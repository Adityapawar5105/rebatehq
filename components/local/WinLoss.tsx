"use client";
// Chunk 8C-1: the win/loss log in Quote Desk. The outcome panel sits on an open quote that has left draft; the report
// groups recorded outcomes by reason, customer or rep in a worker grid (grid standard). Margin columns appear only when
// the worker sends them (the "cost" capability); a Sales Rep's report covers only their own quotes (decision 16).
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import type { QuoteView } from "@/lib/quotes/quotes";
import { REASONS, OUTCOMES, type Outcome, type Reason, type ReportBy } from "@/lib/quotes/outcomes";
import { errorText, fmt, t, type MessageKey } from "@/lib/i18n";
import { Button, Card, EmptyState, Field, Grid, Notice, Skeleton, StatTile } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";
import { addDays, businessToday } from "@/lib/vault/today";

type Op = (f: () => Promise<void>) => Promise<void>;
export const OUTCOME_LABEL: Record<Outcome, MessageKey> = { won: "winloss.won", lost: "winloss.lost", no_decision: "winloss.noDecision" };
export const REASON_LABEL: Record<Reason, MessageKey> = { price: "winloss.reason.price", competitor: "winloss.reason.competitor", availability: "winloss.reason.availability", lead_time: "winloss.reason.leadTime",
  specification: "winloss.reason.specification", relationship: "winloss.reason.relationship", service: "winloss.reason.service", credit_terms: "winloss.reason.creditTerms", timing: "winloss.reason.timing", other: "winloss.reason.other" };

export function OutcomePanel({ client, quote, busy, operation, onSaved }: { client: VaultClient; quote: QuoteView; busy: boolean; operation: Op; onSaved: (v: QuoteView) => void }) {
  const o = quote.outcome;
  const [form, setForm] = useState({ outcome: (o?.outcome ?? "won") as Outcome, reason: (o?.reason ?? "price") as Reason, competitor: o?.competitor ?? "", note: o?.note ?? "" });
  useEffect(() => { setForm({ outcome: o?.outcome ?? "won", reason: o?.reason ?? "price", competitor: o?.competitor ?? "", note: o?.note ?? "" }); }, [quote.id, o?.recordedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className={styles.card} data-testid="quote-outcome" data-outcome={o?.outcome ?? ""}>
    <h3>{t("winloss.heading")}</h3>
    <p className={styles.small}>{o ? t("winloss.recorded", { outcome: t(OUTCOME_LABEL[o.outcome]), reason: t(REASON_LABEL[o.reason]), date: fmt.date(o.recordedAt.slice(0, 10)) }) : t("winloss.notRecorded")}</p>
    <form onSubmit={e => { e.preventDefault(); void operation(async () => onSaved(await client.call("quoteOutcome", { id: quote.id, input: { outcome: form.outcome, reason: form.reason, competitor: form.competitor.trim() || null, note: form.note.trim() || null } }))); }}>
      <Grid min={170}>
        <Field label={t("winloss.outcome")}><select value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value as Outcome })} data-testid="outcome-select">{OUTCOMES.map(x => <option key={x} value={x}>{t(OUTCOME_LABEL[x])}</option>)}</select></Field>
        <Field label={t("winloss.reason")}><select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value as Reason })} data-testid="outcome-reason">{REASONS.map(x => <option key={x} value={x}>{t(REASON_LABEL[x])}</option>)}</select></Field>
        <Field label={t("winloss.competitor")}><input value={form.competitor} maxLength={100} onChange={e => setForm({ ...form, competitor: e.target.value })} data-testid="outcome-competitor"/></Field>
      </Grid>
      <Field label={t("winloss.note")} hint={t("winloss.noteHelp")}><textarea className={styles.textarea} value={form.note} maxLength={1000} onChange={e => setForm({ ...form, note: e.target.value })} data-testid="outcome-note"/></Field>
      <Button type="submit" variant="primary" disabled={busy} data-testid="outcome-save">{t("winloss.save")}</Button>
    </form>
  </div>;
}

export function WinLossReport({ client, busy, operation }: { client: VaultClient; busy: boolean; operation: Op }) {
  const today = businessToday();
  const [by, setBy] = useState<ReportBy>("reason"), [from, setFrom] = useState(addDays(today, -364)), [to, setTo] = useState(today);
  const [view, setView] = useState<Results["winLoss"] | null>(null), [gq, setGq] = useState<GridQuery>({}), [error, setError] = useState("");
  const load = async (q = gq, offset = 0) => { setError(""); try { setView(await client.call("winLoss", { by, from, to, offset, grid: q })); } catch (e) { setError(errorText(e)); } };
  useEffect(() => { setGq({}); void load({}); }, [client, by]); // eslint-disable-line react-hooks/exhaustive-deps
  const margin = !!view && "wonMargin" in view.total, tot = view?.total;
  const label = (key: string | null, lbl: string | null) => by === "reason" ? (REASON_LABEL[key as Reason] ? t(REASON_LABEL[key as Reason]) : key ?? "") : lbl ? `${lbl} (${key})` : key ?? "";
  return <Card title={t("winloss.reportHeading")} description={view?.mineOnly ? t("winloss.mineOnly") : t("winloss.reportHelp")} data-testid="winloss-report">
    <form onSubmit={e => { e.preventDefault(); void operation(() => load()); }}>
      <Grid min={160}>
        <Field label={t("winloss.by")}><select value={by} onChange={e => setBy(e.target.value as ReportBy)} data-testid="winloss-by"><option value="reason">{t("winloss.by.reason")}</option><option value="customer">{t("winloss.by.customer")}</option><option value="rep">{t("winloss.by.rep")}</option></select></Field>
        <Field label={t("winloss.from")}><input type="date" value={from} onChange={e => setFrom(e.target.value)} required/></Field>
        <Field label={t("winloss.to")}><input type="date" value={to} onChange={e => setTo(e.target.value)} required/></Field>
      </Grid>
      <Button type="submit" disabled={busy}>{t("ops.apply")}</Button>
    </form>
    {error && <Notice tone="warn" role="alert">{error}</Notice>}
    {!view ? !error && <Skeleton/> : <>
      <Grid min={150}>
        <StatTile icon="checkCircle" label={t("winloss.won")} value={fmt.int(tot!.won ?? "0")} valueProps={{ "data-testid": "winloss-won" }}/>
        <StatTile icon="alert" label={t("winloss.lost")} value={fmt.int(tot!.lost ?? "0")} valueProps={{ "data-testid": "winloss-lost" }}/>
        <StatTile icon="trend" label={t("winloss.winRate")} value={tot!.winRate === null ? t("common.unknown") : fmt.percent(tot!.winRate!)} valueProps={{ "data-testid": "winloss-rate" }}/>
        <StatTile icon="coins" label={t("winloss.lostValue")} value={fmt.currency(tot!.lostValue ?? "0")} valueProps={{ "data-testid": "winloss-lost-value", "data-value": tot!.lostValue ?? "" }}/>
        {margin && <StatTile icon="coins" label={t("winloss.lostMargin")} value={fmt.currency(tot!.lostMargin ?? "0")} valueProps={{ "data-testid": "winloss-lost-margin", "data-value": tot!.lostMargin ?? "" }}/>}
      </Grid>
      {view.grid.total === "0" ? <EmptyState icon="inbox" title={t("winloss.empty")}/> :
        <DataGrid label={t("winloss.reportHeading")} testId="winloss-grid" rows={view.rows} rowKey={r => String(r.key)} rowProps={r => ({ "data-key": String(r.key) })}
          remote={{ query: gq, onQuery: q => { setGq(q); void operation(() => load(q)); }, meta: view.grid, fetch: g => client.call("winLoss", { by, from, to, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "key", name: t(by === "reason" ? "winloss.reason" : by === "customer" ? "winloss.by.customer" : "winloss.by.rep"), value: r => r.key, cell: r => <span translate={by === "reason" ? undefined : "no"}>{label(r.key, r.label)}</span> },
          { id: "quotes", name: t("winloss.quotes"), type: "int", num: true, value: r => r.quotes },
          { id: "won", name: t("winloss.won"), type: "int", num: true, value: r => r.won },
          { id: "lost", name: t("winloss.lost"), type: "int", num: true, value: r => r.lost },
          { id: "open", name: t("winloss.noDecision"), type: "int", num: true, value: r => r.open },
          { id: "win_rate", name: t("winloss.winRate"), type: "percent", num: true, value: r => r.win_rate },
          { id: "won_value", name: t("winloss.wonValue"), type: "money", num: true, value: r => r.won_value },
          { id: "lost_value", name: t("winloss.lostValue"), type: "money", num: true, value: r => r.lost_value },
          ...(margin ? [{ id: "won_margin", name: t("winloss.wonMargin"), type: "money" as const, num: true, value: (r: Record<string, string | null>) => r.won_margin },
            { id: "lost_margin", name: t("winloss.lostMargin"), type: "money" as const, num: true, value: (r: Record<string, string | null>) => r.lost_margin }] : []),
        ]}/>}
      <p className={styles.small}>{t("winloss.method")}</p>
    </>}
  </Card>;
}
