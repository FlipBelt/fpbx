import assert from "node:assert/strict";

process.env.OCR_REGRESSION = "1";
const { collectInvoiceLedgerSnapshots, normalizeOcrResult } = await import("../server.mjs");

const normalizedInvoice = normalizeOcrResult({
  kind: "invoice",
  response: {
    body: {
      data: {
        InvoiceNumber: "12345678901234567890",
        SellerTaxNumber: "SELLER-TEST",
        PurchaserTaxNumber: "BUYER-TEST",
        InvoiceDate: "2026年8月14日",
        AmountWithoutTax: "100.00",
        TaxAmount: "13.00",
        TotalTaxIncludedAmount: "113.00",
        invoiceDetails: [{ itemName: "测试服务" }],
      },
    },
  },
  ocrType: "Invoice",
});
assert.equal(normalizedInvoice.invoiceLedger.invoiceNumber, "12345678901234567890");
assert.equal(normalizedInvoice.invoiceLedger.totalAmount, "113.00");
assert.equal(normalizedInvoice.invoiceLedger.invoiceDate, "2026-08-14");

const draft = {
  form_component_values: [{
    name: "表格",
    value: JSON.stringify([{
      rowValue: [{ name: "对应发票上传", value: JSON.stringify([{ fileId: "invoice-file-1", fileName: "invoice.png" }]) }],
    }]),
  }],
};

const withoutOcr = collectInvoiceLedgerSnapshots(draft, {
  user: { userId: "user-1" },
  evidenceByFileId: new Map([["invoice-file-1", { documentRole: "payment" }]]),
});
assert.equal(withoutOcr.snapshots.length, 1);
assert.equal(withoutOcr.snapshots[0].fileId, "invoice-file-1");
assert.equal(withoutOcr.snapshots[0].hasOcrSnapshot, false);

const withOcr = collectInvoiceLedgerSnapshots(draft, {
  user: { userId: "user-1" },
  evidenceByFileId: new Map([["invoice-file-1", { documentRole: "payment", invoiceLedger: { invoiceNumber: "123" }, contentFingerprint: "same-invoice-content" }]]),
});
assert.equal(withOcr.snapshots.length, 1);
assert.equal(withOcr.snapshots[0].snapshot.invoiceNumber, "123");
assert.equal(withOcr.snapshots[0].contentFingerprint, "same-invoice-content");

console.log("PASS | invoice-ledger sync policy | mapped attachments sync without OCR role gate | paid=0");
