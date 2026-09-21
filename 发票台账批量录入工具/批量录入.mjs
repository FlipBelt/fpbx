import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

process.env.OCR_REGRESSION = "1";
const {
  importInvoiceLedgerBatch,
  rollbackInvoiceLedger,
  buildInvoiceLedgerRepairTemplate,
  previewInvoiceLedgerRepair,
  applyInvoiceLedgerRepair,
  rollbackInvoiceLedgerRepair,
  readInvoiceLedgerStore,
  registerInvoiceLedgerWorkbook,
} = await import("../server.mjs");

const [command = "status", argument = "", extra = ""] = process.argv.slice(2);

function toRow(item) {
  return {
    时间: item.syncedAt || item.completedAt || item.failedAt || item.createdAt || "",
    审批编号: item.approvalNumber || "",
    审批实例: item.processInstanceId || item.sourceId || "",
    状态: item.status || "",
    发票附件数: item.items?.length || 0,
    已写入行数: item.rows?.length || 0,
    原因: item.reason || item.error || "",
  };
}

if (command === "import") {
  const path = resolve(process.cwd(), argument || "待导入发票.json");
  const payload = JSON.parse(await readFile(path, "utf8"));
  const result = await importInvoiceLedgerBatch(payload);
  console.log(`完成：月份 ${result.period || payload.period}，写入 ${result.count} 条，状态 ${result.status}`);
} else if (command === "rollback") {
  if (!argument) throw new Error("缺少审批实例 ID 或审批编号。");
  const result = await rollbackInvoiceLedger(argument);
  console.log(`回滚完成：已清空=${result.reverted.length}，需人工处理=${result.manual.length}`);
  if (result.manual.length) console.log(JSON.stringify(result.manual, null, 2));
} else if (command === "register") {
  if (!argument || !extra) throw new Error("请提供月份和 Excel 链接。");
  const result = await registerInvoiceLedgerWorkbook({ period: argument, url: extra });
  console.log(`登记完成：${argument} -> ${result.workbookId}`);
} else if (command === "trace") {
  if (!argument) throw new Error("请提供审批实例 ID、审批编号或批量来源 ID。");
  const store = await readInvoiceLedgerStore();
  const item = [...store.events].reverse().find((event) => (
    event.processInstanceId === argument || event.approvalNumber === argument || event.sourceId === argument
  ));
  if (!item) throw new Error("没有找到对应的台账追踪记录。");
  console.log(JSON.stringify(item, null, 2));
} else if (command === "status") {
  const store = await readInvoiceLedgerStore();
  console.table(store.events.slice(-30).map(toRow));
} else if (command === "repair-template") {
  const period = argument || "";
  const outputPath = resolve(process.cwd(), extra || `待补录发票-${period || "全部"}.json`);
  const payload = await buildInvoiceLedgerRepairTemplate({ period });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`已生成补录模板：${outputPath}，共 ${payload.repairs.length} 行。`);
} else if (command === "repair-preview") {
  const path = resolve(process.cwd(), argument || "待补录发票.json");
  const payload = JSON.parse(await readFile(path, "utf8"));
  const result = await previewInvoiceLedgerRepair(payload);
  console.table(result.entries.map((item) => ({
    审批编号: item.approvalNumber,
    文件: item.fileName,
    目标行: item.rowNumber,
    状态: item.status,
    原因: item.reason,
  })));
  console.log(JSON.stringify(result.summary, null, 2));
} else if (command === "repair-apply") {
  const path = resolve(process.cwd(), argument || "待补录发票.json");
  const payload = JSON.parse(await readFile(path, "utf8"));
  const result = await applyInvoiceLedgerRepair(payload);
  console.log(`补录完成：任务 ${result.jobId}，状态 ${result.status}`);
  console.log(JSON.stringify(result.summary, null, 2));
} else if (command === "repair-rollback") {
  if (!argument) throw new Error("缺少补录任务 ID。");
  const result = await rollbackInvoiceLedgerRepair(argument);
  console.log(`补录回滚完成：已恢复=${result.reverted.length}，需人工处理=${result.manual.length}`);
  if (result.manual.length) console.log(JSON.stringify(result.manual, null, 2));
} else {
  throw new Error(`未知命令：${command}`);
}
