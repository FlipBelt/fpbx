import assert from "node:assert/strict";

// Importing server.mjs with this flag keeps the HTTP listener closed while the
// pure recognition helpers are exercised against the same company catalogue
// used by production submission validation.
process.env.OCR_REGRESSION = "1";
const {
  readRosterFieldValue,
  resolveSocialPaymentCompany,
} = await import("../server.mjs");

const expectedCompany = "杭州环飞体育科技有限公司";
const fieldCode = "220ab1b5-f816-4d11-96c7-84eb07f9f3ba";

const checks = [
  ["reads HRM fieldDataList shape", () => assert.equal(readRosterFieldValue({
    fieldDataList: [{ fieldCode, value: expectedCompany }],
  }, fieldCode), expectedCompany)],
  ["reads HRM fieldValue shape", () => assert.equal(readRosterFieldValue({
    fieldList: [{ code: fieldCode, fieldValue: expectedCompany }],
  }, fieldCode), expectedCompany)],
  ["reads DingTalk roster fieldValueList shape", () => assert.equal(readRosterFieldValue({
    fieldDataList: [{ fieldCode, fieldValueList: [{ itemIndex: 0, value: expectedCompany }] }],
  }, fieldCode), expectedCompany)],
  ["reads direct keyed shape", () => assert.equal(readRosterFieldValue({
    [fieldCode]: { text: expectedCompany },
  }, fieldCode), expectedCompany)],
  ["recognizes an exact configured company", () => assert.deepEqual(
    resolveSocialPaymentCompany(expectedCompany),
    { status: "verified", companyName: expectedCompany, sourceValue: expectedCompany },
  )],
  ["handles an unfilled roster field", () => assert.equal(resolveSocialPaymentCompany("").status, "missing")],
  ["rejects an unconfigured roster value without guessing", () => assert.equal(resolveSocialPaymentCompany("测试社保公司").status, "invalid_value")],
];

let failed = 0;
for (const [name, check] of checks) {
  try {
    check();
    console.log(`PASS | ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL | ${name} | ${error.message}`);
  }
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${checks.length} | paid_calls=0`);
process.exitCode = failed ? 1 : 0;
