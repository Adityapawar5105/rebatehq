import { AppFrame } from "@/components/AppFrame";
import { AuditViewer } from "@/components/AuditViewer";
import { requireAppPageContext } from "@/lib/context";
import { serverT } from "@/lib/i18n/server";
export const dynamic = "force-dynamic";
export default async function AuditPage(){const t=await serverT();const context=await requireAppPageContext();return <AppFrame context={context}><h1>{t("page.audit.controlPlaneAudit")}</h1><p>{t("page.audit.identityLicenceAndWorkspace")}</p><AuditViewer/></AppFrame>;}
