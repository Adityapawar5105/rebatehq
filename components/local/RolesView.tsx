"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { RoleList } from "@/lib/vault/protocol";
import { ROLES, type RoleId } from "@/lib/roles/access";
import { fmt, msg, say, t } from "@/lib/i18n";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
/** Team roles. The worker enforces them: a role without cost access never receives cost values. */
export function RolesView({ client, busy, operation, refresh }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [list, setList] = useState<RoleList | null>(null), [note, setNote] = useState(""), [form, setForm] = useState<{ userId: string; name: string; role: RoleId }>({ userId: "", name: "", role: "sales_rep" });
  useEffect(() => { let on = true; void client.call("roleList", {}).then(l => { if (on) setList(l); }).catch(() => { if (on) setNote(msg("roles.couldNotLoadRoles")); }); return () => { on = false; }; }, [client]);
  if (!list) return <section className={styles.card} aria-busy="true"><h2>{t("roles.teamAndRoles2")}</h2><p role="status">{say(note) || t("roles.loadingRoles")}</p></section>;
  const run = (work: () => Promise<RoleList>, done: string) => void operation(async () => { setList(await work()); setNote(done); await refresh(); });
  return <section className={styles.card} aria-labelledby="roles-heading" data-testid="roles">
    <h2 id="roles-heading">{t("roles.teamAndRoles")}</h2>
    <p>{t("roles.youAre")}{" "}<strong>{say(list.you.roleLabel)}</strong>{t("roles.sentenceEnd")} {list.pricingOwner ? t("roles.pricingOwner", { pricingOwner: list.pricingOwner }) : t("roles.noPricingOwnerIs")}{" "}{t("roles.rolesAreStoredIn")}</p>
    <p role="status">{say(note)}</p>
    <div className={styles.tableWrap}><table className={styles.table} aria-label={t("roles.roles")}><thead><tr><th scope="col">{t("roles.role3")}</th><th scope="col">{t("roles.whatItCanDo")}</th></tr></thead><tbody>{ROLES.map(r => <tr key={r.id}><td>{say(r.label)}</td><td className={styles.wrap}>{say(r.summary)}</td></tr>)}</tbody></table></div>
    {list.canManage ? <>
      <h3>{t("roles.people")}</h3>
      <DataGrid label={t("roles.peopleAndRoles")} testId="roles-people" rows={list.people} rowKey={p => p.userId} columns={[
        { id: "name", name: t("roles.name2"), value: p => p.name, cell: p => <span translate="no">{p.name}{p.you ? <span translate="yes">{t("roles.you")}</span> : ""}</span> },
        { id: "user", name: t("roles.signInId"), value: p => p.userId, cell: p => <span translate="no">{p.userId}</span> },
        { id: "role", name: t("roles.role2"), value: p => say(p.roleLabel) },
        { id: "change", name: t("roles.change"), cell: p => <>{!p.you && <><label className={styles.small}>{t("roles.roleFor", { name: p.name })}<select disabled={busy} value={p.role} onChange={e => run(() => client.call("roleSet", { userId: p.userId, name: p.name, role: e.target.value as RoleId }), msg("roles.nowRole", { name: p.name, role: ROLES.find(r => r.id === e.target.value)!.label }))}>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></label>
            <button disabled={busy} aria-label={t("roles.remove2", { name: p.name })} onClick={() => run(() => client.call("roleRemove", { userId: p.userId }), msg("roles.removed", { name: p.name }))}>{t("roles.remove")}</button></>}</> },
      ]}/>
      <form onSubmit={e => { e.preventDefault(); run(() => client.call("roleSet", form), msg("roles.nowRole", { name: form.name, role: ROLES.find(r => r.id === form.role)!.label })); setForm({ ...form, userId: "", name: "" }); }}>
        <h3>{t("roles.giveSomeoneAccess")}</h3>
        <label>{t("roles.name")}<input required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>{t("roles.signInIdFrom")}<input required maxLength={160} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} /></label>
        <label>{t("roles.role")}<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as RoleId })}>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></label>
        <button className={styles.primary} disabled={busy || !form.name.trim() || !form.userId.trim()}>{t("roles.assignRole")}</button>
      </form>
      <p className={styles.muted} data-testid="reps-never-see-cost">{t("roles.repsNeverSeeCost")}</p>
    </> : <p className={styles.muted}>{t("roles.onlyAnOwnerOr")}</p>}
    <h3>{t("roles.previewAnotherRole")}</h3>
    <p className={styles.small}>{t("roles.seeTheAppAs")}</p>
    <label>{t("roles.previewAs")}<select value={list.you.viewAs ?? ""} disabled={busy} onChange={e => run(() => client.call("rolePreview", { role: (e.target.value || null) as RoleId | null }), msg(e.target.value ? "roles.previewingThatRole" : "roles.backToYourOwn"))}><option value="">{t("roles.myOwnRole")}</option>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></label>
  </section>;
}
