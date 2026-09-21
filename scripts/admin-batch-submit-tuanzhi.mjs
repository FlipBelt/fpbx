#!/usr/bin/env node

// Controlled, one-shot administrator batch runner for the already-confirmed
// Tuanzhi reimbursement split.  It reuses the production upload/OCR/evidence
// and scheduled-submission functions; it does not call DingTalk directly with
// a hand-built OA payload or borrow the employee's personal token.

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createAdminWorkbench } from "../admin-workbench.mjs";
import {
  applyDocumentClassification,
  buildDocumentIdentity,
  createUploadedEvidence,
  getDingTalkEmployeeProfile,
  prepareDingTalkApprovalForSession,
  prepareScheduledOrImmediateApproval,
  recognizeUploadedFile,
  recordSubmissionHistory,
  reserveSubmissionRequest,
  settleSubmissionRequest,
  uploadFileToDingTalkStorage,
  verifyEvidenceToken,
} from "../server.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceDir = resolve(process.argv[2] || "");
if (!sourceDir) throw new Error("Usage: admin-batch-submit-tuanzhi.mjs <source-dir>");

const TARGET_USER_ID = "17527338004768506";
const OPERATOR_USER_ID = "17748641644197045";
const DAILY_TEMPLATE_CASE = "b0a47901-aec4-40a7-a829-f5baa9393be4";
const NO_INVOICE_TEMPLATE_CASE = "3021e41a-8292-47d8-9400-670c7065740e";
const TRACE_PREFIX = `admin-tuanzhi-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

const exactRows = [
  { date: "2026-04-25", reason: "北京回杭州机票", amount: "950.00", payment: ["北京回杭州机票.jpg"], invoice: ["北京回杭州机票.pdf"] },
  { date: "2026-04-21", reason: "北京打车去机场", amount: "26.15", payment: ["北京打车去机场.jpg"], invoice: ["北京打车去机场.pdf"] },
  { date: "2026-04-21", reason: "打车杭州去机场", amount: "42.43", payment: ["打车杭州去机场.png"], invoice: ["打车杭州去机场.pdf"] },
  { date: "2026-04-21", reason: "杭州去北京机票及保险", amount: "735.00", payment: ["杭州去北京机票.png", "杭州去北京机票保险.png"], invoice: ["杭州去北京机票（含保险）.pdf"] },
  { date: "2026-04-21", reason: "杭州到北京高铁", amount: "122.50", payment: ["杭州到北京.png"], invoice: ["杭州到北京高铁.pdf"] },
  { date: "2026-04-18", reason: "西安回杭州高铁", amount: "724.50", payment: ["西安回杭州高铁.png"], invoice: ["西安回杭州高铁.pdf"] },
  { date: "2026-04-18", reason: "西安酒店（138元）", amount: "138.00", payment: ["西安酒店.png"], invoice: ["西安酒店138.pdf"] },
  { date: "2026-04-17", reason: "西安酒店（109元）", amount: "109.00", payment: ["西安酒店2.png"], invoice: ["西安酒店109.pdf"] },
  { date: "2026-04-17", reason: "打车去高铁站（13.77元）", amount: "13.77", payment: ["打车去高铁站.png"], invoice: ["打车去高铁站.pdf"] },
  { date: "2026-04-16", reason: "杭州去西安高铁", amount: "707.50", payment: ["杭州去西安.png"], invoice: ["杭州去西安高铁.pdf"] },
  { date: "2026-04-14", reason: "上海打车去跑团", amount: "47.20", payment: ["上海打车去跑团.png"], invoice: ["上海打车去跑团.pdf"] },
  { date: "2026-04-14", reason: "打车去高铁站（14.62元）", amount: "14.62", payment: ["打车去高铁站2.png"], invoice: ["打车去高铁站 (2).pdf"] },
  { date: "2026-04-14", reason: "打车去ektos", amount: "18.84", payment: ["打车去ektos.png"], invoice: ["打车去ektos.pdf"] },
  { date: "2026-04-14", reason: "跑团打车", amount: "16.29", payment: ["跑团打车.png"], invoice: ["跑团打车.pdf"] },
  { date: "2026-04-14", reason: "西安吃饭", amount: "102.40", payment: ["西安吃饭2.png"], invoice: ["西安吃饭.pdf"] },
  { date: "2026-05-14", reason: "杭州去上海高铁", amount: "87.00", payment: ["杭州去上海高铁.png"], invoice: ["杭州去上海高铁.pdf"] },
  { date: "2026-05-14", reason: "上海高铁回杭州", amount: "80.00", payment: ["上海回杭州高铁.png"], invoice: ["上海高铁回杭州.pdf"] },
];

const noInvoiceRows = [
  ["北京午饭", "18.17", "北京午饭.png"],
  ["西安吃饭", "46.29", "西安跑团买水.png"],
  ["西安晚饭", "27.00", "西安晚饭.png"],
  ["上海地铁", "3.00", "上海地铁.png"],
  ["上海哈罗单车", "9.40", "上海哈罗单车.png"],
  ["上海午饭", "16.20", "上海午饭.png"],
  ["西安自行车", "1.80", "西安自行车.png"],
  ["西安自行车2", "7.90", "西安自行车2.png"],
  ["上海自行车", "3.50", "上海自行车.png"],
  ["上海晚饭", "45.20", "上海晚饭.png"],
].map(([reason, amount, file]) => ({ date: "2026-04-22", reason, amount, payment: [file], invoice: [] }));

// The three groups previously held back because payment and invoice totals
// differ.  They are now submitted as no-invoice expenses, using only the
// payment evidence and the employee-confirmed payment amount.
const mismatchNoInvoiceRows = [
  { date: "2026-04-19", reason: "北京酒店（付款金额与发票不一致）", amount: "255.46", payment: ["北京酒店.png"], invoice: [] },
  { date: "2026-04-21", reason: "北京机场去酒店（付款金额与发票不一致）", amount: "153.94", payment: ["打车北京机场去酒店.png"], invoice: [] },
  { date: "2026-04-14", reason: "四合一付款组（付款金额与发票不一致）", amount: "429.61", payment: ["金华到杭州送货.png", "西安打车去高铁站.png", "西安打车去酒店.png", "打车去上海高铁站.png"], invoice: [] },
];

const runMode = String(process.argv[3] || "full").trim().toLowerCase();
if (!["full", "mismatch-no-invoice"].includes(runMode)) {
  throw new Error("第二个参数只能是 full 或 mismatch-no-invoice。");
}

function json(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function fileMime(name) {
  const ext = extname(name).toLowerCase();
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf" })[ext] || "application/octet-stream";
}

function componentByName(components, pattern) {
  return components.find((component) => pattern.test(String(component?.name || "")));
}

function cloneTableRow(templateRow, values) {
  const cells = Array.isArray(templateRow)
    ? templateRow
    : (templateRow?.rowValue || templateRow?.details || []);
  const updated = cells.map((cell) => {
    const name = String(cell?.name || cell?.label || "");
    if (!name) return cell;
    const nextValue = values[name];
    return nextValue === undefined ? cell : { ...cell, value: nextValue };
  });
  if (Array.isArray(templateRow)) return updated;
  if (Array.isArray(templateRow?.rowValue)) return { ...templateRow, rowValue: updated };
  return { ...templateRow, details: updated };
}

function makeDraft(template, { rows, total, noInvoice, companyName, target, operator, workflowId, workflowTitle, evidenceManifest }) {
  const source = json(template.snapshot.draft);
  const components = Array.isArray(source.form_component_values) ? source.form_component_values : [];
  const table = componentByName(components, /表格|费用明细|差旅.*明细/);
  if (!table) throw new Error(`${workflowTitle}模板缺少费用明细表格组件。`);
  const parsedRows = JSON.parse(table.value || "[]");
  const rowTemplate = parsedRows[0];
  const rowObjects = rows.map((row) => {
    const rowId = row._rowId || `row-${cryptoRandom()}`;
    const paymentAttachments = row.payment.map((fileName) => evidenceManifest.find((item) => item.fileName === fileName && item.kind === "payment")?.attachment).filter(Boolean);
    const invoiceAttachments = row.invoice.map((fileName) => evidenceManifest.find((item) => item.fileName === fileName && item.kind === "invoice")?.attachment).filter(Boolean);
    const rowValue = {
      "业务实际发生时间": row.date,
      "申请事由": row.reason,
      "金额": row.amount,
      "所属项目/业务": "市场部—品牌营销",
      "发票类型": noInvoice ? "无" : "电子-普票",
      "付款截图/订单截图": JSON.stringify(paymentAttachments),
      "对应发票上传": JSON.stringify(invoiceAttachments),
      "发票附件": JSON.stringify(invoiceAttachments),
      "备注": noInvoice ? "无票报销，已由管理员核对付款凭证" : "",
    };
    return { rowId, row, cells: cloneTableRow(rowTemplate, rowValue), paymentAttachments, invoiceAttachments };
  });
  const rebuiltComponents = components
    .filter((component) => !/^关联审批单$/.test(String(component?.name || "")))
    .map((component) => {
      if (component === table) return { ...component, value: JSON.stringify(rowObjects.map((item) => item.cells)) };
      if (/申请金额/.test(String(component?.name || ""))) return { ...component, value: total };
      if (/需要付款的公司名称|付款公司|走账主体|报销公司/.test(String(component?.name || ""))) return { ...component, value: JSON.stringify([companyName]) };
      return component;
    });
  const snapshotRows = rowObjects.map((item) => ({
    rowId: item.rowId,
    date: item.row.date,
    reason: item.row.reason,
    amount: item.row.amount,
    project: "市场部—品牌营销",
    invoiceType: noInvoice ? "无" : "电子-普票",
    paymentAttachments: item.paymentAttachments.map((a) => a.fileName),
    invoiceAttachments: item.invoiceAttachments.map((a) => a.fileName),
  }));
  return {
    ...source,
    session_token: "",
    dept_id: String(target.departments[0]?.id || ""),
    process_code: String(source.process_code || ""),
    no_invoice: Boolean(noInvoice),
    invoice_only: false,
    form_component_values: rebuiltComponents,
    evidence_manifest: evidenceManifest.map((item) => ({
      fileId: item.fileId,
      token: item.token,
      targetRowId: item.targetRowId,
      manualAmount: item.manualAmount,
      attachment: item.attachment,
    })),
    attachment_row_bindings: rowObjects.map((item, index) => ({
      rowIndex: index,
      rowId: item.rowId,
      paymentAttachments: item.paymentAttachments,
      invoiceAttachments: item.invoiceAttachments,
    })),
    evidence_processing_tokens: [],
    related_component_names: [],
    related_source_process_code: "",
    submission_route: {
      mode: "admin_originator",
      subjectUserId: String(target.userId),
      subjectName: String(target.name),
      departmentId: String(target.departments[0]?.id || ""),
      departmentName: String(target.departments[0]?.name || ""),
      companyName,
    },
    submission_context: {
      workflowId,
      workflowTitle,
      snapshot: {
        totalAmount: total,
        companyName,
        departmentName: String(target.departments[0]?.name || ""),
        recipientAccountMasked: "已保存账户（管理员代发）",
        relatedApprovals: [],
        paymentCount: evidenceManifest.filter((item) => item.kind === "payment").length,
        invoiceCount: evidenceManifest.filter((item) => item.kind === "invoice").length,
        warningSummary: noInvoice ? "无票凭证由管理员按已确认金额提交" : "已排除三笔付款/发票金额不一致的特殊组",
        rows: snapshotRows,
      },
    },
    remark: noInvoice
      ? "管理员代发：团子已确认的无票费用，三笔付款/发票差额项目暂不提交。"
      : "管理员代发：团子已确认的有票且付款/发票一致项目，三笔差额项目暂不提交。",
    submission_id: `admin_${cryptoRandom()}`,
  };
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function uploadOne(session, fileName, kind) {
  const filePath = join(sourceDir, fileName);
  const info = await stat(filePath);
  const file = { path: filePath, name: fileName, originalFilename: fileName, mimetype: fileMime(fileName), size: info.size };
  const ocr = await recognizeUploadedFile({ kind, file });
  const resolved = applyDocumentClassification(kind, ocr, fileName);
  const contentHash = createHash("sha256").update(await readFile(filePath)).digest("hex");
  const identity = buildDocumentIdentity(ocr, fileName, contentHash);
  const uploaded = await uploadFileToDingTalkStorage({ session, file });
  const evidence = createUploadedEvidence({
    session,
    originalKind: kind,
    resolvedKind: resolved.kind,
    ocr,
    attachment: uploaded.attachment,
    identity,
  });
  return {
    fileName,
    kind: resolved.kind,
    fileId: evidence.record.fileId,
    token: evidence.token,
    attachment: uploaded.attachment,
    ocr,
  };
}

async function main() {
  const localConfig = JSON.parse(await readFile(join(root, "dingtalk.config.json"), "utf8"));
  const workbench = await createAdminWorkbench({ root, dataDirectory: join(root, "data"), localConfig });
  try {
    const target = await getDingTalkEmployeeProfile(TARGET_USER_ID);
    const operator = await getDingTalkEmployeeProfile(OPERATOR_USER_ID);
    if (target.socialCompanyRecognition?.status !== "verified") throw new Error("团子当前社保主体未验证，停止代发。");
    if (!target.departments.length) throw new Error("团子没有可用钉钉部门，停止代发。");
    const session = {
      user: target,
      adminContext: { enabled: true, subjectUserId: target.userId, operatorUserId: operator.userId, operatorName: operator.name },
      evidenceByFileId: new Map(),
      documentByFingerprint: new Map(),
      possibleDocumentByFingerprint: new Map(),
    };

    const activeMismatchRows = runMode === "mismatch-no-invoice" ? mismatchNoInvoiceRows : [];
    const specs = runMode === "mismatch-no-invoice"
      ? activeMismatchRows.flatMap((row) => row.payment.map((fileName) => ({ fileName, kind: "payment" })))
      : [
        ...exactRows.flatMap((row) => [...row.payment.map((fileName) => ({ fileName, kind: "payment" })), ...row.invoice.map((fileName) => ({ fileName, kind: "invoice" }))]),
        ...noInvoiceRows.map((row) => ({ fileName: row.payment[0], kind: "payment" })),
      ];
    const uniqueSpecs = [...new Map(specs.map((item) => [`${item.kind}:${item.fileName}`, item])).values()];
    const uploaded = new Map();
    const cachePath = join(sourceDir, ".admin-upload-cache.json");
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      for (const item of Array.isArray(cached) ? cached : []) {
        const record = verifyEvidenceToken(item.token);
        if (record?.fileId && item.attachment) {
          session.evidenceByFileId.set(record.fileId, record);
          uploaded.set(`${item.kind}:${item.fileName}`, item);
        }
      }
      if (uploaded.size) process.stdout.write(`CACHE ${uploaded.size} 份已上传凭证，跳过重复上传\n`);
    } catch {
      // First run or an interrupted run without a usable cache.
    }
    for (const [index, spec] of uniqueSpecs.entries()) {
      if (uploaded.has(`${spec.kind}:${spec.fileName}`)) continue;
      process.stdout.write(`UPLOAD ${index + 1}/${uniqueSpecs.length} ${spec.kind} ${spec.fileName}\n`);
      const item = await uploadOne(session, spec.fileName, spec.kind);
      uploaded.set(`${spec.kind}:${spec.fileName}`, item);
      await writeFile(cachePath, JSON.stringify([...uploaded.values()]), "utf8");
    }

    const evidenceForRows = (rows) => rows.flatMap((row) => [
      ...row.payment.map((fileName) => ({ ...uploaded.get(`payment:${fileName}`), targetRowId: row.rowId || "", manualAmount: row.amount })),
      ...row.invoice.map((fileName) => ({ ...uploaded.get(`invoice:${fileName}`), targetRowId: row.rowId || "", manualAmount: "" })),
    ]);
    const makeManifest = (rows) => rows.flatMap((row) => [
      ...row.payment.map((fileName) => ({ ...uploaded.get(`payment:${fileName}`), targetRowId: row._rowId, manualAmount: row.amount })),
      ...row.invoice.map((fileName) => ({ ...uploaded.get(`invoice:${fileName}`), targetRowId: row._rowId, manualAmount: "" })),
    ]);
    const prepareRows = (rows) => rows.map((row) => ({ ...row, _rowId: `row-${cryptoRandom()}` }));
    const exactPreparedRows = prepareRows(exactRows);
    const noInvoicePreparedRows = prepareRows(runMode === "mismatch-no-invoice" ? mismatchNoInvoiceRows : noInvoiceRows);
    const exactManifest = makeManifest(exactPreparedRows);
    const noInvoiceManifest = makeManifest(noInvoicePreparedRows);
    const companyName = target.socialCompanyRecognition.companyName;
    const dailyTemplate = await workbench.getLatestDraft(DAILY_TEMPLATE_CASE, { decrypt: true });
    const noInvoiceTemplate = await workbench.getLatestDraft(NO_INVOICE_TEMPLATE_CASE, { decrypt: true });
    if (!dailyTemplate?.snapshot?.draft || !noInvoiceTemplate?.snapshot?.draft) throw new Error("缺少可复用的已验证表单模板。");

    const submissions = runMode === "mismatch-no-invoice"
      ? [{ key: "mismatch-no-invoice", rows: noInvoicePreparedRows, manifest: noInvoiceManifest, template: noInvoiceTemplate, total: "839.01", noInvoice: true, workflowId: "no_invoice", workflowTitle: "日常报销（无票）" }]
      : [
        { key: "exact-ticket", rows: exactPreparedRows, manifest: exactManifest, template: dailyTemplate, total: "3935.20", noInvoice: false, workflowId: "daily", workflowTitle: "日常报销（有票）" },
        { key: "no-invoice", rows: noInvoicePreparedRows, manifest: noInvoiceManifest, template: noInvoiceTemplate, total: "178.46", noInvoice: true, workflowId: "no_invoice", workflowTitle: "日常报销（无票）" },
      ];

    const results = [];
    for (const submission of submissions) {
      const traceId = runMode === "mismatch-no-invoice"
        ? "admin-tuanzhi-mismatch-noinvoice-v1"
        : `${TRACE_PREFIX}-${submission.key}`;
      const draft = makeDraft(submission.template, {
        rows: submission.rows,
        total: submission.total,
        noInvoice: submission.noInvoice,
        companyName,
        target,
        operator,
        workflowId: submission.workflowId,
        workflowTitle: submission.workflowTitle,
        evidenceManifest: submission.manifest,
      });
      if (runMode === "mismatch-no-invoice") {
        // Stable idempotency key: a retry after a transient failure must not
        // create a second reimbursement for this same mismatch group.
        draft.submission_id = "admin_tuanzhi_mismatch_noinvoice_v1";
      }
      const captured = await workbench.captureDraft({
        traceId,
        draftId: draft.submission_id,
        ownerUserId: target.userId,
        ownerName: target.name,
        ownerUnionId: target.unionId,
        ownerDepartments: target.departments,
        ownerSocialCompanyRecognition: target.socialCompanyRecognition,
        workflowId: submission.workflowId,
        workflowTitle: submission.workflowTitle,
        draft,
        source: "admin_manual",
        reason: runMode === "mismatch-no-invoice"
          ? "团子已确认的三笔付款/发票差额项目，按无票报销提交"
          : "团子已确认的材料，管理员代发；三笔付款/发票差额项目暂不提交",
        adminOriginator: true,
        operatorUserId: operator.userId,
        operatorName: operator.name,
      });
      draft.submission_context.adminCaseId = captured.caseId;
      draft.submission_context.adminOperatorUserId = operator.userId;
      await workbench.setCaseStatus(captured.caseId, "open", { originatorUserId: target.userId, operatorUserId: operator.userId, dispatchMode: "scheduled" });
      const actionId = await workbench.recordAdminAction({
        caseId: captured.caseId,
        actorUserId: operator.userId,
        actorName: operator.name,
        action: "submit_on_behalf",
        reason: runMode === "mismatch-no-invoice"
          ? "团子已确认的三笔付款/发票差额项目，按无票报销提交"
          : "团子已确认的材料，管理员代发；三笔付款/发票差额项目暂不提交",
        idempotencyKey: `admin-submit:${captured.caseId}:1`,
        detail: { revision: captured.revision, originatorUserId: target.userId, operatorUserId: operator.userId, routeMode: "admin_originator" },
        status: "dispatching",
      });
      await workbench.setCaseStatus(captured.caseId, "submitting");
      let reservation;
      try {
        reservation = await reserveSubmissionRequest(session, draft);
        if (!["new", "create"].includes(reservation.action)) throw new Error(`提交幂等状态异常：${reservation.action}`);
        const prepared = await prepareScheduledOrImmediateApproval(draft, session, reservation);
        if (!prepared.scheduled) throw new Error("当前时间未进入待发起池，已停止，未直接创建 OA。");
        await recordSubmissionHistory({ session, draft, status: "scheduled", scheduledJobId: prepared.job.id, scheduledAt: prepared.job.scheduledAt });
        await workbench.setCaseStatus(captured.caseId, "scheduled", {
          scheduledJobId: prepared.job.id,
          scheduledAt: prepared.job.scheduledAt,
          trackingCode: prepared.job.trackingCode,
          originatorUserId: target.userId,
          operatorUserId: operator.userId,
          routeMode: "admin_originator",
          dispatchMode: "scheduled",
        });
        await workbench.updateAdminAction(actionId, { status: "succeeded", result: { scheduled: true, scheduledJobId: prepared.job.id, scheduledAt: prepared.job.scheduledAt, trackingCode: prepared.job.trackingCode } });
        results.push({ key: submission.key, caseId: captured.caseId, scheduledJobId: prepared.job.id, scheduledAt: prepared.job.scheduledAt, trackingCode: prepared.job.trackingCode, amount: submission.total });
      } catch (error) {
        if (reservation) await settleSubmissionRequest(reservation, "failed", { failureReason: error.message }).catch(() => {});
        await workbench.setCaseStatus(captured.caseId, "open");
        await workbench.updateAdminAction(actionId, { status: "failed", result: { reason: error.message } });
        throw error;
      }
    }
    console.log(JSON.stringify({
      ok: true,
      target: { userId: target.userId, name: target.name, company: companyName, department: target.departments[0] },
      submitted: results,
      submittedMismatchGroups: runMode === "mismatch-no-invoice" ? ["北京酒店", "北京机场去酒店", "四合一付款/发票组"] : [],
      excludedMismatchGroups: runMode === "mismatch-no-invoice" ? [] : ["北京酒店", "北京机场去酒店", "四合一付款/发票组"],
    }, null, 2));
  } finally {
    await workbench.close();
  }
}

await main();
