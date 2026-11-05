import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { LoginForm } from "@/components/LoginForm";
import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
export default async function Login(){const t=await serverT();const state=await getAuthState();if(state?.memberships.length)redirect("/home");return <main className="app-content"><section className="app-card" style={{maxWidth:640,margin:"10vh auto"}}><div className="brand"><span className="mark" aria-hidden="true">{t("shell.brandMark")}</span>{t("app.name")}</div><h1>{t("page.login.signInToYour")}</h1><p className="muted">{t("page.login.useAVerifiedEmail")}</p><LoginForm/></section></main>}
