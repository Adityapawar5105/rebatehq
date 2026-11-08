"use client";
import { useEffect, useRef, useState } from "react";
import { CurrencySettings } from './CurrencySettings';
import { VaultClient } from "@/lib/vault/client";
import type { Scope, StorageStatus, Tier, VaultStatus } from "@/lib/vault/protocol";
import { fmt, msg, say, t, useLocale, setWorkspaceCurrency, type MessageKey } from "@/lib/i18n";
import { Preferences } from "@/components/Preferences";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Card, Field, JumpNav, Notice, PageHeader } from "@/components/ui/ui";
import ui from "@/components/ui/ui.module.css";
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
import sh from "./shell.module.css";
// Section ids are stable identifiers (hash links, role access lists); labels are message keys.
export const sections = ["Home", "Data Hub", "Margin", "Pricing", "Quotes", "Reports", "Settings"] as const;
export type Section = typeof sections[number];
export const SECTION_LABEL: Record<Section, MessageKey> = { Home: "shell.section.home", "Data Hub": "shell.section.dataHub", Margin: "shell.section.margin", Pricing: "shell.section.pricing", Quotes: "shell.section.quotes", Reports: "shell.section.reports", Settings: "shell.section.settings" };
const SECTION_DESC: Record<Section, MessageKey> = { Home: "shell.desc.home", "Data Hub": "shell.desc.dataHub", Margin: "shell.desc.margin", Pricing: "shell.desc.pricing", Quotes: "shell.desc.quotes", Reports: "shell.desc.reports", Settings: "shell.desc.settings" };
const SECTION_ICON: Record<Section, IconName> = { Home: "home", "Data Hub": "database", Margin: "chart", Pricing: "tag", Quotes: "quote", Reports: "report", Settings: "settings" };
export const sectionHash = (s: Section) => s.toLowerCase().replace(" ", "-");
const NAV_KEY = "rebatehq.nav";
export function VaultApp({ scope, email, workspace, lab = false, legacyEnabled = false }: { scope: Scope; email: string; workspace: string; lab?: boolean; legacyEnabled?: boolean }) {
  useLocale(); // re-render every screen when the language changes
  const client = useRef<VaultClient | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null), [section, setSection] = useState<Section>("Home");
  // Status and error text are kept as message references, so a language switch re-renders them.
  useEffect(() => { setWorkspaceCurrency(status?.state === "unlocked" ? status.currency : "USD"); }, [status?.state, status?.currency]);
  const [error, setError] = useState(""), [message, setMessage] = useState(msg("shell.opening")), [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(""), [tier, setTier] = useState<Tier>("starter"), [ownerName, setOwnerName] = useState("");
  const [storage, setStorage] = useState<StorageStatus | null>(null), [progress, setProgress] = useState<{ stage: string; done: string; total: string } | null>(null);
  const [supported, setSupported] = useState(true);
  // Layout preferences only (never business data): a collapsed sidebar is remembered in this browser.
  const [collapsed, setCollapsed] = useState(false), [drawer, setDrawer] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem(NAV_KEY) === "collapsed"); } catch {} }, []);
  const toggleNav = () => setCollapsed(c => { try { localStorage.setItem(NAV_KEY, c ? "open" : "collapsed"); } catch {} return !c; });
  useEffect(() => { if (!drawer) return; const close = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [drawer]);
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
    setSupported(/Chrome|Edg\/|Firefox\//.test(navigator.userAgent));
    let lastActivity = 0;
    const touch = () => { if (Date.now() - lastActivity > 5000) { lastActivity = Date.now(); void c.call("touch", {}).catch(() => undefined); } };
    const leaving = () => { void c.call("lock", {}).catch(() => undefined); };
    window.addEventListener("pointerdown", touch); window.addEventListener("keydown", touch); window.addEventListener("pagehide", leaving);
    const hash = () => { const raw = location.hash.slice(1); const value=raw.startsWith('pricing-')?'pricing':raw.startsWith('margin-')?'margin':raw; const match = sections.find(s => sectionHash(s) === value); if (match) setSection(match); };
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
  const lock = () => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setMessage(msg("shell.locked")); });
  const licenceLine = status?.licence && <p role="status" data-testid="licence-status" className={sh.licence} data-tone={status.licence.writable ? "ok" : "bad"}>
    <Icon name={status.licence.writable ? "shield" : "alert"} size={15}/>
    <span>{status.licence.writable?(t("shell.licensed", { tier: tierName(status.licence.tier) })+(status.licence.offline?t("shell.offlineGrace"):'')):t("shell.readOnly", { reason: say(status.licence.reason) })}{t("common.listSeparator")}<a href="/account/licence">{t("shell.licenceLink")}</a></span>
  </p>;
  return <div className={`${styles.shell} ${sh.frame}`} data-nav={collapsed ? "collapsed" : "open"} data-drawer={drawer ? "open" : "closed"}>
    <a className={sh.skip} href="#local-content">{t("shell.skip")}</a>
    <aside className={sh.sidebar} id="app-sidebar" aria-label={t("shell.sidebar")}>
      <a href="/home" className={sh.brand}><span className={sh.mark} aria-hidden="true">{t("shell.brandMark")}</span><span className={sh.label}>{t("app.name")}</span></a>
      <nav aria-label={t("shell.mainNav")} className={sh.nav}>
        {navItems.map(item => <a key={item} href={`#${sectionHash(item)}`} className={sh.navLink} aria-current={shown === item ? "page" : undefined} title={collapsed ? t(SECTION_LABEL[item]) : undefined} onClick={() => { setSection(item); setDrawer(false); }}><Icon name={SECTION_ICON[item]}/><span className={sh.label}>{t(SECTION_LABEL[item])}</span></a>)}
        {legacyEnabled && <a className={sh.navLink} href="/legacy/dashboard"><Icon name="flask"/><span className={sh.label}>{t("shell.legacyLink")}</span></a>}
      </nav>
      <div className={sh.sideFoot}>
        <div className={sh.workspace}><strong translate="no">{workspace}</strong><span translate="no">{email}</span></div>
        <button type="button" className={sh.collapse} aria-pressed={collapsed} onClick={toggleNav}><Icon name="sidebar"/><span className={sh.label}>{t(collapsed ? "shell.expandNav" : "shell.collapseNav")}</span></button>
      </div>
    </aside>
    {drawer && <button type="button" className={sh.scrim} aria-label={t("shell.closeMenu")} onClick={() => setDrawer(false)}/>}
    <div className={sh.main}>
      <header className={sh.topbar}>
        <button type="button" className={sh.menuButton} aria-label={t("shell.menu")} aria-expanded={drawer} aria-controls="app-sidebar" onClick={() => setDrawer(true)}><Icon name="menu"/></button>
        <button type="button" className={sh.search} aria-label={t("shell.paletteButton")} aria-keyshortcuts="Control+K Meta+K" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}><Icon name="search" size={16}/><span className={sh.searchText}>{t("shell.searchLabel")}</span><kbd className={sh.kbd}>{t("shell.paletteShortcut")}</kbd></button>
        <div className={sh.tools}>
          <Preferences pseudo={lab} className={sh.prefs}/>
          {!lab && <form className={sh.signout} method="post" action="/api/auth/logout"><Button type="submit" variant="ghost" size="sm" icon="logout">{t("shell.signOut")}</Button></form>}
        </div>
      </header>
      {lab && <p className={sh.labNotice} role="note"><Icon name="flask" size={15}/><span>{t("shell.labNotice")}</span></p>}
      <CommandPalette client={unlocked ? client.current : null} caps={caps} sections={navItems} go={item => { setSection(item); location.hash = sectionHash(item); }} commands={{
        lock: unlocked ? lock : undefined,
        save: unlocked && status?.dirty ? () => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); }) : undefined,
      }}/>
      <main id="local-content" className={sh.content} tabIndex={-1}>
        {unlocked && <PageHeader eyebrow={t("shell.eyebrow")} title={t(SECTION_LABEL[shown])} description={t(SECTION_DESC[shown])} actions={<Button icon="lock" disabled={busy} onClick={lock}>{t("shell.lock")}</Button>}/>}
        {!supported && <Notice data-testid="browser-support-notice" tone="warn">{t("shell.browserNotice")}</Notice>}
        <p role="status" aria-live="polite" className={sh.message}>{say(message)}</p>
        {error && <Notice tone="bad" role="alert">{t("common.warningMark", { text: say(error) })}</Notice>}
        {status?.preparing && <Notice tone="info" data-testid="preparing">{t("shell.preparing")}</Notice>}
        {status?.recovered && <Notice tone="warn">{t("shell.recovered")}</Notice>}
        {progress && <div className={sh.progress}><label htmlFor="vault-progress">{say(progress.stage)}</label><progress id="vault-progress" value={Number(progress.done)} max={Math.max(1, Number(progress.total))}/>{!progress.stage.startsWith("Saving") && !progress.stage.startsWith("Saved") && <Button size="sm" onClick={() => void client.current!.call("cancel", {})}>{t("shell.cancelImport")}</Button>}</div>}
        {!status ? <section className={ui.card} aria-busy="true">{t("shell.startingWorker")}</section> : !unlocked ? <div className={sh.auth}>
          <section className={`${ui.card} ${sh.authCard}`} aria-labelledby="auth-heading">
            <span className={sh.authIcon}><Icon name="lock" size={24}/></span>
            <h2 id="auth-heading">{t(status.exists ? "shell.unlockHeading" : "shell.createHeading")}</h2>
            <p className={sh.authNote}>{t("shell.passphraseNote")}</p>
            <form onSubmit={event => { event.preventDefault(); const secret = passphrase; setPassphrase(""); void operation(async () => { const start = performance.now(); const result = status.exists ? await client.current!.call("unlock", { passphrase: secret }) : await client.current!.call("create", { passphrase: secret, tier, ownerName }); setStatus(result); setMessage(msg("shell.vaultReady", { ms: Math.round(performance.now() - start) })); window.dispatchEvent(new CustomEvent("vault-ready")); }); }}>
              <Field label={t("shell.passphrase")}><input type="password" minLength={12} maxLength={256} required autoComplete={status.exists ? "current-password" : "new-password"} value={passphrase} onChange={event => setPassphrase(event.target.value)} disabled={busy}/></Field>
              {!status.exists && <Field label={t("shell.ownerName")} hint={<span id="owner-help">{t("shell.ownerHelp")}</span>}><input required maxLength={160} value={ownerName} onChange={event => setOwnerName(event.target.value)} disabled={busy} aria-describedby="owner-help"/></Field>}
              {!status.exists && <Field label={t("shell.capacity")}><select value={tier} onChange={event => setTier(event.target.value as Tier)} disabled={busy}><option value="starter">{t("shell.tier.starter")}</option><option value="professional" disabled={status.licence?.tier==='starter'}>{t("shell.tier.professional")}</option><option value="scale" disabled={status.licence?.tier!=='scale'}>{t("shell.tier.scale")}</option></select></Field>}
              <Button type="submit" variant="primary" size="lg" block icon={status.exists ? "key" : "shield"} disabled={busy || (!status.exists && !ownerName.trim())}>{busy ? t("shell.openingButton") : t(status.exists ? "shell.unlockButton" : "shell.createButton")}</Button>
            </form>
            {licenceLine}
            <p className={sh.authFoot}>{t("shell.autoLockNote")}</p>
          </section>
          {client.current && <div className={sh.authSide}><BackupView client={client.current} busy={busy} operation={operation} unlocked={false} onStatus={setStatus}/></div>}
        </div> : <>
          {access?.viewAs && <Notice tone="warn" role="status" data-testid="preview-banner" actions={<Button size="sm" disabled={busy} onClick={() => void operation(async () => { await client.current!.call("rolePreview", { role: null }); setStatus(await client.current!.call("status", {})); })}>{t("shell.returnView")}</Button>}>{t("shell.previewBanner", { role: say(access.roleLabel) })}</Notice>}
          {status.dirty && <Notice tone="bad" actions={<Button size="sm" onClick={() => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); })}>{t("shell.retrySave")}</Button>}>{t("shell.unsaved")}</Notice>}
          <div className={sh.statusBar}>
            <dl className={sh.summary} aria-label={t("shell.summaryLabel")}>
              <div><dt>{t("shell.stat.lines")}</dt><dd data-testid="line-count" data-value={status.lines}>{fmt.int(status.lines)}</dd></div>
              <div><dt>{t("shell.stat.products")}</dt><dd>{fmt.int(status.products)}</dd></div>
              <div><dt>{t("shell.stat.customers")}</dt><dd>{fmt.int(status.customers)}</dd></div>
              <div><dt>{t("shell.stat.generation")}</dt><dd>{fmt.int(status.generation)}</dd></div>
            </dl>
            {licenceLine}
          </div>
          {shown === "Home" && client.current && <HomeView client={client.current} userId={scope.userId} version={`${status.lines}|${status.generation}|${access?.role}`} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))}/>}
          {shown === "Home" && client.current && caps.includes('collaborate') && status.licence?.tier!=='starter' && <RelayPanel client={client.current} userId={scope.userId} onChange={async()=>setStatus(await client.current!.call('status',{}))}/>}
          {shown === "Home" && <GlossaryCard/>}
          {shown === "Data Hub" && client.current && <>
            <JumpNav label={t("shell.onThisPage")} jumpLabel={name => t("shell.jumpTo", { name })} items={[
              { id: "studio-heading", label: t("studio.importStudio"), icon: "upload" }, { id: "fix-heading", label: t("studio.fixLater"), icon: "inbox" },
              { id: "recon-heading", label: t("studio.reconciliation"), icon: "report" }, { id: "health-heading", label: t("studio.dataHealth"), icon: "checkCircle" },
              { id: "sources-heading", label: t("studio.importedFiles"), icon: "database" }, { id: "cleanup-heading", label: t("cleanup.itemMasterCleanup"), icon: "sparkle" },
              ...(caps.includes("cost") ? [{ id: "basis-heading", label: t("basis.costBasis"), icon: "coins" as const }] : []),
            ]}/>
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
          {shown === "Pricing" && client.current && <PricingView tier={status.licence?.tier??'starter'} client={client.current} userId={scope.userId} caps={caps} busy={busy} operation={operation} refresh={async()=>setStatus(await client.current!.call("status",{}))}/>}
          {shown === "Quotes" && client.current && <QuotesView client={client.current} userId={scope.userId} caps={caps} tier={status.licence?.tier} busy={busy} operation={operation}/>}
          {shown === "Reports" && caps.includes("cost") && client.current && <Card headingId="report-card-heading" title={t("shell.report.heading")} description={t("shell.report.body")}><LeakReportButton client={client.current} busy={busy || status.lines === "0"} operation={operation} setMessage={setMessage} onStatus={setStatus}/></Card>}
          {shown === "Reports" && caps.includes("audit") && <Card headingId="audit-heading" title={t("shell.audit.heading")} description={t("shell.audit.body", { entries: Number(status.auditEntries), version: status.schemaVersion })}><Button variant="primary" icon="shield" disabled={busy} onClick={() => void operation(async () => { const result = await client.current!.call("verify", {}); if (!result.valid) throw new Error(msg("shell.audit.failed")); setMessage(msg("shell.audit.verified", { entries: Number(result.entries) })); })}>{t("shell.audit.button")}</Button><p className={styles.muted}>{t("shell.audit.note")}</p></Card>}
          {shown === "Settings" && <JumpNav label={t("shell.onThisPage")} jumpLabel={name => t("shell.jumpTo", { name })} items={[
            { id: "prefs-heading", label: t("shell.prefs.heading"), icon: "palette" }, ...(caps.includes("backup") ? [{ id: "backup-heading", label: t("backup.encryptedBackupAndRestore"), icon: "download" as const }] : []),
            { id: "roles-heading", label: t("roles.teamAndRoles"), icon: "users" }, { id: "storage-heading", label: t("shell.storage.heading"), icon: "database" },
          ]}/>}
          {shown === "Settings" && <Card headingId="prefs-heading" title={t("shell.prefs.heading")} description={t("shell.prefs.body")}><Preferences pseudo={lab} className={styles.row}/><p>{t("fx.moneyNote", {code:status.currency})}</p></Card>}
          {shown === "Settings" && client.current && <CurrencySettings client={client.current} status={status} busy={busy} operation={operation} onStatus={setStatus}/>}
          {shown === "Settings" && client.current && caps.includes("backup") && <BackupView client={client.current} busy={busy} operation={operation} unlocked onStatus={setStatus}/>}
          {shown === "Settings" && client.current && <RolesView client={client.current} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))}/>}
          {shown === "Settings" && <section className={styles.card} aria-labelledby="storage-heading"><h2 id="storage-heading">{t("shell.storage.heading")}</h2>{status.licence?.writable&&status.tier!==status.licence.tier&&caps.includes('roles')&&<button disabled={busy} onClick={()=>void operation(async()=>{setStatus(await client.current!.call('capacityUpgrade',{}));setMessage(msg("shell.storage.upgraded"));})}>{t("shell.storage.upgrade")}</button>}<p>{t("shell.storage.summary", { saved: status.lastSaved ? fmt.dateTime(status.lastSaved) : t("common.none") })}</p><p>{t("shell.storage.persistence", { persistence: storage ? t(storage.persistent ? "shell.storage.granted" : "shell.storage.notGranted") : t("common.unknown"), usage: storage?.usage ? fmt.int(storage.usage) : t("common.unknown"), quota: storage?.quota ? fmt.int(storage.quota) : t("common.unknown"), bytes: storage?.namedOpfsBytes ? fmt.int(storage.namedOpfsBytes) : t("common.unknown") })}</p><button className={styles.primary} onClick={() => void operation(async () => { await navigator.storage.persist(); setStorage(await client.current!.call("storage", {})); setMessage(msg("shell.storage.refreshed")); })}>{t("shell.storage.request")}</button><p className={styles.muted}>{t("shell.storage.note")}</p>{!lab && <p><a href="/account/users">{t("shell.storage.team")}</a>{t("common.listSeparator")}<a href="/account/workspace">{t("shell.storage.workspace")}</a></p>}</section>}
        </>}
      </main>
    </div>
  </div>;
}
