import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { databaseContext } from "@/lib/context";
import { AppFrame } from "@/components/AppFrame";
import { requireAppPageContext } from "@/lib/context";
import { withDatabase } from "@/lib/db";
import { getRebateAudit } from "@/lib/rebates";
import { can } from "@/lib/permissions";
export const dynamic = "force-dynamic";
const money = (value: unknown, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));
export default async function RebatesPage() {if (!legacyBusinessEnabled()) notFound();
  const context = await requireAppPageContext();
  if (!can(context.role,"rebates.read")) return <AppFrame context={context}><div className="page-head"><div><h1>Rebates</h1><p>You don&apos;t have permission to view rebate records. Ask an owner or manager.</p></div></div></AppFrame>;
  const data = await withDatabase(databaseContext(context), db => getRebateAudit(db,context.tenantId));
  return <AppFrame context={context}><div className="page-head"><div><h1>Rebates</h1><p>Compare modeled supplier credits with credits recorded in imported data.</p></div></div>
    <section className="app-card"><h2>Agreement review</h2><p className="small muted">A reconciliation aid based on recorded terms and source entries. Confirm eligibility before claiming credits. Returns and credit memos reduce eligible spend.</p>{data.length ? <div className="data-table"><table><thead><tr><th>Agreement</th><th>Mode / period</th><th>Net eligible spend</th><th>Modeled rebate</th><th>Credits received</th><th>Difference</th><th>Next tier</th></tr></thead><tbody>{data.map((r:any)=><tr key={r.id}><td><b>{r.name}</b><div>{r.party_id}</div><details><summary>Inspect source entries</summary><ul>{r.audit.rows.map((row:any)=><li key={row.id}>{row.source_ref} · {row.occurred_on} · {row.entry_type} · {money(row.amount,r.currency)} · {row.included ? "Included" : row.reason}</li>)}</ul></details></td><td>{r.calculation_mode}<br/>{r.period_start} – {r.period_end}</td><td>{money(r.audit.eligibleSpend,r.currency)}</td><td>{money(r.audit.earned,r.currency)}</td><td>{money(r.audit.credits,r.currency)}</td><td>{money(r.audit.difference,r.currency)}</td><td>{r.audit.remaining===null ? "No higher tier recorded" : `${money(r.audit.remaining,r.currency)} to next ${r.audit.nextRate}% tier. Review needs, eligibility and margin before recommending an order.`}</td></tr>)}</tbody></table></div> : <p className="muted">No rebate agreements have been imported.</p>}</section>
  </AppFrame>;
}
