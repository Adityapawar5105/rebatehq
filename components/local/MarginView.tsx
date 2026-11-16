"use client";
import {CompetitorLog,ServiceOrders} from './PricingTools';
import {RebateReconciliation} from "./RebatesView";
import {MarginBridge} from "./PricingOps";
import {SectionTabs} from "@/components/ui/ui";
import {CustomerHealthView} from "./HomeMonitor";

// Margin section (chunk 4D): waterfall, drill-down, whale curve, leaks, ROI and the
// "show me the math" panel. Every number is computed in the vault worker; this file only draws.
// Chunk 7U: text from message keys, amounts and counts through Intl, glossary popovers beside
// the numbers, chart colours from theme tokens. Chunk 7V: shared components; the waterfall table
// doubles as the chart (floating bars), so the chart and its accessible table are one element.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus, LeaksView } from "@/lib/vault/protocol";
import type { Dim, Drill, Filters, MathPanel, Metric, Waterfall, Whale } from "@/lib/margin/views";
import type { Finding, LeakRow } from "@/lib/margin/leaks";
import type { RoiSummary } from "@/lib/margin/roi";
import { fmt, getLocale, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Badge, Button, ButtonLink, Card, EmptyState, Field, Grid, Notice, Skeleton, StatTile, numCell, uiStyles as ui } from "@/components/ui/ui";
import { Term } from "./Glossary";
import { MARGIN_FILTER_EVENT } from "./CommandPalette";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
import type { GridQuery } from "@/lib/grid/core";
type Shared = { client: VaultClient; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; setMessage: (m: string) => void; onStatus: (s: VaultStatus) => void; status: VaultStatus };
const $ = (cents: string | null | undefined) => cents === null || cents === undefined ? t("common.unknown") : fmt.currency(cents);
/** Basis points ("1234") as a percent with two decimals, exactly. */
const bpPercent = (bp: string) => { const neg = bp.startsWith("-"), abs = (neg ? bp.slice(1) : bp).padStart(3, "0"); return fmt.percent(`${neg ? "-" : ""}${abs.slice(0, -2)}.${abs.slice(-2)}`); };
const DIM_LABEL: Record<Dim, MessageKey> = { product: "margin.dim.product", category: "margin.dim.category", customer: "margin.dim.customer", branch: "margin.dim.branch", tier: "margin.dim.tier", region: "margin.dim.region", month: "margin.dim.month" };
const dimName = (d: Dim) => t(DIM_LABEL[d]);
const NONE: Filters = { by: [] };
type MathTarget = { metric: Metric; filters: Filters; title: string } | { leak: Finding } | null;

/** Floating-bar geometry for the waterfall. Layout only: the amounts shown are the worker's exact cents. */
function waterfallBars(w: Waterfall) {
  let level = 0;
  const segs = w.steps.map(s => { const v = Number(s.cents); if (s.kind === "start" || s.kind === "subtotal" || s.kind === "end") { level = v; return [0, v] as const; } const a = level; level += v; return [a, level] as const; });
  const all = segs.flat(), lo = Math.min(0, ...all), hi = Math.max(1, ...all), pos = (x: number) => (x - lo) / (hi - lo) * 100;
  return w.steps.map((s, i) => {
    const [a, b] = segs[i], v = Number(s.cents);
    const tone = s.kind === "excluded" ? "muted" : s.kind === "minus" || v < 0 ? "bad" : s.kind === "end" || s.kind === "plus" ? "ok" : "accent";
    return { left: pos(Math.min(a, b)), width: Math.max(0.6, pos(Math.max(a, b)) - pos(Math.min(a, b))), tone };
  });
}

function WaterfallView({ client, busy, operation, setMessage, onStatus, status }: Shared) {
  const [filters, setFilters] = useState<Filters>(NONE), [w, setW] = useState<Waterfall | null>(null), [dim, setDim] = useState<Dim>("customer"), [sort, setSort] = useState<"pocket" | "margin" | "rate">("pocket");
  const [gq, setGq] = useState<GridQuery>({}), [d, setD] = useState<Drill | null>(null), [whale, setWhale] = useState<Whale | null>(null), [leaks, setLeaks] = useState<LeaksView | null>(null), [target, setTarget] = useState<MathTarget>(null);
  const version = `${status.lines}|${status.generation}`;
  useEffect(() => { let on = true; void client.call("marginWaterfall", { filters }).then(x => { if (on) setW(x); }).catch(() => undefined); void client.call("marginWhale", { filters }).then(x => { if (on) setWhale(x); }).catch(() => undefined); return () => { on = false; }; }, [client, filters, version]);
  useEffect(() => { setGq({}); }, [dim]);
  useEffect(() => { let on = true; void client.call("marginDrill", { dim, filters, sort, grid: gq }).then(x => { if (on) setD(x); }).catch(() => undefined); return () => { on = false; }; }, [client, dim, filters, sort, version, gq]);
  useEffect(() => { let on = true; if (status.lines !== "0") void client.call("leaks", {}).then(x => { if (on) setLeaks(x); }).catch(() => undefined); return () => { on = false; }; }, [client, version, status.lines]);
  const addFilter = (dimName: Dim, value: string) => setFilters(f => ({ ...f, by: [...f.by.filter(x => x.dim !== dimName), { dim: dimName, value }] }));
  // The command palette opens Margin filtered to a SKU or customer it found.
  useEffect(() => {
    const onFilter = (e: Event) => { const { dim: k, value } = (e as CustomEvent<{ dim: string; value: string }>).detail; if (k === "product" || k === "customer") { setDim(k === "product" ? "customer" : "product"); addFilter(k, value); } };
    window.addEventListener(MARGIN_FILTER_EVENT, onFilter); return () => window.removeEventListener(MARGIN_FILTER_EVENT, onFilter);
  }, []);
  const open = (metric: Metric, title: string, f: Filters = filters) => setTarget({ metric, filters: f, title });
  if (status.lines === "0") return <Card headingId="waterfall-heading" title={t("margin.waterfall")}><EmptyState icon="chart" title={t("margin.waterfall")} body={t("margin.empty")} action={<ButtonLink variant="primary" href="#data-hub" icon="database">{t("margin.openDataHub")}</ButtonLink>}/></Card>;
  const bars = w ? waterfallBars(w) : [], list = w?.steps.find(s => s.key === "list");
  return <>
    {target && <MathView client={client} target={target} onClose={() => setTarget(null)}/>}
    {w && <Grid min={200} className={ui.kpis}>
      {list && <StatTile icon="tag" label={<Term id="listPrice">{t("margin.col.list")}</Term>} value={$(list.cents)}/>}
      <StatTile icon="coins" label={<Term id="netPocket">{t("margin.col.netPocket")}</Term>} value={$(w.netPocket)}/>
      <StatTile icon="trend" tone={w.margin.startsWith("-") ? "bad" : "ok"} label={<Term id="pocketMargin">{t("margin.col.margin")}</Term>} value={$(w.margin)} hint={fmt.percent(w.rate)}/>
      {leaks && <StatTile icon="alert" tone={leaks.result.findings.length ? "warn" : "ok"} label={<Term id="leak">{t("margin.leaks")}</Term>} value={$(leaks.result.dedupedCents)} hint={t(leaks.sample ? "margin.acrossFindingsSample" : "margin.acrossFindings", { count: leaks.result.findings.length })}/>}
    </Grid>}
    <Card headingId="waterfall-heading" title={<Term id="waterfall">{t("margin.waterfall")}</Term>} description={t("margin.waterfallIntro")}>
      {filters.by.length > 0 && <div className={ui.row} role="group" aria-label={t("margin.activeFilters")}>{filters.by.map(x => <button key={x.dim} className={ui.chip} aria-label={t("margin.removeFilter", { dim: dimName(x.dim), value: x.value })} onClick={() => setFilters(f => ({ ...f, by: f.by.filter(y => y.dim !== x.dim) }))}>{t("margin.filterChip", { dim: dimName(x.dim), value: x.value })} <span aria-hidden="true">✕</span></button>)}<Button size="sm" variant="ghost" onClick={() => setFilters(NONE)}>{t("margin.clearFilters")}</Button></div>}
      {!w ? <div aria-busy="true"><p className={styles.muted}>{t("margin.calculating")}</p><Skeleton lines={5}/></div> : <>
        {w.rebateReconciliation&&<RebateReconciliation value={w.rebateReconciliation}/>}
        <div className={ui.tableWrap}><table className={`${ui.table} ${ui.waterfall}`} aria-label={t("margin.waterfall")}>
          <thead><tr><th scope="col">{t("margin.step")}</th><th scope="col" className={ui.wfCol}>{t("margin.shareOfList")}</th><th scope="col" className={numCell}>{t("margin.amount")}</th></tr></thead>
          <tbody>{w.steps.map((s, i) => <tr key={s.key} data-kind={s.kind}>
            <td>{say(s.label)}</td>
            <td className={ui.wfCol}><div className={ui.wfTrack} aria-hidden="true"><span className={ui.wfBar} data-tone={bars[i].tone} style={{ left: `${bars[i].left}%`, width: `${bars[i].width}%` }}/></div></td>
            <td className={numCell}><button className={ui.numLink} data-testid={`wf-${s.key}`} aria-label={t("margin.mathFor", { label: say(s.label) })} onClick={() => open(s.key, say(s.label))}>{$(s.cents)}</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className={styles.small}><Term id="marginRate">{t("margin.rateLabel")}</Term>{" "}<button className={ui.numLink} aria-label={t("margin.mathForRate")} onClick={() => open("rate", t("margin.pocketMarginRate"))}>{fmt.percent(w.rate)}</button>{" "}{t("margin.ofKnownCostPocket")}{t("common.listSeparator")}<button className={ui.numLink} aria-label={t("margin.mathForLines")} onClick={() => open("lines", t("margin.linesTitle"))}>{t("margin.lineCount", { count: Number(w.lines) })}</button>{t("common.listSeparator")}{t("margin.creditLines", { count: Number(w.credits.lines), ms: w.ms })}</p>
        {w.uncostedLines !== "0" && <Notice tone="warn">{t("margin.uncosted", { count: Number(w.uncostedLines), pocket: $(w.uncostedPocket) })}</Notice>}
      </>}
    </Card>
    <Card headingId="drill-heading" title={t("margin.drillDown")}>
      <Grid min={180}>
        <Field label={t("margin.by")}><select value={dim} onChange={e => setDim(e.target.value as Dim)}>{(Object.keys(DIM_LABEL) as Dim[]).map(k => <option key={k} value={k}>{dimName(k)}</option>)}</select></Field>
        <Field label={t("margin.sort")}><select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="pocket">{t("margin.sortPocket")}</option><option value="margin">{t("margin.sortMargin")}</option><option value="rate">{t("margin.sortRate")}</option></select></Field>
      </Grid>
      {d && <><p className={styles.small}>{t(Number(d.total) > d.rows.length ? "margin.drillCountShowing" : "margin.drillCount", { count: Number(d.total), dim: dimName(d.dim).toLocaleLowerCase(getLocale()), shown: d.rows.length, ms: d.ms })}</p>
        <DrillGrid d={d} gq={gq} setGq={setGq} client={client} dim={dim} filters={filters} sort={sort} open={open} addFilter={addFilter}/></>}
    </Card>
    <WhaleCard whale={whale} open={open}/>
    <LeaksCard client={client} leaks={leaks} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus} onEvidence={leak => setTarget({ leak })}/>
  </>;
}
function DrillGrid({ d, gq, setGq, client, dim, filters, sort, open, addFilter }: { d: Drill; gq: GridQuery; setGq: (q: GridQuery) => void; client: VaultClient; dim: Dim; filters: Filters; sort: "pocket" | "margin" | "rate"; open: (metric: Metric, title: string, f?: Filters) => void; addFilter: (dim: Dim, value: string) => void }) {
  type Row = Drill["rows"][number];
  const nameOf = (r: Row) => r.label ? `${r.key} · ${r.label}` : r.key || t("margin.blank");
  const math = (metric: Metric, label: string, pick: (r: Row) => string) => ({ cell: (r: Row) => { const f: Filters = { ...filters, by: [...filters.by.filter(x => x.dim !== d.dim), { dim: d.dim, value: r.key }] };
    return <button className={ui.numLink} aria-label={t("margin.mathForRow", { label, key: r.key })} onClick={() => open(metric, t("margin.rowTitle", { label, name: nameOf(r) }), f)}>{$(pick(r))}</button>; } });
  return <DataGrid label={t("margin.marginBy", { dim: dimName(d.dim).toLocaleLowerCase(getLocale()) })} testId="drill-table" tall rows={d.rows} rowKey={r => r.key}
    remote={{ query: gq, onQuery: setGq, meta: d.grid, fetch: q => client.call("marginDrill", { dim, filters, sort, grid: q }).then(x => x.grid!) }} columns={[
      { id: "key", name: dimName(d.dim), value: r => r.key, cell: r => <span className={styles.wrap} translate="no">{nameOf(r)}</span> },
      { id: "lines", name: t("margin.col.lines"), type: "int", num: true, value: r => r.lines },
      { id: "list", name: t("margin.col.list"), header: <Term id="listPrice">{t("margin.col.list")}</Term>, type: "money", num: true, value: r => r.list, ...math("list", t("margin.col.list"), r => r.list) },
      { id: "discount", name: t("margin.col.discounts"), header: <Term id="discount">{t("margin.col.discounts")}</Term>, type: "money", num: true, value: r => r.discount, ...math("discount", t("margin.col.discounts"), r => r.discount) },
      { id: "credits", name: t("margin.col.credits"), header: <Term id="returnsCredits">{t("margin.col.credits")}</Term>, type: "money", num: true, value: r => r.credits, ...math("credits", t("margin.returnsAndCredits"), r => r.credits) },
      { id: "pocket", name: t("margin.col.netPocket"), header: <Term id="netPocket">{t("margin.col.netPocket")}</Term>, type: "money", num: true, value: r => r.pocket, ...math("netPocket", t("margin.col.netPocket"), r => r.pocket) },
      { id: "cost", name: t("margin.col.cost"), header: <Term id="cost">{t("margin.col.cost")}</Term>, type: "money", num: true, value: r => r.cost, ...math("cost", t("margin.col.cost"), r => r.cost) },
      { id: "margin", name: t("margin.col.margin"), header: <Term id="pocketMargin">{t("margin.col.margin")}</Term>, type: "money", num: true, value: r => r.margin, ...math("margin", t("margin.col.margin"), r => r.margin) },
      { id: "rate_value", name: t("margin.col.rate"), type: "percent", num: true, value: r => r.rateValue ?? null, cell: r => fmt.percent(r.rate) },
      { id: "uncosted", name: t("margin.col.noCost"), type: "int", num: true, value: r => r.uncostedLines },
      { id: "actions", name: t("margin.col.actions"), cell: r => <Button size="sm" variant="ghost" icon="chevronRight" aria-label={t("margin.drillInto", { dim: dimName(d.dim), key: r.key })} onClick={() => addFilter(d.dim, r.key)}>{t("margin.drillIn")}</Button> },
    ]}/>;
}
function WhaleCard({ whale, open }: { whale: Whale | null; open: (m: Metric, t: string) => void }) {
  if (!whale) return null;
  if (!whale.available) return <Card headingId="whale-heading" title={t("margin.whale")}><Notice tone="info">{say(whale.reason)}</Notice></Card>;
  const pts = whale.points, ys = pts.map(p => p.y), top = Math.max(100, ...ys), bottom = Math.min(0, ...ys), H = 200, Wd = 560;
  const x = (v: number) => v / 100 * Wd, y = (v: number) => H - (v - bottom) / (top - bottom || 1) * H;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const area = pts.length ? `${path} L${x(pts[pts.length - 1].x).toFixed(1)},${y(0).toFixed(1)} L${x(pts[0].x).toFixed(1)},${y(0).toFixed(1)} Z` : "";
  const peak = pts.reduce((m, p) => p.y > m.y ? p : m, pts[0] ?? { x: 0, y: 0 });
  const grid = [0, 25, 50, 75, 100].filter(v => v <= top && v >= bottom);
  return <Card headingId="whale-heading" title={<Term id="whaleCurve">{t("margin.whale")}</Term>}>
    <p className={styles.small}>{t("margin.whaleSummary", { peakAt: Number(whale.peakAt), count: Number(whale.customers), peakPct: fmt.percent(whale.peakPct), losers: Number(whale.losers), loserMargin: $(whale.loserMargin) })}{" "}<button className={ui.numLink} aria-label={t("margin.mathForTotal")} onClick={() => open("margin", t("margin.pocketMargin"))}>{$(whale.totalMargin)}</button>{t("roles.sentenceEnd")}{whale.uncostedCustomers !== "0" ? " " + t("margin.whaleUncosted", { count: Number(whale.uncostedCustomers) }) : ""}</p>
    <svg className={ui.chart} viewBox={`-48 -12 ${Wd + 64} ${H + 44}`} role="img" aria-label={t("margin.whaleChart", { peakPct: fmt.percent(whale.peakPct), count: Number(whale.peakAt) })}>
      {grid.map(v => <g key={v}><line x1={0} x2={Wd} y1={y(v)} y2={y(v)} className={v === 0 ? ui.axis : ui.gridLine}/><text x={-8} y={y(v) + 4} textAnchor="end" className={ui.tick}>{fmt.percent(v)}</text></g>)}
      <path d={area} className={ui.area}/>
      <path d={path} className={ui.line}/>
      {pts.length > 0 && <circle cx={x(peak.x)} cy={y(peak.y)} r={5} className={ui.peak}/>}
      <text x={0} y={H + 30} className={ui.tick}>{t("margin.whaleAxis")}</text>
    </svg>
    <DataGrid label={t("margin.whaleLosers")} testId="whale-losers" rows={whale.bottom} rowKey={r => r.key} columns={[
      { id: "customer", name: t("margin.lowestCustomers"), value: r => r.label ? `${r.key} · ${r.label}` : r.key, cell: r => <span translate="no">{r.key}{r.label ? ` · ${r.label}` : ""}</span> },
      { id: "pocket", name: t("margin.col.netPocket"), type: "money", num: true, value: r => r.pocket },
      { id: "margin", name: t("margin.col.margin"), type: "money", num: true, value: r => r.margin },
      { id: "rate", name: t("margin.col.rate"), type: "percent", num: true, value: r => r.rate === "n/a" ? null : r.rate.replace("%", ""), cell: r => fmt.percent(r.rate) },
    ]}/>
  </Card>;
}
function LeaksCard({ client, leaks, busy, operation, setMessage, onStatus, onEvidence }: { client: VaultClient; leaks: LeaksView | null; busy: boolean; operation: Shared["operation"]; setMessage: Shared["setMessage"]; onStatus: Shared["onStatus"]; onEvidence: (f: Finding) => void }) {
  const [picked, setPicked] = useState<Finding[]>([]);
  return <Card headingId="leaks-heading" title={<Term id="leak">{t("margin.leaks")}</Term>} actions={leaks && <LeakReportButton client={client} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus} ids={picked.length ? picked.map(f => f.id) : undefined}/>}>
    {!leaks ? <div aria-busy="true"><p className={styles.muted}>{t("margin.lookingForLeaks")}</p><Skeleton/></div> : <>
      <p>{t("margin.leakDollarsFound")}{" "}<strong data-testid="leak-total">{$(leaks.result.dedupedCents)}</strong>{" "}{t(leaks.sample ? "margin.acrossFindingsSample" : "margin.acrossFindings", { count: leaks.result.findings.length })}{leaks.result.overlapLines !== "0" ? " " + t("margin.overlap", { count: Number(leaks.result.overlapLines), overlapCents: $(leaks.result.overlapCents) }) : ""}</p>
      {leaks.result.findings.length > 1 && <p className={styles.small}>{t("margin.reportSelectionHint")}</p>}
      {leaks.result.findings.length ? <DataGrid label={t("margin.leakFindings")} testId="leak-findings" rows={leaks.result.findings} rowKey={f => f.id} onSelectionChange={setPicked} columns={[
        { id: "type", name: t("margin.col.type"), value: f => say(f.label), cell: f => <Badge tone="warn">{say(f.label)}</Badge> },
        { id: "finding", name: t("margin.col.finding"), value: f => say(f.title), cell: f => <span className={styles.wrap}>{say(f.title)}</span> },
        { id: "lines", name: t("margin.col.lines"), type: "int", num: true, value: f => f.lines },
        { id: "leak", name: t("margin.col.leak"), type: "money", num: true, value: f => f.cents, cell: f => <button className={ui.numLink} aria-label={t("margin.mathForLeak", { title: say(f.title) })} onClick={() => onEvidence(f)}>{$(f.cents)}</button> },
      ]}/> : <EmptyState icon="checkCircle" title={t("margin.noLeaks")}/>}
      <p className={styles.small}>{t("margin.notChecked", { uncosted: fmt.int(leaks.result.checked.uncostedLines), untiered: fmt.int(leaks.result.checked.untieredLines), credits: fmt.int(leaks.result.checked.creditLines), ms: leaks.result.ms })}</p>
    </>}
  </Card>;
}
/** Downloads the Leak Report PDF; with `ids` (findings ticked on screen) the report covers only those findings. */
export function LeakReportButton({ client, busy, operation, setMessage, onStatus, ids }: Pick<Shared, "client" | "busy" | "operation" | "setMessage" | "onStatus"> & { ids?: string[] }) {
  return <Button variant="primary" icon="download" disabled={busy} data-testid="leak-report-download" onClick={() => void operation(async () => {
    const out = await client.call("leakReport", ids ? { locale: getLocale(), ids } : { locale: getLocale() }); onStatus(out.status);
    const url = URL.createObjectURL(out.blob), a = document.createElement("a"); a.href = url; a.download = out.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(msg("margin.reportCreated", { bytes: Number(out.bytes) }));
  })}>{ids ? t("margin.downloadSelected", { count: ids.length }) : t("margin.downloadLeakReportPdf")}</Button>;
}
export function RoiCard({ client, version }: { client: VaultClient; version: string }) {
  const [roi, setRoi] = useState<RoiSummary | null>(null);
  useEffect(() => { let on = true; void client.call("roi", {}).then(r => { if (on) setRoi(r); }).catch(() => undefined); return () => { on = false; }; }, [client, version]);
  if (!roi) return null;
  return <Card headingId="roi-heading" title={<Term id="roi">{t("margin.roiTracker")}</Term>}>
    <p>{t("margin.leakDollarsFoundSo")}{" "}<strong data-testid="roi-total">{$(roi.identifiedCents)}</strong>{" "}{t(roi.since ? "home.acrossFindingsSince" : "home.acrossFindings", { count: Number(roi.findings), since: fmt.date(roi.since?.slice(0, 10)) })}</p>
    {roi.sampleFindings !== "0" && <p className={styles.small}>{t("margin.playgroundSampleFindingsAre", { sampleCents: $(roi.sampleCents) })}</p>}
    <p className={styles.muted}>{t("margin.aRunningTotalOf")}</p>
    <a href="#margin">{t("margin.openMargin")}</a>
  </Card>;
}
type SourceRow = MathPanel["rows"][number] | LeakRow;
function MathRows({ leak, lines, list, meta, gq, setGq, fetch }: { leak: boolean; lines: boolean; list: SourceRow[]; meta: import("@/lib/grid/core").GridMeta | undefined; gq: GridQuery; setGq: (q: GridQuery) => void; fetch: (q: GridQuery) => Promise<import("@/lib/grid/core").GridMeta> }) {
  const money = (k: "list" | "discount" | "freight" | "cost" | "pocket", name: string) => ({ id: k, name, type: "money" as const, num: true, value: (r: SourceRow) => (r[k] as string | null) ?? null, cell: (r: SourceRow) => $(r[k] as string | null) });
  return <DataGrid label={t("margin.sourceRows")} testId="math-rows" rows={list} rowKey={r => `${r.sourceFile}|${r.sourceRow}`} remote={{ query: gq, onQuery: setGq, meta, fetch }} columns={[
    { id: "file", name: t("margin.sourceFile"), value: r => r.sourceFile, cell: r => <span className={styles.wrap}><span translate="no">{r.sourceFile}</span>{"recordedRebate" in r && r.recordedRebate !== r.rebate && <p>{t("rebate.booked")}: {$(r.recordedRebate)} · {t("rebate.recognized")}: {$(r.rebate)}</p>}{"fxRate" in r && <><small>{t("fx.provenance", { source: r.sourceCurrency, workspace: r.workspaceCurrency, rate: fmt.decimal(r.fxRate) })}</small>{r.headerFx !== "[]" && <small>{t("fx.headerProvenance", { details: r.headerFx })}</small>}</>}</span> },
    { id: "source_row", name: t("margin.row"), type: "int", num: true, value: r => r.sourceRow },
    { id: "invoice", name: t("margin.invoice"), value: r => r.invoice, cell: r => <span translate="no">{r.invoice}</span> },
    { id: "d", name: t("margin.date"), type: "date", value: r => r.date },
    { id: "product_id", name: t("margin.product"), value: r => r.product, cell: r => <span translate="no">{r.product}</span> },
    { id: "customer_id", name: t("margin.customer"), value: r => r.customer, cell: r => <span translate="no">{r.customer}</span> },
    money("list", t("margin.list")), money("discount", t("margin.discount")), money("freight", t("margin.freight")), money("cost", t("margin.cost")), money("pocket", t("margin.pocket")),
    leak ? { id: "leak", name: t("margin.leak"), type: "money", num: true, value: r => "leak" in r ? r.leak : null, cell: r => "leak" in r ? $(r.leak) : null }
      : { id: "contribution", name: t("margin.contributes"), type: "money", num: true, value: r => lines ? null : (r as MathPanel["rows"][number]).contribution, cell: r => lines ? t("margin.lineCount", { count: 1 }) : $((r as MathPanel["rows"][number]).contribution) },
  ]}/>;
}
function MathView({ client, target, onClose }: { client: VaultClient; target: NonNullable<MathTarget>; onClose: () => void }) {
  const [gq, setGq] = useState<GridQuery>({}), [panel, setPanel] = useState<MathPanel | null>(null), [rows, setRows] = useState<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean; grid?: import("@/lib/grid/core").GridMeta } | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const leak = "leak" in target ? target.leak : null;
  useEffect(() => { setGq({}); setOffset(0); }, [target]);
  useEffect(() => { let on = true; setError("");
    const work = "leak" in target ? client.call("leakRows", { id: target.leak.id, offset, grid: gq }).then(r => { if (on) setRows(r); }) : client.call("marginMath", { metric: target.metric, filters: target.filters, offset, grid: gq }).then(p => { if (on) setPanel(p); });
    work.catch(e => { if (on) setError(e instanceof Error && e.message ? e.message : msg("margin.couldNotLoadThe")); }); return () => { on = false; }; }, [client, target, offset, leak, gq]);
  const title = leak ? say(leak.title) : (target as { title: string }).title, meta = leak ? rows?.grid : panel?.grid, count = Number(meta?.matched ?? (leak ? rows?.count ?? 0 : panel?.rowCount ?? 0));
  return <section className={`${ui.card} ${ui.focusCard}`} role="dialog" aria-modal="false" aria-labelledby="math-heading">
    <div className={ui.cardHead}><div><h2 id="math-heading">{t("margin.showTheMath", { title })}</h2></div><div className={ui.cardActions}><Button size="sm" icon="close" onClick={onClose}>{t("common.close")}</Button></div></div>
    {error && <Notice tone="bad" role="alert">{say(error)}</Notice>}
    {leak && <><p><strong>{say(leak.label)}{t("common.definitionSeparator")}</strong>{t("margin.leakOn", { cents: $(leak.cents), count: Number(leak.lines) })}</p><p className={styles.small}><strong>{t("margin.formula")}</strong> {say(leak.formula)}</p><p className={styles.small}>{say(leak.detail)}</p>
      {rows && <p className={styles.small}>{t("margin.evidenceSum", { sum: $(rows.sum), count: Number(rows.count) })}{" "}{rows.engineAgrees ? t("margin.eachLeakShownBelow") : t("margin.theMarginEngineDisagrees")}</p>}</>}
    {panel && <><p className={ui.mathValue}><strong data-testid="math-value">{panel.metric === "rate" ? bpPercent(panel.value) : panel.metric === "lines" ? t("margin.lineCount", { count: Number(panel.value) }) : $(panel.value)}</strong></p>
      <p className={styles.small}><strong>{t("margin.formula")}</strong> {say(panel.formula)}</p>
      <ul className={styles.small}>{panel.inputs.map(i => <li key={i.label}>{t("margin.input", { label: say(i.label), value: panel.metric === "lines" ? fmt.int(i.cents) : $(i.cents) })}</li>)}</ul>
      <Notice tone={panel.check.agrees && panel.rowsAgree ? "ok" : "warn"}>{panel.check.agrees ? t("margin.recomputedByTheMargin") : t("margin.theMarginEngineGot")} {panel.rowsAgree ? t("margin.sourceLinesAdd", { count: Number(panel.rowCount) }) : t("margin.theSourceLinesDo")}</Notice></>}
    {(panel?.rows.length || rows?.rows.length || gq.filters?.length) ? <MathRows leak={!!leak} lines={!leak && "metric" in target && target.metric === "lines"} list={(leak ? rows?.rows : panel?.rows) ?? []} meta={meta} gq={gq}
      setGq={q => { setGq(q); setOffset(0); }} fetch={q => leak ? client.call("leakRows", { id: leak.id, offset: 0, grid: q }).then(r => r.grid) : client.call("marginMath", { metric: (target as { metric: Metric }).metric, filters: (target as { filters: Filters }).filters, offset: 0, grid: q }).then(p => p.grid!)}/> : null}
    {count > 25 && <div className={ui.row}><Button size="sm" icon="chevronLeft" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("margin.previous25")}</Button><span className={styles.small}>{t("margin.rowsRange", { from: offset + 1, to: Math.min(count, offset + 25), count })}</span><Button size="sm" disabled={offset + 25 >= count} onClick={() => setOffset(offset + 25)}>{t("margin.next25")}</Button></div>}
  </section>;
}

export function MarginView(props:Shared){
 const [tab,setTab]=useState('waterfall');
 const canBridge=props.status.licence?.tier==='professional'||props.status.licence?.tier==='scale',shown=canBridge||tab==='health'?tab:'waterfall';
 useEffect(()=>{const read=()=>setTab(['#margin-bridge','#margin-competitors','#margin-service','#margin-health'].includes(location.hash)?location.hash.slice(8):'waterfall');read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 const items=[{id:'waterfall',label:t('margin.waterfall'),href:'#margin-waterfall'},{id:'health',label:t('monitor.healthTab'),href:'#margin-health',testId:'ops-tab-health'},...(canBridge?[{id:'bridge',label:t('ops.bridge'),href:'#margin-bridge',testId:'ops-tab-margin-bridge'},{id:'competitors',label:t('pc2.competitors'),href:'#margin-competitors',testId:'ops-tab-competitors'},{id:'service',label:t('pc2.service'),href:'#margin-service',testId:'ops-tab-service'}]:[])];
 const version=`${props.status.lines}|${props.status.generation}`;
 return <><SectionTabs label={t('margin.views')} current={shown} onSelect={setTab} items={items}/> {shown==='health'?<CustomerHealthView client={props.client} version={version}/>:shown==='competitors'?<CompetitorLog client={props.client} canEdit={!!props.status.access?.caps.includes('pricing')}/>:shown==='service'?<ServiceOrders client={props.client} canEdit={!!props.status.access?.caps.includes('pricing')}/>:shown==='bridge'?<MarginBridge client={props.client}/>:<WaterfallView {...props}/>}</>;
}
