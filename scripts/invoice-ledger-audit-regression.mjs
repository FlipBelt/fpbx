import assert from "node:assert/strict";

process.env.OCR_REGRESSION = "1";
const { normalizeApprovalInstance, getInvoiceLedgerSkipReason } = await import("../server.mjs");

const normalized = normalizeApprovalInstance({
  businessId: "202607311706000155017",
  status: "RUNNING",
}, "workflow-instance-id");
assert.equal(normalized.processInstanceId, "workflow-instance-id");
assert.equal(normalized.businessId, "202607311706000155017");

assert.equal(getInvoiceLedgerSkipReason({ evidenceRows: 0 }).code, "no_evidence_rows");
assert.equal(getInvoiceLedgerSkipReason({ evidenceRows: 1, invoiceAttachmentCount: 0 }).code, "no_invoice_attachment");
assert.equal(getInvoiceLedgerSkipReason({ evidenceRows: 1, invoiceAttachmentCount: 1, mappedAttachmentCount: 0 }).code, "invoice_attachment_missing_file_id");
assert.equal(getInvoiceLedgerSkipReason({ evidenceRows: 1, invoiceAttachmentCount: 1, mappedAttachmentCount: 1 }).code, "duplicate_invoice");

console.log("PASS | invoice-ledger audit contract | paid=0");
