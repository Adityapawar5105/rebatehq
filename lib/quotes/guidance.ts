// Chunk 8A (blueprint Phase 3): explainable deal guidance in Quote Desk. For each quote line the worker suggests a
// unit price and says why, from four signals: this customer's recent prices, what similar customers (same tier) paid,
// the tier/category guardrail, and a recent supplier cost increase. Deterministic SQL over the local vault; no model,
// no network. Decision 16: the result carries selling prices, guardrail prices, counts and dates only. A cost increase
// is a yes/no flag with no amount; cost and margin values are never read into the result.
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import { rha } from "../margin/decimal";
import { businessToday } from "../vault/today";

/** Look-back windows (days before the latest invoice date in the vault, or before today for supplier costs). */
export const HISTORY_DAYS = 365, COST_RISE_DAYS = 90;
/** At most this many recent lines count as the customer's history (the newest ones). */
export const HISTORY_LINES = 5;
/** Similar customers: at least this many lines from at least this many other customers in the same tier. */
export const SIMILAR_MIN_LINES = 3, SIMILAR_MIN_CUSTOMERS = 2, SIMILAR_MAX_LINES = 200;

export type Basis = "history" | "similar" | "target" | "book" | "none";
/** One reason, as data: the page turns it into a sentence in the user's language and currency. */
export type Reason =
  | { code: "history"; cents: string; count: string; date: string; used: boolean }
  | { code: "similar"; cents: string; count: string; customers: string; tier: string; used: boolean }
  | { code: "target"; cents: string; floorCents: string | null; used: boolean }
  | { code: "book"; cents: string; used: boolean }
  | { code: "costRise"; applied: boolean }
  | { code: "floor"; cents: string }
  | { code: "start"; cents: string }
  | { code: "none" };
export type LineGuidance = { lineNo: number; productId: string; quotedCents: string; suggestedCents: string | null; basis: Basis; reasons: Reason[] };
type Rows = Record<string, unknown>[];
const rows = async (e: Engine, sql: string): Promise<Rows> => (await e.conn.query(sql)).toArray().map(r => ({ ...r }));
const big = (v: unknown) => BigInt(String(v));
/** Median of whole-cent prices, the two middle values averaged half away from zero. */
export function medianCents(values: bigint[]): bigint | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : rha(s[m - 1] + s[m], BigInt(2));
}
/** Net unit price of a sales line in whole cents: (list − discount) / quantity, half away from zero. */
const UNIT = rhaSql("CAST(l.list_cents - l.discount_cents AS HUGEINT) * 10000", "CAST(l.quantity * 10000 AS HUGEINT)");

/** Signals and suggestion for one product sold to one customer. */
export async function lineGuidance(e: Engine, input: { productId: string; customerId: string; tier: string; quotedCents: string; bookCents: string | null; startCents: string | null; targetCents: string | null; floorCents: string | null; today: string }) {
  const p = Q(input.productId), since = `(SELECT max(sale_date) FROM sales_lines) - INTERVAL ${HISTORY_DAYS} DAY`;
  const sale = `l.product_id = ${p} AND l.line_kind = 'sale' AND l.quantity > 0 AND l.list_cents > 0 AND l.sale_date > ${since}`;
  const own = await rows(e, `SELECT ${UNIT}::VARCHAR AS unit, strftime(l.sale_date, '%Y-%m-%d') AS d FROM sales_lines l WHERE ${sale} AND l.customer_id = ${Q(input.customerId)}
 ORDER BY l.sale_date DESC, l.source_id, l.line_id LIMIT ${HISTORY_LINES}`);
  const similar = input.tier ? await rows(e, `SELECT ${UNIT}::VARCHAR AS unit, l.customer_id AS c FROM sales_lines l JOIN customers k ON k.customer_id = l.customer_id
 WHERE ${sale} AND l.customer_id <> ${Q(input.customerId)} AND k.tier = ${Q(input.tier)} ORDER BY l.sale_date DESC, l.source_id, l.line_id LIMIT ${SIMILAR_MAX_LINES}`) : [];
  // A supplier cost increase: a vendor's latest cost above its previous cost, dated within the window. Only a flag leaves this query.
  const rise = (await rows(e, `WITH v AS (SELECT cost, effective_date, lag(cost) OVER (PARTITION BY vendor ORDER BY effective_date, id) AS prev,
 row_number() OVER (PARTITION BY vendor ORDER BY effective_date DESC, id DESC) AS n FROM vendor_costs WHERE product_id = ${p})
SELECT count(*) > 0 AS up FROM v WHERE n = 1 AND prev IS NOT NULL AND cost > prev AND effective_date > DATE ${Q(input.today)} - INTERVAL ${COST_RISE_DAYS} DAY AND effective_date <= DATE ${Q(input.today)}`))[0]?.up === true;

  const reasons: Reason[] = [];
  const history = own.length ? medianCents(own.map(r => big(r.unit))) : null;
  const similarOk = similar.length >= SIMILAR_MIN_LINES && new Set(similar.map(r => String(r.c))).size >= SIMILAR_MIN_CUSTOMERS;
  const peer = similarOk ? medianCents(similar.map(r => big(r.unit))) : null;
  const target = input.targetCents === null ? null : big(input.targetCents), floor = input.floorCents === null ? null : big(input.floorCents), start = input.startCents === null ? null : big(input.startCents);
  const book = input.bookCents === null ? null : big(input.bookCents);
  const basis: Basis = history !== null ? "history" : peer !== null ? "similar" : target !== null ? "target" : book !== null ? "book" : "none";
  if (history !== null) reasons.push({ code: "history", cents: String(history), count: String(own.length), date: String(own[0].d), used: basis === "history" });
  if (peer !== null) reasons.push({ code: "similar", cents: String(peer), count: String(similar.length), customers: String(new Set(similar.map(r => String(r.c))).size), tier: input.tier, used: basis === "similar" });
  if (target !== null) reasons.push({ code: "target", cents: String(target), floorCents: floor === null ? null : String(floor), used: basis === "target" });
  if (book !== null) reasons.push({ code: "book", cents: String(book), used: basis === "book" });
  let price = basis === "history" ? history : basis === "similar" ? peer : basis === "target" ? target : book;
  if (price === null) return { suggestedCents: null, basis, reasons: [{ code: "none" } as Reason] };
  if (rise) {
    const applied = target !== null && price < target;
    if (applied) price = target!;
    reasons.push({ code: "costRise", applied });
  }
  if (floor !== null && price < floor) { price = floor; reasons.push({ code: "floor", cents: String(floor) }); }
  if (start !== null && price > start && (floor === null || start >= floor)) { price = start; reasons.push({ code: "start", cents: String(start) }); }
  return { suggestedCents: String(price), basis, reasons };
}

/** Guidance for every line of a quote, from the line's stored book price and guardrail snapshot. */
export async function quoteGuidance(e: Engine, quoteId: string, today = businessToday()): Promise<{ quoteId: string; lines: LineGuidance[] }> {
  const q = (await rows(e, `SELECT q.customer_id, coalesce(c.tier, '') AS tier FROM quotes q LEFT JOIN customers c ON c.customer_id = q.customer_id WHERE q.id = ${Q(quoteId)}`))[0];
  if (!q) return { quoteId, lines: [] };
  const lines = await rows(e, `SELECT line_no, product_id, unit_price_cents::VARCHAR AS unit, book_price_cents::VARCHAR AS book, start_cents::VARCHAR AS s, target_cents::VARCHAR AS t, floor_cents::VARCHAR AS f
 FROM quote_lines WHERE quote_id = ${Q(quoteId)} ORDER BY line_no`);
  const s = (v: unknown) => v === null || v === undefined ? null : String(v);
  const out: LineGuidance[] = [];
  for (const l of lines) {
    const g = await lineGuidance(e, { productId: String(l.product_id), customerId: String(q.customer_id), tier: String(q.tier), quotedCents: String(l.unit), bookCents: s(l.book), startCents: s(l.s), targetCents: s(l.t), floorCents: s(l.f), today });
    out.push({ lineNo: Number(l.line_no), productId: String(l.product_id), quotedCents: String(l.unit), ...g });
  }
  return { quoteId, lines: out };
}
