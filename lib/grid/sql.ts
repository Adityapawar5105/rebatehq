// Worker side of the grid standard (chunk 7V-3a). A paged command keeps its own SQL as `base` (no ORDER BY or
// LIMIT) and this module wraps it: filter, sort, page, count, distinct values and exact totals all run in
// DuckDB over the whole result, so a 1,000,000-row grid never reaches the main thread. Column names come only
// from the command's code-defined spec; user values are quoted. Never formula evaluation.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { sqlText as Q } from "../spike/exact";
import { applyQuery, distinctOf, average, checkQuery, GridInputError, GRID_DISTINCT_LIMIT, GRID_TOTAL_COLS, GRID_TOTAL_ROWS, isNumeric, NUMBER, type ClientColumn, type GridMeta, type GridQuery, type GridSpec, type GridType, type Totals } from "./core";

const rows = async (e: Engine, sql: string): Promise<Record<string, unknown>[]> => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)));
const bad = (): never => { throw new VaultError("FILTER", msg("grid.invalid")); };
/** Validates a grid query from the UI; a bad column or value is a FILTER error, never SQL. */
export function gridQuery(spec: GridSpec, input: unknown): GridQuery {
  try { return checkQuery(spec, input); } catch (e) { if (e instanceof GridInputError) bad(); throw e; }
}
const ref = (col: string) => `g."${col}"`;
const asText = (expr: string) => `CAST(${expr} AS VARCHAR)`;
/** The typed value of a raw column for ordering and aggregates. Text compares case- and accent-insensitively. */
function typed(expr: string, type: GridType) {
  switch (type) {
    case "int": case "money": return `TRY_CAST(${expr} AS HUGEINT)`;
    case "decimal": case "percent": return `TRY_CAST(${expr} AS DECIMAL(38,10))`;
    case "date": return `TRY_CAST(${asText(expr)} AS TIMESTAMP)`;
    default: return `${asText(expr)} COLLATE NOACCENT.NOCASE`;
  }
}
/** WHERE conditions for every filter, optionally leaving one column out (its own distinct list). */
function conditions(q: GridQuery, skip?: string) {
  return (q.filters ?? []).filter(f => f.col !== skip).map(f => {
    const vals = f.values.filter((v): v is string => v !== null), blanks = f.values.length !== vals.length;
    const parts = [vals.length ? `${asText(ref(f.col))} IN (${vals.map(Q).join(",")})` : "", blanks ? `${ref(f.col)} IS NULL` : ""].filter(Boolean);
    return parts.length ? `(${parts.join(" OR ")})` : "FALSE";
  });
}
const where = (c: string[]) => c.length ? `WHERE ${c.join(" AND ")}` : "";
/** ORDER BY for the user's sort, before the command's own default order (which keeps ties stable). */
function order(spec: GridSpec, q: GridQuery, fallback: string) {
  const s = q.sort; if (!s) return fallback;
  return `${typed(ref(s.col), spec[s.col])} ${s.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, ${fallback}`;
}
function trim(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v); return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

/** One page of a worker grid plus the counts and any distinct values or totals the query asked for.
 * `fallback` is the command's default ORDER BY in terms of `g.` columns and must end in a unique key. */
export async function gridPage(e: Engine, base: string, spec: GridSpec, q: GridQuery, page: { fallback: string; limit: number; offset: number }) {
  const c = conditions(q), limit = Math.max(1, Math.min(500, Math.floor(page.limit))), offset = Math.max(0, Math.min(10_000_000, Math.floor(page.offset)));
  const data = await rows(e, `SELECT * FROM (${base}) g ${where(c)} ORDER BY ${order(spec, q, page.fallback)} LIMIT ${limit} OFFSET ${offset}`);
  return { rows: data, grid: await gridMeta(e, base, spec, q) };
}
/** Counts, distinct values and totals for a worker grid, without a page. */
export async function gridMeta(e: Engine, base: string, spec: GridSpec, q: GridQuery): Promise<GridMeta> {
  const c = conditions(q);
  const n = (await rows(e, `SELECT count(*)::VARCHAR AS total, count(*) FILTER (WHERE ${c.length ? c.join(" AND ") : "TRUE"})::VARCHAR AS matched FROM (${base}) g`))[0];
  const meta: GridMeta = { matched: String(n.matched), total: String(n.total) };
  if (q.distinct) {
    const col = q.distinct.col, own = conditions(q, col), needle = q.distinct.search?.trim();
    if (needle) own.push(`contains(lower(${asText(ref(col))}), lower(${Q(needle)}))`);
    const list = await rows(e, `SELECT ${asText(ref(col))} AS v, count(*)::VARCHAR AS n FROM (${base}) g ${where(own)} GROUP BY 1 ORDER BY ${typed("v", spec[col])} ASC NULLS FIRST LIMIT ${GRID_DISTINCT_LIMIT + 1}`);
    meta.distinct = { values: list.slice(0, GRID_DISTINCT_LIMIT).map(r => ({ value: r.v === null ? null : String(r.v), count: String(r.n) })), more: list.length > GRID_DISTINCT_LIMIT };
  }
  if (q.totals?.length) meta.totals = await totalsSql(e, `SELECT * FROM (${base}) g ${where(c)}`, q.totals.map(col => ({ key: col, expr: `x."${col}"`, type: spec[col] })));
  return meta;
}
async function totalsSql(e: Engine, from: string, cols: { key: string; expr: string; type: GridType }[]): Promise<Record<string, Totals>> {
  if (!cols.length) return {};
  const sel = cols.flatMap((c, i) => { const v = typed(c.expr, c.type); return [`count(${v})::VARCHAR AS c${i}`, `coalesce(sum(${v}),0)::VARCHAR AS s${i}`, `min(${v})::VARCHAR AS lo${i}`, `max(${v})::VARCHAR AS hi${i}`]; });
  const r = (await rows(e, `SELECT ${sel.join(",")} FROM (${from}) x`))[0];
  const out: Record<string, Totals> = {};
  cols.forEach((c, i) => {
    if (!isNumeric(c.type)) return;
    const count = String(r[`c${i}`]), sum = trim(r[`s${i}`]) ?? "0";
    out[c.key] = { count, sum, avg: average(c.type, sum, count), min: trim(r[`lo${i}`]), max: trim(r[`hi${i}`]) };
  });
  return out;
}
/** SUM/AVG/MIN/MAX/COUNT of the rows a person selected in a browser-held grid. The values are the ones the
 * grid already shows that person, so no column is revealed that the role cannot see. Computed by DuckDB. */
export async function valuesTotals(e: Engine, types: unknown, values: unknown, maxRows = GRID_TOTAL_ROWS): Promise<Totals[]> {
  if (!Array.isArray(types) || !types.length || types.length > GRID_TOTAL_COLS || !types.every(t => typeof t === "string" && isNumeric(t as GridType))) bad();
  if (!Array.isArray(values) || values.length > maxRows) bad();
  const t = types as GridType[];
  const lit = (v: unknown) => v === null ? "NULL" : typeof v === "string" && NUMBER.test(v) ? Q(v) : bad();
  const body = (values as unknown[]).map(row => { if (!Array.isArray(row) || row.length !== t.length) bad(); return `(${(row as unknown[]).map(lit).join(",")})`; });
  const names = t.map((_, i) => `v${i}`);
  const from = body.length ? `SELECT * FROM (VALUES ${body.join(",")}) AS v(${names.join(",")})` : `SELECT ${names.map(n => `NULL::VARCHAR AS ${n}`).join(",")} WHERE FALSE`;
  const out = await totalsSql(e, from, t.map((type, i) => ({ key: names[i], expr: `x.${names[i]}`, type })));
  return names.map(n => out[n]);
}

/** Text in worker-held grids sorts with this collation (the UI language is not known in the worker). */
const WORKER_LOCALE = "en";
/** A grid over rows the worker already holds in memory (a price-grid draft). Same rules as gridPage;
 * totals still go through DuckDB. */
export async function memoryPage<R>(e: Engine, all: R[], cols: (ClientColumn<R>)[], spec: GridSpec, q: GridQuery, page: { limit: number; offset: number }) {
  const shown = applyQuery(all, cols, q, WORKER_LOCALE), offset = Math.max(0, Math.floor(page.offset));
  const meta: GridMeta = { matched: String(shown.length), total: String(all.length) };
  if (q.distinct) meta.distinct = distinctOf(all, cols, q, q.distinct.col, WORKER_LOCALE, q.distinct.search ?? "");
  const want = (q.totals ?? []).map(id => cols.find(c => c.id === id)).filter((c): c is ClientColumn<R> => !!c && isNumeric(spec[c.id]));
  if (want.length) {
    const list = await valuesTotals(e, want.map(c => spec[c.id]), shown.map(r => want.map(c => { const v = c.value(r); return v !== null && NUMBER.test(v) ? v : null; })), Number.MAX_SAFE_INTEGER);
    meta.totals = Object.fromEntries(want.map((c, i) => [c.id, list[i]]));
  }
  return { rows: shown.slice(offset, offset + Math.max(1, Math.min(500, page.limit))), grid: meta };
}
