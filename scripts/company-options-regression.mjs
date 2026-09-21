import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

const expectedCompanies = [
  "飞比特（宁波）国际贸易有限公司",
  "宁波飞比特体育用品有限公司", "宁波星飞贸易有限公司", "飞将体育科技（宁波）有限公司",
  "杭州飞跑体育有限公司", "杭州来跑来购体育科技有限公司", "杭州乐跑体育科技有限公司",
  "宁波逐风劲跑体育科技有限公司", "杭州飞凌跃动文化体育科技有限公司", "杭州飞比特运动有限公司",
  "杭州飞比特体育科技有限公司", "杭州环飞体育科技有限公司", "杭州京跑体育用品有限公司",
  "宁波甄质供应链管理有限公司", "杭州速然体育科技有限公司", "杭州飞书电子商务有限公司",
  "杭州径鹰体育用品有限公司", "宁波凌一供应链管理有限公司", "杭州创简品牌管理有限公司",
  "杭州飞途行远企业管理有限公司",
];
const removedCompanies = ["杭州晨露体育科技有限公司", "宁波飞凡新零售有限公司"];
const checks = [
  ["采购供应链枚举", appSource.includes('"采购供应链"')],
  ...expectedCompanies.map((company) => [`公司清单：${company}`, appSource.includes(`"${company}"`)]),
  ...removedCompanies.map((company) => [`已替换旧公司：${company}`, !appSource.includes(`"${company}"`)]),
  ["可搜索输入框", htmlSource.includes('id="companySelect"') && htmlSource.includes('role="combobox"')],
  ["可直接展开公司清单", htmlSource.includes('id="companyMenuToggle"') && htmlSource.includes('id="companyOptionsMenu"') && appSource.includes('openCompanyOptions("")')],
  ["下拉选择无需清空默认公司", appSource.includes('Deliberately ignore the current input when the arrow is clicked')],
  ["社保主体识别提示", htmlSource.includes('id="companyMatchHint"') && appSource.includes("getSocialCompanyRecognition")],
  ["支持重新检测社保主体", htmlSource.includes('id="companyRecognitionRefreshButton"') && appSource.includes("refreshSocialCompanyRecognition")],
  ["不再按组织层级自动匹配付款公司", !appSource.includes("getCompanyMatchDetails") && !appSource.includes("defaultMatch.company")],
  ["付款公司手工修改需确认", appSource.includes("confirmManualCompanyOverride") && appSource.includes("window.confirm")],
  ["日常和差旅报销公司必填", appSource.includes('companySelect.required = isDaily || isTravel') && appSource.includes('["daily", "travel"].includes(currentWorkflow()?.targetType)') && appSource.includes('请选择需要付款的公司名称。')],
  ["差旅显示公司字段", appSource.includes('companyField.hidden = !isDaily && !isTravel')],
  ["差旅提交公司字段", appSource.includes('...(companies.length ? [{ name: "需要付款的公司名称", value: JSON.stringify(companies) }] : [])')],
  ["社保主体只读 HRM 查询", serverSource.includes('/v1.0/hrm/rosters/lists/query') && serverSource.includes("fieldFilterList")],
  ["社保主体刷新 API", serverSource.includes('/api/dingtalk/social-company')],
  ["组织同步仍保留给原身份展示", serverSource.includes('/api/dingtalk/organization')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid=0`);
process.exitCode = failed ? 1 : 0;
