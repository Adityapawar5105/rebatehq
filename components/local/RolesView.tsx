"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { RoleList } from "@/lib/vault/protocol";
import { ROLES, type RoleId } from "@/lib/roles/access";
import styles from "./vault.module.css";
/** Team roles. The worker enforces them: a role without cost access never receives cost values. */
export function RolesView({ client, busy, operation, refresh }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [list, setList] = useState<RoleList | null>(null), [note, setNote] = useState(""), [form, setForm] = useState<{ userId: string; name: string; role: RoleId }>({ userId: "", name: "", role: "sales_rep" });
  useEffect(() => { let on = true; void client.call("roleList", {}).then(l => { if (on) setList(l); }).catch(() => { if (on) setNote("Could not load roles."); }); return () => { on = false; }; }, [client]);
  if (!list) return <section className={styles.card} aria-busy="true"><h2>Team and roles</h2><p role="status">{note || "Loading roles…"}</p></section>;
  const run = (work: () => Promise<RoleList>, done: string) => void operation(async () => { setList(await work()); setNote(done); await refresh(); });
  return <section className={styles.card} aria-labelledby="roles-heading" data-testid="roles">
    <h2 id="roles-heading">Team and roles</h2>
    <p>You are <strong>{list.you.roleLabel}</strong>. {list.pricingOwner ? `Pricing Owner: ${list.pricingOwner}.` : "No Pricing Owner is named."} Roles are stored in this encrypted vault and enforced by the local worker: a role that may not see cost never receives a cost value.</p>
    <p role="status">{note}</p>
    <div className={styles.tableWrap}><table className={styles.table} aria-label="Roles"><thead><tr><th>Role</th><th>What it can do</th></tr></thead><tbody>{ROLES.map(r => <tr key={r.id}><td>{r.label}</td><td className={styles.wrap}>{r.summary}</td></tr>)}</tbody></table></div>
    {list.canManage ? <>
      <h3>People</h3>
      <div className={styles.tableWrap}><table className={styles.table} aria-label="People and roles"><thead><tr><th>Name</th><th>Sign-in ID</th><th>Role</th><th>Change</th></tr></thead>
        <tbody>{list.people.map(p => <tr key={p.userId}><td>{p.name}{p.you ? " (you)" : ""}</td><td>{p.userId}</td><td>{p.roleLabel}</td>
          <td>{!p.you && <><label className={styles.small}>Role for {p.name}<select disabled={busy} value={p.role} onChange={e => run(() => client.call("roleSet", { userId: p.userId, name: p.name, role: e.target.value as RoleId }), `${p.name} is now ${ROLES.find(r => r.id === e.target.value)!.label}.`)}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
            <button disabled={busy} aria-label={`Remove ${p.name}`} onClick={() => run(() => client.call("roleRemove", { userId: p.userId }), `${p.name} was removed.`)}>Remove</button></>}</td></tr>)}</tbody></table></div>
      <form onSubmit={e => { e.preventDefault(); run(() => client.call("roleSet", form), `${form.name} is now ${ROLES.find(r => r.id === form.role)!.label}.`); setForm({ ...form, userId: "", name: "" }); }}>
        <h3>Give someone access</h3>
        <label>Name<input required maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Sign-in ID (from Team and invitations)<input required maxLength={160} value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} /></label>
        <label>Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as RoleId })}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <button className={styles.primary} disabled={busy || !form.name.trim() || !form.userId.trim()}>Assign role</button>
      </form>
      <label><input type="checkbox" checked={list.repSeesCost} disabled={busy} onChange={e => run(() => client.call("accessSet", { repSeesCost: e.target.checked }), e.target.checked ? "Sales Reps can now see cost and margin." : "Sales Reps no longer see cost or margin.")} /> Let Sales Reps see cost and margin (off by default)</label>
    </> : <p className={styles.muted}>Only an Owner or Admin can change roles.</p>}
    <h3>Preview another role</h3>
    <p className={styles.small}>See the app as another role would. A preview only removes what you can see. It ends when you lock the vault.</p>
    <label>Preview as<select value={list.you.viewAs ?? ""} disabled={busy} onChange={e => run(() => client.call("rolePreview", { role: (e.target.value || null) as RoleId | null }), e.target.value ? "Previewing that role." : "Back to your own view.")}><option value="">My own role</option>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
  </section>;
}
