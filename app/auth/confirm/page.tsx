import { serverT } from "@/lib/i18n/server";
export const dynamic="force-dynamic";
// One deliberate click finishes an email sign-in link (see app/auth/callback/route.ts). Nothing here verifies
// the token: the form posts it to /auth/callback, whose same-origin POST is checked by the proxy.
export default async function ConfirmSignIn({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,t=await serverT(),value=(k:string)=>typeof params[k]==="string"?(params[k] as string).slice(0,512):"";
 const tokenHash=value("token_hash"),type=value("type"),invite=value("invite");
 return <main className="app-content"><section className="app-card" style={{maxWidth:640,margin:"10vh auto"}}>
  <div className="brand"><span className="mark" aria-hidden="true">{t("shell.brandMark")}</span>{t("app.name")}</div>
  <h1>{t("page.confirm.title")}</h1>
  {tokenHash&&type?<form className="app-form" method="post" action="/auth/callback">
   <p className="muted">{t("page.confirm.body")}</p>
   <input type="hidden" name="token_hash" value={tokenHash}/><input type="hidden" name="type" value={type}/>{invite&&<input type="hidden" name="invite" value={invite}/>}
   <button className="primary" type="submit" data-testid="confirm-sign-in">{t("page.confirm.button")}</button>
   <p className="small muted">{t("page.confirm.note")}</p>
  </form>:<p role="alert" className="form-message error">{t("page.login.errorLink")}</p>}
 </section></main>;
}
