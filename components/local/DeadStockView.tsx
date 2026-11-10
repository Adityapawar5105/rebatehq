"use client";
// Chunk 8B-2: the dead-stock clearance optimiser (a Vendors tab for cost roles). Stock on hand comes from a Data Hub
// file; carrying costs are typed by the user. Suggested prices never go below replacement cost and reach live prices
// only through the normal draft, Pricing Owner approval and ERP export. The list is a worker grid on the grid standard.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import type { DeadStatus } from "@/lib/inventory/deadstock";
import { minorUnits } from "@/lib/spike/exact";
import { basisPointsDecimal } from "@/lib/margin/decimal";
import { errorText, fmt, msg, t, type MessageKey } from "@/lib/i18n";
import { Button, ButtonLink, Card, EmptyState, Field, Grid, Notice, Skeleton, StatTile } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

const STATUS: Record<DeadStatus, MessageKey> = { suggested: "dead.status.suggested", floored: "dead.status.floored", at_cost: "dead.status.atCost", no_price: "dead.status.noPrice", no_cost: "dead.status.noCost" };
type State = Results["deadState"];
type Form = { idle: string; rate: string; storage: string; horizon: string };
const formOf = (s: State["settings"]): Form => ({ idle: String(s.idleDays), rate: basisPointsDecimal(BigInt(s.capitalRateBp)), storage: (Number(s.storageCents) / 100).toFixed(2), horizon: String(s.horizonMonths) });

export function DeadStockView({ client, version, canPrice, canImport, busy, operation }: { client: VaultClient; version: string; canPrice: boolean; canImport: boolean; busy: boolean; operation: (work: () => Promise<void>) => Promise<void> }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState(""), [gq, setGq] = useState<GridQuery>({}), [form, setForm] = useState<Form | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()), [draft, setDraft] = useState<Results["deadDraft"] | null>(null);
  useEffect(() => { let on = true; setError(""); setPicked(new Set()); void client.call("deadState", {}).then(v => { if (on) setState(v); }).catch(e => { if (on) setError(errorText(e)); }); return () => { on = false; }; }, [client, version]);
  if (error && !state) return <Notice tone="warn" role="alert">{error}</Notice>;
  if (!state) return <Skeleton/>;
  const s = state.summary, page = state.page;
  const reload = async (q = gq, offset = 0) => { const p = await client.call("deadRows", { offset, grid: q }); setState(v => v ? { ...v, page: p } : v); };
  const save = () => void operation(async () => {
    const int = (v: string) => /^\d{1,4}$/.test(v.trim()) ? Number(v) : NaN, bp = minorUnits(form!.rate), cents = minorUnits(form!.storage);
    if (bp < BigInt(0) || bp > BigInt(10000) || cents < BigInt(0)) throw new Error(msg("dead.invalid"));
    setState(await client.call("deadSettingsSave", { input: { idleDays: int(form!.idle), capitalRateBp: Number(bp), storageCents: cents.toString(), horizonMonths: int(form!.horizon) } })); setForm(null); setPicked(new Set()); setDraft(null);
  });
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const priced = page.rows.filter(r => r.status === "suggested" || r.status === "floored");
  return <>
    <Card title={t("dead.heading")} description={t("dead.intro")} data-testid="dead-stock" actions={canPrice ? <Button size="sm" disabled={busy} data-testid="dead-settings" onClick={() => setForm(form ? null : formOf(state.settings))}>{t("dead.settings")}</Button> : undefined}>
      {error && <Notice tone="warn" role="alert">{error}</Notice>}
      <p className={styles.small} data-testid="dead-params">{t("dead.params", { days: fmt.int(state.settings.idleDays), rate: fmt.percent(basisPointsDecimal(BigInt(state.settings.capitalRateBp))), storage: fmt.currency(state.settings.storageCents), months: fmt.int(state.settings.horizonMonths) })}</p>
      {form && <form className={styles.card} data-testid="dead-settings-form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Grid min={180}>
          <Field label={t("dead.idleDays")} hint={t("dead.idleDaysHelp")}><input inputMode="numeric" value={form.idle} required onChange={e => setForm({ ...form, idle: e.target.value })} data-testid="dead-idle"/></Field>
          <Field label={t("dead.capitalRate")}><input inputMode="decimal" value={form.rate} required onChange={e => setForm({ ...form, rate: e.target.value })} data-testid="dead-rate"/></Field>
          <Field label={t("dead.storage")}><input inputMode="decimal" value={form.storage} required onChange={e => setForm({ ...form, storage: e.target.value })} data-testid="dead-storage"/></Field>
          <Field label={t("dead.horizon")} hint={t("dead.horizonHelp")}><input inputMode="numeric" value={form.horizon} required onChange={e => setForm({ ...form, horizon: e.target.value })} data-testid="dead-horizon"/></Field>
        </Grid>
        <Button type="submit" variant="primary" disabled={busy} data-testid="dead-settings-save">{t("dead.save")}</Button>
      </form>}
      {s.stockRows === "0" ? <EmptyState icon="upload" title={t("dead.noStock")} body={t("dead.noStockHelp")} action={canImport ? <ButtonLink variant="primary" href="#data-hub" icon="database">{t("margin.openDataHub")}</ButtonLink> : undefined}/> : <>
        <Grid min={170}>
          <StatTile icon="inbox" label={t("dead.skus")} value={fmt.int(s.skus)} valueProps={{ "data-testid": "dead-skus" }}/>
          <StatTile icon="alert" tone={s.capital !== "0" ? "warn" : "ok"} label={t("dead.capital")} value={fmt.currency(s.capital)} valueProps={{ "data-testid": "dead-capital", "data-value": s.capital }}/>
          <StatTile icon="trend" label={t("dead.carrying")} value={fmt.currency(s.carryingMonth)} valueProps={{ "data-testid": "dead-carrying", "data-value": s.carryingMonth }}/>
        </Grid>
        {s.unknownItems !== "0" && <Notice tone="warn">{t("dead.unknownItems", { count: fmt.int(s.unknownItems) })}</Notice>}
        {s.noCost !== "0" && <Notice tone="warn">{t("dead.noCostItems", { count: fmt.int(s.noCost) })}</Notice>}
        <p className={styles.small}>{t("dead.method")}</p>
        {page.grid.total === "0" ? <EmptyState icon="checkCircle" title={t("dead.none")}/> : <>
          <DataGrid label={t("dead.heading")} testId="dead-grid" rows={page.rows} rowKey={r => r.product_id} rowProps={r => ({ "data-status": r.status, "data-suggested": r.suggested ?? "" })}
            remote={{ query: gq, onQuery: q => { setGq(q); void operation(() => reload(q)); }, meta: page.grid, fetch: g => client.call("deadRows", { offset: 0, grid: g }).then(v => v.grid) }} columns={[
            ...(canPrice ? [{ id: "pick", name: t("dead.include"), cell: (r: State["page"]["rows"][number]) => r.status === "suggested" || r.status === "floored" ? <input type="checkbox" style={{ width: "auto" }} aria-label={t("dead.includeItem", { item: r.product_id })} checked={picked.has(r.product_id)} onChange={() => toggle(r.product_id)} data-testid={"dead-pick-" + r.product_id}/> : "" }] : []),
            { id: "product_id", name: t("vendor.sku"), value: r => r.product_id, cell: r => <span className={styles.wrap} translate="no">{r.product_id}{r.description ? ` · ${r.description}` : ""}</span> },
            { id: "category", name: t("vendor.category"), value: r => r.category, cell: r => <span translate="no">{r.category}</span> },
            { id: "on_hand", name: t("dead.onHand"), type: "decimal", num: true, value: r => r.on_hand, cell: r => <>{fmt.decimal(r.on_hand)} <span className={styles.small} translate="no">{r.uom}</span></> },
            { id: "last_sale", name: t("dead.lastSale"), type: "date", value: r => r.last_sale, cell: r => r.last_sale ? <>{fmt.date(r.last_sale)}<br/><span className={styles.small}>{t("dead.daysAgo", { count: Number(r.idle_days) })}</span></> : t("dead.neverSold") },
            { id: "unit_cost", name: t("dead.unitCost"), type: "money", num: true, value: r => r.unit_cost },
            { id: "capital", name: t("dead.capital"), type: "money", num: true, value: r => r.capital },
            { id: "carrying_month", name: t("dead.carrying"), type: "money", num: true, value: r => r.carrying_month },
            { id: "price", name: t("dead.price"), type: "money", num: true, value: r => r.price },
            { id: "suggested", name: t("dead.suggested"), type: "money", num: true, value: r => r.suggested, cell: r => r.suggested === null ? t("common.unknown") : <strong>{fmt.currency(r.suggested)}</strong> },
            { id: "markdown", name: t("dead.markdown"), type: "money", num: true, value: r => r.markdown },
            { id: "status", name: t("dead.statusCol"), value: r => r.status, label: v => STATUS[v as DeadStatus] ? t(STATUS[v as DeadStatus]) : v, cell: r => <span className={styles.pill} data-status={r.status}>{t(STATUS[r.status])}</span> },
            { id: "substitutes", name: t("dead.substitutes"), value: r => r.substitutes, cell: r => r.substitutes ? <span className={styles.wrap} translate="no">{r.substitutes}</span> : <span className={styles.small}>{t("dead.noSubstitutes")}</span> },
          ]}/>
          <div className={styles.row}><Button size="sm" disabled={busy || !page.offset} onClick={() => void operation(() => reload(gq, page.offset - 50))}>{t("ops.previous")}</Button><Button size="sm" disabled={busy || page.offset + 50 >= Number(page.grid.matched)} onClick={() => void operation(() => reload(gq, page.offset + 50))}>{t("ops.next")}</Button></div>
          {canPrice && <div className={styles.row}>
            <Button size="sm" disabled={busy || !priced.length} onClick={() => setPicked(new Set(priced.map(r => r.product_id)))} data-testid="dead-pick-page">{t("dead.pickPage")}</Button>
            <Button variant="primary" disabled={busy || !picked.size} data-testid="dead-draft" onClick={() => void operation(async () => { setDraft(await client.call("deadDraft", { ids: [...picked] })); setPicked(new Set()); })}>{t("dead.draft", { count: picked.size })}</Button></div>}
        </>}
      </>}
    </Card>
    {draft && <Card title={t("pricing.changePreview")} data-testid="dead-draft-ready"><p data-testid="dead-draft-count" data-value={draft.count}>{t("dead.draftReady", { count: fmt.int(draft.count), impact: fmt.currency(draft.impact) })}</p>
      <ButtonLink variant="primary" href="#pricing-rules" icon="chevronRight">{t("dead.openPricing")}</ButtonLink></Card>}
  </>;
}
