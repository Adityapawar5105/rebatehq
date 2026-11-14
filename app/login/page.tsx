import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/context";
import { LoginForm } from "@/components/LoginForm";
import { serverT } from "@/lib/i18n/server";
import { forwardAuthParams } from "@/lib/auth-forward";
const REASON={link:"page.login.errorLink",expired:"page.login.errorExpired",browser:"page.login.errorBrowser",invite:"page.login.errorInvite"} as const;
export const dynamic="force-dynamic";
export default async function Login({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const params=await searchParams;const forward=forwardAuthParams(params);if(forward)redirect(forward);const t=await serverT();const state=await getAuthState();if(state?.memberships.length)redirect("/home");const reason=typeof params.error==="string"&&params.error in REASON?REASON[params.error as keyof typeof REASON]:null;return <main className="app-content"><section className="app-card" style={{maxWidth:640,margin:"10vh auto"}}><div className="brand"><span className="mark" aria-hidden="true">{t("shell.brandMark")}</span>{t("app.name")}</div><h1>{t("page.login.signInToYour")}</h1><p className="muted">{t("page.login.useAVerifiedEmail")}</p>{reason&&<p role="alert" className="form-message error" data-testid="login-error">{t(reason)}</p>}<LoginForm/></section></main>}
