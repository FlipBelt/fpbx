import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const v2Source = await readFile(new URL("../v2.js", import.meta.url), "utf8");

const checks = [
  ["result dialog no longer exposes raw JSON", !htmlSource.includes("payloadPreview") && !appSource.includes("payloadPreview")],
  ["success result includes approval status, instance ID, and initiated time", appSource.includes('label: "审批状态"') && appSource.includes('label: "审批实例编号"') && appSource.includes('label: "发起时间"')],
  ["failure result includes the exact failure reason", appSource.includes('label: "失败原因"') && appSource.includes("getSubmissionFailureHint")],
  ["validation and identity errors use the same result presentation", appSource.includes('title: "暂时无法提交"') && appSource.includes('title: "未获取钉钉身份"')],
  ["approval instance ID can be copied", appSource.includes("copyResultInstanceButton") && htmlSource.includes('id="copyResultInstance"')],
  ["result dialog has modern success and failure styling", cssSource.includes('.result-dialog-content[data-result-state="success"]') && cssSource.includes('.result-dialog-content[data-result-state="error"]')],
  ["successful approval can only finish by creating a new blank reimbursement", appSource.includes('closeButton.textContent = resultState === "success" ? "完成并新建报销"') && appSource.includes("function startNewReimbursement()") && appSource.includes('document.dispatchEvent(new CustomEvent("reimbursement:new-submission"))')],
  ["success locks the old form against a second OA submission", appSource.includes('state.submissionStatus = "succeeded"') && appSource.includes('if (isSubmissionLocked())') && v2Source.includes('if (!isSubmissionLocked()) submitButton.disabled = false;')],
  ["approval API persists an idempotency reservation before creating OA", serverSource.includes("submission-requests.json") && serverSource.includes("reserveSubmissionRequest") && serverSource.includes("settleSubmissionRequest") && serverSource.includes("idempotent: true")],
  ["only accepted pool/OA submissions lock a draft permanently", serverSource.includes('sameId.status === "success" && sameId.fingerprint !== fingerprint') && serverSource.includes('if (sameId.status === "success") return { action: "replay", entry: sameId };')],
  ["failed drafts can update their fingerprint and retry", serverSource.includes('sameId.fingerprint = fingerprint;') && serverSource.includes('sameId.status = "pending";') && serverSource.includes('failed、cancelled，及超出短暂处理窗口的 pending')],
  ["cancelled scheduled jobs release their submission lock", serverSource.includes("releaseCancelledScheduledSubmissionRequest") && serverSource.includes("await releaseCancelledScheduledSubmissionRequest(cancelled)")],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid=0`);
process.exitCode = failed ? 1 : 0;
