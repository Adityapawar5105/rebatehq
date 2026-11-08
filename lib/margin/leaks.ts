import {SERVICE_LEAK_SQL} from './service-cost';
import { rhaSql } from "./sql";
import { dec, rescale } from "./decimal";
// Leak finder (chunk 4D). Generic, documented rules over the vault's sales lines; nothing
// here knows about the Playground. Each finding has a type, a scope, a dollar amount and
// evidence rows (source file + row). Credit lines are never leaks. Unknown cost is never
// treated as zero: lines without cost are left out of the margin rules and counted.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { atRateSql, discountBpSql, POCKET, MARGIN } from "./sql";
import { bpText, rha } from "./decimal";
import { lineFromCents } from "./engine";
import { msg } from "../i18n/core";

export type LeakType = "small_order_loss" | "free_delivery_loss" | "below_floor" | "discount_outlier" | "unrecovered_freight" | "negative_margin" | "below_lower_tier" | "below_cost";
export const LEAK_LABELS: Record<LeakType, string> = { small_order_loss:msg("pc2.smallLoss"),free_delivery_loss:msg("pc2.freeLoss"),below_floor: msg("leak.belowTierFloor"), discount_outlier: msg("leak.discountOutlierVsTier"), unrecovered_freight: msg("leak.unrecoveredFreight"),
  negative_margin: msg("leak.negativeMargin"), below_lower_tier: msg("leak.billedAtABetter"), below_cost: msg("leak.priceBelowCost") };
/** Rule thresholds. Without configured guardrails (chunk 4E) a tier's floor is its peer rate. */
export const RULES = {
  /** A line is over-discounted when it is at least this many basis points above its tier's peer rate. */
  excessBp: 100,
  /** A customer (or customer x category) is a pattern when at least this share of its lines is over-discounted. */
  patternShare: 0.9, minPatternLines: 3, minCustomerLines: 5,
  /** Scattered over-discounted lines are reported when this far above the peer rate. */
  scatteredBp: 500,
  /** A tier's peer rate needs 2+ customers, 20+ lines, and the modal rate on 30%+ of its $100+ lines. */
  minTierCustomers: 2, minTierLines: 20, modeShare: 0.3, modeMinListCents: 10000,
  /** Freight above this share of the line's list is treated as not billed back (small-order freight). */
  freightShareBp: 1000,
} as const;
export type Finding = { id: string; type: LeakType; label: string; title: string; scope: Record<string, string>; lines: string; cents: string; formula: string; detail: string };
export type LeakResult = { findings: Finding[]; totalCents: string; overlapCents: string; overlapLines: string; dedupedCents: string;
  checked: { saleLines: string; creditLines: string; uncostedLines: string; untieredLines: string; tiers: string }; ms: number };
const q = async (engine: Engine, sql: string) => (await engine.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? "" : String(v);
export async function findLeaks(engine: Engine,costToServe=true,window?:{from:string;to:string}): Promise<LeakResult> {
  const t0 = performance.now(), R = RULES;
  // Scope the input, never the rules or final amounts. The default remains the
  // original full-history finder. Service-order rules use the same scoped input.
  await engine.conn.query(`CREATE OR REPLACE TEMP VIEW lf_input AS SELECT * FROM sales_lines ${window?`WHERE sale_date>=DATE ${sqlText(window.from)} AND sale_date<DATE ${sqlText(window.to)}`:''}`);
  // Statement by statement, so an engine failure names the step (SQL text only, never values).
  const run = async (sql: string) => { for (const stmt of sql.replaceAll(/\bsales_lines\b/g,'lf_input').split(/;\s*\n/)) if (stmt.trim()) { try { await engine.conn.query(stmt); } catch { throw new Error(msg('monitor.finderFailed')); } } };
  // Memory: lf_lines and lf_excess are views (never materialised) and a hit is five numbers
  // (finding hash, source number, line, leak, basis), so a 2M-line vault fits the 512 MB guardrail.
  await run(`DROP VIEW IF EXISTS temp.lf_excess; DROP VIEW IF EXISTS temp.lf_lines; DROP TABLE IF EXISTS temp.lf_tiers; DROP TABLE IF EXISTS temp.lf_hits; DROP TABLE IF EXISTS temp.lf_keys; DROP TABLE IF EXISTS temp.lf_shift; DROP TABLE IF EXISTS temp.lf_shift0; DROP TABLE IF EXISTS temp.lf_floor; DROP TABLE IF EXISTS temp.lf_scatter; DROP TABLE IF EXISTS temp.lf_src;
CREATE TEMP TABLE lf_src AS SELECT id AS source_id, (row_number() OVER (ORDER BY id))::INTEGER AS sid FROM source_files;
CREATE TEMP VIEW lf_lines AS SELECT x.sid, s.source_id, s.line_id, s.source_row, s.invoice_id, s.product_id, s.customer_id, s.sale_date, s.quantity, c.tier, p.category, s.list_cents, s.discount_cents, s.rebate_cents, s.freight_cents, s.cost_cents,
 ${POCKET} AS pocket, ${MARGIN} AS margin, ${discountBpSql()} AS rate_bp
FROM sales_lines s JOIN lf_src x USING (source_id) JOIN customers c USING (customer_id) JOIN products p USING (product_id) WHERE s.line_kind = 'sale';
CREATE TEMP TABLE lf_tiers AS WITH t AS (SELECT tier, count(*) AS n, count(DISTINCT customer_id) AS nc FROM lf_lines WHERE tier <> '' GROUP BY tier),
 m AS (SELECT tier, rate_bp, count(*) AS k FROM lf_lines WHERE tier <> '' AND list_cents >= ${R.modeMinListCents} GROUP BY tier, rate_bp),
 r AS (SELECT tier, rate_bp, k, row_number() OVER (PARTITION BY tier ORDER BY k DESC, rate_bp) AS rk, sum(k) OVER (PARTITION BY tier) AS mk FROM m)
SELECT t.tier, CAST(r.rate_bp AS INTEGER) AS tier_bp FROM t JOIN r ON r.tier = t.tier AND r.rk = 1 WHERE t.nc >= ${R.minTierCustomers} AND t.n >= ${R.minTierLines} AND r.k * 100 >= r.mk * ${Math.round(R.modeShare * 100)};
CREATE TEMP VIEW lf_excess AS SELECT l.*, t.tier_bp, CAST(l.discount_cents - ${atRateSql("l.list_cents", "t.tier_bp")} AS BIGINT) AS excess,
 (NOT EXISTS(SELECT 1 FROM price_guardrails g WHERE g.tier=l.tier AND g.category=l.category) AND l.discount_cents - ${atRateSql("l.list_cents", "t.tier_bp")} > 0 AND l.rate_bp - t.tier_bp >= ${R.excessBp}) AS flag FROM lf_lines l JOIN lf_tiers t USING (tier);
CREATE TEMP TABLE lf_keys(h UBIGINT, finding VARCHAR, type VARCHAR);
CREATE TEMP TABLE lf_hits(h UBIGINT, sid INTEGER, line_id BIGINT, leak BIGINT, basis_bp INTEGER);
CREATE TEMP TABLE lf_shift0 AS WITH c AS (SELECT customer_id, any_value(tier) AS tier, any_value(tier_bp) AS tier_bp, count(*) AS n, count(*) FILTER (WHERE flag) AS nf FROM lf_excess GROUP BY customer_id),
 md AS (SELECT customer_id, rate_bp, row_number() OVER (PARTITION BY customer_id ORDER BY count(*) DESC, rate_bp) AS rk FROM lf_excess WHERE list_cents >= ${R.modeMinListCents} GROUP BY customer_id, rate_bp)
SELECT c.customer_id, c.tier, c.tier_bp, md.rate_bp AS modal_bp, (SELECT min(t.tier) FROM lf_tiers t WHERE t.tier_bp = md.rate_bp AND t.tier_bp > c.tier_bp AND t.tier <> c.tier) AS matched,
 CASE WHEN (SELECT min(t.tier) FROM lf_tiers t WHERE t.tier_bp = md.rate_bp AND t.tier_bp > c.tier_bp AND t.tier <> c.tier) IS NOT NULL THEN 'below_lower_tier' ELSE 'discount_outlier' END AS type
FROM c LEFT JOIN md ON md.customer_id = c.customer_id AND md.rk = 1 WHERE c.n >= ${R.minCustomerLines} AND c.nf * 100 >= c.n * ${Math.round(R.patternShare * 100)};
CREATE TEMP TABLE lf_shift AS SELECT *, CASE WHEN type = 'below_lower_tier' THEN 'below_lower_tier|' || customer_id || '|' || matched ELSE 'discount_outlier|' || customer_id END AS finding FROM lf_shift0; DROP TABLE lf_shift0;
CREATE TEMP TABLE lf_floor AS SELECT customer_id, category, 'below_floor|' || customer_id || '|' || category AS finding FROM lf_excess WHERE customer_id NOT IN (SELECT customer_id FROM lf_shift)
 GROUP BY customer_id, category HAVING count(*) >= ${R.minPatternLines} AND count(*) FILTER (WHERE flag) * 100 >= count(*) * ${Math.round(R.patternShare * 100)};`);
  // 1. Whole-customer discount shifts (billed at a better tier's schedule, or an outlier), then category patterns below the tier floor.
  await run(`INSERT INTO lf_keys SELECT hash(finding), finding, type FROM lf_shift;
INSERT INTO lf_hits SELECT hash(s.finding), e.sid, e.line_id, e.excess, e.tier_bp FROM lf_excess e JOIN lf_shift s USING (customer_id) WHERE e.flag;
INSERT INTO lf_keys SELECT hash(finding), finding, 'below_floor' FROM lf_floor;
INSERT INTO lf_hits SELECT hash(g.finding), e.sid, e.line_id, e.excess, e.tier_bp FROM lf_excess e JOIN lf_floor g USING (customer_id, category) WHERE e.flag;
CREATE TEMP TABLE lf_scatter AS SELECT 'discount_outlier|' || e.customer_id || '|lines' AS finding, e.sid, e.line_id, e.excess, e.tier_bp FROM lf_excess e
 WHERE e.flag AND e.rate_bp - e.tier_bp >= ${R.scatteredBp} AND NOT EXISTS (SELECT 1 FROM lf_hits h WHERE h.sid = e.sid AND h.line_id = e.line_id);
INSERT INTO lf_keys SELECT DISTINCT hash(finding), finding, 'discount_outlier' FROM lf_scatter;
INSERT INTO lf_hits SELECT hash(finding), sid, line_id, excess, tier_bp FROM lf_scatter; DROP TABLE lf_scatter; DROP TABLE lf_floor;
INSERT INTO lf_keys VALUES (hash('unrecovered_freight|small_lines'), 'unrecovered_freight|small_lines', 'unrecovered_freight'), (hash('negative_margin|cost_rise'), 'negative_margin|cost_rise', 'negative_margin'),
 (hash('below_cost|all'), 'below_cost|all', 'below_cost'), (hash('negative_margin|other'), 'negative_margin|other', 'negative_margin');
INSERT INTO lf_hits SELECT hash('unrecovered_freight|small_lines'), sid, line_id, freight_cents, NULL FROM lf_lines WHERE CAST(freight_cents AS HUGEINT) * 10000 > CAST(list_cents AS HUGEINT) * ${R.freightShareBp};
CREATE OR REPLACE TEMP TABLE lf_rise AS WITH v AS (SELECT product_id, vendor, effective_date, cost, lag(cost) OVER (PARTITION BY product_id, vendor ORDER BY effective_date, id) AS prev FROM vendor_costs)
 SELECT product_id, min(effective_date) AS since FROM v WHERE prev IS NOT NULL AND cost > prev GROUP BY product_id;
INSERT INTO lf_hits SELECT hash('negative_margin|cost_rise'), l.sid, l.line_id, -l.margin, NULL FROM lf_lines l JOIN lf_rise r USING (product_id) WHERE l.margin < 0 AND l.sale_date >= r.since;
CREATE OR REPLACE TEMP TABLE lf_loss AS SELECT sid, line_id FROM lf_hits WHERE h = hash('negative_margin|cost_rise');
INSERT INTO lf_hits SELECT CASE WHEN l.list_cents - l.discount_cents < l.cost_cents THEN hash('below_cost|all') ELSE hash('negative_margin|other') END, l.sid, l.line_id, -l.margin, NULL
 FROM lf_lines l WHERE l.margin < 0 AND NOT EXISTS (SELECT 1 FROM lf_loss x WHERE x.sid = l.sid AND x.line_id = l.line_id);
CREATE OR REPLACE TEMP VIEW lf_guard AS SELECT l.sid,l.line_id,'below_floor|'||l.customer_id||'|'||l.category AS finding,CAST(${rhaSql('CAST(g.floor AS HUGEINT)*CAST(l.quantity*10000 AS HUGEINT)','10000')}-(l.list_cents-l.discount_cents) AS BIGINT) AS leak FROM lf_lines l JOIN price_guardrails g ON g.tier=l.tier AND g.category=l.category;
INSERT INTO lf_keys SELECT DISTINCT hash(finding),finding,'below_floor' FROM lf_guard WHERE leak>0 AND finding NOT IN(SELECT finding FROM lf_keys);
INSERT INTO lf_hits SELECT hash(finding),sid,line_id,leak,NULL FROM lf_guard WHERE leak>0;
`);
  if(costToServe)await run(SERVICE_LEAK_SQL);
  else await run("DROP TABLE IF EXISTS temp.lf_service_alloc;CREATE TEMP TABLE lf_service_alloc(sid INTEGER,line_id BIGINT,loss BIGINT,weight BIGINT,total HUGEINT,cumulative HUGEINT)");
  await run("DELETE FROM lf_keys WHERE h NOT IN (SELECT DISTINCT h FROM lf_hits)");
  const keys = (await q(engine, "SELECT count(*) AS n, count(DISTINCT h) AS d FROM lf_keys"))[0];
  if (String(keys.n) !== String(keys.d)) throw new Error(msg("leak.leakFindingKeysCollided"));
  // Narrow join on sales_lines (product and customer only), so the hash table is built on the hits.
  const groups = await q(engine, `WITH g AS (SELECT h, count(*)::VARCHAR AS n, sum(leak)::VARCHAR AS cents, sum(leak) AS c, any_value(basis_bp)::VARCHAR AS basis FROM lf_hits GROUP BY h),
 pc AS (SELECT h.h, count(DISTINCT s.product_id)::VARCHAR AS products, count(DISTINCT s.customer_id)::VARCHAR AS customers FROM lf_hits h JOIN lf_src x ON x.sid = h.sid JOIN sales_lines s ON s.source_id = x.source_id AND s.line_id = h.line_id GROUP BY h.h)
SELECT k.finding, k.type, g.n, g.cents, g.basis, pc.products, pc.customers FROM lf_keys k JOIN g ON g.h = k.h JOIN pc ON pc.h = k.h ORDER BY g.c DESC, k.finding`);
  const shift = new Map((await q(engine, "SELECT customer_id, tier, tier_bp::VARCHAR AS tier_bp, modal_bp::VARCHAR AS modal_bp, matched FROM lf_shift")).map(r => [S(r.customer_id), r]));
  const tiers = new Map((await q(engine, "SELECT tier, tier_bp::VARCHAR AS bp FROM lf_tiers")).map(r => [S(r.tier), S(r.bp)]));
  const rise = await q(engine, "SELECT min(since)::VARCHAR AS a, max(since)::VARCHAR AS b, count(*)::VARCHAR AS n FROM lf_rise");
  const findings = groups.map(g => describe(S(g.finding), g, shift, tiers, rise[0]));
  const tot = (await q(engine, `SELECT coalesce(sum(leak),0)::VARCHAR AS total FROM lf_hits`))[0];
  const ov = (await q(engine, `SELECT coalesce(sum(t - mx),0)::VARCHAR AS c, count(*)::VARCHAR AS n FROM (SELECT sum(leak) AS t, max(leak) AS mx FROM lf_hits GROUP BY sid, line_id HAVING count(*) > 1)`))[0];
  const checked = (await q(engine, `SELECT (SELECT count(*) FROM lf_input WHERE line_kind='sale')::VARCHAR AS sale, (SELECT count(*) FROM lf_input WHERE line_kind='credit')::VARCHAR AS credit,
 (SELECT count(*) FROM lf_lines WHERE cost_cents IS NULL)::VARCHAR AS uncosted, (SELECT count(*) FROM lf_lines WHERE tier NOT IN (SELECT tier FROM lf_tiers))::VARCHAR AS untiered, (SELECT count(*) FROM lf_tiers)::VARCHAR AS tiers`))[0];
  const total = BigInt(S(tot.total)), overlap = BigInt(S(ov.c));
  return { findings, totalCents: String(total), overlapCents: String(overlap), overlapLines: S(ov.n), dedupedCents: String(total - overlap),
    checked: { saleLines: S(checked.sale), creditLines: S(checked.credit), uncostedLines: S(checked.uncosted), untieredLines: S(checked.untiered), tiers: S(checked.tiers) }, ms: Math.round(performance.now() - t0) };
}
function describe(id: string, g: Record<string, unknown>, shift: Map<string, Record<string, unknown>>, tiers: Map<string, string>, rise: Record<string, unknown>): Finding {
  const [type, a, b] = id.split("|") as [LeakType, string, string | undefined];
  const base = { id, type, label: LEAK_LABELS[type], lines: S(g.n), cents: S(g.cents) };
  const bp = (v: unknown) => bpText(BigInt(S(v) || "0"));
  switch (type) {
    case "small_order_loss":case "free_delivery_loss":return {...base,scope:{rule:type},title:base.label,formula:msg("pc2.serviceFormula"),detail:msg("pc2.serviceDetail")};
    case "below_lower_tier": { const s = shift.get(a)!;
      return { ...base, scope: { customer: a, tier: S(s.tier), billedAs: b! }, title: msg("leak.tierIsBilledAt", { a, tier: S(s.tier), b }),
        formula: msg("leak.leakPerLineDiscount3", { tier: S(s.tier), tierbp: bp(s.tier_bp) }), detail: msg("leak.linesTypicalDiscountTier", { lines: base.lines, modalbp: bp(s.modal_bp), b, value: bp(tiers.get(b!)) }) }; }
    case "discount_outlier": { const s = shift.get(a), tier = S(s?.tier), lines = b === "lines";
      return { ...base, scope: { customer: a, ...(lines ? { pattern: "scattered lines" } : {}) }, title: lines ? msg("leak.linesDiscountedFarAbove", { a }) : msg("leak.isDiscountedFarAbove", { a }),
        formula: (s ? msg("leak.leakPerLineTierRate", { tier, rate: bp(s.tier_bp) }) : msg("leak.leakPerLineDiscount2", {})), detail: s ? msg("leak.typicalDiscountWhichMatches", { modalbp: bp(s.modal_bp) }) : msg("leak.linesAtLeastPoints", { value: RULES.scatteredBp / 100 }) }; }
    case "below_floor":
      return { ...base, scope: { customer: a, category: b! }, title: msg("leak.linesPricedBelowThe", { a, b }), formula: g.basis === null ? msg("leak.leakPerLineMax") : msg("leak.leakPerLineDiscount", { basis: bp(g.basis) }),
        detail: msg("leak.configuredUnitFloorsTake", { lines: base.lines, b }) };
    case "unrecovered_freight":
      return { ...base, scope: { rule: `freight > ${RULES.freightShareBp / 100}% of list` }, title: msg("leak.freightNotBilledBack"), formula: msg("leak.leakPerLineFreight", { value: RULES.freightShareBp / 100 }),
        detail: msg("leak.customersProducts", { customers: S(g.customers), products: S(g.products) }) };
    case "below_cost":
      return { ...base, scope: { rule: "net price below cost" }, title: msg("leak.linesPricedBelowCost"), formula: msg("leak.leakPerLineCost3"), detail: msg("leak.productsCustomersLinesWith", { products: S(g.products), customers: S(g.customers) }) };
    case "negative_margin":
      return a === "cost_rise"
        ? { ...base, scope: { rule: "vendor cost rise not passed on" }, title: msg("leak.vendorCostRisesNot", { products: S(g.products) }), formula: msg("leak.leakPerLineCost2"),
            detail: msg(S(rise.a) !== S(rise.b) ? "leak.vendorCostFilesShowRange" : "leak.vendorCostFilesShow", { n: S(rise.n), a: S(rise.a), b: S(rise.b) }) }
        : { ...base, scope: { rule: "other loss-making lines" }, title: msg("leak.otherLinesSoldAt"), formula: msg("leak.leakPerLineCost"), detail: msg("leak.productsCustomers", { products: S(g.products), customers: S(g.customers) }) };
  }
}
export type LeakRow = { sourceFile: string; sourceRow: string; lineId: string; invoice: string; date: string; product: string; category: string; customer: string; tier: string;
  list: string; discount: string; rebate: string; freight: string; cost: string | null; pocket: string; margin: string | null; rate: string; basis: string; leak: string; engineLeak: string };
/** Evidence rows for one finding (largest first), with the leak recomputed by the JS engine for each row. */
/** Evidence rows for one finding (largest first), with the leak recomputed by the JS engine for each row. */
export async function leakRows(engine: Engine, id: string, offset = 0, limit = 25): Promise<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean }> {
  const where = `WHERE h.h = hash(${sqlText(id)})`;
  const agg = (await q(engine, `SELECT count(*)::VARCHAR AS n, coalesce(sum(leak),0)::VARCHAR AS c FROM lf_hits h ${where}`))[0];
  const page = `(SELECT * FROM lf_hits h ${where} ORDER BY h.leak DESC, h.sid, h.line_id LIMIT ${Math.max(1, Math.min(200, limit))} OFFSET ${Math.max(0, Math.floor(offset))})`;
  const rows = await q(engine, `SELECT f.name AS file, l.source_row::VARCHAR AS source_row, l.line_id::VARCHAR AS line_id, coalesce(l.invoice_id,'') AS invoice, l.sale_date::VARCHAR AS d, l.product_id, l.category, l.customer_id, l.tier,
 l.list_cents::VARCHAR AS list, l.discount_cents::VARCHAR AS discount, l.rebate_cents::VARCHAR AS rebate, l.freight_cents::VARCHAR AS freight, l.cost_cents::VARCHAR AS cost, l.pocket::VARCHAR AS pocket, l.margin::VARCHAR AS margin,
 l.quantity::VARCHAR AS quantity, g.floor::VARCHAR AS configured_floor, l.rate_bp::VARCHAR AS rate, p.basis_bp::VARCHAR AS basis, p.leak::VARCHAR AS leak, k.type,a.loss::VARCHAR service_loss,a.weight::VARCHAR service_weight,a.total::VARCHAR service_total,a.cumulative::VARCHAR service_cumulative
FROM ${page} p JOIN lf_keys k ON k.h = p.h JOIN lf_lines l ON l.sid = p.sid AND l.line_id = p.line_id JOIN source_files f ON f.id = l.source_id LEFT JOIN price_guardrails g ON g.tier=l.tier AND g.category=l.category LEFT JOIN lf_service_alloc a ON a.sid=l.sid AND a.line_id=l.line_id
ORDER BY p.leak DESC, p.sid, p.line_id`);
  let agrees = true;
  const out = rows.map(r => {
    const n = (k: string) => BigInt(S(r[k])), type = S(r.type) as LeakType;
    const w = lineFromCents({ list: n("list"), discount: n("discount"), rebate: n("rebate"), freight: n("freight"), cost: r.cost === null ? null : n("cost") });
    const engineLeak = ['small_order_loss','free_delivery_loss'].includes(type) ? n('service_loss')*n('service_cumulative')/n('service_total')-n('service_loss')*(n('service_cumulative')-n('service_weight'))/n('service_total') : type === 'below_floor' && r.configured_floor !== null ? rha(BigInt(S(r.configured_floor))*rescale(dec(S(r.quantity)),4).v,BigInt(10000))-(n('list')-n('discount')) : type === "unrecovered_freight" ? n("freight") : ["negative_margin", "below_cost"].includes(type) ? -(w.margin ?? BigInt(0)) : n("discount") - rha(n("list") * n("basis"), BigInt(10000));
    if (String(engineLeak) !== S(r.leak)) agrees = false;
    return { sourceFile: S(r.file), sourceRow: S(r.source_row), lineId: S(r.line_id), invoice: S(r.invoice), date: S(r.d), product: S(r.product_id), category: S(r.category), customer: S(r.customer_id), tier: S(r.tier),
      list: S(r.list), discount: S(r.discount), rebate: S(r.rebate), freight: S(r.freight), cost: r.cost === null ? null : S(r.cost), pocket: S(r.pocket), margin: r.margin === null ? null : S(r.margin),
      rate: r.rate===null?msg("common.unknown"):bpText(n("rate")), basis: r.basis === null ? "" : bpText(n("basis")), leak: S(r.leak), engineLeak: String(engineLeak) };
  });
  return { rows: out, count: S(agg.n), sum: S(agg.c), engineAgrees: agrees };
}
/** All hits of one finding, for tests: source, line, leak and the line's amounts. */
export async function hitRows(engine: Engine, id: string) {
  return (await q(engine, `SELECT l.source_id, h.line_id::VARCHAR AS line_id, h.leak::VARCHAR AS leak, h.basis_bp::VARCHAR AS basis, k.type, l.list_cents::VARCHAR AS list, l.discount_cents::VARCHAR AS discount, l.rebate_cents::VARCHAR AS rebate, l.freight_cents::VARCHAR AS freight, l.cost_cents::VARCHAR AS cost
FROM lf_hits h JOIN lf_keys k ON k.h = h.h JOIN lf_lines l ON l.sid = h.sid AND l.line_id = h.line_id WHERE h.h = hash(${sqlText(id)})`));
}
/** Every hit with its line kind, for tests (credits must never appear). */
export async function hitKinds(engine: Engine) {
  return (await q(engine, `SELECT s.line_kind, count(*)::VARCHAR AS n FROM lf_hits h JOIN lf_src x ON x.sid = h.sid JOIN sales_lines s ON s.source_id = x.source_id AND s.line_id = h.line_id GROUP BY s.line_kind`));
}
