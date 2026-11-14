"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { HomeData } from "@/lib/vault/protocol";
import { fmt, msg, say, t } from "@/lib/i18n";
import { Button, ButtonLink, Card, Field, Grid, Notice, Skeleton, StatTile } from "@/components/ui/ui";
import { Term } from "./Glossary";
import {HomeMonitor} from './HomeMonitor';
import styles from "./vault.module.css";
const money = (cents: string) => fmt.currency(cents);
/** Home: who you are here, the numbers your role may see, the cash leak and customer health headline, and the ROI tracker.
 * The 7-day setup checklist was removed from Home on 14 Nov 2026 at the user's request (blueprint section 22). */
export function HomeView({ client, userId, version, busy, operation, refresh }: { client: VaultClient; userId: string; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [home, setHome] = useState<HomeData | null>(null), [owner, setOwner] = useState(""), [note, setNote] = useState("");
  const load = async () => setHome(await client.call("home", {}));
  useEffect(() => { let on = true; void client.call("home", {}).then(h => { if (on) setHome(h); }).catch(() => { if (on) setNote(msg("home.couldNotLoadHome")); }); return () => { on = false; }; }, [client, version]);
  if (!home) return <Card aria-busy="true"><p role="status" className={styles.muted}>{say(note) || t("home.loadingYourHome")}</p><Skeleton lines={4}/></Card>;
  const { access } = home, has = (c: string) => access.caps.some(x => x === c);
  return <>
    <Card headingId="role-heading" title={t("home.yourRole", { roleLabel: access.roleLabel })} description={home.pricingOwner ? t("home.pricingOwnerTheyApprove", { pricingOwner: home.pricingOwner }) : t("home.noPricingOwnerIs")} data-testid="role-banner">
      {access.viewAs && <Notice tone="warn">{t("home.previewingTheViewYou", { roleLabel: access.roleLabel })}</Notice>}
      {!access.assigned && <Notice tone="warn">{t("home.youHaveNoRole")}</Notice>}
      {!home.pricingOwner && has("roles") && <Notice tone="warn" role="group" aria-label={t("home.nameThePricingOwner2")} title={t("home.required")}>
        <p>{t("home.nameThePricingOwner")}</p>
        <Field label={t("home.pricingOwnerName")}><input value={owner} maxLength={160} onChange={e => setOwner(e.target.value)}/></Field>
        <Button variant="primary" disabled={busy || !owner.trim()} onClick={() => void operation(async () => { await client.call("pricingOwner", { name: owner, userId, backupDays: 7 }); setOwner(""); await load(); await refresh(); })}>{t("home.nameMeAsPricing")}</Button>
      </Notice>}
    </Card>
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
