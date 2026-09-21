import assert from "node:assert/strict";
import {
  extractInvoiceLedgerSnapshot,
  hasLedgerInvoiceData,
  monthKeyFromApprovalTime,
  monthlyLedgerFilename,
  toFinanceWorkbookRow,
} from "../invoice-ledger.mjs";

const snapshot = extractInvoiceLedgerSnapshot({
  sellerName: "测试销方",
  buyerName: "测试购方",
  countableAmount: "113.00",
  data: {
    InvoiceNumber: "12345678901234567890",
    SellerTaxNumber: "SELLER-TEST",
    PurchaserTaxNumber: "BUYER-TEST",
    InvoiceDate: "2026年7月30日",
    AmountWithoutTax: "100.00",
    TaxAmount: "13.00",
  },
  invoiceDetails: [{ itemName: "测试服务" }],
});
assert.equal(snapshot.invoiceDate, "2026-07-30");
assert.equal(snapshot.totalAmount, "113.00");
assert.ok(hasLedgerInvoiceData(snapshot));
assert.equal(monthKeyFromApprovalTime("2026-07-30T10:00:00+08:00"), "2026-07");
assert.equal(monthlyLedgerFilename("2026-07"), "2026年-07月取得发票-速然");
const row = toFinanceWorkbookRow(snapshot, { serial: 1, submittedAt: "2026-07-30" });
assert.equal(row.length, 13);
assert.deepEqual(row.slice(0, 2), ["1", "12345678901234567890"]);
assert.deepEqual(row.slice(8), ["100.00", "13.00", "113.00", "2026-07-30", "否"]);
const incompleteRow = toFinanceWorkbookRow({}, { serial: 2, submittedAt: "2026-07-30", allowIncomplete: true });
assert.equal(incompleteRow.length, 13);
assert.deepEqual(incompleteRow.slice(0, 2), ["2", ""]);
console.log("PASS | invoice-ledger data contract | paid=0");
