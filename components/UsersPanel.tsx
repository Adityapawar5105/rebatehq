"use client";
import { useState } from "react";
import { t, msg, useLocale, say, fmt } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import p from "./local/people.module.css";
const MEMBER_ROLE: Record<string, MessageKey> = { owner: "users.owner", manager: "users.manager", analyst: "users.analyst", rep: "users.rep" };
type Member={user_id:string;email:string;role:"owner"|"manager"|"analyst"|"rep";status:string;created_at:string};
const AVATAR = ["a", "b", "c", "d", "e"];
const initials = (s: string) => (s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?");
const hue = (k: string) => AVATAR[[...k].reduce((a, c) => (a + c.charCodeAt(0)) % 997, 0) % AVATAR.length];
/** Account › Users and invitations: workspace members and their workspace access (styled like Settings › Team and roles,
 *  25 Nov 2026). The select's value is the role itself, so it always shows the member's current access. */
export function UsersPanel({members}:{members:Member[]}) {useLocale();
  const [rows,setRows]=useState(members); const [message,setMessage]=useState(""); const [busy,setBusy]=useState("");
  async function update(userId:string,role:Member["role"]){setBusy(userId);setMessage("");try{const response=await fetch(`/api/users/${userId}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({role})});const result=await response.json();if(!response.ok)throw new Error(result.error||msg("users.roleCouldNotBe2"));setRows(current=>current.map(member=>member.user_id===userId?{...member,role}:member));setMessage(msg("users.roleUpdatedFor", { email: result.data.email }))}catch(error){setMessage(error instanceof Error?error.message:t("users.roleCouldNotBe"))}finally{setBusy("")}}
  return <>{message&&<p role="status" className="form-message">{say(message)}</p>}<div className="data-table"><table><thead><tr><th scope="col">{t("users.member")}</th><th scope="col">{t("users.role")}</th><th scope="col">{t("users.status")}</th><th scope="col">{t("users.joined")}</th><th scope="col">{t("users.changeRole")}</th></tr></thead><tbody>{rows.map(member=>{const active=member.status==="active";return <tr key={member.user_id}>
    <td><span className={p.person}><span className={p.avatar} data-hue={hue(member.user_id)} aria-hidden="true">{initials(member.email)}</span><span className={p.who}><span className={p.name} translate="no">{member.email}</span></span></span></td>
    <td>{t(MEMBER_ROLE[member.role] ?? "users.rep")}</td>
    <td><span className={p.status} data-tone={active?"ok":"bad"}><span className={p.dot} aria-hidden="true"/>{t(active?"people.status.active":"people.status.suspended")}</span></td>
    <td>{fmt.date(member.created_at)}</td>
    <td><select aria-label={t("users.roleFor", { email: member.email })} className="input" value={member.role} disabled={member.role==="owner"||Boolean(busy)} onChange={e=>void update(member.user_id,e.target.value as Member["role"])}><option value="owner">{t("users.owner")}</option><option value="manager">{t("users.manager")}</option><option value="analyst">{t("users.analyst")}</option><option value="rep">{t("users.rep")}</option></select></td></tr>;})}</tbody></table></div></>;
}
