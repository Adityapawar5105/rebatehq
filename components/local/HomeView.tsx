"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { HomeData } from "@/lib/vault/protocol";
import type { QuoteSummary } from "@/lib/quotes/quotes";
import { fmt, msg, say, t } from "@/lib/i18n";
import { Badge, Button, ButtonLink, Card, Field, Grid, Notice, Skeleton, StatTile, type Tone } from "@/components/ui/ui";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Term } from "./Glossary";
import {HomeMonitor} from './HomeMonitor';
import styles from "./vault.module.css";
import hs from "./home.module.css";
import ui from "@/components/ui/ui.module.css";
const money = (cents: string) => fmt.currency(cents);

/** One row in the Home work list: a link to the screen where the work is done. Never cost or margin. */
type WorkItem = { id: string; icon: IconName; title: string; subtitle: string; badge: string; tone: Tone; href: string; at: string | null };
type Run = { id: string; rule: string; affected: string; at: string };
const isToday = (at: string | null) => !!at && new Date(at).toDateString() === new Date().toDateString();
const newest = (a: WorkItem, b: WorkItem) => (b.at ?? "").localeCompare(a.at ?? "");

/** "Your drafts" and "Action required", built only from reads the role already has: quotes, price previews and the Home counts. */
function workLists(home: HomeData, quotes: QuoteSummary[], runs: Run[], userId: string, approver: boolean) {
  const has = (c: string) => home.access.caps.some(x => x === c), drafts: WorkItem[] = [], action: WorkItem[] = [];
  const quote = (q: QuoteSummary, badge: string, tone: Tone): WorkItem => ({ id: "quote:" + q.id, icon: "quote", title: t("home.work.quote", { number: q.number }), subtitle: q.customerName || q.customerId, badge, tone, href: "#quotes-open-" + encodeURIComponent(q.id), at: q.updatedAt });
  for (const q of quotes) {
    const mine = q.createdBy === userId;
    if (mine && q.status === "draft") drafts.push(quote(q, t("home.badge.draft"), "info"));
    else if (mine && q.status === "rejected") action.push(quote(q, t("home.badge.rejected"), "bad"));
    else if (mine && q.status === "pending") action.push(quote(q, t("home.badge.awaiting"), "info")); // the author's own exception, until someone decides or they withdraw it
    else if (!mine && q.status === "pending" && has("quoteApprove")) action.push(quote(q, t("home.badge.toApprove"), "warn"));
  }
  for (const r of runs) action.push({ id: "run:" + r.id, icon: "tag", title: r.rule ? t("home.work.preview", { rule: r.rule }) : t("home.work.previewUnnamed"), subtitle: t("home.work.previewRows", { count: Number(r.affected) }), // Only the named Pricing Owner approves price changes; everyone else sees that the preview is waiting on them.
    badge: t(approver ? "home.badge.toApprove" : "home.badge.awaiting"), tone: approver ? "warn" : "info", href: "#pricing-rules", at: r.at || null });
  if (home.openFixLater && home.openFixLater !== "0") action.push({ id: "fix", icon: "inbox", title: t("home.rejectedRowsInFix"), subtitle: t("home.work.rows", { count: Number(home.openFixLater) }), badge: t("home.badge.toFix"), tone: "warn", href: "#data-hub", at: null });
  if (home.openRecon && home.openRecon !== "0") action.push({ id: "recon", icon: "report", title: t("home.openReconciliationDifferences"), subtitle: t("home.work.open", { count: Number(home.openRecon) }), badge: t("home.badge.review"), tone: "info", href: "#data-hub", at: null });
  if (home.margin && home.margin.uncostedLines !== "0") action.push({ id: "uncosted", icon: "alert", title: t("home.linesWithoutCost"), subtitle: t("home.work.rows", { count: Number(home.margin.uncostedLines) }), badge: t("home.badge.toFix"), tone: "warn", href: "#data-hub", at: null });
  return { drafts: drafts.sort(newest), action: action.sort(newest) };
}

/** The tabbed work list at the top of Home, newest first and grouped by day. */
function WorkTabs({ drafts, action }: { drafts: WorkItem[]; action: WorkItem[] }) {
  const [tab, setTab] = useState<"drafts" | "action">(drafts.length || !action.length ? "drafts" : "action");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [{ id: "drafts" as const, label: t("home.tab.drafts"), items: drafts }, { id: "action" as const, label: t("home.tab.action"), items: action }];
  const keys = (e: KeyboardEvent<HTMLButtonElement>, i: number) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; e.preventDefault(); const next = (i + 1) % tabs.length; setTab(tabs[next].id); refs.current[next]?.focus(); };
  const items = tabs.find(x => x.id === tab)!.items, today = items.filter(i => isToday(i.at)), earlier = items.filter(i => !isToday(i.at));
  const list = (rows: WorkItem[]) => <ul className={hs.list}>{rows.map(i => <li key={i.id}><a href={i.href} className={hs.item} data-testid="home-work-item">
    <span className={hs.itemIcon} aria-hidden="true"><Icon name={i.icon}/></span>
    <span className={hs.itemText}><strong translate="no">{i.title}</strong><span translate="no">{i.subtitle}</span></span>
    <Badge tone={i.tone}>{i.badge}</Badge>
  </a></li>)}</ul>;
  return <section className={hs.work} aria-labelledby="home-work-heading" data-testid="home-work">
    <h2 id="home-work-heading" className={styles.srOnly}>{t("home.work.heading")}</h2>
    <div role="tablist" aria-label={t("home.work.heading")} className={hs.tabs}>
      {tabs.map((x, i) => <button key={x.id} ref={el => { refs.current[i] = el; }} type="button" role="tab" id={`home-tab-${x.id}`} aria-selected={tab === x.id} aria-controls="home-work-panel" tabIndex={tab === x.id ? 0 : -1} className={hs.tab} onClick={() => setTab(x.id)} onKeyDown={e => keys(e, i)} data-testid={`home-tab-${x.id}`}>
        <span className={hs.tabLabel}>{x.label}</span><span className={hs.tabCount}>{t("home.work.count", { count: x.items.length })}</span>
      </button>)}
    </div>
    <div role="tabpanel" id="home-work-panel" aria-labelledby={`home-tab-${tab}`} className={hs.panel} tabIndex={0}>
      {!items.length && <p className={hs.empty}>{t(tab === "drafts" ? "home.work.emptyDrafts" : "home.work.emptyAction")}</p>}
      {!!today.length && <><h3 className={hs.day}>{t("home.work.today")}</h3>{list(today)}</>}
      {!!earlier.length && <><h3 className={hs.day}>{t(today.length ? "home.work.earlier" : "home.work.recent")}</h3>{list(earlier)}</>}
    </div>
  </section>;
}

/** "Create new" in the Home header: links to where each kind of work starts, only those the role can do. */
export function CreateNew({ items }: { items: { href: string; label: string; icon: IconName }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    window.addEventListener("pointerdown", away); return () => window.removeEventListener("pointerdown", away);
  }, []);
  if (!items.length) return null;
  const close = () => { if (ref.current) ref.current.open = false; };
  return <details ref={ref} className={hs.create} data-testid="home-create" onKeyDown={e => { if (e.key === "Escape" && ref.current?.open) { e.stopPropagation(); close(); ref.current.querySelector("summary")?.focus(); } }}>
    <summary className={`${ui.btn} ${ui.primary}`}><Icon name="plus" size={17}/>{t("home.create.button")}</summary>
    <ul className={hs.menu}>{items.map(i => <li key={i.href}><a href={i.href} onClick={close}><Icon name={i.icon} size={16}/>{i.label}</a></li>)}</ul>
  </details>;
}

/** Home: a greeting (in the page header), the work that is yours or waits on you, the numbers your role may see, and the ROI tracker.
 * The 7-day setup checklist was removed from Home on 14 Nov 2026, and the greeting + work tabs layout replaced the role card
 * on 15 Nov 2026, both at the user's request (blueprint section 22). */
export function HomeView({ client, userId, version, busy, operation, refresh, onHome }: { client: VaultClient; userId: string; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; onHome?: (home: HomeData) => void }) {
  const [home, setHome] = useState<HomeData | null>(null), [owner, setOwner] = useState(""), [note, setNote] = useState("");
  const [work, setWork] = useState<{ drafts: WorkItem[]; action: WorkItem[] } | null>(null);
  const load = async () => setHome(await client.call("home", {}));
  useEffect(() => { let on = true; void client.call("home", {}).then(h => { if (on) setHome(h); }).catch(() => { if (on) setNote(msg("home.couldNotLoadHome")); }); return () => { on = false; }; }, [client, version]);
  useEffect(() => { if (home) onHome?.(home); }, [home, onHome]);
  useEffect(() => {
    if (!home) return;
    let on = true; const has = (c: string) => home.access.caps.some(x => x === c);
    // Quotes need Professional or Scale (the worker refuses them on Starter): a refused read only leaves that part out.
    void Promise.all([
      has("quote") ? client.call("quoteList", {}).catch(() => [] as QuoteSummary[]) : Promise.resolve([] as QuoteSummary[]),
      has("pricing") ? client.call("pricingState", {}).catch(() => null) : Promise.resolve(null),
    ]).then(([quotes, state]) => {
      if (!on) return;
      const names = new Map((state?.rules ?? []).map(r => [String(r.id), String(r.name)]));
      const runs = (state?.runs ?? []).filter(r => r.status === "preview").map(r => ({ id: String(r.id), rule: names.get(String(r.rule_id)) ?? "", affected: String(r.affected), at: String(r.run_date ?? "") }));
      setWork(workLists(home, quotes, runs, userId, state?.owner?.id === userId));
    });
    return () => { on = false; };
  }, [client, home, userId]);
  if (!home) return <Card aria-busy="true"><p role="status" className={styles.muted}>{say(note) || t("home.loadingYourHome")}</p><Skeleton lines={4}/></Card>;
  const { access } = home, has = (c: string) => access.caps.some(x => x === c);
  return <>
    {access.viewAs && <Notice tone="warn">{t("home.previewingTheViewYou", { roleLabel: access.roleLabel })}</Notice>}
    {!access.assigned && <Notice tone="warn">{t("home.youHaveNoRole")}</Notice>}
    {!home.pricingOwner && has("roles") && <Notice tone="warn" role="group" aria-label={t("home.nameThePricingOwner2")} title={t("home.required")}>
      <p>{t("home.nameThePricingOwner")}</p>
      <Field label={t("home.pricingOwnerName")}><input value={owner} maxLength={160} onChange={e => setOwner(e.target.value)}/></Field>
      <Button variant="primary" disabled={busy || !owner.trim()} onClick={() => void operation(async () => { await client.call("pricingOwner", { name: owner, userId, backupDays: 7 }); setOwner(""); await load(); await refresh(); })}>{t("home.nameMeAsPricing")}</Button>
    </Notice>}
    {work ? <WorkTabs key={version} drafts={work.drafts} action={work.action}/> : <Card aria-busy="true"><Skeleton lines={3}/></Card>}
    <Card headingId="role-view-heading" title={t("home.whatMattersForYour")} data-testid="role-view">
      <Grid min={190}>
        {home.margin && <>
          <StatTile wide icon="coins" label={<Term id="netPocket">{t("home.netPocket")}</Term>} value={money(home.margin.netPocket)}/>
          <StatTile wide icon="trend" tone="ok" label={<Term id="pocketMargin">{t("home.pocketMargin")}</Term>} value={money(home.margin.margin)} hint={fmt.percent(home.margin.rate)} valueProps={{ "data-testid": "home-margin" }}/>
          <StatTile icon="alert" tone={home.margin.uncostedLines === "0" ? undefined : "warn"} label={t("home.linesWithoutCost")} value={fmt.int(home.margin.uncostedLines)}/>
        </>}
        {home.openFixLater !== undefined && <StatTile icon="inbox" tone={home.openFixLater === "0" ? undefined : "warn"} label={t("home.rejectedRowsInFix")} value={fmt.int(home.openFixLater)}/>}
        {home.previews !== undefined && <StatTile icon="tag" label={t("home.pricePreviewsAwaitingApproval")} value={fmt.int(home.previews)}/>}
        {home.rules !== undefined && <StatTile icon="sparkle" label={t("home.pricingRules")} value={fmt.int(home.rules)}/>}
        {home.openRecon !== undefined && <StatTile icon="report" label={t("home.openReconciliationDifferences")} value={fmt.int(home.openRecon)}/>}
        <StatTile icon="shield" label={<Term id="guardrail">{t("home.priceGuardrailsFloorsAnd")}</Term>} value={fmt.int(home.guardrails)}/>
      </Grid>
      {!has("cost") && <p className={styles.muted}>{t("home.costAndMarginAre")}</p>}
    </Card>
    {has('cost')&&<HomeMonitor client={client} version={version}/>}
    {home.roi && <Card headingId="roi-heading" title={<Term id="roi">{t("home.roiTracker")}</Term>} description={t("home.aRunningTotalOf")} actions={<ButtonLink href="#margin" icon="chart">{t("home.openMargin")}</ButtonLink>}>
      <StatTile icon="coins" tone="ok" label={t("home.leakDollarsFoundSo")} value={money(home.roi.identifiedCents)} valueProps={{ "data-testid": "roi-total" }}
        hint={t(home.roi.since ? "home.acrossFindingsSince" : "home.acrossFindings", { count: Number(home.roi.findings), since: fmt.date(home.roi.since?.slice(0, 10)) })}/>
      {home.roi.sampleFindings !== "0" && <p className={styles.small}>{t("home.playgroundSampleFindingsAre", { sampleCents: money(home.roi.sampleCents) })}</p>}
      {home.roi.updated && <p className={styles.small}>{t("home.lastUpdated", { updated: fmt.date(home.roi.updated.slice(0, 10)) })}</p>}
    </Card>}
  </>;
}
