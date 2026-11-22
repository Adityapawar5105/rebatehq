// Chunk 7E-2 (blueprint sections 6 and 9, M9): historical scenario simulator, Scale tier only.
// It replays whole months of imported sales and credit lines with percentage price and cost changes through the
// vault's line waterfall (lineFromCents: pocket = list − discount − rebate − freight; margin = pocket − cost, unknown
// cost stays unknown) and compares the result with what actually happened. It runs in the vault worker, one month
// at a time so it reports progress and can be cancelled, into a TEMPORARY table: no vault row ever changes
// (engine design rule 6). Money is integer cents; every scaled component is rounded half away from zero once.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { sqlText as Q } from "../spike/exact";
import { rhaSql, rateBpSql } from "../margin/sql";
import { bpPercentSql } from "../margin/views";
import { basisPointsDecimal, rateBp } from "../margin/decimal";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? null : String(v);
const bad = (): never => { throw new VaultError("SIM", msg("sim.invalid")); };

/** Guardrails: the blueprint's v1 hard cap of 2M lines, at most 36 months, at most 20 changes. */
export const SIM_MAX_LINES = 2_000_000, SIM_MAX_MONTHS = 36, SIM_MAX_CHANGES = 20;
export const SIM_KINDS = ["price", "cost"] as const;
export const SIM_SCOPES = ["all", "category", "customer", "product"] as const;
export type SimKind = typeof SIM_KINDS[number];
export type SimScope = typeof SIM_SCOPES[number];
export type SimChange = { kind: SimKind; scope: SimScope; value: string; pct: string };
export type SimInput = { from: string; to: string; changes: SimChange[] };
import type { ProgressKind } from "../studio/studio";
import { salesInput } from "../rebate/input";
export type Progress = (stage: string, done: string, total: string, kind?: ProgressKind) => void;
/** Most specific first: a product change beats a customer change, which beats a category change, which beats "all". */
const PRECEDENCE: SimScope[] = ["product", "customer", "category", "all"];
const COLUMN: Record<Exclude<SimScope, "all">, string> = { product: "l.product_id", customer: "l.customer_id", category: "coalesce(p.category, '')" };

/** A signed percent with at most two decimals, −90.00 to +100.00, as integer basis points. */
export function percentBp(text: unknown): number {
  if (typeof text !== "string" || !/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(text.trim())) bad();
  const t = (text as string).trim(), negative = t.startsWith("-"), [w, f = ""] = t.replace(/^[+-]/, "").split(".");
  const bp = (Number(w) * 100 + Number(f.padEnd(2, "0"))) * (negative ? -1 : 1);
  if (bp < -9000 || bp > 10000) bad();
  return bp;
}
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthIndex = (m: string) => { const x = MONTH.exec(m); if (!x) bad(); return Number(x![1]) * 12 + Number(x![2]) - 1; };
const monthText = (i: number) => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;

/** Validates a scenario. Returns the months to replay and the parsed changes. */
export function checkScenario(input: unknown) {
  const v = input as Partial<SimInput> | null;
  if (!v || typeof v !== "object" || typeof v.from !== "string" || typeof v.to !== "string" || !Array.isArray(v.changes)) bad();
  const a = monthIndex(v!.from!), b = monthIndex(v!.to!);
  if (b < a || b - a + 1 > SIM_MAX_MONTHS) throw new VaultError("SIM", msg("sim.badPeriod", { months: SIM_MAX_MONTHS }));
  if (!v!.changes!.length || v!.changes!.length > SIM_MAX_CHANGES) throw new VaultError("SIM", msg("sim.badChanges", { max: SIM_MAX_CHANGES }));
  const seen = new Set<string>();
  const changes = v!.changes!.map(c => {
    if (!c || typeof c !== "object" || !SIM_KINDS.includes(c.kind) || !SIM_SCOPES.includes(c.scope)) bad();
    if (c.kind === "cost" && c.scope === "customer") bad(); // a supplier cost does not depend on who bought
    const value = c.scope === "all" ? "" : typeof c.value === "string" ? c.value.trim() : bad();
    if (c.scope !== "all" && (!value || value.length > 200)) bad();
    const key = JSON.stringify([c.kind, c.scope, value]);
    if (seen.has(key)) throw new VaultError("SIM", msg("sim.duplicate"));
    seen.add(key);
    return { kind: c.kind, scope: c.scope, value, bp: percentBp(c.pct) };
  });
  return { from: monthText(a), to: monthText(b), months: Array.from({ length: b - a + 1 }, (_, i) => monthText(a + i)), changes };
}
/** The basis points that apply to a line for one kind (most specific scope wins; 0 when nothing matches). */
function bpSql(changes: ReturnType<typeof checkScenario>["changes"], kind: SimKind) {
  const parts = PRECEDENCE.flatMap(scope => {
    const list = changes.filter(c => c.kind === kind && c.scope === scope);
    if (!list.length) return [];
    if (scope === "all") return [String(list[0].bp)];
    return [`CASE ${list.map(c => `WHEN ${COLUMN[scope]} = ${Q(c.value)} THEN ${c.bp}`).join(" ")} END`];
  });
  return `coalesce(${[...parts, "0"].join(", ")})`;
}
/** x scaled by (10000 + bp) / 10000, rounded half away from zero to the cent (NULL stays NULL). */
const scaled = (x: string, bp: string) => rhaSql(`CAST(${x} AS HUGEINT) * (10000 + ${bp})`, "10000");

export const SIM_TABLE = "md_sim";
const CREATE = `CREATE OR REPLACE TEMP TABLE ${SIM_TABLE}(product_id VARCHAR, customer_id VARCHAR, month DATE, lines BIGINT, changed BIGINT, costed BIGINT,
 a_list HUGEINT, a_discount HUGEINT, a_rebate HUGEINT, freight HUGEINT, a_cost HUGEINT, a_costed_pocket HUGEINT,
 s_list HUGEINT, s_discount HUGEINT, s_rebate HUGEINT, s_cost HUGEINT, s_costed_pocket HUGEINT)`;

/**
 * Replays the period month by month into the temporary table and returns the totals. List, discount and rebate move
 * with the price change (discount and rebate keep their share of list); freight is unchanged; cost moves with the
 * cost change. Quantities are as they happened (no volume response is modelled).
 */
export async function simulate(e: Engine, input: unknown, signal: AbortSignal, progress: Progress) {
  const s = checkScenario(input), t0 = Date.now();
  const start = `DATE ${Q(s.from + "-01")}`, end = `(DATE ${Q(s.to + "-01")} + INTERVAL 1 MONTH)`;
  const count = Number((await rows(e, `SELECT count(*)::VARCHAR AS n FROM sales_lines WHERE sale_date >= ${start} AND sale_date < ${end}`))[0].n);
  if (!count) throw new VaultError("SIM", msg("sim.noLines"));
  if (count > SIM_MAX_LINES) throw new VaultError("SIM", msg("sim.tooMany", { lines: count, max: SIM_MAX_LINES }));
  // Phase 16 audit: the same input as the Margin screens and the leak finder, so customer rebate programmes are in the
  // actual figures (rebate_sales adds or replaces the booked rebate); sales_lines alone left them out.
  const lineSource = await salesInput(e);
  const pb = bpSql(s.changes, "price"), cb = bpSql(s.changes, "cost");
  await e.conn.query(CREATE);
  let done = false;
  try {
    for (let i = 0; i < s.months.length; i++) {
      if (signal.aborted) throw new VaultError("CANCELLED", msg("sim.cancelled"));
      progress(msg("sim.progress", { month: s.months[i] }), String(i), String(s.months.length), "sim");
      const m = `DATE ${Q(s.months[i] + "-01")}`;
      await e.conn.query(`INSERT INTO ${SIM_TABLE}
WITH x AS (SELECT l.product_id, l.customer_id, l.list_cents, l.discount_cents, l.rebate_cents, l.freight_cents, l.cost_cents, ${pb} AS pb, ${cb} AS cb
 FROM ${lineSource} l LEFT JOIN products p ON p.product_id = l.product_id WHERE l.sale_date >= ${m} AND l.sale_date < ${m} + INTERVAL 1 MONTH),
y AS (SELECT *, ${scaled("list_cents", "pb")} AS sl, ${scaled("discount_cents", "pb")} AS sd, ${scaled("rebate_cents", "pb")} AS sr,
 CASE WHEN cost_cents IS NULL THEN NULL ELSE ${scaled("cost_cents", "cb")} END AS sc FROM x)
SELECT product_id, customer_id, ${m}, count(*), count(*) FILTER (WHERE pb <> 0 OR (cb <> 0 AND cost_cents IS NOT NULL)), count(cost_cents),
 sum(list_cents), sum(discount_cents), sum(rebate_cents), sum(freight_cents), coalesce(sum(cost_cents), 0),
 coalesce(sum(list_cents - discount_cents - rebate_cents - freight_cents) FILTER (WHERE cost_cents IS NOT NULL), 0),
 sum(sl), sum(sd), sum(sr), coalesce(sum(sc), 0), coalesce(sum(sl - sd - sr - freight_cents) FILTER (WHERE cost_cents IS NOT NULL), 0)
FROM y GROUP BY product_id, customer_id`);
    }
    if (signal.aborted) throw new VaultError("CANCELLED", msg("sim.cancelled"));
    progress(msg("sim.progress", { month: s.to }), String(s.months.length), String(s.months.length), "sim");
    done = true;
  } finally { if (!done) await e.conn.query(`DROP TABLE IF EXISTS ${SIM_TABLE}`).catch(() => undefined); }
  return { from: s.from, to: s.to, months: String(s.months.length), changes: s.changes.map(c => ({ kind: c.kind, scope: c.scope, value: c.value, bp: String(c.bp) })), ...(await simTotals(e)), ms: String(Date.now() - t0) };
}

export type SimSide = { list: string; discount: string; rebate: string; freight: string; pocket: string; cost: string; costedPocket: string; margin: string; rate: string | null };
/** Totals of the last run: what happened and the scenario, side by side, plus the change. */
export async function simTotals(e: Engine) {
  const r = (await rows(e, `SELECT sum(lines)::VARCHAR AS lines, sum(changed)::VARCHAR AS changed, sum(costed)::VARCHAR AS costed,
 sum(a_list)::VARCHAR AS al, sum(a_discount)::VARCHAR AS ad, sum(a_rebate)::VARCHAR AS ar, sum(freight)::VARCHAR AS f, sum(a_cost)::VARCHAR AS ac, sum(a_costed_pocket)::VARCHAR AS acp,
 sum(s_list)::VARCHAR AS sl, sum(s_discount)::VARCHAR AS sd, sum(s_rebate)::VARCHAR AS sr, sum(s_cost)::VARCHAR AS sc, sum(s_costed_pocket)::VARCHAR AS scp FROM ${SIM_TABLE}`))[0];
  const B = (v: unknown) => BigInt(String(v ?? "0")), f = B(r.f);
  const side = (list: bigint, discount: bigint, rebate: bigint, cost: bigint, costedPocket: bigint): SimSide => {
    const margin = costedPocket - cost, rate = costedPocket === BigInt(0) ? null : rateBpText(margin, costedPocket);
    return { list: String(list), discount: String(discount), rebate: String(rebate), freight: String(f), pocket: String(list - discount - rebate - f), cost: String(cost), costedPocket: String(costedPocket), margin: String(margin), rate };
  };
  const actual = side(B(r.al), B(r.ad), B(r.ar), B(r.ac), B(r.acp)), scenario = side(B(r.sl), B(r.sd), B(r.sr), B(r.sc), B(r.scp));
  return { lines: String(r.lines ?? "0"), changedLines: String(r.changed ?? "0"), uncostedLines: String(B(r.lines) - B(r.costed)), actual, scenario,
    delta: { list: String(B(scenario.list) - B(actual.list)), pocket: String(B(scenario.pocket) - B(actual.pocket)), cost: String(B(scenario.cost) - B(actual.cost)), margin: String(B(scenario.margin) - B(actual.margin)) } };
}
/** Margin rate as exact percent text with two decimals ("-0.05"), from the engine's rateBp. */
const rateBpText = (margin: bigint, pocket: bigint) => basisPointsDecimal(rateBp(margin, pocket)!);

export const SIM_DIMS = ["product", "category", "customer", "tier", "month"] as const;
export type SimDim = typeof SIM_DIMS[number];
export const SIM_GRID: GridSpec = { key: "text", label: "text", lines: "int", changed: "int", actual_pocket: "money", scenario_pocket: "money",
  actual_margin: "money", scenario_margin: "money", margin_change: "money", actual_rate: "percent", scenario_rate: "percent", uncosted: "int" };
const DIM_KEY: Record<SimDim, { key: string; label: string }> = {
  product: { key: "m.product_id", label: "coalesce(any_value(p.description), '')" },
  category: { key: "coalesce(p.category, '')", label: "''" },
  customer: { key: "m.customer_id", label: "coalesce(any_value(c.name), '')" },
  tier: { key: "coalesce(c.tier, '')", label: "''" },
  month: { key: "strftime(m.month, '%Y-%m')", label: "''" },
};
/** The last run broken down by one dimension, as a worker grid. */
export async function simRows(e: Engine, dim: unknown, offset = 0, grid?: unknown) {
  if (!(SIM_DIMS as readonly unknown[]).includes(dim)) bad();
  const d = DIM_KEY[dim as SimDim];
  const base = `SELECT z.*, (z.sm - z.am)::VARCHAR AS margin_change, z.ap::VARCHAR AS actual_pocket, z.sp::VARCHAR AS scenario_pocket,
 z.am::VARCHAR AS actual_margin, z.sm::VARCHAR AS scenario_margin, ${bpPercentSql(rateBpSql("z.am", "z.acp"))} AS actual_rate, ${bpPercentSql(rateBpSql("z.sm", "z.scp"))} AS scenario_rate
FROM (SELECT ${d.key} AS key, ${d.label} AS label, sum(m.lines)::VARCHAR AS lines, sum(m.changed)::VARCHAR AS changed, (sum(m.lines) - sum(m.costed))::VARCHAR AS uncosted,
 sum(m.a_list - m.a_discount - m.a_rebate - m.freight) AS ap, sum(m.s_list - m.s_discount - m.s_rebate - m.freight) AS sp,
 sum(m.a_costed_pocket - m.a_cost) AS am, sum(m.s_costed_pocket - m.s_cost) AS sm, sum(m.a_costed_pocket) AS acp, sum(m.s_costed_pocket) AS scp
 FROM ${SIM_TABLE} m LEFT JOIN products p ON p.product_id = m.product_id LEFT JOIN customers c ON c.customer_id = m.customer_id GROUP BY 1) z`;
  const page = await gridPage(e, base, SIM_GRID, gridQuery(SIM_GRID, grid), { fallback: "g.key", limit: 50, offset });
  return { dim: dim as SimDim, offset, rows: page.rows.map(r => ({ key: String(r.key), label: String(r.label ?? ""), lines: String(r.lines), changed: String(r.changed), actual_pocket: String(r.actual_pocket), scenario_pocket: String(r.scenario_pocket), actual_margin: String(r.actual_margin), scenario_margin: String(r.scenario_margin), margin_change: String(r.margin_change), actual_rate: S(r.actual_rate), scenario_rate: S(r.scenario_rate), uncosted: String(r.uncosted) })), grid: page.grid as GridMeta };
}
/** Choices for the change editor: categories, customer ids and tiers in this vault (bounded lists). */
export async function simOptions(e: Engine) {
  const list = async (sql: string) => (await rows(e, sql)).map(r => String(r.v));
  const span = (await rows(e, `SELECT strftime(min(sale_date), '%Y-%m') AS a, strftime(max(sale_date), '%Y-%m') AS b FROM sales_lines`))[0];
  return { first: S(span.a), lastMonth: S(span.b), categories: await list(`SELECT DISTINCT category AS v FROM products WHERE category <> '' ORDER BY 1 LIMIT 500`) };
}
