import { requireAppPageContext } from '@/lib/context';
import { AppFrame } from '@/components/AppFrame';
import { LicencePanel } from '@/components/LicencePanel';
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function LicencePage(){const t=await serverT();const context=await requireAppPageContext();return <AppFrame context={context}><h1>{t("page.licence.workspaceLicence")}</h1><LicencePanel owner={context.role==='owner'}/></AppFrame>;}
