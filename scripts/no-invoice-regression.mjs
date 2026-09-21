import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

const processCode = "PROC-429BDF89-0899-4857-BED1-03C449C9FBC7";
const checks = [
  ["no-invoice process code", appSource.includes(`noInvoiceDaily: "${processCode}"`)],
  ["no-invoice workflow", /id:\s*"no_invoice"[\s\S]*?targetType:\s*"daily"[\s\S]*?processCode:\s*PROCESS_CODES\.noInvoiceDaily[\s\S]*?noInvoice:\s*true/.test(appSource)],
  ["invoice value forced to none", appSource.includes('invoiceType: isNoInvoiceWorkflow(workflow) ? "无" : row.invoiceType')],
  ["invoice attachment excluded from OA row", appSource.includes('workflow.noInvoice ? [] : getRowAttachments(row, "invoice")') && appSource.includes("buildDailyTableValue")],
  ["daily payload uses selected workflow process code", appSource.includes("process_code: workflow.processCode")],
  ["invoice upload and OCR summary hidden", appSource.includes("invoiceDropZone.hidden = noInvoice") && appSource.includes("invoiceDetectedSummary.hidden = noInvoice")],
  ["invoice audit disabled", appSource.includes('const invoiceFiles = noInvoice ? [] : getFilesByType("invoice")') && appSource.includes('const invoiceTotal = noInvoice ? 0 : getDetectedAmountTotal("invoice")')],
  ["invoice validation bypassed", appSource.includes("const noInvoice = isNoInvoiceWorkflow(workflow);") && appSource.includes("if (!noInvoice && !row.invoiceType)")],
  ["no-invoice upload guard", appSource.includes('formData.append("no_invoice", isNoInvoiceWorkflow() ? "1" : "0")')],
  ["cache-busted deployment asset", htmlSource.includes("app.js?v=20260907-company-option-1")],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
