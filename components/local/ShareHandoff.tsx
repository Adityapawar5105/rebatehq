"use client";
// Team sharing release S1 (SHARING_DESIGN.md; blueprint section 22, item 38): export a pack selection for a colleague
// as an encrypted file with a one-time code, and import one. Every check runs in the worker; this card only mirrors it.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import { ROLE_LABEL, type RoleId } from "@/lib/roles/access";
import { Button, Card, Checkbox, Field, Notice } from "@/components/ui/ui";
import { fmt, msg, say, t } from "@/lib/i18n";
import { download } from "./PricingView";
import { PACK_IDS, PACK_LABEL, type PackId } from "@/lib/sharing/packs";
import styles from "./vault.module.css";

type State = Results["shareState"]; type Counts = Results["shareCounts"]; type Preview = Results["shareImportPreview"];
const FULL = ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors"], SALES = ["items", "customers", "book", "contracts", "guards"];
const packLabel = (p: string) => (PACK_IDS as readonly string[]).includes(p) ? t(PACK_LABEL[p as PackId]) : p;
const STALE_DAYS = 7;

export function ShareHandoff({ client, busy, operation, refresh }: { client: VaultClient; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [state, setState] = useState<State | null>(null), [counts, setCounts] = useState<Counts | null>(null), [note, setNote] = useState("");
  const [role, setRole] = useState<RoleId>("sales_rep"), [name, setName] = useState(""), [packs, setPacks] = useState<string[]>(SALES), [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null), [typed, setTyped] = useState(""), [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => { let on = true; void client.call("shareState", {}).then(async s => { if (!on) return; setState(s); if (s.canExport) { const c = await client.call("shareCounts", {}); if (on) setCounts(c); } }).catch(() => { if (on) setNote(msg("share.loadFailed")); }); return () => { on = false; }; }, [client]);
  if (!state) return null;
  if (state.tier === "starter") return <Card headingId="share-heading" title={t("share.heading")} description={t("share.starter")}/>;
  const lockedRole = state.roles.find(r => r.role === role)?.locked ?? true;
  const lockedPack = (p: string) => lockedRole && !!counts?.find(c => c.pack === p)?.locked;
  const chosen = packs.filter(p => !lockedPack(p));
  const toggle = (p: string, on: boolean) => setPacks(on ? [...new Set([...packs, p])] : packs.filter(x => x !== p));
  const newest = state.books.reduce<string | null>((m, b) => !m || b.publishedAt > m ? b.publishedAt : m, null);
  const age = newest ? Math.floor((Date.now() - Date.parse(newest)) / 86_400_000) : 0;
  return <Card headingId="share-heading" title={t("share.heading")} description={t("share.body")} data-testid="share-card">
    <p role="status">{say(note)}</p>
    {state.books.length > 0 && <Notice tone={age > STALE_DAYS ? "warn" : "info"} title={t("share.received", { name: state.books[0].publisher, date: fmt.date(newest!) })} data-testid="share-received">
      <ul className={styles.guardList}>{state.books.map(b => <li key={b.pack}>{t("share.receivedPack", { pack: packLabel(b.pack), rows: fmt.int(b.rows), date: fmt.date(b.publishedAt) })}</li>)}</ul>
      {age > STALE_DAYS && <p>{t("share.stale", { count: age })}</p>}
      {state.changes.length > 0 && <details><summary>{t("share.changes", { count: state.changes.length })}</summary><ul className={styles.guardList} data-testid="share-changes">{state.changes.map((c, i) => <li key={i}>{t("share.change", { pack: packLabel(c.pack), key: c.key, before: c.before === null ? t("share.none") : fmt.currency(c.before), after: c.after === null ? t("share.removed") : fmt.currency(c.after) })}</li>)}</ul></details>}
      <p className={styles.muted}>{t("share.receivedNote")}</p>
    </Notice>}
    {state.canExport && <section aria-labelledby="share-export-heading">
      <h3 id="share-export-heading">{t("share.exportHeading")}</h3>
      <p>{t("share.exportBody")}</p>
      <div className={styles.grid}>
        <Field label={t("share.forRole")}><select value={role} onChange={e => { setRole(e.target.value as RoleId); setCode(""); }} data-testid="share-role">{state.roles.map(r => <option key={r.role} value={r.role}>{say(ROLE_LABEL[r.role])}</option>)}</select></Field>
        <Field label={t("share.forName")} hint={t("share.forNameHint")}><input value={name} maxLength={160} onChange={e => setName(e.target.value)} data-testid="share-name"/></Field>
      </div>
      <p><Button size="sm" onClick={() => setPacks(FULL)}>{t("share.presetFull")}</Button> <Button size="sm" onClick={() => setPacks(SALES)}>{t("share.presetSales")}</Button></p>
      <fieldset><legend>{t("share.packs")}</legend>{FULL.map(p => {
        const c = counts?.find(x => x.pack === p), locked = lockedPack(p);
        return <Checkbox key={p} label={t("share.packLine", { pack: packLabel(p), rows: fmt.int(c?.rows ?? 0) })} hint={locked ? t("share.lockedHint", { role: say(ROLE_LABEL[role]) }) : c?.locked ? t("share.costHint") : undefined} checked={!locked && packs.includes(p)} disabled={locked} onChange={e => toggle(p, e.target.checked)} data-testid={`share-pack-${p}`}/>;
      })}</fieldset>
      <Button variant="primary" icon="download" disabled={busy || !chosen.length} data-testid="share-export" onClick={() => void operation(async () => {
        const r = await client.call("shareExport", { packs: chosen, role, name }); download(r.name, r.blob); setCode(r.code); setNote(msg("share.exported", { count: r.packs.length }));
      })}>{t("share.exportButton")}</Button>
      {code && <Notice tone="warn" title={t("share.codeTitle")} data-testid="share-code-box"><p><code translate="no" className={styles.code} data-testid="share-code">{code}</code></p><p>{t("share.codeNote")}</p><Button size="sm" onClick={() => setCode("")}>{t("share.codeDone")}</Button></Notice>}
    </section>}
    <section aria-labelledby="share-import-heading">
      <h3 id="share-import-heading">{t("share.importHeading")}</h3>
      <p>{t("share.importBody")}</p>
      <div className={styles.grid}>
        <Field label={t("share.file")}><input type="file" accept=".rhqshare" data-testid="share-file" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}/></Field>
        <Field label={t("share.code")} hint={t("share.codeHint")}><input value={typed} autoComplete="off" spellCheck={false} data-testid="share-code-input" onChange={e => { setTyped(e.target.value); setPreview(null); }}/></Field>
      </div>
      <Button disabled={busy || !file || !typed.trim()} data-testid="share-check" onClick={() => void operation(async () => { setPreview(await client.call("shareImportPreview", { file: file!, code: typed })); })}>{t("share.check")}</Button>
      {preview && <Notice tone={preview.packs.some(p => p.older) ? "bad" : "info"} title={t("share.previewTitle", { name: preview.publisher, date: fmt.dateTime(preview.exportedAt) })} data-testid="share-preview">
        <p>{t("share.previewFor", { role: say(ROLE_LABEL[preview.recipientRole]), name: preview.recipientName || t("share.none") })}</p>
        <ul className={styles.guardList}>{preview.packs.map(p => <li key={p.pack}>{t("share.packLine", { pack: packLabel(p.pack), rows: fmt.int(p.rows) })}{p.older ? " " + t("share.olderPack") : ""}</li>)}</ul>
        <p>{t("share.replaceNote")}</p>
        <Button variant="primary" disabled={busy || preview.packs.some(p => p.older)} data-testid="share-import" onClick={() => void operation(async () => {
          const r = await client.call("shareImport", { file: file!, code: typed }); setState(r.state); setPreview(null); setTyped(""); setNote(msg("share.imported", { count: r.packs.length, changed: Number(r.changed) })); await refresh();
        })}>{t("share.importButton")}</Button>
      </Notice>}
    </section>
  </Card>;
}
