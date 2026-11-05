"use client";
// Margin section (chunk 4D): waterfall, drill-down, whale curve, leaks, ROI and the
// "show me the math" panel. Every number is computed in the vault worker; this file only draws.
// Chunk 7U: text from message keys, amounts and counts through Intl, glossary popovers beside
// the numbers, chart colours from theme tokens.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus, LeaksView } from "@/lib/vault/protocol";
import type { Dim, Drill, Filters, MathPanel, Metric, Waterfall, Whale } from "@/lib/margin/views";
import type { Finding, LeakRow } from "@/lib/margin/leaks";
import type { RoiSummary } from "@/lib/margin/roi";
import { fmt, getLocale, msg, say, t, type MessageKey } from "@/lib/i18n";
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
export function MarginView({ client, busy, operation, setMessage, onStatus, status }: Shared) {
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
  if (status.lines === "0") return <section className={styles.card}><h2>{t("margin.waterfall")}</h2><p>{t("margin.empty")}</p><a className={styles.primary} href="#data-hub">{t("margin.openDataHub")}</a></section>;
  const max = w ? Math.max(1, ...w.steps.map(s => Math.abs(Number(s.cents)))) : 1;
  return <>
    {target && <MathView client={client} target={target} onClose={() => setTarget(null)}/>}
    <section className={styles.card} aria-labelledby="waterfall-heading">
      <h2 id="waterfall-heading"><Term id="waterfall">{t("margin.waterfall")}</Term></h2>
      <p className={styles.muted}>{t("margin.waterfallIntro")}</p>
      {filters.by.length > 0 && <div className={styles.row} role="group" aria-label={t("margin.activeFilters")}>{filters.by.map(x => <button key={x.dim} className={styles.linkish} aria-label={t("margin.removeFilter", { dim: dimName(x.dim), value: x.value })} onClick={() => setFilters(f => ({ ...f, by: f.by.filter(y => y.dim !== x.dim) }))}>{t("margin.filterChip", { dim: dimName(x.dim), value: x.value })} <span aria-hidden="true">✕</span></button>)}<button className={styles.linkish} onClick={() => setFilters(NONE)}>{t("margin.clearFilters")}</button></div>}
      {!w ? <p aria-busy="true">{t("margin.calculating")}</p> : <>
        <div className={styles.tableWrap}><table className={styles.table} aria-label={t("margin.waterfall")}>
          <thead><tr><th scope="col">{t("margin.step")}</th><th scope="col" style={{ width: "40%" }}>{t("margin.shareOfList")}</th><th scope="col">{t("margin.amount")}</th></tr></thead>
          <tbody>{w.steps.map(s => <tr key={s.key} data-header={s.kind === "subtotal" || s.kind === "end" || undefined}>
            <td>{say(s.label)}</td>
            <td><div aria-hidden="true" style={{ height: 12, width: `${Math.min(100, Math.abs(Number(s.cents)) / max * 100)}%`, background: s.kind === "minus" || Number(s.cents) < 0 ? "var(--chart-red)" : s.kind === "excluded" ? "var(--chart-track)" : "var(--chart-teal)", borderRadius: 3 }}/></td>
            <td><button className={styles.linkish} data-testid={`wf-${s.key}`} aria-label={t("margin.mathFor", { label: say(s.label) })} onClick={() => open(s.key, say(s.label))}>{$(s.cents)}</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className={styles.small}><Term id="marginRate">{t("margin.rateLabel")}</Term>{" "}<button className={styles.linkish} aria-label={t("margin.mathForRate")} onClick={() => open("rate", t("margin.pocketMarginRate"))}>{fmt.percent(w.rate)}</button>{" "}{t("margin.ofKnownCostPocket")}{t("common.listSeparator")}<button className={styles.linkish} aria-label={t("margin.mathForLines")} onClick={() => open("lines", t("margin.linesTitle"))}>{t("margin.lineCount", { count: Number(w.lines) })}</button>{t("common.listSeparator")}{t("margin.creditLines", { count: Number(w.credits.lines), ms: w.ms })}</p>
        {w.uncostedLines !== "0" && <p className={styles.warning}>{t("margin.uncosted", { count: Number(w.uncostedLines), pocket: $(w.uncostedPocket) })}</p>}
      </>}
    </section>
    <section className={styles.card} aria-labelledby="drill-heading">
      <h2 id="drill-heading">{t("margin.drillDown")}</h2>
      <div className={styles.grid}>
        <label>{t("margin.by")}<select value={dim} onChange={e => setDim(e.target.value as Dim)}>{(Object.keys(DIM_LABEL) as Dim[]).map(k => <option key={k} value={k}>{dimName(k)}</option>)}</select></label>
        <label>{t("margin.sort")}<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="pocket">{t("margin.sortPocket")}</option><option value="margin">{t("margin.sortMargin")}</option><option value="rate">{t("margin.sortRate")}</option></select></label>
      </div>
      {d && <><p className={styles.small}>{t(Number(d.total) > d.rows.length ? "margin.drillCountShowing" : "margin.drillCount", { count: Number(d.total), dim: dimName(d.dim).toLocaleLowerCase(getLocale()), shown: d.rows.length, ms: d.ms })}</p>
        <div className={styles.tableWrap}><table className={styles.table} aria-label={t("margin.marginBy", { dim: dimName(d.dim).toLocaleLowerCase(getLocale()) })}>
          <thead><tr><th scope="col">{dimName(d.dim)}</th><th scope="col">{t("margin.col.lines")}</th><th scope="col"><Term id="listPrice">{t("margin.col.list")}</Term></th><th scope="col"><Term id="discount">{t("margin.col.discounts")}</Term></th><th scope="col"><Term id="returnsCredits">{t("margin.col.credits")}</Term></th><th scope="col"><Term id="netPocket">{t("margin.col.netPocket")}</Term></th><th scope="col"><Term id="cost">{t("margin.col.cost")}</Term></th><th scope="col"><Term id="pocketMargin">{t("margin.col.margin")}</Term></th><th scope="col">{t("margin.col.rate")}</th><th scope="col">{t("margin.col.noCost")}</th><th scope="col"><span className={styles.srOnly}>{t("margin.col.actions")}</span></th></tr></thead>
          <tbody>{d.rows.map(r => { const f: Filters = { ...filters, by: [...filters.by.filter(x => x.dim !== d.dim), { dim: d.dim, value: r.key }] }, name = r.label ? `${r.key} · ${r.label}` : r.key || t("margin.blank");
            const cell = (metric: Metric, v: string, label: string) => <button className={styles.linkish} aria-label={t("margin.mathForRow", { label, key: r.key })} onClick={() => open(metric, t("margin.rowTitle", { label, name }), f)}>{$(v)}</button>;
            return <tr key={r.key}><td className={styles.wrap} translate="no">{name}</td><td>{fmt.int(r.lines)}</td><td>{cell("list", r.list, t("margin.col.list"))}</td><td>{cell("discount", r.discount, t("margin.col.discounts"))}</td><td>{cell("credits", r.credits, t("margin.returnsAndCredits"))}</td>
              <td>{cell("netPocket", r.pocket, t("margin.col.netPocket"))}</td><td>{cell("cost", r.cost, t("margin.col.cost"))}</td><td>{cell("margin", r.margin, t("margin.col.margin"))}</td><td>{fmt.percent(r.rate)}</td><td>{fmt.int(r.uncostedLines)}</td>
              <td><button className={styles.linkish} aria-label={t("margin.drillInto", { dim: dimName(d.dim), key: r.key })} onClick={() => addFilter(d.dim, r.key)}>{t("margin.drillIn")}</button></td></tr>; })}</tbody>
        </table></div></>}
    </section>
    <WhaleCard whale={whale} open={open}/>
    <LeaksCard client={client} leaks={leaks} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus} onEvidence={leak => setTarget({ leak })}/>
  </>;
}
function WhaleCard({ whale, open }: { whale: Whale | null; open: (m: Metric, t: string) => void }) {
  if (!whale) return null;
  if (!whale.available) return <section className={styles.card} aria-labelledby="whale-heading"><h2 id="whale-heading">{t("margin.whale")}</h2><p><span aria-hidden="true">🔒 </span>{say(whale.reason)}</p></section>;
  const pts = whale.points, ys = pts.map(p => p.y), top = Math.max(100, ...ys), bottom = Math.min(0, ...ys), H = 180, Wd = 520;
  const y = (v: number) => H - (v - bottom) / (top - bottom || 1) * H, path = pts.map((p, i) => `${i ? "L" : "M"}${(p.x / 100 * Wd).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  return <section className={styles.card} aria-labelledby="whale-heading">
    <h2 id="whale-heading"><Term id="whaleCurve">{t("margin.whale")}</Term></h2>
    <p className={styles.small}>{t("margin.whaleSummary", { peakAt: Number(whale.peakAt), count: Number(whale.customers), peakPct: fmt.percent(whale.peakPct), losers: Number(whale.losers), loserMargin: $(whale.loserMargin) })}{" "}<button className={styles.linkish} aria-label={t("margin.mathForTotal")} onClick={() => open("margin", t("margin.pocketMargin"))}>{$(whale.totalMargin)}</button>{t("roles.sentenceEnd")}{whale.uncostedCustomers !== "0" ? " " + t("margin.whaleUncosted", { count: Number(whale.uncostedCustomers) }) : ""}</p>
    <svg viewBox={`-40 -10 ${Wd + 60} ${H + 40}`} role="img" aria-label={t("margin.whaleChart", { peakPct: fmt.percent(whale.peakPct), count: Number(whale.peakAt) })} style={{ width: "100%", maxWidth: 640 }}>
      <line x1={0} x2={Wd} y1={y(100)} y2={y(100)} stroke="var(--border)" strokeDasharray="4 4"/><line x1={0} x2={Wd} y1={y(0)} y2={y(0)} stroke="var(--border-strong)"/>
      <text x={-6} y={y(100) + 4} fontSize={11} textAnchor="end" fill="var(--text-muted)">{fmt.percent(100)}</text><text x={-6} y={y(0) + 4} fontSize={11} textAnchor="end" fill="var(--text-muted)">{fmt.percent(0)}</text>
      <text x={0} y={H + 26} fontSize={11} fill="var(--text-muted)">{t("margin.whaleAxis")}</text>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5}/>
    </svg>
    <div className={styles.tableWrap}><table className={styles.table} aria-label={t("margin.whaleLosers")}><thead><tr><th scope="col">{t("margin.lowestCustomers")}</th><th scope="col">{t("margin.col.netPocket")}</th><th scope="col">{t("margin.col.margin")}</th><th scope="col">{t("margin.col.rate")}</th></tr></thead>
      <tbody>{whale.bottom.map(r => <tr key={r.key}><td translate="no">{r.key}{r.label ? ` · ${r.label}` : ""}</td><td>{$(r.pocket)}</td><td>{$(r.margin)}</td><td>{fmt.percent(r.rate)}</td></tr>)}</tbody></table></div>
  </section>;
}
function LeaksCard({ client, leaks, busy, operation, setMessage, onStatus, onEvidence }: { client: VaultClient; leaks: LeaksView | null; busy: boolean; operation: Shared["operation"]; setMessage: Shared["setMessage"]; onStatus: Shared["onStatus"]; onEvidence: (f: Finding) => void }) {
  return <section className={styles.card} aria-labelledby="leaks-heading">
    <h2 id="leaks-heading"><Term id="leak">{t("margin.leaks")}</Term></h2>
    {!leaks ? <p aria-busy="true">{t("margin.lookingForLeaks")}</p> : <>
      <p>{t("margin.leakDollarsFound")}{" "}<strong data-testid="leak-total">{$(leaks.result.dedupedCents)}</strong>{" "}{t(leaks.sample ? "margin.acrossFindingsSample" : "margin.acrossFindings", { count: leaks.result.findings.length })}{leaks.result.overlapLines !== "0" ? " " + t("margin.overlap", { count: Number(leaks.result.overlapLines), overlapCents: $(leaks.result.overlapCents) }) : ""}</p>
      <div className={styles.tableWrap}><table className={styles.table} aria-label={t("margin.leakFindings")}>
        <thead><tr><th scope="col">{t("margin.col.type")}</th><th scope="col">{t("margin.col.finding")}</th><th scope="col">{t("margin.col.lines")}</th><th scope="col">{t("margin.col.leak")}</th></tr></thead>
        <tbody>{leaks.result.findings.map(f => <tr key={f.id}><td>{say(f.label)}</td><td className={styles.wrap}>{say(f.title)}</td><td>{fmt.int(f.lines)}</td>
          <td><button className={styles.linkish} aria-label={t("margin.mathForLeak", { title: say(f.title) })} onClick={() => onEvidence(f)}>{$(f.cents)}</button></td></tr>)}</tbody>
      </table></div>
      {!leaks.result.findings.length && <p className={styles.muted}>{t("margin.noLeaks")}</p>}
      <p className={styles.small}>{t("margin.notChecked", { uncosted: fmt.int(leaks.result.checked.uncostedLines), untiered: fmt.int(leaks.result.checked.untieredLines), credits: fmt.int(leaks.result.checked.creditLines), ms: leaks.result.ms })}</p>
      <LeakReportButton client={client} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus}/>
    </>}
  </section>;
}
export function LeakReportButton({ client, busy, operation, setMessage, onStatus }: Pick<Shared, "client" | "busy" | "operation" | "setMessage" | "onStatus">) {
  return <button className={styles.primary} disabled={busy} onClick={() => void operation(async () => {
    const out = await client.call("leakReport", { locale: getLocale() }); onStatus(out.status);
    const url = URL.createObjectURL(out.blob), a = document.createElement("a"); a.href = url; a.download = out.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(msg("margin.reportCreated", { bytes: Number(out.bytes) }));
  })}>{t("margin.downloadLeakReportPdf")}</button>;
}
export function RoiCard({ client, version }: { client: VaultClient; version: string }) {
  const [roi, setRoi] = useState<RoiSummary | null>(null);
  useEffect(() => { let on = true; void client.call("roi", {}).then(r => { if (on) setRoi(r); }).catch(() => undefined); return () => { on = false; }; }, [client, version]);
  if (!roi) return null;
  return <section className={styles.card} aria-labelledby="roi-heading">
    <h2 id="roi-heading"><Term id="roi">{t("margin.roiTracker")}</Term></h2>
    <p>{t("margin.leakDollarsFoundSo")}{" "}<strong data-testid="roi-total">{$(roi.identifiedCents)}</strong>{" "}{t(roi.since ? "home.acrossFindingsSince" : "home.acrossFindings", { count: Number(roi.findings), since: fmt.date(roi.since?.slice(0, 10)) })}</p>
    {roi.sampleFindings !== "0" && <p className={styles.small}>{t("margin.playgroundSampleFindingsAre", { sampleCents: $(roi.sampleCents) })}</p>}
    <p className={styles.muted}>{t("margin.aRunningTotalOf")}</p>
    <a href="#margin">{t("margin.openMargin")}</a>
  </section>;
}
function MathView({ client, target, onClose }: { client: VaultClient; target: NonNullable<MathTarget>; onClose: () => void }) {
  const [panel, setPanel] = useState<MathPanel | null>(null), [rows, setRows] = useState<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean } | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const leak = "leak" in target ? target.leak : null;
  useEffect(() => { let on = true; setError("");
    const work = "leak" in target ? client.call("leakRows", { id: target.leak.id, offset }).then(r => { if (on) setRows(r); }) : client.call("marginMath", { metric: target.metric, filters: target.filters, offset }).then(p => { if (on) setPanel(p); });
    work.catch(e => { if (on) setError(e instanceof Error && e.message ? e.message : msg("margin.couldNotLoadThe")); }); return () => { on = false; }; }, [client, target, offset, leak]);
  const title = leak ? say(leak.title) : (target as { title: string }).title, count = Number(leak ? rows?.count ?? 0 : panel?.rowCount ?? 0);
  return <section className={styles.card} role="dialog" aria-modal="false" aria-labelledby="math-heading" style={{ borderColor: "var(--accent)", borderWidth: 2 }}>
    <div className={styles.title}><h2 id="math-heading">{t("margin.showTheMath", { title })}</h2><button onClick={onClose}>{t("common.close")}</button></div>
    {error && <p role="alert" className={styles.error}>{t("common.warningMark", { text: say(error) })}</p>}
    {leak && <><p><strong>{say(leak.label)}{t("common.definitionSeparator")}</strong>{t("margin.leakOn", { cents: $(leak.cents), count: Number(leak.lines) })}</p><p className={styles.small}><strong>{t("margin.formula")}</strong> {say(leak.formula)}</p><p className={styles.small}>{say(leak.detail)}</p>
      {rows && <p className={styles.small}>{t("margin.evidenceSum", { sum: $(rows.sum), count: Number(rows.count) })}{" "}{rows.engineAgrees ? t("margin.eachLeakShownBelow") : t("margin.theMarginEngineDisagrees")}</p>}</>}
    {panel && <><p><strong data-testid="math-value">{panel.metric === "rate" ? bpPercent(panel.value) : panel.metric === "lines" ? t("margin.lineCount", { count: Number(panel.value) }) : $(panel.value)}</strong></p>
      <p className={styles.small}><strong>{t("margin.formula")}</strong> {say(panel.formula)}</p>
      <ul className={styles.small}>{panel.inputs.map(i => <li key={i.label}>{t("margin.input", { label: say(i.label), value: panel.metric === "lines" ? fmt.int(i.cents) : $(i.cents) })}</li>)}</ul>
      <p className={styles.small}>{panel.check.agrees ? t("margin.recomputedByTheMargin") : t("margin.theMarginEngineGot")} {panel.rowsAgree ? t("margin.sourceLinesAdd", { count: Number(panel.rowCount) }) : t("margin.theSourceLinesDo")}</p></>}
    {(panel?.rows.length || rows?.rows.length) ? <div className={styles.tableWrap}><table className={styles.table} aria-label={t("margin.sourceRows")}>
      <thead><tr><th scope="col">{t("margin.sourceFile")}</th><th scope="col">{t("margin.row")}</th><th scope="col">{t("margin.invoice")}</th><th scope="col">{t("margin.date")}</th><th scope="col">{t("margin.product")}</th><th scope="col">{t("margin.customer")}</th><th scope="col">{t("margin.list")}</th><th scope="col">{t("margin.discount")}</th><th scope="col">{t("margin.freight")}</th><th scope="col">{t("margin.cost")}</th><th scope="col">{t("margin.pocket")}</th><th scope="col">{leak ? t("margin.leak") : t("margin.contributes")}</th></tr></thead>
      <tbody>{(leak ? rows!.rows : panel!.rows).map(r => <tr key={`${r.sourceFile}|${r.sourceRow}`}><td className={styles.wrap} translate="no">{r.sourceFile}</td><td>{fmt.int(r.sourceRow)}</td><td translate="no">{r.invoice}</td><td>{fmt.date(r.date)}</td><td translate="no">{r.product}</td><td translate="no">{r.customer}</td>
        <td>{$(r.list)}</td><td>{$(r.discount)}</td><td>{$(r.freight)}</td><td>{$(r.cost)}</td><td>{$(r.pocket)}</td><td>{"leak" in r ? $(r.leak) : target && "metric" in target && target.metric === "lines" ? t("margin.lineCount", { count: 1 }) : $((r as MathPanel["rows"][number]).contribution)}</td></tr>)}</tbody>
    </table></div> : null}
    {count > 25 && <div className={styles.row}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>{t("margin.previous25")}</button><span className={styles.small}>{t("margin.rowsRange", { from: offset + 1, to: Math.min(count, offset + 25), count })}</span><button disabled={offset + 25 >= count} onClick={() => setOffset(offset + 25)}>{t("margin.next25")}</button></div>}
  </section>;
}
