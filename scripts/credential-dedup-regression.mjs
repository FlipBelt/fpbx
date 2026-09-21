process.env.OCR_REGRESSION = "1";
process.env.EVIDENCE_SIGNING_SECRET = "credential-dedup-regression";

const {
  applyDocumentClassification,
  auditApprovalEvidence,
  buildDocumentIdentity,
  sanitizeApprovalEvidenceAttachments,
  signEvidenceRecord,
} = await import("../server.mjs");

let failed = 0;
function check(name, passed, details = "") {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
  if (!passed) failed += 1;
}

function invoiceOcr(invoiceNumber, amount = "539.00", extra = {}) {
  const ocr = {
    rawText: `电子发票 发票号码 ${invoiceNumber} 开票日期 2026年07月27日 购买方 杭州环飞体育科技有限公司 销售方 宁波甄质供应链管理有限公司 价税合计 ￥${amount}`,
    amount,
    sellerName: "宁波甄质供应链管理有限公司",
    buyerName: "杭州环飞体育科技有限公司",
    ...extra,
  };
  applyDocumentClassification("invoice", ocr, extra.fileName || "电子发票.pdf");
  return ocr;
}

const pdfIdentity = buildDocumentIdentity(
  invoiceOcr("26332000005749300096"),
  "原始发票.pdf",
  "a".repeat(64),
);
const screenshotIdentity = buildDocumentIdentity(
  invoiceOcr("26332000005749300096"),
  "付款区上传的发票截图.png",
  "b".repeat(64),
);
check(
  "same invoice across PDF and screenshot has one semantic fingerprint",
  pdfIdentity.semanticFingerprint &&
    pdfIdentity.semanticFingerprint === screenshotIdentity.semanticFingerprint &&
    pdfIdentity.contentFingerprint !== screenshotIdentity.contentFingerprint,
  `semantic_match=${pdfIdentity.semanticFingerprint === screenshotIdentity.semanticFingerprint}`,
);

const differentInvoiceIdentity = buildDocumentIdentity(
  invoiceOcr("26332000005749300097"),
  "相同金额的另一张发票.pdf",
  "c".repeat(64),
);
check(
  "same amount but different invoice number is not merged",
  differentInvoiceIdentity.semanticFingerprint !== pdfIdentity.semanticFingerprint,
);

const possibleA = invoiceOcr("", "88.00", {
  rawText: "电子发票 开票日期 2026年07月27日 销售方 宁波测试服务有限公司 价税合计 ￥88.00",
  sellerName: "宁波测试服务有限公司",
});
const possibleB = structuredClone(possibleA);
const possibleIdentityA = buildDocumentIdentity(possibleA, "模糊发票A.png", "d".repeat(64));
const possibleIdentityB = buildDocumentIdentity(possibleB, "模糊发票B.pdf", "e".repeat(64));
check(
  "incomplete but highly similar invoices enter one review group",
  !possibleIdentityA.semanticFingerprint &&
    possibleIdentityA.possibleFingerprint &&
    possibleIdentityA.possibleFingerprint === possibleIdentityB.possibleFingerprint,
);

const userId = "credential-dedup-user";
function record(seed) {
  return {
    v: 1,
    userId,
    issuedAt: Date.now(),
    roleConfidence: "high",
    paymentDecision: seed.documentRole === "payment" ? "included" : "",
    recognizedAmount: seed.countableAmount,
    contentFingerprint: "",
    semanticFingerprint: "",
    possibleFingerprint: "",
    possibleDuplicateOfFileId: "",
    possibleDuplicateOfFileName: "",
    ...seed,
  };
}

const records = [
  record({
    fileId: "pay-1",
    fileName: "付款截图.png",
    originalKind: "payment",
    kind: "payment",
    documentRole: "payment",
    countableAmount: "100.00",
    semanticFingerprint: "payment-number:unique-1",
  }),
  record({
    fileId: "inv-1",
    fileName: "原始发票.pdf",
    originalKind: "invoice",
    kind: "invoice",
    documentRole: "tax_invoice",
    countableAmount: "100.00",
    semanticFingerprint: "invoice-number:same-document",
  }),
  record({
    fileId: "inv-2",
    fileName: "同一发票截图.png",
    originalKind: "payment",
    kind: "invoice",
    documentRole: "tax_invoice",
    countableAmount: "100.00",
    semanticFingerprint: "invoice-number:same-document",
  }),
];

function attachment(item) {
  return { fileId: item.fileId, fileName: item.fileName };
}

function buildDraft(inputRecords, decisions = {}, processingTokens = []) {
  const paymentAttachments = inputRecords.filter((item) => item.kind === "payment").map(attachment);
  const invoiceAttachments = inputRecords.filter((item) => item.kind === "invoice").map(attachment);
  return {
    evidence_manifest: inputRecords.map((item) => ({
      fileId: item.fileId,
      token: signEvidenceRecord(item),
      duplicateDecision: decisions[item.fileId] || "",
    })),
    evidence_processing_tokens: processingTokens,
    form_component_values: [
      {
        name: "表格",
        value: JSON.stringify([[
          { name: "申请事由", value: "跨格式重复测试" },
          { name: "金额", value: "100.00" },
          { name: "发票类型", value: "电子-普票" },
          { name: "付款截图/订单截图", value: JSON.stringify(paymentAttachments) },
          { name: "对应发票上传", value: JSON.stringify(invoiceAttachments) },
        ]]),
      },
      { name: "申请金额（元）", value: "100.00" },
    ],
  };
}

const session = { user: { userId } };
const duplicateDraft = buildDraft(records);
const duplicateAudit = auditApprovalEvidence(duplicateDraft, session);
check(
  "backend counts cross-format duplicate invoice only once",
  duplicateAudit.errors.length === 0 &&
    duplicateAudit.totals.paymentAmount === "100.00" &&
    duplicateAudit.totals.taxInvoiceAmount === "100.00" &&
    duplicateAudit.processing.duplicateCount === 1 &&
    duplicateAudit.excludedFileIds.includes("inv-2"),
  `tax=${duplicateAudit.totals.taxInvoiceAmount} duplicates=${duplicateAudit.processing.duplicateCount}`,
);

const sanitized = sanitizeApprovalEvidenceAttachments(duplicateDraft, duplicateAudit.excludedFileIds);
const sanitizedRows = JSON.parse(sanitized.form_component_values[0].value);
const sanitizedInvoices = JSON.parse(sanitizedRows[0].find((cell) => cell.name === "对应发票上传").value);
check(
  "duplicate attachment is removed from final OA table",
  sanitizedInvoices.length === 1 && sanitizedInvoices[0].fileId === "inv-1",
  `oa_invoice_attachments=${sanitizedInvoices.length}`,
);

const possibleRecords = [
  records[0],
  record({
    fileId: "possible-base",
    fileName: "模糊发票A.png",
    originalKind: "invoice",
    kind: "invoice",
    documentRole: "tax_invoice",
    countableAmount: "100.00",
  }),
  record({
    fileId: "possible-review",
    fileName: "模糊发票B.pdf",
    originalKind: "invoice",
    kind: "invoice",
    documentRole: "tax_invoice",
    countableAmount: "100.00",
    possibleDuplicateOfFileId: "possible-base",
    possibleDuplicateOfFileName: "模糊发票A.png",
  }),
];
const unresolvedAudit = auditApprovalEvidence(buildDraft(possibleRecords), session);
check(
  "possible duplicate cannot pass unnoticed",
  unresolvedAudit.errors.some((message) => message.includes("集中确认")),
);

const confirmedSameAudit = auditApprovalEvidence(
  buildDraft(possibleRecords, { "possible-review": "same" }),
  session,
);
check(
  "user-confirmed duplicate is excluded and normal amount still passes",
  confirmedSameAudit.errors.length === 0 &&
    confirmedSameAudit.totals.taxInvoiceAmount === "100.00" &&
    confirmedSameAudit.processing.duplicateCount === 1,
);

const confirmedDifferentAudit = auditApprovalEvidence(
  buildDraft(possibleRecords, { "possible-review": "different" }),
  session,
);
check(
  "user-confirmed distinct documents remain independently countable",
  confirmedDifferentAudit.errors.length === 0 &&
    confirmedDifferentAudit.totals.taxInvoiceAmount === "200.00" &&
    confirmedDifferentAudit.processing.reviewedDistinctCount === 1,
);

const processingEventToken = signEvidenceRecord({
  v: 1,
  recordType: "processing_event",
  action: "confirmed_duplicate",
  userId,
  fileId: "inv-1",
  canonicalFileName: "原始发票.pdf",
  duplicateFileName: "付款区上传的发票截图.png",
  documentRole: "tax_invoice",
  matchReasons: ["发票号码一致"],
  issuedAt: Date.now(),
});
const eventAudit = auditApprovalEvidence(buildDraft(records.slice(0, 2), {}, [processingEventToken]), session);
check(
  "automatic merge event is included in finance-facing audit summary",
  eventAudit.processing.duplicateCount === 1,
);

console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
