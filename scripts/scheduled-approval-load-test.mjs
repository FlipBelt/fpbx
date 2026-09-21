import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWithinReleaseWindow, ScheduledApprovalScheduler, ScheduledApprovalStore, SCHEDULED_STATUSES } from "../scheduled-approvals.mjs";

const directory = await mkdtemp(join(tmpdir(), "reimbursement-schedule-load-"));
let now = Date.parse("2026-08-21T01:00:00.000Z"); // 21st 09:00 in Shanghai
const store = new ScheduledApprovalStore(join(directory, "load.sqlite"), { now: () => now, encryptionKey: "load-test-key" });
const total = 240;
let active = 0;
let maxActive = 0;
const sent = new Set();

try {
  for (let index = 0; index < total; index += 1) {
    store.createJob({
      submissionId: `load-${index}`,
      fingerprint: `fingerprint-${index}`,
      ownerUserId: `user-${index % 30}`,
      ownerName: `测试用户${index % 30}`,
      deptId: String(100 + (index % 5)),
      workflowId: "daily",
      workflowTitle: "日常报销（有票）",
      processCode: "PROC-LOAD-TEST",
      amount: 100 + index / 100,
      scheduledAt: new Date(now).toISOString(),
      releaseIntervalMs: 3 * 60 * 1000,
      prepared: { payload: { originator_user_id: `user-${index % 30}`, attachments: [`file-${index}`] } },
      context: { editableDraft: { row: index } },
      snapshot: { totalAmount: (100 + index / 100).toFixed(2) },
    });
  }

  const scheduler = new ScheduledApprovalScheduler({
    store,
    now: () => now,
    dispatch: async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      assert.equal(sent.has(job.id), false);
      sent.add(job.id);
      active -= 1;
      return { processInstanceId: `instance-${job.id}` };
    },
  });

  let claimed = 0;
  while (claimed < total) {
    const batch = await scheduler.tick();
    assert.equal(batch.claimed, 1);
    claimed += batch.claimed;
    now += 3 * 60 * 1000;
    if (!isWithinReleaseWindow(now)) {
      const shanghai = new Date(now + 8 * 60 * 60 * 1000);
      now = Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate() + 1, 1, 0);
    }
  }
  const stats = store.stats();
  assert.equal(sent.size, total);
  assert.equal(stats.statuses[SCHEDULED_STATUSES.SUCCEEDED].count, total);
  assert.equal(maxActive, 1);
  assert.equal(claimed, total);
  assert.equal(new Date(now - 3 * 60 * 1000).toISOString(), "2026-08-22T03:57:00.000Z");
  console.log(`PASS | ${total} jobs are released once, one every three minutes, only during 09:00-18:00 Shanghai business hours`);
  console.log("SUMMARY | PASSED | paid_dingtalk_calls=0 | paid_ocr_calls=0");
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
