import { AppFrame } from "@/components/AppFrame";
import { AuditViewer } from "@/components/AuditViewer";
import { requireAppPageContext } from "@/lib/context";
export const dynamic = "force-dynamic";
export default async function AuditPage(){const context=await requireAppPageContext();return <AppFrame context={context}><h1>Control-plane audit</h1><p>Identity, licence and workspace event metadata only. Business history is in your encrypted vault.</p><AuditViewer/></AppFrame>;}
