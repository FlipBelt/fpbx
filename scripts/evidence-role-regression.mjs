process.env.OCR_REGRESSION = "1";

const {
  applyDocumentClassification,
  auditApprovalEvidence,
  extractScenarioPaymentAmount,
  reconcileSubmittedAttachmentBindings,
  signEvidenceRecord,
} = await import("../server.mjs");

let failed = 0;
function check(name, passed, details = "") {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
  if (!passed) failed += 1;
}

function classified(originalKind, fileName, rawText, amount, decision = "") {
  const ocr = { rawText, amount, decision, warnings: [] };
  const result = applyDocumentClassification(originalKind, ocr, fileName);
  return { ...result, ocr };
}

const taxInvoice = classified(
  "payment",
  "dzfp_26332000005749300096.pdf",
  "电子发票 发票号码 26332000005749300096 购买方名称 杭州环飞体育科技有限公司 纳税人识别号 9133 销售方名称 宁波甄质供应链管理有限公司 税率 税额 价税合计（小写）￥539.00",
  "539.00",
);
check(
  "invoice uploaded in payment area is automatically moved",
  taxInvoice.kind === "invoice" && taxInvoice.reclassified &&
    taxInvoice.ocr.documentRole === "tax_invoice" &&
    taxInvoice.ocr.countableAmount === "539.00",
  `kind=${taxInvoice.kind} role=${taxInvoice.ocr.documentRole}`,
);

const itinerary = classified(
  "invoice",
  "【T3出行-55.91元-2个行程】高德打车电子行程单.pdf",
  "高德打车电子行程单 共计2单行程 行程时间 起点 终点 合计55.91元",
  "55.91",
);
check(
  "itinerary stays attached but is excluded from invoice amount",
  itinerary.kind === "invoice" && !itinerary.reclassified &&
    itinerary.ocr.documentRole === "supporting_document" &&
    itinerary.ocr.countableAmount === "",
  `kind=${itinerary.kind} role=${itinerary.ocr.documentRole} countable=${itinerary.ocr.countableAmount || "0"}`,
);

const railTicket = classified(
  "invoice",
  "8月17高铁.pdf",
  "铁路电子客票 中国铁路 车次 G1234 乘车日期 2026年08月17日 始发站 杭州东 终到站 上海虹桥 票价 ￥100.00",
  "100.00",
);
check(
  "railway e-ticket is a countable title-exempt transport receipt",
  railTicket.kind === "invoice" && railTicket.ocr.documentRole === "title_exempt_transport_receipt" &&
    railTicket.ocr.countableAmount === "100.00",
  `kind=${railTicket.kind} role=${railTicket.ocr.documentRole} countable=${railTicket.ocr.countableAmount || "0"}`,
);

const ambiguousRailName = classified(
  "invoice",
  "高铁票.pdf",
  "报销附件 金额 ￥100.00",
  "100.00",
);
check(
  "railway filename alone never creates a title exemption",
  ambiguousRailName.ocr.documentRole === "unknown",
  `role=${ambiguousRailName.ocr.documentRole}`,
);

const payment = classified(
  "invoice",
  "微信支付截图.png",
  "微信支付 付款成功 实付金额 ￥88.00 支付时间 2026-07-27 付款方式 零钱",
  "88.00",
  "included",
);
check(
  "payment uploaded in invoice area is automatically moved",
  payment.kind === "payment" && payment.reclassified &&
    payment.ocr.documentRole === "payment" &&
    payment.ocr.countableAmount === "88.00",
  `kind=${payment.kind} role=${payment.ocr.documentRole}`,
);

const discountedPayment = extractScenarioPaymentAmount(
  "账单详情 高德打车 -38.90 自动扣款成功 订单金额 39.30 工商银行立减 -0.40 支付时间 2026-07-14 付款方式 工商银行储蓄卡",
);
check(
  "bank discount payment uses actual debit instead of order amount",
  discountedPayment?.amount === "38.90" && discountedPayment?.decision === "included",
  `amount=${discountedPayment?.amount || "blank"} scene=${discountedPayment?.scene || "blank"}`,
);

const awaitingReceiptPayment = extractScenarioPaymentAmount(
  "账单详情 商户 -14.39 等待确认收货 支付时间 2026-07-16 付款方式 工商银行储蓄卡 订单号 202607162300",
);
check(
  "paid order awaiting receipt is accepted as completed payment",
  awaitingReceiptPayment?.amount === "14.39" && awaitingReceiptPayment?.decision === "included",
  `amount=${awaitingReceiptPayment?.amount || "blank"} scene=${awaitingReceiptPayment?.scene || "blank"}`,
);

function attachment(fileId, fileName) {
  return { fileId, fileName };
}

function buildDraft(rowDefinitions, records, { noInvoice = false, invoiceOnly = false, applicationAmount } = {}) {
  const userId = "regression-user";
  const manifest = records.map((record) => {
    const signed = {
      v: 1,
      userId,
      issuedAt: Date.now(),
      recognizedAmount: record.countableAmount || "",
      paymentDecision: record.documentRole === "payment" ? "included" : "",
      roleConfidence: "high",
      ...record,
    };
    return {
      fileId: record.fileId,
      token: signEvidenceRecord(signed),
      manualAmount: "",
    };
  });
  const tableRows = rowDefinitions.map((row) => [
    { name: "申请事由", value: row.reason },
    { name: "金额", value: row.amount },
    { name: "发票类型", value: row.invoiceType || "电子-普票" },
    {
      name: "付款截图/订单截图",
      value: JSON.stringify(row.paymentIds.map((id) => attachment(id, records.find((item) => item.fileId === id)?.fileName))),
    },
    {
      name: "对应发票上传",
      value: JSON.stringify(row.invoiceIds.map((id) => attachment(id, records.find((item) => item.fileId === id)?.fileName))),
    },
  ]);
  return {
    evidence_validation_version: 2,
    evidence_manifest: manifest,
    no_invoice: noInvoice,
    invoice_only: invoiceOnly,
    form_component_values: [
      { name: "表格", value: JSON.stringify(tableRows) },
      { name: "申请金额（元）", value: applicationAmount || rowDefinitions.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2) },
    ],
  };
}

const mixedRecords = [
  { fileId: "p1", fileName: "第1行付款合计", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "537.51" },
  { fileId: "i1", fileName: "第1行16张税务发票", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "532.01" },
  ...Array.from({ length: 16 }, (_, index) => ({
    fileId: `s${index + 1}`,
    fileName: `第1行行程单${index + 1}`,
    originalKind: "invoice",
    kind: "invoice",
    documentRole: "supporting_document",
    countableAmount: "",
  })),
  { fileId: "p2", fileName: "第2行付款合计", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "681.39" },
  { fileId: "i2", fileName: "第2行税务发票", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "667.00" },
  { fileId: "p3", fileName: "第3行付款合计", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "146.11" },
  { fileId: "i3", fileName: "第3行税务发票", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "130.00" },
  { fileId: "p4", fileName: "第4行付款", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "367.03" },
  { fileId: "i4", fileName: "第4行税务发票", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "367.03" },
];
const mixedRows = [
  { reason: "拍摄差旅费用", amount: "537.51", paymentIds: ["p1"], invoiceIds: ["i1", ...Array.from({ length: 16 }, (_, index) => `s${index + 1}`)] },
  { reason: "后期软件费用", amount: "681.39", paymentIds: ["p2"], invoiceIds: ["i2"] },
  { reason: "拍摄道具", amount: "146.11", paymentIds: ["p3"], invoiceIds: ["i3"] },
  { reason: "崇礼车辆油费", amount: "367.03", paymentIds: ["p4"], invoiceIds: ["i4"] },
];
const mixedAudit = auditApprovalEvidence(
  buildDraft(mixedRows, mixedRecords, { applicationAmount: "1732.04" }),
  { user: { userId: "regression-user" } },
);
check(
  "exact mixed case excludes 16 itineraries, explains their role, and blocks missing 36 yuan",
  mixedAudit.errors.length === 4 &&
    mixedAudit.totals.paymentAmount === "1732.04" &&
    mixedAudit.totals.taxInvoiceAmount === "1696.04" &&
    mixedAudit.totals.shortfall === "36.00" &&
    mixedAudit.rows[0].supportingDocumentCount === 16 &&
    mixedAudit.errors.some((message) => message.includes("行程单/佐证材料")),
  `errors=${mixedAudit.errors.length} payment=${mixedAudit.totals.paymentAmount} tax=${mixedAudit.totals.taxInvoiceAmount} missing=${mixedAudit.totals.shortfall}`,
);
check(
  "exact row shortages are reported",
  ["5.50", "14.39", "16.11"].every((amount) => mixedAudit.errors.some((message) => message.includes(`缺少 ${amount} 元`))),
  mixedAudit.errors.join(" / "),
);

const normalRecords = [
  { fileId: "normal-p", fileName: "正常付款.png", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "100.00" },
  { fileId: "normal-i", fileName: "正常发票.pdf", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "100.00" },
];
const normalAudit = auditApprovalEvidence(
  buildDraft([{ reason: "正常报销", amount: "100.00", paymentIds: ["normal-p"], invoiceIds: ["normal-i"] }], normalRecords),
  { user: { userId: "regression-user" } },
);
check("existing normal reimbursement still passes", normalAudit.errors.length === 0);

const detachedSupplementDraft = buildDraft(
  [{ reason: "补传发票后提交", amount: "100.00", paymentIds: ["normal-p"], invoiceIds: [] }],
  normalRecords,
);
detachedSupplementDraft.attachment_row_bindings = [{
  rowIndex: 0,
  rowId: "second-row",
  paymentAttachments: [attachment("normal-p", "正常付款.png")],
  invoiceAttachments: [attachment("normal-i", "正常发票.pdf")],
}];
const reconciledSupplementDraft = reconcileSubmittedAttachmentBindings(
  detachedSupplementDraft,
  { user: { userId: "regression-user" } },
);
const reconciledSupplementAudit = auditApprovalEvidence(
  reconciledSupplementDraft,
  { user: { userId: "regression-user" } },
);
check(
  "signed supplemental invoice binding is restored into the submitted row before audit",
  reconciledSupplementAudit.errors.length === 0 &&
    parseInt(reconciledSupplementAudit.totals.taxInvoiceAmount, 10) === 100,
  `errors=${reconciledSupplementAudit.errors.length} tax=${reconciledSupplementAudit.totals.taxInvoiceAmount}`,
);

const manifestTargetRecoveryDraft = buildDraft(
  [{ reason: "回执目标行恢复", amount: "100.00", paymentIds: ["normal-p"], invoiceIds: [] }],
  normalRecords,
);
manifestTargetRecoveryDraft.attachment_row_bindings = [{
  rowIndex: 0,
  rowId: "second-row",
  paymentAttachments: [],
  invoiceAttachments: [],
}];
const targetManifestItem = manifestTargetRecoveryDraft.evidence_manifest.find((item) => item.fileId === "normal-i");
targetManifestItem.targetRowId = "second-row";
targetManifestItem.attachment = { spaceId: "space", fileId: "normal-i", fileName: "正常发票.pdf", fileSize: "100", fileType: "pdf" };
const manifestTargetRecoveryAudit = auditApprovalEvidence(
  reconcileSubmittedAttachmentBindings(manifestTargetRecoveryDraft, { user: { userId: "regression-user" } }),
  { user: { userId: "regression-user" } },
);
check(
  "signed manifest target restores an attachment when a browser redraw empties its row field",
  manifestTargetRecoveryAudit.errors.length === 0 && manifestTargetRecoveryAudit.totals.taxInvoiceAmount === "100.00",
  `errors=${manifestTargetRecoveryAudit.errors.length} tax=${manifestTargetRecoveryAudit.totals.taxInvoiceAmount}`,
);

const excessPaymentRecords = [
  { fileId: "excess-p", fileName: "多付一元付款.png", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "45.90" },
  { fileId: "excess-i", fileName: "实际报销发票.pdf", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "44.90" },
];
const excessPaymentAudit = auditApprovalEvidence(
  buildDraft(
    [{ reason: "实际只报销44.90元", amount: "44.90", paymentIds: ["excess-p"], invoiceIds: ["excess-i"] }],
    excessPaymentRecords,
    { applicationAmount: "44.90" },
  ),
  { user: { userId: "regression-user" } },
);
check(
  "payment higher than declared amount warns but still passes",
  excessPaymentAudit.errors.length === 0 &&
    excessPaymentAudit.warnings.some((message) => message.includes("多付 1.00 元")) &&
    excessPaymentAudit.totals.shortfall === "0.00",
  `errors=${excessPaymentAudit.errors.length} warnings=${excessPaymentAudit.warnings.join(" / ")}`,
);

const legacyDraft = buildDraft(
  [{ reason: "旧页面正常报销", amount: "100.00", paymentIds: ["normal-p"], invoiceIds: ["normal-i"] }],
  normalRecords,
);
legacyDraft.evidence_manifest = [];
const legacyEvidence = new Map(normalRecords.map((record) => [record.fileId, {
  v: 1,
  userId: "regression-user",
  issuedAt: Date.now(),
  recognizedAmount: record.countableAmount,
  paymentDecision: record.documentRole === "payment" ? "included" : "",
  roleConfidence: "high",
  ...record,
}]));
const legacyAudit = auditApprovalEvidence(
  legacyDraft,
  { user: { userId: "regression-user" }, evidenceByFileId: legacyEvidence },
);
check("already-open legacy page still submits without re-upload", legacyAudit.errors.length === 0);

const discountRecords = [
  { fileId: "discount-p", fileName: "优惠后付款.png", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "99.00" },
  { fileId: "discount-i", fileName: "优惠前发票.pdf", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "100.00" },
];
const discountAudit = auditApprovalEvidence(
  buildDraft([{ reason: "正常优惠报销", amount: "99.00", paymentIds: ["discount-p"], invoiceIds: ["discount-i"] }], discountRecords),
  { user: { userId: "regression-user" } },
);
check("invoice higher than payment still passes for discounts", discountAudit.errors.length === 0);

const noInvoiceRecords = [
  { fileId: "noinvoice-p", fileName: "无票付款.png", originalKind: "payment", kind: "payment", documentRole: "payment", countableAmount: "36.00" },
];
const noInvoiceAudit = auditApprovalEvidence(
  buildDraft(
    [{ reason: "无票报销", amount: "36.00", invoiceType: "无", paymentIds: ["noinvoice-p"], invoiceIds: [] }],
    noInvoiceRecords,
    { noInvoice: true },
  ),
  { user: { userId: "regression-user" } },
);
check("no-invoice workflow still passes without invoice", noInvoiceAudit.errors.length === 0);

const invoiceOnlyRecords = [
  { fileId: "supply-i", fileName: "采购供应链发票.pdf", originalKind: "invoice", kind: "invoice", documentRole: "tax_invoice", countableAmount: "268.00" },
];
const invoiceOnlyAudit = auditApprovalEvidence(
  buildDraft(
    [{ reason: "采购供应链费用", amount: "268.00", paymentIds: [], invoiceIds: ["supply-i"] }],
    invoiceOnlyRecords,
    { invoiceOnly: true },
  ),
  { user: { userId: "regression-user" } },
);
check("invoice-only workflow passes with tax invoice and no payment proof", invoiceOnlyAudit.errors.length === 0 && invoiceOnlyAudit.invoiceOnly);

const invoiceOnlyMismatch = auditApprovalEvidence(
  buildDraft(
    [{ reason: "采购供应链费用", amount: "269.00", paymentIds: [], invoiceIds: ["supply-i"] }],
    invoiceOnlyRecords,
    { invoiceOnly: true, applicationAmount: "269.00" },
  ),
  { user: { userId: "regression-user" } },
);
check("invoice-only workflow blocks declared amount mismatch", invoiceOnlyMismatch.errors.some((message) => message.includes("税务发票合计 268.00 元")));

console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
