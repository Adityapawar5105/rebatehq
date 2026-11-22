import {hasSupplier} from '../rebate/input';
// Item master cleanup assistant. It never edits invoice facts: it merges look-alike product
// IDs, spells units one way and fills missing categories, and every fix keeps the cells it
// changed in cleanup_changes so it can be undone. Fixes are computed here as SQL; the service
// runs them in a transaction with an audit entry, then rebuilds the margin pre-aggregate.
import { programs as rebatePrograms } from "../rebate/store";
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { VaultError } from "../vault/protocol";
import { CANONICAL_UNITS, canonicalUnit } from "./uom";
import { msg } from "../i18n/core";
import { NOTE_LIMIT, noteLength } from "../notes/notes";
/** Vaults from schema v15 on have row notes; older fixtures and journals do not. */
const hasColumn = async (e: Engine, column: string) => Number((await rows(e, `SELECT count(*) AS n FROM information_schema.columns WHERE table_name='products' AND column_name='${column}'`))[0].n) > 0;
const hasNotes = (e: Engine) => hasColumn(e, "notes");
// Phase 16 audit (22 Nov 2026): the v22 barcode was neither moved to the kept item nor journalled, so a merge lost a
// duplicate's barcode for good (a counter scanner then missed the item) and undo could not bring it back.
const hasBarcode = (e: Engine) => hasColumn(e, "barcode");
export type FixKind = "merge_duplicates" | "normalize_uom" | "set_category";
export const MAX_MERGE_LINES = 250_000;
const GROUP_LIMIT = 100, MEMBER_LIMIT = 5000;
const bad = (text: string): never => { throw new VaultError("CLEANUP", text); };
const rows = async (e: Engine, sql: string): Promise<Record<string, any>[]> => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)));
export type DuplicateGroup = { key: string; confidence: "certain" | "possible"; canonical: string; lines: string; members: Array<{ product: string; lines: string; fromItemMaster: boolean }> };
export type UnitIssue = { from: string; to: string | null; products: string; examples: string[]; kind: "spelling" | "unknown" | "missing" };
export type CategoryIssue = { key: string; products: string; suggestion: string | null; support: string; examples: string[] };
export type Scan = { duplicates: DuplicateGroup[]; units: UnitIssue[]; categories: CategoryIssue[]; unitChoices: string[]; totals: { duplicateProducts: string; unitProducts: string; uncategorised: string }; truncated: boolean };
export type FixView = { id: string; kind: FixKind; summary: string; cells: string; appliedAt: string; appliedBy: string; undoneAt: string | null };
const K2 = "upper(regexp_replace(p.product_id, '[^A-Za-z0-9]', '', 'g'))", PREFIX = "upper(regexp_extract(p.product_id, '^[A-Za-z0-9]+', 0))";
/** The canonical member: most invoice lines, then one that came from an item master file, then the smallest ID. */
function pickCanonical(members: DuplicateGroup["members"]) {
  return [...members].sort((a, b) => Number(BigInt(b.lines) - BigInt(a.lines)) || Number(b.fromItemMaster) - Number(a.fromItemMaster) || (a.product < b.product ? -1 : 1))[0];
}
async function duplicateGroups(e: Engine, only?: string): Promise<{ groups: DuplicateGroup[]; truncated: boolean }> {
  const found = await rows(e, `WITH l AS (SELECT product_id, sum(lines) AS n FROM agg_p GROUP BY product_id),
m AS (SELECT p.product_id, upper(trim(p.product_id)) AS k1, ${K2} AS k2, p.source_id IS NOT NULL AS src, coalesce(l.n, 0) AS n FROM products p LEFT JOIN l ON l.product_id = p.product_id),
g AS (SELECT k2, count(*) AS c, count(DISTINCT k1) AS d FROM m WHERE k2 <> '' ${only ? `AND k2 = ${Q(only)}` : ""} GROUP BY k2 HAVING count(*) > 1)
SELECT m.product_id, m.k2, m.src, m.n::VARCHAR AS n, g.d::VARCHAR AS d FROM m JOIN g USING (k2) ORDER BY m.k2, m.product_id LIMIT ${MEMBER_LIMIT}`);
  const byKey = new Map<string, DuplicateGroup>();
  for (const r of found) {
    const g = byKey.get(r.k2) ?? { key: String(r.k2), confidence: r.d === "1" ? "certain" : "possible", canonical: "", lines: "0", members: [] } as DuplicateGroup;
    g.members.push({ product: String(r.product_id), lines: String(r.n), fromItemMaster: !!r.src }); byKey.set(g.key, g);
  }
  const groups = [...byKey.values()].map(g => ({ ...g, canonical: pickCanonical(g.members).product, lines: String(g.members.reduce((s, m) => s + BigInt(m.lines), BigInt(0))) }));
  return { groups: groups.sort((a, b) => Number(BigInt(b.lines) - BigInt(a.lines)) || (a.key < b.key ? -1 : 1)), truncated: found.length >= MEMBER_LIMIT };
}
export async function scan(e: Engine): Promise<Scan> {
  const dup = await duplicateGroups(e);
  const unitRows = await rows(e, `SELECT uom, count(*)::VARCHAR AS n, string_agg(product_id, ' | ' ORDER BY product_id) FILTER (WHERE rn <= 3) AS ex FROM (SELECT uom, product_id, row_number() OVER (PARTITION BY uom ORDER BY product_id) AS rn FROM products) GROUP BY uom ORDER BY count(*) DESC, uom LIMIT 500`);
  const units: UnitIssue[] = [];
  for (const r of unitRows) {
    const from = String(r.uom), to = canonicalUnit(from), blank = from.trim() === "";
    // A spelling that is already the canonical code needs nothing; unknown units are reported, never guessed.
    if (to === from) continue;
    units.push({ from, to, products: String(r.n), examples: String(r.ex ?? "").split(" | ").filter(Boolean), kind: blank ? "missing" : to ? "spelling" : "unknown" });
  }
  const catRows = await rows(e, `WITH p AS (SELECT p.product_id, p.category, ${PREFIX} AS pre FROM products p),
known AS (SELECT pre, category, count(*) AS n FROM p WHERE category <> '' AND pre <> '' GROUP BY pre, category),
tot AS (SELECT pre, sum(n) AS t FROM known GROUP BY pre),
best AS (SELECT pre, arg_max(category, n) AS category, max(n) AS n FROM known GROUP BY pre),
miss AS (SELECT pre, product_id, row_number() OVER (PARTITION BY pre ORDER BY product_id) AS rn FROM p WHERE category = '' AND pre <> '')
SELECT m.pre, count(*)::VARCHAR AS products, string_agg(m.product_id, ' | ' ORDER BY m.product_id) FILTER (WHERE m.rn <= 3) AS ex, b.category AS suggestion, coalesce(b.n, 0)::VARCHAR AS support, coalesce(t.t, 0)::VARCHAR AS total
FROM miss m LEFT JOIN best b USING (pre) LEFT JOIN tot t USING (pre) GROUP BY m.pre, b.category, b.n, t.t ORDER BY count(*) DESC, m.pre LIMIT ${GROUP_LIMIT}`);
  const categories: CategoryIssue[] = catRows.map(r => {
    // Suggest only with real evidence: three or more categorised products with the same ID prefix, two thirds of them agreeing.
    const support = BigInt(r.support), total = BigInt(r.total), ok = r.suggestion && support >= BigInt(3) && support * BigInt(3) >= total * BigInt(2);
    return { key: String(r.pre), products: String(r.products), suggestion: ok ? String(r.suggestion) : null, support: String(r.support), examples: String(r.ex ?? "").split(" | ").filter(Boolean) };
  });
  const uncategorised = (await rows(e, "SELECT count(*)::VARCHAR AS n FROM products WHERE category = ''"))[0].n;
  return { duplicates: dup.groups.slice(0, GROUP_LIMIT), units, categories, unitChoices: CANONICAL_UNITS, truncated: dup.truncated || dup.groups.length > GROUP_LIMIT,
    totals: { duplicateProducts: String(dup.groups.reduce((s, g) => s + g.members.length - 1, 0)), unitProducts: String(units.reduce((s, u) => s + Number(u.products), 0)), uncategorised: String(uncategorised) } };
}
export async function history(e: Engine): Promise<FixView[]> {
  return (await rows(e, "SELECT id, kind, summary, cells::VARCHAR AS cells, applied_at, applied_by, undone_at FROM cleanup_fixes ORDER BY applied_at DESC, id LIMIT 50"))
    .map(r => ({ id: String(r.id), kind: r.kind as FixKind, summary: String(r.summary), cells: String(r.cells), appliedAt: String(r.applied_at), appliedBy: String(r.applied_by), undoneAt: r.undone_at === null ? null : String(r.undone_at) }));
}
export type Plan = { fixId: string; kind: FixKind; summary: string; cells: number; sql: string; finishSql: string };
const LINE_COLS = "source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind";
const lit = (v: unknown) => v === null || v === undefined ? "CAST(NULL AS VARCHAR)" : Q(String(v));
const header = (id: string, kind: FixKind, summary: string, cells: number, at: string, actor: string) => `INSERT INTO cleanup_fixes VALUES(${Q(id)},${Q(kind)},${Q(summary)},${cells},${Q(at)},${Q(actor)},NULL,NULL);`;
const journal = (id: string, parts: string[]) => `INSERT INTO cleanup_changes SELECT ${Q(id)}, row_number() OVER (ORDER BY o, t, k1, coalesce(k2,''), c), t, k1, k2, c, b, a FROM (${parts.join(" UNION ALL ")});`;
const BUMP = "UPDATE vault_meta SET pricing_revision=pricing_revision+1 WHERE id=1;";
/** Plan one fix. `key` names a group from the latest scan; the plan is recomputed from the vault, never from the client's list. */
export async function plan(e: Engine, kind: FixKind, key: string, target: string | null, actor: string, at: string): Promise<Plan> {
  const id = crypto.randomUUID();
  if (typeof key !== "string" || key.length > 200) return bad(msg("itemfix.chooseAGroupFrom"));
  if (kind === "normalize_uom") {
    const to = target ?? canonicalUnit(key);
    if (!to || !CANONICAL_UNITS.includes(to)) return bad(msg("itemfix.chooseTheUnitTo"));
    if (to === key) return bad(msg("itemfix.thatUnitIsAlready"));
    const n = Number((await rows(e, `SELECT count(*) AS n FROM products WHERE uom = ${Q(key)}`))[0].n);
    if (!n) return bad(msg("itemfix.noProductsUseThat"));
    const summary = msg("itemfix.spellUnit", { unit: key || msg("itemfix.blank"), to, count: n });
    return { fixId: id, kind, summary, cells: n, finishSql: "", sql: `${header(id, kind, summary, n, at, actor)}
${journal(id, [`SELECT 1 AS o, 'products' AS t, product_id AS k1, CAST(NULL AS VARCHAR) AS k2, 'uom' AS c, uom AS b, ${Q(to)} AS a FROM products WHERE uom = ${Q(key)}`])}
UPDATE products SET uom = ${Q(to)} WHERE uom = ${Q(key)}; ${BUMP}` };
  }
  if (kind === "set_category") {
    const found = (await scan(e)).categories.find(c => c.key === key);
    if (!found) return bad(msg("itemfix.noUncategorisedProductsWith"));
    const category = (target ?? found!.suggestion ?? "").trim();
    if (!category) return bad(msg("itemfix.chooseACategoryThere"));
    if (category.length > 160 || /[\x00-\x1f]/.test(category)) return bad(msg("itemfix.useACategoryOf"));
    const n = Number(found!.products), summary = msg("itemfix.setCategory", { category, count: n, prefix: key });
    const where = `category = '' AND ${PREFIX.replaceAll("p.", "")} = ${Q(key)}`;
    return { fixId: id, kind, summary, cells: n, finishSql: "", sql: `${header(id, kind, summary, n, at, actor)}
${journal(id, [`SELECT 1 AS o, 'products' AS t, product_id AS k1, CAST(NULL AS VARCHAR) AS k2, 'category' AS c, category AS b, ${Q(category)} AS a FROM products WHERE ${where}`])}
UPDATE products SET category = ${Q(category)} WHERE ${where}; ${BUMP}` };
  }
  if (kind !== "merge_duplicates") return bad(msg("itemfix.unsupportedFix"));
  const group = (await duplicateGroups(e, key)).groups[0];
  if (!group || group.members.length < 2) return bad(msg("itemfix.thatGroupNoLonger"));
  const canon = group.canonical, dups = group.members.map(m => m.product).filter(p => p !== canon), list = dups.map(Q).join(","), canonQ = Q(canon);
  const involved = new Set(group.members.map(m=>m.product));
  if((await rebatePrograms(e)).some(p=>[...p.eligible,...p.excluded].some(s=>involved.has(s))))return bad(msg('rebate.skuMergeBlocked'));
  if(await hasSupplier(e)){const n=(await rows(e,`SELECT count(*)::VARCHAR n FROM purchases WHERE product_id IN(${[...involved].map(Q).join(',')})`))[0].n;if(n!=='0')return bad(msg('supplier.mergeBlocked'));}
  const moved = Number((await rows(e, `SELECT count(*) AS n FROM sales_lines WHERE product_id IN (${list})`))[0].n);
  if (moved > MAX_MERGE_LINES) return bad(msg("itemfix.thisMergeWouldMove", { moved, maxmergelines: MAX_MERGE_LINES }));
  const vendor = Number((await rows(e, `SELECT count(*) AS n FROM vendor_costs WHERE product_id IN (${list})`))[0].n), price = Number((await rows(e, `SELECT count(*) AS n FROM price_matrix WHERE product_id IN (${list})`))[0].n);
  // Fill the canonical product's empty fields from the duplicates (largest first), keeping what it already has.
  const withBarcode = await hasBarcode(e), barcodeCol = withBarcode ? ", barcode" : "";
  const have = (await rows(e, `SELECT description, category, current_cost::VARCHAR AS current_cost, list_price::VARCHAR AS list_price${barcodeCol} FROM products WHERE product_id = ${canonQ}`))[0];
  const donors = await rows(e, `SELECT product_id, description, category, current_cost::VARCHAR AS current_cost, list_price::VARCHAR AS list_price${barcodeCol} FROM products WHERE product_id IN (${list})`);
  const order = new Map(group.members.map(m => [m.product, BigInt(m.lines)])), sorted = donors.sort((a, b) => Number(order.get(b.product_id)! - order.get(a.product_id)!) || (a.product_id < b.product_id ? -1 : 1));
  const fills: Array<{ col: string; before: string | null; after: string; sql: string }> = [];
  for (const col of ["description", "category", "current_cost", "list_price", ...(withBarcode ? ["barcode"] : [])]) {
    const empty = have[col] === null || have[col] === "", donor = sorted.find(d => d[col] !== null && d[col] !== "");
    if (empty && donor) fills.push({ col, before: have[col] === null ? null : String(have[col]), after: String(donor[col]), sql: col === "current_cost" || col === "list_price" ? `${col} = ${donor[col]}` : `${col} = ${Q(donor[col])}` });
  }
  // 7V-3b row notes: the duplicates' notes are journalled with their rows, and appended to the kept product's
  // note (largest duplicate first). A combined note over the limit stops the merge; undo restores every note.
  const withNotes = await hasNotes(e);
  if (withNotes) {
    const own = (await rows(e, `SELECT notes FROM products WHERE product_id = ${canonQ}`))[0]?.notes ?? null;
    const extra = await rows(e, `SELECT product_id, notes FROM products WHERE product_id IN (${list}) AND coalesce(notes,'') <> ''`);
    const parts = [own, ...sorted.map(d => extra.find(x => x.product_id === d.product_id)?.notes).filter(n => n !== undefined)].filter((n): n is string => typeof n === "string" && n !== "");
    const combined = parts.join("\n");
    if (extra.length) {
      if (noteLength(combined) > NOTE_LIMIT) return bad(msg("notes.mergeTooLong", { limit: NOTE_LIMIT }));
      fills.push({ col: "notes", before: own === null ? null : String(own), after: combined, sql: `notes = ${Q(combined)}` });
    }
  }
  const PCOLS = ["description", "category", "uom", "current_cost", "list_price", "source_id", "source_row", ...(withNotes ? ["notes"] : []), ...(withBarcode ? ["barcode"] : [])];
  const parts = [
    ...PCOLS.map(c => `SELECT 1 AS o, 'products' AS t, product_id AS k1, CAST(NULL AS VARCHAR) AS k2, '${c}' AS c, CAST(${c} AS VARCHAR) AS b, CAST(NULL AS VARCHAR) AS a FROM products WHERE product_id IN (${list})`),
    `SELECT 1, 'products', product_id, CAST(NULL AS VARCHAR), '*row', product_id, CAST(NULL AS VARCHAR) FROM products WHERE product_id IN (${list})`,
    ...fills.map(f => `SELECT 2, 'products', ${canonQ}, CAST(NULL AS VARCHAR), '${f.col}', ${lit(f.before)}, ${lit(f.after)}`),
    `SELECT 3, 'sales_lines', source_id, CAST(line_id AS VARCHAR), 'product_id', product_id, ${canonQ} FROM sales_lines WHERE product_id IN (${list})`,
    `SELECT 4, 'vendor_costs', id, CAST(NULL AS VARCHAR), 'product_id', product_id, ${canonQ} FROM vendor_costs WHERE product_id IN (${list})`,
    `SELECT 5, 'price_matrix', id, CAST(NULL AS VARCHAR), 'product_id', product_id, ${canonQ} FROM price_matrix WHERE product_id IN (${list})`,
  ];
  const cells = moved + vendor + price + dups.length + fills.length;
  const summary = msg("itemfix.merge", { count: dups.length, ids: dups.join(", "), canon, moved: msg("itemfix.linesMoved", { count: moved }) });
  // DuckDB refuses to delete a product row in the same transaction that re-pointed its invoice lines,
  // so the duplicates are removed in a second step (finishSql). Re-running the merge finishes it.
  return { fixId: id, kind, summary, cells, sql: `${header(id, kind, summary, cells, at, actor)}
${journal(id, parts)}
DROP TABLE IF EXISTS md_cleanup_lines; CREATE TEMP TABLE md_cleanup_lines AS SELECT * FROM sales_lines WHERE product_id IN (${list});
DELETE FROM sales_lines WHERE product_id IN (${list});
INSERT INTO sales_lines(${LINE_COLS}) SELECT source_id,line_id,${canonQ},customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind FROM md_cleanup_lines;
DROP TABLE md_cleanup_lines;
UPDATE vendor_costs SET product_id = ${canonQ} WHERE product_id IN (${list});
UPDATE price_matrix SET product_id = ${canonQ} WHERE product_id IN (${list});
${fills.map(f => `UPDATE products SET ${f.sql} WHERE product_id = ${canonQ};`).join("\n")} ${BUMP}`, finishSql: `DELETE FROM products WHERE product_id IN (${list});` };
}
export type UndoPlan = { kind: FixKind; summary: string; restored: number; skipped: number; sql: string };
/** Undo one fix: restore only the cells that still hold the value the fix wrote; later changes are left alone and counted. */
export async function undoPlan(e: Engine, fixId: string, actor: string, at: string): Promise<UndoPlan> {
  const fix = (await rows(e, `SELECT kind, summary, cells, undone_at FROM cleanup_fixes WHERE id = ${Q(fixId)}`))[0];
  if (!fix) return bad(msg("itemfix.thatFixIsNot"));
  if (fix.undone_at !== null) return bad(msg("itemfix.thatFixWasAlready"));
  const id = Q(fixId), kind = fix.kind as FixKind, mark = `UPDATE cleanup_fixes SET undone_at = ${Q(at)}, undone_by = ${Q(actor)} WHERE id = ${id}; ${BUMP}`;
  const count = async (sql: string) => Number((await rows(e, sql))[0].n);
  if (kind !== "merge_duplicates") {
    const col = kind === "normalize_uom" ? "uom" : "category";
    const restored = await count(`SELECT count(*) AS n FROM cleanup_changes j JOIN products p ON p.product_id = j.key1 WHERE j.fix_id = ${id} AND j.col = '${col}' AND p.${col} = j.after_value`);
    return { kind, summary: String(fix.summary), restored, skipped: Number(fix.cells) - restored, sql: `UPDATE products SET ${col} = j.before_value FROM cleanup_changes j WHERE j.fix_id = ${id} AND j.col = '${col}' AND j.key1 = products.product_id AND products.${col} = j.after_value; ${mark}` };
  }
  const lines = await count(`SELECT count(*) AS n FROM cleanup_changes j JOIN sales_lines s ON s.source_id = j.key1 AND CAST(s.line_id AS VARCHAR) = j.key2 AND s.product_id = j.after_value WHERE j.fix_id = ${id} AND j.tbl = 'sales_lines'`);
  const vendor = await count(`SELECT count(*) AS n FROM cleanup_changes j JOIN vendor_costs v ON v.id = j.key1 AND v.product_id = j.after_value WHERE j.fix_id = ${id} AND j.tbl = 'vendor_costs'`);
  const price = await count(`SELECT count(*) AS n FROM cleanup_changes j JOIN price_matrix v ON v.id = j.key1 AND v.product_id = j.after_value WHERE j.fix_id = ${id} AND j.tbl = 'price_matrix'`);
  const fillCols = (await rows(e, `SELECT col FROM cleanup_changes WHERE fix_id = ${id} AND tbl = 'products' AND after_value IS NOT NULL`)).map(r => String(r.col));
  const restoredProducts = await count(`SELECT count(*) AS n FROM cleanup_changes WHERE fix_id = ${id} AND col = '*row' AND key1 NOT IN (SELECT product_id FROM products)`);
  const restored = lines + vendor + price + restoredProducts + fillCols.length;
  const field = (c: string) => `max(CASE WHEN col = '${c}' THEN before_value END)`;
  const fillSql = fillCols.map(col => { const num = col === "current_cost" || col === "list_price", cast = (x: string) => num ? `CAST(${x} AS BIGINT)` : x;
    return `UPDATE products SET ${col} = ${cast("j.before_value")} FROM cleanup_changes j WHERE j.fix_id = ${id} AND j.tbl = 'products' AND j.col = '${col}' AND j.key1 = products.product_id AND j.after_value IS NOT NULL AND products.${col} = ${cast("j.after_value")};`; }).join("\n");
  const withNotes = await hasNotes(e), withBarcode = await hasBarcode(e);
  return { kind, summary: String(fix.summary), restored, skipped: Math.max(0, Number(fix.cells) - restored), sql: `INSERT INTO products(product_id,description,category,uom,current_cost,list_price,source_id,source_row${withNotes ? ",notes" : ""}${withBarcode ? ",barcode" : ""})
SELECT key1, coalesce(${field("description")}, ''), coalesce(${field("category")}, ''), coalesce(${field("uom")}, 'EA'), CAST(${field("current_cost")} AS BIGINT), CAST(${field("list_price")} AS BIGINT), ${field("source_id")}, CAST(${field("source_row")} AS BIGINT)${withNotes ? `, ${field("notes")}` : ""}${withBarcode ? `, ${field("barcode")}` : ""}
FROM cleanup_changes WHERE fix_id = ${id} AND tbl = 'products' AND key1 IN (SELECT key1 FROM cleanup_changes WHERE fix_id = ${id} AND col = '*row') AND key1 NOT IN (SELECT product_id FROM products) GROUP BY key1;
${fillSql}
DROP TABLE IF EXISTS md_cleanup_lines;
CREATE TEMP TABLE md_cleanup_lines AS SELECT s.*, j.before_value AS old FROM sales_lines s JOIN cleanup_changes j ON j.fix_id = ${id} AND j.tbl = 'sales_lines' AND j.key1 = s.source_id AND j.key2 = CAST(s.line_id AS VARCHAR) AND s.product_id = j.after_value;
DELETE FROM sales_lines WHERE (source_id, line_id) IN (SELECT source_id, line_id FROM md_cleanup_lines);
INSERT INTO sales_lines(${LINE_COLS}) SELECT source_id,line_id,old,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind FROM md_cleanup_lines;
DROP TABLE md_cleanup_lines;
UPDATE vendor_costs SET product_id = j.before_value FROM cleanup_changes j WHERE j.fix_id = ${id} AND j.tbl = 'vendor_costs' AND j.key1 = vendor_costs.id AND vendor_costs.product_id = j.after_value;
UPDATE price_matrix SET product_id = j.before_value FROM cleanup_changes j WHERE j.fix_id = ${id} AND j.tbl = 'price_matrix' AND j.key1 = price_matrix.id AND price_matrix.product_id = j.after_value;
${mark}` };
}

