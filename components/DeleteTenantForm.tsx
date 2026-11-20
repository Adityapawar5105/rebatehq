"use client";
// Disable this workspace (owner only; the route checks the permission and the typed name). Moved from the legacy
// data page to Account > Workspace on 20 Nov 2026 (review gap 17), and translated.
import { useState } from "react";
import { msg, say, t, useLocale } from "@/lib/i18n";
export function DeleteTenantForm({tenantName}:{tenantName:string}){
  useLocale();
  const [value,setValue]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMessage("");
    try{const r=await fetch("/api/tenant/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({confirmation:value})});const x=await r.json();if(!r.ok)throw new Error(x.error||msg("workspaceClose.failed"));setMessage(msg("workspaceClose.done"));setTimeout(()=>location.assign("/login"),2200);}
    catch(e){setMessage(e instanceof Error?e.message:msg("workspaceClose.failed"));}finally{setBusy(false);}
  }
  return <form className="app-form" onSubmit={submit} data-testid="workspace-close">
    <p>{t("workspaceClose.prompt",{name:tenantName})}</p>
    <input className="input" value={value} onChange={e=>setValue(e.target.value)} aria-label={t("workspaceClose.confirmLabel")}/>
    <button className="danger" disabled={busy||value!==tenantName}>{busy?t("workspaceClose.busy"):t("workspaceClose.button")}</button>
    {message&&<p role="status" className="form-message">{say(message)}</p>}
  </form>;
}
