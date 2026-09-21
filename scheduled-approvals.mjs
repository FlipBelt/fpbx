import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEDULED_STATUSES = Object.freeze({
  SCHEDULED: "scheduled",
  DISPATCHING: "dispatching",
  RETRY: "retry",
  UNKNOWN: "unknown",
  MANUAL: "manual",
  SUCCEEDED: "succeeded",
  CANCELLED: "cancelled",
});

const FINAL_STATUSES = new Set([SCHEDULED_STATUSES.SUCCEEDED, SCHEDULED_STATUSES.CANCELLED]);
const MUTABLE_STATUSES = new Set([SCHEDULED_STATUSES.SCHEDULED, SCHEDULED_STATUSES.RETRY, SCHEDULED_STATUSES.MANUAL]);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_RELEASE_INTERVAL_MS = 3 * 60 * 1000;
const RELEASE_WINDOW_START_MINUTE = 9 * 60;
const RELEASE_WINDOW_END_MINUTE = 18 * 60;

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function deriveEncryptionKey(value) {
  return value ? createHash("sha256").update(String(value)).digest() : null;
}

function encodeSensitive(value, encryptionKey) {
  const plain = json(value);
  if (!encryptionKey) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decodeSensitive(value, encryptionKey, fallback = null) {
  if (!value?.startsWith?.("enc:v1:")) return parseJson(value, fallback);
  if (!encryptionKey) throw new Error("定时发送数据已加密，但当前没有可用的解密密钥。");
  try {
    const [, , ivText, tagText, encryptedText] = value.split(":");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
    return parseJson(plain, fallback);
  } catch (error) {
    throw new Error(`定时发送数据解密失败：${error.message}`);
  }
}

function toPublicJob(row, { includePrepared = false, encryptionKey = null } = {}) {
  if (!row) return null;
  const result = {
    id: row.id,
    submissionId: row.submission_id,
    fingerprint: row.fingerprint,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    deptId: row.dept_id,
    workflowId: row.workflow_id,
    workflowTitle: row.workflow_title,
    processCode: row.process_code,
    trackingCode: row.tracking_code || "",
    amount: (Number(row.amount_cents) / 100).toFixed(2),
    status: row.status,
    scheduledAt: row.scheduled_at,
    nextAttemptAt: row.next_attempt_at,
    attemptCount: Number(row.attempt_count || 0),
    processInstanceId: row.process_instance_id || "",
    failureCode: row.failure_code || "",
    failureReason: row.failure_reason || "",
    failureAdvice: row.failure_advice || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchedAt: row.dispatched_at || "",
    cancelledAt: row.cancelled_at || "",
    snapshot: parseJson(row.snapshot_json, null),
  };
  if (includePrepared) {
    result.prepared = decodeSensitive(row.prepared_json, encryptionKey, null);
    result.context = decodeSensitive(row.context_json, encryptionKey, null);
  }
  return result;
}

function shanghaiParts(value) {
  const shifted = new Date(new Date(value).getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function shanghaiDate(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute) - SHANGHAI_OFFSET_MS);
}

function releaseWindowMinute(parts) {
  return parts.hour * 60 + parts.minute;
}

export function isWithinReleaseWindow(nowValue) {
  const parts = shanghaiParts(nowValue);
  const minute = releaseWindowMinute(parts);
  return minute >= RELEASE_WINDOW_START_MINUTE && minute < RELEASE_WINDOW_END_MINUTE;
}

function normalizeReleaseSlot(value) {
  let candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) throw new Error("待发起时槽时间无效。");
  // Move a candidate before 09:00 to 09:00 on the same Shanghai day and a
  // candidate at/after 18:00 to 09:00 on the next Shanghai day. This keeps
  // every automatic OA call inside the business-hours window.
  for (let guard = 0; guard < 370; guard += 1) {
    const parts = shanghaiParts(candidate);
    const minute = releaseWindowMinute(parts);
    if (minute < RELEASE_WINDOW_START_MINUTE) {
      candidate = shanghaiDate(parts.year, parts.month, parts.day, 9, 0);
      continue;
    }
    if (minute >= RELEASE_WINDOW_END_MINUTE) {
      candidate = shanghaiDate(parts.year, parts.month, parts.day + 1, 9, 0);
      continue;
    }
    return candidate;
  }
  throw new Error("无法计算有效的待发起时槽。");
}

function advanceShanghaiMonth(year, month) {
  if (month < 11) return { year, month: month + 1 };
  return { year: year + 1, month: 0 };
}

/**
 * The monthly reimbursement rule deliberately depends only on the submission
 * date in Shanghai. Amount, workflow and an old "urgent" flag are not part of
 * the decision: 1-20 joins this month's batch, 21-25 starts immediately, and
 * 26 through month-end joins next month's batch.
 */
export function getScheduledApprovalDecision(nowValue, config = {}) {
  if (!config.enabled) return { scheduled: false, reason: "scheduled_approvals_disabled" };
  const parts = shanghaiParts(nowValue);
  if (parts.day >= 21 && parts.day <= 25) {
    return { scheduled: false, reason: "direct_processing_window" };
  }
  const target = parts.day <= 20
    ? { year: parts.year, month: parts.month }
    : advanceShanghaiMonth(parts.year, parts.month);
  const scheduledAt = shanghaiDate(target.year, target.month, 21, 9, 0).toISOString();
  return {
    scheduled: true,
    reason: parts.day <= 20 ? "current_month_batch" : "next_month_batch",
    batchKey: `${target.year}-${String(target.month + 1).padStart(2, "0")}`,
    scheduledAt,
  };
}

export function calculateScheduledAt(nowValue, config = {}) {
  return getScheduledApprovalDecision(nowValue, config).scheduledAt || "";
}

// Kept as a compatibility export for callers outside this module. Eligibility
// now means only that the feature is enabled; the date decision above chooses
// between queueing and immediate OA creation. Queued releases are dispatched
// only during the Shanghai 09:00-18:00 business-hours window.
export function isEligibleForScheduling(_input = {}, config = {}) {
  return Boolean(config.enabled);
}

export class ScheduledApprovalStore {
  constructor(filePath, options = {}) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.now = options.now || (() => Date.now());
    this.encryptionKey = deriveEncryptionKey(options.encryptionKey);
    this.db = new Database(filePath);
    try { chmodSync(filePath, 0o600); } catch {}
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_approval_jobs (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        owner_name TEXT NOT NULL DEFAULT '',
        dept_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_title TEXT NOT NULL,
        process_code TEXT NOT NULL,
        tracking_code TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        prepared_json TEXT NOT NULL,
        context_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_until TEXT NOT NULL DEFAULT '',
        process_instance_id TEXT NOT NULL DEFAULT '',
        failure_code TEXT NOT NULL DEFAULT '',
        failure_reason TEXT NOT NULL DEFAULT '',
        failure_advice TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dispatched_at TEXT NOT NULL DEFAULT '',
        cancelled_at TEXT NOT NULL DEFAULT '',
        UNIQUE(owner_user_id, submission_id)
      );
      CREATE INDEX IF NOT EXISTS scheduled_approval_due_idx
        ON scheduled_approval_jobs(status, next_attempt_at, scheduled_at);
      CREATE INDEX IF NOT EXISTS scheduled_approval_owner_idx
        ON scheduled_approval_jobs(owner_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS scheduled_approval_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scheduled_approval_event_job_idx
        ON scheduled_approval_events(job_id, id DESC);
      CREATE TABLE IF NOT EXISTS scheduled_approval_runtime (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS application_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        owner_user_id TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        workflow_id TEXT NOT NULL DEFAULT '',
        workflow_title TEXT NOT NULL DEFAULT '',
        summary_json TEXT NOT NULL DEFAULT '{}',
        reason_code TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS application_audit_created_idx
        ON application_audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS application_audit_status_idx
        ON application_audit_events(status, created_at DESC);
      CREATE TABLE IF NOT EXISTS client_audit_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        draft_id TEXT NOT NULL DEFAULT '',
        sequence INTEGER NOT NULL DEFAULT 0,
        owner_user_id TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'info',
        workflow_id TEXT NOT NULL DEFAULT '',
        workflow_title TEXT NOT NULL DEFAULT '',
        client_at TEXT NOT NULL DEFAULT '',
        server_at TEXT NOT NULL,
        app_version TEXT NOT NULL DEFAULT '',
        summary_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS client_audit_trace_idx
        ON client_audit_events(trace_id, sequence, server_at);
      CREATE INDEX IF NOT EXISTS client_audit_owner_idx
        ON client_audit_events(owner_user_id, server_at DESC);
    `);
    const columns = new Set(this.db.prepare("PRAGMA table_info(scheduled_approval_jobs)").all().map((column) => column.name));
    if (!columns.has("tracking_code")) {
      this.db.exec("ALTER TABLE scheduled_approval_jobs ADD COLUMN tracking_code TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS scheduled_approval_tracking_idx ON scheduled_approval_jobs(tracking_code)");
  }

  publicJob(row, options = {}) {
    return toPublicJob(row, { ...options, encryptionKey: this.encryptionKey });
  }

  close() {
    this.db.close();
  }

  addEvent(jobId, eventType, detail = {}) {
    this.db.prepare(`INSERT INTO scheduled_approval_events (job_id, event_type, detail_json, created_at)
      VALUES (?, ?, ?, ?)`).run(jobId, eventType, json(detail), iso(this.now()));
  }

  reserveReleaseSlot(batchStartAt, releaseIntervalMs = DEFAULT_RELEASE_INTERVAL_MS) {
    const batchStart = new Date(batchStartAt);
    if (Number.isNaN(batchStart.getTime())) throw new Error("待发起批次时间无效。");
    const interval = Math.max(Number(releaseIntervalMs) || DEFAULT_RELEASE_INTERVAL_MS, 1_000);
    const normalizedStart = normalizeReleaseSlot(batchStart);
    // A monthly batch may span the 21st through the 25th. Include every
    // non-cancelled slot in that window so new submissions cannot reuse a slot
    // that has already been claimed, retried, or completed.
    const batchEnd = new Date(normalizedStart.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const latest = this.db.prepare(`SELECT scheduled_at FROM scheduled_approval_jobs
      WHERE status <> ? AND scheduled_at >= ? AND scheduled_at < ?
      ORDER BY scheduled_at DESC, created_at DESC LIMIT 1`)
      .get(SCHEDULED_STATUSES.CANCELLED, normalizedStart.toISOString(), batchEnd);
    const latestAt = latest?.scheduled_at ? new Date(latest.scheduled_at).getTime() : NaN;
    const candidate = Number.isFinite(latestAt)
      ? new Date(Math.max(normalizedStart.getTime(), latestAt + interval))
      : normalizedStart;
    return normalizeReleaseSlot(candidate).toISOString();
  }

  createJob(input) {
    const existing = this.db.prepare(`SELECT * FROM scheduled_approval_jobs
      WHERE owner_user_id = ? AND submission_id = ?`).get(input.ownerUserId, input.submissionId);
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        const error = new Error("该提交编号已经对应另一笔报销，请新建报销后再提交。");
        error.statusCode = 409;
        throw error;
      }
      return { created: false, job: this.publicJob(existing) };
    }
    const create = this.db.transaction(() => {
      const id = input.id || randomUUID();
      const now = iso(this.now());
      const scheduledAt = input.releaseIntervalMs
        ? this.reserveReleaseSlot(input.scheduledAt, input.releaseIntervalMs)
        : input.scheduledAt;
      this.db.prepare(`INSERT INTO scheduled_approval_jobs (
      id, submission_id, fingerprint, owner_user_id, owner_name, dept_id,
      workflow_id, workflow_title, process_code, tracking_code, amount_cents, status,
      scheduled_at, next_attempt_at, prepared_json, context_json, snapshot_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
        id, input.submissionId, input.fingerprint, input.ownerUserId, input.ownerName || "", input.deptId,
        input.workflowId, input.workflowTitle, input.processCode, input.trackingCode || id, Math.round(Number(input.amount) * 100),
        SCHEDULED_STATUSES.SCHEDULED, scheduledAt, scheduledAt, encodeSensitive(input.prepared, this.encryptionKey),
        encodeSensitive(input.context, this.encryptionKey), json(input.snapshot), now, now,
      );
      this.addEvent(id, "scheduled", { scheduledAt, amount: Number(input.amount).toFixed(2) });
      return { created: true, job: this.getJob(id) };
    });
    return create();
  }

  getJob(id, options = {}) {
    return this.publicJob(this.db.prepare("SELECT * FROM scheduled_approval_jobs WHERE id = ?").get(id), options);
  }

  getBySubmission(ownerUserId, submissionId, options = {}) {
    return this.publicJob(this.db.prepare(`SELECT * FROM scheduled_approval_jobs
      WHERE owner_user_id = ? AND submission_id = ?`).get(ownerUserId, submissionId), options);
  }

  listForUser(ownerUserId, limit = 100) {
    const rows = this.db.prepare(`SELECT * FROM scheduled_approval_jobs
      WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`).all(ownerUserId, Math.min(Math.max(Number(limit) || 50, 1), 200));
    return rows.map((row) => this.publicJob(row));
  }

  listAdmin({ status = "", limit = 200, offset = 0 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const boundedOffset = Math.max(Number(offset) || 0, 0);
    const rows = status
      ? this.db.prepare(`SELECT * FROM scheduled_approval_jobs WHERE status = ? ORDER BY scheduled_at, created_at LIMIT ? OFFSET ?`).all(status, boundedLimit, boundedOffset)
      : this.db.prepare(`SELECT * FROM scheduled_approval_jobs ORDER BY scheduled_at, created_at LIMIT ? OFFSET ?`).all(boundedLimit, boundedOffset);
    return rows.map((row) => this.publicJob(row));
  }

  listUnknown(limit = 50, options = {}) {
    return this.db.prepare(`SELECT * FROM scheduled_approval_jobs WHERE status = ? AND next_attempt_at <= ? ORDER BY updated_at LIMIT ?`)
      .all(SCHEDULED_STATUSES.UNKNOWN, iso(this.now()), Math.min(Math.max(Number(limit) || 20, 1), 100))
      .map((row) => this.publicJob(row, options));
  }

  deferUnknownReconciliation(id, delayMs = 5 * 60 * 1000) {
    const nextAttemptAt = iso(this.now() + Math.max(Number(delayMs) || 0, 60_000));
    this.db.prepare(`UPDATE scheduled_approval_jobs SET next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(nextAttemptAt, iso(this.now()), id, SCHEDULED_STATUSES.UNKNOWN);
    return nextAttemptAt;
  }

  getEvents(jobId, limit = 100) {
    return this.db.prepare(`SELECT event_type AS eventType, detail_json AS detailJson, created_at AS createdAt
      FROM scheduled_approval_events WHERE job_id = ? ORDER BY id DESC LIMIT ?`)
      .all(jobId, Math.min(Math.max(Number(limit) || 50, 1), 200))
      .map((row) => ({ eventType: row.eventType, detail: parseJson(row.detailJson, {}), createdAt: row.createdAt }));
  }

  addAuditEvent(input = {}) {
    const id = input.id || randomUUID();
    const createdAt = input.createdAt || iso(this.now());
    this.db.prepare(`INSERT OR REPLACE INTO application_audit_events (
      id, event_type, owner_user_id, owner_name, status, workflow_id, workflow_title,
      summary_json, reason_code, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      String(input.eventType || "system"),
      String(input.ownerUserId || ""),
      String(input.ownerName || ""),
      String(input.status || "info"),
      String(input.workflowId || ""),
      String(input.workflowTitle || ""),
      json(input.summary || {}),
      String(input.reasonCode || ""),
      String(input.reason || ""),
      createdAt,
    );
    return id;
  }

  listAuditEvents({ eventType = "", status = "", limit = 200, offset = 0 } = {}) {
    const clauses = [];
    const values = [];
    if (eventType) { clauses.push("event_type = ?"); values.push(String(eventType)); }
    if (status) { clauses.push("status = ?"); values.push(String(status)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 500), Math.max(Number(offset) || 0, 0));
    return this.db.prepare(`SELECT id, event_type AS eventType, owner_user_id AS ownerUserId,
      owner_name AS ownerName, status, workflow_id AS workflowId, workflow_title AS workflowTitle,
      summary_json AS summaryJson, reason_code AS reasonCode, reason, created_at AS createdAt
      FROM application_audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...values)
      .map((row) => ({ ...row, summary: parseJson(row.summaryJson, {}), summaryJson: undefined }));
  }

  auditStats() {
    const rows = this.db.prepare(`SELECT event_type AS eventType, status, COUNT(*) AS count
      FROM application_audit_events GROUP BY event_type, status`).all();
    return rows.reduce((result, row) => {
      result[row.eventType] ||= {};
      result[row.eventType][row.status] = Number(row.count);
      return result;
    }, {});
  }

  addClientAuditEvents(events = []) {
    const insert = this.db.prepare(`INSERT OR IGNORE INTO client_audit_events (
      id, trace_id, draft_id, sequence, owner_user_id, owner_name, event_type, status,
      workflow_id, workflow_title, client_at, server_at, app_version, summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const transaction = this.db.transaction((items) => items.reduce((accepted, item) => {
      const result = insert.run(
        item.id, item.traceId, item.draftId, Number(item.sequence) || 0,
        item.ownerUserId, item.ownerName, item.eventType, item.status,
        item.workflowId, item.workflowTitle, item.clientAt, item.serverAt,
        item.appVersion, json(item.summary || {}),
      );
      return accepted + Number(result.changes || 0);
    }, 0));
    return transaction(Array.isArray(events) ? events : []);
  }

  listClientAuditEvents({ limit = 500, traceId = "" } = {}) {
    const values = [];
    const where = traceId ? "WHERE trace_id = ?" : "";
    if (traceId) values.push(String(traceId));
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
    return this.db.prepare(`SELECT id, trace_id AS traceId, draft_id AS draftId, sequence,
      owner_user_id AS ownerUserId, owner_name AS ownerName, event_type AS eventType,
      status, workflow_id AS workflowId, workflow_title AS workflowTitle,
      client_at AS clientAt, server_at AS serverAt, app_version AS appVersion,
      summary_json AS summaryJson FROM client_audit_events ${where}
      ORDER BY server_at DESC, sequence DESC LIMIT ?`).all(...values)
      .map((row) => ({ ...row, summary: parseJson(row.summaryJson, {}), summaryJson: undefined }));
  }

  clientAuditStats() {
    const rows = this.db.prepare(`SELECT event_type AS eventType, status, COUNT(*) AS count
      FROM client_audit_events GROUP BY event_type, status`).all();
    return rows.reduce((result, row) => {
      result[row.eventType] ||= {};
      result[row.eventType][row.status] = Number(row.count);
      return result;
    }, {});
  }

  claimDueJobs(workerId, { limit = 2, leaseMs = 5 * 60 * 1000 } = {}) {
    const transaction = this.db.transaction(() => {
      const now = iso(this.now());
      const due = this.db.prepare(`SELECT id FROM scheduled_approval_jobs
        WHERE status IN (?, ?)
          AND scheduled_at <= ? AND next_attempt_at <= ?
        ORDER BY scheduled_at, created_at LIMIT ?`)
        .all(SCHEDULED_STATUSES.SCHEDULED, SCHEDULED_STATUSES.RETRY, now, now, Math.max(1, Number(limit) || 1));
      const leaseUntil = iso(this.now() + leaseMs);
      const update = this.db.prepare(`UPDATE scheduled_approval_jobs
        SET status = ?, lease_owner = ?, lease_until = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND status IN (?, ?)`);
      const claimed = [];
      for (const item of due) {
        const result = update.run(
          SCHEDULED_STATUSES.DISPATCHING, workerId, leaseUntil, now, item.id,
          SCHEDULED_STATUSES.SCHEDULED, SCHEDULED_STATUSES.RETRY,
        );
        if (result.changes) {
          this.addEvent(item.id, "dispatch_started", { workerId, leaseUntil });
          claimed.push(this.getJob(item.id, { includePrepared: true }));
        }
      }
      return claimed;
    });
    return transaction();
  }

  markSucceeded(id, processInstanceId, detail = {}) {
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, process_instance_id = ?,
      lease_owner = '', lease_until = '', failure_code = '', failure_reason = '', failure_advice = '',
      dispatched_at = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(SCHEDULED_STATUSES.SUCCEEDED, processInstanceId, now, now, id, SCHEDULED_STATUSES.DISPATCHING);
    this.addEvent(id, "dispatch_succeeded", { processInstanceId, ...detail });
    return this.getJob(id);
  }

  markReconciled(id, processInstanceId, detail = {}) {
    const now = iso(this.now());
    const result = this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, process_instance_id = ?,
      lease_owner = '', lease_until = '', failure_code = '', failure_reason = '', failure_advice = '',
      dispatched_at = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(SCHEDULED_STATUSES.SUCCEEDED, processInstanceId, now, now, id, SCHEDULED_STATUSES.UNKNOWN);
    if (result.changes) this.addEvent(id, "delivery_reconciled", { processInstanceId, ...detail });
    return this.getJob(id);
  }

  markRetry(id, failure, nextAttemptAt) {
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, next_attempt_at = ?,
      lease_owner = '', lease_until = '', failure_code = ?, failure_reason = ?, failure_advice = ?, updated_at = ?
      WHERE id = ? AND status = ?`).run(
      SCHEDULED_STATUSES.RETRY, nextAttemptAt, failure.code || "temporary_failure",
      failure.reason || "系统暂时无法发起OA，正在自动重试。", failure.advice || "无需重复提交。", now,
      id, SCHEDULED_STATUSES.DISPATCHING,
    );
    this.addEvent(id, "retry_scheduled", { nextAttemptAt, failure });
    return this.getJob(id);
  }

  markManual(id, failure) {
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, lease_owner = '', lease_until = '',
      failure_code = ?, failure_reason = ?, failure_advice = ?, updated_at = ? WHERE id = ?`)
      .run(SCHEDULED_STATUSES.MANUAL, failure.code || "manual_review", failure.reason || "需要管理员处理。", failure.advice || "", now, id);
    this.addEvent(id, "manual_review_required", { failure });
    return this.getJob(id);
  }

  markUnknown(id, failure) {
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, lease_owner = '', lease_until = '',
      next_attempt_at = ?, failure_code = ?, failure_reason = ?, failure_advice = ?, updated_at = ? WHERE id = ?`)
      .run(SCHEDULED_STATUSES.UNKNOWN, iso(this.now() + 5 * 60 * 1000), failure.code || "delivery_unknown", failure.reason || "钉钉是否创建成功尚待核对。", failure.advice || "请勿直接重试。", now, id);
    this.addEvent(id, "delivery_result_unknown", { failure });
    return this.getJob(id);
  }

  recoverExpiredLeases() {
    const now = iso(this.now());
    const expired = this.db.prepare(`SELECT id FROM scheduled_approval_jobs
      WHERE status = ? AND lease_until <> '' AND lease_until <= ?`).all(SCHEDULED_STATUSES.DISPATCHING, now);
    for (const row of expired) {
      this.markUnknown(row.id, {
        code: "worker_interrupted",
        reason: "发送过程中服务发生重启，钉钉创建结果需要核对。",
        advice: "系统不会自动重复发起，请管理员核对后处理。",
      });
    }
    return expired.length;
  }

  cancel(id, ownerUserId = "") {
    const row = this.db.prepare("SELECT * FROM scheduled_approval_jobs WHERE id = ?").get(id);
    if (!row || (ownerUserId && row.owner_user_id !== ownerUserId)) return null;
    if (!MUTABLE_STATUSES.has(row.status)) {
      const error = new Error("该报销已经进入发起流程，当前不能撤销。");
      error.statusCode = 409;
      throw error;
    }
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, cancelled_at = ?, updated_at = ?,
      lease_owner = '', lease_until = '' WHERE id = ?`).run(SCHEDULED_STATUSES.CANCELLED, now, now, id);
    this.addEvent(id, "cancelled", { ownerUserId });
    return this.getJob(id);
  }

  reschedule(id, scheduledAt) {
    const row = this.getJob(id);
    if (!row || FINAL_STATUSES.has(row.status) || row.status === SCHEDULED_STATUSES.DISPATCHING) {
      const error = new Error("该记录当前不能调整发送时间。");
      error.statusCode = 409;
      throw error;
    }
    const now = iso(this.now());
    this.db.prepare(`UPDATE scheduled_approval_jobs SET status = ?, scheduled_at = ?, next_attempt_at = ?,
      failure_code = '', failure_reason = '', failure_advice = '', updated_at = ? WHERE id = ?`)
      .run(SCHEDULED_STATUSES.SCHEDULED, scheduledAt, scheduledAt, now, id);
    this.addEvent(id, "rescheduled", { scheduledAt });
    return this.getJob(id);
  }

  setRuntime(key, value) {
    const now = iso(this.now());
    this.db.prepare(`INSERT INTO scheduled_approval_runtime (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, String(value), now);
  }

  runtime() {
    return Object.fromEntries(this.db.prepare("SELECT key, value, updated_at AS updatedAt FROM scheduled_approval_runtime").all()
      .map((row) => [row.key, { value: row.value, updatedAt: row.updatedAt }]));
  }

  stats() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount_cents
      FROM scheduled_approval_jobs GROUP BY status`).all();
    return {
      statuses: Object.fromEntries(rows.map((row) => [row.status, { count: Number(row.count), amount: (Number(row.amount_cents) / 100).toFixed(2) }])),
      runtime: this.runtime(),
    };
  }
}

export class ScheduledApprovalScheduler {
  constructor({ store, dispatch, classifyFailure, reconcileUnknown = null, now = () => Date.now(), workerId = randomUUID(), maxAttempts = 5, leaseMs = 5 * 60 * 1000, backoffMs = [60_000, 300_000, 900_000, 1_800_000, 3_600_000] }) {
    this.store = store;
    this.dispatch = dispatch;
    this.classifyFailure = classifyFailure || (() => ({ retryable: false }));
    this.reconcileUnknown = reconcileUnknown;
    this.now = now;
    this.workerId = workerId;
    // A release tick may create at most one OA. This is enforced here rather
    // than relying only on deployment configuration, so a future PM2 env edit
    // cannot turn a monthly batch into a burst.
    this.concurrency = 1;
    this.maxJobsPerTick = 1;
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 5);
    this.leaseMs = leaseMs;
    this.backoffMs = backoffMs;
    this.running = false;
    this.timer = null;
  }

  async tick() {
    if (this.running) return { skipped: true };
    if (this.store.runtime().paused?.value === "true") {
      this.store.setRuntime("lastHeartbeat", iso(this.now()));
      return { skipped: true, paused: true };
    }
    if (!isWithinReleaseWindow(this.now())) {
      this.store.setRuntime("lastHeartbeat", iso(this.now()));
      this.store.setRuntime("lastSkipReason", "outside_release_window");
      return { skipped: true, reason: "outside_release_window" };
    }
    this.running = true;
    const startedAt = iso(this.now());
    this.store.setRuntime("lastHeartbeat", startedAt);
    try {
      const recovered = this.store.recoverExpiredLeases();
      const reconciled = await this.reconcileUnknownJobs();
      const jobs = this.store.claimDueJobs(this.workerId, { limit: 1, leaseMs: this.leaseMs });
      const results = jobs.length ? [await this.process(jobs[0])] : [];
      const claimed = jobs.length;
      if (claimed) this.store.setRuntime("lastHeartbeat", iso(this.now()));
      this.store.setRuntime("lastCompletedTick", iso(this.now()));
      this.store.setRuntime("lastBatchCount", claimed);
      return { skipped: false, recovered, reconciled, claimed, results, capped: claimed >= this.maxJobsPerTick };
    } finally {
      this.running = false;
    }
  }

  async reconcileUnknownJobs() {
    if (typeof this.reconcileUnknown !== "function") return { checked: 0, matched: 0 };
    const jobs = this.store.listUnknown(Math.max(this.concurrency * 5, 10), { includePrepared: true });
    let matched = 0;
    for (const job of jobs) {
      try {
        const result = await this.reconcileUnknown(job);
        if (result?.processInstanceId) {
          this.store.markReconciled(job.id, result.processInstanceId, { source: result.source || "tracking_code" });
          matched += 1;
        } else {
          this.store.deferUnknownReconciliation(job.id);
        }
      } catch (error) {
        this.store.addEvent(job.id, "reconciliation_failed", { reason: error.message || String(error) });
        this.store.deferUnknownReconciliation(job.id);
      }
    }
    return { checked: jobs.length, matched };
  }

  async process(job) {
    try {
      const result = await this.dispatch(job);
      this.store.markSucceeded(job.id, result.processInstanceId, { requestId: result.requestId || "" });
      return { id: job.id, status: SCHEDULED_STATUSES.SUCCEEDED, processInstanceId: result.processInstanceId };
    } catch (error) {
      const classification = this.classifyFailure(error, job) || {};
      const failure = classification.failure || {
        code: error.code || "dispatch_failed",
        reason: error.message || "钉钉OA暂未创建。",
        advice: "无需重复提交。",
      };
      if (classification.unknown) {
        this.store.markUnknown(job.id, failure);
        return { id: job.id, status: SCHEDULED_STATUSES.UNKNOWN };
      }
      if (classification.retryable && job.attemptCount < this.maxAttempts) {
        const delay = this.backoffMs[Math.min(job.attemptCount - 1, this.backoffMs.length - 1)] || this.backoffMs.at(-1) || 60_000;
        const nextAttemptAt = iso(this.now() + delay);
        this.store.markRetry(job.id, failure, nextAttemptAt);
        return { id: job.id, status: SCHEDULED_STATUSES.RETRY, nextAttemptAt };
      }
      this.store.markManual(job.id, failure);
      return { id: job.id, status: SCHEDULED_STATUSES.MANUAL };
    }
  }

  start(intervalMs = 60_000) {
    if (this.timer) return;
    this.store.recoverExpiredLeases();
    this.timer = setInterval(() => this.tick().catch((error) => {
      this.store.setRuntime("lastSchedulerError", error.message || String(error));
    }), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
