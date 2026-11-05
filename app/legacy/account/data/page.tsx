import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { DeleteTenantForm } from "@/components/DeleteTenantForm";
import { requireAppPageContext } from "@/lib/context";
import { can } from "@/lib/permissions";
export const dynamic="force-dynamic";
// 6R: prototype import and the server workspace export were retired with the wave-1 tables;
// workspace data now lives in the local vault (encrypted backup in Settings).
export default async function DataPage(){if (!legacyBusinessEnabled()) notFound();const context=await requireAppPageContext();if(!can(context.role,"tenant.export"))return <AppFrame context={context}><div className="page-head"><div><h1>Workspace</h1><p>You don&apos;t have permission to manage this workspace.</p></div></div></AppFrame>;return <AppFrame context={context}><div className="page-head"><div><h1>Workspace</h1><p>Business data is kept in each user&apos;s local vault. Use Settings › Download encrypted backup to keep a copy.</p></div></div><section className="app-card"><h2>Disable workspace</h2><p className="muted">This immediately blocks access. Append-only audit records are retained.</p><DeleteTenantForm tenantName={context.tenantName}/></section></AppFrame>}