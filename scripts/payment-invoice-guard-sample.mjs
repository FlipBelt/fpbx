import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.env.OCR_REGRESSION = "1";

const {
  detectHighConfidenceInvoiceDocument,
  getAliyunOcrClient,
  recognizeWithFallback,
  resolveUploadedDocumentKind,
} = await import("../server.mjs");

const samplePath = fileURLToPath(new URL("../../测试数据集/新功能测试/1-536.png", import.meta.url));
const cachePath = fileURLToPath(new URL("../artifacts/payment-invoice-guard-sample.json", import.meta.url));
let ocr;
let paidCalls = 0;

try {
  await access(cachePath);
  ocr = JSON.parse(await readFile(cachePath, "utf8"));
} catch {
  const client = getAliyunOcrClient();
  if (!client) throw new Error("OCR 服务未配置，无法生成首次样本缓存。");
  ocr = await recognizeWithFallback({
    client,
    kind: "payment",
    file: {
      path: samplePath,
      name: "1-536.png",
      originalFilename: "1-536.png",
      mimetype: "image/png",
    },
  });
  paidCalls = 1;
  await mkdir(fileURLToPath(new URL("../artifacts/", import.meta.url)), { recursive: true });
  await writeFile(cachePath, JSON.stringify(ocr, null, 2), "utf8");
}

const detection = detectHighConfidenceInvoiceDocument(ocr);
const resolution = resolveUploadedDocumentKind("payment", ocr);
const passed = detection.role === "invoice" &&
  detection.confidence === "high" &&
  resolution.kind === "invoice" &&
  resolution.reclassified;

console.log(`${passed ? "PASS" : "FAIL"} | actual invoice image | role=${detection.role} confidence=${detection.confidence || "none"} reclassified=${resolution.reclassified} signals=${detection.signals.join(",")} paid=${paidCalls}`);
console.log(`CACHE | ${cachePath}`);
process.exitCode = passed ? 0 : 1;
