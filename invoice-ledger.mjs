// Reusable invoice-ledger data contract.
// This module is intentionally OCR-provider independent: callers give it the
// cached OCR result produced during upload, and later sync/batch jobs consume
// only this normalized snapshot.  No function here makes an OCR request.
import { extractInvoiceLedgerSnapshotFromOcr, hasCompleteInvoiceLedgerData } from "./invoice-ledger-extraction.mjs";

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function money(value) {
  const raw = text(value).replace(/[,，\s￥¥]/g, "");
  const match = raw.match(/-?\d+(?:\.\d{1,2})?/);
  if (!match) return "";
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function date(value) {
  const raw = text(value);
  const match = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function deepFind(value, names) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, names);
      if (found) return found;
    }
    return "";
  }
  for (const name of names) {
    if (text(value[name])) return value[name];
  }
  for (const nested of Object.values(value)) {
    const found = deepFind(nested, names);
    if (found) return found;
  }
  return "";
}

function distinct(values) {
  return [...new Set(values.map(text).filter(Boolean))];
}

/**
 * Returns the exact business fields used by the current 13-column finance
 * workbook. Empty values deliberately remain empty: finance must be able to
 * spot incomplete OCR instead of receiving invented values.
 */
export function extractInvoiceLedgerSnapshot(ocr = {}) {
  return extractInvoiceLedgerSnapshotFromOcr(ocr);
}

export function hasLedgerInvoiceData(snapshot = {}) {
  return Boolean(text(snapshot.invoiceNumber) || text(snapshot.sellerTaxNumber) || text(snapshot.totalAmount));
}

/** Strict gate for a formal finance-ledger write. */
export function isLedgerSnapshotReadyForWrite(snapshot = {}) {
  return hasCompleteInvoiceLedgerData(snapshot);
}

export function monthKeyFromApprovalTime(value = new Date()) {
  const time = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error("Invalid approval time for invoice ledger period.");
  return `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}`;
}

export function monthlyLedgerFilename(monthKey, suffix = "速然") {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey))) throw new Error("Invalid invoice ledger month key.");
  const [year, month] = monthKey.split("-");
  return `${year}年-${month}月取得发票-${suffix}`;
}

export function toFinanceWorkbookRow(snapshot = {}, { serial, submittedAt, booked = "否", allowIncomplete = false } = {}) {
  if (!allowIncomplete && !hasLedgerInvoiceData(snapshot)) throw new Error("OCR cache does not contain invoice ledger fields.");
  return [
    text(serial), text(snapshot.invoiceNumber), text(snapshot.sellerTaxNumber), text(snapshot.sellerName),
    text(snapshot.buyerTaxNumber), text(snapshot.buyerName), text(snapshot.invoiceDate), text(snapshot.itemName),
    text(snapshot.amount), text(snapshot.taxAmount), text(snapshot.totalAmount), date(submittedAt || new Date()), text(booked),
  ];
}
