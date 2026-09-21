import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

// This benchmark intentionally makes the current backend OCR calls. It does
// not upload files to DingTalk or create approvals; it only runs the same OCR
// and classification chain used by the upload endpoint.
process.env.OCR_REGRESSION = "1";

const fixtureDir = resolve(process.cwd(), "..", "测试数据集", "团子的报销（草稿3）");
const outputDir = resolve(process.cwd(), "artifacts");

const visualBaseline = {
  "4合一发票明细.JPG": 378.61,
  "北京打车去机场.jpg": 26.15,
  "北京回杭州机票.jpg": 950.00,
  "北京酒店.png": 255.46,
  "北京午饭.png": 18.17,
  "打车北京机场去酒店.png": 153.94,
  "打车杭州去机场.png": 42.43,
  "打车去高铁站.png": 13.77,
  "打车去高铁站2.png": 14.62,
  "打车去上海高铁站.png": 40.49,
  "打车去ektos.png": 18.84,
  "杭州到北京.png": 122.50,
  "杭州去北京机票.png": 670.00,
  "杭州去北京机票保险.png": 65.00,
  "杭州去上海高铁.png": 87.00,
  "杭州去西安.png": 707.50,
  "金华到杭州送货.png": 322.54,
  "跑团打车.png": 16.29,
  "跑者城市指南抖+投放.jpg": 496.45,
  "上海打车去跑团.png": 47.20,
  "上海地铁.png": 3.00,
  "上海哈罗单车.png": 9.40,
  "上海回杭州高铁.png": 80.00,
  "上海晚饭.png": 45.20,
  "上海午饭.png": 16.20,
  "上海自行车.png": 3.50,
  "西安吃饭2.png": 102.40,
  "西安打车去高铁站.png": 30.76,
  "西安打车去酒店.png": 35.82,
  "西安回杭州高铁.png": 724.50,
  "西安酒店.png": 138.00,
  "西安酒店2.png": 109.00,
  "西安跑团买水.png": 46.29,
  "西安晚饭.png": 27.00,
  "西安自行车.png": 1.80,
  "西安自行车2.png": 7.90,
  "4个发票-金华到杭州送货+西安打车去高铁站+西安打车去酒店+打车去上海高铁站.pdf": 378.61,
  "北京打车去机场.pdf": 26.15,
  "北京回杭州机票.pdf": 950.00,
  "北京机场去酒店.pdf": 142.94,
  "北京酒店（发票只能看这个）.pdf": 241.00,
  "打车杭州去机场.pdf": 42.43,
  "打车去高铁站 (2).pdf": 14.62,
  "打车去高铁站.pdf": 13.77,
  "打车去ektos.pdf": 18.84,
  "杭州到北京高铁.pdf": 122.50,
  "杭州去北京机票（含保险）.pdf": 735.00,
  "杭州去上海高铁.pdf": 87.00,
  "杭州去西安高铁.pdf": 707.50,
  "跑团打车.pdf": 16.29,
  "上海打车去跑团.pdf": 47.20,
  "上海高铁回杭州.pdf": 80.00,
  "西安吃饭.pdf": 102.40,
  "西安回杭州高铁.pdf": 724.50,
  "西安酒店109.pdf": 109.00,
  "西安酒店138.pdf": 138.00,
};

const paymentImages = new Set(Object.keys(visualBaseline).filter((name) => /\.(?:png|jpe?g)$/i.test(name)));
paymentImages.delete("4合一发票明细.JPG");

function money(value) {
  const number = Number(String(value ?? "").replace(/[,，]/g, ""));
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "";
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0).toFixed(2);
}

function closeEnough(actual, expected) {
  return Math.abs(Number(actual || 0) - Number(expected || 0)) <= 0.01;
}

function backendCandidateAmounts(ocr) {
  const values = Array.isArray(ocr?.candidateAmounts) ? ocr.candidateAmounts : [];
  if (values.length) return [...new Set(values.map(money).filter(Boolean))];
  if (ocr?.candidateAmount) return [money(ocr.candidateAmount)].filter(Boolean);
  if (ocr?.amount) return [money(ocr.amount)].filter(Boolean);
  return [];
}

const { readdir } = await import("node:fs/promises");
const { applyDocumentClassification, recognizeUploadedFile } = await import("../server.mjs");
const names = (await readdir(fixtureDir)).filter((name) => visualBaseline[name]);
const results = [];
for (const name of names) {
  const path = join(fixtureDir, name);
  const ext = extname(name).toLowerCase();
  const kind = ext === ".pdf" || name === "4合一发票明细.JPG" ? "invoice" : "payment";
  const file = {
    path,
    name,
    originalFilename: name,
    mimetype: ext === ".pdf" ? "application/pdf" : `image/${ext === ".jpg" || ext === ".jpeg" ? "jpeg" : "png"}`,
  };
  const startedAt = Date.now();
  let ocr;
  let error = "";
  try {
    ocr = await recognizeUploadedFile({ kind, file });
    applyDocumentClassification(kind, ocr, name);
  } catch (caught) {
    error = caught?.message || String(caught);
  }
  const candidates = backendCandidateAmounts(ocr);
  const backendCountable = kind === "invoice"
    ? money(ocr?.countableAmount)
    : ocr?.decision === "included" ? money(ocr?.amount) : "";
  const selectedManual = candidates.length === 1 && ocr?.decision !== "included" ? candidates[0] : "";
  const backendEffective = backendCountable || selectedManual;
  results.push({
    name,
    kind,
    visualAmount: money(visualBaseline[name]),
    backendCountable,
    backendCandidateAmounts: candidates,
    backendEffective,
    decision: ocr?.decision || "",
    scene: ocr?.scene || "",
    documentRole: ocr?.documentRole || "",
    recognizedAmount: money(ocr?.recognizedAmount || ocr?.amount),
    evidence: ocr?.evidence || "",
    warnings: Array.isArray(ocr?.warnings) ? ocr.warnings : [],
    ocrType: ocr?.ocrType || "",
    error,
    durationMs: Date.now() - startedAt,
    match: !error && closeEnough(backendEffective, visualBaseline[name]),
  });
  console.log(`${error ? "ERROR" : results.at(-1).match ? "MATCH" : "DIFF"} | ${name} | visual=${money(visualBaseline[name])} backend=${backendEffective || "0.00"} candidates=${candidates.join("+") || "-"} decision=${ocr?.decision || "-"}`);
}

const paymentRows = results.filter((item) => item.kind === "payment");
const invoiceRows = results.filter((item) => item.kind === "invoice");
const summary = {
  fixtureDir,
  generatedAt: new Date().toISOString(),
  totalFiles: results.length,
  matchedFiles: results.filter((item) => item.match).length,
  differingFiles: results.filter((item) => !item.match).length,
  errors: results.filter((item) => item.error).length,
  visualTotalAllFiles: sum(results.map((item) => item.visualAmount)),
  backendCountableTotalAllFiles: sum(results.map((item) => item.backendCountable)),
  visualPaymentTotal: sum(paymentRows.map((item) => item.visualAmount)),
  backendPaymentCountableTotal: sum(paymentRows.map((item) => item.backendCountable)),
  visualInvoiceTotal: sum(invoiceRows.map((item) => item.visualAmount)),
  backendInvoiceCountableTotal: sum(invoiceRows.map((item) => item.backendCountable)),
  filesWithCandidates: results.filter((item) => item.backendCandidateAmounts.length).length,
  singleCandidateFiles: results.filter((item) => item.backendCandidateAmounts.length === 1).length,
  multiCandidateFiles: results.filter((item) => item.backendCandidateAmounts.length > 1).length,
  singlePaymentCandidateTotal: sum(paymentRows
    .filter((item) => item.backendCandidateAmounts.length === 1)
    .map((item) => item.backendCandidateAmounts[0])),
  results,
};
await mkdir(outputDir, { recursive: true });
const outputPath = join(outputDir, "v2-visual-backend-benchmark.json");
await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");
console.log(`SUMMARY | files=${summary.totalFiles} matched=${summary.matchedFiles} different=${summary.differingFiles} errors=${summary.errors}`);
console.log(`TOTALS | visualAll=${summary.visualTotalAllFiles} backendCountableAll=${summary.backendCountableTotalAllFiles} visualPayment=${summary.visualPaymentTotal} backendPayment=${summary.backendPaymentCountableTotal} visualInvoice=${summary.visualInvoiceTotal} backendInvoice=${summary.backendInvoiceCountableTotal}`);
console.log(`REPORT | ${outputPath}`);
