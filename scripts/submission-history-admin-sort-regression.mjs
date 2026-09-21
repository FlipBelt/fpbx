#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const [indexSource, appSource, v2Source, styleSource, v2StyleSource] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "v2.js"), "utf8"),
  readFile(resolve(root, "styles.css"), "utf8"),
  readFile(resolve(root, "v2.css"), "utf8"),
]);

const checks = [
  ["all users have a personal submission-history entry point", indexSource.includes('id="submissionHistoryButton"') && indexSource.includes("我的提交记录")],
  ["history API statuses include scheduled queue receipts", appSource.includes("已进入待发起池") && appSource.includes("预计 OA 发起时间")],
  ["history dialog exposes a complete receipt", appSource.includes("renderSubmissionReceipt") && appSource.includes("查看完整回执")],
  ["history receipt renders personal routing information", appSource.includes("付款公司") && appSource.includes("发起部门")],
  ["history receipt can be expanded and collapsed", appSource.includes("data-history-target") && appSource.includes("submissionHistoryList?.addEventListener")],
  ["admin toolbar has a sort toggle", v2Source.includes("data-admin-sort") && v2Source.includes("排序：最新优先")],
  ["admin defaults to newest-first", v2Source.includes('let operationsDashboardSortDirection = "desc"')],
  ["admin sort applies to pool, submissions and uploads", v2Source.includes('sortAdminEntries(result.scheduled || [], "scheduled")') && v2Source.includes('sortAdminEntries(result.submissions || [], "submissions")') && v2Source.includes('sortAdminEntries(result.uploads || [], "uploads")')],
  ["admin sort applies to audit, cases and errors", v2Source.includes('sortAdminEntries(result.clientAudit || [], "client-audit")') && v2Source.includes('sortAdminEntries(workbenchCases?.entries || [], "cases")') && v2Source.includes('sortAdminEntries(result.errors || [], "errors")')],
  ["history statuses and receipt have dedicated styles", styleSource.includes(".history-status.scheduled") && styleSource.includes(".submission-history-receipt")],
  ["admin sort toolbar wraps on narrow screens", v2StyleSource.includes(".v2-scheduled-admin-toolbar { display: flex; flex-wrap: wrap;")],
];

let failed = 0;
for (const [label, passed] of checks) {
  if (passed) console.log(`PASS | ${label}`);
  else { failed += 1; console.error(`FAIL | ${label}`); }
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length}`);
if (failed) process.exitCode = 1;
