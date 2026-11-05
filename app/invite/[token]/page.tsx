import { LoginForm } from "@/components/LoginForm";
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function InvitePage({params}:{params:Promise<{token:string}>}){const t=await serverT();const {token}=await params;return <main className="app-content"><section className="app-card" style={{maxWidth:650,margin:"8vh auto"}}><span className="status-chip">{t("page.invite.workspaceInvitation")}</span><h1>{t("page.invite.acceptYourInvitation")}</h1><p className="muted">{t("page.invite.signInUsingThe")}</p><LoginForm inviteToken={token}/></section></main>}
