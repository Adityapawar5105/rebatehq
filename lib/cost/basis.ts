// Cost basis selector: the same sales margin under four costs, side by side, per product
// group (category). "Invoice" is the cost that came with the invoice lines (what the waterfall
// uses). The others price every sold unit at ONE per-product unit cost:
//   last         = the most recent dated vendor cost (ties: latest cost row id)
//   average      = the mean of the product's dated vendor costs (equal weight per cost row)
//   replacement  = the item master's current cost, else the last vendor cost
// A product with no cost under a basis is "unknown" for that basis: its lines are left out of
// that basis' margin and counted, never costed at zero. Costs stay exact: each pre-aggregated
// customer x product x month row is costed as round_half_away(unit_cost x quantity) in HUGEINT.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { rateBp, bpText } from "../margin/decimal";
import { rhaSql } from "../margin/sql";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
export const BASES = ["last", "average", "replacement"] as const;
export type BasisId = typeof BASES[number];
export const BASIS_LABEL: Record<BasisId | "invoice", string> = { invoice: msg("basis.lib.invoiceCost"), last: msg("basis.lib.lastCost"), average: msg("basis.lib.averageCost"), replacement: msg("basis.lib.replacementCost") };
export const NO_CATEGORY = "(No category)";
export type BasisCols = { pocket: string; cost: string; margin: string; rate: string; uncostedLines: string };
export type BasisGroup = { group: string; lines: string; invoice: BasisCols; last: BasisCols; average: BasisCols; replacement: BasisCols; selected: BasisId | null; selectedMargin: string; selectedRate: string };
export type CostBasisView = { groups: BasisGroup[]; total: Omit<BasisGroup, "group" | "selected">; truncated: boolean; formula: string; ms: number };
const MAX_GROUPS = 200, Z = BigInt(0), big = (v: unknown) => BigInt(String(v ?? "0"));
const POCKET_ROW = "(a.list_cents - a.discount_cents - a.rebate_cents - a.freight_cents)";
const unit = (k: string) => rhaSql(`CAST(c_${k}.num AS HUGEINT) * CAST(a.quantity * 10000 AS HUGEINT)`, `CAST(c_${k}.den AS HUGEINT) * 10000`);
const sums = (k: string) => `coalesce(sum(CASE WHEN c_${k}.num IS NOT NULL THEN ${POCKET_ROW} END), 0)::VARCHAR AS ${k}_pocket, coalesce(sum(CASE WHEN c_${k}.num IS NOT NULL THEN ${unit(k)} END), 0)::VARCHAR AS ${k}_cost, coalesce(sum(CASE WHEN c_${k}.num IS NULL THEN a.lines END), 0)::VARCHAR AS ${k}_unknown`;
function cols(r: Record<string, unknown>, k: string): BasisCols {
  const pocket = big(r[`${k}_pocket`]), cost = big(r[`${k}_cost`]), margin = pocket - cost;
  return { pocket: String(pocket), cost: String(cost), margin: String(margin), rate: bpText(rateBp(margin, pocket)), uncostedLines: String(r[`${k}_unknown`]) };
}
export const FORMULA = msg("basis.lib.marginUnderABasis");
/** Per-product unit costs as a fraction num/den (exact), one CTE per basis. */
const BASES_SQL = `WITH v AS (SELECT product_id, cost, row_number() OVER (PARTITION BY product_id ORDER BY effective_date DESC, id DESC) AS rk FROM vendor_costs),
c_last AS (SELECT product_id, CAST(cost AS HUGEINT) AS num, CAST(1 AS HUGEINT) AS den FROM v WHERE rk = 1),
c_average AS (SELECT product_id, CAST(sum(cost) AS HUGEINT) AS num, CAST(count(*) AS HUGEINT) AS den FROM vendor_costs GROUP BY product_id),
c_replacement AS (SELECT p.product_id, CAST(coalesce(p.current_cost, l.num) AS HUGEINT) AS num, CAST(1 AS HUGEINT) AS den FROM products p LEFT JOIN c_last l USING (product_id) WHERE coalesce(p.current_cost, l.num) IS NOT NULL)`;
export async function costBasis(engine: Engine): Promise<CostBasisView> {
  const t0 = performance.now();
  const rows = (await engine.conn.query(`${BASES_SQL}
SELECT coalesce(nullif(p.category, ''), ${sqlText(NO_CATEGORY)}) AS grp, sum(a.lines)::VARCHAR AS lines,
 coalesce(sum(a.costed_pocket_cents), 0)::VARCHAR AS invoice_pocket, coalesce(sum(a.cost_cents), 0)::VARCHAR AS invoice_cost, sum(a.lines - a.costed_lines)::VARCHAR AS invoice_unknown,
 ${sums("last")}, ${sums("average")}, ${sums("replacement")},
 s.basis AS selected, count(*) OVER ()::VARCHAR AS groups
FROM agg_cpm a JOIN products p ON p.product_id = a.product_id
 LEFT JOIN c_last ON c_last.product_id = a.product_id LEFT JOIN c_average ON c_average.product_id = a.product_id LEFT JOIN c_replacement ON c_replacement.product_id = a.product_id
 LEFT JOIN cost_basis_settings s ON s.product_group = coalesce(p.category, '')
GROUP BY coalesce(nullif(p.category, ''), ${sqlText(NO_CATEGORY)}), s.basis ORDER BY sum(${POCKET_ROW}) DESC, 1 LIMIT ${MAX_GROUPS}`)).toArray();
  const groups: BasisGroup[] = rows.map(r => {
    const invoice = cols(r, "invoice"), last = cols(r, "last"), average = cols(r, "average"), replacement = cols(r, "replacement");
    const selected = BASES.includes(r.selected as BasisId) ? r.selected as BasisId : null, pick = selected ? { last, average, replacement }[selected] : invoice;
    return { group: String(r.grp), lines: String(r.lines), invoice, last, average, replacement, selected, selectedMargin: pick.margin, selectedRate: pick.rate };
  });
  const sum = (f: (g: BasisGroup) => BasisCols): BasisCols => { const pocket = groups.reduce((s, g) => s + big(f(g).pocket), Z), cost = groups.reduce((s, g) => s + big(f(g).cost), Z); return { pocket: String(pocket), cost: String(cost), margin: String(pocket - cost), rate: bpText(rateBp(pocket - cost, pocket)), uncostedLines: String(groups.reduce((s, g) => s + big(f(g).uncostedLines), Z)) }; };
  const selectedMargin = groups.reduce((s, g) => s + big(g.selectedMargin), Z), selectedPocket = groups.reduce((s, g) => s + big((g.selected ? g[g.selected] : g.invoice).pocket), Z);
  return { groups, truncated: rows.length > 0 && Number(rows[0].groups) > MAX_GROUPS, formula: FORMULA, ms: Math.round((performance.now() - t0) * 10) / 10,
    total: { lines: String(groups.reduce((s, g) => s + big(g.lines), Z)), invoice: sum(g => g.invoice), last: sum(g => g.last), average: sum(g => g.average), replacement: sum(g => g.replacement), selectedMargin: String(selectedMargin), selectedRate: bpText(rateBp(selectedMargin, selectedPocket)) } };
}
/** SQL that records the basis chosen for a product group (the "(No category)" label stands for an empty category). */
export function basisSql(group: string, basis: BasisId | null) {
  if (typeof group !== "string" || !group.trim() || group.length > 160 || /[\x00-\x1f]/.test(group)) throw new VaultError("COST_BASIS", msg("basis.lib.chooseAProductGroup"));
  if (basis !== null && !BASES.includes(basis)) throw new VaultError("COST_BASIS", msg("basis.lib.chooseLastAverageOr"));
  const key = group === NO_CATEGORY ? "" : group;
  return `DELETE FROM cost_basis_settings WHERE product_group=${sqlText(key)};${basis ? ` INSERT INTO cost_basis_settings VALUES(${sqlText(key)},${sqlText(basis)});` : ""}`;
}

