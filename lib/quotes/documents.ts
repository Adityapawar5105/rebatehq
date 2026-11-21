// Roadmap Phase 11 (blueprint section 22, item 34): documents a customer may receive, built in the vault worker.
// - Quote branding: the workspace's company name, address, quote terms and a small JPEG logo (one row per vault).
// - The customer quote PDF (11.3): prices only. It is drawn from a quote view built WITHOUT cost, so cost, margin,
//   floor, target, start, book price and zone can never reach it (decision 16; tests/quotes.test.ts scans it).
// - The customer price list (11.4): the book price at quantity 1 for every item, as CSV or XLSX (formula-safe).
// - The mailing list for a price-increase letter (11.4): the customers a planned increase reaches, as CSV.
// Nothing is uploaded; every file is handed to the page to download.
import * as XLSX from "xlsx";
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { Pdf, type Color } from "../margin/pdf";
import { centsText } from "../margin/decimal";
import { csvRow, csvSafeCell } from "../csv";
import { resolvedBook } from "../pricing/book";
import { VaultError } from "../vault/protocol";
import { currency, date as fmtDate, decimal, integer, msg, translate, type Locale, type MessageKey, type Params } from "../i18n/core";
import type { QuoteView } from "./quotes";

export type Branding = { company: string; address: string; terms: string; logo: string | null; updatedAt: string | null };
export const LOGO_MAX_BYTES = 200_000;
const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? "" : String(v);
const bad = (key: MessageKey, params?: Params): never => { throw new VaultError("QUOTE", msg(key, params)); };
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

export async function branding(e: Engine): Promise<Branding | null> {
  const r = (await rows(e, "SELECT company, address, terms, logo_jpeg, updated_at FROM quote_branding WHERE id=1"))[0];
  return r ? { company: S(r.company), address: S(r.address), terms: S(r.terms), logo: r.logo_jpeg === null ? null : S(r.logo_jpeg), updatedAt: S(r.updated_at) } : null;
}
function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Validated SQL to save the branding. `logo`: base64 of a JPEG (at most 200 kB), null to remove it, undefined to keep it. */
export async function brandingSql(e: Engine, input: unknown, userId: string, at: string) {
  const i = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number, required = false) => { const s = typeof v === "string" ? v.trim() : ""; if ((required && !s) || s.length > max || CONTROL.test(s)) bad("qdoc.brandingInvalid"); return s; };
  const company = text(i.company, 120, true), address = text(i.address, 400), terms = text(i.terms, 2000);
  let logo: string | null;
  if (i.logo === undefined) logo = (await branding(e))?.logo ?? null;
  else if (i.logo === null) logo = null;
  else {
    if (typeof i.logo !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(i.logo)) bad("qdoc.logoInvalid");
    const bytes = base64Bytes(i.logo as string);
    if (bytes.length > LOGO_MAX_BYTES) bad("qdoc.logoTooLarge", { max: integer("en", LOGO_MAX_BYTES / 1000) });
    if (!Pdf.jpegInfo(bytes)) bad("qdoc.logoInvalid");
    logo = i.logo as string;
  }
  return `DELETE FROM quote_branding; INSERT INTO quote_branding VALUES(1,${Q(company)},${address ? Q(address) : "NULL"},${terms ? Q(terms) : "NULL"},${logo === null ? "NULL" : Q(logo)},${Q(userId)},${Q(at)});`;
}

const INK: Color = [.1, .1, .12], MUTED: Color = [.36, .38, .41];
/** 11.3: the quote as a customer receives it. `v` must come from quotes.view(..., withCost=false). */
export function quotePdf(v: QuoteView, b: Branding | null, locale: Locale, code: string, issued: string) {
  if (v.status !== "submitted" && v.status !== "approved") bad("qdoc.pdfSentOnly");
  if ("costCents" in v || v.lines.some(l => "costCents" in l)) bad("qdoc.pdfSentOnly"); // never from a cost view
  const pdf = new Pdf(), L = 48, R = 564, tr = (k: MessageKey, p?: Params) => translate(locale, k, p), money = (c: string) => currency(locale, c, code);
  let y = 0;
  const page = () => { pdf.page(); y = 744; };
  const need = (h: number) => { if (y - h < 60) page(); };
  const wrap = (s: string, size: number, x = L, width = R - L, bold = false, color = MUTED) => { for (const line of s.split(/\r?\n/).flatMap(p => Pdf.wrap(p, size, width))) { need(size + 6); pdf.text(x, y, line, size, bold, color); y -= size + 5; } };
  page();
  // Header: logo on the left, company and address on the right.
  let top = y;
  if (b?.logo) {
    const bytes = base64Bytes(b.logo), info = Pdf.jpegInfo(bytes);
    if (info) { const scale = Math.min(140 / info.width, 56 / info.height), w = info.width * scale, h = info.height * scale; pdf.image(L, y - h + 12, w, h, bytes); top = Math.min(top, y - h); }
  }
  if (b) { pdf.text(R, y, b.company, 13, true, INK, "right"); let ay = y - 16; for (const line of b.address.split(/\r?\n/).filter(Boolean).slice(0, 6)) { pdf.text(R, ay, Pdf.fit(line, 9, 260), 9, false, MUTED, "right"); ay -= 12; } top = Math.min(top, ay); }
  y = top - 18;
  pdf.text(L, y, tr("qdoc.title", { number: v.number }), 20, true, INK); y -= 24;
  const facts: [string, string][] = [[tr("qdoc.customer"), v.customerName ? `${v.customerName} (${v.customerId})` : v.customerId], [tr("qdoc.issued"), fmtDate(locale, issued)],
    [tr("qdoc.validUntil"), v.validUntil ? fmtDate(locale, v.validUntil) : tr("qdoc.noValidity")], ...(v.revisionOf ? [[tr("qdoc.revisionOf"), v.revisionOf.number] as [string, string]] : [])];
  for (const [k, val] of facts) { pdf.text(L, y, k, 9, true, INK); pdf.text(L + 110, y, Pdf.fit(val, 9, R - L - 110), 9, false, MUTED); y -= 13; }
  y -= 10;
  // Lines: item, quantity, unit price, line total. Nothing else from the quote view is printed.
  const cols: [number, "left" | "right"][] = [[L, "left"], [400, "right"], [480, "right"], [R, "right"]];
  const row = (cells: string[], bold: boolean) => { need(16); cells.forEach((c, i) => pdf.text(cols[i][0], y, i === 0 ? Pdf.fit(c, 9, 300) : c, 9, bold, bold ? INK : MUTED, cols[i][1])); y -= 14; };
  row([tr("qdoc.colItem"), tr("qdoc.colQty"), tr("qdoc.colUnit"), tr("qdoc.colTotal")], true); pdf.line(L, y + 10, R, y + 10);
  for (const l of v.lines) row([l.productId + (l.description ? " · " + l.description : ""), decimal(locale, l.quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")), money(l.unitCents), money(l.totalCents)], false);
  pdf.line(L, y + 10, R, y + 10); y -= 4;
  pdf.text(480, y, tr("qdoc.total"), 11, true, INK, "right"); pdf.text(R, y, money(v.totalCents), 11, true, INK, "right"); y -= 18;
  pdf.text(L, y, tr("qdoc.currency", { code }), 8, false, MUTED); y -= 20;
  if (b?.terms) { need(40); pdf.text(L, y, tr("qdoc.terms"), 11, true, INK); y -= 16; wrap(b.terms, 9); }
  pdf.eachPage((i, n) => pdf.text(L, 30, tr("qdoc.footer", { company: b?.company || "", page: integer(locale, i + 1), pages: integer(locale, n) }), 8, false, MUTED));
  return { name: `${v.number.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`, bytes: pdf.bytes(tr("qdoc.title", { number: v.number })) };
}

export const PRICE_LIST_HEADERS = ["product_id", "description", "category", "uom", "barcode", "unit_price", "price_basis"] as const;
const PRICE_LIST_MAX = 200_000;
/** 11.4: the book price at quantity 1 for every item, for one customer, on `asOf`. Prices only. */
export async function priceList(e: Engine, customerId: unknown, format: unknown, asOf: string) {
  if (typeof customerId !== "string" || !customerId || customerId.length > 64 || CONTROL.test(customerId)) bad("quote.chooseCustomer");
  if (format !== "csv" && format !== "xlsx") bad("qdoc.formatInvalid");
  const c = (await rows(e, `SELECT customer_id, tier FROM customers WHERE customer_id=${Q(customerId as string)}`))[0];
  if (!c) bad("quote.unknownCustomer", { id: customerId as string });
  const input = `SELECT row_number() OVER (ORDER BY p.product_id)::VARCHAR AS lookup_id, p.product_id, coalesce(p.category,'') AS category, ${Q(customerId as string)} AS customer_id, ${Q(S(c.tier))} AS tier, 1 AS quantity, DATE ${Q(asOf)} AS as_of,
 coalesce(p.description,'') AS description, coalesce(p.uom,'') AS uom, coalesce(p.barcode,'') AS barcode, p.list_price FROM products p`;
  const found = await rows(e, `SELECT product_id, description, category, uom, barcode, coalesce(book_price, list_price)::VARCHAR AS price,
 CASE WHEN book_price IS NULL THEN 'list' WHEN book_customer IS NOT NULL THEN 'customer' ELSE 'price_list' END AS basis
 FROM (${resolvedBook(input)}) WHERE coalesce(book_price, list_price) IS NOT NULL ORDER BY product_id LIMIT ${PRICE_LIST_MAX + 1}`);
  if (found.length > PRICE_LIST_MAX) bad("qdoc.listTooLong", { max: integer("en", PRICE_LIST_MAX) });
  const table = [[...PRICE_LIST_HEADERS] as string[], ...found.map(r => [S(r.product_id), S(r.description), S(r.category), S(r.uom), S(r.barcode), centsText(BigInt(S(r.price))), S(r.basis)])];
  const safe = (customerId as string).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) || "customer";
  return { name: `rebatehq-price-list-${safe}-${asOf}.${format}`, blob: fileOf(table, format as "csv" | "xlsx", "Price list"), rows: found.length };
}

export const MAILING_HEADERS = ["customer_id", "name", "tier", "branch", "region", "segment", "increase_percent"] as const;
/** 11.4: the customers a planned price increase reaches (tier, customer, or buyers of the category in the last 365 days), for the letter's mail-out. */
export async function mailingList(e: Engine, runId: unknown, asOf: string) {
  if (typeof runId !== "string" || !runId || runId.length > 64 || CONTROL.test(runId)) bad("qdoc.runInvalid");
  const m = (await rows(e, `SELECT segment_type, segment_value, increase_bp FROM price_changesets WHERE run_id=${Q(runId as string)} AND kind='planner'`))[0];
  if (!m) bad("qdoc.runInvalid");
  const type = S(m.segment_type), value = S(m.segment_value);
  const where = type === "tier" ? `tier=${Q(value)}` : type === "customer" ? `customer_id=${Q(value)}`
    : type === "category" ? `customer_id IN (SELECT DISTINCT l.customer_id FROM sales_lines l JOIN products p USING(product_id) WHERE p.category=${Q(value)} AND l.sale_date > DATE ${Q(asOf)} - INTERVAL 365 DAY AND l.sale_date <= DATE ${Q(asOf)})` : bad("qdoc.runInvalid");
  const found = await rows(e, `SELECT customer_id, name, tier, branch, region FROM customers WHERE ${where} ORDER BY customer_id`);
  const rate = m.increase_bp === null ? "" : (Number(m.increase_bp) / 100).toFixed(2);
  const table = [[...MAILING_HEADERS] as string[], ...found.map(r => [S(r.customer_id), S(r.name), S(r.tier), S(r.branch), S(r.region), `${type}:${value}`, rate])];
  return { name: `rebatehq-price-increase-mailing-${asOf}.csv`, blob: fileOf(table, "csv", "Mailing list"), rows: found.length };
}

function fileOf(table: string[][], format: "csv" | "xlsx", sheet: string): Blob {
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(table.map(r => r.map(csvSafeCell))), sheet);
    return new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const chunks: string[] = ["﻿"]; for (let i = 0; i < table.length; i += 2000) chunks.push(table.slice(i, i + 2000).map(csvRow).join("\r\n") + "\r\n");
  return new Blob(chunks, { type: "text/csv;charset=utf-8" });
}
