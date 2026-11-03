// Data health score: equal-weight mean of the components that apply, each with a
// visible formula and an improvement step. Statistics only; money stays exact elsewhere.
import type { Engine } from "../vault/engine";
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
 (SELECT count(*) FROM sales_lines WHERE cost_cents IS NOT NULL AND list_cents - discount_cents - freight_cents - rebate_cents - cost_cents < 0)::VARCHAR AS below_cost,
 (SELECT count(*) FROM rejected_rows WHERE status = 'open')::VARCHAR AS open_rows,
 (SELECT count(*) FROM customers)::VARCHAR AS customers,
 (SELECT count(*) FROM customers WHERE tier <> '')::VARCHAR AS tiered`)).toArray()[0];
  const n = (k: string) => BigInt(String(f[k]));
  const lines = n("lines"), products = n("products"), customers = n("customers");
  const components: HealthComponent[] = [
    { key: "cost", label: "Lines with a known cost", score: pct(n("costed"), lines), detail: `${n("costed")} of ${lines} invoice lines`, step: "Map a cost column, or load an item master or vendor cost sheet. Margins cannot be trusted without cost." },
    { key: "unique", label: "Unique product IDs", score: products ? pct(products - n("dup_products"), products) : null, detail: `${n("dup_products")} of ${products} products differ only by case or spaces`, step: "Merge look-alike product IDs (item master cleanup arrives in the next phase)." },
    { key: "prices", label: "Consistent prices", score: pct(n("comparable") - n("outliers"), n("comparable")), detail: `${n("outliers")} of ${n("comparable")} lines are priced above 5x or below 1/5 of the product's median unit price`, step: "Check those lines for unit-of-measure or keying errors." },
    { key: "complete", label: "Import completeness", score: pct(lines, lines + n("open_rows")), detail: `${n("open_rows")} rejected rows are waiting in Fix Later`, step: "Work through Fix Later: correct, then re-check and load, or dismiss." },
    { key: "customers", label: "Customers with a pricing tier", score: pct(n("tiered"), customers), detail: `${n("tiered")} of ${customers} customers`, step: "Load a customer list with a tier column." },
  ];
  const scored = components.filter(c => c.score !== null);
  return {
    score: scored.length ? Math.round(scored.reduce((s, c) => s + c.score!, 0) / scored.length) : null,
    formula: "Health = average of the components that apply (each 0-100%, equal weight).",
    components, linesBelowCost: String(n("below_cost")), openFixLater: String(n("open_rows")),
  };
}
