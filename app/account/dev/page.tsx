import { AppFrame } from "@/components/AppFrame";
import { DevImpersonationForm } from "@/components/DevImpersonationForm";
import { requireAppPageContext } from "@/lib/context";
import { devImpersonationEnabled } from "@/lib/impersonation";
export const dynamic="force-dynamic";
export default async function DevToolsPage(){const context=await requireAppPageContext();if(!devImpersonationEnabled())return <AppFrame context={context}><div className="page-head"><div><h1>Development tools</h1><p>Development impersonation is disabled.</p></div></div></AppFrame>;return <AppFrame context={context}><div className="page-head"><div><h1>Development impersonation</h1><p>Test workspace roles without using a demo-role switcher.</p></div><span className="status-chip">Local development only</span></div><section className="app-card"><DevImpersonationForm tenantId={context.tenantId} impersonated={context.impersonated}/></section></AppFrame>}
