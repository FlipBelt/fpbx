import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ScheduledApprovalScheduler,
  ScheduledApprovalStore,
  SCHEDULED_STATUSES,
  calculateScheduledAt,
  getScheduledApprovalDecision,
  isWithinReleaseWindow,
  isEligibleForScheduling,
} from "../scheduled-approvals.mjs";

const directory = await mkdtemp(join(tmpdir(), "reimbursement-schedule-test-"));
let now = Date.parse("2026-08-16T09:00:00.000Z"); // 17:00 in Shanghai, before cutoff.
const store = new ScheduledApprovalStore(join(directory, "queue.sqlite"), { now: () => now, encryptionKey: "local-regression-key" });
const base = {
  fingerprint: "fingerprint-a",
  ownerUserId: "user-a",
  ownerName: "测试用户",
  deptId: "100",
  workflowId: "daily",
  workflowTitle: "日常报销（有票）",
  processCode: "PROC-TEST",
  amount: 1999.99,
  scheduledAt: "2026-08-21T01:00:00.000Z",
  prepared: { payload: { originator_user_id: "user-a" } },
  context: { user: { userId: "user-a" } },
  snapshot: { totalAmount: "1999.99", rows: [] },
};

try {
  const policy = { enabled: true };
  assert.deepEqual(getScheduledApprovalDecision("2026-07-31T16:00:00.000Z", policy), {
    scheduled: true, reason: "current_month_batch", batchKey: "2026-08", scheduledAt: "2026-08-21T01:00:00.000Z",
  });
  assert.equal(calculateScheduledAt("2026-08-20T15:59:59.000Z", policy), "2026-08-21T01:00:00.000Z");
  assert.deepEqual(getScheduledApprovalDecision("2026-08-20T16:00:00.000Z", policy), { scheduled: false, reason: "direct_processing_window" });
  assert.deepEqual(getScheduledApprovalDecision("2026-08-24T15:59:59.000Z", policy), { scheduled: false, reason: "direct_processing_window" });
  assert.deepEqual(getScheduledApprovalDecision("2026-08-25T16:00:00.000Z", policy), {
    scheduled: true, reason: "next_month_batch", batchKey: "2026-09", scheduledAt: "2026-09-21T01:00:00.000Z",
  });
  assert.equal(calculateScheduledAt("2026-12-25T16:00:00.000Z", policy), "2027-01-21T01:00:00.000Z");
  assert.equal(isWithinReleaseWindow("2026-08-21T00:59:59.000Z"), false);
  assert.equal(isWithinReleaseWindow("2026-08-21T01:00:00.000Z"), true);
  assert.equal(isWithinReleaseWindow("2026-08-21T09:59:59.000Z"), true);
  assert.equal(isWithinReleaseWindow("2026-08-21T10:00:00.000Z"), false);
  for (const input of [
    { amount: 1, workflowId: "daily", urgent: true },
    { amount: 2000, workflowId: "travel_transport" },
    { amount: 100000, workflowId: "unlisted_workflow" },
  ]) assert.equal(isEligibleForScheduling(input, policy), true);
  console.log("PASS | calendar-only scheduling policy uses 1-20 / 21-25 / 26-end windows");

  const first = store.createJob({ ...base, submissionId: "submission-00000001", releaseIntervalMs: 180_000 });
  const secondSlot = store.createJob({ ...base, submissionId: "submission-release-slot", fingerprint: "slot-fingerprint", releaseIntervalMs: 180_000 });
  const replay = store.createJob({ ...base, submissionId: "submission-00000001" });
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(first.job.id, replay.job.id);
  assert.equal(secondSlot.job.scheduledAt, "2026-08-21T01:03:00.000Z");
  assert.equal(store.getJob(first.job.id, { includePrepared: true }).prepared.payload.originator_user_id, "user-a");
  const rawPrepared = store.db.prepare("SELECT prepared_json FROM scheduled_approval_jobs WHERE id = ?").get(first.job.id).prepared_json;
  assert.equal(rawPrepared.startsWith("enc:v1:"), true);
  assert.equal(rawPrepared.includes("user-a"), false);
  console.log("PASS | queue insertion is idempotent");
  console.log("PASS | delayed payload is encrypted at rest and decrypts for the worker");

  now = Date.parse("2026-08-21T01:00:01.000Z");
  const claimedA = store.claimDueJobs("worker-a", { limit: 2, leaseMs: 60_000 });
  const claimedB = store.claimDueJobs("worker-b", { limit: 2, leaseMs: 60_000 });
  assert.equal(claimedA.length, 1);
  assert.equal(claimedB.length, 0);
  store.markSucceeded(claimedA[0].id, "instance-001");
  assert.equal(store.getJob(claimedA[0].id).status, SCHEDULED_STATUSES.SUCCEEDED);
  console.log("PASS | atomic claim prevents duplicate dispatch and release slots are spaced by three minutes");

  store.createJob({ ...base, submissionId: "submission-00000002", fingerprint: "fingerprint-b", scheduledAt: new Date(now).toISOString() });
  let attempts = 0;
  const scheduler = new ScheduledApprovalScheduler({
    store,
    now: () => now,
    concurrency: 2,
    backoffMs: [1000],
    dispatch: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary network failure");
      return { processInstanceId: "instance-002" };
    },
    classifyFailure: (error) => ({ retryable: /temporary/.test(error.message), failure: { code: "network", reason: error.message } }),
  });
  await scheduler.tick();
  let retryJob = store.getBySubmission("user-a", "submission-00000002");
  assert.equal(retryJob.status, SCHEDULED_STATUSES.RETRY);
  now += 1001;
  await scheduler.tick();
  retryJob = store.getBySubmission("user-a", "submission-00000002");
  assert.equal(retryJob.status, SCHEDULED_STATUSES.SUCCEEDED);
  assert.equal(retryJob.processInstanceId, "instance-002");
  console.log("PASS | transient failure retries and later succeeds");

  let pacedDispatches = 0;
  store.createJob({ ...base, submissionId: "submission-paced-a", fingerprint: "paced-a", scheduledAt: new Date(now).toISOString() });
  store.createJob({ ...base, submissionId: "submission-paced-b", fingerprint: "paced-b", scheduledAt: new Date(now).toISOString() });
  const pacedScheduler = new ScheduledApprovalScheduler({
    store,
    now: () => now,
    dispatch: async () => ({ processInstanceId: `paced-${++pacedDispatches}` }),
  });
  await pacedScheduler.tick();
  assert.equal(pacedDispatches, 1);
  assert.equal(store.getBySubmission("user-a", "submission-paced-a").status, SCHEDULED_STATUSES.SUCCEEDED);
  assert.equal(store.getBySubmission("user-a", "submission-paced-b").status, SCHEDULED_STATUSES.SCHEDULED);
  store.reschedule(store.getBySubmission("user-a", "submission-paced-b").id, new Date(now + 24 * 60 * 60 * 1000).toISOString());
  console.log("PASS | one scheduler tick dispatches at most one OA");

  store.createJob({ ...base, submissionId: "submission-00000003", fingerprint: "fingerprint-c", scheduledAt: new Date(now).toISOString() });
  const interrupted = store.claimDueJobs("crashed-worker", { limit: 1, leaseMs: 1000 });
  assert.equal(interrupted.length, 1);
  now += 1001;
  assert.equal(store.recoverExpiredLeases(), 1);
  assert.equal(store.getJob(interrupted[0].id).status, SCHEDULED_STATUSES.UNKNOWN);
  console.log("PASS | restart recovery never blindly duplicates an uncertain OA request");

  store.setRuntime("paused", "true");
  const pausedTick = await scheduler.tick();
  assert.equal(pausedTick.paused, true);
  store.setRuntime("paused", "false");
  console.log("PASS | administrator can pause and resume the batch");

  store.createJob({ ...base, submissionId: "submission-00000004", fingerprint: "fingerprint-d", scheduledAt: new Date(now + 60_000).toISOString() });
  const cancellable = store.getBySubmission("user-a", "submission-00000004");
  store.cancel(cancellable.id, "user-a");
  assert.equal(store.getJob(cancellable.id).status, SCHEDULED_STATUSES.CANCELLED);
  console.log("PASS | applicant can cancel before dispatch");

  const stats = store.stats();
  assert.equal(stats.statuses.succeeded.count, 3);
  assert.equal(stats.statuses.unknown.count, 1);
  assert.equal(stats.statuses.cancelled.count, 1);
  console.log("PASS | admin statistics are available");

  store.addAuditEvent({
    eventType: "upload",
    ownerUserId: "user-a",
    ownerName: "测试用户",
    status: "success",
    summary: { fileCount: 2, files: [{ name: "付款.png" }, { name: "发票.pdf" }] },
  });
  store.addAuditEvent({
    eventType: "upload",
    ownerUserId: "user-a",
    ownerName: "测试用户",
    status: "failed",
    reasonCode: "upload_failed",
    reason: "模拟上传失败",
  });
  assert.equal(store.listAuditEvents({ eventType: "upload" }).length, 2);
  assert.equal(store.auditStats().upload.success, 1);
  assert.equal(store.auditStats().upload.failed, 1);
  console.log("PASS | upload and error audit events are persisted for the admin dashboard");

  now += 5 * 60 * 1000 + 1;
  const reconciler = new ScheduledApprovalScheduler({
    store,
    now: () => now,
    concurrency: 1,
    dispatch: async () => { throw new Error("unknown records must not be dispatched directly"); },
    reconcileUnknown: async (job) => job.trackingCode
      ? { processInstanceId: "instance-reconciled", source: "mock_tracking_component" }
      : null,
  });
  const reconciliation = await reconciler.tick();
  assert.equal(reconciliation.reconciled.matched, 1);
  assert.equal(store.getJob(interrupted[0].id).status, SCHEDULED_STATUSES.SUCCEEDED);
  console.log("PASS | uncertain delivery is reconciled by tracking code without duplicate dispatch");

  const restartFile = join(directory, "restart.sqlite");
  const restartStore = new ScheduledApprovalStore(restartFile, { now: () => now, encryptionKey: "restart-key" });
  const restartJob = restartStore.createJob({ ...base, submissionId: "submission-restart", fingerprint: "restart-fingerprint" }).job;
  restartStore.close();
  const reopened = new ScheduledApprovalStore(restartFile, { now: () => now, encryptionKey: "restart-key" });
  assert.equal(reopened.getJob(restartJob.id, { includePrepared: true }).prepared.payload.originator_user_id, "user-a");
  reopened.close();
  console.log("PASS | encrypted snapshot survives process restart");
  console.log("SUMMARY | PASSED | paid_dingtalk_calls=0 | paid_ocr_calls=0");
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
