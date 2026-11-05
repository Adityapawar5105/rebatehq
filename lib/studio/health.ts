// Data health score: equal-weight mean of the components that apply, each with a
// visible formula and an improvement step. Statistics only; money stays exact elsewhere.
import type { Engine } from "../vault/engine";
import { msg } from "../i18n/core";
export type HealthComponent = { key: string; label: string; score: number | null; detail: string; step: string };
export type Health = { score: number | null; formula: string; components: HealthComponent[]; linesBelowCost: string; openFixLater: string };
const pct = (num: bigint, den: bigint) => den === BigInt(0) ? null : Math.round(Number(num * BigInt(1000) / den) / 10);
export async function health(engine: Engine): Promise<Health> {
  const f = (await engine.conn.query(`WITH u AS (SELECT product_id, list_cents::DOUBLE / quantity::DOUBLE AS unit FROM sales_lines WHERE quantity > 0),
m AS (SELECT product_id, median(unit) AS med FROM u GROUP BY product_id HAVING count(*) >= 5)
SELECT (SELECT count(*) FROM sales_lines)::VARCHAR AS lines,
 (SELECT count(*) FROM sales_lines WHERE cost_cents IS NOT NULL)::VARCHAR AS costed,
 (SELECT count(*) FROM products)::VARCHAR AS products,
 (SELECT coalesce(sum(c), 0) FROM (SELECT count(*) AS c FROM products GROUP BY upper(trim(product_id)) HAVING count(*) > 1))::VARCHAR AS dup_products,
 (SELECT count(*) FROM u JOIN m USING (product_id) WHERE m.med > 0 AND (u.unit > m.med * 5 OR u.unit < m.med / 5))::VARCHAR AS outliers,
 (SELECT count(*) FROM u JOIN m USING (product_id))::VARCHAR AS comparable,
 (SELECT count(*) FROM sales_lines WHERE line_kind = 'sale' AND cost_cents IS NOT NULL AND list_cents - discount_cents - freight_cents - rebate_cents - cost_cents < 0)::VARCHAR AS below_cost,
 (SELECT count(*) FROM rejected_rows WHERE status = 'open')::VARCHAR AS open_rows,
 (SELECT count(*) FROM customers)::VARCHAR AS customers,
 (SELECT count(*) FROM customers WHERE tier <> '')::VARCHAR AS tiered`)).toArray()[0];
  const n = (k: string) => BigInt(String(f[k]));
  const lines = n("lines"), products = n("products"), customers = n("customers");
  const components: HealthComponent[] = [
    { key: "cost", label: msg("health.linesWithAKnown"), score: pct(n("costed"), lines), detail: msg("health.ofInvoiceLines", { value: n("costed"), lines }), step: msg("health.mapACostColumn") },
    { key: "unique", label: msg("health.uniqueProductIds"), score: products ? pct(products - n("dup_products"), products) : null, detail: msg("health.ofProductsDifferOnly", { value: n("dup_products"), products }), step: msg("health.mergeLookAlikeProduct") },
    { key: "prices", label: msg("health.consistentPrices"), score: pct(n("comparable") - n("outliers"), n("comparable")), detail: msg("health.ofLinesArePriced", { value: n("outliers"), value2: n("comparable") }), step: msg("health.checkThoseLinesFor") },
    { key: "complete", label: msg("health.importCompleteness"), score: pct(lines, lines + n("open_rows")), detail: msg("health.rejectedRowsAreWaiting", { value: n("open_rows") }), step: msg("health.workThroughFixLater") },
    { key: "customers", label: msg("health.customersWithAPricing"), score: pct(n("tiered"), customers), detail: msg("health.ofCustomers", { value: n("tiered"), customers }), step: msg("health.loadACustomerList") },
  ];
  const scored = components.filter(c => c.score !== null);
  return {
    score: scored.length ? Math.round(scored.reduce((s, c) => s + c.score!, 0) / scored.length) : null,
    formula: msg("health.healthAverageOfThe"),
    components, linesBelowCost: String(n("below_cost")), openFixLater: String(n("open_rows")),
  };
}
