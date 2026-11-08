import {salesInput} from '../rebate/input';
import {reconciliation} from '../rebate/store';
// Margin views read the agg_cpm pre-aggregate: waterfall (list -> pocket -> margin),
// drill-down by product/category/customer/branch/tier/region/month, the whale curve,
// and "show me the math" for any number (formula, inputs and the source rows).
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { rateBp, centsText, bpText } from "./decimal";
import { lineFromCents } from "./engine";
import { POCKET, MARGIN, rateBpSql } from "./sql";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";
/** Grid columns (7V-3a). The drill-down returns its top rows; sort and filter run over every group. */
export const DRILL_GRID: GridSpec = { key: "text", label: "text", lines: "int", list: "money", discount: "money", credits: "money", pocket: "money", cost: "money", margin: "money", rate_value: "percent", uncosted: "int" };
/** Source-row grids of "show the math" (the leak evidence uses the same columns with "leak"). */
export const MATH_ROWS_GRID: GridSpec = { file: "text", source_row: "int", invoice: "text", d: "date", product_id: "text", customer_id: "text", list: "money", discount: "money", freight: "money", cost: "money", pocket: "money", contribution: "money" };
/** Exact percent text ("-0.05") from integer basis points, for sorting and filtering a rate column. */
export const bpPercentSql = (bp: string) => `CASE WHEN ${bp} IS NULL THEN NULL ELSE (CASE WHEN ${bp} < 0 THEN '-' ELSE '' END) || (abs(${bp}) // 100)::VARCHAR || '.' || lpad((abs(${bp}) % 100)::VARCHAR, 2, '0') END`;

export type Dim = "product" | "category" | "customer" | "branch" | "tier" | "region" | "month";
export const DIMS: Dim[] = ["product", "category", "customer", "branch", "tier", "region", "month"];
export type Filters = { by: Array<{ dim: Dim; value: string }>; from?: string | null; to?: string | null };
const Z = BigInt(0), big = (v: unknown) => BigInt(String(v ?? "0"));
/** Column for a dimension over the aggregate (a = agg_cpm, c = customers, p = products) or over lines (s = sales_lines). */
function col(dim: Dim, lines = false) {
  const t = lines ? "s" : "a";
  switch (dim) {
    case "product": return `${t}.product_id`; case "customer": return `${t}.customer_id`;
    case "category": return "p.category"; case "branch": return "c.branch"; case "tier": return "c.tier"; case "region": return "c.region";
    case "month": return lines ? "strftime(date_trunc('month', s.sale_date), '%Y-%m')" : "strftime(a.month, '%Y-%m')";
  }
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export function checkFilters(f: Filters | undefined): Filters {
  const by = Array.isArray(f?.by) ? f!.by : [];
  if (by.length > 6) throw new VaultError("FILTER", msg("waterfall.useAtMostSix"));
  for (const x of by) if (!DIMS.includes(x.dim) || typeof x.value !== "string" || x.value.length > 200) throw new VaultError("FILTER", msg("waterfall.unsupportedFilter"));
  for (const m of [f?.from, f?.to]) if (m != null && !MONTH.test(m)) throw new VaultError("FILTER", msg("waterfall.useMonthsAsYyyy"));
  return { by, from: f?.from ?? null, to: f?.to ?? null };
}
function where(f: Filters, lines = false) {
  const parts = f.by.map(x => `${col(x.dim, lines)} = ${sqlText(x.value)}`);
  const m = lines ? "date_trunc('month', s.sale_date)" : "a.month";
  if (f.from) parts.push(`${m} >= DATE '${f.from}-01'`);
  if (f.to) parts.push(`${m} <= DATE '${f.to}-01'`);
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}
const needsJoin = (f: Filters, extra: Dim[] = []) => ({ c: [...f.by.map(x => x.dim), ...extra].some(d => ["customer", "branch", "tier", "region"].includes(d)), p: [...f.by.map(x => x.dim), ...extra].some(d => ["product", "category"].includes(d)) });
/** The smallest pre-aggregate that can answer: customer x month, product (all months), or customer x product x month. */
export function aggTable(f: Filters, extra: Dim[] = []) {
  const dims = [...f.by.map(x => x.dim), ...extra];
  if (dims.every(d => ["customer", "branch", "tier", "region", "month"].includes(d))) return "agg_cm";
  if (dims.every(d => ["product", "category"].includes(d)) && !f.from && !f.to) return "agg_p";
  return "agg_cpm";
}
function fromAgg(f: Filters, extra: Dim[] = []) {
  const j = needsJoin(f, extra);
  return `${aggTable(f, extra)} a${j.c ? " JOIN customers c ON c.customer_id = a.customer_id" : ""}${j.p ? " JOIN products p ON p.product_id = a.product_id" : ""}`;
}
export type Comp = { lines: string; list: string; discount: string; rebate: string; freight: string; pocket: string };
export type Step = { key: Metric; label: string; cents: string; kind: "start" | "minus" | "plus" | "subtotal" | "excluded" | "end" };
export type Waterfall = { filters: Filters; lines: string; sales: Comp; credits: Comp; netPocket: string; costedLines: string; costedPocket: string; cost: string; margin: string; rate: string;
  uncostedLines: string; uncostedPocket: string; steps: Step[]; ms: number; rebateReconciliation?:Awaited<ReturnType<typeof reconciliation>> };
export type Metric = "list" | "discount" | "rebate" | "freight" | "salesPocket" | "credits" | "netPocket" | "uncostedPocket" | "costedPocket" | "cost" | "margin" | "rate" | "lines";
const SUMS = "sum(a.lines) AS lines, sum(a.list_cents) AS list, sum(a.discount_cents) AS discount, sum(a.rebate_cents) AS rebate, sum(a.freight_cents) AS freight, sum(a.costed_lines) AS costed_lines, sum(a.costed_pocket_cents) AS costed_pocket, sum(a.cost_cents) AS cost";
export async function waterfall(engine: Engine, filters?: Filters): Promise<Waterfall> {
  const f = checkFilters(filters), t0 = performance.now();
  const rows = (await engine.conn.query(`SELECT a.line_kind, ${SUMS} FROM ${fromAgg(f)} ${where(f)} GROUP BY a.line_kind`)).toArray();
  const pick = (kind: string) => rows.find(r => r.line_kind === kind) ?? {} as Record<string, unknown>;
  const comp = (r: Record<string, unknown>) => { const list = big(r.list), discount = big(r.discount), rebate = big(r.rebate), freight = big(r.freight);
    return { lines: big(r.lines), list, discount, rebate, freight, pocket: lineFromCents({ list, discount, rebate, freight, cost: null }).pocket, costedLines: big(r.costed_lines), costedPocket: big(r.costed_pocket), cost: big(r.cost) }; };
  const s = comp(pick("sale")), c = comp(pick("credit"));
  const netPocket = s.pocket + c.pocket, costedPocket = s.costedPocket + c.costedPocket, cost = s.cost + c.cost, margin = costedPocket - cost;
  const lines = s.lines + c.lines, costedLines = s.costedLines + c.costedLines, uncostedPocket = netPocket - costedPocket;
  const str = (x: typeof s): Comp => ({ lines: String(x.lines), list: String(x.list), discount: String(x.discount), rebate: String(x.rebate), freight: String(x.freight), pocket: String(x.pocket) });
  const steps: Step[] = [
    { key: "list", label: msg("waterfall.listSales"), cents: String(s.list), kind: "start" },
    { key: "discount", label: msg("waterfall.discounts2"), cents: String(-s.discount), kind: "minus" },
    { key: "rebate", label: msg("waterfall.offInvoiceRebates"), cents: String(-s.rebate), kind: "minus" },
    { key: "freight", label: msg("waterfall.freight2"), cents: String(-s.freight), kind: "minus" },
    { key: "salesPocket", label: msg("waterfall.pocketSales2"), cents: String(s.pocket), kind: "subtotal" },
    { key: "credits", label: msg("waterfall.returnsAndCredits2"), cents: String(c.pocket), kind: "plus" },
    { key: "netPocket", label: msg("waterfall.netPocket3"), cents: String(netPocket), kind: "subtotal" },
    { key: "uncostedPocket", label: msg("waterfall.pocketWithUnknownCost3"), cents: String(-uncostedPocket), kind: "excluded" },
    { key: "costedPocket", label: msg("waterfall.pocketWithKnownCost5"), cents: String(costedPocket), kind: "subtotal" },
    { key: "cost", label: msg("waterfall.cost2"), cents: String(-cost), kind: "minus" },
    { key: "margin", label: msg("waterfall.pocketMargin2"), cents: String(margin), kind: "end" },
  ];
  return { rebateReconciliation:await reconciliation(engine),filters: f, lines: String(lines), sales: str(s), credits: str(c), netPocket: String(netPocket), costedLines: String(costedLines), costedPocket: String(costedPocket), cost: String(cost), margin: String(margin),
    rate: bpText(rateBp(margin, costedPocket)), uncostedLines: String(lines - costedLines), uncostedPocket: String(uncostedPocket), steps, ms: Math.round((performance.now() - t0) * 10) / 10 };
}
export type DrillRow = { rateValue?: string | null; key: string; label: string; lines: string; list: string; discount: string; rebate: string; freight: string; credits: string; pocket: string; costedLines: string; cost: string; margin: string; rate: string; uncostedLines: string };
export type Drill = { grid?: GridMeta; dim: Dim; filters: Filters; rows: DrillRow[]; total: string; ms: number };
export async function drill(engine: Engine, dim: Dim, filters?: Filters, sort: "margin" | "pocket" | "rate" = "pocket", limit = 100, grid?: unknown): Promise<Drill> {
  if (!DIMS.includes(dim)) throw new VaultError("FILTER", msg("waterfall.unsupportedDrillDown"));
  const f = checkFilters(filters), t0 = performance.now(), k = col(dim);
  const pocket = `(sum(a.list_cents) - sum(a.discount_cents) - sum(a.rebate_cents) - sum(a.freight_cents))`, margin = "(sum(a.costed_pocket_cents) - sum(a.cost_cents))";
  const q = gridQuery(DRILL_GRID, grid), rate = rateBpSql(margin, "sum(a.costed_pocket_cents)");
  const fallback = sort === "margin" ? "g.margin_n ASC, g.key" : sort === "rate" ? "g.rate_n ASC NULLS LAST, g.key" : "g.pocket_n DESC, g.key";
  // Group on the id first; product/customer labels are joined only for the rows returned.
  const attr = !["product", "customer", "month"].includes(dim), j = needsJoin(f, attr ? [dim] : []), table = aggTable(f, [dim]);
  const from = `${table} a${j.c ? " JOIN customers c ON c.customer_id = a.customer_id" : ""}${j.p ? " JOIN products p ON p.product_id = a.product_id" : ""}`;
  const label = dim === "product" ? "(SELECT description FROM products px WHERE px.product_id = d0.key)" : dim === "customer" ? "(SELECT name FROM customers cx WHERE cx.customer_id = d0.key)" : "''";
  const base = `SELECT d0.*, ${label} AS label, ${bpPercentSql("d0.rate_n")} AS rate_value FROM (SELECT ${k} AS key, sum(a.lines)::VARCHAR AS lines, coalesce(sum(a.list_cents) FILTER (WHERE a.line_kind='sale'),0)::VARCHAR AS list, coalesce(sum(a.discount_cents) FILTER (WHERE a.line_kind='sale'),0)::VARCHAR AS discount,
 coalesce(sum(a.rebate_cents) FILTER (WHERE a.line_kind='sale'),0)::VARCHAR AS rebate, coalesce(sum(a.freight_cents) FILTER (WHERE a.line_kind='sale'),0)::VARCHAR AS freight,
 coalesce(sum(a.list_cents - a.discount_cents - a.rebate_cents - a.freight_cents) FILTER (WHERE a.line_kind='credit'),0)::VARCHAR AS credits, ${pocket}::VARCHAR AS pocket,
 sum(a.costed_lines)::VARCHAR AS costed_lines, sum(a.cost_cents)::VARCHAR AS cost, ${margin}::VARCHAR AS margin, ${rate} AS rate_n, (sum(a.lines) - sum(a.costed_lines))::VARCHAR AS uncosted, ${pocket} AS pocket_n, ${margin} AS margin_n
FROM ${from} ${where(f)} GROUP BY ${k}) d0`;
  const page = await gridPage(engine, base, DRILL_GRID, q, { fallback, limit: Math.max(1, Math.min(500, limit)), offset: 0 });
  const rows = page.rows;
  return { dim, filters: f, total: page.grid.matched, grid: page.grid, ms: Math.round((performance.now() - t0) * 10) / 10,
    rows: rows.map(r => ({ rateValue: r.rate_value === null ? null : String(r.rate_value), key: String(r.key), label: String(r.label ?? ""), lines: String(r.lines), list: String(r.list ?? "0"), discount: String(r.discount ?? "0"), rebate: String(r.rebate ?? "0"), freight: String(r.freight ?? "0"),
      credits: String(r.credits ?? "0"), pocket: String(r.pocket), costedLines: String(r.costed_lines), cost: String(r.cost), margin: String(r.margin), rate: r.rate_n === null ? "n/a" : bpText(BigInt(String(r.rate_n))), uncostedLines: String(r.uncosted) })) };
}
export type Whale = { available: boolean; reason?: string; customers: string; totalMargin: string; peakMargin: string; peakAt: string; peakPct: string; losers: string; loserMargin: string;
  points: Array<{ x: number; y: number }>; top: DrillRow[]; bottom: DrillRow[]; uncostedCustomers: string; ms: number };
/** Customer profitability: customers ranked by pocket margin (known cost), cumulative margin as % of the total. */
export async function whale(engine: Engine, tier: string, filters?: Filters): Promise<Whale> {
  const empty = { customers: "0", totalMargin: "0", peakMargin: "0", peakAt: "0", peakPct: "n/a", losers: "0", loserMargin: "0", points: [], top: [], bottom: [], uncostedCustomers: "0", ms: 0 };
  if (tier === "starter") return { available: false, reason: msg("waterfall.customerProfitabilityTheWhale"), ...empty };
  const f = checkFilters(filters), t0 = performance.now();
  const rows = (await engine.conn.query(`SELECT a.customer_id, (sum(a.costed_pocket_cents) - sum(a.cost_cents))::VARCHAR AS margin, (sum(a.lines) - sum(a.costed_lines))::VARCHAR AS uncosted
FROM ${fromAgg(f)} ${where(f)} GROUP BY a.customer_id ORDER BY sum(a.costed_pocket_cents) - sum(a.cost_cents) DESC, a.customer_id`)).toArray();
  const margins = rows.map(r => big(r.margin)), total = margins.reduce((s, m) => s + m, Z);
  let run = Z, peak = Z, peakAt = 0; const cum: bigint[] = [];
  margins.forEach((m, i) => { run += m; cum.push(run); if (run > peak) { peak = run; peakAt = i + 1; } });
  const n = rows.length, step = Math.max(1, Math.ceil(n / 200)), points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  for (let i = step - 1; i < n; i += step) points.push({ x: (i + 1) / n * 100, y: total === Z ? 0 : Number(cum[i] * BigInt(10000) / (total < Z ? -total : total)) / 100 });
  if (n && points[points.length - 1].x !== 100) points.push({ x: 100, y: total === Z ? 0 : Number(cum[n - 1] * BigInt(10000) / (total < Z ? -total : total)) / 100 });
  const losers = margins.filter(m => m < Z);
  const d = await drill(engine, "customer", f, "margin", 10), top = await drill(engine, "customer", f, "pocket", 10);
  return { available: true, customers: String(n), totalMargin: String(total), peakMargin: String(peak), peakAt: String(peakAt), peakPct: total > Z ? bpText(rateBp(peak, total)) : "n/a",
    losers: String(losers.length), loserMargin: String(losers.reduce((s, m) => s + m, Z)), points, top: top.rows, bottom: d.rows, uncostedCustomers: String(rows.filter(r => r.uncosted !== "0").length), ms: Math.round((performance.now() - t0) * 10) / 10 };
}
// ---- Show me the math ---------------------------------------------------------------
const CONTRIB: Record<Exclude<Metric, "rate">, { expr: string; kind?: "sale" | "credit"; cost?: "known" | "unknown"; formula: string }> = {
  list: { expr: "s.list_cents", kind: "sale", formula: msg("waterfall.listSumOfList") },
  discount: { expr: "s.discount_cents", kind: "sale", formula: msg("waterfall.discountsSumOfDiscount") },
  rebate: { expr: "s.rebate_cents", kind: "sale", formula: msg("waterfall.offInvoiceRebatesSum") },
  freight: { expr: "s.freight_cents", kind: "sale", formula: msg("waterfall.freightSumOfFreight") },
  salesPocket: { expr: POCKET, kind: "sale", formula: msg("waterfall.pocketSalesListDiscounts") },
  credits: { expr: POCKET, kind: "credit", formula: msg("waterfall.returnsAndCreditsSum") },
  netPocket: { expr: POCKET, formula: msg("waterfall.netPocketPocketSales") },
  uncostedPocket: { expr: POCKET, cost: "unknown", formula: msg("waterfall.pocketWithUnknownCost2") },
  costedPocket: { expr: POCKET, cost: "known", formula: msg("waterfall.pocketWithKnownCost4") },
  cost: { expr: "s.cost_cents", cost: "known", formula: msg("waterfall.costSumOfCost") },
  margin: { expr: MARGIN, cost: "known", formula: msg("waterfall.pocketMarginPocketWith") },
  lines: { expr: "1", formula: msg("waterfall.linesNumberOfInvoice") },
};
export type MathRow = { sourceCurrency:string;workspaceCurrency:string;fxRate:string;headerFx:string; sourceFile: string; sourceId: string; sourceRow: string; lineId: string; invoice: string; date: string; product: string; customer: string; kind: string; quantity: string;
  recordedRebate: string; list: string; discount: string; rebate: string; freight: string; cost: string | null; pocket: string; margin: string | null; contribution: string };
export type MathPanel = { grid?: GridMeta; metric: Metric; label: string; value: string; formula: string; inputs: Array<{ label: string; cents: string }>; check: { engine: string; agrees: boolean };
  rows: MathRow[]; rowCount: string; rowsSum: string; rowsAgree: boolean; offset: number };
/** The formula, its inputs (recomputed by the JS engine) and the source rows behind one waterfall number. */
export async function math(engine: Engine, metric: Metric, filters?: Filters, offset = 0, grid?: unknown): Promise<MathPanel> {
  const input=await salesInput(engine);
  const f = checkFilters(filters), w = await waterfall(engine, f);
  if (!(metric in CONTRIB) && metric !== "rate") throw new VaultError("FILTER", msg("waterfall.unsupportedNumber"));
  const s = w.sales, c = w.credits, n = (v: string) => BigInt(v);
  const pocket = (x: Comp) => lineFromCents({ list: n(x.list), discount: n(x.discount), rebate: n(x.rebate), freight: n(x.freight), cost: null }).pocket;
  const engineValue: Record<Metric, () => bigint> = {
    list: () => n(s.list), discount: () => n(s.discount), rebate: () => n(s.rebate), freight: () => n(s.freight), salesPocket: () => pocket(s), credits: () => pocket(c),
    netPocket: () => pocket(s) + pocket(c), uncostedPocket: () => pocket(s) + pocket(c) - n(w.costedPocket), costedPocket: () => n(w.costedPocket), cost: () => n(w.cost),
    margin: () => lineFromCents({ list: n(w.costedPocket), discount: Z, rebate: Z, freight: Z, cost: n(w.cost) }).margin!, rate: () => rateBp(n(w.margin), n(w.costedPocket)) ?? Z, lines: () => n(w.lines),
  };
  const shown: Record<Metric, string> = { list: s.list, discount: s.discount, rebate: s.rebate, freight: s.freight, salesPocket: s.pocket, credits: c.pocket, netPocket: w.netPocket, uncostedPocket: w.uncostedPocket,
    costedPocket: w.costedPocket, cost: w.cost, margin: w.margin, rate: String(rateBp(n(w.margin), n(w.costedPocket)) ?? "0"), lines: w.lines };
  const inputs: Record<Metric, Array<[string, string]>> = {
    list: [[msg("waterfall.listOnSalesLines"), s.list]], discount: [[msg("waterfall.discountsOnSalesLines"), s.discount]], rebate: [[msg("waterfall.rebatesOnSalesLines"), s.rebate]], freight: [[msg("waterfall.freightOnSalesLines"), s.freight]],
    salesPocket: [[msg("waterfall.list"), s.list], [msg("waterfall.discounts"), s.discount], [msg("waterfall.rebates"), s.rebate], [msg("waterfall.freight"), s.freight]],
    credits: [[msg("waterfall.creditList"), c.list], [msg("waterfall.creditDiscounts"), c.discount], [msg("waterfall.creditRebates"), c.rebate], [msg("waterfall.creditFreight"), c.freight]],
    netPocket: [[msg("waterfall.pocketSales"), s.pocket], [msg("waterfall.returnsAndCredits"), c.pocket]], uncostedPocket: [[msg("waterfall.netPocket2"), w.netPocket], [msg("waterfall.pocketWithKnownCost3"), w.costedPocket]],
    costedPocket: [[msg("waterfall.netPocket"), w.netPocket], [msg("waterfall.pocketWithUnknownCost"), w.uncostedPocket]], cost: [[msg("waterfall.costOnLinesWith"), w.cost]],
    margin: [[msg("waterfall.pocketWithKnownCost2"), w.costedPocket], [msg("waterfall.cost"), w.cost]], rate: [[msg("waterfall.pocketMargin"), w.margin], [msg("waterfall.pocketWithKnownCost"), w.costedPocket]], lines: [[msg("waterfall.salesLines"), s.lines], [msg("waterfall.creditLines"), c.lines]],
  };
  const computed = engineValue[metric]();
  const spec = metric === "rate" ? CONTRIB.margin : CONTRIB[metric];
  const conds = [where(f, true).replace(/^WHERE /, ""), spec.kind ? `s.line_kind='${spec.kind}'` : "", spec.cost === "known" ? "s.cost_cents IS NOT NULL" : spec.cost === "unknown" ? "s.cost_cents IS NULL" : ""].filter(Boolean);
  const j = needsJoin(f), base = `FROM ${input} s${j.c ? " JOIN customers c ON c.customer_id = s.customer_id" : ""}${j.p ? " JOIN products p ON p.product_id = s.product_id" : ""} ${conds.length ? "WHERE " + conds.join(" AND ") : ""}`;
  const agg = (await engine.conn.query(`SELECT count(*)::VARCHAR AS n, coalesce(sum(${spec.expr}),0)::VARCHAR AS total ${base}`)).toArray()[0];
  const at = Math.max(0, Math.floor(offset));
  const mathBase = `SELECT (SELECT source_currency FROM import_batches b WHERE b.source_id=s.source_id LIMIT 1) AS source_currency,(SELECT workspace_currency FROM import_batches b WHERE b.source_id=s.source_id LIMIT 1) AS workspace_currency,(SELECT fx_rate FROM import_batches b WHERE b.source_id=s.source_id LIMIT 1) AS fx_rate,(SELECT header_fx FROM import_batches b WHERE b.source_id=s.source_id LIMIT 1) AS header_fx, f.name AS file, s.source_id, s.source_row::VARCHAR AS source_row, s.line_id::VARCHAR AS line_id, coalesce(s.invoice_id,'') AS invoice, s.sale_date::VARCHAR AS d, s.product_id, s.customer_id, s.line_kind, s.quantity::VARCHAR AS q,
 (SELECT raw.rebate_cents::VARCHAR FROM sales_lines raw WHERE raw.source_id=s.source_id AND raw.line_id=s.line_id) AS recorded_rebate,s.list_cents::VARCHAR AS list, s.discount_cents::VARCHAR AS discount, s.rebate_cents::VARCHAR AS rebate, s.freight_cents::VARCHAR AS freight, s.cost_cents::VARCHAR AS cost, ${POCKET.replaceAll("list_cents", "s.list_cents").replaceAll("discount_cents", "s.discount_cents").replaceAll("rebate_cents", "s.rebate_cents").replaceAll("freight_cents", "s.freight_cents")}::VARCHAR AS pocket,
 (CASE WHEN s.cost_cents IS NULL THEN NULL ELSE s.list_cents - s.discount_cents - s.rebate_cents - s.freight_cents - s.cost_cents END)::VARCHAR AS margin, (${spec.expr})::VARCHAR AS contribution, abs(${spec.expr}) AS order_n, s.source_row AS row_n
 ${base.replace(`FROM ${input} s`, `FROM ${input} s JOIN source_files f ON f.id = s.source_id`)}`;
  const paged = await gridPage(engine, mathBase, MATH_ROWS_GRID, gridQuery(MATH_ROWS_GRID, grid), { fallback: "g.order_n DESC, g.source_id, g.row_n", limit: 25, offset: at });
  const rows = paged.rows;
  const label = w.steps.find(x => x.key === metric)?.label ?? (metric === "rate" ? msg("waterfall.pocketMarginRate") : msg("waterfall.lines"));
  const value = shown[metric];
  return { metric, label, value, formula: metric === "rate" ? msg("waterfall.pocketMarginRatePocket") : spec.formula,
    inputs: inputs[metric].map(([l, v]) => ({ label: l, cents: v })), check: { engine: String(computed), agrees: String(computed) === value },
    rowCount: String(agg.n), rowsSum: String(agg.total), rowsAgree: metric === "rate" ? String(agg.total) === w.margin : String(agg.total) === value, offset: at, grid: paged.grid,
    rows: rows.map(r => ({ sourceCurrency:String(r.source_currency ?? "USD"),workspaceCurrency:String(r.workspace_currency ?? "USD"),fxRate:String(r.fx_rate ?? "1"),headerFx:String(r.header_fx ?? "[]"), sourceFile: String(r.file), sourceId: String(r.source_id), sourceRow: String(r.source_row), lineId: String(r.line_id), invoice: String(r.invoice), date: String(r.d), product: String(r.product_id), customer: String(r.customer_id), kind: String(r.line_kind), quantity: String(r.q),
      recordedRebate:String(r.recorded_rebate),list: String(r.list), discount: String(r.discount), rebate: String(r.rebate), freight: String(r.freight), cost: r.cost === null ? null : String(r.cost), pocket: String(r.pocket), margin: r.margin === null ? null : String(r.margin), contribution: String(r.contribution) })) };
}
export { centsText };
