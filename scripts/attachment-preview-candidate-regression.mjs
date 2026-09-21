import { readFile } from "node:fs/promises";

process.env.OCR_REGRESSION = "1";

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const { extractScenarioPaymentAmount, normalizeOcrResult } = await import("../server.mjs");

let failed = 0;
function check(name, passed, details = "") {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}${details ? ` | ${details}` : ""}`);
  if (!passed) failed += 1;
}

const singleCandidate = extractScenarioPaymentAmount("付款记录 交通出行 -950.00 2026-08-12 08:35");
check(
  "single unreadable-status payment keeps OCR candidate",
  singleCandidate?.decision === "manual" && singleCandidate?.candidateAmount === "950.00" && singleCandidate?.amount === "",
  `decision=${singleCandidate?.decision || ""} candidate=${singleCandidate?.candidateAmount || ""}`,
);

const multipleCandidates = extractScenarioPaymentAmount("付款记录 -200.00 服务费 -96.45 订单详情");
check(
  "multiple payment candidates are shown without auto-summing",
  multipleCandidates?.decision === "manual" && multipleCandidates?.amount === "" &&
    Array.isArray(multipleCandidates?.candidateAmounts) && multipleCandidates.candidateAmounts.join(",") === "200.00,96.45",
  `candidates=${multipleCandidates?.candidateAmounts?.join(",") || ""}`,
);

const normalizedCandidate = normalizeOcrResult({
  kind: "payment",
  fallbackText: "付款截图.png",
  ocrType: "Advanced",
  response: { body: { data: JSON.stringify({ content: "付款记录 -950.00 交通出行 2026-08-12" }) } },
});
check(
  "normalized OCR response carries candidate to frontend payload",
  normalizedCandidate?.decision === "manual" && normalizedCandidate?.candidateAmount === "950.00" &&
    normalizedCandidate?.candidateAmounts?.[0] === "950.00",
  `candidate=${normalizedCandidate?.candidateAmount || ""}`,
);

const staticChecks = [
  ["server exposes candidate amount fields", serverSource.includes("candidateAmount") && serverSource.includes("candidateAmounts")],
  ["server protects preview URLs with evidence token", serverSource.includes("getAttachmentPreviewUrl") && serverSource.includes("verifyEvidenceToken")],
  ["server exposes attachment preview endpoint", serverSource.includes("/api/files/preview-url") && serverSource.includes("GetFileDownloadInfoRequest")],
  ["assignment UI renders candidate choices", appSource.includes("getOcrCandidateAmounts") && appSource.includes("data-value=\"${escapeHtml(formatMoney(value))}\"")],
  ["assignment UI renders preview action", appSource.includes("data-assignment-action=\"preview-file\"")],
  ["OCR suggestion filenames are preview buttons", appSource.includes("ocr-suggestion-file-preview") && appSource.includes("ocrSuggestionList?.addEventListener")],
  ["restored DingTalk attachments are previewable", appSource.includes("/api/files/preview-url?") && appSource.includes("evidence_token")],
  ["candidate and preview controls have styles", styleSource.includes(".assignment-file-preview") && styleSource.includes(".assignment-file-candidates")],
];
staticChecks.forEach(([name, passed]) => check(name, passed));

console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${3 + staticChecks.length}`);
process.exitCode = failed ? 1 : 0;
