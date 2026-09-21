import assert from "node:assert/strict";
import { extractInvoiceLedgerSnapshotFromPdfText, extractInvoicePartyFromPdfText, isSafeInvoiceLedgerSnapshot } from "../invoice-ledger-local-parser.mjs";

const text = `电子发票（普通发票）
发票号码：26332000006732688456 开票日期：2026年08月04日
购买方信息 名称：杭州飞书电子商务有限公司 统一社会信用代码/纳税人识别号：91330205MAE9RH3B3R
销售方信息 名称：杭州尚印彩图文广告有限公司 统一社会信用代码/纳税人识别号：91330102MAKF9JTK67
项目名称 规格型号 单位 数量 单价 金额 税率/征收率 税额
*生产生活服务*图文广告制作 158.42 1% 1.58
价税合计（大写）壹佰陆拾圆整（小写）￥160.00
备注 开票人：测试`;

const result = extractInvoiceLedgerSnapshotFromPdfText(text);
assert.deepEqual(Object.fromEntries([
  "invoiceNumber", "sellerTaxNumber", "sellerName", "buyerTaxNumber", "buyerName",
  "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount",
].map((field) => [field, result[field]])), {
  invoiceNumber: "26332000006732688456",
  sellerTaxNumber: "91330102MAKF9JTK67",
  sellerName: "杭州尚印彩图文广告有限公司",
  buyerTaxNumber: "91330205MAE9RH3B3R",
  buyerName: "杭州飞书电子商务有限公司",
  invoiceDate: "2026-08-04",
  itemName: "生产生活服务图文广告制作",
  amount: "158.42",
  taxAmount: "1.58",
  totalAmount: "160.00",
});
assert.equal(result.version, 3);
assert.ok(result.provenance.sellerName);

const unsafe = isSafeInvoiceLedgerSnapshot({
  ...result,
  sellerName: "项目名称规格型号单位数量金额税率税额",
  itemName: "项目名称规格型号单位数量",
});
assert.equal(unsafe.snapshot.sellerName, "");
assert.equal(unsafe.snapshot.itemName, "");
assert.deepEqual(unsafe.rejectedFields.sort(), ["itemName", "sellerName"]);
assert.deepEqual(extractInvoicePartyFromPdfText("名称：杭州飞书电子商务有限公司 统一社会信用代码/纳税人识别号：91330205MAE9RH3B3R"), {
  name: "杭州飞书电子商务有限公司", taxNumber: "91330205MAE9RH3B3R",
});
assert.equal(extractInvoiceLedgerSnapshotFromPdfText("销售方信息 名称： 统一社会信用代码：91330102MAKF9JTK67").sellerName, "");
const noHeaders = extractInvoiceLedgerSnapshotFromPdfText("名称：杭州某公司 统一社会信用代码：91330102MAKF9JTK67");
assert.equal(noHeaders.buyerName, "");
assert.equal(noHeaders.sellerName, "");
const orderedPairs = extractInvoiceLedgerSnapshotFromPdfText("名称：杭州购方有限公司 统一社会信用代码：91330205MAE9RH3B3R 名称：杭州销方有限公司 统一社会信用代码：91330102MAKF9JTK67");
assert.equal(orderedPairs.buyerName, "杭州购方有限公司");
assert.equal(orderedPairs.sellerName, "杭州销方有限公司");
const rail = extractInvoiceLedgerSnapshotFromPdfText("铁路电子客票 发票号码：26339190041008828330 开票日期：2026年08月07日 购买方名称：杭州飞跑体育有限公司 票价：￥72.00");
assert.equal(rail.documentType, "rail_ticket");
assert.equal(rail.totalAmount, "72.00");
const railAlternateLabel = extractInvoiceLedgerSnapshotFromPdfText("铁路电子客票 票据号码：26339190041008828331 开票日期：2026年08月07日 购买方名称：杭州飞跑体育有限公司 票面金额：￥72．50");
assert.equal(railAlternateLabel.totalAmount, "72.50");
assert.equal(railAlternateLabel.quality.status, "ready");
const railWithIncidentalNumbers = extractInvoiceLedgerSnapshotFromPdfText("铁路电子客票 发票号码：26339190041008828332 开票日期：2026年08月07日 购买方名称：杭州飞跑体育有限公司 票款：￥100.00 金额：80.00 税额：20.00");
assert.equal(railWithIncidentalNumbers.quality.status, "ready");
const vatMismatch = extractInvoiceLedgerSnapshotFromPdfText(text.replace("￥160.00", "￥161.00"));
assert.equal(vatMismatch.quality.status, "needs_review");
assert.ok(vatMismatch.quality.reasons.includes("amount_tax_total_mismatch"));
console.log("PASS | local invoice PDF parser | bounded fields | rejected headers");
