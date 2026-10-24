import { databaseContext } from "@/lib/context";
import { AppFrame } from "@/components/AppFrame";
import { requireAppPageContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { can } from "@/lib/permissions";
export const dynamic = "force-dynamic";
const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
export default async function RebatesPage() {
  const context = await requireAppPageContext();
  if (!can(context.role,"rebates.read")) return <AppFrame context={context}><div className="page-head"><div><h1>Rebates</h1><p>You don&apos;t have permission to view rebate records. Ask an owner or manager.</p></div></div></AppFrame>;
  const data = await withDatabase(databaseContext(context), async db => (await db.query(`SELECT a.id,a.party_type,a.party_id,a.name,a.rate_pct,a.threshold_amount,a.period_start,a.period_end,
    COALESCE(p.eligible_spend,0) AS eligible_spend,COALESCE(p.modeled_amount,0) AS modeled_amount,COALESCE(p.recorded_credits,0) AS recorded_credits
    FROM rebate_agreement a LEFT JOIN LATERAL (SELECT * FROM rebate_progress rp WHERE rp.tenant_id=a.tenant_id AND rp.agreement_id=a.id ORDER BY updated_at DESC LIMIT 1) p ON true
    WHERE a.tenant_id=$1 ORDER BY a.period_end DESC LIMIT 500`,[context.tenantId])).rows);
  return <AppFrame context={context}><div className="page-head"><div><h1>Rebates</h1><p>Compare modeled supplier credits with credits recorded in imported data.</p></div></div>
    <section className="app-card"><h2>Agreement review</h2><p className="small muted">This is a reconciliation aid. It does not determine legal entitlement or submit a supplier claim.</p>{data.length ? <div className="data-table"><table><thead><tr><th>Supplier / customer</th><th>Type</th><th>Rate</th><th>Period</th><th>Eligible spend</th><th>Modeled</th><th>Credits received</th><th>Difference</th></tr></thead><tbody>{data.map((r:any)=><tr key={r.id}><td><b>{r.name}</b><div className="small muted">{r.party_id}</div></td><td>{r.party_type}</td><td>{Number(r.rate_pct).toFixed(2)}%</td><td>{String(r.period_start).slice(0,10)} – {String(r.period_end).slice(0,10)}</td><td>{money(r.eligible_spend)}</td><td>{money(r.modeled_amount)}</td><td>{money(r.recorded_credits)}</td><td>{money(Number(r.modeled_amount)-Number(r.recorded_credits))}</td></tr>)}</tbody></table></div> : <p className="muted">No rebate agreements are imported yet. Use the prototype import or add one in a future workflow.</p>}</section>
  </AppFrame>;
}
