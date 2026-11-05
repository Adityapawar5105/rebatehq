"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { HomeData } from "@/lib/vault/protocol";
import { fmt, msg, say, t } from "@/lib/i18n";
import { Term } from "./Glossary";
import styles from "./vault.module.css";
const money = (cents: string) => fmt.money(cents);
/** Home: who you are here, the 7-day setup checklist, the ROI tracker and the numbers your role may see. */
export function HomeView({ client, userId, version, busy, operation, refresh }: { client: VaultClient; userId: string; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [home, setHome] = useState<HomeData | null>(null), [owner, setOwner] = useState(""), [note, setNote] = useState("");
  const load = async () => setHome(await client.call("home", {}));
  useEffect(() => { let on = true; void client.call("home", {}).then(h => { if (on) setHome(h); }).catch(() => { if (on) setNote(msg("home.couldNotLoadHome")); }); return () => { on = false; }; }, [client, version]);
  if (!home) return <section className={styles.card} aria-busy="true"><p role="status">{say(note) || t("home.loadingYourHome")}</p></section>;
  const { access, checklist: list } = home, has = (c: string) => access.caps.some(x => x === c);
  return <>
    <section className={styles.card} aria-labelledby="role-heading" data-testid="role-banner">
      <h2 id="role-heading">{t("home.yourRole", { roleLabel: access.roleLabel })}</h2>
      {access.viewAs && <p className={styles.warning}>{t("home.previewingTheViewYou", { roleLabel: access.roleLabel })}</p>}
      {!access.assigned && <p className={styles.warning}>{t("home.youHaveNoRole")}</p>}
      <p className={styles.muted}>{home.pricingOwner ? t("home.pricingOwnerTheyApprove", { pricingOwner: home.pricingOwner }) : t("home.noPricingOwnerIs")}</p>
      {!home.pricingOwner && has("roles") && <div className={styles.warning} role="group" aria-label={t("home.nameThePricingOwner2")}>
        <p><strong>{t("home.required")}</strong>{" "}{t("home.nameThePricingOwner")}</p>
        <label>{t("home.pricingOwnerName")}<input value={owner} maxLength={160} onChange={e => setOwner(e.target.value)} /></label>
        <button className={styles.primary} disabled={busy || !owner.trim()} onClick={() => void operation(async () => { await client.call("pricingOwner", { name: owner, userId, backupDays: 7 }); setOwner(""); await load(); await refresh(); })}>{t("home.nameMeAsPricing")}</button>
      </div>}
    </section>
    <section className={styles.card} aria-labelledby="setup-heading" data-testid="setup-checklist">
      <h2 id="setup-heading">{t("home.your7DaySetup")}</h2>
      <p>{t("home.day2", { day: Math.min(list.day, 99) })}{" "}<strong data-testid="setup-progress-text">{t("home.ofStepsDone", { done: Number(list.done), total: Number(list.total) })}</strong></p>
      <progress value={list.done} max={list.total} aria-label={t("home.setupProgress")}>{list.done}/{list.total}</progress>
      <ol>{list.steps.map(s => <li key={s.step} data-testid={`setup-${s.step}`} data-done={s.done ? "yes" : "no"}>
        <strong>{s.done ? t("home.done") : t("home.toDo")}</strong> · {say(s.label)} <span className={styles.muted}>{t("home.day", { day: s.day })}</span>
        {!s.done && <> <span className={styles.small}>{say(s.hint)}</span> <a href={s.where}>{t("home.go")}</a>{s.manual && has("roles") && <> <button disabled={busy} onClick={() => void operation(async () => { await client.call("checklistMark", { step: s.step }); await load(); await refresh(); })}>{t("home.markDone")}</button></>}</>}
        {s.done && s.doneAt && <span className={styles.small}> {t(s.how === "manual" ? "home.markedByHand" : "home.detected", { date: fmt.date(s.doneAt.slice(0, 10)) })}</span>}
      </li>)}</ol>
      {list.complete && <p role="status"><strong>{t("home.setupComplete")}</strong>{" "}{t("home.yourPricingWorkflowIs")}</p>}
      <p className={styles.muted}>{t("home.progressIsStoredIn")}</p>
    </section>
    {home.roi && <section className={styles.card} aria-labelledby="roi-heading">
      <h2 id="roi-heading"><Term id="roi">{t("home.roiTracker")}</Term></h2>
      <p>{t("home.leakDollarsFoundSo")}{" "}<strong data-testid="roi-total">{money(home.roi.identifiedCents)}</strong>{" "}{t(home.roi.since ? "home.acrossFindingsSince" : "home.acrossFindings", { count: Number(home.roi.findings), since: fmt.date(home.roi.since?.slice(0, 10)) })}</p>
      {home.roi.sampleFindings !== "0" && <p className={styles.small}>{t("home.playgroundSampleFindingsAre", { sampleCents: money(home.roi.sampleCents) })}</p>}
      {home.roi.updated && <p className={styles.small}>{t("home.lastUpdated", { updated: fmt.date(home.roi.updated.slice(0, 10)) })}</p>}
      <p className={styles.muted}>{t("home.aRunningTotalOf")}</p>
      <a href="#margin">{t("home.openMargin")}</a>
    </section>}
    <section className={styles.card} aria-labelledby="role-view-heading" data-testid="role-view">
      <h2 id="role-view-heading">{t("home.whatMattersForYour")}</h2>
      <dl className={styles.totals}>
        {home.margin && <><div><dt><Term id="netPocket">{t("home.netPocket")}</Term></dt><dd>{money(home.margin.netPocket)}</dd></div><div><dt><Term id="pocketMargin">{t("home.pocketMargin")}</Term></dt><dd data-testid="home-margin">{money(home.margin.margin)} · {fmt.percent(home.margin.rate)}</dd></div><div><dt>{t("home.linesWithoutCost")}</dt><dd>{fmt.int(home.margin.uncostedLines)}</dd></div></>}
        {home.openFixLater !== undefined && <div><dt>{t("home.rejectedRowsInFix")}</dt><dd>{fmt.int(home.openFixLater)}</dd></div>}
        {home.previews !== undefined && <div><dt>{t("home.pricePreviewsAwaitingApproval")}</dt><dd>{fmt.int(home.previews)}</dd></div>}
        {home.rules !== undefined && <div><dt>{t("home.pricingRules")}</dt><dd>{fmt.int(home.rules)}</dd></div>}
        {home.openRecon !== undefined && <div><dt>{t("home.openReconciliationDifferences")}</dt><dd>{fmt.int(home.openRecon)}</dd></div>}
        <div><dt><Term id="guardrail">{t("home.priceGuardrailsFloorsAnd")}</Term></dt><dd>{fmt.int(home.guardrails)}</dd></div>
      </dl>
      {!has("cost") && <p className={styles.muted}>{t("home.costAndMarginAre")}</p>}
    </section>
  </>;
}
