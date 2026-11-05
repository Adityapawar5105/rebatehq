import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { CreateTenantForm } from "@/components/CreateTenantForm";
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function Setup(){const t=await serverT();const state=await getAuthState();if(!state)redirect("/login");if(state.memberships.length)redirect("/home");return <main className="app-content"><section className="app-card" style={{maxWidth:700,margin:"8vh auto"}}><span className="status-chip">{t("page.setup.verifiedAccountNoWorkspace")}</span><h1>{t("page.setup.createANewWorkspace")}</h1><p className="muted">{t("page.setup.youAreNotA")}</p><CreateTenantForm/></section></main>}
