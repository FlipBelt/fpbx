// Compatibility adapter for the historical PDF tool. The implementation
// lives in invoice-ledger-extraction.mjs so online OCR and local PDF recovery
// apply the same validators and completeness gate.
import {
  extractInvoiceLedgerSnapshotFromText,
  extractInvoicePartyFromText,
  hasCompleteInvoiceLedgerData,
  normalizeInvoiceLedgerSnapshot,
} from "./invoice-ledger-extraction.mjs";

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function extractInvoiceLedgerSnapshotFromPdfText(pdfText = {}) {
  const raw = typeof pdfText === "string" ? pdfText : pdfText.text || "";
  const evidence = extractInvoiceLedgerSnapshotFromText(raw);
  return { ...evidence.snapshot, quality: evidence.assessment };
}

export function hasUsableHistoricalInvoiceSnapshot(snapshot = {}) {
  return hasCompleteInvoiceLedgerData(snapshot);
}

export function extractInvoicePartyFromPdfText(pdfText = {}) {
  const raw = typeof pdfText === "string" ? pdfText : pdfText.text || "";
  return extractInvoicePartyFromText(raw);
}

export function isSafeInvoiceLedgerSnapshot(snapshot = {}) {
  const cleaned = normalizeInvoiceLedgerSnapshot(snapshot);
  const rejectedFields = Object.entries(snapshot).filter(([key, value]) => (
    ["sellerTaxNumber", "sellerName", "buyerTaxNumber", "buyerName", "itemName"].includes(key)
    && text(value) && !text(cleaned[key])
  )).map(([key]) => key);
  return { snapshot: cleaned, safe: hasCompleteInvoiceLedgerData(cleaned) && !rejectedFields.length, rejectedFields };
}
