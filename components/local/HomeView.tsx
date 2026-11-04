"use client";
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { HomeData } from "@/lib/vault/protocol";
import { centsText } from "@/lib/margin/decimal";
import styles from "./vault.module.css";
const money = (cents: string) => centsText(BigInt(cents));
/** Home: who you are here, the 7-day setup checklist, the ROI tracker and the numbers your role may see. */
export function HomeView({ client, userId, version, busy, operation, refresh }: { client: VaultClient; userId: string; version: string; busy: boolean; operation: (f: () => Promise<void>) => Promise<void>; refresh: () => Promise<void> }) {
  const [home, setHome] = useState<HomeData | null>(null), [owner, setOwner] = useState(""), [note, setNote] = useState("");
  const load = async () => setHome(await client.call("home", {}));
  useEffect(() => { let on = true; void client.call("home", {}).then(h => { if (on) setHome(h); }).catch(() => { if (on) setNote("Could not load Home. Reopen it to retry."); }); return () => { on = false; }; }, [client, version]);
  if (!home) return <section className={styles.card} aria-busy="true"><p role="status">{note || "Loading your Home…"}</p></section>;
  const { access, checklist: list } = home, has = (c: string) => access.caps.some(x => x === c);
  return <>
    <section className={styles.card} aria-labelledby="role-heading" data-testid="role-banner">
      <h2 id="role-heading">Your role: {access.roleLabel}</h2>
      {access.viewAs && <p className={styles.warning}>Previewing the {access.roleLabel} view. You see only what that role sees. Use "Return to my own view" above to leave the preview.</p>}
      {!access.assigned && <p className={styles.warning}>You have no role in this vault yet, so you have the Sales Rep view. Ask an Owner to assign one.</p>}
      <p className={styles.muted}>{home.pricingOwner ? `Pricing Owner: ${home.pricingOwner}. They approve every price change.` : "No Pricing Owner is named yet."}</p>
      {!home.pricingOwner && has("roles") && <div className={styles.warning} role="group" aria-label="Name the Pricing Owner">
        <p><strong>Required:</strong> name the Pricing Owner before changing prices. That person approves every price change.</p>
        <label>Pricing Owner name<input value={owner} maxLength={160} onChange={e => setOwner(e.target.value)} /></label>
        <button className={styles.primary} disabled={busy || !owner.trim()} onClick={() => void operation(async () => { await client.call("pricingOwner", { name: owner, userId, backupDays: 7 }); setOwner(""); await load(); await refresh(); })}>Name me as Pricing Owner</button>
      </div>}
    </section>
    <section className={styles.card} aria-labelledby="setup-heading" data-testid="setup-checklist">
      <h2 id="setup-heading">Your 7-day setup</h2>
      <p>Day {Math.min(list.day, 99)} · <strong data-testid="setup-progress-text">{list.done} of {list.total} steps done</strong></p>
      <progress value={list.done} max={list.total} aria-label="Setup progress">{list.done}/{list.total}</progress>
      <ol>{list.steps.map(s => <li key={s.step} data-testid={`setup-${s.step}`} data-done={s.done ? "yes" : "no"}>
        <strong>{s.done ? "✓ Done" : "○ To do"}</strong> · {s.label} <span className={styles.muted}>(day {s.day})</span>
        {!s.done && <> <span className={styles.small}>{s.hint}</span> <a href={s.where}>Go</a>{s.manual && has("roles") && <> <button disabled={busy} onClick={() => void operation(async () => { await client.call("checklistMark", { step: s.step }); await load(); await refresh(); })}>Mark done</button></>}</>}
        {s.done && s.doneAt && <span className={styles.small}> {s.how === "manual" ? "marked by hand" : "detected"} {s.doneAt.slice(0, 10)}</span>}
      </li>)}</ol>
      {list.complete && <p role="status"><strong>Setup complete.</strong> Your pricing workflow is running end to end.</p>}
      <p className={styles.muted}>Progress is stored in your encrypted vault on this device. Sample (Playground) data never counts.</p>
    </section>
    {home.roi && <section className={styles.card} aria-labelledby="roi-heading">
      <h2 id="roi-heading">ROI tracker</h2>
      <p>Leak dollars found so far: <strong data-testid="roi-total">{money(home.roi.identifiedCents)}</strong> across {home.roi.findings} findings{home.roi.since ? ` since ${home.roi.since.slice(0, 10)}` : ""}.</p>
      {home.roi.sampleFindings !== "0" && <p className={styles.small}>Playground sample findings ({money(home.roi.sampleCents)}) are kept apart and never counted.</p>}
      {home.roi.updated && <p className={styles.small}>Last updated {home.roi.updated.slice(0, 10)}.</p>}
      <p className={styles.muted}>A running total of the leaks the finder has identified in your data. These are findings, not recovered money: “recovered” is tracked from Phase 2, once price changes are recorded.</p>
      <a href="#margin">Open Margin</a>
    </section>}
    <section className={styles.card} aria-labelledby="role-view-heading" data-testid="role-view">
      <h2 id="role-view-heading">What matters for your role</h2>
      <dl className={styles.totals}>
        {home.margin && <><div><dt>Net pocket</dt><dd>{money(home.margin.netPocket)}</dd></div><div><dt>Pocket margin</dt><dd data-testid="home-margin">{money(home.margin.margin)} · {home.margin.rate}</dd></div><div><dt>Lines without cost</dt><dd>{home.margin.uncostedLines}</dd></div></>}
        {home.openFixLater !== undefined && <div><dt>Rejected rows in Fix Later</dt><dd>{home.openFixLater}</dd></div>}
        {home.previews !== undefined && <div><dt>Price previews awaiting approval</dt><dd>{home.previews}</dd></div>}
        {home.rules !== undefined && <div><dt>Pricing rules</dt><dd>{home.rules}</dd></div>}
        {home.openRecon !== undefined && <div><dt>Open reconciliation differences</dt><dd>{home.openRecon}</dd></div>}
        <div><dt>Price guardrails (floors and targets)</dt><dd>{home.guardrails}</dd></div>
      </dl>
      {!has("cost") && <p className={styles.muted}>Cost and margin are not shown to this role.</p>}
    </section>
  </>;
}
