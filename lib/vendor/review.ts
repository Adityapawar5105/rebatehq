// Chunk 7E-1 (blueprint section 6 Phase 2, section 9): vendor price review and purchase price variance.
// Everything runs in the vault worker over local tables. A supplier cost sheet is loaded through Import Studio
// (role vendor_cost), which only adds cost history: no live price changes until a rule is simulated, approved and
// exported. The review compares that sheet with the costs before it, flags conflicts (the 3B diff ideas: unknown
// SKU, a later cost already on file, a different cost on the same date), estimates the margin effect on recent
// volume, and lists the open quotes and saved rules the change touches. Money is integer cents, exactly.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { sqlText as Q, validDate } from "../spike/exact";
import { divRoundSql, rhaSql } from "../margin/sql";
import { bpPercentSql } from "../margin/views";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? null : String(v);
const bad = (): never => { throw new VaultError("VENDOR", msg("vendor.invalid")); };
/** Recent volume window for the margin estimate (days back from the latest invoice date). */
export const WINDOWS = [90, 180, 365] as const;
const OPEN_QUOTES = "('draft','submitted','pending')";
export type ReviewStatus = "unknown_sku" | "conflict" | "backdated" | "first_cost" | "increase" | "decrease" | "unchanged";

/** Supplier cost sheets loaded in this vault (Import Studio role vendor_cost). */
export async function vendorSheets(e: Engine) {
  return (await rows(e, `SELECT f.id, f.name, f.imported_at, count(v.id)::VARCHAR AS lines, count(DISTINCT v.vendor)::VARCHAR AS vendors,
 min(v.effective_date)::VARCHAR AS first_date, max(v.effective_date)::VARCHAR AS last_date
FROM source_files f JOIN vendor_costs v ON v.source_id = f.id WHERE f.role = 'vendor_cost' GROUP BY f.id, f.name, f.imported_at ORDER BY f.imported_at DESC, f.id`))
    .map(r => ({ id: String(r.id), name: String(r.name), importedAt: String(r.imported_at), lines: String(r.lines), vendors: String(r.vendors), firstDate: S(r.first_date), lastDate: S(r.last_date) }));
}
async function sheetExists(e: Engine, id: unknown) {
  if (typeof id !== "string" || !id || id.length > 200) bad();
  if (!(await rows(e, `SELECT 1 FROM source_files WHERE id = ${Q(id as string)} AND role = 'vendor_cost'`)).length) throw new VaultError("VENDOR", msg("vendor.noSheet"));
  return id as string;
}
const windowDays = (w: unknown) => { const n = Number(w ?? 365); if (!(WINDOWS as readonly number[]).includes(n)) bad(); return n; };

/** The saved pricing rules as SQL conditions over a reviewed row (latest revision of each rule). */
async function ruleCase(e: Engine) {
  const list = (await rows(e, `SELECT r.id, r.name, v.definition FROM rules r JOIN rule_revisions v ON v.rule_id = r.id
 WHERE v.version = (SELECT max(version) FROM rule_revisions x WHERE x.rule_id = r.id) ORDER BY r.name, r.id LIMIT 200`));
  const parts = list.flatMap(r => {
    try {
      const d = JSON.parse(String(r.definition)) as { vendor?: string; category?: string; threshold?: string };
      if (typeof d.vendor !== "string" || typeof d.category !== "string" || !/^\d{1,5}$/.test(String(d.threshold))) return [];
      // The same trigger the rule simulation uses (lib/pricing/rules.ts): this vendor, this category, and the new
      // cost above the vendor's previous cost by more than the threshold (basis points).
      return [`CASE WHEN x.vendor = ${Q(d.vendor)} AND x.category = ${Q(d.category)} AND x.previous_cost > 0 AND CAST(x.new_cost - x.previous_cost AS HUGEINT) * 10000 > CAST(x.previous_cost AS HUGEINT) * ${d.threshold} THEN ${Q(String(r.name))} END`];
    } catch { return []; }
  });
  return parts.length ? `concat_ws(', ', ${parts.join(", ")})` : "''";
}

/** One row per line of the sheet, with everything the review shows. Output column names are the grid spec. */
async function reviewBase(e: Engine, sheet: string, days: number) {
  const s = Q(sheet), rules = await ruleCase(e);
  return `WITH sheet AS (SELECT id, vendor, product_id, cost, effective_date, source_row FROM vendor_costs WHERE source_id = ${s}),
other AS (SELECT vendor, product_id, effective_date, cost FROM vendor_costs WHERE coalesce(source_id, '') <> ${s}),
prev AS (SELECT sh.id, o.cost AS previous_cost FROM sheet sh ASOF LEFT JOIN other o ON sh.vendor = o.vendor AND sh.product_id = o.product_id AND sh.effective_date > o.effective_date),
later AS (SELECT vendor, product_id, max(effective_date) AS latest FROM other GROUP BY 1, 2),
clash AS (SELECT vendor, product_id, effective_date, min(cost) AS lo, max(cost) AS hi FROM other GROUP BY 1, 2, 3),
vol AS (SELECT product_id, sum(quantity) AS qty FROM sales_lines WHERE line_kind = 'sale' AND sale_date > (SELECT max(sale_date) FROM sales_lines) - INTERVAL ${days} DAY GROUP BY 1),
quoted AS (SELECT l.product_id, count(DISTINCT q.id) AS quotes FROM quotes q JOIN quote_lines l ON l.quote_id = q.id WHERE q.status IN ${OPEN_QUOTES} GROUP BY 1),
x AS (SELECT sh.id, sh.vendor, sh.product_id, sh.effective_date, sh.source_row, sh.cost AS new_cost, pv.previous_cost, p.current_cost, p.product_id IS NOT NULL AS known,
 coalesce(p.description, '') AS description, coalesce(p.category, '') AS category, coalesce(v.qty, 0) AS qty, coalesce(qd.quotes, 0) AS quotes,
 lt.latest > sh.effective_date AS is_backdated, (c.lo IS NOT NULL AND (c.lo <> sh.cost OR c.hi <> sh.cost)) AS is_clash
 FROM sheet sh LEFT JOIN prev pv ON pv.id = sh.id LEFT JOIN products p ON p.product_id = sh.product_id LEFT JOIN vol v ON v.product_id = sh.product_id
 LEFT JOIN quoted qd ON qd.product_id = sh.product_id LEFT JOIN later lt ON lt.vendor = sh.vendor AND lt.product_id = sh.product_id
 LEFT JOIN clash c ON c.vendor = sh.vendor AND c.product_id = sh.product_id AND c.effective_date = sh.effective_date),
y AS (SELECT x.*, coalesce(x.previous_cost, x.current_cost) AS basis, ${rules} AS rules_hit FROM x)
SELECT y.id, y.product_id, y.description, y.category, y.vendor, y.effective_date::VARCHAR AS effective_date, y.source_row::VARCHAR AS source_row,
 y.new_cost::VARCHAR AS new_cost, y.previous_cost::VARCHAR AS previous_cost, y.current_cost::VARCHAR AS current_cost,
 CASE WHEN y.basis IS NULL THEN NULL ELSE (y.new_cost - y.basis)::VARCHAR END AS change,
 CASE WHEN y.basis IS NULL OR y.basis = 0 THEN NULL ELSE ${bpPercentSql(divRoundSql("CAST(y.new_cost - y.basis AS HUGEINT) * 10000", "y.basis"))} END AS change_pct,
 CASE WHEN NOT y.known THEN 'unknown_sku' WHEN y.is_clash THEN 'conflict' WHEN y.is_backdated THEN 'backdated' WHEN y.basis IS NULL THEN 'first_cost'
  WHEN y.new_cost > y.basis THEN 'increase' WHEN y.new_cost < y.basis THEN 'decrease' ELSE 'unchanged' END AS status,
 y.qty::VARCHAR AS volume,
 CASE WHEN y.basis IS NULL THEN NULL ELSE (-${rhaSql("CAST(y.new_cost - y.basis AS HUGEINT) * CAST(y.qty * 10000 AS HUGEINT)", "10000")})::VARCHAR END AS margin_impact,
 y.quotes::VARCHAR AS open_quotes, y.rules_hit AS rules
FROM y`;
}
export const REVIEW_GRID: GridSpec = { product_id: "text", description: "text", category: "text", vendor: "text", effective_date: "date", new_cost: "money", previous_cost: "money", current_cost: "money", change: "money", change_pct: "percent", status: "text", volume: "decimal", margin_impact: "money", open_quotes: "int", rules: "text" };
export type ReviewRow = { id: string; product_id: string; description: string; category: string; vendor: string; effective_date: string; source_row: string; new_cost: string; previous_cost: string | null; current_cost: string | null; change: string | null; change_pct: string | null; status: ReviewStatus; volume: string; margin_impact: string | null; open_quotes: string; rules: string };

/** The review grid of one supplier cost sheet, with totals for the whole sheet. */
export async function vendorReview(e: Engine, sheetId: unknown, window?: unknown, offset = 0, grid?: unknown) {
  const sheet = await sheetExists(e, sheetId), days = windowDays(window), base = await reviewBase(e, sheet, days);
  const t = (await rows(e, `SELECT count(*)::VARCHAR AS lines, count(*) FILTER (WHERE status = 'increase')::VARCHAR AS increases, count(*) FILTER (WHERE status = 'decrease')::VARCHAR AS decreases,
 count(*) FILTER (WHERE status IN ('unknown_sku','conflict','backdated'))::VARCHAR AS conflicts, count(*) FILTER (WHERE status = 'first_cost')::VARCHAR AS first_costs,
 coalesce(sum(CAST(margin_impact AS HUGEINT)), 0)::VARCHAR AS margin_impact, count(*) FILTER (WHERE rules <> '')::VARCHAR AS rule_lines FROM (${base}) r`))[0];
  const quotes = (await rows(e, `SELECT count(DISTINCT q.id)::VARCHAR AS n FROM quotes q JOIN quote_lines l ON l.quote_id = q.id
 WHERE q.status IN ${OPEN_QUOTES} AND l.product_id IN (SELECT product_id FROM (${base}) r WHERE CAST(change AS BIGINT) <> 0)`))[0].n;
  const page = await gridPage(e, base, REVIEW_GRID, gridQuery(REVIEW_GRID, grid), { fallback: "g.product_id, g.vendor, g.effective_date, g.id", limit: 50, offset });
  return { sheet, window: days, offset, totals: { lines: String(t.lines), increases: String(t.increases), decreases: String(t.decreases), conflicts: String(t.conflicts), firstCosts: String(t.first_costs), marginImpact: String(t.margin_impact), ruleLines: String(t.rule_lines), quotes: String(quotes) },
    rows: page.rows.map(r => ({ id: String(r.id), product_id: String(r.product_id), description: String(r.description), category: String(r.category), vendor: String(r.vendor), effective_date: String(r.effective_date), source_row: S(r.source_row) ?? "", new_cost: String(r.new_cost), previous_cost: S(r.previous_cost), current_cost: S(r.current_cost), change: S(r.change), change_pct: S(r.change_pct), status: String(r.status) as ReviewStatus, volume: String(r.volume), margin_impact: S(r.margin_impact), open_quotes: String(r.open_quotes), rules: String(r.rules ?? "") })) as ReviewRow[], grid: page.grid };
}

export const QUOTE_GRID: GridSpec = { number: "text", customer_id: "text", status: "text", product_id: "text", quantity: "decimal", unit_price: "money", quote_cost: "money", new_cost: "money", margin_before: "money", margin_after: "money" };
/** Open quote lines whose SKU changes cost in this sheet: the margin at the quoted price before and after. The new
 * cost of a SKU is its latest row in the sheet (highest cost when several vendors share that date). */
export async function vendorReviewQuotes(e: Engine, sheetId: unknown, offset = 0, grid?: unknown) {
  const sheet = await sheetExists(e, sheetId), s = Q(sheet);
  const base = `WITH latest AS (SELECT product_id, cost FROM vendor_costs WHERE source_id = ${s} QUALIFY row_number() OVER (PARTITION BY product_id ORDER BY effective_date DESC, cost DESC, id) = 1)
SELECT q.id || '|' || l.line_no AS key, q.number, q.customer_id, q.status, l.product_id, l.quantity::VARCHAR AS quantity, l.unit_price_cents::VARCHAR AS unit_price,
 l.cost_cents::VARCHAR AS quote_cost, n.cost::VARCHAR AS new_cost,
 CASE WHEN l.cost_cents IS NULL THEN NULL ELSE ${rhaSql("CAST(l.unit_price_cents - l.cost_cents AS HUGEINT) * CAST(l.quantity * 10000 AS HUGEINT)", "10000")}::VARCHAR END AS margin_before,
 ${rhaSql("CAST(l.unit_price_cents - n.cost AS HUGEINT) * CAST(l.quantity * 10000 AS HUGEINT)", "10000")}::VARCHAR AS margin_after
FROM quotes q JOIN quote_lines l ON l.quote_id = q.id JOIN latest n ON n.product_id = l.product_id
WHERE q.status IN ${OPEN_QUOTES} AND (l.cost_cents IS NULL OR l.cost_cents <> n.cost)`;
  const page = await gridPage(e, base, QUOTE_GRID, gridQuery(QUOTE_GRID, grid), { fallback: "g.number, g.key", limit: 50, offset });
  return { sheet, offset, rows: page.rows.map(r => ({ key: String(r.key), number: String(r.number), customer_id: String(r.customer_id), status: String(r.status), product_id: String(r.product_id), quantity: String(r.quantity), unit_price: String(r.unit_price), quote_cost: S(r.quote_cost), new_cost: String(r.new_cost), margin_before: S(r.margin_before), margin_after: String(r.margin_after) })), grid: page.grid };
}

/** Optional receipt-date range for variance. */
function period(input: { from?: unknown; to?: unknown }) {
  const out: string[] = [];
  for (const [k, op] of [["from", ">="], ["to", "<="]] as const) {
    const v = input[k]; if (v === undefined || v === null || v === "") continue;
    try { validDate(String(v)); } catch { bad(); }
    out.push(`receipt_date ${op} DATE ${Q(String(v))}`);
  }
  return out.length ? `WHERE ${out.join(" AND ")}` : "";
}
export const PPV_GRID: GridSpec = { product_id: "text", description: "text", category: "text", receipts: "int", suppliers: "int", quantity: "decimal", spend: "money", min_unit: "money", max_unit: "money", spread: "money", avg_unit: "money", standard: "money", variance: "money" };
/** Purchase price variance by SKU from the Purchases import (7D-2). Unit costs come from receipts only; returns
 * and credit memos change net quantity and spend. Variance = net spend − net quantity × standard cost (the item
 * master's current cost), rounded half away from zero to the cent: positive means paid above standard. */
export async function ppv(e: Engine, input: { from?: unknown; to?: unknown } = {}, offset = 0, grid?: unknown) {
  const unit = divRoundSql("CAST(amount_cents AS HUGEINT) * 10000", "CAST(quantity * 10000 AS HUGEINT)");
  const base = `WITH r AS (SELECT * FROM purchases ${period(input)}),
s AS (SELECT product_id, count(*) FILTER (WHERE entry_kind = 'receipt') AS receipts, count(DISTINCT supplier) AS suppliers, sum(quantity) AS qty, sum(amount_cents) AS spend,
 min(${unit}) FILTER (WHERE entry_kind = 'receipt') AS min_unit, max(${unit}) FILTER (WHERE entry_kind = 'receipt') AS max_unit,
 sum(amount_cents) FILTER (WHERE entry_kind = 'receipt') AS r_spend, sum(quantity) FILTER (WHERE entry_kind = 'receipt') AS r_qty FROM r GROUP BY 1)
SELECT s.product_id, coalesce(p.description, '') AS description, coalesce(p.category, '') AS category, s.receipts::VARCHAR AS receipts, s.suppliers::VARCHAR AS suppliers,
 s.qty::VARCHAR AS quantity, s.spend::VARCHAR AS spend, s.min_unit::VARCHAR AS min_unit, s.max_unit::VARCHAR AS max_unit, (s.max_unit - s.min_unit)::VARCHAR AS spread,
 ${divRoundSql("CAST(s.r_spend AS HUGEINT) * 10000", "CAST(s.r_qty * 10000 AS HUGEINT)")}::VARCHAR AS avg_unit, p.current_cost::VARCHAR AS standard,
 CASE WHEN p.current_cost IS NULL THEN NULL ELSE (s.spend - ${rhaSql("CAST(s.qty * 10000 AS HUGEINT) * p.current_cost", "10000")})::VARCHAR END AS variance
FROM s LEFT JOIN products p ON p.product_id = s.product_id`;
  const t = (await rows(e, `SELECT count(*)::VARCHAR AS skus, count(*) FILTER (WHERE CAST(suppliers AS INTEGER) > 1)::VARCHAR AS multi, count(*) FILTER (WHERE CAST(spread AS BIGINT) > 0)::VARCHAR AS spread,
 coalesce(sum(CAST(variance AS HUGEINT)), 0)::VARCHAR AS variance, count(*) FILTER (WHERE variance IS NULL)::VARCHAR AS no_standard FROM (${base}) z`))[0];
  const page = await gridPage(e, base, PPV_GRID, gridQuery(PPV_GRID, grid), { fallback: "g.product_id", limit: 50, offset });
  return { offset, totals: { skus: String(t.skus), multiSupplier: String(t.multi), spread: String(t.spread), variance: String(t.variance), noStandard: String(t.no_standard) },
    rows: page.rows.map(r => ({ product_id: String(r.product_id), description: String(r.description), category: String(r.category), receipts: String(r.receipts), suppliers: String(r.suppliers), quantity: String(r.quantity), spend: String(r.spend), min_unit: S(r.min_unit), max_unit: S(r.max_unit), spread: S(r.spread), avg_unit: S(r.avg_unit), standard: S(r.standard), variance: S(r.variance) })), grid: page.grid as GridMeta };
}
export const PPV_LINE_GRID: GridSpec = { receipt_date: "date", supplier: "text", receipt_ref: "text", entry_kind: "text", quantity: "decimal", amount: "money", unit: "money", standard: "money", variance: "money" };
/** The purchase lines behind one SKU's variance. */
export async function ppvLines(e: Engine, product: unknown, input: { from?: unknown; to?: unknown } = {}, offset = 0, grid?: unknown) {
  if (typeof product !== "string" || !product || product.length > 200) bad();
  const where = period(input), cond = `${where ? where + " AND" : "WHERE"} product_id = ${Q(product as string)}`;
  const base = `SELECT r.source_id || '|' || r.line_id AS key, r.receipt_date::VARCHAR AS receipt_date, r.supplier, r.receipt_ref, r.entry_kind, r.quantity::VARCHAR AS quantity, r.amount_cents::VARCHAR AS amount,
 CASE WHEN r.entry_kind = 'receipt' THEN ${divRoundSql("CAST(r.amount_cents AS HUGEINT) * 10000", "CAST(r.quantity * 10000 AS HUGEINT)")}::VARCHAR END AS unit, p.current_cost::VARCHAR AS standard,
 CASE WHEN p.current_cost IS NULL THEN NULL ELSE (r.amount_cents - ${rhaSql("CAST(r.quantity * 10000 AS HUGEINT) * p.current_cost", "10000")})::VARCHAR END AS variance, r.source_id, r.line_id
FROM (SELECT * FROM purchases ${cond}) r LEFT JOIN products p ON p.product_id = r.product_id`;
  const page = await gridPage(e, base, PPV_LINE_GRID, gridQuery(PPV_LINE_GRID, grid), { fallback: "CAST(g.receipt_date AS DATE), g.source_id, g.line_id", limit: 50, offset });
  return { product, offset, rows: page.rows.map(r => ({ key: String(r.key), receipt_date: String(r.receipt_date), supplier: String(r.supplier), receipt_ref: String(r.receipt_ref), entry_kind: String(r.entry_kind), quantity: String(r.quantity), amount: String(r.amount), unit: S(r.unit), standard: S(r.standard), variance: S(r.variance) })), grid: page.grid };
}
