"use client";
// Chunk 8B-1 (blueprint v2.6 gap 1): the Margin Drain agents on Home. The checks run in the vault worker on the saved
// schedule while RebateHQ is open, and right away when one is overdue at opening; the card says so plainly and never
// suggests a server-side service. Inbox is a worker grid on the grid standard.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import type { Rule } from "@/lib/agents/agents";
import { minorUnits } from "@/lib/spike/exact";
import { basisPointsDecimal } from "@/lib/margin/decimal";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import { Button, Card, EmptyState, Field, Grid, Notice, Skeleton, StatTile } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

const RULE: Record<Rule, MessageKey> = { leak: "agents.rule.leak", below_floor: "agents.rule.belowFloor", contract_expiry: "agents.rule.expiry", cost_rise: "agents.rule.costRise", customer_health: "agents.rule.health", index_trigger: "agents.rule.index" };
const STATUS: Record<string, MessageKey> = { new: "agents.status.new", read: "agents.status.read", dismissed: "agents.status.dismissed", resolved: "agents.status.resolved" };
const pct = (bp: string | undefined) => !bp ? t("common.unknown") : fmt.percent(basisPointsDecimal(BigInt(bp)));
const money = (c: string | undefined | null) => !c ? t("common.unknown") : fmt.currency(c);
type Row = Results["agentRows"]["rows"][number];
/** One finding as a sentence in the user's language. */
function what(r: Row) {
  const d = r.detail;
  switch (r.rule) {
    case "leak": return say(d.title);
    case "below_floor": return t("agents.what.belowFloor", { product: d.product || d.category, tier: d.tier, price: money(d.price), floor: money(d.floor) }) + (d.customer ? " " + t("agents.what.forCustomer", { customer: d.customer }) : "");
    case "contract_expiry": return t("agents.what.expiry", { product: d.product || d.category, who: d.customer || d.tier, date: fmt.date(d.validTo), price: money(d.price) });
    case "cost_rise": return t("agents.what.costRise", { vendor: d.vendor, product: d.product, before: money(d.previous), after: money(d.latest), change: pct(d.riseBp), date: fmt.date(d.date) });
    case "customer_health": return [d.marginDrop === "true" ? t("agents.what.marginDrop", { before: pct(d.beforeRate), after: pct(d.afterRate) }) : "", d.frequencyDrop === "true" ? t("agents.what.fewerOrders", { before: fmt.int(d.beforeOrders), after: fmt.int(d.afterOrders) }) : ""].filter(Boolean).join(" ");
    case "index_trigger": return t("agents.what.index", { index: d.index, change: pct(d.indexChangeBp || "0"), cost: pct(d.costChangeBp), scope: d.value, skus: fmt.int(d.skus) });
  }
}
const INTERVALS = [15, 30, 60, 120, 240, 1440];

export function AgentsInbox({ client, version, canPrice, busy, operation }: { client: VaultClient; version: string; canPrice: boolean; busy: boolean; operation: (work: () => Promise<void>) => Promise<void> }) {
  const [state, setState] = useState<Results["agentState"] | null>(null), [page, setPage] = useState<Results["agentRows"] | null>(null), [error, setError] = useState("");
  const [query, setQuery] = useState<GridQuery>({ filters: [{ col: "status", values: ["new", "read"] }] }), [form, setForm] = useState<null | { enabled: boolean; interval: number; leak: string; health: string; expiry: 30 | 60 | 90; rise: string }>(null);
  const load = async (q = query, offset = 0) => { const [s, p] = await Promise.all([client.call("agentState", {}), client.call("agentRows", { offset, grid: q })]); setState(s); setPage(p); };
  useEffect(() => { let on = true; setError(""); void Promise.all([client.call("agentState", {}), client.call("agentRows", { offset: 0, grid: query })]).then(([s, p]) => { if (on) { setState(s); setPage(p); } }).catch(() => { if (on) setError(t("agents.failed")); }); return () => { on = false; }; }, [client, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = (key: string, status: "new" | "read" | "dismissed") => void operation(async () => { await client.call("agentMark", { key, status }); await load(); });
  const s = state?.settings;
  return <Card title={t("agents.heading")} description={t("agents.openOnly")} data-testid="agents" aria-busy={!state && !error}>
    {error && <Notice tone="warn" role="alert">{error}</Notice>}
    {!state || !page ? !error && <Skeleton/> : <>
      <p data-testid="agents-last-checked">{state.last ? t("agents.lastChecked", { date: fmt.dateTime(state.last.finishedAt), how: t(state.last.reason === "manual" ? "agents.how.manual" : state.last.reason === "open" ? "agents.how.open" : "agents.how.schedule") }) : t("agents.never")}
        {" "}{s!.enabled ? state.nextAt ? t("agents.next", { date: fmt.dateTime(state.nextAt) }) : t("agents.nextSoon") : t("agents.off")}</p>
      <Grid min={150}>
        <StatTile icon="alert" tone={state.counts.new !== "0" ? "warn" : "ok"} label={t("agents.status.new")} value={fmt.int(state.counts.new)} valueProps={{ "data-testid": "agents-new" }}/>
        <StatTile icon="inbox" label={t("agents.status.read")} value={fmt.int(state.counts.read)}/>
        <StatTile icon="checkCircle" label={t("agents.status.resolved")} value={fmt.int(state.counts.resolved)}/>
      </Grid>
      <div className={styles.row}><Button variant="primary" icon="search" disabled={busy} data-testid="agents-run" onClick={() => void operation(async () => { setState(await client.call("agentRun", {})); await load(); })}>{t("agents.checkNow")}</Button>
        {canPrice && <Button disabled={busy} data-testid="agents-settings" onClick={() => setForm(form ? null : { enabled: s!.enabled, interval: s!.intervalMinutes, leak: (Number(s!.leakThresholdCents) / 100).toFixed(2), health: basisPointsDecimal(BigInt(s!.healthThresholdBp)), expiry: s!.expiryDays, rise: basisPointsDecimal(BigInt(s!.costRiseBp)) })}>{t("agents.settings")}</Button>}</div>
      {form && <form className={styles.card} data-testid="agents-settings-form" onSubmit={e => { e.preventDefault(); void operation(async () => {
        const bp = (v: string) => { const n = minorUnits(v); if (n <= BigInt(0) || n > BigInt(1000000)) throw new Error(msg("agents.invalid")); return Number(n); };
        setState(await client.call("agentSettingsSave", { input: { enabled: form.enabled, intervalMinutes: form.interval, leakThresholdCents: minorUnits(form.leak).toString(), healthThresholdBp: bp(form.health), expiryDays: form.expiry, costRiseBp: bp(form.rise) } })); setForm(null); }); }}>
        <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}/> {t("agents.enabled")}</label>
        <Grid min={180}>
          <Field label={t("agents.interval")}><select value={form.interval} onChange={e => setForm({ ...form, interval: Number(e.target.value) })}>{INTERVALS.map(m => <option key={m} value={m}>{m < 60 ? t("agents.minutes", { count: m }) : t("agents.hours", { count: m / 60 })}</option>)}</select></Field>
          <Field label={t("agents.leakThreshold")}><input inputMode="decimal" value={form.leak} onChange={e => setForm({ ...form, leak: e.target.value })} required/></Field>
          <Field label={t("agents.healthThreshold")}><input inputMode="decimal" value={form.health} onChange={e => setForm({ ...form, health: e.target.value })} required/></Field>
          <Field label={t("agents.expiryDays")}><select value={form.expiry} onChange={e => setForm({ ...form, expiry: Number(e.target.value) as 30 | 60 | 90 })}>{[30, 60, 90].map(d => <option key={d} value={d}>{t("agents.days", { count: d })}</option>)}</select></Field>
          <Field label={t("agents.costRise")}><input inputMode="decimal" value={form.rise} onChange={e => setForm({ ...form, rise: e.target.value })} required/></Field>
        </Grid>
        <Button type="submit" variant="primary" disabled={busy} data-testid="agents-settings-save">{t("agents.save")}</Button>
      </form>}
      {page.grid.total === "0" ? <EmptyState icon="checkCircle" title={t("agents.empty")}/> : <>
        <DataGrid label={t("agents.inbox")} testId="agents-inbox" rows={page.rows} rowKey={r => r.key} rowProps={r => ({ "data-rule": r.rule, "data-status": r.status })}
          remote={{ query, onQuery: q => { setQuery(q); void operation(() => load(q)); }, meta: page.grid, fetch: g => client.call("agentRows", { offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "rule", name: t("agents.rule"), value: r => r.rule, label: v => RULE[v as Rule] ? t(RULE[v as Rule]) : v, cell: r => t(RULE[r.rule]) },
          { id: "subject", name: t("agents.subject"), value: r => r.subject, cell: r => <span className={styles.wrap}><strong translate="no">{r.subject}</strong><br/><span className={styles.small}>{what(r)}</span></span> },
          { id: "amount", name: t("agents.amount"), type: "money", num: true, value: r => r.amount },
          { id: "first_seen", name: t("agents.firstSeen"), type: "date", value: r => r.first_seen, cell: r => fmt.dateTime(r.first_seen) },
          { id: "last_seen", name: t("agents.lastSeen"), type: "date", value: r => r.last_seen, cell: r => fmt.dateTime(r.last_seen) },
          { id: "status", name: t("agents.statusCol"), value: r => r.status, label: v => STATUS[v] ? t(STATUS[v]) : v, cell: r => <span className={styles.pill} data-status={r.status}>{t(STATUS[r.status])}</span> },
          { id: "actions", name: t("quotes.actions"), cell: r => r.status === "resolved" ? "" : <span className={styles.row}>
            {r.status === "new" && <Button size="sm" disabled={busy} onClick={() => mark(r.key, "read")} data-testid="agents-mark-read">{t("agents.markRead")}</Button>}
            {r.status !== "dismissed" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => mark(r.key, "dismissed")} data-testid="agents-dismiss">{t("agents.dismiss")}</Button>
              : <Button size="sm" variant="ghost" disabled={busy} onClick={() => mark(r.key, "new")}>{t("agents.reopen")}</Button>}</span> },
        ]}/>
        <div className={styles.row}><Button size="sm" disabled={busy || !page.offset} onClick={() => void operation(() => load(query, page.offset - 50))}>{t("ops.previous")}</Button><Button size="sm" disabled={busy || page.offset + 50 >= Number(page.grid.matched)} onClick={() => void operation(() => load(query, page.offset + 50))}>{t("ops.next")}</Button></div>
      </>}
    </>}
  </Card>;
}
