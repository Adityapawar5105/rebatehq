"use client";
// Vendors section (chunk 7E-1): vendor price review of a supplier cost sheet, and purchase price variance from the
// Purchases import. Everything is computed in the vault worker; every list is a worker grid on the grid standard.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results, Tier } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import { errorText, fmt, t, type MessageKey } from "@/lib/i18n";
import { Button, ButtonLink, Card, EmptyState, Field, Grid, Notice, SectionTabs, Skeleton, StatTile, uiStyles as ui } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

const STATUS: Record<string, MessageKey> = { unknown_sku: "vendor.status.unknown", conflict: "vendor.status.conflict", backdated: "vendor.status.backdated", first_cost: "vendor.status.first",
  increase: "vendor.status.increase", decrease: "vendor.status.decrease", unchanged: "vendor.status.unchanged" };
const statusText = (v: string) => STATUS[v] ? t(STATUS[v]) : v;
const QSTATUS: Record<string, MessageKey> = { draft: "quotes.status.draft", submitted: "quotes.status.submitted", pending: "quotes.status.pending" };
const KIND: Record<string, MessageKey> = { receipt: "vendor.kind.receipt", return: "vendor.kind.return", credit_memo: "vendor.kind.credit" };
const money = (v: string | null) => v === null ? t("common.unknown") : fmt.currency(v);

/** A worker grid's query and reload, reset when `resetKey` changes. */
function useGrid<T>(load: (offset: number, grid: GridQuery) => Promise<T>, resetKey: string) {
  const [view, setView] = useState<T | null>(null), [gq, setGq] = useState<GridQuery>({}), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const run = (offset: number, grid: GridQuery) => { setBusy(true); setError(""); return load(offset, grid).then(setView).catch(e => setError(errorText(e))).finally(() => setBusy(false)); };
  useEffect(() => { setGq({}); setView(null); if (resetKey) void run(0, {}); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { view, gq, error, busy, page: (offset: number) => run(offset, gq), query: (q: GridQuery) => { setGq(q); void run(0, q); } };
}
function Pager({ offset, matched, busy, page }: { offset: number; matched: string; busy: boolean; page: (o: number) => unknown }) {
  return <div className={styles.row}><Button size="sm" icon="chevronLeft" disabled={busy || !offset} onClick={() => void page(Math.max(0, offset - 50))}>{t("ops.previous")}</Button>
    <Button size="sm" disabled={busy || offset + 50 >= Number(matched)} onClick={() => void page(offset + 50)}>{t("ops.next")}</Button></div>;
}

function PriceReview({ client, version, canImport }: { client: VaultClient; version: string; canImport: boolean }) {
  const [sheets, setSheets] = useState<Results["vendorSheets"] | null>(null), [sheet, setSheet] = useState(""), [days, setDays] = useState(365), [error, setError] = useState("");
  useEffect(() => { let on = true; void client.call("vendorSheets", {}).then(v => { if (on) { setSheets(v); setSheet(s => s && v.some(x => x.id === s) ? s : v[0]?.id ?? ""); } }).catch(e => { if (on) setError(errorText(e)); }); return () => { on = false; }; }, [client, version]);
  const review = useGrid((offset, grid) => client.call("vendorReview", { sheet, window: days, offset, grid }), sheet ? `${sheet}|${days}|${version}` : "");
  const quotes = useGrid((offset, grid) => client.call("vendorReviewQuotes", { sheet, offset, grid }), sheet ? `${sheet}|${version}` : "");
  if (error) return <Notice tone="warn" role="alert">{error}</Notice>;
  if (!sheets) return <Skeleton/>;
  if (!sheets.length) return <Card title={t("vendor.review")} description={t("vendor.reviewHelp")}><EmptyState icon="upload" title={t("vendor.noSheets")} body={t("vendor.noSheetsHelp")} action={canImport ? <ButtonLink variant="primary" href="#data-hub" icon="database">{t("margin.openDataHub")}</ButtonLink> : undefined}/></Card>;
  const r = review.view, q = quotes.view;
  return <>
    <Card title={t("vendor.review")} description={t("vendor.reviewHelp")} data-testid="vendor-review" aria-busy={review.busy}>
      <Grid min={220}>
        <Field label={t("vendor.sheet")}><select value={sheet} onChange={e => setSheet(e.target.value)} data-testid="vendor-sheet">{sheets.map(s => <option key={s.id} value={s.id}>{s.name} · {fmt.dateTime(s.importedAt)} · {t("vendor.sheetLines", { count: fmt.int(s.lines) })}</option>)}</select></Field>
        <Field label={t("vendor.window")} hint={t("vendor.windowHelp")}><select value={days} onChange={e => setDays(Number(e.target.value))}>{[90, 180, 365].map(d => <option key={d} value={d}>{t("vendor.days", { count: fmt.int(d) })}</option>)}</select></Field>
      </Grid>
      <p className={styles.small}>{t("vendor.noLiveChange")}</p>
      {review.error && <Notice tone="warn" role="alert">{review.error}</Notice>}
      {!r ? !review.error && <Skeleton/> : <>
        <Grid min={170} className={ui.kpis}>
          <StatTile icon="tag" label={t("vendor.lines")} value={fmt.int(r.totals.lines)}/>
          <StatTile icon="trend" tone={r.totals.increases !== "0" ? "warn" : "ok"} label={t("vendor.increases")} value={fmt.int(r.totals.increases)} hint={t("vendor.decreasesHint", { count: fmt.int(r.totals.decreases) })}/>
          <StatTile icon="alert" tone={r.totals.conflicts !== "0" ? "bad" : "ok"} label={t("vendor.conflicts")} value={fmt.int(r.totals.conflicts)} valueProps={{ "data-testid": "vendor-conflicts" }}/>
          <StatTile wide icon="coins" tone={r.totals.marginImpact.startsWith("-") ? "bad" : "ok"} label={t("vendor.marginImpact")} value={money(r.totals.marginImpact)} hint={t("vendor.marginImpactHint", { days: fmt.int(r.window) })} valueProps={{ "data-testid": "vendor-impact", "data-value": r.totals.marginImpact }}/>
          <StatTile icon="quote" label={t("vendor.quotes")} value={fmt.int(r.totals.quotes)}/>
          <StatTile icon="settings" label={t("vendor.rules")} value={fmt.int(r.totals.ruleLines)}/>
        </Grid>
        <DataGrid label={t("vendor.review")} testId="vendor-review-grid" rows={r.rows} rowKey={x => x.id} remote={{ query: review.gq, onQuery: review.query, meta: r.grid, fetch: g => client.call("vendorReview", { sheet, window: days, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "product_id", name: t("vendor.sku"), value: x => x.product_id, cell: x => <span className={styles.wrap} translate="no">{x.product_id}{x.description ? ` · ${x.description}` : ""}</span> },
          { id: "category", name: t("vendor.category"), value: x => x.category, cell: x => <span translate="no">{x.category}</span> },
          { id: "vendor", name: t("vendor.vendor"), value: x => x.vendor, cell: x => <span translate="no">{x.vendor}</span> },
          { id: "effective_date", name: t("vendor.effective"), type: "date", value: x => x.effective_date },
          { id: "new_cost", name: t("vendor.newCost"), type: "money", num: true, value: x => x.new_cost },
          { id: "previous_cost", name: t("vendor.previousCost"), type: "money", num: true, value: x => x.previous_cost },
          { id: "current_cost", name: t("vendor.itemCost"), type: "money", num: true, value: x => x.current_cost },
          { id: "change", name: t("vendor.change"), type: "money", num: true, value: x => x.change },
          { id: "change_pct", name: t("vendor.changePct"), type: "percent", num: true, value: x => x.change_pct },
          { id: "status", name: t("vendor.status"), value: x => x.status, label: statusText, cell: x => <span className={styles.pill} data-status={x.status}>{statusText(x.status)}</span> },
          { id: "volume", name: t("vendor.volume"), type: "decimal", num: true, value: x => x.volume },
          { id: "margin_impact", name: t("vendor.marginImpact"), type: "money", num: true, value: x => x.margin_impact },
          { id: "open_quotes", name: t("vendor.openQuotes"), type: "int", num: true, value: x => x.open_quotes },
          { id: "rules", name: t("vendor.rulesHit"), value: x => x.rules || null, cell: x => x.rules ? <span translate="no">{x.rules}</span> : "" },
        ]}/>
        <Pager offset={r.offset} matched={r.grid.matched} busy={review.busy} page={review.page}/>
      </>}
    </Card>
    <Card title={t("vendor.affectedQuotes")} description={t("vendor.affectedQuotesHelp")} data-testid="vendor-quotes" aria-busy={quotes.busy}>
      {quotes.error && <Notice tone="warn" role="alert">{quotes.error}</Notice>}
      {!q ? !quotes.error && <Skeleton/> : !q.rows.length && !quotes.gq.filters?.length ? <EmptyState icon="checkCircle" title={t("vendor.noQuotes")}/> : <>
        <DataGrid label={t("vendor.affectedQuotes")} testId="vendor-quotes-grid" rows={q.rows} rowKey={x => x.key} remote={{ query: quotes.gq, onQuery: quotes.query, meta: q.grid, fetch: g => client.call("vendorReviewQuotes", { sheet, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "number", name: t("quotes.number"), value: x => x.number, cell: x => <span translate="no">{x.number}</span> },
          { id: "customer_id", name: t("quotes.customer"), value: x => x.customer_id, cell: x => <span translate="no">{x.customer_id}</span> },
          { id: "status", name: t("quotes.statusLabel"), value: x => x.status, label: v => QSTATUS[v] ? t(QSTATUS[v]) : v, cell: x => QSTATUS[x.status] ? t(QSTATUS[x.status]) : x.status },
          { id: "product_id", name: t("vendor.sku"), value: x => x.product_id, cell: x => <span translate="no">{x.product_id}</span> },
          { id: "quantity", name: t("quotes.quantity"), type: "decimal", num: true, value: x => x.quantity },
          { id: "unit_price", name: t("quotes.unitPrice"), type: "money", num: true, value: x => x.unit_price },
          { id: "quote_cost", name: t("vendor.quoteCost"), type: "money", num: true, value: x => x.quote_cost },
          { id: "new_cost", name: t("vendor.newCost"), type: "money", num: true, value: x => x.new_cost },
          { id: "margin_before", name: t("vendor.marginBefore"), type: "money", num: true, value: x => x.margin_before },
          { id: "margin_after", name: t("vendor.marginAfter"), type: "money", num: true, value: x => x.margin_after, cell: x => <span data-tone={x.margin_after.startsWith("-") ? "bad" : undefined}>{money(x.margin_after)}</span> },
        ]}/>
        <Pager offset={q.offset} matched={q.grid.matched} busy={quotes.busy} page={quotes.page}/>
      </>}
    </Card>
  </>;
}

function PriceVariance({ client, version }: { client: VaultClient; version: string }) {
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [range, setRange] = useState({ from: "", to: "" }), [product, setProduct] = useState("");
  const span = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const ppv = useGrid((offset, grid) => client.call("vendorPpv", { ...span, offset, grid }), `${range.from}|${range.to}|${version}`);
  const lines = useGrid((offset, grid) => client.call("vendorPpvLines", { product, ...span, offset, grid }), product ? `${product}|${range.from}|${range.to}|${version}` : "");
  const p = ppv.view, l = lines.view;
  return <>
    <Card title={t("vendor.ppv")} description={t("vendor.ppvHelp")} data-testid="vendor-ppv" aria-busy={ppv.busy}>
      <form onSubmit={e => { e.preventDefault(); setProduct(""); setRange({ from, to }); }}><Grid min={200}>
        <Field label={t("vendor.from")}><input type="date" value={from} onChange={e => setFrom(e.target.value)}/></Field>
        <Field label={t("vendor.to")}><input type="date" value={to} onChange={e => setTo(e.target.value)}/></Field>
      </Grid><Button type="submit" variant="primary">{t("ops.apply")}</Button></form>
      <p className={styles.small}>{t("vendor.ppvMethod")}</p>
      {ppv.error && <Notice tone="warn" role="alert">{ppv.error}</Notice>}
      {!p ? !ppv.error && <Skeleton/> : !p.rows.length && !ppv.gq.filters?.length ? <EmptyState icon="inbox" title={t("vendor.noPurchases")} body={t("vendor.noPurchasesHelp")}/> : <>
        <Grid min={170} className={ui.kpis}>
          <StatTile icon="tag" label={t("vendor.skus")} value={fmt.int(p.totals.skus)}/>
          <StatTile icon="users" label={t("vendor.multiSupplier")} value={fmt.int(p.totals.multiSupplier)}/>
          <StatTile icon="trend" label={t("vendor.withSpread")} value={fmt.int(p.totals.spread)}/>
          <StatTile wide icon="coins" tone={p.totals.variance.startsWith("-") ? "ok" : p.totals.variance === "0" ? undefined : "warn"} label={t("vendor.variance")} value={money(p.totals.variance)} hint={t("vendor.noStandard", { count: fmt.int(p.totals.noStandard) })} valueProps={{ "data-testid": "ppv-total", "data-value": p.totals.variance }}/>
        </Grid>
        <DataGrid label={t("vendor.ppv")} testId="ppv-grid" rows={p.rows} rowKey={x => x.product_id} remote={{ query: ppv.gq, onQuery: ppv.query, meta: p.grid, fetch: g => client.call("vendorPpv", { ...span, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "product_id", name: t("vendor.sku"), value: x => x.product_id, cell: x => <span className={styles.wrap} translate="no">{x.product_id}{x.description ? ` · ${x.description}` : ""}</span> },
          { id: "category", name: t("vendor.category"), value: x => x.category, cell: x => <span translate="no">{x.category}</span> },
          { id: "receipts", name: t("vendor.receipts"), type: "int", num: true, value: x => x.receipts },
          { id: "suppliers", name: t("vendor.suppliers"), type: "int", num: true, value: x => x.suppliers },
          { id: "quantity", name: t("vendor.netQty"), type: "decimal", num: true, value: x => x.quantity },
          { id: "spend", name: t("vendor.netSpend"), type: "money", num: true, value: x => x.spend },
          { id: "min_unit", name: t("vendor.minUnit"), type: "money", num: true, value: x => x.min_unit },
          { id: "max_unit", name: t("vendor.maxUnit"), type: "money", num: true, value: x => x.max_unit },
          { id: "spread", name: t("vendor.spread"), type: "money", num: true, value: x => x.spread },
          { id: "avg_unit", name: t("vendor.avgUnit"), type: "money", num: true, value: x => x.avg_unit },
          { id: "standard", name: t("vendor.standard"), type: "money", num: true, value: x => x.standard },
          { id: "variance", name: t("vendor.variance"), type: "money", num: true, value: x => x.variance },
          { id: "lines", name: t("vendor.lines"), cell: x => <Button size="sm" variant="ghost" icon="chevronRight" aria-label={t("vendor.showLinesFor", { sku: x.product_id })} onClick={() => setProduct(x.product_id)} data-testid="ppv-show-lines">{t("vendor.showLines")}</Button> },
        ]}/>
        <Pager offset={p.offset} matched={p.grid.matched} busy={ppv.busy} page={ppv.page}/>
      </>}
    </Card>
    {product && <Card title={t("vendor.linesFor", { sku: product })} data-testid="ppv-lines" aria-busy={lines.busy} actions={<Button size="sm" icon="close" onClick={() => setProduct("")}>{t("common.close")}</Button>}>
      {lines.error && <Notice tone="warn" role="alert">{lines.error}</Notice>}
      {!l ? !lines.error && <Skeleton/> : <>
        <DataGrid label={t("vendor.linesFor", { sku: product })} testId="ppv-lines-grid" rows={l.rows} rowKey={x => x.key} remote={{ query: lines.gq, onQuery: lines.query, meta: l.grid, fetch: g => client.call("vendorPpvLines", { product, ...span, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "receipt_date", name: t("vendor.date"), type: "date", value: x => x.receipt_date },
          { id: "supplier", name: t("vendor.supplier"), value: x => x.supplier, cell: x => <span translate="no">{x.supplier}</span> },
          { id: "receipt_ref", name: t("vendor.receipt"), value: x => x.receipt_ref, cell: x => <span translate="no">{x.receipt_ref}</span> },
          { id: "entry_kind", name: t("vendor.kind"), value: x => x.entry_kind, label: v => KIND[v] ? t(KIND[v]) : v, cell: x => KIND[x.entry_kind] ? t(KIND[x.entry_kind]) : x.entry_kind },
          { id: "quantity", name: t("quotes.quantity"), type: "decimal", num: true, value: x => x.quantity },
          { id: "amount", name: t("vendor.amount"), type: "money", num: true, value: x => x.amount },
          { id: "unit", name: t("vendor.unitCost"), type: "money", num: true, value: x => x.unit },
          { id: "standard", name: t("vendor.standard"), type: "money", num: true, value: x => x.standard },
          { id: "variance", name: t("vendor.variance"), type: "money", num: true, value: x => x.variance },
        ]}/>
        <Pager offset={l.offset} matched={l.grid.matched} busy={lines.busy} page={lines.page}/>
      </>}
    </Card>}
  </>;
}

export function VendorsView({ client, tier, version, canImport }: { client: VaultClient; tier?: Tier; version: string; canImport: boolean }) {
  const [tab, setTab] = useState<"review" | "ppv">("review");
  useEffect(() => { const read = () => setTab(location.hash === "#vendors-ppv" ? "ppv" : "review"); read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read); }, []);
  if (tier === "starter") return <Card title={t("vendor.review")}><Notice>{t("vendor.proRequired")}</Notice></Card>;
  return <>
    <SectionTabs label={t("vendor.tabs")} current={tab} onSelect={id => setTab(id as "review" | "ppv")} items={[
      { id: "review", label: t("vendor.review"), href: "#vendors", testId: "vendor-tab-review" }, { id: "ppv", label: t("vendor.ppv"), href: "#vendors-ppv", testId: "vendor-tab-ppv" }]}/>
    {tab === "ppv" ? <PriceVariance client={client} version={version}/> : <PriceReview client={client} version={version} canImport={canImport}/>}
  </>;
}
