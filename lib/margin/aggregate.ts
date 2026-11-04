// Pre-aggregate (customer x product x month x line kind) and reconciliation.
// The margin views read agg_cpm; reconciliation proves, per invoice, customer x month
// and in total, that the waterfall equals the imported lines to the cent. Differences
// are written to recon_issues (shown in Fix Later) and never adjusted silently.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { POCKET } from "./sql";

/** Rebuild the pre-aggregate from sales_lines (inside the caller's transaction or alone). */
export const REBUILD_SQL = `DELETE FROM agg_cpm;
INSERT INTO agg_cpm SELECT customer_id, product_id, date_trunc('month', sale_date)::DATE AS month, line_kind, count(*), sum(quantity), sum(list_cents), sum(discount_cents), sum(rebate_cents), sum(freight_cents),
 count(cost_cents), coalesce(sum(${POCKET}) FILTER (WHERE cost_cents IS NOT NULL), 0), coalesce(sum(cost_cents), 0)
FROM sales_lines GROUP BY customer_id, product_id, month, line_kind;
DELETE FROM agg_cm;
INSERT INTO agg_cm SELECT customer_id, month, line_kind, sum(lines), sum(list_cents), sum(discount_cents), sum(rebate_cents), sum(freight_cents), sum(costed_lines), sum(costed_pocket_cents), sum(cost_cents) FROM agg_cpm GROUP BY customer_id, month, line_kind;
DELETE FROM agg_p;
INSERT INTO agg_p SELECT product_id, line_kind, sum(lines), sum(list_cents), sum(discount_cents), sum(rebate_cents), sum(freight_cents), sum(costed_lines), sum(costed_pocket_cents), sum(cost_cents) FROM agg_cpm GROUP BY product_id, line_kind;`;
/** Rollups the views read when a question needs only customer or only product attributes. */
export const ROLLUPS = ["agg_cm", "agg_p"] as const;
export async function rebuildAggregates(engine: Engine) {
  await engine.conn.query("BEGIN");
  try { await engine.conn.query(REBUILD_SQL); await engine.conn.query("COMMIT"); }
  catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
}
const COMPONENTS = ["lines", "list", "discount", "rebate", "freight", "cost", "costed_lines", "costed_pocket"] as const;
const lineSide = `count(*) AS lines, sum(list_cents) AS list, sum(discount_cents) AS discount, sum(rebate_cents) AS rebate, sum(freight_cents) AS freight, coalesce(sum(cost_cents),0) AS cost, count(cost_cents) AS costed_lines, coalesce(sum(${POCKET}) FILTER (WHERE cost_cents IS NOT NULL),0) AS costed_pocket`;
const aggSide = `sum(lines) AS lines, sum(list_cents) AS list, sum(discount_cents) AS discount, sum(rebate_cents) AS rebate, sum(freight_cents) AS freight, sum(cost_cents) AS cost, sum(costed_lines) AS costed_lines, sum(costed_pocket_cents) AS costed_pocket`;
export type ReconIssue = { id: string; level: "invoice" | "customer_month" | "total"; scopeKey: string; component: string; imported: string | null; waterfall: string | null; sourceId: string | null; sourceRow: string | null; message: string; status: "open" | "accepted" };
export type ReconSummary = { checkedAt: string; invoices: string; customerMonths: string; lines: string; open: ReconIssue[]; accepted: string; reconciled: boolean };
const LABEL: Record<string, string> = { lines: "line count", list: "list", discount: "discounts", rebate: "rebates", freight: "freight", cost: "known cost", costed_lines: "lines with known cost", costed_pocket: "pocket of lines with known cost" };
async function idFor(parts: string[]) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u0001"))));
  return "rc-" + [...bytes.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/**
 * Compare the pre-aggregate with the imported lines per customer x month and in total,
 * and check that every invoice belongs to one customer and one month (otherwise its
 * total cannot reconcile to a customer x month). Returns the differences found.
 */
export async function findDifferences(engine: Engine, limit = 1000) {
  const q = async (sql: string) => (await engine.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
  const found: Omit<ReconIssue, "id" | "status">[] = [];
  const cm = await q(`WITH l AS (SELECT customer_id, date_trunc('month', sale_date)::DATE AS m, ${lineSide}, min(source_id) AS sid, min(source_row) AS srow FROM sales_lines GROUP BY 1, 2),
a AS (SELECT customer_id, month AS m, ${aggSide} FROM agg_cpm GROUP BY 1, 2)
SELECT coalesce(l.customer_id, a.customer_id) AS c, coalesce(l.m, a.m)::VARCHAR AS m, l.sid, l.srow::VARCHAR AS srow, ${COMPONENTS.map(k => `l.${k}::VARCHAR AS l_${k}, a.${k}::VARCHAR AS a_${k}`).join(", ")}
FROM l FULL OUTER JOIN a ON l.customer_id = a.customer_id AND l.m = a.m
WHERE ${COMPONENTS.map(k => `l.${k} IS DISTINCT FROM a.${k}`).join(" OR ")} ORDER BY 1, 2 LIMIT ${limit}`);
  for (const r of cm) for (const k of COMPONENTS) if (r[`l_${k}`] !== r[`a_${k}`]) found.push({ level: "customer_month", scopeKey: `${r.c}|${String(r.m).slice(0, 7)}`, component: k, imported: r[`l_${k}`] as string | null, waterfall: r[`a_${k}`] as string | null,
    sourceId: (r.sid as string) ?? null, sourceRow: (r.srow as string) ?? null, message: `Customer ${r.c}, ${String(r.m).slice(0, 7)}: the waterfall's ${LABEL[k]} differs from the imported lines.` });
  const total = (await q(`SELECT ${COMPONENTS.map(k => `coalesce(l.${k},0)::VARCHAR AS l_${k}, coalesce(a.${k},0)::VARCHAR AS a_${k}`).join(", ")} FROM (SELECT ${lineSide} FROM sales_lines) l, (SELECT ${aggSide} FROM agg_cpm) a`))[0];
  for (const k of COMPONENTS) if ((total[`l_${k}`] ?? "0") !== (total[`a_${k}`] ?? "0")) found.push({ level: "total", scopeKey: "all", component: k, imported: total[`l_${k}`] as string | null, waterfall: total[`a_${k}`] as string | null, sourceId: null, sourceRow: null, message: `The waterfall's total ${LABEL[k]} differs from the imported lines.` });
  // The rollups must equal the imported lines too (they serve customer-only and product-only views).
  for (const r of ROLLUPS) {
    const t = (await q(`SELECT ${COMPONENTS.map(k => `coalesce(a.${k},0)::VARCHAR AS a_${k}`).join(", ")} FROM (SELECT ${aggSide} FROM ${r}) a`))[0];
    for (const k of COMPONENTS) if ((total[`l_${k}`] ?? "0") !== (t[`a_${k}`] ?? "0")) found.push({ level: "total", scopeKey: r, component: k, imported: total[`l_${k}`] as string | null, waterfall: t[`a_${k}`] as string | null, sourceId: null, sourceRow: null,
      message: `The ${r === "agg_cm" ? "customer x month" : "product"} totals' ${LABEL[k]} differ from the imported lines.` });
  }
  // min/max per invoice (not count DISTINCT) keeps this inside the memory guardrail at 2M lines; counts are taken only for the split invoices.
  const split = await q(`WITH s AS (SELECT invoice_id FROM sales_lines WHERE invoice_id IS NOT NULL GROUP BY invoice_id HAVING min(customer_id) <> max(customer_id) OR min(sale_date) < max(sale_date) AND date_trunc('month', min(sale_date)) <> date_trunc('month', max(sale_date)) ORDER BY invoice_id LIMIT ${limit})
SELECT l.invoice_id, count(DISTINCT l.customer_id)::VARCHAR AS customers, count(DISTINCT date_trunc('month', l.sale_date))::VARCHAR AS months, min(l.source_id) AS sid, min(l.source_row)::VARCHAR AS srow, sum(l.list_cents)::VARCHAR AS list
FROM sales_lines l JOIN s USING (invoice_id) GROUP BY l.invoice_id ORDER BY l.invoice_id`);
  for (const r of split) found.push({ level: "invoice", scopeKey: String(r.invoice_id), component: r.customers !== "1" ? "customer" : "month", imported: r.list as string, waterfall: null, sourceId: r.sid as string, sourceRow: r.srow as string,
    message: r.customers !== "1" ? `Invoice ${r.invoice_id} has lines for ${r.customers} customers, so its total cannot reconcile to one customer.` : `Invoice ${r.invoice_id} has lines in ${r.months} months, so its total cannot reconcile to one month.` });
  const counts = (await q(`SELECT (SELECT count(*) FROM (SELECT invoice_id FROM sales_lines WHERE invoice_id IS NOT NULL GROUP BY invoice_id))::VARCHAR AS invoices, (SELECT count(*) FROM (SELECT DISTINCT customer_id, date_trunc('month', sale_date) FROM sales_lines))::VARCHAR AS cms, (SELECT count(*) FROM sales_lines)::VARCHAR AS lines`))[0];
  return { found, invoices: String(counts.invoices), customerMonths: String(counts.cms), lines: String(counts.lines) };
}
/** SQL that replaces the open issues with the differences just found; accepted issues keep their status. Run in a transaction. */
export async function recordSql(found: Omit<ReconIssue, "id" | "status">[], at: string) {
  const values: string[] = [];
  for (const f of found) {
    const id = await idFor([f.level, f.scopeKey, f.component, f.imported ?? "", f.waterfall ?? ""]);
    const n = (v: string | null) => v === null ? "NULL" : `CAST(${sqlText(v)} AS HUGEINT)`;
    values.push(`(${sqlText(id)},${sqlText(f.level)},${sqlText(f.scopeKey)},${sqlText(f.component)},${n(f.imported)},${n(f.waterfall)},${f.sourceId === null ? "NULL" : sqlText(f.sourceId)},${f.sourceRow === null ? "NULL" : f.sourceRow},${sqlText(f.message)},'open',${sqlText(at)})`);
  }
  return `DELETE FROM recon_issues WHERE status='open';
${values.length ? `INSERT INTO recon_issues VALUES ${values.join(",")} ON CONFLICT (id) DO NOTHING;` : ""}`;
}
export async function reconSummary(engine: Engine, counts: { invoices: string; customerMonths: string; lines: string }, at: string): Promise<ReconSummary> {
  const open = (await engine.conn.query(`SELECT id, level, scope_key, component, imported_cents::VARCHAR AS imported, waterfall_cents::VARCHAR AS waterfall, source_id, source_row::VARCHAR AS source_row, message, status FROM recon_issues WHERE status='open' ORDER BY level, scope_key, component LIMIT 200`)).toArray()
    .map(r => ({ id: String(r.id), level: r.level, scopeKey: String(r.scope_key), component: String(r.component), imported: r.imported === null ? null : String(r.imported), waterfall: r.waterfall === null ? null : String(r.waterfall), sourceId: r.source_id === null ? null : String(r.source_id), sourceRow: r.source_row === null ? null : String(r.source_row), message: String(r.message), status: "open" }) as ReconIssue);
  const accepted = String((await engine.conn.query("SELECT count(*)::VARCHAR AS n FROM recon_issues WHERE status='accepted'")).toArray()[0].n);
  return { checkedAt: at, ...counts, open, accepted, reconciled: open.length === 0 };
}
