// Chunk 8D, on the device (BENCHMARKS_DESIGN.md sections 2-3): the Owner maps local categories to the 12 standard
// families; the worker computes, for one completed quarter, each family's four rates from sale lines (exact integers,
// the 4D waterfall: pocket = list − discount − rebate − freight) and rounds them down to whole-point bands. A family is
// left out unless it has at least 200 lines, 20 customers and no customer above 25% of its pocket revenue. Only the
// resulting bands, the quarter and the size band can leave the device, and only when the Owner confirms.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { sqlText as Q } from "../spike/exact";
import { msg } from "../i18n/core";
import { FAMILIES, FAMILY_MIN, METRICS, bandOf, checkPayload, isQuarter, quarterDates, sizeBandOf, type BenchPayload, type BenchRow, type Family, type Metric } from "./payload";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const bad = (): never => { throw new VaultError("BENCH", msg("bench.invalid")); };
const B = (v: unknown) => BigInt(String(v ?? "0"));

export async function mapping(e: Engine) {
  const r = await rows(e, `SELECT p.category, m.family, count(*)::VARCHAR AS products FROM products p LEFT JOIN bench_family_map m ON m.category = p.category
 WHERE p.category <> '' GROUP BY p.category, m.family ORDER BY p.category LIMIT 2000`);
  return r.map(x => ({ category: String(x.category), family: x.family === null ? null : String(x.family) as Family, products: String(x.products) }));
}
export function mappingSql(input: unknown, at: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) bad();
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 2000) bad();
  const out: string[] = [];
  for (const [category, family] of entries) {
    if (!category || category.length > 200 || /[\x00-\x1f]/.test(category)) bad();
    if (family === null || family === "") out.push(`DELETE FROM bench_family_map WHERE category=${Q(category)};`);
    else if (FAMILIES.includes(family as Family)) out.push(`INSERT INTO bench_family_map VALUES(${Q(category)},${Q(String(family))},${Q(at)}) ON CONFLICT(category) DO UPDATE SET family=excluded.family,updated_at=excluded.updated_at;`);
    else bad();
  }
  return out.join("\n");
}

export type FamilyCheck = { family: Family; lines: string; customers: string; topShareBp: string; included: boolean; reason: "ok" | "lines" | "customers" | "concentration" | "revenue"; bands: Partial<Record<Metric, number>> };
export type Preview = { quarter: string; from: string; to: string; sizeBand: string; families: FamilyCheck[]; unmapped: string; payload: BenchPayload | null };

/** Everything the Owner reviews before sharing one quarter; `payload` is exactly what would be sent (or null). */
export async function preview(e: Engine, quarter: unknown): Promise<Preview> {
  if (!isQuarter(quarter)) bad();
  const { from, to } = quarterDates(quarter as string), within = `l.line_kind = 'sale' AND l.sale_date BETWEEN DATE ${Q(from)} AND DATE ${Q(to)}`;
  const pocket = "(l.list_cents - l.discount_cents - l.rebate_cents - l.freight_cents)";
  const total = (await rows(e, `SELECT coalesce(sum(${pocket}), 0)::VARCHAR AS revenue FROM sales_lines l WHERE ${within}`))[0];
  const unmapped = (await rows(e, `SELECT count(*)::VARCHAR AS n FROM sales_lines l JOIN products p USING (product_id) LEFT JOIN bench_family_map m ON m.category = p.category WHERE ${within} AND m.family IS NULL`))[0];
  const fam = await rows(e, `WITH x AS (SELECT m.family, l.customer_id, l.list_cents, l.discount_cents, l.rebate_cents, l.freight_cents, l.cost_cents, ${pocket} AS pocket
  FROM sales_lines l JOIN products p USING (product_id) JOIN bench_family_map m ON m.category = p.category WHERE ${within}),
 c AS (SELECT family, customer_id, sum(pocket) AS rev FROM x GROUP BY family, customer_id)
SELECT x.family, count(*)::VARCHAR AS lines, count(DISTINCT x.customer_id)::VARCHAR AS customers, sum(x.list_cents)::VARCHAR AS list, sum(x.discount_cents)::VARCHAR AS discount,
 sum(x.rebate_cents)::VARCHAR AS rebate, sum(x.freight_cents)::VARCHAR AS freight, sum(x.pocket)::VARCHAR AS pocket,
 coalesce(sum(x.pocket) FILTER (WHERE x.cost_cents IS NOT NULL), 0)::VARCHAR AS costed_pocket, coalesce(sum(x.cost_cents), 0)::VARCHAR AS cost,
 (SELECT max(rev) FROM c WHERE c.family = x.family)::VARCHAR AS top
FROM x GROUP BY x.family ORDER BY x.family`);
  const families: FamilyCheck[] = [], payloadRows: BenchRow[] = [];
  for (const r of fam) {
    const family = String(r.family) as Family, lines = B(r.lines), customers = B(r.customers), pocketSum = B(r.pocket), top = B(r.top);
    const topShareBp = pocketSum > BigInt(0) ? (top * BigInt(10000) / pocketSum).toString() : "0";
    const reason: FamilyCheck["reason"] = lines < BigInt(FAMILY_MIN.lines) ? "lines" : customers < BigInt(FAMILY_MIN.customers) ? "customers" : pocketSum <= BigInt(0) ? "revenue" : BigInt(topShareBp) > BigInt(FAMILY_MIN.topShareBp) ? "concentration" : "ok";
    const bands: Partial<Record<Metric, number>> = {};
    if (reason === "ok") {
      const list = B(r.list), costedPocket = B(r.costed_pocket);
      if (costedPocket > BigInt(0)) bands.pocket_margin = bandOf(costedPocket - B(r.cost), costedPocket);
      if (list > BigInt(0)) { bands.discount_rate = bandOf(B(r.discount), list); bands.rebate_rate = bandOf(B(r.rebate), list); }
      bands.freight_rate = bandOf(B(r.freight), pocketSum);
      for (const metric of METRICS) if (bands[metric] !== undefined) payloadRows.push({ family, metric, band: bands[metric]! });
    }
    families.push({ family, lines: lines.toString(), customers: customers.toString(), topShareBp, included: reason === "ok", reason, bands });
  }
  const sizeBand = sizeBandOf(B(total.revenue));
  const payload = payloadRows.length ? checkPayload({ v: 1, quarter, sizeBand, rows: payloadRows }) : null;
  return { quarter: quarter as string, from, to, sizeBand, families, unmapped: String(unmapped.n), payload };
}

/** The exact payload the server accepted, kept for the record; the audit entry holds codes and counts only. */
export function shareSql(payload: unknown, stored: unknown, by: string, at: string) {
  const p = checkPayload(payload);
  if (typeof stored !== "number" || !Number.isInteger(stored) || stored !== p.rows.length) bad();
  return { quarter: p.quarter, rows: p.rows.length, sql: `INSERT INTO bench_shares VALUES(${Q(p.quarter)},${Q(JSON.stringify(p))},${p.rows.length},${Q(by)},${Q(at)},NULL)
 ON CONFLICT(quarter) DO UPDATE SET payload=excluded.payload,rows=excluded.rows,shared_by=excluded.shared_by,shared_at=excluded.shared_at,withdrawn_at=NULL;` };
}
export type Cell = { sizeBand: string; family: string; metric: string; p25: number; p50: number; p75: number; releasedAt: string };
export function figuresSql(quarter: unknown, cells: unknown, at: string) {
  if (!isQuarter(quarter) || !Array.isArray(cells) || cells.length > 4 * 12 * 4) bad();
  const values = (cells as Cell[]).map(c => {
    const edge = (n: unknown) => Number.isInteger(n) && (n as number) >= -20 && (n as number) <= 80 && ((n as number) + 20) % 5 === 0 ? n as number : bad();
    if (!["S1", "S2", "S3", "S4"].includes(c.sizeBand) || !FAMILIES.includes(c.family as Family) || !METRICS.includes(c.metric as Metric) || typeof c.releasedAt !== "string") bad();
    return `(${Q(quarter as string)},${Q(c.sizeBand)},${Q(c.family)},${Q(c.metric)},${edge(c.p25)},${edge(c.p50)},${edge(c.p75)},${Q(c.releasedAt.slice(0, 40))},${Q(at)})`;
  });
  return `DELETE FROM bench_figures WHERE quarter=${Q(quarter as string)};${values.length ? `INSERT INTO bench_figures VALUES ${values.join(",")};` : ""}`;
}
export const withdrawnSql = (at: string) => `UPDATE bench_shares SET withdrawn_at=${Q(at)} WHERE withdrawn_at IS NULL; DELETE FROM bench_figures;`;

export async function state(e: Engine) {
  const shares = (await rows(e, "SELECT quarter, payload, rows, shared_by, shared_at, withdrawn_at FROM bench_shares ORDER BY quarter DESC LIMIT 40"))
    .map(r => ({ quarter: String(r.quarter), payload: JSON.parse(String(r.payload)) as BenchPayload, rows: Number(r.rows), sharedBy: String(r.shared_by), sharedAt: String(r.shared_at), withdrawnAt: r.withdrawn_at === null ? null : String(r.withdrawn_at) }));
  const figures = (await rows(e, "SELECT quarter, size_band, family, metric, p25, p50, p75, released_at FROM bench_figures ORDER BY quarter DESC, family, metric LIMIT 800"))
    .map(r => ({ quarter: String(r.quarter), sizeBand: String(r.size_band), family: String(r.family), metric: String(r.metric), p25: Number(r.p25), p50: Number(r.p50), p75: Number(r.p75), releasedAt: String(r.released_at) }));
  return { shares, figures, mapping: await mapping(e) };
}
