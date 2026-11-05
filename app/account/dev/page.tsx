import { AppFrame } from "@/components/AppFrame";
import { DevImpersonationForm } from "@/components/DevImpersonationForm";
import { requireAppPageContext } from "@/lib/context";
import { devImpersonationEnabled } from "@/lib/impersonation";
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function DevToolsPage(){const t=await serverT();const context=await requireAppPageContext();if(!devImpersonationEnabled())return <AppFrame context={context}><div className="page-head"><div><h1>{t("page.dev.developmentTools")}</h1><p>{t("page.dev.developmentImpersonationIsDisabled")}</p></div></div></AppFrame>;return <AppFrame context={context}><div className="page-head"><div><h1>{t("page.dev.developmentImpersonation")}</h1><p>{t("page.dev.testWorkspaceRolesWithout")}</p></div><span className="status-chip">{t("page.dev.localDevelopmentOnly")}</span></div><section className="app-card"><DevImpersonationForm tenantId={context.tenantId} impersonated={context.impersonated}/></section></AppFrame>}
