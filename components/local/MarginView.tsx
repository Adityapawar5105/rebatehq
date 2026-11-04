"use client";
// Margin section (chunk 4D): waterfall, drill-down, whale curve, leaks, ROI and the
// "show me the math" panel. Every number is computed in the vault worker; this file only draws.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { VaultStatus, LeaksView } from "@/lib/vault/protocol";
import type { Dim, Drill, Filters, MathPanel, Metric, Waterfall, Whale } from "@/lib/margin/views";
import type { Finding, LeakRow } from "@/lib/margin/leaks";
import type { RoiSummary } from "@/lib/margin/roi";
import { moneyText } from "@/lib/spike/exact";
import styles from "./vault.module.css";
type Shared = { client: VaultClient; busy: boolean; operation: (work: () => Promise<void>) => Promise<void>; setMessage: (m: string) => void; onStatus: (s: VaultStatus) => void; status: VaultStatus };
const $ = (cents: string | null | undefined) => cents === null || cents === undefined ? "unknown" : (cents.startsWith("-") ? "-$" + moneyText(cents.slice(1)) : "$" + moneyText(cents));
const DIM_LABEL: Record<Dim, string> = { product: "Product", category: "Category", customer: "Customer", branch: "Branch", tier: "Tier", region: "Region", month: "Month" };
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
  const open = (metric: Metric, title: string, f: Filters = filters) => setTarget({ metric, filters: f, title });
  if (status.lines === "0") return <section className={styles.card}><h2>Margin waterfall</h2><p>Import sales history in Data Hub, or load the Playground, to see your waterfall, drill-downs and leaks.</p><a className={styles.primary} href="#data-hub">Open Data Hub</a></section>;
  const max = w ? Math.max(1, ...w.steps.map(s => Math.abs(Number(s.cents)))) : 1;
  return <>
    {target && <MathView client={client} target={target} onClose={() => setTarget(null)}/>}
    <section className={styles.card} aria-labelledby="waterfall-heading">
      <h2 id="waterfall-heading">Margin waterfall</h2>
      <p className={styles.muted}>List price to pocket margin, in exact cents from your imported lines. Select any amount to see its formula and source rows.</p>
      {filters.by.length > 0 && <div className={styles.row} aria-label="Active filters">{filters.by.map(x => <button key={x.dim} className={styles.linkish} aria-label={`Remove filter ${DIM_LABEL[x.dim]} ${x.value}`} onClick={() => setFilters(f => ({ ...f, by: f.by.filter(y => y.dim !== x.dim) }))}>{DIM_LABEL[x.dim]}: {x.value} ✕</button>)}<button className={styles.linkish} onClick={() => setFilters(NONE)}>Clear filters</button></div>}
      {!w ? <p aria-busy="true">Calculating…</p> : <>
        <div className={styles.tableWrap}><table className={styles.table} aria-label="Margin waterfall">
          <thead><tr><th scope="col">Step</th><th scope="col" style={{ width: "40%" }}>Share of list</th><th scope="col">Amount</th></tr></thead>
          <tbody>{w.steps.map(s => <tr key={s.key} data-header={s.kind === "subtotal" || s.kind === "end" || undefined}>
            <td>{s.label}</td>
            <td><div aria-hidden="true" style={{ height: 12, width: `${Math.min(100, Math.abs(Number(s.cents)) / max * 100)}%`, background: s.kind === "minus" || Number(s.cents) < 0 ? "#e7b3ad" : s.kind === "excluded" ? "#d2dcdf" : "#9cc8cf", borderRadius: 3 }}/></td>
            <td><button className={styles.linkish} data-testid={`wf-${s.key}`} aria-label={`Show the math for ${s.label}`} onClick={() => open(s.key, s.label)}>{$(s.cents)}</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className={styles.small}>Pocket margin rate: <button className={styles.linkish} aria-label="Show the math for the pocket margin rate" onClick={() => open("rate", "Pocket margin rate")}>{w.rate}</button> of pocket with known cost · <button className={styles.linkish} aria-label="Show the math for line count" onClick={() => open("lines", "Lines")}>{Number(w.lines).toLocaleString("en-US")} lines</button> · {Number(w.credits.lines).toLocaleString("en-US")} return/credit lines · calculated in {w.ms} ms</p>
        {w.uncostedLines !== "0" && <p className={styles.warning}>⚠ {Number(w.uncostedLines).toLocaleString("en-US")} lines have no known cost. Their pocket ({$(w.uncostedPocket)}) is left out of margin; cost is never assumed to be zero. Load an item master or vendor costs to include them.</p>}
      </>}
    </section>
    <section className={styles.card} aria-labelledby="drill-heading">
      <h2 id="drill-heading">Drill down</h2>
      <div className={styles.grid}>
        <label>By<select value={dim} onChange={e => setDim(e.target.value as Dim)}>{(Object.keys(DIM_LABEL) as Dim[]).map(k => <option key={k} value={k}>{DIM_LABEL[k]}</option>)}</select></label>
        <label>Sort<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="pocket">Largest pocket first</option><option value="margin">Lowest margin first</option><option value="rate">Lowest margin rate first</option></select></label>
      </div>
      {d && <><p className={styles.small}>{Number(d.total).toLocaleString("en-US")} {DIM_LABEL[d.dim].toLowerCase()} values{Number(d.total) > d.rows.length ? `; showing ${d.rows.length}` : ""} · {d.ms} ms</p>
        <div className={styles.tableWrap}><table className={styles.table} aria-label={`Margin by ${DIM_LABEL[d.dim].toLowerCase()}`}>
          <thead><tr><th scope="col">{DIM_LABEL[d.dim]}</th><th scope="col">Lines</th><th scope="col">List</th><th scope="col">Discounts</th><th scope="col">Returns/credits</th><th scope="col">Net pocket</th><th scope="col">Cost</th><th scope="col">Margin</th><th scope="col">Rate</th><th scope="col">No cost</th><th scope="col"></th></tr></thead>
          <tbody>{d.rows.map(r => { const f: Filters = { ...filters, by: [...filters.by.filter(x => x.dim !== d.dim), { dim: d.dim, value: r.key }] }, name = r.label ? `${r.key} · ${r.label}` : r.key || "(blank)";
            const cell = (metric: Metric, v: string, label: string) => <button className={styles.linkish} aria-label={`Show the math for ${label} of ${r.key}`} onClick={() => open(metric, `${label}: ${name}`, f)}>{$(v)}</button>;
            return <tr key={r.key}><td className={styles.wrap}>{name}</td><td>{Number(r.lines).toLocaleString("en-US")}</td><td>{cell("list", r.list, "List")}</td><td>{cell("discount", r.discount, "Discounts")}</td><td>{cell("credits", r.credits, "Returns and credits")}</td>
              <td>{cell("netPocket", r.pocket, "Net pocket")}</td><td>{cell("cost", r.cost, "Cost")}</td><td>{cell("margin", r.margin, "Margin")}</td><td>{r.rate}</td><td>{r.uncostedLines}</td>
              <td><button className={styles.linkish} aria-label={`Drill into ${DIM_LABEL[d.dim]} ${r.key}`} onClick={() => addFilter(d.dim, r.key)}>Drill in</button></td></tr>; })}</tbody>
        </table></div></>}
    </section>
    <WhaleCard whale={whale} open={open}/>
    <LeaksCard client={client} leaks={leaks} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus} onEvidence={leak => setTarget({ leak })}/>
  </>;
}
function WhaleCard({ whale, open }: { whale: Whale | null; open: (m: Metric, t: string) => void }) {
  if (!whale) return null;
  if (!whale.available) return <section className={styles.card} aria-labelledby="whale-heading"><h2 id="whale-heading">Customer profitability (whale curve)</h2><p>🔒 {whale.reason}</p></section>;
  const pts = whale.points, ys = pts.map(p => p.y), top = Math.max(100, ...ys), bottom = Math.min(0, ...ys), H = 180, Wd = 520;
  const y = (v: number) => H - (v - bottom) / (top - bottom || 1) * H, path = pts.map((p, i) => `${i ? "L" : "M"}${(p.x / 100 * Wd).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  return <section className={styles.card} aria-labelledby="whale-heading">
    <h2 id="whale-heading">Customer profitability (whale curve)</h2>
    <p className={styles.small}>Customers ranked by pocket margin; the line is cumulative margin as a share of the total. The most profitable {whale.peakAt} of {whale.customers} customers earn {whale.peakPct} of total margin; {whale.losers} customers lose {$(whale.loserMargin)}. Total: <button className={styles.linkish} aria-label="Show the math for total margin" onClick={() => open("margin", "Pocket margin")}>{$(whale.totalMargin)}</button>.{whale.uncostedCustomers !== "0" ? ` ${whale.uncostedCustomers} customers have lines with unknown cost.` : ""}</p>
    <svg viewBox={`-40 -10 ${Wd + 60} ${H + 40}`} role="img" aria-label={`Whale curve: peak ${whale.peakPct} of total margin at ${whale.peakAt} customers`} style={{ width: "100%", maxWidth: 640 }}>
      <line x1={0} x2={Wd} y1={y(100)} y2={y(100)} stroke="#d2dcdf" strokeDasharray="4 4"/><line x1={0} x2={Wd} y1={y(0)} y2={y(0)} stroke="#72868b"/>
      <text x={-6} y={y(100) + 4} fontSize={11} textAnchor="end" fill="#466069">100%</text><text x={-6} y={y(0) + 4} fontSize={11} textAnchor="end" fill="#466069">0%</text>
      <text x={0} y={H + 26} fontSize={11} fill="#466069">customers, most profitable first →</text>
      <path d={path} fill="none" stroke="#075e6d" strokeWidth={2.5}/>
    </svg>
    <div className={styles.tableWrap}><table className={styles.table} aria-label="Customers losing the most margin"><thead><tr><th scope="col">Lowest-margin customers</th><th scope="col">Net pocket</th><th scope="col">Margin</th><th scope="col">Rate</th></tr></thead>
      <tbody>{whale.bottom.map(r => <tr key={r.key}><td>{r.key}{r.label ? ` · ${r.label}` : ""}</td><td>{$(r.pocket)}</td><td>{$(r.margin)}</td><td>{r.rate}</td></tr>)}</tbody></table></div>
  </section>;
}
function LeaksCard({ client, leaks, busy, operation, setMessage, onStatus, onEvidence }: { client: VaultClient; leaks: LeaksView | null; busy: boolean; operation: Shared["operation"]; setMessage: Shared["setMessage"]; onStatus: Shared["onStatus"]; onEvidence: (f: Finding) => void }) {
  return <section className={styles.card} aria-labelledby="leaks-heading">
    <h2 id="leaks-heading">Margin leaks</h2>
    {!leaks ? <p aria-busy="true">Looking for leaks…</p> : <>
      <p>Leak dollars found: <strong data-testid="leak-total">{$(leaks.result.dedupedCents)}</strong> across {leaks.result.findings.length} findings{leaks.sample ? " (sample data, not counted in your ROI tracker)" : ""}.{leaks.result.overlapLines !== "0" ? ` ${Number(leaks.result.overlapLines).toLocaleString("en-US")} lines appear in more than one finding; the overlap (${$(leaks.result.overlapCents)}) is counted once.` : ""}</p>
      <div className={styles.tableWrap}><table className={styles.table} aria-label="Leak findings">
        <thead><tr><th scope="col">Type</th><th scope="col">Finding</th><th scope="col">Lines</th><th scope="col">Leak</th></tr></thead>
        <tbody>{leaks.result.findings.map(f => <tr key={f.id}><td>{f.label}</td><td className={styles.wrap}>{f.title}</td><td>{Number(f.lines).toLocaleString("en-US")}</td>
          <td><button className={styles.linkish} aria-label={`Show the math for leak ${f.title}`} onClick={() => onEvidence(f)}>{$(f.cents)}</button></td></tr>)}</tbody>
      </table></div>
      {!leaks.result.findings.length && <p className={styles.muted}>No leaks found by the current rules.</p>}
      <p className={styles.small}>Not checked: {Number(leaks.result.checked.uncostedLines).toLocaleString("en-US")} lines with unknown cost (margin rules), {Number(leaks.result.checked.untieredLines).toLocaleString("en-US")} lines without a usable tier (discount rules); {Number(leaks.result.checked.creditLines).toLocaleString("en-US")} return/credit lines are never leaks. Found in {leaks.result.ms} ms.</p>
      <LeakReportButton client={client} busy={busy} operation={operation} setMessage={setMessage} onStatus={onStatus}/>
    </>}
  </section>;
}
export function LeakReportButton({ client, busy, operation, setMessage, onStatus }: Pick<Shared, "client" | "busy" | "operation" | "setMessage" | "onStatus">) {
  return <button className={styles.primary} disabled={busy} onClick={() => void operation(async () => {
    const out = await client.call("leakReport", {}); onStatus(out.status);
    const url = URL.createObjectURL(out.blob), a = document.createElement("a"); a.href = url; a.download = out.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(`Leak Report PDF created on this device (${Number(out.bytes).toLocaleString("en-US")} bytes); nothing was uploaded. The export is in the audit log.`);
  })}>Download Leak Report (PDF)</button>;
}
export function RoiCard({ client, version }: { client: VaultClient; version: string }) {
  const [roi, setRoi] = useState<RoiSummary | null>(null);
  useEffect(() => { let on = true; void client.call("roi", {}).then(r => { if (on) setRoi(r); }).catch(() => undefined); return () => { on = false; }; }, [client, version]);
  if (!roi) return null;
  return <section className={styles.card} aria-labelledby="roi-heading">
    <h2 id="roi-heading">ROI tracker</h2>
    <p>Leak dollars found so far: <strong data-testid="roi-total">{$(roi.identifiedCents)}</strong> across {roi.findings} findings{roi.since ? ` since ${roi.since.slice(0, 10)}` : ""}.</p>
    {roi.sampleFindings !== "0" && <p className={styles.small}>Playground sample findings ({$(roi.sampleCents)}) are kept apart and never counted.</p>}
    <p className={styles.muted}>A running total of leaks the leak finder has identified in your data. Dollars actually recovered are tracked from Phase 2, once price changes are recorded.</p>
    <a href="#margin">Open Margin</a>
  </section>;
}
function MathView({ client, target, onClose }: { client: VaultClient; target: NonNullable<MathTarget>; onClose: () => void }) {
  const [panel, setPanel] = useState<MathPanel | null>(null), [rows, setRows] = useState<{ rows: LeakRow[]; count: string; sum: string; engineAgrees: boolean } | null>(null), [offset, setOffset] = useState(0), [error, setError] = useState("");
  const leak = "leak" in target ? target.leak : null;
  useEffect(() => { let on = true; setError("");
    const work = "leak" in target ? client.call("leakRows", { id: target.leak.id, offset }).then(r => { if (on) setRows(r); }) : client.call("marginMath", { metric: target.metric, filters: target.filters, offset }).then(p => { if (on) setPanel(p); });
    work.catch(e => { if (on) setError(e instanceof Error ? e.message : "Could not load the math."); }); return () => { on = false; }; }, [client, target, offset, leak]);
  const title = leak ? leak.title : (target as { title: string }).title, count = Number(leak ? rows?.count ?? 0 : panel?.rowCount ?? 0);
  return <section className={styles.card} role="dialog" aria-modal="false" aria-labelledby="math-heading" style={{ borderColor: "#075e6d", borderWidth: 2 }}>
    <div className={styles.title}><h2 id="math-heading">Show the math: {title}</h2><button onClick={onClose}>Close</button></div>
    {error && <p role="alert" className={styles.error}>⚠ {error}</p>}
    {leak && <><p><strong>{leak.label}:</strong> {$(leak.cents)} on {Number(leak.lines).toLocaleString("en-US")} lines.</p><p className={styles.small}><strong>Formula:</strong> {leak.formula}</p><p className={styles.small}>{leak.detail}</p>
      {rows && <p className={styles.small}>Evidence rows sum to {$(rows.sum)} ({rows.count} lines). {rows.engineAgrees ? "✓ Each leak shown below was recomputed by the margin engine and matches." : "⚠ The margin engine disagrees with a row below."}</p>}</>}
    {panel && <><p><strong data-testid="math-value">{panel.metric === "rate" ? `${moneyText(panel.value.replace("-", "")).replace(/^/, panel.value.startsWith("-") ? "-" : "")}%` : panel.metric === "lines" ? `${Number(panel.value).toLocaleString("en-US")} lines` : $(panel.value)}</strong></p>
      <p className={styles.small}><strong>Formula:</strong> {panel.formula}</p>
      <ul className={styles.small}>{panel.inputs.map(i => <li key={i.label}>{i.label}: {panel.metric === "lines" ? i.cents : $(i.cents)}</li>)}</ul>
      <p className={styles.small}>{panel.check.agrees ? "✓ Recomputed by the margin engine from these inputs: same to the cent." : "⚠ The margin engine got a different value."} {panel.rowsAgree ? `✓ The ${Number(panel.rowCount).toLocaleString("en-US")} source lines add up to it.` : "⚠ The source lines do not add up; see Fix Later → Reconciliation."}</p></>}
    {(panel?.rows.length || rows?.rows.length) ? <div className={styles.tableWrap}><table className={styles.table} aria-label="Source rows">
      <thead><tr><th scope="col">Source file</th><th scope="col">Row</th><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Product</th><th scope="col">Customer</th><th scope="col">List</th><th scope="col">Discount</th><th scope="col">Freight</th><th scope="col">Cost</th><th scope="col">Pocket</th><th scope="col">{leak ? "Leak" : "Contributes"}</th></tr></thead>
      <tbody>{(leak ? rows!.rows : panel!.rows).map(r => <tr key={`${r.sourceFile}|${r.sourceRow}`}><td className={styles.wrap}>{r.sourceFile}</td><td>{r.sourceRow}</td><td>{r.invoice}</td><td>{r.date}</td><td>{r.product}</td><td>{r.customer}</td>
        <td>{$(r.list)}</td><td>{$(r.discount)}</td><td>{$(r.freight)}</td><td>{$(r.cost)}</td><td>{$(r.pocket)}</td><td>{"leak" in r ? $(r.leak) : target && "metric" in target && target.metric === "lines" ? "1 line" : $((r as MathPanel["rows"][number]).contribution)}</td></tr>)}</tbody>
    </table></div> : null}
    {count > 25 && <div className={styles.row}><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous 25</button><span className={styles.small}>Rows {offset + 1}–{Math.min(count, offset + 25)} of {count.toLocaleString("en-US")}, largest first</span><button disabled={offset + 25 >= count} onClick={() => setOffset(offset + 25)}>Next 25</button></div>}
  </section>;
}
