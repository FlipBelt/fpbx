import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || new URL("..", import.meta.url).pathname);
const database = new Database(resolve(root, "data/scheduled-approvals.sqlite"), { readonly: true });
const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
const runtime = Object.fromEntries(database.prepare("SELECT key, value, updated_at AS updatedAt FROM scheduled_approval_runtime").all()
  .map((row) => [row.key, row]));
const jobs = Number(database.prepare("SELECT COUNT(*) AS count FROM scheduled_approval_jobs").get().count);
const auditEvents = tables.has("application_audit_events")
  ? Number(database.prepare("SELECT COUNT(*) AS count FROM application_audit_events").get().count)
  : -1;
database.close();

const config = JSON.parse(await readFile(resolve(root, "dingtalk.config.json"), "utf8"));
const scheduled = config.scheduledApprovals || {};
const heartbeatAgeSeconds = runtime.lastHeartbeat
  ? Math.max(0, Math.round((Date.now() - Date.parse(runtime.lastHeartbeat.updatedAt)) / 1000))
  : -1;

console.log(`audit_table=${tables.has("application_audit_events")}`);
console.log(`audit_events=${auditEvents}`);
console.log(`scheduled_jobs=${jobs}`);
console.log(`heartbeat_age_seconds=${heartbeatAgeSeconds}`);
console.log(`last_batch_count=${runtime.lastBatchCount?.value || "0"}`);
console.log(`scheduler_error=${runtime.lastSchedulerError?.value || "none"}`);
console.log(`admin_count=${Array.isArray(scheduled.adminUserIds) ? scheduled.adminUserIds.length : 0}`);
console.log(`feature_enabled=${Boolean(scheduled.enabled)}`);

if (!tables.has("application_audit_events")) process.exitCode = 1;
if (heartbeatAgeSeconds < 0 || heartbeatAgeSeconds > 180) process.exitCode = 1;
if (runtime.lastSchedulerError?.value) process.exitCode = 1;
if (!Array.isArray(scheduled.adminUserIds) || scheduled.adminUserIds.length !== 1) process.exitCode = 1;
if (!scheduled.enabled) process.exitCode = 1;
