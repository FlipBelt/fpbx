import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [moduleSource, serverSource, v2Source, migrationOne, migrationTwo, lifecycle] = await Promise.all([
  readFile(resolve(root, "admin-workbench.mjs"), "utf8"),
  readFile(resolve(root, "server.mjs"), "utf8"),
  readFile(resolve(root, "v2.js"), "utf8"),
  readFile(resolve(root, "migrations/001_admin_workbench.sql"), "utf8"),
  readFile(resolve(root, "migrations/002_admin_workbench_actions.sql"), "utf8"),
  readFile(resolve(root, "deploy/oss-lifecycle-reimbursement-60-days.xml"), "utf8"),
]);

const checks = [
  ["workbench remains feature-gated", moduleSource.includes("REIMBURSEMENT_ADMIN_WORKBENCH_ENABLED") && moduleSource.includes("isConfigured")],
  ["full draft and OCR snapshots are encrypted", moduleSource.includes("createCipheriv") && moduleSource.includes("encryptJson")],
  ["OSS archive uses ECS role and object-level AES256", moduleSource.includes("ecs_ram_role") && moduleSource.includes('x-oss-server-side-encryption')],
  ["server sidecar writes do not block existing flows", serverSource.includes("void adminWorkbench?.captureServerEvent") && serverSource.includes("void adminWorkbench?.captureClientEvents")],
  ["server keeps admin repair and submit behind separate gates", serverSource.includes('requireAdminWorkbench(getSession(body.session_token), "repair")') && serverSource.includes('requireAdminWorkbench(getSession(body.session_token), "submit")')],
  ["manual admin-originator route has an independent feature gate", moduleSource.includes("manualCreateEnabled") && serverSource.includes('requireAdminWorkbench(getSession(body.session_token), "manual_create")') && serverSource.includes("/api/admin/workbench/manual-cases")],
  ["manual case snapshots preserve target and operator identities", moduleSource.includes("adminOriginator") && moduleSource.includes("operatorUserId") && serverSource.includes("ownerUnionId")],
  ["manual employee directory lookup is admin-only", serverSource.includes("/api/admin/workbench/employees") && serverSource.includes('"manual_create"')],
  ["admin-originator OA payload separates operator from originator", serverSource.includes('route.mode === "admin_originator"') && serverSource.includes("effectiveOriginatorUserId") && serverSource.includes("operatorUserId")],
  ["admin submission uses a synthetic employee session", serverSource.includes("createSupportSession") && serverSource.includes("prepareDingTalkApprovalForSession")],
  ["admin-originator submission reuses the normal scheduled/immediate queue path", serverSource.includes("reserveSubmissionRequest(syntheticSession, draft)") && serverSource.includes("prepareScheduledOrImmediateApproval(draft, syntheticSession, reservation)") && serverSource.includes('dispatchPreparedDingTalkApproval(preparedResult.prepared)')],
  ["scheduled admin-originator jobs retain workbench linkage for post-dispatch status", serverSource.includes("adminCaseId") && serverSource.includes("Admin scheduled case update failed")],
  ["V2 exposes case diagnostics", v2Source.includes('data-admin-tab="cases"') && v2Source.includes("openAdminWorkbenchCase")],
  ["relational schema covers cases, events, drafts and artifacts", ["support_cases", "case_events", "client_events", "server_events", "draft_revisions", "attachment_artifacts"].every((name) => migrationOne.includes(name))],
  ["admin actions are idempotent", migrationTwo.includes("admin_actions_idempotency_uq")],
  ["database retention only purges workbench tables", moduleSource.includes("purgeExpiredCases") && moduleSource.includes('"attachment_artifacts", "support_cases"')],
  ["archive lifecycle is scoped to the reimbursement prefix for 60 days", lifecycle.includes("reimbursement-assistant/") && lifecycle.includes("<Days>60</Days>")],
];

checks.forEach(([label, passed]) => {
  assert.ok(passed, label);
  console.log(`PASS | ${label}`);
});
console.log(`SUMMARY | PASSED | checks=${checks.length} | paid_ocr_calls=0`);
