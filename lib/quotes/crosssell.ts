// Chunk 8A: cross-sell suggestions ("customers who buy X also buy Y") for a quote, by basket analysis over the local
// sales lines. A basket is one invoice (or, without an invoice number, one customer's purchases on one day). For each
// product X on the quote and each other product Y: together = baskets holding both; confidence = together / baskets
// holding X; lift = confidence / (baskets holding Y / all baskets). Exact integer arithmetic in DuckDB; no cost, no
// margin, no model and no network, so Sales Reps can see it (decision 16).
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { rhaSql } from "../margin/sql";

/** Thresholds (ASSUMPTIONS.md, 8A): a pair needs this many baskets together and this lift (x100), over this window. */
export const CROSS_DAYS = 365, MIN_TOGETHER = 3, MIN_LIFT_HUNDREDTHS = 120, MAX_SUGGESTIONS = 10;
export type CrossSell = { productId: string; description: string; category: string; basedOn: string; together: string; confidence: string; lift: string };
const pct = (bp: string) => `(CASE WHEN ${bp} < 0 THEN '-' ELSE '' END) || (abs(${bp}) // 100)::VARCHAR || '.' || lpad((abs(${bp}) % 100)::VARCHAR, 2, '0')`;

/** Suggestions for a customer buying these products; products already on the quote, or bought by this customer in the
 * window, are left out. Ordered by lift, then confidence, then product id. */
export async function crossSell(e: Engine, customerId: string, productIds: string[]): Promise<CrossSell[]> {
  const ids = [...new Set(productIds)].slice(0, 200);
  if (!ids.length) return [];
  const list = ids.map(Q).join(",");
  const sql = `WITH b AS (SELECT DISTINCT coalesce(nullif(invoice_id, ''), customer_id || '|' || strftime(sale_date, '%Y-%m-%d')) AS basket, product_id, customer_id
 FROM sales_lines WHERE line_kind = 'sale' AND quantity > 0 AND sale_date > (SELECT max(sale_date) FROM sales_lines) - INTERVAL ${CROSS_DAYS} DAY),
baskets AS (SELECT DISTINCT basket, product_id FROM b),
total AS (SELECT count(DISTINCT basket) AS n FROM baskets),
per AS (SELECT product_id, count(*) AS n FROM baskets GROUP BY 1),
owned AS (SELECT DISTINCT product_id FROM b WHERE customer_id = ${Q(customerId)}),
pairs AS (SELECT x.product_id AS x, y.product_id AS y, count(*) AS together FROM baskets x JOIN baskets y ON y.basket = x.basket AND y.product_id <> x.product_id
 WHERE x.product_id IN (${list}) AND y.product_id NOT IN (${list}) AND y.product_id NOT IN (SELECT product_id FROM owned) GROUP BY 1, 2),
scored AS (SELECT p.*, ${rhaSql("CAST(p.together AS HUGEINT) * 10000", "CAST(px.n AS HUGEINT)")} AS conf_bp,
 ${rhaSql("CAST(p.together AS HUGEINT) * (SELECT n FROM total) * 100", "CAST(px.n AS HUGEINT) * py.n")} AS lift_h
 FROM pairs p JOIN per px ON px.product_id = p.x JOIN per py ON py.product_id = p.y WHERE p.together >= ${MIN_TOGETHER}),
best AS (SELECT * FROM scored WHERE lift_h >= ${MIN_LIFT_HUNDREDTHS} QUALIFY row_number() OVER (PARTITION BY y ORDER BY lift_h DESC, conf_bp DESC, x) = 1)
SELECT s.y AS product_id, coalesce(pr.description, '') AS description, coalesce(pr.category, '') AS category, s.x AS based_on, s.together::VARCHAR AS together,
 ${pct("s.conf_bp")} AS confidence, ${pct("s.lift_h")} AS lift
FROM best s LEFT JOIN products pr ON pr.product_id = s.y ORDER BY s.lift_h DESC, s.conf_bp DESC, s.y LIMIT ${MAX_SUGGESTIONS}`;
  return (await e.conn.query(sql)).toArray().map(r => ({ productId: String(r.product_id), description: String(r.description), category: String(r.category), basedOn: String(r.based_on), together: String(r.together), confidence: String(r.confidence), lift: String(r.lift) }));
}
