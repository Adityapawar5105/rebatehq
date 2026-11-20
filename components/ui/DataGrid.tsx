"use client";
// The grid standard (chunk 7V-3a, blueprint v2.5 items 26-27). Every data grid in the app uses this table:
// sort and a multi-value filter on each column header, row selection and a status bar with SUM, AVG, MIN,
// MAX and COUNT of the selected rows. Grids held in the browser sort and filter here; worker grids
// (`remote`) pass the query to their own worker command, which runs it over the whole result. Totals are
// always computed by DuckDB in the worker. Unlike the other components in components/ui, this one owns a
// few generic labels (sort, filter, select), all message keys.
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { applyQuery, distinctOf, isNumeric, totalsOf, type DistinctValue, type GridMeta, type GridQuery, type GridType, type Totals } from "@/lib/grid/core";
import { fmt, getLocale, t, useLocale } from "@/lib/i18n";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import s from "./ui.module.css";

export type GridColumn<R> = {
  /** Worker grids: the column name in the command's grid spec. */
  id: string;
  /** Plain-text column name, used in labels ("Sort by …"). */
  name: string;
  /** What the header shows, when it differs from `name` (a glossary term, for example). */
  header?: ReactNode;
  type?: GridType;
  /** The raw value the cell shows (cents, exact decimal, ISO date or text). Without it the column is not
   * sortable or filterable (an actions column). */
  value?: (row: R) => string | null;
  cell?: (row: R) => ReactNode;
  /** Display text of a raw value in the filter list (a translated status, for example). */
  label?: (value: string) => string;
  num?: boolean;
  className?: string;
  sort?: boolean;
  filter?: boolean;
};
export type RemoteGrid = {
  query: GridQuery;
  onQuery: (q: GridQuery) => void;
  meta: GridMeta | null | undefined;
  /** Runs the grid's worker command for distinct values or totals of the whole filtered result. */
  fetch: (q: GridQuery) => Promise<GridMeta>;
};
type TotalsFn = (types: GridType[], values: (string | null)[][]) => Promise<Totals[]>;
const TotalsContext = createContext<TotalsFn | null>(null);
/** Lets every grid inside total a selection through the vault worker. */
export function GridTotalsProvider({ value, children }: { value: TotalsFn; children: ReactNode }) { return <TotalsContext.Provider value={value}>{children}</TotalsContext.Provider>; }

export function showValue(type: GridType, v: string | null): string {
  if (v === null) return t("grid.blanks");
  switch (type) {
    case "money": return fmt.currency(v);
    case "int": return /^-?\d+$/.test(v) ? fmt.int(v) : v;
    case "decimal": return fmt.decimal(v);
    case "percent": return fmt.percent(v);
    case "date": return v.length > 10 ? fmt.dateTime(v) : fmt.date(v);
    default: return v === "" ? t("grid.empty") : v;
  }
}
/** A cell's default text: like the filter list, but a missing value reads "unknown" and empty text stays empty. */
const cellText = (type: GridType, v: string | null) => v === null ? t("common.unknown") : type === "text" ? v : showValue(type, v);
const cx = (...n: (string | false | undefined)[]) => n.filter(Boolean).join(" ");
const sameQuery = (a: GridQuery, b: GridQuery) => JSON.stringify(a) === JSON.stringify(b);

type Props<R> = {
  label: string;
  columns: GridColumn<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  remote?: RemoteGrid;
  footer?: ReactNode;
  selectable?: boolean;
  tall?: boolean;
  className?: string;
  testId?: string;
  rowProps?: (row: R) => Record<string, string | undefined>;
  caption?: ReactNode;
  /** Local grids: called with the selected rows (in screen order) whenever the selection changes. */
  onSelectionChange?: (rows: R[]) => void;
};
export function DataGrid<R>({ label, columns, rows, rowKey, remote, footer, selectable = true, tall, className, testId, rowProps, caption, onSelectionChange }: Props<R>) {
  useLocale();
  const locale = getLocale();
  const [local, setLocal] = useState<GridQuery>({});
  const query = remote ? remote.query : local;
  const setQuery = useCallback((q: GridQuery) => { if (remote) remote.onQuery(q); else setLocal(q); }, [remote]);
  // Callers often build `columns` inline; memoise on the column signature so a re-render does not refetch.
  const colRef = useRef(columns); colRef.current = columns;
  const signature = columns.map(c => `${c.id}:${c.type ?? "text"}:${c.value ? 1 : 0}`).join("|");
  const keyed = useMemo(() => colRef.current.filter((c): c is GridColumn<R> & { value: (r: R) => string | null } => !!c.value).map(c => ({ ...c, type: c.type ?? "text" })), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const isRemote = !!remote;
  const visible = useMemo(() => isRemote ? rows : applyQuery(rows, keyed, query, locale), [isRemote, rows, keyed, query, locale]);
  const filtered = (query.filters ?? []).length > 0;
  const total = remote ? remote.meta?.total ?? String(rows.length) : String(rows.length), matched = remote ? remote.meta?.matched ?? String(rows.length) : String(visible.length);

  // Selection: row keys on the screen, or every row matching the filters ("all").
  const [picked, setPicked] = useState<Set<string>>(new Set()), [all, setAll] = useState(false), anchor = useRef<number | null>(null);
  const visibleKeys = useMemo(() => visible.map(rowKey), [visible, rowKey]);
  useEffect(() => { setPicked(p => { const keep = new Set([...p].filter(k => visibleKeys.includes(k))); return keep.size === p.size ? p : keep; }); }, [visibleKeys]);
  const queryKey = JSON.stringify({ sort: query.sort ?? null, filters: query.filters ?? [] });
  // Only a filter change clears the selection; sorting keeps it (UI handoff 1.3), so ticked Leak Report findings survive a sort.
  const filterKey = JSON.stringify(query.filters ?? []);
  useEffect(() => { setAll(false); setPicked(new Set()); }, [filterKey]);
  const count = all ? Number(matched) : picked.size;
  const toggle = (i: number, shift: boolean) => {
    setAll(false);
    // Read the range start now: the state updater runs after the anchor has moved to this row.
    const start = anchor.current, [from, to] = shift && start !== null ? [Math.min(start, i), Math.max(start, i)] : [i, i];
    setPicked(p => {
      const next = new Set(p), key = visibleKeys[i], on = !p.has(key);
      for (let n = from; n <= to; n++) { if (on) next.add(visibleKeys[n]); else next.delete(visibleKeys[n]); }
      return next;
    });
    anchor.current = i;
  };
  const everyShown = visibleKeys.length > 0 && visibleKeys.every(k => picked.has(k));
  const onSelect = useRef(onSelectionChange); onSelect.current = onSelectionChange;
  // Report only real changes: callers build rowKey inline, so the key list is a new array on every render.
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    const chosen = all ? visibleKeys : visibleKeys.filter(k => picked.has(k)), sig = chosen.join("\u0001");
    if (sig === emitted.current) return; emitted.current = sig;
    onSelect.current?.(all ? visible : visible.filter((_, i) => picked.has(visibleKeys[i])));
  }, [all, picked, visible, visibleKeys]);
  // Header checkbox: clear when everything shown is selected; otherwise select every row (a worker grid selects
  // every row matching its filters, including rows on other pages).
  const toggleAll = () => { if (all || everyShown) { setAll(false); setPicked(new Set()); } else { setAll(!!remote); setPicked(new Set(visibleKeys)); } };

  // Totals of the selection, computed in the worker.
  const totalsFn = useContext(TotalsContext);
  const numeric = useMemo(() => keyed.filter(c => isNumeric(c.type)), [keyed]);
  const [totals, setTotals] = useState<Record<string, Totals> | null>(null), [totalsError, setTotalsError] = useState(false), seq = useRef(0);
  const remoteRef = useRef(remote); remoteRef.current = remote;
  const selKey = all ? `all|${matched}` : [...picked].sort().join("\u0001");
  useEffect(() => {
    const n = ++seq.current, remote = remoteRef.current; setTotalsError(false);
    if (!count || !numeric.length) { setTotals(null); return; }
    const timer = setTimeout(() => {
      const work: Promise<Record<string, Totals>> = all && remote
        ? remote.fetch({ ...query, totals: numeric.map(c => c.id) }).then(m => m.totals ?? {})
        : (() => {
          const chosen = visible.filter(r => picked.has(rowKey(r))), types = numeric.map(c => c.type), values = chosen.map(r => numeric.map(c => c.value(r)));
          const local = () => Promise.resolve(Object.fromEntries(numeric.map((c, i) => [c.id, totalsOf(c.type as "money", values.map(v => v[i]))])));
          return totalsFn ? totalsFn(types, values).then(list => Object.fromEntries(numeric.map((c, i) => [c.id, list[i]]))) : local();
        })();
      work.then(v => { if (n === seq.current) setTotals(v); }).catch(() => { if (n === seq.current) { setTotals(null); setTotalsError(true); } });
    }, 120);
    return () => clearTimeout(timer);
  }, [selKey, queryKey, visible, numeric, totalsFn]); // eslint-disable-line react-hooks/exhaustive-deps

  const [openCol, setOpenCol] = useState<string | null>(null);
  const cols = (selectable ? 1 : 0) + columns.length;
  const statusId = useId();
  return <div className={s.gridBox} data-testid={testId}>
    {/* Always rendered at a fixed height, so the first tick never pushes the table down (UI handoff 1.1). */}
    <div className={s.gridBar}>
      {/* The row count is always shown; the "N of M" form (grid-count) only while a filter is on (20 Nov 2026). */}
      {!filtered && <span data-testid="grid-rows">{t("grid.rowsTotal", { count: Number(total) })}</span>}
      {filtered && <span data-testid="grid-count">{t("grid.rowsShown", { shown: fmt.int(matched), total: fmt.int(total) })}</span>}
      {filtered && <button type="button" className={s.chip} onClick={() => setQuery({ ...query, filters: [] })}>{t("grid.clearFilters")}</button>}
      {count > 0 && <button type="button" className={s.chip} onClick={() => { setAll(false); setPicked(new Set()); }}>{t("grid.clearSelection")}</button>}
    </div>
    <div className={cx(s.tableWrap, tall && s.tall, className)} role="region" aria-label={label} tabIndex={0}>
      <table className={s.table} aria-label={label} aria-describedby={count ? statusId : undefined}>
        {caption && <caption>{caption}</caption>}
        <thead><tr>
          {selectable && <th scope="col" className={s.selCol}><input type="checkbox" aria-label={remote ? t("grid.selectAllMatching", { count: fmt.int(matched) }) : t("grid.selectAll")} checked={all || everyShown} onChange={toggleAll} data-testid="grid-select-all"/></th>}
          {columns.map(c => <HeaderCell key={c.id} col={c} query={query} setQuery={setQuery} open={openCol === c.id} setOpen={o => setOpenCol(o ? c.id : null)}
            distinct={(search: string) => c.value ? remote ? remote.fetch({ ...query, distinct: { col: c.id, search } }).then(m => m.distinct ?? { values: [], more: false }) : Promise.resolve(distinctOf(rows, keyed, query, c.id, locale, search)) : Promise.resolve({ values: [], more: false })}/>)}
        </tr></thead>
        <tbody>
          {visible.map((r, i) => { const key = visibleKeys[i], on = all || picked.has(key); return <tr key={key} data-selected={on ? "yes" : undefined} {...(rowProps?.(r) ?? {})}>
            {selectable && <td className={s.selCol}><input type="checkbox" aria-label={t("grid.selectRow", { row: i + 1 })} checked={on} onChange={() => undefined} onClick={e => toggle(i, e.shiftKey)} data-testid="grid-select"/></td>}
            {columns.map(c => <td key={c.id} className={cx(c.num && s.num, c.className)}>{c.cell ? c.cell(r) : c.value ? cellText(c.type ?? "text", c.value(r)) : null}</td>)}
          </tr>; })}
          {/* An empty table and a table filtered to nothing say different things; the filtered one offers to clear. */}
          {!visible.length && <tr><td colSpan={cols} className={s.gridEmpty} data-testid={filtered ? "grid-no-matches" : "grid-empty"}>{filtered ? <>{t("grid.noMatches")}{" "}<button type="button" className={s.chip} onClick={() => setQuery({ ...query, filters: [] })}>{t("grid.clearFilters")}</button></> : t("grid.noRows")}</td></tr>}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
    <div id={statusId} className={s.gridStatus} role="status" aria-live="polite" data-testid="grid-status">
      {count > 0 && <>
        <strong>{t("grid.selected", { count })}</strong>
        {totalsError && <span>{t("grid.totalsFailed")}</span>}
        {/* Compact (UI handoff 1.2): the sum of each numeric column on one line; average, min, max and count under "More totals". */}
        {totals && numeric.map(c => { const v = totals[c.id]; if (!v) return null; const f = (x: string | null) => x === null ? t("common.unknown") : showValue(c.type, x);
          return <span key={c.id} className={s.gridTotal} data-testid={`grid-total-${c.id}`} data-sum={v.sum} data-count={v.count}>
            {t("grid.totalsShort", { name: c.name, sum: f(v.sum) })}
          </span>; })}
        {totals && <details className={s.gridMore} data-testid="grid-more-totals"><summary>{t("grid.moreTotals")}</summary>
          <table className={s.gridMoreTable} aria-label={t("grid.totalsTable")}><thead><tr><th scope="col">{t("grid.col.column")}</th><th scope="col">{t("grid.col.sum")}</th><th scope="col">{t("grid.col.avg")}</th><th scope="col">{t("grid.col.min")}</th><th scope="col">{t("grid.col.max")}</th><th scope="col">{t("grid.col.count")}</th></tr></thead>
          <tbody>{numeric.map(c => { const v = totals[c.id]; if (!v) return null; const f = (x: string | null) => x === null ? t("common.unknown") : showValue(c.type, x);
            return <tr key={c.id}><th scope="row">{c.name}</th><td>{f(v.sum)}</td><td>{f(v.avg)}</td><td>{f(v.min)}</td><td>{f(v.max)}</td><td>{fmt.int(v.count)}</td></tr>; })}</tbody></table>
        </details>}
      </>}
    </div>
  </div>;
}

function HeaderCell<R>({ col, query, setQuery, open, setOpen, distinct }: { col: GridColumn<R>; query: GridQuery; setQuery: (q: GridQuery) => void; open: boolean; setOpen: (o: boolean) => void; distinct: (search: string) => Promise<{ values: DistinctValue[]; more: boolean }> }) {
  const sortable = !!col.value && col.sort !== false, filterable = !!col.value && col.filter !== false;
  const dir = query.sort?.col === col.id ? query.sort.dir : null;
  const filter = (query.filters ?? []).find(f => f.col === col.id);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const cycle = () => setQuery({ ...query, sort: dir === null ? { col: col.id, dir: "asc" } : dir === "asc" ? { col: col.id, dir: "desc" } : null });
  const sortLabel = t(dir === "asc" ? "grid.sortedAsc" : dir === "desc" ? "grid.sortedDesc" : "grid.sortBy", { name: col.name });
  return <th scope="col" aria-label={col.name} className={cx(col.num && s.num)} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}>
    <span className={s.thInner}>
      {sortable && !col.header ? <button type="button" className={s.sortBtn} onClick={cycle} aria-label={sortLabel} data-testid={`grid-sort-${col.id}`}>{col.name}<Icon name={dir === "desc" ? "sortDown" : dir === "asc" ? "sortUp" : "sort"} size={14}/></button>
        : <>{col.header ?? col.name}{sortable && <button type="button" className={s.iconBtn} onClick={cycle} aria-label={sortLabel} data-testid={`grid-sort-${col.id}`}><Icon name={dir === "desc" ? "sortDown" : dir === "asc" ? "sortUp" : "sort"} size={14}/></button>}</>}
      {filterable && <button ref={filterBtn} type="button" className={s.iconBtn} data-active={filter ? "yes" : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        aria-label={t(filter ? "grid.filterOn" : "grid.filter", { name: col.name })} data-testid={`grid-filter-${col.id}`}><Icon name="filter" size={14}/></button>}
    </span>
    {open && <FilterPanel anchor={filterBtn} name={col.name} type={col.type ?? "text"} label={col.label} current={filter?.values ?? null} distinct={distinct}
      onClose={() => { setOpen(false); filterBtn.current?.focus(); }}
      onApply={values => { const rest = (query.filters ?? []).filter(f => f.col !== col.id); setQuery({ ...query, filters: values === null ? rest : [...rest, { col: col.id, values }] }); setOpen(false); filterBtn.current?.focus(); }}/>}
  </th>;
}

function FilterPanel({ anchor, name, type, label, current, distinct, onClose, onApply }: { anchor: React.RefObject<HTMLButtonElement | null>; name: string; type: GridType; label?: (value: string) => string; current: (string | null)[] | null; distinct: (search: string) => Promise<{ values: DistinctValue[]; more: boolean }>; onClose: () => void; onApply: (values: (string | null)[] | null) => void }) {
  const [search, setSearch] = useState(""), [list, setList] = useState<{ values: DistinctValue[]; more: boolean } | null>(null), [error, setError] = useState(false);
  const [chosen, setChosen] = useState<Set<string | null> | null>(current ? new Set(current) : null);
  const box = useRef<HTMLDivElement>(null), searchRef = useRef<HTMLInputElement>(null), headingId = useId();
  // Fixed to the viewport beside its button, so the table's scroll box cannot clip it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    // Below the button when it fits, otherwise above it; always inside the viewport (a fixed panel cannot be scrolled to).
    const place = () => { const r = anchor.current?.getBoundingClientRect(); if (!r) return; const width = Math.min(320, window.innerWidth - 32), height = Math.min(box.current?.offsetHeight || 360, window.innerHeight - 16);
      const below = r.bottom + 4, above = r.top - 4 - height, top = below + height <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, window.innerHeight - 8 - height);
      setPos({ top: Math.round(top), left: Math.round(Math.max(16, Math.min(r.left, window.innerWidth - width - 16))) }); };
    place(); const again = requestAnimationFrame(place), grow = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place); if (box.current) grow?.observe(box.current); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(again); grow?.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => { let on = true; setError(false); const timer = setTimeout(() => { distinct(search).then(v => { if (on) setList(v); }).catch(() => { if (on) setError(true); }); }, search ? 200 : 0); return () => { on = false; clearTimeout(timer); }; }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, [onClose, anchor]);
  const isOn = (v: string | null) => chosen === null || chosen.has(v);
  const flip = (v: string | null) => setChosen(c => { const base = c ?? new Set(list?.values.map(x => x.value) ?? []); const next = new Set(base); if (next.has(v)) next.delete(v); else next.add(v); return next; });
  const shown = list?.values ?? [];
  const searching = search.trim() !== "";
  // With a search, the filter keeps the matching values that are ticked (all of them until the user unticks one).
  const apply = () => {
    if (searching) { const keep = shown.filter(v => isOn(v.value)).map(v => v.value); if (keep.length) onApply(keep); return; }
    if (chosen === null) return onApply(null); const everything = !list?.more && shown.every(v => chosen.has(v.value)); onApply(everything ? null : [...chosen]);
  };
  const ticked = shown.filter(v => isOn(v.value)).length;
  // Rendered on <body> so no stacking context (the sidebar, a scrolling table) can cover it.
  return createPortal(<div ref={box} className={s.filterPanel} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }} role="dialog" aria-labelledby={headingId} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <strong id={headingId} className={s.filterTitle}>{t("grid.filter", { name })}</strong>
    <label className={s.field}><span className={s.fieldLabel}>{t("grid.searchValues")}</span><input ref={searchRef} type="search" value={search} maxLength={160} placeholder={t("grid.searchPlaceholder")} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(); } }} data-testid="grid-filter-search"/></label>
    {searching && list && <p className={s.fieldHint} role="status">{t("grid.matches", { count: shown.length })}</p>}
    <div className={s.row}>
      <button type="button" className={s.chip} onClick={() => setChosen(new Set([...(chosen ?? []), ...shown.map(v => v.value)]))}>{t("grid.selectAll")}</button>
      <button type="button" className={s.chip} onClick={() => setChosen(new Set([...(chosen ?? [])].filter(v => !shown.some(x => x.value === v))))}>{t("grid.selectNone")}</button>
    </div>
    {error ? <p className={s.fieldError} role="alert">{t("grid.valuesFailed")}</p> : !list ? <p className={s.fieldHint}>{t("grid.loadingValues")}</p> :
      <ul className={s.filterList} aria-label={t("grid.values", { name })}>
        {!shown.length && <li className={s.fieldHint}>{t("grid.noValues")}</li>}
        {shown.map(v => { const text = v.value !== null && label ? label(v.value) : showValue(type, v.value);
          return <li key={v.value ?? "\u0000"} className={s.filterItem}><label><input type="checkbox" checked={isOn(v.value)} onChange={() => flip(v.value)}/> <span translate={type === "text" && !label ? "no" : undefined}><Highlight text={text} find={search}/></span> <span className={s.fieldHint}>{fmt.int(v.count)}</span></label>
            <button type="button" className={s.onlyBtn} onClick={() => onApply([v.value])} aria-label={t("grid.onlyValue", { value: text })} data-testid="grid-filter-only">{t("grid.only")}</button></li>; })}
      </ul>}
    {list?.more && <p className={s.fieldHint}>{t("grid.moreValues", { count: fmt.int(shown.length) })}</p>}
    <div className={s.row}>
      <button type="button" className={cx(s.btn, s.primary, s.sm)} onClick={apply} disabled={searching && !ticked} data-testid="grid-filter-apply">{searching ? t("grid.applyMatches", { count: ticked }) : t("grid.apply")}</button>
      <button type="button" className={cx(s.btn, s.secondary, s.sm)} onClick={() => onApply(null)}>{t("grid.clearFilter")}</button>
      <button type="button" className={cx(s.btn, s.ghost, s.sm)} onClick={onClose}>{t("common.close")}</button>
    </div>
  </div>, document.body);
}
/** Marks the searched text inside a value (case-insensitive), so matches stand out in the list. */
function Highlight({ text, find }: { text: string; find: string }) {
  const q = find.trim(); if (!q) return <>{text}</>;
  const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase()); if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className={s.match}>{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</>;
}
export { sameQuery };
