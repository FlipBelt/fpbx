import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// This is intentionally an offline regression test. The raw result cache is
// the immutable record of the one primary OCR call made for each sample; rule
// work must never spend OCR quota again.
process.env.OCR_REGRESSION = "1";

const samples = [
  ["new", "2d1010db2280a8f5cc50457b634b134f.jpg", "850.00"],
  ["new", "3db2d0c87daf44c3343f7630b0ab3fe3.jpg", "99.81"],
  ["new", "87f6cabada2ba5bb2f00a213fcafe3ac.jpg", "750.00"],
  ["new", "136d02e7703c360e3db1e9b84bcf5124.jpg", "62.16"],
  ["new", "237de2608976f48ed0ee15220e8997fd.jpg", "4277.36"],
  ["new", "768b29f2d4e8181cffe2bbbb7ebeada8.jpg", "940.00"],
  ["new", "911eb513f421c3806172d85fc9eb77ff.jpg", "0.00"],
  ["new", "7017103679c2f3fd1d5da4fbddf4ab01.jpg", "61.55"],
  ["new", "d2a07ad00c0154cc6203361e33b8ae2e.jpg", "29.23"],
  ["new", "fb74ce0cdc3aaa0e855156c1dd94be9a.jpg", "0.00"],
  ["old", "820回支付.jpg", "85.00"],
  ["old", "ffaeb99e913a35651cb1997641017adb.jpg", "368.00"],
  ["old", "lQDPJwDv9GdYg4_NB1HNBaCw5bxZzoIS9fwKDn1N7FPYAA_1440_1873.jpg", "71.00"],
  ["old", "lQDPKHwWI4Zrk4_NBqXNBaCwug2o9eqItp4KDn1N7FPYAQ_1440_1701.jpg", "78.00"],
  ["old", "截图1.jpg", "24.80"],
  ["old", "截图2.png", "73.30"],
  ["old", "截图3.jpg", "38.90"],
];

const outputDirectory = resolve(process.cwd(), "artifacts");
const rawPath = resolve(outputDirectory, "ocr-regression-raw.json");
const reportPath = resolve(outputDirectory, "ocr-regression-report.json");
const { normalizeOcrResult } = await import("../server.mjs");
const cache = JSON.parse(await readFile(rawPath, "utf8"));
const byName = new Map(cache.map((item) => [item.name, item]));

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function equalAmount(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.005;
}

const report = samples.map(([group, name, expected]) => {
  const cached = byName.get(name);
  if (!cached?.raw) {
    return {
      group, name, expected, candidateAmount: "", finalAmount: "",
      state: "cache_missing", passed: false, paidCalls: 0,
      evidence: "缺少原始 OCR 缓存；本脚本不会发起付费 OCR 调用。",
    };
  }

  const normalized = normalizeOcrResult({
    kind: "payment",
    response: { body: { data: cached.raw } },
    fallbackText: name,
    ocrType: "Advanced",
  });
  const candidateAmount = money(normalized.amount);
  // Only a known, completed-payment scene enters the automatic payment total.
  // Excluded/manual values remain visible as candidates and need user action.
  const finalAmount = normalized.decision === "included" ? candidateAmount : "0.00";
  return {
    group,
    name,
    expected,
    candidateAmount,
    finalAmount,
    state: normalized.decision || "manual",
    scene: normalized.scene || "unknown",
    evidence: normalized.evidence || "",
    warnings: normalized.warnings || [],
    passed: equalAmount(finalAmount, expected),
    paidCalls: 0,
  };
});

const summary = {
  total: report.length,
  passed: report.filter((item) => item.passed).length,
  failed: report.filter((item) => !item.passed).length,
  paidCalls: 0,
  cache: rawPath,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, report }, null, 2), "utf8");

for (const item of report) {
  console.log(`${item.passed ? "PASS" : "FAIL"} | ${item.name} | expected=${item.expected} candidate=${item.candidateAmount} final=${item.finalAmount} | ${item.scene}/${item.state} | paid=${item.paidCalls}`);
}
console.log(`SUMMARY | ${summary.passed}/${summary.total} passed | paid=${summary.paidCalls} | report=${reportPath}`);
process.exitCode = summary.failed ? 1 : 0;
