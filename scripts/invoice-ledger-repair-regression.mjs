import assert from "node:assert/strict";

process.env.OCR_REGRESSION = "1";
const {
  getLedgerRepairFields,
  isUsableLedgerRepairSnapshot,
  normalizeLedgerCell,
} = await import("../server.mjs");

const snapshot = {
  invoiceNumber: "12345678901234567890",
  sellerTaxNumber: "SELLER-TEST",
  sellerName: "测试销方",
  buyerTaxNumber: "BUYER-TEST",
  buyerName: "测试购方",
  invoiceDate: "2026-08-14",
  itemName: "测试服务",
  amount: "100.00",
  taxAmount: "13.00",
  totalAmount: "113.00",
};

const fields = getLedgerRepairFields(snapshot);
assert.equal(fields.length, 10);
assert.deepEqual(fields, [
  "12345678901234567890", "SELLER-TEST", "测试销方", "BUYER-TEST", "测试购方",
  "2026-08-14", "测试服务", "100.00", "13.00", "113.00",
]);
assert.equal(isUsableLedgerRepairSnapshot(snapshot), true);
assert.equal(isUsableLedgerRepairSnapshot({ invoiceNumber: "only-number" }), false);
assert.equal(normalizeLedgerCell(46248, 11), "2026-08-14");

console.log("PASS | invoice-ledger repair contract | B:K only | paid=0");
