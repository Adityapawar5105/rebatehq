// Leak finder (chunk 4D). Generic, documented rules over the vault's sales lines; nothing
// here knows about the Playground. Each finding has a type, a scope, a dollar amount and
// evidence rows (source file + row). Credit lines are never leaks. Unknown cost is never
// treated as zero: lines without cost are left out of the margin rules and counted.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { atRateSql, discountBpSql, POCKET, MARGIN } from "./sql";
import { bpText, rha } from "./decimal";
import { lineFromCents } from "./engine";

export type LeakType = "below_floor" | "discount_outlier" | "unrecovered_freight" | "negative_margin" | "below_lower_tier" | "below_cost";
export const LEAK_LABELS: Record<LeakType, string> = { below_floor: "Below tier floor", discount_outlier: "Discount outlier vs tier peers", unrecovered_freight: "Unrecovered freight",
  negative_margin: "Negative margin", below_lower_tier: "Billed at a better tier", below_cost: "Price below cost" };
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
export async function findLeaks(engine: Engine): Promise<LeakResult> {
  const t0 = performance.now(), R = RULES;
  await engine.conn.query(`DROP TABLE IF EXISTS temp.lf_lines; DROP TABLE IF EXISTS temp.lf_tiers; DROP TABLE IF EXISTS temp.lf_excess; DROP TABLE IF EXISTS temp.lf_hits; DROP TABLE IF EXISTS temp.lf_shift;
CREATE TEMP TABLE lf_lines AS SELECT s.source_id, s.line_id, s.product_id, s.customer_id, s.sale_date, c.tier, p.category, s.list_cents, s.discount_cents, s.rebate_cents, s.freight_cents, s.cost_cents,
 ${POCKET} AS pocket, ${MARGIN} AS margin, ${discountBpSql()} AS rate_bp
FROM sales_lines s JOIN customers c USING (customer_id) JOIN products p USING (product_id) WHERE s.line_kind = 'sale' AND s.list_cents > 0;
CREATE TEMP TABLE lf_tiers AS WITH t AS (SELECT tier, count(*) AS n, count(DISTINCT customer_id) AS nc FROM lf_lines WHERE tier <> '' GROUP BY tier),
 m AS (SELECT tier, rate_bp, count(*) AS k FROM lf_lines WHERE tier <> '' AND list_cents >= ${R.modeMinListCents} GROUP BY tier, rate_bp),
 r AS (SELECT tier, rate_bp, k, row_number() OVER (PARTITION BY tier ORDER BY k DESC, rate_bp) AS rk, sum(k) OVER (PARTITION BY tier) AS mk FROM m)
SELECT t.tier, r.rate_bp AS tier_bp FROM t JOIN r ON r.tier = t.tier AND r.rk = 1 WHERE t.nc >= ${R.minTierCustomers} AND t.n >= ${R.minTierLines} AND r.k * 100 >= r.mk * ${Math.round(R.modeShare * 100)};
CREATE TEMP TABLE lf_excess AS SELECT l.*, t.tier_bp, l.discount_cents - ${atRateSql("l.list_cents", "t.tier_bp")} AS excess,
 (l.discount_cents - ${atRateSql("l.list_cents", "t.tier_bp")} > 0 AND l.rate_bp - t.tier_bp >= ${R.excessBp}) AS flag FROM lf_lines l JOIN lf_tiers t USING (tier);
CREATE TEMP TABLE lf_hits(finding VARCHAR, type VARCHAR, source_id VARCHAR, line_id BIGINT, leak HUGEINT, basis_bp HUGEINT);
CREATE TEMP TABLE lf_shift AS WITH c AS (SELECT customer_id, any_value(tier) AS tier, any_value(tier_bp) AS tier_bp, count(*) AS n, count(*) FILTER (WHERE flag) AS nf FROM lf_excess GROUP BY customer_id),
 md AS (SELECT customer_id, rate_bp, row_number() OVER (PARTITION BY customer_id ORDER BY count(*) DESC, rate_bp) AS rk FROM lf_excess WHERE list_cents >= ${R.modeMinListCents} GROUP BY customer_id, rate_bp)
SELECT c.customer_id, c.tier, c.tier_bp, md.rate_bp AS modal_bp, (SELECT min(t.tier) FROM lf_tiers t WHERE t.tier_bp = md.rate_bp AND t.tier_bp > c.tier_bp AND t.tier <> c.tier) AS matched
FROM c LEFT JOIN md ON md.customer_id = c.customer_id AND md.rk = 1 WHERE c.n >= ${R.minCustomerLines} AND c.nf * 100 >= c.n * ${Math.round(R.patternShare * 100)};`);
  // 1. Whole-customer discount shifts: billed at a better tier's schedule, or a discount outlier.
  await engine.conn.query(`INSERT INTO lf_hits SELECT CASE WHEN s.matched IS NOT NULL THEN 'below_lower_tier|' || e.customer_id || '|' || s.matched ELSE 'discount_outlier|' || e.customer_id END,
 CASE WHEN s.matched IS NOT NULL THEN 'below_lower_tier' ELSE 'discount_outlier' END, e.source_id, e.line_id, e.excess, e.tier_bp FROM lf_excess e JOIN lf_shift s USING (customer_id) WHERE e.flag;
INSERT INTO lf_hits SELECT 'below_floor|' || e.customer_id || '|' || e.category, 'below_floor', e.source_id, e.line_id, e.excess, e.tier_bp FROM lf_excess e
 JOIN (SELECT customer_id, category FROM lf_excess WHERE customer_id NOT IN (SELECT customer_id FROM lf_shift) GROUP BY customer_id, category HAVING count(*) >= ${R.minPatternLines} AND count(*) FILTER (WHERE flag) * 100 >= count(*) * ${Math.round(R.patternShare * 100)}) g USING (customer_id, category) WHERE e.flag;
INSERT INTO lf_hits SELECT 'discount_outlier|' || e.customer_id || '|lines', 'discount_outlier', e.source_id, e.line_id, e.excess, e.tier_bp FROM lf_excess e
 WHERE e.flag AND e.rate_bp - e.tier_bp >= ${R.scatteredBp} AND NOT EXISTS (SELECT 1 FROM lf_hits h WHERE h.source_id = e.source_id AND h.line_id = e.line_id);
INSERT INTO lf_hits SELECT 'unrecovered_freight|small_lines', 'unrecovered_freight', source_id, line_id, freight_cents, NULL FROM lf_lines WHERE CAST(freight_cents AS HUGEINT) * 10000 > CAST(list_cents AS HUGEINT) * ${R.freightShareBp};
CREATE OR REPLACE TEMP TABLE lf_rise AS WITH v AS (SELECT product_id, vendor, effective_date, cost, lag(cost) OVER (PARTITION BY product_id, vendor ORDER BY effective_date, id) AS prev FROM vendor_costs)
 SELECT product_id, min(effective_date) AS since FROM v WHERE prev IS NOT NULL AND cost > prev GROUP BY product_id;
INSERT INTO lf_hits SELECT 'negative_margin|cost_rise', 'negative_margin', l.source_id, l.line_id, -l.margin, NULL FROM lf_lines l JOIN lf_rise r USING (product_id) WHERE l.margin < 0 AND l.sale_date >= r.since;
CREATE OR REPLACE TEMP TABLE lf_loss AS SELECT source_id, line_id FROM lf_hits WHERE finding = 'negative_margin|cost_rise';
INSERT INTO lf_hits SELECT 'below_cost|all', 'below_cost', l.source_id, l.line_id, -l.margin, NULL FROM lf_lines l WHERE l.margin < 0 AND l.list_cents - l.discount_cents < l.cost_cents AND NOT EXISTS (SELECT 1 FROM lf_loss x WHERE x.source_id = l.source_id AND x.line_id = l.line_id);
INSERT INTO lf_hits SELECT 'negative_margin|other', 'negative_margin', l.source_id, l.line_id, -l.margin, NULL FROM lf_lines l WHERE l.margin < 0 AND l.list_cents - l.discount_cents >= l.cost_cents AND NOT EXISTS (SELECT 1 FROM lf_loss x WHERE x.source_id = l.source_id AND x.line_id = l.line_id);`);
  const groups = await q(engine, `SELECT h.finding, h.type, count(*)::VARCHAR AS n, sum(h.leak)::VARCHAR AS cents, count(DISTINCT l.product_id)::VARCHAR AS products, count(DISTINCT l.customer_id)::VARCHAR AS customers, any_value(h.basis_bp)::VARCHAR AS basis,
 min(l.sale_date)::VARCHAR AS first, max(l.sale_date)::VARCHAR AS last FROM lf_hits h JOIN lf_lines l USING (source_id, line_id) GROUP BY h.finding, h.type ORDER BY sum(h.leak) DESC, h.finding`);
  const shift = new Map((await q(engine, "SELECT customer_id, tier, tier_bp::VARCHAR AS tier_bp, modal_bp::VARCHAR AS modal_bp, matched FROM lf_shift")).map(r => [S(r.customer_id), r]));
  const tiers = new Map((await q(engine, "SELECT tier, tier_bp::VARCHAR AS bp FROM lf_tiers")).map(r => [S(r.tier), S(r.bp)]));
  const rise = await q(engine, "SELECT min(since)::VARCHAR AS a, max(since)::VARCHAR AS b, count(*)::VARCHAR AS n FROM lf_rise");
  const findings = groups.map(g => describe(S(g.finding), g, shift, tiers, rise[0]));
  const tot = (await q(engine, `SELECT coalesce(sum(leak),0)::VARCHAR AS total FROM lf_hits`))[0];
  const ov = (await q(engine, `SELECT coalesce(sum(t - mx),0)::VARCHAR AS c, count(*)::VARCHAR AS n FROM (SELECT sum(leak) AS t, max(leak) AS mx FROM lf_hits GROUP BY source_id, line_id HAVING count(*) > 1)`))[0];
  const checked = (await q(engine, `SELECT (SELECT count(*) FROM sales_lines WHERE line_kind='sale')::VARCHAR AS sale, (SELECT count(*) FROM sales_lines WHERE line_kind='credit')::VARCHAR AS credit,
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
    case "below_lower_tier": { const s = shift.get(a)!;
      return { ...base, scope: { customer: a, tier: S(s.tier), billedAs: b! }, title: `${a} (tier ${S(s.tier)}) is billed at tier ${b}'s discount`,
        formula: `Leak per line = discount - list x ${S(s.tier)} peer rate (${bp(s.tier_bp)}), rounded to the cent.`, detail: `${base.lines} lines, ${bp(s.modal_bp)} typical discount = tier ${b}'s peer rate (${bp(tiers.get(b!))}).` }; }
    case "discount_outlier": { const s = shift.get(a), tier = S(s?.tier), lines = b === "lines";
      return { ...base, scope: { customer: a, ...(lines ? { pattern: "scattered lines" } : {}) }, title: lines ? `${a}: lines discounted far above tier peers` : `${a} is discounted far above its tier's peers`,
        formula: `Leak per line = discount - list x the tier's peer rate${s ? ` (${tier}: ${bp(s.tier_bp)})` : ""}, rounded to the cent.`, detail: s ? `Typical discount ${bp(s.modal_bp)}, which matches no better tier's rate.` : `Lines at least ${RULES.scatteredBp / 100} points above the tier's peer rate.` }; }
    case "below_floor":
      return { ...base, scope: { customer: a, category: b! }, title: `${a}: ${b} lines priced below the tier floor`, formula: `Leak per line = discount - list x the tier floor rate (${bp(g.basis)}), rounded to the cent.`,
        detail: `Until price guardrails are set (Pricing), a tier's floor is its peer rate. ${base.lines} ${b} lines are over-discounted while the customer's other categories are not.` };
    case "unrecovered_freight":
      return { ...base, scope: { rule: `freight > ${RULES.freightShareBp / 100}% of list` }, title: "Freight not billed back on small lines", formula: `Leak per line = freight, on lines where freight is more than ${RULES.freightShareBp / 100}% of list.`,
        detail: `${S(g.customers)} customers, ${S(g.products)} products.` };
    case "below_cost":
      return { ...base, scope: { rule: "net price below cost" }, title: "Lines priced below cost", formula: "Leak per line = cost - pocket, where net price (list - discount) is below cost.", detail: `${S(g.products)} products, ${S(g.customers)} customers. Lines with unknown cost are not checked.` };
    case "negative_margin":
      return a === "cost_rise"
        ? { ...base, scope: { rule: "vendor cost rise not passed on" }, title: `Vendor cost rises not passed on (${S(g.products)} products)`, formula: "Leak per line = cost - pocket, on lines sold at a loss on or after the product's vendor cost increase.",
            detail: `Vendor cost files show increases on ${S(rise.n)} products effective ${S(rise.a)}${S(rise.a) !== S(rise.b) ? ` to ${S(rise.b)}` : ""}. Lines with unknown cost are not checked.` }
        : { ...base, scope: { rule: "other loss-making lines" }, title: "Other lines sold at a loss", formula: "Leak per line = cost - pocket, where pocket (list - discount - rebate - freight) is below cost.", detail: `${S(g.products)} products, ${S(g.customers)} customers.` };
  }
}
export type LeakRow = { sourceFile: string; sourceRow: string; lineId: string; invoice: string; date: string; product: string; category: string; customer: string; tier: string;
  list: string; discount: string; rebate: string; freight: string; cost: string | null; pocket: string; margin: string | null; rate: string; basis: string; leak: string; engineLeak: string };
/** Evidence rows for one finding (largest first), with the leak recomputed by the JS engine for each row. */
export async function leakRows(engine: Engine, id: string, offset = 0, limit = 25): Promise<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean }> {
  const where = `WHERE h.finding = ${sqlText(id)}`;
  const agg = (await q(engine, `SELECT count(*)::VARCHAR AS n, coalesce(sum(leak),0)::VARCHAR AS c FROM lf_hits h ${where}`))[0];
  const rows = await q(engine, `SELECT f.name AS file, s.source_row::VARCHAR AS source_row, s.line_id::VARCHAR AS line_id, coalesce(s.invoice_id,'') AS invoice, s.sale_date::VARCHAR AS d, l.product_id, l.category, l.customer_id, l.tier,
 l.list_cents::VARCHAR AS list, l.discount_cents::VARCHAR AS discount, l.rebate_cents::VARCHAR AS rebate, l.freight_cents::VARCHAR AS freight, l.cost_cents::VARCHAR AS cost, l.pocket::VARCHAR AS pocket, l.margin::VARCHAR AS margin,
 l.rate_bp::VARCHAR AS rate, h.basis_bp::VARCHAR AS basis, h.leak::VARCHAR AS leak, h.type
FROM lf_hits h JOIN lf_lines l USING (source_id, line_id) JOIN sales_lines s ON s.source_id = h.source_id AND s.line_id = h.line_id JOIN source_files f ON f.id = h.source_id ${where}
ORDER BY h.leak DESC, h.source_id, s.source_row LIMIT ${Math.max(1, Math.min(200, limit))} OFFSET ${Math.max(0, Math.floor(offset))}`);
  let agrees = true;
  const out = rows.map(r => {
    const n = (k: string) => BigInt(S(r[k])), type = S(r.type) as LeakType;
    const w = lineFromCents({ list: n("list"), discount: n("discount"), rebate: n("rebate"), freight: n("freight"), cost: r.cost === null ? null : n("cost") });
    const engineLeak = type === "unrecovered_freight" ? n("freight") : ["negative_margin", "below_cost"].includes(type) ? -(w.margin ?? BigInt(0)) : n("discount") - rha(n("list") * n("basis"), BigInt(10000));
    if (String(engineLeak) !== S(r.leak)) agrees = false;
    return { sourceFile: S(r.file), sourceRow: S(r.source_row), lineId: S(r.line_id), invoice: S(r.invoice), date: S(r.d), product: S(r.product_id), category: S(r.category), customer: S(r.customer_id), tier: S(r.tier),
      list: S(r.list), discount: S(r.discount), rebate: S(r.rebate), freight: S(r.freight), cost: r.cost === null ? null : S(r.cost), pocket: S(r.pocket), margin: r.margin === null ? null : S(r.margin),
      rate: bpText(n("rate")), basis: r.basis === null ? "" : bpText(n("basis")), leak: S(r.leak), engineLeak: String(engineLeak) };
  });
  return { rows: out, count: S(agg.n), sum: S(agg.c), engineAgrees: agrees };
}
/** All hits of one finding, for tests: (source_id, line_id, leak). */
export async function hitRows(engine: Engine, id: string) {
  return (await q(engine, `SELECT h.source_id, h.line_id::VARCHAR AS line_id, h.leak::VARCHAR AS leak, h.basis_bp::VARCHAR AS basis, h.type, l.list_cents::VARCHAR AS list, l.discount_cents::VARCHAR AS discount, l.rebate_cents::VARCHAR AS rebate, l.freight_cents::VARCHAR AS freight, l.cost_cents::VARCHAR AS cost
FROM lf_hits h JOIN lf_lines l USING (source_id, line_id) WHERE h.finding = ${sqlText(id)}`));
}
