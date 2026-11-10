// Chunk 8C-1: documents generated locally in the vault worker, in the user's language. A vendor negotiation sheet
// (one vendor's cost history, the last 12 months of purchases and cheaper quotes from other vendors) and a rebate
// agreement drawn from a customer rebate program. Exact integer cents; no notes; PDF text only (no links or actions).
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import { basisPointsDecimal } from "../margin/decimal";
import { Pdf, type Color } from "../margin/pdf";
import { VaultError } from "../vault/protocol";
import { currency, date, decimal, integer, percent, translate, msg, type Locale, type MessageKey, type Params } from "../i18n/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? "" : String(v);
const INK: Color = [.1, .1, .12], MUTED: Color = [.36, .38, .41];
export const SHEET_ROWS = 200;

/** A page writer with wrapped text and simple right-aligned tables. */
function writer(locale: Locale) {
  const pdf = new Pdf(), L = 48, R = 564, tr = (k: MessageKey, p?: Params) => translate(locale, k, p); let y = 0;
  const page = () => { pdf.page(); y = 738; pdf.text(L, 28, tr("templates.footer", { page: integer(locale, pdf.pageCount) }), 8, false, MUTED); };
  const need = (h: number) => { if (y - h < 48) page(); };
  const lines = (text: string, size = 10, bold = false) => { let line = ""; const flush = () => { need(size + 7); pdf.text(L, y, line, size, bold, bold ? INK : MUTED); y -= size + 7; line = ""; };
    for (const word of text.split(/\s+/)) { if (Pdf.widthOf(line + (line ? " " : "") + word, size) > R - L && line) flush(); if (Pdf.widthOf(word, size) > R - L) { for (const ch of word) { if (Pdf.widthOf(line + ch, size) > R - L) flush(); line += ch; } } else line += (line ? " " : "") + word; } if (line) flush(); };
  const heading = (k: MessageKey) => { need(48); y -= 8; lines(tr(k), 13, true); pdf.line(L, y + 3, R, y + 3); y -= 6; };
  /** Columns: [x of the left edge or right edge, align]. The first column is cut to `first` points. */
  const table = (cols: [number, "left" | "right"][], head: string[], body: string[][], first = 190) => {
    const row = (cells: string[], bold: boolean) => { need(16); cells.forEach((c, i) => pdf.text(cols[i][0], y, i === 0 ? Pdf.fit(c, 8, first) : c, 8, bold, bold ? INK : MUTED, cols[i][1])); y -= 13; };
    row(head, true); for (const r of body) row(r, false);
  };
  const blank = (label: string) => { need(30); y -= 12; pdf.text(L, y, label, 9, false, MUTED); pdf.line(L + 140, y - 2, R, y - 2, [.5, .5, .52]); y -= 10; };
  return { pdf, tr, page, lines, heading, table, blank };
}

/** Vendor negotiation sheet for one vendor (its newest cost per item, the previous cost, purchases in the last 365 days). */
export async function negotiationSheet(e: Engine, vendor: unknown, locale: Locale, code: string, today = new Date().toISOString().slice(0, 10)) {
  if (typeof vendor !== "string" || !vendor || vendor.length > 200) throw new VaultError("TEMPLATE", msg("templates.invalid"));
  const v = Q(vendor), since = `DATE ${Q(today)} - INTERVAL 365 DAY`;
  const items = await rows(e, `WITH c AS (SELECT vendor, product_id, cost, effective_date, lag(cost) OVER (PARTITION BY vendor, product_id ORDER BY effective_date, id) AS prev,
 row_number() OVER (PARTITION BY vendor, product_id ORDER BY effective_date DESC, id DESC) AS n FROM vendor_costs WHERE effective_date <= DATE ${Q(today)}),
mine AS (SELECT * FROM c WHERE n = 1 AND vendor = ${v}),
other AS (SELECT product_id, min(cost) AS best FROM c WHERE n = 1 AND vendor <> ${v} GROUP BY product_id),
bought AS (SELECT product_id, sum(quantity) AS qty, sum(amount_cents) AS spend FROM purchases WHERE supplier = ${v} AND receipt_date > ${since} AND receipt_date <= DATE ${Q(today)} GROUP BY product_id)
SELECT m.product_id, coalesce(p.description,'') AS description, m.cost::VARCHAR AS cost, m.prev::VARCHAR AS prev, m.effective_date::VARCHAR AS since,
 CASE WHEN m.prev > 0 THEN ${rhaSql("CAST(m.cost - m.prev AS HUGEINT) * 10000", "m.prev")} END::VARCHAR AS change_bp, o.best::VARCHAR AS best,
 coalesce(b.qty, 0)::VARCHAR AS qty, coalesce(b.spend, 0)::VARCHAR AS spend,
 CASE WHEN o.best < m.cost THEN ${rhaSql("CAST(m.cost - o.best AS HUGEINT) * CAST(coalesce(b.qty,0) * 10000 AS HUGEINT)", "10000")} ELSE 0 END::VARCHAR AS gap
FROM mine m LEFT JOIN products p USING (product_id) LEFT JOIN other o USING (product_id) LEFT JOIN bought b USING (product_id)
ORDER BY coalesce(b.spend, 0) DESC, m.product_id`);
  if (!items.length) throw new VaultError("TEMPLATE", msg("templates.noVendor"));
  const sum = (k: string) => items.reduce((s, r) => s + BigInt(S(r[k]) || "0"), BigInt(0)), money = (c: string) => currency(locale, c, code);
  const rises = items.filter(r => r.change_bp !== null && BigInt(S(r.change_bp)) > BigInt(0)).length, cheaper = items.filter(r => r.best !== null && BigInt(S(r.best)) < BigInt(S(r.cost))).length;
  const facts = { items: items.length, spend: sum("spend").toString(), gap: sum("gap").toString(), rises, cheaper };
  const w = writer(locale); w.page();
  w.lines(w.tr("templates.sheetTitle", { vendor }), 20, true); w.lines(w.tr("templates.generated", { date: date(locale, today) }), 9); w.lines(w.tr("fx.moneyNote", { code }), 9);
  w.heading("templates.summary");
  w.lines(w.tr("templates.sheetSpend", { spend: money(facts.spend), items: integer(locale, facts.items) }));
  w.lines(w.tr("templates.sheetRises", { count: integer(locale, rises) })); w.lines(w.tr("templates.sheetCheaper", { count: integer(locale, cheaper), gap: money(facts.gap) }));
  w.heading("templates.items");
  w.table([[48, "left"], [300, "right"], [355, "right"], [400, "right"], [455, "right"], [505, "right"], [564, "right"]],
    [w.tr("templates.colItem"), w.tr("templates.colCost"), w.tr("templates.colPrevious"), w.tr("templates.colChange"), w.tr("templates.colBest"), w.tr("templates.colQty"), w.tr("templates.colSpend")],
    items.slice(0, SHEET_ROWS).map(r => [S(r.product_id) + (r.description ? " · " + S(r.description) : ""), money(S(r.cost)), r.prev === null ? "-" : money(S(r.prev)), r.change_bp === null ? "-" : percent(locale, basisPointsDecimal(BigInt(S(r.change_bp)))), r.best === null ? "-" : money(S(r.best)), decimal(locale, S(r.qty)), money(S(r.spend))]));
  if (items.length > SHEET_ROWS) w.lines(w.tr("templates.topRows", { shown: integer(locale, SHEET_ROWS), total: integer(locale, items.length) }), 9);
  w.heading("templates.points"); for (const k of ["templates.point1", "templates.point2", "templates.point3"] as const) w.lines(w.tr(k));
  w.heading("templates.agreed"); for (const k of ["templates.agreedCost", "templates.agreedFrom", "templates.agreedBy"] as const) w.blank(w.tr(k));
  return { name: `rebatehq-negotiation-${vendor.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) || "vendor"}.pdf`, bytes: w.pdf.bytes(w.tr("templates.sheetTitle", { vendor })), facts };
}

/** Rebate agreement drawn from a customer rebate program: parties, term, tiers, scope, settlement and signatures. */
export async function rebateAgreement(e: Engine, id: unknown, locale: Locale, code: string, today = new Date().toISOString().slice(0, 10)) {
  if (typeof id !== "string" || !id || id.length > 200) throw new VaultError("TEMPLATE", msg("templates.invalid"));
  const p = (await rows(e, `SELECT r.*, r.period_start::VARCHAR AS from_d, r.period_end::VARCHAR AS to_d, coalesce(c.name,'') AS customer_name FROM rebate_programs r LEFT JOIN customers c USING (customer_id) WHERE r.id = ${Q(id)}`))[0];
  if (!p) throw new VaultError("TEMPLATE", msg("templates.noProgram"));
  const tiers = await rows(e, `SELECT from_cents::VARCHAR AS f, to_cents::VARCHAR AS t, rate_milli FROM rebate_tiers WHERE program_id = ${Q(id)} ORDER BY from_cents`);
  const money = (c: string) => currency(locale, c, code), rate = (m: unknown) => percent(locale, (Number(m) / 1000).toFixed(3).replace(/\.?0+$/, ""));
  const w = writer(locale); w.page();
  w.lines(w.tr("templates.agreementTitle"), 20, true); w.lines(S(p.reference) + " · " + S(p.name), 11, true); w.lines(w.tr("templates.draftNotice", { date: date(locale, today) }), 9); w.lines(w.tr("fx.moneyNote", { code }), 9);
  w.heading("templates.parties"); w.blank(w.tr("templates.supplier")); w.lines(w.tr("templates.customer", { name: S(p.customer_name) || S(p.customer_id), id: S(p.customer_id) }));
  w.heading("templates.term"); w.lines(w.tr("templates.termBody", { from: date(locale, S(p.from_d)), to: date(locale, S(p.to_d)) }));
  w.heading("templates.calculation"); w.lines(w.tr(p.mode === "retroactive" ? "templates.retroactive" : "templates.incremental"));
  w.table([[48, "left"], [300, "right"], [430, "right"]], [w.tr("templates.colFrom"), w.tr("templates.colTo"), w.tr("templates.colRate")],
    tiers.map(t => [money(S(t.f)), t.t === null ? w.tr("templates.noLimit") : money(S(t.t)), rate(t.rate_milli)]));
  w.heading("templates.scope"); w.lines(w.tr("templates.eligible", { list: S(p.eligible_skus) || w.tr("templates.allItems") })); if (S(p.excluded_skus)) w.lines(w.tr("templates.excluded", { list: S(p.excluded_skus) }));
  w.heading("templates.settlement"); w.lines(w.tr("templates.settlementBody")); w.blank(w.tr("templates.paymentTerms"));
  w.heading("templates.signatures"); for (const k of ["templates.forSupplier", "templates.forCustomer"] as const) { w.blank(w.tr(k)); w.blank(w.tr("templates.nameTitle")); w.blank(w.tr("templates.dateSigned")); }
  return { name: `rebatehq-rebate-agreement-${S(p.reference).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) || "program"}.pdf`, bytes: w.pdf.bytes(w.tr("templates.agreementTitle")), tiers: tiers.length };
}
