import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/AppFrame";
import { AuditViewer } from "@/components/AuditViewer";
import { requireAppPageContext } from "@/lib/context";
import { can } from "@/lib/permissions";
export const dynamic="force-dynamic";
export default async function AuditPage(){if (!legacyBusinessEnabled()) notFound();const context=await requireAppPageContext();if(!can(context.role,"audit.read"))return <AppFrame context={context}><div className="page-head"><div><h1>Audit log</h1><p>You don&apos;t have permission to view the audit log. Ask an owner or manager.</p></div></div></AppFrame>;return <AppFrame context={context}><div className="page-head"><div><h1>Audit log</h1><p>Append-only record of workspace changes and exports.</p></div></div><section className="app-card"><AuditViewer/></section></AppFrame>}
