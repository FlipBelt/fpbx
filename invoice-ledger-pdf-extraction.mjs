// Local PDF evidence adapter for the V3 invoice extraction engine.
// No spreadsheet SDK is imported here; this file can safely be used for a
// read-only historical regression run.
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractInvoiceLedgerEvidence } from "./invoice-ledger-extraction.mjs";
import OcrClient, * as ocrApi from "@alicloud/ocr-api20210707";
import OpenApi from "@alicloud/openapi-client";
import Util from "@alicloud/tea-util";

const execFileAsync = promisify(execFile);

function text(value) { return value === undefined || value === null ? "" : String(value).trim(); }

function parseProviderData(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return { rawText: String(value) }; }
}

function collectProviderText(value, output = [], depth = 0) {
  if (depth > 12 || output.join("").length > 512_000 || value === undefined || value === null) return output;
  if (typeof value === "string" || typeof value === "number") { output.push(String(value)); return output; }
  if (Array.isArray(value)) { for (const item of value) collectProviderText(item, output, depth + 1); return output; }
  if (typeof value === "object") for (const nested of Object.values(value)) collectProviderText(nested, output, depth + 1);
  return output;
}

async function providerOcrEvidence(file, config = {}) {
  const result = { attempted: false, successfulTypes: [], failedTypes: [], ocr: null, source: null };
  if (config.provider !== "aliyun" || !config.accessKeyId || !config.accessKeySecret) return result;
  result.attempted = true;
  const client = new OcrClient.default(new OpenApi.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: config.endpoint || "ocr-api.cn-hangzhou.aliyuncs.com",
    regionId: config.regionId || "cn-hangzhou",
  }));
  const allData = [];
  const rawParts = [];
  // RecognizeAllText's Invoice model accepts images, but rejects a PDF body.
  // Render page one locally so historic PDF attachments receive the same model
  // quality as the application's normal uploaded images.
  const imagePrefix = join(dirname(file), "provider-ocr-page");
  const image = `${imagePrefix}-1.png`;
  try {
    await execFileAsync("pdftoppm", ["-png", "-r", "300", "-f", "1", "-l", "1", file, imagePrefix], { maxBuffer: 4 * 1024 * 1024, timeout: 45_000 });
  } catch {
    result.failedTypes.push("pdf_render_failed");
    return result;
  }
  for (const type of ["Invoice", "Advanced", "General"]) {
    try {
      const request = { type, body: createReadStream(image), pageNo: 1 };
      const response = await client.recognizeAllTextWithOptions(
        new ocrApi.RecognizeAllTextRequest(request),
        new Util.RuntimeOptions({ connectTimeout: Number(config.connectTimeoutMs || 5000), readTimeout: Number(config.readTimeoutMs || 15000) }),
      );
      const data = parseProviderData(response?.body?.data);
      allData.push(data);
      rawParts.push(collectProviderText(data).join("\n"));
      result.successfulTypes.push(type);
      // The invoice model is preferred.  Stop only when it exposes the two
      // immutable anchors; later generic modes otherwise add noise.
      const probe = extractInvoiceLedgerEvidence({ ocr: { data }, sources: [{ kind: "aliyun-ocr", text: rawParts.at(-1), confidence: 96 }] });
      if (probe.snapshot.invoiceNumber && probe.snapshot.totalAmount) break;
    } catch (error) {
      result.failedTypes.push(String(error?.code || "provider_error").slice(0, 80));
    }
  }
  if (allData.length) {
    result.ocr = { data: allData };
    result.source = { kind: "aliyun-ocr", text: rawParts.join("\n"), confidence: 96 };
  }
  return result;
}

function decodeXml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

// pdftotext -bbox-layout keeps the left/right invoice columns separate. The
// normal text stream often emits both vertical headers before either value,
// which is why string-only buyer/seller splitting was unreliable.
function bboxPartySources(xml) {
  const words = [];
  const matcher = /<word\s+xMin="([^"]+)"\s+yMin="([^"]+)"\s+xMax="([^"]+)"\s+yMax="([^"]+)">([\s\S]*?)<\/word>/gu;
  for (const match of String(xml || "").matchAll(matcher)) {
    const [xMin, yMin, xMax] = match.slice(1, 4).map(Number);
    const value = decodeXml(match[5]).trim();
    if (Number.isFinite(xMin) && Number.isFinite(yMin) && Number.isFinite(xMax) && value) words.push({ xMin, yMin, xMax, value });
  }
  if (!words.length) return [];
  const partyNameXs = words
    .filter((word) => /名称/u.test(word.value) && !/项目名称/u.test(word.value))
    .map((word) => word.xMin)
    .sort((left, right) => left - right);
  // The two “名称” labels are a much more stable divider than page width:
  // vertical “销售方信息” characters can sit just left of the physical middle.
  const mid = partyNameXs.length >= 2
    ? (partyNameXs[0] + partyNameXs.at(-1)) / 2
    : (Math.min(...words.map((word) => word.xMin)) + Math.max(...words.map((word) => word.xMax))) / 2;
  const records = { buyer: { name: "", tax: "" }, seller: { name: "", tax: "" } };
  const buckets = new Map();
  for (const word of words) {
    // Labels are rendered a few points higher than their values in many PDFs.
    const key = Math.round(word.yMin / 10);
    buckets.set(key, [...(buckets.get(key) || []), word]);
  }
  for (const row of buckets.values()) {
    const ordered = row.sort((left, right) => left.xMin - right.xMin);
    const labels = ordered.map((word, index) => {
      const name = /名称/u.test(word.value) && !/项目名称/u.test(word.value);
      const tax = /统一社会信用代码|纳税人识别号/u.test(word.value);
      return name || tax ? { index, type: name ? "name" : "tax", xMin: word.xMin, label: name ? "名称" : (word.value.includes("统一社会信用代码/纳税人识别号") ? "统一社会信用代码/纳税人识别号" : word.value.includes("纳税人识别号") ? "纳税人识别号" : "统一社会信用代码") } : null;
    }).filter(Boolean);
    for (let labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
      const label = labels[labelIndex];
      const next = labels[labelIndex + 1]?.index ?? ordered.length;
      const joined = ordered.slice(label.index, next).map((word) => word.value).join("");
      const start = joined.indexOf(label.label);
      let value = joined.slice(start + label.label.length).replace(/^[：:]/u, "").trim();
      // Strip one vertical heading character that can be positioned between
      // the left value and the right-hand field label.
      if (label.type === "name") value = value.replace(/[购买销售方信息]+$/u, "").trim();
      if (label.type === "tax") value = value.match(/[0-9A-Z]{15,30}/iu)?.[0] || "";
      const side = label.xMin < mid ? "buyer" : "seller";
      if (label.type === "name" && !records[side].name) records[side].name = value;
      if (label.type === "tax" && !records[side].tax) records[side].tax = value;
    }
  }
  return ["buyer", "seller"].map((side) => {
    const record = records[side];
    return { kind: "pdf-bbox-party", side, text: record.name || record.tax ? `名称：${record.name} 统一社会信用代码/纳税人识别号：${record.tax}` : "", confidence: 97 };
  }).filter((item) => item.text);
}

// Exported for deterministic regression tests; production callers use the
// same helper internally and never need to inspect the XML themselves.
export function extractBboxPartySourcesForTest(xml = "") {
  return bboxPartySources(xml);
}

function bboxPartyRegions(xml, dpi = 220) {
  const words = [];
  const matcher = /<word\s+xMin="([^"]+)"\s+yMin="([^"]+)"\s+xMax="([^"]+)"\s+yMax="([^"]+)">([\s\S]*?)<\/word>/gu;
  for (const match of String(xml || "").matchAll(matcher)) {
    const [xMin, yMin, xMax, yMax] = match.slice(1, 5).map(Number);
    const value = decodeXml(match[5]).trim();
    if ([xMin, yMin, xMax, yMax].every(Number.isFinite) && value) words.push({ xMin, yMin, xMax, yMax, value });
  }
  const names = words.filter((word) => /名称/u.test(word.value) && !/项目名称/u.test(word.value)).sort((left, right) => left.xMin - right.xMin);
  const taxes = words.filter((word) => /统一社会信用代码|纳税人识别号/u.test(word.value));
  const page = String(xml || "").match(/<page\s+width="([^"]+)"\s+height="([^"]+)"/u);
  if (names.length < 2 || !page) return [];
  const pageWidth = Number(page[1]);
  const scale = dpi / 72;
  if (!Number.isFinite(pageWidth) || !Number.isFinite(scale)) return [];
  const mid = (names[0].xMin + names.at(-1).xMin) / 2;
  const yValues = [...names, ...taxes].map((word) => word.yMin);
  const top = Math.max(0, Math.min(...yValues) - 24);
  const bottom = Math.max(...yValues.map((value) => value + 32));
  const y = Math.floor(top * scale);
  const height = Math.ceil((bottom - top) * scale);
  // The name-label divider is ideal for ownership but can fall inside a long
  // buyer tax number. Crop at the physical half-page divider instead.
  const panelMid = pageWidth / 2;
  const buyerWidth = Math.ceil(panelMid * scale);
  const sellerX = Math.floor(panelMid * scale);
  const sellerWidth = Math.ceil((pageWidth - panelMid) * scale);
  return [
    { side: "buyer", x: 0, y, width: buyerWidth, height },
    { side: "seller", x: sellerX, y, width: sellerWidth, height },
  ].filter((region) => region.width > 50 && region.height > 50);
}

async function ocrPage(image, psm) {
  const { stdout } = await execFileAsync("tesseract", [image, "stdout", "-l", "chi_sim+eng", "--psm", String(psm)], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 35_000,
  });
  return stdout;
}

async function pdfPageCount(file) {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [file], { maxBuffer: 512 * 1024, timeout: 10_000 });
    const count = Number(String(stdout).match(/^Pages:\s*(\d+)/mu)?.[1]);
    return Number.isInteger(count) && count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

function evidenceDiagnostics({ sources, evidence, pageCount, deepScan }) {
  // This is deliberately structural only: the durable audit report records
  // neither source text nor invoice values beyond the extracted snapshot.
  const joined = sources.map((item) => String(item.text || "")).join("\n");
  const normalized = joined.replace(/\s+/g, "");
  return {
    parserVersion: 3,
    pageCount,
    deepScan,
    sourceKinds: [...new Set(sources.map((item) => String(item.kind || "unknown")))].sort(),
    sourceCharacterCounts: sources.reduce((out, item) => {
      const kind = String(item.kind || "unknown");
      out[kind] = (out[kind] || 0) + String(item.text || "").length;
      return out;
    }, {}),
    candidateCount: evidence.candidates.length,
    // Pattern presence is enough to tell an empty/noisy scan from a parser
    // gap; it deliberately records no recognised words or invoice values.
    sourceSignals: {
      hasInvoiceLabel: /发票号码|票据号码|发票号|数电发票/u.test(normalized),
      hasDateLabel: /开票日期|填开日期|开具日期/u.test(normalized),
      hasTotalLabel: /价税合计|票价|票款|票面金额|合计金额/u.test(normalized),
      hasPartyLabel: /购买方|销售方|购方|销方/u.test(normalized),
      hasRailLabel: /铁路电子客票|电子客票|铁路客票/u.test(normalized),
      hasDigits: /\d{6,}/u.test(normalized),
    },
  };
}

/** Downloads and extracts a single PDF into a field-level, auditable V3 result. */
export async function downloadAndExtractInvoicePdf({ url, fileName = "invoice.pdf", providerOcr = null } = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "invoice-ledger-v3-"));
  const safeName = text(fileName).replace(/[^a-zA-Z0-9._-]/g, "_") || "invoice.pdf";
  const file = join(directory, safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`approval_attachment_download_http_${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.subarray(0, 4).toString("utf8") !== "%PDF") throw new Error("approval_attachment_not_pdf");
    await fs.writeFile(file, content);
    const pageCount = await pdfPageCount(file);
    const sources = [];
    let providerDiagnostics = { attempted: false, successfulTypes: [], failedTypes: [] };
    const pdfText = await Promise.allSettled([
      execFileAsync("pdftotext", ["-layout", file, "-"], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 }),
      execFileAsync("pdftotext", ["-raw", file, "-"], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 }),
      execFileAsync("pdftotext", ["-bbox-layout", file, "-"], { maxBuffer: 8 * 1024 * 1024, timeout: 20_000 }),
    ]);
    if (pdfText[0].status === "fulfilled") sources.push({ kind: "pdf-layout", text: pdfText[0].value.stdout, confidence: 92 });
    if (pdfText[1].status === "fulfilled") sources.push({ kind: "pdf-raw", text: pdfText[1].value.stdout, confidence: 86 });
    if (pdfText[2].status === "fulfilled") sources.push(...bboxPartySources(pdfText[2].value.stdout));
    let evidence = extractInvoiceLedgerEvidence({ sources });
    let deepScan = false;
    if (!evidence.assessment.canWrite) {
      // PDF text coordinates supply exact party-panel boundaries even when
      // the embedded glyph encoding hides tax numbers. OCR only those panels
      // and assign them by their known side; no reading-order guess is used.
      const regions = pdfText[2].status === "fulfilled" ? bboxPartyRegions(pdfText[2].value.stdout) : [];
      for (const region of regions) {
        const prefix = join(directory, `${region.side}-panel`);
        await execFileAsync("pdftoppm", ["-png", "-r", "220", "-f", "1", "-l", "1", "-x", String(region.x), "-y", String(region.y), "-W", String(region.width), "-H", String(region.height), file, prefix], { maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
        const image = `${prefix}-1.png`;
        const panel = await ocrPage(image, 6);
        sources.push({ kind: "ocr-party", side: region.side, text: panel, confidence: 82 });
      }
      evidence = extractInvoiceLedgerEvidence({ sources });
      const missingNonPartyField = ["invoiceNumber", "invoiceDate", "itemName", "amount", "taxAmount", "totalAmount"].some((field) => !evidence.snapshot[field]);
      // Scanned/malformed PDFs have no usable coordinate panel or still miss
      // their table fields. Only then pay the cost of two whole-page OCR modes.
      if (!evidence.assessment.canWrite && (regions.length === 0 || missingNonPartyField)) {
        // A completely unparseable first pass is almost always a scan rather
        // than a text PDF.  Inspect up to three pages at 300 dpi and include
        // PSM 4 (column layout) in addition to the existing block/sparse
        // modes.  For normal PDFs keep the lower-cost one-page pass.
        const railTicketMissingCore = evidence.assessment.documentType === "rail_ticket"
          && ["invoiceNumber", "invoiceDate", "totalAmount"].some((field) => !evidence.snapshot[field]);
        // Railway PDFs often retain the passenger section as text while the
        // small fare block is a raster image.  Treat a missing ticket core
        // value like a scan even when other candidates already exist.
        deepScan = evidence.candidates.length === 0 || railTicketMissingCore;
        const pagesToScan = evidence.candidates.length === 0 ? Math.min(pageCount, 3) : 1;
        const dpi = deepScan ? "300" : "220";
        const prefix = join(directory, "page");
        await execFileAsync("pdftoppm", ["-png", "-r", dpi, "-f", "1", "-l", String(pagesToScan), file, prefix], { maxBuffer: 4 * 1024 * 1024, timeout: 45_000 });
        const pages = (await fs.readdir(directory)).filter((name) => /^page-\d+\.png$/u.test(name)).sort();
        for (const page of pages.slice(0, pagesToScan)) {
          const image = join(directory, page);
          const jobs = deepScan ? [ocrPage(image, 3), ocrPage(image, 4), ocrPage(image, 6), ocrPage(image, 11)] : [ocrPage(image, 6), ocrPage(image, 11)];
          const [automatic, column, block, sparse] = await Promise.allSettled(deepScan ? jobs : [Promise.resolve(""), Promise.resolve(""), ...jobs]);
          if (deepScan && automatic.status === "fulfilled") sources.push({ kind: "ocr-automatic", text: automatic.value, confidence: 71 });
          if (deepScan && column.status === "fulfilled") sources.push({ kind: "ocr-columns", text: column.value, confidence: 70 });
          if (block.status === "fulfilled") sources.push({ kind: "ocr-full", text: block.value, confidence: 68 });
          if (sparse.status === "fulfilled") sources.push({ kind: "ocr-sparse", text: sparse.value, confidence: 64 });
        }
        evidence = extractInvoiceLedgerEvidence({ sources });
      }
    }
    // Historical scans with no local candidate cannot safely be reconstructed
    // from PDF text.  An explicitly enabled provider fallback may be used for
    // that narrow case only; ordinary PDFs never make an additional OCR call.
    if (providerOcr?.enabled && evidence.candidates.length === 0) {
      const provider = await providerOcrEvidence(file, providerOcr);
      providerDiagnostics = {
        attempted: provider.attempted,
        successfulTypes: provider.successfulTypes,
        failedTypes: provider.failedTypes,
      };
      if (provider.source) {
        sources.push(provider.source);
        evidence = extractInvoiceLedgerEvidence({ ocr: provider.ocr, sources });
      }
    }
    return {
      ...evidence.snapshot,
      quality: evidence.assessment,
      candidates: evidence.candidates,
      diagnostics: { ...evidenceDiagnostics({ sources, evidence, pageCount, deepScan }), providerOcr: providerDiagnostics },
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
