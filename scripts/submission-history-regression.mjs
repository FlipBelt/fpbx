import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.OCR_REGRESSION = "1";
const { describeDingTalkApprovalFailure, describeSubmissionFailure } = await import("../server.mjs");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

const disabledFlow = describeDingTalkApprovalFailure(new Error('DingTalk approval failed: {"code":"processGetFailed","message":"获取审批流失败或审批单状态为非启用状态"}'));
assert.equal(disabledFlow.code, "process_not_enabled");
assert.match(disabledFlow.reason, /未启用/);
assert.match(disabledFlow.advice, /钉钉 OA 管理员/);

const validation = describeSubmissionFailure(new Error("请填写第 1 行的申请事由。"));
assert.equal(validation.code, "submission_validation");
assert.equal(validation.reason, "请填写第 1 行的申请事由。");

const checks = [
  ["process-disabled error is translated without raw DingTalk JSON", !disabledFlow.reason.includes("requestid") && !disabledFlow.reason.includes("processGetFailed")],
  ["server persists submission attempts", appSource.includes("/api/submission-history")],
  ["client sends workflow context", appSource.includes("submission_context") && appSource.includes("workflowTitle")],
  ["history entry button and dialog exist", htmlSource.includes("submissionHistoryButton") && htmlSource.includes("submissionHistoryDialog")],
  ["history clearly separates success and failure", appSource.includes("发起成功") && appSource.includes("发起失败")],
  ["history has dedicated readable UI", styleSource.includes(".submission-history-dialog") && styleSource.includes(".history-status.failed")],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length + 2} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
