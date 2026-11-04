import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { databaseContext } from "@/lib/context";
import { AppFrame } from "@/components/AppFrame";
import { requireAppPageContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getMonthlyWaterfall } from "@/lib/analytics";
import {dataReadiness} from "@/lib/readiness";
import {DataReadiness} from "@/components/DataReadiness";
export const dynamic = "force-dynamic";
const money = (value: unknown, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));
export default async function DashboardPage() {if (!legacyBusinessEnabled()) notFound();
  const context = await requireAppPageContext();
  const data = await withDatabase(databaseContext(context), async db => {
    const snapshots = can(context.role, "costs.read") ? (await db.query(`SELECT period_month,order_count,pocket_revenue,pocket_margin,margin_pct FROM margin_snapshot WHERE tenant_id=$1 AND entity_type='company' AND entity_id=$1::text ORDER BY period_month DESC LIMIT 12`, [context.tenantId])).rows : [];
    let waterfall=null;if(can(context.role,"costs.read")){const month=latestSnapshotMonth(snapshots)||String((await db.query("SELECT max(month_key) AS month FROM sales_order WHERE tenant_id=$1",[context.tenantId])).rows[0]?.month||"");if(month)waterfall=await getMonthlyWaterfall(db,context.tenantId,month);}
    const counts = context.role === "rep"
      ? await db.query(`SELECT (SELECT count(*)::int FROM customer WHERE tenant_id=$1 AND assigned_rep_id=$2) AS customers,
        (SELECT count(*)::int FROM product WHERE tenant_id=$1 AND active=true) AS products,
        (SELECT count(*)::int FROM quote WHERE tenant_id=$1 AND created_by=$2 AND status='pending_approval') AS pending_quotes,
        (SELECT count(*)::int FROM quote WHERE tenant_id=$1 AND created_by=$2) AS quotes`, [context.tenantId, context.userId])
      : await db.query(`SELECT (SELECT count(*)::int FROM customer WHERE tenant_id=$1) AS customers,
        (SELECT count(*)::int FROM product WHERE tenant_id=$1 AND active=true) AS products,
        (SELECT count(*)::int FROM quote WHERE tenant_id=$1 AND status='pending_approval') AS pending_quotes,
        (SELECT count(*)::int FROM quote WHERE tenant_id=$1) AS quotes`, [context.tenantId]);
    const alerts = can(context.role, "costs.read") ? (await db.query("SELECT id,severity,message,created_at FROM alert WHERE tenant_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 5", [context.tenantId])).rows : [];
    const readiness=can(context.role,"costs.read")?await dataReadiness(db,context.tenantId):null;
    return { snapshots: snapshots.reverse(), counts: counts.rows[0], alerts,waterfall,readiness };
  });
  const latest = data.snapshots.at(-1); const previous = data.snapshots.at(-2); const enoughHistory = Boolean(latest && previous);
  return <AppFrame context={context}><div className="page-head"><div><h1>Margin and revenue overview</h1><p>See what needs attention in {context.tenantName}.</p></div><span className="status-chip">{context.isDemo ? "Sample data" : "Live workspace"}</span></div>
    {can(context.role, "costs.read") ? <>
      {data.readiness?<DataReadiness data={data.readiness}/>:null}
      <section className="grid-4"><div className="metric"><span>Latest month · pocket revenue</span><strong>{latest ? money(latest.pocket_revenue,context.currency) : "—"}</strong></div><div className="metric"><span>Latest month · pocket margin</span><strong>{latest ? money(latest.pocket_margin,context.currency) : "—"}</strong></div><div className="metric"><span>Latest month · margin rate</span><strong>{latest ? `${Number(latest.margin_pct).toFixed(1)}%` : "—"}</strong></div><div className="metric"><span>Margin trend</span><strong>{!enoughHistory ? "Not enough history" : `${Number(latest.margin_pct) >= Number(previous.margin_pct) ? "↑" : "↓"} ${Math.abs(Number(latest.margin_pct)-Number(previous.margin_pct)).toFixed(1)} pts`}</strong></div></section>
      <section className="app-card"><h2>Monthly margin snapshots</h2><p className="muted small">Stored, engine-calculated history. A trend appears after two monthly periods exist.</p>{data.snapshots.length ? <div className="data-table"><table><thead><tr><th>Month</th><th>Orders</th><th>Pocket revenue</th><th>Pocket margin</th><th>Margin rate</th></tr></thead><tbody>{data.snapshots.map((row:any)=><tr key={String(row.period_month)}><td>{String(row.period_month).slice(0,7)}</td><td>{row.order_count}</td><td>{money(row.pocket_revenue,context.currency)}</td><td>{money(row.pocket_margin,context.currency)}</td><td>{Number(row.margin_pct).toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="muted">No snapshots have been imported. Import prototype history or load a demo workspace.</p>}</section>
      <section className="app-card"><h2>Pocket-margin waterfall{data.waterfall?` · ${data.waterfall.month}`:""}</h2><p className="small muted">Drill into source orders behind each period total. Costs use the basis effective on each transaction date; missing history is flagged as a data-quality issue.</p>{data.waterfall?<><div className="waterfall">{data.waterfall.steps.map((step:any)=><div key={step.label} className={`water-step ${step.value<0?"loss":""} ${["Pocket price","Pocket margin"].includes(step.label)?"final":""}`}><small>{step.label}</small><strong>{money(step.value,context.currency)}</strong></div>)}</div>{data.waterfall.dataQualityIssues?.length>0&&<p className="callout">Some orders were excluded because their effective cost or exchange rate is missing. Review Data quality issues.</p>}<details><summary>Inspect source order details ({data.waterfall.details.length})</summary><div className="data-table"><table><thead><tr><th>Order</th><th>Customer</th><th>SKU</th><th>Qty</th><th>Pocket price</th><th>Cost</th><th>Margin</th><th>Rate</th></tr></thead><tbody>{data.waterfall.details.map((row:any)=><tr key={row.id}><td>{row.id}</td><td>{row.customer}</td><td>{row.sku}</td><td>{row.quantity}</td><td>{money(row.pocket,context.currency)}</td><td>{money(row.cogs,context.currency)}</td><td>{money(row.margin,context.currency)}</td><td>{Number(row.rate).toFixed(1)}%</td></tr>)}</tbody></table></div></details></>:<p className="muted">No sales orders have been imported.</p>}</section>
      <section className="app-card"><h2>Open alerts</h2>{data.alerts.length ? <ul>{data.alerts.map((alert:any)=><li key={alert.id}><b>{alert.severity}</b> · {alert.message}</li>)}</ul> : <p className="muted">No open alerts.</p>}</section>
    </> : <section className="grid-3"><div className="metric"><span>Assigned customers</span><strong>{data.counts.customers}</strong></div><div className="metric"><span>Your quotes</span><strong>{data.counts.quotes}</strong></div><div className="metric"><span>Awaiting approval</span><strong>{data.counts.pending_quotes}</strong></div><p className="muted small">Your dashboard does not show cost or margin dollars. Quote guardrails show only the zone and distance from the configured walk-away threshold.</p></section>}
    <section className="grid-3"><div className="metric"><span>Active products</span><strong>{data.counts.products}</strong></div><div className="metric"><span>Customers</span><strong>{data.counts.customers}</strong></div><div className="metric"><span>Quotes</span><strong>{data.counts.quotes}</strong></div></section>
  </AppFrame>;
}

function latestSnapshotMonth(rows:any[]){const last=rows[0];return last?String(last.period_month).slice(0,7):""}
