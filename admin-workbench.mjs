import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import mysql from "mysql2/promise";
import OSS from "ali-oss";
import CredentialsSdk from "@alicloud/credentials";

const JSON_COLUMNS = new Set(["summary_json", "payload_json", "detail_json", "snapshot_json", "patch_json", "result_json", "ocr_json"]);

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), min), max) : fallback;
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function parseJson(value, fallback = null) {
  // mysql2 returns native JSON columns as objects in production.  Preserve
  // them instead of attempting JSON.parse(object), which becomes
  // "[object Object]" and silently loses encrypted case snapshots.
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function stableJson(value) {
  return JSON.stringify(value ?? {});
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deriveKey(value) {
  return value ? createHash("sha256").update(String(value)).digest() : null;
}

function encryptJson(value, key) {
  if (!key) throw new Error("管理员工作台缺少加密密钥，拒绝保存完整草稿或OCR数据。");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(stableJson(value), "utf8"), cipher.final()]);
  return { encrypted: `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}` };
}

function decryptJson(value, key) {
  const token = value?.encrypted;
  if (!token?.startsWith?.("enc:v1:")) return value;
  if (!key) throw new Error("管理员工作台加密数据无法解密：缺少密钥。");
  const [, , ivText, tagText, cipherText] = token.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return parseJson(Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]).toString("utf8"), null);
}

async function readEnvFile(file) {
  try {
    const source = await readFile(file, "utf8");
    return source.split(/\r?\n/).reduce((result, line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/i);
      if (match) result[match[1]] = match[2];
      return result;
    }, {});
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function rowToObject(row = {}) {
  const result = { ...row };
  Object.entries(result).forEach(([key, value]) => {
    if (JSON_COLUMNS.has(key)) result[key.replace(/_json$/, "")] = parseJson(value, {});
    delete result[key];
  });
  return result;
}

function caseStatusForEvent(event = {}) {
  if (event.status === "failed") return "open";
  if (/mismatch|异常|失败|拦截|missing|failed/i.test(`${event.eventType} ${event.reasonCode} ${event.reason}`)) return "open";
  return "observing";
}

/**
 * The support workbench is intentionally an optional sidecar. Its callers must
 * never make an employee upload, OCR request, or approval submission depend on
 * MySQL/OSS availability.
 */
export async function createAdminWorkbench({ root, dataDirectory, localConfig = {}, env = process.env } = {}) {
  const configured = localConfig.adminWorkbench && typeof localConfig.adminWorkbench === "object"
    ? localConfig.adminWorkbench
    : {};
  const mysqlEnv = await readEnvFile(`${dataDirectory}/mysql-workbench.local.env`);
  const config = {
    enabled: bool(env.REIMBURSEMENT_ADMIN_WORKBENCH_ENABLED ?? configured.enabled, false),
    archiveEnabled: bool(env.REIMBURSEMENT_OSS_ARCHIVE_ENABLED ?? configured.archiveEnabled, false),
    readEnabled: bool(env.REIMBURSEMENT_ADMIN_WORKBENCH_READ_ENABLED ?? configured.readEnabled, false),
    repairEnabled: bool(env.REIMBURSEMENT_ADMIN_REPAIR_ENABLED ?? configured.repairEnabled, false),
    submitEnabled: bool(env.REIMBURSEMENT_ADMIN_SUBMIT_ENABLED ?? configured.submitEnabled, false),
    // Creating a case from scratch is intentionally a separate capability from
    // replaying an employee-saved case.  It can be enabled for a small admin
    // group without changing the existing repair/submit gates.
    manualCreateEnabled: bool(env.REIMBURSEMENT_ADMIN_MANUAL_CREATE_ENABLED ?? configured.manualCreateEnabled, false),
    retainDays: integer(env.REIMBURSEMENT_ADMIN_RETENTION_DAYS ?? configured.retainDays, 60, 1, 3650),
    mysql: {
      host: clean(env.REIMBURSEMENT_MYSQL_HOST ?? configured.mysqlHost ?? mysqlEnv.MYSQL_HOST ?? "127.0.0.1", 200),
      port: integer(env.REIMBURSEMENT_MYSQL_PORT ?? configured.mysqlPort ?? mysqlEnv.MYSQL_PORT, 3306, 1, 65535),
      database: clean(env.REIMBURSEMENT_MYSQL_DATABASE ?? configured.mysqlDatabase ?? mysqlEnv.MYSQL_DATABASE, 120),
      user: clean(env.REIMBURSEMENT_MYSQL_USER ?? configured.mysqlUser ?? mysqlEnv.MYSQL_USER, 120),
      password: String(env.REIMBURSEMENT_MYSQL_PASSWORD ?? configured.mysqlPassword ?? mysqlEnv.MYSQL_PASSWORD ?? ""),
      connectionLimit: integer(env.REIMBURSEMENT_MYSQL_POOL_SIZE ?? configured.mysqlPoolSize, 5, 1, 8),
    },
    oss: {
      region: clean(env.OSS_REGION ?? configured.ossRegion ?? "cn-hangzhou", 80),
      bucket: clean(env.OSS_BUCKET ?? configured.ossBucket ?? "", 120),
      roleName: clean(env.OSS_RAM_ROLE ?? configured.ossRamRole ?? "", 120),
      prefix: clean(env.REIMBURSEMENT_OSS_PREFIX ?? configured.ossPrefix ?? "reimbursement-assistant", 120).replace(/^\/+|\/+$/g, ""),
    },
    encryptionKey: String(env.REIMBURSEMENT_WORKBENCH_ENCRYPTION_KEY
      ?? configured.encryptionKey
      ?? localConfig.scheduledApprovals?.encryptionKey
      ?? localConfig.appSecret
      ?? ""),
  };
  const sensitiveDataKey = deriveKey(config.encryptionKey);

  let pool = null;
  let credential = null;
  let ossClient = null;
  let ossClientPromise = null;

  function isConfigured() {
    return Boolean(config.enabled && config.mysql.database && config.mysql.user && config.mysql.password);
  }

  async function getPool() {
    if (!isConfigured()) throw new Error("管理员工作台数据库未启用或未配置。");
    if (!pool) {
      pool = mysql.createPool({
        ...config.mysql,
        waitForConnections: true,
        queueLimit: 20,
        connectTimeout: 5000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        timezone: "Z",
      });
    }
    return pool;
  }

  async function getOssClient() {
    if (!config.archiveEnabled || !config.oss.bucket || !config.oss.roleName) {
      throw new Error("OSS归档未启用或配置不完整。");
    }
    if (ossClient) return ossClient;
    if (ossClientPromise) return ossClientPromise;
    ossClientPromise = (async () => {
      credential ||= new CredentialsSdk.default({
        type: "ecs_ram_role",
        roleName: config.oss.roleName,
        enableIMDSv2: true,
        disableIMDSv1: true,
        timeout: 3000,
        connectTimeout: 3000,
      });
      const toOssCredentials = async () => {
        const value = await credential.getCredential();
        return {
          accessKeyId: value.accessKeyId,
          accessKeySecret: value.accessKeySecret,
          stsToken: value.securityToken,
        };
      };
      const first = await toOssCredentials();
      ossClient = new OSS({
        ...first,
        bucket: config.oss.bucket,
        endpoint: `oss-${config.oss.region}-internal.aliyuncs.com`,
        timeout: 10000,
        refreshSTSToken: toOssCredentials,
        refreshSTSTokenInterval: 4 * 60 * 1000,
      });
      return ossClient;
    })().finally(() => { ossClientPromise = null; });
    return ossClientPromise;
  }

  async function query(sql, values = []) {
    const db = await getPool();
    // Use the text protocol for JSON-heavy workbench writes.  mysql2's
    // prepared-statement path can reject large encrypted snapshots with a
    // one-byte COM_STMT_EXECUTE serialization mismatch; the text protocol
    // preserves the same parameter binding while avoiding that driver bug.
    return db.query(sql, values);
  }

  async function ensureCase({ traceId = "", ownerUserId = "", ownerName = "", workflowId = "", workflowTitle = "", status = "observing", source = "system", summary = {} } = {}) {
    const trace = clean(traceId, 120) || `server:${randomUUID()}`;
    const [existing] = await query("SELECT id FROM support_cases WHERE trace_id = ? LIMIT 1", [trace]);
    if (existing.length) {
      await query(`UPDATE support_cases SET owner_user_id = COALESCE(NULLIF(?, ''), owner_user_id), owner_name = COALESCE(NULLIF(?, ''), owner_name),
        workflow_id = COALESCE(NULLIF(?, ''), workflow_id), workflow_title = COALESCE(NULLIF(?, ''), workflow_title), status = IF(status = 'closed', status, ?),
        summary_json = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [
        clean(ownerUserId, 120), clean(ownerName, 120), clean(workflowId, 80), clean(workflowTitle, 160), clean(status, 32), stableJson(summary), existing[0].id,
      ]);
      return existing[0].id;
    }
    const id = randomUUID();
    await query(`INSERT INTO support_cases (id, trace_id, owner_user_id, owner_name, workflow_id, workflow_title, status, source, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [
      id, trace, clean(ownerUserId, 120), clean(ownerName, 120), clean(workflowId, 80), clean(workflowTitle, 160), clean(status, 32), clean(source, 32), stableJson(summary),
    ]);
    return id;
  }

  async function appendCaseEvent({ caseId, eventType, status = "info", actorType = "system", actorUserId = "", actorName = "", reasonCode = "", reason = "", detail = {} } = {}) {
    await query(`INSERT INTO case_events (id, case_id, event_type, status, actor_type, actor_user_id, actor_name, reason_code, reason, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [
      randomUUID(), caseId, clean(eventType, 80), clean(status, 32), clean(actorType, 32), clean(actorUserId, 120), clean(actorName, 120),
      clean(reasonCode, 80), clean(reason, 1000), stableJson(detail),
    ]);
  }

  async function captureClientEvents(events = []) {
    if (!isConfigured()) return { accepted: 0, disabled: true };
    const accepted = [];
    // These are append-only diagnostics.  Avoid a cross-connection transaction
    // here: a failed event must never hold locks that can delay the main app.
    for (const event of Array.isArray(events) ? events : []) {
        const traceId = clean(event.traceId, 120);
        if (!traceId || !clean(event.id, 120)) continue;
        const caseId = await ensureCase({
          traceId, ownerUserId: event.ownerUserId, ownerName: event.ownerName, workflowId: event.workflowId,
          workflowTitle: event.workflowTitle, status: caseStatusForEvent(event), source: "client", summary: event.summary || {},
        });
        const [result] = await query(`INSERT IGNORE INTO client_events
          (id, case_id, trace_id, draft_id, sequence_no, owner_user_id, owner_name, event_type, status, workflow_id, workflow_title, client_at, server_at, app_version, summary_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?)`, [
          clean(event.id, 120), caseId, traceId, clean(event.draftId, 120), Number(event.sequence) || 0, clean(event.ownerUserId, 120), clean(event.ownerName, 120),
          clean(event.eventType, 80), clean(event.status, 32) || "info", clean(event.workflowId, 80), clean(event.workflowTitle, 160), clean(event.clientAt, 48), clean(event.appVersion, 80), stableJson(event.summary || {}),
        ]);
        if (result.affectedRows) {
          await appendCaseEvent({ caseId, eventType: event.eventType, status: event.status, actorType: "employee", actorUserId: event.ownerUserId, actorName: event.ownerName, detail: event.summary || {} });
          accepted.push(event.id);
        }
    }
    return { accepted: accepted.length, disabled: false };
  }

  async function captureServerEvent(event = {}) {
    if (!isConfigured()) return { accepted: false, disabled: true };
    const traceId = clean(event.traceId, 120) || `server:${event.id || randomUUID()}`;
    const caseId = await ensureCase({
      traceId, ownerUserId: event.ownerUserId, ownerName: event.ownerName, workflowId: event.workflowId,
      workflowTitle: event.workflowTitle, status: caseStatusForEvent(event), source: "server", summary: event.summary || {},
    });
    await query(`INSERT IGNORE INTO server_events (id, case_id, trace_id, event_type, status, owner_user_id, owner_name, workflow_id, workflow_title,
      reason_code, reason, summary_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [
      clean(event.id, 160) || randomUUID(), caseId, traceId, clean(event.eventType, 80), clean(event.status, 32) || "info",
      clean(event.ownerUserId, 120), clean(event.ownerName, 120), clean(event.workflowId, 80), clean(event.workflowTitle, 160),
      clean(event.reasonCode, 80), clean(event.reason, 1000), stableJson(event.summary || {}),
    ]);
    await appendCaseEvent({ caseId, eventType: event.eventType, status: event.status, actorType: "system", actorUserId: event.ownerUserId, actorName: event.ownerName, reasonCode: event.reasonCode, reason: event.reason, detail: event.summary || {} });
    return { accepted: true, caseId };
  }

  async function captureDraft({ traceId, draftId = "", ownerUserId, ownerName = "", ownerUnionId = "", ownerDepartments = [], ownerSocialCompanyRecognition = null, workflowId = "", workflowTitle = "", draft = {}, source = "submission", reason = "", adminOriginator = false, operatorUserId = "", operatorName = "" } = {}) {
    if (!isConfigured()) return null;
    const caseId = await ensureCase({ traceId, ownerUserId, ownerName, workflowId, workflowTitle, source, summary: { action: "draft_captured" } });
    const [latest] = await query("SELECT revision FROM draft_revisions WHERE case_id = ? ORDER BY revision DESC LIMIT 1", [caseId]);
    const revision = Number(latest[0]?.revision || 0) + 1;
    const canonical = {
      draft: { ...draft, session_token: "" },
      support: {
        ownerUserId: clean(ownerUserId, 120),
        ownerName: clean(ownerName, 120),
        ownerUnionId: clean(ownerUnionId, 180),
        socialCompanyRecognition: ownerSocialCompanyRecognition && typeof ownerSocialCompanyRecognition === "object"
          ? ownerSocialCompanyRecognition
          : null,
        departments: Array.isArray(ownerDepartments)
          ? ownerDepartments.slice(0, 50).map((item) => ({ id: clean(item?.id, 80), name: clean(item?.name, 160) }))
          : [],
        // These fields are server-generated only.  They let a later admin
        // submit/repair request recreate the target employee context without
        // ever putting an employee's access token in the browser.
        adminOriginator: Boolean(adminOriginator),
        operatorUserId: clean(operatorUserId, 120),
        operatorName: clean(operatorName, 120),
      },
    };
    const protectedSnapshot = encryptJson(canonical, sensitiveDataKey);
    await query(`INSERT INTO draft_revisions (id, case_id, draft_id, revision, owner_user_id, owner_name, workflow_id, workflow_title, source, snapshot_json, snapshot_hash, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, [
      randomUUID(), caseId, clean(draftId, 120), revision, clean(ownerUserId, 120), clean(ownerName, 120), clean(workflowId, 80), clean(workflowTitle, 160),
      clean(source, 32), stableJson(protectedSnapshot), sha256(stableJson(canonical)), clean(reason, 1000),
    ]);
    await query("UPDATE support_cases SET current_revision = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [revision, caseId]);
    await appendCaseEvent({ caseId, eventType: "draft_revision", actorType: String(source).startsWith("admin") ? "admin" : "system", actorUserId: ownerUserId, actorName: ownerName, reason, detail: { revision, source } });
    return { caseId, revision };
  }

  async function archiveAttachment({ caseId = "", traceId = "", ownerUserId = "", ownerName = "", workflowId = "", workflowTitle = "", filePath, fileName, mimeType = "", size = 0, contentHash = "", ocr = {}, kind = "", attachmentFileId = "" } = {}) {
    if (!isConfigured() || !config.archiveEnabled) return { archived: false, disabled: true };
    const effectiveCaseId = caseId || await ensureCase({ traceId, ownerUserId, ownerName, workflowId, workflowTitle, source: "upload", summary: { action: "attachment_archive" } });
    const client = await getOssClient();
    const artifactId = randomUUID();
    const extension = extname(fileName || filePath || "").toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
    const date = new Date();
    const objectKey = `${config.oss.prefix}/evidence/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${effectiveCaseId}/${artifactId}${extension}`;
    const expiresAt = new Date(Date.now() + config.retainDays * 24 * 60 * 60 * 1000);
    await client.putStream(objectKey, createReadStream(filePath), {
      headers: { "x-oss-server-side-encryption": "AES256" },
      timeout: 10000,
    });
    await query(`INSERT INTO attachment_artifacts (id, case_id, owner_user_id, owner_name, workflow_id, workflow_title, file_name, file_name_hash, mime_type, file_size,
      content_hash, kind, attachment_file_id, oss_bucket, oss_object_key, archive_status, expires_at, ocr_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'archived', ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [
      artifactId, effectiveCaseId, clean(ownerUserId, 120), clean(ownerName, 120), clean(workflowId, 80), clean(workflowTitle, 160),
      clean(basename(fileName || "attachment"), 255), sha256(clean(fileName || "attachment", 255)), clean(mimeType, 120), Math.max(0, Number(size) || 0),
      clean(contentHash, 128), clean(kind, 40), clean(attachmentFileId, 160), config.oss.bucket, objectKey, expiresAt, stableJson(encryptJson(ocr || {}, sensitiveDataKey)),
    ]);
    await appendCaseEvent({ caseId: effectiveCaseId, eventType: "attachment_archived", status: "success", actorType: "system", detail: { artifactId, kind: clean(kind, 40), expiresAt: expiresAt.toISOString() } });
    return { archived: true, artifactId, caseId: effectiveCaseId, objectKey, expiresAt: expiresAt.toISOString() };
  }

  async function listCases({ queryText = "", status = "", ownerUserId = "", limit = 100, offset = 0 } = {}) {
    if (!isConfigured() || !config.readEnabled) return { entries: [], disabled: true };
    const clauses = [];
    const values = [];
    if (clean(status, 32)) { clauses.push("status = ?"); values.push(clean(status, 32)); }
    if (clean(ownerUserId, 120)) { clauses.push("owner_user_id = ?"); values.push(clean(ownerUserId, 120)); }
    const text = clean(queryText, 160);
    if (text) {
      clauses.push("(owner_name LIKE ? OR workflow_title LIKE ? OR trace_id LIKE ? OR id LIKE ?)");
      values.push(`%${text}%`, `%${text}%`, `%${text}%`, `%${text}%`);
    }
    values.push(integer(limit, 100, 1, 200), Math.max(0, Number(offset) || 0));
    const [rows] = await query(`SELECT id, trace_id, owner_user_id, owner_name, workflow_id, workflow_title, status, source, current_revision, summary_json, created_at, updated_at
      FROM support_cases ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`, values);
    return { entries: rows.map(rowToObject), disabled: false };
  }

  async function getCase(caseId) {
    if (!isConfigured() || !config.readEnabled) return null;
    const [cases] = await query("SELECT * FROM support_cases WHERE id = ? LIMIT 1", [clean(caseId, 80)]);
    if (!cases.length) return null;
    const [events] = await query("SELECT * FROM case_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 500", [clean(caseId, 80)]);
    const [revisions] = await query("SELECT id, draft_id, revision, owner_user_id, owner_name, workflow_id, workflow_title, source, snapshot_hash, reason, created_at FROM draft_revisions WHERE case_id = ? ORDER BY revision DESC LIMIT 100", [clean(caseId, 80)]);
    const [artifacts] = await query("SELECT id, file_name, mime_type, file_size, content_hash, kind, attachment_file_id, archive_status, expires_at, ocr_json, created_at FROM attachment_artifacts WHERE case_id = ? ORDER BY created_at DESC LIMIT 200", [clean(caseId, 80)]);
    return {
      case: rowToObject(cases[0]),
      events: events.map(rowToObject),
      revisions: revisions.map(rowToObject),
      artifacts: artifacts.map(rowToObject),
    };
  }

  async function findCaseByTraceId(traceId) {
    if (!isConfigured()) return null;
    const [rows] = await query("SELECT id, owner_user_id, owner_name, workflow_id, workflow_title, status, current_revision, updated_at FROM support_cases WHERE trace_id = ? LIMIT 1", [clean(traceId, 120)]);
    const row = rows[0];
    return row ? {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerName: row.owner_name,
      workflowId: row.workflow_id,
      workflowTitle: row.workflow_title,
      status: row.status,
      currentRevision: Number(row.current_revision || 0),
      updatedAt: row.updated_at,
    } : null;
  }

  async function getLatestDraft(caseId, { decrypt = false } = {}) {
    if (!isConfigured()) return null;
    const [rows] = await query("SELECT * FROM draft_revisions WHERE case_id = ? ORDER BY revision DESC LIMIT 1", [clean(caseId, 80)]);
    if (!rows.length) return null;
    const revision = rowToObject(rows[0]);
    if (decrypt) revision.snapshot = decryptJson(revision.snapshot, sensitiveDataKey);
    return revision;
  }

  async function recordAdminAction({ caseId, actorUserId, actorName = "", action, reason, idempotencyKey = "", detail = {}, status = "requested", result = {} } = {}) {
    if (!isConfigured()) throw new Error("管理员工作台未启用。");
    const idempotency = clean(idempotencyKey, 120);
    if (idempotency) {
      const [existing] = await query("SELECT id, status, result_json FROM admin_actions WHERE idempotency_key = ? LIMIT 1", [idempotency]);
      if (existing.length) {
        const error = new Error(existing[0].status === "succeeded"
          ? "该管理员代发起已经完成，系统已阻止重复创建 OA。"
          : "该管理员代发起正在处理或已失败；请先核验案件状态，不能重复发起。");
        error.statusCode = 409;
        error.adminAction = { id: existing[0].id, status: existing[0].status, result: parseJson(existing[0].result_json, {}) };
        throw error;
      }
    }
    const id = randomUUID();
    await query(`INSERT INTO admin_actions (id, case_id, actor_user_id, actor_name, action, reason, idempotency_key, status, detail_json, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`, [
      id, clean(caseId, 80), clean(actorUserId, 120), clean(actorName, 120), clean(action, 80), clean(reason, 1000), idempotency || null, clean(status, 32), stableJson(detail), stableJson(result),
    ]);
    await appendCaseEvent({ caseId, eventType: `admin_${action}`, status, actorType: "admin", actorUserId, actorName, reason, detail });
    return id;
  }

  async function updateAdminAction(id, { status, result = {} } = {}) {
    await query("UPDATE admin_actions SET status = ?, result_json = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [clean(status, 32), stableJson(result), clean(id, 80)]);
  }

  async function setCaseStatus(caseId, status, summary = null) {
    if (!isConfigured()) throw new Error("管理员工作台未启用。");
    if (summary) {
      await query("UPDATE support_cases SET status = ?, summary_json = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [clean(status, 32), stableJson(summary), clean(caseId, 80)]);
    } else {
      await query("UPDATE support_cases SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", [clean(status, 32), clean(caseId, 80)]);
    }
  }

  async function purgeExpiredCases({ batchSize = 100 } = {}) {
    if (!isConfigured()) return { purgedCases: 0, disabled: true };
    const db = await getPool();
    const limit = integer(batchSize, 100, 1, 500);
    const [expired] = await db.execute(
      "SELECT id FROM support_cases WHERE updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY) ORDER BY updated_at ASC LIMIT ?",
      [config.retainDays, limit],
    );
    const caseIds = expired.map((row) => row.id).filter(Boolean);
    if (!caseIds.length) return { purgedCases: 0, retentionDays: config.retainDays };
    const placeholders = caseIds.map(() => "?").join(", ");
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      // Only workbench tables are included.  The employee service's SQLite
      // history and every pre-existing MySQL schema remain out of scope.
      for (const table of ["admin_actions", "case_events", "client_events", "server_events", "draft_revisions", "attachment_artifacts", "support_cases"]) {
        await connection.execute(`DELETE FROM ${table} WHERE ${table === "support_cases" ? "id" : "case_id"} IN (${placeholders})`, caseIds);
      }
      await connection.commit();
      return { purgedCases: caseIds.length, retentionDays: config.retainDays };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function health() {
    if (!isConfigured()) return { enabled: false, configured: false, retentionDays: config.retainDays };
    try {
      await query("SELECT 1");
      return { enabled: true, configured: true, mysql: "ok", archiveEnabled: config.archiveEnabled, retentionDays: config.retainDays, ossBucket: config.oss.bucket || "" };
    } catch (error) {
      return { enabled: true, configured: true, mysql: "failed", error: clean(error.message, 300), archiveEnabled: config.archiveEnabled, retentionDays: config.retainDays };
    }
  }

  async function verifyArchiveAccess() {
    if (!isConfigured() || !config.archiveEnabled) return { enabled: false, archiveEnabled: false };
    const client = await getOssClient();
    const result = await client.getBucketInfo(config.oss.bucket);
    return { enabled: true, archiveEnabled: true, bucket: config.oss.bucket, location: clean(result?.location || result?.res?.headers?.["x-oss-bucket-location"] || "", 120) };
  }

  return {
    config: () => ({
      enabled: config.enabled,
      archiveEnabled: config.archiveEnabled,
      readEnabled: config.readEnabled,
      repairEnabled: config.repairEnabled,
      submitEnabled: config.submitEnabled,
      manualCreateEnabled: config.manualCreateEnabled,
      retainDays: config.retainDays,
      mysql: { ...config.mysql, password: config.mysql.password ? "[configured]" : "" },
      oss: { ...config.oss },
    }),
    isConfigured,
    health,
    verifyArchiveAccess,
    captureClientEvents,
    captureServerEvent,
    captureDraft,
    archiveAttachment,
    listCases,
    getCase,
    findCaseByTraceId,
    getLatestDraft,
    recordAdminAction,
    updateAdminAction,
    setCaseStatus,
    purgeExpiredCases,
    decryptStoredSnapshot(value) { return decryptJson(value, sensitiveDataKey); },
    async close() { if (pool) await pool.end(); },
  };
}
