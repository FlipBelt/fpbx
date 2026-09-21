#!/usr/bin/env node
// Historical recovery tool.  It downloads only the invoice attachments that
// already have an audit mapping, parses them locally, and writes a durable
// recovery manifest.  No Aliyun OCR request is made by this tool.
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dingtalk from "@alicloud/dingtalk";
import * as $OpenApi from "@alicloud/openapi-client";
import * as Util from "@alicloud/tea-util";
import { extractInvoiceLedgerSnapshotFromPdfText, extractInvoicePartyFromPdfText, hasUsableHistoricalInvoiceSnapshot, isSafeInvoiceLedgerSnapshot } from "../invoice-ledger-local-parser.mjs";
import { downloadAndExtractInvoicePdf } from "../invoice-ledger-pdf-extraction.mjs";
import { isLedgerSnapshotReadyForWrite, toFinanceWorkbookRow } from "../invoice-ledger.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const dataDir = join(root, "data");
const ledgerFile = join(dataDir, "invoice-ledger-sync.json");
const configFile = join(root, "dingtalk.config.json");
const recoveryFile = join(dataDir, "invoice-ledger-historical-recovery.json");
const auditFile = join(dataDir, "invoice-ledger-extraction-regression.json");
const restoreJobsFile = join(dataDir, "invoice-ledger-historical-restore-jobs.json");
const applyJobsFile = join(dataDir, "invoice-ledger-safe-backfill-jobs.json");
const command = process.argv[2] || "plan";
const period = (process.argv.find((arg) => arg.startsWith("--period=")) || "").slice(9);
const execute = process.argv.includes("--execute");
const force = process.argv.includes("--force");
const onlyNeedsReview = process.argv.includes("--only-needs-review");
const providerOcr = process.argv.includes("--provider-ocr");
const replaceExisting = process.argv.includes("--replace-existing");
const includeRailTickets = process.argv.includes("--include-rail-tickets");
const redoRecovered = process.argv.includes("--redo-recovered");
const requestedLimit = Number((process.argv.find((arg) => arg.startsWith("--limit=")) || "").slice(8));
const auditConcurrency = Math.max(1, Math.min(2, Number((process.argv.find((arg) => arg.startsWith("--concurrency=")) || "").slice(14)) || 2));
const batchSize = Math.max(1, Math.min(20, Number((process.argv.find((arg) => arg.startsWith("--batch-size=")) || "").slice(13)) || 10));

function now() { return new Date().toISOString(); }
function cliError(message) { const error = new Error(message); error.isCli = true; return error; }
function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } }
async function writeJsonAtomic(file, value) { const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await fs.rename(temporary, file); }
function mergeEntriesByKey(entries = []) { return [...new Map(entries.filter((entry) => entry?.key).map((entry) => [entry.key, entry])).values()]; }
function configValue(config, name, fallback = "") { return process.env[name] || config[name] || fallback; }
function apiConfig() { return new $OpenApi.Config({ protocol: "https", regionId: "central" }); }
function headers(service, token, name) { return new service[name]({ xAcsDingtalkAccessToken: token }); }
function runtime() { return new Util.RuntimeOptions({}); }

async function getToken(config) {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appKey: configValue(config, "DINGTALK_APP_KEY", config.appKey), appSecret: configValue(config, "DINGTALK_APP_SECRET", config.appSecret) }) });
  const body = await response.json();
  if (!response.ok || !body.accessToken) throw cliError("无法获取钉钉应用令牌。请检查当前后端配置。");
  return body.accessToken;
}

async function approvalAttachmentUrl({ workflow, token, processInstanceId, fileId }) {
  const result = await workflow.grantProcessInstanceForDownloadFileWithOptions(
    new dingtalk.workflow_1_0.GrantProcessInstanceForDownloadFileRequest({ processInstanceId, fileId }),
    headers(dingtalk.workflow_1_0, token, "GrantProcessInstanceForDownloadFileHeaders"), runtime(),
  );
  const url = result?.body?.result?.downloadUri;
  if (!url) throw cliError("审批附件下载授权未返回下载地址。");
  return url;
}

async function downloadAndParsePdf(url, fileName) {
  const directory = await fs.mkdtemp(join(tmpdir(), "invoice-ledger-recovery-"));
  const safeName = text(fileName).replace(/[^a-zA-Z0-9._-]/g, "_") || "invoice.pdf";
  const file = join(directory, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw cliError(`审批附件下载失败（HTTP ${response.status}）。`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.subarray(0, 4).toString("utf8") !== "%PDF") throw cliError("该审批附件不是可解析的 PDF 发票。");
    await fs.writeFile(file, content);
    // Different invoice issuers embed their PDF text differently.  Keep both
    // renderings and use layout for the primary invoice/amount pair when it
    // is complete; raw then fills only missing fields.  This avoids treating
    // one formatting variant as universally reliable.
    const [{ stdout: layout }, { stdout: raw }] = await Promise.all([
      execFileAsync("pdftotext", ["-layout", file, "-"], { maxBuffer: 4 * 1024 * 1024 }),
      execFileAsync("pdftotext", ["-raw", file, "-"], { maxBuffer: 4 * 1024 * 1024 }),
    ]);
    const layoutSnapshot = extractInvoiceLedgerSnapshotFromPdfText(layout);
    const rawSnapshot = extractInvoiceLedgerSnapshotFromPdfText(raw);
    const score = (snapshot) => Object.values(snapshot).filter((value) => text(value)).length;
    const primary = score(rawSnapshot) >= score(layoutSnapshot) ? rawSnapshot : layoutSnapshot;
    const secondary = primary === layoutSnapshot ? rawSnapshot : layoutSnapshot;
    const snapshot = { ...primary };
    for (const [key, value] of Object.entries(secondary)) {
      if (!text(snapshot[key]) && text(value)) snapshot[key] = value;
    }
    // Some approvals contain a scanned invoice PDF or a corrupt text layer.
    // Render it locally and apply the installed open-source OCR.  This stays
    // entirely on the server and makes no paid or external OCR request.
    const needsPartyCrop = !text(snapshot.buyerName) || !text(snapshot.buyerTaxNumber)
      || !text(snapshot.sellerName) || !text(snapshot.sellerTaxNumber);
    if (!hasUsableHistoricalInvoiceSnapshot(snapshot) || needsPartyCrop) {
      const pagePrefix = join(directory, "rendered-page");
      await execFileAsync("pdftoppm", ["-png", "-r", "160", "-f", "1", "-l", "1", file, pagePrefix], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
      const pages = (await fs.readdir(directory)).filter((name) => /^rendered-page-\d+\.png$/u.test(name)).sort().slice(0, 1);
      const ocrTexts = [];
      for (const page of pages) {
        const { stdout } = await execFileAsync("tesseract", [join(directory, page), "stdout", "-l", "chi_sim+eng", "--psm", "6"], { maxBuffer: 4 * 1024 * 1024, timeout: 25_000 });
        ocrTexts.push(stdout);
      }
      const fallback = extractInvoiceLedgerSnapshotFromPdfText(ocrTexts.join("\n"));
      for (const [key, value] of Object.entries(fallback)) {
        if (!text(snapshot[key]) && text(value)) snapshot[key] = value;
      }
      // The party blocks are vertical text in many VAT PDFs. Whole-page OCR
      // loses their grouping, so OCR the left/right information panels as
      // independent, labelled fields. The coordinates are the standard
      // one-page electronic invoice layout rendered at 220 dpi.
      if (needsPartyCrop) {
        const partyJobs = [
          { side: "buyer", x: "15", y: "167", width: "647", height: "269" },
          { side: "seller", x: "665", y: "167", width: "647", height: "269" },
        ];
        for (const partyJob of partyJobs) {
          const prefix = join(directory, `${partyJob.side}-party`);
          await execFileAsync("pdftoppm", ["-png", "-r", "160", "-f", "1", "-l", "1", "-x", partyJob.x, "-y", partyJob.y, "-W", partyJob.width, "-H", partyJob.height, file, prefix], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
          const image = `${prefix}-1.png`;
          const { stdout } = await execFileAsync("tesseract", [image, "stdout", "-l", "chi_sim+eng", "--psm", "6"], { maxBuffer: 4 * 1024 * 1024, timeout: 25_000 });
          const party = extractInvoicePartyFromPdfText(stdout);
          if (partyJob.side === "buyer") {
            if (!text(snapshot.buyerName) && party.name) snapshot.buyerName = party.name;
            if (!text(snapshot.buyerTaxNumber) && party.taxNumber) snapshot.buyerTaxNumber = party.taxNumber;
          } else {
            if (!text(snapshot.sellerName) && party.name) snapshot.sellerName = party.name;
            if (!text(snapshot.sellerTaxNumber) && party.taxNumber) snapshot.sellerTaxNumber = party.taxNumber;
          }
        }
      }
      if (hasUsableHistoricalInvoiceSnapshot(fallback)) snapshot.source = "historical-approval-pdf-local-tesseract";
    }
    snapshot.source = snapshot.source || "historical-approval-pdf-local";
    const checked = isSafeInvoiceLedgerSnapshot(snapshot);
    return { ...checked.snapshot, rejectedFields: checked.rejectedFields };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function historicalRows(ledger) {
  return (ledger.events || []).flatMap((event) => {
    if (event.status !== "synced_partial" || (period && event.period !== period)) return [];
    return (event.rows || []).map((row) => ({ event, row }));
  }).filter(({ event, row }) => event.processInstanceId && row.fileId);
}

// Regression intentionally has a wider scope than the old recovery job: it
// evaluates every original attachment that has an approval/file mapping,
// regardless of whether it was previously written, skipped, or partial.
function auditRows(ledger) {
  return (ledger.events || []).flatMap((event) => {
    // Old write-mode events store `rows`; current audit-mode events persist
    // the OCR snapshot as `items` before any workbook operation.  Supporting
    // both makes the regression tool useful after process restart as well.
    const written = (event.rows || []).map((row) => ({ event, row }));
    const audited = (event.items || []).map((item, index) => ({
      event,
      row: {
        ...item,
        rowNumber: item.rowNumber || index + 1,
        fileName: item.fileName || "",
      },
    }));
    // A completed sync can contain both representations.  One attachment is
    // one audit unit; favour the written row because it has its real sheet row
    // number, while audit-mode events contribute their item-only records.
    const byFile = new Map(audited.map(({ row }) => [String(row.fileId || ""), { event, row }]));
    for (const item of written) byFile.set(String(item.row.fileId || ""), item);
    return [...byFile.values()];
  }).filter(({ event, row }) => event?.processInstanceId && row?.fileId && (!period || event.period === period));
}

function auditSummary(entries = []) {
  const summary = { total: entries.length, ready: 0, needs_review: 0, failed: 0, fields: {} };
  for (const field of ["invoiceNumber", "sellerTaxNumber", "sellerName", "buyerTaxNumber", "buyerName", "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount"]) summary.fields[field] = 0;
  for (const entry of entries) {
    if (entry.status === "ready") summary.ready += 1;
    else if (entry.status === "failed") summary.failed += 1;
    else summary.needs_review += 1;
    for (const field of Object.keys(summary.fields)) if (text(entry.snapshot?.[field])) summary.fields[field] += 1;
  }
  return summary;
}

async function audit() {
  const [config, ledger, previous] = await Promise.all([readJson(configFile, {}), readJson(ledgerFile, { events: [] }), readJson(auditFile, { entries: [] })]);
  const rows = auditRows(ledger);
  const oldByKey = new Map((previous.entries || []).filter((entry) => entry?.key).map((entry) => [entry.key, entry]));
  const selected = rows.filter(({ event, row }) => {
    const previousEntry = oldByKey.get(`${event.eventId}:${row.fileId}:${row.rowNumber}`);
    if (onlyNeedsReview) return previousEntry?.status === "needs_review";
    return force || Number(previousEntry?.snapshot?.version || 0) < 3;
  });
  if (!execute) return { mode: "dry-run", action: "audit", period: period || "all", mappedOriginalAttachments: rows.length, selected: selected.length, command: "node scripts/invoice-ledger-historical-recovery.mjs audit --execute --force" };
  const token = await getToken(config);
  const providerOcrConfig = providerOcr ? {
    enabled: true,
    provider: configValue(config, "OCR_PROVIDER", config.ocrProvider || "none"),
    accessKeyId: configValue(config, "ALIYUN_OCR_ACCESS_KEY_ID", config.aliyunOcrAccessKeyId || config.ocrAccessKeyId || ""),
    accessKeySecret: configValue(config, "ALIYUN_OCR_ACCESS_KEY_SECRET", config.aliyunOcrAccessKeySecret || config.ocrAccessKeySecret || ""),
    endpoint: configValue(config, "ALIYUN_OCR_ENDPOINT", config.aliyunOcrEndpoint || "ocr-api.cn-hangzhou.aliyuncs.com"),
    regionId: configValue(config, "ALIYUN_OCR_REGION", config.aliyunOcrRegion || "cn-hangzhou"),
  } : null;
  const workflow = new dingtalk.workflow_1_0.default(apiConfig());
  const completed = [];
  const auditOne = async ({ event, row }) => {
    const key = `${event.eventId}:${row.fileId}:${row.rowNumber}`;
    const entry = {
      key, eventId: event.eventId, approvalNumber: event.approvalNumber || "", processInstanceId: event.processInstanceId,
      period: event.period || "", fileId: row.fileId, fileName: row.fileName || "", rowNumber: row.rowNumber,
      status: "running", startedAt: now(), parserVersion: 3,
    };
    try {
      const url = await approvalAttachmentUrl({ workflow, token, processInstanceId: event.processInstanceId, fileId: row.fileId });
      const snapshot = await downloadAndExtractInvoicePdf({ url, fileName: row.fileName, providerOcr: providerOcrConfig });
      entry.snapshot = snapshot;
      entry.quality = snapshot.quality || {};
      entry.status = entry.quality.status || (hasUsableHistoricalInvoiceSnapshot(snapshot) ? "ready" : "needs_review");
      entry.reasons = entry.quality.reasons || [];
    } catch (error) {
      entry.status = "failed";
      entry.reasons = [error.message];
    }
    entry.completedAt = now();
    return entry;
  };
  for (let index = 0; index < selected.length; index += auditConcurrency) {
    const batch = await Promise.all(selected.slice(index, index + auditConcurrency).map(auditOne));
    completed.push(...batch);
    const entries = mergeEntriesByKey([...(previous.entries || []), ...completed]);
    await writeJsonAtomic(auditFile, { version: 3, mode: "read_only_regression", updatedAt: now(), entries, summary: auditSummary(entries) });
    for (const entry of batch) process.stdout.write(`审计 ${Math.min(selected.length, index + batch.indexOf(entry) + 1)}/${selected.length}：${entry.status}\n`);
  }
  const entries = mergeEntriesByKey([...(previous.entries || []), ...completed]);
  const summary = auditSummary(entries);
  await writeJsonAtomic(auditFile, { version: 3, mode: "read_only_regression", updatedAt: now(), entries, summary });
  return { mode: "execute", action: "audit", period: period || "all", onlyNeedsReview, providerOcr, processed: completed.length, summary };
}

async function recover() {
  const [config, ledger, existing] = await Promise.all([readJson(configFile, {}), readJson(ledgerFile, { events: [] }), readJson(recoveryFile, { version: 1, entries: [] })]);
  const rows = historicalRows(ledger);
  const existingEntries = mergeEntriesByKey(existing.entries || []);
  const prior = new Map(existingEntries.map((entry) => [entry.key, entry]));
  const candidates = rows.filter(({ event, row }) => {
    const priorEntry = prior.get(`${event.eventId}:${row.fileId}:${row.rowNumber}`);
    if (redoRecovered) return priorEntry?.status === "recovered"
      && hasUsableHistoricalInvoiceSnapshot(priorEntry.snapshot)
      && Number(priorEntry.snapshot?.version || 0) < 2;
    return force || !(priorEntry?.status === "recovered" && hasUsableHistoricalInvoiceSnapshot(priorEntry.snapshot));
  });
  const selectedRows = Number.isFinite(requestedLimit) && requestedLimit > 0 ? candidates.slice(0, requestedLimit) : candidates;
  if (!execute) return { mode: "dry-run", action: "recover", period: period || "all", eligible: candidates.length, selected: selectedRows.length, command: "node scripts/invoice-ledger-historical-recovery.mjs recover --execute" };
  const token = await getToken(config);
  const workflow = new dingtalk.workflow_1_0.default(apiConfig());
  const entries = [];
  for (let index = 0; index < selectedRows.length; index += 1) {
    const { event, row } = selectedRows[index];
    const key = `${event.eventId}:${row.fileId}:${row.rowNumber}`;
    const already = prior.get(key);
    const entry = { key, eventId: event.eventId, approvalNumber: event.approvalNumber || "", processInstanceId: event.processInstanceId, period: event.period, workbookId: event.workbookId, sheetId: row.sheetId, rowNumber: row.rowNumber, fileId: row.fileId, fileName: row.fileName || "", sourceRow: row.row || [], status: "running", startedAt: now() };
    try {
      const url = await approvalAttachmentUrl({ workflow, token, processInstanceId: event.processInstanceId, fileId: row.fileId });
      const snapshot = await downloadAndParsePdf(url, row.fileName);
      entry.snapshot = snapshot;
      entry.status = hasUsableHistoricalInvoiceSnapshot(snapshot) ? "recovered" : "partial";
      entry.reason = entry.status === "partial" ? "local_pdf_text_missing_required_invoice_number_or_total" : "";
    } catch (error) { entry.status = "failed"; entry.reason = error.message; }
    entry.completedAt = now(); entries.push(entry);
    await writeJsonAtomic(recoveryFile, { version: 1, updatedAt: now(), entries: mergeEntriesByKey([...existingEntries, ...entries]) });
    process.stdout.write(`已处理 ${index + 1}/${selectedRows.length}：${entry.status}\n`);
  }
  const all = mergeEntriesByKey([...existingEntries, ...entries]);
  await writeJsonAtomic(recoveryFile, { version: 1, updatedAt: now(), entries: all });
  return { mode: "execute", action: "recover", total: entries.length, recovered: entries.filter((item) => item.status === "recovered").length, partial: entries.filter((item) => item.status === "partial").length, failed: entries.filter((item) => item.status === "failed").length };
}

function ledgerFields(snapshot) { return toFinanceWorkbookRow(snapshot, { serial: "", submittedAt: "2000-01-01", allowIncomplete: true }).slice(1, 11); }
function normalizeComparableCell(value, index) {
  if (value === undefined || value === null || value === "") return "";
  // DingTalk spreadsheets store dates as Excel serial numbers after an
  // updateRange call.  Convert them back before comparing to the ISO strings
  // supplied by the ledger contract.
  if ([6, 11].includes(index)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
      return utc.toISOString().slice(0, 10);
    }
    const match = text(value).match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  if ([8, 9, 10].includes(index)) {
    const number = Number(String(value).replace(/[￥¥,，\s]/g, ""));
    if (Number.isFinite(number)) return number.toFixed(2);
  }
  return text(value);
}
function cellsEqual(left, right, index) { return normalizeComparableCell(left, index) === normalizeComparableCell(right, index); }
function rowIsBlank(row) { return !row.some((value) => text(value)); }
function isNotBooked(value) { return ["", "否", "no"].includes(text(value).toLowerCase()); }
function correctionKey(entry) { return `${entry.workbookId}:${entry.sheetId}:${entry.rowNumber}`; }

function strictSnapshotReady(entry = {}) {
  const snapshot = entry.snapshot || {};
  // The finance workbook has a fixed B:K contract.  Profile-level validity
  // (for example a railway ticket without VAT tax fields) is not sufficient
  // for a historical backfill when the requested rule is “no blank fields”.
  const allLedgerColumnsPresent = ["invoiceNumber", "sellerTaxNumber", "sellerName", "buyerTaxNumber", "buyerName", "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount"]
    .every((field) => text(snapshot[field]));
  const profileCompleteRailTicket = includeRailTickets && entry.quality?.documentType === "rail_ticket";
  return entry.status === "ready" && isLedgerSnapshotReadyForWrite(snapshot) && (allLedgerColumnsPresent || profileCompleteRailTicket);
}

function backfillDedupKey(entry = {}) {
  const snapshot = entry.snapshot || {};
  // Invoice number is immutable for VAT and e-ticket documents.  Including
  // seller tax/total avoids collapsing valid same-number edge cases.
  return `${text(snapshot.invoiceNumber)}|${text(snapshot.sellerTaxNumber)}|${text(snapshot.totalAmount)}`;
}

async function applyReadyAuditEntries() {
  if (!period) throw cliError("安全回填必须指定 --period=YYYY-MM。");
  const [config, ledger, audit, existing] = await Promise.all([
    readJson(configFile, {}), readJson(ledgerFile, { events: [], months: {} }),
    readJson(auditFile, { entries: [] }), readJson(applyJobsFile, { version: 1, jobs: [] }),
  ]);
  const workbook = ledger.months?.[period];
  if (!workbook?.workbookId) throw cliError(`未登记 ${period} 的目标台账文件。`);
  const matching = (audit.entries || []).filter((entry) => entry.period === period);
  const skipped = matching.filter((entry) => !strictSnapshotReady(entry)).map((entry) => ({ key: entry.key, status: entry.status, reasons: entry.reasons || [] }));
  const unique = new Map(); const duplicate = [];
  for (const entry of matching.filter(strictSnapshotReady)) {
    const key = backfillDedupKey(entry);
    if (!key || unique.has(key)) { duplicate.push({ key: entry.key, reason: "duplicate_invoice_snapshot" }); continue; }
    unique.set(key, entry);
  }
  const candidates = [...unique.values()];
  if (!candidates.length) return { mode: execute ? "execute" : "dry-run", action: "apply-ready", period, eligible: 0, skipped: skipped.length, duplicate: duplicate.length };
  const token = await getToken(config);
  const operatorUserId = configValue(config, "DINGTALK_INVOICE_LEDGER_OPERATOR_USER_ID", config.invoiceLedger?.operatorUserId);
  if (!operatorUserId) throw cliError("缺少台账操作人配置。");
  const userResponse = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userid: operatorUserId, language: "zh_CN" }) });
  const user = await userResponse.json(); const operatorId = user?.result?.unionid || user?.result?.unionId;
  if (!operatorId) throw cliError("无法取得台账操作人的 unionId。");
  const client = new dingtalk.doc_1_0.default(apiConfig());
  const sheets = (await client.getAllSheetsWithOptions(workbook.workbookId, new dingtalk.doc_1_0.GetAllSheetsRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetAllSheetsHeaders"), runtime())).body?.value || [];
  const sheet = sheets[0]; if (!sheet?.id) throw cliError("目标台账没有工作表。");
  // This controlled job is capped at 83 rows.  Keep the preflight small as
  // DingTalk's document gateway can time out on unnecessarily large ranges.
  const current = (await client.getRangeWithOptions(workbook.workbookId, sheet.id, "A1:M200", new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values || [];
  const occupied = current.slice(1).map((row, index) => ({ row: index + 2, value: row || [] })).filter((item) => !rowIsBlank(item.value));
  const backupEnd = Math.max(candidates.length + 1, ...occupied.map((item) => item.row), 1);
  const plan = {
    action: "apply-ready", period, workbook: workbook.name || "", sheetId: sheet.id,
    eligible: candidates.length, skipped: skipped.length, duplicate: duplicate.length,
    occupiedRows: occupied.length, occupiedRowNumbers: occupied.map((item) => item.row),
    batchSize, replaceExisting, includeRailTickets, backupRange: `A2:M${backupEnd}`,
  };
  if (!execute) return { mode: "dry-run", ...plan };
  if (occupied.length && !replaceExisting) throw cliError(`目标台账不是空表，检测到 ${occupied.length} 行已有数据；为避免覆盖，安全回填已停止。`);
  const events = new Map((ledger.events || []).map((event) => [event.eventId, event]));
  const fullBackup = current.slice(1, backupEnd).map((row) => Array.from({ length: 13 }, (_, index) => row?.[index] ?? ""));
  const job = { jobId: randomUUID(), type: "safe_ready_audit_backfill", createdAt: now(), status: "running", plan, skipped, duplicate, backup: { range: plan.backupRange, values: fullBackup }, batches: [] };
  existing.jobs = [...(existing.jobs || []), job]; await writeJsonAtomic(applyJobsFile, existing);
  const restoreFullBackup = async () => {
    await client.updateRangeWithOptions(workbook.workbookId, sheet.id, plan.backupRange, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: fullBackup }), headers(dingtalk.doc_1_0, token, "UpdateRangeHeaders"), runtime());
  };
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const entries = candidates.slice(offset, offset + batchSize);
    // Recheck immediately before every write batch.  A malformed snapshot can
    // never become writable merely because it was once marked ready.
    const unsafe = entries.filter((entry) => !strictSnapshotReady(entry));
    if (unsafe.length) throw cliError(`第 ${offset / batchSize + 1} 批字段复核失败，已停止写入。`);
    const start = offset + 2; const end = start + entries.length - 1;
    const values = entries.map((entry, index) => {
      const event = events.get(entry.eventId) || {};
      return toFinanceWorkbookRow(entry.snapshot, { serial: start + index - 1, submittedAt: event.approvalCreatedAt || event.submittedAt || `${period}-01`, booked: "否" });
    });
    const range = `A${start}:M${end}`;
    const batch = { range, keys: entries.map((entry) => entry.key), status: "writing", before: fullBackup.slice(start - 2, end - 1) };
    job.batches.push(batch); await writeJsonAtomic(applyJobsFile, existing);
    await client.updateRangeWithOptions(workbook.workbookId, sheet.id, range, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values }), headers(dingtalk.doc_1_0, token, "UpdateRangeHeaders"), runtime());
    const after = (await client.getRangeWithOptions(workbook.workbookId, sheet.id, range, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values || [];
    const valid = values.every((row, rowIndex) => row.every((value, columnIndex) => cellsEqual(value, after[rowIndex]?.[columnIndex], columnIndex)));
    if (!valid) {
      await restoreFullBackup();
      batch.status = "rolled_back_readback_mismatch"; job.status = "failed_rolled_back"; await writeJsonAtomic(applyJobsFile, existing);
      throw cliError(`第 ${offset / batchSize + 1} 批回读校验失败，已自动回滚该批。`);
    }
    batch.status = "written_verified"; batch.completedAt = now(); await writeJsonAtomic(applyJobsFile, existing);
  }
  // New data occupies rows 2..(eligible + 1).  Explicit replacement must
  // also remove prior system rows below that boundary, otherwise stale rows
  // remain as duplicate invoices.
  const staleStart = candidates.length + 2;
  if (replaceExisting && backupEnd >= staleStart) {
    const staleRange = `A${staleStart}:M${backupEnd}`;
    await client.updateRangeWithOptions(workbook.workbookId, sheet.id, staleRange, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: Array.from({ length: backupEnd - staleStart + 1 }, () => Array(13).fill("")) }), headers(dingtalk.doc_1_0, token, "UpdateRangeHeaders"), runtime());
  }
  const finalRows = (await client.getRangeWithOptions(workbook.workbookId, sheet.id, `A2:M${backupEnd}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values || [];
  const expectedRows = candidates.map((entry, index) => {
    const event = events.get(entry.eventId) || {};
    return toFinanceWorkbookRow(entry.snapshot, { serial: index + 1, submittedAt: event.approvalCreatedAt || event.submittedAt || `${period}-01`, booked: "否" });
  });
  const finalValid = expectedRows.every((row, rowIndex) => row.every((value, columnIndex) => cellsEqual(value, finalRows[rowIndex]?.[columnIndex], columnIndex)))
    && finalRows.slice(expectedRows.length).every(rowIsBlank);
  if (!finalValid) {
    await restoreFullBackup(); job.status = "failed_rolled_back"; job.failure = "final_readback_mismatch"; await writeJsonAtomic(applyJobsFile, existing);
    throw cliError("最终回读校验失败，已恢复覆盖前备份。");
  }
  job.status = "completed"; job.completedAt = now(); await writeJsonAtomic(applyJobsFile, existing);
  return { mode: "execute", action: "apply-ready", period, written: candidates.length, skipped: skipped.length, duplicate: duplicate.length, batches: job.batches.length };
}

function mostRecentHistoricalWrites(jobs = []) {
  const result = new Map();
  for (const job of jobs) {
    if (job.type !== "historical_restore_cleared_rows") continue;
    for (const entry of job.entries || []) {
      if (Array.isArray(entry.after) && entry.after.length) result.set(correctionKey(entry), entry);
    }
  }
  return result;
}

async function restore() {
  const [config, recovery, existingJobs] = await Promise.all([readJson(configFile, {}), readJson(recoveryFile, { entries: [] }), readJson(restoreJobsFile, { jobs: [] })]);
  const candidates = (recovery.entries || []).filter((entry) => entry.status === "recovered" && (!period || entry.period === period) && hasUsableHistoricalInvoiceSnapshot(entry.snapshot));
  if (!candidates.length) return { mode: execute ? "execute" : "dry-run", action: "restore", eligible: 0, message: "尚无可恢复的完整本地解析结果。请先执行 recover --execute。" };
  const token = await getToken(config); const operatorUserId = configValue(config, "DINGTALK_INVOICE_LEDGER_OPERATOR_USER_ID", config.invoiceLedger?.operatorUserId);
  if (!operatorUserId) throw cliError("缺少台账操作人配置。");
  const userResponse = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userid: operatorUserId, language: "zh_CN" }) });
  const user = await userResponse.json(); const operatorId = user?.result?.unionid || user?.result?.unionId;
  if (!operatorId) throw cliError("无法取得台账操作人的 unionId。");
  const client = new dingtalk.doc_1_0.default(apiConfig()); const planned = [];
  for (const entry of candidates) {
    const current = (await client.getRangeWithOptions(entry.workbookId, entry.sheetId, `A${entry.rowNumber}:M${entry.rowNumber}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values?.[0] || [];
    const source = Array.isArray(entry.sourceRow) ? entry.sourceRow : [];
    const desired = toFinanceWorkbookRow(entry.snapshot, { serial: source[0] || entry.rowNumber - 1, submittedAt: source[11] || `${entry.period}-01`, booked: source[12] || "否", allowIncomplete: true });
    const matches = desired.every((value, index) => cellsEqual(value, current[index], index));
    planned.push({ ...entry, before: current, desired, status: matches ? "already_restored" : rowIsBlank(current) ? "ready_restore" : "manual_conflict" });
  }
  const summary = planned.reduce((out, entry) => ({ ...out, [entry.status]: (out[entry.status] || 0) + 1 }), {});
  if (!execute) return { mode: "dry-run", action: "restore", summary };
  const job = { jobId: randomUUID(), type: "historical_restore_cleared_rows", createdAt: now(), status: "running", entries: planned, summary };
  existingJobs.jobs = [...(existingJobs.jobs || []), job]; await writeJsonAtomic(restoreJobsFile, existingJobs);
  for (const entry of job.entries.filter((item) => item.status === "ready_restore")) {
    try {
      await client.updateRangeWithOptions(entry.workbookId, entry.sheetId, `A${entry.rowNumber}:M${entry.rowNumber}`, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [entry.desired] }), headers(dingtalk.doc_1_0, token, "UpdateRangeHeaders"), runtime());
      const after = (await client.getRangeWithOptions(entry.workbookId, entry.sheetId, `A${entry.rowNumber}:M${entry.rowNumber}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values?.[0] || [];
      entry.after = after; entry.status = entry.desired.every((value, index) => cellsEqual(value, after[index], index)) ? "restored" : "failed"; entry.reason = entry.status === "failed" ? "read_back_mismatch" : "";
    } catch (error) { entry.status = "failed"; entry.reason = error.message; }
    job.updatedAt = now(); await writeJsonAtomic(restoreJobsFile, existingJobs);
  }
  job.completedAt = now(); job.summary = job.entries.reduce((out, entry) => ({ ...out, [entry.status]: (out[entry.status] || 0) + 1 }), {}); job.status = job.summary.failed ? "completed_with_errors" : "completed"; await writeJsonAtomic(restoreJobsFile, existingJobs);
  return { mode: "execute", action: "restore", jobId: job.jobId, summary: job.summary };
}

async function correct() {
  const [config, recovery, existingJobs] = await Promise.all([readJson(configFile, {}), readJson(recoveryFile, { entries: [] }), readJson(restoreJobsFile, { jobs: [] })]);
  // A v2 re-parse may intentionally downgrade a formerly recovered row to
  // "partial".  It still needs correcting: preserve only fields backed by the
  // new parser, and clear B:K when the invoice no longer meets the minimum
  // safe ledger requirement.  Limit the scope to rows we can prove were
  // written by the earlier recovery job.
  const previousWrites = mostRecentHistoricalWrites(existingJobs.jobs || []);
  const candidates = (recovery.entries || []).filter((entry) => (
    (!period || entry.period === period)
    && Number(entry.snapshot?.version || 0) >= 2
    && previousWrites.has(correctionKey(entry))
  ));
  if (!candidates.length) return { mode: execute ? "execute" : "dry-run", action: "correct", eligible: 0 };
  const token = await getToken(config); const operatorUserId = configValue(config, "DINGTALK_INVOICE_LEDGER_OPERATOR_USER_ID", config.invoiceLedger?.operatorUserId);
  if (!operatorUserId) throw cliError("缺少台账操作人配置。");
  const userResponse = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userid: operatorUserId, language: "zh_CN" }) });
  const user = await userResponse.json(); const operatorId = user?.result?.unionid || user?.result?.unionId;
  if (!operatorId) throw cliError("无法取得台账操作人的 unionId。");
  const client = new dingtalk.doc_1_0.default(apiConfig()); const planned = [];
  for (const entry of candidates) {
    const current = (await client.getRangeWithOptions(entry.workbookId, entry.sheetId, `A${entry.rowNumber}:M${entry.rowNumber}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values?.[0] || [];
    const hasSafeSnapshot = entry.status === "recovered" && hasUsableHistoricalInvoiceSnapshot(entry.snapshot);
    const desired = hasSafeSnapshot ? ledgerFields(entry.snapshot) : Array(10).fill("");
    const historical = previousWrites.get(correctionKey(entry));
    const unchangedSinceSystemWrite = historical && desired.length === 10 && historical.after.slice(1, 11).every((value, index) => cellsEqual(value, current[index + 1], index + 1));
    const alreadyCorrect = desired.every((value, index) => cellsEqual(value, current[index + 1], index + 1));
    let status = "ready_correction"; let reason = "";
    if (!historical) { status = "manual_conflict"; reason = "missing_historical_write_snapshot"; }
    else if (!isNotBooked(current[12])) { status = "manual_conflict"; reason = "already_booked"; }
    else if (alreadyCorrect) { status = "already_correct"; }
    else if (!unchangedSinceSystemWrite) { status = "manual_conflict"; reason = "row_changed_after_system_write"; }
    planned.push({ ...entry, before: current, desired, status, reason, correctionMode: hasSafeSnapshot ? "replace_with_v2" : "clear_unsafe_legacy_fields" });
  }
  const summary = planned.reduce((out, entry) => ({ ...out, [entry.status]: (out[entry.status] || 0) + 1 }), {});
  if (!execute) return { mode: "dry-run", action: "correct", summary };
  const job = { jobId: randomUUID(), type: "historical_field_correction", createdAt: now(), status: "running", entries: planned, summary };
  existingJobs.jobs = [...(existingJobs.jobs || []), job]; await writeJsonAtomic(restoreJobsFile, existingJobs);
  for (const entry of job.entries.filter((item) => item.status === "ready_correction")) {
    try {
      await client.updateRangeWithOptions(entry.workbookId, entry.sheetId, `B${entry.rowNumber}:K${entry.rowNumber}`, new dingtalk.doc_1_0.UpdateRangeRequest({ operatorId, values: [entry.desired] }), headers(dingtalk.doc_1_0, token, "UpdateRangeHeaders"), runtime());
      const after = (await client.getRangeWithOptions(entry.workbookId, entry.sheetId, `B${entry.rowNumber}:K${entry.rowNumber}`, new dingtalk.doc_1_0.GetRangeRequest({ operatorId }), headers(dingtalk.doc_1_0, token, "GetRangeHeaders"), runtime())).body?.values?.[0] || [];
      entry.after = after; entry.status = entry.desired.every((value, index) => cellsEqual(value, after[index], index + 1)) ? "corrected" : "failed"; entry.reason = entry.status === "failed" ? "read_back_mismatch" : "";
    } catch (error) { entry.status = "failed"; entry.reason = error.message; }
    job.updatedAt = now(); await writeJsonAtomic(restoreJobsFile, existingJobs);
  }
  job.completedAt = now(); job.summary = job.entries.reduce((out, entry) => ({ ...out, [entry.status]: (out[entry.status] || 0) + 1 }), {}); job.status = job.summary.failed ? "completed_with_errors" : "completed"; await writeJsonAtomic(restoreJobsFile, existingJobs);
  return { mode: "execute", action: "correct", jobId: job.jobId, summary: job.summary };
}

async function main() {
  if (!new Set(["plan", "audit", "recover", "restore", "correct", "apply-ready"]).has(command)) throw cliError("用法：plan | audit --execute --force | apply-ready --period=YYYY-MM [--execute] | recover [--redo-recovered] --execute | restore [--execute] | correct [--execute] [--period=YYYY-MM]");
  if (command === "plan") { const ledger = await readJson(ledgerFile, { events: [] }); const rows = historicalRows(ledger); return { action: "plan", period: period || "all", historicalPartialRows: rows.length, flow: ["审批附件专用下载接口", "本地 PDF 解析（不调用付费 OCR）", "生成恢复清单", "仅恢复当前为空且回读一致的台账行"] }; }
  if (command === "audit") return audit();
  if (command === "apply-ready") return applyReadyAuditEntries();
  if (command === "recover") return recover();
  return command === "correct" ? correct() : restore();
}

main().then((result) => { console.log(JSON.stringify(result, null, 2)); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
