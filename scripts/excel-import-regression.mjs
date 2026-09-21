import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.OCR_REGRESSION = "1";

const {
  readXlsxXmlEntries,
  getXlsxSharedStrings,
  getXlsxFirstSheet,
  getXlsxRows,
  readXlsxEmbeddedImages,
} = await import("../server.mjs");

const workbookPath = fileURLToPath(new URL("../../测试数据集/崇礼报销7.21.xlsx", import.meta.url));
const entries = await readXlsxXmlEntries(workbookPath);
const sheet = getXlsxFirstSheet(entries);
const rows = getXlsxRows(sheet.xml, getXlsxSharedStrings(entries.get("xl/sharedStrings.xml")));
const images = await readXlsxEmbeddedImages(workbookPath);
const imageCells = new Set(images.map((image) => `${image.row}:${image.column}`));

const imported = [];
const skipped = [];
rows.slice(1).forEach((row, index) => {
  const sourceRow = index + 2;
  const reason = String(row[0] || "").trim();
  if (!reason || /^(合计|总计|小计)/.test(reason)) return;
  const amount = Number(row[1] || 0);
  const hasPayment = imageCells.has(`${sourceRow}:2`);
  const hasInvoice = imageCells.has(`${sourceRow}:3`);
  if (amount > 0 && hasPayment && hasInvoice) imported.push({ sourceRow, reason, amount });
  else skipped.push({ sourceRow, reason, hasPayment, hasInvoice });
});

assert.equal(sheet.name, "报销");
assert.equal(images.length, 37, "嵌入图片数量变更时，请复核 Excel 图片锚点解析");
assert.equal(imported.length, 11, "仅同时有付款截图和发票的明细可导入");
assert.equal(skipped.length, 21, "缺任一附件的明细必须剔除");
assert.equal(imported.reduce((sum, item) => sum + item.amount, 0).toFixed(2), "6547.29");
assert.ok(skipped.some((item) => item.reason === "有赞小红书生方案" && item.hasPayment && !item.hasInvoice));
assert.ok(skipped.some((item) => item.reason === "7.8中饭3人（60）" && !item.hasPayment && !item.hasInvoice));

console.log(`PASS | ${sheet.name} | import=${imported.length} | skipped=${skipped.length} | images=${images.length} | total=6547.29 | paid=0`);
