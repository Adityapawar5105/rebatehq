"use client";
import {CompetitorLog,ServiceOrders} from './PricingTools';
import {MarginBridge} from "./PricingOps";
import {SectionTabs} from "@/components/ui/ui";

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
  const [d, setD] = useState<Drill | null>(null), [whale, setWhale] = useState<Whale | null>(null), [leaks, setLeaks] = useState<LeaksView | null>(null), [target, setTarget] = useState<MathTarget>(null);
  const version = `${status.lines}|${status.generation}`;
  useEffect(() => { let on = true; void client.call("marginWaterfall", { filters }).then(x => { if (on) setW(x); }).catch(() => undefined); void client.call("marginWhale", { filters }).then(x => { if (on) setWhale(x); }).catch(() => undefined); return () => { on = false; }; }, [client, filters, version]);
  useEffect(() => { let on = true; void client.call("marginDrill", { dim, filters, sort }).then(x => { if (on) setD(x); }).catch(() => undefined); return () => { on = false; }; }, [client, dim, filters, sort, version]);
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
        <div className={`${ui.tableWrap} ${ui.tall}`}><table className={ui.table} aria-label={t("margin.marginBy", { dim: dimName(d.dim).toLocaleLowerCase(getLocale()) })}>
          <thead><tr><th scope="col">{dimName(d.dim)}</th><th scope="col" className={numCell}>{t("margin.col.lines")}</th><th scope="col" className={numCell}><Term id="listPrice">{t("margin.col.list")}</Term></th><th scope="col" className={numCell}><Term id="discount">{t("margin.col.discounts")}</Term></th><th scope="col" className={numCell}><Term id="returnsCredits">{t("margin.col.credits")}</Term></th><th scope="col" className={numCell}><Term id="netPocket">{t("margin.col.netPocket")}</Term></th><th scope="col" className={numCell}><Term id="cost">{t("margin.col.cost")}</Term></th><th scope="col" className={numCell}><Term id="pocketMargin">{t("margin.col.margin")}</Term></th><th scope="col" className={numCell}>{t("margin.col.rate")}</th><th scope="col" className={numCell}>{t("margin.col.noCost")}</th><th scope="col"><span className={styles.srOnly}>{t("margin.col.actions")}</span></th></tr></thead>
          <tbody>{d.rows.map(r => { const f: Filters = { ...filters, by: [...filters.by.filter(x => x.dim !== d.dim), { dim: d.dim, value: r.key }] }, name = r.label ? `${r.key} · ${r.label}` : r.key || t("margin.blank");
            const cell = (metric: Metric, v: string, label: string) => <td className={numCell}><button className={ui.numLink} aria-label={t("margin.mathForRow", { label, key: r.key })} onClick={() => open(metric, t("margin.rowTitle", { label, name }), f)}>{$(v)}</button></td>;
            return <tr key={r.key}><td className={styles.wrap} translate="no">{name}</td><td className={numCell}>{fmt.int(r.lines)}</td>{cell("list", r.list, t("margin.col.list"))}{cell("discount", r.discount, t("margin.col.discounts"))}{cell("credits", r.credits, t("margin.returnsAndCredits"))}
              {cell("netPocket", r.pocket, t("margin.col.netPocket"))}{cell("cost", r.cost, t("margin.col.cost"))}{cell("margin", r.margin, t("margin.col.margin"))}<td className={numCell}>{fmt.percent(r.rate)}</td><td className={numCell}>{fmt.int(r.uncostedLines)}</td>
              <td><Button size="sm" variant="ghost" icon="chevronRight" aria-label={t("margin.drillInto", { dim: dimName(d.dim), key: r.key })} onClick={() => addFilter(d.dim, r.key)}>{t("margin.drillIn")}</Button></td></tr>; })}</tbody>
        </table></div></>}
    </Card>
    <WhaleCard whale={whale} open={open}/>
    <LeaksCard client={client} leaks={leaks} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus} onEvidence={leak => setTarget({ leak })}/>
  </>;
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
    <div className={ui.tableWrap}><table className={ui.table} aria-label={t("margin.whaleLosers")}><thead><tr><th scope="col">{t("margin.lowestCustomers")}</th><th scope="col" className={numCell}>{t("margin.col.netPocket")}</th><th scope="col" className={numCell}>{t("margin.col.margin")}</th><th scope="col" className={numCell}>{t("margin.col.rate")}</th></tr></thead>
      <tbody>{whale.bottom.map(r => <tr key={r.key}><td translate="no">{r.key}{r.label ? ` · ${r.label}` : ""}</td><td className={numCell}>{$(r.pocket)}</td><td className={numCell}>{$(r.margin)}</td><td className={numCell}>{fmt.percent(r.rate)}</td></tr>)}</tbody></table></div>
  </Card>;
}
function LeaksCard({ client, leaks, busy, operation, setMessage, onStatus, onEvidence }: { client: VaultClient; leaks: LeaksView | null; busy: boolean; operation: Shared["operation"]; setMessage: Shared["setMessage"]; onStatus: Shared["onStatus"]; onEvidence: (f: Finding) => void }) {
  return <Card headingId="leaks-heading" title={<Term id="leak">{t("margin.leaks")}</Term>} actions={leaks && <LeakReportButton client={client} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus}/>}>
    {!leaks ? <div aria-busy="true"><p className={styles.muted}>{t("margin.lookingForLeaks")}</p><Skeleton/></div> : <>
      <p>{t("margin.leakDollarsFound")}{" "}<strong data-testid="leak-total">{$(leaks.result.dedupedCents)}</strong>{" "}{t(leaks.sample ? "margin.acrossFindingsSample" : "margin.acrossFindings", { count: leaks.result.findings.length })}{leaks.result.overlapLines !== "0" ? " " + t("margin.overlap", { count: Number(leaks.result.overlapLines), overlapCents: $(leaks.result.overlapCents) }) : ""}</p>
      {leaks.result.findings.length ? <div className={ui.tableWrap}><table className={ui.table} aria-label={t("margin.leakFindings")}>
        <thead><tr><th scope="col">{t("margin.col.type")}</th><th scope="col">{t("margin.col.finding")}</th><th scope="col" className={numCell}>{t("margin.col.lines")}</th><th scope="col" className={numCell}>{t("margin.col.leak")}</th></tr></thead>
        <tbody>{leaks.result.findings.map(f => <tr key={f.id}><td><Badge tone="warn">{say(f.label)}</Badge></td><td className={styles.wrap}>{say(f.title)}</td><td className={numCell}>{fmt.int(f.lines)}</td>
          <td className={numCell}><button className={ui.numLink} aria-label={t("margin.mathForLeak", { title: say(f.title) })} onClick={() => onEvidence(f)}>{$(f.cents)}</button></td></tr>)}</tbody>
      </table></div> : <EmptyState icon="checkCircle" title={t("margin.noLeaks")}/>}
      <p className={styles.small}>{t("margin.notChecked", { uncosted: fmt.int(leaks.result.checked.uncostedLines), untiered: fmt.int(leaks.result.checked.untieredLines), credits: fmt.int(leaks.result.checked.creditLines), ms: leaks.result.ms })}</p>
    </>}
  </Card>;
}
export function LeakReportButton({ client, busy, operation, setMessage, onStatus }: Pick<Shared, "client" | "busy" | "operation" | "setMessage" | "onStatus">) {
  return <Button variant="primary" icon="download" disabled={busy} onClick={() => void operation(async () => {
    const out = await client.call("leakReport", { locale: getLocale() }); onStatus(out.status);
    const url = URL.createObjectURL(out.blob), a = document.createElement("a"); a.href = url; a.download = out.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(msg("margin.reportCreated", { bytes: Number(out.bytes) }));
  })}>{t("margin.downloadLeakReportPdf")}</Button>;
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
function MathView({ client, target, onClose }: { client: VaultClient; target: NonNullable<MathTarget>; onClose: () => void }) {
  const [panel, setPanel] = useState<MathPanel | null>(null), [rows, setRows] = useState<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean } | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const leak = "leak" in target ? target.leak : null;
  useEffect(() => { let on = true; setError("");
    const work = "leak" in target ? client.call("leakRows", { id: target.leak.id, offset }).then(r => { if (on) setRows(r); }) : client.call("marginMath", { metric: target.metric, filters: target.filters, offset }).then(p => { if (on) setPanel(p); });
    work.catch(e => { if (on) setError(e instanceof Error && e.message ? e.message : msg("margin.couldNotLoadThe")); }); return () => { on = false; }; }, [client, target, offset, leak]);
  const title = leak ? say(leak.title) : (target as { title: string }).title, count = Number(leak ? rows?.count ?? 0 : panel?.rowCount ?? 0);
  return <section className={`${ui.card} ${ui.focusCard}`} role="dialog" aria-modal="false" aria-labelledby="math-heading">
    <div className={ui.cardHead}><div><h2 id="math-heading">{t("margin.showTheMath", { title })}</h2></div><div className={ui.cardActions}><Button size="sm" icon="close" onClick={onClose}>{t("common.close")}</Button></div></div>
    {error && <Notice tone="bad" role="alert">{t("common.warningMark", { text: say(error) })}</Notice>}
    {leak && <><p><strong>{say(leak.label)}{t("common.definitionSeparator")}</strong>{t("margin.leakOn", { cents: $(leak.cents), count: Number(leak.lines) })}</p><p className={styles.small}><strong>{t("margin.formula")}</strong> {say(leak.formula)}</p><p className={styles.small}>{say(leak.detail)}</p>
      {rows && <p className={styles.small}>{t("margin.evidenceSum", { sum: $(rows.sum), count: Number(rows.count) })}{" "}{rows.engineAgrees ? t("margin.eachLeakShownBelow") : t("margin.theMarginEngineDisagrees")}</p>}</>}
    {panel && <><p className={ui.mathValue}><strong data-testid="math-value">{panel.metric === "rate" ? bpPercent(panel.value) : panel.metric === "lines" ? t("margin.lineCount", { count: Number(panel.value) }) : $(panel.value)}</strong></p>
      <p className={styles.small}><strong>{t("margin.formula")}</strong> {say(panel.formula)}</p>
      <ul className={styles.small}>{panel.inputs.map(i => <li key={i.label}>{t("margin.input", { label: say(i.label), value: panel.metric === "lines" ? fmt.int(i.cents) : $(i.cents) })}</li>)}</ul>
      <Notice tone={panel.check.agrees && panel.rowsAgree ? "ok" : "warn"}>{panel.check.agrees ? t("margin.recomputedByTheMargin") : t("margin.theMarginEngineGot")} {panel.rowsAgree ? t("margin.sourceLinesAdd", { count: Number(panel.rowCount) }) : t("margin.theSourceLinesDo")}</Notice></>}
    {(panel?.rows.length || rows?.rows.length) ? <div className={ui.tableWrap}><table className={ui.table} aria-label={t("margin.sourceRows")}>
      <thead><tr><th scope="col">{t("margin.sourceFile")}</th><th scope="col" className={numCell}>{t("margin.row")}</th><th scope="col">{t("margin.invoice")}</th><th scope="col">{t("margin.date")}</th><th scope="col">{t("margin.product")}</th><th scope="col">{t("margin.customer")}</th><th scope="col" className={numCell}>{t("margin.list")}</th><th scope="col" className={numCell}>{t("margin.discount")}</th><th scope="col" className={numCell}>{t("margin.freight")}</th><th scope="col" className={numCell}>{t("margin.cost")}</th><th scope="col" className={numCell}>{t("margin.pocket")}</th><th scope="col" className={numCell}>{leak ? t("margin.leak") : t("margin.contributes")}</th></tr></thead>
      <tbody>{(leak ? rows!.rows : panel!.rows).map(r => <tr key={`${r.sourceFile}|${r.sourceRow}`}><td className={styles.wrap}><span translate="no">{r.sourceFile}</span>{'fxRate' in r && <><small>{t('fx.provenance',{source:r.sourceCurrency,workspace:r.workspaceCurrency,rate:fmt.decimal(r.fxRate)})}</small>{r.headerFx !== '[]' && <small>{t('fx.headerProvenance',{details:r.headerFx})}</small>}</>}</td><td className={numCell}>{fmt.int(r.sourceRow)}</td><td translate="no">{r.invoice}</td><td>{fmt.date(r.date)}</td><td translate="no">{r.product}</td><td translate="no">{r.customer}</td>
        <td className={numCell}>{$(r.list)}</td><td className={numCell}>{$(r.discount)}</td><td className={numCell}>{$(r.freight)}</td><td className={numCell}>{$(r.cost)}</td><td className={numCell}>{$(r.pocket)}</td><td className={numCell}>{"leak" in r ? $(r.leak) : target && "metric" in target && target.metric === "lines" ? t("margin.lineCount", { count: 1 }) : $((r as MathPanel["rows"][number]).contribution)}</td></tr>)}</tbody>
    </table></div> : null}
    {count > 25 && <div className={ui.row}><Button size="sm" icon="chevronLeft" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("margin.previous25")}</Button><span className={styles.small}>{t("margin.rowsRange", { from: offset + 1, to: Math.min(count, offset + 25), count })}</span><Button size="sm" disabled={offset + 25 >= count} onClick={() => setOffset(offset + 25)}>{t("margin.next25")}</Button></div>}
  </section>;
}

export function MarginView(props:Shared){
 const [tab,setTab]=useState('waterfall');
 const canBridge=props.status.licence?.tier==='professional'||props.status.licence?.tier==='scale',shown=canBridge?tab:'waterfall';
 useEffect(()=>{const read=()=>setTab(['#margin-bridge','#margin-competitors','#margin-service'].includes(location.hash)?location.hash.slice(8):'waterfall');read();window.addEventListener('hashchange',read);return()=>window.removeEventListener('hashchange',read);},[]);
 return <>{canBridge&&<SectionTabs label={t('ops.bridge')} current={shown} onSelect={setTab} items={[{id:'waterfall',label:t('margin.waterfall'),href:'#margin-waterfall'},{id:'bridge',label:t('ops.bridge'),href:'#margin-bridge',testId:'ops-tab-margin-bridge'},{id:'competitors',label:t('pc2.competitors'),href:'#margin-competitors',testId:'ops-tab-competitors'},{id:'service',label:t('pc2.service'),href:'#margin-service',testId:'ops-tab-service'}]}/>} {shown==='competitors'?<CompetitorLog client={props.client} canEdit={!!props.status.access?.caps.includes('pricing')}/>:shown==='service'?<ServiceOrders client={props.client} canEdit={!!props.status.access?.caps.includes('pricing')}/>:shown==='bridge'?<MarginBridge client={props.client}/>:<WaterfallView {...props}/>}</>;
}
