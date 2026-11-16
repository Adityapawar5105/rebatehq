"use client";
// Chunk 8D: opt-in anonymous benchmarks (BENCHMARKS_DESIGN.md). Cost roles on Professional/Scale see this quarter's
// bands and any figures the Owner fetched. Only the Owner maps categories, turns sharing on or off, shares a quarter
// after reviewing the exact payload, fetches figures and withdraws. Nothing is sent when the screen opens: every
// request is an explicit Owner click. Worker grids follow the grid standard.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import { FAMILIES, METRICS, type Family, type Metric } from "@/lib/bench/payload";
import { benchConsent, benchFigures, benchSetConsent, benchShare, benchWithdraw, type ConsentView } from "@/lib/bench/client";
import { errorText, fmt, msg, t, type MessageKey } from "@/lib/i18n";
import { Button, Card, EmptyState, Field, Notice, Skeleton } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

type Op = (f: () => Promise<void>) => Promise<void>;
const FAMILY: Record<Family, MessageKey> = { electrical: "bench.family.electrical", plumbing: "bench.family.plumbing", hvac: "bench.family.hvac", industrial_mro: "bench.family.industrialMro", fasteners: "bench.family.fasteners", safety: "bench.family.safety",
  janitorial: "bench.family.janitorial", packaging: "bench.family.packaging", building_materials: "bench.family.buildingMaterials", foodservice: "bench.family.foodservice", medical: "bench.family.medical", other: "bench.family.other" };
const METRIC: Record<Metric, MessageKey> = { pocket_margin: "bench.metric.pocketMargin", discount_rate: "bench.metric.discountRate", rebate_rate: "bench.metric.rebateRate", freight_rate: "bench.metric.freightRate" };
const REASON: Record<string, MessageKey> = { ok: "bench.reason.ok", lines: "bench.reason.lines", customers: "bench.reason.customers", concentration: "bench.reason.concentration", revenue: "bench.reason.revenue" };
const range = (lo: number) => lo >= 80 ? "80%" : `${lo}–${lo + 4}%`;

export function BenchmarksView({ client, version, busy, operation }: { client: VaultClient; version: string; busy: boolean; operation: Op }) {
  const [state, setState] = useState<Results["benchState"] | null>(null), [preview, setPreview] = useState<Results["benchPreview"] | null>(null);
  const [map, setMap] = useState<Record<string, string>>({}), [consent, setConsent] = useState<ConsentView | undefined>(undefined), [agree, setAgree] = useState(false);
  const [error, setError] = useState(""), [note, setNote] = useState(""), [confirmWithdraw, setConfirmWithdraw] = useState(false);
  useEffect(() => { let on = true; setError(""); void client.call("benchState", {}).then(async s => { if (!on) return; setState(s); setMap(Object.fromEntries(s.mapping.map(m => [m.category, m.family ?? ""]))); const p = await client.call("benchPreview", { quarter: s.quarter }); if (on) setPreview(p); }).catch(e => { if (on) setError(errorText(e)); }); return () => { on = false; }; }, [client, version]);
  if (error && !state) return <Notice tone="warn" role="alert">{error}</Notice>;
  if (!state || !preview) return <Skeleton/>;
  const owner = state.owner, quarter = state.quarter, shared = state.shares.find(s => s.quarter === quarter && !s.withdrawnAt), figures = state.figures.filter(f => f.quarter === quarter);
  const act = (work: () => Promise<void>) => void operation(async () => { setError(""); setNote(""); try { await work(); } catch (e) { setError(errorText(e)); } });
  const refreshPreview = async () => setPreview(await client.call("benchPreview", { quarter }));
  return <>
    <Card headingId="bench-heading" title={t("bench.heading")} description={t("bench.intro")} data-testid="benchmarks">
      <Notice tone="info">{t("bench.whatLeaves")}</Notice>
      {error && <Notice tone="warn" role="alert">{error}</Notice>}
      {note && <p role="status" data-testid="bench-note">{note}</p>}
      <p className={styles.small}>{t("bench.quarter", { quarter, from: fmt.date(preview.from), to: fmt.date(preview.to), size: preview.sizeBand })}</p>
      {owner && <div className={styles.row} data-testid="bench-consent" data-state={consent === undefined ? "unknown" : consent?.optedIn ? "on" : "off"}>
        {consent === undefined ? <Button size="sm" disabled={busy} data-testid="bench-check" onClick={() => act(async () => setConsent((await benchConsent()).consent))}>{t("bench.check")}</Button>
          : <span>{consent?.optedIn ? t("bench.on", { date: fmt.dateTime(consent.decidedAt) }) : t("bench.off")}</span>}
      </div>}
    </Card>
    {owner && <Card title={t("bench.mapHeading")} description={t("bench.mapHelp")} data-testid="bench-map">
      {!state.mapping.length ? <EmptyState icon="database" title={t("bench.noCategories")}/> : <>
        <DataGrid label={t("bench.mapHeading")} testId="bench-map-grid" rows={state.mapping} rowKey={m => m.category} columns={[
          { id: "category", name: t("vendor.category"), value: m => m.category, cell: m => <span translate="no">{m.category}</span> },
          { id: "products", name: t("bench.products"), type: "int", num: true, value: m => m.products },
          { id: "family", name: t("bench.family"), value: m => map[m.category] || "", label: v => v ? t(FAMILY[v as Family]) : t("bench.notMapped"), cell: m => <select aria-label={t("bench.familyFor", { category: m.category })} value={map[m.category] ?? ""} onChange={e => setMap({ ...map, [m.category]: e.target.value })} data-testid={"bench-family-" + m.category}>
            <option value="">{t("bench.notMapped")}</option>{FAMILIES.map(f => <option key={f} value={f}>{t(FAMILY[f])}</option>)}</select> },
        ]}/>
        <Button variant="primary" disabled={busy} data-testid="bench-map-save" onClick={() => act(async () => { setState(await client.call("benchMapSave", { mapping: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v || null])) })); await refreshPreview(); setNote(msg("bench.mapSaved")); })}>{t("bench.mapSave")}</Button>
      </>}
    </Card>}
    <Card title={t("bench.previewHeading", { quarter })} description={t("bench.previewHelp")} data-testid="bench-preview">
      {preview.unmapped !== "0" && <Notice tone="warn">{t("bench.unmapped", { count: fmt.int(preview.unmapped) })}</Notice>}
      {!preview.families.length ? <EmptyState icon="inbox" title={t("bench.noFamilies")}/> :
        <DataGrid label={t("bench.previewHeading", { quarter })} testId="bench-families" rows={preview.families} rowKey={f => f.family} rowProps={f => ({ "data-included": f.included ? "yes" : "no" })} columns={[
          { id: "family", name: t("bench.family"), value: f => f.family, label: v => t(FAMILY[v as Family]), cell: f => t(FAMILY[f.family]) },
          { id: "lines", name: t("bench.lines"), type: "int", num: true, value: f => f.lines },
          { id: "customers", name: t("bench.customers"), type: "int", num: true, value: f => f.customers },
          { id: "status", name: t("bench.status"), value: f => f.reason, label: v => t(REASON[v]), cell: f => t(REASON[f.reason]) },
          ...METRICS.map(m => ({ id: m, name: t(METRIC[m]), type: "int" as const, num: true, value: (f: (typeof preview.families)[number]) => f.bands[m] === undefined ? null : String(f.bands[m]), cell: (f: (typeof preview.families)[number]) => f.bands[m] === undefined ? "–" : `${f.bands[m]}%` })),
        ]}/>}
      {owner && <>
        <h3>{t("bench.payloadHeading")}</h3>
        {preview.payload ? <pre className={styles.code} data-testid="bench-payload" translate="no">{JSON.stringify(preview.payload, null, 2)}</pre> : <p data-testid="bench-payload-none">{t("bench.nothingToShare")}</p>}
        {consent?.optedIn !== true ? <div className={styles.card}>
          <p className={styles.small}>{t("bench.consentText")}</p>
          <label className={styles.row}><input type="checkbox" style={{ width: "auto" }} checked={agree} onChange={e => setAgree(e.target.checked)} data-testid="bench-agree"/> {t("bench.agree")}</label>
          <Button variant="primary" disabled={busy || !agree} data-testid="bench-optin" onClick={() => act(async () => { setConsent((await benchSetConsent(true)).consent); setNote(msg("bench.optedIn")); })}>{t("bench.turnOn")}</Button>
        </div> : <div className={styles.row}>
          <Button variant="primary" disabled={busy || !preview.payload} data-testid="bench-share" onClick={() => act(async () => { const r = await benchShare(preview.payload!); setState(await client.call("benchShared", { payload: preview.payload, stored: r.stored })); setNote(msg("bench.shared", { quarter, rows: fmt.int(r.stored) })); })}>{t(shared ? "bench.shareAgain" : "bench.share", { quarter })}</Button>
          <Button disabled={busy || !shared} data-testid="bench-figures-get" onClick={() => act(async () => { const r = await benchFigures(quarter); setState(await client.call("benchFiguresSave", { quarter, cells: r.cells })); setNote(msg(r.cells.length ? "bench.figuresSaved" : "bench.noFiguresYet", { count: fmt.int(r.cells.length) })); })}>{t("bench.getFigures", { quarter })}</Button>
          <Button variant="ghost" disabled={busy} data-testid="bench-optout" onClick={() => act(async () => { setConsent((await benchSetConsent(false)).consent); setNote(msg("bench.optedOut")); })}>{t("bench.turnOff")}</Button>
        </div>}
        {consent !== undefined && (!confirmWithdraw ? <Button variant="ghost" size="sm" disabled={busy} data-testid="bench-withdraw" onClick={() => setConfirmWithdraw(true)}>{t("bench.withdraw")}</Button>
          : <div className={styles.row}><span>{t("bench.withdrawConfirm")}</span><Button variant="danger" size="sm" disabled={busy} data-testid="bench-withdraw-confirm" onClick={() => act(async () => { setConfirmWithdraw(false); const r = await benchWithdraw(); setConsent(r.consent); setState(await client.call("benchWithdrawn", {})); setNote(msg("bench.withdrawn", { count: fmt.int(r.deleted) })); })}>{t("bench.withdrawYes")}</Button><Button size="sm" variant="ghost" onClick={() => setConfirmWithdraw(false)}>{t("bench.cancel")}</Button></div>)}
      </>}
    </Card>
    <Card title={t("bench.figuresHeading", { quarter })} description={t("bench.figuresHelp")} data-testid="bench-figures">
      {!figures.length ? <EmptyState icon="chart" title={t(shared ? "bench.figuresPending" : "bench.figuresGive")}/> :
        <DataGrid label={t("bench.figuresHeading", { quarter })} testId="bench-figures-grid" rows={figures} rowKey={f => `${f.sizeBand}|${f.family}|${f.metric}`} columns={[
          { id: "family", name: t("bench.family"), value: f => f.family, label: v => t(FAMILY[v as Family]), cell: f => t(FAMILY[f.family as Family]) },
          { id: "metric", name: t("bench.metric"), value: f => f.metric, label: v => t(METRIC[v as Metric]), cell: f => t(METRIC[f.metric as Metric]) },
          { id: "size", name: t("bench.size"), value: f => f.sizeBand },
          { id: "p50", name: t("bench.median"), type: "int", num: true, value: f => String(f.p50), cell: f => <strong>{range(f.p50)}</strong> },
          { id: "middle", name: t("bench.middleHalf"), value: f => `${f.p25}`, cell: f => `${f.p25}–${Math.min(f.p75 + 4, 80)}%` },
          { id: "yours", name: t("bench.yours"), value: f => { const r = shared?.payload.rows.find(x => x.family === f.family && x.metric === f.metric); return r ? String(r.band) : null; }, cell: f => { const r = shared?.payload.rows.find(x => x.family === f.family && x.metric === f.metric); return r ? `${r.band}%` : "–"; } },
        ]}/>}
      <p className={styles.small}>{t("bench.method")}</p>
    </Card>
  </>;
}
