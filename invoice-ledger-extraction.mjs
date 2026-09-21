// Invoice ledger extraction V3.
//
// This module is deliberately independent from DingTalk and spreadsheets.  It
// turns structured OCR and PDF/OCR text into one auditable invoice snapshot;
// callers receive field provenance and a strict write decision, never a guess.

export const LEDGER_FIELDS = [
  "invoiceNumber", "sellerTaxNumber", "sellerName", "buyerTaxNumber", "buyerName",
  "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount",
];

const REQUIRED_VAT_FIELDS = [
  "invoiceNumber", "sellerTaxNumber", "sellerName", "buyerName",
  "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount",
];

const LABEL_ONLY_VALUES = new Set([
  "名称", "名称:", "名称：", "销售方名称", "购买方名称", "销方名称", "购方名称",
  "纳税人识别号", "统一社会信用代码", "统一社会信用代码纳税人识别号",
  "发票号码", "开票日期", "项目名称", "货物或应税劳务服务名称", "金额", "税额", "价税合计",
]);

const HEADER_WORDS = /^(?:名称|销售方名称|购买方名称|销方名称|购方名称|纳税人识别号|统一社会信用代码|项目名称|规格型号|单位|数量|单价|金额|税率|税额|价税合计|合计|发票号码|开票日期|备注|开票人)[：:]?$/u;
const HEADER_SEQUENCE = /(?:项目名称|规格型号|单位|数量|单价|金额|税率|税额|价税合计){2,}/u;
const TAX_LABEL = /(?:统一社会信用代码(?:\/纳税人识别号)?|纳税人识别号)/u;

function text(value) {
  return value === undefined || value === null ? "" : String(value).replace(/\u00a0/g, " ").trim();
}

function compact(value) {
  return text(value)
    .replace(/\\[rnt]/g, "")
    .replace(/[\r\n\t\f\v\u0000-\u001f]/g, "")
    .replace(/[．。]/g, ".")
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z\u4e00-\u9fff￥¥.,，:：*＊%％+\-()（）/]/gu, "");
}

function lines(value) {
  return String(value || "")
    .replace(/\\[rnt]/g, "\n")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function money(value) {
  const normalized = text(value).replace(/[￥¥,，\s]/g, "").replace(/[．。]/g, ".");
  const match = normalized.match(/^-?\d+(?:\.\d{1,2})?$/u) || normalized.match(/-?\d+(?:\.\d{1,2})?/u);
  if (!match) return "";
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function date(value) {
  const match = text(value).match(/(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/u);
  if (!match) return "";
  const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return Number.isNaN(new Date(`${normalized}T00:00:00Z`).getTime()) ? "" : normalized;
}

function labelKey(value) {
  return compact(value).replace(/[：:]/g, "");
}

function isLabelOnly(value) {
  const normalized = compact(value);
  return !normalized || LABEL_ONLY_VALUES.has(normalized) || HEADER_WORDS.test(normalized);
}

function isValidTaxNumber(value) {
  const normalized = compact(value).toUpperCase();
  return /^[0-9A-Z]{15,30}$/u.test(normalized) && /\d/u.test(normalized);
}

function isValidCompanyName(value) {
  const normalized = text(value).replace(/^[：:\-\s]+/u, "").trim();
  return normalized.length >= 2 && normalized.length <= 100
    && !isLabelOnly(normalized)
    && /[\u4e00-\u9fffA-Za-z]/u.test(normalized)
    && !HEADER_SEQUENCE.test(normalized)
    && !/(?:项目名称|规格型号|价税合计|纳税人识别号|统一社会信用代码)/u.test(normalized);
}

function isValidItemName(value) {
  const normalized = text(value).replace(/[＊*]/gu, "").replace(/^[：:\-\s]+/u, "").trim();
  return normalized.length >= 2 && normalized.length <= 160
    && !isLabelOnly(normalized)
    && /[\u4e00-\u9fffA-Za-z]/u.test(normalized)
    && !HEADER_SEQUENCE.test(normalized)
    && !/^(?:规格型号|单位|数量|单价|金额|税率|税额)$/u.test(normalized)
    ? normalized
    : "";
}

function isValidInvoiceNumber(value) {
  return /^[0-9A-Z-]{8,32}$/iu.test(compact(value));
}

function normalizeField(field, value) {
  if (field === "invoiceNumber") return isValidInvoiceNumber(value) ? compact(value).toUpperCase() : "";
  if (field === "sellerTaxNumber" || field === "buyerTaxNumber") return isValidTaxNumber(value) ? compact(value).toUpperCase() : "";
  if (field === "sellerName" || field === "buyerName") return isValidCompanyName(value) ? text(value).replace(/^[：:\s]+/u, "") : "";
  if (field === "invoiceDate") return date(value);
  if (field === "itemName") return isValidItemName(value);
  if (["amount", "taxAmount", "totalAmount"].includes(field)) return money(value);
  return text(value);
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
  for (const name of names) if (text(value[name])) return value[name];
  for (const nested of Object.values(value)) {
    const found = deepFind(nested, names);
    if (found) return found;
  }
  return "";
}

function addCandidate(candidates, field, value, source, confidence, strategy) {
  const normalized = normalizeField(field, value);
  if (!normalized) return;
  const key = `${field}|${normalized}|${source}|${strategy}`;
  if (candidates.some((candidate) => candidate.key === key)) return;
  candidates.push({ key, field, value: normalized, source, confidence, strategy });
}

function firstLabelValue(source, labelPattern, stops = []) {
  const normalized = compact(source);
  const match = normalized.match(labelPattern);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const tail = normalized.slice(start);
  const stopIndexes = stops.map((stop) => tail.search(stop)).filter((index) => index >= 0);
  return tail.slice(0, stopIndexes.length ? Math.min(...stopIndexes) : 140).replace(/^[：:]/u, "").trim();
}

function sectionForParty(value, side = "") {
  const source = compact(value);
  if (!side) return source;
  const headers = side === "buyer" ? ["购买方信息", "购方信息", "购买方"] : ["销售方信息", "销方信息", "销售方"];
  const opposite = side === "buyer" ? ["销售方信息", "销方信息", "销售方"] : ["项目名称", "货物或应税劳务服务名称", "价税合计", "备注", "购买方信息", "购方信息"];
  const starts = headers.map((header) => source.indexOf(header)).filter((index) => index >= 0);
  if (!starts.length) return source;
  const start = Math.min(...starts);
  const tail = source.slice(start + headers.find((header) => source.indexOf(header, start) === start).length);
  const ends = opposite.map((header) => tail.indexOf(header)).filter((index) => index >= 0);
  return tail.slice(0, ends.length ? Math.min(...ends) : 500);
}

function hasPartyHeader(value, side) {
  const source = compact(value);
  const headers = side === "buyer" ? ["购买方信息", "购方信息", "购买方"] : ["销售方信息", "销方信息", "销售方"];
  return headers.some((header) => source.includes(header));
}

function extractPartyCandidates(value, side, source, confidence, candidates) {
  const section = sectionForParty(value, side);
  const name = firstLabelValue(section, /名称[：:]?/u, [TAX_LABEL, /地址电话/u, /开户行/u, /项目名称/u, /规格型号/u, /备注/u]);
  const tax = firstLabelValue(section, /(?:统一社会信用代码(?:纳税人识别号)?|纳税人识别号)[：:]?/u, [/名称/u, /地址电话/u, /开户行/u, /项目名称/u, /规格型号/u, /备注/u]);
  const explicitTax = section.match(/(?:统一社会信用代码(?:纳税人识别号)?|纳税人识别号)[：:]?([0-9A-Z]{15,30})/iu)?.[1] || tax.match(/[0-9A-Z]{15,30}/iu)?.[0] || "";
  addCandidate(candidates, side === "buyer" ? "buyerName" : "sellerName", name, source, confidence, "party-labelled-name");
  addCandidate(candidates, side === "buyer" ? "buyerTaxNumber" : "sellerTaxNumber", explicitTax, source, confidence, "party-labelled-tax");
}

function orderedPartyPairs(value) {
  const source = compact(value);
  const pattern = /名称[：:]?(.{2,120}?)(?:统一社会信用代码(?:\/纳税人识别号)?|纳税人识别号)[：:]?([0-9A-Z]{15,30})/giu;
  const pairs = [];
  for (const match of source.matchAll(pattern)) {
    const name = normalizeField("buyerName", match[1]);
    const taxNumber = normalizeField("buyerTaxNumber", match[2]);
    if (name && taxNumber) pairs.push({ name, taxNumber });
  }
  return [...new Map(pairs.map((pair) => [`${pair.name}|${pair.taxNumber}`, pair])).values()];
}

function extractTextCandidates(value, source, confidence, candidates, sideHint = "") {
  const raw = String(value || "");
  const flat = compact(raw);
  if (!flat) return;
  if (sideHint) extractPartyCandidates(flat, sideHint, source, confidence, candidates);
  else {
    // Whole-page OCR often loses the small 买方/销方 headers. In that case it
    // is unsafe to assign the one detected name to both parties; only a
    // dedicated crop may use a side hint.
    if (hasPartyHeader(flat, "buyer")) extractPartyCandidates(flat, "buyer", source, confidence, candidates);
    if (hasPartyHeader(flat, "seller")) extractPartyCandidates(flat, "seller", source, confidence, candidates);
    // Some valid PDF text layers preserve two complete name/tax pairs but
    // omit the vertical buyer/seller headings. Their reading order follows
    // the standard invoice layout (buyer, then seller). Keep this source
    // deliberately lower confidence so a labelled/cropped value wins.
    if (!hasPartyHeader(flat, "buyer") && !hasPartyHeader(flat, "seller")) {
      const pairs = orderedPartyPairs(flat);
      if (pairs.length === 2) {
        addCandidate(candidates, "buyerName", pairs[0].name, source, confidence - 18, "ordered-party-pairs");
        addCandidate(candidates, "buyerTaxNumber", pairs[0].taxNumber, source, confidence - 18, "ordered-party-pairs");
        addCandidate(candidates, "sellerName", pairs[1].name, source, confidence - 18, "ordered-party-pairs");
        addCandidate(candidates, "sellerTaxNumber", pairs[1].taxNumber, source, confidence - 18, "ordered-party-pairs");
      }
    }
  }
  addCandidate(candidates, "invoiceNumber", firstLabelValue(flat, /(?:发票号码|票据号码|发票号)[：:]?/iu, [/开票日期/u, /购买方/u, /销售方/u, /项目名称/u]), source, confidence, "labelled-invoice-number");
  if (!candidates.some((candidate) => candidate.field === "invoiceNumber" && candidate.source === source)) {
    const numbers = [...flat.matchAll(/(?<!\d)(\d{20})(?!\d)/g)].map((match) => match[1]);
    if (new Set(numbers).size === 1) addCandidate(candidates, "invoiceNumber", numbers[0], source, confidence - 15, "unique-20-digit-number");
  }
  addCandidate(candidates, "invoiceDate", firstLabelValue(flat, /(?:开票日期|填开日期|开具日期)[：:]?/u, [/购买方/u, /销售方/u, /项目名称/u, /货物或应税劳务/u]), source, confidence, "labelled-date");
  const totalSection = firstLabelValue(flat, /价税合计/u, [/备注/u, /开票人/u]);
  addCandidate(candidates, "totalAmount", totalSection.match(/(?:小写|￥|¥)[^0-9]{0,30}(-?\d+[.,]?\d{0,2})/u)?.[1] || totalSection.match(/-?\d+[.,]\d{1,2}/u)?.[0] || "", source, confidence, "total-section");
  if (/铁路电子客票|电子客票|铁路客票/u.test(flat)) {
    // Railway e-tickets do not carry VAT amount/tax fields.  Different
    // issuers use 票价、票款、票面金额或合计金额, and scans frequently turn the
    // decimal point into a full-width dot.  These labels are specific enough
    // to be a safe total candidate without borrowing an unrelated amount.
    const railFare = flat.match(/(?:票价|票款|票面金额|合计金额|应付金额|实收金额)[：:]?[￥¥]?(-?\d+(?:[\.．。]\d{1,2})?)/u)?.[1] || "";
    addCandidate(candidates, "totalAmount", railFare, source, confidence, "rail-ticket-fare");
    addCandidate(candidates, "itemName", "铁路电子客票", source, confidence, "rail-ticket-type");
  }
  const names = [];
  for (const line of lines(raw)) {
    if (!/[＊*].+[＊*]/u.test(line)) continue;
    // Electronic invoices commonly render a category as *服务* followed by
    // the real item description. Keep both, then stop before table numbers.
    const itemText = line.replace(/[＊*]/gu, "").replace(/\s+-?\d+(?:\.\d{1,2})?(?:\s|$).*/u, "").trim();
    const item = isValidItemName(itemText);
    if (item) names.push(item);
  }
  if (!names.length) {
    const segment = flat.match(/(?:项目名称|货物或应税劳务服务名称)(.{2,180}?)(?:价税合计|备注|开票人)/u)?.[1] || "";
    const item = isValidItemName(segment.replace(/(?:规格型号|单位|数量|单价|金额|税率|税额).*/u, ""));
    if (item) names.push(item);
  }
  if (names.length) addCandidate(candidates, "itemName", [...new Set(names)].join("；"), source, confidence, "item-table");
  extractAmounts(raw, flat, source, confidence, candidates);
}

function extractAmounts(raw, flat, source, confidence, candidates) {
  const totalCandidates = candidates.filter((candidate) => candidate.field === "totalAmount" && candidate.source === source).map((candidate) => Number(candidate.value));
  const total = totalCandidates.length === 1 ? totalCandidates[0] : NaN;
  const rows = lines(raw).filter((line) => /[＊*].+[＊*]/u.test(line));
  const pairs = [];
  for (const row of rows) {
    const decimals = [...row.matchAll(/-?\d+\.\d{1,2}/g)].map((match) => Number(match[0]));
    if (decimals.length >= 2) pairs.push([decimals.at(-2), decimals.at(-1)]);
  }
  if (pairs.length && Number.isFinite(total)) {
    const amount = pairs.reduce((sum, pair) => sum + pair[0], 0);
    const tax = pairs.reduce((sum, pair) => sum + pair[1], 0);
    if (Math.abs(amount + tax - total) <= 0.011) {
      addCandidate(candidates, "amount", amount, source, confidence, "item-table-sum");
      addCandidate(candidates, "taxAmount", tax, source, confidence, "item-table-sum");
      return;
    }
  }
  const amountLabel = flat.match(/金额[：:]?(-?\d+(?:\.\d{1,2})?)/u)?.[1];
  const taxLabel = flat.match(/税额[：:]?(-?\d+(?:\.\d{1,2})?)/u)?.[1];
  if (amountLabel && taxLabel && (!Number.isFinite(total) || Math.abs(Number(amountLabel) + Number(taxLabel) - total) <= 0.011)) {
    addCandidate(candidates, "amount", amountLabel, source, confidence, "labelled-amount");
    addCandidate(candidates, "taxAmount", taxLabel, source, confidence, "labelled-tax");
  }
}

function extractStructuredCandidates(ocr, candidates) {
  const data = ocr?.data || {};
  const find = (names) => text(deepFind(data, names));
  const source = "ocr-cache";
  addCandidate(candidates, "invoiceNumber", find(["invoiceNumber", "InvoiceNumber", "printedInvoiceNumber", "PrintedInvoiceNumber"]), source, 98, "structured-ocr");
  addCandidate(candidates, "sellerTaxNumber", find(["sellerTaxNumber", "SellerTaxNumber", "salesTaxNumber", "SalesTaxNumber"]), source, 98, "structured-ocr");
  addCandidate(candidates, "sellerName", text(ocr?.sellerName) || find(["sellerName", "SellerName", "salesName", "SalesName"]), source, 98, "structured-ocr");
  addCandidate(candidates, "buyerTaxNumber", find(["buyerTaxNumber", "BuyerTaxNumber", "purchaserTaxNumber", "PurchaserTaxNumber"]), source, 98, "structured-ocr");
  addCandidate(candidates, "buyerName", text(ocr?.buyerName) || find(["buyerName", "BuyerName", "purchaserName", "PurchaserName"]), source, 98, "structured-ocr");
  addCandidate(candidates, "invoiceDate", find(["invoiceDate", "InvoiceDate", "issueDate", "IssueDate", "billingDate", "BillingDate"]), source, 98, "structured-ocr");
  addCandidate(candidates, "totalAmount", find(["totalTaxIncludedAmount", "TotalTaxIncludedAmount", "totalAmount", "TotalAmount", "invoiceAmount", "InvoiceAmount"]) || ocr?.countableAmount || ocr?.recognizedAmount || ocr?.amount, source, 98, "structured-ocr");
  addCandidate(candidates, "amount", find(["amountWithoutTax", "AmountWithoutTax", "amountExcludingTax", "AmountExcludingTax", "totalAmountWithoutTax"]), source, 98, "structured-ocr");
  addCandidate(candidates, "taxAmount", find(["taxAmount", "TaxAmount", "totalTax", "TotalTax"]), source, 98, "structured-ocr");
  const names = (Array.isArray(ocr?.invoiceDetails) ? ocr.invoiceDetails : []).map((item) => isValidItemName(item?.itemName)).filter(Boolean);
  addCandidate(candidates, "itemName", [...new Set(names)].join("；") || find(["itemName", "ItemName", "goodsName", "GoodsName"]), source, 98, "structured-ocr");
}

function selectSnapshot(candidates) {
  const snapshot = { version: 3, source: "", fields: {}, provenance: {}, rejectedFields: [] };
  for (const field of LEDGER_FIELDS) {
    const values = candidates.filter((candidate) => candidate.field === field).sort((left, right) => right.confidence - left.confidence);
    const unique = [...new Map(values.map((candidate) => [candidate.value, candidate])).values()];
    if (!unique.length) { snapshot.fields[field] = ""; continue; }
    const selected = unique[0];
    snapshot.fields[field] = selected.value;
    snapshot.provenance[field] = {
      source: selected.source,
      strategy: selected.strategy,
      confidence: selected.confidence,
      alternatives: unique.slice(1, 3).map((candidate) => ({ value: candidate.value, source: candidate.source, confidence: candidate.confidence })),
    };
    if (unique.length > 1 && unique[1].value !== selected.value && unique[1].confidence >= selected.confidence - 8) snapshot.rejectedFields.push(`${field}:conflicting_candidates`);
  }
  Object.assign(snapshot, snapshot.fields);
  snapshot.source = [...new Set(Object.values(snapshot.provenance).map((item) => item.source))].join("+");
  delete snapshot.fields;
  return snapshot;
}

function assess(snapshot, candidates, documentType = "vat_invoice") {
  const reasons = [];
  const required = documentType === "rail_ticket"
    ? ["invoiceNumber", "buyerName", "invoiceDate", "itemName", "totalAmount"]
    : REQUIRED_VAT_FIELDS;
  const missing = required.filter((field) => !text(snapshot[field]));
  if (missing.length) reasons.push(`missing_required:${missing.join(",")}`);
  const amount = Number(snapshot.amount); const tax = Number(snapshot.taxAmount); const total = Number(snapshot.totalAmount);
  // A railway electronic ticket is a transport receipt, not a VAT invoice:
  // any incidental number recognised as an amount or tax must never block a
  // valid ticket from entering the ledger.  VAT invoices retain the strict
  // accounting identity check.
  if (documentType === "vat_invoice" && [amount, tax, total].every(Number.isFinite) && Math.abs(amount + tax - total) > 0.011) reasons.push("amount_tax_total_mismatch");
  if (documentType === "vat_invoice" && snapshot.sellerTaxNumber && snapshot.buyerTaxNumber && snapshot.sellerTaxNumber === snapshot.buyerTaxNumber) reasons.push("buyer_seller_tax_number_same");
  if (documentType === "vat_invoice" && snapshot.sellerName && snapshot.buyerName && snapshot.sellerName === snapshot.buyerName) reasons.push("buyer_seller_name_same");
  const hadLabelCandidate = candidates.some((candidate) => ["sellerName", "buyerName", "itemName"].includes(candidate.field) && isLabelOnly(candidate.value));
  if (hadLabelCandidate) reasons.push("field_label_candidate_rejected");
  const fieldStatus = Object.fromEntries(LEDGER_FIELDS.map((field) => [field, text(snapshot[field]) ? "present" : "missing"]));
  return {
    status: reasons.length ? "needs_review" : "ready",
    canWrite: reasons.length === 0,
    requiredMissing: missing,
    reasons,
    fieldStatus,
    documentType,
  };
}

/**
 * Unifies all available evidence.  `sources` accepts PDF text, full-page OCR,
 * and party crops.  It makes no API calls and never writes a workbook.
 */
export function extractInvoiceLedgerEvidence({ ocr = null, sources = [] } = {}) {
  const candidates = [];
  if (ocr && typeof ocr === "object") extractStructuredCandidates(ocr, candidates);
  for (const item of sources) {
    const kind = String(item?.kind || "pdf-text");
    const confidence = Number(item?.confidence || (kind === "pdf-layout" ? 90 : kind === "pdf-raw" ? 82 : kind === "ocr-party" ? 72 : 60));
    extractTextCandidates(item?.text || "", kind, confidence, candidates, item?.side || "");
  }
  const snapshot = selectSnapshot(candidates);
  const sourceText = sources.map((item) => String(item?.text || "")).join("\n");
  const documentType = /铁路电子客票|电子客票|铁路客票/u.test(sourceText) ? "rail_ticket" : "vat_invoice";
  snapshot.documentType = documentType;
  const assessment = assess(snapshot, candidates, documentType);
  return { snapshot, assessment, candidates: candidates.map(({ key, ...candidate }) => candidate) };
}

export function extractInvoiceLedgerSnapshotFromOcr(ocr = {}) {
  return extractInvoiceLedgerEvidence({ ocr }).snapshot;
}

export function extractInvoiceLedgerSnapshotFromText(textValue = "") {
  return extractInvoiceLedgerEvidence({ sources: [{ kind: "pdf-text", text: textValue, confidence: 90 }] });
}

export function normalizeInvoiceLedgerSnapshot(snapshot = {}) {
  const normalized = { ...snapshot };
  for (const field of LEDGER_FIELDS) normalized[field] = normalizeField(field, snapshot[field]);
  return normalized;
}

/** Extract one labelled name/tax pair from an already-cropped party panel. */
export function extractInvoicePartyFromText(textValue = "") {
  const candidates = [];
  extractTextCandidates(textValue, "ocr-party", 78, candidates, "buyer");
  const snapshot = selectSnapshot(candidates);
  return { name: snapshot.buyerName || "", taxNumber: snapshot.buyerTaxNumber || "" };
}

export function hasCompleteInvoiceLedgerData(snapshot = {}) {
  return assess(normalizeInvoiceLedgerSnapshot(snapshot), [], snapshot.documentType || "vat_invoice").canWrite;
}
