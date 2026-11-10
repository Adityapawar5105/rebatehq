"use client";
// Chunk 8B-1: cost index triggers (a Vendors tab for cost roles). Index series come from files uploaded in Data Hub;
// exchange rates are typed here. Nothing is fetched from the web. Lists are DataGrids on the grid standard.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import type { TriggerView } from "@/lib/agents/costindex";
import { CURRENCIES } from "@/lib/vault/currency";
import { basisPointsDecimal } from "@/lib/margin/decimal";
import { errorText, fmt, t, type MessageKey } from "@/lib/i18n";
import { Button, ButtonLink, Card, EmptyState, Field, Grid, Notice, Skeleton } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

const STATUS: Record<TriggerView["status"], MessageKey> = { triggered: "index.status.triggered", quiet: "index.status.quiet", insufficient: "index.status.insufficient" };
const pct = (bp: string | null) => bp === null ? t("common.unknown") : fmt.percent(basisPointsDecimal(BigInt(bp)));
const blank = { name: "", index: "", scope: "category" as "category" | "product", value: "", baseDate: "", thresholdPct: "5", passThroughPct: "100", fx: false, currency: "EUR", base: "", now: "", bufferPct: "3" };

export function CostIndexView({ client, version, canPrice, canImport, busy, operation }: { client: VaultClient; version: string; canPrice: boolean; canImport: boolean; busy: boolean; operation: (work: () => Promise<void>) => Promise<void> }) {
  const [state, setState] = useState<Results["indexState"] | null>(null), [error, setError] = useState(""), [form, setForm] = useState(blank), [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(""), [skus, setSkus] = useState<Results["indexSkus"] | null>(null), [gq, setGq] = useState<GridQuery>({});
  useEffect(() => { let on = true; setError(""); void client.call("indexState", {}).then(v => { if (on) setState(v); }).catch(e => { if (on) setError(errorText(e)); }); return () => { on = false; }; }, [client, version]);
  useEffect(() => { let on = true; setSkus(null); setGq({}); if (selected) void client.call("indexSkus", { id: selected, offset: 0, grid: {} }).then(v => { if (on) setSkus(v); }).catch(e => { if (on) setError(errorText(e)); }); return () => { on = false; }; }, [client, selected, version]);
  if (error && !state) return <Notice tone="warn" role="alert">{error}</Notice>;
  if (!state) return <Skeleton/>;
  const save = () => void operation(async () => {
    setState(await client.call("indexTriggerSave", { input: { name: form.name, index: form.index, scope: form.scope, value: form.value, baseDate: form.baseDate, thresholdPct: form.thresholdPct, passThroughPct: form.passThroughPct, fx: form.fx ? { currency: form.currency, base: form.base, now: form.now, bufferPct: form.bufferPct } : null } }));
    setForm(blank); setOpen(false);
  });
  return <>
    <Card title={t("index.series")} description={t("index.seriesHelp")} data-testid="index-series">
      {!state.series.length ? <EmptyState icon="upload" title={t("index.noSeries")} body={t("index.noSeriesHelp")} action={canImport ? <ButtonLink variant="primary" href="#data-hub" icon="database">{t("margin.openDataHub")}</ButtonLink> : undefined}/> :
        <DataGrid label={t("index.series")} testId="index-series-grid" rows={state.series} rowKey={s => s.name} columns={[
          { id: "name", name: t("index.name"), value: s => s.name, cell: s => <span translate="no">{s.name}</span> },
          { id: "points", name: t("index.points"), type: "int", num: true, value: s => s.points },
          { id: "first", name: t("index.first"), type: "date", value: s => s.first },
          { id: "last", name: t("index.last"), type: "date", value: s => s.last },
          { id: "lastValue", name: t("index.lastValue"), type: "decimal", num: true, value: s => s.lastValue },
        ]}/>}
    </Card>
    <Card title={t("index.triggers")} description={t("index.triggersHelp")} data-testid="index-triggers" actions={canPrice && state.series.length ? <Button size="sm" icon="sparkle" disabled={busy} onClick={() => setOpen(!open)} data-testid="index-new">{t("index.new")}</Button> : undefined}>
      {error && <Notice tone="warn" role="alert">{error}</Notice>}
      {open && <form onSubmit={e => { e.preventDefault(); save(); }} data-testid="index-form">
        <Grid min={180}>
          <Field label={t("index.triggerName")}><input value={form.name} maxLength={100} required onChange={e => setForm({ ...form, name: e.target.value })} data-testid="index-name"/></Field>
          <Field label={t("index.name")}><select value={form.index} required onChange={e => setForm({ ...form, index: e.target.value })} data-testid="index-series-select"><option value="">{t("index.choose")}</option>{state.series.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select></Field>
          <Field label={t("index.scope")}><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as "category" | "product" })}><option value="category">{t("index.scope.category")}</option><option value="product">{t("index.scope.product")}</option></select></Field>
          <Field label={t(form.scope === "category" ? "index.scope.category" : "index.scope.product")}><input value={form.value} maxLength={200} required onChange={e => setForm({ ...form, value: e.target.value })} data-testid="index-value" translate="no"/></Field>
          <Field label={t("index.baseDate")} hint={t("index.baseDateHelp")}><input type="date" value={form.baseDate} required onChange={e => setForm({ ...form, baseDate: e.target.value })} data-testid="index-base"/></Field>
          <Field label={t("index.threshold")}><input inputMode="decimal" value={form.thresholdPct} required onChange={e => setForm({ ...form, thresholdPct: e.target.value })} data-testid="index-threshold"/></Field>
          <Field label={t("index.passThrough")} hint={t("index.passThroughHelp")}><input inputMode="decimal" value={form.passThroughPct} required onChange={e => setForm({ ...form, passThroughPct: e.target.value })} data-testid="index-pass"/></Field>
        </Grid>
        <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={form.fx} onChange={e => setForm({ ...form, fx: e.target.checked })} data-testid="index-fx"/> {t("index.fxImported")}</label>
        {form.fx && <><p className={styles.small}>{t("index.fxHelp")}</p><Grid min={160}>
          <Field label={t("index.fxCurrency")}><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label={t("index.fxBase")}><input inputMode="decimal" value={form.base} required onChange={e => setForm({ ...form, base: e.target.value })} data-testid="index-fx-base"/></Field>
          <Field label={t("index.fxNow")}><input inputMode="decimal" value={form.now} required onChange={e => setForm({ ...form, now: e.target.value })} data-testid="index-fx-now"/></Field>
          <Field label={t("index.fxBuffer")}><input inputMode="decimal" value={form.bufferPct} required onChange={e => setForm({ ...form, bufferPct: e.target.value })} data-testid="index-fx-buffer"/></Field>
        </Grid></>}
        <p className={styles.small}>{t("index.method")}</p>
        <Button type="submit" variant="primary" disabled={busy} data-testid="index-save">{t("index.save")}</Button>
      </form>}
      {!state.triggers.length ? <EmptyState icon="trend" title={t("index.noTriggers")}/> :
        <DataGrid label={t("index.triggers")} testId="index-triggers-grid" rows={state.triggers} rowKey={x => x.id} rowProps={x => ({ "data-status": x.status, "data-cost-bp": x.costChangeBp ?? "" })} columns={[
          { id: "name", name: t("index.triggerName"), value: x => x.name, cell: x => <span className={styles.wrap}><strong translate="no">{x.name}</strong><br/><span className={styles.small} translate="no">{x.index} · {x.value}</span></span> },
          { id: "status", name: t("index.statusCol"), value: x => x.status, label: v => t(STATUS[v as TriggerView["status"]]), cell: x => <span className={styles.pill} data-status={x.status}>{t(STATUS[x.status])}</span> },
          { id: "indexChange", name: t("index.indexChange"), type: "percent", num: true, value: x => x.indexChangeBp === null ? null : basisPointsDecimal(BigInt(x.indexChangeBp)), cell: x => <>{pct(x.indexChangeBp)}<br/><span className={styles.small}>{x.basePeriod && x.latestPeriod ? t("index.between", { from: fmt.date(x.basePeriod), to: fmt.date(x.latestPeriod) }) : ""}</span></> },
          { id: "fxChange", name: t("index.fxChange"), type: "percent", num: true, value: x => x.fxChangeBp === null ? null : basisPointsDecimal(BigInt(x.fxChangeBp)), cell: x => x.fx ? <>{pct(x.fxChangeBp)}<br/><span className={styles.small} translate="no">{x.fx.currency} · {t("index.buffer", { buffer: pct(x.fx.bufferBp) })}</span></> : "" },
          { id: "costChange", name: t("index.costChange"), type: "percent", num: true, value: x => x.costChangeBp === null ? null : basisPointsDecimal(BigInt(x.costChangeBp)), cell: x => <strong>{pct(x.costChangeBp)}</strong> },
          { id: "skus", name: t("index.skus"), type: "int", num: true, value: x => x.skus },
          { id: "actions", name: t("quotes.actions"), cell: x => <span className={styles.row}>
            <Button size="sm" disabled={busy} onClick={() => setSelected(x.id)} data-testid="index-show-skus">{t("index.showSkus")}</Button>
            {canPrice && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void operation(async () => { setState(await client.call("indexTriggerDelete", { id: x.id })); if (selected === x.id) setSelected(""); })}>{t("index.delete")}</Button>}</span> },
        ]}/>}
      {state.triggers.some(x => x.status === "triggered" && x.scope === "category" && x.costChangeBp !== null && BigInt(x.costChangeBp) > BigInt(0)) && <p className={styles.small}>{t("index.planHint")} <a href="#pricing-planner">{t("index.openPlanner")}</a></p>}
    </Card>
    {selected && <Card title={t("index.skusFor", { name: skus?.trigger.name ?? "" })} description={t("index.skusHelp")} data-testid="index-skus" actions={<Button size="sm" icon="close" onClick={() => setSelected("")}>{t("common.close")}</Button>}>
      {!skus ? <Skeleton/> : <DataGrid label={t("index.skusFor", { name: skus.trigger.name })} testId="index-skus-grid" rows={skus.rows} rowKey={r => r.product_id}
        remote={{ query: gq, onQuery: q => { setGq(q); void client.call("indexSkus", { id: selected, offset: 0, grid: q }).then(setSkus); }, meta: skus.grid, fetch: g => client.call("indexSkus", { id: selected, offset: 0, grid: g }).then(v => v.grid) }} columns={[
        { id: "product_id", name: t("vendor.sku"), value: r => r.product_id, cell: r => <span className={styles.wrap} translate="no">{r.product_id}{r.description ? ` · ${r.description}` : ""}</span> },
        { id: "category", name: t("vendor.category"), value: r => r.category, cell: r => <span translate="no">{r.category}</span> },
        { id: "current_cost", name: t("index.currentCost"), type: "money", num: true, value: r => r.current_cost },
        { id: "expected_cost", name: t("index.expectedCost"), type: "money", num: true, value: r => r.expected_cost },
        { id: "change", name: t("index.change"), type: "money", num: true, value: r => r.change },
      ]}/>}
    </Card>}
  </>;
}
