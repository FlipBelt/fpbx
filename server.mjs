import { createServer } from "node:http";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import dingtalk from "@alicloud/dingtalk";
import OpenApi from "@alicloud/openapi-client";
import OcrClient, * as ocrApi from "@alicloud/ocr-api20210707";
import Util from "@alicloud/tea-util";
import Busboy from "busboy";
import yauzl from "yauzl";
import { createAdminWorkbench } from "./admin-workbench.mjs";
import { extractInvoiceLedgerSnapshot, hasLedgerInvoiceData, monthKeyFromApprovalTime, monthlyLedgerFilename, toFinanceWorkbookRow } from "./invoice-ledger.mjs";
import {
  ScheduledApprovalScheduler,
  ScheduledApprovalStore,
} from "./scheduled-approvals.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const recipientAccountsDirectory = join(root, "data");
const recipientAccountsFile = join(recipientAccountsDirectory, "recipient-accounts.json");
const relatedReferencesFile = join(recipientAccountsDirectory, "related-approval-references.json");
const relatedInstanceIndexFile = join(recipientAccountsDirectory, "related-approval-instance-index.json");
const invoiceLedgerStoreFile = join(recipientAccountsDirectory, "invoice-ledger-sync.json");
const invoiceLedgerRepairStoreFile = join(recipientAccountsDirectory, "invoice-ledger-repair-jobs.json");
const submissionHistoryFile = join(recipientAccountsDirectory, "submission-history.json");
const submissionRequestsFile = join(recipientAccountsDirectory, "submission-requests.json");
const scheduledApprovalsFile = join(recipientAccountsDirectory, "scheduled-approvals.sqlite");
const localConfig = await loadLocalConfig();
let adminWorkbench = null;
try {
  adminWorkbench = await createAdminWorkbench({ root, dataDirectory: recipientAccountsDirectory, localConfig });
  // Retention cleanup is an optional, low-priority sidecar task.  It never
  // delays startup or an employee reimbursement request.
  if (adminWorkbench?.isConfigured?.()) {
    const runWorkbenchRetention = () => void adminWorkbench.purgeExpiredCases()
      .catch((error) => console.error(`Admin workbench retention cleanup failed: ${error.message}`));
    setTimeout(runWorkbenchRetention, 30_000).unref();
    setInterval(runWorkbenchRetention, 24 * 60 * 60 * 1000).unref();
  }
} catch (error) {
  // The support workbench is strictly optional.  A configuration error must
  // never take down the employee reimbursement service during startup.
  console.error(`Admin workbench initialization skipped: ${error.message}`);
}
const port = Number(getConfig("PORT", "port") || 8793);
const host = getConfig("HOST", "host", "127.0.0.1");
const tokenCache = { value: "", expiresAt: 0 };
const sessionCache = new Map();
const sessionTtlMs = 2 * 60 * 60 * 1000;
const maxUploadFileBytes = 50 * 1024 * 1024;
let ocrClientCache = null;
let recipientAccountsWriteQueue = Promise.resolve();
let relatedReferencesWriteQueue = Promise.resolve();
let relatedInstanceIndexWriteQueue = Promise.resolve();
let invoiceLedgerWriteQueue = Promise.resolve();
let invoiceLedgerRepairWriteQueue = Promise.resolve();
let submissionHistoryWriteQueue = Promise.resolve();
let submissionRequestWriteQueue = Promise.resolve();
let scheduledApprovalStore = null;
let scheduledApprovalScheduler = null;
const dingTalkEmployeeDirectoryCache = { expiresAt: 0, users: [] };

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

// 与前端“需要付款的公司名称”清单保持同一业务口径。发票购买方必须与
// 本次选择的走账主体一致；不能通过手写任意名称绕过该规则。
const APPROVAL_COMPANY_NAMES = [
  "飞比特（宁波）国际贸易有限公司",
  "宁波飞比特体育用品有限公司", "宁波星飞贸易有限公司", "飞将体育科技（宁波）有限公司",
  "杭州飞跑体育有限公司", "杭州来跑来购体育科技有限公司", "杭州乐跑体育科技有限公司",
  "宁波逐风劲跑体育科技有限公司", "杭州飞凌跃动文化体育科技有限公司", "杭州飞比特运动有限公司",
  "杭州飞比特体育科技有限公司", "杭州环飞体育科技有限公司", "杭州京跑体育用品有限公司",
  "宁波甄质供应链管理有限公司", "杭州速然体育科技有限公司", "杭州飞书电子商务有限公司",
  "杭州径鹰体育用品有限公司", "宁波凌一供应链管理有限公司", "杭州创简品牌管理有限公司",
  "杭州飞途行远企业管理有限公司",
];

// The manual admin route is deliberately limited to approval processes already
// supported by the employee-facing form.  A caller cannot submit an arbitrary
// process code by pasting JSON into the workbench.
const ADMIN_SUPPORTED_PROCESS_CODES = new Set([
  "PROC-8249A121-DBA1-4B54-A3F8-82D2A66703A5", // 日常报销（有票）
  "PROC-04CE0467-D413-41B1-8686-10318BFA537B", // 出差差旅费报销
  "PROC-429BDF89-0899-4857-BED1-03C449C9FBC7", // 日常报销（无票）
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function loadLocalConfig() {
  try {
    const config = await readFile(join(root, "dingtalk.config.json"), "utf8");
    return JSON.parse(config);
  } catch {
    return {};
  }
}

function getConfig(envName, fileName, fallback = "") {
  return process.env[envName] || localConfig[fileName] || fallback;
}

function parseConfigList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[,，;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function getV2AccessConfig() {
  const fullReleaseValue = process.env.REIMBURSEMENT_V2_ENABLED ?? localConfig.v2Enabled ?? "false";
  return {
    fullRelease: String(fullReleaseValue).trim().toLowerCase() === "true",
    testerUserIds: parseConfigList(process.env.REIMBURSEMENT_V2_TEST_USER_IDS || localConfig.v2TestUserIds),
    experimentalUseV2Testers: String(process.env.REIMBURSEMENT_V2_EXPERIMENT_USE_V2_TESTERS || localConfig.v2ExperimentUseV2Testers || "false").trim().toLowerCase() === "true",
    experimentalUserIds: parseConfigList(process.env.REIMBURSEMENT_V2_EXPERIMENT_USER_IDS || localConfig.v2ExperimentUserIds),
    experimentalUserNames: parseConfigList(process.env.REIMBURSEMENT_V2_EXPERIMENT_USER_NAMES || localConfig.v2ExperimentUserNames),
    compactTesterUserIds: parseConfigList(process.env.REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS || localConfig.v2CompactTestUserIds),
    compactTesterUserNames: parseConfigList(process.env.REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES || localConfig.v2CompactTestUserNames),
    invoiceOnlyUserIds: parseConfigList(process.env.REIMBURSEMENT_INVOICE_ONLY_USER_IDS || localConfig.invoiceOnlyUserIds),
    invoiceOnlyUserNames: parseConfigList(process.env.REIMBURSEMENT_INVOICE_ONLY_USER_NAMES || localConfig.invoiceOnlyUserNames || "鲁新"),
  };
}

function getSocialCompanyRecognitionConfig() {
  const configured = localConfig.socialCompanyRecognition && typeof localConfig.socialCompanyRecognition === "object"
    ? localConfig.socialCompanyRecognition
    : {};
  const enabledValue = process.env.REIMBURSEMENT_SOCIAL_COMPANY_RECOGNITION_ENABLED
    ?? configured.enabled
    ?? "true";
  return {
    // This field is maintained by HR and is the only authoritative source for
    // the reimbursement payment entity.  Department membership must never be
    // used as a fallback because it can differ from social-security affiliation.
    enabled: String(enabledValue).trim().toLowerCase() === "true",
    fieldCode: String(process.env.REIMBURSEMENT_SOCIAL_COMPANY_FIELD_CODE
      || configured.fieldCode
      || "220ab1b5-f816-4d11-96c7-84eb07f9f3ba").trim(),
    fieldName: String(configured.fieldName || "主体（社保公司）").trim(),
    excludedUserIds: parseConfigList(process.env.REIMBURSEMENT_SOCIAL_COMPANY_EXCLUDED_USER_IDS || configured.excludedUserIds),
  };
}

function getOnBehalfConfig() {
  const enabledValue = process.env.REIMBURSEMENT_ON_BEHALF_ENABLED
    ?? localConfig.onBehalfEnabled
    ?? "false";
  return {
    enabled: String(enabledValue).trim().toLowerCase() === "true",
    operatorUserIds: parseConfigList(process.env.REIMBURSEMENT_ON_BEHALF_OPERATOR_USER_IDS || localConfig.onBehalfOperatorUserIds),
    rootDeptId: String(process.env.REIMBURSEMENT_DINGTALK_ROOT_DEPT_ID || localConfig.rootDeptId || "1").trim() || "1",
  };
}

function canUseOnBehalf(session) {
  const userId = String(session?.user?.userId || "");
  const config = getOnBehalfConfig();
  return Boolean(config.enabled && userId && (!config.operatorUserIds.length || config.operatorUserIds.includes(userId)));
}

function getV2UserProfile(session) {
  const user = session?.user || {};
  const config = getV2AccessConfig();
  const explicitTester = config.testerUserIds.includes(String(user.userId || ""));
  const compactUiTester = config.compactTesterUserIds.includes(String(user.userId || ""))
    || config.compactTesterUserNames.includes(String(user.name || ""));
  // The revised V2 workflow is part of the formal V2 release.  Keep the
  // legacy tester switches only for installations that have not enabled V2
  // globally; a company-wide release must never leave most users on an
  // older step order.
  const expenseEntryV3 = config.fullRelease
    || (config.experimentalUseV2Testers && explicitTester)
    || config.experimentalUserIds.includes(String(user.userId || ""))
    || config.experimentalUserNames.includes(String(user.name || ""));
  const invoiceOnly = config.invoiceOnlyUserIds.includes(String(user.userId || ""))
    || config.invoiceOnlyUserNames.includes(String(user.name || ""));
  const scheduledConfig = getScheduledApprovalConfig();
  return {
    // Full release takes priority over an old tester list, so a stale whitelist
    // can never leave part of the company on the retired workbench.
    enabled: config.fullRelease || (config.testerUserIds.length ? explicitTester : true),
    invoiceOnly,
    // 试用版只改变 V2 内的步骤编排；没有命中白名单的用户继续使用已全量发布的稳定 V2。
    expenseEntryV3,
    // Compact three-stage UI is a separately controlled usability test. It is
    // not tied to historic submissions, so a named tester can see the switch
    // before creating their first reimbursement.
    compactUiTester,
    userId: String(user.userId || ""),
    userName: String(user.name || ""),
    scheduledApprovals: {
      enabled: scheduledConfig.enabled,
      policy: "calendar-21-business-hours-v2",
      releaseWindow: "09:00-18:00 Asia/Shanghai",
      isAdmin: scheduledConfig.adminUserIds.includes(String(user.userId || "")),
    },
    onBehalf: {
      enabled: canUseOnBehalf(session),
      policy: "subject-route-v1",
    },
  };
}

function getScheduledApprovalConfig() {
  const configured = localConfig.scheduledApprovals && typeof localConfig.scheduledApprovals === "object"
    ? localConfig.scheduledApprovals
    : {};
  const readNumber = (envName, key, fallback) => {
    const value = Number(process.env[envName] ?? configured[key] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  };
  const releaseIntervalMs = Math.max(readNumber("REIMBURSEMENT_SCHEDULED_RELEASE_INTERVAL_MS", "releaseIntervalMs", 3 * 60 * 1000), 30_000);
  return {
    enabled: String(process.env.REIMBURSEMENT_SCHEDULED_APPROVALS_ENABLED ?? configured.enabled ?? "false") === "true",
    releaseIntervalMs,
    // Poll at the same cadence as releases. Manual dispatch invokes tick()
    // directly, so it does not need a faster background interval.
    intervalMs: releaseIntervalMs,
    maxAttempts: readNumber("REIMBURSEMENT_SCHEDULED_MAX_ATTEMPTS", "maxAttempts", 5),
    reconciliationDays: readNumber("REIMBURSEMENT_SCHEDULED_RECONCILIATION_DAYS", "reconciliationDays", 7),
    reconciliationMaxResults: readNumber("REIMBURSEMENT_SCHEDULED_RECONCILIATION_MAX_RESULTS", "reconciliationMaxResults", 60),
    adminUserIds: parseConfigList(process.env.REIMBURSEMENT_SCHEDULED_ADMIN_USER_IDS || configured.adminUserIds),
    trackingComponentName: String(process.env.REIMBURSEMENT_SCHEDULED_TRACKING_COMPONENT_NAME || configured.trackingComponentName || "").trim(),
    trackingComponentId: String(process.env.REIMBURSEMENT_SCHEDULED_TRACKING_COMPONENT_ID || configured.trackingComponentId || "").trim(),
  };
}

// Keep the calendar policy in the main service so a compatible, already
// running scheduled-worker module is not a deployment dependency for an
// unrelated employee-facing feature.  China has no daylight-saving changes;
// the fixed offset makes the business-day boundary explicit and testable.
function getScheduledApprovalDecision(nowValue, config = {}) {
  if (!config.enabled) return { scheduled: false, reason: "scheduled_approvals_disabled" };
  const shifted = new Date(new Date(nowValue).getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  if (day >= 21 && day <= 25) return { scheduled: false, reason: "direct_processing_window" };
  const targetYear = day <= 20 || month < 11 ? year : year + 1;
  const targetMonth = day <= 20 ? month : (month + 1) % 12;
  const scheduledAt = new Date(Date.UTC(targetYear, targetMonth, 21, 9, 0) - 8 * 60 * 60 * 1000).toISOString();
  return {
    scheduled: true,
    reason: day <= 20 ? "current_month_batch" : "next_month_batch",
    batchKey: `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`,
    scheduledAt,
  };
}

function getClientAuditConfig() {
  const configured = localConfig.clientAudit && typeof localConfig.clientAudit === "object"
    ? localConfig.clientAudit
    : {};
  return {
    // 审计是旁路能力：可立即关闭，但默认启用以保留排查链路。
    enabled: String(process.env.REIMBURSEMENT_CLIENT_AUDIT_ENABLED ?? configured.enabled ?? "true") === "true",
    maxBatch: Math.min(Math.max(Number(process.env.REIMBURSEMENT_CLIENT_AUDIT_MAX_BATCH ?? configured.maxBatch ?? 25) || 25, 1), 50),
  };
}

function getScheduledApprovalStore() {
  if (!scheduledApprovalStore) {
    const configured = localConfig.scheduledApprovals && typeof localConfig.scheduledApprovals === "object"
      ? localConfig.scheduledApprovals
      : {};
    const encryptionKey = process.env.REIMBURSEMENT_SCHEDULED_ENCRYPTION_KEY
      || configured.encryptionKey
      || getConfig("DINGTALK_APP_SECRET", "appSecret");
    scheduledApprovalStore = new ScheduledApprovalStore(scheduledApprovalsFile, { encryptionKey });
  }
  return scheduledApprovalStore;
}

function requireScheduledAdmin(session) {
  if (!session?.user?.userId) {
    const error = new Error("Missing or expired DingTalk session.");
    error.statusCode = 401;
    throw error;
  }
  const config = getScheduledApprovalConfig();
  if (!config.adminUserIds.includes(String(session.user.userId))) {
    const error = new Error("当前用户没有定时发送管理权限。");
    error.statusCode = 403;
    throw error;
  }
  return session;
}

function recordApplicationAuditEvent({ session = null, ...event } = {}) {
  try {
    const normalized = {
      ...event,
      ownerUserId: event.ownerUserId || String(session?.user?.userId || ""),
      ownerName: event.ownerName || String(session?.user?.name || ""),
    };
    getScheduledApprovalStore().addAuditEvent(normalized);
    // MySQL is a diagnostics sidecar.  Do not await it and do not allow it to
    // affect uploads, OCR, approvals, or the existing SQLite audit trail.
    void adminWorkbench?.captureServerEvent(normalized)
      .catch((error) => console.error(`Admin workbench server event write failed: ${error.message}`));
  } catch (error) {
    console.error(`Application audit write failed: ${error.message}`);
  }
}

function sanitizeClientAuditAttachment(value = {}) {
  return {
    fileId: cleanSubmissionText(value.fileId, "").slice(0, 160),
    fileName: cleanSubmissionText(value.fileName || value.name, "").slice(0, 160),
    kind: cleanSubmissionText(value.kind, "").slice(0, 32),
    documentRole: cleanSubmissionText(value.documentRole, "").slice(0, 64),
    ocrAmount: formatMoney(value.ocrAmount || value.amount),
    targetRowId: cleanSubmissionText(value.targetRowId, "").slice(0, 120),
    duplicate: Boolean(value.duplicate),
    attached: Boolean(value.attached),
  };
}

function sanitizeClientAuditSummary(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const attachment = source.attachment && typeof source.attachment === "object"
    ? sanitizeClientAuditAttachment(source.attachment)
    : null;
  const attachments = Array.isArray(source.attachments)
    ? source.attachments.slice(0, 30).map(sanitizeClientAuditAttachment)
    : [];
  // Deliberately whitelist fields.  Browser audit must never copy recipient
  // accounts, session tokens, OCR raw text or file contents to this store.
  return {
    action: cleanSubmissionText(source.action, "").slice(0, 80),
    step: cleanSubmissionText(source.step, "").slice(0, 40),
    rowId: cleanSubmissionText(source.rowId, "").slice(0, 120),
    targetRowId: cleanSubmissionText(source.targetRowId, "").slice(0, 120),
    reasonCode: cleanSubmissionText(source.reasonCode, "").slice(0, 80),
    message: cleanSubmissionText(source.message, "").slice(0, 300),
    amount: formatMoney(source.amount),
    rowCount: Math.max(0, Math.min(Number(source.rowCount) || 0, 200)),
    paymentCount: Math.max(0, Math.min(Number(source.paymentCount) || 0, 200)),
    invoiceCount: Math.max(0, Math.min(Number(source.invoiceCount) || 0, 200)),
    attachment,
    attachments,
  };
}

function normalizeClientAuditEvents(body = {}, session) {
  const config = getClientAuditConfig();
  const input = Array.isArray(body.events) ? body.events.slice(0, config.maxBatch) : [];
  return input.map((event, index) => {
    const source = event && typeof event === "object" ? event : {};
    const id = cleanSubmissionText(source.id, "").slice(0, 120);
    const traceId = cleanSubmissionText(source.traceId, "").slice(0, 120);
    if (!id || !traceId) return null;
    return {
      id,
      traceId,
      draftId: cleanSubmissionText(source.draftId, "").slice(0, 120),
      sequence: Math.max(0, Math.min(Number(source.sequence) || index + 1, 10_000_000)),
      ownerUserId: String(session.user.userId || ""),
      ownerName: cleanSubmissionText(session.user.name, "").slice(0, 120),
      eventType: cleanSubmissionText(source.eventType, "client_event").slice(0, 80),
      status: ["info", "success", "warning", "failed"].includes(source.status) ? source.status : "info",
      workflowId: cleanSubmissionText(source.workflowId, "").slice(0, 80),
      workflowTitle: cleanSubmissionText(source.workflowTitle, "").slice(0, 120),
      clientAt: cleanSubmissionText(source.clientAt, "").slice(0, 40),
      serverAt: new Date().toISOString(),
      appVersion: cleanSubmissionText(source.appVersion, "").slice(0, 80),
      summary: sanitizeClientAuditSummary(source.summary),
    };
  }).filter(Boolean);
}

function maskAdminUserId(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? `${text.slice(0, 2)}***` : "";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function getInvoiceLedgerConfig() {
  const configured = localConfig.invoiceLedger && typeof localConfig.invoiceLedger === "object"
    ? localConfig.invoiceLedger
    : {};
  const requestedMode = String(process.env.DINGTALK_INVOICE_LEDGER_MODE || configured.mode || "sync").toLowerCase();
  return {
    enabled: String(process.env.DINGTALK_INVOICE_LEDGER_ENABLED ?? configured.enabled ?? "false") === "true",
    // Audit mode intentionally runs the complete evidence/OCR/dedup pipeline
    // but never opens, creates, or updates a DingTalk workbook.  It is the
    // mandatory safety mode for parser regression and staged rollout.
    mode: requestedMode === "audit" ? "audit" : "sync",
    folderDentryUuid: String(process.env.DINGTALK_INVOICE_LEDGER_FOLDER_DENTRY_UUID || configured.folderDentryUuid || ""),
    templateDentryUuid: String(process.env.DINGTALK_INVOICE_LEDGER_TEMPLATE_DENTRY_UUID || configured.templateDentryUuid || ""),
    templateWorkbookId: String(process.env.DINGTALK_INVOICE_LEDGER_TEMPLATE_WORKBOOK_ID || configured.templateWorkbookId || ""),
    templatePeriod: String(process.env.DINGTALK_INVOICE_LEDGER_TEMPLATE_PERIOD || configured.templatePeriod || "2026-05"),
    templateFileName: String(process.env.DINGTALK_INVOICE_LEDGER_TEMPLATE_FILE_NAME || configured.templateFileName || "2026年-05月取得发票-速然"),
    operatorUserId: String(process.env.DINGTALK_INVOICE_LEDGER_OPERATOR_USER_ID || configured.operatorUserId || ""),
    fileSuffix: String(process.env.DINGTALK_INVOICE_LEDGER_FILE_SUFFIX || configured.fileSuffix || "速然"),
  };
}

async function readSubmissionHistoryStore() {
  try {
    const parsed = JSON.parse(await readFile(submissionHistoryFile, "utf8"));
    return { version: 1, entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, entries: [] };
    throw new Error("Unable to read submission history store.");
  }
}

async function writeSubmissionHistoryStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${submissionHistoryFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, submissionHistoryFile);
}

async function readSubmissionRequestStore() {
  try {
    const parsed = JSON.parse(await readFile(submissionRequestsFile, "utf8"));
    return { version: 1, entries: Array.isArray(parsed?.entries) ? parsed.entries : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, entries: [] };
    throw new Error("Unable to read submission request store.");
  }
}

async function writeSubmissionRequestStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${submissionRequestsFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, submissionRequestsFile);
}

function runSubmissionRequestMutation(mutator) {
  const task = submissionRequestWriteQueue.then(async () => {
    const store = await readSubmissionRequestStore();
    const result = await mutator(store);
    await writeSubmissionRequestStore(store);
    return result;
  });
  submissionRequestWriteQueue = task.catch(() => {});
  return task;
}

function runSubmissionHistoryMutation(mutator) {
  const task = submissionHistoryWriteQueue.then(async () => {
    const store = await readSubmissionHistoryStore();
    const result = await mutator(store);
    await writeSubmissionHistoryStore(store);
    return result;
  });
  submissionHistoryWriteQueue = task.catch(() => {});
  return task;
}

function cleanSubmissionText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 240);
}

const submissionRequestMaxAgeMs = 24 * 60 * 60 * 1000;
const submissionReplayWindowMs = 15 * 60 * 1000;
const submissionPendingWindowMs = 5 * 60 * 1000;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function getSubmissionRequestId(draft) {
  const id = String(draft?.submission_id || "").trim();
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(id)) {
    const error = new Error("提交标识无效，请刷新页面后重新提交。");
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function getSubmissionFingerprint(draft) {
  const payload = {
    processCode: String(draft?.process_code || ""),
    relatedSourceProcessCode: String(draft?.related_source_process_code || ""),
    formComponentValues: Array.isArray(draft?.form_component_values) ? draft.form_component_values : [],
    evidenceManifest: Array.isArray(draft?.evidence_manifest) ? draft.evidence_manifest : [],
    noInvoice: Boolean(draft?.no_invoice),
    invoiceOnly: Boolean(draft?.invoice_only),
    remark: String(draft?.remark || ""),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function isRecentSubmission(entry, now, windowMs) {
  const updatedAt = Date.parse(entry?.updatedAt || entry?.createdAt || "");
  return Number.isFinite(updatedAt) && now - updatedAt <= windowMs;
}

async function reserveSubmissionRequest(session, draft) {
  if (!session?.user?.userId) {
    const error = new Error("当前钉钉登录会话已失效，请从钉钉工作台重新打开本应用后再提交。");
    error.statusCode = 401;
    throw error;
  }
  const id = getSubmissionRequestId(draft);
  const ownerUserId = String(session.user.userId);
  const fingerprint = getSubmissionFingerprint(draft);
  const processCode = String(draft?.process_code || "");

  return runSubmissionRequestMutation((store) => {
    const now = Date.now();
    store.entries = store.entries.filter((entry) => isRecentSubmission(entry, now, submissionRequestMaxAgeMs));
    const sameId = store.entries.find((entry) => entry.id === id && entry.ownerUserId === ownerUserId);
    if (sameId) {
      // 只有系统已接受该报销（已进定时池或已经取得 OA 实例）才永久锁定。
      // 校验/会话/钉钉发起失败后的草稿必须允许用户修正附件或明细后原地重试。
      if (sameId.status === "success" && sameId.fingerprint !== fingerprint) {
        const error = new Error("该报销页面已对应另一笔提交，请刷新页面后重新填写或新建报销。");
        error.statusCode = 409;
        throw error;
      }
      if (sameId.status === "success") return { action: "replay", entry: sameId };
      if (sameId.status === "pending" && isRecentSubmission(sameId, now, submissionPendingWindowMs)) {
        if (sameId.fingerprint !== fingerprint) {
          const error = new Error("这笔报销正在发起中，请勿在发起完成前修改或重复提交。请稍候查看提交记录确认结果。");
          error.statusCode = 409;
          throw error;
        }
        return { action: "pending", entry: sameId };
      }
      // failed、cancelled，及超出短暂处理窗口的 pending 都没有创建可复用的
      // OA/定时池锁；用最新草稿内容重置为一次新的待处理请求。
      sameId.fingerprint = fingerprint;
      sameId.processCode = processCode;
      sameId.status = "pending";
      sameId.processInstanceId = "";
      sameId.resultType = "";
      sameId.scheduledJobId = "";
      sameId.scheduledAt = "";
      sameId.trackingCode = "";
      sameId.failureReason = "";
      sameId.updatedAt = new Date(now).toISOString();
      return { action: "create", entry: sameId };
    }

    const sameContent = store.entries.find((entry) => entry.ownerUserId === ownerUserId
      && entry.fingerprint === fingerprint
      && ((entry.status === "success" && isRecentSubmission(entry, now, submissionReplayWindowMs))
        || (entry.status === "pending" && isRecentSubmission(entry, now, submissionPendingWindowMs))));
    if (sameContent) return { action: sameContent.status === "success" ? "replay" : "pending", entry: sameContent };

    const entry = {
      id,
      ownerUserId,
      fingerprint,
      processCode,
      status: "pending",
      processInstanceId: "",
      failureReason: "",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    store.entries.push(entry);
    return { action: "create", entry };
  });
}

async function settleSubmissionRequest(reservation, status, options = {}) {
  const entry = reservation?.entry;
  if (!entry?.id || !entry?.ownerUserId) return;
  await runSubmissionRequestMutation((store) => {
    const target = store.entries.find((item) => item.id === entry.id
      && item.ownerUserId === entry.ownerUserId
      && item.fingerprint === entry.fingerprint);
    if (!target) return;
    target.status = status;
    target.processInstanceId = String(options.processInstanceId || "");
    target.resultType = String(options.resultType || (options.processInstanceId ? "approval" : target.resultType || ""));
    target.scheduledJobId = String(options.scheduledJobId || target.scheduledJobId || "");
    target.scheduledAt = String(options.scheduledAt || target.scheduledAt || "");
    target.trackingCode = String(options.trackingCode || target.trackingCode || "");
    target.failureReason = cleanSubmissionText(options.failureReason || "", "");
    target.updatedAt = new Date().toISOString();
  });
}

function describeDingTalkApprovalFailure(error, processCode = "") {
  const raw = String(error?.message || error || "");
  const details = String(error?.data ? JSON.stringify(error.data) : "");
  const combined = `${raw} ${details}`;
  if (/processGetFailed|获取审批流失败|审批单状态为非启用状态|非启用状态/i.test(combined)) {
    return {
      code: "process_not_enabled",
      reason: "钉钉审批流程当前未启用，或该流程编号已失效。",
      advice: "请由钉钉 OA 管理员进入“审批管理”，启用“出差差旅费报销”流程，并核对应用配置的流程编号后重试。",
      processCode: String(processCode || ""),
    };
  }
  if (/session expired|会话.*失效|401|免登/i.test(combined)) {
    return {
      code: "session_expired",
      reason: "当前钉钉登录会话已失效。",
      advice: "请从钉钉工作台重新打开本应用，完成免登后再次提交。",
    };
  }
  if (/form.*format|form_component|组件格式|表单组件|invalidParameter/i.test(combined)) {
    return {
      code: "form_configuration",
      reason: "审批表单字段与当前应用提交内容不匹配。",
      advice: "请联系系统管理员核对钉钉审批表单中的字段、明细表和关联审批组件配置。",
    };
  }
  if (/权限|permission|forbidden|403/i.test(combined)) {
    return {
      code: "permission_denied",
      reason: "当前应用或当前用户缺少发起该审批的权限。",
      advice: "请联系钉钉 OA 管理员检查应用权限、可见范围和审批发起人权限。",
    };
  }
  return {
    code: "dingtalk_request_failed",
    reason: "钉钉审批未能创建。",
    advice: "请检查必填信息、关联审批和附件后重试；若仍失败，请联系系统管理员并提供提交记录中的失败时间。",
  };
}

function describeSubmissionFailure(error, processCode = "") {
  if (error?.approvalFailure) return error.approvalFailure;
  const raw = String(error?.message || error || "");
  if (/DingTalk|processGetFailed|审批流|审批单状态|form.*format|form_component/i.test(raw)) {
    return describeDingTalkApprovalFailure(error, processCode);
  }
  if (/session expired|会话.*失效|401|免登/i.test(raw)) return describeDingTalkApprovalFailure(error, processCode);
  return {
    code: "submission_validation",
    reason: cleanSubmissionText(raw, "提交前校验未通过。"),
    advice: "请按提示修正本次报销信息后再次提交。",
  };
}

function getSubmissionWorkflowContext(draft = {}) {
  const context = draft.submission_context && typeof draft.submission_context === "object" ? draft.submission_context : {};
  return {
    workflowId: cleanSubmissionText(context.workflowId, "unknown"),
    workflowTitle: cleanSubmissionText(context.workflowTitle, "报销申请"),
  };
}

function captureAdminWorkbenchDraft({ session, draft, source = "submission", reason = "" } = {}) {
  if (!session?.user?.userId || !draft) return;
  const workflow = getSubmissionWorkflowContext(draft);
  const context = draft.submission_context && typeof draft.submission_context === "object" ? draft.submission_context : {};
  const traceId = cleanSubmissionText(context.traceId || `submission:${draft.submission_id || randomUUID()}`, 120);
  void adminWorkbench?.captureDraft({
    traceId,
    draftId: cleanSubmissionText(draft.submission_id, 120),
    ownerUserId: String(session.user.userId),
    ownerName: String(session.user.name || ""),
    ownerDepartments: Array.isArray(session.user.departments) ? session.user.departments : [],
    workflowId: workflow.workflowId,
    workflowTitle: workflow.workflowTitle,
    draft,
    source,
    reason,
  }).catch((error) => console.error(`Admin workbench draft capture failed: ${error.message}`));
}

function requireAdminWorkbench(session, capability = "read") {
  const admin = requireScheduledAdmin(session);
  if (!adminWorkbench?.isConfigured?.()) {
    const error = new Error("管理员工作台尚未启用或数据库未连接。");
    error.statusCode = 503;
    throw error;
  }
  const config = adminWorkbench.config?.() || {};
  const enabled = capability === "read" ? config.readEnabled
    : capability === "repair" ? config.repairEnabled
      : capability === "submit" ? config.submitEnabled
        : capability === "manual_create" ? config.manualCreateEnabled
        : false;
  if (!enabled) {
    const error = new Error("该管理员功能当前处于安全关闭状态。");
    error.statusCode = 403;
    throw error;
  }
  return admin;
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function createSupportSession(snapshot) {
  const support = snapshot?.support || {};
  const userId = String(support.ownerUserId || "");
  if (!userId) throw new Error("该案件缺少原申请人身份，无法代修复或代发起。");
  const departments = Array.isArray(support.departments) ? support.departments
    .map((item) => ({ id: String(item?.id || ""), name: String(item?.name || "") }))
    .filter((item) => item.id)
    : [];
  return {
    user: {
      userId,
      name: String(support.ownerName || ""),
      unionId: String(support.ownerUnionId || ""),
      departments,
      socialCompanyRecognition: support.socialCompanyRecognition || null,
    },
    // Only snapshots explicitly created by the server's manual-admin endpoint
    // can set this bit.  It is not inferred from a browser-provided route mode.
    adminContext: support.adminOriginator ? {
      enabled: true,
      subjectUserId: userId,
      operatorUserId: String(support.operatorUserId || ""),
      operatorName: String(support.operatorName || ""),
    } : null,
    // Signed evidence tokens in a modern manifest are verified independently.
    // An empty map intentionally prevents an administrator from borrowing an
    // unrelated employee's transient upload-session memory.
    evidenceByFileId: new Map(),
  };
}

function createAdminOriginatorSession(snapshot) {
  const session = createSupportSession(snapshot);
  if (!session.adminContext?.enabled) {
    const error = new Error("该案件不是管理员新建的代发案件，不能使用管理员身份路由。");
    error.statusCode = 409;
    throw error;
  }
  return session;
}

function applyAdminRepairPatch(draft, patch) {
  const allowed = new Set([
    "form_component_values", "remark", "dept_id", "evidence_manifest", "attachment_row_bindings",
    "evidence_processing_tokens", "no_invoice", "invoice_only", "related_source_process_code", "related_component_names",
  ]);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("修复内容格式无效。");
  const next = cloneJsonValue(draft);
  Object.entries(patch).forEach(([key, value]) => {
    if (!allowed.has(key)) throw new Error(`不允许通过管理员修复修改“${key}”。`);
    next[key] = cloneJsonValue(value);
  });
  // A repair is always a new operation.  Keep the original process and target
  // identity immutable, and let the normal backend evidence rules revalidate.
  delete next.originator_user_id;
  delete next.session_token;
  return next;
}

async function getAdminCaseSnapshot(caseId) {
  const revision = await adminWorkbench?.getLatestDraft(caseId, { decrypt: true });
  if (!revision?.snapshot?.draft) {
    const error = new Error("该案件尚未保存可修复的服务端草稿；请让员工重新进入报销页面并提交一次预检。");
    error.statusCode = 409;
    throw error;
  }
  return revision;
}

function validateAdminManualDraftEnvelope(draft = {}) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    const error = new Error("管理员代发草稿必须是 JSON 对象。");
    error.statusCode = 400;
    throw error;
  }
  const processCode = String(draft.process_code || getConfig("DINGTALK_PROCESS_CODE", "processCode", "")).trim();
  if (!ADMIN_SUPPORTED_PROCESS_CODES.has(processCode)
    && processCode !== String(getConfig("DINGTALK_PROCESS_CODE", "processCode", "")).trim()) {
    const error = new Error("管理员代发暂不支持该审批流程，只允许日常、有票/无票和差旅报销流程。");
    error.statusCode = 422;
    throw error;
  }
  if (!Array.isArray(draft.form_component_values)) {
    const error = new Error("管理员代发草稿缺少 form_component_values 表单内容。");
    error.statusCode = 422;
    throw error;
  }
  const serialized = JSON.stringify(draft);
  if (serialized.length > 2_000_000) {
    const error = new Error("管理员代发草稿过大，请删除无关字段后再保存。");
    error.statusCode = 413;
    throw error;
  }
  return processCode;
}

function buildAdminManualDraft({ draft, target, departmentId = "", workflowId = "", workflowTitle = "", traceId = "" } = {}) {
  const next = cloneJsonValue(draft);
  const selectedDepartment = target.departments.find((item) => String(item.id) === String(departmentId))
    || (target.departments.length === 1 ? target.departments[0] : null);
  if (!selectedDepartment) {
    const error = new Error(target.departments.length
      ? "该员工有多个钉钉部门，请明确传入 department_id。"
      : "未读取到该员工的钉钉部门，无法建立审批路由。");
    error.statusCode = 422;
    throw error;
  }
  const selectedCompany = getApprovalPaymentCompanyName(next);
  const recognition = target.socialCompanyRecognition || {};
  if (recognition.status === "verified" && !selectedCompany) {
    next.form_component_values = [
      ...next.form_component_values,
      { name: "需要付款的公司名称", value: JSON.stringify([recognition.companyName]) },
    ];
  }
  const processCode = String(next.process_code || getConfig("DINGTALK_PROCESS_CODE", "processCode", "")).trim();
  next.process_code = processCode;
  next.dept_id = String(selectedDepartment.id);
  next.submission_id = String(next.submission_id || `admin_${randomUUID().replaceAll("-", "")}`);
  next.session_token = "";
  delete next.originator_user_id;
  next.submission_route = {
    mode: "admin_originator",
    subjectUserId: String(target.userId),
    departmentId: String(selectedDepartment.id),
    departmentName: String(selectedDepartment.name || selectedDepartment.id),
    companyName: selectedCompany || String(recognition.companyName || ""),
  };
  next.submission_context = {
    ...(next.submission_context && typeof next.submission_context === "object" ? next.submission_context : {}),
    traceId,
    workflowId: String(workflowId || next.submission_context?.workflowId || "admin_manual"),
    workflowTitle: String(workflowTitle || next.submission_context?.workflowTitle || "管理员代发报销"),
  };
  return { draft: next, selectedDepartment };
}

function sanitizeSubmissionSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows.slice(0, 200).map((row, index) => ({
    index: index + 1,
    date: cleanSubmissionText(row?.date),
    reason: cleanSubmissionText(row?.reason),
    amount: cleanSubmissionText(row?.amount),
    project: cleanSubmissionText(row?.project),
    expenseType: cleanSubmissionText(row?.expenseType),
    invoiceType: cleanSubmissionText(row?.invoiceType),
    relatedBusinessId: cleanSubmissionText(row?.relatedBusinessId),
    paymentAttachments: parseConfigList(row?.paymentAttachments).slice(0, 50).map((item) => cleanSubmissionText(item)),
    invoiceAttachments: parseConfigList(row?.invoiceAttachments).slice(0, 50).map((item) => cleanSubmissionText(item)),
  })) : [];
  return {
    totalAmount: cleanSubmissionText(snapshot.totalAmount),
    companyName: cleanSubmissionText(snapshot.companyName),
    departmentName: cleanSubmissionText(snapshot.departmentName),
    recipientAccountMasked: cleanSubmissionText(snapshot.recipientAccountMasked),
    relatedApprovals: Array.isArray(snapshot.relatedApprovals)
      ? snapshot.relatedApprovals.slice(0, 50).map((item) => cleanSubmissionText(item))
      : [],
    paymentCount: Math.max(0, Number(snapshot.paymentCount) || 0),
    invoiceCount: Math.max(0, Number(snapshot.invoiceCount) || 0),
    warningSummary: cleanSubmissionText(snapshot.warningSummary),
    rows,
  };
}

async function recordSubmissionHistory({ session, draft, status, processInstanceId = "", failure = null, scheduledJobId = "", scheduledAt = "" }) {
  if (!session?.user?.userId) return;
  const workflow = getSubmissionWorkflowContext(draft);
  const entry = {
    id: randomUUID(),
    ownerUserId: String(session.user.userId),
    ownerName: cleanSubmissionText(session.user.name),
    createdAt: new Date().toISOString(),
    status: ["success", "scheduled"].includes(status) ? status : "failed",
    workflowId: workflow.workflowId,
    workflowTitle: workflow.workflowTitle,
    processCode: cleanSubmissionText(draft.process_code),
    processInstanceId: cleanSubmissionText(processInstanceId),
    scheduledJobId: cleanSubmissionText(scheduledJobId),
    scheduledAt: cleanSubmissionText(scheduledAt),
    reasonCode: cleanSubmissionText(failure?.code),
    reason: cleanSubmissionText(failure?.reason),
    advice: cleanSubmissionText(failure?.advice),
    snapshot: ["success", "scheduled"].includes(status) ? sanitizeSubmissionSnapshot(draft?.submission_context?.snapshot) : null,
  };
  await runSubmissionHistoryMutation((store) => {
    store.entries.unshift(entry);
    store.entries = store.entries.slice(0, 1000);
    return entry;
  });
  recordApplicationAuditEvent({
    id: `submission:${entry.id}`,
    session,
    eventType: "submission",
    status: entry.status,
    workflowId: entry.workflowId,
    workflowTitle: entry.workflowTitle,
    summary: {
      totalAmount: entry.snapshot?.totalAmount || "",
      paymentCount: entry.snapshot?.paymentCount || 0,
      invoiceCount: entry.snapshot?.invoiceCount || 0,
      scheduledJobId: entry.scheduledJobId,
      processInstanceId: entry.processInstanceId,
    },
    reasonCode: entry.reasonCode,
    reason: entry.reason,
    createdAt: entry.createdAt,
  });
}

async function updateScheduledSubmissionHistory(job, { status, processInstanceId = "", failure = null } = {}) {
  if (!job?.id) return;
  await runSubmissionHistoryMutation((store) => {
    const entry = store.entries.find((item) => item.scheduledJobId === job.id);
    if (!entry) return;
    entry.status = status;
    entry.processInstanceId = cleanSubmissionText(processInstanceId || entry.processInstanceId);
    entry.reasonCode = cleanSubmissionText(failure?.code);
    entry.reason = cleanSubmissionText(failure?.reason);
    entry.advice = cleanSubmissionText(failure?.advice);
    entry.updatedAt = new Date().toISOString();
  });
}

async function listSubmissionHistory(session, limit = 50) {
  if (!session?.user?.userId) {
    const error = new Error("Missing or expired DingTalk session.");
    error.statusCode = 401;
    throw error;
  }
  const store = await readSubmissionHistoryStore();
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const entries = store.entries
      .filter((entry) => entry.ownerUserId === String(session.user.userId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, boundedLimit);
  if (scheduledApprovalStore || getScheduledApprovalConfig().enabled) {
    const jobs = new Map(getScheduledApprovalStore().listForUser(String(session.user.userId), 200).map((job) => [job.id, job]));
    entries.forEach((entry) => {
      const job = jobs.get(entry.scheduledJobId);
      entry.amount = job?.amount || entry.snapshot?.totalAmount || entry.amount || "";
      if (!job) return;
      entry.status = job.status;
      entry.scheduledAt = job.scheduledAt;
      entry.processInstanceId = job.processInstanceId;
      entry.reasonCode = job.failureCode;
      entry.reason = job.failureReason;
      entry.advice = job.failureAdvice;
      entry.updatedAt = job.updatedAt;
    });
  } else {
    entries.forEach((entry) => { entry.amount = entry.snapshot?.totalAmount || entry.amount || ""; });
  }
  return {
    entries,
  };
}

async function buildOperationsDashboard() {
  const store = getScheduledApprovalStore();
  const historyStore = await readSubmissionHistoryStore();
  const scheduled = store.listAdmin({ limit: 500 });
  const jobsById = new Map(scheduled.map((job) => [job.id, job]));
  const sessionNames = new Map([...sessionCache.values()].map((item) => [String(item?.user?.userId || ""), String(item?.user?.name || "")]));
  const submissions = (historyStore.entries || [])
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 500)
    .map((entry) => {
      const job = jobsById.get(entry.scheduledJobId);
      return {
        id: entry.id,
        ownerName: entry.ownerName || sessionNames.get(String(entry.ownerUserId || "")) || "",
        ownerUserId: maskAdminUserId(entry.ownerUserId),
        workflowId: entry.workflowId,
        workflowTitle: entry.workflowTitle,
        status: job?.status || entry.status,
        processInstanceId: job?.processInstanceId || entry.processInstanceId || "",
        scheduledJobId: entry.scheduledJobId || "",
        scheduledAt: job?.scheduledAt || entry.scheduledAt || "",
        reasonCode: job?.failureCode || entry.reasonCode || "",
        reason: job?.failureReason || entry.reason || "",
        advice: job?.failureAdvice || entry.advice || "",
        snapshot: entry.snapshot || null,
        createdAt: entry.createdAt,
        updatedAt: job?.updatedAt || entry.updatedAt || entry.createdAt,
      };
    });
  const audits = store.listAuditEvents({ limit: 500 });
  const clientAudit = store.listClientAuditEvents({ limit: 500 }).map((event) => ({
    ...event,
    ownerUserId: maskAdminUserId(event.ownerUserId),
  }));
  const uploads = audits.filter((event) => event.eventType === "upload").map((event) => ({
    ...event,
    ownerUserId: maskAdminUserId(event.ownerUserId),
  }));
  const errors = [
    ...audits.filter((event) => event.status === "failed" && event.eventType !== "submission").map((event) => ({
      id: event.id,
      source: event.eventType === "upload" ? "附件上传" : "系统记录",
      ownerName: event.ownerName,
      ownerUserId: maskAdminUserId(event.ownerUserId),
      workflowTitle: event.workflowTitle,
      reasonCode: event.reasonCode,
      reason: event.reason,
      createdAt: event.createdAt,
    })),
    ...submissions.filter((entry) => entry.status === "failed").map((entry) => ({
      id: `submission:${entry.id}`,
      source: "报销提交",
      ownerName: entry.ownerName,
      ownerUserId: entry.ownerUserId,
      workflowTitle: entry.workflowTitle,
      reasonCode: entry.reasonCode,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
    ...scheduled.filter((job) => ["retry", "unknown", "manual"].includes(job.status)).map((job) => ({
      id: `scheduled:${job.id}`,
      source: "定时发起",
      ownerName: job.ownerName,
      ownerUserId: maskAdminUserId(job.ownerUserId),
      workflowTitle: job.workflowTitle,
      reasonCode: job.failureCode,
      reason: job.failureReason,
      createdAt: job.updatedAt,
    })),
  ].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, 500);
  const successfulSubmissions = submissions.filter((entry) => ["success", "succeeded"].includes(entry.status)).length;
  const failedSubmissions = submissions.filter((entry) => entry.status === "failed").length;
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      queued: scheduled.filter((job) => ["scheduled", "retry", "dispatching"].includes(job.status)).length,
      scheduledSucceeded: scheduled.filter((job) => job.status === "succeeded").length,
      submissions: submissions.length,
      successfulSubmissions,
      failedSubmissions,
      uploads: uploads.length,
      uploadFailures: uploads.filter((event) => event.status === "failed").length,
      clientAuditEvents: clientAudit.length,
      errors: errors.length,
    },
    runtime: store.runtime(),
    scheduled: scheduled.map((job) => ({ ...job, ownerUserId: maskAdminUserId(job.ownerUserId) })),
    submissions,
    uploads,
    clientAudit,
    clientAuditStats: store.clientAuditStats(),
    errors,
  };
}

async function readInvoiceLedgerStore() {
  try {
    const parsed = JSON.parse(await readFile(invoiceLedgerStoreFile, "utf8"));
    return {
      version: 1,
      months: parsed?.months && typeof parsed.months === "object" ? parsed.months : {},
      events: Array.isArray(parsed?.events) ? parsed.events : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, months: {}, events: [] };
    throw error;
  }
}

async function writeInvoiceLedgerStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${invoiceLedgerStoreFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, invoiceLedgerStoreFile);
}

function runInvoiceLedgerMutation(mutator) {
  const task = invoiceLedgerWriteQueue.then(async () => {
    const store = await readInvoiceLedgerStore();
    const result = await mutator(store);
    await writeInvoiceLedgerStore(store);
    return result;
  });
  invoiceLedgerWriteQueue = task.catch(() => {});
  return task;
}

async function readInvoiceLedgerRepairStore() {
  try {
    const parsed = JSON.parse(await readFile(invoiceLedgerRepairStoreFile, "utf8"));
    return { version: 1, jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, jobs: [] };
    throw error;
  }
}

async function writeInvoiceLedgerRepairStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${invoiceLedgerRepairStoreFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, invoiceLedgerRepairStoreFile);
}

function runInvoiceLedgerRepairMutation(mutator) {
  const task = invoiceLedgerRepairWriteQueue.then(async () => {
    const store = await readInvoiceLedgerRepairStore();
    const result = await mutator(store);
    await writeInvoiceLedgerRepairStore(store);
    return result;
  });
  invoiceLedgerRepairWriteQueue = task.catch(() => {});
  return task;
}

function requireAdminToken(request) {
  const configured = getConfig("ADMIN_DEBUG_TOKEN", "adminDebugToken");
  if (!configured) throw new Error("Admin debug endpoint is not configured.");
  const provided = request.headers["x-debug-token"] || new URL(request.url, `http://${request.headers.host}`).searchParams.get("debug_token");
  if (provided !== configured) throw new Error("Invalid admin debug token.");
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function countCjk(text) {
  return (String(text || "").match(/[\u3400-\u9fff]/g) || []).length;
}

function normalizeUploadedFilename(filename) {
  const fallback = "attachment";
  const raw = String(filename || fallback).replace(/[\\/]/g, "_").trim() || fallback;
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  const looksMojibake = /[ÃÂÅÆÇÈÉåæçèéäö]/.test(raw);

  if (!decoded.includes("\uFFFD") && (countCjk(decoded) > countCjk(raw) || looksMojibake)) {
    return decoded.replace(/[\\/]/g, "_").trim() || raw;
  }

  return raw;
}

function parseMultipartRequest(request) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};
    const writes = [];
    const busboy = Busboy({
      headers: request.headers,
      defParamCharset: "utf8",
      limits: { fileSize: maxUploadFileBytes, files: 20 },
    });

    busboy.on("field", (name, value) => {
      fields[name] = [...(fields[name] || []), value];
    });

    busboy.on("file", (name, stream, info) => {
      const filename = normalizeUploadedFilename(info.filename);
      const tempPath = join(tmpdir(), `reimbursement-${randomUUID()}${extname(filename)}`);
      const writeStream = createWriteStream(tempPath);
      const fileRecord = {
        path: tempPath,
        originalFilename: filename,
        name: filename,
        mimetype: info.mimeType || "",
        size: 0,
      };
      files[name] = [...(files[name] || []), fileRecord];

      stream.on("data", (chunk) => {
        fileRecord.size += chunk.length;
      });
      stream.on("limit", () => {
        stream.unpipe(writeStream);
        writeStream.destroy(new Error("Upload file exceeds 50MB limit."));
      });

      stream.pipe(writeStream);
      writes.push(new Promise((fileResolve, fileReject) => {
        writeStream.on("finish", fileResolve);
        writeStream.on("error", fileReject);
        stream.on("error", fileReject);
      }));
    });

    busboy.on("error", reject);
    busboy.on("finish", async () => {
      try {
        await Promise.all(writes);
        resolve({ fields, files });
      } catch (error) {
        reject(error);
      }
    });

    request.pipe(busboy);
  });
}

function firstField(fields, name) {
  return Array.isArray(fields?.[name]) ? fields[name][0] : "";
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function readZipEntryBuffer(zip, entry, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > maxBytes) {
      reject(new Error(`Excel 文件中的 ${entry.fileName} 过大，无法安全导入。`));
      return;
    }
    zip.openReadStream(entry, (streamError, stream) => {
      if (streamError) return reject(streamError);
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy(new Error(`Excel 文件中的 ${entry.fileName} 过大，无法安全导入。`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function readZipEntry(zip, entry, maxBytes = 8 * 1024 * 1024) {
  return (await readZipEntryBuffer(zip, entry, maxBytes)).toString("utf8");
}

async function readXlsxXmlEntries(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (openError, zip) => {
      if (openError) return reject(new Error("无法读取 Excel 文件，请确认文件没有损坏。"));
      const entries = new Map();
      let totalXmlSize = 0;
      const maxTotalXmlBytes = 16 * 1024 * 1024;
      const wanted = (name) => name === "xl/workbook.xml"
        || name === "xl/_rels/workbook.xml.rels"
        || name === "xl/sharedStrings.xml"
        || /^xl\/worksheets\/[^/]+\.xml$/i.test(name)
        || /^xl\/worksheets\/_rels\/[^/]+\.rels$/i.test(name)
        || /^xl\/drawings\/[^/]+\.xml$/i.test(name)
        || /^xl\/drawings\/_rels\/[^/]+\.rels$/i.test(name);
      const closeWithError = (error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", closeWithError);
      zip.on("entry", async (entry) => {
        try {
          if (!wanted(entry.fileName)) {
            zip.readEntry();
            return;
          }
          totalXmlSize += entry.uncompressedSize;
          if (totalXmlSize > maxTotalXmlBytes) {
            closeWithError(new Error("Excel 的工作表内容过大，无法安全导入。"));
            return;
          }
          entries.set(entry.fileName, await readZipEntry(zip, entry));
          zip.readEntry();
        } catch (error) {
          closeWithError(error);
        }
      });
      zip.on("end", () => resolve(entries));
      zip.readEntry();
    });
  });
}

function getXlsxRelationships(xml) {
  const relationships = new Map();
  Array.from(String(xml || "").matchAll(/<Relationship\b([^>]*)\/>/gi)).forEach((match) => {
    const id = (match[1].match(/\bId="([^"]+)"/i) || [])[1];
    const target = (match[1].match(/\bTarget="([^"]+)"/i) || [])[1];
    if (id && target) relationships.set(id, target);
  });
  return relationships;
}

function resolveXlsxPath(baseDirectory, target) {
  const parts = `${baseDirectory}/${String(target || "")}`.split("/");
  const resolved = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  });
  return resolved.join("/");
}

async function readXlsxEmbeddedImages(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, decodeStrings: true }, (openError, zip) => {
      if (openError) return reject(new Error("无法读取 Excel 内嵌图片。"));
      const entries = new Map();
      let totalSize = 0;
      const maxTotalBytes = 18 * 1024 * 1024;
      const wanted = (name) => /^xl\/drawings\/[^/]+\.xml$/i.test(name)
        || /^xl\/drawings\/_rels\/[^/]+\.rels$/i.test(name)
        || /^xl\/media\/[^/]+\.(?:png|jpe?g|webp)$/i.test(name);
      const closeWithError = (error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", closeWithError);
      zip.on("entry", async (entry) => {
        try {
          if (!wanted(entry.fileName)) {
            zip.readEntry();
            return;
          }
          totalSize += entry.uncompressedSize;
          if (totalSize > maxTotalBytes) {
            closeWithError(new Error("Excel 内嵌图片过多或过大，单次导入最多支持 18MB。"));
            return;
          }
          entries.set(entry.fileName, await readZipEntryBuffer(zip, entry, 8 * 1024 * 1024));
          zip.readEntry();
        } catch (error) {
          closeWithError(error);
        }
      });
      zip.on("end", () => {
        try {
          const images = [];
          Array.from(entries.entries())
            .filter(([name]) => /^xl\/drawings\/[^/]+\.xml$/i.test(name))
            .forEach(([drawingPath, drawingBuffer]) => {
              const drawingXml = drawingBuffer.toString("utf8");
              const fileName = drawingPath.split("/").pop();
              const relationshipsPath = `xl/drawings/_rels/${fileName}.rels`;
              const relationships = getXlsxRelationships(entries.get(relationshipsPath)?.toString("utf8"));
              Array.from(drawingXml.matchAll(/<xdr:(?:oneCellAnchor|twoCellAnchor)\b[^>]*>([\s\S]*?)<\/xdr:(?:oneCellAnchor|twoCellAnchor)>/gi)).forEach((anchor) => {
                const from = anchor[1].match(/<xdr:from\b[^>]*>([\s\S]*?)<\/xdr:from>/i)?.[1] || "";
                const column = Number((from.match(/<xdr:col\b[^>]*>(\d+)<\/xdr:col>/i) || [])[1]);
                const row = Number((from.match(/<xdr:row\b[^>]*>(\d+)<\/xdr:row>/i) || [])[1]);
                const relationshipId = (anchor[1].match(/r:embed="([^"]+)"/i) || [])[1];
                const target = relationships.get(relationshipId);
                const mediaPath = target ? resolveXlsxPath("xl/drawings", target) : "";
                const buffer = entries.get(mediaPath);
                if (!Number.isInteger(column) || !Number.isInteger(row) || !buffer) return;
                images.push({ row: row + 1, column, mediaPath, buffer });
              });
            });
          resolve(images);
        } catch (error) {
          reject(error);
        }
      });
      zip.readEntry();
    });
  });
}

function getXlsxSharedStrings(xml) {
  return Array.from(String(xml || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi))
    .map((match) => decodeXmlText(match[1]));
}

function getXlsxFirstSheet(entries) {
  const workbook = entries.get("xl/workbook.xml") || "";
  const relationships = entries.get("xl/_rels/workbook.xml.rels") || "";
  const sheet = workbook.match(/<sheet\b([^>]*)\/>/i);
  if (!sheet) throw new Error("Excel 中没有可读取的工作表。");
  const attributes = sheet[1];
  const name = decodeXmlText((attributes.match(/\bname="([^"]*)"/i) || [])[1] || "工作表");
  const relationshipId = (attributes.match(/(?:r:)?id="([^"]+)"/i) || [])[1];
  const relation = relationshipId
    ? Array.from(relationships.matchAll(/<Relationship\b([^>]*)\/>/gi)).find((match) => new RegExp(`\\bId="${relationshipId}"`, "i").test(match[1]))
    : null;
  const target = relation ? (relation[1].match(/\bTarget="([^"]+)"/i) || [])[1] : "worksheets/sheet1.xml";
  const normalizedTarget = String(target || "worksheets/sheet1.xml").replace(/^\//, "").replace(/^xl\//, "");
  const path = `xl/${normalizedTarget}`;
  const xml = entries.get(path) || entries.get("xl/worksheets/sheet1.xml");
  if (!xml) throw new Error("Excel 的第一个工作表无法读取。");
  return { name, xml };
}

function xlsxColumnIndex(reference) {
  const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function getXlsxRows(xml, sharedStrings) {
  return Array.from(String(xml || "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)).map((rowMatch) => {
    const values = [];
    Array.from(rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)).forEach((cellMatch) => {
      const attributes = cellMatch[1];
      const payload = cellMatch[2];
      const index = xlsxColumnIndex((attributes.match(/\br="([^"]+)"/i) || [])[1]);
      if (index < 0) return;
      const type = (attributes.match(/\bt="([^"]+)"/i) || [])[1] || "";
      const raw = decodeXmlText((payload.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i) || [])[1]
        || (payload.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i) || [])[1]
        || "");
      values[index] = type === "s" ? (sharedStrings[Number(raw)] || "") : raw;
    });
    return values;
  });
}

function normalizeSheetHeader(value) {
  return String(value || "").replace(/[\s\-_/（）()【】\[\]：:]/g, "").toLowerCase();
}

function findSheetColumn(headers, aliases) {
  return headers.findIndex((header) => aliases.some((alias) => normalizeSheetHeader(header).includes(normalizeSheetHeader(alias))));
}

function parseSheetMoney(value) {
  const matched = String(value || "").replace(/[,，\s]/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  const amount = Number(matched?.[0]);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
}

function hasAttachmentEvidence(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return Boolean(normalized && !/^(无|没有|未提供|暂无|n\/a|na|none|否|0|-)$/.test(normalized));
}

function getEmbeddedImageMimeType(mediaPath) {
  const extension = extname(mediaPath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function uploadImportedExcelImages(session, importedRows) {
  const pending = [];
  const attachments = [];
  let serial = 0;
  try {
    importedRows.forEach((row) => {
      [["payment", row.paymentImages], ["invoice", row.invoiceImages]].forEach(([kind, images]) => {
        (images || []).forEach((image, imageIndex) => {
          serial += 1;
          const extension = extname(image.mediaPath).toLowerCase() || ".png";
          const name = `Excel-${row.sourceRow}-${kind === "payment" ? "付款" : "发票"}-${imageIndex + 1}${extension}`;
          const path = join(tmpdir(), `reimbursement-excel-${randomUUID()}${extension}`);
          pending.push({
            path,
            name,
            originalFilename: name,
            mimetype: getEmbeddedImageMimeType(image.mediaPath),
            size: image.buffer.length,
            kind,
            sourceRow: row.sourceRow,
            lastModified: Date.now() + serial,
            buffer: image.buffer,
          });
        });
      });
    });
    for (const file of pending) {
      await writeFile(file.path, file.buffer);
      const ocr = await recognizeUploadedFile({ kind: file.kind, file });
      const resolved = applyDocumentClassification(file.kind, ocr, file.name);
      const contentHash = await hashUploadedFile(file.path);
      const identity = buildDocumentIdentity(ocr, file.name, contentHash);
      let possibleDuplicate = findPossibleUploadedDocument(session, identity);
      const uploaded = await uploadFileToDingTalkStorage({ session, file });
      const evidence = createUploadedEvidence({
        session,
        originalKind: file.kind,
        resolvedKind: resolved.kind,
        ocr,
        attachment: uploaded.attachment,
        identity,
        possibleDuplicate,
      });
      attachments.push({
        sourceRow: file.sourceRow,
        kind: resolved.kind,
        originalKind: file.kind,
        reclassified: resolved.reclassified,
        name: uploaded.name,
        size: uploaded.size,
        lastModified: file.lastModified,
        mimetype: file.mimetype,
        attachment: uploaded.attachment,
        ocr,
        evidenceToken: evidence.token,
        possibleDuplicateOfFileId: evidence.record.possibleDuplicateOfFileId,
        possibleDuplicateOfFileName: evidence.record.possibleDuplicateOfFileName,
        duplicateReasons: evidence.record.possibleDuplicateMatchReasons,
      });
    }
    return attachments;
  } finally {
    await Promise.allSettled(pending.map((file) => unlink(file.path)));
  }
}

async function importExpenseSheet(request) {
  const { fields, files } = await parseMultipartRequest(request);
  const incoming = Object.values(files || {}).flat();

  try {
    const session = getSession(firstField(fields, "session_token"));
    if (!session) {
      const error = new Error("Missing or expired DingTalk session.");
      error.statusCode = 401;
      throw error;
    }
    const [file] = incoming;
    if (!file) throw new Error("请选择一个 .xlsx 格式的费用明细文件。");
    if (extname(file.originalFilename).toLowerCase() !== ".xlsx") {
      throw new Error("目前仅支持 .xlsx 格式；请将表格另存为 Excel 工作簿（.xlsx）后再导入。");
    }
    const entries = await readXlsxXmlEntries(file.path);
    const { name: sheetName, xml } = getXlsxFirstSheet(entries);
    const rows = getXlsxRows(xml, getXlsxSharedStrings(entries.get("xl/sharedStrings.xml")));
    const embeddedImages = await readXlsxEmbeddedImages(file.path);
    const headerRowIndex = rows.findIndex((row) => row.some((value) => /费用明细|申请事由|价格|金额|截图|发票/.test(String(value || ""))));
    if (headerRowIndex < 0) throw new Error("未找到表头。请至少包含“费用明细、价格/元、截图、发票”四列。");
    const headers = rows[headerRowIndex];
    const reasonIndex = findSheetColumn(headers, ["费用明细", "申请事由", "费用说明", "事由", "类目"]);
    const amountIndex = findSheetColumn(headers, ["价格", "金额", "报销金额", "费用金额"]);
    const paymentIndex = findSheetColumn(headers, ["付款截图", "付款凭证", "订单截图", "截图", "付款"]);
    const invoiceIndex = findSheetColumn(headers, ["发票附件", "对应发票", "发票"]);
    if ([reasonIndex, amountIndex, paymentIndex, invoiceIndex].some((index) => index < 0)) {
      throw new Error("表头不完整。请包含“费用明细、价格/元、截图、发票”四列。");
    }
    const imagesByCell = new Map();
    embeddedImages.forEach((image) => {
      const key = `${image.row}:${image.column}`;
      imagesByCell.set(key, [...(imagesByCell.get(key) || []), image]);
    });

    const imported = [];
    const skipped = [];
    rows.slice(headerRowIndex + 1).forEach((row, index) => {
      const sourceRow = headerRowIndex + index + 2;
      const reason = String(row[reasonIndex] || "").trim();
      const amount = parseSheetMoney(row[amountIndex]);
      const paymentReference = String(row[paymentIndex] ?? "").trim();
      const invoiceReference = String(row[invoiceIndex] ?? "").trim();
      const paymentImages = imagesByCell.get(`${sourceRow}:${paymentIndex}`) || [];
      const invoiceImages = imagesByCell.get(`${sourceRow}:${invoiceIndex}`) || [];
      if (!reason && !amount && !paymentReference && !invoiceReference) return;
      if (/^(合计|总计|小计)/.test(reason)) return;
      const reasons = [];
      if (!reason) reasons.push("缺少费用明细");
      if (!amount) reasons.push("金额无效");
      if (!hasAttachmentEvidence(paymentReference) && !paymentImages.length) reasons.push("缺付款截图");
      if (!hasAttachmentEvidence(invoiceReference) && !invoiceImages.length) reasons.push("缺发票");
      if (reasons.length) {
        skipped.push({ sourceRow, reason: reason || `第 ${sourceRow} 行`, reasons });
        return;
      }
      imported.push({ sourceRow, reason, amount, paymentReference, invoiceReference, paymentImages, invoiceImages });
    });

    const attachments = await uploadImportedExcelImages(session, imported);

    return {
      sheetName,
      imported: imported.map(({ paymentImages, invoiceImages, ...item }) => item),
      attachments,
      skipped,
      summary: {
        totalRows: imported.length + skipped.length,
        importedRows: imported.length,
        skippedRows: skipped.length,
        skippedMissingPayment: skipped.filter((item) => item.reasons.includes("缺付款截图")).length,
        skippedMissingInvoice: skipped.filter((item) => item.reasons.includes("缺发票")).length,
      },
    };
  } finally {
    await Promise.allSettled(incoming.map((item) => unlink(item.path)));
  }
}

function formatMoney(value) {
  const amount = Math.abs(Number(String(value || "").replace(/[,，]/g, "").trim()));
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "";
}

function sumMoney(values) {
  return (values || []).reduce((total, value) => total + Number(formatMoney(value) || 0), 0).toFixed(2);
}

function extractSafeAmountFromText(text, requireKeyword = false) {
  const source = String(text || "");
  const amountPattern = /(?:金额|合计|总计|小计|实付|付款|支付|收款|转账|价税合计|[¥￥])?\s*(-?[0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:元)?/g;
  const matches = Array.from(source.matchAll(amountPattern))
    .filter((match) => !requireKeyword || /金额|合计|总计|小计|实付|付款|支付|收款|转账|价税合计|[¥￥]|元/.test(match[0]));
  const amounts = matches
    .map((match) => Math.abs(Number(String(match[1]).replace(/[,，]/g, ""))))
    .filter((value) => Number.isFinite(value) && value > 0);
  return amounts.length ? formatMoney(Math.max(...amounts)) : "";
}

function extractFragmentedCurrencyAmount(source, data = {}) {
  // Some mobile payment screenshots are returned by OCR as adjacent blocks
  // such as `￥8` (low confidence) followed by `80.00` (high confidence).
  // The generic fallback used to keep the first token and silently turn 80
  // into 8.00. Only repair the narrow prefix pattern where the second block is
  // a decimal amount beginning with the first block's integer token.
  const blocks = Array.isArray(data?.subImages)
    ? data.subImages.flatMap((image) => image?.blockInfo?.blockDetails || [])
    : [];
  for (let index = 0; index < blocks.length - 1; index += 1) {
    const current = String(blocks[index]?.blockContent || "").replace(/\s+/g, "");
    const next = String(blocks[index + 1]?.blockContent || "").replace(/\s+/g, "");
    const first = current.match(/^[¥￥]([0-9]{1,2})$/);
    const second = next.match(/^([0-9]{1,7}(?:\.[0-9]{1,2}))$/);
    if (!first || !second || !second[1].startsWith(first[1])) continue;
    const currentConfidence = Number(blocks[index]?.blockConfidence || 0);
    const nextConfidence = Number(blocks[index + 1]?.blockConfidence || 0);
    if (nextConfidence >= currentConfidence || currentConfidence < 80) {
      return { amount: formatMoney(parseMoneyValue(second[1])), evidence: `${current} ${next}（按高置信度完整金额纠正）` };
    }
  }

  // Older OCR payloads may only contain flattened text. Keep the same repair
  // conservative: the second decimal token must start with the first token.
  const text = normalizeOcrText(source);
  const match = text.match(/[¥￥]\s*([0-9]{1,2})\s+([0-9]{1,7}(?:\.[0-9]{1,2}))\b/);
  if (match && match[2].startsWith(match[1])) {
    return { amount: formatMoney(parseMoneyValue(match[2])), evidence: `${match[0]}（按完整金额纠正）` };
  }
  return null;
}

function extractFilenameAmount(filename, allowLoose = false) {
  const baseName = String(filename || "").replace(/\.[^.]+$/, "");
  // Do not treat a trailing sequence number as money. Mobile screenshots are
  // commonly named IMG_0579.PNG / IMG_0588.PNG; using those IDs as a fallback
  // can create a false payment amount and is materially worse than asking for
  // confirmation. A filename is accepted only when it states an amount with
  // an explicit currency/amount label (handled by extractSafeAmountFromText).
  if (!allowLoose) return extractSafeAmountFromText(baseName, true);
  return extractSafeAmountFromText(baseName, false);
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/[：]/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoneyValue(value) {
  const amount = Number(String(value || "").replace(/[,，]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function uniqueMoneyValues(values, tolerance = 0.01) {
  const result = [];
  values.forEach((value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (!result.some((item) => Math.abs(item - value) <= tolerance)) result.push(value);
  });
  return result;
}

function buildPaymentSceneResult({
  amount,
  scene,
  evidence,
  confidence = "medium",
  warnings = [],
  decision = "included",
  candidateAmount = "",
  candidateAmounts = [],
}) {
  const formatted = formatMoney(amount);
  if (decision === "included" && !formatted) return null;
  const candidates = Array.from(new Set([
    ...(Array.isArray(candidateAmounts) ? candidateAmounts : []),
    ...(candidateAmount ? [candidateAmount] : []),
  ].map(formatMoney).filter(Boolean)));
  return {
    amount: formatted,
    scene,
    evidence,
    confidence,
    warnings,
    decision,
    candidateAmount: candidates.length === 1 ? candidates[0] : "",
    candidateAmounts: candidates,
  };
}

function findLabeledAmount(source, labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^0-9¥￥]{0,18}[¥￥]?\\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\\.[0-9]{1,2})?)`);
    const match = source.match(pattern);
    if (match) {
      const amount = parseMoneyValue(match[1]);
      if (amount > 0) return { amount, evidence: match[0].trim() };
    }
  }
  return null;
}

function extractTransactionListAmount(source) {
  // A ledger-style payment screenshot may contain several independently completed
  // rides/orders. Only sum entries when each amount is paired with its own success
  // marker; this deliberately does not apply to ordinary single-payment proofs.
  if (!/(滴滴|快车|打车|交通出行|自动扣款成功)/.test(source)) return null;
  const successMatches = Array.from(source.matchAll(/自动扣款成功/g));
  if (successMatches.length < 2) return null;

  const records = successMatches.map((success, index) => {
    const previousEnd = index ? successMatches[index - 1].index + successMatches[index - 1][0].length : 0;
    const segment = source.slice(previousEnd, success.index + success[0].length);
    const amounts = Array.from(segment.matchAll(/[-－]\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/g));
    const amountMatch = amounts.at(-1);
    if (!amountMatch) return null;
    const amount = parseMoneyValue(amountMatch[1]);
    if (!amount) return null;
    return {
      amount,
      // The complete transaction block keeps two same-value rides distinct when
      // their time/name differs, while repeated OCR blocks collapse to one.
      signature: segment.replace(/\s+/g, "").trim(),
      evidence: `${amount.toFixed(2)} 元`,
    };
  }).filter(Boolean);

  const uniqueRecords = records.filter((record, index) =>
    records.findIndex((item) => item.signature === record.signature) === index,
  );
  if (uniqueRecords.length < 2) {
    return {
      amount: "",
      scene: "transaction_list",
      evidence: `检测到 ${successMatches.length} 条自动扣款成功记录`,
      confidence: "low",
      decision: "manual",
      warnings: ["该截图包含多笔交易，但金额未能逐笔可靠匹配，请拆分上传或手工核对。"],
    };
  }

  return buildPaymentSceneResult({
    amount: uniqueRecords.reduce((sum, record) => sum + record.amount, 0),
    scene: "transaction_list",
    evidence: `已识别 ${uniqueRecords.length} 笔自动扣款：${uniqueRecords.map((record) => record.evidence).join(" + ")}`,
    confidence: "high",
  });
}

function extractWechatTransferAmount(source) {
  if (!/转账/.test(source) || !/(已被接收|已收款)/.test(source)) return null;
  const matches = Array.from(source.matchAll(/[¥￥]\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)[^¥￥]{0,16}(已被接收|已收款)/g));
  const values = uniqueMoneyValues(matches.map((match) => parseMoneyValue(match[1])));
  if (!values.length) return null;
  // A single screenshot can contain duplicated OCR blocks. Do not add transfer values
  // together here: each uploaded image is treated as one payment proof.
  if (values.length > 1) {
    return {
      amount: "",
      scene: "wechat_transfer",
      evidence: matches.map((match) => match[0].trim()).join("；"),
      confidence: "low",
      decision: "manual",
      candidateAmounts: values,
      warnings: ["截图识别到多笔不同的转账金额，请拆分上传或手工核对后填写。"],
    };
  }
  return buildPaymentSceneResult({
    amount: values[0],
    scene: "wechat_transfer",
    evidence: matches.map((match) => match[0].trim()).join("；"),
    confidence: "high",
  });
}

function extractLaundryReceiptAmount(source) {
  if (!/(待付金额|折后总额|付款状态|会员姓名|取衣时间)/.test(source)) return null;
  const found = findLabeledAmount(source, ["待付金额", "折后总额", "应付金额", "实付金额", "合计金额"]);
  if (!found) return null;
  if (!/(已付款|交易成功|支付成功|已支付|已扣款)/.test(source)) {
    return buildPaymentSceneResult({
      amount: "",
      scene: "laundry_receipt",
      evidence: found.evidence,
      confidence: "high",
      decision: "excluded",
      warnings: ["这是消费小票，但未识别到已付款状态，不能作为付款截图计入报销金额。"],
    });
  }
  return buildPaymentSceneResult({
    amount: found.amount,
    scene: "laundry_receipt",
    evidence: found.evidence,
    confidence: "high",
  });
}

function extractRefundedPaymentAmount(source) {
  // Do not treat action buttons such as "申请退款" or links such as
  // "火车票退款说明" as an actual refund. A refund scene requires an explicit
  // completed-refund status, or a refund label immediately followed by money.
  if (!/(已退款|已退|退款(?:金额)?\s*[¥￥]?\s*[0-9]|退票[^0-9]{0,12}[¥￥]?\s*[0-9])/.test(source)) return null;
  const payments = uniqueMoneyValues(Array.from(source.matchAll(/[-－]\s*([0-9]{1,7}(?:[,，][0-9]{3})*\.[0-9]{1,2})/g))
    .map((match) => parseMoneyValue(match[1])));
  const explicitRefund = source.match(/(?:已退款|退款金额|已退)[^0-9]{0,20}[¥￥]?\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/);
  const refund = parseMoneyValue(explicitRefund?.[1]) || extractRefundAmountFromText(source);
  // The refund amount may appear next to the original debit. On a single
  // transaction-detail page, the largest signed debit is the original payment.
  const gross = Math.max(...payments, 0);
  if (!gross || !refund || gross <= refund) {
    return buildPaymentSceneResult({
      amount: "",
      scene: "refund_payment",
      evidence: "检测到退款信息",
      confidence: "low",
      decision: "manual",
      warnings: ["退款金额无法与原付款可靠关联，请拆分截图或手工核对后再提交。"],
    });
  }

  return buildPaymentSceneResult({
    amount: gross - refund,
    scene: "refund_payment",
    evidence: `原付款 ${formatMoney(gross)} 元 - 已退款 ${formatMoney(refund)} 元`,
    confidence: "high",
    warnings: ["已按同页明确退款信息计算实际支付净额。"],
  });
}

function extractPinduoduoOrderAmount(source) {
  if (/京东|白条|京东快递|自营/.test(source)) return null;
  if (!/(拼单|拼多多|平台优惠|大促价|交易成功)/.test(source)) return null;
  const found = findLabeledAmount(source, ["实付", "实付款"]);
  if (found) {
    return buildPaymentSceneResult({
      amount: found.amount,
      scene: "pinduoduo_order",
      evidence: found.evidence,
      confidence: "high",
    });
  }
  const fallback = findLabeledAmount(source, ["订单金额", "合计"]);
  return fallback ? buildPaymentSceneResult({
    amount: "",
    scene: "pinduoduo_order",
    evidence: fallback.evidence,
    confidence: "medium",
    decision: "manual",
    warnings: ["未识别到“实付”字段，订单金额/合计不能自动作为付款金额计入。"],
  }) : null;
}

function extractJdOrderAmount(source) {
  if (!/(京东|自营|白条|京东快递)/.test(source)) return null;
  const directPaid = source.match(/(?:实付款|实付)\s*[¥￥]\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (directPaid) {
    return buildPaymentSceneResult({
      amount: parseMoneyValue(directPaid[1]),
      scene: "jd_order",
      evidence: directPaid[0].trim(),
      confidence: "high",
    });
  }
  const paidTotal = source.match(/(?:实付款|实付)[\s\S]{0,80}?合计\s*[¥￥]?\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (paidTotal) {
    return buildPaymentSceneResult({
      amount: parseMoneyValue(paidTotal[1]),
      scene: "jd_order",
      evidence: paidTotal[0].trim(),
      confidence: "high",
    });
  }
  const found = findLabeledAmount(source, ["合计", "订单金额"]);
  if (!found) return null;
  return buildPaymentSceneResult({
    amount: "",
    scene: "jd_order",
    evidence: found.evidence,
    confidence: "medium",
    decision: "manual",
    warnings: ["未识别到“实付”字段，订单金额/合计不能自动作为付款金额计入。"],
  });
}

function extractDiscountedPaymentAmount(source) {
  if (!/(交易成功|支付成功|自动扣款成功|已支付|已扣款)/.test(source)) return null;
  const order = findLabeledAmount(source, ["订单金额", "交易金额", "应付金额"]);
  const discountMatch = source.match(
    /(?:立减|优惠|抵扣|红包)[^0-9-－]{0,12}[-－]?\s*([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/,
  );
  const debits = uniqueMoneyValues(Array.from(source.matchAll(
    /(?:^|[\s:])[-－]\s*([0-9]{1,7}(?:[,，][0-9]{3})*\.[0-9]{1,2})(?=\s|$|[\u4e00-\u9fff])/g,
  )).map((match) => parseMoneyValue(match[1])));
  const discount = parseMoneyValue(discountMatch?.[1]);
  if (!order?.amount || !discount || !debits.length) return null;
  const paid = debits.find((value) => Math.abs(order.amount - discount - value) <= 0.01);
  if (!paid) return null;
  return buildPaymentSceneResult({
    amount: paid,
    scene: "discounted_payment",
    evidence: `订单 ${formatMoney(order.amount)} 元 - 优惠 ${formatMoney(discount)} 元 = 实付 ${formatMoney(paid)} 元`,
    confidence: "high",
    warnings: ["已按同页明确的订单金额和优惠金额计算实际付款。"],
  });
}

function extractGenericPaymentRecordAmount(source) {
  const paidStatus = /(交易成功|支付成功|自动扣款成功|已支付|已扣款)/.test(source) ||
    (/(等待确认收货|待收货|卖家已发货)/.test(source) && /支付时间/.test(source));
  const signed = uniqueMoneyValues(Array.from(source.matchAll(/(?:^|[\s:])[-－]\s*([0-9]{1,7}(?:[,，][0-9]{3})*\.[0-9]{1,2})(?=\s|$|[\u4e00-\u9fff])/g))
    .map((match) => parseMoneyValue(match[1])));
  if (signed.length > 1) {
    return buildPaymentSceneResult({
      amount: "",
      scene: "payment_record",
      evidence: `检测到 ${signed.length} 个不同的付款候选金额`,
      confidence: "low",
      decision: "manual",
      candidateAmounts: signed,
      warnings: ["普通付款截图存在多个不同金额，系统不会自动求和或取最大值。"],
    });
  }
  if (signed.length === 1 && paidStatus) {
    return buildPaymentSceneResult({
      amount: signed[0],
      scene: "payment_record",
      evidence: `付款成功记录 ${formatMoney(signed[0])} 元`,
      confidence: "high",
    });
  }

  if (signed.length === 1) {
    return buildPaymentSceneResult({
      amount: "",
      scene: "payment_record",
      evidence: `检测到付款候选金额 ${formatMoney(signed[0])} 元，但未识别到付款完成状态`,
      confidence: "medium",
      decision: "manual",
      candidateAmount: signed[0],
      warnings: ["已读到付款金额，但未识别到付款完成状态，请核对后确认。"],
    });
  }

  const labeled = findLabeledAmount(source, ["支付金额", "付款金额", "交易金额", "实付款", "实付", "收款金额"]);
  if (labeled && paidStatus) {
    return buildPaymentSceneResult({
      amount: labeled.amount,
      scene: "payment_record",
      evidence: labeled.evidence,
      confidence: "high",
    });
  }
  if (labeled) {
    return buildPaymentSceneResult({
      amount: "",
      scene: "payment_record",
      evidence: `检测到付款候选金额 ${formatMoney(labeled.amount)} 元，但未识别到付款完成状态`,
      confidence: "medium",
      decision: "manual",
      candidateAmount: labeled.amount,
      warnings: ["已读到付款金额，但未识别到付款完成状态，请核对后确认。"],
    });
  }
  return null;
}

function extractScenarioPaymentAmount(text) {
  const source = normalizeOcrText(text);
  return extractTransactionListAmount(source)
    || extractWechatTransferAmount(source)
    || extractLaundryReceiptAmount(source)
    || extractRefundedPaymentAmount(source)
    || extractJdOrderAmount(source)
    || extractPinduoduoOrderAmount(source)
    || extractDiscountedPaymentAmount(source)
    || extractGenericPaymentRecordAmount(source);
}

function extractPaymentAmountFromText(text) {
  const scenario = extractScenarioPaymentAmount(text);
  if (scenario) return scenario.amount || "";
  return "";
}

function extractRefundAmountFromText(text) {
  const source = String(text || "").replace(/[：]/g, ":");
  const matches = [
    ...source.matchAll(/(?:已退款|退款|已退|退回|退票)[^0-9]{0,20}([0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/g),
  ];
  return matches
    .map((match) => Number(String(match[1]).replace(/[,，]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);
}

function applyPaymentRefund(amount, rawText) {
  const gross = Number(formatMoney(amount));
  if (!gross) return formatMoney(amount);
  const refund = extractRefundAmountFromText(rawText);
  return refund > 0 ? formatMoney(Math.max(gross - refund, 0)) : formatMoney(gross);
}

function getOcrConfig() {
  const normalized = {
    provider: getConfig("OCR_PROVIDER", "ocrProvider", "none"),
    accessKeyId: getConfig("ALIYUN_OCR_ACCESS_KEY_ID", "aliyunOcrAccessKeyId") || getConfig("OCR_ACCESS_KEY_ID", "ocrAccessKeyId"),
    accessKeySecret: getConfig("ALIYUN_OCR_ACCESS_KEY_SECRET", "aliyunOcrAccessKeySecret") || getConfig("OCR_ACCESS_KEY_SECRET", "ocrAccessKeySecret"),
    endpoint: getConfig("ALIYUN_OCR_ENDPOINT", "aliyunOcrEndpoint", "ocr-api.cn-hangzhou.aliyuncs.com"),
    regionId: getConfig("ALIYUN_OCR_REGION", "aliyunOcrRegion", "cn-hangzhou"),
    connectTimeoutMs: Number(getConfig("ALIYUN_OCR_CONNECT_TIMEOUT_MS", "aliyunOcrConnectTimeoutMs", 5000)),
    readTimeoutMs: Number(getConfig("ALIYUN_OCR_READ_TIMEOUT_MS", "aliyunOcrReadTimeoutMs", 15000)),
  };
  return normalized;
}

function getAliyunOcrClient() {
  const config = getOcrConfig();
  if (config.provider !== "aliyun") return null;
  if (!config.accessKeyId || !config.accessKeySecret) return null;
  if (ocrClientCache) return ocrClientCache;

  ocrClientCache = new OcrClient.default(new OpenApi.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: config.endpoint,
    regionId: config.regionId,
  }));
  return ocrClientCache;
}

function parseOcrData(data) {
  if (!data) return {};
  if (typeof data === "object") return data;
  try {
    return JSON.parse(data);
  } catch {
    return { rawText: String(data) };
  }
}

function pickValue(source, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function findDeepValue(source, keys = []) {
  if (!source || typeof source !== "object") return "";
  const direct = pickValue(source, keys);
  if (direct) return direct;
  for (const value of Object.values(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findDeepValue(item, keys);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findDeepValue(value, keys);
      if (found) return found;
    }
  }
  return "";
}

function collectText(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(collectText).filter(Boolean).join(" ");
  return String(value);
}

function collectReadableOcrText(data) {
  const direct = data?.content || data?.Content || data?.rawText || data?.RawText;
  if (direct) return String(direct);
  const subImages = data?.subImages || data?.SubImages || [];
  const blockText = Array.isArray(subImages)
    ? subImages
        .flatMap((image) => image?.blockInfo?.blockDetails || image?.BlockInfo?.BlockDetails || [])
        .map((block) => block?.blockContent || block?.BlockContent || "")
        .filter(Boolean)
        .join(" ")
    : "";
  return blockText || collectText(data);
}

function flattenOcrKeyValues(value, result = {}) {
  if (!value) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenOcrKeyValues(item, result));
    return result;
  }
  if (typeof value !== "object") return result;

  if (value.kvDetails && typeof value.kvDetails === "object") {
    Object.entries(value.kvDetails).forEach(([key, detail]) => {
      const text = collectText(detail);
      if (key && text) result[key] = text;
    });
  }

  const label = value.key || value.Key || value.name || value.Name || value.fieldName || value.FieldName;
  const raw = value.value ?? value.Value ?? value.text ?? value.Text ?? value.content ?? value.Content;
  if (label && raw !== undefined && raw !== null) {
    const text = typeof raw === "object" ? collectText(raw) : String(raw);
    if (text.trim()) result[String(label)] = text;
  }

  Object.values(value).forEach((item) => flattenOcrKeyValues(item, result));
  return result;
}

function pickLabelValue(source, labels = []) {
  const entries = Object.entries(source || {});
  for (const label of labels) {
    const found = entries.find(([key, value]) => key.includes(label) && String(value || "").trim());
    if (found) return found[1];
  }
  return "";
}

function extractInvoiceDetails(data) {
  const candidates = [
    data.invoiceDetails,
    data.InvoiceDetails,
    data.items,
    data.Items,
    data.subImages?.flatMap((item) => item?.tableInfo?.tableDetails || []),
    data.SubImages?.flatMap((item) => item?.TableInfo?.TableDetails || []),
  ].filter(Boolean);
  const details = candidates.find(Array.isArray) || [];
  return details.map((item) => ({
    itemName: pickValue(item, ["itemName", "ItemName", "name", "Name", "goodsName", "GoodsName", "goods", "Goods"]) ||
      pickLabelValue(flattenOcrKeyValues(item), ["项目名称", "货物或应税劳务", "服务名称", "商品名称", "名称"]),
    amount: formatMoney(pickValue(item, ["amount", "Amount", "sum", "Sum", "total", "Total"]) ||
      pickLabelValue(flattenOcrKeyValues(item), ["金额", "价税合计", "合计"])),
    raw: item,
  }));
}

function detectHighConfidenceInvoiceDocument(ocr = {}) {
  const text = String(ocr.rawText || collectReadableOcrText(ocr.data || {}))
    .replace(/\s+/g, "")
    .toLowerCase();
  const signalDefinitions = [
    ["发票抬头", /增值税.{0,12}发票|电子.{0,8}发票|数电票|全面数字化的电子发票|(?:invoicetype|title).{0,24}(?:数电|发票)/],
    ["购买方", /购买方|购方信息|购方名称|purchasername/],
    ["销售方", /销售方|销方信息|销方名称|sellername/],
    ["纳税人识别号", /纳税人识别号|统一社会信用代码|purchasertaxnumber|sellertaxnumber/],
    ["发票号码", /发票号码|发票代码|开票日期|校验码|invoicenumber|invoicecode|invoicedate/],
    ["价税信息", /价税合计|税率\/征收率|税率|税额|invoicetax|totalamount/],
    ["发票明细", /货物或应税劳务|服务名称|项目名称.{0,30}(金额|税率)|invoicedetails|itemname/],
  ];
  const signals = signalDefinitions
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  const completedPayment = /支付成功|付款成功|交易成功|转账成功|收款成功|支付完成|付款完成|交易完成/.test(text);
  const has = (label) => signals.includes(label);
  const hasPartiesAndTax = has("购买方") && has("销售方") && has("纳税人识别号") && has("价税信息");
  const hasInvoiceHeader = has("发票抬头") && signals.length >= 3;
  const hasInvoiceMetadata = has("发票号码") && has("纳税人识别号") &&
    (has("购买方") || has("销售方")) && has("价税信息");
  const isInvoice = !completedPayment && (hasPartiesAndTax || hasInvoiceHeader || hasInvoiceMetadata);
  return {
    role: isInvoice ? "invoice" : "unknown",
    confidence: isInvoice ? "high" : "",
    signals,
  };
}

function detectDocumentRole(ocr = {}, originalKind = "", fileName = "") {
  const rawText = String(ocr.rawText || collectReadableOcrText(ocr.data || {}));
  const text = rawText.replace(/\s+/g, "").toLowerCase();
  const normalizedName = String(fileName || "").replace(/\s+/g, "").toLowerCase();
  const recognizedAmount = formatMoney(ocr.amount);
  // Railway e-tickets are valid expense documents, but are not VAT invoices
  // and commonly have no purchaser title. Do not infer this exemption from a
  // filename alone: require the document text to identify a railway e-ticket.
  // This precedes generic invoice detection because some railway layouts also
  // contain an invoice number or issue date.
  const railTicketSignals = [
    ["铁路电子客票", /铁路电子客票|铁路客票/],
    ["铁路电子客票字段", /电子客票/],
    ["铁路运营信息", /中国铁路|12306|车次|乘车日期|始发站|终到站|席别|票价|票款/],
  ].filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  if (railTicketSignals.includes("铁路电子客票") ||
      (railTicketSignals.includes("铁路电子客票字段") && railTicketSignals.includes("铁路运营信息"))) {
    return {
      role: "title_exempt_transport_receipt",
      confidence: "high",
      signals: railTicketSignals,
    };
  }
  const invoiceDetection = detectHighConfidenceInvoiceDocument(ocr);
  if (invoiceDetection.role === "invoice") {
    return {
      role: "tax_invoice",
      confidence: "high",
      signals: invoiceDetection.signals,
    };
  }

  const supportingSignals = [
    ["行程单", /行程单|amapitinerary/],
    ["行程汇总", /共计\d+单行程|行程时间|申请时间/],
    ["行程字段", /起点.{0,12}终点|上车时间|出发地.{0,12}到达地/],
  ].filter(([, pattern]) => pattern.test(text) || pattern.test(normalizedName))
    .map(([label]) => label);
  if (supportingSignals.includes("行程单") &&
      (supportingSignals.length >= 2 || /电子行程单/.test(normalizedName))) {
    return {
      role: "supporting_document",
      confidence: "high",
      signals: supportingSignals,
    };
  }

  const paymentSignals = [
    ["支付完成", /支付成功|付款成功|交易成功|转账成功|收款成功|支付完成|付款完成|交易完成|自动扣款成功/],
    ["实付金额", /实付|付款金额|支付金额|收款金额|自动扣款|订单金额/],
    ["支付信息", /支付时间|付款方式|支付方式|查看扣款顺序|账单详情/],
  ].filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  const paymentDecisionAccepted = originalKind === "payment" && ocr.decision === "included" && recognizedAmount;
  if ((paymentSignals.includes("支付完成") && paymentSignals.length >= 2 && recognizedAmount) ||
      paymentDecisionAccepted) {
    return {
      role: "payment",
      confidence: paymentSignals.includes("支付完成") ? "high" : "medium",
      signals: paymentSignals.length ? paymentSignals : ["付款OCR状态机确认"],
    };
  }

  const mediumInvoiceSignals = [
    ["发票文件名", /发票|invoice|dzfp/],
    ["发票号码", /发票号码|发票代码|校验码/],
    ["开票信息", /开票日期|购买方|销售方|纳税人识别号/],
    ["税额信息", /价税合计|税率|税额/],
  ].filter(([label, pattern]) => (
    label === "发票文件名" ? pattern.test(normalizedName) : pattern.test(text)
  )).map(([label]) => label);
  if (recognizedAmount && mediumInvoiceSignals.includes("发票文件名") &&
      mediumInvoiceSignals.length >= 2 && !/行程单/.test(normalizedName)) {
    return {
      role: "tax_invoice",
      confidence: "medium",
      signals: mediumInvoiceSignals,
    };
  }

  return {
    role: "unknown",
    confidence: "",
    signals: [],
  };
}

function resolveUploadedDocumentKind(kind, ocr = {}, fileName = "") {
  const detection = detectDocumentRole(ocr, kind, fileName);
  let resolvedKind = kind;
  if (["tax_invoice", "title_exempt_transport_receipt", "supporting_document"].includes(detection.role)) resolvedKind = "invoice";
  if (detection.role === "payment") resolvedKind = "payment";
  const reclassified = resolvedKind !== kind;
  return {
    kind: resolvedKind,
    reclassified,
    detection,
  };
}

function applyDocumentClassification(originalKind, ocr = {}, fileName = "") {
  const resolved = resolveUploadedDocumentKind(originalKind, ocr, fileName);
  const recognizedAmount = formatMoney(ocr.amount);
  ocr.originalKind = originalKind;
  ocr.kind = resolved.kind;
  ocr.documentRole = resolved.detection.role;
  ocr.roleConfidence = resolved.detection.confidence;
  ocr.roleSignals = resolved.detection.signals;
  ocr.recognizedAmount = recognizedAmount;

  if (["tax_invoice", "title_exempt_transport_receipt"].includes(resolved.detection.role)) {
    ocr.countableAmount = recognizedAmount;
    ocr.scene = "";
    ocr.decision = "";
    ocr.locked = false;
    ocr.warnings = [];
  } else if (resolved.detection.role === "payment") {
    ocr.countableAmount = ocr.decision === "included" || originalKind === "invoice"
      ? recognizedAmount
      : "";
    if (originalKind === "invoice" && recognizedAmount) {
      ocr.decision = "included";
      ocr.locked = false;
      ocr.evidence = ocr.evidence || `付款内容识别金额 ¥${recognizedAmount}`;
    }
  } else {
    ocr.countableAmount = "";
    if (originalKind === "payment") {
      ocr.decision = "excluded";
      ocr.locked = true;
      ocr.warnings = [
        ...(Array.isArray(ocr.warnings) ? ocr.warnings : []),
        resolved.detection.role === "supporting_document"
          ? "该文件是行程单/佐证材料，不计入付款金额。"
          : "无法确认该文件是付款成功凭证，不自动计入付款金额。",
      ];
    }
  }
  return resolved;
}

function normalizeIdentityValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s:：\-_/（）()[\]【】]/g, "")
    .toUpperCase();
}

function identityHash(namespace, values) {
  const normalized = values.map(normalizeIdentityValue).filter(Boolean).join("|");
  return normalized
    ? `${namespace}:${createHash("sha256").update(normalized, "utf8").digest("hex")}`
    : "";
}

function findIdentityTextValue(text, patterns = []) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

function findOcrIdentityValue(ocr, keys = [], patterns = []) {
  const data = ocr?.data || {};
  const flattened = flattenOcrKeyValues(data);
  const direct = findDeepValue(data, keys) || pickValue(flattened, keys);
  if (direct) return String(direct).trim();
  return findIdentityTextValue(ocr?.rawText || collectReadableOcrText(data), patterns);
}

function buildDocumentIdentity(ocr = {}, fileName = "", contentHash = "") {
  const role = String(ocr.documentRole || "unknown");
  const recognizedAmount = formatMoney(ocr.countableAmount || ocr.recognizedAmount || ocr.amount);
  const rawText = String(ocr.rawText || collectReadableOcrText(ocr.data || {}));
  const identity = {
    role,
    contentFingerprint: contentHash ? `content:${String(contentHash).toLowerCase()}` : "",
    semanticFingerprint: "",
    possibleFingerprint: "",
    confidence: "",
    matchReasons: [],
    display: {
      fileName: String(fileName || ""),
      amount: recognizedAmount,
      invoiceNumber: "",
      transactionNumber: "",
      date: "",
      counterparty: "",
    },
  };

  if (role === "tax_invoice") {
    const invoiceNumber = findOcrIdentityValue(
      ocr,
      ["invoiceNumber", "InvoiceNumber", "printedInvoiceNumber", "PrintedInvoiceNumber"],
      [
        /(?:发票号码|数电票号码)[^0-9A-Z]{0,16}([0-9]{8,24})/i,
        /invoicenumber[^0-9A-Z]{0,16}([0-9]{8,24})/i,
      ],
    );
    const invoiceCode = findOcrIdentityValue(
      ocr,
      ["invoiceCode", "InvoiceCode", "printedInvoiceCode", "PrintedInvoiceCode"],
      [/(?:发票代码|invoicecode)[^0-9A-Z]{0,16}([0-9]{8,16})/i],
    );
    const sellerTaxNumber = findOcrIdentityValue(
      ocr,
      ["sellerTaxNumber", "SellerTaxNumber", "salesTaxNumber", "SalesTaxNumber"],
      [/(?:销售方|销方)[\s\S]{0,80}?(?:纳税人识别号|统一社会信用代码)[^0-9A-Z]{0,12}([0-9A-Z]{15,20})/i],
    );
    const purchaserTaxNumber = findOcrIdentityValue(
      ocr,
      ["purchaserTaxNumber", "PurchaserTaxNumber", "buyerTaxNumber", "BuyerTaxNumber"],
      [/(?:购买方|购方)[\s\S]{0,80}?(?:纳税人识别号|统一社会信用代码)[^0-9A-Z]{0,12}([0-9A-Z]{15,20})/i],
    );
    const invoiceDate = findOcrIdentityValue(
      ocr,
      ["invoiceDate", "InvoiceDate", "issueDate", "IssueDate"],
      [/(?:开票日期|invoicedate)[^0-9]{0,12}([0-9]{4}[年./-][0-9]{1,2}[月./-][0-9]{1,2}日?)/i],
    );
    const sellerName = ocr.sellerName || findOcrIdentityValue(
      ocr,
      ["sellerName", "SellerName", "salesName", "SalesName"],
      [/(?:销售方名称|销方名称)[：:\s]*([^\s]{4,40})/],
    );
    identity.display.invoiceNumber = invoiceNumber;
    identity.display.date = invoiceDate;
    identity.display.counterparty = sellerName;

    if (normalizeIdentityValue(invoiceNumber).length >= 8) {
      identity.semanticFingerprint = identityHash("invoice-number", [invoiceCode, invoiceNumber]);
      identity.confidence = "confirmed";
      identity.matchReasons = ["发票号码一致"];
    } else if (sellerTaxNumber && purchaserTaxNumber && invoiceDate && recognizedAmount) {
      identity.semanticFingerprint = identityHash(
        "invoice-composite",
        [sellerTaxNumber, purchaserTaxNumber, invoiceDate, recognizedAmount],
      );
      identity.confidence = "confirmed";
      identity.matchReasons = ["购销双方税号、开票日期和价税合计一致"];
    }
    if (recognizedAmount && sellerTaxNumber && purchaserTaxNumber) {
      identity.possibleFingerprint = identityHash(
        "invoice-review-parties-amount",
        [sellerTaxNumber, purchaserTaxNumber, recognizedAmount],
      );
      if (!identity.semanticFingerprint) identity.confidence = "possible";
      identity.matchReasons = identity.semanticFingerprint
        ? identity.matchReasons
        : ["购销双方税号和价税合计一致，但未识别到完整发票号码/日期"];
    } else if (!identity.semanticFingerprint && recognizedAmount && invoiceDate && (sellerTaxNumber || sellerName)) {
      identity.possibleFingerprint = identityHash(
        "invoice-review",
        [sellerTaxNumber || sellerName, invoiceDate, recognizedAmount],
      );
      identity.confidence = "possible";
      identity.matchReasons = ["销售方、开票日期和金额一致，但未识别到完整发票号码"];
    }
  } else if (role === "payment") {
    const transactionNumber = findOcrIdentityValue(
      ocr,
      [
        "transactionId", "TransactionId", "transactionNumber", "TransactionNumber",
        "tradeNo", "TradeNo", "orderNumber", "OrderNumber",
      ],
      [/(?:交易单号|商户单号|支付单号|流水号|订单号)[：:\s]*([0-9A-Z-]{10,40})/i],
    );
    const paymentTime = findOcrIdentityValue(
      ocr,
      ["paymentTime", "PaymentTime", "tradeTime", "TradeTime"],
      [/(?:支付时间|付款时间|交易时间)[：:\s]*([0-9]{4}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}日?(?:\s*[0-9]{1,2}[：:][0-9]{2}(?::[0-9]{2})?)?)/],
    );
    const counterparty = ocr.recipientName || ocr.sellerName || findIdentityTextValue(rawText, [
      /(?:商户|收款方|收款人)[：:\s]*([^\s]{2,40})/,
    ]);
    identity.display.transactionNumber = transactionNumber;
    identity.display.date = paymentTime;
    identity.display.counterparty = counterparty;
    if (normalizeIdentityValue(transactionNumber).length >= 10) {
      identity.semanticFingerprint = identityHash("payment-number", [transactionNumber]);
      identity.confidence = "confirmed";
      identity.matchReasons = ["支付交易号/订单号一致"];
    } else if (recognizedAmount && paymentTime && counterparty) {
      identity.possibleFingerprint = identityHash(
        "payment-review",
        [counterparty, paymentTime, recognizedAmount],
      );
      identity.confidence = "possible";
      identity.matchReasons = ["收款方、支付时间和实付金额一致，但未识别到完整交易号"];
    }
  }
  return identity;
}

async function hashUploadedFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function normalizeOcrResult({ kind, response, fallbackText = "", ocrType = "" }) {
  const body = response?.body || {};
  const data = parseOcrData(body.data);
  const kv = flattenOcrKeyValues(data);
  const merged = { ...kv, ...data };
  // A filename is diagnostic context, not OCR text. In particular, do not let
  // a generated name such as IMG_0579.PNG become a payment candidate when an
  // OCR provider returns no readable text.
  const rawText = collectReadableOcrText(data);
  const structuredAmount = formatMoney(pickValue(data, [
    "totalAmount", "TotalAmount", "amount", "Amount", "payAmount", "PayAmount",
    "invoiceAmount", "InvoiceAmount", "sumAmount", "SumAmount", "total", "Total",
    "totalTaxIncludedAmount", "TotalTaxIncludedAmount",
  ]) || findDeepValue(data, [
    "totalAmount", "TotalAmount", "amount", "Amount", "payAmount", "PayAmount",
    "invoiceAmount", "InvoiceAmount", "sumAmount", "SumAmount", "total", "Total",
    "totalTaxIncludedAmount", "TotalTaxIncludedAmount",
  ]) || pickLabelValue(merged, [
    "价税合计", "合计金额", "小写", "付款金额", "支付金额", "实付", "收款金额",
    "订单金额", "发票金额", "金额",
  ]));
  // Invoices have structured amount fields. Payment screenshots do not: their
  // OCR payload often exposes an arbitrary price, list subtotal, or original
  // price as the first/maximum "amount". Therefore the payment state machine
  // must decide known scenes before this generic fallback is considered.
  const fragmentedCurrency = kind === "payment" ? extractFragmentedCurrencyAmount(rawText, data) : null;
  const legacyAmount = fragmentedCurrency?.amount || structuredAmount ||
    extractSafeAmountFromText(rawText, true) ||
    extractFilenameAmount(fallbackText, false);
  const paymentScene = kind === "payment" ? extractScenarioPaymentAmount(rawText) : null;
  const paymentCandidateAmounts = kind === "payment"
    ? Array.from(new Set([
      ...(Array.isArray(paymentScene?.candidateAmounts) ? paymentScene.candidateAmounts : []),
      ...(paymentScene?.candidateAmount ? [paymentScene.candidateAmount] : []),
    ].map(formatMoney).filter(Boolean)))
    : [];
  const paymentCandidateAmount = paymentCandidateAmounts.length === 1 ? paymentCandidateAmounts[0] : "";
  const highRiskScenes = new Set([
    "transaction_list",
    "wechat_transfer",
    "refund_payment",
    "laundry_receipt",
    "payment_record",
  ]);
  const isHighRiskScene = Boolean(
    paymentScene &&
    paymentScene.decision !== "included" &&
    highRiskScenes.has(paymentScene.scene),
  );

  let amount = legacyAmount;
  let paymentDecision = "";
  let paymentWarnings = [];
  let paymentEvidence = "";
  let paymentConfidence = "";
  let paymentSceneName = "";

  if (kind === "payment") {
    paymentSceneName = paymentScene?.scene || (legacyAmount ? "generic_payment" : "");
    paymentEvidence = paymentScene?.evidence || fragmentedCurrency?.evidence || (legacyAmount ? `通用 OCR 识别金额 ¥${legacyAmount}` : "");
    paymentConfidence = paymentScene?.confidence || (legacyAmount ? "medium" : "");

    if (paymentScene?.decision === "included" && paymentScene.amount) {
      amount = paymentScene.amount;
      paymentDecision = "included";
      paymentWarnings = paymentScene.warnings || [];
    } else if (paymentScene?.decision === "excluded") {
      // An amount is still returned so the UI can show the customer what OCR
      // found, but it is deliberately not included until manually confirmed.
      amount = paymentScene.amount || legacyAmount || "";
      paymentDecision = "excluded";
      paymentWarnings = paymentScene.warnings || [];
    } else if (legacyAmount && !isHighRiskScene) {
      // Normal payment/order screenshots retain the former automatic result.
      paymentDecision = "included";
      paymentWarnings = paymentScene?.warnings || [];
    } else {
      // Keep the candidate visible for review, but do not include it in totals
      // until the user explicitly confirms it for genuinely ambiguous cases.
      amount = paymentScene?.amount || (paymentCandidateAmounts.length === 1
        ? paymentCandidateAmount
        : paymentCandidateAmounts.length > 1
          ? ""
          : legacyAmount) || "";
      paymentDecision = paymentScene?.decision || "manual";
      paymentWarnings = paymentScene?.warnings || ["未能确认这是已完成的付款记录，确认金额后才会计入报销金额。"];
    }
  }

  const normalized = {
    enabled: true,
    provider: "aliyun",
    kind,
    ocrType,
    reason: "",
    amount,
    candidateAmount: paymentCandidateAmount,
    candidateAmounts: paymentCandidateAmounts,
    scene: paymentSceneName,
    evidence: paymentEvidence,
    confidence: paymentConfidence,
    decision: paymentDecision,
    locked: Boolean(kind === "payment" && paymentDecision !== "included"),
    warnings: paymentWarnings,
    rawText,
    data,
    invoiceDetails: extractInvoiceDetails(data),
    sellerName: pickValue(merged, ["sellerName", "SellerName", "seller", "Seller", "salesName", "SalesName"]) ||
      pickLabelValue(merged, ["销售方名称", "销方名称", "收款方", "商户名称"]),
    buyerName: pickValue(merged, ["buyerName", "BuyerName", "purchaserName", "PurchaserName"]) ||
      pickLabelValue(merged, ["购买方名称", "购方名称", "受票方"]),
    recipientName: pickValue(merged, ["recipientName", "RecipientName", "payeeName", "PayeeName", "sellerName", "SellerName"]) ||
      pickLabelValue(merged, ["收款方", "收款人", "商户名称", "销售方名称"]),
    requestId: body.requestId,
    code: body.code,
    message: body.message,
  };
  // Persist a provider-independent invoice projection alongside the OCR result.
  // Later ledger sync and historical import consume this cache and never OCR again.
  normalized.invoiceLedger = kind === "invoice" ? extractInvoiceLedgerSnapshot(normalized) : null;
  return normalized;
}

async function recognizeAllTextFile({ client, file, type }) {
  const request = {
    type,
    body: createReadStream(file.path),
  };
  if (type !== "PaymentRecord") request.pageNo = 1;
  const config = getOcrConfig();
  const runtime = new Util.RuntimeOptions({
    connectTimeout: config.connectTimeoutMs,
    readTimeout: config.readTimeoutMs,
  });
  return client.recognizeAllTextWithOptions(new ocrApi.RecognizeAllTextRequest(request), runtime);
}

function isOcrTimeoutError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /timeout|ReadTimeout|SocketTimeout|ETIMEDOUT/i.test(text);
}

async function recognizeAllTextFileWithRetry(options) {
  try {
    return await recognizeAllTextFile(options);
  } catch (error) {
    if (!isOcrTimeoutError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return recognizeAllTextFile(options);
  }
}

async function recognizeWithFallback({ client, kind, file }) {
  const types = kind === "payment" ? ["Advanced", "PaymentRecord", "General"] : ["Invoice", "Advanced", "General"];
  const errors = [];
  let lastResult = null;

  for (const type of types) {
    try {
      const response = await recognizeAllTextFileWithRetry({ client, file, type });
      const result = normalizeOcrResult({ kind, response, fallbackText: file.name, ocrType: type });
      // Do not let a later generic OCR pass overwrite a payment-scene ambiguity
      // with an arbitrary larger number.
      if (kind === "payment" && result.locked) return result;
      if (result.amount || type === types.at(-1)) return result;
      lastResult = result;
      errors.push(`${type}: 未识别到金额`);
    } catch (error) {
      errors.push(`${type}: ${error.code || error.message}`);
    }
  }

  if (lastResult) {
    lastResult.reason = errors.join("；");
    return lastResult;
  }

  const message = errors.join("；") || "未知错误";
  const error = new Error(message);
  error.ocrErrors = errors;
  throw error;
}

async function recognizeUploadedFile({ kind, file }) {
  const ocr = {
    enabled: false,
    provider: getOcrConfig().provider,
    reason: "未配置OCR服务",
    amount: kind === "payment" ? "" : extractFilenameAmount(file.originalFilename || file.name, false),
    rawText: "",
    invoiceDetails: [],
  };

  if (file.mimetype.startsWith("text/") || file.name.toLowerCase().endsWith(".txt")) {
    try {
      ocr.rawText = await readFile(file.path, "utf8");
      ocr.amount = extractSafeAmountFromText(ocr.rawText, true) || ocr.amount;
    } catch {
      ocr.rawText = "";
    }
  }

  const client = getAliyunOcrClient();
  if (!client) {
    if (ocr.provider !== "none") ocr.reason = `OCR服务 ${ocr.provider} 尚未完成密钥配置`;
    return ocr;
  }

  try {
    if (kind === "payment") {
      const result = await recognizeWithFallback({ client, kind, file });
      result.amount = result.amount || ocr.amount;
      return result;
    }

    if (kind === "invoice") {
      const result = await recognizeWithFallback({ client, kind, file });
      result.amount = result.amount || ocr.amount;
      return result;
    }

    ocr.reason = "其他附件不做OCR识别";
  } catch (error) {
    ocr.provider = "aliyun";
    ocr.reason = `阿里云OCR识别失败：${error.message}`;
  }

  return ocr;
}

function createDingTalkSdkClient(service) {
  const config = new OpenApi.Config({});
  config.protocol = "https";
  config.regionId = "central";
  return new service.default(config);
}

function createRuntimeOptions() {
  return new Util.RuntimeOptions({});
}

async function getDingTalkAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const appKey = getConfig("DINGTALK_APP_KEY", "appKey");
  const appSecret = getConfig("DINGTALK_APP_SECRET", "appSecret");
  if (!appKey || !appSecret) {
    throw new Error("Missing DingTalk AppKey or AppSecret. Please fill dingtalk.config.json.");
  }

  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const body = await response.json();
  if (!response.ok || !body.accessToken) {
    throw new Error(`DingTalk token failed: ${JSON.stringify(body)}`);
  }

  tokenCache.value = body.accessToken;
  tokenCache.expiresAt = Date.now() + Math.max(60, Number(body.expireIn || 7200) - 120) * 1000;
  return tokenCache.value;
}

async function requestDingTalk(path, payload) {
  const accessToken = await getDingTalkAccessToken();
  const response = await fetch(`https://oapi.dingtalk.com${path}?access_token=${accessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();

  if (!response.ok || body.errcode !== 0) {
    throw new Error(`DingTalk API failed: ${JSON.stringify(body)}`);
  }

  return body.result || body;
}

async function requestDingTalkHrm(path, payload) {
  const accessToken = await getDingTalkAccessToken();
  const response = await fetch(`https://api.dingtalk.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": accessToken,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code || body?.errcode) {
    const error = new Error(`DingTalk HRM API failed: ${JSON.stringify(body)}`);
    error.statusCode = response.status || 502;
    throw error;
  }
  return body;
}

function readRosterFieldValue(record, fieldCode) {
  if (!record || typeof record !== "object") return "";
  if (Object.prototype.hasOwnProperty.call(record, fieldCode)) {
    const direct = record[fieldCode];
    return typeof direct === "object"
      ? String(direct?.value ?? direct?.fieldValue ?? direct?.text ?? "").trim()
      : String(direct || "").trim();
  }
  const candidates = [
    ...(Array.isArray(record.fieldDataList) ? record.fieldDataList : []),
    ...(Array.isArray(record.fieldList) ? record.fieldList : []),
    ...(Array.isArray(record.fields) ? record.fields : []),
  ];
  const field = candidates.find((item) => String(item?.fieldCode || item?.code || item?.id || "") === fieldCode);
  const firstListedValue = Array.isArray(field?.fieldValueList) ? field.fieldValueList[0] : null;
  return String(
    field?.value
    ?? field?.fieldValue
    ?? field?.text
    ?? field?.content
    ?? firstListedValue?.value
    ?? firstListedValue?.fieldValue
    ?? firstListedValue?.text
    ?? "",
  ).trim();
}

function normalizeSocialCompanyRecognitionError(error) {
  const message = String(error?.message || error || "");
  return /permission|forbidden|accessdenied|403|scope/i.test(message)
    ? "permission_denied"
    : "temporarily_unavailable";
}

function resolveSocialPaymentCompany(rawValue, config = getSocialCompanyRecognitionConfig()) {
  const sourceValue = String(rawValue || "").trim();
  if (!sourceValue) {
    return { status: "missing", companyName: "", sourceValue: "" };
  }
  const normalized = normalizeApprovalCompanyName(sourceValue);
  const companyName = APPROVAL_COMPANY_NAMES.find((item) => normalizeApprovalCompanyName(item) === normalized) || "";
  return companyName
    ? { status: "verified", companyName, sourceValue }
    : { status: "invalid_value", companyName: "", sourceValue };
}

async function recognizeSocialPaymentCompany(userId) {
  const config = getSocialCompanyRecognitionConfig();
  const checkedAt = new Date().toISOString();
  const base = {
    enabled: config.enabled,
    fieldName: config.fieldName,
    checkedAt,
  };
  if (!config.enabled) return { ...base, status: "disabled", companyName: "" };
  if (!userId) return { ...base, status: "temporarily_unavailable", companyName: "" };
  if (config.excludedUserIds.includes(String(userId))) return { ...base, status: "excluded", companyName: "" };
  if (!config.fieldCode) return { ...base, status: "temporarily_unavailable", companyName: "" };

  try {
    const result = await requestDingTalkHrm("/v1.0/hrm/rosters/lists/query", {
      userIdList: [String(userId)],
      fieldFilterList: [config.fieldCode],
      appAgentId: Number(getConfig("DINGTALK_AGENT_ID", "agentId")),
      text2SelectConvert: false,
    });
    const records = Array.isArray(result?.result)
      ? result.result
      : (Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []));
    const record = records.find((item) => String(item?.userId || item?.userid || item?.user_id || "") === String(userId)) || records[0];
    const resolved = resolveSocialPaymentCompany(readRosterFieldValue(record, config.fieldCode), config);
    return { ...base, ...resolved };
  } catch (error) {
    // HRM is a convenience and audit signal.  It must not prevent a user from
    // continuing with a valid manually selected payment company.
    console.warn(`DingTalk social company lookup unavailable for current user: ${error.message}`);
    return { ...base, status: normalizeSocialCompanyRecognitionError(error), companyName: "" };
  }
}

async function getDingTalkUserByAuthCode(authCode) {
  const result = await requestDingTalk("/topapi/v2/user/getuserinfo", { code: authCode });
  const userId = result.userid || result.userId;
  if (!userId) throw new Error(`DingTalk auth did not return userid: ${JSON.stringify(result)}`);
  return {
    userId,
    unionId: result.unionid || result.unionId || "",
  };
}

async function getDingTalkUserDetail(userId) {
  const result = await requestDingTalk("/topapi/v2/user/get", {
    userid: userId,
    language: "zh_CN",
  });
  return result;
}

function normalizeDingTalkEmployeeSummary(item = {}) {
  const userId = String(item.userid || item.userId || item.user_id || "").trim();
  const name = String(item.name || item.realName || item.nick || "").trim();
  const deptIds = (item.dept_id_list || item.deptIdList || item.deptIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  return userId ? { userId, name: name || userId, deptIds } : null;
}

async function listDingTalkEmployees(query = "", limit = 20) {
  const config = getOnBehalfConfig();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const now = Date.now();
  if (now >= dingTalkEmployeeDirectoryCache.expiresAt || !dingTalkEmployeeDirectoryCache.users.length) {
    const users = [];
    const seen = new Set();
    let cursor = 0;
    for (let page = 0; page < 12; page += 1) {
      const result = await requestDingTalk("/topapi/v2/user/list", {
        dept_id: Number(config.rootDeptId),
        cursor,
        size: 100,
        language: "zh_CN",
      });
      const rows = Array.isArray(result?.list)
        ? result.list
        : (Array.isArray(result?.userlist) ? result.userlist : (Array.isArray(result?.users) ? result.users : []));
      rows.map(normalizeDingTalkEmployeeSummary).filter(Boolean).forEach((item) => {
        if (!seen.has(item.userId)) {
          seen.add(item.userId);
          users.push(item);
        }
      });
      const hasMore = Boolean(result?.has_more ?? result?.hasMore);
      const nextCursor = result?.next_cursor ?? result?.nextCursor;
      if (!hasMore || nextCursor === undefined || nextCursor === null || String(nextCursor) === String(cursor)) break;
      cursor = nextCursor;
    }
    dingTalkEmployeeDirectoryCache.users = users;
    dingTalkEmployeeDirectoryCache.expiresAt = now + 5 * 60 * 1000;
  }
  const matches = dingTalkEmployeeDirectoryCache.users.filter((item) => {
    if (!normalizedQuery) return true;
    return item.name.toLowerCase().includes(normalizedQuery) || item.userId.toLowerCase().includes(normalizedQuery);
  });
  return matches.slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)));
}

async function getDingTalkEmployeeProfile(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) throw new Error("Missing employee user id.");
  const detail = await getDingTalkUserDetail(normalizedUserId);
  const deptIds = (detail.dept_id_list || detail.deptIdList || []).map((id) => String(id));
  const user = {
    userId: normalizedUserId,
    unionId: detail.unionid || detail.unionId || "",
    name: detail.name || detail.realName || normalizedUserId,
    departments: [],
    organizationPaths: [],
  };
  await syncDingTalkUserOrganization(user, deptIds);
  user.socialCompanyRecognition = await recognizeSocialPaymentCompany(normalizedUserId);
  return user;
}

async function getDingTalkDepartment(deptId) {
  try {
    const result = await requestDingTalk("/topapi/v2/department/get", {
      dept_id: Number(deptId),
      language: "zh_CN",
    });
    return {
      id: String(deptId),
      name: result.name || `部门 ${deptId}`,
    };
  } catch {
    return {
      id: String(deptId),
      name: `部门 ${deptId}`,
    };
  }
}

async function getDingTalkDepartmentParentIds(deptId) {
  try {
    const result = await requestDingTalk("/topapi/v2/department/listparentbydept", {
      dept_id: Number(deptId),
    });
    return (result.parent_id_list || result.parentIdList || [])
      .map((id) => String(id))
      .filter(Boolean);
  } catch (error) {
    // Hierarchy matching is an enhancement; a temporary address-book failure
    // must never prevent login, attachment upload, or reimbursement submission.
    console.warn(`DingTalk department hierarchy unavailable for ${deptId}: ${error.message}`);
    return [];
  }
}

async function getDingTalkDepartmentPath(deptId) {
  const parentIds = await getDingTalkDepartmentParentIds(deptId);
  const ids = [...new Set([...parentIds, String(deptId)])];
  const departments = await Promise.all(ids.map((id) => getDingTalkDepartment(id)));
  return { deptId: String(deptId), departments };
}

async function syncDingTalkUserOrganization(user, requestedDeptIds = null) {
  const deptIds = [...new Set((requestedDeptIds || user?.departments?.map((department) => department.id) || [])
    .map((id) => String(id))
    .filter(Boolean))];
  const organizationPaths = await Promise.all(deptIds.map((deptId) => getDingTalkDepartmentPath(deptId)));
  const leafDepartments = organizationPaths.map((path) => (
    path.departments.find((department) => department.id === path.deptId)
    || { id: path.deptId, name: `部门 ${path.deptId}` }
  ));
  user.departments = leafDepartments;
  user.organizationPaths = organizationPaths;
  return user;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessionCache.entries()) {
    if (session.expiresAt <= now) sessionCache.delete(token);
  }
}

function createSession(user) {
  cleanupSessions();
  const sessionToken = randomUUID();
  sessionCache.set(sessionToken, {
    user,
    expiresAt: Date.now() + sessionTtlMs,
    evidenceByFileId: new Map(),
    documentByFingerprint: new Map(),
    possibleDocumentByFingerprint: new Map(),
  });
  return sessionToken;
}

function getSession(sessionToken) {
  cleanupSessions();
  if (!sessionToken) return null;
  const session = sessionCache.get(sessionToken);
  if (!session) return null;
  return session;
}

function requireRecipientAccountSession(sessionToken) {
  const session = getSession(sessionToken);
  if (!session?.user?.userId) {
    const error = new Error("Missing or expired DingTalk session.");
    error.statusCode = 401;
    throw error;
  }
  return session;
}

function cleanRecipientAccountText(value, maxLength = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeRecipientAccount(input) {
  const accountType = cleanRecipientAccountText(input?.accountType, 40);
  const allowedTypes = new Set(["PERSONAL_BANK_CARD", "CORPORATE_BANK_ACCOUNT", "ALIPAY", "DINGTALK"]);
  if (!allowedTypes.has(accountType)) throw new Error("Unsupported recipient account type.");

  const account = {
    accountType,
    alias: cleanRecipientAccountText(input?.alias, 40),
    accountName: cleanRecipientAccountText(input?.accountName, 80),
    accountNumber: cleanRecipientAccountText(input?.accountNumber, 80).replace(/\s+/g, ""),
    bankName: cleanRecipientAccountText(input?.bankName, 100),
    branchName: cleanRecipientAccountText(input?.branchName, 120),
    province: cleanRecipientAccountText(input?.province, 40),
    city: cleanRecipientAccountText(input?.city, 40),
  };
  if (!account.accountName || !account.accountNumber) {
    throw new Error("收款人/户名和账号为必填项。");
  }
  if (["PERSONAL_BANK_CARD", "CORPORATE_BANK_ACCOUNT"].includes(account.accountType)) {
    if (![account.bankName, account.branchName, account.province, account.city].every(Boolean)) {
      throw new Error("银行卡和对公账户需要填写开户行、开户支行、开户省份和开户城市。");
    }
  }
  return account;
}

async function readRecipientAccountsStore() {
  try {
    const raw = await readFile(recipientAccountsFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, accounts: [] };
    throw new Error("Unable to read recipient accounts store.");
  }
}

async function writeRecipientAccountsStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const tempFile = `${recipientAccountsFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tempFile, recipientAccountsFile);
}

function runRecipientAccountsMutation(mutator) {
  const task = recipientAccountsWriteQueue.then(async () => {
    const store = await readRecipientAccountsStore();
    const result = await mutator(store);
    await writeRecipientAccountsStore(store);
    return result;
  });
  recipientAccountsWriteQueue = task.catch(() => {});
  return task;
}

function accountsForUser(store, userId) {
  return store.accounts
    .filter((account) => account.ownerUserId === userId)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function listRecipientAccounts(session) {
  const store = await readRecipientAccountsStore();
  return { accounts: accountsForUser(store, session.user.userId) };
}

async function saveRecipientAccount(session, accountId, input) {
  const normalized = normalizeRecipientAccount(input);
  return runRecipientAccountsMutation((store) => {
    const now = new Date().toISOString();
    let saved;
    if (accountId) {
      const index = store.accounts.findIndex((account) => account.id === accountId && account.ownerUserId === session.user.userId);
      if (index < 0) throw new Error("Recipient account not found.");
      saved = {
        ...store.accounts[index],
        ...normalized,
        updatedAt: now,
      };
      store.accounts[index] = saved;
    } else {
      saved = {
        id: randomUUID(),
        ownerUserId: session.user.userId,
        ...normalized,
        createdAt: now,
        updatedAt: now,
      };
      store.accounts.push(saved);
    }
    return { account: saved, accounts: accountsForUser(store, session.user.userId) };
  });
}

async function removeRecipientAccount(session, accountId) {
  return runRecipientAccountsMutation((store) => {
    const index = store.accounts.findIndex((account) => account.id === accountId && account.ownerUserId === session.user.userId);
    if (index < 0) throw new Error("Recipient account not found.");
    store.accounts.splice(index, 1);
    return { accounts: accountsForUser(store, session.user.userId) };
  });
}

async function readRelatedReferencesStore() {
  try {
    const raw = await readFile(relatedReferencesFile, "utf8");
    const parsed = JSON.parse(raw);
    return { version: 1, references: Array.isArray(parsed.references) ? parsed.references : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, references: [] };
    throw new Error("Unable to read related approval references store.");
  }
}

async function readRelatedInstanceIndexStore() {
  try {
    const raw = await readFile(relatedInstanceIndexFile, "utf8");
    const parsed = JSON.parse(raw);
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, entries: [] };
    throw new Error("Unable to read related approval instance index.");
  }
}

async function writeRelatedInstanceIndexStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const tempFile = `${relatedInstanceIndexFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tempFile, relatedInstanceIndexFile);
}

function runRelatedInstanceIndexMutation(mutator) {
  const task = relatedInstanceIndexWriteQueue.then(async () => {
    const store = await readRelatedInstanceIndexStore();
    const result = await mutator(store);
    await writeRelatedInstanceIndexStore(store);
    return result;
  });
  relatedInstanceIndexWriteQueue = task.catch(() => {});
  return task;
}

async function indexRelatedApprovalInstances({ userId, processCode, instances }) {
  if (!userId || !processCode || !Array.isArray(instances)) return;
  const now = new Date().toISOString();
  const indexable = instances
    .filter((instance) => instance?.processInstanceId && instance?.businessId)
    .map((instance) => ({
      ownerUserId: userId,
      processCode,
      businessId: String(instance.businessId),
      processInstanceId: String(instance.processInstanceId),
      title: String(instance.title || ""),
      discoveredAt: now,
    }));
  if (!indexable.length) return;

  await runRelatedInstanceIndexMutation((store) => {
    indexable.forEach((entry) => {
      const index = store.entries.findIndex((item) =>
        item.ownerUserId === entry.ownerUserId
        && item.processCode === entry.processCode
        && item.businessId === entry.businessId,
      );
      if (index >= 0) store.entries[index] = { ...store.entries[index], ...entry };
      else store.entries.push(entry);
    });
    return null;
  });
}

async function findIndexedRelatedApprovalInstance({ userId, processCode, businessId }) {
  const normalizedId = String(businessId || "").trim();
  if (!userId || !processCode || !normalizedId) return null;
  const store = await readRelatedInstanceIndexStore();
  return store.entries.find((entry) =>
    entry.ownerUserId === userId
    && entry.processCode === processCode
    && entry.businessId === normalizedId,
  ) || null;
}

async function writeRelatedReferencesStore(store) {
  await mkdir(recipientAccountsDirectory, { recursive: true, mode: 0o700 });
  const tempFile = `${relatedReferencesFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tempFile, relatedReferencesFile);
}

function runRelatedReferencesMutation(mutator) {
  const task = relatedReferencesWriteQueue.then(async () => {
    const store = await readRelatedReferencesStore();
    const result = await mutator(store);
    await writeRelatedReferencesStore(store);
    return result;
  });
  relatedReferencesWriteQueue = task.catch(() => {});
  return task;
}

function extractRelatedInstanceIds(draft) {
  const names = new Set(Array.isArray(draft.related_component_names) ? draft.related_component_names : []);
  const values = Array.isArray(draft.form_component_values) ? draft.form_component_values : [];
  const ids = new Set();
  values.filter((value) => names.has(value.name)).forEach((value) => {
    try {
      const parsed = JSON.parse(value.extValue || "{}");
      (parsed.list || []).forEach((item) => {
        if (item?.procInstId) ids.add(String(item.procInstId));
      });
    } catch {
      // A malformed optional relationship value must not block the approval itself.
    }
  });
  return [...ids];
}

async function recordRelatedApprovalReferences(session, draft, reimbursementInstanceId) {
  const relatedInstanceIds = extractRelatedInstanceIds(draft);
  const ownerUserId = String(session?.submissionRoute?.subjectUserId || session?.user?.userId || "");
  if (!relatedInstanceIds.length || !ownerUserId) return;
  const now = new Date().toISOString();
  await runRelatedReferencesMutation((store) => {
    relatedInstanceIds.forEach((relatedInstanceId) => {
      const exists = store.references.some((reference) =>
        reference.ownerUserId === ownerUserId &&
        reference.relatedInstanceId === relatedInstanceId &&
        reference.reimbursementInstanceId === reimbursementInstanceId,
      );
      if (!exists) {
        store.references.push({
          ownerUserId,
          relatedInstanceId,
          relatedProcessCode: String(draft.related_source_process_code || ""),
          reimbursementInstanceId: String(reimbursementInstanceId),
          reimbursementProcessCode: String(draft.process_code || ""),
          createdAt: now,
        });
      }
    });
    return null;
  });
}

function isReleasedReimbursementInstance(instance = {}) {
  const status = String(instance.status || "").trim().toUpperCase();
  const result = String(instance.result || "").trim().toUpperCase();
  const releasedStates = new Set([
    "TERMINATED", "CANCELED", "CANCELLED", "DELETED", "REVOKED", "WITHDRAWN",
    "REFUSED", "REFUSE", "REJECTED",
  ]);
  return releasedStates.has(status) || releasedStates.has(result);
}

async function reconcileRelatedApprovalReferences(session) {
  const userId = session?.user?.userId;
  if (!userId) return { releasedCount: 0 };

  const store = await readRelatedReferencesStore();
  const candidates = store.references.filter((reference) => reference.ownerUserId === userId);
  const reimbursementIds = [...new Set(candidates.map((reference) => reference.reimbursementInstanceId).filter(Boolean))];
  if (!reimbursementIds.length) return { releasedCount: 0 };

  const releasedReimbursementIds = new Set();
  await Promise.all(reimbursementIds.map(async (instanceId) => {
    try {
      const instance = await getDingTalkProcessInstance(instanceId);
      if (isReleasedReimbursementInstance(instance)) releasedReimbursementIds.add(instanceId);
    } catch (error) {
      // An unreadable target instance is never released automatically. This
      // preserves the duplicate-reimbursement guard when DingTalk is transient.
      console.warn(`Related reference reconciliation skipped ${instanceId}: ${error.message}`);
    }
  }));

  if (!releasedReimbursementIds.size) return { releasedCount: 0 };
  return runRelatedReferencesMutation((latestStore) => {
    const before = latestStore.references.length;
    latestStore.references = latestStore.references.filter((reference) => !(
      reference.ownerUserId === userId && releasedReimbursementIds.has(reference.reimbursementInstanceId)
    ));
    return { releasedCount: before - latestStore.references.length };
  });
}

async function getRelatedReferenceMap(userId, processCode) {
  const store = await readRelatedReferencesStore();
  return new Map(
    store.references
      .filter((reference) => reference.ownerUserId === userId && (!processCode || reference.relatedProcessCode === processCode))
      .map((reference) => [reference.relatedInstanceId, reference]),
  );
}

async function loginDingTalkUser(authCode) {
  if (!authCode) throw new Error("Missing DingTalk authCode.");

  const authUser = await getDingTalkUserByAuthCode(authCode);
  const userId = authUser.userId;
  const detail = await getDingTalkUserDetail(userId);
  const deptIds = (detail.dept_id_list || detail.deptIdList || []).map((id) => String(id));
  const user = {
    userId,
    unionId: authUser.unionId || detail.unionid || detail.unionId || "",
    name: detail.name || detail.realName || userId,
    departments: [],
    organizationPaths: [],
  };
  await syncDingTalkUserOrganization(user, deptIds);
  const socialCompanyRecognition = await recognizeSocialPaymentCompany(userId);
  user.socialCompanyRecognition = socialCompanyRecognition;
  recordApplicationAuditEvent({
    session: { user },
    id: `social-company-login:${userId}:${socialCompanyRecognition.checkedAt}`,
    eventType: "social_company_recognition",
    action: "login_lookup",
    status: socialCompanyRecognition.status,
    companyName: socialCompanyRecognition.companyName || "",
  });

  return {
    sessionToken: createSession(user),
    user,
    socialCompanyRecognition,
    onBehalf: {
      enabled: canUseOnBehalf({ user }),
      policy: "subject-route-v1",
    },
  };
}

async function getApprovalAttachmentSpace(session) {
  const accessToken = await getDingTalkAccessToken();
  const workflow = dingtalk.workflow_1_0;
  const client = createDingTalkSdkClient(workflow);
  const request = new workflow.GetAttachmentSpaceRequest({
    agentId: Number(getConfig("DINGTALK_AGENT_ID", "agentId")),
    userId: session.user.userId,
  });
  const headers = new workflow.GetAttachmentSpaceHeaders({
    xAcsDingtalkAccessToken: accessToken,
  });
  const response = await client.getAttachmentSpaceWithOptions(request, headers, createRuntimeOptions());
  const spaceId = response?.body?.result?.spaceId;
  if (!spaceId) throw new Error(`DingTalk attachment space failed: ${JSON.stringify(response?.body || response)}`);
  return String(spaceId);
}

function buildUploadHeaders(headers = {}) {
  const uploadHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) uploadHeaders[key] = String(value);
  }
  return uploadHeaders;
}

function buildApprovalAttachment(dentry, fallback) {
  const extension = (dentry?.extension || extname(fallback.name).replace(".", "") || "file").toLowerCase();
  const fileSize = Number(dentry?.size || fallback.size || 0);
  return {
    spaceId: String(dentry?.spaceId || fallback.spaceId),
    fileId: String(dentry?.id || dentry?.uuid || ""),
    fileName: dentry?.name || fallback.name,
    fileSize: String(Number.isFinite(fileSize) ? fileSize : 0),
    fileType: extension,
  };
}

function parseApprovalComponentValue(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function collectApprovalFieldPairs(formComponentValues = []) {
  const pairs = [];
  const seen = new Set();
  const add = (label, value) => {
    const normalizedLabel = String(label || "").replace(/\s+/g, " ").trim();
    const normalizedValue = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalizedLabel || !normalizedValue) return;
    const key = `${normalizedLabel}\u0000${normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ label: normalizedLabel, value: normalizedValue });
  };
  const walk = (label, value) => {
    const parsed = parseApprovalComponentValue(value);
    if (Array.isArray(parsed)) {
      parsed.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          if (label) add(label, entry);
          return;
        }
        if (Array.isArray(entry.rowValue)) {
          walk("", entry.rowValue);
          return;
        }
        const entryLabel = entry.props?.label || entry.label || entry.name || label;
        if (entry.value !== undefined) {
          walk(entryLabel, entry.value);
          return;
        }
        if (entry.props && entryLabel) {
          walk(entryLabel, entry.props.value ?? entry.props.text ?? "");
        }
      });
      return;
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.rowValue)) {
        walk("", parsed.rowValue);
        return;
      }
      if (parsed.value !== undefined) {
        walk(parsed.label || parsed.name || label, parsed.value);
        return;
      }
      if (label) add(label, parsed.text || parsed.name || "");
      return;
    }
    if (label) add(label, parsed);
  };
  (Array.isArray(formComponentValues) ? formComponentValues : []).forEach((item) => {
    if (!item || typeof item !== "object") return;
    walk(item.name || item.label || "", item.value);
  });
  return pairs;
}

function firstTravelFieldValue(pairs, pattern, excludedPattern = null) {
  return pairs.find((pair) => pattern.test(pair.label) && !(excludedPattern && excludedPattern.test(pair.label)))?.value || "";
}

function normalizeApprovalTravelInfo(formComponentValues = []) {
  const pairs = collectApprovalFieldPairs(formComponentValues);
  const combinedRoutePattern = /(?:出发地.*目的地|起点.*终点|出发.*到达)/i;
  const startDate = firstTravelFieldValue(pairs, /(?:出差|行程)?(?:开始|起始|出发)(?:日期|时间)?$/i);
  const endDate = firstTravelFieldValue(pairs, /(?:出差|行程)?(?:结束|终止|返回|返程)(?:日期|时间)?$/i);
  const explicitDate = firstTravelFieldValue(pairs, /^(?:出差|行程)?(?:日期|时间|起止日期|行程日期)$/i);
  const departure = firstTravelFieldValue(pairs, /(?:出发地|出发城市|出发地点|始发地|出发站|起点)/i, combinedRoutePattern);
  const destination = firstTravelFieldValue(pairs, /(?:目的地|目的城市|目的地点|到达地|到达城市|终点|终到站)/i, combinedRoutePattern);
  const routePair = pairs.find((pair) => combinedRoutePattern.test(pair.label));
  let routeDeparture = departure;
  let routeDestination = destination;
  if (routePair && (!routeDeparture || !routeDestination)) {
    const parts = routePair.value.split(/\s*(?:至|到|→|->|—|–)\s*/).map((item) => item.trim()).filter(Boolean);
    if (parts.length >= 2) {
      routeDeparture ||= parts[0];
      routeDestination ||= parts[parts.length - 1];
    }
  }
  const date = explicitDate || (startDate && endDate
    ? (startDate === endDate ? startDate : `${startDate} 至 ${endDate}`)
    : startDate || endDate);
  return {
    date,
    startDate,
    endDate,
    departure: routeDeparture,
    destination: routeDestination,
  };
}

function normalizeApprovalInstance(instance = {}, fallbackProcessInstanceId = "") {
  const source = instance.processInstance || instance.process_instance || instance;
  const formComponentValues = (source.formComponentValues || source.form_component_values || []).map((item) => ({
    name: item.name,
    value: item.value,
    componentType: item.componentType || item.component_type,
  }));
  return {
    processInstanceId: String(source.processInstanceId || source.process_instance_id || source.id || fallbackProcessInstanceId || ""),
    processCode: String(source.processCode || source.process_code || ""),
    businessId: String(source.businessId || source.business_id || source.business_id_ext || ""),
    title: source.title || source.processName || source.process_name || "",
    status: source.status || source.statusCode || source.status_code || "",
    result: source.result || "",
    createTime: source.createTime || source.create_time || "",
    finishTime: source.finishTime || source.finish_time || "",
    originatorUserId: source.originatorUserId || source.originator_userid || "",
    formComponentValues,
    travelInfo: normalizeApprovalTravelInfo(formComponentValues),
  };
}

async function getWorkflowClient() {
  const accessToken = await getDingTalkAccessToken();
  const workflow = dingtalk.workflow_1_0;
  return {
    accessToken,
    workflow,
    client: createDingTalkSdkClient(workflow),
  };
}

async function getDingTalkProcessInstance(processInstanceId) {
  if (!processInstanceId) throw new Error("Missing process instance id.");

  const { accessToken, workflow, client } = await getWorkflowClient();
  try {
    const response = await client.getProcessInstanceWithOptions(
      new workflow.GetProcessInstanceRequest({ processInstanceId }),
      new workflow.GetProcessInstanceHeaders({ xAcsDingtalkAccessToken: accessToken }),
      createRuntimeOptions(),
    );
    const instance = response?.body?.result;
    if (!instance) {
      throw new Error(`DingTalk workflow detail failed: ${JSON.stringify(response?.body || response)}`);
    }
    return normalizeApprovalInstance(instance, processInstanceId);
  } catch (workflowError) {
    try {
      const legacy = await requestDingTalk("/topapi/processinstance/get", {
        process_instance_id: processInstanceId,
      });
      return normalizeApprovalInstance(legacy, processInstanceId);
    } catch (legacyError) {
      throw new Error(`workflow=${workflowError.message}; legacy=${legacyError.message}`);
    }
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

async function listDingTalkProcessInstances({ session, userId, processCode, days = 120, maxResults = 20 }) {
  const queryUserId = userId || session?.user?.userId;
  if (!queryUserId) throw new Error("Missing DingTalk user id.");
  if (!processCode) throw new Error("Missing related process code.");

  const { accessToken, workflow, client } = await getWorkflowClient();
  const requestedDays = Math.max(1, Math.min(Number(days) || 119, 365));
  const resultLimit = Math.max(1, Math.min(Number(maxResults) || 20, 60));
  const ids = [];
  const seenIds = new Set();
  let lastRaw = {};
  const windowSizeDays = 119;
  let remainingDays = requestedDays;
  let windowEndTime = Date.now();
  let windowCount = 0;
  let hasMore = false;

  // The DingTalk API accepts at most 120 days per request. Query a longer
  // history as adjacent 119-day windows so users can still select older trips.
  while (remainingDays > 0 && ids.length < resultLimit && windowCount < 4) {
    const windowDays = Math.min(windowSizeDays, remainingDays);
    const windowStartTime = windowEndTime - windowDays * 24 * 60 * 60 * 1000;
    let nextToken = 0;
    let pageCount = 0;

    while (ids.length < resultLimit && pageCount < 12) {
      const response = await client.listProcessInstanceIdsWithOptions(
        new workflow.ListProcessInstanceIdsRequest({
          processCode,
          startTime: windowStartTime,
          endTime: windowEndTime,
          maxResults: Math.min(10, resultLimit - ids.length),
          nextToken,
          userIds: [queryUserId],
        }),
        new workflow.ListProcessInstanceIdsHeaders({ xAcsDingtalkAccessToken: accessToken }),
        createRuntimeOptions(),
      );
      const result = response?.body?.result || {};
      lastRaw = result;
      (result.list || []).forEach((id) => {
        const normalizedId = String(id || "");
        if (normalizedId && !seenIds.has(normalizedId) && ids.length < resultLimit) {
          seenIds.add(normalizedId);
          ids.push(normalizedId);
        }
      });
      pageCount += 1;
      const candidate = result.nextToken ?? result.next_token;
      if (candidate === undefined || candidate === null || candidate === "" || Number(candidate) === 0 || candidate === nextToken) break;
      nextToken = candidate;
      hasMore = true;
    }

    remainingDays -= windowDays;
    windowEndTime = windowStartTime - 1;
    windowCount += 1;
  }
  hasMore = hasMore || remainingDays > 0 || ids.length >= resultLimit;

  const reconciliation = session
    ? await reconcileRelatedApprovalReferences({ ...session, user: { ...session.user, userId: queryUserId } })
    : { releasedCount: 0 };
  const referenceMap = await getRelatedReferenceMap(queryUserId, processCode);
  const instances = await mapWithConcurrency(ids, 4, async (id) => {
    try {
      const detail = await getDingTalkProcessInstance(id);
      const reference = referenceMap.get(detail.processInstanceId || id);
      return {
        ...detail,
        processInstanceId: detail.processInstanceId || id,
        selectable: !reference,
        alreadyReferenced: Boolean(reference),
        reference: reference ? {
          reimbursementInstanceId: reference.reimbursementInstanceId,
          reimbursementProcessCode: reference.reimbursementProcessCode,
          createdAt: reference.createdAt,
        } : null,
        detailAvailable: true,
      };
    } catch (error) {
      console.warn(`Related approval detail failed for ${id}: ${error.message}`);
      const reference = referenceMap.get(id);
      return {
        processInstanceId: id,
        businessId: "",
        title: "",
        status: "UNKNOWN",
        selectable: !reference,
        alreadyReferenced: Boolean(reference),
        detailAvailable: false,
        error: error.message,
      };
    }
  });
  await indexRelatedApprovalInstances({
    userId: queryUserId,
    processCode,
    instances,
  });
  return {
    processCode,
    userId: queryUserId,
    rangeDays: requestedDays,
    queriedWindowCount: windowCount,
    releasedReferenceCount: reconciliation.releasedCount,
    instances,
    hasMore,
    raw: lastRaw,
  };
}

async function getManualRelatedProcessInstance({ session, instanceId, processCode, userId = "" }) {
  const normalizedId = String(instanceId || "").trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(normalizedId)) {
    throw new Error("审批实例编号格式不正确。");
  }
  if (!processCode) throw new Error("Missing related process code.");
  const queryUserId = String(userId || session.user.userId);
  await reconcileRelatedApprovalReferences({ ...session, user: { ...session.user, userId: queryUserId } });
  const indexed = await findIndexedRelatedApprovalInstance({
    userId: queryUserId,
    processCode,
    businessId: normalizedId,
  });
  const resolvedInstanceId = indexed?.processInstanceId || normalizedId;
  let detail;
  try {
    detail = await getDingTalkProcessInstance(resolvedInstanceId);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/invalidParameter|Parameter error|errcode.?[:=].?400002/i.test(message)) {
      throw new Error("钉钉无法读取该审批。若填写的是审批编号，请先在本应用查询过该审批以建立映射；历史审批需由管理员开通审批事件同步后才能自动补录。");
    }
    throw error;
  }
  if (detail.originatorUserId && detail.originatorUserId !== queryUserId) {
    const error = new Error(queryUserId === String(session.user.userId)
      ? "该审批不是当前钉钉用户发起，不能关联。"
      : "该审批不是所选报销归属人发起，不能关联。");
    error.statusCode = 403;
    throw error;
  }
  if (detail.processCode && detail.processCode !== processCode) {
    const error = new Error("该审批类型与当前报销流程要求的前置审批不一致。");
    error.statusCode = 400;
    throw error;
  }
  const referenceMap = await getRelatedReferenceMap(queryUserId, processCode);
  const reference = referenceMap.get(detail.processInstanceId || resolvedInstanceId);
  return {
    instance: {
      ...detail,
      processInstanceId: detail.processInstanceId || resolvedInstanceId,
      selectable: !reference,
      alreadyReferenced: Boolean(reference),
      reference: reference ? {
        reimbursementInstanceId: reference.reimbursementInstanceId,
        reimbursementProcessCode: reference.reimbursementProcessCode,
        createdAt: reference.createdAt,
      } : null,
      detailAvailable: true,
    },
  };
}

async function uploadFileToDingTalkStorage({ session, file }) {
  if (!session.user.unionId) {
    throw new Error("Current DingTalk user has no unionId; cannot upload approval attachment.");
  }

  const accessToken = await getDingTalkAccessToken();
  const spaceId = await getApprovalAttachmentSpace(session);
  const storage = dingtalk.storage_1_0;
  const client = createDingTalkSdkClient(storage);
  const parentId = "0";
  const buffer = await readFile(file.path);
  const fileName = file.originalFilename || file.name || "attachment";
  const md5 = createHash("md5").update(buffer).digest("hex");
  const headers = { xAcsDingtalkAccessToken: accessToken };

  const uploadInfoRequest = new storage.GetFileUploadInfoRequest({
    multipart: false,
    protocol: "HEADER_SIGNATURE",
    unionId: session.user.unionId,
    option: new storage.GetFileUploadInfoRequestOption({
      preCheckParam: new storage.GetFileUploadInfoRequestOptionPreCheckParam({
        md5,
        name: fileName,
        parentId,
        size: buffer.length,
      }),
      preferIntranet: false,
    }),
  });

  const uploadInfoResponse = await client.getFileUploadInfoWithOptions(
    spaceId,
    uploadInfoRequest,
    new storage.GetFileUploadInfoHeaders(headers),
    createRuntimeOptions(),
  );
  const uploadInfo = uploadInfoResponse?.body;
  const uploadUrl = uploadInfo?.headerSignatureInfo?.resourceUrls?.[0];
  if (!uploadUrl || !uploadInfo.uploadKey) {
    throw new Error(`DingTalk upload info failed: ${JSON.stringify(uploadInfo || uploadInfoResponse)}`);
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: buildUploadHeaders(uploadInfo.headerSignatureInfo.headers),
    body: buffer,
  });
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => "");
    throw new Error(`DingTalk storage upload failed: ${uploadResponse.status} ${errorText}`);
  }

  const commitResponse = await client.commitFileWithOptions(
    spaceId,
    new storage.CommitFileRequest({
      name: fileName,
      parentId,
      uploadKey: uploadInfo.uploadKey,
      unionId: session.user.unionId,
    }),
    new storage.CommitFileHeaders(headers),
    createRuntimeOptions(),
  );
  const dentry = commitResponse?.body?.dentry;
  const attachment = buildApprovalAttachment(dentry, { name: fileName, size: buffer.length, spaceId });
  if (!attachment.fileId) {
    throw new Error(`DingTalk commit file failed: ${JSON.stringify(commitResponse?.body || commitResponse)}`);
  }

  return {
    name: attachment.fileName,
    size: Number(attachment.fileSize),
    attachment,
    raw: {
      spaceId,
      dentry,
    },
  };
}

async function getAttachmentPreviewUrl({ session, spaceId = "", fileId = "", evidenceToken = "" }) {
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Missing DingTalk attachment file id.");
    error.statusCode = 400;
    throw error;
  }
  let record = session?.evidenceByFileId?.get(normalizedFileId) || null;
  if (!record && evidenceToken) {
    try {
      record = verifyEvidenceToken(evidenceToken);
    } catch {
      record = null;
    }
  }
  if (!record || String(record.fileId || "") !== normalizedFileId || String(record.userId || "") !== String(session?.user?.userId || "")) {
    const error = new Error("该附件不属于当前登录会话，无法预览。");
    error.statusCode = 403;
    throw error;
  }
  const recordSpaceId = String(record.spaceId || "").trim();
  const normalizedSpaceId = String(spaceId || recordSpaceId).trim();
  if (!normalizedSpaceId || (recordSpaceId && normalizedSpaceId !== recordSpaceId)) {
    const error = new Error("附件存储空间校验失败，无法预览。");
    error.statusCode = 403;
    throw error;
  }
  if (!session?.user?.unionId) {
    const error = new Error("当前钉钉用户缺少 unionId，无法预览附件。");
    error.statusCode = 401;
    throw error;
  }

  const accessToken = await getDingTalkAccessToken();
  const storage = dingtalk.storage_1_0;
  const client = createDingTalkSdkClient(storage);
  const response = await client.getFileDownloadInfoWithOptions(
    normalizedSpaceId,
    normalizedFileId,
    new storage.GetFileDownloadInfoRequest({
      unionId: session.user.unionId,
      option: new storage.GetFileDownloadInfoRequestOption({ preferIntranet: false }),
    }),
    new storage.GetFileDownloadInfoHeaders({ xAcsDingtalkAccessToken: accessToken }),
    createRuntimeOptions(),
  );
  const info = response?.body?.headerSignatureInfo || {};
  const url = info.resourceUrls?.[0] || info.internalResourceUrls?.[0] || "";
  if (!url) throw new Error(`DingTalk attachment preview URL unavailable: ${JSON.stringify(response?.body || response)}`);
  return {
    url,
    fileName: String(record.fileName || ""),
    fileType: String(record.fileType || ""),
    mimeType: String(record.fileType || "").toLowerCase(),
    expiresIn: Number(info.expirationSeconds || 0) || 0,
  };
}

async function uploadApprovalFiles(request) {
  const { fields, files } = await parseMultipartRequest(request);
  const session = getSession(firstField(fields, "session_token"));
  if (!session) throw new Error("Missing or expired DingTalk session.");

  const kind = firstField(fields, "kind") || "file";
  const noInvoiceWorkflow = firstField(fields, "no_invoice") === "1";
  // 仅用于审计定位，不参与附件归属或审批载荷；实际归属仍由前端明细关联和
  // 提交时的凭证 token 共同校验。
  const targetRowId = cleanSubmissionText(firstField(fields, "target_row_id"), 120);
  const clientTraceId = cleanSubmissionText(firstField(fields, "trace_id"), 120);
  const incoming = Object.values(files || {}).flat();
  if (!incoming.length) throw new Error("No upload file found.");

  const uploaded = [];
  let uploadError = null;
  try {
    for (const file of incoming) {
      const contentHash = await hashUploadedFile(file.path);
      // 完全相同的二次选择先按内容哈希复用原回执，避免又上传一次、又做一次 OCR。
      // 这不会像旧前端那样静默跳过：仍返回可直接写入当前明细的确认结果。
      const contentIdentity = buildDocumentIdentity({}, file.originalFilename || file.name, contentHash);
      let confirmedDuplicate = findConfirmedUploadedDocument(session, contentIdentity);
      if (confirmedDuplicate) {
        const processingEvent = createEvidenceProcessingEvent({
          session,
          action: "confirmed_duplicate",
          canonical: confirmedDuplicate,
          duplicateFileName: file.originalFilename || file.name,
          matchReasons: confirmedDuplicate.matchReasons,
        });
        uploaded.push({
          kind: confirmedDuplicate.record.kind,
          originalKind: kind,
          reclassified: confirmedDuplicate.record.kind !== kind,
          reclassificationMessage: confirmedDuplicate.record.kind !== kind
            ? "检测到该文件与已上传发票内容相同，已从付款区移除并自动合并，不会重复计入金额。"
            : "",
          classificationMessage: "检测到同一凭证的不同版本，系统已保留先上传版本，本文件未重复添加。",
          duplicate: true,
          duplicateOfFileId: confirmedDuplicate.record.fileId,
          duplicateOfFileName: confirmedDuplicate.record.fileName,
          duplicateReasons: confirmedDuplicate.matchReasons,
          processingEventToken: processingEvent.token,
          ocr: confirmedDuplicate.ocr || {},
          evidenceToken: confirmedDuplicate.token,
          name: confirmedDuplicate.record.fileName,
          size: Number(confirmedDuplicate.attachment?.fileSize || 0),
          attachment: confirmedDuplicate.attachment,
        });
        continue;
      }
      const ocr = await recognizeUploadedFile({ kind, file });
      const resolved = applyDocumentClassification(kind, ocr, file.originalFilename || file.name);
      if (kind === "payment" && resolved.kind !== "payment" && noInvoiceWorkflow) {
        const error = new Error("检测到该文件不是付款凭证，不能用于无票报销。文件未上传钉钉，请上传实际的支付成功记录、订单实付页面或银行付款凭证。");
        error.statusCode = 422;
        throw error;
      }
      const identity = buildDocumentIdentity(ocr, file.originalFilename || file.name, contentHash);
      confirmedDuplicate = findConfirmedUploadedDocument(session, identity);
      let possibleDuplicate = findPossibleUploadedDocument(session, identity);
      const result = await uploadFileToDingTalkStorage({ session, file });
      const concurrentDuplicate = findConfirmedUploadedDocument(session, identity);
      if (concurrentDuplicate) {
        const processingEvent = createEvidenceProcessingEvent({
          session,
          action: "confirmed_duplicate",
          canonical: concurrentDuplicate,
          duplicateFileName: file.originalFilename || file.name,
          matchReasons: concurrentDuplicate.matchReasons,
        });
        uploaded.push({
          kind: concurrentDuplicate.record.kind,
          originalKind: kind,
          reclassified: concurrentDuplicate.record.kind !== kind,
          reclassificationMessage: concurrentDuplicate.record.kind !== kind
            ? "检测到该文件与已上传发票内容相同，已从付款区移除并自动合并，不会重复计入金额。"
            : "",
          classificationMessage: "检测到同一凭证的不同版本，系统已保留先上传版本，本文件未重复添加。",
          duplicate: true,
          duplicateOfFileId: concurrentDuplicate.record.fileId,
          duplicateOfFileName: concurrentDuplicate.record.fileName,
          duplicateReasons: concurrentDuplicate.matchReasons,
          processingEventToken: processingEvent.token,
          ocr,
          evidenceToken: concurrentDuplicate.token,
          name: concurrentDuplicate.record.fileName,
          size: Number(concurrentDuplicate.attachment?.fileSize || 0),
          attachment: concurrentDuplicate.attachment,
        });
        continue;
      }
      possibleDuplicate = possibleDuplicate || findPossibleUploadedDocument(session, identity);
      const evidence = createUploadedEvidence({
        session,
        originalKind: kind,
        resolvedKind: resolved.kind,
        ocr,
        attachment: result.attachment,
        identity,
        possibleDuplicate,
      });
      let archive = null;
      try {
        // The archive is deliberately best-effort.  A successful DingTalk
        // attachment/OCR result remains successful even when diagnostics
        // storage is temporarily unavailable.
        archive = await adminWorkbench?.archiveAttachment({
          traceId: clientTraceId,
          ownerUserId: String(session.user.userId || ""),
          ownerName: String(session.user.name || ""),
          workflowId: "",
          workflowTitle: "",
          filePath: file.path,
          fileName: file.originalFilename || file.name,
          mimeType: file.mimeType || file.mimetype || "",
          size: Number(file.size || result.size || 0),
          contentHash,
          ocr,
          kind: resolved.kind,
          attachmentFileId: result.attachment?.fileId || "",
        }) || null;
      } catch (archiveError) {
        console.error(`Attachment archive failed without affecting upload: ${archiveError.message}`);
      }
      const roleMessages = {
        tax_invoice: "检测到该文件是税务发票，已自动归入“发票附件”。请继续上传真实的付款凭证。",
        title_exempt_transport_receipt: "检测到该文件是铁路电子客票等免抬头交通票据，已归入“发票附件”并计入票据金额；不参与发票抬头校验。",
        supporting_document: "检测到该文件是行程单/佐证材料，已保留在发票附件中，但不会计入税务发票金额。",
        payment: "检测到该文件是付款凭证，已自动归入“付款截图/订单截图”。",
      };
      uploaded.push({
        kind: resolved.kind,
        originalKind: kind,
        reclassified: resolved.reclassified,
        reclassificationMessage: resolved.reclassified ? (roleMessages[resolved.detection.role] || "") : "",
        classificationMessage: roleMessages[resolved.detection.role] || "",
        possibleDuplicateOfFileId: evidence.record.possibleDuplicateOfFileId,
        possibleDuplicateOfFileName: evidence.record.possibleDuplicateOfFileName,
        duplicateReasons: evidence.record.possibleDuplicateMatchReasons,
        ocr,
        evidenceToken: evidence.token,
        archive: archive?.archived ? { archived: true, artifactId: archive.artifactId, expiresAt: archive.expiresAt } : { archived: false },
        ...result,
      });
    }
  } catch (error) {
    uploadError = error;
    throw error;
  } finally {
    await Promise.allSettled(incoming.map((file) => unlink(file.path)));
    recordApplicationAuditEvent({
      session,
      eventType: "upload",
      status: uploadError ? "failed" : "success",
      summary: {
        requestedKind: kind,
        targetRowId,
        fileCount: incoming.length,
        files: (uploadError ? incoming : uploaded).slice(0, 50).map((file) => ({
          name: cleanSubmissionText(file.name || file.originalFilename, 160),
          size: Math.max(0, Number(file.size || file.attachment?.fileSize) || 0),
          kind: cleanSubmissionText(file.kind || kind, 32),
          duplicate: Boolean(file.duplicate),
          reclassified: Boolean(file.reclassified),
          documentRole: cleanSubmissionText(file.ocr?.documentRole, 48),
          countableAmount: formatMoney(file.ocr?.countableAmount),
        })),
      },
      reasonCode: uploadError ? "upload_failed" : "",
      reason: uploadError ? cleanSubmissionText(uploadError.message, 300) : "",
    });
  }

  return { files: uploaded };
}

function getPublicDingTalkConfig() {
  return {
    corpId: getConfig("DINGTALK_CORP_ID", "corpId"),
    agentId: getConfig("DINGTALK_AGENT_ID", "agentId"),
  };
}

function getOcrStatus() {
  const config = getOcrConfig();
  return {
    provider: config.provider,
    enabled: config.provider === "aliyun" && Boolean(config.accessKeyId && config.accessKeySecret),
    endpoint: config.provider === "aliyun" ? config.endpoint : "",
    note: config.provider === "aliyun" ? "阿里云OCR已配置：专用识别优先，失败或无金额时降级到通用识别；仅接受带金额标识的文件名兜底。" : "OCR云服务未配置，当前仅做带金额标识的文件名/文本金额兜底提取。",
  };
}

function getEvidenceSigningSecret() {
  return getConfig("EVIDENCE_SIGNING_SECRET", "evidenceSigningSecret")
    || getConfig("DINGTALK_APP_SECRET", "appSecret")
    || getConfig("DINGTALK_CLIENT_SECRET", "clientSecret");
}

function signEvidenceRecord(record) {
  const secret = getEvidenceSigningSecret();
  if (!secret) throw new Error("Missing server evidence signing secret.");
  const payload = Buffer.from(JSON.stringify(record), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyEvidenceToken(token) {
  const secret = getEvidenceSigningSecret();
  if (!secret) throw new Error("Missing server evidence signing secret.");
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) throw new Error("凭证识别记录无效，请重新上传该附件。");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("凭证识别记录签名无效，请重新上传该附件。");
  }
  const record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (record.v !== 1 || !record.fileId || !record.userId || !record.issuedAt) {
    throw new Error("凭证识别记录不完整，请重新上传该附件。");
  }
  if (Date.now() - Number(record.issuedAt) > 7 * 24 * 60 * 60 * 1000) {
    throw new Error("凭证识别记录已过期，请重新上传该附件。");
  }
  return record;
}

function getConfirmedIdentityKeys(identity = {}) {
  return [identity.semanticFingerprint, identity.contentFingerprint].filter(Boolean);
}

function findConfirmedUploadedDocument(session, identity) {
  const index = session?.documentByFingerprint;
  if (!index) return null;
  for (const key of getConfirmedIdentityKeys(identity)) {
    const existing = index.get(key);
    if (existing) {
      return {
        ...existing,
        matchReasons: key.startsWith("content:")
          ? ["文件内容完全一致"]
          : identity.matchReasons,
      };
    }
  }
  return null;
}

function findPossibleUploadedDocument(session, identity) {
  if (!identity?.possibleFingerprint) return null;
  const existing = session?.possibleDocumentByFingerprint?.get(identity.possibleFingerprint);
  if (!existing) return null;
  return {
    ...existing,
    matchReasons: identity.possibleFingerprint.startsWith("invoice-review-parties-amount:")
      ? ["购销双方税号和价税合计一致，但其中一份未识别到完整发票号码/日期"]
      : ["关键主体、日期和金额高度相似，但唯一编号不完整"],
  };
}

function indexUploadedDocument(session, identity, uploadedDocument) {
  if (!session.documentByFingerprint) session.documentByFingerprint = new Map();
  if (!session.possibleDocumentByFingerprint) session.possibleDocumentByFingerprint = new Map();
  getConfirmedIdentityKeys(identity).forEach((key) => {
    session.documentByFingerprint.set(key, uploadedDocument);
  });
  if (identity?.possibleFingerprint) {
    session.possibleDocumentByFingerprint.set(identity.possibleFingerprint, uploadedDocument);
  }
}

function createEvidenceProcessingEvent({
  session,
  action,
  canonical,
  duplicateFileName,
  matchReasons = [],
}) {
  const record = {
    v: 1,
    recordType: "processing_event",
    action,
    userId: String(session?.user?.userId || ""),
    fileId: String(canonical?.record?.fileId || ""),
    canonicalFileName: String(canonical?.record?.fileName || ""),
    duplicateFileName: String(duplicateFileName || ""),
    documentRole: String(canonical?.record?.documentRole || "unknown"),
    matchReasons: Array.isArray(matchReasons) ? matchReasons.map(String).slice(0, 4) : [],
    issuedAt: Date.now(),
  };
  return { record, token: signEvidenceRecord(record) };
}

function createUploadedEvidence({
  session,
  originalKind,
  resolvedKind,
  ocr,
  attachment,
  identity = {},
  possibleDuplicate = null,
}) {
  const record = {
    v: 1,
    userId: String(session?.user?.userId || ""),
    fileId: String(attachment?.fileId || ""),
    fileName: String(attachment?.fileName || ""),
    spaceId: String(attachment?.spaceId || ""),
    fileType: String(attachment?.fileType || ""),
    fileSize: String(attachment?.fileSize || ""),
    originalKind: String(originalKind || ""),
    kind: String(resolvedKind || ""),
    documentRole: String(ocr?.documentRole || "unknown"),
    roleConfidence: String(ocr?.roleConfidence || ""),
    recognizedAmount: formatMoney(ocr?.recognizedAmount || ocr?.amount),
    countableAmount: formatMoney(ocr?.countableAmount),
    candidateAmount: formatMoney(ocr?.candidateAmount),
    candidateAmounts: Array.isArray(ocr?.candidateAmounts)
      ? ocr.candidateAmounts.map(formatMoney).filter(Boolean).slice(0, 12)
      : [],
    paymentDecision: String(ocr?.decision || ""),
    invoiceLedger: ocr?.invoiceLedger && typeof ocr.invoiceLedger === "object"
      ? ocr.invoiceLedger
      : null,
    contentFingerprint: String(identity?.contentFingerprint || ""),
    semanticFingerprint: String(identity?.semanticFingerprint || ""),
    possibleFingerprint: String(identity?.possibleFingerprint || ""),
    identityConfidence: String(identity?.confidence || ""),
    identityMatchReasons: Array.isArray(identity?.matchReasons)
      ? identity.matchReasons.map(String).slice(0, 4)
      : [],
    possibleDuplicateOfFileId: String(possibleDuplicate?.record?.fileId || ""),
    possibleDuplicateOfFileName: String(possibleDuplicate?.record?.fileName || ""),
    possibleDuplicateMatchReasons: Array.isArray(possibleDuplicate?.matchReasons)
      ? possibleDuplicate.matchReasons.map(String).slice(0, 4)
      : [],
    issuedAt: Date.now(),
  };
  if (!record.userId || !record.fileId) throw new Error("Unable to bind OCR evidence to the uploaded attachment.");
  const token = signEvidenceRecord(record);
  if (!session.evidenceByFileId) session.evidenceByFileId = new Map();
  session.evidenceByFileId.set(record.fileId, record);
  const uploadedDocument = {
    record,
    token,
    attachment,
    identity,
    ocr,
  };
  indexUploadedDocument(session, identity, uploadedDocument);
  return { record, token, uploadedDocument };
}

function parseJsonValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeEvidenceRow(row, index) {
  const cells = Array.isArray(row?.rowValue)
    ? row.rowValue
    : Array.isArray(row)
      ? row
      : Array.isArray(row?.details)
        ? row.details
        : [];
  const fields = {};
  cells.forEach((cell) => {
    const key = String(cell?.name || cell?.label || "").trim();
    if (key) fields[key] = cell?.value;
  });
  const findValue = (patterns) => {
    const entry = Object.entries(fields).find(([key]) => patterns.some((pattern) => pattern.test(key)));
    return entry?.[1];
  };
  return {
    index: index + 1,
    reason: String(findValue([/申请事由/, /费用说明/, /报销说明/]) || "").trim(),
    amount: formatMoney(findValue([/^金额(?:（元）|\(元\))?$/, /报销金额/, /申请金额/])),
    invoiceType: String(findValue([/发票类型/]) || "").trim(),
    paymentAttachments: parseJsonValue(findValue([/付款截图/, /订单截图/, /付款凭证/]), []),
    invoiceAttachments: parseJsonValue(findValue([/对应发票/, /^发票附件$/, /发票上传/]), []),
  };
}

function parseApprovalEvidenceRows(draft) {
  const components = Array.isArray(draft?.form_component_values) ? draft.form_component_values : [];
  const table = components.find((item) => {
    if (!item) return false;
    if (/表格|费用明细|差旅.*明细/.test(String(item.name || ""))) {
      const parsed = parseJsonValue(item.value, null);
      return Array.isArray(parsed);
    }
    return false;
  });
  const rows = parseJsonValue(table?.value, []);
  return Array.isArray(rows) ? rows.map(normalizeEvidenceRow) : [];
}

function getEvidenceAttachmentCellKind(cell) {
  const name = String(cell?.name || cell?.label || "");
  if (/付款截图|订单截图|付款凭证/.test(name)) return "payment";
  if (/对应发票|发票附件|发票上传/.test(name)) return "invoice";
  return "";
}

function normalizeBoundEvidenceAttachment(attachment, record) {
  const fileId = getEvidenceAttachmentFileId(attachment);
  if (!fileId || !record) return null;
  const fileSize = Number(attachment?.fileSize || attachment?.size || 0);
  return {
    spaceId: String(attachment?.spaceId || attachment?.space_id || ""),
    fileId,
    fileName: String(attachment?.fileName || attachment?.file_name || record.fileName || "attachment"),
    fileSize: String(Number.isFinite(fileSize) ? fileSize : 0),
    fileType: String(attachment?.fileType || attachment?.file_type || attachment?.extension || "file").toLowerCase(),
  };
}

function reconcileSubmittedAttachmentBindings(draft, session) {
  const bindings = Array.isArray(draft?.attachment_row_bindings) ? draft.attachment_row_bindings : [];
  if (!bindings.length) return draft;
  const evidenceMap = getSubmittedEvidenceMap(draft, session);
  const components = Array.isArray(draft?.form_component_values) ? draft.form_component_values : [];
  let changed = false;
  const reconciledComponents = components.map((component) => {
    if (!/表格|费用明细|差旅.*明细/.test(String(component?.name || ""))) return component;
    const rows = parseJsonValue(component.value, null);
    if (!Array.isArray(rows)) return component;
    const reconciledRows = rows.map((row, rowIndex) => {
      const binding = bindings.find((item) => Number(item?.rowIndex) === rowIndex);
      if (!binding) return row;
      const rowCells = Array.isArray(row) ? row : (Array.isArray(row?.rowValue) ? row.rowValue : row?.details);
      if (!Array.isArray(rowCells)) return row;
      let rowChanged = false;
      const reconciledCells = rowCells.map((cell) => {
        const expectedKind = getEvidenceAttachmentCellKind(cell);
        if (!expectedKind) return cell;
        const directBound = Array.isArray(binding?.[expectedKind === "invoice" ? "invoiceAttachments" : "paymentAttachments"])
          ? binding[expectedKind === "invoice" ? "invoiceAttachments" : "paymentAttachments"]
          : [];
        // The ordinary path uses the row's visible attachment keys.  If a
        // browser redraw has emptied that table field, recover the same file
        // from the signed manifest's target row.  Both sources still require
        // the authenticated file ID and the server OCR kind to match.
        const recoveredBound = [...evidenceMap.values()]
          .filter((record) => record?.submittedTargetRowId === String(binding?.rowId || "") && record.kind === expectedKind)
          .map((record) => record.submittedAttachment)
          .filter(Boolean);
        const bound = [...directBound, ...recoveredBound];
        const existing = parseJsonValue(cell.value, []);
        const merged = Array.isArray(existing) ? [...existing] : [];
        const existingIds = new Set(merged.map(getEvidenceAttachmentFileId).filter(Boolean));
        bound.forEach((attachment) => {
          const fileId = getEvidenceAttachmentFileId(attachment);
          const record = evidenceMap.get(fileId);
          // A browser may only restore an attachment that this user uploaded,
          // whose signed receipt appears in this request, and whose OCR kind
          // agrees with the target cell.  The binding never bypasses validation.
          if (!fileId || existingIds.has(fileId) || record?.kind !== expectedKind) return;
          const normalized = normalizeBoundEvidenceAttachment(attachment, record);
          if (!normalized) return;
          existingIds.add(fileId);
          merged.push(normalized);
          rowChanged = true;
        });
        return rowChanged ? { ...cell, value: JSON.stringify(merged) } : cell;
      });
      if (!rowChanged) return row;
      changed = true;
      if (Array.isArray(row)) return reconciledCells;
      if (Array.isArray(row?.rowValue)) return { ...row, rowValue: reconciledCells };
      return { ...row, details: reconciledCells };
    });
    return changed ? { ...component, value: JSON.stringify(reconciledRows) } : component;
  });
  return changed ? { ...draft, form_component_values: reconciledComponents } : draft;
}

function normalizeApprovalCompanyName(value) {
  return String(value || "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[()（）\[\]【】{}「」『』,.，。·•:：;；'"`]/g, "")
    .replace(/有限责任公司$/u, "有限公司")
    .trim();
}

function normalizeOcrBuyerName(value) {
  // Aliyun's generic OCR sometimes returns the field key and its printed label
  // together with the value (for example:
  // "purchaserName 公司全称:杭州飞途行远企业管理有限公司 100 100").
  // Remove only known buyer-field labels; do not use a generic fuzzy match or
  // discard arbitrary Chinese text, otherwise a genuinely different company
  // could be accepted as an OCR variant.
  return normalizeApprovalCompanyName(String(value || "")
    .replace(/(?:purchaser[\s_-]*name|buyer[\s_-]*name|purchaser|buyer|购买方(?:信息|名称)?|购方(?:信息|名称)?|公司全称|公司名称|单位全称|单位名称|购货单位|购方单位|发票抬头(?:名称)?|抬头(?:名称)?)/giu, ""));
}

function parseCompanyComponentValue(value) {
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) return String(parsed.find((item) => String(item || "").trim()) || "").trim();
  if (parsed && typeof parsed === "object") return String(parsed.name || parsed.value || "").trim();
  return String(parsed || "").trim();
}

function getApprovalPaymentCompanyName(draft) {
  const components = Array.isArray(draft?.form_component_values) ? draft.form_component_values : [];
  const component = components.find((item) => /需要付款的公司名称|付款公司|走账主体|报销公司/.test(String(item?.name || "")));
  return parseCompanyComponentValue(component?.value) || String(draft?.submission_context?.snapshot?.companyName || "").trim();
}

function evaluateInvoiceTitleMatch({ companyName, buyerName }) {
  const expected = normalizeApprovalCompanyName(companyName);
  const actual = normalizeOcrBuyerName(buyerName);
  if (!expected) return { status: "invalid_company", reason: "未选择有效的付款公司" };
  if (!actual) return { status: "unrecognized", reason: "OCR未识别到发票购买方/抬头" };
  if (expected === actual) return { status: "matched", reason: "发票购买方与付款公司一致" };
  // This is intentionally narrower than a generic substring comparison. A
  // complete configured company name may be surrounded only by OCR field
  // labels (removed above) and a numeric coordinate/reading-order suffix.
  // Any remaining Chinese or Latin text still produces a hard mismatch.
  const expectedPosition = actual.indexOf(expected);
  if (expectedPosition >= 0) {
    const residue = `${actual.slice(0, expectedPosition)}${actual.slice(expectedPosition + expected.length)}`;
    if (/^\d{1,20}$/u.test(residue)) {
      return { status: "matched", reason: "发票购买方与付款公司一致（已忽略OCR字段杂讯）", matchMode: "ocr_noise_contained" };
    }
  }
  return { status: "mismatch", reason: "发票购买方与付款公司不一致" };
}

function validateApprovalInvoiceTitles(draft, session) {
  const companyName = getApprovalPaymentCompanyName(draft);
  const normalizedCompany = normalizeApprovalCompanyName(companyName);
  const configuredCompany = APPROVAL_COMPANY_NAMES.find((item) => normalizeApprovalCompanyName(item) === normalizedCompany);
  if (!configuredCompany) {
    const error = new Error("未选择有效的需要付款公司名称，无法执行发票抬头校验。请返回页面从公司清单中选择。");
    error.statusCode = 422;
    throw error;
  }

  const rows = parseApprovalEvidenceRows(draft);
  if (!rows.length) return { enforced: false, companyName: configuredCompany, checkedCount: 0, issues: [] };
  const evidenceMap = getSubmittedEvidenceMap(draft, session);
  const issues = [];
  const checkedFileIds = new Set();
  rows.forEach((row) => {
    for (const attachment of Array.isArray(row.invoiceAttachments) ? row.invoiceAttachments : []) {
      const fileId = getEvidenceAttachmentFileId(attachment);
      if (!fileId || checkedFileIds.has(fileId)) continue;
      checkedFileIds.add(fileId);
      const record = evidenceMap.get(fileId);
      const fileName = String(record?.fileName || attachment?.fileName || fileId || "未知发票");
      if (!record) {
        issues.push({ row: row.index, fileName, reason: "缺少后端OCR识别记录，请重新上传" });
        continue;
      }
      // 行程单、订单等佐证文件和已明确识别的免抬头交通票据不是税务发票，
      // 不要求存在购买方抬头。未知文件仍不能借此绕过校验。
      if (["supporting_document", "title_exempt_transport_receipt"].includes(record.documentRole)) continue;
      if (record.documentRole !== "tax_invoice") {
        issues.push({ row: row.index, fileName, reason: "无法确认这是可校验的税务发票，请补充清晰发票" });
        continue;
      }
      const buyerName = record.invoiceLedger?.buyerName || record.buyerName || "";
      const result = evaluateInvoiceTitleMatch({ companyName: configuredCompany, buyerName });
      if (result.status !== "matched") issues.push({ row: row.index, fileName, buyerName, reason: result.reason });
    }
  });
  if (issues.length) {
    const first = issues[0];
    const error = new Error(`发票抬头校验未通过：第 ${first.row} 行“${first.fileName}”${first.reason}${first.buyerName ? `（OCR购买方：${first.buyerName}）` : ""}。请补充与“${configuredCompany}”一致的发票。`);
    error.statusCode = 422;
    error.invoiceTitleAudit = { enforced: true, companyName: configuredCompany, checkedCount: checkedFileIds.size, issues };
    throw error;
  }
  return { enforced: true, companyName: configuredCompany, checkedCount: checkedFileIds.size, issues: [] };
}

function getEvidenceAttachmentFileId(attachment) {
  return String(attachment?.fileId || attachment?.file_id || "").trim();
}

function getSubmittedEvidenceMap(draft, session) {
  const manifest = Array.isArray(draft?.evidence_manifest) ? draft.evidence_manifest : [];
  // Keep already-open clients compatible during rollout. The backend stores the
  // exact signed-source record at upload time, so an older page that does not yet
  // echo evidence tokens can still be audited without asking the user to reload
  // or upload everything again. Tokens remain the restart-safe path for new pages.
  const evidenceMap = new Map(session?.evidenceByFileId || []);
  manifest.forEach((item) => {
    const fileId = String(item?.fileId || "").trim();
    let record;
    if (item?.token) {
      record = verifyEvidenceToken(item.token);
    } else {
      record = session?.evidenceByFileId?.get(fileId);
    }
    if (!record || record.fileId !== fileId || record.userId !== String(session?.user?.userId || "")) {
      throw new Error(`附件 ${fileId || "未知"} 的后端识别记录不匹配，请重新上传该附件。`);
    }
    const manualAmount = formatMoney(item?.manualAmount);
    const duplicateDecision = ["same", "different"].includes(String(item?.duplicateDecision || ""))
      ? String(item.duplicateDecision)
      : "";
    evidenceMap.set(fileId, {
      ...record,
      submittedTargetRowId: String(item?.targetRowId || ""),
      submittedAttachment: normalizeBoundEvidenceAttachment(item?.attachment, record),
      manualAmount: (
        manualAmount &&
        record.kind === "payment" &&
        ["payment", "unknown"].includes(record.documentRole)
      ) ? manualAmount : "",
      duplicateDecision: record.possibleDuplicateOfFileId ? duplicateDecision : "",
    });
  });
  return evidenceMap;
}

function getEvidenceProcessingEvents(draft, session) {
  const tokens = Array.isArray(draft?.evidence_processing_tokens)
    ? draft.evidence_processing_tokens
    : [];
  return tokens.map((token) => verifyEvidenceToken(token)).filter((record) => {
    if (record.recordType !== "processing_event") return false;
    if (record.userId !== String(session?.user?.userId || "")) {
      throw new Error("凭证自动处理记录与当前用户不匹配。");
    }
    return true;
  });
}

function auditApprovalEvidence(draft, session) {
  const rows = parseApprovalEvidenceRows(draft);
  if (!rows.length) return { enforced: false, rows: [], errors: [], warnings: [], totals: {} };
  const evidenceMap = getSubmittedEvidenceMap(draft, session);
  const processingEvents = getEvidenceProcessingEvents(draft, session);
  const errors = [];
  const warnings = [];
  const usedFileIds = new Set();
  const seenDocumentFingerprints = new Map();
  const excludedFileIds = new Set();
  const duplicateDocuments = processingEvents
    .filter((event) => event.action === "confirmed_duplicate")
    .map((event) => ({
      fileId: "",
      fileName: event.duplicateFileName,
      duplicateOfFileId: event.fileId,
      duplicateOfFileName: event.canonicalFileName,
      source: "upload",
    }));
  const reviewedDistinctDocuments = [];
  const noInvoiceWorkflow = Boolean(draft?.no_invoice);
  const invoiceOnlyWorkflow = Boolean(draft?.invoice_only);
  let declaredTotal = 0;
  let paymentTotal = 0;
  let taxInvoiceTotal = 0;

  const readRecords = (attachments, row, expectedKind) => {
    const records = [];
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
      const fileId = getEvidenceAttachmentFileId(attachment);
      if (!fileId) continue;
      if (usedFileIds.has(fileId)) {
        duplicateDocuments.push({
          fileId,
          fileName: attachment.fileName || fileId,
          duplicateOfFileId: fileId,
          duplicateOfFileName: attachment.fileName || fileId,
          source: "same_file_id",
        });
        continue;
      }
      usedFileIds.add(fileId);
      const record = evidenceMap.get(fileId);
      if (!record) {
        errors.push(`第 ${row.index} 行附件“${attachment.fileName || fileId}”缺少后端OCR识别记录，请重新上传。`);
        continue;
      }
      if (record.kind !== expectedKind) {
        errors.push(
          `第 ${row.index} 行附件“${record.fileName}”识别为${record.kind === "payment" ? "付款凭证" : "发票/佐证材料"}，与上传区域不一致。`,
        );
        continue;
      }
      if (record.possibleDuplicateOfFileId) {
        if (!record.duplicateDecision) {
          errors.push(
            `第 ${row.index} 行附件“${record.fileName}”与“${record.possibleDuplicateOfFileName || record.possibleDuplicateOfFileId}”疑似为同一凭证，请在附件工作台集中确认后再提交。`,
          );
          excludedFileIds.add(record.fileId);
          continue;
        }
        if (record.duplicateDecision === "same") {
          excludedFileIds.add(record.fileId);
          duplicateDocuments.push({
            fileId: record.fileId,
            fileName: record.fileName,
            duplicateOfFileId: record.possibleDuplicateOfFileId,
            duplicateOfFileName: record.possibleDuplicateOfFileName,
            source: "user_confirmed",
          });
          continue;
        }
        reviewedDistinctDocuments.push({
          fileId: record.fileId,
          fileName: record.fileName,
          comparedWithFileId: record.possibleDuplicateOfFileId,
          comparedWithFileName: record.possibleDuplicateOfFileName,
        });
      }
      const fingerprint = record.semanticFingerprint || record.contentFingerprint;
      if (fingerprint) {
        const existing = seenDocumentFingerprints.get(fingerprint);
        if (existing && existing.fileId !== record.fileId) {
          excludedFileIds.add(record.fileId);
          duplicateDocuments.push({
            fileId: record.fileId,
            fileName: record.fileName,
            duplicateOfFileId: existing.fileId,
            duplicateOfFileName: existing.fileName,
            source: "backend",
          });
          continue;
        }
        seenDocumentFingerprints.set(fingerprint, record);
      }
      records.push(record);
    }
    return records;
  };

  const auditedRows = rows.map((row) => {
    const declaredAmount = Number(row.amount || 0);
    const paymentRecords = readRecords(row.paymentAttachments, row, "payment");
    const invoiceRecords = readRecords(row.invoiceAttachments, row, "invoice");
    const rowPaymentTotal = Number(sumMoney(paymentRecords.map((record) => (
      record.manualAmount || record.countableAmount
    )).filter(Boolean)));
    const rowTaxInvoiceTotal = Number(sumMoney(invoiceRecords
      .filter((record) => ["tax_invoice", "title_exempt_transport_receipt"].includes(record.documentRole))
      .map((record) => record.countableAmount)
      .filter(Boolean)));
    const supportingDocuments = invoiceRecords.filter((record) => record.documentRole === "supporting_document");
    const unknownInvoiceDocuments = invoiceRecords.filter((record) => record.documentRole === "unknown");
    const requiresInvoice = invoiceOnlyWorkflow || (!noInvoiceWorkflow && row.invoiceType !== "无");
    const label = `第 ${row.index} 行${row.reason ? `“${row.reason}”` : ""}`;

    if (invoiceOnlyWorkflow) {
      if (!invoiceRecords.some((record) => record.documentRole === "tax_invoice")) {
        errors.push(`${label}没有可验证的税务发票。采购供应链专属入口每条明细必须上传发票。`);
      } else if (Math.abs(declaredAmount - rowTaxInvoiceTotal) > 0.01) {
        errors.push(
          `${label}填写 ${formatMoney(declaredAmount)} 元，但税务发票合计 ${formatMoney(rowTaxInvoiceTotal)} 元，差额 ${formatMoney(Math.abs(declaredAmount - rowTaxInvoiceTotal))} 元。`,
        );
      }
    } else if (!paymentRecords.length) {
      errors.push(`${label}没有可验证的付款凭证。`);
    } else if (declaredAmount - rowPaymentTotal > 0.01) {
      errors.push(
        `${label}填写 ${formatMoney(declaredAmount)} 元，但付款凭证合计 ${formatMoney(rowPaymentTotal)} 元，仍缺少 ${formatMoney(declaredAmount - rowPaymentTotal)} 元付款凭证。`,
      );
    } else if (rowPaymentTotal - declaredAmount > 0.01) {
      warnings.push(`${label}付款凭证合计 ${formatMoney(rowPaymentTotal)} 元，高于申报金额 ${formatMoney(declaredAmount)} 元，多付 ${formatMoney(rowPaymentTotal - declaredAmount)} 元；系统只按申报金额报销。`);
    }
    if (requiresInvoice && declaredAmount - rowTaxInvoiceTotal > 0.01) {
      const nonCountableInvoiceNames = [...supportingDocuments, ...unknownInvoiceDocuments]
        .map((record) => `“${record.fileName || "未命名附件"}”${record.documentRole === "supporting_document" ? "被识别为行程单/佐证材料" : "未能确认是税务发票"}`)
        .join("、");
      if (nonCountableInvoiceNames) {
        errors.push(`${label}${nonCountableInvoiceNames}，因此不计入发票金额；请补充清晰的税务发票或免抬头交通票据。`);
      } else if (!invoiceRecords.length) {
        errors.push(`${label}没有随本次明细提交可核验的发票附件；请在该行重新补传，等待“发票 OCR 已确认”后再提交。`);
      }
      errors.push(
        `${label}发票/免抬头交通票据合计 ${formatMoney(rowTaxInvoiceTotal) || "0.00"} 元，小于申报金额 ${formatMoney(declaredAmount)} 元，缺少 ${formatMoney(declaredAmount - rowTaxInvoiceTotal)} 元。行程单和其他佐证材料不计入票据金额。`,
      );
    }

    declaredTotal += declaredAmount;
    paymentTotal += rowPaymentTotal;
    taxInvoiceTotal += rowTaxInvoiceTotal;
    return {
      ...row,
      declaredAmount: formatMoney(declaredAmount),
      paymentTotal: formatMoney(rowPaymentTotal),
      taxInvoiceTotal: formatMoney(rowTaxInvoiceTotal),
      requiresInvoice,
      supportingDocumentCount: supportingDocuments.length,
      unknownInvoiceDocumentCount: unknownInvoiceDocuments.length,
    };
  });

  const amountComponent = (draft.form_component_values || []).find((item) => (
    /申请金额|金额（元）|总报销金额/.test(String(item?.name || ""))
  ));
  const applicationAmount = Number(formatMoney(amountComponent?.value) || 0);
  if (applicationAmount > 0 && Math.abs(applicationAmount - declaredTotal) > 0.01) {
    errors.push(
      `申请总金额 ${formatMoney(applicationAmount)} 元与明细合计 ${formatMoney(declaredTotal)} 元不一致。`,
    );
  }

  return {
    enforced: true,
    invoiceOnly: invoiceOnlyWorkflow,
    rows: auditedRows,
    errors,
    warnings,
    totals: {
      declaredAmount: formatMoney(declaredTotal),
      paymentAmount: formatMoney(paymentTotal),
      taxInvoiceAmount: formatMoney(taxInvoiceTotal),
      shortfall: formatMoney(Math.max(0, declaredTotal - taxInvoiceTotal)) || "0.00",
    },
    processing: {
      duplicateCount: duplicateDocuments.length,
      reviewedDistinctCount: reviewedDistinctDocuments.length,
      duplicateDocuments,
      reviewedDistinctDocuments,
    },
    excludedFileIds: [...excludedFileIds],
  };
}

function validateApprovalEvidence(draft, session) {
  const audit = auditApprovalEvidence(draft, session);
  if (audit.errors.length) {
    const error = new Error(`后端凭证校验未通过：${audit.errors[0]}`);
    error.statusCode = 422;
    error.audit = audit;
    throw error;
  }
  return audit;
}

function sanitizeApprovalEvidenceAttachments(draft, excludedFileIds = []) {
  const excluded = new Set((excludedFileIds || []).map(String).filter(Boolean));
  if (!excluded.size) return draft;
  const cloneCells = (cells) => (Array.isArray(cells) ? cells.map((cell) => {
    if (!/付款截图|订单截图|付款凭证|对应发票|发票附件|发票上传/.test(String(cell?.name || cell?.label || ""))) {
      return cell;
    }
    const attachments = parseJsonValue(cell.value, null);
    if (!Array.isArray(attachments)) return cell;
    return {
      ...cell,
      value: JSON.stringify(attachments.filter((attachment) => (
        !excluded.has(getEvidenceAttachmentFileId(attachment))
      ))),
    };
  }) : cells);
  const components = (draft.form_component_values || []).map((component) => {
    if (!/表格|费用明细|差旅.*明细/.test(String(component?.name || ""))) return component;
    const rows = parseJsonValue(component.value, null);
    if (!Array.isArray(rows)) return component;
    const sanitizedRows = rows.map((row) => {
      if (Array.isArray(row)) return cloneCells(row);
      if (Array.isArray(row?.rowValue)) return { ...row, rowValue: cloneCells(row.rowValue) };
      if (Array.isArray(row?.details)) return { ...row, details: cloneCells(row.details) };
      return row;
    });
    return { ...component, value: JSON.stringify(sanitizedRows) };
  });
  return { ...draft, form_component_values: components };
}

function normalizeSubmissionRouteMode(value) {
  const mode = String(value || "self").trim().toLowerCase();
  if (mode === "on_behalf") return "on_behalf";
  if (mode === "admin_originator") return "admin_originator";
  return "self";
}

async function resolveSubmissionRoute(draft = {}, session) {
  const operator = session?.user;
  if (!operator?.userId) throw new Error("DingTalk session expired. Please re-authenticate before submitting the approval.");
  const submittedRoute = draft.submission_route && typeof draft.submission_route === "object"
    ? draft.submission_route
    : {};
  const mode = normalizeSubmissionRouteMode(submittedRoute.mode);
  if (mode === "self") {
    return {
      mode: "self",
      operatorUserId: String(operator.userId),
      subjectUserId: String(operator.userId),
      subjectName: String(operator.name || operator.userId),
      departmentSource: "operator_dingtalk",
      companySource: "operator_social_security",
    };
  }
  if (mode === "admin_originator") {
    // This mode is server-only.  It is backed by a snapshot bit written by the
    // admin manual-case endpoint and therefore cannot be enabled by an
    // employee changing submission_route in their browser.
    if (!session?.adminContext?.enabled || String(session.adminContext.subjectUserId || "") !== String(operator.userId)) {
      const error = new Error("管理员代发起路由只能从受控工作台案件进入。不会借用员工个人 Token。");
      error.statusCode = 403;
      throw error;
    }
    const subject = await getDingTalkEmployeeProfile(operator.userId);
    const requestedDeptId = String(draft.dept_id || submittedRoute.departmentId || submittedRoute.department_id || "").trim();
    const selectedDepartment = subject.departments.find((department) => String(department.id) === requestedDeptId)
      || (subject.departments.length === 1 ? subject.departments[0] : null);
    if (!selectedDepartment) {
      const error = new Error(subject.departments.length
        ? "代发起归属人的部门不唯一，请在案件草稿中指定其钉钉部门。"
        : "未读取到代发起归属人的钉钉部门，无法确定审批路由。");
      error.statusCode = 422;
      throw error;
    }
    const recognition = subject.socialCompanyRecognition || {};
    const selectedCompanyName = getApprovalPaymentCompanyName(draft);
    if (recognition.status === "verified" && !selectedCompanyName) {
      draft.form_component_values = [
        ...(draft.form_component_values || []),
        { name: "需要付款的公司名称", value: JSON.stringify([recognition.companyName]) },
      ];
    }
    if (recognition.status !== "verified" && !selectedCompanyName) {
      const error = new Error("未读取到代发起归属人的有效社保公司，请在案件草稿中填写付款公司。");
      error.statusCode = 422;
      throw error;
    }
    return {
      mode: "admin_originator",
      operatorUserId: String(session.adminContext.operatorUserId || ""),
      operatorName: String(session.adminContext.operatorName || "管理员"),
      subjectUserId: String(subject.userId),
      subjectName: String(subject.name || subject.userId),
      departmentId: String(selectedDepartment.id),
      departmentName: String(selectedDepartment.name || selectedDepartment.id),
      departmentSource: "subject_dingtalk",
      companyName: recognition.status === "verified" && !selectedCompanyName ? recognition.companyName : selectedCompanyName,
      companySource: recognition.status === "verified" && !selectedCompanyName ? "subject_social_security" : "manual_override",
      socialCompanyRecognition: recognition,
      subjectDepartments: subject.departments,
    };
  }
  if (!canUseOnBehalf(session)) {
    const error = new Error("当前账号暂未开通代他人报销入口。");
    error.statusCode = 403;
    throw error;
  }
  const subjectUserId = String(submittedRoute.subjectUserId || submittedRoute.subject_user_id || "").trim();
  if (!subjectUserId) throw new Error("代他人报销必须选择报销归属人。");
  const subject = await getDingTalkEmployeeProfile(subjectUserId);
  const requestedDeptId = String(draft.dept_id || submittedRoute.departmentId || submittedRoute.department_id || "").trim();
  const selectedDepartment = subject.departments.find((department) => String(department.id) === requestedDeptId)
    || (subject.departments.length === 1 ? subject.departments[0] : null);
  if (!selectedDepartment) {
    throw new Error(subject.departments.length
      ? "代报销归属人的部门不唯一，请从该员工的部门清单中选择。"
      : "未读取到代报销归属人的钉钉部门，无法确定审批路由。");
  }
  const recognition = subject.socialCompanyRecognition || {};
  const selectedCompanyName = getApprovalPaymentCompanyName(draft);
  if (recognition.status === "verified" && !selectedCompanyName) {
    draft.form_component_values = [
      ...(draft.form_component_values || []),
      { name: "需要付款的公司名称", value: JSON.stringify([recognition.companyName]) },
    ];
  }
  if (recognition.status !== "verified" && !selectedCompanyName) {
    const error = new Error("未读取到代报销归属人的有效社保公司，请先补全人事花名册或手工选择付款公司。");
    error.statusCode = 422;
    throw error;
  }
  return {
    mode: "on_behalf",
    operatorUserId: String(operator.userId),
    operatorName: String(operator.name || operator.userId),
    subjectUserId,
    subjectName: String(subject.name || subjectUserId),
    departmentId: String(selectedDepartment.id),
    departmentName: String(selectedDepartment.name || selectedDepartment.id),
    departmentSource: "subject_dingtalk",
    companyName: recognition.status === "verified" && !selectedCompanyName ? recognition.companyName : selectedCompanyName,
    companySource: recognition.status === "verified" && !selectedCompanyName ? "subject_social_security" : "manual_override",
    socialCompanyRecognition: recognition,
    subjectDepartments: subject.departments,
  };
}

function normalizeApprovalPayload(draft, session) {
  const sessionUser = session?.user;
  if (!sessionUser?.userId) {
    const error = new Error("DingTalk session expired. Please re-authenticate before submitting the approval.");
    error.statusCode = 401;
    throw error;
  }
  const route = session?.submissionRoute || {};
  const requestedDeptId = String(["on_behalf", "admin_originator"].includes(route.mode) ? route.departmentId || draft.dept_id : draft.dept_id || "");
  const subjectDepartments = route.mode === "on_behalf" ? (route.subjectDepartments || []) : (sessionUser?.departments || []);
  const allowedDepartments = route.mode === "admin_originator"
    ? (route.subjectDepartments || [])
    : subjectDepartments;
  const selectedDepartment =
    allowedDepartments.find((department) => department.id === requestedDeptId) ||
    (allowedDepartments.length === 1 ? allowedDepartments[0] : null);

  // Ordinary submissions always use the authenticated employee.  The only
  // exception is the server-created admin-originator context, where the
  // employee is intentionally the OA originator and the administrator remains
  // an audit/operator identity.
  const originatorUserId = sessionUser.userId;
  const effectiveOriginatorUserId = route.mode === "admin_originator"
    ? String(route.subjectUserId || "")
    : originatorUserId;
  const deptId = selectedDepartment?.id || getConfig("DINGTALK_DEPT_ID", "deptId", draft.dept_id);

  if (sessionUser && !selectedDepartment) {
    throw new Error(["on_behalf", "admin_originator"].includes(route.mode)
      ? "Selected department does not belong to the selected reimbursement owner."
      : "Selected department does not belong to the current DingTalk user.");
  }

  if (!effectiveOriginatorUserId || !deptId) {
    throw new Error("Missing DingTalk originator_user_id or dept_id.");
  }

  return {
    process_code: draft.process_code || getConfig("DINGTALK_PROCESS_CODE", "processCode", "PROC-4E593459-342D-499D-8ADA-6CF0664CCB9B"),
    originator_user_id: effectiveOriginatorUserId,
    dept_id: deptId,
    form_component_values: draft.form_component_values,
    remark: ["on_behalf", "admin_originator"].includes(route.mode)
      ? `[代他人报销] 归属人：${route.subjectName || route.subjectUserId}；操作人：${route.operatorName || sessionUser.name || sessionUser.userId}。${draft.remark || ""}`.trim()
      : draft.remark,
  };
}

function removeRelatedComponents(payload, componentNames = []) {
  const names = new Set(componentNames.filter(Boolean));
  if (!names.size) return payload;
  return {
    ...payload,
    form_component_values: (payload.form_component_values || []).filter((item) => !names.has(item.name)),
  };
}

function looksLikeRelatedComponentError(error) {
  const message = String(error?.message || error || "");
  return /关联审批|组件格式|表单组件|Process form format error|form format|form_component|component/i.test(message);
}

async function postDingTalkApproval(accessToken, payload) {
  const workflow = dingtalk.workflow_1_0;
  const client = createDingTalkSdkClient(workflow);
  const deptId = Number(payload.dept_id);
  const agentId = Number(getConfig("DINGTALK_AGENT_ID", "agentId"));

  const toDetailChild = (item = {}) => new workflow.StartProcessInstanceRequestFormComponentValuesDetailsDetails({
    name: item.name,
    value: item.value === undefined || item.value === null ? "" : String(item.value),
    id: item.id,
    componentType: item.componentType || item.component_type,
    bizAlias: item.bizAlias || item.biz_alias,
    extValue: item.extValue || item.ext_value,
  });

  const toDetailRow = (item = {}) => new workflow.StartProcessInstanceRequestFormComponentValuesDetails({
    name: item.name,
    value: item.value === undefined || item.value === null ? "" : String(item.value),
    id: item.id,
    bizAlias: item.bizAlias || item.biz_alias,
    extValue: item.extValue || item.ext_value,
    details: Array.isArray(item.details) ? item.details.map(toDetailChild) : undefined,
  });

  const formComponentValues = (payload.form_component_values || []).map((item) => {
    const value = item.value === undefined || item.value === null ? "" : String(item.value);
    return new workflow.StartProcessInstanceRequestFormComponentValues({
      name: item.name,
      value,
      id: item.id,
      componentType: item.componentType || item.component_type,
      extValue: item.extValue || item.ext_value,
      details: Array.isArray(item.details) ? item.details.map(toDetailRow) : undefined,
    });
  });

  try {
    const response = await client.startProcessInstanceWithOptions(
      new workflow.StartProcessInstanceRequest({
        processCode: payload.process_code,
        originatorUserId: payload.originator_user_id,
        deptId: Number.isFinite(deptId) ? deptId : payload.dept_id,
        microappAgentId: Number.isFinite(agentId) ? agentId : undefined,
        formComponentValues,
      }),
      new workflow.StartProcessInstanceHeaders({ xAcsDingtalkAccessToken: accessToken }),
      createRuntimeOptions(),
    );
    const instanceId = response?.body?.instanceId;
    if (!instanceId) {
      throw new Error(`DingTalk approval failed: ${JSON.stringify(response?.body || response)}`);
    }
    return {
      errcode: 0,
      errmsg: "ok",
      process_instance_id: instanceId,
      instanceId,
      raw: response?.body,
    };
  } catch (error) {
    const failure = describeDingTalkApprovalFailure(error, payload.process_code);
    const publicError = new Error(`${failure.reason} ${failure.advice}`.trim());
    publicError.statusCode = error?.statusCode || 400;
    publicError.approvalFailure = failure;
    throw publicError;
  }
}

async function prepareDingTalkApprovalForSession(draft, session) {
  if (!session?.user?.userId) {
    const error = new Error("DingTalk session expired. Please re-authenticate before submitting the approval.");
    error.statusCode = 401;
    throw error;
  }
  if (draft?.invoice_only && !getV2UserProfile(session).invoiceOnly) {
    const error = new Error("当前钉钉用户没有使用采购供应链专属报销入口的权限。");
    error.statusCode = 403;
    throw error;
  }
  // Do not rely solely on the browser table render.  A supplemental upload can
  // finish while that render is being rebuilt; use its signed receipt to merge
  // it back into the exact row before any backend audit or OA serialization.
  const reconciledDraft = reconcileSubmittedAttachmentBindings(draft, session);
  const submissionRoute = await resolveSubmissionRoute(reconciledDraft, session);
  const routedDraft = {
    ...reconciledDraft,
    dept_id: submissionRoute.departmentId || reconciledDraft.dept_id,
    submission_route: submissionRoute,
  };
  const routedSession = { ...session, submissionRoute };
  const evidenceAudit = validateApprovalEvidence(routedDraft, routedSession);
  const invoiceTitleAudit = validateApprovalInvoiceTitles(routedDraft, routedSession);
  // Re-read the current HR roster value at the server boundary for audit and
  // change detection.  A mismatch is intentionally warning-only: finance
  // allows a user to select another company for legitimate exceptional cases.
  const socialCompanyRecognition = ["on_behalf", "admin_originator"].includes(submissionRoute.mode)
    ? submissionRoute.socialCompanyRecognition
    : await recognizeSocialPaymentCompany(session.user.userId);
  const selectedCompanyName = getApprovalPaymentCompanyName(routedDraft);
  recordApplicationAuditEvent({
    session,
    id: `social-company-submit:${session.user.userId}:${draft?.submission_id || randomUUID()}`,
    eventType: "social_company_recognition",
    action: "submission_recheck",
    status: socialCompanyRecognition.status,
    companyName: socialCompanyRecognition.companyName || "",
    selectedCompanyName,
    differsFromRecognized: Boolean(
      socialCompanyRecognition.status === "verified"
      && normalizeApprovalCompanyName(socialCompanyRecognition.companyName) !== normalizeApprovalCompanyName(selectedCompanyName),
    ),
  });
  const sanitizedDraft = sanitizeApprovalEvidenceAttachments(routedDraft, evidenceAudit.excludedFileIds);
  // Keep the exact OCR projection that passed validation with the prepared
  // approval.  finalizePreparedApproval intentionally creates a fresh session
  // after DingTalk accepts the form, so relying on the in-memory upload map at
  // that point used to lose the ledger fields on a normal request boundary.
  const ledgerEvidence = [...getSubmittedEvidenceMap(sanitizedDraft, session).entries()]
    .map(([fileId, record]) => [fileId, record]);
  const payload = normalizeApprovalPayload(sanitizedDraft, routedSession);
  if (evidenceAudit.enforced) {
    const totals = evidenceAudit.totals;
    payload.remark = [
      payload.remark,
      `后端凭证校验：付款 ${totals.paymentAmount || "0.00"} 元，税务发票 ${totals.taxInvoiceAmount || "0.00"} 元；行程单和其他佐证材料未计入发票金额。`,
      invoiceTitleAudit.enforced ? `发票抬头校验：已核验 ${invoiceTitleAudit.checkedCount} 张税务发票，均与付款公司“${invoiceTitleAudit.companyName}”一致。` : "",
      evidenceAudit.processing?.duplicateCount
        ? `凭证处理：已排除 ${evidenceAudit.processing.duplicateCount} 份重复凭证，重复附件未写入 OA 且未重复计入金额。`
        : "",
      evidenceAudit.processing?.reviewedDistinctCount
        ? `凭证处理：申请人确认 ${evidenceAudit.processing.reviewedDistinctCount} 组疑似凭证为不同凭证，处理记录已保留。`
        : "",
    ].filter(Boolean).join("；");
  }
  return {
    payload,
    evidenceAudit,
    invoiceTitleAudit,
    socialCompanyRecognition,
    ledgerEvidence,
    draft: { ...sanitizedDraft, session_token: "" },
    user: {
      userId: String(session.user.userId),
      name: String(session.user.name || ""),
      departments: Array.isArray(session.user.departments) ? session.user.departments : [],
      submissionRoute,
    },
  };
}

async function prepareDingTalkApproval(draft) {
  return prepareDingTalkApprovalForSession(draft, getSession(draft.session_token));
}

async function dispatchPreparedDingTalkApproval(prepared) {
  const accessToken = await getDingTalkAccessToken();
  const body = await postDingTalkApproval(accessToken, prepared.payload);
  const finalized = await finalizePreparedApproval(prepared, body.process_instance_id);
  return {
    processInstanceId: body.process_instance_id,
    request: prepared.payload,
    evidenceAudit: prepared.evidenceAudit,
    raw: body,
    invoiceLedger: finalized.invoiceLedger,
  };
}

async function finalizePreparedApproval(prepared, processInstanceId) {
  const session = {
    user: prepared.user,
    submissionRoute: prepared.user?.submissionRoute || prepared.draft?.submission_route || null,
    evidenceByFileId: new Map(Array.isArray(prepared.ledgerEvidence) ? prepared.ledgerEvidence : []),
  };
  const draft = prepared.draft;
  await recordRelatedApprovalReferences(session, draft, processInstanceId);
  const invoiceLedger = await enqueueInvoiceLedgerSync({ session, draft, processInstanceId }).catch((error) => ({
    enabled: getInvoiceLedgerConfig().enabled,
    status: "failed",
    error: error.message,
  }));
  return { invoiceLedger };
}

async function createDingTalkApproval(draft) {
  return dispatchPreparedDingTalkApproval(await prepareDingTalkApproval(draft));
}

function getPreparedApprovalAmount(prepared, draft) {
  const audited = Number(prepared?.evidenceAudit?.totals?.declaredAmount);
  if (Number.isFinite(audited) && audited > 0) return audited;
  const snapshotAmount = Number(draft?.submission_context?.snapshot?.totalAmount);
  return Number.isFinite(snapshotAmount) ? snapshotAmount : 0;
}

function classifyScheduledDispatchFailure(error) {
  const raw = String(error?.message || error || "");
  const failure = describeSubmissionFailure(error);
  const unknown = Boolean(error?.deliveryUnknown) || /timeout|timed out|ECONNRESET|socket hang up|connection reset/i.test(raw);
  const retryable = !unknown && (/429|rate.?limit|too many|temporar|busy|ECONNREFUSED|ENETUNREACH|access.?token/i.test(raw)
    || ["system_busy", "rate_limited", "token_failed"].includes(String(failure.code || "")));
  return { unknown, retryable, failure };
}

async function settleScheduledSubmissionRequest(job, processInstanceId) {
  await runSubmissionRequestMutation((store) => {
    const entry = store.entries.find((item) => item.id === job.submissionId && item.ownerUserId === job.ownerUserId);
    if (!entry) return;
    entry.status = "success";
    entry.resultType = "approval";
    entry.processInstanceId = String(processInstanceId || "");
    entry.scheduledJobId = job.id;
    entry.updatedAt = new Date().toISOString();
  });
}

async function releaseCancelledScheduledSubmissionRequest(job) {
  if (!job?.submissionId || !job?.ownerUserId) return;
  await runSubmissionRequestMutation((store) => {
    const entry = store.entries.find((item) => item.id === job.submissionId && item.ownerUserId === job.ownerUserId);
    // 仅释放仍由该定时任务占用的请求，绝不影响已经实际发起 OA 的记录。
    if (!entry || entry.status !== "success" || entry.resultType !== "scheduled" || entry.scheduledJobId !== job.id) return;
    entry.status = "cancelled";
    entry.processInstanceId = "";
    entry.resultType = "";
    entry.scheduledJobId = "";
    entry.scheduledAt = "";
    entry.trackingCode = "";
    entry.failureReason = "用户已撤销尚未发起 OA 的定时报销，可修改后重新提交。";
    entry.updatedAt = new Date().toISOString();
  });
}

async function dispatchScheduledApproval(job) {
  const result = await dispatchPreparedDingTalkApproval(job.prepared);
  await settleScheduledSubmissionRequest(job, result.processInstanceId);
  await updateScheduledSubmissionHistory(job, { status: "success", processInstanceId: result.processInstanceId });
  // A manual admin-originator case is still a normal scheduled submission.  The
  // queue is the source of truth for dispatch; this sidecar update is only for
  // workbench visibility and must never turn a successful OA call into a retry.
  if (job.context?.adminCaseId) {
    await adminWorkbench?.setCaseStatus(job.context.adminCaseId, "submitted", {
      processInstanceId: result.processInstanceId,
      originatorUserId: job.ownerUserId,
      operatorUserId: job.context.adminOperatorUserId || "",
      routeMode: "admin_originator",
      dispatchMode: "scheduled",
      scheduledJobId: job.id,
    }).catch((error) => console.error(`Admin scheduled case update failed: ${error.message}`));
  }
  return result;
}

async function reconcileUnknownScheduledApproval(job) {
  const config = getScheduledApprovalConfig();
  if (!config.trackingComponentName || !job.trackingCode) return null;
  const result = await listDingTalkProcessInstances({
    userId: job.ownerUserId,
    processCode: job.processCode,
    days: config.reconciliationDays,
    maxResults: config.reconciliationMaxResults,
  });
  const matched = result.instances.find((instance) => (instance.formComponentValues || []).some((item) => (
    String(item.name || "") === config.trackingComponentName
      && String(item.value || "").includes(job.trackingCode)
  )));
  if (!matched?.processInstanceId) return null;
  await finalizePreparedApproval(job.prepared, matched.processInstanceId);
  await settleScheduledSubmissionRequest(job, matched.processInstanceId);
  await updateScheduledSubmissionHistory(job, { status: "success", processInstanceId: matched.processInstanceId });
  return { processInstanceId: matched.processInstanceId, source: "oa_tracking_component" };
}

function ensureScheduledApprovalScheduler() {
  const config = getScheduledApprovalConfig();
  if (!config.enabled) return null;
  if (!scheduledApprovalScheduler) {
    scheduledApprovalScheduler = new ScheduledApprovalScheduler({
      store: getScheduledApprovalStore(),
      dispatch: dispatchScheduledApproval,
      classifyFailure: classifyScheduledDispatchFailure,
      reconcileUnknown: reconcileUnknownScheduledApproval,
      maxAttempts: config.maxAttempts,
    });
  }
  return scheduledApprovalScheduler;
}

async function prepareScheduledOrImmediateApproval(draft, session, reservation) {
  // Use the already authenticated server session passed by the caller.  This
  // is essential for the admin-originator route, whose synthetic employee
  // session is intentionally never placed in the browser session store.
  const prepared = await prepareDingTalkApprovalForSession(draft, session);
  const config = getScheduledApprovalConfig();
  const workflow = getSubmissionWorkflowContext(draft);
  const amount = getPreparedApprovalAmount(prepared, draft);
  const scheduling = getScheduledApprovalDecision(new Date(), config);
  if (!scheduling.scheduled) {
    return { scheduled: false, prepared };
  }
  const jobId = randomUUID();
  const trackingCode = `BX-${jobId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  if (config.trackingComponentName) {
    prepared.payload.form_component_values = [
      ...(prepared.payload.form_component_values || []),
      {
        name: config.trackingComponentName,
        value: trackingCode,
        ...(config.trackingComponentId ? { id: config.trackingComponentId } : {}),
      },
    ];
  }
  const result = getScheduledApprovalStore().createJob({
    id: jobId,
    trackingCode,
    submissionId: reservation.entry.id,
    fingerprint: reservation.entry.fingerprint,
    ownerUserId: String(session.user.userId),
    ownerName: String(session.user.name || ""),
    deptId: String(prepared.payload.dept_id),
    workflowId: workflow.workflowId,
    workflowTitle: workflow.workflowTitle,
    processCode: String(prepared.payload.process_code),
    amount,
    scheduledAt: scheduling.scheduledAt,
    releaseIntervalMs: config.releaseIntervalMs,
    prepared,
    context: {
      submittedAt: new Date().toISOString(),
      companyTimeZone: "Asia/Shanghai",
      scheduledPolicy: "calendar-21-business-hours-v2",
      scheduledReleaseWindow: "09:00-18:00 Asia/Shanghai",
      scheduledBatchKey: scheduling.batchKey,
      scheduledReason: scheduling.reason,
      adminCaseId: String(draft?.submission_context?.adminCaseId || ""),
      adminOperatorUserId: String(draft?.submission_context?.adminOperatorUserId || ""),
      editableDraft: draft?.submission_context?.editableDraft && typeof draft.submission_context.editableDraft === "object"
        ? draft.submission_context.editableDraft
        : null,
    },
    snapshot: sanitizeSubmissionSnapshot(draft?.submission_context?.snapshot),
  });
  await settleSubmissionRequest(reservation, "success", {
    resultType: "scheduled",
    scheduledJobId: result.job.id,
    scheduledAt: result.job.scheduledAt,
    trackingCode: result.job.trackingCode,
  });
  if (result.created) {
    await recordSubmissionHistory({
      session,
      draft,
      status: "scheduled",
      scheduledJobId: result.job.id,
      scheduledAt: result.job.scheduledAt,
    }).catch((error) => console.error(`Scheduled submission history write failed: ${error.message}`));
  }
  return { scheduled: true, job: result.job, idempotent: !result.created };
}

function collectInvoiceLedgerSnapshots(draft, session) {
  // The approval gateway already verifies invoice presence and amount. For ledger
  // sync, the "corresponding invoice upload" field is the source of truth.
  // OCR enriches the row but never decides whether the selected invoice is synced.
  const evidence = new Map(session?.evidenceByFileId || []);
  const manifest = Array.isArray(draft?.evidence_manifest) ? draft.evidence_manifest : [];
  const diagnostics = {
    evidenceRows: 0,
    invoiceAttachmentCount: 0,
    mappedAttachmentCount: 0,
    missingAttachmentIdCount: 0,
    missingEvidenceRecordCount: 0,
    ocrSnapshotCount: 0,
  };
  for (const item of manifest) {
    const fileId = String(item?.fileId || "").trim();
    if (!fileId || !item?.token) continue;
    try {
      const record = verifyEvidenceToken(item.token);
      if (record?.fileId === fileId && record?.userId === String(session?.user?.userId || "")) evidence.set(fileId, record);
    } catch {
      // The approval was already accepted. A stale/missing token must be audited,
      // not turn an invoice attachment into an invisible ledger omission.
    }
  }
  const snapshots = [];
  for (const row of parseApprovalEvidenceRows(draft)) {
    diagnostics.evidenceRows += 1;
    for (const attachment of row.invoiceAttachments || []) {
      diagnostics.invoiceAttachmentCount += 1;
      const fileId = getEvidenceAttachmentFileId(attachment);
      const record = evidence.get(fileId);
      if (!fileId) {
        diagnostics.missingAttachmentIdCount += 1;
        continue;
      }
      diagnostics.mappedAttachmentCount += 1;
      if (!record) diagnostics.missingEvidenceRecordCount += 1;
      if (record?.invoiceLedger) diagnostics.ocrSnapshotCount += 1;
      snapshots.push({
        fileId,
        fileName: String(attachment?.fileName || attachment?.name || record?.fileName || ""),
        snapshot: record?.invoiceLedger || {},
        hasOcrSnapshot: Boolean(record?.invoiceLedger),
        contentFingerprint: String(record?.contentFingerprint || ""),
        semanticFingerprint: String(record?.semanticFingerprint || ""),
      });
    }
  }
  return { snapshots: [...new Map(snapshots.map((item) => [item.fileId, item])).values()], diagnostics };
}

function getInvoiceLedgerSkipReason(diagnostics = {}) {
  if (!diagnostics.evidenceRows) return { code: "no_evidence_rows", message: "The approval has no reimbursement evidence rows." };
  if (!diagnostics.invoiceAttachmentCount) return { code: "no_invoice_attachment", message: "No invoice attachment was selected in reimbursement rows." };
  if (!diagnostics.mappedAttachmentCount) return { code: "invoice_attachment_missing_file_id", message: "Invoice attachments did not contain a usable attachment id." };
  return { code: "duplicate_invoice", message: "Every selected invoice attachment has already been synchronized." };
}

function getLedgerInvoiceDedupKey(item = {}) {
  const snapshot = item.snapshot || {};
  const number = String(snapshot.invoiceNumber || "").trim();
  if (!number) return "";
  return `${number}|${String(snapshot.sellerTaxNumber || "").trim()}`;
}

function getLedgerContentDedupKey(item = {}) {
  return String(item.contentFingerprint || "").trim();
}

async function filterDuplicateInvoiceLedgerItems(eventId, items) {
  return runInvoiceLedgerMutation((store) => {
    const current = store.events.find((item) => item.eventId === eventId);
    const existingFileIds = new Set();
    const existingInvoiceKeys = new Set();
    const existingContentKeys = new Set();
    for (const event of store.events) {
      if (event.eventId === eventId || !["pending", "synced", "synced_partial"].includes(event.status)) continue;
      for (const item of event.items || []) {
        if (item?.fileId) existingFileIds.add(String(item.fileId));
        const key = getLedgerInvoiceDedupKey(item);
        if (key) existingInvoiceKeys.add(key);
        const contentKey = getLedgerContentDedupKey(item);
        if (contentKey) existingContentKeys.add(contentKey);
      }
    }
    const accepted = [];
    const duplicates = [];
    for (const item of items) {
      const fileId = String(item?.fileId || "");
      const invoiceKey = getLedgerInvoiceDedupKey(item);
      const contentKey = getLedgerContentDedupKey(item);
      if (existingFileIds.has(fileId) || (contentKey && existingContentKeys.has(contentKey)) || (invoiceKey && existingInvoiceKeys.has(invoiceKey))) {
        const reason = existingFileIds.has(fileId)
          ? "attachment_already_synced"
          : contentKey && existingContentKeys.has(contentKey)
            ? "invoice_content_already_synced"
            : "invoice_number_already_synced";
        duplicates.push({ fileId, fileName: item.fileName || "", reason });
        continue;
      }
      accepted.push(item);
      existingFileIds.add(fileId);
      if (invoiceKey) existingInvoiceKeys.add(invoiceKey);
      if (contentKey) existingContentKeys.add(contentKey);
    }
    if (current) current.duplicateItems = duplicates;
    return { accepted, duplicates };
  });
}

async function recordInvoiceLedgerApprovalIdentity(eventId, processInstanceId) {
  try {
    const approval = await getDingTalkProcessInstance(processInstanceId);
    await runInvoiceLedgerMutation((store) => {
      const event = store.events.find((item) => item.eventId === eventId);
      if (!event) return;
      event.approvalNumber = String(approval.businessId || "");
      event.approvalStatus = String(approval.status || "");
      event.approvalCreatedAt = approval.createTime || "";
      event.approvalTitle = String(approval.title || "");
      event.approvalIdentityResolvedAt = new Date().toISOString();
    });
  } catch (error) {
    await runInvoiceLedgerMutation((store) => {
      const event = store.events.find((item) => item.eventId === eventId);
      if (event) event.approvalIdentityLookupError = error.message;
    });
  }
}

async function getInvoiceLedgerOperatorId(config) {
  const detail = await getDingTalkUserDetail(config.operatorUserId);
  const unionId = detail?.unionid || detail?.unionId;
  if (!unionId) throw new Error("Invoice ledger operator has no unionId.");
  return unionId;
}

async function getInvoiceLedgerWorkbook(config, period, operatorId) {
  return runInvoiceLedgerMutation(async (store) => {
    if (store.months[period]?.workbookId) return store.months[period];
    if (period === config.templatePeriod && config.templateWorkbookId) {
      const entry = { workbookId: config.templateWorkbookId, dentryUuid: config.templateDentryUuid, name: monthlyLedgerFilename(period, config.fileSuffix), existingTemplate: true };
      store.months[period] = entry;
      return entry;
    }
    throw new Error(`月度台账 ${period} 尚未登记。请先在“发票入账登记”目录按模板创建该月 Excel，并在批量工具中登记其链接。`);
  });
}

async function registerInvoiceLedgerWorkbook({ period, url }) {
  if (!/^\d{4}-\d{2}$/.test(String(period))) throw new Error("Month must use YYYY-MM.");
  const parsed = new URL(String(url || ""));
  const workbookId = parsed.searchParams.get("docKey");
  if (!workbookId) throw new Error("The spreadsheet link does not contain docKey.");
  const config = getInvoiceLedgerConfig();
  const operatorId = await getInvoiceLedgerOperatorId(config);
  const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0);
  const sheets = (await client.getAllSheetsWithOptions(workbookId, new dingtalk.doc_1_0.GetAllSheetsRequest({ operatorId }), new dingtalk.doc_1_0.GetAllSheetsHeaders({ xAcsDingtalkAccessToken: token }), createRuntimeOptions())).body?.value || [];
  if (!sheets.length) throw new Error("The registered monthly workbook has no worksheet.");
  const entry = { workbookId, dentryUuid: parsed.searchParams.get("dentryKey") || "", name: monthlyLedgerFilename(period, config.fileSuffix), registeredAt: new Date().toISOString() };
  await runInvoiceLedgerMutation((store) => { store.months[period] = entry; });
  return entry;
}

async function appendInvoiceLedgerRows({ workbookId, operatorId, items, submittedAt }) {
  const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0);
  const runtime = createRuntimeOptions();
  const sheets = (await client.getAllSheetsWithOptions(workbookId, new dingtalk.doc_1_0.GetAllSheetsRequest({ operatorId }), new dingtalk.doc_1_0.GetAllSheetsHeaders({ xAcsDingtalkAccessToken: token }), runtime)).body?.value || [];
  const sheet = sheets[0]; if (!sheet?.id) throw new Error("Monthly ledger has no worksheet.");
  const values = (await client.getRangeWithOptions(workbookId, sheet.id, "A1:A5000", new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), new dingtalk.doc_1_0.GetRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime)).body?.values || [];
  let last = 1; values.forEach((row, index) => { if (String(row?.[0] || "").trim()) last = index + 1; });
  const written = [];
  for (const item of items) {
    const rowNumber = ++last;
    const row = toFinanceWorkbookRow(item.snapshot, { serial: rowNumber - 1, submittedAt, allowIncomplete: true });
    await client.updateRangeWithOptions(workbookId, sheet.id, `A${rowNumber}:M${rowNumber}`, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [row] }), new dingtalk.doc_1_0.UpdateRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime);
    written.push({ ...item, sheetId: sheet.id, rowNumber, row });
  }
  return written;
}

async function enqueueInvoiceLedgerSync({ session, draft, processInstanceId }) {
  const config = getInvoiceLedgerConfig();
  const existing = (await readInvoiceLedgerStore()).events.find((item) => item.processInstanceId === String(processInstanceId));
  if (existing) return { enabled: true, status: existing.status, count: existing.rows?.length || 0, period: existing.period, idempotent: true };
  const submittedAt = new Date().toISOString(); const period = monthKeyFromApprovalTime(submittedAt); const eventId = randomUUID();
  await runInvoiceLedgerMutation((store) => { store.events.push({ eventId, processInstanceId: String(processInstanceId), period, status: "pending", submittedAt, createdAt: submittedAt }); });
  await recordInvoiceLedgerApprovalIdentity(eventId, processInstanceId);
  if (!config.enabled) {
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "disabled", reasonCode: "ledger_disabled", reason: "Invoice ledger synchronization is disabled.", completedAt: new Date().toISOString() }); });
    return { enabled: false, status: "disabled" };
  }
  if (![config.folderDentryUuid, config.templateDentryUuid, config.operatorUserId].every(Boolean)) {
    const error = new Error("Invoice ledger configuration is incomplete.");
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "failed", reasonCode: "configuration_incomplete", error: error.message, failedAt: new Date().toISOString() }); });
    throw error;
  }
  try {
    const collected = collectInvoiceLedgerSnapshots(draft, session);
    if (!collected.snapshots.length) {
      const skipped = getInvoiceLedgerSkipReason(collected.diagnostics);
      await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "skipped", reasonCode: skipped.code, reason: skipped.message, diagnostics: collected.diagnostics, completedAt: new Date().toISOString() }); });
      return { enabled: true, status: "skipped", count: 0, period, reasonCode: skipped.code };
    }
    const deduplicated = await filterDuplicateInvoiceLedgerItems(eventId, collected.snapshots);
    if (!deduplicated.accepted.length) {
      const skipped = getInvoiceLedgerSkipReason(collected.diagnostics);
      await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "skipped", reasonCode: skipped.code, reason: skipped.message, diagnostics: collected.diagnostics, items: [], completedAt: new Date().toISOString() }); });
      return { enabled: true, status: "skipped", count: 0, period, reasonCode: skipped.code };
    }
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); event.items = deduplicated.accepted; event.diagnostics = collected.diagnostics; });
    if (config.mode === "audit") {
      await runInvoiceLedgerMutation((store) => {
        const event = store.events.find((item) => item.eventId === eventId);
        Object.assign(event, {
          status: "audited",
          reasonCode: "ledger_audit_mode",
          reason: "Invoice ledger audit mode: extraction was recorded but no workbook write was attempted.",
          completedAt: new Date().toISOString(),
        });
      });
      return { enabled: true, mode: "audit", status: "audited", count: deduplicated.accepted.length, period, duplicateCount: deduplicated.duplicates.length };
    }
    const operatorId = await getInvoiceLedgerOperatorId(config); const workbook = await getInvoiceLedgerWorkbook(config, period, operatorId);
    const written = await appendInvoiceLedgerRows({ workbookId: workbook.workbookId, operatorId, items: deduplicated.accepted, submittedAt });
    const incompleteCount = deduplicated.accepted.filter((item) => !hasLedgerInvoiceData(item.snapshot)).length;
    const status = incompleteCount ? "synced_partial" : "synced";
    await runInvoiceLedgerMutation((store) => {
      const event = store.events.find((item) => item.eventId === eventId);
      Object.assign(event, {
        workbookId: workbook.workbookId,
        status,
        rows: written,
        syncedAt: new Date().toISOString(),
        reasonCode: incompleteCount ? "ocr_snapshot_missing" : "",
        reason: incompleteCount ? `${incompleteCount} selected invoice attachment(s) were synchronized without a usable OCR snapshot and require manual completion.` : "",
      });
    });
    return { enabled: true, status, count: written.length, period, workbookId: workbook.workbookId, incompleteCount, duplicateCount: deduplicated.duplicates.length };
  } catch (error) {
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "failed", error: error.message, failedAt: new Date().toISOString() }); });
    throw error;
  }
}

async function rollbackInvoiceLedger(processInstanceId) {
  const event = (await readInvoiceLedgerStore()).events.find((item) => (
    item.processInstanceId === String(processInstanceId)
    || item.approvalNumber === String(processInstanceId)
    || item.sourceId === String(processInstanceId)
  ) && item.status === "synced");
  if (!event) throw new Error("No synchronized invoice ledger event found for this approval.");
  const config = getInvoiceLedgerConfig(); const operatorId = await getInvoiceLedgerOperatorId(config); const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0); const runtime = createRuntimeOptions(); const reverted = []; const manual = [];
  for (const item of event.rows || []) {
    const current = (await client.getRangeWithOptions(event.workbookId, item.sheetId, `A${item.rowNumber}:M${item.rowNumber}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), new dingtalk.doc_1_0.GetRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime)).body?.values?.[0] || [];
    const booked = String(current[12] || "").trim(); const matches = JSON.stringify(current) === JSON.stringify(item.row);
    if (!matches || !["", "否", "no", "NO"].includes(booked)) { manual.push({ rowNumber: item.rowNumber, reason: !matches ? "row_changed" : "already_booked" }); continue; }
    await client.updateRangeWithOptions(event.workbookId, item.sheetId, `A${item.rowNumber}:M${item.rowNumber}`, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [Array(13).fill("")] }), new dingtalk.doc_1_0.UpdateRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime); reverted.push(item.rowNumber);
  }
  await runInvoiceLedgerMutation((store) => { const target = store.events.find((item) => item.eventId === event.eventId); if (target) { target.status = manual.length ? "rollback_manual_required" : "rolled_back"; target.rollback = { reverted, manual, at: new Date().toISOString() }; } });
  return { reverted, manual };
}

async function importInvoiceLedgerBatch({ period, sourceId, invoices }) {
  const config = getInvoiceLedgerConfig();
  if (!/^\d{4}-\d{2}$/.test(String(period))) throw new Error("Batch period must use YYYY-MM.");
  if (!Array.isArray(invoices) || !invoices.length) throw new Error("Batch invoices must be a non-empty array.");
  const items = invoices.map((snapshot, index) => ({ fileId: String(snapshot.fileId || `batch-${index + 1}`), snapshot: snapshot.snapshot || snapshot }));
  const stableSourceId = String(sourceId || `batch-${period}-${createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 16)}`);
  const existing = (await readInvoiceLedgerStore()).events.find((item) => item.sourceId === stableSourceId);
  if (existing) return { status: existing.status, count: existing.rows?.length || 0, idempotent: true, sourceId: stableSourceId };
  const eventId = randomUUID(); const submittedAt = `${period}-01`;
  await runInvoiceLedgerMutation((store) => { store.events.push({ eventId, sourceId: stableSourceId, period, status: "pending", items, submittedAt, createdAt: new Date().toISOString() }); });
  try {
    const operatorId = await getInvoiceLedgerOperatorId(config); const workbook = await getInvoiceLedgerWorkbook(config, period, operatorId);
    const rows = await appendInvoiceLedgerRows({ workbookId: workbook.workbookId, operatorId, items, submittedAt });
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { workbookId: workbook.workbookId, rows, status: "synced", syncedAt: new Date().toISOString() }); });
    return { status: "synced", count: rows.length, period, sourceId: stableSourceId, workbookId: workbook.workbookId };
  } catch (error) {
    await runInvoiceLedgerMutation((store) => { const event = store.events.find((item) => item.eventId === eventId); Object.assign(event, { status: "failed", error: error.message, failedAt: new Date().toISOString() }); });
    throw error;
  }
}

function normalizeLedgerCell(value, columnIndex = -1) {
  if (value === undefined || value === null) return "";
  // DingTalk workbook APIs return dates as Excel serial numbers.  The repair
  // guard compares the existing A/L/M anchors without treating that transport
  // representation as a manual edit.
  if (columnIndex === 11 && typeof value === "number") {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function equalLedgerCells(left, right, columnIndex = -1) {
  return normalizeLedgerCell(left, columnIndex) === normalizeLedgerCell(right, columnIndex);
}

function getLedgerRepairFields(snapshot = {}) {
  // B:K only.  A (serial), L (entry date) and M (booked status) always remain
  // owned by the finance workbook and are never overwritten by a repair.
  return toFinanceWorkbookRow(snapshot, {
    serial: "",
    submittedAt: "2000-01-01",
    allowIncomplete: true,
  }).slice(1, 11);
}

function isUsableLedgerRepairSnapshot(snapshot = {}) {
  return Boolean(
    String(snapshot.invoiceNumber || "").trim()
    && String(snapshot.totalAmount || "").trim(),
  );
}

function findInvoiceLedgerRepairTarget(store, repair = {}) {
  const approvalNumber = String(repair.approvalNumber || "").trim();
  const processInstanceId = String(repair.processInstanceId || "").trim();
  const event = store.events.find((item) => (
    (approvalNumber && item.approvalNumber === approvalNumber)
    || (processInstanceId && item.processInstanceId === processInstanceId)
  ));
  if (!event) return { error: "approval_not_found" };
  const fileId = String(repair.fileId || "").trim();
  const rowNumber = Number(repair.rowNumber || 0);
  const row = (event.rows || []).find((item) => (
    (!fileId || String(item.fileId || "") === fileId)
    && (!rowNumber || Number(item.rowNumber) === rowNumber)
  ));
  if (!row) return { event, error: "invoice_row_not_found" };
  return { event, row };
}

async function buildInvoiceLedgerRepairTemplate({ period = "" } = {}) {
  const store = await readInvoiceLedgerStore();
  const repairs = [];
  for (const event of store.events) {
    if (event.status !== "synced_partial") continue;
    if (period && event.period !== period) continue;
    for (const row of event.rows || []) {
      repairs.push({
        approvalNumber: event.approvalNumber || "",
        processInstanceId: event.processInstanceId || "",
        period: event.period || "",
        fileId: row.fileId || "",
        fileName: row.fileName || "",
        rowNumber: row.rowNumber || 0,
        snapshot: {
          invoiceNumber: "",
          sellerTaxNumber: "",
          sellerName: "",
          buyerTaxNumber: "",
          buyerName: "",
          invoiceDate: "",
          itemName: "",
          amount: "",
          taxAmount: "",
          totalAmount: "",
          source: "historical-repair",
        },
      });
    }
  }
  return {
    sourceId: `ledger-repair-${period || "all"}-${new Date().toISOString().slice(0, 10)}`,
    period: period || "",
    repairs,
  };
}

async function previewInvoiceLedgerRepair({ repairs = [] } = {}) {
  if (!Array.isArray(repairs) || !repairs.length) throw new Error("Repair payload must contain a non-empty repairs array.");
  const store = await readInvoiceLedgerStore();
  const config = getInvoiceLedgerConfig();
  const operatorId = await getInvoiceLedgerOperatorId(config);
  const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0);
  const runtime = createRuntimeOptions();
  const entries = [];
  for (const repair of repairs) {
    const target = findInvoiceLedgerRepairTarget(store, repair);
    if (target.error) {
      entries.push({ ...repair, status: "manual_required", reason: target.error });
      continue;
    }
    const snapshot = repair.snapshot && typeof repair.snapshot === "object" ? repair.snapshot : repair;
    if (!isUsableLedgerRepairSnapshot(snapshot)) {
      entries.push({ ...repair, status: "manual_required", reason: "snapshot_incomplete" });
      continue;
    }
    const current = (await client.getRangeWithOptions(
      target.event.workbookId,
      target.row.sheetId,
      `A${target.row.rowNumber}:M${target.row.rowNumber}`,
      new dingtalk.doc_1_0.GetRangeRequest({ operatorId }),
      new dingtalk.doc_1_0.GetRangeHeaders({ xAcsDingtalkAccessToken: token }),
      runtime,
    )).body?.values?.[0] || [];
    const expectedRow = target.row.row || [];
    const anchorMatches = equalLedgerCells(current[0], expectedRow[0], 0)
      && equalLedgerCells(current[11], expectedRow[11], 11);
    const booked = normalizeLedgerCell(current[12], 12);
    const desired = getLedgerRepairFields(snapshot);
    const actualFields = Array.from({ length: 10 }, (_, index) => normalizeLedgerCell(current[index + 1], index + 1));
    const desiredFields = desired.map((value, index) => normalizeLedgerCell(value, index + 1));
    const alreadyApplied = actualFields.every((value, index) => value === desiredFields[index]);
    const hasExistingFields = actualFields.some(Boolean);
    let status = "ready";
    let reason = "";
    if (!anchorMatches) { status = "manual_required"; reason = "row_anchor_changed"; }
    else if (!["", "否", "no", "NO"].includes(booked)) { status = "manual_required"; reason = "already_booked"; }
    else if (alreadyApplied) { status = "already_applied"; reason = ""; }
    else if (hasExistingFields) { status = "manual_required"; reason = "manual_content_conflict"; }
    entries.push({
      approvalNumber: target.event.approvalNumber || "",
      processInstanceId: target.event.processInstanceId || "",
      period: target.event.period || "",
      fileId: target.row.fileId || "",
      fileName: target.row.fileName || "",
      eventId: target.event.eventId,
      workbookId: target.event.workbookId,
      sheetId: target.row.sheetId,
      rowNumber: target.row.rowNumber,
      snapshot,
      before: current,
      desired,
      status,
      reason,
    });
  }
  const summary = entries.reduce((result, entry) => {
    result[entry.status] = (result[entry.status] || 0) + 1;
    return result;
  }, {});
  return { entries, summary };
}

async function applyInvoiceLedgerRepair({ sourceId = "", repairs = [] } = {}) {
  const preview = await previewInvoiceLedgerRepair({ repairs });
  const stableSourceId = String(sourceId || `ledger-repair-${createHash("sha256").update(JSON.stringify(repairs)).digest("hex").slice(0, 16)}`);
  const existing = (await readInvoiceLedgerRepairStore()).jobs.find((job) => job.sourceId === stableSourceId && job.status === "completed");
  if (existing) return { jobId: existing.jobId, status: "completed", idempotent: true, summary: existing.summary };
  const job = {
    jobId: randomUUID(),
    sourceId: stableSourceId,
    status: "running",
    createdAt: new Date().toISOString(),
    entries: preview.entries,
    summary: preview.summary,
  };
  await runInvoiceLedgerRepairMutation((store) => { store.jobs.push(job); });
  const config = getInvoiceLedgerConfig();
  const operatorId = await getInvoiceLedgerOperatorId(config);
  const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0);
  const runtime = createRuntimeOptions();
  for (const entry of job.entries.filter((item) => item.status === "ready")) {
    try {
      await client.updateRangeWithOptions(
        entry.workbookId,
        entry.sheetId,
        `B${entry.rowNumber}:K${entry.rowNumber}`,
        new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [entry.desired] }),
        new dingtalk.doc_1_0.UpdateRangeHeaders({ xAcsDingtalkAccessToken: token }),
        runtime,
      );
      const actual = (await client.getRangeWithOptions(
        entry.workbookId,
        entry.sheetId,
        `B${entry.rowNumber}:K${entry.rowNumber}`,
        new dingtalk.doc_1_0.GetRangeRequest({ operatorId }),
        new dingtalk.doc_1_0.GetRangeHeaders({ xAcsDingtalkAccessToken: token }),
        runtime,
      )).body?.values?.[0] || [];
      const verified = entry.desired.every((value, index) => equalLedgerCells(value, actual[index], index + 1));
      entry.status = verified ? "applied" : "failed";
      entry.reason = verified ? "" : "read_back_mismatch";
      entry.after = actual;
    } catch (error) {
      entry.status = "failed";
      entry.reason = error.message;
    }
    await runInvoiceLedgerRepairMutation((store) => {
      const target = store.jobs.find((item) => item.jobId === job.jobId);
      if (target) Object.assign(target, { entries: job.entries, updatedAt: new Date().toISOString() });
    });
  }
  const summary = job.entries.reduce((result, entry) => {
    result[entry.status] = (result[entry.status] || 0) + 1;
    return result;
  }, {});
  job.summary = summary;
  job.status = summary.failed ? "completed_with_errors" : "completed";
  job.completedAt = new Date().toISOString();
  await runInvoiceLedgerRepairMutation((store) => {
    const target = store.jobs.find((item) => item.jobId === job.jobId);
    if (target) Object.assign(target, job);
  });
  await runInvoiceLedgerMutation((store) => {
    for (const entry of job.entries.filter((item) => ["applied", "already_applied"].includes(item.status))) {
      const event = store.events.find((item) => item.eventId === entry.eventId);
      const row = event?.rows?.find((item) => String(item.fileId || "") === String(entry.fileId || "") && Number(item.rowNumber) === Number(entry.rowNumber));
      if (!event || !row) continue;
      row.snapshot = entry.snapshot;
      row.hasOcrSnapshot = true;
      row.row = [row.row?.[0] || "", ...entry.desired, row.row?.[11] || "", row.row?.[12] || "否"];
      event.repairHistory = [...(event.repairHistory || []), { jobId: job.jobId, fileId: row.fileId, rowNumber: row.rowNumber, status: entry.status, at: job.completedAt }];
      if ((event.rows || []).every((item) => hasLedgerInvoiceData(item.snapshot))) {
        event.originalStatus = event.originalStatus || event.status;
        event.status = "synced";
        event.reasonCode = "";
        event.reason = "";
        event.repairedAt = job.completedAt;
      }
    }
  });
  return { jobId: job.jobId, status: job.status, summary };
}

async function rollbackInvoiceLedgerRepair(jobId) {
  const job = (await readInvoiceLedgerRepairStore()).jobs.find((item) => item.jobId === String(jobId));
  if (!job) throw new Error("Repair job not found.");
  const config = getInvoiceLedgerConfig();
  const operatorId = await getInvoiceLedgerOperatorId(config);
  const token = await getDingTalkAccessToken();
  const client = createDingTalkSdkClient(dingtalk.doc_1_0);
  const runtime = createRuntimeOptions();
  const reverted = []; const manual = [];
  for (const entry of job.entries.filter((item) => item.status === "applied")) {
    const current = (await client.getRangeWithOptions(
      entry.workbookId, entry.sheetId, `A${entry.rowNumber}:M${entry.rowNumber}`,
      new dingtalk.doc_1_0.GetRangeRequest({ operatorId }),
      new dingtalk.doc_1_0.GetRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime,
    )).body?.values?.[0] || [];
    const matches = entry.desired.every((value, index) => equalLedgerCells(value, current[index + 1], index + 1));
    const booked = normalizeLedgerCell(current[12], 12);
    if (!matches || !["", "否", "no", "NO"].includes(booked)) {
      manual.push({ fileId: entry.fileId, rowNumber: entry.rowNumber, reason: !matches ? "row_changed" : "already_booked" });
      continue;
    }
    await client.updateRangeWithOptions(
      entry.workbookId, entry.sheetId, `B${entry.rowNumber}:K${entry.rowNumber}`,
      new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [entry.before.slice(1, 11)] }),
      new dingtalk.doc_1_0.UpdateRangeHeaders({ xAcsDingtalkAccessToken: token }), runtime,
    );
    reverted.push(entry.rowNumber);
  }
  await runInvoiceLedgerRepairMutation((store) => {
    const target = store.jobs.find((item) => item.jobId === job.jobId);
    if (target) target.rollback = { reverted, manual, at: new Date().toISOString() };
  });
  return { reverted, manual };
}

async function reconcileInvoiceLedgerApprovals() {
  const config = getInvoiceLedgerConfig();
  if (!config.enabled) return { checked: 0, rolledBack: 0 };
  const store = await readInvoiceLedgerStore();
  const candidates = store.events.filter((event) => event.processInstanceId && event.status === "synced");
  let rolledBack = 0;
  for (const event of candidates) {
    try {
      const approval = await getDingTalkProcessInstance(event.processInstanceId);
      const status = String(approval.status || "").toUpperCase();
      const result = String(approval.result || "").toLowerCase();
      if (["TERMINATED", "CANCELED", "CANCELLED", "REVOKED"].includes(status) || ["refuse", "rejected"].includes(result)) {
        await rollbackInvoiceLedger(event.processInstanceId);
        rolledBack += 1;
      }
    } catch (error) {
      await runInvoiceLedgerMutation((current) => {
        const target = current.events.find((item) => item.eventId === event.eventId);
        if (target) target.lastReconcileError = error.message;
      });
    }
  }
  return { checked: candidates.length, rolledBack };
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  if (pathname === "/data" || pathname.startsWith("/data/")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const filePath = normalize(join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      // The DingTalk webview otherwise keeps an obsolete HTML shell/app.js.
      "Cache-Control": "no-store, max-age=0",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not Found");
  }
}

async function serveV2Index(response) {
  const source = await readFile(join(root, "index.html"), "utf8");
  const version = "20260921-manual-reason-1";
  const html = source
    .replace("<title>发票自动报销助手</title>", "<title>发票自动报销助手</title>")
    .replace(/<link rel="stylesheet" href="\.\/styles\.css\?v=[^"]+"\s*\/>/, `<link rel="stylesheet" href="/styles.css?v=${version}" />\n    <link rel="stylesheet" href="/v2.css?v=${version}" />`)
    .replace(/<script src="\.\/app\.js\?v=[^"]+"><\/script>/, `<script src="/app.js?v=${version}"></script>\n    <script src="/v2.js?v=${version}"></script>`);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  });
  response.end(html);
}

async function serveV1Index(response) {
  const source = await readFile(join(root, "index.html"), "utf8");
  const version = "20260921-manual-reason-1";
  const html = source
    .replace(/<link rel="stylesheet" href="\.\/styles\.css\?v=[^"]+"\s*\/>/, `<link rel="stylesheet" href="/styles.css?v=${version}" />`)
    .replace(/<script src="\.\/app\.js\?v=[^"]+"><\/script>/, `<script src="/app.js?v=${version}"></script>\n    <script src="/v2-router.js?v=${version}"></script>`);
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
  });
  response.end(html);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && ["/", "/index.html"].includes(request.url.split("?")[0])) {
      await serveV1Index(response);
      return;
    }

    if (request.method === "GET" && ["/v2", "/v2/", "/v2/index.html"].includes(request.url.split("?")[0])) {
      await serveV2Index(response);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/v2/profile")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      sendJson(response, 200, getV2UserProfile(session));
      return;
    }

    if (request.method === "POST" && request.url === "/api/client-audit/events") {
      const body = await readRequestBody(request);
      const session = getSession(body.session_token);
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const config = getClientAuditConfig();
      if (!config.enabled) {
        sendJson(response, 202, { accepted: 0, disabled: true });
        return;
      }
      const events = normalizeClientAuditEvents(body, session);
      // This endpoint is deliberately independent of upload/approval paths.
      // An audit write can never create OCR work or trigger an OA submission.
      const accepted = events.length ? getScheduledApprovalStore().addClientAuditEvents(events) : 0;
      void adminWorkbench?.captureClientEvents(events)
        .catch((error) => console.error(`Admin workbench client event write failed: ${error.message}`));
      sendJson(response, 202, { accepted, received: events.length, disabled: false });
      return;
    }

    if (request.method === "POST" && request.url === "/api/approvals") {
      const draft = await readRequestBody(request);
      const session = getSession(draft.session_token);
      const reservation = await reserveSubmissionRequest(session, draft);
      captureAdminWorkbenchDraft({ session, draft, source: "submission", reason: "员工请求提交审批" });
      if (reservation.action === "replay") {
        const scheduled = reservation.entry.resultType === "scheduled";
        sendJson(response, 200, {
          processInstanceId: reservation.entry.processInstanceId,
          scheduled,
          scheduledJobId: reservation.entry.scheduledJobId || "",
          scheduledAt: reservation.entry.scheduledAt || "",
          trackingCode: reservation.entry.trackingCode || "",
          idempotent: true,
        });
        return;
      }
      if (reservation.action === "pending") {
        const error = new Error("这笔报销正在发起中，请勿重复点击。请稍候查看提交记录确认结果。");
        error.statusCode = 409;
        throw error;
      }
      try {
        const preparedResult = await prepareScheduledOrImmediateApproval(draft, session, reservation);
        if (preparedResult.scheduled) {
          sendJson(response, 200, {
            scheduled: true,
            scheduledJobId: preparedResult.job.id,
            scheduledAt: preparedResult.job.scheduledAt,
            submittedAt: preparedResult.job.createdAt,
            trackingCode: preparedResult.job.trackingCode,
            idempotent: preparedResult.idempotent,
          });
          return;
        }
        const result = await dispatchPreparedDingTalkApproval(preparedResult.prepared);
        await settleSubmissionRequest(reservation, "success", { processInstanceId: result.processInstanceId })
          .catch((error) => console.error(`Submission dedup write failed: ${error.message}`));
        await recordSubmissionHistory({
          session,
          draft,
          status: "success",
          processInstanceId: result.processInstanceId,
        }).catch((error) => console.error(`Submission history write failed: ${error.message}`));
        sendJson(response, 200, { ...result, idempotent: false });
      } catch (error) {
        const failure = describeSubmissionFailure(error, draft.process_code);
        await settleSubmissionRequest(reservation, "failed", { failureReason: failure.reason })
          .catch((dedupError) => console.error(`Submission dedup write failed: ${dedupError.message}`));
        await recordSubmissionHistory({ session, draft, status: "failed", failure })
          .catch((historyError) => console.error(`Submission history write failed: ${historyError.message}`));
        const publicError = new Error(`${failure.reason} ${failure.advice}`.trim());
        publicError.statusCode = error.statusCode || 400;
        throw publicError;
      }
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/submission-history")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      const result = await listSubmissionHistory(session, url.searchParams.get("limit"));
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/scheduled-approvals")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const entries = getScheduledApprovalStore().listForUser(String(session.user.userId), url.searchParams.get("limit"));
      sendJson(response, 200, { entries });
      return;
    }

    if (request.method === "POST" && request.url === "/api/scheduled-approvals/cancel-and-copy") {
      const body = await readRequestBody(request);
      const session = getSession(body.session_token);
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const store = getScheduledApprovalStore();
      const existing = store.getJob(String(body.id || ""), { includePrepared: true });
      if (!existing || existing.ownerUserId !== String(session.user.userId)) {
        const error = new Error("没有找到该报销记录。");
        error.statusCode = 404;
        throw error;
      }
      const cancelled = store.cancel(existing.id, String(session.user.userId));
      await releaseCancelledScheduledSubmissionRequest(cancelled);
      await updateScheduledSubmissionHistory(cancelled, { status: "cancelled" });
      sendJson(response, 200, { cancelled, editableDraft: existing.context?.editableDraft || null });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/scheduled-approvals/export")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requireScheduledAdmin(getSession(url.searchParams.get("session_token")));
      const entries = getScheduledApprovalStore().listAdmin({ status: url.searchParams.get("status") || "", limit: 500 });
      const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const rows = [
        ["系统流水号", "追踪号", "提交人", "用户ID", "报销入口", "金额", "状态", "计划发起时间", "OA实例编号", "失败原因", "创建时间"],
        ...entries.map((entry) => [entry.id, entry.trackingCode, entry.ownerName, entry.ownerUserId, entry.workflowTitle, entry.amount,
          entry.status, entry.scheduledAt, entry.processInstanceId, entry.failureReason, entry.createdAt]),
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
      response.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="scheduled-approvals-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      });
      response.end(csv);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/operations-dashboard")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = requireScheduledAdmin(getSession(url.searchParams.get("session_token")));
      sendJson(response, 200, {
        ...await buildOperationsDashboard(),
        workbench: (() => {
          const config = adminWorkbench?.config?.() || {};
          return {
            enabled: Boolean(config.enabled),
            readEnabled: Boolean(config.readEnabled),
            repairEnabled: Boolean(config.repairEnabled),
            submitEnabled: Boolean(config.submitEnabled),
            manualCreateEnabled: Boolean(config.manualCreateEnabled),
          };
        })(),
        currentUser: { userId: maskAdminUserId(session.user.userId), name: session.user.name || "" },
      });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/workbench/health")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requireScheduledAdmin(getSession(url.searchParams.get("session_token")));
      sendJson(response, 200, await adminWorkbench?.health() || { enabled: false, configured: false });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/workbench/employees")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requireAdminWorkbench(getSession(url.searchParams.get("session_token")), "manual_create");
      const query = String(url.searchParams.get("q") || "").trim();
      const employees = await listDingTalkEmployees(query, url.searchParams.get("limit") || 20);
      sendJson(response, 200, { employees, policy: "admin-originator-v1" });
      return;
    }

    if (request.method === "POST" && request.url === "/api/admin/workbench/manual-cases") {
      const body = await readRequestBody(request);
      const admin = requireAdminWorkbench(getSession(body.session_token), "manual_create");
      const reason = cleanSubmissionText(body.reason, 1000);
      if (!reason) {
        const error = new Error("管理员新建代发案件必须填写处理原因。");
        error.statusCode = 400;
        throw error;
      }
      const targetUserId = String(body.target_user_id || body.targetUserId || "").trim();
      if (!targetUserId) {
        const error = new Error("管理员代发必须指定报销归属人的钉钉 userId。");
        error.statusCode = 400;
        throw error;
      }
      const draft = cloneJsonValue(body.draft || {});
      validateAdminManualDraftEnvelope(draft);
      const target = await getDingTalkEmployeeProfile(targetUserId);
      const traceId = cleanSubmissionText(body.trace_id || `admin-manual:${targetUserId}:${draft.submission_id || randomUUID()}`, 120);
      const { draft: manualDraft, selectedDepartment } = buildAdminManualDraft({
        draft,
        target,
        departmentId: body.department_id || body.departmentId || draft.dept_id || "",
        workflowId: body.workflow_id || body.workflowId || "",
        workflowTitle: body.workflow_title || body.workflowTitle || "",
        traceId,
      });
      const existing = await adminWorkbench.findCaseByTraceId?.(traceId);
      if (existing) {
        if (String(existing.ownerUserId || existing.owner_user_id || "") !== String(target.userId)) {
          const error = new Error("该管理员代发追踪号已被其他归属人占用，请重新生成后再试。");
          error.statusCode = 409;
          throw error;
        }
        sendJson(response, 200, {
          ok: true,
          idempotent: true,
          caseId: existing.id,
          revision: existing.currentRevision || existing.current_revision || 0,
          target: { userId: target.userId, name: target.name, departments: target.departments, socialCompanyRecognition: target.socialCompanyRecognition },
          dispatch: { mode: "manual_review_then_submit", note: "案件已存在，系统未重复创建。" },
        });
        return;
      }
      const saved = await adminWorkbench.captureDraft({
        traceId,
        draftId: manualDraft.submission_id,
        ownerUserId: target.userId,
        ownerName: target.name,
        ownerUnionId: target.unionId,
        ownerDepartments: target.departments,
        ownerSocialCompanyRecognition: target.socialCompanyRecognition,
        workflowId: manualDraft.submission_context.workflowId,
        workflowTitle: manualDraft.submission_context.workflowTitle,
        draft: manualDraft,
        source: "admin_manual",
        reason,
        adminOriginator: true,
        operatorUserId: admin.user.userId,
        operatorName: admin.user.name,
      });
      const actionId = await adminWorkbench.recordAdminAction({
        caseId: saved.caseId,
        actorUserId: String(admin.user.userId),
        actorName: String(admin.user.name || ""),
        action: "manual_create",
        reason,
        idempotencyKey: `admin-manual-create:${traceId}`,
        detail: {
          targetUserId: target.userId,
          targetName: target.name,
          originatorUserId: target.userId,
          operatorUserId: admin.user.userId,
          departmentId: selectedDepartment.id,
          companyRecognition: target.socialCompanyRecognition || {},
        },
        status: "succeeded",
        result: { revision: saved.revision },
      });
      await adminWorkbench.setCaseStatus(saved.caseId, "open", {
        originatorUserId: target.userId,
        operatorUserId: admin.user.userId,
        dispatchMode: "manual_review_then_submit",
      });
      sendJson(response, 201, {
        ok: true,
        caseId: saved.caseId,
        revision: saved.revision,
        actionId,
        target: {
          userId: target.userId,
          name: target.name,
          unionIdAvailable: Boolean(target.unionId),
          departments: target.departments,
          socialCompanyRecognition: target.socialCompanyRecognition,
        },
        dispatch: { mode: "manual_review_then_submit", note: "案件已保存；只有在管理员点击代发起并通过完整凭证校验后才会创建 OA。" },
      });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/workbench/cases")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      requireAdminWorkbench(getSession(url.searchParams.get("session_token")), "read");
      const match = url.pathname.match(/^\/api\/admin\/workbench\/cases\/([A-Za-z0-9-]+)$/);
      if (match) {
        const result = await adminWorkbench.getCase(match[1]);
        if (!result) {
          const error = new Error("未找到该排障案件。");
          error.statusCode = 404;
          throw error;
        }
        sendJson(response, 200, result);
      } else {
        sendJson(response, 200, await adminWorkbench.listCases({
          queryText: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "",
          ownerUserId: url.searchParams.get("owner_user_id") || "",
          limit: url.searchParams.get("limit") || 100,
          offset: url.searchParams.get("offset") || 0,
        }));
      }
      return;
    }

    if (request.method === "POST" && request.url.match(/^\/api\/admin\/workbench\/cases\/[A-Za-z0-9-]+\/repair$/)) {
      const body = await readRequestBody(request);
      const admin = requireAdminWorkbench(getSession(body.session_token), "repair");
      const caseId = String(request.url).match(/^\/api\/admin\/workbench\/cases\/([A-Za-z0-9-]+)\/repair$/)?.[1] || "";
      const reason = cleanSubmissionText(body.reason, 1000);
      if (!reason) {
        const error = new Error("管理员代修复必须填写处理原因。");
        error.statusCode = 400;
        throw error;
      }
      const latest = await getAdminCaseSnapshot(caseId);
      if (body.expected_revision !== undefined && Number(body.expected_revision) !== Number(latest.revision)) {
        const error = new Error("该案件已被其他操作更新，请刷新后重新确认修复内容。");
        error.statusCode = 409;
        throw error;
      }
      const syntheticSession = latest.snapshot?.support?.adminOriginator
        ? createAdminOriginatorSession(latest.snapshot)
        : createSupportSession(latest.snapshot);
      const repairedDraft = applyAdminRepairPatch(latest.snapshot.draft, body.patch);
      // Preflight is intentionally the same server-side validator used by an
      // employee submission.  An administrator cannot save an invalid repair.
      const prepared = await prepareDingTalkApprovalForSession(repairedDraft, syntheticSession);
      const actionId = await adminWorkbench.recordAdminAction({
        caseId,
        actorUserId: String(admin.user.userId),
        actorName: String(admin.user.name || ""),
        action: "repair",
        reason,
        detail: { previousRevision: latest.revision, patchKeys: Object.keys(body.patch || {}), validation: { evidence: prepared.evidenceAudit?.totals || {}, invoiceTitle: prepared.invoiceTitleAudit || {} } },
        status: "validated",
      });
      const saved = await adminWorkbench.captureDraft({
        traceId: latest.snapshot?.draft?.submission_context?.traceId || `case:${caseId}`,
        draftId: latest.draft_id || latest.snapshot?.draft?.submission_id || "",
        ownerUserId: syntheticSession.user.userId,
        ownerName: syntheticSession.user.name,
        ownerDepartments: syntheticSession.user.departments,
        workflowId: latest.workflow_id,
        workflowTitle: latest.workflow_title,
        draft: repairedDraft,
        source: "admin",
        reason,
      });
      await adminWorkbench.setCaseStatus(caseId, "repaired");
      await adminWorkbench.updateAdminAction(actionId, { status: "succeeded", result: { revision: saved.revision } });
      sendJson(response, 200, { ok: true, caseId, revision: saved.revision, validation: { evidence: prepared.evidenceAudit?.totals || {}, invoiceTitle: prepared.invoiceTitleAudit || {} } });
      return;
    }

    if (request.method === "POST" && request.url.match(/^\/api\/admin\/workbench\/cases\/[A-Za-z0-9-]+\/submit$/)) {
      const body = await readRequestBody(request);
      const admin = requireAdminWorkbench(getSession(body.session_token), "submit");
      const caseId = String(request.url).match(/^\/api\/admin\/workbench\/cases\/([A-Za-z0-9-]+)\/submit$/)?.[1] || "";
      const reason = cleanSubmissionText(body.reason, 1000);
      if (!reason) {
        const error = new Error("管理员代发起必须填写原因。");
        error.statusCode = 400;
        throw error;
      }
      const latest = await getAdminCaseSnapshot(caseId);
      if (body.expected_revision !== undefined && Number(body.expected_revision) !== Number(latest.revision)) {
        const error = new Error("该案件已被其他操作更新，请刷新后重新确认代发起。");
        error.statusCode = 409;
        throw error;
      }
      const syntheticSession = latest.snapshot?.support?.adminOriginator
        ? createAdminOriginatorSession(latest.snapshot)
        : createSupportSession(latest.snapshot);
      const draft = cloneJsonValue(latest.snapshot.draft);
      draft.submission_id = `admin_${randomUUID().replaceAll("-", "")}`;
      draft.session_token = "";
      const actionId = await adminWorkbench.recordAdminAction({
        caseId,
        actorUserId: String(admin.user.userId),
        actorName: String(admin.user.name || ""),
        action: "submit_on_behalf",
        reason,
        idempotencyKey: `admin-submit:${caseId}:${latest.revision}`,
        detail: {
          revision: latest.revision,
          originatorUserId: syntheticSession.user.userId,
          operatorUserId: admin.user.userId,
          routeMode: syntheticSession.adminContext?.enabled ? "admin_originator" : "self",
        },
        status: "dispatching",
      });
      await adminWorkbench.setCaseStatus(caseId, "submitting");
      // Keep the case linkage inside the encrypted queued snapshot.  The
      // scheduled worker can then update the admin workbench after OA creation
      // without changing the employee-facing submission path.
      draft.submission_context = {
        ...(draft.submission_context && typeof draft.submission_context === "object" ? draft.submission_context : {}),
        adminCaseId: caseId,
        adminOperatorUserId: String(admin.user.userId),
      };
      let reservation = null;
      try {
        reservation = await reserveSubmissionRequest(syntheticSession, draft);
        if (reservation.action === "replay") {
          const scheduled = reservation.entry.resultType === "scheduled";
          await adminWorkbench.setCaseStatus(caseId, scheduled ? "scheduled" : "submitted", {
            processInstanceId: reservation.entry.processInstanceId || "",
            scheduledJobId: reservation.entry.scheduledJobId || "",
            scheduledAt: reservation.entry.scheduledAt || "",
            originatorUserId: syntheticSession.user.userId,
            operatorUserId: admin.user.userId,
            routeMode: "admin_originator",
            dispatchMode: scheduled ? "scheduled" : "immediate",
          });
          await adminWorkbench.updateAdminAction(actionId, { status: "succeeded", result: {
            idempotent: true,
            scheduled,
            scheduledJobId: reservation.entry.scheduledJobId || "",
            processInstanceId: reservation.entry.processInstanceId || "",
          } });
          sendJson(response, 200, {
            ok: true,
            idempotent: true,
            scheduled,
            scheduledJobId: reservation.entry.scheduledJobId || "",
            scheduledAt: reservation.entry.scheduledAt || "",
            processInstanceId: reservation.entry.processInstanceId || "",
            originatorUserId: syntheticSession.user.userId,
            operatorUserId: admin.user.userId,
            routeMode: "admin_originator",
          });
          return;
        }
        if (reservation.action === "pending") {
          const error = new Error("该管理员代发正在进入待发起池，请稍候查看管理台，不要重复提交。");
          error.statusCode = 409;
          throw error;
        }
        const preparedResult = await prepareScheduledOrImmediateApproval(draft, syntheticSession, reservation);
        if (preparedResult.scheduled) {
          const job = preparedResult.job;
          await recordSubmissionHistory({
            session: syntheticSession,
            draft,
            status: "scheduled",
            scheduledJobId: job.id,
            scheduledAt: job.scheduledAt,
          });
          await adminWorkbench.setCaseStatus(caseId, "scheduled", {
            scheduledJobId: job.id,
            scheduledAt: job.scheduledAt,
            trackingCode: job.trackingCode,
            originatorUserId: syntheticSession.user.userId,
            operatorUserId: admin.user.userId,
            routeMode: "admin_originator",
            dispatchMode: "scheduled",
          });
          await adminWorkbench.updateAdminAction(actionId, { status: "succeeded", result: {
            scheduled: true,
            scheduledJobId: job.id,
            scheduledAt: job.scheduledAt,
            trackingCode: job.trackingCode,
          } });
          sendJson(response, 200, {
            ok: true,
            scheduled: true,
            scheduledJobId: job.id,
            scheduledAt: job.scheduledAt,
            trackingCode: job.trackingCode,
            originatorUserId: syntheticSession.user.userId,
            operatorUserId: admin.user.userId,
            routeMode: "admin_originator",
          });
          return;
        }
        const result = await dispatchPreparedDingTalkApproval(preparedResult.prepared);
        await settleSubmissionRequest(reservation, "success", { processInstanceId: result.processInstanceId });
        await recordSubmissionHistory({ session: syntheticSession, draft, status: "success", processInstanceId: result.processInstanceId });
        await adminWorkbench.setCaseStatus(caseId, "submitted", {
          processInstanceId: result.processInstanceId,
          originatorUserId: preparedResult.prepared.payload.originator_user_id,
          operatorUserId: admin.user.userId,
          routeMode: preparedResult.prepared.user?.submissionRoute?.mode || "self",
          dispatchMode: "immediate",
        });
        await adminWorkbench.updateAdminAction(actionId, { status: "succeeded", result: { processInstanceId: result.processInstanceId, scheduled: false } });
        sendJson(response, 200, {
          ok: true,
          processInstanceId: result.processInstanceId,
          scheduled: false,
          originatorUserId: preparedResult.prepared.payload.originator_user_id,
          operatorUserId: admin.user.userId,
          routeMode: preparedResult.prepared.user?.submissionRoute?.mode || "self",
        });
      } catch (error) {
        const failure = describeSubmissionFailure(error, draft.process_code);
        if (reservation) {
          await settleSubmissionRequest(reservation, "failed", { failureReason: failure.reason })
            .catch((dedupError) => console.error(`Admin submission dedup write failed: ${dedupError.message}`));
        }
        await adminWorkbench.setCaseStatus(caseId, "open");
        await adminWorkbench.updateAdminAction(actionId, { status: "failed", result: failure });
        const publicError = new Error(`${failure.reason} ${failure.advice}`.trim());
        publicError.statusCode = error.statusCode || 400;
        throw publicError;
      }
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/scheduled-approvals")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = requireScheduledAdmin(getSession(url.searchParams.get("session_token")));
      const store = getScheduledApprovalStore();
      sendJson(response, 200, {
        entries: store.listAdmin({ status: url.searchParams.get("status") || "", limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") }),
        stats: store.stats(),
        config: getScheduledApprovalConfig(),
        currentUser: { userId: session.user.userId, name: session.user.name || "" },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/admin/scheduled-approvals/action") {
      const body = await readRequestBody(request);
      requireScheduledAdmin(getSession(body.session_token));
      const store = getScheduledApprovalStore();
      const action = String(body.action || "");
      let result = null;
      let message = "";
      if (action === "pause") {
        store.setRuntime("paused", "true");
        result = { paused: true };
      } else if (action === "resume") {
        store.setRuntime("paused", "false");
        result = { paused: false };
      } else if (action === "dispatch-now" || action === "confirm-not-created") {
        const jobId = String(body.id || "");
        const scheduled = store.reschedule(jobId, new Date().toISOString());
        // “立即发起”不能只把时间改成现在再静默等待下一轮 Worker 扫描。
        // 在当前请求中主动跑一次调度；与独立 Worker 通过数据库原子认领隔离，
        // 两边同时运行也只会有一个进程真正创建 OA。
        store.addEvent(jobId, "manual_dispatch_requested", { action, requestedAt: new Date().toISOString() });
        const tick = await ensureScheduledApprovalScheduler()?.tick();
        result = store.getJob(scheduled.id) || scheduled;
        if (result.status === "succeeded") {
          message = `钉钉 OA 已发起，审批实例号：${result.processInstanceId || "已创建，编号待同步"}`;
        } else if (result.status === "dispatching") {
          message = "正在发起钉钉 OA，请勿重复点击；系统会自动刷新结果。";
        } else if (result.status === "retry") {
          message = `本次未立即发起，系统将自动重试：${result.failureReason || "请稍后刷新查看"}`;
        } else if (result.status === "manual" || result.status === "unknown") {
          message = `本次未确认发起成功：${result.failureReason || "请在异常记录中查看原因"}`;
        } else if (tick?.paused) {
          message = "当前批次已暂停，已记录立即发起请求；恢复批次后会继续处理。";
        } else {
          message = "立即发起请求已受理，系统正在同步最新状态。";
        }
      } else if (action === "reschedule") {
        const scheduledAt = new Date(body.scheduled_at);
        if (Number.isNaN(scheduledAt.getTime())) {
          const error = new Error("新的发送时间无效。");
          error.statusCode = 400;
          throw error;
        }
        result = store.reschedule(String(body.id || ""), scheduledAt.toISOString());
      } else if (action === "cancel") {
        result = store.cancel(String(body.id || ""));
      } else if (action === "tick") {
        result = await ensureScheduledApprovalScheduler()?.tick();
      } else {
        const error = new Error("不支持的管理操作。");
        error.statusCode = 400;
        throw error;
      }
      sendJson(response, 200, { result, message, stats: store.stats() });
      return;
    }

    if (request.method === "POST" && request.url === "/api/invoice-ledger/rollback") {
      const body = await readRequestBody(request);
      const session = getSession(body.session_token);
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session."); error.statusCode = 401; throw error;
      }
      const approval = await getDingTalkProcessInstance(body.process_instance_id);
      if (String(approval.originatorUserId) !== String(session.user.userId)) {
        const error = new Error("Only the approval originator can roll back its invoice ledger rows."); error.statusCode = 403; throw error;
      }
      const result = await rollbackInvoiceLedger(body.process_instance_id);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/files/preview-url")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const result = await getAttachmentPreviewUrl({
        session,
        spaceId: url.searchParams.get("space_id") || "",
        fileId: url.searchParams.get("file_id") || "",
        evidenceToken: url.searchParams.get("evidence_token") || "",
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/files/upload") {
      const result = await uploadApprovalFiles(request);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/expense-sheet/import") {
      const result = await importExpenseSheet(request);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/dingtalk/login") {
      const { authCode } = await readRequestBody(request);
      const result = await loginDingTalkUser(authCode);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/dingtalk/on-behalf/search")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      if (!canUseOnBehalf(session)) {
        const error = new Error("当前账号暂未开通代他人报销入口。");
        error.statusCode = 403;
        throw error;
      }
      const employees = await listDingTalkEmployees(url.searchParams.get("q") || "", url.searchParams.get("limit") || 20);
      sendJson(response, 200, { employees, policy: "subject-route-v1" });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/dingtalk/on-behalf/profile")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      if (!canUseOnBehalf(session)) {
        const error = new Error("当前账号暂未开通代他人报销入口。");
        error.statusCode = 403;
        throw error;
      }
      const subject = await getDingTalkEmployeeProfile(url.searchParams.get("user_id"));
      recordApplicationAuditEvent({
        session,
        id: `on-behalf-profile:${session.user.userId}:${subject.userId}`,
        eventType: "on_behalf_subject_selected",
        action: "subject_profile_lookup",
        status: "success",
        subjectUserId: subject.userId,
        subjectName: subject.name,
        companyName: subject.socialCompanyRecognition?.companyName || "",
      });
      sendJson(response, 200, { employee: subject, policy: "subject-route-v1" });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/dingtalk/organization")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const user = await syncDingTalkUserOrganization(session.user);
      sendJson(response, 200, { user });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/dingtalk/social-company")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session?.user?.userId) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const requestedUserId = String(url.searchParams.get("user_id") || session.user.userId);
      if (requestedUserId !== String(session.user.userId) && !canUseOnBehalf(session)) {
        const error = new Error("当前账号无权查询其他员工的社保主体。");
        error.statusCode = 403;
        throw error;
      }
      const socialCompanyRecognition = await recognizeSocialPaymentCompany(requestedUserId);
      if (requestedUserId === String(session.user.userId)) session.user.socialCompanyRecognition = socialCompanyRecognition;
      recordApplicationAuditEvent({
        session,
        id: `social-company-refresh:${session.user.userId}:${requestedUserId}:${socialCompanyRecognition.checkedAt}`,
        eventType: "social_company_recognition",
        action: "manual_refresh",
        status: socialCompanyRecognition.status,
        companyName: socialCompanyRecognition.companyName || "",
        subjectUserId: requestedUserId,
      });
      sendJson(response, 200, { socialCompanyRecognition });
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/recipient-accounts")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = requireRecipientAccountSession(url.searchParams.get("session_token"));
      const result = await listRecipientAccounts(session);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/recipient-accounts") {
      const body = await readRequestBody(request);
      const session = requireRecipientAccountSession(body.session_token);
      const result = await saveRecipientAccount(session, body.id, body.account);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "DELETE" && request.url.startsWith("/api/recipient-accounts/")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const accountId = decodeURIComponent(url.pathname.slice("/api/recipient-accounts/".length));
      if (!accountId) throw new Error("Missing recipient account id.");
      const session = requireRecipientAccountSession(url.searchParams.get("session_token"));
      const result = await removeRecipientAccount(session, accountId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url === "/api/dingtalk/config") {
      sendJson(response, 200, getPublicDingTalkConfig());
      return;
    }

    if (request.method === "GET" && request.url === "/api/ocr/status") {
      sendJson(response, 200, getOcrStatus());
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/related-approval-by-id")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const requestedUserId = String(url.searchParams.get("user_id") || session.user.userId);
      if (requestedUserId !== String(session.user.userId) && !canUseOnBehalf(session)) {
        const error = new Error("当前账号无权查询其他员工的关联审批。");
        error.statusCode = 403;
        throw error;
      }
      const result = await getManualRelatedProcessInstance({
        session,
        instanceId: url.searchParams.get("instance_id"),
        processCode: url.searchParams.get("process_code"),
        userId: requestedUserId,
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/related-approvals")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session) {
        const error = new Error("Missing or expired DingTalk session.");
        error.statusCode = 401;
        throw error;
      }
      const requestedUserId = String(url.searchParams.get("user_id") || session?.user?.userId || "");
      if (requestedUserId !== String(session?.user?.userId || "") && !canUseOnBehalf(session)) {
        const error = new Error("当前账号无权查询其他员工的关联审批。");
        error.statusCode = 403;
        throw error;
      }
      const result = await listDingTalkProcessInstances({
        session,
        userId: requestedUserId,
        processCode: url.searchParams.get("process_code"),
        days: url.searchParams.get("days"),
        maxResults: url.searchParams.get("max_results"),
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/admin/related-approvals")) {
      requireAdminToken(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const result = await listDingTalkProcessInstances({
        userId: url.searchParams.get("user_id"),
        processCode: url.searchParams.get("process_code"),
        days: url.searchParams.get("days"),
        maxResults: url.searchParams.get("max_results"),
      });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/api/approval-detail")) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const session = getSession(url.searchParams.get("session_token"));
      if (!session) throw new Error("Missing or expired DingTalk session.");
      const result = await getDingTalkProcessInstance(url.searchParams.get("instance_id"));
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(`Request failed ${request.method} ${request.url}: ${error.stack || error.message}`);
    sendJson(response, error.statusCode || 500, { error: error.message });
  }
});

if (process.env.OCR_REGRESSION !== "1" && process.env.REIMBURSEMENT_SCHEDULED_WORKER !== "1") {
  server.listen(port, host, () => {
    console.log(`Reimbursement assistant is running at http://${host}:${port}`);
    if (getInvoiceLedgerConfig().enabled) {
      setTimeout(() => reconcileInvoiceLedgerApprovals().catch((error) => console.error(`Invoice ledger reconcile failed: ${error.message}`)), 15000);
      setInterval(() => reconcileInvoiceLedgerApprovals().catch((error) => console.error(`Invoice ledger reconcile failed: ${error.message}`)), 5 * 60 * 1000).unref();
    }
  });
}

function startScheduledApprovalWorker() {
  const config = getScheduledApprovalConfig();
  if (!config.enabled) return { enabled: false, scheduler: null };
  const scheduler = ensureScheduledApprovalScheduler();
  setTimeout(() => scheduler.tick().catch((error) => console.error(`Scheduled approval startup tick failed: ${error.message}`)), 1000).unref();
  scheduler.start(config.intervalMs);
  console.log(`Scheduled approval worker enabled: calendar policy 1-20/21-25/26-end, release window 09:00-18:00 Asia/Shanghai, one OA per ${Math.round(config.releaseIntervalMs / 60000)} minute(s)`);
  return { enabled: true, scheduler };
}

export {
  getAliyunOcrClient,
  normalizeOcrResult,
  detectHighConfidenceInvoiceDocument,
  detectDocumentRole,
  resolveUploadedDocumentKind,
  applyDocumentClassification,
  buildDocumentIdentity,
  auditApprovalEvidence,
  validateApprovalInvoiceTitles,
  normalizeApprovalCompanyName,
  evaluateInvoiceTitleMatch,
  sanitizeApprovalEvidenceAttachments,
  parseApprovalEvidenceRows,
  reconcileSubmittedAttachmentBindings,
  signEvidenceRecord,
  verifyEvidenceToken,
  getAttachmentPreviewUrl,
  startScheduledApprovalWorker,
  getV2UserProfile,
  prepareDingTalkApproval,
  dispatchPreparedDingTalkApproval,
  createUploadedEvidence,
  uploadFileToDingTalkStorage,
  getDingTalkEmployeeProfile,
  prepareDingTalkApprovalForSession,
  prepareScheduledOrImmediateApproval,
  recordSubmissionHistory,
  reserveSubmissionRequest,
  settleSubmissionRequest,
  extractFilenameAmount,
  normalizeApprovalPayload,
  extractScenarioPaymentAmount,
  recognizeAllTextFile,
  recognizeWithFallback,
  recognizeUploadedFile,
  readXlsxXmlEntries,
  getXlsxSharedStrings,
  getXlsxFirstSheet,
  getXlsxRows,
  readXlsxEmbeddedImages,
  importInvoiceLedgerBatch,
  rollbackInvoiceLedger,
  buildInvoiceLedgerRepairTemplate,
  previewInvoiceLedgerRepair,
  applyInvoiceLedgerRepair,
  rollbackInvoiceLedgerRepair,
  readInvoiceLedgerRepairStore,
  getLedgerRepairFields,
  isUsableLedgerRepairSnapshot,
  normalizeLedgerCell,
  readInvoiceLedgerStore,
  reconcileInvoiceLedgerApprovals,
  registerInvoiceLedgerWorkbook,
  normalizeApprovalInstance,
  normalizeApprovalTravelInfo,
  getInvoiceLedgerSkipReason,
  collectInvoiceLedgerSnapshots,
  describeDingTalkApprovalFailure,
  describeSubmissionFailure,
  getSocialCompanyRecognitionConfig,
  getOnBehalfConfig,
  canUseOnBehalf,
  normalizeSubmissionRouteMode,
  resolveSubmissionRoute,
  readRosterFieldValue,
  resolveSocialPaymentCompany,
  recognizeSocialPaymentCompany,
};
