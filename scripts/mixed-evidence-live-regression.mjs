import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

process.env.OCR_REGRESSION = "1";

const {
  applyDocumentClassification,
  auditApprovalEvidence,
  normalizeOcrResult,
  recognizeUploadedFile,
  signEvidenceRecord,
} = await import("../server.mjs");

const businessId = "202607271704000137280";
const defaultSource = resolve("artifacts", `approval-${businessId}-files`);
const sourceDirectory = resolve(process.env.MIXED_EVIDENCE_SOURCE || defaultSource);
const manifestPath = join(sourceDirectory, "manifest.json");
const cachePath = resolve(
  process.env.MIXED_EVIDENCE_CACHE ||
  join("artifacts", `approval-${businessId}-mixed-live-ocr.json`),
);
const reportPath = resolve(
  process.env.MIXED_EVIDENCE_REPORT ||
  join("artifacts", `approval-${businessId}-mixed-live-report.json`),
);
const concurrency = Math.max(1, Math.min(4, Number(process.env.MIXED_EVIDENCE_CONCURRENCY || 3)));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, files);
    else files.push(path);
  }
  return files;
}

const sourceFiles = await walk(sourceDirectory);
const sourceByLocalName = new Map(sourceFiles.map((path) => [path.split(/[\\/]/).at(-1), path]));

function mimeType(name) {
  return {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  }[extname(name).toLowerCase()] || "application/octet-stream";
}

async function readCache() {
  try {
    await access(cachePath);
    const value = JSON.parse(await readFile(cachePath, "utf8"));
    return Array.isArray(value.results) ? value.results : [];
  } catch {
    return [];
  }
}

let results = await readCache();
const cachedByKey = new Map(results.map((item) => [`${item.row}:${item.group}:${item.index}`, item]));
const pending = manifest.filter((item) => !cachedByKey.has(`${item.row}:${item.group}:${item.index}`));
let paidFiles = 0;

async function persistCache() {
  await mkdir(dirname(cachePath), { recursive: true });
  results = [...cachedByKey.values()].sort((left, right) => (
    left.row - right.row ||
    String(left.group).localeCompare(String(right.group), "zh-CN") ||
    left.index - right.index
  ));
  await writeFile(cachePath, JSON.stringify({
    businessId,
    generatedAt: new Date().toISOString(),
    sourceDirectory,
    results,
  }, null, 2), "utf8");
}

async function recognizeItem(item) {
  const key = `${item.row}:${item.group}:${item.index}`;
  const path = sourceByLocalName.get(item.localName);
  if (!path) throw new Error(`找不到源文件：${item.localName}`);
  const originalKind = item.group === "付款" ? "payment" : "invoice";
  const ocr = await recognizeUploadedFile({
    kind: originalKind,
    file: {
      path,
      name: item.originalName,
      originalFilename: item.originalName,
      mimetype: mimeType(item.originalName),
    },
  });
  paidFiles += 1;
  cachedByKey.set(key, {
    row: item.row,
    reason: item.reason,
    declaredAmount: item.declaredAmount,
    group: item.group,
    index: item.index,
    originalName: item.originalName,
    localName: item.localName,
    ocr,
  });
  console.log(`OCR ${cachedByKey.size}/${manifest.length} | 第${item.row}行 ${item.group}${String(item.index).padStart(2, "0")} | ${item.originalName}`);
}

for (let offset = 0; offset < pending.length; offset += concurrency) {
  const batch = pending.slice(offset, offset + concurrency);
  await Promise.all(batch.map(recognizeItem));
  await persistCache();
}
if (!pending.length) console.log(`CACHE | reused ${results.length} OCR records | ${cachePath}`);

const classified = results.map((item) => {
  const originalKind = item.group === "付款" ? "payment" : "invoice";
  const cachedOcr = structuredClone(item.ocr);
  const ocr = cachedOcr?.data && Object.keys(cachedOcr.data).length
    ? normalizeOcrResult({
        kind: originalKind,
        response: {
          body: {
            data: cachedOcr.data,
            requestId: cachedOcr.requestId,
            code: cachedOcr.code,
            message: cachedOcr.message,
          },
        },
        fallbackText: item.originalName,
        ocrType: cachedOcr.ocrType,
      })
    : cachedOcr;
  const resolution = applyDocumentClassification(originalKind, ocr, item.originalName);
  return {
    ...item,
    fileId: `row${item.row}-${item.group}-${item.index}`,
    originalKind,
    resolvedKind: resolution.kind,
    documentRole: ocr.documentRole,
    recognizedAmount: ocr.recognizedAmount || "",
    countableAmount: ocr.countableAmount || "",
    decision: ocr.decision || "",
    ocr,
  };
});

const userId = "mixed-live-regression";
const rows = [1, 2, 3, 4].map((rowNumber) => {
  const items = classified.filter((item) => item.row === rowNumber);
  const reason = items[0]?.reason || `第${rowNumber}行`;
  const amount = items[0]?.declaredAmount || "";
  const payment = items.filter((item) => item.resolvedKind === "payment");
  const invoice = items.filter((item) => item.resolvedKind === "invoice");
  return { rowNumber, reason, amount, payment, invoice };
});

const records = classified.map((item) => ({
  v: 1,
  userId,
  fileId: item.fileId,
  fileName: item.originalName,
  originalKind: item.originalKind,
  kind: item.resolvedKind,
  documentRole: item.documentRole,
  roleConfidence: item.ocr.roleConfidence || "",
  recognizedAmount: item.recognizedAmount,
  countableAmount: item.countableAmount,
  paymentDecision: item.decision,
  issuedAt: Date.now(),
}));
const recordById = new Map(records.map((record) => [record.fileId, record]));
const evidenceManifest = records.map((record) => ({
  fileId: record.fileId,
  token: signEvidenceRecord(record),
  manualAmount: "",
}));
const table = rows.map((row) => [
  { name: "申请事由", value: row.reason },
  { name: "金额", value: row.amount },
  { name: "发票类型", value: "电子-普票" },
  {
    name: "付款截图/订单截图",
    value: JSON.stringify(row.payment.map((item) => {
      const record = recordById.get(item.fileId);
      return { fileId: record.fileId, fileName: record.fileName };
    })),
  },
  {
    name: "对应发票上传",
    value: JSON.stringify(row.invoice.map((item) => {
      const record = recordById.get(item.fileId);
      return { fileId: record.fileId, fileName: record.fileName };
    })),
  },
]);
const draft = {
  evidence_validation_version: 2,
  evidence_manifest: evidenceManifest,
  no_invoice: false,
  form_component_values: [
    { name: "表格", value: JSON.stringify(table) },
    { name: "申请金额（元）", value: "1732.04" },
  ],
};
const audit = auditApprovalEvidence(draft, { user: { userId } });
const roleCounts = Object.fromEntries(
  ["payment", "tax_invoice", "supporting_document", "unknown"].map((role) => [
    role,
    classified.filter((item) => item.documentRole === role).length,
  ]),
);
const expectedRowAmounts = [
  ["537.51", "532.01", "5.50"],
  ["681.39", "667.00", "14.39"],
  ["146.11", "130.00", "16.11"],
  ["367.03", "367.03", ""],
];
const rowAmountsMatch = expectedRowAmounts.every(([payment, taxInvoice, shortage], index) => {
  const row = audit.rows[index];
  const errorHasShortage = shortage
    ? audit.errors.some((message) => message.includes(`第 ${index + 1} 行`) && message.includes(`缺少 ${shortage} 元`))
    : true;
  return row?.paymentTotal === payment && row?.taxInvoiceTotal === taxInvoice && errorHasShortage;
});
const passed = classified.length === 60 &&
  roleCounts.payment === 24 &&
  roleCounts.tax_invoice === 20 &&
  roleCounts.supporting_document === 16 &&
  roleCounts.unknown === 0 &&
  audit.totals.paymentAmount === "1732.04" &&
  audit.totals.taxInvoiceAmount === "1696.04" &&
  audit.totals.shortfall === "36.00" &&
  audit.errors.length === 3 &&
  rowAmountsMatch;

const report = {
  businessId,
  generatedAt: new Date().toISOString(),
  passed,
  paidFiles,
  sourceFileCount: classified.length,
  roleCounts,
  totals: audit.totals,
  rows: audit.rows.map((row) => ({
    row: row.index,
    reason: row.reason,
    declaredAmount: row.declaredAmount,
    paymentTotal: row.paymentTotal,
    taxInvoiceTotal: row.taxInvoiceTotal,
    supportingDocumentCount: row.supportingDocumentCount,
  })),
  errors: audit.errors,
  files: classified.map((item) => ({
    row: item.row,
    group: item.group,
    index: item.index,
    fileName: item.originalName,
    resolvedKind: item.resolvedKind,
    documentRole: item.documentRole,
    recognizedAmount: item.recognizedAmount,
    countableAmount: item.countableAmount,
    decision: item.decision,
  })),
  cachePath,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

for (const row of report.rows) {
  console.log(
    `ROW ${row.row} | ${row.reason} | declared=${row.declaredAmount} payment=${row.paymentTotal} tax_invoice=${row.taxInvoiceTotal} supporting=${row.supportingDocumentCount}`,
  );
}
console.log(
  `${passed ? "PASS" : "FAIL"} | exact 60-file mixed upload | roles=${JSON.stringify(roleCounts)} | payment=${audit.totals.paymentAmount || "0.00"} tax_invoice=${audit.totals.taxInvoiceAmount || "0.00"} missing=${audit.totals.shortfall || "0.00"} | errors=${audit.errors.length} | paid_files=${paidFiles}`,
);
console.log(`REPORT | ${reportPath}`);
process.exitCode = passed ? 0 : 1;
