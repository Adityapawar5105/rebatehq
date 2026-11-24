"use client";
// Team sharing S3a (SHARING_DESIGN.md section 3; blueprint section 22, item 38): who receives which data. The Owner ticks
// packs per role, adds extras for one person, previews a person's view and sees what changes before saving a draft; the
// draft is signed at the next key rotation. The worker checks every rule again (cost locks, Owner-only edits).
import { useEffect, useMemo, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { Grid } from "@/lib/relay/protocol";
import { ALL_PACKS, COST_PACKS, RECOMMENDED, VAULT_ROLES, costRole, packsFor, publisherRole, type AnyPack, type RoleId } from "@/lib/sharing/catalog";
import { ROLE_LABEL } from "@/lib/roles/access";
import { Button, Card, Field, Notice } from "@/components/ui/ui";
import { msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";

const PACK_NAME: Record<AnyPack, MessageKey> = { items: "share.pack.items", customers: "share.pack.customers", book: "share.pack.book", contracts: "share.pack.contracts", guards: "share.pack.guards", cost: "share.pack.cost", cost_floors: "share.pack.cost_floors", supplier: "share.pack.supplier", rules: "share.pack.rules", competitors: "share.pack.competitors", documents: "share.pack.documents", results: "share.pack.results" };
/** Packs a release has built (S1); the rest are shown but cannot be changed yet. */
const BUILT: readonly AnyPack[] = ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors"];
const locked = (role: RoleId, pack: AnyPack) => !costRole(role) && COST_PACKS.includes(pack);
const fixed = (role: RoleId) => publisherRole(role, false);
const order = (packs: AnyPack[]) => ALL_PACKS.filter(p => packs.includes(p));
type State = Results["shareGrid"];

export function ShareGrid({ client, busy, operation }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void> }) {
  const [state, setState] = useState<State | null>(null), [grid, setGrid] = useState<Grid | null>(null), [note, setNote] = useState(""), [who, setWho] = useState("");
  useEffect(() => { let on = true; void client.call("shareGrid", {}).then(s => { if (!on) return; setState(s); setGrid(s.draft ?? s.signed); }).catch(() => { if (on) setNote(msg("share.loadFailed")); }); return () => { on = false; }; }, [client]);
  const ticks = useMemo(() => Object.fromEntries(grid?.ticks ?? []) as Record<RoleId, AnyPack[]>, [grid]);
  if (!state) return null;
  if (!grid) return <Card headingId="share-grid-heading" title={t("share.grid.heading")} description={t("share.grid.notJoined")} data-testid="share-grid"/>;
  const edit = state.canSign && !busy, name = (u: string) => state.people.find(p => p.userId === u)?.name ?? u;
  const setTicks = (next: Record<RoleId, AnyPack[]>) => setGrid({ ...grid, ticks: VAULT_ROLES.map(r => [r, order(fixed(r) ? [...ALL_PACKS] : next[r].filter(p => !locked(r, p)))]) as Grid["ticks"] });
  const toggle = (role: RoleId, pack: AnyPack, on: boolean) => setTicks({ ...ticks, [role]: on ? [...ticks[role], pack] : ticks[role].filter(p => p !== pack) });
  const preset = (kind: "recommended" | "open" | "strict") => setTicks(Object.fromEntries(VAULT_ROLES.map(r => [r, kind === "recommended" ? [...RECOMMENDED[r]] : kind === "open" ? [...ALL_PACKS] : ["items", "book"]])) as Record<RoleId, AnyPack[]>);
  const extra = (userId: string, pack: AnyPack, on: boolean) => setGrid({ ...grid, people: grid.people.map(p => p.userId !== userId ? p : { ...p, extras: order(on ? [...p.extras, pack] : p.extras.filter(x => x !== pack)) }) });
  const gets = (g: Grid, userId: string) => { const p = g.people.find(x => x.userId === userId); return p ? packsFor(p.role, g.namedOwner === userId, Object.fromEntries(g.ticks), p.extras) : []; };
  const list = (packs: AnyPack[]) => packs.length ? packs.map(p => t(PACK_NAME[p])).join(", ") : t("share.grid.none");
  const changes = state.signed ? grid.people.flatMap(p => {
    const before = gets(state.signed!, p.userId), after = gets(grid, p.userId), gain = after.filter(x => !before.includes(x)), lose = before.filter(x => !after.includes(x));
    return [...(gain.length ? [t("share.grid.gains", { name: name(p.userId), packs: list(gain) })] : []), ...(lose.length ? [t("share.grid.loses", { name: name(p.userId), packs: list(lose) })] : [])];
  }) : [];
  const preview = grid.people.find(p => p.userId === who);
  return <Card headingId="share-grid-heading" title={t("share.grid.heading")} description={t("share.grid.body")} data-testid="share-grid">
    <p role="status">{say(note)}</p>
    {!state.canSign && <Notice tone="info">{t("share.grid.readOnly")}</Notice>}
    {state.draft && <Notice tone="warn" data-testid="share-grid-draft">{t("share.grid.draftPending")}</Notice>}
    {state.canSign && <p><span className={styles.muted}>{t("share.grid.presets")}: </span>
      <Button size="sm" disabled={!edit} onClick={() => preset("recommended")}>{t("share.grid.recommended")}</Button>{" "}
      <Button size="sm" disabled={!edit} onClick={() => preset("open")}>{t("share.grid.open")}</Button>{" "}
      <Button size="sm" disabled={!edit} onClick={() => preset("strict")}>{t("share.grid.strict")}</Button>{" "}
      <Button size="sm" disabled={!edit || !state.signed} onClick={() => setGrid(state.signed)}>{t("share.grid.reset")}</Button></p>}
    <div className={styles.tableWrap}><table className={styles.table} data-testid="share-grid-table">
      <thead><tr><th scope="col">{t("share.grid.pack")}</th>{VAULT_ROLES.map(r => <th key={r} scope="col">{say(ROLE_LABEL[r])}</th>)}</tr></thead>
      <tbody>{ALL_PACKS.map(p => <tr key={p}><th scope="row">{t(PACK_NAME[p])}{BUILT.includes(p) ? "" : " " + t("share.grid.later")}</th>
        {VAULT_ROLES.map(r => <td key={r}>{locked(r, p) ? <span title={t("share.grid.locked")} aria-label={t("share.grid.locked")} data-testid={`share-grid-lock-${r}-${p}`}>🔒</span> :
          <input type="checkbox" aria-label={t("share.grid.cell", { pack: t(PACK_NAME[p]), role: say(ROLE_LABEL[r]) })} data-testid={`share-grid-${r}-${p}`}
            checked={fixed(r) || ticks[r]?.includes(p)} disabled={!edit || fixed(r) || !BUILT.includes(p)} onChange={e => toggle(r, p, e.target.checked)}/>}</td>)}</tr>)}</tbody>
    </table></div>
    <p className={styles.muted}>{t("share.grid.lockNote")}</p>
    <details><summary>{t("share.grid.extras")}</summary>{grid.people.filter(p => !fixed(p.role)).map(p => <fieldset key={p.userId}><legend>{name(p.userId)} · {say(ROLE_LABEL[p.role])}</legend>
      {BUILT.filter(x => !locked(p.role, x)).map(x => <label key={x} className={styles.row}><input type="checkbox" disabled={!edit} checked={p.extras.includes(x)} onChange={e => extra(p.userId, x, e.target.checked)}/>{t(PACK_NAME[x])}</label>)}</fieldset>)}</details>
    <Field label={t("share.grid.preview")}><select value={who} onChange={e => setWho(e.target.value)} data-testid="share-grid-preview"><option value="">—</option>{grid.people.map(p => <option key={p.userId} value={p.userId}>{name(p.userId)}</option>)}</select></Field>
    {preview && <p data-testid="share-grid-preview-result">{t("share.grid.previewGets", { name: name(preview.userId), packs: list(gets(grid, preview.userId)) })}</p>}
    <h3>{t("share.grid.changes")}</h3>
    <ul className={styles.guardList} data-testid="share-grid-changes">{changes.length ? changes.map((c, i) => <li key={i}>{c}</li>) : <li>{t("share.grid.noChanges")}</li>}</ul>
    {state.canSign && <p><Button variant="primary" disabled={!edit} data-testid="share-grid-save" onClick={() => void operation(async () => { const s = await client.call("shareGridSave", { grid }); setState(s); setGrid(s.draft ?? s.signed); setNote(msg("share.grid.saved")); })}>{t("share.grid.save")}</Button>{" "}
      <Button disabled={!edit || !state.draft} onClick={() => void operation(async () => { const s = await client.call("shareGridDiscard", {}); setState(s); setGrid(s.signed); })}>{t("share.grid.discard")}</Button></p>}
  </Card>;
}
