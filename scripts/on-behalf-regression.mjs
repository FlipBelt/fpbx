import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const v2Source = await readFile(new URL("../v2.js", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const v2CssSource = await readFile(new URL("../v2.css", import.meta.url), "utf8");
const ecosystemSource = await readFile(new URL("../ecosystem.config.cjs", import.meta.url), "utf8");

process.env.OCR_REGRESSION = "1";
const {
  normalizeSubmissionRouteMode,
  normalizeApprovalPayload,
  resolveSubmissionRoute,
} = await import("../server.mjs");

const checks = [
  ["独立代他人报销入口存在", htmlSource.includes('id="routeModeSection"') && htmlSource.includes('id="onBehalfOpenButton"') && htmlSource.includes("代他人报销")],
  ["代报入口默认不改变本人模式", appSource.includes('mode: "self"') && appSource.includes("setSelfSubmissionRoute") && !appSource.includes('state.workflowId = "on_behalf"')],
  ["前端保存代报归属人和路由摘要", appSource.includes("getSubmissionRoutePayload") && appSource.includes("submissionRoute:") && appSource.includes("subjectDepartments")],
  ["前端通过后端接口搜索并读取归属人", appSource.includes("/api/dingtalk/on-behalf/search") && appSource.includes("/api/dingtalk/on-behalf/profile")],
  ["代报切换会刷新部门、公司和关联审批", appSource.includes("applySubjectDepartmentOptions") && appSource.includes("loadRelatedApprovals()") && appSource.includes("subject_social_security")],
  ["提交载荷携带独立路由信息", appSource.includes("submission_route: getSubmissionRoutePayload()") && appSource.includes("dept_id: data.deptId")],
  ["代报关联审批按归属人查询", appSource.includes('params.set("user_id", getSubmissionSubjectUserId())')],
  ["后端代报功能有独立开关", serverSource.includes("getOnBehalfConfig") && serverSource.includes("REIMBURSEMENT_ON_BEHALF_ENABLED") && serverSource.includes("canUseOnBehalf")],
  ["后端代报入口搜索与员工档案接口存在", serverSource.includes("/api/dingtalk/on-behalf/search") && serverSource.includes("/api/dingtalk/on-behalf/profile") && serverSource.includes("listDingTalkEmployees")],
  ["后端代报档案按钉钉组织和HRM社保主体重查", serverSource.includes("getDingTalkEmployeeProfile") && serverSource.includes("syncDingTalkUserOrganization") && serverSource.includes("recognizeSocialPaymentCompany")],
  ["本人路由仍使用原部门限制", serverSource.includes("route.mode === \"on_behalf\" ? (route.subjectDepartments || []) : (sessionUser?.departments || [])") && serverSource.includes("Selected department does not belong to the current DingTalk user")],
  ["代报路由只允许归属人部门", serverSource.includes("Selected department does not belong to the selected reimbursement owner") && serverSource.includes("subject.departments")],
  ["代报不能无声回退到操作人社保公司", serverSource.includes("未读取到代报销归属人的有效社保公司") && serverSource.includes("recognition.status !== \"verified\" && !selectedCompanyName")],
  ["OA发起人继续使用真实当前操作人", serverSource.includes("const originatorUserId = sessionUser.userId")],
  ["代报身份写入OA备注和审计链路", serverSource.includes("[代他人报销]") && serverSource.includes("on_behalf_subject_selected") && serverSource.includes("submissionRoute")],
  ["关联审批引用按归属人记录", serverSource.includes("const ownerUserId = String(session?.submissionRoute?.subjectUserId")],
  ["V2回执保留代报路由", v2Source.includes("submissionRoute: typeof window.__reimbursementRoute?.get")],
  ["经典版与三步版入口样式均有覆盖", cssSource.includes(".route-mode-section") && v2CssSource.includes(".v2-compact-ui .route-mode-section")],
  ["生产配置已开启代报入口", ecosystemSource.includes('REIMBURSEMENT_ON_BEHALF_ENABLED: "true"')],
  ["旧版流程没有被替换为代报流程", !appSource.includes('state.workflowId = "on_behalf"') && !v2Source.includes('state.workflowId = "on_behalf"')],
  ["服务端路由模式默认自报且保留真实发起人", normalizeSubmissionRouteMode("") === "self" && normalizeApprovalPayload({ dept_id: "dept-1", form_component_values: [] }, { user: { userId: "operator-1", departments: [{ id: "dept-1" }] } }).originator_user_id === "operator-1"],
  ["代报载荷使用归属人部门但不冒充归属人发起", (() => {
    const payload = normalizeApprovalPayload({ dept_id: "dept-subject", form_component_values: [] }, {
      user: { userId: "operator-1", name: "操作人", departments: [{ id: "dept-operator" }] },
      submissionRoute: { mode: "on_behalf", departmentId: "dept-subject", subjectDepartments: [{ id: "dept-subject", name: "归属部门" }], subjectName: "归属人", operatorName: "操作人" },
    });
    return payload.dept_id === "dept-subject" && payload.originator_user_id === "operator-1" && payload.remark.includes("[代他人报销]");
  })()],
  ["管理员代发载荷使用归属人作为OA发起人并保留操作人", (() => {
    const payload = normalizeApprovalPayload({ dept_id: "dept-subject", form_component_values: [] }, {
      user: { userId: "subject-1", name: "归属人", departments: [{ id: "dept-subject" }] },
      adminContext: { enabled: true, subjectUserId: "subject-1", operatorUserId: "admin-1", operatorName: "管理员" },
      submissionRoute: { mode: "admin_originator", subjectUserId: "subject-1", departmentId: "dept-subject", subjectDepartments: [{ id: "dept-subject", name: "归属部门" }], subjectName: "归属人", operatorName: "管理员" },
    });
    return payload.dept_id === "dept-subject" && payload.originator_user_id === "subject-1" && payload.remark.includes("操作人：管理员");
  })()],
  ["服务端在未开通时拒绝代报路由", await (async () => {
    try {
      await resolveSubmissionRoute({ submission_route: { mode: "on_behalf", subjectUserId: "subject-1" } }, { user: { userId: "operator-1" } });
      return false;
    } catch (error) {
      return error.statusCode === 403;
    }
  })()],
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
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_ocr_calls=0 | network_calls=0`);
process.exitCode = failed ? 1 : 0;
