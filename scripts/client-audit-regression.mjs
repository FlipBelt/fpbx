import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduledApprovalStore } from "../scheduled-approvals.mjs";

const directory = await mkdtemp(join(tmpdir(), "reimbursement-client-audit-"));
const store = new ScheduledApprovalStore(join(directory, "audit.sqlite"), { encryptionKey: "test-key" });

try {
  const base = {
    traceId: "trace-test", draftId: "draft-test", ownerUserId: "user-test", ownerName: "测试用户",
    workflowId: "travel_transport", workflowTitle: "出差差旅费报销", clientAt: "2026-08-24T00:00:00.000Z",
    serverAt: "2026-08-24T00:00:01.000Z", appVersion: "test", status: "info",
  };
  const accepted = store.addClientAuditEvents([
    { ...base, id: "event-1", sequence: 1, eventType: "attachment_ocr_completed", summary: { attachment: { fileName: "ticket.pdf", ocrAmount: "85.00" } } },
    { ...base, id: "event-2", sequence: 2, eventType: "attachment_bound", summary: { targetRowId: "row-1" } },
  ]);
  assert.equal(accepted, 2);
  assert.equal(store.addClientAuditEvents([{ ...base, id: "event-1", sequence: 1, eventType: "attachment_ocr_completed" }]), 0);
  const events = store.listClientAuditEvents({ traceId: "trace-test" });
  assert.equal(events.length, 2);
  assert.equal(events[0].traceId, "trace-test");
  assert.equal(store.clientAuditStats().attachment_bound.info, 1);
  console.log("PASS | client audit storage is append-only and idempotent");
  console.log("SUMMARY | PASSED | checks=1 | paid_ocr_calls=0");
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
