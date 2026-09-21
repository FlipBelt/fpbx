import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Import the backend normalizer without opening a listening socket.
process.env.OCR_REGRESSION = "1";
const { normalizeApprovalInstance, normalizeApprovalTravelInfo } = await import("../server.mjs");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const appStyle = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const v2Style = await readFile(new URL("../v2.css", import.meta.url), "utf8");

const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push([name, true]);
  } catch (error) {
    checks.push([`${name}: ${error.message}`, false]);
  }
};

check("普通字段提取日期和地点", () => {
  const info = normalizeApprovalTravelInfo([
    { name: "出差开始日期", value: "2026-09-20" },
    { name: "出差结束日期", value: "2026-09-23" },
    { name: "出发地", value: "杭州" },
    { name: "目的地", value: "北京" },
  ]);
  assert.deepEqual(info, {
    date: "2026-09-20 至 2026-09-23",
    startDate: "2026-09-20",
    endDate: "2026-09-23",
    departure: "杭州",
    destination: "北京",
  });
});

check("钉钉 TableField rowValue 提取日期和地点", () => {
  const info = normalizeApprovalTravelInfo([{
    name: "行程明细",
    componentType: "TableField",
    value: JSON.stringify([{
      rowValue: [
        { label: "出差日期", value: "2026-09-20" },
        { label: "出发地", value: "杭州" },
        { label: "目的地", value: "北京" },
      ],
      rowNumber: "TableField-0",
    }]),
  }]);
  assert.equal(info.date, "2026-09-20");
  assert.equal(info.departure, "杭州");
  assert.equal(info.destination, "北京");
});

check("合并路线字段可拆分出发地和目的地", () => {
  const info = normalizeApprovalTravelInfo([
    { name: "出发地/目的地", value: "杭州 → 北京" },
  ]);
  assert.equal(info.departure, "杭州");
  assert.equal(info.destination, "北京");
});

check("审批详情归一化保留 travelInfo 且不丢原始表单", () => {
  const normalized = normalizeApprovalInstance({
    processInstanceId: "proc-travel-test",
    processCode: "PROC-4E30A11D-CB09-49AD-B3D9-94209D6ED80A",
    formComponentValues: [
      { name: "出差日期", value: "2026-09-20" },
      { name: "出发地", value: "杭州" },
      { name: "目的地", value: "北京" },
    ],
  });
  assert.equal(normalized.formComponentValues.length, 3);
  assert.equal(normalized.travelInfo.destination, "北京");
});

check("关联审批接口仍返回统一详情并允许手工补录", () => {
  assert.match(serverSource, /request\.url\.startsWith\("\/api\/related-approvals"\)/);
  assert.match(serverSource, /request\.url\.startsWith\("\/api\/related-approval-by-id"\)/);
  assert.match(serverSource, /travelInfo: normalizeApprovalTravelInfo\(formComponentValues\)/);
});

check("前端解析 TableField 并在列表和详情显示出差信息", () => {
  assert.match(appSource, /Array\.isArray\(entry\.rowValue\)/);
  assert.match(appSource, /function getRelatedTravelInfo/);
  assert.match(appSource, /related-option-travel-summary/);
  assert.match(appSource, /related-travel-info/);
});

check("V1/V2 具备对应样式", () => {
  assert.match(appStyle, /\.related-travel-info/);
  assert.match(appStyle, /\.related-option-travel-summary/);
  assert.match(v2Style, /\.v2-compact-ui \.related-travel-info/);
});

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} | ${name}`);
  if (!passed) failed += 1;
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid=0`);
process.exitCode = failed ? 1 : 0;
