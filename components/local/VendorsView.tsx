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
import { CostIndexView } from "./CostIndexView";
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

type Change = { kind: "price" | "cost"; scope: "all" | "category" | "customer" | "product"; value: string; pct: string };
const SCOPE: Record<Change["scope"], MessageKey> = { all: "sim.scope.all", category: "sim.scope.category", customer: "sim.scope.customer", product: "sim.scope.product" };
type Dim = "product" | "category" | "customer" | "tier" | "month";
const DIMS: Array<{ id: Dim; label: MessageKey }> = [{ id: "category", label: "sim.dim.category" }, { id: "product", label: "sim.dim.product" }, { id: "customer", label: "sim.dim.customer" }, { id: "tier", label: "sim.dim.tier" }, { id: "month", label: "sim.dim.month" }];
const pct = (v: string | null) => v === null ? t("common.notApplicable") : fmt.percent(v);
const shift = (month: string, by: number) => { const [y, m] = month.split("-").map(Number), i = y * 12 + m - 1 + by; return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`; };

/** Historical scenario simulator (7E-2, Scale only): replays past months with price and cost changes in the worker. */
function Simulator({ client, version, operation }: { client: VaultClient; version: string; operation: (work: () => Promise<void>) => Promise<void> }) {
  const [options, setOptions] = useState<Results["simOptions"] | null>(null), [error, setError] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [changes, setChanges] = useState<Change[]>([{ kind: "price", scope: "all", value: "", pct: "2" }]), [run, setRun] = useState<Results["simRun"] | null>(null), [dim, setDim] = useState<Dim>("category"), [running, setRunning] = useState(false);
  useEffect(() => {
    let on = true; setRun(null);
    void client.call("simOptions", {}).then(v => {
      if (!on) return; setOptions(v); setRun(v.last);
      if (v.last) { setFrom(v.last.from); setTo(v.last.to); setChanges(v.last.changes.map(c => ({ kind: c.kind, scope: c.scope, value: c.value, pct: String(Number(c.bp) / 100) }))); }
      else if (v.first && v.lastMonth) { setTo(v.lastMonth); const a = shift(v.lastMonth, -11); setFrom(a < v.first ? v.first : a); }
    }).catch(e => { if (on) setError(errorText(e)); });
    return () => { on = false; };
  }, [client, version]);
  const rows = useGrid((offset, grid) => client.call("simRows", { dim, offset, grid }), run ? `${dim}|${run.from}|${run.to}|${run.ms}|${run.lines}|${JSON.stringify(run.changes)}` : "");
  const set = (i: number, patch: Partial<Change>) => setChanges(list => list.map((c, j) => j !== i ? c : { ...c, ...patch, ...(patch.kind === "cost" && c.scope === "customer" ? { scope: "all" as const, value: "" } : {}), ...(patch.scope === "all" ? { value: "" } : {}) }));
  const submit = () => void operation(async () => { setRunning(true); try { setRun(await client.call("simRun", { scenario: { from, to, changes } })); } finally { setRunning(false); } });
  if (error) return <Notice tone="warn" role="alert">{error}</Notice>;
  if (!options) return <Skeleton/>;
  if (!options.first) return <Card title={t("sim.heading")} description={t("sim.help")}><EmptyState icon="upload" title={t("sim.noSales")} body={t("sim.noSalesHelp")}/></Card>;
  const r = run;
  const metric = (id: string, label: MessageKey, a: string | null, b: string | null, isMoney = true) => ({ id, label: t(label), actual: a, scenario: b, change: isMoney && a !== null && b !== null ? String(BigInt(b) - BigInt(a)) : null, isMoney });
  const compare = r ? [metric("list", "sim.m.list", r.actual.list, r.scenario.list), metric("discount", "sim.m.discount", r.actual.discount, r.scenario.discount), metric("rebate", "sim.m.rebate", r.actual.rebate, r.scenario.rebate),
    metric("freight", "sim.m.freight", r.actual.freight, r.scenario.freight), metric("pocket", "sim.m.pocket", r.actual.pocket, r.scenario.pocket), metric("cost", "sim.m.cost", r.actual.cost, r.scenario.cost),
    metric("margin", "sim.m.margin", r.actual.margin, r.scenario.margin), metric("rate", "sim.m.rate", r.actual.rate, r.scenario.rate, false)] : [];
  return <>
    <Card title={t("sim.heading")} description={t("sim.help")} data-testid="sim" aria-busy={running}>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <Grid min={200}>
          <Field label={t("sim.from")} hint={t("sim.monthHint")}><input type="month" value={from} min={options.first ?? undefined} max={options.lastMonth ?? undefined} onChange={e => setFrom(e.target.value)} required data-testid="sim-from"/></Field>
          <Field label={t("sim.to")} hint={t("sim.dataSpan", { first: options.first ?? "", last: options.lastMonth ?? "" })}><input type="month" value={to} min={options.first ?? undefined} max={options.lastMonth ?? undefined} onChange={e => setTo(e.target.value)} required data-testid="sim-to"/></Field>
        </Grid>
        <h3 className={styles.small}>{t("sim.changes")}</h3>
        <datalist id="sim-categories">{options.categories.map(c => <option key={c} value={c}/>)}</datalist>
        {changes.map((c, i) => <div key={i} data-testid="sim-change"><Grid min={160}>
          <Field label={t("sim.kind")}><select value={c.kind} onChange={e => set(i, { kind: e.target.value as Change["kind"] })} data-testid="sim-kind"><option value="price">{t("sim.kind.price")}</option><option value="cost">{t("sim.kind.cost")}</option></select></Field>
          <Field label={t("sim.scope")}><select value={c.scope} onChange={e => set(i, { scope: e.target.value as Change["scope"] })} data-testid="sim-scope">{(Object.keys(SCOPE) as Change["scope"][]).filter(k => c.kind === "price" || k !== "customer").map(k => <option key={k} value={k}>{t(SCOPE[k])}</option>)}</select></Field>
          {c.scope !== "all" && <Field label={t("sim.value")}><input value={c.value} maxLength={200} required list={c.scope === "category" ? "sim-categories" : undefined} onChange={e => set(i, { value: e.target.value })} data-testid="sim-value" translate="no"/></Field>}
          <Field label={t("sim.percent")} hint={t("sim.percentHint")}><input value={c.pct} inputMode="decimal" required pattern="[+\-]?[0-9]{1,3}([.][0-9]{1,2})?" onChange={e => set(i, { pct: e.target.value })} data-testid="sim-pct"/></Field>
        </Grid>
          <Button size="sm" variant="ghost" icon="close" disabled={changes.length < 2} aria-label={t("sim.removeChange", { n: fmt.int(i + 1) })} onClick={() => setChanges(list => list.filter((_, j) => j !== i))}>{t("sim.remove")}</Button>
        </div>)}
        <div className={styles.row}>
          <Button size="sm" icon="sparkle" disabled={changes.length >= 20} onClick={() => setChanges(list => [...list, { kind: "price", scope: "category", value: "", pct: "0" }])} data-testid="sim-add">{t("sim.addChange")}</Button>
          <Button type="submit" variant="primary" icon="flask" disabled={running || !from || !to} data-testid="sim-run">{t("sim.run")}</Button>
        </div>
        <p className={styles.small}>{t("sim.method")}</p>
      </form>
    </Card>
    {r && <Card title={t("sim.results", { from: r.from, to: r.to })} description={t("sim.resultsHelp")} data-testid="sim-results">
      <Grid min={170} className={ui.kpis}>
        <StatTile icon="tag" label={t("sim.lines")} value={fmt.int(r.lines)} hint={t("sim.changedLines", { count: fmt.int(r.changedLines) })} valueProps={{ "data-testid": "sim-lines" }}/>
        <StatTile icon="coins" label={t("sim.actualMargin")} value={money(r.actual.margin)} hint={pct(r.actual.rate)} valueProps={{ "data-testid": "sim-actual-margin", "data-value": r.actual.margin }}/>
        <StatTile icon="flask" label={t("sim.scenarioMargin")} value={money(r.scenario.margin)} hint={pct(r.scenario.rate)} valueProps={{ "data-testid": "sim-scenario-margin", "data-value": r.scenario.margin }}/>
        <StatTile wide icon="trend" tone={r.delta.margin.startsWith("-") ? "bad" : r.delta.margin === "0" ? undefined : "ok"} label={t("sim.marginChange")} value={money(r.delta.margin)} hint={t("sim.pocketChange", { amount: money(r.delta.pocket) })} valueProps={{ "data-testid": "sim-margin-change", "data-value": r.delta.margin }}/>
      </Grid>
      {r.uncostedLines !== "0" && <Notice tone="warn">{t("sim.uncosted", { count: fmt.int(r.uncostedLines) })}</Notice>}
      <DataGrid label={t("sim.compare")} testId="sim-compare-grid" rows={compare} rowKey={x => x.id} columns={[
        { id: "label", name: t("sim.measure"), value: x => x.label },
        { id: "actual", name: t("sim.actual"), type: "money", num: true, value: x => x.isMoney ? x.actual : null, cell: x => x.isMoney ? money(x.actual) : pct(x.actual) },
        { id: "scenario", name: t("sim.scenario"), type: "money", num: true, value: x => x.isMoney ? x.scenario : null, cell: x => x.isMoney ? money(x.scenario) : pct(x.scenario) },
        { id: "change", name: t("sim.change"), type: "money", num: true, value: x => x.change, cell: x => x.isMoney ? money(x.change) : "" },
      ]}/>
    </Card>}
    {r && <Card title={t("sim.breakdown")} data-testid="sim-breakdown" aria-busy={rows.busy} actions={<select aria-label={t("sim.breakdownBy")} value={dim} onChange={e => setDim(e.target.value as Dim)} data-testid="sim-dim">{DIMS.map(d => <option key={d.id} value={d.id}>{t(d.label)}</option>)}</select>}>
      {rows.error && <Notice tone="warn" role="alert">{rows.error}</Notice>}
      {!rows.view ? !rows.error && <Skeleton/> : <>
        <DataGrid label={t("sim.breakdown")} testId="sim-grid" rows={rows.view.rows} rowKey={x => x.key} remote={{ query: rows.gq, onQuery: rows.query, meta: rows.view.grid, fetch: g => client.call("simRows", { dim, offset: 0, grid: g }).then(v => v.grid) }} columns={[
          { id: "key", name: t(DIMS.find(d => d.id === dim)!.label), value: x => x.key, cell: x => <span className={styles.wrap} translate="no">{x.key || t("sim.none")}{x.label ? ` · ${x.label}` : ""}</span> },
          { id: "lines", name: t("sim.lines"), type: "int", num: true, value: x => x.lines },
          { id: "changed", name: t("sim.changed"), type: "int", num: true, value: x => x.changed },
          { id: "actual_pocket", name: t("sim.actualPocket"), type: "money", num: true, value: x => x.actual_pocket },
          { id: "scenario_pocket", name: t("sim.scenarioPocket"), type: "money", num: true, value: x => x.scenario_pocket },
          { id: "actual_margin", name: t("sim.actualMargin"), type: "money", num: true, value: x => x.actual_margin },
          { id: "scenario_margin", name: t("sim.scenarioMargin"), type: "money", num: true, value: x => x.scenario_margin },
          { id: "margin_change", name: t("sim.marginChange"), type: "money", num: true, value: x => x.margin_change },
          { id: "actual_rate", name: t("sim.actualRate"), type: "percent", num: true, value: x => x.actual_rate, cell: x => pct(x.actual_rate) },
          { id: "scenario_rate", name: t("sim.scenarioRate"), type: "percent", num: true, value: x => x.scenario_rate, cell: x => pct(x.scenario_rate) },
          { id: "uncosted", name: t("sim.uncostedCol"), type: "int", num: true, value: x => x.uncosted },
        ]}/>
        <Pager offset={rows.view.offset} matched={rows.view.grid.matched} busy={rows.busy} page={rows.page}/>
      </>}
    </Card>}
  </>;
}

export function VendorsView({ client, tier, version, canImport, canSimulate, canPrice = false, busy = false, operation }: { client: VaultClient; tier?: Tier; version: string; canImport: boolean; canSimulate: boolean; canPrice?: boolean; busy?: boolean; operation: (work: () => Promise<void>) => Promise<void> }) {
  const [tab, setTab] = useState<"review" | "ppv" | "sim" | "index">("review");
  useEffect(() => { const read = () => setTab(location.hash === "#vendors-ppv" ? "ppv" : location.hash === "#vendors-sim" ? "sim" : location.hash === "#vendors-index" ? "index" : "review"); read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read); }, []);
  if (tier === "starter") return <Card title={t("vendor.review")}><Notice>{t("vendor.proRequired")}</Notice></Card>;
  return <>
    <SectionTabs label={t("vendor.tabs")} current={tab} onSelect={id => setTab(id as "review" | "ppv" | "sim" | "index")} items={[
      { id: "review", label: t("vendor.review"), href: "#vendors", testId: "vendor-tab-review" }, { id: "ppv", label: t("vendor.ppv"), href: "#vendors-ppv", testId: "vendor-tab-ppv" },
      ...(canSimulate ? [{ id: "sim", label: t("sim.tab"), href: "#vendors-sim", testId: "vendor-tab-sim" }] : []),
      { id: "index", label: t("index.tab"), href: "#vendors-index", testId: "vendor-tab-index" }]}/>
    {tab === "index" ? <CostIndexView client={client} version={version} canPrice={canPrice} canImport={canImport} busy={busy} operation={operation}/>
      : tab === "sim" && canSimulate ? tier === "scale" ? <Simulator client={client} version={version} operation={operation}/> : <Card title={t("sim.heading")}><Notice data-testid="sim-scale-required">{t("sim.needScale")}</Notice></Card>
      : tab === "ppv" ? <PriceVariance client={client} version={version}/> : <PriceReview client={client} version={version} canImport={canImport}/>}
  </>;
}
