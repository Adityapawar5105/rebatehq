import { legacyBusinessEnabled } from "@/lib/legacy-gate";
import { AppFrame } from "@/components/AppFrame";
import { ConnectorSecretForm } from "@/components/ConnectorSecretForm";
import { requireAppPageContext } from "@/lib/context";
import { can } from "@/lib/permissions";
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function WorkspacePage(){const t=await serverT();const context=await requireAppPageContext();return <AppFrame context={context}><div className="page-head"><div><h1>{t("page.workspace.workspaceSettings")}</h1><p>{t("page.workspace.identityLicenceAndWorkspace")}</p></div></div><section className="app-card"><h2>{context.tenantName}</h2><p>{t("page.workspace.workspaceMode")}{" "}<b>{context.isDemo?t("page.workspace.demoSampleData"):t("page.workspace.customerWorkspace")}</b></p><p className="small muted">{t("page.workspace.roleMembershipTenantAccess", { role: context.role })}</p></section>{legacyBusinessEnabled() && context.role==="owner"&&<section className="app-card"><h2>{t("page.workspace.connectorCredentials")}</h2><p className="muted">{t("page.workspace.credentialsAreEncryptedWith")}</p><ConnectorSecretForm/></section>}</AppFrame>}
