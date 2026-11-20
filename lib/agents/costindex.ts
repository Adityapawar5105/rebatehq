// Chunk 8B-1 (blueprint sections 6 and 9): cost index triggers with the import-cost currency buffer. Index series are
// files the user uploads through Import Studio (role cost_index); exchange rates are typed by the user. Nothing is
// fetched from the web (decision: no live FX fetch from the browser). All arithmetic is exact integers:
//   index change (bp)  = (latest − base) × 10,000 / base, half away from zero, from the latest points on or before
//                        today and on or before the base date;
//   FX change (bp)     = (rate now − base rate) × 10,000 / base rate; the buffer absorbs the first buffer_bp of a rise;
//   cost change (bp)   = index change × pass-through / 10,000 + max(0, FX change − buffer);
//   expected cost      = current cost × (10,000 + cost change) / 10,000, half away from zero, per SKU.
// A trigger fires when the index rose by at least its threshold, or the FX rate rose beyond the buffer.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { sqlText as Q, validDate } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import { rha } from "../margin/decimal";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";
import { CURRENCIES } from "../vault/currency";
import { msg } from "../i18n/core";
import { businessToday } from "../vault/today";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? null : String(v);
const bad = (): never => { throw new VaultError("INDEX", msg("index.invalid")); };
export const MAX_TRIGGERS = 100;
export type TriggerInput = { name: string; index: string; scope: "category" | "product"; value: string; baseDate: string; thresholdPct: string; passThroughPct: string; fx?: { currency: string; base: string; now: string; bufferPct: string } | null };
export type TriggerStatus = "triggered" | "quiet" | "insufficient";
export type TriggerView = { id: string; name: string; index: string; scope: "category" | "product"; value: string; baseDate: string; thresholdBp: string; passThroughBp: string;
  fx: { currency: string; base: string; now: string; bufferBp: string } | null; status: TriggerStatus; baseValue: string | null; basePeriod: string | null; latestValue: string | null; latestPeriod: string | null;
  indexChangeBp: string | null; fxChangeBp: string | null; costChangeBp: string | null; skus: string; createdAt: string };

/** Percent text with at most two decimals ("3", "-1.25") as integer basis points within [min, max]. */
export function pctBp(text: unknown, min: number, max: number) {
  if (typeof text !== "string" || !/^-?\d{1,4}(\.\d{1,2})?$/.test(text.trim())) bad();
  const t = (text as string).trim(), neg = t.startsWith("-"), [w, f = ""] = t.replace("-", "").split("."), bp = (Number(w) * 100 + Number(f.padEnd(2, "0"))) * (neg ? -1 : 1);
  if (bp < min || bp > max) bad();
  return bp;
}
/** A positive exchange rate with at most six decimals, as an integer scaled by 10^6. */
export function rateMicros(text: unknown) {
  if (typeof text !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(text.trim())) bad();
  const [w, f = ""] = (text as string).trim().split("."), v = BigInt(w) * BigInt(1000000) + BigInt(f.padEnd(6, "0"));
  if (v <= BigInt(0)) bad();
  return v;
}
const micros = (v: bigint) => `${v / BigInt(1000000)}.${String(v % BigInt(1000000)).padStart(6, "0")}`;
/** SQL to save a trigger after validating it (the index must already have points). */
export async function triggerSql(e: Engine, input: TriggerInput, userId: string, at: string) {
  const i = input ?? bad();
  const name = typeof i.name === "string" ? i.name.trim() : bad(), index = typeof i.index === "string" ? i.index.trim() : bad(), value = typeof i.value === "string" ? i.value.trim() : bad();
  if (!name || name.length > 100 || !index || index.length > 100 || !value || value.length > 200 || !["category", "product"].includes(i.scope)) bad();
  try { validDate(i.baseDate); } catch { bad(); }
  const threshold = pctBp(i.thresholdPct, 1, 1_000_000), pass = pctBp(i.passThroughPct, 0, 10000);
  if (!(await rows(e, `SELECT 1 FROM cost_index_points WHERE index_name = ${Q(index)} LIMIT 1`)).length) throw new VaultError("INDEX", msg("index.noSeries"));
  if (Number((await rows(e, "SELECT count(*) AS n FROM cost_index_triggers"))[0].n) >= MAX_TRIGGERS) throw new VaultError("INDEX", msg("index.tooMany", { max: MAX_TRIGGERS }));
  let fx = "NULL,NULL,NULL,NULL";
  if (i.fx) {
    if (!(CURRENCIES as readonly string[]).includes(i.fx.currency)) bad();
    fx = `${Q(i.fx.currency)},${micros(rateMicros(i.fx.base))},${micros(rateMicros(i.fx.now))},${pctBp(i.fx.bufferPct, 0, 10000)}`;
  }
  const id = crypto.randomUUID();
  return { id, sql: `INSERT INTO cost_index_triggers VALUES(${Q(id)},${Q(name)},${Q(index)},${Q(i.scope)},${Q(value)},DATE ${Q(i.baseDate)},${threshold},${pass},${fx},${Q(userId)},${Q(at)});` };
}
export const deleteSql = (id: unknown) => { if (typeof id !== "string" || !id || id.length > 64) bad(); return `DELETE FROM cost_index_triggers WHERE id = ${Q(id as string)};`; };

/** Every trigger with its evaluation as of `today`. */
export async function triggers(e: Engine, today = businessToday()): Promise<TriggerView[]> {
  validDate(today);
  const list = await rows(e, `SELECT t.*, b.period_date::VARCHAR AS base_period, b.index_value::VARCHAR AS base_value, n.period_date::VARCHAR AS latest_period, n.index_value::VARCHAR AS latest_value,
 CAST(b.index_value * 10000 AS HUGEINT)::VARCHAR AS b4, CAST(n.index_value * 10000 AS HUGEINT)::VARCHAR AS n4,
 CAST(t.fx_base * 1000000 AS HUGEINT)::VARCHAR AS fb6, CAST(t.fx_now * 1000000 AS HUGEINT)::VARCHAR AS fn6,
 (SELECT count(*) FROM products p WHERE p.current_cost IS NOT NULL AND (CASE WHEN t.scope = 'category' THEN p.category ELSE p.product_id END) = t.scope_value)::VARCHAR AS skus
FROM cost_index_triggers t
LEFT JOIN LATERAL (SELECT period_date, index_value FROM cost_index_points x WHERE x.index_name = t.index_name AND x.period_date <= t.base_date ORDER BY period_date DESC LIMIT 1) b ON TRUE
LEFT JOIN LATERAL (SELECT period_date, index_value FROM cost_index_points x WHERE x.index_name = t.index_name AND x.period_date <= DATE ${Q(today)} ORDER BY period_date DESC LIMIT 1) n ON TRUE
ORDER BY t.name, t.id`);
  return list.map(r => {
    const fx = r.fx_currency === null ? null : { currency: String(r.fx_currency), base: String(r.fx_base), now: String(r.fx_now), bufferBp: String(r.fx_buffer_bp) };
    const ok = r.b4 !== null && r.n4 !== null && String(r.latest_period) > String(r.base_period);
    const indexChange = ok ? rha((BigInt(String(r.n4)) - BigInt(String(r.b4))) * BigInt(10000), BigInt(String(r.b4))) : null;
    const fxChange = fx ? rha((BigInt(String(r.fn6)) - BigInt(String(r.fb6))) * BigInt(10000), BigInt(String(r.fb6))) : null;
    const buffer = fx ? BigInt(fx.bufferBp) : BigInt(0), fxExcess = fxChange !== null && fxChange > buffer ? fxChange - buffer : BigInt(0);
    const fired = (indexChange !== null && indexChange >= BigInt(String(r.threshold_bp))) || (fxChange !== null && fxChange > buffer);
    const cost = indexChange === null && fxChange === null ? null : rha((indexChange ?? BigInt(0)) * BigInt(String(r.pass_through_bp)), BigInt(10000)) + fxExcess;
    return { id: String(r.id), name: String(r.name), index: String(r.index_name), scope: String(r.scope) as "category" | "product", value: String(r.scope_value), baseDate: String(r.base_date).slice(0, 10),
      thresholdBp: String(r.threshold_bp), passThroughBp: String(r.pass_through_bp), fx, status: fired ? "triggered" : ok || fx ? "quiet" : "insufficient",
      baseValue: S(r.base_value), basePeriod: S(r.base_period), latestValue: S(r.latest_value), latestPeriod: S(r.latest_period),
      indexChangeBp: indexChange === null ? null : String(indexChange), fxChangeBp: fxChange === null ? null : String(fxChange), costChangeBp: cost === null ? null : String(cost), skus: String(r.skus), createdAt: String(r.created_at) };
  });
}
/** Index series loaded in this vault. */
export async function series(e: Engine) {
  return (await rows(e, `SELECT index_name, count(*)::VARCHAR AS points, min(period_date)::VARCHAR AS first, max(period_date)::VARCHAR AS last,
 arg_max(index_value, period_date)::VARCHAR AS last_value FROM cost_index_points GROUP BY 1 ORDER BY 1 LIMIT 500`))
    .map(r => ({ name: String(r.index_name), points: String(r.points), first: String(r.first), last: String(r.last), lastValue: String(r.last_value) }));
}
export const SKU_GRID: GridSpec = { product_id: "text", description: "text", category: "text", current_cost: "money", expected_cost: "money", change: "money" };
/** The SKUs one trigger covers, each with its expected cost at the trigger's cost change. */
export async function triggerSkus(e: Engine, id: unknown, offset = 0, grid?: unknown, today?: string) {
  const t = (await triggers(e, today)).find(x => x.id === id);
  if (!t) throw new VaultError("INDEX", msg("index.noTrigger"));
  const bp = t.costChangeBp ?? "0", col = t.scope === "category" ? "p.category" : "p.product_id";
  const base = `SELECT p.product_id, coalesce(p.description, '') AS description, coalesce(p.category, '') AS category, p.current_cost::VARCHAR AS current_cost,
 ${rhaSql(`CAST(p.current_cost AS HUGEINT) * (10000 + (${bp}))`, "10000")}::VARCHAR AS expected_cost,
 (${rhaSql(`CAST(p.current_cost AS HUGEINT) * (10000 + (${bp}))`, "10000")} - p.current_cost)::VARCHAR AS change
FROM products p WHERE p.current_cost IS NOT NULL AND ${col} = ${Q(t.value)}`;
  const page = await gridPage(e, base, SKU_GRID, gridQuery(SKU_GRID, grid), { fallback: "g.product_id", limit: 50, offset });
  return { trigger: t, offset, rows: page.rows.map(r => ({ product_id: String(r.product_id), description: String(r.description), category: String(r.category), current_cost: String(r.current_cost), expected_cost: String(r.expected_cost), change: String(r.change) })), grid: page.grid as GridMeta };
}
