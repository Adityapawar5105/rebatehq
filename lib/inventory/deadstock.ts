// Chunk 8B-2 (blueprint Phase 3; v2.4 decision): the dead-stock clearance optimiser. Stock on hand comes from an
// Import Studio file (role inventory); nothing else is assumed about inventory. An item is dead stock when it has stock
// on hand and no sale in the last `idle days` (at least 90), or has never sold. Exact integers throughout, rounded half
// away from zero:
//   replacement cost (unit)   = item master current cost, else the newest vendor cost (as the 5A cost basis does);
//   capital tied up           = on hand × replacement cost;
//   carrying cost per month   = capital × cost of capital % / 12 + on hand × storage cost per unit per month;
//   carrying per unit (H)     = unit cost × cost of capital % × H / 12 + storage per unit per month × H, H = horizon months;
//   suggested clearance price = max(replacement cost, list price − carrying per unit over H): a markdown no larger
//                               than what holding the unit another H months would cost, never below replacement cost.
//   An item already priced at or below replacement cost keeps its price. Substitutes: up to three SKUs in the same
//   category and unit of measure that sold in the idle window, by units sold; the dead item can be offered in their place.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { sqlText as Q, validDate } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";
import { msg } from "../i18n/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? null : String(v);
const bad = (): never => { throw new VaultError("DEADSTOCK", msg("dead.invalid")); };
export type DeadSettings = { idleDays: number; capitalRateBp: number; storageCents: string; horizonMonths: number; updatedAt: string | null };
export const DEFAULTS: DeadSettings = { idleDays: 90, capitalRateBp: 1000, storageCents: "0", horizonMonths: 12, updatedAt: null };
export const MAX_DRAFT = 5000;
export type DeadStatus = "suggested" | "floored" | "at_cost" | "no_price" | "no_cost";
export const DEAD_GRID: GridSpec = { product_id: "text", description: "text", category: "text", uom: "text", on_hand: "decimal", last_sale: "date", idle_days: "int", unit_cost: "money", capital: "money",
  carrying_month: "money", price: "money", suggested: "money", markdown: "money", status: "text", substitutes: "text" };

export async function settings(e: Engine): Promise<DeadSettings> {
  const r = (await rows(e, "SELECT * FROM dead_stock_settings WHERE id = 1"))[0];
  return r ? { idleDays: Number(r.idle_days), capitalRateBp: Number(r.capital_rate_bp), storageCents: String(r.storage_cents), horizonMonths: Number(r.horizon_months), updatedAt: String(r.updated_at) } : DEFAULTS;
}
export function settingsSql(input: unknown, at: string) {
  const v = input as Partial<DeadSettings> | null;
  if (!v || typeof v !== "object") bad();
  const int = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? x as number : bad();
  const idle = int(v!.idleDays, 90, 730), rate = int(v!.capitalRateBp, 0, 10000), horizon = int(v!.horizonMonths, 1, 36);
  const storage = typeof v!.storageCents === "string" && /^(0|[1-9]\d{0,9})$/.test(v!.storageCents) ? v!.storageCents : bad();
  return `INSERT INTO dead_stock_settings VALUES(1,${idle},${rate},${storage},${horizon},${Q(at)}) ON CONFLICT(id) DO UPDATE SET idle_days=excluded.idle_days,capital_rate_bp=excluded.capital_rate_bp,
 storage_cents=excluded.storage_cents,horizon_months=excluded.horizon_months,updated_at=excluded.updated_at;`;
}

/** Every dead-stock item with its figures, as SQL over the vault (one row per product). */
export function deadSql(s: DeadSettings, today: string) {
  validDate(today);
  const d = `DATE ${Q(today)}`, rate = BigInt(s.capitalRateBp), storage = BigInt(s.storageCents), h = BigInt(s.horizonMonths);
  const units = "CAST(x.on_hand * 10000 AS HUGEINT)", cost = "CAST(x.unit_cost AS HUGEINT)";
  const carryUnit = `(${rhaSql(`${cost} * ${rate * h}`, "120000")} + ${storage * h})`;
  return `WITH stock AS (SELECT product_id, sum(on_hand) AS on_hand FROM inventory_levels GROUP BY product_id HAVING sum(on_hand) > 0),
vc AS (SELECT product_id, cost, row_number() OVER (PARTITION BY product_id ORDER BY effective_date DESC, id DESC) AS rk FROM vendor_costs),
sold AS (SELECT product_id, max(sale_date) AS last_sale FROM sales_lines WHERE line_kind = 'sale' AND sale_date <= ${d} GROUP BY product_id),
x AS (SELECT s.product_id, coalesce(p.description, '') AS description, coalesce(p.category, '') AS category, coalesce(p.uom, '') AS uom, s.on_hand, l.last_sale,
 CASE WHEN l.last_sale IS NULL THEN NULL ELSE date_diff('day', l.last_sale, ${d}) END AS idle_days, coalesce(p.current_cost, vc.cost) AS unit_cost, p.list_price AS price
 FROM stock s JOIN products p USING (product_id) LEFT JOIN sold l USING (product_id) LEFT JOIN vc ON vc.product_id = s.product_id AND vc.rk = 1
 WHERE l.last_sale IS NULL OR l.last_sale <= ${d} - INTERVAL ${s.idleDays} DAY),
act AS (SELECT l.product_id, p.category, p.uom, sum(l.quantity) AS q FROM sales_lines l JOIN products p USING (product_id)
 WHERE l.line_kind = 'sale' AND l.sale_date > ${d} - INTERVAL ${s.idleDays} DAY AND l.sale_date <= ${d} AND p.category <> '' GROUP BY l.product_id, p.category, p.uom),
ranked AS (SELECT *, row_number() OVER (PARTITION BY category, uom ORDER BY q DESC, product_id) AS r FROM act),
subs AS (SELECT x.product_id, string_agg(ranked.product_id, ', ' ORDER BY ranked.r) AS substitutes FROM x JOIN ranked ON ranked.category = x.category AND ranked.uom = x.uom AND ranked.r <= 3 GROUP BY x.product_id),
c AS (SELECT x.*, CASE WHEN x.unit_cost IS NULL THEN NULL ELSE ${rhaSql(`${units} * ${cost}`, "10000")} END AS capital,
 CASE WHEN x.unit_cost IS NULL THEN NULL ELSE ${rhaSql(`${units} * ${cost} * ${rate}`, "1200000000")} + ${rhaSql(`${units} * ${storage}`, "10000")} END AS carrying_month,
 CASE WHEN x.unit_cost IS NULL OR x.price IS NULL THEN NULL ELSE x.price - ${carryUnit} END AS candidate FROM x)
SELECT c.product_id, c.description, c.category, c.uom, c.on_hand::VARCHAR AS on_hand, c.last_sale::VARCHAR AS last_sale, c.idle_days::VARCHAR AS idle_days,
 c.unit_cost::VARCHAR AS unit_cost, c.capital::VARCHAR AS capital, c.carrying_month::VARCHAR AS carrying_month, c.price::VARCHAR AS price,
 (CASE WHEN c.price IS NULL OR c.unit_cost IS NULL THEN NULL WHEN c.price <= c.unit_cost THEN c.price ELSE greatest(c.unit_cost, c.candidate) END)::VARCHAR AS suggested,
 (CASE WHEN c.price IS NULL OR c.unit_cost IS NULL THEN NULL WHEN c.price <= c.unit_cost THEN 0 ELSE c.price - greatest(c.unit_cost, c.candidate) END)::VARCHAR AS markdown,
 CASE WHEN c.unit_cost IS NULL THEN 'no_cost' WHEN c.price IS NULL THEN 'no_price' WHEN c.price <= c.unit_cost THEN 'at_cost' WHEN c.candidate < c.unit_cost THEN 'floored' ELSE 'suggested' END AS status,
 coalesce(subs.substitutes, '') AS substitutes
FROM c LEFT JOIN subs USING (product_id)`;
}

export type DeadRow = { product_id: string; description: string; category: string; uom: string; on_hand: string; last_sale: string | null; idle_days: string | null; unit_cost: string | null; capital: string | null;
  carrying_month: string | null; price: string | null; suggested: string | null; markdown: string | null; status: DeadStatus; substitutes: string };
const toRow = (r: Record<string, unknown>): DeadRow => ({ product_id: String(r.product_id), description: String(r.description), category: String(r.category), uom: String(r.uom), on_hand: String(r.on_hand),
  last_sale: S(r.last_sale), idle_days: S(r.idle_days), unit_cost: S(r.unit_cost), capital: S(r.capital), carrying_month: S(r.carrying_month), price: S(r.price), suggested: S(r.suggested),
  markdown: S(r.markdown), status: String(r.status) as DeadStatus, substitutes: String(r.substitutes) });

/** Totals for the summary tiles, and stock rows whose item is not in the item master. */
export async function summary(e: Engine, s: DeadSettings, today: string) {
  const r = (await rows(e, `SELECT count(*)::VARCHAR AS skus, coalesce(sum(capital::HUGEINT), 0)::VARCHAR AS capital, coalesce(sum(carrying_month::HUGEINT), 0)::VARCHAR AS carrying,
 count(*) FILTER (WHERE status = 'no_cost')::VARCHAR AS no_cost, count(*) FILTER (WHERE status IN ('suggested', 'floored'))::VARCHAR AS priced FROM (${deadSql(s, today)})`))[0];
  const stock = (await rows(e, `SELECT count(*)::VARCHAR AS n, count(*) FILTER (WHERE product_id NOT IN (SELECT product_id FROM products))::VARCHAR AS unknown FROM inventory_levels`))[0];
  return { skus: String(r.skus), capital: String(r.capital), carryingMonth: String(r.carrying), noCost: String(r.no_cost), priced: String(r.priced), stockRows: String(stock.n), unknownItems: String(stock.unknown) };
}
export async function page(e: Engine, s: DeadSettings, today: string, offset = 0, grid?: unknown) {
  const p = await gridPage(e, deadSql(s, today), DEAD_GRID, gridQuery(DEAD_GRID, grid), { fallback: "g.product_id", limit: 50, offset });
  return { offset, rows: p.rows.map(toRow), grid: p.grid as GridMeta };
}
/** The picked items that have a clearance price below their list price, with that price (worker-side, for a draft). */
export async function picks(e: Engine, s: DeadSettings, today: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DRAFT || ids.some(i => typeof i !== "string" || !i || i.length > 200)) bad();
  const list = (ids as string[]).map(Q).join(",");
  return (await rows(e, `SELECT product_id, suggested FROM (${deadSql(s, today)}) WHERE status IN ('suggested', 'floored') AND product_id IN (${list}) ORDER BY product_id`))
    .map(r => ({ product_id: String(r.product_id), suggested: String(r.suggested) }));
}
