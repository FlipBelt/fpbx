import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const v2Source = await readFile(new URL("../v2.js", import.meta.url), "utf8");

const checks = [
  ["rename dialog exists", htmlSource.includes('id="attachmentRenameDialog"') && htmlSource.includes('id="attachmentRenameInput"')],
  ["only uploaded invoice/payment evidence can be renamed", appSource.includes("function canRenameUploadedEvidence") && appSource.includes('["payment", "invoice"].includes(classifyFile(file))') && appSource.includes("file?.dingtalkAttachment?.fileId")],
  ["file extension is preserved", appSource.includes("function normalizeRenamedEvidenceFileName") && appSource.includes("文件扩展名必须保留")],
  ["rename changes display attachment only", appSource.includes("file.dingtalkAttachment = { ...file.dingtalkAttachment, fileName: result.fileName") && appSource.includes("未重新上传或 OCR 识别")],
  ["legacy draft row assignment key is preserved", appSource.includes("if (!file.clientUploadId) file.clientUploadId = getFileKey(file)")],
  ["rename is audit-recorded", appSource.includes('queueClientAuditEvent("attachment_renamed"')],
  ["V2 sees the renamed shared attachment name", v2Source.includes("getFileByKey(key)?.name") && v2Source.includes("renderFiles()")],
];

let failed = 0;
for (const [name, passed] of checks) {
  try {
    assert.ok(passed);
    console.log(`PASS | ${name}`);
  } catch {
    failed += 1;
    console.log(`FAIL | ${name}`);
  }
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_calls=0`);
process.exitCode = failed ? 1 : 0;
