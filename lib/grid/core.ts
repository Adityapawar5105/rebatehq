// Shared grid standard (chunk 7V-3a, blueprint v2.5 items 26-27): column sort, multi-value filter and the
// selection aggregate status bar. Pure functions used by the browser table and the vault worker alike.
// Values are the raw strings a grid already shows (cents, exact decimals, ISO dates, text). Nothing here
// evaluates a formula; numbers are compared and averaged exactly, never through floating point.

export type GridType = "text" | "int" | "money" | "decimal" | "percent" | "date";
export type GridSort = { col: string; dir: "asc" | "desc" };
export type GridFilter = { col: string; values: (string | null)[] };
/** What a grid asks the worker for. `distinct` and `totals` are extra answers on top of the page. */
export type GridQuery = { sort?: GridSort | null; filters?: GridFilter[]; distinct?: { col: string; search?: string }; totals?: string[] };
/** The output columns a worker grid may sort, filter or total, with their types. Keys are code-defined. */
export type GridSpec = Record<string, GridType>;
export type Totals = { count: string; sum: string; avg: string | null; min: string | null; max: string | null };
export type DistinctValue = { value: string | null; count: string };
export type GridMeta = { matched: string; total: string; distinct?: { values: DistinctValue[]; more: boolean }; totals?: Record<string, Totals> };

export const GRID_DISTINCT_LIMIT = 500;
export const GRID_FILTER_VALUES = 1000;
export const GRID_FILTERS = 20;
export const GRID_TOTAL_ROWS = 5000;
export const GRID_TOTAL_COLS = 24;
/** Decimal places kept for averages: money averages are whole cents; other averages keep these places. */
export const AVG_PLACES: Record<Exclude<GridType, "text" | "date">, number> = { money: 0, int: 2, decimal: 4, percent: 4 };

const NUMERIC = new Set<GridType>(["int", "money", "decimal", "percent"]);
export const isNumeric = (t: GridType): t is Exclude<GridType, "text" | "date"> => NUMERIC.has(t);
export const GRID_TYPES: GridType[] = ["text", "int", "money", "decimal", "percent", "date"];
const COL = /^[a-z_][a-z0-9_]{0,63}$/i;
export const NUMBER = /^-?\d{1,30}(\.\d{1,12})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}/;

export class GridInputError extends Error {}
const fail = (): never => { throw new GridInputError("grid"); };
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v : fail();

/** Validates an untrusted grid query against the grid's own column list. */
export function checkQuery(spec: GridSpec, input: unknown): GridQuery {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail();
  const q = input as Record<string, unknown>, out: GridQuery = {};
  const col = (v: unknown) => { const c = text(v, 64); return COL.test(c) && Object.prototype.hasOwnProperty.call(spec, c) ? c : fail(); };
  if (q.sort !== undefined && q.sort !== null) {
    const s = q.sort as Record<string, unknown>;
    if (typeof s !== "object" || (s.dir !== "asc" && s.dir !== "desc")) fail();
    out.sort = { col: col(s.col), dir: s.dir as "asc" | "desc" };
  }
  if (q.filters !== undefined) {
    if (!Array.isArray(q.filters) || q.filters.length > GRID_FILTERS) fail();
    const seen = new Set<string>();
    out.filters = (q.filters as unknown[]).map(f => {
      const r = f as Record<string, unknown>; if (!r || typeof r !== "object" || !Array.isArray(r.values) || r.values.length > GRID_FILTER_VALUES) fail();
      const c = col(r.col); if (seen.has(c)) fail(); seen.add(c);
      return { col: c, values: (r.values as unknown[]).map(v => v === null ? null : text(v, 1000)) };
    });
  }
  if (q.distinct !== undefined) {
    const d = q.distinct as Record<string, unknown>; if (!d || typeof d !== "object") fail();
    out.distinct = { col: col(d.col), ...(d.search !== undefined ? { search: text(d.search, 160) } : {}) };
  }
  if (q.totals !== undefined) {
    if (!Array.isArray(q.totals) || q.totals.length > GRID_TOTAL_COLS) fail();
    out.totals = (q.totals as unknown[]).map(col).filter(c => isNumeric(spec[c]));
  }
  return out;
}

/** Splits an exact decimal string into sign, digits and scale. */
function parts(v: string) {
  const neg = v.startsWith("-"), abs = neg ? v.slice(1) : v, [i, f = ""] = abs.split(".");
  return { neg, int: i.replace(/^0+(?=\d)/, ""), frac: f.replace(/0+$/, "") };
}
/** Exact comparison of two decimal strings (any scale). */
export function compareDecimal(a: string, b: string): number {
  const x = parts(a), y = parts(b), zero = (p: ReturnType<typeof parts>) => p.int === "0" && !p.frac;
  const xn = x.neg && !zero(x), yn = y.neg && !zero(y);
  if (xn !== yn) return xn ? -1 : 1;
  let c = x.int.length - y.int.length || (x.int < y.int ? -1 : x.int > y.int ? 1 : 0);
  if (!c) { const n = Math.max(x.frac.length, y.frac.length), fx = x.frac.padEnd(n, "0"), fy = y.frac.padEnd(n, "0"); c = fx < fy ? -1 : fx > fy ? 1 : 0; }
  return xn ? -c : c;
}
/** Compares two raw cell values of one type. Blanks sort last in both directions (handled by the caller). */
export function compareValues(type: GridType, a: string, b: string, collator: Intl.Collator): number {
  if (isNumeric(type)) {
    const na = NUMBER.test(a), nb = NUMBER.test(b);
    if (na && nb) return compareDecimal(a, b);
    if (na !== nb) return na ? -1 : 1;
  }
  if (type === "date" && DATE.test(a) && DATE.test(b)) return a < b ? -1 : a > b ? 1 : 0;
  return collator.compare(a, b);
}

/** A decimal string as a BigInt scaled to `places` decimal places (truncating extra places is never needed:
 * callers pass values whose scale is at most `places`). */
function scaled(v: string, places: number) {
  const p = parts(v); if (p.frac.length > places) throw new GridInputError("scale");
  const n = BigInt(p.int + p.frac.padEnd(places, "0")); return p.neg ? -n : n;
}
function unscale(n: bigint, places: number) {
  const neg = n < BigInt(0), s = (neg ? -n : n).toString().padStart(places + 1, "0");
  const out = places ? `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, "") : s;
  return (neg && out !== "0" ? "-" : "") + out;
}
/** Exact average: sum / count, rounded half away from zero to the type's places. */
export function average(type: Exclude<GridType, "text" | "date">, sum: string, count: string): string | null {
  const n = BigInt(count); if (n === BigInt(0)) return null;
  const places = AVG_PLACES[type], scale = Math.max(places, parts(sum).frac.length), s = scaled(sum, scale);
  const shift = BigInt(10) ** BigInt(scale - places), den = n * shift, neg = s < BigInt(0), abs = neg ? -s : s;
  let q = abs / den; if ((abs % den) * BigInt(2) >= den) q += BigInt(1);
  return unscale(neg ? -q : q, places);
}
/** Exact SUM/AVG/MIN/MAX/COUNT of decimal strings; the browser fallback when no worker is attached. */
export function totalsOf(type: Exclude<GridType, "text" | "date">, values: (string | null)[]): Totals {
  const nums = values.filter((v): v is string => v !== null && NUMBER.test(v));
  if (!nums.length) return { count: "0", sum: "0", avg: null, min: null, max: null };
  const places = Math.max(0, ...nums.map(v => parts(v).frac.length));
  const sum = unscale(nums.reduce((s, v) => s + scaled(v, places), BigInt(0)), places);
  const sorted = [...nums].sort(compareDecimal);
  return { count: String(nums.length), sum, avg: average(type, sum, String(nums.length)), min: sorted[0], max: sorted[sorted.length - 1] };
}

export type ClientColumn<R> = { id: string; type: GridType; value: (r: R) => string | null };
/** Filters, then sorts, rows held in the browser. Ties keep the original order (the caller's row-key order). */
export function applyQuery<R>(rows: R[], cols: ClientColumn<R>[], q: GridQuery, locale: string): R[] {
  const by = new Map(cols.map(c => [c.id, c]));
  let out = rows;
  for (const f of q.filters ?? []) {
    const c = by.get(f.col); if (!c) continue;
    const set = new Set(f.values); out = out.filter(r => set.has(c.value(r)));
  }
  const s = q.sort, c = s ? by.get(s.col) : undefined;
  if (!s || !c) return out;
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: false });
  const dir = s.dir === "asc" ? 1 : -1;
  return out.map((r, i) => ({ r, i, v: c.value(r) })).sort((a, b) => {
    if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
    return compareValues(c.type, a.v, b.v, collator) * dir || a.i - b.i;
  }).map(x => x.r);
}
/** Distinct values of one column for the filter list, honouring every other column's filter. */
export function distinctOf<R>(rows: R[], cols: ClientColumn<R>[], q: GridQuery, col: string, locale: string, search = ""): { values: DistinctValue[]; more: boolean } {
  const others: GridQuery = { filters: (q.filters ?? []).filter(f => f.col !== col) };
  const c = cols.find(x => x.id === col); if (!c) return { values: [], more: false };
  const counts = new Map<string | null, number>();
  for (const r of applyQuery(rows, cols, others, locale)) { const v = c.value(r); counts.set(v, (counts.get(v) ?? 0) + 1); }
  const needle = search.trim().toLocaleLowerCase(locale);
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  const all = [...counts].filter(([v]) => !needle || (v ?? "").toLocaleLowerCase(locale).includes(needle))
    .sort(([a], [b]) => a === null ? -1 : b === null ? 1 : compareValues(c.type, a, b, collator));
  return { values: all.slice(0, GRID_DISTINCT_LIMIT).map(([value, n]) => ({ value, count: String(n) })), more: all.length > GRID_DISTINCT_LIMIT };
}
