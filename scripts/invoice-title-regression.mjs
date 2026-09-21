import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.OCR_REGRESSION = "1";

const {
  normalizeApprovalCompanyName,
  evaluateInvoiceTitleMatch,
} = await import("../server.mjs");
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

const cases = [
  ["exact buyer title matches", evaluateInvoiceTitleMatch({ companyName: "杭州飞跑体育有限公司", buyerName: "杭州飞跑体育有限公司" }).status === "matched"],
  ["legal suffix and punctuation normalize safely", evaluateInvoiceTitleMatch({ companyName: "飞将体育科技（宁波）有限公司", buyerName: "飞将体育科技(宁波)有限责任公司" }).status === "matched"],
  ["another legal company is blocked", evaluateInvoiceTitleMatch({ companyName: "杭州飞跑体育有限公司", buyerName: "杭州环飞体育科技有限公司" }).status === "mismatch"],
  ["missing buyer title is blocked", evaluateInvoiceTitleMatch({ companyName: "杭州飞跑体育有限公司", buyerName: "" }).status === "unrecognized"],
  ["known OCR field noise and numeric suffix are ignored", evaluateInvoiceTitleMatch({ companyName: "杭州飞跑体育有限公司", buyerName: "purchaserName 杭州飞跑体育有限公司 100 100" }).status === "matched"],
  ["printed company-full-name label and numeric suffix are ignored", evaluateInvoiceTitleMatch({ companyName: "杭州飞途行远企业管理有限公司", buyerName: "purchaserName 公司全称:杭州飞途行远企业管理有限公司 100 100" }).status === "matched"],
  ["buyer label variants are ignored", evaluateInvoiceTitleMatch({ companyName: "杭州飞途行远企业管理有限公司", buyerName: "购买方名称：杭州飞途行远企业管理有限公司 99 99" }).status === "matched"],
  ["label noise cannot make another company pass", evaluateInvoiceTitleMatch({ companyName: "杭州飞途行远企业管理有限公司", buyerName: "purchaserName 公司全称:杭州飞跑体育有限公司 100 100" }).status === "mismatch"],
  ["extra non-numeric OCR text is not accepted as a containment match", evaluateInvoiceTitleMatch({ companyName: "杭州飞跑体育有限公司", buyerName: "杭州飞跑体育有限公司张三" }).status === "mismatch"],
  ["normalizer does not discard company identity", normalizeApprovalCompanyName("杭州飞跑体育有限公司") !== normalizeApprovalCompanyName("杭州环飞体育科技有限公司")],
  ["browser normalizer includes the same printed-label cleanup", appSource.includes("公司全称") && appSource.includes("购方单位")],
];

let failed = 0;
for (const [name, passed] of cases) {
  try {
    assert.ok(passed);
    console.log(`PASS | ${name}`);
  } catch {
    failed += 1;
    console.log(`FAIL | ${name}`);
  }
}
console.log(`SUMMARY | ${failed ? "FAILED" : "PASSED"} | checks=${cases.length} | paid_ocr_calls=0`);
process.exitCode = failed ? 1 : 0;
