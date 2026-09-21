(() => {
  const V2_VERSION = "20260901-on-behalf-v1";
  const V2_DRAFT_PREFIX = "reimbursement-assistant-v2-preview";
  const LEGACY_SCOPED_DRAFT_PREFIX = "reimbursement-assistant-draft-v2";
  const SUPPLY_WORKFLOW_ID = "supply_chain_invoice";
  const stableStepOrder = ["related", "details", "attachments", "ocr", "account", "review"];
  const experimentalDailyStepOrder = ["related", "line_setup", "attachments", "details", "account", "review"];
  const stepShellOrder = ["related", "line_setup", "details", "attachments", "ocr", "account", "review"];
  const stepLabels = {
    related: "关联业务审批",
    line_setup: "建立报销明细",
    details: "填写费用明细",
    attachments: "上传并分配附件",
    ocr: "核对 OCR 建议",
    account: "确认公司与收款账户",
    review: "最终核对并提交",
  };
  const compactStages = [
    { id: "related", label: "关联审批", title: "先确认业务场景与关联审批", description: "选择发起部门，并按当前费用需要关联出差、外出、团建等业务审批。", stepIds: ["related", "line_setup"] },
    { id: "attachments", label: "附件上传", title: "集中上传并核对附件", description: "付款凭证和发票只上传一次；OCR、附件归类及风险提示继续使用现有规则。", stepIds: ["attachments", "ocr"] },
    { id: "review", label: "确认提交", title: "补齐明细并完成提交", description: "核对费用明细、付款公司、收款账户和总金额；所有原有强制拦截仍在提交前生效。", stepIds: ["details", "account", "review"] },
  ];
  const v2State = {
    profile: null,
    activeStep: "details",
    manuallySkipped: new Set(),
    completion: new Map(),
    issues: [],
    issueIndex: 0,
    lastSnapshot: null,
    lastWorkflowId: "",
    usedWorkflowIds: new Set(),
    autoFillTimer: 0,
    lastExperimentalOcrSignature: "",
    experimentalAutoFillSummary: "",
    uiVariant: "classic",
    compactStageId: "related",
    compactEligible: false,
    // 第 2 步的加减先调整“待确认数量”，不能被其它区域的刷新按当前行数覆盖。
    experimentalDetailCountInput: null,
  };

  const originalShowSubmissionResult = showSubmissionResult;
  const originalRenderSubmissionHistory = renderSubmissionHistory;
  const originalBuildOcrSuggestion = buildOcrSuggestion;
  const originalRenderDailyRows = renderDailyRows;
  const originalRenderTravelRows = renderTravelRows;
  const originalRenderFiles = renderFiles;

  document.documentElement.classList.add("v2-ui");
  document.body.dataset.v2Version = V2_VERSION;

  getDraftStorageKey = function getV2DraftStorageKey(userId = state.user?.userId) {
    return userId ? `${V2_DRAFT_PREFIX}:${userId}` : "";
  };

  // V1 stored per-user drafts under a different localStorage key. During the
  // company-wide V2 rollout we retain that key and offer it as a restore
  // candidate, so routing a user to V2 never strands an unfinished draft.
  const originalGetDraftRestoreCandidate = getDraftRestoreCandidate;
  const originalClearSavedDraft = clearSavedDraft;
  getDraftRestoreCandidate = function getV2DraftRestoreCandidate() {
    const userId = String(state.user?.userId || "");
    if (userId) {
      const legacyScopedDraft = readStoredDraft(`${LEGACY_SCOPED_DRAFT_PREFIX}:${userId}`);
      if (hasRestorableDraft(legacyScopedDraft)) {
        return { draft: legacyScopedDraft, legacy: true, source: "legacy-scoped" };
      }
    }
    return originalGetDraftRestoreCandidate();
  };
  clearSavedDraft = function clearV2SavedDraft(includeLegacy = true) {
    originalClearSavedDraft(includeLegacy);
    if (!includeLegacy) return;
    const userId = String(state.user?.userId || "");
    if (userId) localStorage.removeItem(`${LEGACY_SCOPED_DRAFT_PREFIX}:${userId}`);
  };

  const travelWorkflow = WORKFLOWS.find((workflow) => workflow.id === "travel_transport");
  if (travelWorkflow?.related) travelWorkflow.related.autoGenerateRows = false;

  if (!WORKFLOWS.some((workflow) => workflow.id === SUPPLY_WORKFLOW_ID)) {
    WORKFLOWS.push({
      id: SUPPLY_WORKFLOW_ID,
      title: "采购供应链报销",
      targetType: "daily",
      targetName: "日常报销 应用接口测试",
      processCode: PROCESS_CODES.daily,
      detailMode: "mixed",
      invoiceOnly: true,
      defaultProject: "采购供应链",
      detailHint: "采购供应链专属入口：无需前置审批和付款截图，每条明细只需上传有效发票。",
      description: "仅向授权用户开放；金额以税务发票识别结果为核对依据。",
    });
  }

  buildOcrSuggestion = function buildV2OcrSuggestion(args) {
    const suggestion = originalBuildOcrSuggestion(args);
    if (currentWorkflow()?.invoiceOnly && !suggestion.amount) {
      suggestion.amount = formatMoney(sumMoney(getFilesByKeys(args.invoiceKeys || []).map(getOcrAmount).filter(Boolean)));
      if (suggestion.amount) suggestion.sources.amount = "发票识别金额";
    }
    return suggestion;
  };

  syncTravelRowsWithRelated = function syncV2TravelRowsWithRelated() {
    const selectedIds = new Set(state.selectedRelated.map((item) => item.processInstanceId));
    if (!state.travelRows.length && state.selectedRelated.length) {
      state.travelRows.push(createTravelRow({
        relatedInstanceId: state.selectedRelated[0].processInstanceId,
        relatedBusinessId: state.selectedRelated[0].businessId,
        relatedTitle: state.selectedRelated[0].title,
      }));
    }
    if (!selectedIds.size) return;
    const fallback = state.selectedRelated[0];
    state.travelRows.forEach((row) => {
      if (!row.relatedInstanceId || !selectedIds.has(row.relatedInstanceId)) {
        row.relatedInstanceId = fallback.processInstanceId;
        row.relatedBusinessId = fallback.businessId;
        row.relatedTitle = fallback.title;
      }
    });
  };

  function isSupplyWorkflow(workflow = currentWorkflow()) {
    return workflow?.id === SUPPLY_WORKFLOW_ID || Boolean(workflow?.invoiceOnly);
  }

  function maskAccount(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    return source.replace(/\d(?=\d{4})/g, "*").slice(0, 160);
  }

  function fileNames(keys = []) {
    return keys.map((key) => getFileByKey(key)?.name).filter(Boolean);
  }

  function buildSubmissionSnapshot(workflow = currentWorkflow()) {
    const rows = workflow.targetType === "travel" ? state.travelRows : state.dailyRows;
    const departmentName = departmentSelect.selectedOptions?.[0]?.textContent || "";
    return {
      totalAmount: formatMoney(workflow.targetType === "travel" ? getTravelRowsTotal(rows) : getDailyRowsTotal(rows)),
      companyName: companySelect.value || "",
      departmentName,
      submissionRoute: typeof window.__reimbursementRoute?.get === "function" ? window.__reimbursementRoute.get() : { mode: "self" },
      recipientAccountMasked: maskAccount(recipientAccountTextInput.value),
      relatedApprovals: state.selectedRelated.map((item) => item.businessId || item.title || item.processInstanceId),
      paymentCount: getFilesByType("payment").length,
      invoiceCount: getFilesByType("invoice").length,
      warningSummary: buildAuditReport({ invoiceType: invoiceTypeSelect.value || "" }, amountInput.value, workflow).warnings.join("；"),
      rows: rows.map((row) => ({
        date: row.businessDate,
        reason: row.reason,
        amount: formatMoney(row.amount),
        project: row.project,
        expenseType: row.expenseType,
        invoiceType: row.invoiceType,
        relatedBusinessId: row.relatedBusinessId,
        paymentAttachments: fileNames(row.paymentFileKeys),
        invoiceAttachments: fileNames(row.invoiceFileKeys),
      })),
    };
  }

  function renderReceipt(snapshot, instanceId = "") {
    if (!snapshot) return "";
    const rows = snapshot.rows || [];
    return `<section class="v2-receipt">
      <div class="v2-receipt-summary">
        <div><span>报销总额</span><strong>¥${escapeHtml(snapshot.totalAmount || "0.00")}</strong></div>
        <div><span>费用明细</span><strong>${rows.length} 条</strong></div>
        <div><span>附件</span><strong>付款 ${snapshot.paymentCount || 0} · 发票 ${snapshot.invoiceCount || 0}</strong></div>
      </div>
      ${snapshot.relatedApprovals?.length ? `<p class="v2-receipt-related"><b>关联审批</b>${snapshot.relatedApprovals.map(escapeHtml).join("、")}</p>` : ""}
      <div class="v2-receipt-table-wrap"><table class="v2-receipt-table">
        <thead><tr><th>#</th><th>日期</th><th>费用说明</th><th>类别/项目</th><th>金额</th><th>附件</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr>
          <td>${index + 1}</td><td>${escapeHtml(row.date || "—")}</td><td>${escapeHtml(row.reason || "—")}</td>
          <td>${escapeHtml(row.expenseType || row.project || "—")}</td><td>¥${escapeHtml(row.amount || "0.00")}</td>
          <td>付款 ${(row.paymentAttachments || []).length} · 发票 ${(row.invoiceAttachments || []).length}</td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="v2-receipt-meta">
        <span>${escapeHtml(snapshot.companyName || "未填写公司")}</span>
        ${snapshot.departmentName ? `<span>发起部门：${escapeHtml(snapshot.departmentName)}</span>` : ""}
        <span>${escapeHtml(snapshot.recipientAccountMasked || "未填写收款账户")}</span>
        ${instanceId ? `<span>审批编号 ${escapeHtml(instanceId)}</span>` : ""}
      </div>
    </section>`;
  }

  showSubmissionResult = function showV2SubmissionResult(options) {
    originalShowSubmissionResult(options);
    let receipt = resultDialogContent.querySelector(".v2-receipt");
    if (receipt) receipt.remove();
    if (options?.state === "success" && v2State.lastSnapshot) {
      resultHint.insertAdjacentHTML("beforebegin", renderReceipt(v2State.lastSnapshot, options.instanceId));
    }
  };

  renderSubmissionHistory = function renderV2SubmissionHistory(entries = []) {
    if (!submissionHistoryList) return;
    submissionHistoryList.innerHTML = entries.length ? entries.map((entry) => {
      const succeeded = entry.status === "success";
      const detailId = `history-${escapeHtml(entry.id || String(Math.random()))}`;
      return `<article class="submission-history-item v2-history-item">
        <div class="v2-history-main">
          <div><h3>${escapeHtml(entry.workflowTitle || "报销申请")}</h3>
          <p>${escapeHtml(formatResultTime(entry.createdAt))} · ${succeeded ? `审批编号：${escapeHtml(entry.processInstanceId || "待返回")}` : `失败原因：${escapeHtml(entry.reason || "未获取到具体原因")}`}</p></div>
          <span class="history-status ${succeeded ? "" : "failed"}">${succeeded ? "发起成功" : "发起失败"}</span>
        </div>
        ${entry.advice && !succeeded ? `<p class="history-reason">${escapeHtml(entry.advice)}</p>` : ""}
        ${entry.snapshot ? `<button class="v2-history-toggle" type="button" data-history-target="${detailId}">查看完整回执</button>
          <div id="${detailId}" class="v2-history-receipt" hidden>${renderReceipt(entry.snapshot, entry.processInstanceId)}</div>` : ""}
      </article>`;
    }).join("") : `<p class="submission-history-empty">暂无提交记录。</p>`;
  };

  const scheduledStatusMeta = {
    scheduled: { label: "报销已提交", className: "scheduled", detail: "系统将按公司安排自动发起钉钉 OA" },
    dispatching: { label: "正在发起 OA", className: "dispatching", detail: "系统正在处理，无需重复操作" },
    retry: { label: "系统处理中", className: "retry", detail: "暂时未发起，系统正在自动重试" },
    unknown: { label: "结果核对中", className: "unknown", detail: "系统正在核对钉钉是否已创建审批" },
    manual: { label: "需要管理员处理", className: "manual", detail: "系统已通知管理员处理" },
    succeeded: { label: "OA 已发起", className: "", detail: "钉钉 OA 已创建" },
    cancelled: { label: "已撤销", className: "cancelled", detail: "该报销未发起 OA" },
    success: { label: "OA 已发起", className: "", detail: "钉钉 OA 已创建" },
    failed: { label: "发起失败", className: "failed", detail: "钉钉 OA 未创建" },
  };

  renderSubmissionHistory = function renderV2ScheduledSubmissionHistory(entries = []) {
    if (!submissionHistoryList) return;
    submissionHistoryList.innerHTML = entries.length ? entries.map((entry) => {
      const meta = scheduledStatusMeta[entry.status] || scheduledStatusMeta.failed;
      const detailId = `history-${escapeHtml(entry.id || String(Math.random()))}`;
      const isScheduled = Boolean(entry.scheduledJobId);
      const amount = entry.snapshot?.totalAmount || entry.amount || "0.00";
      const primaryDetail = entry.processInstanceId
        ? `审批编号：${escapeHtml(entry.processInstanceId)}`
        : entry.scheduledAt
          ? `预计 OA 发起时间：${escapeHtml(formatResultTime(entry.scheduledAt))}`
          : meta.detail;
      const canCopy = isScheduled && ["scheduled", "retry", "manual"].includes(entry.status);
      return `<article class="submission-history-item v2-history-item" data-scheduled-job-id="${escapeHtml(entry.scheduledJobId || "")}">
        <div class="v2-history-main">
          <div><h3>${escapeHtml(entry.workflowTitle || "报销申请")}</h3>
          <p>金额：¥${escapeHtml(amount)} · 申请时间：${escapeHtml(formatResultTime(entry.createdAt))} · ${primaryDetail}</p></div>
          <span class="history-status ${meta.className}">${meta.label}</span>
        </div>
        ${entry.reason ? `<p class="history-reason">${escapeHtml(entry.reason)}${entry.advice ? ` ${escapeHtml(entry.advice)}` : ""}</p>` : ""}
        <div class="v2-history-actions">
          ${entry.snapshot ? `<button class="v2-history-toggle" type="button" data-history-target="${detailId}">查看完整回执</button>` : ""}
          ${canCopy ? `<button class="v2-history-copy" type="button" data-cancel-copy="${escapeHtml(entry.scheduledJobId)}">撤销并复制为草稿</button>` : ""}
        </div>
        ${entry.snapshot ? `<div id="${detailId}" class="v2-history-receipt" hidden>${renderReceipt(entry.snapshot, entry.processInstanceId)}</div>` : ""}
      </article>`;
    }).join("") : `<p class="submission-history-empty">暂无提交记录。</p>`;
  };

  async function cancelScheduledAndCopy(jobId) {
    if (!jobId || !confirm("确认撤销这笔尚未发起 OA 的报销，并复制为可修改草稿吗？")) return;
    const response = await fetch(`${getApiBase()}/api/scheduled-approvals/cancel-and-copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: state.sessionToken, id: jobId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "撤销失败");
    submissionHistoryDialog.close();
    startNewReimbursement();
    if (result.editableDraft) {
      restoreSavedDraft(result.editableDraft);
      renderWorkflowSelect();
      renderWorkflowForm();
      renderWorkflowCards();
      renderFiles();
      renderDailyRows();
      renderTravelRows();
      renderRelatedDetail();
      await uploadPendingFiles();
      await loadRelatedApprovals();
      saveDraft(true);
      applyWorkflow(state.workflowId, { openFirst: true });
      addMessage("bot", "原报销已撤销并恢复为草稿，你可以修改后重新提交。");
    }
  }

  function createScheduledAdminDialog() {
    const button = document.createElement("button");
    button.id = "v2ScheduledAdminButton";
    button.className = "secondary-button";
    button.type = "button";
    button.textContent = "系统管理";
    button.hidden = true;
    document.querySelector(".topbar-actions")?.prepend(button);

    const adminDialog = document.createElement("dialog");
    adminDialog.id = "v2ScheduledAdminDialog";
    adminDialog.className = "v2-scheduled-admin-dialog";
    adminDialog.innerHTML = `<div class="v2-scheduled-admin-content">
      <header><div><p class="eyebrow">仅管理员可见</p><h2>报销系统管理台</h2><p>查看待发起池、提交结果、附件上传流水、客户端操作追踪、排障案件和异常记录。</p></div><button class="icon-button" type="button" data-admin-close>×</button></header>
      <div class="v2-scheduled-admin-toolbar"><button type="button" data-admin-action="pause">暂停批次</button><button type="button" data-admin-action="resume">恢复批次</button><button type="button" data-admin-export>导出记录</button><button type="button" data-admin-manual-create hidden>新建管理员代发</button><button type="button" data-admin-sort>排序：最新优先</button><button type="button" data-admin-refresh>刷新</button></div>
      <p id="v2AdminActionNotice" class="v2-admin-action-notice" hidden role="status" aria-live="polite"></p>
      <div id="v2ScheduledStats" class="v2-scheduled-stats"></div>
      <nav class="v2-admin-tabs" aria-label="管理台分类">
        <button type="button" class="active" data-admin-tab="scheduled">待发起池</button>
        <button type="button" data-admin-tab="submissions">提交记录</button>
        <button type="button" data-admin-tab="uploads">上传记录</button>
        <button type="button" data-admin-tab="client-audit">操作追踪</button>
        <button type="button" data-admin-tab="cases">排障案件</button>
        <button type="button" data-admin-tab="errors">异常记录</button>
      </nav>
      <div id="v2ScheduledAdminList" class="v2-scheduled-admin-list"><p>正在读取…</p></div>
    </div>`;
    document.body.append(adminDialog);
    return { button, adminDialog };
  }

  let scheduledAdminUi = null;
  let operationsDashboardData = null;
  let operationsDashboardTab = "scheduled";
  let operationsDashboardSortDirection = "desc";
  let workbenchCases = null;
  let workbenchCaseDetail = null;

  function adminOwnerLabel(item = {}) {
    return escapeHtml(item.ownerName || item.ownerUserId || "未知用户");
  }

  function adminSortValue(item = {}, tab = operationsDashboardTab) {
    const value = tab === "client-audit"
      ? (item.serverAt || item.clientAt || item.createdAt)
      : tab === "cases"
        ? (item.updatedAt || item.createdAt)
        : (item.createdAt || item.updatedAt || item.serverAt || item.scheduledAt);
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function sortAdminEntries(entries = [], tab = operationsDashboardTab) {
    return [...entries].sort((left, right) => {
      const delta = adminSortValue(right, tab) - adminSortValue(left, tab);
      return operationsDashboardSortDirection === "desc" ? delta : -delta;
    });
  }

  function updateAdminSortControl() {
    const button = scheduledAdminUi?.adminDialog?.querySelector("[data-admin-sort]");
    if (!button) return;
    const newestFirst = operationsDashboardSortDirection === "desc";
    button.textContent = `排序：${newestFirst ? "最新优先" : "最旧优先"}`;
    button.setAttribute("aria-label", `切换排序，当前${newestFirst ? "最新优先" : "最旧优先"}`);
  }

  function renderOperationsDashboard() {
    if (!operationsDashboardData) return;
    const result = operationsDashboardData;
    updateAdminSortControl();
    const stats = result.stats || {};
    document.getElementById("v2ScheduledStats").innerHTML = [
      ["当前待发起", stats.queued || 0],
      ["提交成功", stats.successfulSubmissions || 0],
      ["提交失败", stats.failedSubmissions || 0],
      ["上传流水", stats.uploads || 0],
      ["操作追踪", stats.clientAuditEvents || 0],
      ["需要关注", stats.errors || 0],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    scheduledAdminUi.adminDialog.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === operationsDashboardTab);
    });
    const list = document.getElementById("v2ScheduledAdminList");
    if (operationsDashboardTab === "scheduled") {
      const entries = sortAdminEntries(result.scheduled || [], "scheduled");
      list.innerHTML = entries.length ? entries.map((job) => {
        const meta = scheduledStatusMeta[job.status] || scheduledStatusMeta.failed;
        const actionable = ["scheduled", "retry", "manual", "unknown"].includes(job.status);
        const mutable = ["scheduled", "retry", "manual"].includes(job.status);
        const actions = job.status === "unknown"
          ? `<button type="button" data-admin-job-action="confirm-not-created">确认 OA 未创建后重发</button>`
          : actionable
            ? `<button type="button" data-admin-job-action="dispatch-now">立即发起</button><button type="button" data-admin-job-action="reschedule">调整时间</button><button type="button" data-admin-job-action="cancel">撤销</button>`
            : "";
        return `<article data-admin-job="${escapeHtml(job.id)}"><div><strong>${adminOwnerLabel(job)} · ${escapeHtml(job.workflowTitle)}</strong><p>¥${escapeHtml(job.amount)} · 申请时间：${escapeHtml(formatResultTime(job.createdAt))} · 预计 OA 发起时间：${escapeHtml(formatResultTime(job.scheduledAt))} · ${meta.label}</p><small>追踪号：${escapeHtml(job.trackingCode || job.id)}</small>${job.failureReason ? `<small>${escapeHtml(job.failureReason)}</small>` : ""}</div><div>${mutable || job.status === "unknown" ? actions : ""}</div></article>`;
      }).join("") : "<p>当前待发起池为空。</p>";
      return;
    }
    if (operationsDashboardTab === "submissions") {
      const entries = sortAdminEntries(result.submissions || [], "submissions");
      list.innerHTML = entries.length ? entries.map((entry) => {
        const meta = scheduledStatusMeta[entry.status] || scheduledStatusMeta.failed;
        const snapshot = entry.snapshot || {};
        return `<article><div><strong>${adminOwnerLabel(entry)} · ${escapeHtml(entry.workflowTitle || "报销申请")}</strong><p>${escapeHtml(formatResultTime(entry.createdAt))} · ¥${escapeHtml(snapshot.totalAmount || "0.00")} · ${meta.label}</p><small>付款附件 ${Number(snapshot.paymentCount || 0)} · 发票附件 ${Number(snapshot.invoiceCount || 0)}${entry.processInstanceId ? ` · OA ${escapeHtml(entry.processInstanceId)}` : ""}</small>${entry.reason ? `<small class="is-error">${escapeHtml(entry.reason)} ${escapeHtml(entry.advice || "")}</small>` : ""}</div></article>`;
      }).join("") : "<p>暂无提交记录。</p>";
      return;
    }
    if (operationsDashboardTab === "uploads") {
      const entries = sortAdminEntries(result.uploads || [], "uploads");
      list.innerHTML = entries.length ? entries.map((event) => {
        const files = Array.isArray(event.summary?.files) ? event.summary.files : [];
        return `<article><div><strong>${adminOwnerLabel(event)} · ${event.status === "success" ? "上传成功" : "上传失败"}</strong><p>${escapeHtml(formatResultTime(event.createdAt))} · ${Number(event.summary?.fileCount || files.length)} 个文件 · ${escapeHtml(event.summary?.requestedKind || "附件")}</p><small>${files.map((file) => escapeHtml(file.name || "未命名附件")).join("、") || "未保留文件名"}</small>${event.reason ? `<small class="is-error">${escapeHtml(event.reason)}</small>` : ""}</div></article>`;
      }).join("") : "<p>暂无独立上传流水。该记录从本功能上线后开始保存；更早的已提交附件可在“提交记录”中回溯。</p>";
      return;
    }
    if (operationsDashboardTab === "client-audit") {
      const entries = sortAdminEntries(result.clientAudit || [], "client-audit");
      list.innerHTML = entries.length ? entries.map((event) => {
        const summary = event.summary || {};
        const attachment = summary.attachment || {};
        const files = Array.isArray(summary.attachments) ? summary.attachments : [];
        const attachmentText = attachment.fileName
          ? `${attachment.fileName}${attachment.ocrAmount ? ` · ¥${attachment.ocrAmount}` : ""}${attachment.targetRowId ? ` · 明细 ${attachment.targetRowId}` : ""}`
          : files.length ? files.map((file) => `${file.fileName || "未命名附件"}${file.ocrAmount ? ` ¥${file.ocrAmount}` : ""}`).join("、") : "";
        return `<article><div><strong>${adminOwnerLabel(event)} · ${escapeHtml(event.eventType || "客户端事件")}</strong><p>${escapeHtml(formatResultTime(event.serverAt || event.clientAt))} · 追踪号 ${escapeHtml(event.traceId || "—")}</p><small>${escapeHtml(summary.action || summary.message || attachmentText || "已记录客户端操作")}</small>${attachmentText && (summary.action || summary.message) ? `<small>${escapeHtml(attachmentText)}</small>` : ""}</div></article>`;
      }).join("") : "<p>暂无客户端操作记录。审计仅从本功能上线后开始保存。</p>";
      return;
    }
    if (operationsDashboardTab === "cases") {
      if (workbenchCases?.error) {
        list.innerHTML = `<p>${escapeHtml(workbenchCases.error)}</p>`;
        return;
      }
      const entries = sortAdminEntries(workbenchCases?.entries || [], "cases");
      list.innerHTML = entries.length ? entries.map((entry) => `<article data-admin-case="${escapeHtml(entry.id)}"><div><strong>${escapeHtml(entry.ownerName || entry.ownerUserId || "未知用户")} · ${escapeHtml(entry.workflowTitle || "报销案件")}</strong><p>${escapeHtml(formatResultTime(entry.updatedAt || entry.createdAt))} · ${escapeHtml(entry.status || "observing")}</p><small>追踪号：${escapeHtml(entry.traceId || "—")}</small></div><div><button type="button" data-admin-case-open>查看案件</button></div></article>`).join("") : "<p>暂无排障案件。开启生命周期采集后，提交失败、OCR异常和附件问题会自动进入这里。</p>";
      return;
    }
    if (operationsDashboardTab === "case-detail") {
      const detail = workbenchCaseDetail;
      if (!detail?.case) {
        list.innerHTML = "<p>未找到案件详情。</p>";
        return;
      }
      const revisions = detail.revisions || [];
      const artifacts = detail.artifacts || [];
      const events = detail.events || [];
      const currentRevision = revisions[0]?.revision || 0;
      list.innerHTML = `<section class="v2-admin-case-detail"><p><button type="button" data-admin-case-back>返回案件列表</button></p><h3>${escapeHtml(detail.case.ownerName || detail.case.ownerUserId || "未知用户")} · ${escapeHtml(detail.case.workflowTitle || "报销案件")}</h3><p>状态：${escapeHtml(detail.case.status || "observing")} · 追踪号：${escapeHtml(detail.case.traceId || "—")}</p><p>当前草稿版本：${escapeHtml(String(currentRevision))} · 附件：${artifacts.length} · 事件：${events.length}</p><div class="v2-admin-case-actions"><button type="button" data-admin-case-repair>高级代修复</button><button type="button" data-admin-case-submit>管理员代发起</button></div><h4>附件</h4>${artifacts.length ? artifacts.map((item) => `<article><div><strong>${escapeHtml(item.fileName || "未命名附件")}</strong><p>${escapeHtml(item.kind || "附件")} · ${Number(item.fileSize || 0)} 字节 · ${escapeHtml(item.archiveStatus || "pending")}</p><small>到期：${escapeHtml(formatResultTime(item.expiresAt || ""))}</small></div></article>`).join("") : "<p>暂无已归档附件。</p>"}<h4>时间线</h4>${events.slice(0, 80).map((event) => `<article><div><strong>${escapeHtml(event.eventType || "事件")} · ${escapeHtml(event.actorName || event.actorType || "系统")}</strong><p>${escapeHtml(formatResultTime(event.createdAt))} · ${escapeHtml(event.status || "info")}</p><small>${escapeHtml(event.reason || "")}</small></div></article>`).join("") || "<p>暂无事件。</p>"}</section>`;
      return;
    }
    const entries = sortAdminEntries(result.errors || [], "errors");
    list.innerHTML = entries.length ? entries.map((entry) => `<article><div><strong>${escapeHtml(entry.source || "系统异常")} · ${adminOwnerLabel(entry)}</strong><p>${escapeHtml(formatResultTime(entry.createdAt))}${entry.workflowTitle ? ` · ${escapeHtml(entry.workflowTitle)}` : ""}</p><small class="is-error">${escapeHtml(entry.reason || "未记录具体原因")}</small>${entry.reasonCode ? `<small>错误代码：${escapeHtml(entry.reasonCode)}</small>` : ""}</div></article>`).join("") : "<p>当前没有需要关注的异常记录。</p>";
  }

  async function loadScheduledAdmin() {
    if (!scheduledAdminUi) return;
    const params = new URLSearchParams({ session_token: state.sessionToken });
    const response = await fetch(`${getApiBase()}/api/admin/operations-dashboard?${params}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "读取系统管理数据失败");
    operationsDashboardData = result;
    const manualButton = scheduledAdminUi.adminDialog.querySelector("[data-admin-manual-create]");
    if (manualButton) manualButton.hidden = !Boolean(result.workbench?.manualCreateEnabled);
    if (operationsDashboardTab === "cases" || operationsDashboardTab === "case-detail") await loadAdminWorkbenchCases();
    renderOperationsDashboard();
  }

  async function loadAdminWorkbenchCases() {
    const params = new URLSearchParams({ session_token: state.sessionToken, limit: "100" });
    const response = await fetch(`${getApiBase()}/api/admin/workbench/cases?${params}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      workbenchCases = { error: result.error || "排障案件中心暂未启用" };
      return;
    }
    workbenchCases = result;
  }

  async function createAdminManualCase() {
    if (!operationsDashboardData?.workbench?.manualCreateEnabled) {
      throw new Error("管理员新建代发功能当前处于安全关闭状态。");
    }
    const query = prompt("请输入报销归属人的钉钉姓名或 userId：");
    if (!query) return;
    const employeeResponse = await fetch(`${getApiBase()}/api/admin/workbench/employees?${new URLSearchParams({ session_token: state.sessionToken, q: query, limit: "20" })}`, { cache: "no-store" });
    const employeeResult = await employeeResponse.json().catch(() => ({}));
    if (!employeeResponse.ok) throw new Error(employeeResult.error || "读取员工花名册失败");
    const employees = Array.isArray(employeeResult.employees) ? employeeResult.employees : [];
    if (!employees.length) throw new Error("未找到匹配员工，请改用准确姓名或 userId。");
    let targetUserId = employees.length === 1 ? employees[0].userId : "";
    if (employees.length > 1) {
      const options = employees.map((item, index) => `${index + 1}. ${item.name} (${item.userId})`).join("\n");
      const selected = prompt(`找到多个员工，请输入序号或 userId：\n${options}`);
      if (!selected) return;
      const index = Number.parseInt(selected, 10);
      targetUserId = Number.isInteger(index) && employees[index - 1]?.userId ? employees[index - 1].userId : selected.trim();
    }
    const defaultDraft = {
      process_code: "PROC-8249A121-DBA1-4B54-A3F8-82D2A66703A5",
      form_component_values: [],
      remark: "管理员代发：请在案件详情中继续核对并补齐表单、附件和明细。",
    };
    const draftText = prompt("粘贴员工已确认的完整报销草稿 JSON。创建案件不会立即发起 OA；保存后请在案件详情中复核并点击“管理员代发起”。", JSON.stringify(defaultDraft, null, 2));
    if (draftText === null) return;
    let draft;
    try { draft = JSON.parse(draftText); } catch { throw new Error("草稿 JSON 格式无效。"); }
    const reason = prompt("请填写本次管理员代发的业务原因：", "员工已提供完整材料，由管理员代为录入发起");
    if (!reason) return;
    const response = await fetch(`${getApiBase()}/api/admin/workbench/manual-cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: state.sessionToken, target_user_id: targetUserId, draft, reason }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "新建管理员代发案件失败");
    operationsDashboardTab = "cases";
    await loadAdminWorkbenchCases();
    renderOperationsDashboard();
    alert(`案件已保存：${result.caseId}\n当前版本：${result.revision}\n尚未创建 OA，请在案件详情中完成复核后再代发起。`);
  }

  async function openAdminWorkbenchCase(caseId) {
    const params = new URLSearchParams({ session_token: state.sessionToken });
    const response = await fetch(`${getApiBase()}/api/admin/workbench/cases/${encodeURIComponent(caseId)}?${params}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "读取案件详情失败");
    workbenchCaseDetail = result;
    operationsDashboardTab = "case-detail";
    renderOperationsDashboard();
  }

  async function runAdminWorkbenchCaseAction(action) {
    const detail = workbenchCaseDetail;
    const caseId = detail?.case?.id;
    const revision = detail?.revisions?.[0]?.revision;
    if (!caseId || !revision) throw new Error("该案件缺少可操作的服务端草稿。");
    const reason = prompt(action === "repair" ? "请填写代修复原因：" : "请填写代发起原因：");
    if (!reason) return;
    const body = { session_token: state.sessionToken, reason, expected_revision: revision };
    if (action === "repair") {
      const patchText = prompt("请输入已确认的修复 JSON（仅允许表单、附件、绑定、公司/部门等字段）。\n例如：{\"remark\":\"已核验修复\"}", "{}");
      if (patchText === null) return;
      try { body.patch = JSON.parse(patchText); } catch { throw new Error("修复 JSON 格式无效。"); }
    } else if (!confirm("将以该员工为OA发起人直接创建审批。系统会记录你的代发起身份和原因。是否继续？")) {
      return;
    }
    const response = await fetch(`${getApiBase()}/api/admin/workbench/cases/${encodeURIComponent(caseId)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "管理员操作失败");
    alert(action === "repair" ? `修复已保存为版本 ${result.revision}。` : `OA 已创建：${result.processInstanceId || "已提交"}`);
    await openAdminWorkbenchCase(caseId);
  }

  async function runScheduledAdminAction(action, id = "", extra = {}) {
    const trigger = extra.trigger || null;
    const notice = document.getElementById("v2AdminActionNotice");
    const isDispatch = ["dispatch-now", "confirm-not-created"].includes(action);
    const originalText = trigger?.textContent || "";
    if (trigger) {
      trigger.disabled = true;
      trigger.setAttribute("aria-busy", "true");
      if (isDispatch) trigger.textContent = action === "confirm-not-created" ? "正在重新发起…" : "正在发起 OA…";
    }
    if (notice) {
      notice.hidden = false;
      notice.className = "v2-admin-action-notice is-processing";
      notice.textContent = isDispatch ? "正在向钉钉发起审批，请勿重复点击。" : "正在处理管理操作…";
    }
    try {
      const { trigger: _trigger, ...requestExtra } = extra;
      const response = await fetch(`${getApiBase()}/api/admin/scheduled-approvals/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: state.sessionToken, action, id, ...requestExtra }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "操作失败");
      if (notice) {
        const status = result.result?.status || "";
        const ok = status === "succeeded" || action === "pause" || action === "resume" || action === "reschedule";
        notice.className = `v2-admin-action-notice ${ok ? "is-success" : "is-warning"}`;
        notice.textContent = result.message || (ok ? "操作已完成。" : "操作已受理，请刷新查看最新状态。");
      }
      await loadScheduledAdmin();
      return result;
    } catch (error) {
      if (notice) {
        notice.className = "v2-admin-action-notice is-error";
        notice.textContent = `操作未完成：${error.message || "请稍后重试"}`;
      }
      throw error;
    } finally {
      if (trigger?.isConnected) {
        trigger.disabled = false;
        trigger.removeAttribute("aria-busy");
        trigger.textContent = originalText;
      }
    }
  }

  async function exportScheduledAdminRecords() {
    const params = new URLSearchParams({ session_token: state.sessionToken });
    const response = await fetch(`${getApiBase()}/api/admin/scheduled-approvals/export?${params}`, { cache: "no-store" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "导出失败");
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `定时发送记录-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  function createV2Chrome() {
    const badge = document.createElement("span");
    badge.className = "v2-preview-badge";
    badge.textContent = "新版";
    document.querySelector(".topbar h1")?.append(badge);

    const help = document.createElement("button");
    help.className = "secondary-button";
    help.id = "v2SceneHelpButton";
    help.type = "button";
    help.textContent = "报销场景说明";
    document.querySelector(".topbar-actions")?.prepend(help);

    const variantToggle = document.createElement("button");
    variantToggle.className = "secondary-button v2-ui-variant-toggle";
    variantToggle.id = "v2UiVariantToggle";
    variantToggle.type = "button";
    variantToggle.hidden = true;
    variantToggle.setAttribute("aria-pressed", "false");
    variantToggle.textContent = "切换版本 · 三步版";
    document.querySelector(".topbar-actions")?.prepend(variantToggle);

    const progress = document.createElement("nav");
    progress.className = "v2-progress";
    progress.id = "v2Progress";
    progress.setAttribute("aria-label", "报销填写进度");
    document.querySelector(".topbar")?.insertAdjacentElement("afterend", progress);

    const compactWorkflow = document.createElement("section");
    compactWorkflow.className = "v2-current-workflow";
    compactWorkflow.innerHTML = `<div><span>当前报销场景</span><strong id="v2CurrentWorkflowTitle">请选择报销场景</strong><p id="v2CurrentWorkflowDescription"></p></div><button type="button" class="secondary-button" id="v2ChangeWorkflow">更换入口</button>`;
    progress.insertAdjacentElement("afterend", compactWorkflow);

    const errorPanel = document.createElement("aside");
    errorPanel.className = "v2-error-panel";
    errorPanel.id = "v2ErrorPanel";
    errorPanel.hidden = true;
    errorPanel.innerHTML = `<div><span id="v2IssueCounter"></span><strong id="v2IssueTitle"></strong><p id="v2IssueHelp"></p></div><div class="v2-error-actions"><button type="button" id="v2PreviousIssue">上一个</button><button type="button" id="v2NextIssue">下一个</button><button type="button" id="v2CloseIssues">关闭</button></div>`;
    document.body.append(errorPanel);

    scheduledAdminUi = createScheduledAdminDialog();

    const businessPrompt = document.createElement("section");
    businessPrompt.id = "v2BusinessPrompt";
    businessPrompt.className = "v2-business-prompt";
    businessPrompt.hidden = true;
    businessPrompt.innerHTML = `<div><strong>需要关联业务审批</strong><p id="v2BusinessPromptText"></p></div><button type="button" id="v2BusinessPromptAction">立即关联</button>`;
    compactWorkflow.insertAdjacentElement("afterend", businessPrompt);

    createSceneDialog();
    createInvoiceTitleDialog();
    createStepShell();
  }

  function createSceneDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "v2SceneDialog";
    dialog.className = "v2-scene-dialog";
    dialog.innerHTML = `<div class="v2-scene-content">
      <header><div><p class="eyebrow">先选对业务场景</p><h2>这次费用属于哪一种？</h2><p>选择后会给出对应填写步骤，之后仍可更换入口。</p></div><button class="icon-button" id="v2CloseSceneDialog" type="button">×</button></header>
      <div id="v2SceneCards" class="v2-scene-grid"></div>
    </div>`;
    document.body.append(dialog);
  }

  function createInvoiceTitleDialog() {
    const dialog = document.createElement("dialog");
    dialog.id = "v2InvoiceTitleDialog";
    dialog.className = "v2-invoice-title-dialog";
    dialog.innerHTML = `<div class="v2-invoice-title-dialog-content">
      <header><div><p class="eyebrow">发票抬头需要补充</p><h2>发现发票抬头异常</h2><p>异常发票已从原费用明细移出，不会提交到钉钉 OA。</p></div><button class="icon-button" type="button" data-v2-title-close>×</button></header>
      <p class="v2-invoice-title-dialog-tip">请按每条提示补充与本次付款公司一致的发票；补充成功后系统会自动归回原明细。若不再使用原发票，可直接删除该异常项。</p>
      <div id="v2InvoiceTitleList" class="v2-invoice-title-list"></div>
      <footer><button class="secondary-button" type="button" data-v2-title-close>稍后处理</button></footer>
    </div>`;
    document.body.append(dialog);
  }

  function renderInvoiceTitleIssues(slots = getPendingInvoiceTitleReplacementSlots()) {
    const list = document.getElementById("v2InvoiceTitleList");
    if (!list) return;
    list.innerHTML = slots.map((slot) => `<article class="v2-invoice-title-item">
      <div><strong>${escapeHtml(slot.rowLabel || "未分配费用明细")}</strong><span>原发票：${escapeHtml(slot.originalFileName || "未知文件")}</span><small>OCR购买方：${escapeHtml(slot.buyerName || "未识别")}</small><small>应使用：${escapeHtml(slot.expectedCompany || companySelect.value || "本次付款公司")}</small><em>${escapeHtml(slot.reason || "发票抬头不一致")}</em></div>
      <div class="v2-invoice-title-actions"><button type="button" data-v2-title-replace="${escapeHtml(slot.id)}">补充该行发票</button><button class="danger" type="button" data-v2-title-discard="${escapeHtml(slot.id)}">删除该异常项</button></div>
    </article>`).join("") || "<p class=\"v2-targeted-attachment-empty\">当前没有待补充的发票。</p>";
  }

  window.__reimbursementV2ShowInvoiceTitleIssues = (slots = getPendingInvoiceTitleReplacementSlots()) => {
    const pending = Array.isArray(slots) && slots.length ? slots : getPendingInvoiceTitleReplacementSlots();
    if (!pending.length) return;
    renderInvoiceTitleIssues(pending);
    const dialog = document.getElementById("v2InvoiceTitleDialog");
    if (dialog && !dialog.open) dialog.showModal();
  };

  function createStepShell() {
    const formRoot = document.createElement("div");
    formRoot.className = "v2-step-root";
    formRoot.id = "v2StepRoot";
    form.prepend(formRoot);
    stepShellOrder.forEach((id, index) => {
      const section = document.createElement("section");
      section.className = "v2-step";
      section.dataset.stepId = id;
      section.innerHTML = `<button type="button" class="v2-step-header" data-v2-open-step="${id}">
        <span class="v2-step-number">${index + 1}</span><span class="v2-step-heading"><b>${stepLabels[id]}</b><small data-v2-step-summary>待处理</small></span><span class="v2-step-state">展开</span>
      </button><div class="v2-step-content" data-v2-step-content></div><footer class="v2-step-footer"><span class="v2-step-ready-hint" data-v2-step-ready-hint></span><button type="button" class="v2-next-button" data-v2-next-step>下一步</button></footer>`;
      formRoot.append(section);
    });
    const compactRoot = document.createElement("div");
    compactRoot.className = "v2-compact-root";
    compactRoot.id = "v2CompactRoot";
    compactRoot.hidden = true;
    compactRoot.innerHTML = compactStages.map((stage, index) => `<section class="v2-compact-stage" data-v2-compact-stage="${stage.id}" hidden>
      <header class="v2-compact-stage-header"><div><p>步骤 ${index + 1} / ${compactStages.length}</p><h2>${stage.title}</h2><span>${stage.description}</span></div><strong data-v2-compact-stage-summary>待处理</strong></header>
      <div class="v2-compact-empty" data-v2-compact-empty hidden><strong>当前场景无需处理这一项</strong><p>可以直接进入下一步，其他业务校验不会因此跳过。</p></div>
      <div class="v2-compact-stage-content" data-v2-compact-stage-content></div>
      <footer class="v2-compact-stage-footer"><button type="button" class="v2-compact-previous" data-v2-compact-direction="-1">上一步</button><span data-v2-compact-stage-hint></span><button type="button" class="v2-compact-next" data-v2-compact-direction="1">下一步 ↗</button></footer>
    </section>`).join("");
    formRoot.append(compactRoot);
    mountStableComponents();
  }

  function stepContent(id) {
    return document.querySelector(`.v2-step[data-step-id="${id}"] [data-v2-step-content]`);
  }

  function isExperimentalDetailSetupWorkflow(workflow = currentWorkflow()) {
    return Boolean(v2State.profile?.expenseEntryV3
      && workflow?.targetType === "daily"
      && !isSupplyWorkflow(workflow));
  }

  function getStepOrder(workflow = currentWorkflow()) {
    return isExperimentalDetailSetupWorkflow(workflow) ? experimentalDailyStepOrder : stableStepOrder;
  }

  function getStepLabel(id, workflow = currentWorkflow()) {
    if (id === "details" && isExperimentalDetailSetupWorkflow(workflow)) return "核对自动回填";
    return stepLabels[id];
  }

  function isRemovableExperimentalDailyRow(row = {}) {
    return !row.businessDate
      && !String(row.reason || "").trim()
      && !Number(formatMoney(row.amount || 0))
      && !getRowFileKeys(row, "payment", "daily").length
      && !getRowFileKeys(row, "invoice", "daily").length;
  }

  function normalizeExperimentalDetailCount(value, fallback = state.dailyRows.length || 1) {
    return Math.max(1, Math.min(20, Number.parseInt(value, 10) || fallback || 1));
  }

  function getExperimentalDetailCountInput() {
    return normalizeExperimentalDetailCount(v2State.experimentalDetailCountInput, state.dailyRows.length || 1);
  }

  function setExperimentalDetailCountInput(value) {
    v2State.experimentalDetailCountInput = normalizeExperimentalDetailCount(value, state.dailyRows.length || 1);
    return v2State.experimentalDetailCountInput;
  }

  function renderExperimentalLineSetup() {
    const setup = stepContent("line_setup");
    if (!setup) return;
    if (!isExperimentalDetailSetupWorkflow()) {
      setup.innerHTML = "";
      return;
    }
    const count = getExperimentalDetailCountInput();
    setup.innerHTML = `<section class="v2-line-setup-card">
      <div class="v2-experimental-step-kicker">第 2 步 · 只建立空白行</div>
      <h3>此次报销有几条明细？</h3><p>这里先不填写金额和申请事由。上传附件并归类后，系统会自动回填金额、日期和发票类型等可确认字段；申请事由由你在下一步人工填写。</p>
      <div class="v2-line-setup-counter"><label for="v2DetailCount">报销明细数量</label><div class="v2-line-setup-controls"><button type="button" data-v2-detail-count-adjust="-1" aria-label="减少一条">−</button><input id="v2DetailCount" type="number" inputmode="numeric" min="1" max="20" value="${count}" aria-label="费用明细条数"><button type="button" data-v2-detail-count-adjust="1" aria-label="增加一条">＋</button><button type="button" class="primary" data-v2-detail-count-apply>确认明细数量</button></div></div>
      <div class="v2-generated-detail-preview"><div><strong>已自动建立的空白明细</strong><span>${count} 条</span></div><ol>${Array.from({ length: count }, (_, index) => `<li><b>第 ${index + 1} 条费用明细</b><small>待附件上传后自动回填</small></li>`).join("")}</ol></div>
      <small>如需减少条数，系统只会移除末尾尚未填写、也未分配附件的空白明细，避免误删已有资料。</small>
    </section>`;
  }

  function applyExperimentalDetailCount(nextCount) {
    if (!isExperimentalDetailSetupWorkflow()) return;
    readDailyRowsFromDom();
    const requested = setExperimentalDetailCountInput(nextCount);
    const current = state.dailyRows.length || 1;
    if (requested > current) {
      for (let index = current; index < requested; index += 1) state.dailyRows.push(createDailyRow());
      v2State.experimentalAutoFillSummary = "已建立空白明细，请在下一步上传并分配对应附件。";
    } else if (requested < current) {
      const removable = state.dailyRows.slice(requested);
      if (!removable.every(isRemovableExperimentalDailyRow)) {
        addMessage("bot", "末尾明细已有填写内容或附件，为避免误删未调整条数；请先在“核对费用明细”中处理这些明细。");
        v2State.experimentalDetailCountInput = current;
        renderExperimentalLineSetup();
        return;
      }
      state.dailyRows = state.dailyRows.slice(0, requested);
      v2State.experimentalAutoFillSummary = "已按本次报销条数调整空白明细。";
    }
    v2State.experimentalDetailCountInput = state.dailyRows.length;
    renderDailyRows();
    renderFiles();
    syncDraft();
    renderProgress();
  }

  function mountStableComponents() {
    const related = stepContent("related");
    const details = stepContent("details");
    const attachments = stepContent("attachments");
    const ocr = stepContent("ocr");
    const account = stepContent("account");
    const review = stepContent("review");
    if (related && leftRelatedMount.parentElement !== related) related.append(leftRelatedMount);
    if (related && departmentField.parentElement !== related) related.prepend(departmentField);
    renderExperimentalLineSetup();
    let autoFillNotice = document.getElementById("v2ExperimentalAutofillNotice");
    if (isExperimentalDetailSetupWorkflow()) {
      if (!autoFillNotice) {
        autoFillNotice = document.createElement("div");
        autoFillNotice.id = "v2ExperimentalAutofillNotice";
        autoFillNotice.className = "v2-experimental-autofill-notice";
      }
      autoFillNotice.textContent = v2State.experimentalAutoFillSummary || "上传并分配附件后，系统会自动填写能确认的日期、金额和发票类型；申请事由请人工填写。";
      if (details && autoFillNotice.parentElement !== details) details.append(autoFillNotice);
    } else {
      autoFillNotice?.remove();
    }
    if (details && dailyDetailSection.parentElement !== details) details.append(dailyDetailSection);
    if (details && travelDetailSection.parentElement !== details) details.append(travelDetailSection);
    if (attachments && attachmentDock.parentElement !== attachments) attachments.append(attachmentDock);
    let attachmentLead = document.getElementById("v2ExperimentalAttachmentLead");
    if (isExperimentalDetailSetupWorkflow()) {
      if (!attachmentLead) {
        attachmentLead = document.createElement("section");
        attachmentLead.id = "v2ExperimentalAttachmentLead";
        attachmentLead.className = "v2-experimental-step-lead";
      }
      attachmentLead.innerHTML = `<div class="v2-experimental-step-kicker">第 3 步 · 上传一次即可</div><h3>上传并归类附件</h3><p>批量上传付款凭证、发票和行程单。系统会在“唯一明细”或“唯一 OCR 金额匹配”时自动归属；有歧义时再由你选择对应明细。归类完成后，下一步会自动回填可确认字段，并引导你填写申请事由。</p>`;
      if (attachments && attachmentLead.parentElement !== attachments) attachments.prepend(attachmentLead);
    } else {
      attachmentLead?.remove();
    }
    const ocrMount = isExperimentalDetailSetupWorkflow() ? details : ocr;
    if (ocrMount) {
      const detected = form.querySelector(".detected-summary-grid");
      if (detected && detected.parentElement !== ocrMount) ocrMount.append(detected);
      if (riskBox && riskBox.parentElement !== ocrMount) ocrMount.append(riskBox);
      if (rollbackOcrSuggestionsButton && rollbackOcrSuggestionsButton.parentElement !== ocrMount) ocrMount.append(rollbackOcrSuggestionsButton);
    }
    if (account) {
      if (companyField.parentElement !== account) account.append(companyField);
      if (dailyLeftMetaMount.parentElement !== account) account.append(dailyLeftMetaMount);
      if (recipientAccountField.parentElement !== account) account.append(recipientAccountField);
      if (otherRemarkField.parentElement !== account) account.append(otherRemarkField);
      if (remarkField.parentElement !== account) account.append(remarkField);
    }
    if (review) {
      [amountInput.closest("label"), amountUpperInput.closest("label"), amountCheckBox, dailyPreviewSection, form.querySelector(".summary-row"), submitButton]
        .filter(Boolean).forEach((element) => { if (element.parentElement !== review) review.append(element); });
    }
    const travelTable = travelRowsBody?.closest("table");
    if (travelTable) travelTable.classList.add("v2-travel-table");
    if (travelDetailHint) {
      travelDetailHint.textContent = "每一行只代表一条明确的费用归类；上方关联的出差申请对整张报销单生效，无需逐行一一对应。";
    }
  }

  // V2 将附件操作统一收口到第 3 步。第 2 步只展示已经分配的结果，避免
  // “明细行上传”和“附件工作台上传”被理解为需要重复执行的两个步骤。
  function renderV2RowAttachmentCell(row, kind, targetType = "daily") {
    const isPayment = kind === "payment";
    const keys = getRowFileKeys(row, kind, targetType);
    const label = isPayment ? "付款凭证" : "发票";
    const chips = keys.length
      ? keys.map((key) => {
        const file = getFileByKey(key);
        const name = file?.name || "已分配附件";
        const unlinkAction = targetType === "travel" ? "unlink-travel-file" : "unlink-row-file";
        return `<span class="v2-row-file-chip"><button type="button" class="row-file-preview" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(name)}</button><button type="button" class="v2-row-file-unlink" data-action="${unlinkAction}" data-kind="${kind}" data-key="${escapeHtml(key)}" title="仅从本行移除附件">移除</button></span>`;
      }).join("")
      : `<span class="v2-row-file-empty">第 3 步统一添加</span>`;
    return `<div class="row-file-cell v2-row-file-cell" data-row-id="${escapeHtml(row.id)}" data-kind="${kind}">
      <div class="v2-row-file-status ${keys.length ? "is-assigned" : "is-missing"}">${keys.length ? `已分配 ${keys.length} 个${label}` : `待补充${label}`}</div>
      <div class="row-file-chips">${chips}</div>
    </div>`;
  }

  renderRowAttachmentCell = function renderV2DailyRowAttachmentCell(row, kind) {
    return renderV2RowAttachmentCell(row, kind, "daily");
  };

  renderTravelAttachmentCell = function renderV2TravelRowAttachmentCell(row, kind) {
    return renderV2RowAttachmentCell(row, kind, "travel");
  };

  function getV2Rows(workflow = currentWorkflow()) {
    return workflow.targetType === "travel" ? state.travelRows : state.dailyRows;
  }

  function isV2AssignableFile(file, workflow) {
    if (file?.titleValidation?.quarantined) return false;
    const kind = classifyFile(file);
    if (workflow.invoiceOnly) return kind === "invoice";
    if (workflow.noInvoice) return kind === "payment";
    return kind === "payment" || kind === "invoice";
  }

  function isV2FileAlreadyAssigned(fileKey) {
    return Boolean(getFileRowAssignment(fileKey) || getFileTravelRowAssignment(fileKey));
  }

  function assignV2FileToRow(fileKey, row, workflow) {
    const field = classifyFile(getFileByKey(fileKey)) === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
    row[field] = Array.from(new Set([...(row[field] || []), fileKey]));
    if (isRelatedDrivenWorkflow(workflow) && row.relatedInstanceId) {
      const file = getFileByKey(fileKey);
      if (file) {
        file.relatedInstanceId = row.relatedInstanceId;
        file.relatedAutoAssigned = true;
      }
    }
  }

  // 只处理没有任何歧义的两类情况：唯一明细，或 OCR 金额只命中唯一明细。
  // 多行同金额、OCR 未识别金额、多关联审批等仍必须由用户在原分配弹窗确认。
  function autoAssignV2ResolvableAttachments({ newFiles = [], targetRowId = "" } = {}) {
    if (targetRowId) return true;
    const workflow = currentWorkflow();
    if (!workflow || state.selectedRelated.length > 1) return false;
    if (workflow.targetType === "daily") readDailyRowsFromDom();
    if (workflow.targetType === "travel") readTravelRowsFromDom();
    const rows = getV2Rows(workflow);
    if (!rows.length) return false;

    const suppliedFiles = Array.isArray(newFiles) && newFiles.length ? newFiles : state.files;
    const candidates = suppliedFiles.filter((file) => isV2AssignableFile(file, workflow) && !isV2FileAlreadyAssigned(getFileKey(file)));
    if (!candidates.length) return true;

    candidates.forEach((file) => {
      let target = null;
      if (rows.length === 1) {
        target = rows[0];
      } else {
        const ocrAmount = Number(formatMoney(getOcrAmount(file)));
        if (ocrAmount > 0) {
          const amountMatches = rows.filter((row) => Math.abs(Number(formatMoney(row.amount || 0)) - ocrAmount) <= AMOUNT_TOLERANCE);
          if (amountMatches.length === 1) target = amountMatches[0];
        }
      }
      if (target) assignV2FileToRow(getFileKey(file), target, workflow);
    });

    if (isRelatedDrivenWorkflow(workflow)) syncRelatedDrivenRows();
    return candidates.every((file) => isV2FileAlreadyAssigned(getFileKey(file)));
  }

  window.__reimbursementV2AutoAssignAttachments = autoAssignV2ResolvableAttachments;

  function rowLabelForAttachment(row, index, workflow) {
    const reason = String(row.reason || "").trim() || `第 ${index + 1} 条费用明细`;
    const amount = Number(formatMoney(row.amount || 0)) > 0 ? ` · ¥${formatMoney(row.amount)}` : "";
    const type = workflow.targetType === "travel" ? row.expenseType : row.project;
    return `${reason}${type ? ` · ${type}` : ""}${amount}`;
  }

  function renderV2AttachmentWorkbench() {
    if (!attachmentDock) return;
    const workflow = currentWorkflow();
    const rows = getV2Rows(workflow);
    const noInvoice = isNoInvoiceWorkflow(workflow);
    const invoiceOnly = isSupplyWorkflow(workflow);
    const uploadGrid = attachmentDock.querySelector(".upload-grid");
    const bulkTip = attachmentDock.querySelector("#bulkUploadTip");
    if (bulkTip) {
      bulkTip.textContent = invoiceOnly
        ? "附件只需上传一次：首次可在这里批量上传全部发票，再点击“分配附件”归入对应明细。"
        : noInvoice
          ? "附件只需上传一次：首次可在这里批量上传全部付款凭证，再点击“分配附件”归入对应明细。"
          : isExperimentalDetailSetupWorkflow(workflow)
            ? "先批量上传并分配付款截图和发票；进入下一步后，系统会按已归类附件自动回填金额、日期和发票类型等可确认字段，申请事由需人工填写。"
            : "附件只需上传一次：首次可在这里批量上传全部付款截图和发票，再点击“分配附件”归入对应明细。";
    }

    let panel = document.getElementById("v2TargetedAttachmentPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "v2TargetedAttachmentPanel";
      panel.className = "v2-targeted-attachment-panel";
      uploadGrid?.insertAdjacentElement("afterend", panel);
    }

    const titleSlots = getPendingInvoiceTitleReplacementSlots();
    const continuingUpload = `<section class="v2-continue-upload"><div><strong>还要继续补充附件？</strong><p>无论是首批还是后续补传，都会进入同一条“上传 → OCR 识别 → 自动归类”链路。识别完成前不会标记为已就绪。</p></div><div><button type="button" data-v2-bulk-supplement="payment">补充付款凭证</button>${noInvoice ? "" : '<button type="button" data-v2-bulk-supplement="invoice">补充发票</button>'}</div></section>`;
    const titleHold = titleSlots.length ? `<section id="v2InvoiceTitleHold" class="v2-invoice-title-hold"><div><strong>有 ${titleSlots.length} 张发票抬头待补充</strong><p>异常发票已从原明细移出。补充正确发票后，系统会自动归回对应明细。</p></div><button type="button" data-v2-title-open>查看并补充</button></section>` : "";
    const cards = rows.map((row, index) => {
      const paymentEvidence = getRowEvidenceReadiness(row, "payment");
      const invoiceEvidence = getRowEvidenceReadiness(row, "invoice");
      const paymentRequired = !invoiceOnly;
      const invoiceRequired = invoiceOnly || (!noInvoice && row.invoiceType !== "无");
      const statusClass = (evidence) => evidence.countable ? "is-ready" : evidence.pending ? "is-processing" : "is-missing";
      const paymentLabel = paymentEvidence.countable
        ? `付款凭证 OCR 已确认 ¥${formatMoney(paymentEvidence.amount)}`
        : paymentEvidence.pending ? "付款凭证正在上传并 OCR 识别" : paymentEvidence.assigned ? "付款凭证 OCR 未确认" : "付款凭证待补充";
      const invoiceLabel = invoiceEvidence.countable
        ? `发票 OCR 已确认 ¥${formatMoney(invoiceEvidence.amount)}`
        : invoiceEvidence.pending ? "发票正在上传并 OCR 识别" : invoiceEvidence.assigned ? "发票 OCR 未确认/不可计入" : "发票待补充";
      const paymentState = paymentRequired
        ? `<span class="${statusClass(paymentEvidence)}">${paymentLabel}</span>`
        : "";
      const invoiceState = invoiceRequired
        ? `<span class="${statusClass(invoiceEvidence)}">${invoiceLabel}</span>`
        : "";
      const actions = [
        paymentRequired ? `<button type="button" data-v2-supplement-kind="payment" data-v2-row-id="${escapeHtml(row.id)}">补充付款凭证</button>` : "",
        invoiceRequired ? `<button type="button" data-v2-supplement-kind="invoice" data-v2-row-id="${escapeHtml(row.id)}">补充发票</button>` : "",
      ].filter(Boolean).join("");
      const fileControls = [
        ...getRowFileKeys(row, "payment", workflow.targetType).map((key) => ({ key, kind: "payment" })),
        ...getRowFileKeys(row, "invoice", workflow.targetType).map((key) => ({ key, kind: "invoice" })),
      ].map(({ key, kind }) => {
        const file = getFileByKey(key);
        return `<span><button type="button" data-action="preview-file" data-key="${escapeHtml(key)}">${escapeHtml(file?.name || "已分配附件")}</button><button type="button" class="v2-row-file-unlink" data-v2-unlink-file="${escapeHtml(key)}" data-v2-unlink-kind="${kind}" data-v2-unlink-row-id="${escapeHtml(row.id)}">从本行移除</button></span>`;
      }).join("");
      return `<article class="v2-attachment-target-card">
        <div class="v2-attachment-target-main"><strong>${escapeHtml(rowLabelForAttachment(row, index, workflow))}</strong><div class="v2-attachment-target-status">${paymentState}${invoiceState}</div>${fileControls ? `<div class="v2-row-file-controls">${fileControls}</div>` : ""}</div>
        <div class="v2-attachment-target-actions">${actions}</div>
      </article>`;
    }).join("");

    panel.innerHTML = `${continuingUpload}${titleHold}<div class="v2-targeted-attachment-heading">
      <div><strong>少一张附件？按明细补充</strong><p>只补充当前明细，不会影响其他明细的附件分配；若附件已上传但尚未归类，请使用上方“分配附件”。</p></div>
    </div>
    <div class="v2-attachment-target-list">${cards || "<p class=\"v2-targeted-attachment-empty\">请先在第 2 步填写费用明细，再到这里上传附件。</p>"}</div>`;
    renderInvoiceTitleIssues(titleSlots);
  }

  function refreshV2AttachmentViews() {
    autoAssignV2ResolvableAttachments();
    const workflow = currentWorkflow();
    const rows = getV2Rows(workflow);
    const files = state.files.filter((file) => isV2AssignableFile(file, workflow));
    const unassigned = files.filter((file) => !isV2FileAlreadyAssigned(getFileKey(file)));
    const pending = getPendingOcrFiles(files);
    const failed = getFailedOcrFiles(files);
    if (uploadProgressBox && files.length && !pending.length) {
      uploadProgressTitle.textContent = failed.length
        ? "附件处理完成，有失败项"
        : unassigned.length
          ? "附件已上传，仍待分配"
          : "附件识别与归类已完成";
      uploadProgressText.textContent = failed.length
        ? `有 ${failed.length} 个附件未成功上传或识别，请删除失败项后重新上传。`
        : unassigned.length
          ? `已上传 ${files.length} 个附件，其中 ${unassigned.length} 个无法自动判断归属，请点击“分配附件”确认。`
          : rows.length
            ? "所有附件已完成上传、OCR识别并归入费用明细，可以继续核对并提交。"
            : "附件已完成上传和 OCR 识别，请先填写费用明细。";
    }
    renderV2AttachmentWorkbench();
    scheduleExperimentalOcrAutofill();
  }

  function scheduleExperimentalOcrAutofill() {
    if (!isExperimentalDetailSetupWorkflow()) return;
    window.clearTimeout(v2State.autoFillTimer);
    v2State.autoFillTimer = window.setTimeout(() => {
      if (!isExperimentalDetailSetupWorkflow()) return;
      readDailyRowsFromDom();
      const suggestions = getOcrDetailSuggestions();
      if (!suggestions.length) return;
      const signature = suggestions.map((item) => [item.rowId, item.amount, item.businessDate, item.reason, item.invoiceType, item.paymentKeys?.join(","), item.invoiceKeys?.join(",")].join("|")).join(";");
      if (!signature || signature === v2State.lastExperimentalOcrSignature) return;
      // 先记录本次附件快照，applyOcrDetailSuggestions 触发的渲染不会重复覆盖用户刚修改过的字段。
      v2State.lastExperimentalOcrSignature = signature;
      state.ocrSuggestionItems = suggestions;
      applyOcrDetailSuggestions();
      v2State.experimentalAutoFillSummary = `已根据 ${suggestions.length} 条已归类附件自动回填金额、日期和发票类型等可确认字段；请填写申请事由并核对风险项目。`;
      mountStableComponents();
      renderProgress();
    }, 80);
  }

  function focusManualReasonStep() {
    if (!isExperimentalDetailSetupWorkflow()) return false;
    readDailyRowsFromDom();
    if (!state.dailyRows.some((row) => !String(row.reason || "").trim())) return false;
    openStep("details", { scroll: true });
    window.setTimeout(() => window.__reimbursementFocusManualReason?.(), 260);
    return true;
  }

  window.__reimbursementV2FocusManualReason = focusManualReasonStep;

  renderDailyRows = function renderV2DailyRows(...args) {
    const result = originalRenderDailyRows(...args);
    window.setTimeout(refreshV2AttachmentViews, 0);
    return result;
  };

  renderTravelRows = function renderV2TravelRows(...args) {
    const result = originalRenderTravelRows(...args);
    window.setTimeout(refreshV2AttachmentViews, 0);
    return result;
  };

  renderFiles = function renderV2Files(...args) {
    const result = originalRenderFiles(...args);
    window.setTimeout(refreshV2AttachmentViews, 0);
    return result;
  };

  placeDailyMetaControls = function placeV2DailyMetaControls() {
    mountStableComponents();
  };

  function visibleStepIds(workflow = currentWorkflow()) {
    return getStepOrder(workflow).filter((id) => {
      if (id === "related") return Boolean(workflow.related);
      return true;
    });
  }

  function getStepCompletion(id, workflow = currentWorkflow()) {
    if (id === "related") {
      if (!workflow.related) return { done: true, summary: "无需前置审批" };
      if (workflow.related.required) return state.selectedRelated.length
        ? { done: true, summary: `已关联 ${state.selectedRelated.length} 张审批` }
        : { done: false, summary: "待关联业务审批" };
      const missing = getMissingBusinessApprovals();
      return missing.length ? { done: false, summary: `需关联${missing.join("、")}` } : { done: true, summary: state.selectedRelated.length ? `已关联 ${state.selectedRelated.length} 张审批` : "按费用需要关联" };
    }
    const rows = workflow.targetType === "travel" ? state.travelRows : state.dailyRows;
    if (id === "line_setup") {
      const done = state.dailyRows.length > 0;
      return { done, summary: done ? `已建立 ${state.dailyRows.length} 条明细` : "请选择本次明细条数" };
    }
    if (id === "details") {
      const dailyRowComplete = (row) => row.businessDate
        && row.reason?.trim()
        && Number(formatMoney(row.amount)) > 0
        && row.project
        // “发票类型”是日常明细的必填列；无票入口会在创建行时固定为“无”。
        && (isNoInvoiceWorkflow(workflow) || row.invoiceType);
      const complete = rows.length && rows.every((row) => (
        workflow.targetType === "travel"
          ? row.businessDate && row.reason?.trim() && Number(formatMoney(row.amount)) > 0 && row.expenseType
          : dailyRowComplete(row)
      ));
      return { done: Boolean(complete), summary: complete ? `${rows.length} 条明细 · ¥${formatMoney(workflow.targetType === "travel" ? getTravelRowsTotal(rows) : getDailyRowsTotal(rows))}` : "待填写费用明细" };
    }
    if (id === "attachments") {
      const invoiceOnly = isSupplyWorkflow(workflow);
      const titleSlots = getPendingInvoiceTitleReplacementSlots();
      const complete = !titleSlots.length && rows.length && rows.every((row) => {
        const paymentReady = invoiceOnly || getRowEvidenceReadiness(row, "payment").countable;
        const invoiceReady = workflow.noInvoice || row.invoiceType === "无" || getRowEvidenceReadiness(row, "invoice").countable;
        return paymentReady && invoiceReady;
      });
      return { done: Boolean(complete), summary: titleSlots.length ? `待补充发票 ${titleSlots.length} 张` : complete ? `付款 ${getFilesByType("payment").length} · 发票 ${getFilesByType("invoice").length}` : "待上传并分配附件" };
    }
    if (id === "ocr") {
      const pending = getPendingOcrFiles();
      const activeFiles = state.files.filter((file) => !file?.titleValidation?.quarantined);
      const failed = getFailedOcrFiles(activeFiles);
      const titleSlots = getPendingInvoiceTitleReplacementSlots();
      return { done: activeFiles.length > 0 && !pending.length && !failed.length && !titleSlots.length, summary: titleSlots.length ? `抬头待补充 ${titleSlots.length} 张` : pending.length ? `识别中 ${pending.length}` : failed.length ? `失败 ${failed.length}` : activeFiles.length ? "OCR已完成" : "等待附件" };
    }
    if (id === "account") {
      const done = Boolean(companySelect.value.trim() && recipientAccountTextInput.value.trim());
      return { done, summary: done ? `${companySelect.value} · 账户已确认` : "待确认公司与账户" };
    }
    if (id === "review") {
      const amount = Number(formatMoney(workflow.targetType === "travel" ? getTravelRowsTotal() : getDailyRowsTotal()));
      // 提交前只能表示“可核对”，不能误标为已完成；真正完成以 OA 发起成功回执为准。
      return { done: false, summary: amount > 0 ? `总额 ¥${formatMoney(amount)} · 待核对并提交` : "待最终核对" };
    }
    return { done: false, summary: "待处理" };
  }

  function compactStageForStep(stepId) {
    return compactStages.find((stage) => stage.stepIds.includes(stepId)) || compactStages[0];
  }

  function visibleCompactStepIds(stage, workflow = currentWorkflow()) {
    const visible = visibleStepIds(workflow);
    return stage.stepIds.filter((id) => visible.includes(id));
  }

  function updateStepPresentation(section, id, visible, workflow, { compact = false } = {}) {
    const shown = visible.includes(id);
    section.hidden = !shown;
    if (!shown) return null;
    const completion = getStepCompletion(id, workflow);
    const wasDone = v2State.completion.get(id);
    if (wasDone === true && !completion.done) v2State.manuallySkipped.add(id);
    v2State.completion.set(id, completion.done);
    section.classList.toggle("is-complete", completion.done);
    section.classList.toggle("is-active", id === v2State.activeStep);
    section.classList.toggle("is-pending", v2State.manuallySkipped.has(id) && !completion.done);
    section.querySelector(".v2-step-number").textContent = visible.indexOf(id) + 1;
    section.querySelector(".v2-step-heading b").textContent = getStepLabel(id, workflow);
    section.querySelector("[data-v2-step-summary]").textContent = completion.summary;
    section.querySelector(".v2-step-state").textContent = id === v2State.activeStep ? "当前" : completion.done ? "已完成" : v2State.manuallySkipped.has(id) ? "待补充" : "待处理";
    const footer = section.querySelector(".v2-step-footer");
    const nextButton = section.querySelector("[data-v2-next-step]");
    const readyHint = section.querySelector("[data-v2-step-ready-hint]");
    const isLastStep = visible.indexOf(id) === visible.length - 1;
    footer.hidden = compact || isLastStep;
    if (!compact && !isLastStep) {
      readyHint.textContent = completion.done
        ? "✓ 本步骤必填内容已完成，可以继续"
        : "本步骤还有内容待补充，也可以稍后返回填写";
      nextButton.textContent = completion.done ? "进入下一步" : "稍后补充，先去下一步";
      nextButton.classList.toggle("is-ready", completion.done);
    }
    return completion;
  }

  function getCompactStageSummary(stage, workflow = currentWorkflow()) {
    const ids = visibleCompactStepIds(stage, workflow);
    if (!ids.length) return { done: true, text: "当前场景无需处理" };
    const completions = ids.map((id) => getStepCompletion(id, workflow));
    const doneCount = completions.filter((item) => item.done).length;
    if (doneCount === completions.length) return { done: true, text: "已完成" };
    if (stage.id === "review") {
      const review = getStepCompletion("review", workflow);
      return { done: false, text: review.summary };
    }
    return { done: false, text: doneCount ? `${doneCount}/${completions.length} 项已完成` : "待处理" };
  }

  function renderCompactProgress(workflow, visible) {
    const stepRoot = document.getElementById("v2StepRoot");
    const compactRoot = document.getElementById("v2CompactRoot");
    const progress = document.getElementById("v2Progress");
    if (!stepRoot || !compactRoot || !progress) return;
    compactRoot.hidden = false;
    progress.classList.add("is-compact");
    if (!compactStages.some((stage) => stage.id === v2State.compactStageId)) v2State.compactStageId = compactStages[0].id;
    const activeStage = compactStages.find((stage) => stage.id === v2State.compactStageId) || compactStages[0];
    const activeIds = visibleCompactStepIds(activeStage, workflow);
    if (activeIds.length && !activeIds.includes(v2State.activeStep)) v2State.activeStep = activeIds[0];

    progress.innerHTML = compactStages.map((stage, index) => {
      const completion = getCompactStageSummary(stage, workflow);
      const active = stage.id === activeStage.id;
      return `<button type="button" data-v2-compact-progress-stage="${stage.id}" class="${completion.done ? "done" : ""} ${active ? "active" : ""}"><span>${completion.done ? "✓" : index + 1}</span><b>${stage.label}</b><small>${completion.text}</small></button>`;
    }).join("");

    compactStages.forEach((stage, stageIndex) => {
      const stageElement = compactRoot.querySelector(`[data-v2-compact-stage="${stage.id}"]`);
      const content = stageElement?.querySelector("[data-v2-compact-stage-content]");
      const stageStepIds = visibleCompactStepIds(stage, workflow);
      stage.stepIds.forEach((id) => {
        const section = document.querySelector(`.v2-step[data-step-id="${id}"]`);
        if (section && content && section.parentElement !== content) content.append(section);
        if (section) updateStepPresentation(section, id, visible, workflow, { compact: true });
      });
      if (!stageElement) return;
      stageElement.hidden = stage.id !== activeStage.id;
      stageElement.querySelector("[data-v2-compact-empty]").hidden = Boolean(stageStepIds.length);
      const summary = getCompactStageSummary(stage, workflow);
      stageElement.querySelector("[data-v2-compact-stage-summary]").textContent = summary.text;
      stageElement.querySelector("[data-v2-compact-stage-hint]").textContent = summary.done
        ? "本页已完成，可继续"
        : "未填完整也可先切换页面，提交时仍会逐项拦截";
      stageElement.querySelector("[data-v2-compact-direction='-1']").hidden = stageIndex === 0;
      stageElement.querySelector("[data-v2-compact-direction='1']").hidden = stageIndex === compactStages.length - 1;
    });
  }

  function renderProgress() {
    const workflow = currentWorkflow();
    const visible = visibleStepIds(workflow);
    const stepRoot = document.getElementById("v2StepRoot");
    const compactRoot = document.getElementById("v2CompactRoot");
    const progress = document.getElementById("v2Progress");
    if (v2State.uiVariant === "compact" && v2State.compactEligible) {
      renderCompactProgress(workflow, visible);
    } else {
      progress?.classList.remove("is-compact");
      if (compactRoot) compactRoot.hidden = true;
      // 切回经典版时把同一批业务模块放回原步骤根节点，不复制任何字段或状态。
      stepShellOrder.forEach((id) => {
        const section = document.querySelector(`.v2-step[data-step-id="${id}"]`);
        if (section && stepRoot && compactRoot) stepRoot.insertBefore(section, compactRoot);
      });
      // 步骤壳包含稳定版与试用版的并集；按当前流程重排后，可见序号始终连续。
      visible.forEach((id) => {
        const section = document.querySelector(`.v2-step[data-step-id="${id}"]`);
        if (section && stepRoot && compactRoot) stepRoot.insertBefore(section, compactRoot);
      });
      if (progress) progress.innerHTML = visible.map((id, index) => {
        const completion = getStepCompletion(id, workflow);
        const active = id === v2State.activeStep;
        return `<button type="button" data-v2-progress-step="${id}" class="${completion.done ? "done" : ""} ${active ? "active" : ""}"><span>${completion.done ? "✓" : index + 1}</span>${getStepLabel(id, workflow)}</button>`;
      }).join("");
      document.querySelectorAll(".v2-step").forEach((section) => updateStepPresentation(section, section.dataset.stepId, visible, workflow));
    }
    updateBusinessPrompt();
    refreshV2AttachmentViews();
  }

  function openStep(id, { scroll = false } = {}) {
    if (!visibleStepIds().includes(id)) return;
    v2State.activeStep = id;
    if (v2State.uiVariant === "compact") v2State.compactStageId = compactStageForStep(id).id;
    document.querySelectorAll(".v2-step").forEach((section) => section.classList.toggle("is-active", section.dataset.stepId === id));
    renderProgress();
    if (scroll) {
      const target = v2State.uiVariant === "compact"
        ? document.querySelector(`[data-v2-compact-stage="${v2State.compactStageId}"]`)
        : document.querySelector(`.v2-step[data-step-id="${id}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function uiVariantStorageKey() {
    const userId = String(state.user?.userId || "");
    return userId ? `reimbursement-assistant-v2-ui-variant:${userId}` : "";
  }

  function updateVariantToggle() {
    const toggle = document.getElementById("v2UiVariantToggle");
    if (!toggle) return;
    toggle.hidden = !v2State.compactEligible;
    const compact = v2State.uiVariant === "compact";
    toggle.setAttribute("aria-pressed", String(compact));
    toggle.textContent = compact ? "切换版本 · 经典版" : "切换版本 · 三步版";
  }

  function setUiVariant(variant, { persist = true, audit = true } = {}) {
    const next = variant === "compact" && v2State.compactEligible ? "compact" : "classic";
    if (next === "compact") v2State.compactStageId = compactStageForStep(v2State.activeStep).id;
    v2State.uiVariant = next;
    document.documentElement.classList.toggle("v2-compact-ui", next === "compact");
    updateVariantToggle();
    const storageKey = uiVariantStorageKey();
    if (persist && storageKey) localStorage.setItem(storageKey, next);
    if (audit) queueClientAuditEvent("ui_variant_switched", {
      action: "ui_variant_switched",
      message: next === "compact" ? "切换到三步版" : "切换到经典版",
      variant: next,
      ...buildClientAuditSnapshot(),
    });
    renderProgress();
  }

  function hasHistoricApproval(entries = []) {
    return entries.some((entry) => String(entry?.processInstanceId || "").trim()
      && ["success", "succeeded"].includes(String(entry?.status || "").toLowerCase()));
  }

  function configureVariantAccess(entries = []) {
    // A compact-UI tester may trial the frontend before they have any
    // historical OA record. Existing successful applicants remain eligible.
    v2State.compactEligible = Boolean(v2State.profile?.compactUiTester) || hasHistoricApproval(entries);
    const storageKey = uiVariantStorageKey();
    const preferred = storageKey ? localStorage.getItem(storageKey) : "";
    setUiVariant(v2State.compactEligible && preferred === "compact" ? "compact" : "classic", { persist: false, audit: false });
  }

  function getMissingBusinessApprovals() {
    const workflow = currentWorkflow();
    if (!workflow.related || isSupplyWorkflow(workflow) || workflow.id === "project") return [];
    const selected = selectedRelatedSourceKeys();
    const rows = workflow.targetType === "travel" ? state.travelRows : state.dailyRows;
    const missing = new Set();
    rows.forEach((row) => {
      const text = `${row.reason || ""} ${row.remark || ""}`;
      if (/团建|团队建设|团队活动/.test(text) && !selected.has("teamBuilding")) missing.add("团建特殊审批");
      if (/出差.{0,12}(车票|机票|火车|高铁|动车|船票|住宿|酒店)|机票|火车票|高铁票|动车票|船票|住宿费|酒店费/.test(text) && !selected.has("travel")) missing.add("出差审批");
      if (/打车|出租车|网约车|滴滴|高德打车|T3|曹操出行|顺风车/i.test(text) && !selected.has("outing") && !selected.has("travel")) missing.add("出差或外出审批");
    });
    return [...missing];
  }

  function updateBusinessPrompt() {
    const prompt = document.getElementById("v2BusinessPrompt");
    const missing = getMissingBusinessApprovals();
    prompt.hidden = !missing.length;
    if (missing.length) document.getElementById("v2BusinessPromptText").textContent = `系统从费用明细中识别到相关业务，请在整张报销单上关联：${missing.join("、")}。无需逐行对应。`;
  }

  function relaxReferencedApprovals() {
    let changed = false;
    state.relatedInstances.forEach((instance) => {
      if (instance.alreadyReferenced) {
        instance.previouslyReferenced = true;
        instance.alreadyReferenced = false;
        instance.selectable = true;
        changed = true;
      }
    });
    if (changed) renderRelatedOptions();
  }

  function renderSceneCards() {
    const cards = WORKFLOWS.filter((workflow) => !workflow.legacy && (!isSupplyWorkflow(workflow) || v2State.profile?.invoiceOnly));
    document.getElementById("v2SceneCards").innerHTML = cards.map((workflow) => {
      const advice = workflow.id === "travel_transport"
        ? "若同一次出差还有餐饮、采购等多类费用，请选择项目制报销。"
        : workflow.id === "project"
          ? "适合一次出差或外出中包含多种不同费用。"
          : workflow.id === "daily"
            ? "适合常规有票费用，可在一张单据中填写多类明细。"
            : workflow.id === "no_invoice"
              ? "仅适合无法取得发票、但有真实付款凭证的费用。"
              : "无需前置审批和付款截图，每条明细上传有效发票即可。";
      return `<button type="button" class="v2-scene-card ${v2State.usedWorkflowIds.has(workflow.id) ? "used" : ""}" data-v2-scene="${workflow.id}">
        <span>${isSupplyWorkflow(workflow) ? "专属入口" : workflow.targetType === "travel" ? "差旅单据" : "日常单据"}</span>
        <strong>${escapeHtml(workflow.title)}</strong><p>${escapeHtml(workflow.description)}</p><small>${escapeHtml(advice)}</small>
        <em>${v2State.usedWorkflowIds.has(workflow.id) ? "已使用过" : "选择此场景 →"}</em>
      </button>`;
    }).join("");
  }

  function openSceneDialog() {
    renderSceneCards();
    const dialog = document.getElementById("v2SceneDialog");
    if (!dialog.open) dialog.showModal();
  }

  function applyWorkflow(workflowId, { openFirst = true } = {}) {
    // 先关闭场景弹窗。即使后续某个页面渲染异常，也不能让用户只能点右上角叉退出。
    const sceneDialog = document.getElementById("v2SceneDialog");
    if (sceneDialog?.open) sceneDialog.close();
    selectWorkflow(workflowId);
    const workflow = currentWorkflow();
    if (isSupplyWorkflow(workflow)) {
      state.dailyRows = state.dailyRows.map((row) => ({ ...row, project: row.project || "采购供应链", invoiceType: row.invoiceType || "电子-普票" }));
    }
    mountStableComponents();
    document.body.classList.toggle("v2-invoice-only", isSupplyWorkflow(workflow));
    paymentDropZone.hidden = isSupplyWorkflow(workflow);
    paymentFilesField.hidden = isSupplyWorkflow(workflow);
    paymentDetectedAmountInput.closest?.("section")?.toggleAttribute?.("hidden", isSupplyWorkflow(workflow));
    document.getElementById("v2CurrentWorkflowTitle").textContent = workflow.title;
    document.getElementById("v2CurrentWorkflowDescription").textContent = workflow.detailHint || workflow.description;
    workflowSelect.value = workflow.id;
    v2State.lastWorkflowId = workflow.id;
    v2State.lastExperimentalOcrSignature = "";
    v2State.experimentalAutoFillSummary = "";
    v2State.experimentalDetailCountInput = null;
    // 每次进入一笔新的 V2 流程都须在第 5 步重新确认实际付款公司。
    state.invoiceTitleValidationCompany = "";
    v2State.manuallySkipped.clear();
    v2State.completion.clear();
    renderDailyRows();
    renderTravelRows();
    renderFiles();
    if (openFirst) openStep(visibleStepIds(workflow)[0], { scroll: false });
    else renderProgress();
    syncDraft();
  }

  function makeIssue(code, step, message, help, target = "") {
    return { code, step, message, help, target };
  }

  function collectV2Issues(data, amount, workflow) {
    const issues = [];
    const push = (code, step, message, help, target) => issues.push(makeIssue(code, step, message, help, target));
    const ocrIssueStep = isExperimentalDetailSetupWorkflow(workflow) ? "details" : "ocr";
    if (!amount || Number(amount) <= 0) push("amount", "review", "请填写大于0的报销金额", "核对明细金额后填写或采用明细合计。", "#amountInput");
    if (!String(data.recipientAccountText || "").trim()) push("recipient", "account", "缺少收款账户", "请选择已保存账户，或填写完整收款信息。", "#recipientAccountField");
    const companyError = validateCompanySelection(data.companyName);
    if (companyError) push("company", "account", companyError, "请从公司清单中选择本次付款主体。", "#companyField");
    const titleSlots = getPendingInvoiceTitleReplacementSlots();
    if (titleSlots.length) push("invoice_title", "attachments", `有 ${titleSlots.length} 张发票抬头待补充`, "这些发票已从原明细移出，请补充与付款公司抬头一致的发票。", "#v2InvoiceTitleHold");
    const invoiceOnly = isSupplyWorkflow(workflow);
    const noInvoice = isNoInvoiceWorkflow(workflow);
    const rows = workflow.targetType === "travel" ? readTravelRowsFromDom() : readDailyRowsFromDom();
    if (!rows.length) push("rows", "details", "请至少填写一行费用明细", "新增一行并填写本笔费用。", workflow.targetType === "travel" ? "#travelDetailSection" : "#dailyDetailSection");
    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const rowSelector = workflow.targetType === "travel" ? `#travelRowsBody tr:nth-child(${rowNumber})` : `#dailyRowsBody tr:nth-child(${rowNumber})`;
      if (!row.businessDate) push("row_date", "details", `第${rowNumber}行缺少费用日期`, "填写实际发生日期。", `${rowSelector} [data-field="businessDate"]`);
      if (!row.reason?.trim()) push("row_reason", "details", `第${rowNumber}行缺少费用说明`, "简要说明本笔费用用途。", `${rowSelector} [data-field="reason"]`);
      if (!formatMoney(row.amount) || Number(row.amount) <= 0) push("row_amount", "details", `第${rowNumber}行金额无效`, invoiceOnly ? "可采用对应发票的OCR金额。" : "可采用对应付款凭证的OCR金额。", `${rowSelector} [data-field="amount"]`);
      if (workflow.targetType === "daily" && !row.project) push("row_project", "details", `第${rowNumber}行缺少所属项目/业务`, "请选择本笔费用归属。", `${rowSelector} [data-field="project"]`);
      if (workflow.targetType === "travel" && !row.expenseType) push("row_type", "details", `第${rowNumber}行缺少费用类型`, "选择最符合的费用类别。", `${rowSelector} [data-field="expenseType"]`);
      if (workflow.targetType === "daily" && !noInvoice && !row.invoiceType) {
        push("row_invoice_type", "details", `第${rowNumber}行缺少发票类型`, "请选择“电子发票”“纸质发票”或“无”。", `${rowSelector} [data-field="invoiceType"]`);
      }
      // 附件工作台位于“上传并分配附件”步骤；不要把用户定位到已折叠的明细表格。
      if (!invoiceOnly && !row.paymentFileKeys?.length) push("row_payment", "attachments", `第${rowNumber}行没有付款凭证`, "上传付款成功截图并在附件工作台分配到本行。", "#attachmentDock");
      if (!noInvoice && row.invoiceType !== "无" && !row.invoiceFileKeys?.length) push("row_invoice", "attachments", `第${rowNumber}行没有发票`, "上传有效发票并在附件工作台分配到本行。", "#attachmentDock");
      if (invoiceOnly && !row.invoiceFileKeys?.length) push("row_invoice_only", "attachments", `第${rowNumber}行没有发票`, "采购供应链专属入口每条明细必须上传发票。", "#attachmentDock");
      if (invoiceOnly && row.invoiceFileKeys?.length) {
        const invoiceTotal = getAssignmentTotals(row).invoice;
        if (invoiceTotal > 0 && Math.abs(Number(row.amount || 0) - invoiceTotal) > AMOUNT_TOLERANCE) push("invoice_amount", ocrIssueStep, `第${rowNumber}行金额与发票不一致`, `填写金额 ${formatMoney(row.amount)} 元，发票识别合计 ${formatMoney(invoiceTotal)} 元。`, "#riskBox");
      }
    });
    if (workflow.related?.required && !state.selectedRelated.length) push("related", "related", `请先选择${workflow.related.label}`, "前置审批只需关联整张报销单，无需逐行对应。", "#relatedBox");
    const businessError = workflow.targetType === "daily" && !invoiceOnly ? validateDailyBusinessApprovalRules(rows, workflow) : "";
    if (businessError) push("business_related", "related", businessError, "OCR识别出的业务类型需要整单关联对应审批。", "#relatedBox");
    if (workflow.targetType === "travel" && state.selectedRelated.length) {
      const fallback = state.selectedRelated[0];
      rows.forEach((row) => {
        if (!row.relatedInstanceId) {
          row.relatedInstanceId = fallback.processInstanceId;
          row.relatedBusinessId = fallback.businessId;
          row.relatedTitle = fallback.title;
        }
      });
      state.travelRows = rows;
    }
    const assignableTypes = noInvoice ? ["payment"] : invoiceOnly ? ["invoice"] : ["payment", "invoice"];
    const pendingFiles = getPendingOcrFiles(state.files.filter((file) => assignableTypes.includes(classifyFile(file))));
    if (pendingFiles.length) push("ocr_pending", ocrIssueStep, `还有${pendingFiles.length}个附件正在识别`, "等待识别完成后再提交。", "#uploadProgressBox");
    const failedFiles = getFailedOcrFiles(state.files.filter((file) => assignableTypes.includes(classifyFile(file))));
    if (failedFiles.length) push("ocr_failed", ocrIssueStep, `有${failedFiles.length}个附件OCR失败`, "删除失败项后重新上传。", "#filesList");
    const notReady = state.files.filter((file) => !file?.titleValidation?.quarantined && !file.dingtalkAttachment);
    if (notReady.length) push("upload_failed", "attachments", "还有附件未成功上传到钉钉", "删除失败附件后重新上传。", "#filesList");
    if (!invoiceOnly) {
      const audit = buildAuditReport(data, amount, workflow);
      audit.errors.forEach((error, index) => push(`audit_${index}`, ocrIssueStep, error, "请核对OCR金额、付款凭证和发票。", "#riskBox"));
    }
    return issues;
  }

  function locateIssue(index) {
    if (!v2State.issues.length) return;
    v2State.issueIndex = (index + v2State.issues.length) % v2State.issues.length;
    const issue = v2State.issues[v2State.issueIndex];
    openStep(issue.step, { scroll: false });
    document.querySelectorAll(".v2-error-target").forEach((element) => element.classList.remove("v2-error-target"));
    const target = document.querySelector(issue.target) || document.querySelector(`.v2-step[data-step-id="${issue.step}"]`);
    target?.classList.add("v2-error-target");
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    target?.focus?.({ preventScroll: true });
    document.getElementById("v2IssueCounter").textContent = `问题 ${v2State.issueIndex + 1}/${v2State.issues.length}`;
    document.getElementById("v2IssueTitle").textContent = issue.message;
    document.getElementById("v2IssueHelp").textContent = issue.help;
    document.getElementById("v2ErrorPanel").hidden = false;
  }

  function showIssues(issues) {
    v2State.issues = issues;
    v2State.issueIndex = 0;
    if (issues.length) locateIssue(0);
  }

  async function submitV2Approval(payload, snapshot) {
    draftStatus.textContent = "提交中";
    submitButton.disabled = true;
    const submissionId = ensureSubmissionId();
    queueClientAuditEvent("submission_intended", {
      action: "submit_requested", ...buildClientAuditSnapshot(), attachments: buildClientAuditSnapshot().attachments,
    }, { critical: true });
    try {
      const result = await withDingTalkSessionRetry(async () => {
        const response = await fetch(`${getApiBase()}/api/approvals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            submission_id: submissionId,
            session_token: state.sessionToken,
            submission_context: {
              workflowId: currentWorkflow().id,
              workflowTitle: currentWorkflow().title,
              traceId: getClientAuditTraceId(),
              snapshot,
              editableDraft: collectDraftData(),
            },
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw createApiError(body.error || "钉钉审批接口返回异常", response.status);
        return body;
      }, "提交审批");
      const instanceId = String(result.processInstanceId || "");
      v2State.lastSnapshot = snapshot;
      markSubmissionSucceeded(instanceId);
      if (instanceId && !v2State.compactEligible) {
        v2State.compactEligible = true;
        updateVariantToggle();
      }
      queueClientAuditEvent("submission_result", {
        action: "submit_succeeded", message: instanceId ? "OA 已创建" : "报销已进入定时发起池", ...buildClientAuditSnapshot(),
      }, { status: "success", critical: true });
      if (result.scheduled) {
        submitButton.textContent = "报销已提交";
        showSubmissionResult({
          state: "success",
          title: "报销提交成功",
          summary: "你的报销资料已成功提交，无需重复操作。",
          details: [
            { label: "提交状态", value: "已成功提交" },
            { label: "报销金额", value: `¥${snapshot.totalAmount || "0.00"}` },
            { label: "报销类型", value: currentWorkflow().title },
            { label: "提交时间", value: formatResultTime(result.submittedAt) },
            { label: "系统流水号", value: result.trackingCode || result.scheduledJobId || submissionId },
          ],
          hint: `本笔报销将按公司统一安排自动发起钉钉 OA，预计发起时间：${formatResultTime(result.scheduledAt)}。`,
        });
        clearSavedDraft();
        draftStatus.textContent = "已提交";
        return;
      }
      showSubmissionResult({
        state: "success",
        title: result.idempotent ? "审批已发起（已避免重复提交）" : "审批已发起",
        summary: result.idempotent ? "系统已找到本次已创建的钉钉 OA，不会重复发起。" : "钉钉 OA 已创建，以下是本次提交的完整回执。",
        details: [
          { label: "审批状态", value: "已发起，等待审批" },
          { label: "审批实例编号", value: instanceId },
          { label: "发起时间", value: formatResultTime() },
          { label: "报销流程", value: currentWorkflow().title },
        ],
        hint: "完整回执已写入个人提交记录。",
        instanceId,
      });
      clearSavedDraft();
      draftStatus.textContent = "已提交";
    } catch (error) {
      markSubmissionEditable();
      queueClientAuditEvent("submission_result", {
        action: "submit_failed", message: error.message || "提交失败", ...buildClientAuditSnapshot(),
      }, { status: "failed", critical: true });
      showSubmissionResult({
        state: "error",
        title: "审批未发起",
        summary: "钉钉 OA 未创建，当前填写和附件仍会保留。",
        details: [
          { label: "失败原因", value: error.message || "未获取到具体错误" },
          { label: "报销流程", value: currentWorkflow().title },
          { label: "失败时间", value: formatResultTime() },
        ],
        hint: getSubmissionFailureHint(error.message),
      });
      draftStatus.textContent = "提交失败";
    } finally {
      if (!isSubmissionLocked()) submitButton.disabled = false;
    }
  }

  async function handleV2Submit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isSubmissionLocked()) {
      showSubmissionResult({
        state: "success",
        title: "本次审批已发起",
        summary: "为避免重复创建审批，请点击“完成并新建报销”开始下一笔。",
        details: [{ label: "审批实例编号", value: state.submittedInstanceId || "已创建，编号待返回" }],
        instanceId: state.submittedInstanceId,
      });
      return;
    }
    if (state.submissionStatus === "submitting") return;
    state.submissionStatus = "submitting";
    renderFiles();
    const workflow = currentWorkflow();
    const data = Object.fromEntries(new FormData(form).entries());
    data.deptId = departmentSelect.value || data.deptId;
    data.companyName = companySelect.value || data.companyName;
    data.otherRemark = otherRemarkInput.value || data.otherRemark;
    data.relatedManual = relatedManualInput.value || data.relatedManual;
    if (workflow.targetType === "daily") readDailyRowsFromDom();
    if (workflow.targetType === "travel") {
      readTravelRowsFromDom();
      syncTravelRowsWithRelated();
      data.amount = formatMoney(getTravelRowsTotal());
    }
    const amount = formatMoney(data.amount || (workflow.targetType === "daily" ? getDailyRowsTotal() : getTravelRowsTotal()));
    amountInput.value = amount;
    syncDraft();
    if (!state.sessionToken) {
      try { await renewDingTalkSession({ announce: true }); } catch (error) {
        markSubmissionEditable();
        renderFiles();
        showIssues([makeIssue("session", "review", "未获取钉钉身份", error.message, "#identityBox")]);
        return;
      }
    }
    await uploadPendingFiles();
    revalidateInvoiceTitles({ notify: true, enforce: true });
    renderFiles();
    if (getPossibleDuplicateFiles({ unresolvedOnly: true }).length) {
      markSubmissionEditable();
      renderFiles();
      openDuplicateReviewDialog({ resumeSubmit: true });
      return;
    }
    const issues = collectV2Issues(data, amount, workflow);
    if (issues.length) {
      markSubmissionEditable();
      renderFiles();
      showIssues(issues);
      return;
    }
    const snapshot = buildSubmissionSnapshot(workflow);
    v2State.lastSnapshot = snapshot;
    const payloadBase = workflow.targetType === "travel" ? buildTravelPayload(data, amount, workflow) : buildDailyPayload(data, amount, workflow);
    if (isSupplyWorkflow(workflow)) payloadBase.invoice_only = true;
    await submitV2Approval({ session_token: state.sessionToken, dept_id: data.deptId, ...payloadBase }, snapshot);
  }

  function bindV2Events() {
    document.getElementById("v2SceneHelpButton").addEventListener("click", openSceneDialog);
    document.getElementById("v2UiVariantToggle").addEventListener("click", () => {
      setUiVariant(v2State.uiVariant === "compact" ? "classic" : "compact");
    });
    document.getElementById("v2ChangeWorkflow").addEventListener("click", openSceneDialog);
    document.getElementById("v2CloseSceneDialog").addEventListener("click", () => document.getElementById("v2SceneDialog").close());
    document.getElementById("v2SceneCards").addEventListener("click", (event) => {
      const card = event.target.closest("[data-v2-scene]");
      if (!card) return;
      applyWorkflow(card.dataset.v2Scene);
      document.getElementById("v2SceneDialog").close();
    });
    document.getElementById("v2Progress").addEventListener("click", (event) => {
      const compactButton = event.target.closest("[data-v2-compact-progress-stage]");
      if (compactButton) {
        const stage = compactStages.find((item) => item.id === compactButton.dataset.v2CompactProgressStage);
        if (!stage) return;
        v2State.compactStageId = stage.id;
        const firstVisible = visibleCompactStepIds(stage)[0];
        if (firstVisible) v2State.activeStep = firstVisible;
        renderProgress();
        document.querySelector(`[data-v2-compact-stage="${stage.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const button = event.target.closest("[data-v2-progress-step]");
      if (button) openStep(button.dataset.v2ProgressStep, { scroll: true });
    });
    document.getElementById("v2StepRoot").addEventListener("click", (event) => {
      const compactDirection = event.target.closest("[data-v2-compact-direction]");
      if (compactDirection) {
        const currentIndex = compactStages.findIndex((stage) => stage.id === v2State.compactStageId);
        const direction = Number(compactDirection.dataset.v2CompactDirection || 0);
        if (direction > 0) {
          const currentStage = compactStages[currentIndex];
          visibleCompactStepIds(currentStage).forEach((id) => {
            if (!getStepCompletion(id).done) v2State.manuallySkipped.add(id);
          });
        }
        const nextStage = compactStages[Math.max(0, Math.min(compactStages.length - 1, currentIndex + direction))];
        if (!nextStage) return;
        v2State.compactStageId = nextStage.id;
        const firstVisible = visibleCompactStepIds(nextStage)[0];
        if (firstVisible) v2State.activeStep = firstVisible;
        renderProgress();
        document.querySelector(`[data-v2-compact-stage="${nextStage.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const countAdjust = event.target.closest("[data-v2-detail-count-adjust]");
      if (countAdjust) {
        const input = document.getElementById("v2DetailCount");
        const next = setExperimentalDetailCountInput((Number.parseInt(input?.value, 10) || getExperimentalDetailCountInput()) + Number(countAdjust.dataset.v2DetailCountAdjust || 0));
        if (input) input.value = next;
        renderExperimentalLineSetup();
        return;
      }
      if (event.target.closest("[data-v2-detail-count-apply]")) {
        applyExperimentalDetailCount(document.getElementById("v2DetailCount")?.value);
        return;
      }
      const header = event.target.closest("[data-v2-open-step]");
      if (header) return openStep(header.dataset.v2OpenStep, { scroll: false });
      const nextButton = event.target.closest("[data-v2-next-step]");
      if (!nextButton) return;
      const section = nextButton.closest(".v2-step");
      const id = section.dataset.stepId;
      // 发票上传阶段只做 OCR 与归类。用户在第 5 步选择实际付款公司、
      // 同时确认收款账户后点击下一步，才将不一致发票隔离并提示补传。
      if (id === "account" && companySelect.value.trim() && recipientAccountTextInput.value.trim()) {
        state.invoiceTitleValidationCompany = companySelect.value;
        revalidateInvoiceTitles({ notify: false, enforce: true });
        const titleSlots = getPendingInvoiceTitleReplacementSlots();
        renderFiles();
        renderDailyRows();
        renderTravelRows();
        syncDraft();
        if (titleSlots.length) {
          addMessage("bot", "付款公司已确认，发现发票抬头异常。请补充与该公司一致的发票后再继续。");
          window.__reimbursementV2ShowInvoiceTitleIssues(titleSlots);
          return;
        }
      }
      const completion = getStepCompletion(id);
      if (completion.done) v2State.manuallySkipped.delete(id);
      else v2State.manuallySkipped.add(id);
      const visible = visibleStepIds();
      const next = visible[visible.indexOf(id) + 1] || visible[visible.length - 1];
      openStep(next, { scroll: true });
    });
    document.getElementById("v2StepRoot").addEventListener("input", (event) => {
      if (event.target?.id !== "v2DetailCount") return;
      // 手动输入也使用同一份待确认数量；后续状态刷新不会把它还原为旧行数。
      v2State.experimentalDetailCountInput = event.target.value;
    });
    attachmentDock.addEventListener("click", (event) => {
      const bulkSupplement = event.target.closest("[data-v2-bulk-supplement]");
      if (bulkSupplement) {
        const input = bulkSupplement.dataset.v2BulkSupplement === "payment" ? paymentFileInput : invoiceFileInput;
        input?.click();
        return;
      }
      const titleOpen = event.target.closest("[data-v2-title-open]");
      if (titleOpen) return window.__reimbursementV2ShowInvoiceTitleIssues();
      const titleReplacement = event.target.closest("[data-v2-title-replace]");
      if (titleReplacement) {
        const slot = getInvoiceTitleReplacementSlot(titleReplacement.dataset.v2TitleReplace);
        if (!slot) return;
        const targetRowId = currentWorkflow().targetType === "travel" ? `travel:${slot.rowId}` : slot.rowId;
        pickRowFiles("invoice", targetRowId, slot.id);
        return;
      }
      const titleDiscard = event.target.closest("[data-v2-title-discard]");
      if (titleDiscard && discardInvoiceTitleReplacementSlot(titleDiscard.dataset.v2TitleDiscard)) {
        renderFiles();
        renderDailyRows();
        renderTravelRows();
        syncDraft();
        addMessage("bot", "已删除该异常发票及其待补充记录；对应费用明细现为待补充发票。");
        if (!getPendingInvoiceTitleReplacementSlots().length) document.getElementById("v2InvoiceTitleDialog").close();
        return;
      }
      const unlink = event.target.closest("[data-v2-unlink-file]");
      if (unlink) {
        const workflow = currentWorkflow();
        const row = getV2Rows(workflow).find((item) => item.id === unlink.dataset.v2UnlinkRowId);
        if (!row) return;
        unlinkFileFromRow(row, unlink.dataset.v2UnlinkFile, unlink.dataset.v2UnlinkKind, workflow.targetType);
        syncAssignedRowAmountsFromPayments();
        renderFiles();
        renderDailyRows();
        renderTravelRows();
        syncDraft();
        addMessage("bot", "已从当前明细移除附件；附件仍保留在工作台，可重新分配或彻底删除。");
        return;
      }
      const supplement = event.target.closest("[data-v2-supplement-kind]");
      if (!supplement) return;
      const rowId = supplement.dataset.v2RowId;
      const kind = supplement.dataset.v2SupplementKind;
      const targetRowId = currentWorkflow().targetType === "travel" ? `travel:${rowId}` : rowId;
      pickRowFiles(kind, targetRowId);
    });
    document.getElementById("v2InvoiceTitleDialog").addEventListener("click", (event) => {
      if (event.target.closest("[data-v2-title-close]")) return document.getElementById("v2InvoiceTitleDialog").close();
      const button = event.target.closest("[data-v2-title-replace]");
      if (!button) {
        const discard = event.target.closest("[data-v2-title-discard]");
        if (!discard || !discardInvoiceTitleReplacementSlot(discard.dataset.v2TitleDiscard)) return;
        renderFiles();
        renderDailyRows();
        renderTravelRows();
        syncDraft();
        addMessage("bot", "已删除该异常发票及其待补充记录；对应费用明细现为待补充发票。");
        renderInvoiceTitleIssues();
        if (!getPendingInvoiceTitleReplacementSlots().length) document.getElementById("v2InvoiceTitleDialog").close();
        return;
      }
      const slot = getInvoiceTitleReplacementSlot(button.dataset.v2TitleReplace);
      if (!slot) return;
      document.getElementById("v2InvoiceTitleDialog").close();
      const targetRowId = currentWorkflow().targetType === "travel" ? `travel:${slot.rowId}` : slot.rowId;
      pickRowFiles("invoice", targetRowId, slot.id);
    });
    document.getElementById("v2BusinessPromptAction").addEventListener("click", () => openStep("related", { scroll: true }));
    document.getElementById("v2PreviousIssue").addEventListener("click", () => locateIssue(v2State.issueIndex - 1));
    document.getElementById("v2NextIssue").addEventListener("click", () => locateIssue(v2State.issueIndex + 1));
    document.getElementById("v2CloseIssues").addEventListener("click", () => {
      document.getElementById("v2ErrorPanel").hidden = true;
      document.querySelectorAll(".v2-error-target").forEach((element) => element.classList.remove("v2-error-target"));
    });
    document.addEventListener("reimbursement:new-submission", () => {
      v2State.lastSnapshot = null;
      v2State.manuallySkipped.clear();
      v2State.completion.clear();
      const workflowId = v2State.profile?.invoiceOnly ? SUPPLY_WORKFLOW_ID : state.workflowId;
      applyWorkflow(workflowId, { openFirst: true });
    });
    document.addEventListener("reimbursement:draft-restored", () => {
      // 恢复草稿不沿用旧入口；重新挂载 V2 外壳，避免钉钉 WebView
      // 复用上一次差旅页面状态，导致恢复后仍被差旅审批校验拦截。
      const workflowId = v2State.profile?.invoiceOnly ? SUPPLY_WORKFLOW_ID : state.workflowId;
      applyWorkflow(workflowId, { openFirst: false });
    });
    submissionHistoryList.addEventListener("click", (event) => {
      const cancelCopy = event.target.closest("[data-cancel-copy]");
      if (cancelCopy) {
        cancelScheduledAndCopy(cancelCopy.dataset.cancelCopy).catch((error) => alert(error.message));
        return;
      }
      const toggle = event.target.closest("[data-history-target]");
      if (!toggle) return;
      const target = document.getElementById(toggle.dataset.historyTarget);
      target.hidden = !target.hidden;
      toggle.textContent = target.hidden ? "查看完整回执" : "收起完整回执";
    });
    scheduledAdminUi.button.addEventListener("click", () => {
      scheduledAdminUi.adminDialog.showModal();
      loadScheduledAdmin().catch((error) => {
        document.getElementById("v2ScheduledAdminList").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      });
    });
    scheduledAdminUi.adminDialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-admin-close]")) scheduledAdminUi.adminDialog.close();
      if (event.target.closest("[data-admin-refresh]")) loadScheduledAdmin().catch((error) => alert(error.message));
      if (event.target.closest("[data-admin-export]")) exportScheduledAdminRecords().catch((error) => alert(error.message));
      if (event.target.closest("[data-admin-manual-create]")) createAdminManualCase().catch((error) => alert(error.message));
      if (event.target.closest("[data-admin-sort]")) {
        operationsDashboardSortDirection = operationsDashboardSortDirection === "desc" ? "asc" : "desc";
        renderOperationsDashboard();
      }
      const tab = event.target.closest("[data-admin-tab]");
      if (tab) {
        operationsDashboardTab = tab.dataset.adminTab;
        if (operationsDashboardTab === "cases") loadAdminWorkbenchCases().then(renderOperationsDashboard).catch((error) => {
          workbenchCases = { error: error.message || "读取排障案件失败" };
          renderOperationsDashboard();
        });
        renderOperationsDashboard();
      }
      const toolbarAction = event.target.closest("[data-admin-action]");
      if (toolbarAction) runScheduledAdminAction(toolbarAction.dataset.adminAction, "", { trigger: toolbarAction }).catch(() => {});
      const jobAction = event.target.closest("[data-admin-job-action]");
      if (jobAction) {
        const id = jobAction.closest("[data-admin-job]")?.dataset.adminJob;
        const action = jobAction.dataset.adminJobAction;
        if (action === "confirm-not-created" && !confirm("请先在钉钉 OA 中按追踪号核对。只有确认 OA 未创建，才可重新发起。是否继续？")) return;
        if (action === "cancel" && !confirm("确认撤销这笔待发送报销吗？")) return;
        if (action === "reschedule") {
          const value = prompt("请输入新的发起时间（例如 2026-08-20 09:00）");
          if (!value) return;
          runScheduledAdminAction(action, id, { scheduled_at: value, trigger: jobAction }).catch(() => {});
          return;
        }
        runScheduledAdminAction(action, id, { trigger: jobAction }).catch(() => {});
      }
      const openCase = event.target.closest("[data-admin-case-open]");
      if (openCase) {
        const caseId = openCase.closest("[data-admin-case]")?.dataset.adminCase;
        if (caseId) openAdminWorkbenchCase(caseId).catch((error) => alert(error.message));
      }
      if (event.target.closest("[data-admin-case-back]")) {
        operationsDashboardTab = "cases";
        renderOperationsDashboard();
      }
      if (event.target.closest("[data-admin-case-repair]")) runAdminWorkbenchCaseAction("repair").catch((error) => alert(error.message));
      if (event.target.closest("[data-admin-case-submit]")) runAdminWorkbenchCaseAction("submit").catch((error) => alert(error.message));
    });
    form.addEventListener("submit", handleV2Submit, true);
    // 字段变化只更新“完成/待补充”状态；步骤切换必须由用户点击按钮确认。
    form.addEventListener("change", () => window.setTimeout(() => renderProgress(), 120));
    document.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target.closest("[role='button']")) window.setTimeout(() => {
        relaxReferencedApprovals();
        mountStableComponents();
        // 点击上传、预览、删除等按钮时只刷新状态；不能因为一次无关点击自动把用户带走。
        renderProgress();
      }, 180);
    });
    const observer = new MutationObserver(() => {
      window.clearTimeout(observer._timer);
      observer._timer = window.setTimeout(() => {
        relaxReferencedApprovals();
        renderProgress();
      }, 120);
    });
    observer.observe(relatedSelect, { childList: true, subtree: true });
  }

  async function waitForSession(timeoutMs = 15000) {
    const started = Date.now();
    while (!state.sessionToken && Date.now() - started < timeoutMs) await new Promise((resolve) => window.setTimeout(resolve, 200));
    return Boolean(state.sessionToken);
  }

  async function loadProfileAndHistory() {
    if (!await waitForSession()) return;
    const params = new URLSearchParams({ session_token: state.sessionToken });
    const [profileResponse, historyResponse] = await Promise.all([
      fetch(`${getApiBase()}/api/v2/profile?${params}`),
      fetch(`${getApiBase()}/api/submission-history?${new URLSearchParams({ session_token: state.sessionToken, limit: "100" })}`),
    ]);
    if (profileResponse.ok) v2State.profile = await profileResponse.json();
    window.__reimbursementRoute?.setEnabled(Boolean(v2State.profile?.onBehalf?.enabled));
    if (scheduledAdminUi) scheduledAdminUi.button.hidden = !v2State.profile?.scheduledApprovals?.isAdmin;
    if (historyResponse.ok) {
      const history = await historyResponse.json();
      const historyEntries = history.entries || [];
      v2State.usedWorkflowIds = new Set(historyEntries.filter((entry) => ["success", "succeeded"].includes(String(entry.status || "").toLowerCase())).map((entry) => entry.workflowId));
      configureVariantAccess(historyEntries);
    } else {
      configureVariantAccess([]);
    }
    if (v2State.profile && !v2State.profile.enabled) {
      location.replace("/");
      return;
    }
    if (v2State.profile?.invoiceOnly) applyWorkflow(SUPPLY_WORKFLOW_ID);
    else {
      // 白名单试用版仅在身份信息返回后启用；初始 DOM 仍是稳定 V2，避免其他用户闪现新流程。
      applyWorkflow(state.workflowId, { openFirst: false });
      openSceneDialog();
    }
  }

  function initV2() {
    createV2Chrome();
    renderWorkflowSelect();
    document.querySelector(".workflow-section").hidden = true;
    document.querySelector(".conversation").hidden = true;
    document.querySelector(".draft-panel").hidden = true;
    document.getElementById("floatingDraftButton").hidden = true;
    bindV2Events();
    applyWorkflow(state.workflowId, { openFirst: true });
    loadProfileAndHistory().catch((error) => console.error(`V2 profile initialization failed: ${error.message}`));
  }

  initV2();
})();
