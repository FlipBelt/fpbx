const productionApiOrigin = "https://fpbx.flipbeltchina.com";

const PROCESS_CODES = {
  daily: "PROC-8249A121-DBA1-4B54-A3F8-82D2A66703A5",
  travel: "PROC-04CE0467-D413-41B1-8686-10318BFA537B",
  travelApplication: "PROC-4E30A11D-CB09-49AD-B3D9-94209D6ED80A",
  outingApplication: "PROC-F6BE02CC-396E-4976-A6EC-98EAC339C2B4",
  teamBuildingSpecialApplication: "PROC-0325F16C-A91E-48DE-B04D-71197895996E",
  noInvoiceDaily: "PROC-429BDF89-0899-4857-BED1-03C449C9FBC7",
};

const PROJECT_OPTIONS = [
  "逐风---天猫旗舰店",
  "杭州飞书---小红书",
  "来跑--抖音2运动",
  "乐跑---天猫pop",
  "飞跑---京东POP",
  "飞凌----拼多多运动旗舰店",
  "飞凌---拼多多官方旗舰店",
  "来跑---抖音户外店",
  "飞跑---京东自营",
  "飞跑---抖音1官方旗舰店",
  "杭州飞比特---视频号",
  "杭州飞比特---私域/小程序商城",
  "经销商",
  "出口",
  "集团总部",
  "市场部—品牌营销",
  "市场部—账号运维",
  "市场部—内容营销",
  "市场部—赛事营销",
  "市场部—产品寄样",
  "采购供应链",
];

const INVOICE_TYPE_OPTIONS = [
  "电子-普票",
  "电子-专票",
  "无",
  "纸质-专票",
  "纸质-普通",
];

const EXPENSE_TYPE_OPTIONS = [
  "报销/餐饮",
  "报销/打车",
  "报销/办公",
  "报销/差旅",
  "报销/其他",
  "员工借款",
  "对公打款",
  "其他支出",
];

// 此清单由《公司清单.docx》维护；只允许在此清单内选择走账主体。
const COMPANY_OPTIONS = [
  "飞比特（宁波）国际贸易有限公司",
  "宁波飞比特体育用品有限公司",
  "宁波星飞贸易有限公司",
  "飞将体育科技（宁波）有限公司",
  "杭州飞跑体育有限公司",
  "杭州来跑来购体育科技有限公司",
  "杭州乐跑体育科技有限公司",
  "宁波逐风劲跑体育科技有限公司",
  "杭州飞凌跃动文化体育科技有限公司",
  "杭州飞比特运动有限公司",
  "杭州飞比特体育科技有限公司",
  "杭州环飞体育科技有限公司",
  "杭州京跑体育用品有限公司",
  "宁波甄质供应链管理有限公司",
  "杭州速然体育科技有限公司",
  "杭州飞书电子商务有限公司",
  "杭州径鹰体育用品有限公司",
  "宁波凌一供应链管理有限公司",
  "杭州创简品牌管理有限公司",
  "杭州飞途行远企业管理有限公司",
];

const RELATED_APPROVAL_SOURCES = {
  travel: { key: "travel", label: "出差申请", processCode: PROCESS_CODES.travelApplication },
  outing: { key: "outing", label: "外出申请", processCode: PROCESS_CODES.outingApplication },
  teamBuilding: { key: "teamBuilding", label: "团建特殊审批", processCode: PROCESS_CODES.teamBuildingSpecialApplication },
};

const WORKFLOWS = [
  {
    id: "travel_transport",
    title: "出差差旅费报销",
    targetType: "travel",
    targetName: "差旅报销单据 应用接入测试",
    processCode: PROCESS_CODES.travel,
    related: {
      label: "关联出差申请",
      processCode: PROCESS_CODES.travelApplication,
      required: true,
      autoGenerateRows: true,
      sources: ["travel"],
      hint: "此入口仅用于报销出差产生的差旅费用，必须关联出差申请。",
      emptyHint: "未查询到近期出差申请。请确认该出差申请由当前用户发起，且在一年内。外出打车或项目混合费用请使用日常报销或项目制报销。",
    },
    fields: {
      dateLabel: "费用发生日期",
      reasonLabel: "费用说明",
      amountLabel: "报销金额",
      reasonPlaceholder: "例如：杭州至上海高铁票、客户拜访交通费",
    },
    description: "仅用于已有出差申请的出差差旅费用；每条明细会写入差旅报销表格。",
  },
  {
    id: "daily",
    title: "日常报销（有票）",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    detailMode: "mixed",
    detailHint: "可在同一张日常报销单中填写多条不同费用明细。涉及打车、出差车票或团建时，按明细提示关联对应业务审批。",
    related: {
      label: "关联业务审批",
      required: false,
      sources: ["travel", "outing", "teamBuilding"],
      hint: "普通日常费用可不关联。明细中填写打车、出差车票或团建费用时，提交前必须关联相应的业务审批。",
      emptyHint: "未查询到近期审批。请切换审批类型后查询，或补录页面未显示的本人审批。",
    },
    description: "日常有票费用统一入口；可按实际业务关联出差、外出或团建审批。",
  },
  {
    id: "advance_recharge",
    legacy: true,
    title: "代垫充值费用报销",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    defaultReason: "代垫充值费用",
    detailHint: "本入口适用于代垫充值类费用。费用类别已由入口确定，如有多笔同类费用可继续新增行。",
    description: "适用于员工先行垫付的平台充值、业务充值。",
  },
  {
    id: "express_fee",
    legacy: true,
    title: "快递费报销",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    defaultReason: "快递费",
    detailHint: "本入口适用于快递、物流、寄样等费用。费用类别已由入口确定，如有多笔同类费用可逐行填写。",
    description: "适用于快递、物流、寄样等费用。",
  },
  {
    id: "team_building",
    legacy: true,
    title: "部门团建报销",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    defaultReason: "部门团建费用",
    detailHint: "本入口适用于部门团建、团队活动报销。费用类别已由入口确定，明细可按实际付款或发票拆分。",
    related: {
      label: "关联特殊审批",
      processCode: PROCESS_CODES.teamBuildingSpecialApplication,
      required: true,
      hint: "部门团建报销必须关联特殊审批；可一次选择多条审批，系统会为每条审批生成对应费用明细。",
      emptyHint: "未查询到近期特殊审批。请确认该特殊审批由当前用户发起，且时间在 120 天内。",
    },
    description: "适用于部门团建、团队活动报销。",
  },
  {
    id: "other",
    legacy: true,
    title: "其他",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    detailMode: "mixed",
    detailHint: "本入口用于一张申请中包含多项不同费用的报销，例如采购费、清洁费、服务费等混合在一起。每一行对应一笔费用明细，请逐行填写费用说明、金额、项目、发票和付款截图。",
    description: "适用于包含多项费用、无法归入单一固定入口的日常报销。",
  },
  {
    id: "no_invoice",
    title: "日常报销（无票）",
    targetType: "daily",
    targetName: "日常报销（自动化）（无票接口）",
    processCode: PROCESS_CODES.noInvoiceDaily,
    detailMode: "mixed",
    noInvoice: true,
    detailHint: "仅适用于无法取得发票、但有真实付款凭证的日常费用。涉及打车、出差车票或团建时，仍须按明细关联业务审批。",
    related: {
      label: "关联业务审批",
      required: false,
      sources: ["travel", "outing", "teamBuilding"],
      hint: "无票只豁免税务发票校验，不豁免打车、出差或团建费用的前置审批要求。",
      emptyHint: "未查询到近期审批。请切换审批类型后查询，或补录页面未显示的本人审批。",
    },
    description: "日常无票费用入口：仅提交付款凭证，仍由审批人进行人工审核。",
  },
  {
    id: "project",
    title: "项目制报销",
    targetType: "daily",
    targetName: "日常报销 应用接口测试",
    processCode: PROCESS_CODES.daily,
    detailMode: "mixed",
    detailHint: "适用于同一项目出差或外出期间发生的多类费用。可按实际情况关联出差申请或外出申请，再自由增加本次项目的费用明细。",
    related: {
      label: "关联业务审批",
      required: false,
      sources: ["travel", "outing"],
      hint: "如本次费用已有出差申请或外出申请，可在此关联；项目制报销允许没有关联审批。表格可自由增加交通、餐饮、住宿、打车及其他项目费用。",
      emptyHint: "未查询到近期出差或外出申请。请切换审批类型后查询，或补录页面未显示的本人审批。",
    },
    description: "项目高频部门的日常报销快捷入口；复用日常报销表格和附件校验。",
  },
];

  // 日常报销是使用频率最高的入口。保留集中定义，避免后续调整流程顺序时
  // 又把首个流程误当成默认入口。
const DEFAULT_WORKFLOW_ID = WORKFLOWS.find((workflow) => workflow.id === "daily")?.id || WORKFLOWS[0].id;

const AMOUNT_TOLERANCE = 0.05;
const LEGACY_DRAFT_STORAGE_KEY = "reimbursement-assistant-draft-v1";
const DRAFT_STORAGE_KEY_PREFIX = "reimbursement-assistant-draft-v2";
const AUTO_SAVE_DELAY_MS = 900;
const DAILY_TABLE_COMPONENT = {
  name: "表格",
  id: "TableField_L1UISWLT5V40",
  componentType: "TableField",
  fields: {
    businessDate: { name: "业务实际发生时间", id: "DDDateField_1LGWY28GSUCG0", componentType: "DDDateField" },
    reason: { name: "申请事由", id: "TextField_XBSC2398F4W0", componentType: "TextField" },
    amount: { name: "金额", id: "NumberField_1J8YNAIUNM9S0", componentType: "NumberField" },
    project: { name: "所属项目/业务", id: "DDSelectField_1G3ORCIWFD400", componentType: "DDSelectField" },
    invoiceType: { name: "发票类型", id: "DDSelectField_MG4OLOR0CGG0", componentType: "DDSelectField" },
    paymentAttachments: { name: "付款截图/订单截图", id: "DDAttachment_ZB9SGGPFQ0G0", componentType: "DDAttachment" },
    invoiceAttachments: { name: "对应发票上传", id: "DDAttachment_V7BA660OH8W0", componentType: "DDAttachment" },
    remark: { name: "备注", id: "TextField_1P7B2O0R0MO00", componentType: "TextField" },
  },
};

const TRAVEL_TABLE_COMPONENT = {
  name: "表格",
  id: "TableField_14ZWKM9GVZI80",
  componentType: "TableField",
  fields: {
    relatedBusinessId: { name: "关联审批编号", id: "TextField_LA49ZLJAAJK0", componentType: "TextField" },
    amount: { name: "报销金额", id: "MoneyField_1CZSLJIY5K3K0", componentType: "MoneyField" },
    businessDate: { name: "费用发生日期", id: "DDDateField_151BKRVHY2YO0", componentType: "DDDateField" },
    expenseType: { name: "费用类型", id: "DDSelectField_1I0IPEWJ2HUO0", componentType: "DDSelectField" },
    reason: { name: "费用说明", id: "TextField_UUCNTGK9IPS0", componentType: "TextField" },
    invoiceAttachments: { name: "发票附件", id: "DDAttachment_STCGKPDBPS00", componentType: "DDAttachment" },
    paymentAttachments: { name: "付款截图附件", id: "DDAttachment_14KY9PX6TKSG0", componentType: "DDAttachment" },
  },
};

const RECIPIENT_ACCOUNT_TYPES = {
  PERSONAL_BANK_CARD: "个人银行卡",
  CORPORATE_BANK_ACCOUNT: "对公账户",
  ALIPAY: "支付宝",
  DINGTALK: "钉钉账户",
};

const state = {
  files: [],
  dailyRows: [],
  travelRows: [],
  draftCollapsed: false,
  config: null,
  user: null,
  sessionToken: "",
  socialCompanyRecognition: null,
  submissionRoute: {
    mode: "self",
    subjectUserId: "",
    subjectName: "",
    departmentId: "",
    departmentName: "",
    socialCompanyRecognition: null,
  },
  pendingOnBehalfSubject: null,
  onBehalfEnabled: false,
  companySelectionSource: "manual",
  manualCompanyOverride: false,
  renamingFileKey: "",
  workflowId: DEFAULT_WORKFLOW_ID,
  selectedRelated: [],
  relatedInstances: [],
  relatedSourceKey: "",
  relatedRequestSeq: 0,
  attachmentDockExpanded: false,
  assignmentFocusKeys: [],
  recipientAccounts: [],
  selectedRecipientAccountId: "",
  recipientAccountEditingId: "",
  draftRestorePending: true,
  pendingDraftCandidate: null,
  autoSaveTimer: 0,
  dailyImportNotice: "",
  processingEvents: [],
  resumeSubmitAfterDuplicateReview: false,
  ocrSuggestionRollback: null,
  ocrSuggestionBatchId: "",
  invoiceTitleReplacementSlots: [],
  activeInvoiceTitleReplacementSlotId: "",
  invoiceTitleValidationNoticeTimer: 0,
  // V2 在第 5 步由用户确认付款公司后才开始强制校验发票抬头。
  // 空值表示尚未确认，避免组织规则预填的公司在上传阶段过早拦截附件。
  invoiceTitleValidationCompany: "",
  submissionStatus: "editing",
  submissionId: "",
  submittedInstanceId: "",
  clientAuditTraceId: "",
  clientAuditSequence: 0,
  clientAuditFlushTimer: 0,
  clientAuditCheckpointTimer: 0,
  clientAuditFlushing: false,
};

const FILE_UPLOAD_CONCURRENCY = 2;
const CLIENT_AUDIT_QUEUE_LIMIT = 240;
const CLIENT_AUDIT_APP_VERSION = "20260916-invoice-title-noise-1";
let dingTalkSessionRefreshPromise = null;

function createClientAuditId(prefix = "audit") {
  return window.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getClientAuditStorageKey() {
  return state.user?.userId ? `reimbursement-client-audit:${state.user.userId}` : "";
}

function readClientAuditQueue() {
  const key = getClientAuditStorageKey();
  if (!key) return [];
  try {
    const queue = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(queue) ? queue.slice(-CLIENT_AUDIT_QUEUE_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeClientAuditQueue(queue) {
  const key = getClientAuditStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify((queue || []).slice(-CLIENT_AUDIT_QUEUE_LIMIT))); } catch {}
}

function getClientAuditTraceId() {
  if (!state.clientAuditTraceId) state.clientAuditTraceId = createClientAuditId("trace");
  return state.clientAuditTraceId;
}

function summarizeClientAuditAttachment(file) {
  return {
    fileId: String(file?.dingtalkAttachment?.fileId || ""),
    fileName: String(file?.name || file?.dingtalkAttachment?.fileName || ""),
    kind: classifyFile(file),
    documentRole: String(file?.ocr?.documentRole || ""),
    ocrAmount: formatMoney(file?.ocr?.countableAmount || file?.ocr?.amount || ""),
    targetRowId: String(file?.uploadTargetRowId || ""),
    duplicate: Boolean(file?.possibleDuplicateOfFileId || file?.duplicateDecision === "same"),
    attached: Boolean(file?.dingtalkAttachment?.fileId),
  };
}

function buildClientAuditSnapshot() {
  const workflow = WORKFLOWS.find((item) => item.id === state.workflowId) || {};
  return {
    rowCount: state.dailyRows.length + state.travelRows.length,
    paymentCount: state.files.filter((file) => classifyFile(file) === "payment").length,
    invoiceCount: state.files.filter((file) => classifyFile(file) === "invoice").length,
    amount: formatMoney(amountInput?.value || ""),
    attachments: state.files.slice(0, 30).map(summarizeClientAuditAttachment),
    workflowId: workflow.id || "",
    workflowTitle: workflow.title || "",
    submissionRoute: getSubmissionRoutePayload(),
  };
}

function queueClientAuditEvent(eventType, summary = {}, { status = "info", critical = false } = {}) {
  if (!state.user?.userId) return;
  const workflow = WORKFLOWS.find((item) => item.id === state.workflowId) || {};
  const queue = readClientAuditQueue();
  const event = {
    id: createClientAuditId("event"), traceId: getClientAuditTraceId(), draftId: state.submissionId || "",
    sequence: ++state.clientAuditSequence, eventType, status, workflowId: workflow.id || "",
    workflowTitle: workflow.title || "", clientAt: new Date().toISOString(), appVersion: CLIENT_AUDIT_APP_VERSION,
    summary,
  };
  queue.push(event);
  writeClientAuditQueue(queue);
  if (critical) flushClientAuditQueue();
  else if (!state.clientAuditFlushTimer) state.clientAuditFlushTimer = window.setTimeout(() => flushClientAuditQueue(), 1500);
}

async function flushClientAuditQueue() {
  if (state.clientAuditFlushTimer) window.clearTimeout(state.clientAuditFlushTimer);
  state.clientAuditFlushTimer = 0;
  if (state.clientAuditFlushing || !state.sessionToken) return;
  const queue = readClientAuditQueue();
  if (!queue.length) return;
  state.clientAuditFlushing = true;
  try {
    const batch = queue.slice(0, 25);
    const response = await fetch(`${getApiBase()}/api/client-audit/events`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_token: state.sessionToken, events: batch }), keepalive: true,
    });
    if (response.ok) writeClientAuditQueue(readClientAuditQueue().filter((event) => !batch.some((sent) => sent.id === event.id)));
  } catch {
    // 审计是旁路能力：保留本地队列等待下次发送，绝不影响报销主流程。
  } finally {
    state.clientAuditFlushing = false;
    if (readClientAuditQueue().length) state.clientAuditFlushTimer = window.setTimeout(() => flushClientAuditQueue(), 5000);
  }
}

function scheduleClientAuditCheckpoint(reason = "draft_changed") {
  if (!state.user?.userId) return;
  if (state.clientAuditCheckpointTimer) window.clearTimeout(state.clientAuditCheckpointTimer);
  state.clientAuditCheckpointTimer = window.setTimeout(() => {
    state.clientAuditCheckpointTimer = 0;
    queueClientAuditEvent("draft_checkpoint", { action: reason, ...buildClientAuditSnapshot() });
  }, 1800);
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

const $ = (selector) => document.querySelector(selector);

const appShell = $(".app-shell");
const assistantPanel = $(".assistant-panel");
const workflowSelect = $("#workflowSelect");
const workflowCards = $("#workflowCards");
const routeModeSection = $("#routeModeSection");
const routeModeTitle = $("#routeModeTitle");
const routeModeSummary = $("#routeModeSummary");
const onBehalfOpenButton = $("#onBehalfOpenButton");
const onBehalfSelfButton = $("#onBehalfSelfButton");
const onBehalfDialog = $("#onBehalfDialog");
const onBehalfSearchInput = $("#onBehalfSearchInput");
const onBehalfSearchButton = $("#onBehalfSearchButton");
const onBehalfStatus = $("#onBehalfStatus");
const onBehalfResults = $("#onBehalfResults");
const onBehalfPreview = $("#onBehalfPreview");
const onBehalfPreviewName = $("#onBehalfPreviewName");
const onBehalfPreviewDepartment = $("#onBehalfPreviewDepartment");
const onBehalfPreviewCompany = $("#onBehalfPreviewCompany");
const onBehalfConfirmButton = $("#onBehalfConfirmButton");
const leftRelatedMount = $("#leftRelatedMount");
const dailyLeftMetaMount = $("#dailyLeftMetaMount");
const dailyDetailSection = $("#dailyDetailSection");
const dailyRowsBody = $("#dailyRowsBody");
const dailyTableTotal = $("#dailyTableTotal");
const dailyInvoiceTypeHeader = $("#dailyInvoiceTypeHeader");
const dailyInvoiceAttachmentHeader = $("#dailyInvoiceAttachmentHeader");
const dailyTableFooterSpacer = $("#dailyTableFooterSpacer");
const dailyDetailHint = $("#dailyDetailHint");
const addDailyRowButton = $("#addDailyRowButton");
const importExpenseSheetButton = $("#importExpenseSheetButton");
const expenseSheetInput = $("#expenseSheetInput");
const travelDetailSection = $("#travelDetailSection");
const travelRowsBody = $("#travelRowsBody");
const travelTableTotal = $("#travelTableTotal");
const travelDetailHint = $("#travelDetailHint");
const addTravelRowButton = $("#addTravelRowButton");
const saveDraftButton = $("#saveDraftButton");
const toggleDraftButton = $("#toggleDraftButton");
const collapseDraftButton = $("#collapseDraftButton");
const floatingDraftButton = $("#floatingDraftButton");
const targetFormTitle = $("#targetFormTitle");
const workflowTitle = $("#workflowTitle");
const workflowDescription = $("#workflowDescription");
const conversation = $("#conversation");
const connectionStatus = $("#connectionStatus");
const identityBox = $("#identityBox");
const identityStatus = $("#identityStatus");
const departmentField = $("#departmentField");
const departmentSelect = $("#departmentSelect");
const relatedBox = $("#relatedBox");
const relatedTitle = $("#relatedTitle");
const relatedHint = $("#relatedHint");
const relatedManualInput = $("#relatedManualInput");
const relatedManualField = $("#relatedManualField");
const relatedSourceOptions = $("#relatedSourceOptions");
const relatedSelect = $("#relatedSelect");
const relatedStatus = $("#relatedStatus");
const relatedDetail = $("#relatedDetail");
const loadRelatedButton = $("#loadRelatedButton");
const paymentDropZone = $("#paymentDropZone");
const invoiceDropZone = $("#invoiceDropZone");
const otherDropZone = $("#otherDropZone");
const paymentFileInput = $("#paymentFileInput");
const invoiceFileInput = $("#invoiceFileInput");
const otherFileInput = $("#otherFileInput");
const attachmentDock = $("#attachmentDock");
const attachmentDockSummary = $("#attachmentDockSummary");
const toggleAttachmentDockButton = $("#toggleAttachmentDockButton");
const assignAttachmentsButton = $("#assignAttachmentsButton");
const filesList = $("#filesList");
const oaFormMount = $("#oaFormMount");
const oaFormSection = $("#oaFormSection");
const form = $("#expenseForm");
const businessDateLabel = $("#businessDateLabel");
const businessDateInput = $("#businessDateInput");
const reasonLabel = $("#reasonLabel");
const reasonInput = $("#reasonInput");
const amountLabel = $("#amountLabel");
const amountInput = $("#amountInput");
const amountUpperInput = $("#amountUpperInput");
const amountCheckBox = $("#amountCheckBox");
const amountCheckTitle = $("#amountCheckTitle");
const amountCheckText = $("#amountCheckText");
const expenseTypeField = $("#expenseTypeField");
const expenseTypeSelect = $("#expenseTypeSelect");
const projectField = $("#projectField");
const projectSelect = $("#projectSelect");
const invoiceTypeField = $("#invoiceTypeField");
const invoiceTypeSelect = $("#invoiceTypeSelect");
const companyField = $("#companyField");
const companySelect = $("#companySelect");
const companyMenuToggle = $("#companyMenuToggle");
const companyOptionsMenu = $("#companyOptionsMenu");
const companyMatchHint = $("#companyMatchHint");
const companyRecognitionRefreshButton = $("#companyRecognitionRefreshButton");
const attachmentRenameDialog = $("#attachmentRenameDialog");
const attachmentRenameInput = $("#attachmentRenameInput");
const attachmentRenameHint = $("#attachmentRenameHint");
const attachmentRenameStatus = $("#attachmentRenameStatus");
const saveAttachmentRenameButton = $("#saveAttachmentRenameButton");
const cancelAttachmentRenameButton = $("#cancelAttachmentRenameButton");
const closeAttachmentRenameDialogButton = $("#closeAttachmentRenameDialog");
const remarkField = $("#remarkField");
const remarkInput = $("#remarkInput");
const otherRemarkField = $("#otherRemarkField");
const otherRemarkInput = $("#otherRemarkInput");
const recipientAccountField = $("#recipientAccountField");
const recipientAccountTextInput = $("#recipientAccountTextInput");
const recipientAccountStatus = $("#recipientAccountStatus");
const recipientAccountDialog = $("#recipientAccountDialog");
const openRecipientAccountDialogButton = $("#openRecipientAccountDialog");
const closeRecipientAccountDialogButton = $("#closeRecipientAccountDialog");
const recipientAccountsList = $("#recipientAccountsList");
const recipientAccountsCount = $("#recipientAccountsCount");
const recipientAccountEditorTitle = $("#recipientAccountEditorTitle");
const recipientAccountTypeInput = $("#recipientAccountTypeInput");
const recipientAccountAliasInput = $("#recipientAccountAliasInput");
const recipientAccountNameInput = $("#recipientAccountNameInput");
const recipientAccountNumberInput = $("#recipientAccountNumberInput");
const recipientAccountBankInput = $("#recipientAccountBankInput");
const recipientAccountBranchInput = $("#recipientAccountBranchInput");
const recipientAccountProvinceInput = $("#recipientAccountProvinceInput");
const recipientAccountCityInput = $("#recipientAccountCityInput");
const recipientAccountEditorTip = $("#recipientAccountEditorTip");
const saveRecipientAccountButton = $("#saveRecipientAccountButton");
const resetRecipientAccountEditorButton = $("#resetRecipientAccountEditor");
const dailyPreviewSection = $("#dailyPreviewSection");
const dailyPreviewRows = $("#dailyPreviewRows");
const paymentFilesInput = $("#paymentFilesInput");
const invoiceFilesInput = $("#invoiceFilesInput");
const paymentDetectedAmountInput = $("#paymentDetectedAmountInput");
const invoiceDetectedAmountInput = $("#invoiceDetectedAmountInput");
const paymentDetectedTotal = $("#paymentDetectedTotal");
const invoiceDetectedTotal = $("#invoiceDetectedTotal");
const paymentDetectedList = $("#paymentDetectedList");
const invoiceDetectedList = $("#invoiceDetectedList");
const invoiceDetectedSummary = $("#invoiceDetectedSummary");
const invoiceSummaryStat = $("#invoiceSummaryStat");
const uploadProgressBox = $("#uploadProgressBox");
const uploadProgressTitle = $("#uploadProgressTitle");
const uploadProgressText = $("#uploadProgressText");
const credentialProcessingBox = $("#credentialProcessingBox");
const credentialProcessingTitle = $("#credentialProcessingTitle");
const credentialProcessingText = $("#credentialProcessingText");
const credentialProcessingEvents = $("#credentialProcessingEvents");
const reviewPossibleDuplicatesButton = $("#reviewPossibleDuplicatesButton");
const attachmentCount = $("#attachmentCount");
const paymentCount = $("#paymentCount");
const invoiceCount = $("#invoiceCount");
const draftStatus = $("#draftStatus");
const submitButton = $("#submitButton");
const riskBox = $("#riskBox");
const dialog = $("#resultDialog");
const resultDialogContent = $(".result-dialog-content");
const resultIcon = $("#resultIcon");
const resultEyebrow = $("#resultEyebrow");
const resultTitle = $("#resultTitle");
const resultText = $("#resultText");
const resultDetails = $("#resultDetails");
const resultHint = $("#resultHint");
const copyResultInstanceButton = $("#copyResultInstance");
const submissionHistoryButton = $("#submissionHistoryButton");
const submissionHistoryDialog = $("#submissionHistoryDialog");
const closeSubmissionHistoryDialog = $("#closeSubmissionHistoryDialog");
const submissionHistoryList = $("#submissionHistoryList");
const attachmentAssignmentDialog = $("#attachmentAssignmentDialog");
const duplicateReviewDialog = $("#duplicateReviewDialog");
const duplicateReviewList = $("#duplicateReviewList");
const closeDuplicateReviewDialogButton = $("#closeDuplicateReviewDialog");
const saveDuplicateReviewButton = $("#saveDuplicateReviewButton");
const assignmentOverview = $("#assignmentOverview");
const assignmentSections = $("#assignmentSections");
const assignmentStatus = $("#assignmentStatus");
const draftRestoreDialog = $("#draftRestoreDialog");
const draftRestoreText = $("#draftRestoreText");
const restoreDraftButton = $("#restoreDraftButton");
const discardDraftButton = $("#discardDraftButton");
const addManualRelatedButton = $("#addManualRelatedButton");
const applyAttachmentAssignments = $("#applyAttachmentAssignments");
const rollbackOcrSuggestionsButton = $("#rollbackOcrSuggestionsButton");
const ocrSuggestionDialog = $("#ocrSuggestionDialog");
const ocrSuggestionSummary = $("#ocrSuggestionSummary");
const ocrSuggestionNotice = $("#ocrSuggestionNotice");
const ocrSuggestionList = $("#ocrSuggestionList");
const ocrSuggestionStatus = $("#ocrSuggestionStatus");
const applyOcrSuggestionsButton = $("#applyOcrSuggestionsButton");
const closeOcrSuggestionDialog = $("#closeOcrSuggestionDialog");
const closeOcrSuggestionButton = $("#closeOcrSuggestionButton");
const relatedOriginalParent = relatedBox.parentElement;
const relatedOriginalNextSibling = relatedBox.nextElementSibling;
const companyOriginalParent = companyField.parentElement;
const companyOriginalNextSibling = companyField.nextElementSibling;
const otherRemarkOriginalParent = otherRemarkField.parentElement;
const otherRemarkOriginalNextSibling = otherRemarkField.nextElementSibling;

function currentWorkflow() {
  return WORKFLOWS.find((workflow) => workflow.id === state.workflowId) || WORKFLOWS[0];
}

function isOnBehalfRoute() {
  return state.submissionRoute?.mode === "on_behalf";
}

function getSubmissionRoutePayload() {
  const route = state.submissionRoute || {};
  return {
    mode: isOnBehalfRoute() ? "on_behalf" : "self",
    subjectUserId: String(route.subjectUserId || ""),
    subjectName: String(route.subjectName || ""),
    departmentId: String(route.departmentId || departmentSelect?.value || ""),
    departmentName: String(route.departmentName || departmentSelect?.selectedOptions?.[0]?.textContent || ""),
    companyName: String(companySelect?.value || ""),
    subjectDepartments: Array.isArray(state.pendingOnBehalfSubject?.departments) ? state.pendingOnBehalfSubject.departments : [],
    socialCompanyRecognition: route.socialCompanyRecognition || null,
  };
}

function getSubmissionSubjectUserId() {
  return isOnBehalfRoute() ? String(state.submissionRoute.subjectUserId || "") : String(state.user?.userId || "");
}

function renderSubmissionRoute() {
  if (!routeModeSection) return;
  const enabled = Boolean(state.onBehalfEnabled && state.user?.userId);
  routeModeSection.hidden = !state.user?.userId || !enabled;
  if (onBehalfOpenButton) {
    onBehalfOpenButton.hidden = !enabled;
    onBehalfOpenButton.textContent = isOnBehalfRoute() ? "更换归属人" : "代他人报销";
  }
  if (onBehalfSelfButton) onBehalfSelfButton.hidden = !enabled || !isOnBehalfRoute();
  if (isOnBehalfRoute()) {
    routeModeTitle.textContent = `代报销：${state.submissionRoute.subjectName || state.submissionRoute.subjectUserId}`;
    const dept = state.submissionRoute.departmentName || departmentSelect?.selectedOptions?.[0]?.textContent || "待选择部门";
    const company = companySelect?.value || state.submissionRoute.socialCompanyRecognition?.companyName || "待确认社保公司";
    routeModeSummary.textContent = `部门：${dept}；付款公司：${company}。当前操作人：${state.user?.name || state.user?.userId}。`;
  } else {
    routeModeTitle.textContent = "本人报销";
    routeModeSummary.textContent = "部门和付款公司按当前登录人的钉钉组织及社保主体识别。";
  }
}

function applySubjectDepartmentOptions(subject) {
  if (!departmentSelect) return;
  const departments = Array.isArray(subject?.departments) ? subject.departments : [];
  departmentSelect.innerHTML = departments.map((department) => `<option value="${escapeHtml(department.id)}">${escapeHtml(department.name)}</option>`).join("");
  const selectedId = String(state.submissionRoute.departmentId || "");
  if (selectedId && departments.some((department) => String(department.id) === selectedId)) departmentSelect.value = selectedId;
  else if (departments.length === 1) departmentSelect.value = String(departments[0].id);
  state.submissionRoute.departmentId = String(departmentSelect.value || "");
  state.submissionRoute.departmentName = departmentSelect.selectedOptions?.[0]?.textContent || "";
  departmentSelect.disabled = departments.length <= 1;
  departmentField.hidden = departments.length === 0;
}

function setSelfSubmissionRoute({ announce = false } = {}) {
  state.submissionRoute = { mode: "self", subjectUserId: "", subjectName: "", departmentId: "", departmentName: "", socialCompanyRecognition: null };
  state.pendingOnBehalfSubject = null;
  state.relatedInstances = [];
  state.selectedRelated = [];
  state.relatedRequestSeq += 1;
  departmentSelect.disabled = false;
  companySelect.value = "";
  renderIdentity();
  applySocialCompanyRecognition({ promptOnConflict: false, notify: false });
  renderSubmissionRoute();
  loadRelatedApprovals();
  syncDraft();
  if (announce) addMessage("bot", "已切回本人报销，恢复使用当前登录人的部门和社保公司识别。");
}

function showOnBehalfDialog() {
  if (!onBehalfDialog) return;
  onBehalfStatus.textContent = "请输入员工姓名或钉钉编号后查询。";
  onBehalfResults.innerHTML = "";
  onBehalfPreview.hidden = true;
  onBehalfDialog.showModal();
  onBehalfSearchInput.focus();
}

async function searchOnBehalfEmployees() {
  const query = String(onBehalfSearchInput?.value || "").trim();
  if (!query) {
    onBehalfStatus.textContent = "请先输入员工姓名或钉钉编号。";
    return;
  }
  if (!state.sessionToken) await renewDingTalkSession({ announce: true });
  onBehalfSearchButton.disabled = true;
  onBehalfStatus.textContent = "正在读取员工名册…";
  try {
    const params = new URLSearchParams({ session_token: state.sessionToken, q: query, limit: "20" });
    const response = await fetch(`${getApiBase()}/api/dingtalk/on-behalf/search?${params}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "员工名册查询失败");
    const employees = Array.isArray(result.employees) ? result.employees : [];
    onBehalfResults.innerHTML = employees.length
      ? employees.map((employee) => `<button type="button" class="on-behalf-result" data-on-behalf-user-id="${escapeHtml(employee.userId)}"><strong>${escapeHtml(employee.name)}</strong><small>${escapeHtml(employee.userId)}</small></button>`).join("")
      : "<p>未找到匹配员工，请检查姓名或钉钉编号。</p>";
    onBehalfStatus.textContent = employees.length ? `找到 ${employees.length} 名员工，请选择一人。` : "未找到匹配员工。";
  } catch (error) {
    onBehalfStatus.textContent = `查询失败：${error.message}`;
  } finally {
    onBehalfSearchButton.disabled = false;
  }
}

async function previewOnBehalfEmployee(userId) {
  onBehalfStatus.textContent = "正在读取该员工部门和社保主体…";
  try {
    const params = new URLSearchParams({ session_token: state.sessionToken, user_id: userId });
    const response = await fetch(`${getApiBase()}/api/dingtalk/on-behalf/profile?${params}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "员工信息读取失败");
    const employee = result.employee || {};
    state.pendingOnBehalfSubject = employee;
    const departments = Array.isArray(employee.departments) ? employee.departments : [];
    const social = employee.socialCompanyRecognition || {};
    onBehalfPreviewName.textContent = `${employee.name || userId}（${userId}）`;
    onBehalfPreviewDepartment.textContent = `所属部门：${departments.map((item) => item.name).join("、") || "未读取到"}`;
    onBehalfPreviewCompany.textContent = social.status === "verified"
      ? `社保主体：${social.companyName}`
      : "社保主体：暂未识别，提交前需要人工选择并说明原因";
    onBehalfPreview.hidden = false;
    onBehalfStatus.textContent = "请确认本次报销实际归属该员工。";
  } catch (error) {
    onBehalfPreview.hidden = true;
    onBehalfStatus.textContent = `读取失败：${error.message}`;
  }
}

function confirmOnBehalfSubject() {
  const subject = state.pendingOnBehalfSubject;
  if (!subject?.userId) return;
  state.submissionRoute = {
    mode: "on_behalf",
    subjectUserId: String(subject.userId),
    subjectName: String(subject.name || subject.userId),
    departmentId: "",
    departmentName: "",
    socialCompanyRecognition: subject.socialCompanyRecognition || null,
  };
  state.relatedInstances = [];
  state.selectedRelated = [];
  state.relatedRequestSeq += 1;
  applySubjectDepartmentOptions(subject);
  const recognition = subject.socialCompanyRecognition || {};
  if (recognition.status === "verified") {
    applySelectedCompany(recognition.companyName, { source: "subject_social_security", manualOverride: false });
  } else {
    companySelect.value = "";
  }
  state.socialCompanyRecognition = state.user?.socialCompanyRecognition || null;
  renderIdentity();
  renderCompanyOptions({ applyDefault: false });
  renderSubmissionRoute();
  onBehalfDialog.close();
  loadRelatedApprovals();
  syncDraft();
  addMessage("bot", `已切换为代他人报销，归属人：${state.submissionRoute.subjectName}。部门、付款公司和关联审批将按该员工重新识别。`);
}

window.__reimbursementRoute = {
  get: () => getSubmissionRoutePayload(),
  isOnBehalf: () => isOnBehalfRoute(),
  setSelf: () => setSelfSubmissionRoute({ announce: true }),
  setEnabled: (enabled) => { state.onBehalfEnabled = Boolean(enabled); renderSubmissionRoute(); },
};

function getWorkflowRelatedSources(workflow = currentWorkflow()) {
  const keys = Array.isArray(workflow?.related?.sources) && workflow.related.sources.length
    ? workflow.related.sources
    : (workflow?.related?.processCode ? ["legacy"] : []);
  return keys.map((key) => {
    if (key === "legacy") {
      return {
        key,
        label: workflow.related.label || "关联审批",
        processCode: workflow.related.processCode,
      };
    }
    return RELATED_APPROVAL_SOURCES[key];
  }).filter(Boolean);
}

function getCurrentRelatedSource(workflow = currentWorkflow()) {
  const sources = getWorkflowRelatedSources(workflow);
  return sources.find((source) => source.key === state.relatedSourceKey) || sources[0] || null;
}

function selectedRelatedSourceKeys() {
  return new Set(state.selectedRelated.map((item) => item.sourceKey).filter(Boolean));
}

function getWorkflowDefaultReason(workflow = currentWorkflow()) {
  return workflow.targetType === "daily" ? workflow.defaultReason || "" : "";
}

function isNoInvoiceWorkflow(workflow = currentWorkflow()) {
  return Boolean(workflow?.noInvoice);
}

function isWorkflowDefaultReason(value) {
  if (!value) return true;
  return WORKFLOWS.some((workflow) => workflow.defaultReason && workflow.defaultReason === value);
}

function applyDailyRowWorkflowDefaults() {
  const workflow = currentWorkflow();
  if (workflow.targetType !== "daily") return;
  const defaultReason = getWorkflowDefaultReason(workflow);
  state.dailyRows = state.dailyRows.map((row) => ({
    ...row,
    reason: isWorkflowDefaultReason(row.reason) ? defaultReason : row.reason,
    invoiceType: isNoInvoiceWorkflow(workflow) ? "无" : row.invoiceType,
  }));
}

function placeBefore(parent, element, nextSibling) {
  if (!parent || !element) return;
  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(element, nextSibling);
  } else {
    parent.append(element);
  }
}

function placeDailyMetaControls(isDaily) {
  if (isDaily && dailyLeftMetaMount) {
    dailyLeftMetaMount.hidden = false;
    dailyLeftMetaMount.append(companyField, otherRemarkField);
    return;
  }
  if (dailyLeftMetaMount) dailyLeftMetaMount.hidden = true;
  placeBefore(companyOriginalParent, companyField, companyOriginalNextSibling);
  placeBefore(otherRemarkOriginalParent, otherRemarkField, otherRemarkOriginalNextSibling);
}

function getApiBase() {
  return location.protocol === "file:" ? productionApiOrigin : "";
}

function getQueryValue(...names) {
  const params = new URLSearchParams(location.search);
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return "";
}

function normalizeCorpId(value) {
  const corpId = String(value || "").trim();
  return /^ding[a-z0-9]+$/i.test(corpId) ? corpId : "";
}

function formatMoney(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  if (!normalized || normalized === ".") return "";
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function formatApprovalBusinessDate(businessId) {
  const match = String(businessId || "").match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function toMoneyNumber(value) {
  const formatted = formatMoney(value);
  return formatted ? Math.abs(Number(formatted)) : 0;
}

function sumMoney(values) {
  const total = values.reduce((sum, value) => sum + toMoneyNumber(value), 0);
  return total > 0 ? Number(total.toFixed(2)) : 0;
}

function amountToChinese(value) {
  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const units = ["", "拾", "佰", "仟"];
  const sections = ["", "万", "亿"];
  const cents = Math.round(Number(value || 0) * 100);
  if (!cents) return "零元整";

  function sectionToChinese(section) {
    let text = "";
    let zero = false;
    for (let i = 0; i < 4; i += 1) {
      const digit = section % 10;
      if (digit === 0) {
        if (text && !zero) {
          text = `${digits[0]}${text}`;
          zero = true;
        }
      } else {
        text = `${digits[digit]}${units[i]}${text}`;
        zero = false;
      }
      section = Math.floor(section / 10);
    }
    return text.replace(/零+$/g, "");
  }

  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor((cents % 100) / 10);
  const fen = cents % 10;
  let yuanText = "";
  let remaining = yuan;
  for (let sectionIndex = 0; remaining > 0; sectionIndex += 1) {
    const section = remaining % 10000;
    if (section) yuanText = `${sectionToChinese(section)}${sections[sectionIndex]}${yuanText}`;
    remaining = Math.floor(remaining / 10000);
  }
  const decimalText = `${jiao ? `${digits[jiao]}角` : ""}${fen ? `${digits[fen]}分` : ""}`;
  return `${yuanText || "零"}元${decimalText || "整"}`.replace(/零+/g, "零");
}

function getFileKey(file) {
  // 新选文件必须有独立客户端标识。旧的“名称+大小+修改时间”会把后续补传
  // 错当成首批附件，进而只做本地关联、不再进入上传和 OCR 链路。
  return file?.clientUploadId || `${file.name}-${file.size}-${file.lastModified}`;
}

function createClientUploadId() {
  return window.crypto?.randomUUID?.() || `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasFileExtension(file, extensions) {
  const name = String(file.name || "").toLowerCase();
  return extensions.some((extension) => name.endsWith(extension));
}

function isImageFile(file) {
  return file.type.startsWith("image/") || hasFileExtension(file, [".jpg", ".jpeg", ".png", ".webp", ".heic"]);
}

function isSupportedInvoiceFile(file) {
  return file.type === "application/pdf" || hasFileExtension(file, [".pdf"]) || isImageFile(file);
}

function isSupportedOtherFile(file) {
  return isSupportedInvoiceFile(file) || hasFileExtension(file, [".doc", ".docx", ".xls", ".xlsx"]);
}

function classifyFile(file) {
  return file.kind || "other";
}

function extractSafeAmountFromText(text, requireKeyword = false) {
  const source = String(text || "");
  const amountPattern = /(?:金额|合计|总计|小计|实付|付款|支付|收款|转账|[¥￥])?\s*(-?[0-9]{1,7}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:元)?/g;
  const matches = Array.from(source.matchAll(amountPattern))
    .filter((match) => !requireKeyword || /金额|合计|总计|小计|实付|付款|支付|收款|转账|[¥￥]|元/.test(match[0]));
  const amounts = matches
    .map((match) => Math.abs(Number(String(match[1]).replace(/[,，]/g, ""))))
    .filter((value) => Number.isFinite(value) && value > 0);
  return amounts.length ? formatMoney(Math.max(...amounts)) : "";
}

function isGeneratedFilenameAmount(file, amount) {
  const baseName = String(file?.name || "").replace(/\.[^.]+$/, "").trim();
  const matched = baseName.match(/^(?:img|image|photo|pic|screenshot|screen[_-]?shot|截图)[\s_-]*0*([0-9]{1,7})$/i);
  if (!matched || !formatMoney(amount) || Number(formatMoney(amount)) !== Number(matched[1])) return false;

  // Old drafts can contain the previous server fallback. It had no usable OCR
  // text and simply copied the technical filename number into `ocr.amount`.
  // Keep a real OCR result if it has text evidence; otherwise suppress the
  // unsafe candidate while retaining any user-confirmed manual amount.
  const rawText = String(file?.ocr?.rawText || "").trim().replace(/\.[^.]+$/, "");
  return !rawText || rawText === baseName;
}

function getRawOcrAmount(file) {
  const candidateAmounts = Array.isArray(file?.ocr?.candidateAmounts) ? file.ocr.candidateAmounts : [];
  const amount = file?.ocr?.candidateAmount || (candidateAmounts.length === 1 ? candidateAmounts[0] : "") || file?.ocr?.amount || file?.ocr?.data?.totalAmount || file?.ocr?.data?.amount || file?.detectedAmount || "";
  return isGeneratedFilenameAmount(file, amount) ? "" : amount;
}

function getOcrCandidateAmounts(file) {
  const values = Array.isArray(file?.ocr?.candidateAmounts)
    ? file.ocr.candidateAmounts
    : (file?.ocr?.candidateAmount ? [file.ocr.candidateAmount] : []);
  const normalized = Array.from(new Set(values.map(formatMoney).filter(Boolean)));
  if (normalized.length) return normalized;
  const risk = file?.ocr?.decision && file.ocr.decision !== "included";
  const fallback = risk ? getRawOcrAmount(file) : "";
  return fallback ? [formatMoney(fallback)] : [];
}

function getOcrCandidateLabel(file) {
  const values = getOcrCandidateAmounts(file);
  return values.length ? values.map((value) => `¥${formatMoney(value)}`).join("、") : "";
}

function getManualOcrAmount(file) {
  return formatMoney(file?.manualAmount) || "";
}

function getOcrAmount(file) {
  if (file?.possibleDuplicateOfFileId && file?.duplicateDecision !== "different") return "";
  const manuallyConfirmed = getManualOcrAmount(file);
  const role = String(file?.ocr?.documentRole || "");
  const kind = classifyFile(file);
  if (manuallyConfirmed) {
    if (kind === "payment" && !["tax_invoice", "supporting_document"].includes(role)) return manuallyConfirmed;
    if (kind === "invoice" && (!role || ["tax_invoice", "title_exempt_transport_receipt"].includes(role))) return manuallyConfirmed;
    return "";
  }
  if (kind === "invoice" && role && !["tax_invoice", "title_exempt_transport_receipt"].includes(role)) return "";
  if (kind === "payment" && role && role !== "payment") return "";
  if (file?.ocr?.decision && file.ocr.decision !== "included") return "";
  return file?.ocr?.countableAmount || getRawOcrAmount(file);
}

function getOcrRiskLabel(file) {
  if (file?.titleValidation?.quarantined) return "发票抬头待补充，不计入本次报销";
  if (file?.ocr?.documentRole === "title_exempt_transport_receipt") return "免抬头交通票据，已计入票据金额";
  if (file?.ocr?.documentRole === "supporting_document") return "佐证材料，不计入发票金额";
  if (classifyFile(file) === "invoice" && file?.ocr?.documentRole === "unknown") return "未确认是税务发票，不计入发票金额";
  if (file?.ocr?.decision === "manual") return "需人工核对";
  if (file?.ocr?.decision === "excluded") return "默认不计入合计";
  return "";
}

function getAssignmentOcrLabel(file) {
  if (file.uploadError) return "上传失败";
  if (file.uploading) return "OCR 识别中";
  if (file.ocrQueueing) return "等待识别";
  if (!file.dingtalkAttachment) return state.sessionToken ? "等待上传" : "待登录上传";
  if (file.ocr?.enabled === false) return "OCR 识别失败";
  const amount = getRawOcrAmount(file);
  const candidateLabel = getOcrCandidateLabel(file);
  const risk = getOcrRiskLabel(file);
  const roleLabels = {
    payment: "付款凭证",
    tax_invoice: "税务发票",
    title_exempt_transport_receipt: "免抬头交通票据",
    supporting_document: "行程单/佐证材料",
    unknown: "类型待确认",
  };
  const role = roleLabels[file?.ocr?.documentRole] || "";
  const prefix = role ? `${role} · ` : "";
  if (risk) return candidateLabel ? `${prefix}候选金额 ${candidateLabel} · ${risk}` : (amount ? `${prefix}识别 ¥${formatMoney(amount)} · ${risk}` : `${prefix}${risk}`);
  return amount ? `${prefix}识别 ¥${formatMoney(amount)}` : `${prefix}未识别到金额`;
}

function getPendingOcrFiles(files = state.files) {
  return files.filter((file) => !file?.titleValidation?.quarantined && (file.uploading || file.ocrQueueing || (!file.dingtalkAttachment && !file.uploadError && state.sessionToken)));
}

function getFailedOcrFiles(files = state.files) {
  return files.filter((file) => !file?.titleValidation?.quarantined && file.dingtalkAttachment && file.ocr?.enabled === false);
}

function getAttachmentAmountTotal(keys = []) {
  return sumMoney(keys.map((key) => getOcrAmount(getFileByKey(key))));
}

function getAssignmentTotals(row) {
  return {
    payment: getAttachmentAmountTotal(row.paymentFileKeys || []),
    invoice: getAttachmentAmountTotal(row.invoiceFileKeys || []),
  };
}

function syncAssignedRowAmountsFromPayments() {
  const workflow = currentWorkflow();
  const rows = workflow.targetType === "travel" ? state.travelRows : state.dailyRows;
  let changed = 0;

  rows.forEach((row) => {
    const paymentTotal = toMoneyNumber(getAssignmentTotals(row).payment);
    const currentTotal = toMoneyNumber(row.amount);
    const paymentAmount = paymentTotal ? formatMoney(paymentTotal) : "";
    const currentAmount = currentTotal ? formatMoney(currentTotal) : "";
    const canUpdate = !currentAmount || row.amountAutoFilled;

    // Never replace an amount the applicant typed or imported. Rows that were
    // previously filled by the system stay synchronized when attachments change.
    if (!canUpdate) return;
    if (currentAmount === paymentAmount) return;

    row.amount = paymentAmount;
    row.amountAutoFilled = Boolean(paymentAmount);
    changed += 1;
  });
  return changed;
}

function getFilesByKeys(keys = []) {
  const wanted = new Set(keys);
  return state.files.filter((file) => wanted.has(getFileKey(file)));
}

function getOcrText(file) {
  return [
    file?.ocr?.rawText,
    file?.ocr?.recipientName,
    file?.ocr?.sellerName,
    file?.ocr?.buyerName,
    file?.name,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function normalizeOcrDate(value = "") {
  const match = String(value).match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function getOcrDateFromFiles(files = [], { paymentFirst = true } = {}) {
  const labelPattern = paymentFirst
    ? /(?:支付时间|付款时间|交易时间|支付日期|付款日期)[：:\s]*([^\n]{0,32})/i
    : /(?:开票日期|出票日期|日期)[：:\s]*([^\n]{0,32})/i;
  const dates = [...new Set(files
    .map((file) => normalizeOcrDate(getOcrText(file).match(labelPattern)?.[1] || ""))
    .filter(Boolean))];
  if (dates.length === 1) return dates[0];
  if (dates.length > 1) return "";
  const fallbackDates = [...new Set(files.map((file) => normalizeOcrDate(getOcrText(file))).filter(Boolean))];
  return fallbackDates.length === 1 ? fallbackDates[0] : "";
}

function getOcrExpenseCategory(files = []) {
  const text = files.map(getOcrText).join(" ").toLowerCase();
  const rules = [
    { key: "taxi", type: "报销/打车", reason: "打车费", pattern: /高德|滴滴|曹操|t3|出租车|网约车|打车|快车|专车/ },
    { key: "rail", type: "报销/差旅", reason: "车票费用", pattern: /12306|铁路|高铁|动车|火车|列车|车票/ },
    { key: "flight", type: "报销/差旅", reason: "机票费用", pattern: /机票|航班|航空|air\s*china|china\s*eastern|china\s*southern/ },
    { key: "hotel", type: "报销/差旅", reason: "住宿费", pattern: /酒店|宾馆|住宿|hotel|inn/ },
    { key: "meal", type: "报销/餐饮", reason: "餐饮费", pattern: /餐饮|餐厅|美食|饭店|外卖|咖啡|奶茶/ },
    { key: "office", type: "报销/办公", reason: "办公用品费", pattern: /办公|文具|耗材|打印|复印|纸张/ },
    { key: "express", type: "报销/其他", reason: "快递费", pattern: /快递|物流|顺丰|中通|圆通|申通|韵达|京东物流/ },
  ];
  const matched = rules.find((rule) => rule.pattern.test(text));
  return matched || { key: "other", type: "报销/其他", reason: "其他费用", pattern: null, confidence: "review" };
}

function getOcrInvoiceType(files = []) {
  const text = files.map(getOcrText).join(" ");
  if (!text) return "";
  const electronic = /数电|全面数字化|电子(?:发票)?/.test(text);
  const special = /专用发票|专票/.test(text);
  const ordinary = /普通发票|普票/.test(text);
  if (special) return electronic ? "电子-专票" : "纸质-专票";
  if (ordinary) return electronic ? "电子-普票" : "纸质-普通";
  return "";
}

function getOcrMerchant(files = []) {
  const values = [...new Set(files
    .map((file) => String(file?.ocr?.recipientName || file?.ocr?.sellerName || "").trim())
    .filter(Boolean))];
  return values.length === 1 ? values[0] : "";
}

function getOcrSuggestionConfidence({ paymentFiles = [], category, businessDate, invoiceType }) {
  const hasConfirmedPayment = paymentFiles.some((file) => getOcrAmount(file));
  if (hasConfirmedPayment && category?.key !== "other" && businessDate) return "high";
  if (hasConfirmedPayment && category?.key !== "other") return "medium";
  if (invoiceType) return "medium";
  return "review";
}

function buildOcrSuggestion({ row, rowKind, paymentKeys = [], invoiceKeys = [], splitIndex = 0 }) {
  const paymentFiles = getFilesByKeys(paymentKeys);
  const invoiceFiles = getFilesByKeys(invoiceKeys);
  const allFiles = [...paymentFiles, ...invoiceFiles];
  const category = getOcrExpenseCategory(paymentFiles.length ? paymentFiles : allFiles);
  const paymentDate = getOcrDateFromFiles(paymentFiles, { paymentFirst: true });
  const invoiceDate = getOcrDateFromFiles(invoiceFiles, { paymentFirst: false });
  const businessDate = paymentDate || invoiceDate;
  const merchant = getOcrMerchant(paymentFiles) || getOcrMerchant(invoiceFiles);
  const amount = formatMoney(sumMoney(paymentFiles.map(getOcrAmount).filter(Boolean)));
  const invoiceType = getOcrInvoiceType(invoiceFiles);
  const confidence = getOcrSuggestionConfidence({ paymentFiles, category, businessDate, invoiceType });
  const reason = merchant ? `${merchant}${category.reason}` : category.reason;
  return {
    id: `${rowKind}:${row.id}:${splitIndex}:${category.key}`,
    rowId: row.id,
    rowKind,
    paymentKeys,
    invoiceKeys,
    category,
    amount,
    businessDate,
    invoiceType,
    reason,
    confidence,
    relatedInstanceId: row.relatedInstanceId || "",
    relatedBusinessId: row.relatedBusinessId || "",
    splitIndex,
    files: allFiles.map((file) => file.name),
    fileKeys: allFiles.map((file) => getFileKey(file)),
    sources: {
      amount: paymentFiles.length ? "付款凭证实付金额" : "未识别到可用付款金额",
      businessDate: paymentDate ? "付款时间" : (invoiceDate ? "开票日期兜底" : "未识别到唯一日期"),
      category: category.key === "other" ? "未能确认费用类别，需人工核对" : "付款凭证/发票内容识别",
      invoiceType: invoiceType ? "税务发票抬头识别" : "未识别到明确发票类型",
    },
  };
}

function getTravelRowOcrSuggestions(row) {
  const paymentFiles = getFilesByKeys(row.paymentFileKeys || []);
  const invoiceFiles = getFilesByKeys(row.invoiceFileKeys || []);
  if (!paymentFiles.length && !invoiceFiles.length) return [];
  const buckets = new Map();
  const ensureBucket = (category) => {
    if (!buckets.has(category.key)) buckets.set(category.key, { category, paymentKeys: [], invoiceKeys: [] });
    return buckets.get(category.key);
  };
  paymentFiles.forEach((file) => {
    const category = getOcrExpenseCategory([file]);
    ensureBucket(category).paymentKeys.push(getFileKey(file));
  });
  invoiceFiles.forEach((file) => {
    const category = getOcrExpenseCategory([file]);
    const bucket = buckets.get(category.key) || (buckets.size === 1 ? [...buckets.values()][0] : ensureBucket(category));
    bucket.invoiceKeys.push(getFileKey(file));
  });
  return [...buckets.values()].map((bucket, index) => buildOcrSuggestion({
    row,
    rowKind: "travel",
    paymentKeys: bucket.paymentKeys,
    invoiceKeys: bucket.invoiceKeys,
    splitIndex: index,
  }));
}

function getOcrDetailSuggestions() {
  const workflow = currentWorkflow();
  if (workflow.targetType === "travel") {
    return state.travelRows.flatMap(getTravelRowOcrSuggestions);
  }
  if (workflow.targetType === "daily") {
    return state.dailyRows
      .filter((row) => (row.paymentFileKeys || []).length || (row.invoiceFileKeys || []).length)
      .map((row) => buildOcrSuggestion({
        row,
        rowKind: "daily",
        paymentKeys: row.paymentFileKeys || [],
        invoiceKeys: row.invoiceFileKeys || [],
      }));
  }
  return [];
}

function renderOcrSuggestionDialog() {
  const suggestions = getOcrDetailSuggestions();
  const highCount = suggestions.filter((item) => item.confidence === "high").length;
  const travelSplitCount = currentWorkflow().targetType === "travel"
    ? suggestions.filter((item) => item.splitIndex > 0).length
    : 0;
  state.ocrSuggestionItems = suggestions;
  ocrSuggestionSummary.textContent = `已根据已分配附件生成 ${suggestions.length} 条明细建议，其中 ${highCount} 条为高置信建议。采纳后仍可逐行修改。`;
  ocrSuggestionNotice.textContent = travelSplitCount
    ? `本次差旅识别到 ${travelSplitCount} 条不同费用类别，采纳后会在对应出差审批下自动拆分明细；每条明细只保留一个明确费用类别。`
    : "金额优先采用付款成功记录；费用发生日期优先采用付款时间，无法识别时才以开票日期兜底。";
  ocrSuggestionList.innerHTML = suggestions.map((item, index) => {
    const review = item.confidence !== "high";
    const label = item.rowKind === "travel"
      ? `差旅明细 ${index + 1}${item.relatedBusinessId ? ` · ${item.relatedBusinessId}` : ""}`
      : `费用明细 ${index + 1}`;
    const fields = [
      ["金额", item.amount ? `${item.amount} 元` : "待人工确认", item.sources.amount],
      ["费用发生日期", item.businessDate || "待人工确认", item.sources.businessDate],
      [item.rowKind === "travel" ? "费用类型" : "申请事由", item.rowKind === "travel" ? item.category.type : "需人工填写", item.rowKind === "travel" ? item.sources.category : "已关闭自动回填，请人工填写"],
      ["发票类型", item.invoiceType || "待人工确认", item.sources.invoiceType],
    ];
    const cardDescription = item.rowKind === "travel"
      ? (item.category.type || "费用类型待核对")
      : "申请事由需人工填写";
    return `<article class="ocr-suggestion-card ${review ? "is-review" : ""}">
      <header><div><h3>${escapeHtml(label)}</h3><p>${escapeHtml(cardDescription)}</p></div><span class="ocr-confidence ${review ? "review" : ""}">${review ? "需核对" : "高置信"}</span></header>
      <dl class="ocr-suggestion-fields">${fields.map(([term, value, source]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd><small>${escapeHtml(source)}</small></div>`).join("")}</dl>
      <div class="ocr-suggestion-files"><b>对应附件：</b>${item.fileKeys?.length
        ? item.fileKeys.map((key, fileIndex) => {
          const file = getFileByKey(key);
          return file
            ? `<button type="button" class="ocr-suggestion-file-preview" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(file.name || item.files[fileIndex] || "附件")}</button>`
            : escapeHtml(item.files[fileIndex] || "附件");
        }).join("、")
        : escapeHtml(item.files.join("、") || "无")}</div>
    </article>`;
  }).join("") || `<p class="assignment-empty">暂无已完成分配且可生成建议的附件。</p>`;
  ocrSuggestionStatus.textContent = suggestions.length
    ? "采纳只填写金额、日期、费用类型和发票类型等可确认字段；申请事由/费用说明必须人工填写。不会覆盖手工填写内容。"
    : "请先将付款截图和发票附件分配到费用明细后再试。";
  applyOcrSuggestionsButton.disabled = !suggestions.length;
}

function openOcrSuggestionDialog() {
  renderOcrSuggestionDialog();
  if (state.ocrSuggestionItems?.length && !ocrSuggestionDialog.open) ocrSuggestionDialog.showModal();
}

function snapshotOcrSuggestionState() {
  return JSON.parse(JSON.stringify({
    workflowId: state.workflowId,
    dailyRows: state.dailyRows,
    travelRows: state.travelRows,
    amount: amountInput.value,
  }));
}

function applyOcrSuggestionFields(row, item, { force = false } = {}) {
  const fields = item.rowKind === "travel"
    ? { amount: item.amount, businessDate: item.businessDate, expenseType: item.category.type }
    : { amount: item.amount, businessDate: item.businessDate, invoiceType: item.invoiceType };
  const autoFields = new Set(row.ocrAutoFields || []);
  Object.entries(fields).forEach(([field, value]) => {
    if (!value) return;
    if (force || !row[field] || autoFields.has(field)) {
      row[field] = value;
      autoFields.add(field);
    }
  });
  row.ocrAutoFields = [...autoFields];
  row.ocrSuggestionBatchId = state.ocrSuggestionBatchId;
}

function applyOcrDetailSuggestions() {
  const suggestions = state.ocrSuggestionItems || getOcrDetailSuggestions();
  if (!suggestions.length) return;
  readDailyRowsFromDom();
  readTravelRowsFromDom();
  state.ocrSuggestionRollback = snapshotOcrSuggestionState();
  state.ocrSuggestionBatchId = `ocr-${Date.now()}`;
  if (currentWorkflow().targetType === "daily") {
    suggestions.forEach((item) => {
      const row = state.dailyRows.find((candidate) => candidate.id === item.rowId);
      if (row) applyOcrSuggestionFields(row, item);
    });
  } else if (currentWorkflow().targetType === "travel") {
    const nextRows = [];
    state.travelRows.forEach((row) => {
      const rowSuggestions = suggestions.filter((item) => item.rowId === row.id);
      if (!rowSuggestions.length) {
        nextRows.push(row);
        return;
      }
      rowSuggestions.forEach((item, index) => {
        const target = index === 0
          ? row
          : createTravelRow({
            ...row,
            id: undefined,
            paymentFileKeys: [],
            invoiceFileKeys: [],
            autoGeneratedFromRelated: false,
            manualSplit: true,
          });
        target.paymentFileKeys = item.paymentKeys;
        target.invoiceFileKeys = item.invoiceKeys;
        applyOcrSuggestionFields(target, item, { force: index > 0 });
        nextRows.push(target);
      });
    });
    state.travelRows = nextRows;
  }
  syncRelatedDrivenRows();
  syncAssignedRowAmountsFromPayments();
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncTravelTotal();
  rollbackOcrSuggestionsButton.hidden = false;
  syncDraft();
  ocrSuggestionDialog.close();
  window.setTimeout(() => {
    const focusV2Reason = window.__reimbursementV2FocusManualReason;
    if (typeof focusV2Reason === "function") {
      focusV2Reason();
      return;
    }
    window.__reimbursementFocusManualReason?.();
  }, 0);
}

function focusFirstEmptyReasonField({ scroll = true } = {}) {
  const fields = [...document.querySelectorAll('[data-field="reason"]')];
  const visibleFields = fields.filter((field) => field.getClientRects().length > 0);
  const candidates = visibleFields.length ? visibleFields : fields;
  const target = candidates.find((field) => !String(field.value || "").trim());
  if (!target) return false;
  if (scroll) target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("needs-manual-reason");
  const clearHighlight = () => target.classList.remove("needs-manual-reason");
  target.addEventListener("input", clearHighlight, { once: true });
  window.setTimeout(() => {
    target.focus();
    if (typeof target.select === "function") target.select();
  }, scroll ? 220 : 0);
  return true;
}

window.__reimbursementFocusManualReason = focusFirstEmptyReasonField;

function rollbackOcrDetailSuggestions() {
  const snapshot = state.ocrSuggestionRollback;
  if (!snapshot || snapshot.workflowId !== state.workflowId) return;
  state.dailyRows = (snapshot.dailyRows || []).map((row) => createDailyRow(row));
  state.travelRows = (snapshot.travelRows || []).map((row) => createTravelRow(row));
  amountInput.value = snapshot.amount || "";
  state.ocrSuggestionRollback = null;
  state.ocrSuggestionBatchId = "";
  rollbackOcrSuggestionsButton.hidden = true;
  syncRelatedDrivenRows();
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncTravelTotal();
  syncDraft();
}

function getPaymentFilesNeedingAttention(files) {
  return files.filter((file) => file.ocr?.decision !== "included" || !getRawOcrAmount(file));
}

function formatFileNames(files, limit = 4) {
  const names = files.map((file) => file.name).filter(Boolean);
  if (!names.length) return "";
  const visible = names.slice(0, limit).join("、");
  return names.length > limit ? `${visible} 等 ${names.length} 张` : visible;
}

function renderAssignmentTotals(row, layer) {
  const totals = getAssignmentTotals(row);
  const amount = formatMoney(row.amount) || "";
  return `
    <div class="assignment-totals">
      <span>付款截图合计 <b>¥${escapeHtml(formatMoney(totals.payment) || "0.00")}</b></span>
      <span>发票合计 <b>¥${escapeHtml(formatMoney(totals.invoice) || "0.00")}</b></span>
      <label class="assignment-row-amount">明细金额<input type="text" inputmode="decimal" value="${escapeHtml(amount)}" placeholder="可手动填写" data-assignment-row-amount data-assignment-layer="${escapeHtml(layer)}" data-target-id="${escapeHtml(row.id)}" /></label>
      <button type="button" class="assignment-fill-button" data-assignment-action="fill-payment-total" data-assignment-layer="${escapeHtml(layer)}" data-target-id="${escapeHtml(row.id)}" ${totals.payment ? "" : "disabled"}>填入付款合计</button>
    </div>
  `;
}

function getOcrStatusLabel(file) {
  if (!file.ocr?.enabled) return file.ocr?.reason ? `OCR：${file.ocr.reason}` : "OCR待接入";
  const roleLabels = {
    payment: "付款凭证",
    tax_invoice: "税务发票",
    title_exempt_transport_receipt: "免抬头交通票据（计金额）",
    supporting_document: "行程单/佐证材料（不计金额）",
    unknown: "类型待确认（不自动计金额）",
  };
  const sceneLabels = {
    transaction_list: "多笔交易列表",
    wechat_transfer: "微信转账",
    laundry_receipt: "洗衣小票",
    refund_payment: "退款后净额",
    payment_record: "付款记录",
    pinduoduo_order: "拼多多订单",
    jd_order: "京东订单",
  };
  const decisionLabels = {
    included: "已计入付款合计",
    manual: "待人工核对，不计入合计",
    excluded: "不计入付款合计",
  };
  const scene = sceneLabels[file.ocr.scene] || "";
  const decision = decisionLabels[file.ocr.decision] || "";
  const role = roleLabels[file.ocr.documentRole] || "";
  const evidence = file.ocr.evidence ? `：${file.ocr.evidence}` : "";
  const warning = Array.isArray(file.ocr.warnings) && file.ocr.warnings.length ? `；提示：${file.ocr.warnings.join("；")}` : "";
  if (role || scene || decision || warning) return `OCR已识别（${[role, scene, decision].filter(Boolean).join("；")}${evidence}${warning}）`;
  return "OCR已识别";
}

function getDetectedAmountTotal(type) {
  return sumMoney(getFilesByType(type).map(getOcrAmount).filter(Boolean));
}

function getUploadProgress() {
  const files = state.files;
  const total = files.length;
  const failed = files.filter((file) => file.uploadError).length;
  const completed = files.filter((file) => file.dingtalkAttachment || file.uploadError).length;
  const pending = files.filter((file) => file.uploading || (!file.dingtalkAttachment && !file.uploadError && state.sessionToken)).length;
  return { total, completed, pending, failed };
}

function renderDetectedSummary({ amounts, total, totalEl, listEl }) {
  if (!totalEl || !listEl) return;
  if (!amounts.length) {
    totalEl.textContent = "待 OCR";
    listEl.textContent = "暂无识别明细";
    listEl.classList.add("is-empty");
    return;
  }

  totalEl.textContent = formatMoney(total);
  listEl.classList.remove("is-empty");
  listEl.innerHTML = amounts
    .map((amount, index) => `<span>${index + 1}. ${escapeHtml(formatMoney(amount) || amount)}</span>`)
    .join("");
}

function renderUploadProgress(progress) {
  if (!uploadProgressBox) return;
  if (!progress.total) {
    uploadProgressBox.hidden = true;
    return;
  }

  uploadProgressBox.hidden = false;
  uploadProgressBox.classList.toggle("is-waiting", progress.pending > 0);
  uploadProgressBox.classList.toggle("has-error", progress.pending === 0 && progress.failed > 0);
  if (progress.pending > 0) {
    uploadProgressTitle.textContent = `正在逐个识别附件 ${progress.completed}/${progress.total}`;
    uploadProgressText.textContent = "多张照片会按队列上传并调用 OCR。请等待全部识别完成后再提交，避免金额还未回填。";
    return;
  }

  uploadProgressTitle.textContent = progress.failed ? "附件处理完成，有失败项" : "附件识别已完成";
  uploadProgressText.textContent = progress.failed
    ? `有 ${progress.failed} 个附件未成功上传或识别，请删除失败项后重新上传。`
    : "所有附件已完成上传和 OCR 识别，可以继续核对金额并提交。";
}

function renderAmountCheck({ amountValue, dailyTotal, paymentTotal, invoiceTotal }) {
  if (!amountCheckBox) return;
  const enteredAmount = toMoneyNumber(amountValue);
  const rowTotal = Number(dailyTotal || 0);
  const paymentDiff = paymentTotal > 0 && enteredAmount > 0 ? enteredAmount - paymentTotal : 0;
  const rowDiff = rowTotal > 0 && enteredAmount > 0 ? enteredAmount - rowTotal : 0;
  const hasPaymentShortfall = paymentTotal > 0 && enteredAmount > 0 && paymentDiff > AMOUNT_TOLERANCE;
  const hasPaymentExcess = paymentTotal > 0 && enteredAmount > 0 && paymentDiff < -AMOUNT_TOLERANCE;
  const hasRowMismatch = rowTotal > 0 && enteredAmount > 0 && Math.abs(rowDiff) > AMOUNT_TOLERANCE;

  amountCheckBox.classList.toggle("warn", hasPaymentShortfall || hasPaymentExcess || hasRowMismatch);
  amountCheckBox.classList.toggle("ok", enteredAmount > 0 && !hasPaymentShortfall && !hasPaymentExcess && !hasRowMismatch);

  if (!enteredAmount) {
    amountCheckTitle.textContent = "总报销金额待填写";
    amountCheckText.textContent = "请填写本次实际要报销的总金额，系统会和付款截图识别总额、明细合计自动比对。";
    return;
  }

  if (hasPaymentShortfall) {
    amountCheckTitle.textContent = "总报销金额与付款截图不一致";
    amountCheckText.textContent = `当前申报 ${formatMoney(enteredAmount)} 元，付款截图合计 ${formatMoney(paymentTotal)} 元，仍缺少 ${formatMoney(paymentDiff)} 元付款凭证。请补充付款截图，或将申报金额修正为实际支付金额。`;
    return;
  }

  if (hasRowMismatch) {
    amountCheckTitle.textContent = "总报销金额与明细合计不一致";
    amountCheckText.textContent = `当前填写 ${formatMoney(enteredAmount)} 元，明细合计 ${formatMoney(rowTotal)} 元，差额 ${formatMoney(Math.abs(rowDiff))} 元。请检查费用明细是否漏填或多填。`;
    return;
  }

  if (hasPaymentExcess) {
    amountCheckTitle.textContent = "付款金额高于报销金额（可以提交）";
    amountCheckText.textContent = `当前申报 ${formatMoney(enteredAmount)} 元，付款截图合计 ${formatMoney(paymentTotal)} 元，多付 ${formatMoney(Math.abs(paymentDiff))} 元。系统只按申报金额报销，本项仅作提醒，不会拦截提交。`;
    return;
  }

  amountCheckTitle.textContent = "金额校验通过";
  amountCheckText.textContent = `总报销金额 ${formatMoney(enteredAmount)} 元${paymentTotal > 0 ? `，付款凭证识别总额 ${formatMoney(paymentTotal)} 元` : ""}${invoiceTotal > 0 ? `，税务发票识别总额 ${formatMoney(invoiceTotal)} 元` : ""}。发票覆盖按每条费用明细单独校验。`;
}

function getRiskLevel(errors, warnings) {
  if (errors.length) return "high";
  if (warnings.length) return "medium";
  return "low";
}

function getRiskLevelLabel(level) {
  return { high: "高风险", medium: "中风险", low: "低风险" }[level] || "未知风险";
}

function buildAuditReport(data, amount, workflow) {
  const noInvoice = isNoInvoiceWorkflow(workflow);
  const paymentFiles = getFilesByType("payment");
  const invoiceFiles = noInvoice ? [] : getFilesByType("invoice");
  const paymentTotal = getDetectedAmountTotal("payment");
  const invoiceTotal = noInvoice ? 0 : getDetectedAmountTotal("invoice");
  const enteredAmount = toMoneyNumber(amount);
  const dailyTotal = workflow?.targetType === "daily" ? getDailyRowsTotal() : 0;
  const travelTotal = workflow?.targetType === "travel" ? getTravelRowsTotal() : 0;
  const errors = [];
  const warnings = [];
  const notes = [];
  const manualPaymentFiles = paymentFiles.filter((file) => file.ocr?.decision === "manual" && !getManualOcrAmount(file));
  const excludedPaymentFiles = paymentFiles.filter((file) => file.ocr?.decision === "excluded" && !getManualOcrAmount(file));
  const confirmedRiskFiles = paymentFiles.filter((file) => file.ocr?.decision !== "included" && getManualOcrAmount(file));
  const includedPaymentFiles = paymentFiles.filter((file) => getOcrAmount(file));
  const paymentFilesNeedingAttention = getPaymentFilesNeedingAttention(paymentFiles);

  if (manualPaymentFiles.length) {
    const names = formatFileNames(manualPaymentFiles);
    errors.push(`有 ${manualPaymentFiles.length} 张付款截图需要人工核对${names ? `：${names}` : ""}。请在“分配报销附件”中确认每张截图的金额，或补充支付成功凭证。`);
  }
  if (paymentFiles.length && !includedPaymentFiles.length && !manualPaymentFiles.length) {
    errors.push("未发现可计入的付款成功凭证，请上传支付成功记录。消费小票或待付款截图不能作为付款凭证。");
  }
  if (excludedPaymentFiles.length) {
    warnings.push(`${excludedPaymentFiles.length} 张附件默认未计入付款合计，请确认是否为有效付款凭证。`);
  }
  if (confirmedRiskFiles.length) {
    notes.push(`${confirmedRiskFiles.length} 张风险附件已由申请人手动确认金额`);
  }

  if (dailyTotal > 0) {
    notes.push(`费用明细合计 ${formatMoney(dailyTotal)} 元`);
    if (enteredAmount > 0 && Math.abs(enteredAmount - dailyTotal) > AMOUNT_TOLERANCE) {
      errors.push(`总报销金额需要和费用明细合计一致：当前填写 ${formatMoney(enteredAmount)} 元，明细合计 ${formatMoney(dailyTotal)} 元。`);
    }
  }

  if (travelTotal > 0) {
    notes.push(`差旅明细合计 ${formatMoney(travelTotal)} 元`);
    if (enteredAmount > 0 && Math.abs(enteredAmount - travelTotal) > AMOUNT_TOLERANCE) {
      errors.push(`总报销金额需要和差旅明细合计一致：当前填写 ${formatMoney(enteredAmount)} 元，差旅明细合计 ${formatMoney(travelTotal)} 元。`);
    }
  }

  if (paymentTotal > 0) {
    notes.push(`付款截图识别总额 ${formatMoney(paymentTotal)} 元`);
    if (enteredAmount > 0 && enteredAmount - paymentTotal > AMOUNT_TOLERANCE) {
      const direction = "付款截图金额偏低，可能有截图漏传或待确认";
      const attention = paymentTotal < enteredAmount && invoiceTotal > paymentTotal
        ? formatFileNames(paymentFilesNeedingAttention)
        : "";
      errors.push(`报销金额应以付款截图为准：当前填写 ${formatMoney(enteredAmount)} 元，付款截图确认总额 ${formatMoney(paymentTotal)} 元。${direction}${attention ? `，请优先核对：${attention}` : ""}。`);
    } else if (enteredAmount > 0 && paymentTotal - enteredAmount > AMOUNT_TOLERANCE) {
      warnings.push(`付款截图合计 ${formatMoney(paymentTotal)} 元，高于申报金额 ${formatMoney(enteredAmount)} 元，多付 ${formatMoney(paymentTotal - enteredAmount)} 元。系统只按申报金额报销，可继续提交。`);
    }
  } else if (paymentFiles.length) {
    warnings.push("付款截图暂未识别到金额，系统无法自动完成付款金额校验。");
  }

  const assignedRows = workflow?.targetType === "travel" ? state.travelRows : state.dailyRows;
  assignedRows.forEach((row, index) => {
    const rowNumber = index + 1;
    const requiresInvoice = !noInvoice && (workflow?.targetType === "travel" || row.invoiceType !== "无");
    if (!requiresInvoice) return;
    const totals = getAssignmentTotals(row);
    const rowPaymentTotal = Number(totals.payment || 0);
    const rowInvoiceTotal = Number(totals.invoice || 0);
    const label = `第 ${rowNumber} 行${row.reason ? `“${row.reason}”` : ""}`;
    const rowDeclaredAmount = Number(row.amount || 0);
    if (rowPaymentTotal > 0 && rowDeclaredAmount - rowPaymentTotal > AMOUNT_TOLERANCE) {
      errors.push(`${label}申报 ${formatMoney(rowDeclaredAmount)} 元，但付款凭证合计 ${formatMoney(rowPaymentTotal)} 元，仍缺少 ${formatMoney(rowDeclaredAmount - rowPaymentTotal)} 元付款凭证。`);
    } else if (rowPaymentTotal - rowDeclaredAmount > AMOUNT_TOLERANCE) {
      warnings.push(`${label}付款凭证比申报金额多 ${formatMoney(rowPaymentTotal - rowDeclaredAmount)} 元，只按申报金额报销。`);
    }
    if (requiresInvoice && rowDeclaredAmount - rowInvoiceTotal > AMOUNT_TOLERANCE) {
      errors.push(
        `${label}税务发票合计 ${formatMoney(rowInvoiceTotal) || "0.00"} 元，小于申报金额 ${formatMoney(rowDeclaredAmount)} 元，缺少 ${formatMoney(rowDeclaredAmount - rowInvoiceTotal)} 元。行程单和其他佐证材料不计入发票金额。`,
      );
    } else if (rowDeclaredAmount > 0 && rowInvoiceTotal - rowDeclaredAmount > AMOUNT_TOLERANCE) {
      notes.push(`${label}发票金额高于申报金额，按实际申报金额报销`);
    }
  });

  if (invoiceTotal > 0) {
    notes.push(`税务发票识别总额 ${formatMoney(invoiceTotal)} 元`);
  } else if (invoiceFiles.length && data.invoiceType !== "无") {
    warnings.push("发票附件中暂未识别到可计入金额的税务发票；行程单和其他佐证材料不会计入发票金额。");
  }

  const riskLevel = getRiskLevel(errors, warnings);

  return {
    paymentTotal,
    invoiceTotal,
    riskLevel,
    riskLabel: getRiskLevelLabel(riskLevel),
    errors,
    warnings,
    notes,
    summary: [`风险等级：${getRiskLevelLabel(riskLevel)}`, ...notes, ...warnings.map((item) => `风险提示：${item}`)].join("；"),
  };
}

async function detectAmount(file) {
  const baseName = file.name.replace(/\.[^.]+$/, "");
  if (classifyFile(file) !== "payment") {
    const explicit = extractSafeAmountFromText(baseName, true);
    if (explicit) return explicit;
  }
  if (file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".txt")) {
    try {
      return extractSafeAmountFromText(await file.text(), true);
    } catch {
      return "";
    }
  }
  return "";
}

function addMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.innerHTML = `
    <div class="avatar">${role === "bot" ? "AI" : "我"}</div>
    <div class="bubble">${text}</div>
  `;
  conversation.append(message);
  conversation.scrollTop = conversation.scrollHeight;
}

function showDailyImportNotice(message) {
  state.dailyImportNotice = String(message || "");
  if (!dailyDetailHint || currentWorkflow().targetType !== "daily") return;
  dailyDetailHint.textContent = state.dailyImportNotice;
  dailyDetailHint.hidden = false;
}

function createApiError(message, status = 0) {
  const error = new Error(message);
  error.status = Number(status) || 0;
  return error;
}

function isExpiredDingTalkSessionError(error) {
  return Number(error?.status) === 401 || /(?:missing|expired)\s+dingtalk\s+session|钉钉.*(?:会话|登录).*(?:失效|过期)|会话.*(?:失效|过期)/i.test(String(error?.message || ""));
}

function setOptions(select, options, { placeholder = "请选择" } = {}) {
  select.innerHTML = "";
  if (placeholder) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.append(empty);
  }
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    select.append(option);
  });
}

function normalizeCompanyName(value) {
  return String(value || "")
    .trim()
    .replace(/有限责任公司$/u, "有限公司")
    .replace(/[\s　()（）\[\]【】,，.。·—_-]/gu, "");
}

function getSocialCompanyRecognition() {
  return isOnBehalfRoute()
    ? state.submissionRoute?.socialCompanyRecognition || null
    : state.socialCompanyRecognition || state.user?.socialCompanyRecognition || null;
}

function isVerifiedSocialCompanyRecognition(recognition = getSocialCompanyRecognition()) {
  return recognition?.status === "verified" && COMPANY_OPTIONS.includes(recognition.companyName);
}

function applySelectedCompany(companyName, { source = "manual", manualOverride = false } = {}) {
  if (!COMPANY_OPTIONS.includes(companyName)) return false;
  companySelect.value = companyName;
  state.companySelectionSource = source;
  state.manualCompanyOverride = manualOverride;
  validateCompanySelection();
  return true;
}

function applySocialCompanyRecognition({ promptOnConflict = false, notify = false } = {}) {
  const recognition = getSocialCompanyRecognition();
  if (!isVerifiedSocialCompanyRecognition(recognition)) {
    renderCompanyOptions({ applyDefault: false });
    return false;
  }
  const recognizedCompany = recognition.companyName;
  const currentCompany = companySelect.value.trim();
  if (!currentCompany) {
    applySelectedCompany(recognizedCompany, { source: "social_security", manualOverride: false });
    if (notify) addMessage("bot", `已按人事花名册中的社保主体自动选择付款公司：${recognizedCompany}。如本次确需使用其他主体，可手动修改并确认。`);
    renderCompanyOptions({ applyDefault: false });
    return true;
  }
  if (currentCompany === recognizedCompany) {
    if (state.companySelectionSource !== "manual") state.companySelectionSource = "social_security";
    renderCompanyOptions({ applyDefault: false });
    return false;
  }
  if (promptOnConflict && window.confirm(`系统根据人事花名册识别到您的社保主体为“${recognizedCompany}”，但当前草稿选择的是“${currentCompany}”。是否改为识别结果？`)) {
    applySelectedCompany(recognizedCompany, { source: "social_security", manualOverride: false });
    revalidateInvoiceTitles({ notify: true });
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncDraft();
    renderCompanyOptions({ applyDefault: false });
    return true;
  }
  state.companySelectionSource = "manual";
  state.manualCompanyOverride = true;
  renderCompanyOptions({ applyDefault: false });
  return false;
}

function confirmManualCompanyOverride(company) {
  const recognition = getSocialCompanyRecognition();
  if (!isVerifiedSocialCompanyRecognition(recognition) || company === recognition.companyName) return true;
  const confirmed = window.confirm(`系统根据人事花名册识别到您的社保主体为“${recognition.companyName}”。您将付款公司改为“${company}”，请确认本次确需使用该主体。`);
  if (!confirmed) {
    applySelectedCompany(recognition.companyName, { source: "social_security", manualOverride: false });
    return false;
  }
  state.companySelectionSource = "manual";
  state.manualCompanyOverride = true;
  return true;
}

function validateCompanySelection(value = companySelect.value) {
  const companyName = String(value || "").trim();
  const requiresCompany = ["daily", "travel"].includes(currentWorkflow()?.targetType);
  const error = !companyName && requiresCompany
    ? "请选择需要付款的公司名称。"
    : (companyName && !COMPANY_OPTIONS.includes(companyName)
      ? "请从公司清单中选择需要付款的公司名称。"
      : "");
  companySelect.setCustomValidity(error);
  return error;
}

function getFilteredCompanyOptions(query = "") {
  const normalizedQuery = normalizeCompanyName(query);
  if (!normalizedQuery) return COMPANY_OPTIONS;
  return COMPANY_OPTIONS.filter((company) => normalizeCompanyName(company).includes(normalizedQuery));
}

function setCompanyMenuOpen(isOpen) {
  if (!companyOptionsMenu || !companyMenuToggle) return;
  companyOptionsMenu.hidden = !isOpen;
  companyMenuToggle.setAttribute("aria-expanded", String(isOpen));
  companySelect.setAttribute("aria-expanded", String(isOpen));
}

function renderCompanyOptionsMenu(query = "") {
  if (!companyOptionsMenu) return;
  const options = getFilteredCompanyOptions(query);
  companyOptionsMenu.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("p");
    empty.className = "company-options-empty";
    empty.textContent = "未找到匹配公司，请继续输入关键词。";
    companyOptionsMenu.append(empty);
    return;
  }
  options.forEach((company) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "company-option";
    option.dataset.company = company;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(company === companySelect.value));
    option.textContent = company;
    companyOptionsMenu.append(option);
  });
}

function openCompanyOptions(query = "") {
  renderCompanyOptionsMenu(query);
  setCompanyMenuOpen(true);
}

function closeCompanyOptions() {
  setCompanyMenuOpen(false);
}

function selectCompanyOption(company) {
  if (!COMPANY_OPTIONS.includes(company)) return;
  if (!confirmManualCompanyOverride(company)) {
    renderCompanyOptions({ applyDefault: false });
    return;
  }
  applySelectedCompany(company, {
    source: company === getSocialCompanyRecognition()?.companyName ? "social_security" : "manual",
    manualOverride: company !== getSocialCompanyRecognition()?.companyName,
  });
  closeCompanyOptions();
  revalidateInvoiceTitles({ notify: true });
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncDraft();
  companySelect.focus();
}

function renderCompanyOptions({ applyDefault = false } = {}) {
  if (!companySelect) return;
  validateCompanySelection();

  if (!companyMatchHint) return;
  const recognition = getSocialCompanyRecognition();
  if (isVerifiedSocialCompanyRecognition(recognition)) {
    companyMatchHint.textContent = state.manualCompanyOverride
      ? `人事花名册识别的社保主体为“${recognition.companyName}”；当前已保留您的手工选择。`
      : `已按人事花名册中的社保主体自动识别：${recognition.companyName}。如本次确需其他主体，可修改后确认。`;
  } else if (recognition?.status === "missing") {
    companyMatchHint.textContent = "人事花名册暂未填写社保主体，请手动选择本次实际付款公司。";
  } else if (recognition?.status === "invalid_value") {
    companyMatchHint.textContent = "人事花名册中的社保主体未匹配现有付款公司清单，请手动选择并联系财务/人事核对。";
  } else if (recognition?.status === "permission_denied" || recognition?.status === "temporarily_unavailable") {
    companyMatchHint.textContent = "暂时无法读取人事花名册社保主体，请手动选择本次实际付款公司；不会影响正常报销。";
  } else if (state.user) {
    companyMatchHint.textContent = "正在读取人事花名册中的社保主体；如未识别到，可手动选择本次实际付款公司。";
  } else {
    companyMatchHint.textContent = "完成钉钉登录后，系统会按人事花名册中的社保主体自动识别；也可手动选择。";
  }
}

async function refreshSocialCompanyRecognition() {
  if (!state.sessionToken) await renewDingTalkSession({ announce: true });
  const query = new URLSearchParams({ session_token: state.sessionToken });
  if (isOnBehalfRoute()) query.set("user_id", state.submissionRoute.subjectUserId);
  const response = await fetch(`${getApiBase()}/api/dingtalk/social-company?${query}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw createApiError(result.error || "重新检测社保主体失败", response.status);
  const recognition = result.socialCompanyRecognition || null;
  if (isOnBehalfRoute()) state.submissionRoute.socialCompanyRecognition = recognition;
  else {
    state.socialCompanyRecognition = recognition;
    if (state.user) state.user.socialCompanyRecognition = recognition;
  }
  applySocialCompanyRecognition({ promptOnConflict: true, notify: true });
  renderCompanyOptions({ applyDefault: false });
  syncDraft();
  return state.socialCompanyRecognition;
}

function getFilesByType(type) {
  return state.files.filter((file) => classifyFile(file) === type && !file?.titleValidation?.quarantined);
}

function normalizeAttachmentForApproval(attachment) {
  if (!attachment) return null;
  const fileSize = Number(attachment.fileSize || attachment.size || 0);
  return {
    ...attachment,
    spaceId: String(attachment.spaceId || ""),
    fileId: String(attachment.fileId || ""),
    fileName: attachment.fileName || attachment.name || "attachment",
    fileSize: String(Number.isFinite(fileSize) ? fileSize : 0),
    fileType: String(attachment.fileType || attachment.extension || "file").toLowerCase(),
  };
}

function getAttachmentsByType(type) {
  return getFilesByType(type)
    .map((file) => normalizeAttachmentForApproval(file.dingtalkAttachment))
    .filter(Boolean);
}

function getAllAttachments() {
  return state.files
    .filter((file) => !file?.titleValidation?.quarantined)
    .map((file) => normalizeAttachmentForApproval(file.dingtalkAttachment))
    .filter(Boolean);
}

function buildEvidenceManifest() {
  return state.files
    .filter((file) => ["payment", "invoice"].includes(classifyFile(file)) && !file?.titleValidation?.quarantined && file.dingtalkAttachment?.fileId)
    .map((file) => ({
      fileId: String(file.dingtalkAttachment.fileId),
      token: file.evidenceToken || "",
      manualAmount: getManualOcrAmount(file),
      duplicateDecision: file.duplicateDecision || "",
      // This is not a second source of truth: it is the signed upload receipt's
      // durable route back to the row when a browser render empties the OA table.
      targetRowId: file.uploadTargetRowId || "",
      attachment: normalizeAttachmentForApproval(file.dingtalkAttachment),
    }));
}

function getEvidenceProcessingTokens() {
  return state.processingEvents.map((event) => event.token).filter(Boolean);
}

function todayValue() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function createDailyRow(seed = {}) {
  const defaultReason = Object.prototype.hasOwnProperty.call(seed, "reason") ? seed.reason : getWorkflowDefaultReason();
  const defaultInvoiceType = isNoInvoiceWorkflow() ? "无" : "";
  return {
    id: seed.id || (window.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random()}`),
    businessDate: seed.businessDate || businessDateInput?.value || todayValue(),
    reason: defaultReason || "",
    amount: seed.amount || "",
    amountAutoFilled: Boolean(seed.amountAutoFilled),
    project: seed.project || "",
    invoiceType: seed.invoiceType || defaultInvoiceType,
    paymentFileKeys: Array.isArray(seed.paymentFileKeys) ? seed.paymentFileKeys : [],
    invoiceFileKeys: Array.isArray(seed.invoiceFileKeys) ? seed.invoiceFileKeys : [],
    importedPaymentReference: seed.importedPaymentReference || "",
    importedInvoiceReference: seed.importedInvoiceReference || "",
    remark: seed.remark || "",
    relatedInstanceId: seed.relatedInstanceId || "",
    relatedBusinessId: seed.relatedBusinessId || "",
    relatedTitle: seed.relatedTitle || "",
    autoGeneratedFromRelated: Boolean(seed.autoGeneratedFromRelated),
    manualSplit: Boolean(seed.manualSplit),
  };
}

function isRelatedDrivenWorkflow(workflow = currentWorkflow()) {
  return Boolean(workflow?.related?.autoGenerateRows);
}

function getRelatedDrivenRows() {
  return currentWorkflow().targetType === "travel" ? state.travelRows : state.dailyRows;
}

function setRelatedDrivenRows(rows) {
  if (currentWorkflow().targetType === "travel") state.travelRows = rows;
  else state.dailyRows = rows;
}

function isEmptyLinkedDailyPlaceholder(row) {
  return !row.relatedInstanceId
    && !row.amount
    && !row.project
    && !row.invoiceType
    && !row.remark
    && !(row.paymentFileKeys || []).length
    && !(row.invoiceFileKeys || []).length
    && (!row.reason || row.reason === getWorkflowDefaultReason());
}

function createRelatedDrivenRow(related) {
  const seed = {
    relatedInstanceId: related.processInstanceId,
    relatedBusinessId: related.businessId,
    relatedTitle: related.title,
    autoGeneratedFromRelated: true,
  };
  return currentWorkflow().targetType === "travel"
    ? createTravelRow(seed)
    : createDailyRow(seed);
}

function syncRelatedDrivenRows() {
  if (!isRelatedDrivenWorkflow()) return;
  const selectedIds = new Set(getRelatedInstanceIds());
  let rows = getRelatedDrivenRows().filter((row) => {
    if (row.autoGeneratedFromRelated) return selectedIds.has(row.relatedInstanceId);
    if (currentWorkflow().targetType === "daily" && selectedIds.size && isEmptyLinkedDailyPlaceholder(row)) return false;
    return !row.relatedInstanceId || selectedIds.has(row.relatedInstanceId);
  });

  state.selectedRelated.forEach((related) => {
    const relatedRows = rows.filter((row) => row.relatedInstanceId === related.processInstanceId);
    const autoRow = relatedRows.find((row) => row.autoGeneratedFromRelated);
    if (autoRow) {
      autoRow.relatedBusinessId = related.businessId || autoRow.relatedBusinessId;
      autoRow.relatedTitle = related.title || autoRow.relatedTitle;
    } else if (relatedRows.length) {
      // Rows created by the former version were also one-to-one default rows.
      relatedRows[0].autoGeneratedFromRelated = true;
      relatedRows[0].relatedBusinessId = related.businessId || relatedRows[0].relatedBusinessId;
      relatedRows[0].relatedTitle = related.title || relatedRows[0].relatedTitle;
    } else {
      rows.push(createRelatedDrivenRow(related));
    }
  });

  const filesByKey = new Map(state.files.map((file) => [getFileKey(file), file]));
  rows.forEach((row) => {
    ["paymentFileKeys", "invoiceFileKeys"].forEach((field) => {
      row[field] = [...new Set((row[field] || []).filter((key) => {
        const file = filesByKey.get(key);
        if (!file) return false;
        return !file.relatedInstanceId || file.relatedInstanceId === row.relatedInstanceId;
      }))];
    });
  });
  state.files.forEach((file) => {
    const kind = classifyFile(file);
    if (!file.relatedInstanceId || !["payment", "invoice"].includes(kind)) return;
    const field = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
    const alreadyAssigned = rows.some((item) => item[field]?.includes(getFileKey(file)));
    if (alreadyAssigned) return;
    const row = rows.find((item) => item.autoGeneratedFromRelated
      && item.relatedInstanceId === file.relatedInstanceId);
    if (!row) return;
    row[field] = Array.from(new Set([...(row[field] || []), getFileKey(file)]));
  });
  setRelatedDrivenRows(rows);
}

function ensureDailyRows() {
  if (!state.dailyRows.length) state.dailyRows.push(createDailyRow());
}

function getFileOptions(type) {
  return getFilesByType(type).map((file) => ({
    key: getFileKey(file),
    name: file.name,
  }));
}

function renderOptionList(options, selected = []) {
  const selectedSet = new Set(selected);
  return options.map((item) => `
    <option value="${escapeHtml(item)}" ${selectedSet.has(item) ? "selected" : ""}>${escapeHtml(item)}</option>
  `).join("");
}

function renderFileOptionList(type, selected = []) {
  const selectedSet = new Set(selected);
  return getFileOptions(type).map((item) => `
    <option value="${escapeHtml(item.key)}" ${selectedSet.has(item.key) ? "selected" : ""}>${escapeHtml(item.name)}</option>
  `).join("");
}

function renderFillHandle(field) {
  return `<button class="cell-fill-handle" type="button" data-fill-handle data-fill-field="${escapeHtml(field)}" aria-label="向下复制此字段" title="按住并向下拖动，复制此字段到后续行"></button>`;
}

function getFileByKey(key) {
  return state.files.find((file) => getFileKey(file) === key);
}

async function openAttachmentPreview(file) {
  if (!file) return;
  let source = "";
  let revokeSource = false;
  let previewName = file.name || file.dingtalkAttachment?.fileName || "附件";
  let previewType = file.type || file.dingtalkAttachment?.fileType || "";
  try {
    if (file instanceof Blob) {
      source = URL.createObjectURL(file);
      revokeSource = true;
    } else {
      const attachment = file.dingtalkAttachment || {};
      const fileId = attachment.fileId || attachment.file_id || "";
      if (!state.sessionToken || !fileId) {
        showSubmissionResult({
          state: "error",
          title: "当前附件无法预览",
          summary: "历史草稿只保留了附件记录，没有可用的钉钉预览凭证。",
          details: [{ label: "附件名称", value: previewName }],
          hint: "请先在钉钉内重新登录；如果该附件已失效，再重新上传后预览。",
        });
        return;
      }
      const params = new URLSearchParams({
        session_token: state.sessionToken,
        file_id: String(fileId),
        space_id: String(attachment.spaceId || ""),
        evidence_token: String(file.evidenceToken || ""),
      });
      const response = await fetch(`${getApiBase()}/api/files/preview-url?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url) throw createApiError(payload.error || "附件预览地址获取失败", response.status);
      source = payload.url;
      previewName = payload.fileName || previewName;
      previewType = payload.mimeType || payload.fileType || previewType;
    }
  } catch (error) {
    if (revokeSource && source) URL.revokeObjectURL(source);
    showSubmissionResult({
      state: "error",
      title: "附件预览失败",
      summary: error.message || "无法获取该附件的预览地址。",
      details: [{ label: "附件名称", value: previewName }],
      hint: isExpiredDingTalkSessionError(error)
        ? "钉钉登录会话已失效，请重新登录后再试。"
        : "请稍后重试；如果仍失败，请重新上传该附件。",
    });
    return;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "attachment-preview-dialog";
  dialog.innerHTML = `
    <section class="attachment-preview-shell">
      <header>
        <div><small>附件预览</small><strong></strong></div>
        <div class="attachment-preview-actions">
          <a target="_blank" rel="noopener noreferrer">新窗口打开</a>
          <button type="button" data-close-preview>关闭</button>
        </div>
      </header>
      <div class="attachment-preview-body"></div>
    </section>`;
  dialog.querySelector("strong").textContent = previewName;
  dialog.querySelector("a").href = source;
  const body = dialog.querySelector(".attachment-preview-body");
  const name = String(previewName || "").toLowerCase();
  const type = String(previewType || "").toLowerCase();
  const isImage = type.startsWith("image/") || /^(?:png|jpe?g|gif|webp|bmp)$/i.test(type) || /\.(png|jpe?g|gif|webp|bmp)$/.test(name);
  if (isImage) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = previewName || "附件预览";
    body.append(image);
  } else {
    const frame = document.createElement("iframe");
    frame.src = source;
    frame.title = previewName || "附件预览";
    body.append(frame);
  }
  dialog.querySelector("[data-close-preview]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (revokeSource) URL.revokeObjectURL(source);
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function renderRowAttachmentCell(row, kind) {
  const isPayment = kind === "payment";
  const keys = getRowFileKeys(row, kind, "daily");
  const uploadAction = isPayment ? "upload-row-payment" : "upload-row-invoice";
  const label = isPayment ? "上传付款截图" : "上传发票附件";
  const chips = keys.length
    ? keys.map((key) => {
      const file = getFileByKey(key);
      const fileName = file?.name || "已选附件";
      return `
        <span class="row-file-chip" title="${escapeHtml(fileName)}">
          <button type="button" class="row-file-preview" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(fileName)}</button>
          <button type="button" data-action="unlink-row-file" data-kind="${kind}" data-key="${escapeHtml(key)}" aria-label="移除此行附件">×</button>
        </span>
      `;
    }).join("")
    : `<span class="row-file-empty">未上传</span>`;

  return `
    <div class="row-file-cell" data-row-id="${escapeHtml(row.id)}" data-kind="${kind}">
      <button class="row-upload-button" type="button" data-action="${uploadAction}">${label}</button>
      <div class="row-file-drop-hint">已分配 ${keys.length} 个 · 可多选</div>
      <div class="row-file-chips">${chips}</div>
    </div>
  `;
}

function renderDailyRows() {
  if (!dailyRowsBody) return;
  ensureDailyRows();
  const noInvoice = isNoInvoiceWorkflow();
  dailyRowsBody.innerHTML = state.dailyRows.map((row, index) => `
    <tr data-row-id="${escapeHtml(row.id)}">
      <td class="fill-copy-cell"><input data-field="businessDate" type="date" value="${escapeHtml(row.businessDate)}" />${renderFillHandle("businessDate")}</td>
      <td class="fill-copy-cell"><textarea data-field="reason" placeholder="填写本笔费用说明">${escapeHtml(row.reason)}</textarea>${renderFillHandle("reason")}</td>
      <td class="fill-copy-cell"><input data-field="amount" type="text" inputmode="decimal" placeholder="0.00" value="${escapeHtml(row.amount)}" />${renderFillHandle("amount")}</td>
      <td class="fill-copy-cell"><select data-field="project">${renderOptionList(["", ...PROJECT_OPTIONS], row.project ? [row.project] : [])}</select>${renderFillHandle("project")}</td>
      ${noInvoice ? "" : `<td class="fill-copy-cell"><select data-field="invoiceType">${renderOptionList(["", ...INVOICE_TYPE_OPTIONS], row.invoiceType ? [row.invoiceType] : [])}</select>${renderFillHandle("invoiceType")}</td>`}
      <td>
        ${renderRowAttachmentCell(row, "payment")}
      </td>
      ${noInvoice ? "" : `<td>${renderRowAttachmentCell(row, "invoice")}</td>`}
      <td class="fill-copy-cell"><textarea data-field="remark" placeholder="可选">${escapeHtml(row.remark)}</textarea>${renderFillHandle("remark")}</td>
      <td>
        <div class="detail-row-actions">
          <button class="text-button" type="button" data-action="copy-row">复制</button>
          <button class="text-button danger" type="button" data-action="remove-row" ${state.dailyRows.length === 1 ? "disabled" : ""}>删除</button>
        </div>
      </td>
    </tr>
  `).join("");
  if (dailyInvoiceTypeHeader) dailyInvoiceTypeHeader.hidden = noInvoice;
  if (dailyInvoiceAttachmentHeader) dailyInvoiceAttachmentHeader.hidden = noInvoice;
  if (dailyTableFooterSpacer) dailyTableFooterSpacer.colSpan = noInvoice ? 4 : 6;
  dailyTableTotal.textContent = formatMoney(getDailyRowsTotal()) || "0.00";
  renderDailyPreview();
}

function readDailyRowsFromDom() {
  if (!dailyRowsBody) return state.dailyRows;
  const rows = Array.from(dailyRowsBody.querySelectorAll("tr[data-row-id]"));
  state.dailyRows = rows.map((tr) => {
    const previous = state.dailyRows.find((item) => item.id === tr.dataset.rowId) || createDailyRow({ id: tr.dataset.rowId });
    const values = { ...previous };
    const autoFields = new Set(previous.ocrAutoFields || []);
    tr.querySelectorAll("input[data-field], select[data-field], textarea[data-field]").forEach((input) => {
      const field = input.dataset.field;
      const previousValue = values[field];
      if (input instanceof HTMLSelectElement && input.multiple) {
        values[field] = Array.from(input.selectedOptions).map((option) => option.value);
      } else {
        values[field] = input.value;
      }
      if (String(values[field] ?? "") !== String(previousValue ?? "")) autoFields.delete(field);
    });
    values.amount = formatMoney(values.amount) || values.amount;
    if (values.amount !== previous.amount) values.amountAutoFilled = false;
    values.ocrAutoFields = [...autoFields];
    return values;
  });
  return state.dailyRows;
}

function getDailyRowsTotal(rows = state.dailyRows) {
  return sumMoney(rows.map((row) => row.amount));
}

function isBlankDailyRow(row) {
  return (!row.reason || row.reason === getWorkflowDefaultReason())
    && !row.amount
    && !row.project
    && !row.invoiceType
    && !row.remark
    && !(row.paymentFileKeys || []).length
    && !(row.invoiceFileKeys || []).length;
}

function getImportReferenceParts(value) {
  const text = String(value || "").trim();
  if (!text || /^\d+(?:\.\d+)?$/.test(text)) return [];
  return text.split(/[，,、;；\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function findAutomaticImportFile(row, kind, occupiedKeys) {
  const field = kind === "invoice" ? "importedInvoiceReference" : "importedPaymentReference";
  const referenceParts = getImportReferenceParts(row[field]);
  const files = getFilesByType(kind).filter((file) => !occupiedKeys.has(getFileKey(file)));
  const referenceMatches = referenceParts.length
    ? files.filter((file) => {
      const name = String(file.name || "").toLowerCase();
      return referenceParts.some((part) => name === part || name.includes(part));
    })
    : [];
  if (referenceMatches.length === 1) return referenceMatches[0];

  const expectedAmount = formatMoney(row.amount);
  const amountMatches = expectedAmount
    ? files.filter((file) => formatMoney(getRawOcrAmount(file)) === expectedAmount)
    : [];
  return amountMatches.length === 1 ? amountMatches[0] : null;
}

function autoAssignImportedDailyAttachments() {
  if (currentWorkflow().targetType !== "daily") return 0;
  let assigned = 0;
  ["payment", "invoice"].forEach((kind) => {
    const field = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
    const occupiedKeys = new Set(state.dailyRows.flatMap((row) => row[field] || []));
    state.dailyRows.forEach((row) => {
      if (!row.importedPaymentReference && !row.importedInvoiceReference) return;
      if ((row[field] || []).length) return;
      const file = findAutomaticImportFile(row, kind, occupiedKeys);
      if (!file) return;
      const key = getFileKey(file);
      row[field] = [key];
      occupiedKeys.add(key);
      assigned += 1;
    });
  });
  return assigned;
}

function getTableRows(tableKind) {
  return tableKind === "travel" ? readTravelRowsFromDom() : readDailyRowsFromDom();
}

function renderTableRows(tableKind) {
  if (tableKind === "travel") {
    renderTravelRows();
    syncTravelTotal();
  } else {
    renderDailyRows();
  }
}

function createTableFillRow(tableKind) {
  return tableKind === "travel"
    ? createTravelRow({ manualSplit: isRelatedDrivenWorkflow() })
    : createDailyRow();
}

function applyTableFill(tableKind, sourceIndex, targetIndex, field) {
  if (targetIndex <= sourceIndex || !field) return false;
  const rows = getTableRows(tableKind);
  while (rows.length <= targetIndex) rows.push(createTableFillRow(tableKind));
  const value = rows[sourceIndex]?.[field] ?? "";
  for (let index = sourceIndex + 1; index <= targetIndex; index += 1) {
    rows[index][field] = value;
    if (tableKind === "travel" && field === "relatedInstanceId") {
      const related = getRelatedById(value);
      rows[index].relatedBusinessId = related?.businessId || "";
      rows[index].relatedTitle = related?.title || "";
    }
  }
  renderTableRows(tableKind);
  syncDraft();
  return true;
}

function beginCellFill(event, tableKind) {
  const handle = event.target.closest("[data-fill-handle]");
  if (!handle) return;
  const tbody = tableKind === "travel" ? travelRowsBody : dailyRowsBody;
  const sourceTr = handle.closest("tr[data-row-id]");
  if (!tbody || !sourceTr) return;
  const field = handle.dataset.fillField;
  const sourceIndex = Array.from(tbody.querySelectorAll("tr[data-row-id]")).indexOf(sourceTr);
  if (sourceIndex < 0 || !field) return;
  event.preventDefault();
  event.stopPropagation();
  let targetIndex = sourceIndex;
  let highlightedRows = [];
  const clearHighlights = () => {
    highlightedRows.forEach((row) => row.classList.remove("fill-copy-target"));
    highlightedRows = [];
  };
  const highlightRange = (index) => {
    clearHighlights();
    Array.from(tbody.querySelectorAll("tr[data-row-id]")).forEach((row, rowIndex) => {
      if (rowIndex > sourceIndex && rowIndex <= index) {
        row.classList.add("fill-copy-target");
        highlightedRows.push(row);
      }
    });
  };
  const setTarget = (pointerEvent) => {
    const tableRows = Array.from(tbody.querySelectorAll("tr[data-row-id]"));
    const candidate = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest("tr[data-row-id]");
    if (candidate?.parentElement === tbody) {
      targetIndex = Math.max(sourceIndex, tableRows.indexOf(candidate));
    } else {
      const lastRow = tableRows.at(-1);
      const lastRect = lastRow?.getBoundingClientRect();
      if (!lastRect || pointerEvent.clientY <= lastRect.bottom) return;
      // Excel lets users drag past the last existing row. Create the required
      // blank rows when the drag ends, then fill into them.
      const rowHeight = Math.max(lastRect.height, 36);
      targetIndex = Math.max(sourceIndex, tableRows.length + Math.floor((pointerEvent.clientY - lastRect.bottom) / rowHeight));
    }
    highlightRange(targetIndex);
  };
  const finish = () => {
    document.removeEventListener("pointermove", setTarget);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
    clearHighlights();
    applyTableFill(tableKind, sourceIndex, targetIndex, field);
  };
  try { handle.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in old DingTalk webviews. */ }
  document.addEventListener("pointermove", setTarget);
  document.addEventListener("pointerup", finish, { once: true });
  document.addEventListener("pointercancel", finish, { once: true });
}

function fillCurrentCellDown(event, tableKind) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "d") return;
  const input = event.target.closest("[data-field]");
  const tbody = tableKind === "travel" ? travelRowsBody : dailyRowsBody;
  const sourceTr = input?.closest("tr[data-row-id]");
  if (!input || !tbody || !sourceTr) return;
  const sourceIndex = Array.from(tbody.querySelectorAll("tr[data-row-id]")).indexOf(sourceTr);
  if (sourceIndex < 0) return;
  event.preventDefault();
  applyTableFill(tableKind, sourceIndex, sourceIndex + 1, input.dataset.field);
}

async function importExpenseSheet(file) {
  if (!file) return;
  if (currentWorkflow().targetType !== "daily") {
    throw new Error("Excel 费用明细导入目前适用于日常报销；差旅报销需先按关联出差申请生成明细。");
  }
  if (isNoInvoiceWorkflow()) {
    throw new Error("无发票报销仅需付款凭证，当前 Excel 导入模板包含发票列，不能用于该入口。请直接填写明细并上传付款截图或订单截图。");
  }
  showDailyImportNotice(`正在导入“${file.name}”，并校验付款截图和发票，请勿关闭页面。`);
  const result = await withDingTalkSessionRetry(async () => {
    const formData = new FormData();
    formData.append("session_token", state.sessionToken);
    formData.append("file", file, file.name);
    const response = await fetch(`${getApiBase()}/api/expense-sheet/import`, { method: "POST", body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw createApiError(payload.error || "Excel 明细导入失败", response.status);
    return payload;
  }, "导入 Excel");
  if (!result.imported?.length) {
    throw new Error(`未导入任何明细：${result.summary?.skippedRows || 0} 行因缺付款截图、发票或有效金额被剔除。`);
  }
  readDailyRowsFromDom();
  if (state.dailyRows.length === 1 && isBlankDailyRow(state.dailyRows[0])) state.dailyRows = [];
  const defaultInvoiceType = invoiceTypeSelect.value || INVOICE_TYPE_OPTIONS.find((item) => item === "电子发票") || "";
  const importedFiles = (result.attachments || []).map((item) => ({
    name: item.name,
    type: item.mimetype || "image/png",
    size: Number(item.size) || 0,
    lastModified: Number(item.lastModified) || Date.now(),
    kind: item.kind,
    detectedAmount: formatMoney(getRawOcrAmount({ ocr: item.ocr })) || "",
    manualAmount: "",
    ocr: item.ocr || null,
    dingtalkAttachment: item.attachment || null,
    evidenceToken: item.evidenceToken || "",
    possibleDuplicateOfFileId: item.possibleDuplicateOfFileId || "",
    possibleDuplicateOfFileName: item.possibleDuplicateOfFileName || "",
    duplicateReasons: Array.isArray(item.duplicateReasons) ? item.duplicateReasons : [],
    duplicateDecision: "",
    uploadError: "",
    uploading: false,
    ocrQueueing: false,
  }));
  state.files.push(...importedFiles);
  const attachmentKeysBySource = new Map();
  importedFiles.forEach((file) => {
    const source = (result.attachments || []).find((item) => item.name === file.name && Number(item.lastModified) === Number(file.lastModified));
    if (!source) return;
    const key = `${source.sourceRow}:${source.kind}`;
    attachmentKeysBySource.set(key, [...(attachmentKeysBySource.get(key) || []), getFileKey(file)]);
  });
  state.dailyRows.push(...result.imported.map((item) => createDailyRow({
    businessDate: businessDateInput.value || todayValue(),
    reason: item.reason,
    amount: formatMoney(item.amount),
    project: projectSelect.value || "",
    invoiceType: defaultInvoiceType,
    importedPaymentReference: item.paymentReference,
    importedInvoiceReference: item.invoiceReference,
    paymentFileKeys: attachmentKeysBySource.get(`${item.sourceRow}:payment`) || [],
    invoiceFileKeys: attachmentKeysBySource.get(`${item.sourceRow}:invoice`) || [],
    remark: `Excel 第 ${item.sourceRow} 行导入`,
  })));
  const automaticallyAssigned = (result.attachments || []).length + autoAssignImportedDailyAttachments();
  renderFiles();
  renderDailyRows();
  syncDraft();
  const { importedRows = 0, skippedRows = 0, skippedMissingPayment = 0, skippedMissingInvoice = 0 } = result.summary || {};
  const message = `已从“${result.sheetName}”导入 ${importedRows} 条费用明细；已安全剔除 ${skippedRows} 条（缺付款 ${skippedMissingPayment}、缺发票 ${skippedMissingInvoice}）。${automaticallyAssigned ? `Excel 内嵌附件已上传并自动归入对应行（${automaticallyAssigned} 个）。` : "Excel 中未含可提取附件；请继续批量上传实际附件，系统会在唯一匹配时自动分配。"}`;
  showDailyImportNotice(message);
  addMessage("bot", message);
}

function createTravelRow(seed = {}) {
  const related = getRelatedById(seed.relatedInstanceId) || state.selectedRelated[0] || {};
  return {
    id: seed.id || (window.crypto?.randomUUID?.() || `travel-row-${Date.now()}-${Math.random()}`),
    relatedInstanceId: seed.relatedInstanceId || related.processInstanceId || "",
    relatedBusinessId: seed.relatedBusinessId || related.businessId || "",
    relatedTitle: seed.relatedTitle || related.title || "",
    businessDate: seed.businessDate || todayValue(),
    expenseType: seed.expenseType || "报销/差旅",
    reason: seed.reason || "",
    amount: seed.amount || "",
    amountAutoFilled: Boolean(seed.amountAutoFilled),
    paymentFileKeys: Array.isArray(seed.paymentFileKeys) ? seed.paymentFileKeys : [],
    invoiceFileKeys: Array.isArray(seed.invoiceFileKeys) ? seed.invoiceFileKeys : [],
    autoGeneratedFromRelated: Boolean(seed.autoGeneratedFromRelated),
    manualSplit: Boolean(seed.manualSplit),
  };
}

function syncTravelRowsWithRelated() {
  if (isRelatedDrivenWorkflow()) {
    syncRelatedDrivenRows();
    return;
  }
  const selectedIds = new Set(state.selectedRelated.map((item) => item.processInstanceId));
  state.travelRows = state.travelRows.filter((row) => selectedIds.has(row.relatedInstanceId));
  state.selectedRelated.forEach((related) => {
    if (!state.travelRows.some((row) => row.relatedInstanceId === related.processInstanceId)) {
      state.travelRows.push(createTravelRow({
        relatedInstanceId: related.processInstanceId,
        relatedBusinessId: related.businessId,
        relatedTitle: related.title,
      }));
    }
  });
}

function ensureTravelRows() {
  if (state.selectedRelated.length) syncTravelRowsWithRelated();
}

function renderTravelAttachmentCell(row, kind) {
  const isPayment = kind === "payment";
  const keys = getRowFileKeys(row, kind, "travel");
  const label = isPayment ? "上传付款截图" : "上传发票附件";
  const action = isPayment ? "upload-travel-payment" : "upload-travel-invoice";
  const chips = keys.length
    ? keys.map((key) => {
      const file = getFileByKey(key);
      const name = file?.name || "已选附件";
      return `<span class="row-file-chip" title="${escapeHtml(name)}"><button type="button" class="row-file-preview" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(name)}</button><button type="button" data-action="unlink-travel-file" data-kind="${kind}" data-key="${escapeHtml(key)}" aria-label="移除本行附件">×</button></span>`;
    }).join("")
    : `<span class="row-file-empty">未上传</span>`;
  return `<div class="row-file-cell" data-row-id="${escapeHtml(row.id)}" data-kind="${kind}">
    <button class="row-upload-button" type="button" data-action="${action}">${label}</button>
    <div class="row-file-drop-hint">已分配 ${keys.length} 个 · 可多选</div>
    <div class="row-file-chips">${chips}</div>
  </div>`;
}

function renderTravelRows() {
  if (!travelRowsBody) return;
  ensureTravelRows();
  travelRowsBody.innerHTML = state.travelRows.length
    ? state.travelRows.map((row) => {
      const relatedOptions = state.selectedRelated.map((item) => `<option value="${escapeHtml(item.processInstanceId)}" ${item.processInstanceId === row.relatedInstanceId ? "selected" : ""}>${escapeHtml(item.businessId || item.processInstanceId)}${item.title ? ` · ${escapeHtml(item.title)}` : ""}</option>`).join("");
      const related = getRelatedById(row.relatedInstanceId);
      const relatedCell = row.autoGeneratedFromRelated && isRelatedDrivenWorkflow()
        ? `<div class="linked-related-cell"><strong>${escapeHtml(related?.businessId || row.relatedBusinessId || "关联审批")}</strong><small>${escapeHtml(related?.title || row.relatedTitle || "自动生成的费用明细")}</small>${formatRelatedTravelSummary(getRelatedTravelInfo(related || {})) ? `<em>${escapeHtml(formatRelatedTravelSummary(getRelatedTravelInfo(related || {})))}</em>` : ""}</div>`
        : `<select data-field="relatedInstanceId"><option value="">请选择关联出差申请</option>${relatedOptions}</select>`;
      const actions = row.autoGeneratedFromRelated && isRelatedDrivenWorkflow()
        ? `<button class="text-button" type="button" data-action="split-travel-row">拆分明细</button>`
        : `<button class="text-button" type="button" data-action="copy-travel-row">复制</button><button class="text-button danger" type="button" data-action="remove-travel-row">删除</button>`;
      return `<tr data-row-id="${escapeHtml(row.id)}">
        <td class="${row.autoGeneratedFromRelated && isRelatedDrivenWorkflow() ? "" : "fill-copy-cell"}">${relatedCell}${row.autoGeneratedFromRelated && isRelatedDrivenWorkflow() ? "" : renderFillHandle("relatedInstanceId")}</td>
        <td class="fill-copy-cell"><input data-field="amount" type="text" inputmode="decimal" placeholder="0.00" value="${escapeHtml(row.amount)}" />${renderFillHandle("amount")}</td>
        <td class="fill-copy-cell"><input data-field="businessDate" type="date" value="${escapeHtml(row.businessDate)}" />${renderFillHandle("businessDate")}</td>
        <td class="fill-copy-cell"><select data-field="expenseType">${renderOptionList(["", ...EXPENSE_TYPE_OPTIONS], row.expenseType ? [row.expenseType] : [])}</select>${renderFillHandle("expenseType")}</td>
        <td class="fill-copy-cell"><textarea data-field="reason" placeholder="填写本笔费用说明">${escapeHtml(row.reason)}</textarea>${renderFillHandle("reason")}</td>
        <td>${renderTravelAttachmentCell(row, "payment")}</td>
        <td>${renderTravelAttachmentCell(row, "invoice")}</td>
        <td><div class="detail-row-actions">${actions}</div></td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="8" class="table-empty-hint">请先在上方选择关联出差申请。</td></tr>`;
  if (travelTableTotal) travelTableTotal.textContent = formatMoney(getTravelRowsTotal()) || "0.00";
}

function readTravelRowsFromDom() {
  if (!travelRowsBody) return state.travelRows;
  state.travelRows = Array.from(travelRowsBody.querySelectorAll("tr[data-row-id]")).map((tr) => {
    const previous = state.travelRows.find((row) => row.id === tr.dataset.rowId) || createTravelRow({ id: tr.dataset.rowId });
    const values = { ...previous };
    const autoFields = new Set(previous.ocrAutoFields || []);
    tr.querySelectorAll("input[data-field], select[data-field], textarea[data-field]").forEach((input) => {
      const previousValue = values[input.dataset.field];
      values[input.dataset.field] = input.value;
      if (String(values[input.dataset.field] ?? "") !== String(previousValue ?? "")) autoFields.delete(input.dataset.field);
    });
    const related = getRelatedById(values.relatedInstanceId);
    values.relatedBusinessId = related?.businessId || values.relatedBusinessId || "";
    values.relatedTitle = related?.title || values.relatedTitle || "";
    values.amount = formatMoney(values.amount) || values.amount;
    if (values.amount !== previous.amount) values.amountAutoFilled = false;
    values.ocrAutoFields = [...autoFields];
    return values;
  });
  return state.travelRows;
}

function getTravelRowsTotal(rows = state.travelRows) {
  return sumMoney(rows.map((row) => row.amount));
}

function autoFillTravelRowAmounts() {
  return syncAssignedRowAmountsFromPayments();
}

function syncTravelTotal() {
  if (currentWorkflow().targetType !== "travel") return;
  readTravelRowsFromDom();
  const total = formatMoney(getTravelRowsTotal());
  // Initialise an empty field from completed line items, but never overwrite
  // a value the applicant is typing or a value restored from a draft.
  if (!formatMoney(amountInput.value) && total) amountInput.value = total;
  if (travelTableTotal) travelTableTotal.textContent = total || "0.00";
}

function getAttachmentsByKeys(keys = []) {
  const wanted = new Set(keys);
  return state.files
    .filter((file) => wanted.has(getFileKey(file)))
    .map((file) => normalizeAttachmentForApproval(file.dingtalkAttachment))
    .filter(Boolean);
}

function getRowTargetId(row = {}, targetType = "daily") {
  return targetType === "travel" ? `travel:${row.id}` : String(row.id || "");
}

function getRowFileKeys(row = {}, kind, targetType = "daily") {
  const keyField = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
  const keys = new Set(row[keyField] || []);
  const targetRowId = getRowTargetId(row, targetType);
  state.files.forEach((file) => {
    if (classifyFile(file) === kind && file.uploadTargetRowId === targetRowId && !file?.titleValidation?.quarantined) {
      keys.add(getFileKey(file));
    }
  });
  return [...keys].filter((key) => Boolean(getFileByKey(key)));
}

function getRowAttachments(row = {}, kind, targetType = "daily") {
  const wanted = new Set(getRowFileKeys(row, kind, targetType));
  const seenFileIds = new Set();
  return state.files.reduce((attachments, file) => {
    if (classifyFile(file) !== kind || file?.titleValidation?.quarantined) return attachments;
    // The row key is the normal path. uploadTargetRowId is the durable fallback
    // for a supplement whose async OCR receipt arrives while the table rerenders.
    if (!wanted.has(getFileKey(file))) return attachments;
    const attachment = normalizeAttachmentForApproval(file.dingtalkAttachment);
    if (!attachment?.fileId || seenFileIds.has(attachment.fileId)) return attachments;
    seenFileIds.add(attachment.fileId);
    attachments.push(attachment);
    return attachments;
  }, []);
}

function buildAttachmentRowBindings(rows = [], targetType = "daily", { includeInvoices = true } = {}) {
  return rows.map((row, rowIndex) => ({
    rowIndex,
    rowId: String(row?.id || ""),
    paymentAttachments: getRowAttachments(row, "payment", targetType),
    invoiceAttachments: includeInvoices ? getRowAttachments(row, "invoice", targetType) : [],
  }));
}

function renderDailyPreview() {
  if (!dailyPreviewRows) return;
  const rows = state.dailyRows.filter((row) => row.businessDate || row.reason || row.amount || row.project);
  dailyPreviewRows.innerHTML = rows.length
    ? rows.map((row, index) => `
      <div class="daily-preview-row">
        <span>第 ${index + 1} 行</span>
        <div>
          <b>${escapeHtml(row.reason || "未填写事由")}</b>
          <p>${escapeHtml(row.businessDate || "未选日期")} · ${escapeHtml(row.project || "未选项目")} · ${escapeHtml(row.invoiceType || "未选发票类型")}</p>
        </div>
        <b>${escapeHtml(formatMoney(row.amount) || "0.00")}</b>
      </div>
    `).join("")
    : `<p class="muted-line">左侧填写费用明细后，这里会预览即将写入 OA 表格的内容。</p>`;
}

function getUploadStatusText(file) {
  if (file.dingtalkAttachment) return "已上传钉钉";
  if (file.uploading) return "正在上传钉钉";
  if (file.uploadError) return `上传失败：${file.uploadError}`;
  if (!state.sessionToken) return "待登录后上传";
  return "待上传钉钉";
}

function getFileRowAssignment(fileKey) {
  const rowIndex = state.dailyRows.findIndex((row) =>
    getRowFileKeys(row, "payment", "daily").includes(fileKey) || getRowFileKeys(row, "invoice", "daily").includes(fileKey));
  if (rowIndex < 0) return null;
  return { row: state.dailyRows[rowIndex], index: rowIndex };
}

function getFileTravelRowAssignment(fileKey) {
  const rowIndex = state.travelRows.findIndex((row) =>
    getRowFileKeys(row, "payment", "travel").includes(fileKey) || getRowFileKeys(row, "invoice", "travel").includes(fileKey));
  if (rowIndex < 0) return null;
  return { row: state.travelRows[rowIndex], index: rowIndex };
}

function getRelatedById(processInstanceId) {
  return state.selectedRelated.find((item) => item.processInstanceId === processInstanceId) || null;
}

function getFileAssignmentText(file) {
  const rowAssignment = getFileRowAssignment(getFileKey(file));
  const travelRowAssignment = getFileTravelRowAssignment(getFileKey(file));
  const related = getRelatedById(file.relatedInstanceId);
  const parts = [];
  if (rowAssignment) parts.push(`明细 ${rowAssignment.index + 1}`);
  if (travelRowAssignment) parts.push(`差旅明细 ${travelRowAssignment.index + 1}${travelRowAssignment.row.relatedBusinessId ? ` · ${travelRowAssignment.row.relatedBusinessId}` : ""}`);
  if (related) parts.push(related.businessId || related.title || "关联审批");
  return parts.length ? parts.join(" · ") : "待分配";
}

function renderWorkflowSelect() {
  workflowSelect.innerHTML = "";
  WORKFLOWS.filter((workflow) => !workflow.legacy).forEach((workflow) => {
    const option = document.createElement("option");
    option.value = workflow.id;
    option.textContent = `${workflow.title}（${workflow.targetType === "travel" ? "差旅报销单据" : "日常报销"}）`;
    workflowSelect.append(option);
  });
  workflowSelect.value = state.workflowId;
  renderWorkflowCards();
}

function renderWorkflowCards() {
  workflowCards.innerHTML = "";
  WORKFLOWS.filter((workflow) => !workflow.legacy).forEach((workflow) => {
    const button = document.createElement("button");
    const selected = workflow.id === state.workflowId;
    const relatedText = workflow.related?.required
      ? `需${workflow.related.label}`
      : (workflow.related ? "按明细需要关联" : "无需前置审批");
    const modeText = workflow.targetType === "travel"
      ? "单独差旅表单"
      : (workflow.detailMode === "mixed" ? "多项混合费用" : "单类费用明细");
    button.type = "button";
    button.className = `workflow-card ${selected ? "active" : ""}`;
    button.dataset.workflowId = workflow.id;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.innerHTML = `
      <span class="workflow-kind">${modeText}</span>
      <strong>${workflow.title}</strong>
      <span>${relatedText}</span>
      <small>${escapeHtml(workflow.detailHint || workflow.description)}</small>
    `;
    workflowCards.append(button);
  });
}

function getFileByAttachmentId(fileId) {
  const expected = String(fileId || "");
  return state.files.find((file) => String(file.dingtalkAttachment?.fileId || "") === expected);
}

function removeFileReferences(fileKey) {
  [...state.dailyRows, ...state.travelRows].forEach((row) => {
    row.paymentFileKeys = (row.paymentFileKeys || []).filter((key) => key !== fileKey);
    row.invoiceFileKeys = (row.invoiceFileKeys || []).filter((key) => key !== fileKey);
  });
}

function unlinkFileFromRow(row, fileKey, kind, targetType = "daily") {
  if (!row) return false;
  const field = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
  const before = row[field] || [];
  row[field] = before.filter((key) => key !== fileKey);
  const file = getFileByKey(fileKey);
  if (file?.uploadTargetRowId === getRowTargetId(row, targetType)) file.uploadTargetRowId = "";
  if (before.length !== row[field].length || file) queueClientAuditEvent("attachment_unbound", {
    action: "unbound_from_row", rowId: row.id, targetRowId: getRowTargetId(row, targetType), attachment: summarizeClientAuditAttachment(file),
  }, { critical: true });
  return before.length !== row[field].length || Boolean(file);
}

function detachFilesFromRemovedRow(row, targetType = "daily") {
  if (!row) return;
  const targetRowId = getRowTargetId(row, targetType);
  state.files.forEach((file) => {
    if (file.uploadTargetRowId === targetRowId) file.uploadTargetRowId = "";
  });
}

function normalizeInvoiceTitle(value) {
  return String(value || "")
    .trim()
    .replace(/有限责任公司$/u, "有限公司")
    .replace(/[\s　()（）\[\]【】,，.。·—_-]/gu, "")
    .toLowerCase();
}

function normalizeOcrBuyerTitle(value) {
  // Keep this in sync with the server-side comparison. OCR occasionally
  // prefixes purchaserName/buyerName or a printed label such as 公司全称:
  // and appends coordinate-like confidence digits.
  return normalizeInvoiceTitle(String(value || "")
    .replace(/(?:purchaser[\s_-]*name|buyer[\s_-]*name|purchaser|buyer|购买方(?:信息|名称)?|购方(?:信息|名称)?|公司全称|公司名称|单位全称|单位名称|购货单位|购方单位|发票抬头(?:名称)?|抬头(?:名称)?)/giu, ""));
}

function getInvoiceBuyerIdentity(file) {
  const ledger = file?.ocr?.invoiceLedger || {};
  return {
    name: String(ledger.buyerName || file?.ocr?.buyerName || "").trim(),
    taxNumber: String(ledger.buyerTaxNumber || "").trim().toUpperCase(),
  };
}

function getInvoiceTitleValidationResult(file, companyName = companySelect.value) {
  if (classifyFile(file) !== "invoice" || isNoInvoiceWorkflow()) return { status: "not_applicable" };
  if (!companyName || !file?.dingtalkAttachment || file.uploading || file.ocrQueueing) return { status: "pending" };
  const role = String(file?.ocr?.documentRole || "unknown");
  if (["supporting_document", "title_exempt_transport_receipt"].includes(role)) return { status: "not_applicable" };
  const buyer = getInvoiceBuyerIdentity(file);
  if (!buyer.name) {
    return {
      status: "unrecognized",
      buyer,
      reason: role === "unknown" ? "未能确认该附件为可核验的税务发票或识别购买方抬头" : "未识别到发票购买方抬头",
    };
  }
  const expected = normalizeInvoiceTitle(companyName);
  const actual = normalizeOcrBuyerTitle(buyer.name);
  if (actual === expected) {
    return { status: "matched", buyer, reason: "购买方抬头与本次付款公司一致" };
  }
  const expectedPosition = actual.indexOf(expected);
  if (expectedPosition >= 0) {
    const residue = `${actual.slice(0, expectedPosition)}${actual.slice(expectedPosition + expected.length)}`;
    if (/^\d{1,20}$/u.test(residue)) {
      return { status: "matched", buyer, reason: "购买方抬头与本次付款公司一致（已忽略OCR字段杂讯）" };
    }
  }
  return {
    status: "mismatch",
    buyer,
    reason: `OCR识别购买方“${buyer.name}”与本次付款公司“${companyName}”不一致`,
  };
}

function getInvoiceTitleReplacementSlot(slotId) {
  return state.invoiceTitleReplacementSlots.find((slot) => slot.id === slotId) || null;
}

function getPendingInvoiceTitleReplacementSlots() {
  return state.invoiceTitleReplacementSlots.filter((slot) => slot.status === "pending");
}

function discardInvoiceTitleReplacementSlot(slotId) {
  const slot = getInvoiceTitleReplacementSlot(slotId);
  if (!slot) return false;
  const fileKeys = new Set([slot.originalFileKey].filter(Boolean));
  state.files.forEach((file) => {
    if (file.invoiceTitleReplacementSlotId === slot.id) fileKeys.add(getFileKey(file));
  });
  fileKeys.forEach(removeFileReferences);
  state.files = state.files.filter((file) => !fileKeys.has(getFileKey(file)));
  state.invoiceTitleReplacementSlots = state.invoiceTitleReplacementSlots.filter((item) => item.id !== slot.id);
  return true;
}

function discardFileFromDraft(fileKey) {
  const file = getFileByKey(fileKey);
  if (!file) return false;
  queueClientAuditEvent("attachment_deleted", { action: "deleted", attachment: summarizeClientAuditAttachment(file) }, { critical: true });
  // A replacement upload and the quarantined original are one logical item.
  // Deleting either one must also clear its pending replacement slot, or the
  // V2 progress area would keep showing a ghost "待补充发票" record.
  if (file.invoiceTitleReplacementSlotId) return discardInvoiceTitleReplacementSlot(file.invoiceTitleReplacementSlotId);
  removeFileReferences(fileKey);
  state.files = state.files.filter((item) => getFileKey(item) !== fileKey);
  return true;
}

function pruneOrphanedInvoiceTitleReplacementSlots() {
  const fileKeys = new Set(state.files.map(getFileKey));
  state.invoiceTitleReplacementSlots = state.invoiceTitleReplacementSlots.filter((slot) => {
    if (slot.status !== "pending") return true;
    const hasOriginal = slot.originalFileKey && fileKeys.has(slot.originalFileKey);
    const hasReplacement = state.files.some((file) => file.invoiceTitleReplacementSlotId === slot.id);
    return hasOriginal || hasReplacement;
  });
}

function getInvoiceTitleRowReference(fileKey) {
  const daily = getFileRowAssignment(fileKey);
  if (daily) return { rowId: daily.row.id, rowKind: "daily", rowIndex: daily.index + 1, rowLabel: `第 ${daily.index + 1} 行费用明细` };
  const travel = getFileTravelRowAssignment(fileKey);
  if (travel) return { rowId: travel.row.id, rowKind: "travel", rowIndex: travel.index + 1, rowLabel: `第 ${travel.index + 1} 行差旅明细` };
  return { rowId: "", rowKind: "", rowIndex: 0, rowLabel: "未分配费用明细" };
}

function restoreInvoiceTitleFileToSlot(file, slot) {
  if (!file || !slot?.rowId) return;
  const rows = slot.rowKind === "travel" ? state.travelRows : state.dailyRows;
  const row = rows.find((item) => item.id === slot.rowId);
  if (!row) return;
  const key = getFileKey(file);
  row.invoiceFileKeys = Array.from(new Set([...(row.invoiceFileKeys || []), key]));
}

function quarantineInvoiceTitleFile(file, result) {
  const key = getFileKey(file);
  const reference = getInvoiceTitleRowReference(key);
  let slot = getInvoiceTitleReplacementSlot(file.invoiceTitleReplacementSlotId);
  if (!slot) {
    slot = {
      id: `title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      rowId: reference.rowId,
      rowKind: reference.rowKind,
      rowIndex: reference.rowIndex,
      rowLabel: reference.rowLabel,
      originalFileKey: key,
      originalFileName: file.name || "异常发票",
      buyerName: result.buyer?.name || "",
      buyerTaxNumber: result.buyer?.taxNumber || "",
      expectedCompany: companySelect.value || "",
      reason: result.reason,
      createdAt: new Date().toISOString(),
    };
    state.invoiceTitleReplacementSlots.push(slot);
  } else {
    slot.status = "pending";
    slot.buyerName = result.buyer?.name || "";
    slot.buyerTaxNumber = result.buyer?.taxNumber || "";
    slot.expectedCompany = companySelect.value || slot.expectedCompany;
    slot.reason = result.reason;
    if (!slot.rowId && reference.rowId) Object.assign(slot, reference);
  }
  removeFileReferences(key);
  file.invoiceTitleReplacementSlotId = slot.id;
  file.titleValidation = {
    status: result.status,
    buyerName: result.buyer?.name || "",
    buyerTaxNumber: result.buyer?.taxNumber || "",
    expectedCompany: companySelect.value || "",
    reason: result.reason,
    quarantined: true,
    checkedAt: new Date().toISOString(),
  };
  return slot;
}

function resolveInvoiceTitleReplacement(file, slot) {
  if (!slot) return;
  restoreInvoiceTitleFileToSlot(file, slot);
  slot.status = "resolved";
  slot.resolvedAt = new Date().toISOString();
  const oldKeys = new Set(state.files
    .filter((candidate) => candidate !== file && candidate.invoiceTitleReplacementSlotId === slot.id && candidate.titleValidation?.quarantined)
    .map(getFileKey));
  state.files = state.files.filter((candidate) => !oldKeys.has(getFileKey(candidate)));
  state.invoiceTitleReplacementSlots = state.invoiceTitleReplacementSlots.filter((candidate) => candidate.id !== slot.id);
  file.invoiceTitleReplacementSlotId = "";
}

function notifyInvoiceTitleIssues(slots = []) {
  if (!slots.length || typeof window.__reimbursementV2ShowInvoiceTitleIssues !== "function") return;
  window.clearTimeout(state.invoiceTitleValidationNoticeTimer);
  state.invoiceTitleValidationNoticeTimer = window.setTimeout(() => {
    const pending = getPendingInvoiceTitleReplacementSlots();
    if (pending.length) window.__reimbursementV2ShowInvoiceTitleIssues(pending);
  }, 120);
}

function shouldDeferV2InvoiceTitleValidation() {
  return document.documentElement.classList.contains("v2-ui")
    && String(state.invoiceTitleValidationCompany || "") !== String(companySelect.value || "");
}

function releaseDeferredInvoiceTitleValidation() {
  // 旧草稿可能是在本次流程改造前保存的，其中的异常发票已被提前隔离。
  // 在用户于第 5 步确认付款公司前，恢复这些附件的原明细归属并清除旧拦截记录。
  state.files.filter((file) => classifyFile(file) === "invoice").forEach((file) => {
    if (!file.titleValidation?.quarantined) return;
    restoreInvoiceTitleFileToSlot(file, getInvoiceTitleReplacementSlot(file.invoiceTitleReplacementSlotId));
    file.titleValidation = { ...file.titleValidation, status: "deferred", quarantined: false, deferred: true };
  });
  state.files.forEach((file) => { file.invoiceTitleReplacementSlotId = ""; });
  state.invoiceTitleReplacementSlots = [];
}

function revalidateInvoiceTitles({ notify = false, enforce = !shouldDeferV2InvoiceTitleValidation() } = {}) {
  if (isNoInvoiceWorkflow()) return [];
  if (!enforce) {
    releaseDeferredInvoiceTitleValidation();
    return [];
  }
  const companyName = companySelect.value || "";
  if (!companyName) return [];
  const newSlots = [];
  state.files.filter((file) => classifyFile(file) === "invoice").forEach((file) => {
    const result = getInvoiceTitleValidationResult(file, companyName);
    if (result.status === "pending" || result.status === "not_applicable") return;
    const slot = getInvoiceTitleReplacementSlot(file.invoiceTitleReplacementSlotId);
    if (result.status === "matched") {
      const wasQuarantined = Boolean(file.titleValidation?.quarantined);
      file.titleValidation = { status: "matched", buyerName: result.buyer?.name || "", buyerTaxNumber: result.buyer?.taxNumber || "", expectedCompany: companyName, reason: result.reason, quarantined: false, checkedAt: new Date().toISOString() };
      if (wasQuarantined || slot) resolveInvoiceTitleReplacement(file, slot);
      return;
    }
    if (file.titleValidation?.quarantined && slot?.expectedCompany === companyName && slot.reason === result.reason) return;
    const nextSlot = quarantineInvoiceTitleFile(file, result);
    if (nextSlot) newSlots.push(nextSlot);
  });
  if (newSlots.length && notify) notifyInvoiceTitleIssues(newSlots);
  return newSlots;
}

function addProcessingEvent(event) {
  if (!event?.token || state.processingEvents.some((item) => item.token === event.token)) return;
  state.processingEvents.push(event);
}

function getPossibleDuplicateFiles({ unresolvedOnly = false } = {}) {
  return state.files.filter((file) => (
    file.possibleDuplicateOfFileId &&
    (!unresolvedOnly || !["same", "different"].includes(file.duplicateDecision))
  ));
}

function renderCredentialProcessing() {
  if (!credentialProcessingBox) return;
  const confirmed = state.processingEvents.filter((event) => event.action === "confirmed_duplicate");
  const possible = getPossibleDuplicateFiles();
  const unresolved = possible.filter((file) => !["same", "different"].includes(file.duplicateDecision));
  const reviewedSame = possible.filter((file) => file.duplicateDecision === "same");
  const reviewedDifferent = possible.filter((file) => file.duplicateDecision === "different");
  const visible = confirmed.length || possible.length;
  credentialProcessingBox.hidden = !visible;
  if (!visible) return;

  credentialProcessingBox.classList.toggle("has-review", unresolved.length > 0);
  credentialProcessingTitle.textContent = unresolved.length
    ? `发现 ${unresolved.length} 组疑似重复凭证`
    : "系统已完成凭证归位和去重";
  credentialProcessingText.textContent = unresolved.length
    ? "疑似重复附件暂未重复计入金额，请集中核对一次；确定重复的凭证已自动合并，无需操作。"
    : "自动处理结果会随审批写入后端校验摘要，财务可以看到排除数量。";
  reviewPossibleDuplicatesButton.hidden = possible.length === 0;
  reviewPossibleDuplicatesButton.textContent = unresolved.length ? "集中确认" : "查看确认结果";

  const eventLines = [
    ...confirmed.slice(-4).map((event) => ({
      text: `已合并：${event.duplicateFileName || "重复文件"} 与 ${event.canonicalFileName || "已上传凭证"} 内容相同，未重复计入`,
      review: false,
    })),
    ...reviewedSame.slice(-3).map((file) => ({
      text: `已确认重复：${file.name} 不重复计入`,
      review: false,
    })),
    ...reviewedDifferent.slice(-3).map((file) => ({
      text: `已确认不同：${file.name} 按独立凭证计入`,
      review: false,
    })),
    ...unresolved.slice(-3).map((file) => ({
      text: `待确认：${file.name} 与 ${file.possibleDuplicateOfFileName || "已有凭证"} 信息高度相似`,
      review: true,
    })),
  ];
  credentialProcessingEvents.innerHTML = eventLines.map((item) => (
    `<span class="credential-processing-event ${item.review ? "review" : ""}">${escapeHtml(item.text)}</span>`
  )).join("");
}

function renderDuplicateReviewDialog() {
  const possible = getPossibleDuplicateFiles();
  duplicateReviewList.innerHTML = possible.map((file) => {
    const key = getFileKey(file);
    const reasons = Array.isArray(file.duplicateReasons) && file.duplicateReasons.length
      ? file.duplicateReasons.join("、")
      : "关键字段高度相似";
    const decision = file.duplicateDecision || "same";
    return `
      <article class="duplicate-review-item">
        <strong><button type="button" class="duplicate-review-file-preview" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(file.name)}</button> ↔ ${escapeHtml(file.possibleDuplicateOfFileName || "已有凭证")}</strong>
        <small>识别依据：${escapeHtml(reasons)}。系统暂未让该文件重复计入金额。</small>
        <select data-duplicate-review-key="${escapeHtml(key)}">
          <option value="same" ${decision === "same" ? "selected" : ""}>按同一凭证处理（推荐）</option>
          <option value="different" ${decision === "different" ? "selected" : ""}>这是两张不同凭证</option>
        </select>
      </article>
    `;
  }).join("");
}

function openDuplicateReviewDialog({ resumeSubmit = false } = {}) {
  if (!getPossibleDuplicateFiles().length) return false;
  state.resumeSubmitAfterDuplicateReview = Boolean(resumeSubmit);
  renderDuplicateReviewDialog();
  if (!duplicateReviewDialog.open) duplicateReviewDialog.showModal();
  return true;
}

function saveDuplicateReview() {
  duplicateReviewList.querySelectorAll("[data-duplicate-review-key]").forEach((select) => {
    const file = getFileByKey(select.dataset.duplicateReviewKey);
    if (file) file.duplicateDecision = select.value === "different" ? "different" : "same";
  });
  const resumeSubmit = state.resumeSubmitAfterDuplicateReview;
  state.resumeSubmitAfterDuplicateReview = false;
  duplicateReviewDialog.close();
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncDraft();
  if (resumeSubmit) window.setTimeout(() => form.requestSubmit(), 0);
}

function getFileExtension(fileName) {
  const name = String(fileName || "").trim();
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
}

function canRenameUploadedEvidence(file) {
  return Boolean(
    file?.dingtalkAttachment?.fileId
    && !file.uploading
    && ["payment", "invoice"].includes(classifyFile(file)),
  );
}

function normalizeRenamedEvidenceFileName(value, originalName) {
  const next = String(value || "").trim().replace(/\s+/g, " ");
  const extension = getFileExtension(originalName);
  if (!next) return { error: "请输入文件名称。" };
  if (next.length > 160) return { error: "文件名不能超过 160 个字符。" };
  if (/[\\/:*?"<>|\u0000-\u001f]/u.test(next)) return { error: "文件名不能包含 \\ / : * ? \" < > | 等字符。" };
  if (!extension) return { error: "原文件缺少扩展名，不能安全改名。" };
  if (!next.toLowerCase().endsWith(extension.toLowerCase())) {
    return { error: `文件扩展名必须保留为 ${extension}。` };
  }
  if (next.length <= extension.length) return { error: "请填写扩展名前的文件名称。" };
  return { fileName: next };
}

function closeAttachmentRenameDialog() {
  state.renamingFileKey = "";
  attachmentRenameInput?.setCustomValidity("");
  if (attachmentRenameDialog?.open) attachmentRenameDialog.close();
}

function openAttachmentRenameDialog(file) {
  if (!canRenameUploadedEvidence(file)) {
    addMessage("bot", "请等待付款截图或发票上传并完成 OCR 后再修改显示名称。改名不会重新上传或重新识别。 ");
    return false;
  }
  // Older restored drafts can predate clientUploadId and use the filename as
  // their row-assignment key. Freeze that existing key before changing name
  // so the attachment remains assigned to the same reimbursement row.
  if (!file.clientUploadId) file.clientUploadId = getFileKey(file);
  state.renamingFileKey = getFileKey(file);
  attachmentRenameInput.value = file.name || file.dingtalkAttachment?.fileName || "";
  attachmentRenameHint.textContent = `仅修改本次报销和钉钉 OA 中显示的名称；文件扩展名 ${getFileExtension(file.name)} 必须保留，不会重新上传或调用 OCR。`;
  attachmentRenameStatus.textContent = "";
  attachmentRenameInput.setCustomValidity("");
  if (!attachmentRenameDialog.open) attachmentRenameDialog.showModal();
  window.setTimeout(() => attachmentRenameInput.select(), 0);
  return true;
}

function saveAttachmentRename() {
  const file = getFileByKey(state.renamingFileKey);
  if (!file || !canRenameUploadedEvidence(file)) {
    closeAttachmentRenameDialog();
    addMessage("bot", "该附件当前不可修改名称，请刷新后重试。 ");
    return false;
  }
  const result = normalizeRenamedEvidenceFileName(attachmentRenameInput.value, file.name || file.dingtalkAttachment?.fileName);
  if (result.error) {
    attachmentRenameInput.setCustomValidity(result.error);
    attachmentRenameStatus.textContent = result.error;
    attachmentRenameInput.reportValidity();
    return false;
  }
  const originalFileName = file.name;
  if (result.fileName === originalFileName) {
    closeAttachmentRenameDialog();
    return true;
  }
  // The upload receipt and OCR evidence remain bound to the immutable fileId.
  // Only the display name carried in this submission's OA attachment changes.
  file.name = result.fileName;
  file.dingtalkAttachment = { ...file.dingtalkAttachment, fileName: result.fileName, name: result.fileName };
  if (file.uploadResponse?.attachment) {
    file.uploadResponse = {
      ...file.uploadResponse,
      attachment: { ...file.uploadResponse.attachment, fileName: result.fileName, name: result.fileName },
    };
  }
  queueClientAuditEvent("attachment_renamed", {
    action: "attachment_renamed",
    attachment: { fileId: file.dingtalkAttachment.fileId, fileName: result.fileName, kind: classifyFile(file), attached: true },
  });
  closeAttachmentRenameDialog();
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncDraft();
  addMessage("bot", `已将附件显示名称改为“${result.fileName}”，未重新上传或 OCR 识别。`);
  return true;
}

function renderFiles() {
  filesList.innerHTML = "";
  const paymentCount = getFilesByType("payment").length;
  const invoiceCount = getFilesByType("invoice").length;
  const otherCount = getFilesByType("other").length;
  const activeFileCount = state.files.filter((file) => !file?.titleValidation?.quarantined).length;
  const titleHoldCount = getPendingInvoiceTitleReplacementSlots().length;
  const noInvoice = isNoInvoiceWorkflow();
  if (attachmentDockSummary) {
    attachmentDockSummary.textContent = `已上传 ${activeFileCount} 个 · 付款 ${paymentCount} · 发票 ${invoiceCount} · 其他 ${otherCount}${titleHoldCount ? ` · 待补充发票 ${titleHoldCount}` : ""}`;
  }
  if (assignAttachmentsButton) assignAttachmentsButton.hidden = activeFileCount === 0;
  if (attachmentDock) attachmentDock.classList.toggle("is-expanded", state.attachmentDockExpanded);
  if (toggleAttachmentDockButton) {
    toggleAttachmentDockButton.textContent = state.attachmentDockExpanded ? "收起" : "展开";
    toggleAttachmentDockButton.hidden = activeFileCount === 0;
  }
  const groups = [
    { type: "payment", title: "付款截图/订单截图", empty: "未上传付款截图/订单截图" },
    ...(!noInvoice ? [{ type: "invoice", title: "发票附件", empty: "未上传发票附件" }] : []),
    { type: "other", title: "其他附件", empty: "未上传其他附件" },
  ];

  groups.forEach((group) => {
    const files = getFilesByType(group.type);
    const groupEl = document.createElement("section");
    groupEl.className = "file-group";
    groupEl.innerHTML = `<h3>${group.title}</h3>`;

    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "empty-files";
      empty.textContent = group.empty;
      groupEl.append(empty);
      filesList.append(groupEl);
      return;
    }

    files.forEach((file) => {
      const key = getFileKey(file);
      const card = document.createElement("article");
      const ocrStatus = getOcrStatusLabel(file);
      card.className = `file-card ${file.uploadError ? "upload-error" : ""} ${file.possibleDuplicateOfFileId ? "duplicate-review" : ""}`;
      card.innerHTML = `
        <div class="file-type">${file.name.split(".").pop().slice(0, 4).toUpperCase()}</div>
        <div>
          <button class="file-name file-preview-button" type="button" data-action="preview-file" data-key="${escapeHtml(key)}" title="点击预览附件">${escapeHtml(file.name)}</button>
          <div class="file-meta">${(file.size / 1024).toFixed(1)} KB · ${getOcrRiskLabel(file) && getOcrCandidateLabel(file) ? `候选金额：${getOcrCandidateLabel(file)}` : `识别金额：${getRawOcrAmount(file) || "待 OCR"}`}${getManualOcrAmount(file) ? ` · 人工确认：${getManualOcrAmount(file)}` : ""}${file.possibleDuplicateOfFileId ? ` · 重复核对：${file.duplicateDecision === "different" ? "已确认不同" : file.duplicateDecision === "same" ? "已确认重复、不计金额" : "待集中确认、暂不计金额"}` : ""}${getOcrRiskLabel(file) ? ` · 风险：${getOcrRiskLabel(file)}` : ""} · ${ocrStatus} · ${getUploadStatusText(file)}</div>
          <div class="file-assignment">${escapeHtml(getFileAssignmentText(file))}</div>
        </div>
        <span class="tag">${group.title}</span>
        ${canRenameUploadedEvidence(file) ? `<button class="text-button rename-file" type="button" data-key="${escapeHtml(key)}" title="仅修改本次报销中显示的文件名称，不会重新上传或识别">修改名称</button>` : ""}
        <button class="remove-file" type="button" data-key="${key}" title="彻底从本次草稿删除附件">删除附件</button>
      `;
      groupEl.append(card);
    });

    filesList.append(groupEl);
  });
  renderCredentialProcessing();
}

function renderIdentity() {
  const departments = isOnBehalfRoute()
    ? (state.pendingOnBehalfSubject?.userId === state.submissionRoute?.subjectUserId
      ? state.pendingOnBehalfSubject?.departments || []
      : [])
    : state.user?.departments || [];
  departmentSelect.innerHTML = "";

  if (!state.user) {
    identityBox.classList.add("warn");
    identityStatus.textContent = "未获取到钉钉登录信息。请在钉钉工作台内打开应用。";
    departmentField.hidden = true;
    renderCompanyOptions({ applyDefault: false });
    return;
  }

  identityBox.classList.remove("warn");
  identityStatus.textContent = isOnBehalfRoute()
    ? `操作人：${state.user.name}（${state.user.userId}） · 归属人：${state.submissionRoute.subjectName}（${state.submissionRoute.subjectUserId}）`
    : `${state.user.name}（${state.user.userId}）`;
  departments.forEach((department) => {
    const option = document.createElement("option");
    option.value = department.id;
    option.textContent = department.name;
    departmentSelect.append(option);
  });
  departmentField.hidden = departments.length === 0;
  renderCompanyOptions();
}

function renderWorkflowForm() {
  const workflow = currentWorkflow();
  const isTravel = workflow.targetType === "travel";
  const isDaily = workflow.targetType === "daily";
  const isOtherDaily = workflow.id === "other";
  const relatedDriven = isRelatedDrivenWorkflow(workflow);
  const noInvoice = isNoInvoiceWorkflow(workflow);

  targetFormTitle.textContent = workflow.targetName;
  workflowTitle.textContent = workflow.title;
  workflowDescription.textContent = workflow.description;
  businessDateLabel.textContent = workflow.fields?.dateLabel || "业务实际发生时间";
  reasonLabel.textContent = workflow.fields?.reasonLabel || "申请事由";
  reasonInput.placeholder = workflow.fields?.reasonPlaceholder || "重点突出，简明扼要";
  amountLabel.textContent = isDaily || isTravel ? "总报销金额" : (workflow.fields?.amountLabel || "金额");

  dailyDetailSection.hidden = !isDaily;
  travelDetailSection.hidden = !isTravel;
  dailyPreviewSection.hidden = !isDaily;
  businessDateInput.closest("label").hidden = isDaily || isTravel;
  reasonInput.closest("label").hidden = isDaily || isTravel;
  amountInput.closest("label").hidden = false;
  // A travel draft can have attachment assignments before its detail rows are
  // fully priced. Keeping this editable lets the applicant enter the verified
  // total instead of trapping the field at 0.00; row-level validation still
  // protects the final OA submission.
  amountInput.readOnly = false;
  amountInput.title = isTravel
    ? "可手动填写总报销金额；提交前仍会校验每行差旅明细及付款、发票金额。"
    : "填写本次实际报销总额。";
  amountUpperInput.closest("label").hidden = false;
  expenseTypeField.hidden = true;
  projectField.hidden = true;
  invoiceTypeField.hidden = true;
  placeDailyMetaControls(isDaily);
  companyField.hidden = !isDaily && !isTravel;
  companySelect.required = isDaily || isTravel;
  otherRemarkField.hidden = isTravel;
  remarkField.hidden = isDaily;
  paymentDropZone.hidden = false;
  invoiceDropZone.hidden = noInvoice;
  otherDropZone.hidden = isTravel;
  if (invoiceFilesInput?.closest("label")) invoiceFilesInput.closest("label").hidden = noInvoice;
  if (invoiceDetectedSummary) invoiceDetectedSummary.hidden = noInvoice;
  if (invoiceSummaryStat) invoiceSummaryStat.hidden = noInvoice;
  $("#assignmentUploadInvoice")?.toggleAttribute("hidden", noInvoice);
  if (assistantPanel && attachmentDock && oaFormSection) {
    // Users must create detail rows before bulk attachment allocation.
    assistantPanel.insertBefore(attachmentDock, oaFormSection);
  }
  dailyDetailHint.hidden = !isDaily;
  dailyDetailHint.textContent = noInvoice
    ? "操作顺序：1. 填写费用明细；2. 批量上传付款截图或订单截图；3. 在附件工作台分配到对应明细并确认金额；4. 系统仅校验付款凭证、明细合计和总报销金额。无票入口不上传发票，提交后仍由审批人进行人工审核。"
    : isDaily
    ? "操作顺序：1. 可新增明细或导入 Excel（缺付款截图或发票的行会自动剔除）；2. 批量上传实际付款截图和发票；3. 系统仅在唯一文件名或唯一 OCR 金额匹配时自动分配，其余请确认；4. 核对后提交。单元格右下角的小方块可向下拖动复制字段；附件不会复制，避免重复占用。"
    : "";

  if (isDaily && relatedDriven) {
    dailyDetailHint.textContent = `操作顺序：1. 先选择${workflow.related?.label || "关联审批"}，系统将自动生成对应费用明细；2. 在下方附件工作台批量上传附件；3. 按关联审批分配附件，金额、日期等可确认字段会自动回填，申请事由请手工填写；付款截图合计可一键填入金额；4. 核对后提交。仅有拆分需求时再新增费用明细。`;
  }
  if (isDaily && state.dailyImportNotice) {
    dailyDetailHint.textContent = state.dailyImportNotice;
  }
  if (travelDetailHint) {
    travelDetailHint.textContent = relatedDriven
      ? "操作顺序：1. 先选择关联出差申请，系统将自动生成对应费用明细；2. 批量上传付款截图和发票；3. 在附件工作台按关联审批分配；4. 金额、日期等可确认字段会自动回填，费用说明请手工填写；付款截图合计可一键填入金额，核对后提交。仅有拆分需求时再新增费用明细。"
      : "每一行会同步写入钉钉差旅报销单的表格。请先选择关联出差申请，再将付款截图和发票附件分配到对应行。";
  }
  if (addDailyRowButton) addDailyRowButton.textContent = relatedDriven ? "拆分明细" : "新增一行";
  if (importExpenseSheetButton) importExpenseSheetButton.hidden = !isDaily || relatedDriven || noInvoice;
  if (addTravelRowButton) addTravelRowButton.textContent = relatedDriven ? "拆分明细" : "新增一行";

  if (bulkUploadTip) {
    if (relatedDriven) {
      bulkUploadTip.textContent = "操作顺序：先选择关联审批，系统会自动生成对应费用明细；可一次性上传全部附件，再按关联审批分配。付款截图金额为报销金额的核对基准。";
    } else {
    bulkUploadTip.textContent = isTravel
      ? "操作顺序：先在上方为每个关联出差申请填写费用明细，再批量上传附件并分配到对应明细。付款截图金额为报销金额的核对基准。"
      : noInvoice
        ? "操作顺序：先完成费用明细，再一次性上传付款截图或订单截图，最后点击“分配附件”归入对应行。无票入口只校验付款凭证和金额一致性，提交后仍由审批人审核。"
      : isDaily
        ? "操作顺序：先完成上方费用明细，再一次性上传本次报销的付款截图和发票，最后点击“分配附件”归入对应行。"
        : "可一次性选择本次报销的全部付款截图和发票，上传后再进行核对。";
    }
  }

  if (isTravel) {
    ensureTravelRows();
    renderTravelRows();
    syncTravelTotal();
  }

  if (workflow.related) {
    const source = getCurrentRelatedSource(workflow);
    if (source) state.relatedSourceKey = source.key;
    if (leftRelatedMount && relatedBox.parentElement !== leftRelatedMount) {
      leftRelatedMount.append(relatedBox);
    }
    relatedBox.classList.add("left-related-box");
    relatedBox.hidden = false;
    relatedTitle.textContent = workflow.related.label;
    relatedHint.textContent = workflow.related.hint;
    renderRelatedSourceOptions();
    loadRelatedButton.textContent = source ? `查询近一年${source.label}` : "查询近期审批";
    relatedManualField.hidden = false;
  } else {
    relatedBox.hidden = true;
    state.selectedRelated = [];
    relatedManualInput.value = "";
    relatedSelect.hidden = true;
    relatedSelect.innerHTML = "";
    if (relatedSourceOptions) {
      relatedSourceOptions.hidden = true;
      relatedSourceOptions.innerHTML = "";
    }
    relatedStatus.textContent = "本流程无需关联前置审批。";
  }

  if (isDaily) applyDailyRowWorkflowDefaults();

  const relatedPolicy = workflow.related
    ? (workflow.related.required
      ? `${workflow.related.label}为必选项；提交时会直写 OA 关联审批组件，并在备注中保留摘要。`
      : "可先按业务需要添加出差、外出或团建审批；填写打车、出差车票或团建费用后，系统会在提交前检查对应审批。")
    : "本流程无需关联前置审批，系统已隐藏关联审批查询入口。";
  riskBox.innerHTML = `
    <strong>当前策略</strong>
    <p>${workflow.targetName}。${relatedPolicy}${noInvoice ? "无票入口仅校验付款截图确认金额与费用明细、总报销金额一致；不要求发票附件，最终仍由审批人进行人工审核。" : isDaily ? "日常报销会按左侧费用明细逐行写入 OA 表格组件；右侧总报销金额需与付款截图识别总额、明细合计保持一致。" : "当前校验总报销金额、付款截图识别总额与发票识别总额；以付款截图金额为准，发票金额可高于付款金额。"}</p>
  `;
  renderDailyRows();
  renderFiles();
  syncDraft();
}

function renderDraftToggle() {
  appShell.classList.toggle("draft-collapsed", state.draftCollapsed);
  if (toggleDraftButton) toggleDraftButton.textContent = state.draftCollapsed ? "显示右侧表单" : "隐藏右侧表单";
  floatingDraftButton.hidden = !state.draftCollapsed;
}

function setDraftCollapsed(collapsed) {
  state.draftCollapsed = Boolean(collapsed);
  renderDraftToggle();
}

function serializeDraftFile(file) {
  return {
    clientUploadId: file.clientUploadId || "",
    name: file.name || "",
    type: file.type || "",
    size: Number(file.size) || 0,
    lastModified: Number(file.lastModified) || 0,
    kind: classifyFile(file),
    detectedAmount: file.detectedAmount || "",
    manualAmount: file.manualAmount || "",
    dingtalkAttachment: file.dingtalkAttachment || null,
    evidenceToken: file.evidenceToken || "",
    possibleDuplicateOfFileId: file.possibleDuplicateOfFileId || "",
    possibleDuplicateOfFileName: file.possibleDuplicateOfFileName || "",
    duplicateReasons: Array.isArray(file.duplicateReasons) ? file.duplicateReasons : [],
    duplicateDecision: file.duplicateDecision || "",
    ocr: file.ocr || null,
    uploadError: file.uploadError || "",
    uploadResponse: file.uploadResponse || null,
    relatedInstanceId: file.relatedInstanceId || "",
    relatedAutoAssigned: Boolean(file.relatedAutoAssigned),
    titleValidation: file.titleValidation || null,
    invoiceTitleReplacementSlotId: file.invoiceTitleReplacementSlotId || "",
    uploadTargetRowId: file.uploadTargetRowId || "",
  };
}

function restoreDraftFile(file) {
  const restored = { ...file };
  restored.clientUploadId = file.clientUploadId || "";
  restored.kind = file.kind || "other";
  restored.name = file.name || "草稿附件";
  restored.type = file.type || "";
  restored.size = Number(file.size) || 0;
  restored.lastModified = Number(file.lastModified) || 0;
  restored.detectedAmount = file.detectedAmount || "";
  restored.manualAmount = file.manualAmount || "";
  restored.dingtalkAttachment = file.dingtalkAttachment || null;
  restored.evidenceToken = file.evidenceToken || "";
  restored.possibleDuplicateOfFileId = file.possibleDuplicateOfFileId || "";
  restored.possibleDuplicateOfFileName = file.possibleDuplicateOfFileName || "";
  restored.duplicateReasons = Array.isArray(file.duplicateReasons) ? file.duplicateReasons : [];
  restored.duplicateDecision = file.duplicateDecision || "";
  restored.ocr = file.ocr || null;
  restored.uploadResponse = file.uploadResponse || null;
  restored.relatedInstanceId = file.relatedInstanceId || "";
  restored.relatedAutoAssigned = Boolean(file.relatedAutoAssigned);
  restored.titleValidation = file.titleValidation || null;
  restored.invoiceTitleReplacementSlotId = file.invoiceTitleReplacementSlotId || "";
  restored.uploadTargetRowId = file.uploadTargetRowId || "";
  restored.uploading = false;
  restored.uploadError = file.uploadError || (file.dingtalkAttachment ? "" : "草稿中的本地附件需重新上传");
  return restored;
}

function collectDraftData() {
  if (currentWorkflow().targetType === "daily") readDailyRowsFromDom();
  if (currentWorkflow().targetType === "travel") readTravelRowsFromDom();
  return {
    ownerUserId: state.user?.userId || "",
    savedAt: new Date().toISOString(),
    workflowId: state.workflowId,
    submissionId: state.submissionId,
    submissionRoute: getSubmissionRoutePayload(),
    selectedRelated: state.selectedRelated,
    relatedSourceKey: state.relatedSourceKey,
    attachmentDockExpanded: state.attachmentDockExpanded,
    processingEvents: state.processingEvents,
    invoiceTitleReplacementSlots: state.invoiceTitleReplacementSlots,
    invoiceTitleValidationCompany: state.invoiceTitleValidationCompany,
    companyRecognition: {
      companySelectionSource: state.companySelectionSource,
      recognizedCompanyName: getSocialCompanyRecognition()?.companyName || "",
      recognitionStatus: getSocialCompanyRecognition()?.status || "",
      recognitionCheckedAt: getSocialCompanyRecognition()?.checkedAt || "",
      manualOverride: state.manualCompanyOverride,
    },
    files: state.files.map(serializeDraftFile),
    dailyRows: state.dailyRows,
    travelRows: state.travelRows,
    form: {
      businessDate: businessDateInput.value,
      reason: reasonInput.value,
      amount: amountInput.value,
      expenseType: expenseTypeSelect.value,
      project: projectSelect.value,
      invoiceType: invoiceTypeSelect.value,
      companyName: companySelect.value,
      remark: remarkInput.value,
      otherRemark: otherRemarkInput.value,
      recipientAccountText: recipientAccountTextInput.value,
      selectedRecipientAccountId: state.selectedRecipientAccountId,
      relatedManual: relatedManualInput.value,
    },
  };
}

function getDraftStorageKey(userId = state.user?.userId) {
  return userId ? `${DRAFT_STORAGE_KEY_PREFIX}:${userId}` : "";
}

function readStoredDraft(storageKey) {
  if (!storageKey) return null;
  try {
    const draft = JSON.parse(localStorage.getItem(storageKey) || "null");
    return draft && typeof draft === "object" ? draft : null;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function hasRestorableDraft(draft) {
  if (!draft || typeof draft !== "object") return false;
  const values = draft.form || {};
  const hasText = [
    values.reason, values.amount, values.project, values.invoiceType, values.companyName,
    values.remark, values.otherRemark, values.recipientAccountText, values.relatedManual,
  ].some((value) => String(value || "").trim());
  const hasFiles = Array.isArray(draft.files) && draft.files.length > 0;
  const hasRelated = Array.isArray(draft.selectedRelated) && draft.selectedRelated.length > 0;
  const hasMeaningfulRows = Array.isArray(draft.dailyRows) && draft.dailyRows.some((row) => [
    row.reason, row.amount, row.project, row.invoiceType, row.remark,
    ...(row.paymentFileKeys || []), ...(row.invoiceFileKeys || []),
  ].some((value) => String(value || "").trim()));
  const hasMeaningfulTravelRows = Array.isArray(draft.travelRows) && draft.travelRows.some((row) => [
    row.reason, row.amount, row.businessDate, row.expenseType,
    ...(row.paymentFileKeys || []), ...(row.invoiceFileKeys || []),
  ].some((value) => String(value || "").trim()));
  return hasText || hasFiles || hasRelated || hasMeaningfulRows || hasMeaningfulTravelRows;
}

function saveDraft(silent = false) {
  const storageKey = getDraftStorageKey();
  if (!storageKey || state.draftRestorePending) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(collectDraftData()));
    if (saveDraftButton) {
      saveDraftButton.textContent = silent ? "已自动保存" : "已保存";
      saveDraftButton.title = `最近保存：${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
    }
    if (!silent) addMessage("bot", "草稿已保存到当前钉钉账号的本机浏览器记录中。");
    window.setTimeout(() => {
      if (saveDraftButton) saveDraftButton.textContent = "保存草稿";
    }, 1600);
    return true;
  } catch (error) {
    if (!silent) addMessage("bot", `草稿保存失败：${error.message}`);
    return false;
  }
}

function scheduleAutoSave() {
  if (!state.user || state.draftRestorePending) return;
  if (state.autoSaveTimer) window.clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = window.setTimeout(() => {
    state.autoSaveTimer = 0;
    saveDraft(true);
  }, AUTO_SAVE_DELAY_MS);
}

function clearSavedDraft(includeLegacy = true) {
  if (state.autoSaveTimer) window.clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = 0;
  try {
    const storageKey = getDraftStorageKey();
    if (storageKey) localStorage.removeItem(storageKey);
    if (includeLegacy) localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY);
  } catch (error) {
    // Ignore storage cleanup failures.
  }
}

function createSubmissionId() {
  return window.crypto?.randomUUID?.() || `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureSubmissionId() {
  if (!state.submissionId) state.submissionId = createSubmissionId();
  return state.submissionId;
}

function isSubmissionLocked() {
  return state.submissionStatus === "succeeded";
}

function markSubmissionSucceeded(instanceId) {
  state.submissionStatus = "succeeded";
  state.submittedInstanceId = String(instanceId || "");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "审批已发起";
  }
}

function markSubmissionEditable() {
  state.submissionStatus = "editing";
  state.submittedInstanceId = "";
}

function restoreSavedDraft(draft) {
  if (!draft || typeof draft !== "object") return false;

  // 草稿只恢复填写内容和附件，不恢复 workflowId。入口属于当前这次填写，
  // 不能因为旧草稿曾经走过出差流程，就在刷新后强制用户继续填写差旅报销。
  // 这里还要显式重置当前状态：钉钉 WebView 可能复用上一次页面实例，
  // 仅仅“不读取 draft.workflowId”并不能清掉页面上残留的差旅入口状态。
  state.workflowId = DEFAULT_WORKFLOW_ID;
  state.submissionId = String(draft.submissionId || "");
  const savedRoute = draft.submissionRoute && typeof draft.submissionRoute === "object" ? draft.submissionRoute : {};
  state.submissionRoute = {
    mode: savedRoute.mode === "on_behalf" ? "on_behalf" : "self",
    subjectUserId: String(savedRoute.subjectUserId || ""),
    subjectName: String(savedRoute.subjectName || ""),
    departmentId: String(savedRoute.departmentId || ""),
    departmentName: String(savedRoute.departmentName || ""),
    socialCompanyRecognition: savedRoute.socialCompanyRecognition || null,
  };
  if (state.submissionRoute.mode === "on_behalf" && state.submissionRoute.subjectUserId) {
    state.pendingOnBehalfSubject = {
      userId: state.submissionRoute.subjectUserId,
      name: state.submissionRoute.subjectName,
      departments: Array.isArray(savedRoute.subjectDepartments) ? savedRoute.subjectDepartments : [],
      socialCompanyRecognition: state.submissionRoute.socialCompanyRecognition,
    };
  } else {
    state.pendingOnBehalfSubject = null;
  }
  state.submissionStatus = "editing";
  state.submittedInstanceId = "";
  state.selectedRelated = Array.isArray(draft.selectedRelated)
    ? draft.selectedRelated
    : (draft.selectedRelated?.processInstanceId ? [draft.selectedRelated] : []);
  state.relatedSourceKey = String(draft.relatedSourceKey || "");
  state.attachmentDockExpanded = Boolean(draft.attachmentDockExpanded);
  state.processingEvents = Array.isArray(draft.processingEvents) ? draft.processingEvents : [];
  state.invoiceTitleReplacementSlots = Array.isArray(draft.invoiceTitleReplacementSlots) ? draft.invoiceTitleReplacementSlots : [];
  state.invoiceTitleValidationCompany = String(draft.invoiceTitleValidationCompany || "");
  state.companySelectionSource = String(draft.companyRecognition?.companySelectionSource || "manual");
  state.manualCompanyOverride = Boolean(draft.companyRecognition?.manualOverride);
  state.files = Array.isArray(draft.files) ? draft.files.map(restoreDraftFile) : [];
  // Drafts saved before the delete fix can contain a replacement slot whose
  // file was already removed. Do not revive that stale blocker on restore.
  pruneOrphanedInvoiceTitleReplacementSlots();
  state.dailyRows = Array.isArray(draft.dailyRows) && draft.dailyRows.length
    ? draft.dailyRows.map((row) => createDailyRow(row))
    : state.dailyRows;
  state.travelRows = Array.isArray(draft.travelRows)
    ? draft.travelRows.map((row) => createTravelRow(row))
    : state.travelRows;
  // 补传附件在刷新前已经获得服务端回执时，按其原始目标明细再次归属。
  // 这避免旧草稿只保留文件、却在异步渲染期间丢掉第二行关联。
  reconcileUploadedTargetAssignments();
  syncRelatedDrivenRows();
  syncAssignedRowAmountsFromPayments();

  const values = draft.form || {};
  businessDateInput.value = values.businessDate || businessDateInput.value;
  reasonInput.value = values.reason || "";
  amountInput.value = values.amount || "";
  expenseTypeSelect.value = values.expenseType || "";
  projectSelect.value = values.project || "";
  invoiceTypeSelect.value = values.invoiceType || "";
  companySelect.value = values.companyName || "";
  // A saved company is never silently replaced.  If HR now identifies another
  // social-security entity, the user receives an explicit choice instead.
  applySocialCompanyRecognition({ promptOnConflict: true, notify: false });
  remarkInput.value = values.remark || "";
  otherRemarkInput.value = values.otherRemark || "";
  recipientAccountTextInput.value = values.recipientAccountText || "";
  if (recipientAccountTextInput.value.trim()) clearRecipientAccountValidity();
  state.selectedRecipientAccountId = values.selectedRecipientAccountId || "";
  relatedManualInput.value = values.relatedManual || "";
  renderIdentity();
  renderSubmissionRoute();
  return true;
}

function getDraftRestoreCandidate() {
  const scopedDraft = readStoredDraft(getDraftStorageKey());
  if (hasRestorableDraft(scopedDraft)) return { draft: scopedDraft, legacy: false };
  const legacyDraft = readStoredDraft(LEGACY_DRAFT_STORAGE_KEY);
  if (hasRestorableDraft(legacyDraft)) return { draft: legacyDraft, legacy: true };
  return null;
}

function promptDraftRestore() {
  const candidate = getDraftRestoreCandidate();
  state.pendingDraftCandidate = candidate;
  state.draftRestorePending = Boolean(candidate);
  if (!candidate) {
    scheduleAutoSave();
    return false;
  }
  const savedAt = candidate.draft.savedAt ? new Date(candidate.draft.savedAt) : null;
  const formattedTime = savedAt && !Number.isNaN(savedAt.getTime())
    ? savedAt.toLocaleString("zh-CN", { hour12: false })
    : "上次";
  draftRestoreText.textContent = `检测到${formattedTime}保存的未完成草稿，是否恢复后继续填写？`;
  if (!draftRestoreDialog.open) draftRestoreDialog.showModal();
  return true;
}

function syncDraft() {
  const workflow = currentWorkflow();
  const isDaily = workflow.targetType === "daily";
  const isTravel = workflow.targetType === "travel";
  const noInvoice = isNoInvoiceWorkflow(workflow);
  if (isDaily) readDailyRowsFromDom();
  if (isTravel) {
    readTravelRowsFromDom();
  }
  const dailyTotal = getDailyRowsTotal();
  const travelTotal = getTravelRowsTotal();
  const amountValue = amountInput.value.trim();
  const payments = getFilesByType("payment");
  const invoices = noInvoice ? [] : getFilesByType("invoice");
  const paymentAmounts = payments.map(getOcrAmount).filter(Boolean);
  const invoiceAmounts = invoices.map(getOcrAmount).filter(Boolean);
  const paymentTotal = getDetectedAmountTotal("payment");
  const invoiceTotal = noInvoice ? 0 : getDetectedAmountTotal("invoice");
  const uploadProgress = getUploadProgress();
  const enteredAmount = toMoneyNumber(amountValue);
  const missingAmount = !enteredAmount;
  const detailTotal = isTravel ? travelTotal : dailyTotal;
  const amountMismatch = enteredAmount > 0 && (
    (paymentTotal > 0 && enteredAmount - paymentTotal > AMOUNT_TOLERANCE) ||
    (detailTotal > 0 && Math.abs(enteredAmount - detailTotal) > AMOUNT_TOLERANCE)
  );
  const audit = buildAuditReport({ invoiceType: invoiceTypeSelect.value || "" }, amountValue, workflow);
  const riskBlocked = audit.errors.length > 0;

  if (isDaily) {
    dailyTableTotal.textContent = formatMoney(dailyTotal) || "0.00";
    renderDailyPreview();
  }
  if (isTravel && travelTableTotal) travelTableTotal.textContent = formatMoney(travelTotal) || "0.00";
  amountUpperInput.value = amountValue && Number.isFinite(Number(amountValue)) ? amountToChinese(amountValue) : "";
  paymentFilesInput.value = payments.map((file) => file.name).join(", ");
  invoiceFilesInput.value = invoices.map((file) => file.name).join(", ");
  paymentDetectedAmountInput.value = paymentAmounts.length ? `${paymentAmounts.join(", ")}；合计 ${formatMoney(paymentTotal)}` : "待 OCR";
  invoiceDetectedAmountInput.value = invoiceAmounts.length ? `${invoiceAmounts.join(", ")}；合计 ${formatMoney(invoiceTotal)}` : "待 OCR";
  renderDetectedSummary({
    amounts: paymentAmounts,
    total: paymentTotal,
    totalEl: paymentDetectedTotal,
    listEl: paymentDetectedList,
  });
  renderDetectedSummary({
    amounts: invoiceAmounts,
    total: invoiceTotal,
    totalEl: invoiceDetectedTotal,
    listEl: invoiceDetectedList,
  });
  renderUploadProgress(uploadProgress);
  renderAmountCheck({ amountValue, dailyTotal: isTravel ? travelTotal : dailyTotal, paymentTotal, invoiceTotal });
  attachmentCount.textContent = state.files.filter((file) => !file?.titleValidation?.quarantined).length;
  paymentCount.textContent = payments.length;
  invoiceCount.textContent = invoices.length;
  draftStatus.textContent = uploadProgress.pending ? "识别中" : (missingAmount ? "待填写" : ((amountMismatch || riskBlocked) ? "风险拦截" : "可提交"));
  if (submitButton) {
    if (isSubmissionLocked()) {
      submitButton.disabled = true;
      submitButton.textContent = "审批已发起";
    } else if (state.submissionStatus === "submitting") {
      submitButton.disabled = true;
      submitButton.textContent = "正在发起审批";
    } else {
      submitButton.disabled = uploadProgress.pending > 0 || missingAmount || amountMismatch || riskBlocked;
      submitButton.textContent = uploadProgress.pending
        ? `识别中 ${uploadProgress.completed}/${uploadProgress.total}`
        : (missingAmount ? "填写总报销金额" : ((amountMismatch || riskBlocked) ? "高风险已拦截" : "提交钉钉 OA"));
    }
  }
  scheduleAutoSave();
  scheduleClientAuditCheckpoint("draft_changed");
}

async function uploadFileToServer(file) {
  if (!state.sessionToken || file.uploading || file.dingtalkAttachment) return;
  if (!(file instanceof File)) {
    file.uploadError = file.uploadError || "草稿中的本地附件需重新上传";
    renderFiles();
    syncDraft();
    return;
  }

  file.ocrQueueing = false;
  file.uploading = true;
  file.uploadError = "";
  queueClientAuditEvent("attachment_upload_started", { action: "upload_started", attachment: summarizeClientAuditAttachment(file) });
  renderFiles();
  if (attachmentAssignmentDialog?.open) renderAttachmentAssignments();
  syncDraft();

  try {
    const result = await withDingTalkSessionRetry(async () => {
      const formData = new FormData();
      formData.append("session_token", state.sessionToken);
      // Correlate the binary upload with the existing client operation trace.
      // This value is diagnostics-only and is never trusted for ownership.
      formData.append("trace_id", getClientAuditTraceId());
      formData.append("kind", classifyFile(file));
      formData.append("no_invoice", isNoInvoiceWorkflow() ? "1" : "0");
      if (file.uploadTargetRowId) formData.append("target_row_id", file.uploadTargetRowId);
      formData.append("file", file, file.name);
      const response = await fetch(`${getApiBase()}/api/files/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw createApiError(payload.error || "附件上传失败", response.status);
      return payload;
    }, "上传附件");

    const uploaded = result.files?.[0];
    if (!uploaded?.attachment?.fileId) throw new Error("钉钉未返回附件 fileId");
    if (uploaded.duplicate) {
      const key = getFileKey(file);
      const canonical = state.files.find((item) => String(item?.dingtalkAttachment?.fileId || "") === String(uploaded.duplicateOfFileId || uploaded.attachment?.fileId || ""));
      addProcessingEvent({
        token: uploaded.processingEventToken || "",
        action: "confirmed_duplicate",
        duplicateFileName: file.name,
        canonicalFileName: uploaded.duplicateOfFileName || uploaded.attachment.fileName,
        duplicateOfFileId: uploaded.duplicateOfFileId || uploaded.attachment.fileId,
        reasons: uploaded.duplicateReasons || [],
      });
      if (canonical) {
        removeFileReferences(key);
        state.files = state.files.filter((item) => item !== file);
        if (file.uploadTargetRowId) assignSelectedFileToTarget(canonical, file.uploadTargetRowId);
        addMessage(
          "bot",
          `检测到“${file.name}”与“${uploaded.duplicateOfFileName || uploaded.attachment.fileName}”是同一凭证，已复用已有 OCR 结果${file.uploadTargetRowId ? "并归入指定明细" : ""}，不会重复计入金额。`,
        );
        return;
      }
      // 原文件可能已从当前草稿删除，或来自刷新前的旧草稿。保留本次选择的记录，
      // 直接写入服务端已确认的附件与 OCR 回执，不能再把它悄悄删掉。
      addMessage(
        "bot",
        `检测到“${file.name}”与历史上传凭证相同，已复用服务端 OCR 回执并保留在当前明细中，不会重复计入金额。`,
      );
    }
    if (uploaded.reclassified && ["payment", "invoice"].includes(uploaded.kind) && uploaded.kind !== classifyFile(file)) {
      const key = getFileKey(file);
      state.dailyRows.forEach((row) => {
        const assigned = [...(row.paymentFileKeys || []), ...(row.invoiceFileKeys || [])].includes(key);
        if (!assigned) return;
        row.paymentFileKeys = (row.paymentFileKeys || []).filter((item) => item !== key);
        row.invoiceFileKeys = (row.invoiceFileKeys || []).filter((item) => item !== key);
        const targetField = uploaded.kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
        row[targetField] = Array.from(new Set([...(row[targetField] || []), key]));
      });
      state.travelRows.forEach((row) => {
        const assigned = [...(row.paymentFileKeys || []), ...(row.invoiceFileKeys || [])].includes(key);
        if (!assigned) return;
        row.paymentFileKeys = (row.paymentFileKeys || []).filter((item) => item !== key);
        row.invoiceFileKeys = (row.invoiceFileKeys || []).filter((item) => item !== key);
        const targetField = uploaded.kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
        row[targetField] = Array.from(new Set([...(row[targetField] || []), key]));
      });
      file.kind = uploaded.kind;
      addMessage("bot", uploaded.reclassificationMessage || "系统已按OCR内容自动调整附件分类。");
    }
    file.dingtalkAttachment = uploaded.attachment;
    file.evidenceToken = uploaded.evidenceToken || "";
    file.ocr = uploaded.ocr || file.ocr || null;
    file.possibleDuplicateOfFileId = uploaded.possibleDuplicateOfFileId || "";
    file.possibleDuplicateOfFileName = uploaded.possibleDuplicateOfFileName || "";
    file.duplicateReasons = Array.isArray(uploaded.duplicateReasons) ? uploaded.duplicateReasons : [];
    file.duplicateDecision = file.possibleDuplicateOfFileId ? "" : "";
    if (file.possibleDuplicateOfFileId) {
      addMessage(
        "bot",
        `“${file.name}”与“${file.possibleDuplicateOfFileName || "已有凭证"}”信息高度相似，已暂不重复计入；可在附件工作台集中确认。`,
      );
    }
    // The server OCR result is authoritative. This also replaces an old local
    // filename hint if the real screenshot OCR succeeds.
    if (uploaded.ocr?.amount) file.detectedAmount = formatMoney(uploaded.ocr.amount);
    // 初选时先挂到明细，上传成功回执后再以真实 fileId/OCR 分类确认一次。
    // 任何中途重绘或草稿恢复都不能把“已上传”变成“未随明细提交”。
    if (file.uploadTargetRowId) assignSelectedFileToTarget(file, file.uploadTargetRowId);
    autoAssignImportedDailyAttachments();
    // OCR completes asynchronously after a file may already have been assigned.
    // Read the visible rows first so a user edit made while waiting is preserved.
    readDailyRowsFromDom();
    readTravelRowsFromDom();
    syncRelatedDrivenRows();
    syncAssignedRowAmountsFromPayments();
    revalidateInvoiceTitles({ notify: true });
    syncAssignedRowAmountsFromPayments();
    queueClientAuditEvent("attachment_ocr_completed", { action: "upload_completed", attachment: summarizeClientAuditAttachment(file) }, { status: "success", critical: true });
  } catch (error) {
    file.uploadError = error.message.includes("Storage.File.Write")
      ? "缺少钉钉权限 Storage.File.Write"
      : error.message.includes("Storage.UploadInfo.Read")
        ? "缺少钉钉权限 Storage.UploadInfo.Read"
        : error.message;
    queueClientAuditEvent("attachment_upload_failed", { action: "upload_failed", attachment: summarizeClientAuditAttachment(file), message: file.uploadError }, { status: "failed", critical: true });
  } finally {
    file.uploading = false;
    file.ocrQueueing = false;
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    if (attachmentAssignmentDialog?.open) renderAttachmentAssignments();
    syncDraft();
  }
}

async function uploadPendingFiles() {
  const pending = state.files.filter((file) => !file?.titleValidation?.quarantined && !file.dingtalkAttachment && !file.uploading && !file.uploadError);
  if (!pending.length || !state.sessionToken) return;
  pending.forEach((file) => { file.ocrQueueing = true; });
  renderFiles();
  if (attachmentAssignmentDialog?.open) renderAttachmentAssignments();
  await runWithConcurrency(pending, FILE_UPLOAD_CONCURRENCY, uploadFileToServer);
}

async function addFiles(fileList, kind, targetRowId = "", invoiceTitleReplacementSlotId = "") {
  const incoming = Array.from(fileList);
  if (!incoming.length) return;

  const newFiles = [];
  for (const file of incoming) {
    const supported = kind === "payment" ? isImageFile(file) : kind === "invoice" ? isSupportedInvoiceFile(file) : isSupportedOtherFile(file);
    if (!supported) {
      addMessage("bot", "当前入口不支持该文件格式。");
      continue;
    }
    // 每次补传均作为一次新的上传任务进入后端；真正的重复由服务端按内容识别，
    // 并回用已有 OCR 回执，而不是在浏览器端静默跳过。
    file.clientUploadId = createClientUploadId();
    file.kind = kind;
    file.invoiceTitleReplacementSlotId = invoiceTitleReplacementSlotId || "";
    file.uploadTargetRowId = targetRowId || "";
    file.detectedAmount = await detectAmount(file);
    file.ocrQueueing = Boolean(state.sessionToken);
    state.files.push(file);
    newFiles.push(file);
  }

  const isTravelRowTarget = String(targetRowId).startsWith("travel:");
  const normalizedTargetRowId = isTravelRowTarget ? String(targetRowId).slice(7) : targetRowId;
  if ((newFiles.length || normalizedTargetRowId) && currentWorkflow().targetType === "daily" && normalizedTargetRowId) {
    ensureDailyRows();
    const targetRow = normalizedTargetRowId
      ? state.dailyRows.find((row) => row.id === normalizedTargetRowId)
      : (state.dailyRows.length === 1 ? state.dailyRows[0] : null);
    if (targetRow) {
      const rowFiles = incoming
        .map((file) => state.files.find((stored) => getFileKey(stored) === getFileKey(file)))
        .filter(Boolean);
      const paymentKeys = rowFiles.filter((file) => classifyFile(file) === "payment").map(getFileKey);
      const invoiceKeys = rowFiles.filter((file) => classifyFile(file) === "invoice").map(getFileKey);
      targetRow.paymentFileKeys = Array.from(new Set([...(targetRow.paymentFileKeys || []), ...paymentKeys]));
      targetRow.invoiceFileKeys = Array.from(new Set([...(targetRow.invoiceFileKeys || []), ...invoiceKeys]));
      if (isRelatedDrivenWorkflow() && targetRow.autoGeneratedFromRelated) {
        rowFiles.forEach((file) => {
          file.relatedInstanceId = targetRow.relatedInstanceId;
          file.relatedAutoAssigned = false;
        });
      }
    }
  }

  if ((newFiles.length || normalizedTargetRowId) && currentWorkflow().targetType === "travel" && isTravelRowTarget) {
    const targetRow = state.travelRows.find((row) => row.id === normalizedTargetRowId);
    if (targetRow) {
      const rowFiles = incoming
        .map((file) => state.files.find((stored) => getFileKey(stored) === getFileKey(file)))
        .filter(Boolean);
      const paymentKeys = rowFiles.filter((file) => classifyFile(file) === "payment").map(getFileKey);
      const invoiceKeys = rowFiles.filter((file) => classifyFile(file) === "invoice").map(getFileKey);
      targetRow.paymentFileKeys = Array.from(new Set([...(targetRow.paymentFileKeys || []), ...paymentKeys]));
      targetRow.invoiceFileKeys = Array.from(new Set([...(targetRow.invoiceFileKeys || []), ...invoiceKeys]));
      if (isRelatedDrivenWorkflow() && targetRow.autoGeneratedFromRelated) {
        rowFiles.forEach((file) => {
          file.relatedInstanceId = targetRow.relatedInstanceId;
          file.relatedAutoAssigned = false;
        });
      }
    }
  }

  if (state.selectedRelated.length === 1) {
    newFiles.forEach((file) => {
      file.relatedInstanceId = state.selectedRelated[0].processInstanceId;
      file.relatedAutoAssigned = true;
    });
  }

  syncRelatedDrivenRows();

  // V2 引导版可在“唯一归属目标”时安全地自动写入附件关联。
  // V1 和未安装该钩子的页面保持原有的批量上传后人工分配逻辑。
  const v2HandledAttachmentAssignment = Boolean(
    typeof window.__reimbursementV2AutoAssignAttachments === "function"
      && window.__reimbursementV2AutoAssignAttachments({ newFiles, targetRowId })
  );

  if (newFiles.length) addMessage("user", `已选择 ${newFiles.length} 个文件`);
  if (newFiles.length) queueClientAuditEvent("attachments_selected", {
    action: "files_selected", targetRowId, attachments: newFiles.map(summarizeClientAuditAttachment),
  }, { critical: true });
  renderFiles();
  renderDailyRows();
  renderTravelRows();
  syncDraft();
  const newAssignableFiles = newFiles.filter((file) => ["payment", "invoice"].includes(classifyFile(file)));
  const needsAssignmentDialog = !targetRowId || state.selectedRelated.length > 1;
  if (newAssignableFiles.length && needsAssignmentDialog && !v2HandledAttachmentAssignment && (currentWorkflow().targetType === "daily" || currentWorkflow().targetType === "travel" || state.selectedRelated.length)) {
    openAttachmentAssignment(newAssignableFiles.map(getFileKey));
  }
  await uploadPendingFiles();
}

function assignSelectedFileToTarget(file, targetRowId = "") {
  const isTravelRowTarget = String(targetRowId).startsWith("travel:");
  const normalizedTargetRowId = isTravelRowTarget ? String(targetRowId).slice(7) : String(targetRowId || "");
  if (!file || !normalizedTargetRowId) return false;
  const field = classifyFile(file) === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
  const rows = isTravelRowTarget ? state.travelRows : state.dailyRows;
  const row = rows.find((item) => item.id === normalizedTargetRowId);
  if (!row) return false;
  // A countable attachment can only belong to one fee row.  Keep the durable
  // target and the visible row key in lockstep so upload, refresh and submit
  // cannot describe different ownership.
  [...state.dailyRows, ...state.travelRows].forEach((candidate) => {
    candidate[field] = (candidate[field] || []).filter((key) => key !== getFileKey(file));
  });
  row[field] = Array.from(new Set([...(row[field] || []), getFileKey(file)]));
  file.uploadTargetRowId = getRowTargetId(row, isTravelRowTarget ? "travel" : "daily");
  queueClientAuditEvent("attachment_bound", { action: "bound_to_row", rowId: row.id, targetRowId: file.uploadTargetRowId, attachment: summarizeClientAuditAttachment(file) }, { critical: true });
  return true;
}

function reconcileUploadedTargetAssignments() {
  let restored = 0;
  state.files.forEach((file) => {
    if (!file?.uploadTargetRowId || !file?.dingtalkAttachment?.fileId || file?.titleValidation?.quarantined) return;
    if (assignSelectedFileToTarget(file, file.uploadTargetRowId)) restored += 1;
  });
  return restored;
}

function getRowEvidenceReadiness(row = {}, kind = "invoice") {
  const targetType = state.travelRows.some((item) => item.id === row.id) ? "travel" : "daily";
  const keys = getRowFileKeys(row, kind, targetType);
  const files = getFilesByKeys(keys);
  const confirmed = files.filter((file) => Boolean(file?.dingtalkAttachment?.fileId)
    && !file.uploading && !file.ocrQueueing && !file.uploadError && Boolean(file?.ocr));
  const countable = confirmed.filter((file) => Number(formatMoney(getOcrAmount(file))) > 0);
  return {
    assigned: files.length,
    confirmed: confirmed.length,
    countable: countable.length,
    amount: sumMoney(countable.map(getOcrAmount)),
    pending: files.some((file) => file.uploading || file.ocrQueueing || (!file.dingtalkAttachment && !file.uploadError)),
    failed: files.some((file) => Boolean(file.uploadError) || file?.ocr?.enabled === false),
  };
}

function assignFileToRow(fileKey, rowId, kind) {
  const field = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
  [...state.dailyRows, ...state.travelRows].forEach((row) => {
    row[field] = (row[field] || []).filter((key) => key !== fileKey);
  });
  const row = state.dailyRows.find((item) => item.id === rowId);
  const file = getFileByKey(fileKey);
  if (row) {
    row[field] = Array.from(new Set([...(row[field] || []), fileKey]));
    if (file) file.uploadTargetRowId = getRowTargetId(row, "daily");
    if (isRelatedDrivenWorkflow() && row.autoGeneratedFromRelated && file) {
      file.relatedInstanceId = row.relatedInstanceId;
      file.relatedAutoAssigned = false;
    }
  } else if (isRelatedDrivenWorkflow() && file) {
    file.relatedInstanceId = "";
    file.relatedAutoAssigned = false;
  }
  if (!row && file) file.uploadTargetRowId = "";
}

function toggleFileRowAssignment(fileKey, rowId, kind) {
  const row = state.dailyRows.find((item) => item.id === rowId);
  const alreadySelected = getRowFileKeys(row, kind, "daily").includes(fileKey);
  assignFileToRow(fileKey, alreadySelected ? "" : rowId, kind);
}

function assignFileToTravelRow(fileKey, rowId, kind) {
  const field = kind === "invoice" ? "invoiceFileKeys" : "paymentFileKeys";
  [...state.dailyRows, ...state.travelRows].forEach((row) => { row[field] = (row[field] || []).filter((key) => key !== fileKey); });
  const row = state.travelRows.find((item) => item.id === rowId);
  const file = getFileByKey(fileKey);
  if (row) {
    row[field] = Array.from(new Set([...(row[field] || []), fileKey]));
    if (file) file.uploadTargetRowId = getRowTargetId(row, "travel");
    const related = getRelatedById(row.relatedInstanceId);
    if (related) {
      row.relatedBusinessId = related.businessId || row.relatedBusinessId;
      row.relatedTitle = related.title || row.relatedTitle;
    }
    if (isRelatedDrivenWorkflow() && row.autoGeneratedFromRelated && file) {
      file.relatedInstanceId = row.relatedInstanceId;
      file.relatedAutoAssigned = false;
    }
  } else if (isRelatedDrivenWorkflow()) {
    if (file) {
      file.relatedInstanceId = "";
      file.relatedAutoAssigned = false;
    }
  }
  if (!row && file) file.uploadTargetRowId = "";
}

function toggleFileTravelRowAssignment(fileKey, rowId, kind) {
  const row = state.travelRows.find((item) => item.id === rowId);
  const alreadySelected = getRowFileKeys(row, kind, "travel").includes(fileKey);
  assignFileToTravelRow(fileKey, alreadySelected ? "" : rowId, kind);
}

function toggleFileRelatedAssignment(fileKey, processInstanceId) {
  const file = getFileByKey(fileKey);
  if (!file) return;
  file.relatedInstanceId = file.relatedInstanceId === processInstanceId ? "" : processInstanceId;
  file.relatedAutoAssigned = false;
  syncRelatedDrivenRows();
}

function extractManualRelatedInstanceId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const fromQuery = ["processInstanceId", "process_instance_id", "instanceId"]
      .map((key) => url.searchParams.get(key))
      .find(Boolean);
    if (fromQuery) return fromQuery.trim();
  } catch {
    // A plain instance ID is also accepted.
  }
  const embedded = raw.match(/(?:processInstanceId|process_instance_id|instanceId)[=/:]([^&#?\s/]+)/i);
  return embedded?.[1] ? decodeURIComponent(embedded[1]).trim() : raw;
}

function renderAssignmentFileButtons(files, selectedKeys, layer, targetId) {
  if (!files.length) return `<p class="assignment-empty">暂无此类附件</p>`;
  const selectedSet = new Set(selectedKeys);
  return files.map((file) => {
    const key = getFileKey(file);
    const selected = selectedSet.has(key);
    const currentTargetId = layer === "row"
      ? getFileRowAssignment(key)?.row?.id
      : layer === "travel-row"
        ? getFileTravelRowAssignment(key)?.row?.id
        : file.relatedInstanceId;
    const assignedElsewhere = Boolean(currentTargetId && currentTargetId !== targetId);
    const assignedRowIndex = layer === "row" && assignedElsewhere
      ? state.dailyRows.findIndex((row) => row.id === currentTargetId) + 1
      : 0;
    const assignedTravelRowIndex = layer === "travel-row" && assignedElsewhere
      ? state.travelRows.findIndex((row) => row.id === currentTargetId) + 1
      : 0;
    const assignedRelatedIndex = layer === "related" && assignedElsewhere
      ? state.selectedRelated.findIndex((item) => item.processInstanceId === currentTargetId) + 1
      : 0;
    const assignedHint = assignedElsewhere
      ? (layer === "row" || layer === "travel-row"
        ? `已归入明细 ${assignedRowIndex || assignedTravelRowIndex || "其他"}`
        : `已归入关联审批 ${assignedRelatedIndex || "其他"}`)
      : "";
    const ocrLabel = getAssignmentOcrLabel(file);
    const rawAmount = getRawOcrAmount(file);
    const candidateAmounts = getOcrCandidateAmounts(file);
    const candidateLabel = candidateAmounts.map((value) => `¥${formatMoney(value)}`).join("、");
    const manualAmount = getManualOcrAmount(file);
    const riskLabel = getOcrRiskLabel(file);
    const isProcessing = file.uploading || file.ocrQueueing;
    const isOcrFailed = file.dingtalkAttachment && file.ocr?.enabled === false;
    const statusHint = isOcrFailed ? (file.ocr?.reason || "OCR 识别失败") : ocrLabel;
    const inputValue = manualAmount || (riskLabel ? "" : formatMoney(rawAmount));
    const inputPlaceholder = riskLabel
      ? (candidateLabel ? `候选 ${candidateLabel}，请确认` : (rawAmount ? `识别 ¥${formatMoney(rawAmount)}，请确认` : "请填写确认金额"))
      : "可手动修改";
    const candidateButtons = candidateAmounts.length && !assignedElsewhere && !isProcessing && riskLabel
      ? candidateAmounts.map((value) => `<button type="button" class="assignment-use-ocr" data-assignment-action="use-file-ocr" data-file-key="${escapeHtml(key)}" data-value="${escapeHtml(formatMoney(value))}">采用 ¥${escapeHtml(formatMoney(value))}</button>`).join("")
      : "";
    return `
      <div class="assignment-file ${selected ? "selected" : ""} ${assignedElsewhere ? "assigned-elsewhere" : ""} ${isProcessing ? "is-processing" : ""} ${isOcrFailed ? "is-ocr-failed" : ""}">
        <button class="assignment-file-choice" type="button"
          data-assignment-layer="${layer}" data-target-id="${escapeHtml(targetId)}"
          data-file-key="${escapeHtml(key)}" data-kind="${escapeHtml(classifyFile(file))}"
          ${assignedElsewhere || isProcessing ? "disabled" : ""} title="${escapeHtml(assignedHint || statusHint || file.name)}">
          <span>${selected ? "✓" : (assignedElsewhere ? "—" : "+")}</span>
          <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
          <small>${escapeHtml(assignedHint || ocrLabel)}</small>
        </button>
        <div class="assignment-file-confirm">
          <span class="assignment-file-raw">${escapeHtml(rawAmount ? `识别金额 ¥${formatMoney(rawAmount)}` : "未识别到金额")}</span>
          ${candidateLabel && riskLabel ? `<span class="assignment-file-candidates">候选金额 ${escapeHtml(candidateLabel)}</span>` : ""}
          ${riskLabel ? `<em>${escapeHtml(riskLabel)}</em>` : ""}
          <label>确认金额<input type="text" inputmode="decimal" value="${escapeHtml(inputValue)}" placeholder="${escapeHtml(inputPlaceholder)}" data-assignment-file-amount data-file-key="${escapeHtml(key)}" ${assignedElsewhere || isProcessing ? "disabled" : ""} /></label>
          ${candidateButtons || (rawAmount && !assignedElsewhere && !isProcessing ? `<button type="button" class="assignment-use-ocr" data-assignment-action="use-file-ocr" data-file-key="${escapeHtml(key)}">采用识别值</button>` : "")}
          <button type="button" class="assignment-file-preview" data-assignment-action="preview-file" data-file-key="${escapeHtml(key)}" title="点击预览附件">预览附件</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderAttachmentAssignments() {
  if (!assignmentSections) return;
  const relatedDriven = isRelatedDrivenWorkflow();
  const noInvoice = isNoInvoiceWorkflow();
  if (relatedDriven) syncRelatedDrivenRows();
  const paymentFiles = getFilesByType("payment");
  const invoiceFiles = noInvoice ? [] : getFilesByType("invoice");
  const assignableFiles = [...paymentFiles, ...invoiceFiles];
  const pendingOcrFiles = getPendingOcrFiles(assignableFiles);
  const failedOcrFiles = getFailedOcrFiles(assignableFiles);
  const sections = [];

  if (currentWorkflow().targetType === "daily" && !relatedDriven) {
    readDailyRowsFromDom();
    const rowsHtml = state.dailyRows.map((row, index) => `
      <article class="assignment-target-card">
        <header><span>${index + 1}</span><div><strong>${escapeHtml(row.reason || `费用明细 ${index + 1}`)}</strong><small>${escapeHtml(formatMoney(row.amount) || "0.00")} 元</small></div></header>
        ${renderAssignmentTotals(row, "row")}
        <div class="assignment-kind"><b>付款截图</b><div>${renderAssignmentFileButtons(paymentFiles, row.paymentFileKeys || [], "row", row.id)}</div></div>
        <div class="assignment-kind"><b>发票附件</b><div>${renderAssignmentFileButtons(invoiceFiles, row.invoiceFileKeys || [], "row", row.id)}</div></div>
      </article>
    `).join("");
    sections.push(`<section class="assignment-group"><h3>按费用明细归类</h3><p>每张附件选择一条费用明细，可将多张附件归入同一行。</p><div class="assignment-targets">${rowsHtml}</div></section>`);
  }

  if (currentWorkflow().targetType === "travel" && !relatedDriven) {
    readTravelRowsFromDom();
    const rowsHtml = state.travelRows.map((row, index) => {
      const related = getRelatedById(row.relatedInstanceId);
      const label = related?.businessId || row.relatedBusinessId || "未选择关联审批";
      return `<article class="assignment-target-card">
        <header><span>${index + 1}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(row.reason || "差旅费用明细")} · ${escapeHtml(formatMoney(row.amount) || "0.00")} 元</small></div></header>
        ${renderAssignmentTotals(row, "travel-row")}
        <div class="assignment-kind"><b>付款截图</b><div>${renderAssignmentFileButtons(paymentFiles, row.paymentFileKeys || [], "travel-row", row.id)}</div></div>
        <div class="assignment-kind"><b>发票附件</b><div>${renderAssignmentFileButtons(invoiceFiles, row.invoiceFileKeys || [], "travel-row", row.id)}</div></div>
      </article>`;
    }).join("");
    sections.push(`<section class="assignment-group"><h3>按差旅报销明细归类</h3><p>附件将随对应明细行写入钉钉 OA 表格。每行可放入多张付款截图和发票附件。</p><div class="assignment-targets">${rowsHtml || "<p class=\"assignment-empty\">请先选择关联出差申请。</p>"}</div></section>`);
  }

  if (state.selectedRelated.length && (currentWorkflow().targetType !== "travel" || relatedDriven)) {
    const relatedHtml = state.selectedRelated.map((instance, index) => {
      const selectedKeys = assignableFiles
        .filter((file) => file.relatedInstanceId === instance.processInstanceId)
        .map(getFileKey);
      const businessId = instance.businessId || instance.processInstanceId;
      const approvalDate = formatApprovalBusinessDate(instance.businessId);
      const linkedRow = relatedDriven
        ? getRelatedDrivenRows().find((row) => row.autoGeneratedFromRelated && row.relatedInstanceId === instance.processInstanceId)
        : null;
      const assignmentLayer = currentWorkflow().targetType === "travel" ? "travel-row" : "row";
      const totalMarkup = linkedRow ? renderAssignmentTotals(linkedRow, assignmentLayer) : "";
      return `
        <article class="assignment-target-card related-assignment-card">
          <header><span>${index + 1}</span><div><strong>${escapeHtml(instance.title || "关联审批")}</strong><small>审批编号：${escapeHtml(businessId)}${approvalDate ? ` · 发起日期：${approvalDate}` : ""}</small></div></header>
          ${totalMarkup}
          <div class="assignment-kind"><b>对应附件</b><div>${renderAssignmentFileButtons(assignableFiles, selectedKeys, "related", instance.processInstanceId)}</div></div>
        </article>
      `;
    }).join("");
    const relatedHint = relatedDriven
      ? "每条关联审批会自动生成一条费用明细。只需在这里把付款截图和发票归入对应审批，明细行会自动同步；如需拆分，再在明细表中使用手工新增行。"
      : "审批编号前 8 位为审批发起日期（YYYYMMDD）。需要按日期核对或分配附件时，请以该日期为准；多选审批时，请为每张付款截图和发票指定对应审批。";
    sections.push(`<section class="assignment-group"><h3>按关联审批归类</h3><p>${relatedHint}</p><div class="assignment-targets">${relatedHtml}</div></section>`);
  }

  const unassignedRows = relatedDriven
    ? 0
    : currentWorkflow().targetType === "daily"
    ? assignableFiles.filter((file) => !getFileRowAssignment(getFileKey(file))).length
    : currentWorkflow().targetType === "travel"
      ? assignableFiles.filter((file) => !getFileTravelRowAssignment(getFileKey(file))).length
      : 0;
  const unassignedRelated = relatedDriven
    ? assignableFiles.filter((file) => !file.relatedInstanceId).length
    : currentWorkflow().targetType !== "travel" && state.selectedRelated.length > 1
    ? assignableFiles.filter((file) => !file.relatedInstanceId).length
    : 0;
  assignmentOverview.innerHTML = `
    <span>付款 ${paymentFiles.length}</span><span>发票 ${invoiceFiles.length}</span>
    ${pendingOcrFiles.length ? `<span class="warn">识别中 ${assignableFiles.length - pendingOcrFiles.length}/${assignableFiles.length}</span>` : ""}
    ${failedOcrFiles.length ? `<span class="warn">OCR 失败 ${failedOcrFiles.length}</span>` : ""}
    ${["daily", "travel"].includes(currentWorkflow().targetType) && !relatedDriven ? `<span class="${unassignedRows ? "warn" : "ok"}">未分配明细 ${unassignedRows}</span>` : ""}
    ${(relatedDriven || state.selectedRelated.length > 1) ? `<span class="${unassignedRelated ? "warn" : "ok"}">未分配审批 ${unassignedRelated}</span>` : ""}
  `;
  if (applyAttachmentAssignments) applyAttachmentAssignments.disabled = pendingOcrFiles.length > 0 || failedOcrFiles.length > 0;
  assignmentStatus.textContent = pendingOcrFiles.length
    ? `正在逐个上传并 OCR 识别：已完成 ${assignableFiles.length - pendingOcrFiles.length}/${assignableFiles.length}，请等待。`
    : failedOcrFiles.length
      ? `有 ${failedOcrFiles.length} 个附件 OCR 识别失败，请删除后重新上传。`
      : unassignedRows || unassignedRelated
    ? `还有 ${unassignedRows + unassignedRelated} 项归类未完成`
    : "附件已完成归类";
  assignmentSections.innerHTML = sections.join("") || `<p class="assignment-empty">当前没有需要分配的附件。</p>`;
  if (noInvoice) {
    assignmentSections.querySelectorAll(".assignment-target-card .assignment-kind:last-child .assignment-empty").forEach((empty) => {
      empty.closest(".assignment-kind")?.remove();
    });
  }
}

function openAttachmentAssignment(focusKeys = []) {
  state.assignmentFocusKeys = focusKeys;
  renderAttachmentAssignments();
  if (!attachmentAssignmentDialog.open) attachmentAssignmentDialog.showModal();
}

function pickRowFiles(kind, rowId, invoiceTitleReplacementSlotId = "") {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = kind === "payment"
    ? ".png,.jpg,.jpeg,.webp,.heic"
    : ".pdf,.png,.jpg,.jpeg,.webp,.heic";
  input.className = "file-input";
  input.style.display = "none";
  input.addEventListener("change", async () => {
    await addFiles(input.files, kind, rowId, invoiceTitleReplacementSlotId);
    input.remove();
  }, { once: true });
  document.body.append(input);
  input.click();
}

function getRowDropZone(target) {
  return target instanceof Element ? target.closest(".row-file-dropzone") : null;
}

function handleRowFileDragOver(event) {
  const zone = getRowDropZone(event.target);
  if (!zone) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  zone.classList.add("dragover");
}

function handleRowFileDragLeave(event) {
  const zone = getRowDropZone(event.target);
  if (!zone) return;
  const nextTarget = event.relatedTarget;
  if (!nextTarget || !zone.contains(nextTarget)) zone.classList.remove("dragover");
}

async function handleRowFileDrop(event) {
  const zone = getRowDropZone(event.target);
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("dragover");
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  readDailyRowsFromDom();
  await addFiles(files, zone.dataset.kind, zone.dataset.rowId);
}

function buildRelatedSummary() {
  const manual = relatedManualInput.value.trim();
  const parts = [];
  if (manual) parts.push(`用户填写：${manual}`);
  state.selectedRelated.forEach((selected, index) => {
    const itemParts = [`实例ID：${selected.processInstanceId}`];
    if (selected.title) itemParts.push(`标题：${selected.title}`);
    if (selected.businessId) itemParts.push(`审批编号：${selected.businessId}`);
    const assignedFiles = state.files.filter((file) => file.relatedInstanceId === selected.processInstanceId);
    if (assignedFiles.length) itemParts.push(`附件：${assignedFiles.map((file) => file.name).join("、")}`);
    parts.push(`关联审批${index + 1}（${itemParts.join("；")}）`);
  });
  return parts.join("；");
}

function formatRelatedOption(instance, workflow) {
  const typeName = workflow.related?.label || "关联审批";
  const title = instance.title || typeName;
  const code = instance.businessId || instance.processInstanceId;
  const status = instance.result || instance.status || "";
  const detail = instance.detailAvailable === false ? "详情待授权" : status;
  return [title, code, detail].filter(Boolean).join(" · ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function formatRelatedTime(value) {
  if (!value) return "";
  const timestamp = Number(value);
  if (Number.isFinite(timestamp) && timestamp > 100000000000) {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
  }
  return String(value);
}

function parseJsonLoose(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !/^[\[{]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function getRelatedLabel(item) {
  return item?.props?.label || item?.label || item?.name || item?.id || "";
}

function isMediaRelatedLabel(label) {
  return /图片|照片|图像|截图|附件|签名/i.test(String(label || ""));
}

function normalizeRelatedValue(value) {
  const parsed = parseJsonLoose(value);
  if (Array.isArray(parsed)) {
    if (parsed.every((item) => item && typeof item === "object" && ("name" in item || "fileName" in item))) {
      const names = parsed.map((item) => item.name || item.fileName).filter(Boolean);
      return names.length ? names.join("、") : `共 ${parsed.length} 项`;
    }
    if (parsed.every((item) => typeof item !== "object")) return parsed.join("、");
    return "";
  }
  if (parsed && typeof parsed === "object") {
    if (parsed.name || parsed.fileName) return parsed.name || parsed.fileName;
    if (parsed.value !== undefined && typeof parsed.value !== "object") return String(parsed.value);
    return "";
  }
  const text = String(parsed ?? "").replace(/\s+/g, " ").trim();
  if (!text || /compressedValue|componentName|componentType|bizAlias/.test(text)) return "";
  if (/^(https?:)?\/\//i.test(text) || /\/ossFileHandle|\.(png|jpe?g|webp|gif)(\?|$)/i.test(text)) return "";
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function flattenRelatedField(item) {
  const rows = [];
  const parsed = parseJsonLoose(item.value);
  if (Array.isArray(parsed) && parsed.every((entry) => entry && typeof entry === "object" && entry.props)) {
    for (const entry of parsed) {
      const label = getRelatedLabel(entry);
      if (isMediaRelatedLabel(label)) continue;
      const value = normalizeRelatedValue(entry.value);
      if (label && value) rows.push({ name: label, value });
    }
    return rows;
  }

  // DingTalk TableField values are encoded as [{ rowValue: [{ label, value }] }].
  // Keep these fields available for the dedicated travel summary as well as the
  // generic approval detail panel.
  if (Array.isArray(parsed) && parsed.some((entry) => entry && typeof entry === "object" && Array.isArray(entry.rowValue))) {
    parsed.forEach((row) => {
      (row.rowValue || []).forEach((entry) => {
        const label = getRelatedLabel(entry);
        if (isMediaRelatedLabel(label)) return;
        const value = normalizeRelatedValue(entry.value);
        if (label && value) rows.push({ name: label, value });
      });
    });
    return rows;
  }

  if (isMediaRelatedLabel(item.name)) return [];
  const value = normalizeRelatedValue(item.value);
  return item.name && value ? [{ name: item.name, value }] : [];
}

function getRelatedTravelInfo(instance = {}) {
  const supplied = instance.travelInfo && typeof instance.travelInfo === "object" ? instance.travelInfo : {};
  const fields = (instance.formComponentValues || [])
    .filter((item) => item && item.value !== undefined && item.value !== "")
    .flatMap(flattenRelatedField);
  const combinedRoutePattern = /(?:出发地.*目的地|起点.*终点|出发.*到达)/i;
  const firstValue = (pattern, excludedPattern = null) => fields.find((item) => pattern.test(item.name) && !(excludedPattern && excludedPattern.test(item.name)))?.value || "";
  const startDate = supplied.startDate || firstValue(/(?:出差|行程)?(?:开始|起始|出发)(?:日期|时间)?$/i);
  const endDate = supplied.endDate || firstValue(/(?:出差|行程)?(?:结束|终止|返回|返程)(?:日期|时间)?$/i);
  const explicitDate = supplied.date || firstValue(/^(?:出差|行程)?(?:日期|时间|起止日期|行程日期)$/i);
  const departure = supplied.departure || firstValue(/(?:出发地|出发城市|出发地点|始发地|出发站|起点)/i, combinedRoutePattern);
  const destination = supplied.destination || firstValue(/(?:目的地|目的城市|目的地点|到达地|到达城市|终点|终到站)/i, combinedRoutePattern);
  const routePair = fields.find((item) => combinedRoutePattern.test(item.name));
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

function formatRelatedTravelSummary(info = {}) {
  const date = info.date || (info.startDate && info.endDate
    ? `${info.startDate} 至 ${info.endDate}`
    : info.startDate || info.endDate);
  const route = [info.departure, info.destination].filter(Boolean).join(" → ");
  return [date, route].filter(Boolean).join(" · ");
}

function renderRelatedTravelInfo(info = {}) {
  const rows = [
    ["日期", info.date || (info.startDate && info.endDate ? `${info.startDate} 至 ${info.endDate}` : info.startDate || info.endDate)],
    ["出发地", info.departure],
    ["目的地", info.destination],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `<div class="related-travel-info" aria-label="出差基础信息">${rows.map(([label, value]) => `
    <div class="related-travel-info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("")}</div>`;
}

function renderRelatedDetail(instances = state.selectedRelated) {
  if (!relatedDetail) return;
  const selected = Array.isArray(instances) ? instances : (instances ? [instances] : []);
  if (!selected.length) {
    relatedDetail.hidden = true;
    relatedDetail.innerHTML = "";
    return;
  }
  relatedDetail.innerHTML = selected.map((instance) => {
    const travelInfo = instance.sourceKey === "travel" || instance.processCode === PROCESS_CODES.travelApplication
      ? getRelatedTravelInfo(instance)
      : {};
    const fields = (instance.formComponentValues || [])
      .filter((item) => item.name && item.value !== undefined && item.value !== "")
      .flatMap(flattenRelatedField)
      .slice(0, 4);
    const fieldRows = fields.map((item) => `
      <div class="related-detail-row"><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(item.value)}</strong></div>
    `).join("");
    return `
      <article class="related-detail-card">
        <div class="related-detail-head">
          <strong>${escapeHtml(instance.title || "审批详情")}</strong>
          <span>${escapeHtml(instance.result || instance.status || "状态未知")}</span>
        </div>
        <div class="related-detail-meta">
          ${instance.businessId ? `<span>审批编号：${escapeHtml(instance.businessId)}</span>` : ""}
          ${instance.createTime ? `<span>发起时间：${escapeHtml(formatRelatedTime(instance.createTime))}</span>` : ""}
        </div>
        ${renderRelatedTravelInfo(travelInfo)}
        ${fieldRows ? `<div class="related-detail-fields">${fieldRows}</div>` : ""}
      </article>
    `;
  }).join("");
  relatedDetail.hidden = false;
}

function getRelatedInstanceIds() {
  return state.selectedRelated.map((item) => item.processInstanceId).filter(Boolean);
}

function getSelectedRelatedProcessCodes(workflow = currentWorkflow()) {
  const selected = state.selectedRelated.map((item) => item.sourceProcessCode).filter(Boolean);
  const fallback = getWorkflowRelatedSources(workflow).map((item) => item.processCode).filter(Boolean);
  return [...new Set((selected.length ? selected : fallback).map(String))];
}

function getRelatedComponentName(workflow) {
  if (!workflow.related) return "";
  return workflow.targetType === "travel" ? "关联出差申请" : "关联审批单";
}

function getRelatedComponentValue(workflow) {
  const ids = getRelatedInstanceIds();
  if (!workflow.related || !ids.length) return null;
  return {
    value: JSON.stringify(state.selectedRelated.map((item) => item.title || item.businessId || workflow.related.label)),
    extValue: JSON.stringify({ list: ids.map((procInstId) => ({ procInstId })) }),
  };
}

function buildDailyTableChild(field, value) {
  return {
    name: field.name,
    id: field.id,
    componentType: field.componentType,
    value: value === undefined || value === null ? "" : String(value),
  };
}

function buildDailyTableValue(rows, workflow = currentWorkflow()) {
  return JSON.stringify(rows.map((row) => [
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.businessDate, row.businessDate),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.reason, row.reason),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.amount, formatMoney(row.amount)),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.project, row.project),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.invoiceType, row.invoiceType),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.paymentAttachments, JSON.stringify(getRowAttachments(row, "payment"))),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.invoiceAttachments, JSON.stringify(workflow.noInvoice ? [] : getRowAttachments(row, "invoice"))),
      buildDailyTableChild(DAILY_TABLE_COMPONENT.fields.remark, row.remark || ""),
  ]));
}

function buildTravelTableValue(rows) {
  return JSON.stringify(rows.map((row) => [
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.relatedBusinessId, row.relatedBusinessId),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.amount, formatMoney(row.amount)),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.businessDate, row.businessDate),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.expenseType, row.expenseType),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.reason, row.reason),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.invoiceAttachments, JSON.stringify(getRowAttachments(row, "invoice", "travel"))),
    buildDailyTableChild(TRAVEL_TABLE_COMPONENT.fields.paymentAttachments, JSON.stringify(getRowAttachments(row, "payment", "travel"))),
  ]));
}

function formatRecipientAccountText(account) {
  const typeLabel = RECIPIENT_ACCOUNT_TYPES[account.accountType] || account.accountType || "其他账户";
  const values = [
    `收款人：${account.accountName}`,
    `账户类型：${typeLabel}`,
    `账号：${account.accountNumber}`,
  ];
  const bankAndBranch = [account.bankName, account.branchName].filter(Boolean).join("");
  if (bankAndBranch) values.push(`开户行：${bankAndBranch}`);
  const location = [account.province, account.city].filter(Boolean).join("");
  if (location) values.push(`开户地：${location}`);
  return values.join("；");
}

function clearRecipientAccountValidity() {
  // 账户由弹窗选择或草稿恢复时会以脚本方式写入 input，不会触发 input 事件。
  // 必须主动清除先前“必填”产生的自定义错误，否则浏览器仍会阻止提交。
  recipientAccountTextInput?.setCustomValidity("");
}

function maskRecipientAccountNumber(accountNumber) {
  const value = String(accountNumber || "").replace(/\s+/g, "");
  if (value.length <= 6) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function isBankRecipientAccount() {
  return ["PERSONAL_BANK_CARD", "CORPORATE_BANK_ACCOUNT"].includes(recipientAccountTypeInput.value);
}

function updateRecipientAccountEditorFields() {
  const bankRequired = isBankRecipientAccount();
  document.querySelectorAll(".recipient-bank-field").forEach((field) => {
    field.hidden = !bankRequired;
  });
  [recipientAccountBankInput, recipientAccountBranchInput, recipientAccountProvinceInput, recipientAccountCityInput].forEach((input) => {
    input.required = bankRequired;
  });
  recipientAccountEditorTip.textContent = bankRequired
    ? "银行卡和对公账户需填写完整开户行信息。"
    : "非银行卡账户仅需填写收款人和账号，可按实际情况补充别名。";
}

function clearRecipientAccountEditor() {
  state.recipientAccountEditingId = "";
  recipientAccountEditorTitle.textContent = "新增收款账户";
  saveRecipientAccountButton.textContent = "保存账户";
  recipientAccountTypeInput.value = "PERSONAL_BANK_CARD";
  recipientAccountAliasInput.value = "";
  recipientAccountNameInput.value = "";
  recipientAccountNumberInput.value = "";
  recipientAccountBankInput.value = "";
  recipientAccountBranchInput.value = "";
  recipientAccountProvinceInput.value = "";
  recipientAccountCityInput.value = "";
  updateRecipientAccountEditorFields();
}

function readRecipientAccountEditor() {
  return {
    accountType: recipientAccountTypeInput.value,
    alias: recipientAccountAliasInput.value.trim(),
    accountName: recipientAccountNameInput.value.trim(),
    accountNumber: recipientAccountNumberInput.value.replace(/\s+/g, ""),
    bankName: recipientAccountBankInput.value.trim(),
    branchName: recipientAccountBranchInput.value.trim(),
    province: recipientAccountProvinceInput.value.trim(),
    city: recipientAccountCityInput.value.trim(),
  };
}

function editRecipientAccount(accountId) {
  const account = state.recipientAccounts.find((item) => item.id === accountId);
  if (!account) return;
  state.recipientAccountEditingId = account.id;
  recipientAccountEditorTitle.textContent = "编辑收款账户";
  saveRecipientAccountButton.textContent = "保存修改";
  recipientAccountTypeInput.value = account.accountType || "PERSONAL_BANK_CARD";
  recipientAccountAliasInput.value = account.alias || "";
  recipientAccountNameInput.value = account.accountName || "";
  recipientAccountNumberInput.value = account.accountNumber || "";
  recipientAccountBankInput.value = account.bankName || "";
  recipientAccountBranchInput.value = account.branchName || "";
  recipientAccountProvinceInput.value = account.province || "";
  recipientAccountCityInput.value = account.city || "";
  updateRecipientAccountEditorFields();
}

function selectRecipientAccount(accountId) {
  const account = state.recipientAccounts.find((item) => item.id === accountId);
  if (!account) return;
  state.selectedRecipientAccountId = account.id;
  recipientAccountTextInput.value = formatRecipientAccountText(account);
  clearRecipientAccountValidity();
  recipientAccountStatus.textContent = `已选择：${account.alias || account.accountName}（${maskRecipientAccountNumber(account.accountNumber)}）`;
  renderRecipientAccounts();
  syncDraft();
  recipientAccountDialog.close();
}

function renderRecipientAccounts() {
  if (!recipientAccountsList) return;
  recipientAccountsCount.textContent = `${state.recipientAccounts.length} 个`;
  if (!state.user) {
    recipientAccountsList.innerHTML = '<p class="recipient-accounts-empty">请先在钉钉内完成登录。</p>';
    return;
  }
  if (!state.recipientAccounts.length) {
    recipientAccountsList.innerHTML = '<p class="recipient-accounts-empty">暂无已保存账户，请在右侧新增。</p>';
    return;
  }
  recipientAccountsList.innerHTML = state.recipientAccounts.map((account) => `
    <article class="recipient-account-card ${account.id === state.selectedRecipientAccountId ? "selected" : ""}">
      <button class="recipient-account-select" type="button" data-recipient-account-select="${escapeHtml(account.id)}">
        <strong>${escapeHtml(account.alias || account.accountName)}</strong>
        <span>${escapeHtml(RECIPIENT_ACCOUNT_TYPES[account.accountType] || account.accountType || "其他账户")} · ${escapeHtml(maskRecipientAccountNumber(account.accountNumber))}</span>
        <small>${escapeHtml(account.bankName || account.accountName)}</small>
      </button>
      <div class="recipient-account-card-actions">
        <button class="text-button" type="button" data-recipient-account-edit="${escapeHtml(account.id)}">编辑</button>
        <button class="text-button danger-text-button" type="button" data-recipient-account-delete="${escapeHtml(account.id)}">删除</button>
      </div>
    </article>
  `).join("");
}

async function loadRecipientAccounts() {
  if (!state.sessionToken) return;
  const response = await fetch(`${getApiBase()}/api/recipient-accounts?session_token=${encodeURIComponent(state.sessionToken)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "读取收款账户失败");
  state.recipientAccounts = Array.isArray(result.accounts) ? result.accounts : [];
  const selected = state.recipientAccounts.find((item) => item.id === state.selectedRecipientAccountId);
  if (selected && !recipientAccountTextInput.value) {
    recipientAccountTextInput.value = formatRecipientAccountText(selected);
  }
  if (recipientAccountTextInput.value.trim()) clearRecipientAccountValidity();
  renderRecipientAccounts();
}

async function saveRecipientAccount() {
  if (!state.sessionToken) throw new Error("请先在钉钉内完成登录后再保存账户");
  const account = readRecipientAccountEditor();
  const response = await fetch(`${getApiBase()}/api/recipient-accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_token: state.sessionToken,
      id: state.recipientAccountEditingId || undefined,
      account,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存收款账户失败");
  state.recipientAccounts = result.accounts || [];
  clearRecipientAccountEditor();
  renderRecipientAccounts();
  selectRecipientAccount(result.account.id);
}

async function deleteRecipientAccount(accountId) {
  if (!state.sessionToken) throw new Error("请先在钉钉内完成登录");
  const response = await fetch(`${getApiBase()}/api/recipient-accounts/${encodeURIComponent(accountId)}?session_token=${encodeURIComponent(state.sessionToken)}`, {
    method: "DELETE",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "删除收款账户失败");
  state.recipientAccounts = result.accounts || [];
  if (state.selectedRecipientAccountId === accountId) state.selectedRecipientAccountId = "";
  renderRecipientAccounts();
}

function buildDailyPayload(data, amount, workflow) {
  const rows = readDailyRowsFromDom();
  const otherAttachments = getAttachmentsByType("other");
  const companies = data.companyName ? [data.companyName] : [];
  const relatedComponentName = getRelatedComponentName(workflow);
  const relatedComponentValue = getRelatedComponentValue(workflow);
  const relatedSummary = buildRelatedSummary();
  const audit = buildAuditReport(data, amount, workflow);
  const detailTotal = formatMoney(getDailyRowsTotal());
  const remarks = [
    `总报销金额 ${amount} 元，费用明细共 ${rows.length} 行，明细合计 ${detailTotal} 元`,
    relatedSummary ? `${workflow.related?.label || "关联审批单"}：${relatedSummary}` : "",
    audit.summary ? `自动校验：${audit.summary}` : "",
  ].filter(Boolean).join("；");

  const values = [
    {
      name: DAILY_TABLE_COMPONENT.name,
      id: DAILY_TABLE_COMPONENT.id,
      componentType: DAILY_TABLE_COMPONENT.componentType,
      value: buildDailyTableValue(rows, workflow),
    },
    { name: "申请金额（元）", value: amount },
    { name: "其他备注", value: data.otherRemark || "" },
  ];

  if (relatedComponentName && relatedComponentValue) {
    values.unshift({ name: relatedComponentName, ...relatedComponentValue });
  }
  if (companies.length) values.push({ name: "需要付款的公司名称", value: JSON.stringify(companies) });
  values.push({ name: "收款人账户信息", value: String(data.recipientAccountText || "").trim() });
  if (otherAttachments.length) values.push({ name: "附件", value: JSON.stringify(otherAttachments) });

  return {
    process_code: workflow.processCode,
    evidence_validation_version: 2,
    evidence_manifest: buildEvidenceManifest(),
    attachment_row_bindings: buildAttachmentRowBindings(rows, "daily", { includeInvoices: !workflow.noInvoice }),
    evidence_processing_tokens: getEvidenceProcessingTokens(),
    no_invoice: Boolean(workflow.noInvoice),
    submission_route: getSubmissionRoutePayload(),
    related_source_process_code: getSelectedRelatedProcessCodes(workflow).join(","),
    form_component_values: values.filter((item) => item && item.value !== undefined && item.value !== ""),
    related_component_names: relatedComponentName && relatedComponentValue ? [relatedComponentName] : [],
    remark: `自动报销助手提交：${workflow.title}。${remarks || "无补充说明"}`,
  };
}

function buildTravelPayload(data, amount, workflow) {
  const rows = readTravelRowsFromDom();
  const companies = data.companyName ? [data.companyName] : [];
  const total = formatMoney(getTravelRowsTotal(rows));
  const relatedComponentName = getRelatedComponentName(workflow);
  const relatedComponentValue = getRelatedComponentValue(workflow);
  const relatedSummary = buildRelatedSummary();
  const audit = buildAuditReport(data, total, workflow);
  const description = [
    `总报销金额 ${total} 元，差旅费用明细共 ${rows.length} 行。`,
    relatedSummary ? `${workflow.related?.label || "关联出差申请"}：${relatedSummary}` : "",
    audit.summary ? `自动校验：${audit.summary}` : "",
  ].filter(Boolean).join("；");

  return {
    process_code: PROCESS_CODES.travel,
    evidence_validation_version: 2,
    evidence_manifest: buildEvidenceManifest(),
    attachment_row_bindings: buildAttachmentRowBindings(rows, "travel"),
    evidence_processing_tokens: getEvidenceProcessingTokens(),
    no_invoice: false,
    submission_route: getSubmissionRoutePayload(),
    related_source_process_code: getSelectedRelatedProcessCodes(workflow).join(","),
    form_component_values: [
      relatedComponentName && relatedComponentValue ? { name: relatedComponentName, ...relatedComponentValue } : null,
      {
        name: TRAVEL_TABLE_COMPONENT.name,
        id: TRAVEL_TABLE_COMPONENT.id,
        componentType: TRAVEL_TABLE_COMPONENT.componentType,
        value: buildTravelTableValue(rows),
      },
      { name: "金额（元）", value: total || amount },
      ...(companies.length ? [{ name: "需要付款的公司名称", value: JSON.stringify(companies) }] : []),
      { name: "收款人账户信息", value: String(data.recipientAccountText || "").trim() },
    ].filter((item) => item && item.value !== undefined && item.value !== ""),
    related_component_names: relatedComponentName && relatedComponentValue ? [relatedComponentName] : [],
    remark: `自动报销助手提交：${workflow.title}。${description || "无补充说明"}`,
  };
}

const DAILY_RELATION_RULES = [
  {
    key: "teamBuilding",
    label: "团建费用",
    sources: ["teamBuilding"],
    pattern: /团建|团队建设|团队活动/,
    requirement: "团建特殊审批",
  },
  {
    key: "travel",
    label: "出差差旅费用",
    sources: ["travel"],
    pattern: /出差.{0,12}(车票|机票|火车|高铁|动车|船票|住宿|酒店)|机票|火车票|高铁票|动车票|船票|住宿费|酒店费/,
    requirement: "出差申请",
  },
  {
    key: "taxi",
    label: "打车费用",
    sources: ["outing", "travel"],
    pattern: /打车|出租车|网约车|滴滴|高德打车|T3|曹操出行|顺风车/,
    requirement: "外出申请或出差申请",
  },
];

function getDailyRowRelationRule(row = {}) {
  const text = `${row.reason || ""} ${row.remark || ""}`;
  return DAILY_RELATION_RULES.find((rule) => rule.pattern.test(text)) || null;
}

function validateDailyBusinessApprovalRules(rows, workflow) {
  if (!workflow?.related) return "";
  // 项目制有一部分真实业务不以出差/外出审批为前置条件，不能再由费用文案反向强制拦截。
  if (workflow.id === "project") return "";
  const selectedSources = selectedRelatedSourceKeys();
  for (const [index, row] of rows.entries()) {
    const rule = getDailyRowRelationRule(row);
    if (!rule || rule.sources.some((source) => selectedSources.has(source))) continue;
    return `第 ${index + 1} 行“${row.reason || rule.label}”属于${rule.label}，请在“关联业务审批”中关联${rule.requirement}后再提交。`;
  }
  return "";
}

function validateBeforeSubmit(data, amount, workflow) {
  if (!workflow) return "请选择报销流程。";
  if (!amount || Number(amount) <= 0) return "请填写大于 0 的金额。";
  if (!String(data.recipientAccountText || "").trim()) return "请填写或选择收款人账户信息。";
  const companyError = validateCompanySelection(data.companyName);
  if (companyError) return companyError;
  revalidateInvoiceTitles({ notify: false });
  const pendingTitleSlots = getPendingInvoiceTitleReplacementSlots();
  if (pendingTitleSlots.length) return `有 ${pendingTitleSlots.length} 张发票抬头与付款公司不一致或无法识别，请在“上传并分配附件”中补充正确发票。`;
  const noInvoice = isNoInvoiceWorkflow(workflow);
  if (workflow.targetType === "daily") {
    const rows = readDailyRowsFromDom();
    if (!rows.length) return "请至少填写一行费用明细。";
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      if (!row.businessDate) return `请填写第 ${rowNumber} 行的业务实际发生时间。`;
      if (!row.reason?.trim()) return `请填写第 ${rowNumber} 行的申请事由。`;
      if (!formatMoney(row.amount) || Number(row.amount) <= 0) return `请填写第 ${rowNumber} 行大于 0 的金额。`;
      if (!row.project) return `请选择第 ${rowNumber} 行的所属项目/业务。`;
      if (!noInvoice && !row.invoiceType) return `请选择第 ${rowNumber} 行的发票类型。`;
      if (!row.paymentFileKeys?.length) return `请选择第 ${rowNumber} 行对应的付款截图/订单截图。`;
      if (row.invoiceType !== "无" && !row.invoiceFileKeys?.length) return `请选择第 ${rowNumber} 行对应的发票附件，或将发票类型改为“无”。`;
      const paymentEvidence = getRowEvidenceReadiness(row, "payment");
      if (!paymentEvidence.countable) return `第 ${rowNumber} 行付款凭证尚未完成上传和 OCR 识别，请在附件工作台等待识别完成或重新补传。`;
      if (row.invoiceType !== "无") {
        const invoiceEvidence = getRowEvidenceReadiness(row, "invoice");
        if (!invoiceEvidence.countable) return `第 ${rowNumber} 行发票尚未完成上传和 OCR 识别，或该文件被识别为行程单/佐证材料；请在附件工作台补传有效税务发票。`;
      }
    }
    const businessApprovalError = validateDailyBusinessApprovalRules(rows, workflow);
    if (businessApprovalError) return businessApprovalError;
  }
  if (workflow.targetType === "travel") {
    const rows = readTravelRowsFromDom();
    if (!rows.length) return "请至少添加一行差旅报销明细。";
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      if (!row.relatedInstanceId || !row.relatedBusinessId) return `请选择第 ${rowNumber} 行对应的关联出差申请。`;
      if (!formatMoney(row.amount) || Number(row.amount) <= 0) return `请填写第 ${rowNumber} 行大于 0 的报销金额。`;
      if (!row.businessDate) return `请选择第 ${rowNumber} 行费用发生日期。`;
      if (!row.expenseType) return `请选择第 ${rowNumber} 行费用类型。`;
      if (!row.reason?.trim()) return `请填写第 ${rowNumber} 行费用说明。`;
      if (!row.paymentFileKeys?.length) return `请为第 ${rowNumber} 行分配付款截图附件。`;
      if (!row.invoiceFileKeys?.length) return `请为第 ${rowNumber} 行分配发票附件。`;
    }
  }
  if (workflow.related?.required && !state.selectedRelated.length) {
    return `请先从近期审批中选择${workflow.related.label}。如果列表为空，请联系管理员确认该前置审批表单的查询权限和 process_code。`;
  }

  const assignableTypes = noInvoice ? ["payment"] : ["payment", "invoice"];
  const assignableFiles = state.files.filter((file) => !file?.titleValidation?.quarantined && assignableTypes.includes(classifyFile(file)));
  if (isRelatedDrivenWorkflow(workflow) && state.selectedRelated.length && assignableFiles.some((file) => !file.relatedInstanceId)) {
    return "已关联多条审批，请先在附件工作台中为每张付款截图和发票选择对应的关联审批。";
  }

  if (workflow.targetType === "travel" && assignableFiles.some((file) => !getFileTravelRowAssignment(getFileKey(file)))) {
    return "请在附件工作台中将每张付款截图和发票附件分配到一条差旅报销明细。";
  }

  const pendingFiles = getPendingOcrFiles();
  if (pendingFiles.length) return `还有 ${pendingFiles.length} 个附件正在逐个上传和 OCR 识别，请等待全部完成后再提交。`;
  const failedOcrFiles = getFailedOcrFiles(state.files.filter((file) => assignableTypes.includes(classifyFile(file))));
  if (failedOcrFiles.length) return `有 ${failedOcrFiles.length} 个付款截图或发票附件 OCR 识别失败，请删除后重新上传。`;
  const invoiceAttachments = noInvoice ? [] : getAttachmentsByType("invoice");
  const paymentAttachments = getAttachmentsByType("payment");
  const travelProofAttachments = [...invoiceAttachments, ...getAttachmentsByType("other")];
  const notReadyFiles = state.files.filter((file) => !file?.titleValidation?.quarantined && !file.dingtalkAttachment);
  if (notReadyFiles.length) return "还有附件未成功上传到钉钉，请删除失败附件后重试。";
  if (workflow.targetType === "travel" && !travelProofAttachments.length) return "请至少上传一份发票或证明附件。";
  if (workflow.targetType === "daily" && !paymentAttachments.length) return "请上传付款截图/订单截图。";
  if (workflow.targetType === "daily" && state.dailyRows.some((row) => row.invoiceType !== "无") && !invoiceAttachments.length) return "当前明细中存在需要发票的行，请上传对应发票。";
  const audit = buildAuditReport(data, amount, workflow);
  if (audit.errors.length) return `高风险拦截：${audit.errors[0]}`;
  return "";
}

function formatResultTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getSubmissionFailureHint(errorMessage = "") {
  const message = String(errorMessage);
  if (/审批流程.*未启用|流程编号已失效|process_not_enabled/i.test(message)) return "请联系钉钉 OA 管理员启用对应报销流程，并核对流程编号后再提交。";
  if (/免登|session|401|身份/i.test(message)) return "请在钉钉工作台内重新打开应用并完成免登后，再次提交。";
  if (/关联审批|出差申请|外出申请|团建/i.test(message)) return "请检查关联业务审批是否已选择、已通过且与当前费用场景匹配。";
  if (/附件|OCR|发票|付款凭证|缺票/i.test(message)) return "请检查每条明细的付款凭证、发票或佐证材料是否已上传并完成识别。";
  return "草稿和已上传附件仍会保留。请根据失败原因修正后再次提交，避免重复发起审批。";
}

const submissionStatusMeta = {
  scheduled: { label: "已进入待发起池", className: "scheduled", detail: "系统将按公司安排自动发起钉钉 OA" },
  dispatching: { label: "正在发起 OA", className: "dispatching", detail: "系统正在处理，请勿重复提交" },
  retry: { label: "系统处理中", className: "retry", detail: "暂未发起，系统正在自动重试" },
  unknown: { label: "结果核对中", className: "unknown", detail: "系统正在核对钉钉是否已创建审批" },
  manual: { label: "需要管理员处理", className: "manual", detail: "系统已记录并通知管理员处理" },
  succeeded: { label: "OA 已发起", className: "succeeded", detail: "钉钉 OA 已创建" },
  success: { label: "OA 已发起", className: "succeeded", detail: "钉钉 OA 已创建" },
  cancelled: { label: "已撤销", className: "cancelled", detail: "该报销未发起 OA" },
  failed: { label: "发起失败", className: "failed", detail: "钉钉 OA 未创建" },
};

function renderSubmissionReceipt(snapshot = {}, instanceId = "") {
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  return `<section class="submission-history-receipt">
    <div class="submission-history-receipt-summary">
      <span>报销总额 <b>¥${escapeHtml(snapshot.totalAmount || "0.00")}</b></span>
      <span>明细 ${rows.length} 条</span>
      <span>付款 ${Number(snapshot.paymentCount || 0)} · 发票 ${Number(snapshot.invoiceCount || 0)}</span>
    </div>
    <dl class="submission-history-receipt-meta">
      ${snapshot.companyName ? `<div><dt>付款公司</dt><dd>${escapeHtml(snapshot.companyName)}</dd></div>` : ""}
      ${snapshot.departmentName ? `<div><dt>发起部门</dt><dd>${escapeHtml(snapshot.departmentName)}</dd></div>` : ""}
      ${snapshot.recipientAccountMasked ? `<div><dt>收款账户</dt><dd>${escapeHtml(snapshot.recipientAccountMasked)}</dd></div>` : ""}
      ${instanceId ? `<div><dt>审批编号</dt><dd>${escapeHtml(instanceId)}</dd></div>` : ""}
    </dl>
    ${rows.length ? `<div class="submission-history-receipt-table-wrap"><table><thead><tr><th>日期</th><th>费用说明</th><th>金额</th><th>附件</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.date || "—")}</td><td>${escapeHtml(row.reason || "—")}</td><td>¥${escapeHtml(row.amount || "0.00")}</td><td>付款 ${Number((row.paymentAttachments || []).length)} · 发票 ${Number((row.invoiceAttachments || []).length)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${snapshot.warningSummary ? `<p class="submission-history-receipt-note">${escapeHtml(snapshot.warningSummary)}</p>` : ""}
  </section>`;
}

function showSubmissionResult({ state: resultState = "neutral", title, summary, details = [], hint = "", instanceId = "" }) {
  resultDialogContent.dataset.resultState = resultState;
  resultIcon.textContent = resultState === "success" ? "✓" : (resultState === "error" ? "!" : "i");
  resultEyebrow.textContent = resultState === "success" ? "钉钉 OA 审批" : (resultState === "error" ? "需要处理" : "提交前检查");
  resultTitle.textContent = title;
  resultText.textContent = summary;
  resultDetails.innerHTML = "";
  details.filter((item) => item?.label && item.value !== undefined && item.value !== "").forEach((item) => {
    const term = document.createElement("dt");
    term.textContent = item.label;
    const description = document.createElement("dd");
    description.textContent = item.value;
    resultDetails.append(term, description);
  });
  resultDetails.hidden = resultDetails.childElementCount === 0;
  resultHint.textContent = hint;
  resultHint.hidden = !hint;
  copyResultInstanceButton.hidden = !instanceId;
  copyResultInstanceButton.dataset.instanceId = instanceId || "";
  const closeButton = $("#closeDialog");
  if (closeButton) closeButton.textContent = resultState === "success" ? "完成并新建报销" : "返回继续填写";
  if (!dialog.open) dialog.showModal();
}

function renderSubmissionHistory(entries = []) {
  if (!submissionHistoryList) return;
  submissionHistoryList.innerHTML = entries.length
    ? entries.map((entry, index) => {
      const status = String(entry.status || "failed").toLowerCase();
      const meta = submissionStatusMeta[status] || submissionStatusMeta.failed;
      const succeeded = ["success", "succeeded"].includes(status);
      const time = formatResultTime(entry.createdAt);
      const detail = entry.processInstanceId
        ? `审批实例编号：${entry.processInstanceId}`
        : entry.scheduledAt
          ? `预计 OA 发起时间：${formatResultTime(entry.scheduledAt)}`
          : meta.detail;
      const detailId = `submission-history-receipt-${index}`;
      const advice = entry.reason || entry.advice
        ? `<p class="history-reason">${escapeHtml(entry.reason || "")}${entry.advice ? ` ${escapeHtml(entry.advice)}` : ""}</p>`
        : "";
      return `<article class="submission-history-item" data-submission-status="${escapeHtml(status)}">
        <div>
          <h3>${escapeHtml(entry.workflowTitle || "报销申请")}</h3>
          <p>${escapeHtml(time)} · ${escapeHtml(detail)}</p>
          ${advice}
          ${entry.snapshot ? `<button class="submission-history-toggle" type="button" data-history-target="${detailId}">查看完整回执</button><div id="${detailId}" class="submission-history-receipt-wrap" hidden>${renderSubmissionReceipt(entry.snapshot, entry.processInstanceId)}</div>` : ""}
        </div>
        <span class="history-status ${escapeHtml(meta.className)}">${escapeHtml(meta.label)}</span>
      </article>`;
    }).join("")
    : `<p class="submission-history-empty">暂无提交记录。后续每次发起都会在这里保留成功或失败结果。</p>`;
}

async function openSubmissionHistory() {
  if (!state.sessionToken) {
    showSubmissionResult({
      state: "error",
      title: "暂时无法读取记录",
      summary: "请先在钉钉工作台内完成登录，再查看个人提交记录。",
      details: [{ label: "原因", value: "当前没有有效的钉钉登录会话" }],
      hint: "重新打开钉钉应用后即可查看自己的提交记录。",
    });
    return;
  }
  submissionHistoryList.innerHTML = `<p class="submission-history-empty">正在读取最近提交记录…</p>`;
  if (!submissionHistoryDialog.open) submissionHistoryDialog.showModal();
  try {
    const params = new URLSearchParams({ session_token: state.sessionToken, limit: "50" });
    const response = await fetch(`${getApiBase()}/api/submission-history?${params}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "读取提交记录失败");
    renderSubmissionHistory(Array.isArray(result.entries) ? result.entries : []);
  } catch (error) {
    submissionHistoryList.innerHTML = `<p class="submission-history-empty">${escapeHtml(error.message || "读取提交记录失败")}</p>`;
  }
}

async function submitApproval(payload) {
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
  state.submissionStatus = "submitting";
  const submissionId = ensureSubmissionId();
  renderFiles();
  draftStatus.textContent = "提交中";
  addMessage("bot", "正在提交钉钉 OA，并写入已上传附件。");

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
          },
        }),
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw createApiError(responseBody.error || "钉钉审批接口返回异常", response.status);
      return responseBody;
    }, "提交审批");

    const instanceId = String(result.processInstanceId || "");
    markSubmissionSucceeded(instanceId);
    showSubmissionResult({
      state: "success",
      title: result.idempotent ? "审批已发起（已避免重复提交）" : "审批已发起",
      summary: result.idempotent ? "系统已找到本次已创建的钉钉 OA，不会重复发起。" : "钉钉 OA 已创建，正在等待后续审批处理。",
      details: [
        { label: "审批状态", value: "已发起，等待审批" },
        { label: "审批实例编号", value: instanceId },
        { label: "发起时间", value: formatResultTime() },
        { label: "报销流程", value: currentWorkflow().title },
      ],
      hint: "审批实例编号可用于在钉钉 OA 中查询本次申请。",
      instanceId,
    });
    clearSavedDraft();
    draftStatus.textContent = "已提交";
    addMessage("bot", "提交成功，OA 审批实例已经创建。");
  } catch (error) {
    markSubmissionEditable();
    showSubmissionResult({
      state: "error",
      title: "审批未发起",
      summary: "钉钉 OA 未创建，本次申请尚未进入审批流程。",
      details: [
        { label: "失败原因", value: error.message || "未获取到具体错误" },
        { label: "报销流程", value: currentWorkflow().title },
        { label: "失败时间", value: formatResultTime() },
      ],
      hint: getSubmissionFailureHint(error.message),
    });
    draftStatus.textContent = "提交失败";
    addMessage("bot", `提交失败：${error.message}`);
  }

}

async function loadDingTalkConfig() {
  const response = await fetch(`${getApiBase()}/api/dingtalk/config`);
  if (!response.ok) throw new Error("无法读取钉钉公开配置");
  state.config = await response.json();
  state.config.corpId = normalizeCorpId(getQueryValue("corpId", "corpid")) || normalizeCorpId(state.config.corpId);
}

function requestDingTalkAuthCode(corpId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("钉钉免登超时，请确认在钉钉工作台内打开应用"));
    }, 6000);

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      callback(value);
    }

    if (!window.dd?.runtime?.permission?.requestAuthCode) {
      finish(reject, new Error("当前页面没有钉钉 JSAPI 环境"));
      return;
    }
    window.dd.runtime.permission.requestAuthCode({
      corpId,
      onSuccess(result) {
        finish(resolve, result.code);
      },
      onFail(error) {
        finish(reject, new Error(error?.errorMessage || error?.message || JSON.stringify(error)));
      },
    });
  });
}

async function renewDingTalkSession({ announce = false } = {}) {
  if (dingTalkSessionRefreshPromise) return dingTalkSessionRefreshPromise;

  dingTalkSessionRefreshPromise = (async () => {
    await loadDingTalkConfig();
    if (!state.config.corpId) {
      throw new Error("缺少 corpId。请在配置里填写 corpId，或把钉钉应用首页地址改为带 ?corpId=$CORPID$。");
    }

    identityStatus.textContent = announce ? "钉钉会话已失效，正在重新免登..." : "正在向钉钉获取免登授权...";
    const authCode = await requestDingTalkAuthCode(state.config.corpId);
    identityStatus.textContent = "正在读取当前用户和部门...";
    const response = await fetch(`${getApiBase()}/api/dingtalk/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCode }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw createApiError(result.error || "钉钉登录失败", response.status);

    state.sessionToken = result.sessionToken;
    state.user = result.user;
    state.onBehalfEnabled = Boolean(result.onBehalf?.enabled);
    state.socialCompanyRecognition = result.socialCompanyRecognition || result.user?.socialCompanyRecognition || null;
    state.companySelectionSource = "manual";
    state.manualCompanyOverride = false;
    queueClientAuditEvent("client_session_ready", { action: "session_ready", ...buildClientAuditSnapshot() });
    flushClientAuditQueue();
    connectionStatus.textContent = "已登录钉钉";
    renderIdentity();
    renderSubmissionRoute();
    applySocialCompanyRecognition({ notify: true });
    if (announce) addMessage("bot", `钉钉会话已更新，当前发起人：${state.user.name}。`);
    await loadRecipientAccounts();
    return result;
  })();

  try {
    return await dingTalkSessionRefreshPromise;
  } finally {
    dingTalkSessionRefreshPromise = null;
  }
}

async function withDingTalkSessionRetry(action, label) {
  if (!state.sessionToken) await renewDingTalkSession({ announce: true });
  try {
    return await action();
  } catch (error) {
    if (!isExpiredDingTalkSessionError(error)) throw error;
    state.sessionToken = "";
    await renewDingTalkSession({ announce: true });
    return action();
  }
}

async function initializeDingTalkLogin() {
  try {
    await renewDingTalkSession();
    addMessage("bot", `已识别当前发起人：${state.user.name}。`);
    if (!promptDraftRestore()) {
      await uploadPendingFiles();
      await loadRelatedApprovals();
    }
  } catch (error) {
    connectionStatus.textContent = "待登录";
    renderIdentity();
    addMessage("bot", `钉钉免登未完成：${error.message}`);
  }
}

function renderRelatedSourceOptions() {
  if (!relatedSourceOptions) return;
  const sources = getWorkflowRelatedSources();
  relatedSourceOptions.hidden = sources.length <= 1;
  relatedSourceOptions.innerHTML = sources.map((source) => `
    <button class="related-source-option ${source.key === state.relatedSourceKey ? "selected" : ""}" type="button"
      data-related-source="${escapeHtml(source.key)}" aria-pressed="${source.key === state.relatedSourceKey}">
      ${escapeHtml(source.label)}
    </button>
  `).join("");
}

function renderRelatedOptions() {
  if (!relatedSelect) return;
  const source = getCurrentRelatedSource();
  const selectedIds = new Set(getRelatedInstanceIds());
  relatedSelect.innerHTML = state.relatedInstances.map((instance) => {
    const selected = selectedIds.has(instance.processInstanceId);
    const referenced = Boolean(instance.alreadyReferenced);
    const unavailable = isRelatedApprovalUnavailable(instance);
    const blocked = referenced || unavailable;
    const blockedText = referenced ? "已由本应用关联" : "审批未通过或已撤销";
    const travelSummary = instance.sourceKey === "travel" || instance.processCode === PROCESS_CODES.travelApplication
      ? formatRelatedTravelSummary(getRelatedTravelInfo(instance))
      : "";
    return `
      <button class="related-option ${selected ? "selected" : ""} ${blocked ? "already-referenced" : ""}" type="button"
        data-instance-id="${escapeHtml(instance.processInstanceId)}" aria-pressed="${selected}" ${blocked ? "disabled" : ""}>
        <span class="related-option-check">${selected ? "✓" : ""}</span>
        <span>
          <strong>${escapeHtml(instance.title || source?.label || currentWorkflow().related?.label || "关联审批")}</strong>
          <small>${escapeHtml([instance.businessId, blocked ? blockedText : (instance.result || instance.status)].filter(Boolean).join(" · "))}</small>
          ${travelSummary ? `<em class="related-option-travel-summary">${escapeHtml(travelSummary)}</em>` : ""}
        </span>
      </button>
    `;
  }).join("");
  relatedSelect.hidden = state.relatedInstances.length === 0;
}

function isRelatedApprovalUnavailable(instance = {}) {
  const status = `${instance.status || ""} ${instance.result || ""}`.toLowerCase();
  return /refuse|refused|reject|rejected|terminate|terminated|cancel|cancelled|canceled|revoke|withdraw|删除|撤销|拒绝|不同意|作废/.test(status);
}

async function loadRelatedApprovals() {
  const workflow = currentWorkflow();
  const source = getCurrentRelatedSource(workflow);
  if (!source?.processCode) return;
  const previouslySelectedIds = new Set(getRelatedInstanceIds());
  const requestSeq = ++state.relatedRequestSeq;
  const workflowId = workflow.id;
  const relatedProcessCode = source.processCode;
  const relatedSourceKey = source.key;
  if (!state.sessionToken) {
    relatedStatus.textContent = "请先在钉钉内完成免登，再查询近期审批。";
    return;
  }

  relatedStatus.textContent = "正在查询近一年审批...";
  relatedSelect.hidden = true;
  state.relatedInstances = [];
  renderRelatedDetail();

  try {
    const params = new URLSearchParams({
      session_token: state.sessionToken,
      process_code: relatedProcessCode,
      days: "365",
      max_results: "60",
    });
    if (isOnBehalfRoute()) params.set("user_id", getSubmissionSubjectUserId());
    const response = await fetch(`${getApiBase()}/api/related-approvals?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "查询失败");
    const latestWorkflow = currentWorkflow();
    if (
      requestSeq !== state.relatedRequestSeq ||
      latestWorkflow.id !== workflowId ||
      getCurrentRelatedSource(latestWorkflow)?.processCode !== relatedProcessCode
    ) {
      return;
    }

    state.relatedInstances = (result.instances || []).map((instance) => ({
      ...instance,
      sourceKey: relatedSourceKey,
      sourceLabel: source.label,
      sourceProcessCode: relatedProcessCode,
    }));
    const loadedIds = new Set(state.relatedInstances.map((instance) => instance.processInstanceId));
    const retainedOtherSources = state.selectedRelated.filter((instance) => instance.sourceKey && instance.sourceKey !== relatedSourceKey);
    const retainedManual = state.selectedRelated.filter((instance) => (
      (!instance.sourceKey || instance.sourceKey === relatedSourceKey) &&
      instance.manuallyAdded && !loadedIds.has(instance.processInstanceId)
    ));
    const loadedSelected = state.relatedInstances.filter((instance) => previouslySelectedIds.has(instance.processInstanceId));
    state.selectedRelated = [...retainedOtherSources, ...retainedManual, ...loadedSelected]
      .filter((instance) => !isRelatedApprovalUnavailable(instance));
    syncRelatedDrivenRows();
    renderRelatedOptions();
    renderRelatedDetail();
    renderDailyRows();
    renderTravelRows();
    syncTravelTotal();
    const referencedCount = state.relatedInstances.filter((instance) => instance.alreadyReferenced).length;
    const releasedCount = Number(result.releasedReferenceCount) || 0;
    relatedStatus.textContent = result.instances?.length
      ? `已查询到 ${result.instances.length} 条近一年${source.label}，可同时选择多条。${releasedCount ? `已自动释放 ${releasedCount} 条已撤回/终止报销的关联记录。` : ""}${referencedCount ? `其中 ${referencedCount} 条已由本应用关联，已禁选。` : ""}`
      : (workflow.related.emptyHint || `未查询到近一年${source.label}，请确认该前置审批已由当前用户发起，或检查应用审批读取权限。`);
  } catch (error) {
    const latestWorkflow = currentWorkflow();
    if (
      requestSeq !== state.relatedRequestSeq ||
      latestWorkflow.id !== workflowId ||
      getCurrentRelatedSource(latestWorkflow)?.processCode !== relatedProcessCode
    ) {
      return;
    }
    relatedStatus.textContent = `查询失败：${error.message}。请检查审批读取权限或前置审批 process_code。`;
  }
}

async function addManualRelatedApproval() {
  const workflow = currentWorkflow();
  const source = getCurrentRelatedSource(workflow);
  const instanceId = extractManualRelatedInstanceId(relatedManualInput.value);
  if (!instanceId) {
    relatedStatus.textContent = "请先粘贴要关联的审批实例编号。";
    return;
  }
  if (!state.sessionToken || !source?.processCode) {
    relatedStatus.textContent = "请先在钉钉内完成登录并选择需要关联审批的流程。";
    return;
  }
  addManualRelatedButton.disabled = true;
  addManualRelatedButton.textContent = "校验中";
  try {
    const params = new URLSearchParams({
      session_token: state.sessionToken,
      instance_id: instanceId,
      process_code: source.processCode,
    });
    if (isOnBehalfRoute()) params.set("user_id", getSubmissionSubjectUserId());
    const response = await fetch(`${getApiBase()}/api/related-approval-by-id?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "审批校验失败");
    const instance = {
      ...result.instance,
      manuallyAdded: true,
      sourceKey: source.key,
      sourceLabel: source.label,
      sourceProcessCode: source.processCode,
    };
    if (instance.alreadyReferenced) {
      relatedStatus.textContent = "该审批已由本应用的早期报销记录关联，不能重复选择。";
      return;
    }
    if (isRelatedApprovalUnavailable(instance)) {
      relatedStatus.textContent = "该前置审批未通过、已撤销或已终止，不能用于发起报销。";
      return;
    }
    if (!state.relatedInstances.some((item) => item.processInstanceId === instance.processInstanceId)) {
      state.relatedInstances = [instance, ...state.relatedInstances];
    }
    if (!state.selectedRelated.some((item) => item.processInstanceId === instance.processInstanceId)) {
      state.selectedRelated = [...state.selectedRelated, instance];
    }
    relatedManualInput.value = "";
    relatedStatus.textContent = `已补录并选中 1 条${source.label}。`;
    syncRelatedDrivenRows();
    renderRelatedOptions();
    renderRelatedDetail();
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncTravelTotal();
    syncDraft();
  } catch (error) {
    relatedStatus.textContent = `无法补录该审批：${error.message}`;
  } finally {
    addManualRelatedButton.disabled = false;
    addManualRelatedButton.textContent = "添加关联";
  }
}

function resetForm({ announce = true } = {}) {
  if (state.files.length || state.dailyRows.length || state.travelRows.length) queueClientAuditEvent("draft_reset", { action: "reset", ...buildClientAuditSnapshot() }, { critical: true });
  state.files = [];
  state.processingEvents = [];
  state.invoiceTitleReplacementSlots = [];
  state.activeInvoiceTitleReplacementSlotId = "";
  state.invoiceTitleValidationCompany = "";
  state.pendingOnBehalfSubject = null;
  state.submissionRoute = { mode: "self", subjectUserId: "", subjectName: "", departmentId: "", departmentName: "", socialCompanyRecognition: null };
  state.resumeSubmitAfterDuplicateReview = false;
  state.ocrSuggestionRollback = null;
  state.ocrSuggestionBatchId = "";
  if (rollbackOcrSuggestionsButton) rollbackOcrSuggestionsButton.hidden = true;
  state.dailyRows = [createDailyRow()];
  state.travelRows = [];
  state.selectedRelated = [];
  state.relatedInstances = [];
  state.relatedSourceKey = "";
  state.selectedRecipientAccountId = "";
  state.submissionId = "";
  state.workflowId = DEFAULT_WORKFLOW_ID;
  markSubmissionEditable();
  clearSavedDraft();
  form.reset();
  recipientAccountTextInput.value = "";
  clearRecipientAccountValidity();
  recipientAccountStatus.textContent = state.user
    ? "请选择已保存账户，或手工填写完整的收款账户信息。"
    : "登录后可查看本人已保存的收款账户。";
  projectSelect.value = "";
  invoiceTypeSelect.value = "";
  expenseTypeSelect.value = "";
  relatedSelect.hidden = true;
  relatedStatus.textContent = "暂未选择关联审批。";
  renderRelatedDetail(null);
  renderFiles();
  renderDailyRows();
  renderWorkflowForm();
  renderIdentity();
  renderSubmissionRoute();
  if (announce) addMessage("bot", "已清空当前表单和附件。");
}

function startNewReimbursement() {
  resetForm({ announce: false });
  if (dialog.open) dialog.close();
  document.dispatchEvent(new CustomEvent("reimbursement:new-submission"));
  addMessage("bot", "本次审批已结束，已为你创建一笔空白报销申请。");
  state.clientAuditTraceId = "";
  state.clientAuditSequence = 0;
  queueClientAuditEvent("draft_created", { action: "new_reimbursement", ...buildClientAuditSnapshot() }, { critical: true });
}

function selectWorkflow(workflowId) {
  if (!WORKFLOWS.some((workflow) => workflow.id === workflowId)) return;
  state.workflowId = workflowId;
  workflowSelect.value = workflowId;
  state.selectedRelated = [];
  state.relatedInstances = [];
  state.relatedSourceKey = "";
  state.relatedRequestSeq += 1;
  ensureDailyRows();
  relatedManualInput.value = "";
  relatedSelect.hidden = true;
  relatedStatus.textContent = "暂未选择关联审批。";
  renderRelatedDetail(null);
  renderWorkflowForm();
  renderWorkflowCards();
  loadRelatedApprovals();
  queueClientAuditEvent("workflow_selected", { action: "workflow_selected", workflowId });
}

function bindEvents() {
  onBehalfOpenButton?.addEventListener("click", showOnBehalfDialog);
  onBehalfSelfButton?.addEventListener("click", () => setSelfSubmissionRoute({ announce: true }));
  onBehalfSearchButton?.addEventListener("click", () => searchOnBehalfEmployees().catch((error) => {
    onBehalfStatus.textContent = `查询失败：${error.message}`;
  }));
  onBehalfSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchOnBehalfEmployees().catch((error) => { onBehalfStatus.textContent = `查询失败：${error.message}`; });
    }
  });
  onBehalfResults?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-on-behalf-user-id]");
    if (button) previewOnBehalfEmployee(button.dataset.onBehalfUserId);
  });
  onBehalfConfirmButton?.addEventListener("click", confirmOnBehalfSubject);
  routeModeSection?.addEventListener("click", (event) => {
    if (event.target.closest("#onBehalfOpenButton")) showOnBehalfDialog();
  });

  workflowSelect.addEventListener("change", () => {
    selectWorkflow(workflowSelect.value);
  });

  workflowCards.addEventListener("click", (event) => {
    const button = event.target.closest(".workflow-card");
    if (!button) return;
    selectWorkflow(button.dataset.workflowId);
  });

  [
    [paymentFileInput, "payment"],
    [invoiceFileInput, "invoice"],
    [otherFileInput, "other"],
  ].forEach(([input, kind]) => {
    input.addEventListener("change", async (event) => {
      await addFiles(event.target.files, kind);
      input.value = "";
    });
  });

  [
    [paymentDropZone, "payment"],
    [invoiceDropZone, "invoice"],
    [otherDropZone, "other"],
  ].forEach(([zone, kind]) => {
    ["dragenter", "dragover"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("dragover");
      });
    });
    zone.addEventListener("drop", async (event) => {
      await addFiles(event.dataTransfer.files, kind);
    });
  });

  filesList.addEventListener("click", (event) => {
    const previewButton = event.target.closest('[data-action="preview-file"]');
    if (previewButton) {
      openAttachmentPreview(getFileByKey(previewButton.dataset.key));
      return;
    }
    const renameButton = event.target.closest(".rename-file");
    if (renameButton) {
      openAttachmentRenameDialog(getFileByKey(renameButton.dataset.key));
      return;
    }
    const button = event.target.closest(".remove-file");
    if (!button) return;
    if (!discardFileFromDraft(button.dataset.key)) return;
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncDraft();
    addMessage("bot", "已删除该文件，可以重新上传或直接提交。");
  });

  attachmentRenameDialog?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveAttachmentRename();
  });
  cancelAttachmentRenameButton?.addEventListener("click", closeAttachmentRenameDialog);
  closeAttachmentRenameDialogButton?.addEventListener("click", closeAttachmentRenameDialog);
  attachmentRenameInput?.addEventListener("input", () => {
    attachmentRenameInput.setCustomValidity("");
    attachmentRenameStatus.textContent = "";
  });

  toggleAttachmentDockButton.addEventListener("click", () => {
    state.attachmentDockExpanded = !state.attachmentDockExpanded;
    renderFiles();
  });

  amountInput.addEventListener("input", syncDraft);
  amountInput.addEventListener("blur", () => {
    const formatted = formatMoney(amountInput.value);
    if (formatted) amountInput.value = formatted;
    syncDraft();
  });

  companySelect.addEventListener("input", () => {
    validateCompanySelection();
    openCompanyOptions(companySelect.value);
    syncDraft();
  });
  companySelect.addEventListener("change", () => {
    if (validateCompanySelection()) return;
    const selectedCompany = companySelect.value.trim();
    if (!confirmManualCompanyOverride(selectedCompany)) {
      revalidateInvoiceTitles({ notify: true });
      renderFiles();
      renderDailyRows();
      renderTravelRows();
      syncDraft();
      renderCompanyOptions({ applyDefault: false });
      return;
    }
    applySelectedCompany(selectedCompany, {
      source: selectedCompany === getSocialCompanyRecognition()?.companyName ? "social_security" : "manual",
      manualOverride: selectedCompany !== getSocialCompanyRecognition()?.companyName,
    });
    revalidateInvoiceTitles({ notify: true });
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncDraft();
  });
  departmentSelect.addEventListener("change", () => {
    if (isOnBehalfRoute()) {
      state.submissionRoute.departmentId = String(departmentSelect.value || "");
      state.submissionRoute.departmentName = departmentSelect.selectedOptions?.[0]?.textContent || "";
      renderSubmissionRoute();
    }
    syncDraft();
  });
  companySelect.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && companyOptionsMenu?.hidden) {
      event.preventDefault();
      openCompanyOptions("");
    }
    if (event.key === "Escape") closeCompanyOptions();
  });
  companyMenuToggle?.addEventListener("click", () => {
    if (companyOptionsMenu?.hidden) {
      // Deliberately ignore the current input when the arrow is clicked:
      // users must be able to choose another company without clearing the default.
      openCompanyOptions("");
    } else {
      closeCompanyOptions();
    }
  });
  companyOptionsMenu?.addEventListener("click", (event) => {
    const option = event.target.closest(".company-option");
    if (option?.dataset.company) selectCompanyOption(option.dataset.company);
  });
  companyRecognitionRefreshButton?.addEventListener("click", async () => {
    companyRecognitionRefreshButton.disabled = true;
    const originalText = companyRecognitionRefreshButton.textContent;
    companyRecognitionRefreshButton.textContent = "检测中...";
    try {
      await withDingTalkSessionRetry(refreshSocialCompanyRecognition, "重新检测社保主体");
    } catch (error) {
      addMessage("bot", `暂时无法重新检测社保主体：${error.message || "请稍后再试"}。当前仍可手动选择付款公司。`);
    } finally {
      companyRecognitionRefreshButton.disabled = false;
      companyRecognitionRefreshButton.textContent = originalText;
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (companyField && !companyField.contains(event.target)) closeCompanyOptions();
  });

  recipientAccountTextInput.addEventListener("input", () => {
    recipientAccountTextInput.setCustomValidity("");
    const selected = state.recipientAccounts.find((item) => item.id === state.selectedRecipientAccountId);
    if (selected && recipientAccountTextInput.value !== formatRecipientAccountText(selected)) {
      state.selectedRecipientAccountId = "";
      recipientAccountStatus.textContent = "已手工修改账户信息，将按当前文本提交。";
      renderRecipientAccounts();
    }
    syncDraft();
  });
  recipientAccountTextInput.addEventListener("invalid", () => {
    recipientAccountTextInput.setCustomValidity("请填写或选择收款人账户信息。");
  });

  openRecipientAccountDialogButton?.addEventListener("click", async () => {
    if (!state.sessionToken) {
      recipientAccountStatus.textContent = "请先在钉钉内完成登录后再管理收款账户。";
      return;
    }
    try {
      await loadRecipientAccounts();
      clearRecipientAccountEditor();
      recipientAccountDialog.showModal();
    } catch (error) {
      recipientAccountStatus.textContent = `读取收款账户失败：${error.message}`;
    }
  });
  closeRecipientAccountDialogButton?.addEventListener("click", () => recipientAccountDialog.close());
  recipientAccountTypeInput?.addEventListener("change", updateRecipientAccountEditorFields);
  resetRecipientAccountEditorButton?.addEventListener("click", clearRecipientAccountEditor);
  saveRecipientAccountButton?.addEventListener("click", async () => {
    try {
      await saveRecipientAccount();
    } catch (error) {
      recipientAccountEditorTip.textContent = error.message;
    }
  });
  recipientAccountsList?.addEventListener("click", async (event) => {
    const select = event.target.closest("[data-recipient-account-select]");
    if (select) {
      selectRecipientAccount(select.dataset.recipientAccountSelect);
      return;
    }
    const edit = event.target.closest("[data-recipient-account-edit]");
    if (edit) {
      editRecipientAccount(edit.dataset.recipientAccountEdit);
      return;
    }
    const remove = event.target.closest("[data-recipient-account-delete]");
    if (remove) {
      try {
        await deleteRecipientAccount(remove.dataset.recipientAccountDelete);
      } catch (error) {
        recipientAccountEditorTip.textContent = error.message;
      }
    }
  });

  relatedSourceOptions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-related-source]");
    if (!button || button.dataset.relatedSource === state.relatedSourceKey) return;
    const source = getWorkflowRelatedSources().find((item) => item.key === button.dataset.relatedSource);
    if (!source) return;
    state.relatedSourceKey = source.key;
    state.relatedInstances = [];
    state.relatedRequestSeq += 1;
    relatedSelect.hidden = true;
    relatedSelect.innerHTML = "";
    relatedStatus.textContent = `当前选择“${source.label}”。点击“查询近一年${source.label}”后选择需要关联的审批。`;
    renderRelatedSourceOptions();
    renderRelatedDetail();
    loadRelatedButton.textContent = `查询近一年${source.label}`;
    syncDraft();
  });
  loadRelatedButton.addEventListener("click", loadRelatedApprovals);
  addManualRelatedButton?.addEventListener("click", addManualRelatedApproval);
  relatedManualInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addManualRelatedApproval();
    }
  });
  relatedSelect.addEventListener("click", (event) => {
    const button = event.target.closest(".related-option");
    if (!button) return;
    const instance = state.relatedInstances.find((item) => item.processInstanceId === button.dataset.instanceId);
    if (!instance) return;
    if (instance.alreadyReferenced) {
      relatedStatus.textContent = "该审批已由本应用的早期报销记录关联，不能重复选择。";
      return;
    }
    if (isRelatedApprovalUnavailable(instance)) {
      relatedStatus.textContent = "该前置审批未通过、已撤销或已终止，不能用于发起报销。";
      return;
    }
    const selectedCountBefore = state.selectedRelated.length;
    const previousOnlyRelatedId = selectedCountBefore === 1 ? state.selectedRelated[0]?.processInstanceId : "";
    const selected = state.selectedRelated.some((item) => item.processInstanceId === instance.processInstanceId);
    state.selectedRelated = selected
      ? state.selectedRelated.filter((item) => item.processInstanceId !== instance.processInstanceId)
      : [...state.selectedRelated, instance];
    const validIds = new Set(getRelatedInstanceIds());
    state.files.forEach((file) => {
      if (file.relatedInstanceId && !validIds.has(file.relatedInstanceId)) file.relatedInstanceId = "";
      if (selectedCountBefore === 1 && state.selectedRelated.length > 1
        && file.relatedInstanceId === previousOnlyRelatedId) {
        file.relatedInstanceId = "";
        file.relatedAutoAssigned = false;
      }
      if (!file.relatedInstanceId && state.selectedRelated.length === 1) {
        file.relatedInstanceId = state.selectedRelated[0].processInstanceId;
        file.relatedAutoAssigned = true;
      }
    });
    syncRelatedDrivenRows();
    if (currentWorkflow().targetType === "travel") {
      state.travelRows.forEach((row) => {
        if (!row.relatedInstanceId) return;
        const related = getRelatedById(row.relatedInstanceId);
        row.relatedBusinessId = related?.businessId || row.relatedBusinessId;
        row.relatedTitle = related?.title || row.relatedTitle;
      });
    }
    relatedStatus.textContent = state.selectedRelated.length
      ? `已选择 ${state.selectedRelated.length} 条关联审批。上传附件后可继续按审批归类。`
      : "暂未选择关联审批。";
    renderRelatedOptions();
    renderRelatedDetail();
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncTravelTotal();
    syncDraft();
  });

  dailyRowsBody.addEventListener("input", syncDraft);
  dailyRowsBody.addEventListener("change", syncDraft);
  dailyRowsBody.addEventListener("pointerdown", (event) => beginCellFill(event, "daily"));
  dailyRowsBody.addEventListener("keydown", (event) => fillCurrentCellDown(event, "daily"));
  dailyRowsBody.addEventListener("dragover", handleRowFileDragOver);
  dailyRowsBody.addEventListener("dragleave", handleRowFileDragLeave);
  dailyRowsBody.addEventListener("drop", handleRowFileDrop);
  dailyRowsBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    readDailyRowsFromDom();
    const rowId = button.closest("tr")?.dataset.rowId;
    const index = state.dailyRows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    if (button.dataset.action === "preview-file") {
      openAttachmentPreview(getFileByKey(button.dataset.key));
      return;
    }
    if (button.dataset.action === "upload-row-payment") {
      pickRowFiles("payment", rowId);
      return;
    }
    if (button.dataset.action === "upload-row-invoice") {
      pickRowFiles("invoice", rowId);
      return;
    }
    if (button.dataset.action === "unlink-row-file") {
      unlinkFileFromRow(state.dailyRows[index], button.dataset.key, button.dataset.kind, "daily");
      if (isRelatedDrivenWorkflow() && state.dailyRows[index].autoGeneratedFromRelated) {
        const file = getFileByKey(button.dataset.key);
        if (file?.relatedInstanceId === state.dailyRows[index].relatedInstanceId) file.relatedInstanceId = "";
        syncRelatedDrivenRows();
      }
      syncAssignedRowAmountsFromPayments();
      renderDailyRows();
      syncDraft();
      return;
    }
    if (button.dataset.action === "copy-row") {
      state.dailyRows.splice(index + 1, 0, createDailyRow({
        ...state.dailyRows[index],
        id: undefined,
        paymentFileKeys: [],
        invoiceFileKeys: [],
      }));
    }
    if (button.dataset.action === "remove-row" && state.dailyRows.length > 1) {
      detachFilesFromRemovedRow(state.dailyRows[index], "daily");
      state.dailyRows.splice(index, 1);
    }
    renderDailyRows();
    syncDraft();
  });

  addDailyRowButton.addEventListener("click", () => {
    readDailyRowsFromDom();
    state.dailyRows.push(createDailyRow());
    renderDailyRows();
    syncDraft();
  });

  importExpenseSheetButton?.addEventListener("click", () => expenseSheetInput?.click());
  expenseSheetInput?.addEventListener("change", async () => {
    const [file] = Array.from(expenseSheetInput.files || []);
    expenseSheetInput.value = "";
    if (!file) return;
    importExpenseSheetButton.disabled = true;
    try {
      await importExpenseSheet(file);
    } catch (error) {
      const message = `Excel 导入失败：${error.message}`;
      showDailyImportNotice(message);
      addMessage("bot", message);
    } finally {
      importExpenseSheetButton.disabled = false;
    }
  });

  travelRowsBody?.addEventListener("input", () => {
    readTravelRowsFromDom();
    syncTravelTotal();
    syncDraft();
  });
  travelRowsBody?.addEventListener("change", () => {
    readTravelRowsFromDom();
    syncTravelTotal();
    syncDraft();
  });
  travelRowsBody?.addEventListener("pointerdown", (event) => beginCellFill(event, "travel"));
  travelRowsBody?.addEventListener("keydown", (event) => fillCurrentCellDown(event, "travel"));
  travelRowsBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    readTravelRowsFromDom();
    const rowId = button.closest("tr")?.dataset.rowId;
    const index = state.travelRows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    if (button.dataset.action === "preview-file") {
      openAttachmentPreview(getFileByKey(button.dataset.key));
      return;
    }
    if (button.dataset.action === "upload-travel-payment") {
      pickRowFiles("payment", `travel:${rowId}`);
      return;
    }
    if (button.dataset.action === "upload-travel-invoice") {
      pickRowFiles("invoice", `travel:${rowId}`);
      return;
    }
    if (button.dataset.action === "unlink-travel-file") {
      unlinkFileFromRow(state.travelRows[index], button.dataset.key, button.dataset.kind, "travel");
      if (isRelatedDrivenWorkflow() && state.travelRows[index].autoGeneratedFromRelated) {
        const file = getFileByKey(button.dataset.key);
        if (file?.relatedInstanceId === state.travelRows[index].relatedInstanceId) file.relatedInstanceId = "";
        syncRelatedDrivenRows();
      }
      syncAssignedRowAmountsFromPayments();
    }
    if (button.dataset.action === "copy-travel-row") {
      state.travelRows.splice(index + 1, 0, createTravelRow({ ...state.travelRows[index], id: undefined, paymentFileKeys: [], invoiceFileKeys: [], autoGeneratedFromRelated: false, manualSplit: true }));
    }
    if (button.dataset.action === "split-travel-row") {
      state.travelRows.splice(index + 1, 0, createTravelRow({ ...state.travelRows[index], id: undefined, paymentFileKeys: [], invoiceFileKeys: [], autoGeneratedFromRelated: false, manualSplit: true }));
    }
    if (button.dataset.action === "remove-travel-row") state.travelRows.splice(index, 1);
    renderTravelRows();
    syncTravelTotal();
    syncDraft();
  });
  addTravelRowButton?.addEventListener("click", () => {
    readTravelRowsFromDom();
    state.travelRows.push(createTravelRow({ manualSplit: isRelatedDrivenWorkflow() }));
    renderTravelRows();
    syncTravelTotal();
    syncDraft();
  });

  saveDraftButton?.addEventListener("click", () => {
    saveDraft(false);
  });

  restoreDraftButton?.addEventListener("click", async () => {
    const candidate = state.pendingDraftCandidate;
    state.pendingDraftCandidate = null;
    state.draftRestorePending = false;
    if (candidate?.draft) {
      restoreSavedDraft(candidate.draft);
      if (candidate.legacy) saveDraft(true);
      renderWorkflowSelect();
      renderWorkflowForm();
      renderWorkflowCards();
      renderFiles();
      renderDailyRows();
      renderTravelRows();
      renderRelatedDetail();
      await uploadPendingFiles();
      await loadRelatedApprovals();
      document.dispatchEvent(new CustomEvent("reimbursement:draft-restored", {
        detail: { workflowId: state.workflowId },
      }));
      addMessage("bot", "已恢复上次未完成的草稿。请注意：未上传完成的本地附件需要重新选择。 ");
    }
    draftRestoreDialog.close();
    scheduleAutoSave();
  });

  discardDraftButton?.addEventListener("click", () => {
    state.pendingDraftCandidate = null;
    state.draftRestorePending = false;
    clearSavedDraft(true);
    draftRestoreDialog.close();
    scheduleAutoSave();
    addMessage("bot", "已开始新的填写记录，旧草稿已清除。");
  });

  toggleDraftButton?.addEventListener("click", () => {
    setDraftCollapsed(!state.draftCollapsed);
  });

  collapseDraftButton.addEventListener("click", () => {
    setDraftCollapsed(true);
  });

  floatingDraftButton.addEventListener("click", () => {
    setDraftCollapsed(false);
  });

  $("#resetButton").addEventListener("click", () => resetForm());
  $("#closeDialog").addEventListener("click", () => {
    if (isSubmissionLocked()) startNewReimbursement();
    else dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    // 成功回执必须经“完成并新建报销”结束，避免用户关掉回执后继续提交旧表单。
    if (isSubmissionLocked()) event.preventDefault();
  });
  copyResultInstanceButton?.addEventListener("click", async () => {
    const instanceId = copyResultInstanceButton.dataset.instanceId || "";
    if (!instanceId) return;
    try {
      await navigator.clipboard.writeText(instanceId);
      copyResultInstanceButton.textContent = "已复制";
      window.setTimeout(() => { copyResultInstanceButton.textContent = "复制审批编号"; }, 1400);
    } catch {
      copyResultInstanceButton.textContent = "请手动复制";
    }
  });

  assignAttachmentsButton?.addEventListener("click", () => openAttachmentAssignment());
  submissionHistoryButton?.addEventListener("click", openSubmissionHistory);
  closeSubmissionHistoryDialog?.addEventListener("click", () => submissionHistoryDialog.close());
  submissionHistoryList?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-history-target]");
    if (!toggle) return;
    const target = document.getElementById(toggle.dataset.historyTarget);
    if (!target) return;
    target.hidden = !target.hidden;
    toggle.textContent = target.hidden ? "查看完整回执" : "收起完整回执";
  });
  $("#assignmentUploadPayment")?.addEventListener("click", () => paymentFileInput.click());
  $("#assignmentUploadInvoice")?.addEventListener("click", () => invoiceFileInput.click());
  $("#closeAssignmentDialog")?.addEventListener("click", () => attachmentAssignmentDialog.close());
  closeOcrSuggestionDialog?.addEventListener("click", () => ocrSuggestionDialog.close());
  closeOcrSuggestionButton?.addEventListener("click", () => ocrSuggestionDialog.close());
  ocrSuggestionList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="preview-file"]');
    if (!button) return;
    void openAttachmentPreview(getFileByKey(button.dataset.key));
  });
  duplicateReviewList?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="preview-file"]');
    if (!button) return;
    void openAttachmentPreview(getFileByKey(button.dataset.key));
  });
  applyOcrSuggestionsButton?.addEventListener("click", applyOcrDetailSuggestions);
  rollbackOcrSuggestionsButton?.addEventListener("click", rollbackOcrDetailSuggestions);
  reviewPossibleDuplicatesButton?.addEventListener("click", () => openDuplicateReviewDialog());
  closeDuplicateReviewDialogButton?.addEventListener("click", () => {
    state.resumeSubmitAfterDuplicateReview = false;
    duplicateReviewDialog.close();
  });
  saveDuplicateReviewButton?.addEventListener("click", saveDuplicateReview);
  applyAttachmentAssignments?.addEventListener("click", () => {
    syncRelatedDrivenRows();
    syncAssignedRowAmountsFromPayments();
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncTravelTotal();
    renderTravelRows();
    syncDraft();
    attachmentAssignmentDialog.close();
    window.setTimeout(openOcrSuggestionDialog, 0);
  });
  assignmentSections?.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-assignment-action='preview-file']");
    if (previewButton) {
      void openAttachmentPreview(getFileByKey(previewButton.dataset.fileKey));
      return;
    }
    const useOcrButton = event.target.closest("[data-assignment-action='use-file-ocr']");
    if (useOcrButton) {
      const file = getFileByKey(useOcrButton.dataset.fileKey);
      if (!file) return;
      const rawAmount = useOcrButton.dataset.value || getRawOcrAmount(file);
      if (!rawAmount) return;
      file.manualAmount = formatMoney(rawAmount);
      syncAssignedRowAmountsFromPayments();
      renderDailyRows();
      renderTravelRows();
      syncTravelTotal();
      renderAttachmentAssignments();
      renderFiles();
      syncDraft();
      return;
    }
    const fillButton = event.target.closest("[data-assignment-action='fill-payment-total']");
    if (fillButton) {
      const isTravel = fillButton.dataset.assignmentLayer === "travel-row";
      const rows = isTravel ? state.travelRows : state.dailyRows;
      const row = rows.find((item) => item.id === fillButton.dataset.targetId);
      if (!row) return;
      row.amount = formatMoney(getAssignmentTotals(row).payment);
      row.amountAutoFilled = false;
      // Render the source table first. The assignment dialog reads from that DOM,
      // so refreshing it first would overwrite the just-filled amount with 0.00.
      if (isTravel) {
        renderTravelRows();
        syncTravelTotal();
      } else {
        renderDailyRows();
      }
      syncDraft();
      renderAttachmentAssignments();
      return;
    }
    const button = event.target.closest(".assignment-file-choice");
    if (!button) return;
    if (button.dataset.assignmentLayer === "row") {
      toggleFileRowAssignment(button.dataset.fileKey, button.dataset.targetId, button.dataset.kind);
    } else if (button.dataset.assignmentLayer === "travel-row") {
      toggleFileTravelRowAssignment(button.dataset.fileKey, button.dataset.targetId, button.dataset.kind);
    } else {
      toggleFileRelatedAssignment(button.dataset.fileKey, button.dataset.targetId);
    }
    syncAssignedRowAmountsFromPayments();
    // Render the source table before rebuilding the dialog: rebuilding the
    // dialog reads the table DOM and would otherwise restore its old amount.
    renderFiles();
    renderDailyRows();
    renderTravelRows();
    syncTravelTotal();
    renderAttachmentAssignments();
    syncDraft();
  });
  assignmentSections?.addEventListener("change", (event) => {
    const fileAmountInput = event.target.closest("[data-assignment-file-amount]");
    if (fileAmountInput) {
      const file = getFileByKey(fileAmountInput.dataset.fileKey);
      if (!file) return;
      file.manualAmount = formatMoney(fileAmountInput.value) || "";
      syncAssignedRowAmountsFromPayments();
      renderDailyRows();
      renderTravelRows();
      syncTravelTotal();
      renderAttachmentAssignments();
      renderFiles();
      syncDraft();
      return;
    }

    const rowAmountInput = event.target.closest("[data-assignment-row-amount]");
    if (!rowAmountInput) return;
    const isTravel = rowAmountInput.dataset.assignmentLayer === "travel-row";
    const rows = isTravel ? state.travelRows : state.dailyRows;
    const row = rows.find((item) => item.id === rowAmountInput.dataset.targetId);
    if (!row) return;
    row.amount = formatMoney(rowAmountInput.value) || "";
    row.amountAutoFilled = false;
    if (isTravel) {
      renderTravelRows();
      syncTravelTotal();
    } else {
      renderDailyRows();
    }
    syncDraft();
    renderAttachmentAssignments();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
      data.amount = formatMoney(getTravelRowsTotal());
    }
    const amount = formatMoney(data.amount);
    amountInput.value = amount || data.amount || "";
    syncDraft();

    if (!state.sessionToken) {
      try {
        await renewDingTalkSession({ announce: true });
      } catch (error) {
        markSubmissionEditable();
        renderFiles();
        showSubmissionResult({
          state: "error",
          title: "未获取钉钉身份",
          summary: "请在钉钉工作台内打开应用，完成免登后再提交。",
          details: [{ label: "失败原因", value: error.message || "钉钉免登未完成" }],
          hint: "完成钉钉免登后，当前草稿仍可继续填写和提交。",
        });
        return;
      }
    }

    await uploadPendingFiles();

    if (getPossibleDuplicateFiles({ unresolvedOnly: true }).length) {
      markSubmissionEditable();
      renderFiles();
      openDuplicateReviewDialog({ resumeSubmit: true });
      return;
    }

    const validationError = validateBeforeSubmit(data, amount, workflow);
    if (validationError) {
      markSubmissionEditable();
      renderFiles();
      showSubmissionResult({
        state: "error",
        title: "暂时无法提交",
        summary: "请完成以下项目后再发起审批。",
        details: [
          { label: "需要处理", value: validationError },
          { label: "报销流程", value: workflow.title },
        ],
        hint: "修正后可直接再次提交，无需重新上传已完成识别的附件。",
      });
      return;
    }

    const payloadBase = workflow.targetType === "travel"
      ? buildTravelPayload(data, amount, workflow)
      : buildDailyPayload(data, amount, workflow);

    await submitApproval({
      session_token: state.sessionToken,
      dept_id: data.deptId,
      ...payloadBase,
    });
  });
}

function initializeStaticOptions() {
  setOptions(projectSelect, PROJECT_OPTIONS);
  setOptions(invoiceTypeSelect, INVOICE_TYPE_OPTIONS);
  setOptions(expenseTypeSelect, EXPENSE_TYPE_OPTIONS);
  renderCompanyOptions();
}

function initializeDefaults() {
  businessDateInput.value = todayValue();
  amountInput.value = "";
  invoiceTypeSelect.value = "";
  expenseTypeSelect.value = "";
  state.dailyRows = [createDailyRow()];
  state.travelRows = [];
}

if (oaFormMount && form.parentElement !== oaFormMount) oaFormMount.append(form);
const resetButton = $("#resetButton");
if (resetButton && $(".topbar-actions")) $(".topbar-actions").prepend(resetButton);

initializeStaticOptions();
initializeDefaults();
renderWorkflowSelect();
renderWorkflowForm();
renderFiles();
renderDailyRows();
renderIdentity();
clearRecipientAccountEditor();
renderRecipientAccounts();
renderDraftToggle();
bindEvents();
initializeDingTalkLogin();
