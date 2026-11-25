"use client";
// Settings › Team and roles › People (25 Nov 2026): one list of everyone on the team. It joins three sources, each kept
// where it belongs:
//   • RebateHQ roles, kept in this encrypted vault and enforced by the worker (roleList, roleSet, roleRemove);
//   • the workspace's members and open invitations (sign-in email, workspace access, status), read by the server page and
//     passed in as props, so this page makes no new request (null in the lab, where there is no server);
//   • what each person receives under the sharing grid (roleList.sharing).
// Workspace access, invitations and suspension stay on the account Users page, which this page links to.
import { useEffect, useMemo, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { RoleList } from "@/lib/vault/protocol";
import { ROLES, type RoleId } from "@/lib/roles/access";
import { roleConflict, type TeamDirectory, type WorkspaceRole } from "@/lib/team";
import { COST_PACKS } from "@/lib/sharing/catalog";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Badge, Button, ButtonLink, Dialog, Field, Notice, Toast } from "@/components/ui/ui";
import { Icon } from "@/components/ui/Icon";
import { DataGrid } from "@/components/ui/DataGrid";
import p from "./people.module.css";

type Status = "active" | "suspended" | "invited" | "local";
type Row = {
  key: string; userId: string | null; name: string; email: string; role: RoleId | null; assigned: boolean; you: boolean;
  workspace: WorkspaceRole | null; status: Status; joined: string; receives: string[] | null; expires?: string;
};
const WORKSPACE: Record<WorkspaceRole, MessageKey> = { owner: "users.owner", manager: "users.manager", analyst: "users.analyst", rep: "users.rep" };
const STATUS: Record<Status, MessageKey> = { active: "people.status.active", suspended: "people.status.suspended", invited: "people.status.invited", local: "people.status.local" };
const TONE: Record<Status, "ok" | "bad" | "warn" | "info"> = { active: "ok", suspended: "bad", invited: "warn", local: "info" };
const AVATAR = ["a", "b", "c", "d", "e"];
const roleLabel = (r: RoleId) => say(ROLES.find(x => x.id === r)!.label);
const initials = (name: string) => (name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?");
const hue = (key: string) => AVATAR[[...key].reduce((a, c) => (a + c.charCodeAt(0)) % 997, 0) % AVATAR.length];

function rowsOf(list: RoleList, team: TeamDirectory | null): Row[] {
  const vault = new Map(list.people.map(x => [x.userId, x])), receives = list.sharing.receives, seen = new Set<string>(), out: Row[] = [];
  for (const m of team?.members ?? []) {
    const v = vault.get(m.userId); seen.add(m.userId);
    out.push({ key: m.userId, userId: m.userId, name: v?.name || m.email.split("@")[0] || m.email, email: m.email, role: v?.role ?? "sales_rep", assigned: !!v, you: v?.you ?? false,
      workspace: m.role, status: m.status === "active" ? "active" : "suspended", joined: m.joinedAt, receives: receives?.[m.userId] ?? null });
  }
  for (const v of list.people) if (!seen.has(v.userId))
    out.push({ key: v.userId, userId: v.userId, name: v.name, email: "", role: v.role, assigned: true, you: v.you, workspace: null, status: "local", joined: v.assignedAt, receives: receives?.[v.userId] ?? null });
  for (const i of team?.invites ?? [])
    out.push({ key: "invite:" + i.email, userId: null, name: i.email, email: i.email, role: null, assigned: false, you: false, workspace: i.role, status: "invited", joined: i.sentAt, receives: null, expires: i.expiresAt });
  return out;
}

export function PeopleView({ client, busy, list, team, onList, refresh, operation }: {
  client: VaultClient; busy: boolean; list: RoleList; team: TeamDirectory | null; onList: (l: RoleList) => void;
  refresh: () => Promise<void>; operation: (f: () => Promise<void>) => Promise<void>;
}) {
  const [search, setSearch] = useState(""), [roleFilter, setRoleFilter] = useState(""), [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Row | null>(null), [form, setForm] = useState<{ name: string; role: RoleId }>({ name: "", role: "sales_rep" });
  const [toast, setToast] = useState<{ title: string; body?: string; undo?: () => Promise<RoleList> } | null>(null), [error, setError] = useState("");
  const [byId, setById] = useState({ userId: "", name: "", role: "sales_rep" as RoleId });
  const all = useMemo(() => rowsOf(list, team), [list, team]), sharing = list.sharing;
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 8000); return () => clearTimeout(id); }, [toast]);
  // With sharing on, the signed grid decides roles: an Owner's edit is a draft until the next rotation, and anyone else's
  // local edit would be overwritten by the next signed grid, so it is not offered.
  const locked = sharing.joined && !sharing.canSign, draft = sharing.joined && sharing.canSign;
  const q = search.trim().toLowerCase();
  const rows = all.filter(r => (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    && (!roleFilter || r.role === roleFilter) && (!statusFilter || r.status === statusFilter));
  const statuses = [...new Set(all.map(r => r.status))];
  const conflict = editing ? roleConflict(form.role, false, editing.workspace) : null;

  const act = (work: () => Promise<RoleList>, done: (l: RoleList) => { title: string; body?: string; undo?: () => Promise<RoleList> }) => void operation(async () => {
    setError("");
    try { const l = await work(); onList(l); setToast(done(l)); await refresh(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : msg("roles.couldNotLoadRoles")); }
  });
  const save = () => {
    const row = editing!, before = row.assigned ? row.role : null, name = form.name.trim() || row.name, role = form.role, userId = row.userId!;
    setEditing(null);
    act(() => client.call("roleSet", { userId, name, role }), () => ({
      title: draft ? msg("people.toast.draft", { name, role: roleLabel(role) }) : msg("people.toast.saved", { name, role: roleLabel(role) }),
      body: draft ? msg("people.toast.draftBody") : undefined,
      undo: () => before ? client.call("roleSet", { userId, name: row.name, role: before }) : client.call("roleRemove", { userId }),
    }));
  };
  const remove = (row: Row) => {
    const before = row.role!, userId = row.userId!;
    act(() => client.call("roleRemove", { userId }), () => ({ title: msg("people.toast.removed", { name: row.name }), body: msg("people.toast.removedBody"),
      undo: () => client.call("roleSet", { userId, name: row.name, role: before }) }));
  };
  const undo = () => { const u = toast?.undo; if (!u) return; setToast(null); act(u, () => ({ title: msg("people.undone") })); };
  const open = (row: Row) => { setError(""); setForm({ name: row.name, role: row.role ?? "sales_rep" }); setEditing(row); };

  return <section className={p.people} aria-labelledby="people-heading" data-testid="people">
    <header className={p.head}>
      <div>
        <h3 id="people-heading" className={p.title}>{t("people.title")} <span className={p.count} data-testid="people-count">{fmt.int(String(all.length))}</span></h3>
        <p className={p.intro}>{t("people.intro")}</p>
      </div>
      {team && <div className={p.headActions}>
        <ButtonLink href="/account/users" icon="users" size="sm">{t("people.manageAccess")}</ButtonLink>
        {team.canInvite && <ButtonLink href="/account/users#invite" icon="plus" size="sm" variant="primary">{t("people.invite")}</ButtonLink>}
      </div>}
    </header>
    {locked && <Notice tone="info" data-testid="people-follows-grid">{t("people.followsGrid")}</Notice>}
    {draft && <Notice tone="info" data-testid="people-draft-note">{t("people.draftNote")}</Notice>}
    {error && <Notice tone="bad" role="alert">{say(error)}</Notice>}
    <div className={p.toolbar} role="search">
      <label className={p.search}><Icon name="search" size={16}/><span className={p.sr}>{t("people.search")}</span>
        <input type="search" value={search} placeholder={t("people.searchPlaceholder")} onChange={e => setSearch(e.target.value)} data-testid="people-search"/></label>
      <label className={p.chip}><Icon name="shield" size={14}/><span className={p.sr}>{t("people.filterRole")}</span>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} data-testid="people-role-filter"><option value="">{t("people.allRoles")}</option>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></label>
      {statuses.length > 1 && <label className={p.chip}><Icon name="circle" size={14}/><span className={p.sr}>{t("people.filterStatus")}</span>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} data-testid="people-status-filter"><option value="">{t("people.allStatuses")}</option>{statuses.map(s => <option key={s} value={s}>{t(STATUS[s])}</option>)}</select></label>}
      {(q || roleFilter || statusFilter) && <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setRoleFilter(""); setStatusFilter(""); }}>{t("people.clear")}</Button>}
    </div>
    <DataGrid label={t("roles.peopleAndRoles")} testId="roles-people" rows={rows} rowKey={r => r.key} className={p.grid} selectable={false}
      rowProps={r => ({ "data-person": r.userId ?? r.email })} columns={[
      { id: "person", name: t("people.col.person"), value: r => r.name, cell: r => <span className={p.person}>
        <span className={p.avatar} data-hue={hue(r.key)} aria-hidden="true">{initials(r.name)}</span>
        <span className={p.who}><span className={p.name} translate="no">{r.name}{r.you && <span className={p.you} translate="yes">{t("people.you")}</span>}</span>
          {r.email && r.email !== r.name && <span className={p.email} translate="no">{r.email}</span>}</span></span> },
      { id: "role", name: t("people.col.role"), value: r => r.role, label: v => roleLabel(v as RoleId), cell: r => r.role === null ? <span className={p.muted}>{t("people.noRoleYet")}</span>
        : <span className={p.role}>{roleLabel(r.role)}{!r.assigned && <span className={p.muted}>{t("people.byDefault")}</span>}</span> },
      ...(team ? [{ id: "workspace", name: t("people.col.workspace"), value: (r: Row) => r.workspace, label: (v: string) => t(WORKSPACE[v as WorkspaceRole]),
        cell: (r: Row) => r.workspace ? <span>{t(WORKSPACE[r.workspace])}{r.role && roleConflict(r.role, false, r.workspace) && <Badge tone="warn" icon="alert">{t("people.conflict")}</Badge>}</span> : <span className={p.muted}>—</span> }] : []),
      // Status needs the server's membership; in the lab every person is only on this device, so the column says nothing.
      ...(team ? [{ id: "status", name: t("people.col.status"), value: (r: Row) => r.status, label: (v: string) => t(STATUS[v as Status]), cell: (r: Row) => <span className={p.status} data-tone={TONE[r.status]} title={r.expires ? t("people.expires", { date: fmt.date(r.expires) }) : undefined}><span className={p.dot} aria-hidden="true"/>{t(STATUS[r.status])}</span> }] : []),
      ...(sharing.receives ? [{ id: "receives", name: t("people.col.receives"), value: (r: Row) => r.receives ? String(r.receives.length) : null, type: "int" as const,
        cell: (r: Row) => !r.receives ? <span className={p.muted}>{r.status === "invited" ? "—" : t("people.notInGrid")}</span>
          : <span className={p.receives} title={r.receives.map(x => t(`share.pack.${x}` as MessageKey)).join(", ")}>{t("people.receivesCount", { count: r.receives.length })}
            {!r.receives.some(x => COST_PACKS.includes(x as never)) && <Badge tone="info" icon="lock">{t("people.noCost")}</Badge>}</span> }] : []),
      { id: "joined", name: t("people.col.joined"), type: "date", value: r => r.joined || null },
      { id: "actions", name: t("people.col.actions"), cell: r => r.userId && list.canManage && !r.you ? <span className={p.actions}>
        <Button size="sm" icon="settings" disabled={busy || locked} aria-label={t(r.assigned ? "people.editFor" : "people.assignFor", { name: r.name })} onClick={() => open(r)} data-testid="people-edit">{t(r.assigned ? "people.edit" : "people.assign")}</Button>
        {r.assigned && <Button size="sm" icon="close" disabled={busy || locked} aria-label={t("people.removeFor", { name: r.name })} onClick={() => remove(r)}>{t("people.remove")}</Button>}
      </span> : r.status === "invited" && team ? <ButtonLink href="/account/users" size="sm">{t("people.manage")}</ButtonLink> : null },
    ]}/>
    {!rows.length && <p className={p.empty}>{t("people.empty")}</p>}
    {list.canManage && !team && <details className={p.byId}>
      <summary>{t("people.addById")}</summary>
      <form onSubmit={e => { e.preventDefault(); const f = byId; setById({ ...byId, userId: "", name: "" });
        act(() => client.call("roleSet", f), () => ({ title: msg("people.toast.saved", { name: f.name, role: roleLabel(f.role) }), undo: () => client.call("roleRemove", { userId: f.userId }) })); }}>
        <Field label={t("roles.name")}><input required maxLength={160} value={byId.name} onChange={e => setById({ ...byId, name: e.target.value })}/></Field>
        <Field label={t("roles.signInIdFrom")}><input required maxLength={160} value={byId.userId} onChange={e => setById({ ...byId, userId: e.target.value })}/></Field>
        <Field label={t("roles.role")}><select value={byId.role} onChange={e => setById({ ...byId, role: e.target.value as RoleId })}>{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></Field>
        <Button type="submit" variant="primary" disabled={busy || locked || !byId.name.trim() || !byId.userId.trim()}>{t("roles.assignRole")}</Button>
      </form>
    </details>}
    <Dialog open={!!editing} onClose={() => setEditing(null)} labelledBy="people-edit-title">
      {editing && <form className={p.dialog} onSubmit={e => { e.preventDefault(); if (!conflict) save(); }} data-testid="people-dialog">
        <h3 id="people-edit-title">{editing.assigned ? t("people.dialog.title", { name: editing.name }) : t("people.dialog.assignTitle", { name: editing.name })}</h3>
        {editing.email && <p className={p.muted} translate="no">{editing.email}</p>}
        <Field label={t("people.dialog.name")}><input maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field>
        <Field label={t("people.dialog.role")} hint={say(ROLES.find(r => r.id === form.role)!.summary)}>
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as RoleId })} data-testid="people-dialog-role">{ROLES.map(r => <option key={r.id} value={r.id}>{say(r.label)}</option>)}</select></Field>
        {conflict && <Notice tone="warn" data-testid="people-conflict">{t(conflict)}</Notice>}
        {draft && <p className={p.muted}>{t("people.toast.draftBody")}</p>}
        <div className={p.dialogActions}>
          <Button onClick={() => setEditing(null)}>{t("people.dialog.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy || !!conflict} data-testid="people-dialog-save">{t("people.dialog.save")}</Button>
        </div>
      </form>}
    </Dialog>
    {toast && <Toast testId="people-toast" title={say(toast.title)} body={toast.body ? say(toast.body) : undefined} closeLabel={t("people.close")} onClose={() => setToast(null)}
      actions={toast.undo ? <button type="button" onClick={undo} disabled={busy}>{t("people.undo")}</button> : undefined}/>}
  </section>;
}
