"use client";
import { useEffect, useRef, useState } from "react";
import { VaultClient } from "@/lib/vault/client";
import type { Scope, StorageStatus, Tier, VaultStatus } from "@/lib/vault/protocol";
import { fmt, msg, say, t, useLocale, type MessageKey } from "@/lib/i18n";
import { Preferences } from "@/components/Preferences";
import { PricingView } from "./PricingView";
import { QuotesView } from "./QuotesView";
import { BackupView } from "./BackupView";
import { ImportStudio } from "./ImportStudio";
import { MarginView, LeakReportButton } from "./MarginView";
import { HomeView } from "./HomeView";
import { CleanupView } from "./CleanupView";
import { CostBasisView } from "./CostBasisView";
import { RolesView } from "./RolesView";
import { RelayPanel } from './RelayPanel';
import { CommandPalette, OPEN_PALETTE_EVENT } from "./CommandPalette";
import { GlossaryCard } from "./Glossary";
import { tierName } from "./labels";
import styles from "./vault.module.css";
// Section ids are stable identifiers (hash links, role access lists); labels are message keys.
export const sections = ["Home", "Data Hub", "Margin", "Pricing", "Quotes", "Reports", "Settings"] as const;
export type Section = typeof sections[number];
export const SECTION_LABEL: Record<Section, MessageKey> = { Home: "shell.section.home", "Data Hub": "shell.section.dataHub", Margin: "shell.section.margin", Pricing: "shell.section.pricing", Quotes: "shell.section.quotes", Reports: "shell.section.reports", Settings: "shell.section.settings" };
export const sectionHash = (s: Section) => s.toLowerCase().replace(" ", "-");
export function VaultApp({ scope, email, workspace, lab = false, legacyEnabled = false }: { scope: Scope; email: string; workspace: string; lab?: boolean; legacyEnabled?: boolean }) {
  useLocale(); // re-render every screen when the language changes
  const client = useRef<VaultClient | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null), [section, setSection] = useState<Section>("Home");
  // Status and error text are kept as message references, so a language switch re-renders them.
  const [error, setError] = useState(""), [message, setMessage] = useState(msg("shell.opening")), [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(""), [tier, setTier] = useState<Tier>("starter"), [ownerName, setOwnerName] = useState("");
  const [storage, setStorage] = useState<StorageStatus | null>(null), [progress, setProgress] = useState<{ stage: string; done: string; total: string } | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let active = true;
    const c = new VaultClient(scope, event => {
      if (!active) return;
      if(event.event === "licence"){setStatus(event.status);}
      else if (event.event === "progress") { setProgress(event); window.dispatchEvent(new CustomEvent("vault-progress", { detail: { stage: event.stage } })); }
      else if (event.event === "writable") { void c.call("status", {}).then(s => { if (active) setStatus(s); }).catch(() => undefined); }
      else { setPassphrase(""); setMessage(event.reason); void c.call("status", {}).then(s => { if (active) setStatus(s); }); }
    });
    client.current = c;
    c.ready.then(s => { if (active) { setStatus(s); setMessage(msg(s.exists ? "shell.unlockPrompt" : "shell.createPrompt")); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : msg("common.operationFailed")); });
    void c.call("storage", {}).then(s => { if (active) setStorage(s); }).catch(() => undefined);
    setSupported(/Chrome|Edg\//.test(navigator.userAgent));
    let lastActivity = 0;
    const touch = () => { if (Date.now() - lastActivity > 5000) { lastActivity = Date.now(); void c.call("touch", {}).catch(() => undefined); } };
    const leaving = () => { void c.call("lock", {}).catch(() => undefined); };
    window.addEventListener("pointerdown", touch); window.addEventListener("keydown", touch); window.addEventListener("pagehide", leaving);
    const hash = () => { const value = location.hash.slice(1); const match = sections.find(s => sectionHash(s) === value); if (match) setSection(match); };
    hash(); window.addEventListener("hashchange", hash);
    return () => { active = false; window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); window.removeEventListener("pagehide", leaving); window.removeEventListener("hashchange", hash); c.close(); client.current = null; };
  }, [scope.userId, scope.tenantId]);
  async function operation(work: () => Promise<void>) {
    setBusy(true); setError(""); setProgress(null);
    try { await work(); } catch (e) { setError(e instanceof Error && e.message ? e.message : msg("common.operationFailed")); try { setStatus(await client.current!.call("status", {})); } catch {} }
    finally { setBusy(false); setProgress(null); }
  }
  const unlocked = status?.state === "unlocked", access = status?.access, caps = access?.caps ?? [], visible = access?.sections ?? [...sections], shown: Section = visible.includes(section) ? section : "Home";
  const navItems = sections.filter(item => !unlocked || visible.includes(item));
  return <div className={styles.shell}>
    <a className={styles.skip} href="#local-content">{t("shell.skip")}</a>
    <header className={styles.header}><a href="/home" className={styles.brand}><span aria-hidden="true">{t("shell.brandMark")}</span> <span>{t("app.name")}</span></a><span translate="no">{workspace}</span><span className={styles.identity} translate="no">{email}</span><button type="button" aria-keyshortcuts="Control+K Meta+K" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}>{t("shell.paletteButton")}</button><Preferences pseudo={lab} className={styles.prefs}/>{!lab && <form method="post" action="/api/auth/logout"><button>{t("shell.signOut")}</button></form>}</header>
    {lab && <aside className={styles.notice}>{t("shell.labNotice")}</aside>}
    <CommandPalette client={unlocked ? client.current : null} caps={caps} sections={navItems} go={item => { setSection(item); location.hash = sectionHash(item); }} commands={{
      lock: unlocked ? () => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setMessage(msg("shell.locked")); }) : undefined,
      save: unlocked && status?.dirty ? () => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); }) : undefined,
    }}/>
    <div className={styles.layout}>
      <nav aria-label={t("shell.mainNav")} className={styles.nav}>{navItems.map(item => <a key={item} href={`#${sectionHash(item)}`} aria-current={shown === item ? "page" : undefined} onClick={() => setSection(item)}>{t(SECTION_LABEL[item])}</a>)}{legacyEnabled && <a href="/legacy/dashboard">{t("shell.legacyLink")}</a>}</nav>
      <main id="local-content" className={styles.content} tabIndex={-1}>
        <div className={styles.title}><div><span className={styles.eyebrow}>{t("shell.eyebrow")}</span><h1>{t(SECTION_LABEL[shown])}</h1></div>{unlocked && <button disabled={busy} onClick={() => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setMessage(msg("shell.locked")); })}>{t("shell.lock")}</button>}</div>
        {!supported && <p className={styles.notice}>{t("shell.browserNotice")}</p>}
        <p role="status" aria-live="polite">{say(message)}</p>
        {error && <p role="alert" className={styles.error}>{t("common.warningMark", { text: say(error) })}</p>}
        {status?.licence && <p role="status" data-testid="licence-status" className={status.licence.writable?styles.muted:styles.error}>{status.licence.writable?(t("shell.licensed", { tier: tierName(status.licence.tier) })+(status.licence.offline?t("shell.offlineGrace"):'')):t("shell.readOnly", { reason: say(status.licence.reason) })}{t("common.listSeparator")}<a href="/account/licence">{t("shell.licenceLink")}</a></p>}
        {status?.preparing && <p className={styles.muted} data-testid="preparing">{t("shell.preparing")}</p>}
        {status?.recovered && <p className={styles.error}>{t("shell.recovered")}</p>}
        {progress && <div className={styles.progress}><label htmlFor="vault-progress">{say(progress.stage)}</label><progress id="vault-progress" value={Number(progress.done)} max={Math.max(1, Number(progress.total))}/>{!progress.stage.startsWith("Saving") && !progress.stage.startsWith("Saved") && <button onClick={() => void client.current!.call("cancel", {})}>{t("shell.cancelImport")}</button>}</div>}
        {!status ? <section className={styles.card} aria-busy="true">{t("shell.startingWorker")}</section> : !unlocked ? <section className={styles.card}>
          <h2>{t(status.exists ? "shell.unlockHeading" : "shell.createHeading")}</h2>
          <p>{t("shell.passphraseNote")}</p>
          <form onSubmit={event => { event.preventDefault(); const secret = passphrase; setPassphrase(""); void operation(async () => { const start = performance.now(); const result = status.exists ? await client.current!.call("unlock", { passphrase: secret }) : await client.current!.call("create", { passphrase: secret, tier, ownerName }); setStatus(result); setMessage(msg("shell.vaultReady", { ms: Math.round(performance.now() - start) })); window.dispatchEvent(new CustomEvent("vault-ready")); }); }}>
            <label>{t("shell.passphrase")}<input type="password" minLength={12} maxLength={256} required autoComplete={status.exists ? "current-password" : "new-password"} value={passphrase} onChange={event => setPassphrase(event.target.value)} disabled={busy}/></label>
            {!status.exists && <label>{t("shell.ownerName")}<input required maxLength={160} value={ownerName} onChange={event => setOwnerName(event.target.value)} disabled={busy} aria-describedby="owner-help"/><span id="owner-help" className={styles.small}>{t("shell.ownerHelp")}</span></label>}
            {!status.exists && <label>{t("shell.capacity")}<select value={tier} onChange={event => setTier(event.target.value as Tier)} disabled={busy}><option value="starter">{t("shell.tier.starter")}</option><option value="professional" disabled={status.licence?.tier==='starter'}>{t("shell.tier.professional")}</option><option value="scale" disabled={status.licence?.tier!=='scale'}>{t("shell.tier.scale")}</option></select></label>}
            <button className={styles.primary} disabled={busy || (!status.exists && !ownerName.trim())}>{busy ? t("shell.openingButton") : t(status.exists ? "shell.unlockButton" : "shell.createButton")}</button>
          </form>
          <p className={styles.muted}>{t("shell.autoLockNote")}</p>
          {client.current&&<BackupView client={client.current} busy={busy} operation={operation} unlocked={false} onStatus={setStatus}/>}
        </section> : <>
          {access?.viewAs && <section className={styles.warning} role="status" data-testid="preview-banner">{t("shell.previewBanner", { role: say(access.roleLabel) })} <button disabled={busy} onClick={() => void operation(async () => { await client.current!.call("rolePreview", { role: null }); setStatus(await client.current!.call("status", {})); })}>{t("shell.returnView")}</button></section>}
          {status.dirty && <section className={styles.error}>{t("shell.unsaved")} <button onClick={() => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); })}>{t("shell.retrySave")}</button></section>}
          <div className={styles.stats}><div><span>{t("shell.stat.lines")}</span><strong data-testid="line-count" data-value={status.lines}>{fmt.int(status.lines)}</strong></div><div><span>{t("shell.stat.products")}</span><strong>{fmt.int(status.products)}</strong></div><div><span>{t("shell.stat.customers")}</span><strong>{fmt.int(status.customers)}</strong></div><div><span>{t("shell.stat.generation")}</span><strong>{fmt.int(status.generation)}</strong></div></div>
          {shown === "Home" && client.current && <HomeView client={client.current} userId={scope.userId} version={`${status.lines}|${status.generation}|${access?.role}`} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))}/>}
          {shown === "Home" && <GlossaryCard/>}
          {shown === "Home" && client.current && caps.includes('collaborate') && status.licence?.tier!=='starter' && <RelayPanel client={client.current} userId={scope.userId} onChange={async()=>setStatus(await client.current!.call('status',{}))}/>}
          {shown === "Data Hub" && client.current && <>
            <ImportStudio client={client.current} status={status} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>
            <CleanupView client={client.current} version={`${status.lines}|${status.generation}`} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>
            {caps.includes("cost") && <CostBasisView client={client.current} version={`${status.lines}|${status.generation}`} busy={busy} operation={operation} canChoose={caps.includes("data")}/>}
            <details className={styles.card}><summary>{t("shell.columns.summary")}</summary>
              <p className={styles.small}><strong>{t("shell.columns.salesLabel")}</strong> <span translate="no">{t("shell.columns.sales")}</span></p>
              <p className={styles.small}><strong>{t("shell.columns.itemsLabel")}</strong> <span translate="no">{t("shell.columns.items")}</span> <strong>{t("shell.columns.customersLabel")}</strong> <span translate="no">{t("shell.columns.customers")}</span></p>
              <p className={styles.small}><strong>{t("shell.columns.vendorLabel")}</strong> <span translate="no">{t("shell.columns.vendor")}</span> <strong>{t("shell.columns.priceLabel")}</strong> <span translate="no">{t("shell.columns.price")}</span></p>
              <p className={styles.muted}>{t("shell.columns.note")}</p>
            </details>
          </>}
          {shown === "Margin" && client.current && <MarginView client={client.current} status={status} busy={busy} operation={operation} setMessage={setMessage} onStatus={setStatus}/>}
          {shown === "Pricing" && client.current && <PricingView client={client.current} userId={scope.userId} caps={caps} busy={busy} operation={operation} refresh={async()=>setStatus(await client.current!.call("status",{}))}/>}
          {shown === "Quotes" && client.current && <QuotesView client={client.current} userId={scope.userId} caps={caps} tier={status.licence?.tier} busy={busy} operation={operation}/>}
          {shown === "Reports" && caps.includes("cost") && client.current && <section className={styles.card}><h2>{t("shell.report.heading")}</h2><p>{t("shell.report.body")}</p><LeakReportButton client={client.current} busy={busy || status.lines === "0"} operation={operation} setMessage={setMessage} onStatus={setStatus}/></section>}
          {shown === "Reports" && caps.includes("audit") && <section className={styles.card}><h2>{t("shell.audit.heading")}</h2><p>{t("shell.audit.body", { entries: Number(status.auditEntries), version: status.schemaVersion })}</p><button className={styles.primary} disabled={busy} onClick={() => void operation(async () => { const result = await client.current!.call("verify", {}); if (!result.valid) throw new Error(msg("shell.audit.failed")); setMessage(msg("shell.audit.verified", { entries: Number(result.entries) })); })}>{t("shell.audit.button")}</button><p className={styles.muted}>{t("shell.audit.note")}</p></section>}
          {shown === "Settings" && <section className={styles.card} aria-labelledby="prefs-heading"><h2 id="prefs-heading">{t("shell.prefs.heading")}</h2><p className={styles.muted}>{t("shell.prefs.body")}</p><Preferences pseudo={lab} className={styles.row}/></section>}
          {shown === "Settings" && client.current && caps.includes("backup") && <BackupView client={client.current} busy={busy} operation={operation} unlocked onStatus={setStatus}/>}
          {shown === "Settings" && client.current && <RolesView client={client.current} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))}/>}
          {shown === "Settings" && <section className={styles.card}><h2>{t("shell.storage.heading")}</h2>{status.licence?.writable&&status.tier!==status.licence.tier&&caps.includes('roles')&&<button disabled={busy} onClick={()=>void operation(async()=>{setStatus(await client.current!.call('capacityUpgrade',{}));setMessage(msg("shell.storage.upgraded"));})}>{t("shell.storage.upgrade")}</button>}<p>{t("shell.storage.summary", { saved: status.lastSaved ? fmt.dateTime(status.lastSaved) : t("common.none") })}</p><p>{t("shell.storage.persistence", { persistence: storage ? t(storage.persistent ? "shell.storage.granted" : "shell.storage.notGranted") : t("common.unknown"), usage: storage?.usage ? fmt.int(storage.usage) : t("common.unknown"), quota: storage?.quota ? fmt.int(storage.quota) : t("common.unknown"), bytes: storage?.namedOpfsBytes ? fmt.int(storage.namedOpfsBytes) : t("common.unknown") })}</p><button className={styles.primary} onClick={() => void operation(async () => { await navigator.storage.persist(); setStorage(await client.current!.call("storage", {})); setMessage(msg("shell.storage.refreshed")); })}>{t("shell.storage.request")}</button><p className={styles.muted}>{t("shell.storage.note")}</p>{!lab && <p><a href="/account/users">{t("shell.storage.team")}</a>{t("common.listSeparator")}<a href="/account/workspace">{t("shell.storage.workspace")}</a></p>}</section>}
        </>}
      </main>
    </div>
  </div>;
}
