import type {Readiness} from "@/lib/readiness";
export function DataReadiness({data}:{data:Readiness}){
 return <section className="app-card readiness" aria-labelledby="readiness-title">
  <h2 id="readiness-title">Data readiness</h2>
  <p>First insights in minutes from files; a live connector typically takes weeks.</p>
  {data.score===null?<p role="status">No invoices yet. Readiness is not available until invoice data is loaded.</p>:<p className="readiness-score"><strong>{data.score}%</strong> · {data.complete} of {data.invoices} invoices have all four kinds of evidence.</p>}
  <p className="small">Formula: 100 × (invoices with freight + invoices with actual cost + invoices with recorded rebates + invoices with unit coverage) ÷ (4 × total invoices). Each check requires every line of an invoice; invoices without lines are incomplete. Each check has equal weight. Display rounded to one decimal place.</p>
  <p className="small muted">Sourced zero amounts count; assumed zeros and standard cost estimates do not. Catalog file imports do not load invoice actuals yet. Use your approved invoice-data process for these allocations.</p>
  <div className="grid-4">{data.checks.map(c=><div key={c.key} className="metric"><span>{c.label}</span><strong>{c.percent===null?"—":`${c.percent}%`}</strong><p>{c.ready} of {data.invoices} invoices</p><details><summary>Steps to improve</summary>{data.invoices>c.ready?<p className="import-issue">⚠ {data.invoices-c.ready} invoices need this evidence.</p>:null}<ol>{c.steps.map(s=><li key={s}>{s}</li>)}</ol></details></div>)}</div>
  <a className="readiness-action" href="/legacy/prices?ingestion=1#ingestion">Review ingestion options</a>
 </section>;
}
