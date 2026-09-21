import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const appStyle = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const v2Source = await readFile(new URL("../v2.js", import.meta.url), "utf8");
const v2Style = await readFile(new URL("../v2.css", import.meta.url), "utf8");
const v2Router = await readFile(new URL("../v2-router.js", import.meta.url), "utf8");
const ecosystemSource = await readFile(new URL("../ecosystem.config.cjs", import.meta.url), "utf8");

const checks = [
  ["V2 has an isolated route", serverSource.includes('"/v2/index.html"') && serverSource.includes("serveV2Index")],
  ["日常报销（有票）是默认入口且新建时恢复默认", appSource.includes('const DEFAULT_WORKFLOW_ID = WORKFLOWS.find((workflow) => workflow.id === "daily")') && appSource.includes("workflowId: DEFAULT_WORKFLOW_ID") && appSource.includes("state.workflowId = DEFAULT_WORKFLOW_ID")],
  ["草稿恢复不改变当前入口", appSource.includes("草稿只恢复填写内容和附件，不恢复 workflowId") && appSource.includes("state.workflowId = DEFAULT_WORKFLOW_ID") && appSource.includes("reimbursement:draft-restored") && v2Source.includes("reimbursement:draft-restored") && !appSource.includes("state.workflowId = WORKFLOWS.some((workflow) => workflow.id === draft.workflowId)")],
  ["V2 full release overrides a stale tester whitelist", serverSource.includes("REIMBURSEMENT_V2_ENABLED") && serverSource.includes("config.fullRelease ||")],
  ["试用流程使用独立白名单，不改变全量 V2 权限", serverSource.includes("REIMBURSEMENT_V2_EXPERIMENT_USER_NAMES") && serverSource.includes("expenseEntryV3") && v2Source.includes("v2State.profile?.expenseEntryV3")],
  ["试用流程可复用既有 V2 白名单身份", serverSource.includes("REIMBURSEMENT_V2_EXPERIMENT_USE_V2_TESTERS") && serverSource.includes("experimentalUseV2Testers && explicitTester")],
  ["normal workbench entry routes users to V2", serverSource.includes("serveV1Index") && v2Router.includes('location.replace("/v2/")')],
  ["payment excess is warning-only", appSource.includes("hasPaymentExcess") && appSource.includes("付款金额高于报销金额（可以提交）") && serverSource.includes("rowPaymentTotal - declaredAmount > 0.01")],
  ["uploaded attachment names open a preview", appSource.includes("openAttachmentPreview") && appSource.includes('data-action="preview-file"') && appStyle.includes(".attachment-preview-dialog")],
  ["V2 has one attachment workbench with targeted supplements", v2Source.includes("附件只需上传一次") && v2Source.includes("少一张附件？按明细补充") && v2Source.includes("data-v2-supplement-kind") && v2Source.includes("renderV2RowAttachmentCell") && v2Style.includes(".v2-targeted-attachment-panel")],
  ["后续补传走与首次上传相同的服务端 OCR 链路", appSource.includes("createClientUploadId") && appSource.includes('formData.append("target_row_id", file.uploadTargetRowId)') && !appSource.includes("existingKeys.has(fileKey)") && appSource.includes("getRowEvidenceReadiness")],
  ["补传附件在上传回执和草稿刷新后都恢复原目标明细", appSource.includes("reconcileUploadedTargetAssignments") && appSource.includes("uploadTargetRowId: file.uploadTargetRowId") && appSource.includes("if (file.uploadTargetRowId) assignSelectedFileToTarget(file, file.uploadTargetRowId)")],
  ["提交前由签名回执重建补传附件，避免浏览器重绘丢失明细归属", appSource.includes("attachment_row_bindings") && serverSource.includes("reconcileSubmittedAttachmentBindings") && serverSource.includes("whose signed receipt appears in this request")],
  ["提交清单携带补传目标行，后端可在明细字段被重绘为空时恢复", appSource.includes("targetRowId: file.uploadTargetRowId") && appSource.includes("attachment: normalizeAttachmentForApproval") && serverSource.includes("submittedTargetRowId") && serverSource.includes("recoveredBound")],
  ["附件删除、移除归属与补传目标使用同一持久归属", appSource.includes("function unlinkFileFromRow") && appSource.includes("function detachFilesFromRemovedRow") && appSource.includes("file.uploadTargetRowId = getRowTargetId") && appSource.includes("getRowFileKeys")],
  ["V2 可从明细移除附件且工作台明确提供彻底删除", v2Source.includes("data-v2-unlink-file") && v2Source.includes("从本行移除") && appSource.includes(">删除附件</button>") && v2Style.includes(".v2-row-file-unlink")],
  ["服务端对完全相同的补传复用 OCR 回执且记录目标明细", serverSource.includes("const contentIdentity = buildDocumentIdentity({}, file.originalFilename || file.name, contentHash)") && serverSource.includes("ocr: confirmedDuplicate.ocr || {}") && serverSource.includes("targetRowId")],
  ["后端缺票反馈会指出附件角色或明细归属问题", serverSource.includes("没有随本次明细提交可核验的发票附件") && serverSource.includes("未能确认是税务发票") && serverSource.includes("documentRole")],
  ["V2 工作台允许持续补传并显示 OCR 确认状态", v2Source.includes("还要继续补充附件？") && v2Source.includes("data-v2-bulk-supplement") && v2Source.includes("正在上传并 OCR 识别") && v2Style.includes(".v2-continue-upload")],
  ["invoice titles wait for the V2 company-confirmation step before isolation", appSource.includes("shouldDeferV2InvoiceTitleValidation") && appSource.includes("releaseDeferredInvoiceTitleValidation") && v2Source.includes('id === "account"') && v2Source.includes("invoiceTitleValidationCompany") && v2Source.includes("enforce: true")],
  ["deleting a quarantined invoice clears its draft slot and row references", appSource.includes("discardInvoiceTitleReplacementSlot") && appSource.includes("pruneOrphanedInvoiceTitleReplacementSlots") && v2Source.includes("data-v2-title-discard") && v2Style.includes(".v2-invoice-title-actions")],
  ["backend rechecks invoice titles before both direct and scheduled approval dispatch", serverSource.includes("validateApprovalInvoiceTitles") && serverSource.includes("发票抬头校验未通过") && serverSource.includes("prepareDingTalkApproval")],
  ["V2 automatically assigns only unambiguous attachments", appSource.includes("__reimbursementV2AutoAssignAttachments") && v2Source.includes("rows.length === 1") && v2Source.includes("amountMatches.length === 1") && v2Source.includes("state.selectedRelated.length > 1")],
  ["V2 distinguishes OCR completion from attachment assignment", v2Source.includes("附件已上传，仍待分配") && v2Source.includes("附件识别与归类已完成")],
  ["V2 uses an isolated draft namespace", v2Source.includes("reimbursement-assistant-v2-preview")],
  ["V2 offers restoration of the old per-user draft", v2Source.includes("LEGACY_SCOPED_DRAFT_PREFIX") && v2Source.includes("legacy-scoped") && v2Source.includes("originalGetDraftRestoreCandidate")],
  ["travel approval is relaxed to whole-document association", v2Source.includes("前置审批只需关联整张报销单") && !v2Source.includes("请为第 ${rowNumber} 行分配关联出差申请")],
  ["guide steps never require previous step completion", v2Source.includes("manuallySkipped") && v2Source.includes("待补充")],
  ["十叶试用版先建立明细、再上传、再核对", v2Source.includes('experimentalDailyStepOrder = ["related", "line_setup", "attachments", "details", "account", "review"]') && v2Source.includes("此次报销有几条明细？")],
  ["试用版按已归类附件自动回填且不覆盖手工字段", v2Source.includes("scheduleExperimentalOcrAutofill") && v2Source.includes("applyOcrDetailSuggestions") && v2Source.includes("lastExperimentalOcrSignature")],
  ["试用版申请事由改为人工填写", v2Source.includes("申请事由由你在下一步人工填写") && v2Source.includes("申请事由需人工填写") && v2Source.includes("__reimbursementV2FocusManualReason")],
  ["试用版减少条数不会删除已有资料", v2Source.includes("isRemovableExperimentalDailyRow") && v2Source.includes("避免误删")],
  ["试用版把 OCR 风险和待补字段留在核对明细步骤", v2Source.includes('const ocrIssueStep = isExperimentalDetailSetupWorkflow(workflow) ? "details" : "ocr"')],
  ["步骤重绘不会依赖循环外序号", v2Source.includes('document.querySelectorAll(".v2-step").forEach((section) => updateStepPresentation')],
  ["选择场景后优先关闭弹窗", v2Source.includes("if (sceneDialog?.open) sceneDialog.close();")],
  ["试用版上传步骤说明自动回填", v2Source.includes("系统会按已归类附件自动回填金额、日期和发票类型等可确认字段")],
  ["试用版建立明细使用已确认的计数与空白行预览 UI", v2Source.includes("已自动建立的空白明细") && v2Source.includes("待附件上传后自动回填") && v2Source.includes("确认明细数量")],
  ["明细数量加减使用独立的待确认值，刷新不会还原旧行数", v2Source.includes("experimentalDetailCountInput") && v2Source.includes("setExperimentalDetailCountInput") && v2Source.includes("renderExperimentalLineSetup();")],
  ["隐藏步骤后的可见步骤序号连续", v2Source.includes('visible.indexOf(id) + 1')],
  ["经典版卡片物理顺序与引导顺序一致", v2Source.includes('visible.forEach((id) =>') && v2Source.includes('stepRoot.insertBefore(section, compactRoot)')],
  ["三步版固定为关联审批、附件上传、确认提交", v2Source.includes('{ id: "related", label: "关联审批"') && v2Source.includes('{ id: "attachments", label: "附件上传"') && v2Source.includes('{ id: "review", label: "确认提交"')],
  ["三步版复用并移动原业务步骤而不复制表单", v2Source.includes("content.append(section)") && v2Source.includes("stepRoot.insertBefore(section, compactRoot)") && v2Source.includes("同一批业务模块")],
  ["三步版仍向成功创建过 OA 的历史发起人开放", v2Source.includes("function hasHistoricApproval") && v2Source.includes("processInstanceId") && v2Source.includes('["success", "succeeded"]') && v2Source.includes("compactEligible")],
  ["三步版可向指定试用人提前开放", serverSource.includes("REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS") && serverSource.includes("REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES") && serverSource.includes("compactUiTester") && v2Source.includes("v2State.profile?.compactUiTester")],
  ["十叶试用身份使用 userId 与钉钉正式姓名双重匹配", ecosystemSource.includes('REIMBURSEMENT_V2_COMPACT_TEST_USER_IDS: "dingaygke3oh1kncubnv"') && ecosystemSource.includes('REIMBURSEMENT_V2_COMPACT_TEST_USER_NAMES: "十叶-冯硕硕"')],
  ["现有经典版保持默认且切换偏好按用户保存", v2Source.includes('uiVariant: "classic"') && v2Source.includes("reimbursement-assistant-v2-ui-variant:") && v2Source.includes('preferred === "compact"')],
  ["版本切换按钮默认隐藏且记录操作审计", v2Source.includes('variantToggle.hidden = true') && v2Source.includes('queueClientAuditEvent("ui_variant_switched"')],
  ["三步版问题定位仍映射到原业务步骤", v2Source.includes("compactStageForStep(id).id") && v2Source.includes("locateIssue") && v2Source.includes("openStep(issue.step")],
  ["主管参考风格只作用于三步版展示壳", v2Style.includes(".v2-compact-ui") && v2Style.includes("#b7df00") && v2Style.includes(".v2-progress.is-compact") && v2Style.includes(".v2-compact-stage-content .v2-step-content")],
  ["三步版复用参考页的设计令牌", v2Style.includes("--v2-ref-bg: #f2f2f0") && v2Style.includes("--v2-ref-accent: #d4ff00") && v2Style.includes("--v2-ref-content: 64rem")],
  ["三步版使用参考页的无卡片布局", v2Style.includes(".v2-compact-ui .assistant-panel") && v2Style.includes("border-radius: 0") && v2Style.includes("box-shadow: none") && v2Style.includes(".v2-compact-ui .v2-compact-stage-header") && v2Style.includes("display: none")],
  ["三步版字段采用参考页底边线输入", v2Style.includes(".v2-compact-ui #departmentSelect") && v2Style.includes("border-bottom: 1px solid rgba(17, 17, 17, .25)")],
  ["三步版附件区采用参考页虚线面板", v2Style.includes(".v2-compact-ui .drop-zone label") && v2Style.includes("border: 1px dashed rgba(17, 17, 17, .3)")],
  ["三步版底部操作栏与参考页一致", v2Style.includes(".v2-compact-ui .v2-compact-stage-footer") && v2Style.includes("position: fixed") && v2Style.includes(".v2-compact-next") && v2Style.includes("min-width: 128px")],
  ["三步版所有阶段覆盖旧蓝色组件规则", v2Style.includes("--primary: var(--v2-ref-ink)") && v2Style.includes(".v2-compact-ui .v2-continue-upload") && v2Style.includes(".v2-compact-ui .amount-check-box") && v2Style.includes(".v2-compact-ui .v2-compact-stage-header")],
  ["三步版顶栏按钮统一参考页中性色", v2Style.includes(".v2-compact-ui .topbar-actions > button") && v2Style.includes("#systemSettingsButton") && v2Style.includes("background: transparent !important")],
  ["三步版确认提交按钮使用参考页荧光绿", v2Style.includes(".v2-compact-ui #submitButton") && v2Style.includes("background: var(--v2-ref-accent) !important")],
  ["代他人报销入口与三步版展示壳兼容", appSource.includes("/api/dingtalk/on-behalf/profile") && v2Source.includes("__reimbursementRoute") && v2Style.includes(".v2-compact-ui .route-mode-section")],
  ["本人报销和代报路由使用独立分支", serverSource.includes("resolveSubmissionRoute") && serverSource.includes('mode === "self"') && serverSource.includes('mode: "on_behalf"')],
  ["daily detail completion requires invoice type", v2Source.includes("isNoInvoiceWorkflow(workflow) || row.invoiceType")],
  ["V2 submit locator catches missing invoice type", v2Source.includes('push("row_invoice_type", "details"')],
  ["field changes never auto-advance", !v2Source.includes("autoAdvance") && v2Source.includes('form.addEventListener("change", () => window.setTimeout(() => renderProgress(), 120))')],
  ["completed steps require manual confirmation", v2Source.includes("✓ 本步骤必填内容已完成，可以继续") && v2Source.includes('completion.done ? "进入下一步" : "稍后补充，先去下一步"')],
  ["unrelated button clicks do not auto-advance steps", v2Source.includes("renderProgress();\n      }, 180);") && !v2Source.includes("renderProgress({ autoAdvance: true });\n      }, 180);")],
  ["review is not marked complete before OA submission", v2Source.includes('return { done: false, summary: amount > 0 ? `总额 ¥${formatMoney(amount)} · 待核对并提交`')],
  ["attachment and OCR issues target visible workspaces", v2Source.includes('"#attachmentDock"') && v2Source.includes('"#riskBox"')],
  ["structured issue locator is implemented", v2Source.includes("collectV2Issues") && v2Source.includes("locateIssue") && v2Style.includes(".v2-error-target")],
  ["OCR business approval prompt is implemented", v2Source.includes("getMissingBusinessApprovals") && v2Source.includes("立即关联")],
  ["supply-chain invoice-only entry is implemented", v2Source.includes("supply_chain_invoice") && serverSource.includes("invoiceOnlyWorkflow")],
  ["invoice-only permission is verified by backend", serverSource.includes("getV2UserProfile(session).invoiceOnly")],
  ["submission snapshot is persisted", serverSource.includes("sanitizeSubmissionSnapshot") && v2Source.includes("buildSubmissionSnapshot")],
  ["success receipt and history detail exist", v2Source.includes("renderReceipt") && v2Source.includes("查看完整回执")],
  ["scheduled submission uses a plain-language success receipt", v2Source.includes('title: "报销提交成功"') && v2Source.includes("按公司统一安排自动发起钉钉 OA")],
  ["queue clearly distinguishes application time from expected OA initiation", v2Source.includes("申请时间：") && v2Source.includes("预计 OA 发起时间：")],
  ["scheduled submission can be cancelled and copied back to a draft", v2Source.includes("cancelScheduledAndCopy") && v2Source.includes("cancel-and-copy") && v2Source.includes("editableDraft: collectDraftData()")],
  ["scheduled approval admin workbench is permission-gated", v2Source.includes("v2ScheduledAdminButton") && v2Source.includes("scheduledApprovals?.isAdmin")],
  ["manual dispatch gives an immediate visible result", v2Source.includes("v2AdminActionNotice") && v2Source.includes("正在向钉钉发起审批") && serverSource.includes("manual_dispatch_requested") && serverSource.includes("await ensureScheduledApprovalScheduler()?.tick()")],
  ["admin dashboard exposes pool, submissions, uploads and errors", v2Source.includes("operations-dashboard") && v2Source.includes('data-admin-tab="uploads"') && v2Source.includes('data-admin-tab="errors"')],
  ["client operation audit is queued without blocking the reimbursement flow", appSource.includes("queueClientAuditEvent") && appSource.includes("flushClientAuditQueue") && serverSource.includes("/api/client-audit/events") && serverSource.includes("addClientAuditEvents") && v2Source.includes('data-admin-tab="client-audit"')],
  ["Feishu-like compact UI is isolated", v2Style.includes("--v2-blue") && v2Style.includes(".v2-step") && v2Style.includes(".v2-scene-card")],
  ["V1 entry files are not modified to load V2", !serverSource.includes("index.html?v2")],
];

let failed = 0;
for (const [name, passed] of checks) {
  try {
    assert.ok(passed);
    console.log(`PASS | ${name}`);
  } catch {
    failed += 1;
    console.log(`FAIL | ${name}`);
  }
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
