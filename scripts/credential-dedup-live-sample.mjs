import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

process.env.OCR_REGRESSION = "1";

const {
  applyDocumentClassification,
  buildDocumentIdentity,
  recognizeUploadedFile,
} = await import("../server.mjs");

const imageCachePath = resolve(
  process.env.CREDENTIAL_DEDUP_IMAGE_CACHE ||
  resolve("artifacts", "payment-invoice-guard-sample.json"),
);
const pdfCachePath = resolve(
  process.env.CREDENTIAL_DEDUP_PDF_CACHE ||
  resolve("artifacts", "credential-dedup-pdf-sample.json"),
);
const pdfPath = resolve(process.env.CREDENTIAL_DEDUP_PDF_SOURCE || resolve(
  "..",
  "测试数据集",
  "新功能测试",
  "dzfp_26332000005749300096_宁波甄质供应链管理有限公司_20260727121619.pdf",
));
const imageOcr = JSON.parse(await readFile(imageCachePath, "utf8"));
let pdfOcr;
let paidCalls = 0;
try {
  await access(pdfCachePath);
  pdfOcr = JSON.parse(await readFile(pdfCachePath, "utf8"));
} catch {
  pdfOcr = await recognizeUploadedFile({
    kind: "invoice",
    file: {
      path: pdfPath,
      name: "dzfp_26332000005749300096_宁波甄质供应链管理有限公司_20260727121619.pdf",
      originalFilename: "dzfp_26332000005749300096_宁波甄质供应链管理有限公司_20260727121619.pdf",
      mimetype: "application/pdf",
    },
  });
  paidCalls = 1;
  await writeFile(pdfCachePath, JSON.stringify(pdfOcr, null, 2), "utf8");
}

applyDocumentClassification("payment", imageOcr, "1-536.png");
applyDocumentClassification(
  "invoice",
  pdfOcr,
  "dzfp_26332000005749300096_宁波甄质供应链管理有限公司_20260727121619.pdf",
);
const imageIdentity = buildDocumentIdentity(imageOcr, "1-536.png", "a".repeat(64));
const pdfIdentity = buildDocumentIdentity(pdfOcr, "原始PDF发票.pdf", "b".repeat(64));
const passed =
  imageOcr.documentRole === "tax_invoice" &&
  pdfOcr.documentRole === "tax_invoice" &&
  imageOcr.countableAmount === "539.00" &&
  pdfOcr.countableAmount === "539.00" &&
  imageIdentity.possibleFingerprint &&
  imageIdentity.possibleFingerprint === pdfIdentity.possibleFingerprint;

console.log(
  `${passed ? "PASS" : "FAIL"} | actual cross-format invoice | image_role=${imageOcr.documentRole} pdf_role=${pdfOcr.documentRole} image_amount=${imageOcr.countableAmount || "0.00"} pdf_amount=${pdfOcr.countableAmount || "0.00"} review_match=${imageIdentity.possibleFingerprint === pdfIdentity.possibleFingerprint} paid=${paidCalls}`,
);
console.log(`PDF_CACHE | ${pdfCachePath}`);
process.exitCode = passed ? 0 : 1;
