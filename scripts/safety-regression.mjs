// Offline safety checks. This test never invokes an OCR endpoint.
process.env.OCR_REGRESSION = "1";

const {
  detectHighConfidenceInvoiceDocument,
  extractFilenameAmount,
  normalizeApprovalPayload,
  normalizeOcrResult,
  resolveUploadedDocumentKind,
} = await import("../server.mjs");

const filenameCases = [
  ["IMG_0579.PNG", ""],
  ["IMG_0588.PNG", ""],
  ["IMG_0589.PNG", ""],
  ["付款金额85.00元.png", "85.00"],
  ["发票-实付99.81元.pdf", "99.81"],
];

let failed = 0;
for (const [filename, expected] of filenameCases) {
  const actual = extractFilenameAmount(filename, false);
  const passed = actual === expected;
  console.log(`${passed ? "PASS" : "FAIL"} | filename | ${filename} | expected=${expected || "blank"} actual=${actual || "blank"}`);
  if (!passed) failed += 1;
}

for (const filename of ["IMG_0579.PNG", "IMG_0588.PNG", "IMG_0589.PNG"]) {
  const normalized = normalizeOcrResult({
    kind: "payment",
    response: { body: { data: {} } },
    fallbackText: filename,
    ocrType: "Advanced",
  });
  const passed = normalized.amount === "";
  console.log(`${passed ? "PASS" : "FAIL"} | empty-ocr | ${filename} | expected=blank actual=${normalized.amount || "blank"}`);
  if (!passed) failed += 1;
}

const invoiceAsPayment = {
  rawText: "购买方信息 名称：宁波甄质供应链管理有限公司 统一社会信用代码/纳税人识别号：91330205MAE832CB83 销售方信息 名称：大味士（杭州）餐饮管理有限公司 纳税人识别号：91330102MAE0L72E3G 项目名称 餐费 金额533.66 税率1% 税额5.34 价税合计（小写）¥539.00",
};
const invoiceDetection = detectHighConfidenceInvoiceDocument(invoiceAsPayment);
const invoiceResolution = resolveUploadedDocumentKind("payment", invoiceAsPayment);
const invoiceReclassified = invoiceDetection.role === "invoice" &&
  invoiceDetection.confidence === "high" &&
  invoiceResolution.kind === "invoice" &&
  invoiceResolution.detection.role === "tax_invoice" &&
  invoiceResolution.reclassified;
console.log(`${invoiceReclassified ? "PASS" : "FAIL"} | payment content guard | invoice image reclassified=${invoiceResolution.reclassified} role=${invoiceDetection.role}`);
if (!invoiceReclassified) failed += 1;

const legitimatePayment = {
  rawText: "微信支付 付款成功 ¥539.00 商户：大味士餐饮 交易单号 420000123456 申请发票",
  amount: "539.00",
  decision: "included",
};
const paymentDetection = detectHighConfidenceInvoiceDocument(legitimatePayment);
const paymentResolution = resolveUploadedDocumentKind("payment", legitimatePayment);
const paymentAccepted = paymentDetection.role !== "invoice" &&
  paymentResolution.kind === "payment" &&
  paymentResolution.detection.role === "payment" &&
  !paymentResolution.reclassified;
console.log(`${paymentAccepted ? "PASS" : "FAIL"} | payment content guard | legitimate payment accepted=${paymentAccepted}`);
if (!paymentAccepted) failed += 1;

try {
  normalizeApprovalPayload({ dept_id: "397440593", form_component_values: [] }, null);
  console.log("FAIL | approval session | expired session unexpectedly accepted");
  failed += 1;
} catch (error) {
  const passed = error.statusCode === 401;
  console.log(`${passed ? "PASS" : "FAIL"} | approval session | expected=401 actual=${error.statusCode || "none"}`);
  if (!passed) failed += 1;
}

const validPayload = normalizeApprovalPayload({ dept_id: "397440593", form_component_values: [] }, {
  user: { userId: "current-user", departments: [{ id: "397440593", name: "测试部门" }] },
});
const validPassed = validPayload.originator_user_id === "current-user";
console.log(`${validPassed ? "PASS" : "FAIL"} | approval originator | expected=current-user actual=${validPayload.originator_user_id || "blank"}`);
if (!validPassed) failed += 1;

console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | paid=0`);
process.exitCode = failed ? 1 : 0;
