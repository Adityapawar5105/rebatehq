"use client";
import { useState } from "react";
import { t, msg, useLocale, say, fmt } from "@/lib/i18n";
export function LoginForm({ inviteToken }: { inviteToken?: string }) {useLocale();
  const [email,setEmail]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage("");setError(false);try{const response=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,inviteToken})});const result=await response.json();if(!response.ok)throw new Error(result.error||msg("login.weCouldNotSend"));setMessage(msg("login.checkYourEmailFor"));}catch(e){setError(true);setMessage(e instanceof Error?e.message:t("login.weCouldnTSend"));}finally{setBusy(false)}}
  return <form className="app-form" onSubmit={submit}><div className="field"><label htmlFor="email">{t("login.workEmail")}</label><input className="input" id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} /></div><button className="primary" disabled={busy}>{busy?t("login.sending"):t("login.emailMeASign")}</button>{message&&<p role="status" className={`form-message ${error?"error":"success"}`}>{say(message)}</p>}<p className="small muted">{t("login.emailVerificationIsRequired")}</p></form>;
}
