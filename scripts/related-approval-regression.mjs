import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

const specialProcessCode = "PROC-0325F16C-A91E-48DE-B04D-71197895996E";
const workflowBlock = (id) => {
  const start = appSource.indexOf(`id: "${id}"`);
  const end = start < 0 ? -1 : appSource.indexOf("\n  },", start);
  return start < 0 ? "" : appSource.slice(start, end < 0 ? undefined : end);
};
const dailyBlock = workflowBlock("daily");
const noInvoiceBlock = workflowBlock("no_invoice");
const projectBlock = workflowBlock("project");
const travelBlock = workflowBlock("travel_transport");
const checks = [
  ["团建特殊审批流程编号", appSource.includes(`teamBuildingSpecialApplication: \"${specialProcessCode}\"`)],
  ["仅显示四个主入口", appSource.includes("WORKFLOWS.filter((workflow) => !workflow.legacy)")],
  ["日常有票使用统一关联业务审批", dailyBlock.includes('label: "关联业务审批"') && dailyBlock.includes('sources: ["travel", "outing", "teamBuilding"]') && dailyBlock.includes("required: false")],
  ["无票也使用统一关联业务审批", noInvoiceBlock.includes('label: "关联业务审批"') && noInvoiceBlock.includes('sources: ["travel", "outing", "teamBuilding"]') && noInvoiceBlock.includes("required: false")],
  ["项目制报销可选关联出差或外出", projectBlock.includes('targetType: "daily"') && projectBlock.includes('sources: ["travel", "outing"]') && projectBlock.includes("required: false")],
  ["差旅入口仍只关联出差申请", travelBlock.includes('targetType: "travel"') && travelBlock.includes('sources: ["travel"]') && travelBlock.includes("required: true")],
  ["日常按明细文案触发关联校验", appSource.includes("validateDailyBusinessApprovalRules") && appSource.includes("打车费用") && appSource.includes("团建费用")],
  ["项目制不被费用文案反向强制关联", appSource.includes('if (workflow.id === "project") return "";')],
  ["只有差旅自动生成关联明细", appSource.includes("return Boolean(workflow?.related?.autoGenerateRows);")],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid=0`);
process.exitCode = failed ? 1 : 0;
