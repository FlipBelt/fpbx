import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const desktopDir = "C:/Users/rulai/Desktop/发票入账登记月度模板";
const previewDir = path.join(process.cwd(), "preview");
const headers = [
  "序号",
  "数电发票号码",
  "销方识别号",
  "销方名称",
  "购方识别号",
  "购买方名称",
  "开票日期",
  "货物或应税劳务名称",
  "金额",
  "税额",
  "价税合计",
  "入账时间",
  "是否入账",
];

const widths = [10, 20, 20, 24, 20, 24, 14, 30, 14, 14, 16, 18, 12];

async function createTemplate(month) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add("发票基础信息");
  sheet.showGridLines = false;
  sheet.getRange("A1:M1").values = [headers];
  sheet.getRange("A1:M1").format = {
    fill: "#D9E2F3",
    font: { bold: true, color: "#1F2937" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#B7C3D0" },
  };
  sheet.getRange("A1:M1").format.rowHeight = 28;
  sheet.getRange("A2:M100").format = {
    borders: { preset: "inside", style: "thin", color: "#E5E7EB" },
    verticalAlignment: "center",
  };
  sheet.getRange("G2:G100").format.numberFormat = "yyyy-mm-dd";
  sheet.getRange("I2:K100").format.numberFormat = "#,##0.00";
  sheet.getRange("L2:L100").format.numberFormat = "yyyy-mm-dd hh:mm";
  sheet.getRange("I2:K100").format.horizontalAlignment = "right";
  sheet.getRange("M2:M100").dataValidation = {
    rule: { type: "list", values: ["是", "否"] },
  };
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 100, 1).format.columnWidth = width;
  });
  sheet.freezePanes.freezeRows(1);

  const inspect = await workbook.inspect({
    kind: "table",
    range: "发票基础信息!A1:M3",
    include: "values,formulas",
    tableMaxRows: 3,
    tableMaxCols: 13,
  });
  const preview = await workbook.render({
    sheetName: "发票基础信息",
    range: "A1:M12",
    scale: 1.2,
    format: "png",
  });
  await fs.mkdir(desktopDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(path.join(previewDir, `${month}.png`), new Uint8Array(await preview.arrayBuffer()));
  const out = await SpreadsheetFile.exportXlsx(workbook);
  const file = path.join(desktopDir, `2026年-${month}月取得发票-速然.xlsx`);
  await out.save(file);
  return { file, inspect: inspect.ndjson };
}

const outputs = [];
for (const month of ["06", "07"]) {
  outputs.push(await createTemplate(month));
}
console.log(JSON.stringify(outputs, null, 2));
