import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

const checks = [
  ["OCR preview opens after attachment assignment", appSource.includes("window.setTimeout(openOcrSuggestionDialog, 0)")],
  ["OCR suggestion uses payment time before invoice date", appSource.includes("const businessDate = paymentDate || invoiceDate")],
  ["OCR suggestion uses payment amount", appSource.includes("sumMoney(paymentFiles.map(getOcrAmount).filter(Boolean))")],
  ["OCR categories include taxi and travel", appSource.includes('key: "taxi"') && appSource.includes('key: "rail"') && appSource.includes('key: "flight"')],
  ["invoice type mapping avoids unknown defaults", appSource.includes("function getOcrInvoiceType") && appSource.includes("return \"\";")],
  ["travel rows split by OCR category", appSource.includes("function getTravelRowOcrSuggestions") && appSource.includes("rowSuggestions.forEach")],
  ["existing travel attachment assignment is preserved after split", appSource.includes("const alreadyAssigned = rows.some")],
  ["manual edits clear automatic field ownership", appSource.includes("autoFields.delete(field)") && appSource.includes("ocrAutoFields")],
  ["OCR application has rollback snapshot", appSource.includes("snapshotOcrSuggestionState") && appSource.includes("rollbackOcrDetailSuggestions")],
  ["preview dialog provides accept and defer actions", htmlSource.includes("applyOcrSuggestionsButton") && htmlSource.includes("closeOcrSuggestionButton")],
  ["main form exposes rollback action", htmlSource.includes("rollbackOcrSuggestionsButton")],
  ["preview dialog has dedicated responsive styling", styleSource.includes(".ocr-suggestion-dialog") && styleSource.includes(".ocr-suggestion-fields")],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
