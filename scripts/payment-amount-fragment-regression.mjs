// Offline regression for OCR currency fragments such as `￥8` + `80.00`.
// This test never calls a paid OCR endpoint.
process.env.OCR_REGRESSION = "1";
const { normalizeOcrResult, applyDocumentClassification } = await import("../server.mjs");

let failed = 0;
function check(name, passed, detail) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  if (!passed) failed += 1;
}

const blockData = {
  content: "杭阳图文广告(三堡店)已收款 ￥ ￥8 80.00 转账时间 2026年09月19日14:02:04 收款时间 2026年09月19日14:05:14 账单详情",
  subImages: [{ blockInfo: { blockDetails: [
    { blockId: 4, blockContent: "杭阳图文广告(三堡店)已收款", blockConfidence: 99 },
    { blockId: 5, blockContent: "￥", blockConfidence: 99 },
    { blockId: 6, blockContent: "￥8", blockConfidence: 72 },
    { blockId: 7, blockContent: "80.00", blockConfidence: 99 },
    { blockId: 8, blockContent: "转账时间", blockConfidence: 99 },
  ] } }],
};
const normalized = normalizeOcrResult({ kind: "payment", response: { body: { data: blockData } }, ocrType: "Advanced" });
check("fragmented currency uses complete high-confidence amount", normalized.amount === "80.00" && normalized.decision === "included", `amount=${normalized.amount || "blank"} decision=${normalized.decision || "blank"}`);
const classified = applyDocumentClassification("payment", normalized, "2.jpg");
check("fragmented currency remains countable payment", classified.detection.role === "payment" && normalized.countableAmount === "80.00", `role=${classified.detection.role} countable=${normalized.countableAmount || "blank"}`);

const flattened = normalizeOcrResult({ kind: "payment", response: { body: { data: { content: "已收款 ￥ ￥8 80.00 转账时间" } } }, ocrType: "Advanced" });
check("flattened OCR text also repairs the prefix fragment", flattened.amount === "80.00" && flattened.decision === "included", `amount=${flattened.amount || "blank"} decision=${flattened.decision || "blank"}`);

console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | failed=${failed}`);
process.exitCode = failed ? 1 : 0;
