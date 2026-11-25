"use client";
import {ReportsView} from './ReportsView';
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeData } from "@/lib/vault/protocol";
import { CurrencySettings } from './CurrencySettings';
import { VaultClient } from "@/lib/vault/client";
import type { Scope, StorageStatus, Tier, VaultStatus } from "@/lib/vault/protocol";
import { fmt, msg, say, t, useLocale, setWorkspaceCurrency, type MessageKey } from "@/lib/i18n";
import { Preferences } from "@/components/Preferences";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, ButtonLink, Card, Field, Grid, Notice, PageHeader, StatTile } from "@/components/ui/ui";
import { SideNav, type SideNavItem } from "./SideNav";
import { SECTION_HASH, SUBPAGE_EVENT, pageOfHash, sectionOfHash, sectionPages } from "./subtabs";
import type { AccountLink } from "@/lib/account-nav";
import { GridTotalsProvider } from "@/components/ui/DataGrid";
import type { GridType } from "@/lib/grid/core";
import ui from "@/components/ui/ui.module.css";
import { PricingView } from "./PricingView";
import { RebatesView } from "./RebatesView";
import { QuotesView } from "./QuotesView";
import { BackupView } from "./BackupView";
import { ImportStudio } from "./ImportStudio";
import { MarginView, LeakReportButton } from "./MarginView";
import { CreateNew, HomeView } from "./HomeView";
import hs from "./home.module.css";
import { CleanupView } from "./CleanupView";
import { CostBasisView } from "./CostBasisView";
import { RecordsView } from "./RecordsView";
import { VendorsView } from "./VendorsView";
import { RolesView } from "./RolesView";
import { ShareHandoff } from "./ShareHandoff";
import { ShareGrid } from "./ShareGrid";
import type { TeamDirectory } from "@/lib/team";
import { SharedBanner } from "./SharedBanner";
import { SharedLockProvider } from "./sharedLock";
import { lockedPacks } from "@/lib/sharing/governed";
/** Team sharing S3: the sections that hold shared packs, for the read-only banner on a receiving seat. */
const SHARED_SECTIONS: Record<string, readonly string[] | undefined> = { Pricing: ["book", "contracts", "guards", "cost_floors"], "Data Hub": ["items", "customers", "cost"], "Rebates & Contracts": ["contracts"] };
import { RelayOnboarding, RelayPanel, RelaySetupLine } from './RelayPanel';
import { QuoteBranding } from './QuoteBranding';
import { AgentsInbox } from './AgentsInbox';
import { AuditPackButton } from './Templates';
import { OfflineCard, clearOfflineCopy, useOfflineWorker } from './OfflineMode';
import { BenchmarksView } from './BenchmarksView';
import { CommandPalette, OPEN_PALETTE_EVENT } from "./CommandPalette";
import { GlossaryCard } from "./Glossary";
import { PassphraseCard, StartAgain } from "./Recovery";
import { waitingDevices } from "@/lib/licence-devices";
import { scrollToHeading } from "./scroll";
import { Badge } from "@/components/ui/ui";
import { tierName } from "./labels";
import styles from "./vault.module.css";
import sh from "./shell.module.css";
// Section ids are stable identifiers (hash links, role access lists); labels are message keys.
export const sections = ["Home", "Data Hub", "Margin", "Pricing", "Quotes", "Rebates & Contracts", "Vendors", "Reports", "Settings"] as const;
export type Section = typeof sections[number];
export const SECTION_LABEL: Record<Section, MessageKey> = { Home: "shell.section.home", "Data Hub": "shell.section.dataHub", Margin: "shell.section.margin", Pricing: "shell.section.pricing", Quotes: "shell.section.quotes", "Rebates & Contracts": "rebate.section", Vendors: "vendor.section", Reports: "shell.section.reports", Settings: "shell.section.settings" };
const SECTION_DESC: Record<Section, MessageKey> = { Home: "shell.desc.home", "Data Hub": "shell.desc.dataHub", Margin: "shell.desc.margin", Pricing: "shell.desc.pricing", Quotes: "shell.desc.quotes", "Rebates & Contracts": "rebate.description", Vendors: "vendor.description", Reports: "shell.desc.reports", Settings: "shell.desc.settings" };
const SECTION_ICON: Record<Section, IconName> = { Home: "home", "Data Hub": "database", Margin: "chart", Pricing: "tag", Quotes: "quote", "Rebates & Contracts": "coins", Vendors: "users", Reports: "report", Settings: "settings" };
export const sectionHash = (s: Section) => s === "Rebates & Contracts" ? "rebates" : s.toLowerCase().replace(" ", "-");
const NAV_KEY = "rebatehq.nav";
export function VaultApp({ scope, email, workspace, lab = false, relayEnabled = false, account = [], team = null }: { scope: Scope; email: string; workspace: string; lab?: boolean; relayEnabled?: boolean; account?: AccountLink[]; /** Members and invitations for Team and roles (null in the lab). */ team?: TeamDirectory | null }) {
  useLocale(); // re-render every screen when the language changes
  const client = useRef<VaultClient | null>(null);
  // Every grid totals its selected rows through the worker (DuckDB), never in the page.
  const gridTotals = useCallback((types: GridType[], values: (string | null)[][]) => { if (!client.current) return Promise.reject(new Error("locked")); return client.current.call("gridTotals", { types, values }); }, []);
  const [status, setStatus] = useState<VaultStatus | null>(null), [section, setSection] = useState<Section>("Home");
  // The address bar's hash picks the sub-page shown under a section (23 Nov 2026); views read the same hash.
  const [hash, setHash] = useState("");
  useOfflineWorker(); // 8C-2: offline copy of the app shell (production builds only)
  // Status and error text are kept as message references, so a language switch re-renders them.
  useEffect(() => { setWorkspaceCurrency(status?.state === "unlocked" ? status.currency : "USD"); }, [status?.state, status?.currency]);
  const [error, setError] = useState(""), [message, setMessage] = useState(msg("shell.opening")), [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState(""), [tier, setTier] = useState<Tier>("starter"), [ownerName, setOwnerName] = useState("");
  const [storage, setStorage] = useState<StorageStatus | null>(null), [progress, setProgress] = useState<{ stage: string; done: string; total: string; kind?: "save" | "sim" | "check" } | null>(null);
  const [supported, setSupported] = useState(true);
  // Home header: the caller's own name, role label and Pricing Owner, from the role-checked `home` read.
  const [homeInfo, setHomeInfo] = useState<{ name: string | null; role: string; owner: string | null } | null>(null);
  const onHome = useCallback((h: HomeData) => setHomeInfo({ name: h.displayName, role: h.access.roleLabel, owner: h.pricingOwner }), []);
  // Layout preferences only (never business data): a collapsed sidebar is remembered in this browser.
  const [collapsed, setCollapsed] = useState(false), [drawer, setDrawer] = useState(false);
  // Audit B-8 and X-4: the idle-lock warning, and a worker that stopped.
  const [locking, setLocking] = useState(false), [dead, setDead] = useState(false);
  // Audit B-5: tell the workspace Owner when a device is waiting for approval (an in-app badge; decision D10).
  const [waiting, setWaiting] = useState(0);
  useEffect(() => { try { setCollapsed(localStorage.getItem(NAV_KEY) === "collapsed"); } catch {} }, []);
  const toggleNav = () => setCollapsed(c => { try { localStorage.setItem(NAV_KEY, c ? "open" : "collapsed"); } catch {} return !c; });
  useEffect(() => { if (!drawer) return; const close = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [drawer]);
  useEffect(() => {
    let active = true;
    const c = new VaultClient(scope, event => {
      if (!active) return;
      if(event.event === "licence"){setStatus(event.status);}
      else if (event.event === "locking") setLocking(true);
      else if (event.event === "progress") { setProgress(event); window.dispatchEvent(new CustomEvent("vault-progress", { detail: { stage: event.stage } })); }
      else if (event.event === "writable" || event.event === "agents" || event.event === "relay") { void c.call("status", {}).then(s => { if (active) setStatus(s); }).catch(() => undefined); }
      else if (event.event === "pickup") {
        // Roadmap 15.1: the scheduled folder pickup imported files or left them for review; Import Studio reloads its batch.
        const r = event.result, name = event.name ?? "";
        setMessage(r.error ? msg("pickup.noticeError", { name }) : r.imported ? msg("pickup.noticeImported", { count: r.added, name }) : msg("pickup.noticeReview", { count: r.added, name }));
        window.dispatchEvent(new CustomEvent("vault-pickup"));
        void c.call("status", {}).then(s => { if (active) setStatus(s); }).catch(() => undefined);
      }
      else { setLocking(false); setPassphrase(""); setMessage(event.reason); void c.call("status", {}).then(s => { if (active) setStatus(s); }); }
    }, () => { if (active) setDead(true); });
    // A worker that never answers is treated as dead, instead of an endless "starting" card (audit X-4).
    const startTimer = setTimeout(() => { if (active) setDead(d => d || !gotStatus); }, 45_000);
    let gotStatus = false;
    client.current = c;
    c.ready.then(s => { gotStatus = true; clearTimeout(startTimer); if (active) { setStatus(s); setMessage(msg(s.exists ? "shell.unlockPrompt" : "shell.createPrompt")); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : msg("common.operationFailed")); });
    void c.call("storage", {}).then(s => { if (active) setStorage(s); }).catch(() => undefined);
    setSupported(/Chrome|Edg\/|Firefox\//.test(navigator.userAgent));
    let lastActivity = 0;
    const touch = () => { setLocking(false); if (Date.now() - lastActivity > 5000) { lastActivity = Date.now(); void c.call("touch", {}).catch(() => undefined); } };
    const leaving = () => { void c.call("lock", {}).catch(() => undefined); };
    // Reading counts as activity too: the mouse wheel and scrolling (audit B-8).
    window.addEventListener("pointerdown", touch); window.addEventListener("keydown", touch); window.addEventListener("wheel", touch, { passive: true }); window.addEventListener("scroll", touch, { passive: true, capture: true }); window.addEventListener("pagehide", leaving);
    const hash = () => { const raw = location.hash.slice(1); setHash(raw); const match = sectionOfHash(raw); if (match) setSection(match); setError(""); };
    // A view that changes its own sub-page (an opened quote) rewrites the hash without a hashchange event.
    const subpage = () => setHash(location.hash.slice(1));
    hash(); window.addEventListener("hashchange", hash); window.addEventListener(SUBPAGE_EVENT, subpage);
    return () => { active = false; clearTimeout(startTimer); window.removeEventListener("pointerdown", touch); window.removeEventListener("keydown", touch); window.removeEventListener("wheel", touch); window.removeEventListener("scroll", touch, { capture: true }); window.removeEventListener("pagehide", leaving); window.removeEventListener("hashchange", hash); window.removeEventListener(SUBPAGE_EVENT, subpage); c.close(); client.current = null; };
  }, [scope.userId, scope.tenantId]);
  async function operation(work: () => Promise<void>) {
    setBusy(true); setError(""); setProgress(null);
    try { await work(); } catch (e) { setError(e instanceof Error && e.message ? e.message : msg("common.operationFailed")); try { setStatus(await client.current!.call("status", {})); } catch {} }
    finally { setBusy(false); setProgress(null); }
  }
  // 9.2: the page reads the worker's one phase value instead of combining flags.
  const unlocked = !!status && status.phase !== "none" && status.phase !== "locked", access = status?.access, caps = access?.caps ?? [], visible = access?.sections ?? [...sections], shown: Section = visible.includes(section) ? section : "Home";
  // Team sharing S5b: who may discuss shared data (Discuss buttons): sharing on (or the lab), the collaborate capability,
  // Professional or Scale. Before this device joins, the dialog says how to join.
  const discussAs = (relayEnabled || lab) && caps.includes("collaborate") && status?.licence?.tier !== "starter" && !!status?.licence?.tier ? scope.userId : null;
  const navItems = sections.filter(item => !unlocked || visible.includes(item));
  // Sub-pages per section (23 Nov 2026): the same role and tier rules as each view; Settings also lists the account pages.
  const navCtx = { caps, tier: status?.licence?.tier };
  const pagesOf = (s: Section) => [
    ...sectionPages(s, navCtx).map(p => ({ href: "#" + p.hash, hash: p.hash, label: t(p.label), testId: p.testId })),
    ...(s === "Settings" && !lab ? account.map(a => ({ href: a.href, hash: "", label: t(a.label), testId: undefined })) : []),
  ];
  // S3c: whether a write is read-only on this receiving seat (the same rule the worker enforces).
  const sharedLock = (action: import("@/lib/vault/protocol").Action) => lockedPacks(action, access?.shared ?? null).length > 0;
  const pages = pagesOf(shown), page = pageOfHash(hash, pages.filter(p => p.hash)) ?? "", pageInfo = pages.length > 1 ? pages.find(p => p.hash === page) : undefined;
  const sideItems: SideNavItem[] = navItems.map(item => ({ href: `#${SECTION_HASH[item]}`, label: t(SECTION_LABEL[item]), icon: SECTION_ICON[item], current: shown === item,
    children: pagesOf(item).map(p => ({ href: p.href, label: p.label, testId: p.testId, current: shown === item && !!p.hash && p.hash === page })) }));
  const navigate = (href: string) => { const s = href.startsWith("#") ? sectionOfHash(href) : null; if (s) setSection(s); setDrawer(false); };
  useEffect(() => {
    if (!unlocked || lab) { setWaiting(0); return; }
    let on = true;
    void waitingDevices().then(n => { if (on) setWaiting(n); }).catch(() => undefined);
    return () => { on = false; };
  }, [unlocked, lab]);
  // A failed action's red notice belongs to the page it happened on: changing page clears it.
  useEffect(() => { setError(""); }, [shown]);
  const locked = !unlocked;
  const signOut = !lab && <form className={sh.signout} method="post" action="/api/auth/logout" onSubmit={e => { const form = e.currentTarget; e.preventDefault(); void clearOfflineCopy().finally(() => form.submit()); }}><Button type="submit" variant="ghost" size="sm" icon="logout">{t("shell.signOut")}</Button></form>;
  const lock = () => void operation(async () => { setStatus(await client.current!.call("lock", {})); setPassphrase(""); setMessage(msg("shell.locked")); });
  const licenceLine = status?.licence && <p role="status" data-testid="licence-status" className={sh.licence} data-tone={status.licence.writable ? "ok" : "bad"}>
    <Icon name={status.licence.writable ? "shield" : "alert"} size={15}/>
    <span>{status.licence.writable?(t("shell.licensed", { tier: tierName(status.licence.tier) })+(status.licence.offline?t("shell.offlineGrace"):'')):t("shell.readOnly", { reason: say(status.licence.reason) })}{t("common.listSeparator")}<a href="/account/licence">{t("shell.licenceLink")}</a></span>
  </p>;
  return <GridTotalsProvider value={gridTotals}><div className={`${styles.shell} ${sh.frame}`} data-nav={collapsed ? "collapsed" : "open"} data-drawer={drawer ? "open" : "closed"} data-locked={locked ? "yes" : undefined}>
    <a className={sh.skip} href="#local-content">{t("shell.skip")}</a>
    {/* Until the vault is unlocked only the unlock card shows: no navigation, search or business screens (16 Nov 2026). */}
    {!locked && <aside className={sh.sidebar} id="app-sidebar" aria-label={t("shell.sidebar")}>
      <a href="/home" className={sh.brand}><span className={sh.mark} aria-hidden="true">{t("shell.brandMark")}</span><span className={sh.label}>{t("app.name")}</span></a>
      <SideNav label={t("shell.mainNav")} items={sideItems} collapsed={collapsed} onNavigate={navigate}/>
      <div className={sh.sideFoot}>
        <div className={sh.workspace}><strong translate="no">{workspace}</strong><span translate="no">{email}</span></div>
        <button type="button" className={sh.collapse} aria-pressed={collapsed} onClick={toggleNav}><Icon name="sidebar"/><span className={sh.label}>{t(collapsed ? "shell.expandNav" : "shell.collapseNav")}</span></button>
      </div>
    </aside>}
    {!locked && drawer && <button type="button" className={sh.scrim} aria-label={t("shell.closeMenu")} onClick={() => setDrawer(false)}/>}
    <div className={sh.main}>
      {!locked && <header className={sh.topbar}>
        <button type="button" className={sh.menuButton} aria-label={t("shell.menu")} aria-expanded={drawer} aria-controls="app-sidebar" onClick={() => setDrawer(true)}><Icon name="menu"/></button>
        <button type="button" className={sh.search} aria-label={t("shell.paletteButton")} aria-keyshortcuts="Control+K Meta+K" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}><Icon name="search" size={16}/><span className={sh.searchText}>{t("shell.searchLabel")}</span><kbd className={sh.kbd}>{t("shell.paletteShortcut")}</kbd></button>
        {/* V2 (23 Nov 2026): the vault summary is a chip in the top bar; the other counts open from it. The licence line stays
            visible, so a read-only licence is never hidden behind a click. */}
        {unlocked && status && <div className={sh.status}>
          <details className={sh.vaultInfo}>
            <summary title={t("shell.summaryLabel")}><Icon name="database" size={15}/><span data-testid="line-count" data-value={status.lines}>{fmt.int(status.lines)}</span><span>{t("shell.stat.lines")}</span></summary>
            <dl className={sh.summary} aria-label={t("shell.summaryLabel")}>
              <div><dt>{t("shell.stat.products")}</dt><dd>{fmt.int(status.products)}</dd></div>
              <div><dt>{t("shell.stat.customers")}</dt><dd>{fmt.int(status.customers)}</dd></div>
              <div><dt>{t("shell.stat.generation")}</dt><dd>{fmt.int(status.generation)}</dd></div>
            </dl>
          </details>
          {licenceLine}
          {waiting > 0 && <a href="/account/licence" data-testid="devices-waiting"><Badge tone="warn" icon="key">{t("shell.devicesWaiting", { count: waiting })}</Badge></a>}
        </div>}
        <div className={sh.tools}>
          <Preferences pseudo={lab} className={sh.prefs}/>
          {signOut}
        </div>
      </header>}
      {lab && <p className={sh.labNotice} role="note"><Icon name="flask" size={15}/><span>{t("shell.labNotice")}</span></p>}
      {unlocked && <CommandPalette client={client.current} caps={caps} tier={status?.licence?.tier} sections={navItems} storageKey={`rebatehq.palette.recent:${scope.tenantId}:${scope.userId}`} go={item => { setSection(item); location.hash = sectionHash(item); }} commands={{
        lock: unlocked ? lock : undefined,
        save: unlocked && status?.dirty ? () => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); }) : undefined,
      }}/>}
      <main id="local-content" className={sh.content} tabIndex={-1}><SharedLockProvider value={access?.shared}>
        {unlocked && shown === "Home" && <PageHeader eyebrow={<span translate="no">{workspace}</span>} title={homeInfo?.name ? t("home.welcome", { name: homeInfo.name }) : t("home.welcomeBack")}
          description={homeInfo && <span data-testid="role-banner">{t("home.yourRole", { roleLabel: homeInfo.role })}{t("common.listSeparator")}{homeInfo.owner ? t("home.pricingOwnerTheyApprove", { pricingOwner: homeInfo.owner }) : t("home.noPricingOwnerIs")}</span>}
          actions={<div className={hs.headerActions}><CreateNew items={[
            ...(caps.includes("quote") && visible.includes("Quotes") && status?.licence?.tier !== "starter" ? [{ href: "#quotes-new", label: t("home.create.quote"), icon: "quote" as const }] : []),
            ...(caps.includes("data") && visible.includes("Data Hub") ? [{ href: "#data-hub", label: t("home.create.import"), icon: "upload" as const }] : []),
            ...(caps.includes("pricing") && visible.includes("Pricing") ? [{ href: "#pricing-rules", label: t("home.create.rule"), icon: "tag" as const }] : []),
          ]}/><Button icon="lock" disabled={busy} onClick={lock}>{t("shell.lock")}</Button></div>}/>}
        {/* V1 (23 Nov 2026): "Section › Page" over the page's own name, in place of the row of tabs. */}
        {unlocked && shown !== "Home" && <PageHeader eyebrow={pageInfo ? <span className={sh.crumb} data-testid="breadcrumb">{t(SECTION_LABEL[shown])}<Icon name="chevronRight" size={12}/>{pageInfo.label}</span> : undefined}
          title={pageInfo ? pageInfo.label : t(SECTION_LABEL[shown])} description={t(SECTION_DESC[shown])} actions={<Button icon="lock" disabled={busy} onClick={lock}>{t("shell.lock")}</Button>}/>}
        <p role="status" aria-live="polite" className={sh.message}>{say(message)}</p>
        {/* V7 (23 Nov 2026): notices stack as one group under the header, each keeping its own action. */}
        <div className={sh.notices}>
          {!supported && <Notice data-testid="browser-support-notice" tone="warn">{t("shell.browserNotice")}</Notice>}
          {error && <Notice tone="bad" role="alert">{say(error)}</Notice>}
          {status?.phase === "preparing" && <Notice tone="info" data-testid="preparing">{t("shell.preparing")}</Notice>}
          {locking && unlocked && <Notice tone="warn" role="alert" data-testid="locking-soon" actions={<Button size="sm" variant="primary" onClick={() => { setLocking(false); void client.current?.call("touch", {}).catch(() => undefined); }}>{t("shell.stayUnlocked")}</Button>}>{t("shell.lockingSoon")}</Notice>}
          {status?.recovered && <Notice tone="warn">{t("shell.recovered")}</Notice>}
        </div>
        {progress && <div className={sh.progress}><label htmlFor="vault-progress">{say(progress.stage)}</label><progress id="vault-progress" value={Number(progress.done)} max={Math.max(1, Number(progress.total))}/>{progress.kind !== "save" && <Button size="sm" onClick={() => void client.current!.call("cancel", {})}>{t(progress.kind === "sim" ? "sim.cancel" : progress.kind === "check" ? "cadence.cancel" : "shell.cancelImport")}</Button>}</div>}
        {dead ? <section className={ui.card} role="alert" data-testid="worker-failed"><h2>{t("shell.workerFailed.title")}</h2><p>{t("shell.workerFailed.body")}</p><Button variant="primary" onClick={() => location.reload()}>{t("shell.workerFailed.reload")}</Button></section>
          : !status ? <section className={ui.card} aria-busy="true">{t("shell.startingWorker")}</section> : !unlocked ? <div className={sh.auth}>
          <section className={`${ui.card} ${sh.authCard}`} aria-labelledby="auth-heading">
            <p className={sh.authBrand}><span className={sh.mark} aria-hidden="true">{t("shell.brandMark")}</span><span>{t("app.name")}</span></p>
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
            {status.exists && client.current && <StartAgain client={client.current} workspace={workspace} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>}
            <p className={sh.authFoot}>{t("shell.autoLockNote")}</p>
          </section>
          <div className={sh.authAccount}><span translate="no">{email}</span>{signOut}</div>
          {/* Restoring only works into an empty vault, so the restore card is offered only before a vault exists. */}
          {client.current && !status.exists && <div className={sh.authSide}><BackupView client={client.current} busy={busy} operation={operation} unlocked={false} onStatus={setStatus}/></div>}
        </div> : <>
          <div className={sh.notices}>
            {access?.viewAs && <Notice tone="warn" role="status" data-testid="preview-banner" actions={<Button size="sm" disabled={busy} onClick={() => void operation(async () => { await client.current!.call("rolePreview", { role: null }); setStatus(await client.current!.call("status", {})); })}>{t("shell.returnView")}</Button>}>{t("shell.previewBanner", { role: say(access.roleLabel) })}</Notice>}
            {status.dirty && <Notice tone="bad" actions={<Button size="sm" onClick={() => void operation(async () => { setStatus(await client.current!.call("save", {})); setMessage(msg("shell.saved")); })}>{t("shell.retrySave")}</Button>}>{t("shell.unsaved")}</Notice>}
            {/* First-run activation (20 Nov 2026): while the Playground's sample files are loaded, every section says so. */}
            {(status.sample === "only" || status.sample === "mixed") && <Notice tone="info" data-testid="sample-banner" actions={caps.includes("data") ? <>
              {status.sample === "only" && visible.includes("Data Hub") && <ButtonLink size="sm" variant="primary" icon="upload" href="#data-hub">{t("shell.sample.import")}</ButtonLink>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void operation(async () => { const out = await client.current!.call("playgroundRemove", {}); setStatus(out.status); setMessage(msg("studio.removedPlaygroundFilesAnd", { count: Number(out.removed) })); })}>{t("shell.sample.remove")}</Button>
            </> : undefined}>{t(status.sample === "only" ? "shell.sample.only" : "shell.sample.mixed")}</Notice>}
          </div>
          {shown === "Home" && client.current && <HomeView sample={status.sample} client={client.current} userId={scope.userId} version={`${status.lines}|${status.generation}|${access?.role}`} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))} onHome={onHome}
            afterWork={caps.includes('collaborate') && status.licence?.tier !== 'starter' ? <RelayOnboarding client={client.current} userId={scope.userId} tenantId={scope.tenantId} relayEnabled={relayEnabled}/> : null}/>}
          {shown === "Home" && client.current && caps.includes("cost") && status.licence?.tier !== "starter" && <AgentsInbox client={client.current} version={`${status.lines}|${status.generation}`} canPrice={caps.includes("pricing")} busy={busy} operation={operation}/>}
          {shown === "Home" && client.current && caps.includes('collaborate') && status.licence?.tier!=='starter' && <RelayPanel client={client.current} userId={scope.userId} tenantId={scope.tenantId} relayEnabled={relayEnabled} onChange={async()=>setStatus(await client.current!.call('status',{}))}/>}
          {/* D1 (23 Nov 2026): Data Hub's sections are split over four sub-pages picked in the sidebar. */}
          {client.current && SHARED_SECTIONS[shown] && <SharedBanner client={client.current} packs={SHARED_SECTIONS[shown]!} version={`${status.lines}|${status.generation}`}/>}
          {shown === "Data Hub" && client.current && (page === "data-hub-import" || page === "data-hub-fix") && <ImportStudio part={page === "data-hub-fix" ? "fix" : "import"} client={client.current} status={status} caps={caps} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>}
          {shown === "Data Hub" && client.current && page === "data-hub-cleanup" && <>
            <CleanupView client={client.current} version={`${status.lines}|${status.generation}`} busy={busy || !!sharedLock("cleanupApply")} operation={operation} onStatus={setStatus} setMessage={setMessage}/>
            {caps.includes("cost") && <CostBasisView client={client.current} version={`${status.lines}|${status.generation}`} busy={busy} operation={operation} canChoose={caps.includes("data") && !sharedLock("costBasisSet")}/>}
          </>}
          {shown === "Data Hub" && client.current && page === "data-hub-records" && caps.includes("data") && <RecordsView client={client.current} version={`${status.lines}|${status.generation}`} discuss={discussAs}/>}
          {shown === "Data Hub" && page === "data-hub-import" && <>
            <details className={styles.card}><summary>{t("shell.columns.summary")}</summary>
              <p className={styles.small}><strong>{t("shell.columns.salesLabel")}</strong> <span translate="no">{t("shell.columns.sales")}</span></p>
              <p className={styles.small}><strong>{t("shell.columns.itemsLabel")}</strong> <span translate="no">{t("shell.columns.items")}</span> <strong>{t("shell.columns.customersLabel")}</strong> <span translate="no">{t("shell.columns.customers")}</span></p>
              <p className={styles.small}><strong>{t("shell.columns.vendorLabel")}</strong> <span translate="no">{t("shell.columns.vendor")}</span> <strong>{t("shell.columns.priceLabel")}</strong> <span translate="no">{t("shell.columns.price")}</span></p>
              <p className={styles.muted}>{t("shell.columns.note")}</p>
            </details>
          </>}
          {shown === "Margin" && client.current && <MarginView client={client.current} status={status} busy={busy} operation={operation} setMessage={setMessage} onStatus={setStatus} discuss={discussAs}/>}
          {shown === "Pricing" && client.current && <PricingView tier={status.licence?.tier??'starter'} client={client.current} userId={scope.userId} caps={caps} busy={busy} operation={operation} refresh={async()=>setStatus(await client.current!.call("status",{}))}/>}
          {shown === "Quotes" && client.current && <QuotesView client={client.current} userId={scope.userId} caps={caps} tier={status.licence?.tier} busy={busy} operation={operation} relayEnabled={relayEnabled}/>}
          {shown === "Vendors" && client.current && <VendorsView client={client.current} tier={status.licence?.tier} version={`${status.lines}|${status.generation}`} canImport={caps.includes("data")} canSimulate={caps.includes("pricing")} canPrice={caps.includes("pricing")} busy={busy} operation={operation}/>}
          {shown === "Rebates & Contracts" && client.current && <RebatesView client={client.current} discuss={discussAs} caps={caps} tier={status.licence?.tier} busy={busy} version={status.generation} operation={operation} refresh={async()=>setStatus(await client.current!.call("status",{}))}/>}
          {shown === "Reports" && client.current && <ReportsView client={client.current} caps={caps} tier={status.licence?.tier} busy={busy} version={`${status.lines}|${status.generation}`} operation={operation} refresh={async()=>setStatus(await client.current!.call("status",{}))}/>}
            {shown === "Reports" && caps.includes("cost") && client.current && <Card headingId="report-card-heading" title={t("shell.report.heading")} description={t("shell.report.body")}><LeakReportButton client={client.current} busy={busy || status.lines === "0"} operation={operation} setMessage={setMessage} onStatus={setStatus}/><ButtonLink variant="ghost" icon="search" href="#margin" data-testid="leak-choose-findings" onClick={() => setTimeout(() => scrollToHeading("leaks-heading"), 50)}>{t("shell.report.choose")}</ButtonLink></Card>}
          {shown === "Reports" && caps.includes("cost") && status.licence?.tier !== "starter" && client.current && <BenchmarksView client={client.current} version={`${status.lines}|${status.generation}`} busy={busy} operation={operation} pendingKey={`rebatehq.bench.withdrawPending:${scope.tenantId}:${scope.userId}`}/>}
          {shown === "Reports" && caps.includes("audit") && <Card headingId="audit-heading" title={t("shell.audit.heading")} description={t("shell.audit.body", { entries: Number(status.auditEntries), version: status.schemaVersion })}><Button variant="primary" icon="shield" disabled={busy} onClick={() => void operation(async () => { const result = await client.current!.call("verify", {}); if (!result.valid) throw new Error(msg("shell.audit.failed")); setMessage(msg("shell.audit.verified", { entries: Number(result.entries) })); })}>{t("shell.audit.button")}</Button> <AuditPackButton client={client.current!} busy={busy} operation={operation} setMessage={setMessage}/><p className={styles.muted}>{t("shell.audit.note")}</p><p className={styles.muted}>{t("auditpack.help")}</p></Card>}
          {/* D2 (23 Nov 2026): Settings is three sub-pages (general, security and storage, team); account pages follow in the sidebar. */}
          {shown === "Settings" && page === "settings-general" && <Card headingId="prefs-heading" title={t("shell.prefs.heading")} description={t("shell.prefs.body")}><Preferences pseudo={lab} className={styles.row}/><p>{t("fx.moneyNote", {code:status.currency})}</p></Card>}
          {shown === "Settings" && page === "settings-general" && client.current && <CurrencySettings client={client.current} status={status} busy={busy} operation={operation} onStatus={setStatus}/>}
          {shown === "Settings" && page === "settings-security" && client.current && caps.includes("backup") && <BackupView client={client.current} busy={busy} operation={operation} unlocked onStatus={setStatus}/>}
          {shown === "Settings" && page === "settings-security" && client.current && <PassphraseCard client={client.current} busy={busy} operation={operation} onStatus={setStatus} setMessage={setMessage}/>}
          {shown === "Settings" && page === "settings-team" && client.current && <RolesView client={client.current} busy={busy} operation={operation} team={team} refresh={async () => setStatus(await client.current!.call("status", {}))}>
            {caps.includes('collaborate') && status.licence?.tier !== 'starter' && <RelaySetupLine client={client.current} userId={scope.userId} tenantId={scope.tenantId} relayEnabled={relayEnabled}/>}
          </RolesView>}
          {shown === "Settings" && page === "settings-team" && client.current && status.licence?.tier !== "starter" && <ShareHandoff client={client.current} busy={busy} operation={operation} refresh={async () => setStatus(await client.current!.call("status", {}))}/>}
          {shown === "Settings" && page === "settings-team" && client.current && caps.includes("collaborate") && caps.includes("roles") && status.licence?.tier !== "starter" && <ShareGrid client={client.current} busy={busy} operation={operation}/>}
          {shown === "Settings" && page === "settings-general" && client.current && caps.includes("quote") && status.licence?.tier !== "starter" && <QuoteBranding client={client.current} busy={busy} operation={operation} canEdit={caps.includes("roles")}/>}
          {/* 8.17: used and available space as tiles in MB or GB, not byte counts. */}
          {shown === "Settings" && page === "settings-security" && <Card headingId="storage-heading" title={t("shell.storage.heading")} description={t("shell.storage.summary", { saved: status.lastSaved ? fmt.dateTime(status.lastSaved) : t("common.none") })}
            actions={status.licence?.writable&&status.tier!==status.licence.tier&&caps.includes('roles')?<Button disabled={busy} onClick={()=>void operation(async()=>{setStatus(await client.current!.call('capacityUpgrade',{}));setMessage(msg("shell.storage.upgraded"));})}>{t("shell.storage.upgrade")}</Button>:undefined}>
            <Grid min={180} data-testid="storage-tiles">
              <StatTile icon="database" label={t("shell.storage.used")} value={storage?.usage ? fmt.bytes(Number(storage.usage)) : t("common.unknown")} valueProps={{ "data-testid": "storage-used" }} hint={storage?.namedOpfsBytes ? t("shell.storage.vaultFiles", { size: fmt.bytes(Number(storage.namedOpfsBytes)) }) : undefined}/>
              <StatTile icon="download" label={t("shell.storage.available")} value={storage?.quota ? fmt.bytes(Math.max(0, Number(storage.quota) - Number(storage.usage ?? 0))) : t("common.unknown")} valueProps={{ "data-testid": "storage-available" }} hint={storage?.quota ? t("shell.storage.ofQuota", { size: fmt.bytes(Number(storage.quota)) }) : undefined}/>
              <StatTile icon="shield" tone={storage?.persistent ? "ok" : "warn"} label={t("shell.storage.persistenceLabel")} value={storage ? t(storage.persistent ? "shell.storage.granted" : "shell.storage.notGranted") : t("common.unknown")} valueProps={{ "data-testid": "storage-persistence" }}/>
            </Grid>
            <Button variant="primary" onClick={() => void operation(async () => { await navigator.storage.persist(); setStorage(await client.current!.call("storage", {})); setMessage(msg("shell.storage.refreshed")); })}>{t("shell.storage.request")}</Button>
            <p className={styles.muted}>{t("shell.storage.note")}</p>{!lab && <p><a href="/account/users">{t("shell.storage.team")}</a>{t("common.listSeparator")}<a href="/account/workspace">{t("shell.storage.workspace")}</a></p>}</Card>}
          {shown === "Settings" && page === "settings-general" && <GlossaryCard/>}
          {shown === "Settings" && page === "settings-security" && <OfflineCard licenceUntil={status.licence?.offline && status.licence.until ? new Date(Number(status.licence.until)).toISOString() : null}/>}
        </>}
      </SharedLockProvider></main>
    </div>
  </div></GridTotalsProvider>;
}
