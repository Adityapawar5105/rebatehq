"use client";
// Quote Desk and Price Check (chunk 7B). Cost and margin appear only when the worker sends them,
// which it does only for the "cost" capability (decision 16): this screen never derives them.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Cap } from "@/lib/roles/access";
import type { Guard, LineInput, PricePoint, PriceSource, QuoteStatus, QuoteSummary, QuoteView } from "@/lib/quotes/quotes";
import type { CreditSignal } from "@/lib/quotes/credit";
import type { Basis, Reason } from "@/lib/quotes/guidance";
import type { Results } from "@/lib/vault/protocol";
import { fmt, getLocale, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
import { OutcomePanel, WinLossReport } from "./WinLoss";
import { Lookup } from "./Lookup";
import { Badge, Button, Card, Field, Notice, type Tone } from "@/components/ui/ui";
import { markSubPage, pageOfHash } from "./subtabs";
import { Icon } from "@/components/ui/Icon";

type Op = (f: () => Promise<void>) => Promise<void>;
type Tab = "check" | "new" | "inbox" | "history" | "winloss";
const TAB: Record<Tab, MessageKey> = { check: "quotes.tab.check", new: "quotes.tab.new", inbox: "quotes.tab.inbox", history: "quotes.tab.history", winloss: "winloss.tab" };
const GUARD: Record<Guard, MessageKey> = { green: "quotes.zone.green", yellow: "quotes.zone.yellow", red: "quotes.zone.red", unset: "quotes.zone.unset" };
const SOURCE: Record<PriceSource, MessageKey> = { customer: "quotes.source.customer", tier: "quotes.source.tier", category: "quotes.source.category", list: "quotes.source.list", none: "quotes.source.none" };
const STATUS: Record<QuoteStatus, MessageKey> = { draft: "quotes.status.draft", submitted: "quotes.status.submitted", pending: "quotes.status.pending", approved: "quotes.status.approved", rejected: "quotes.status.rejected" };
const ANSWER: Record<Guard, MessageKey> = { green: "quotes.answer.green", yellow: "quotes.answer.yellow", red: "quotes.answer.red", unset: "quotes.answer.unset" };
// 8.13: the status pill takes the tone of the status, so a waiting or rejected quote stands out.
const STATUS_TONE: Record<QuoteStatus, Tone> = { draft: "info", submitted: "accent", pending: "warn", approved: "ok", rejected: "bad" };
const CREDIT: Record<CreditSignal["level"], MessageKey> = { green: "quotes.credit.green", amber: "quotes.credit.amber", red: "quotes.credit.red", unknown: "quotes.credit.unknown" };
// Style hooks use tone names, not colour words (theme test: colours come only from tokens).
const TONE: Record<string, string> = { green: "ok", yellow: "warn", amber: "warn", red: "bad" };
/** Hands a file built in the worker to the browser as a download (nothing is uploaded). */
const saveFile = (name: string, blob: Blob) => { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); };
const money = (v: string | null | undefined) => v === null || v === undefined ? t("quotes.none") : fmt.currency(v);

/** A typed price ("12.34" or "12,34") to whole cents, or null when it is not a valid amount. */
export function priceToCents(text: string): string | null {
  const v = text.trim().replace(/,(\d{1,2})$/, ".$1");
  const m = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(v);
  return m ? (BigInt(m[1]) * BigInt(100) + BigInt((m[2] || "").padEnd(2, "0"))).toString() : null;
}
const trimQty = (q: string) => q.includes(".") ? q.replace(/0+$/, "").replace(/\.$/, "") : q;
const centsToText = (c: string) => { const n = BigInt(c); return `${n / BigInt(100)}.${(n % BigInt(100)).toString().padStart(2, "0")}`; };

/** Where a price sits against floor, target and start. Prices only: no cost is involved.
 *  8.7: the marker carries the price, each boundary is labelled where it sits, and one line says how far above or below the floor. */
export function Thermometer({ value, floor, target, start, label }: { value: string | null; floor: string | null; target: string | null; start: string | null; label: string }) {
  if (value === null || floor === null || target === null || start === null) return <p className={styles.muted}>{t("quotes.noGuardrail")}</p>;
  const f = Number(floor), tg = Number(target), s = Number(start), v = Number(value), span = Math.max(s - f, 1);
  const lo = Math.max(0, f - span * 0.25), hi = s + span * 0.15, at = (x: number) => Math.min(100, Math.max(0, (x - lo) / (hi - lo) * 100));
  const zone: Guard = v < f ? "red" : v < tg ? "yellow" : "green";
  // A label near either end is pinned inside the bar, so it never pushes the page sideways on a phone.
  const place = (pct: number) => ({ left: `${pct}%`, transform: `translateX(${pct < 12 ? "0" : pct > 88 ? "-100%" : "-50%"})` });
  const gap = centsGap(value, floor);
  return <div className={styles.thermo} role="meter" aria-label={label} aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={Math.min(hi, Math.max(lo, v))} aria-valuetext={t("quotes.meterText", { zone: t(GUARD[zone]), price: fmt.currency(value) })}>
    <div className={styles.thermoMarkRow} aria-hidden="true"><span className={styles.thermoMarkLabel} style={place(at(v))}>{fmt.currency(value)}</span></div>
    <div className={styles.thermoTrack} aria-hidden="true">
      <span className={styles.thermoRed} style={{ width: `${at(f)}%` }}/>
      <span className={styles.thermoYellow} style={{ left: `${at(f)}%`, width: `${at(tg) - at(f)}%` }}/>
      <span className={styles.thermoGreen} style={{ left: `${at(tg)}%`, width: `${100 - at(tg)}%` }}/>
      <span className={styles.thermoMark} style={{ left: `${at(v)}%` }}/>
    </div>
    <div className={styles.thermoScale} aria-hidden="true">
      <span style={place(at(f))}>{t("quotes.floorShort", { price: fmt.currency(floor) })}</span>
      <span style={place(at(s))}>{t("quotes.startShort", { price: fmt.currency(start) })}</span>
      <span className={styles.thermoScaleLow} style={place(at(tg))}>{t("quotes.targetShort", { price: fmt.currency(target) })}</span>
    </div>
    {gap && <p className={styles.thermoNote} data-testid="thermo-gap">{t(gap.above ? "quotes.aboveFloor" : "quotes.belowFloor", { amount: fmt.currency(gap.cents) })}</p>}
  </div>;
}
/** The distance between two whole-cent prices, kept exact with BigInt. */
function centsGap(value: string, floor: string): { above: boolean; cents: string } | null {
  try { const d = BigInt(value) - BigInt(floor); return { above: d >= BigInt(0), cents: (d < BigInt(0) ? -d : d).toString() }; } catch { return null; }
}

function Zone({ guard }: { guard: Guard }) { return <span className={styles.pill} data-tone={TONE[guard] ?? "none"} data-zone={guard}>{t(GUARD[guard])}</span>; }
/** 8.7: the one answer a rep reads first, as a large pill with a plain sentence. */
function Answer({ guard }: { guard: Guard }) { return <p className={styles.answer}><span className={styles.pill} data-size="lg" data-tone={TONE[guard] ?? "none"} data-testid="quote-answer" data-zone={guard}>{t(ANSWER[guard])}</span></p>; }

/** 8.7: credit as one chip with an icon, the level in words, the date and the first reason; "More" opens the rest. */
function Credit({ credit }: { credit: CreditSignal }) {
  const [first, ...rest] = credit.reasons;
  return <div className={styles.creditChip} data-tone={TONE[credit.level] ?? "none"} data-level={credit.level} data-testid="credit-signal">
    <Icon name={credit.level === "green" ? "checkCircle" : credit.level === "unknown" ? "info" : "alert"} size={15}/>
    <strong>{t(CREDIT[credit.level])}</strong>{credit.asOf && <span className={styles.muted}>{t("quotes.credit.asOf", { date: fmt.date(credit.asOf) })}</span>}
    {first && <span>{say(first)}</span>}
    {rest.length > 0 && <details><summary>{t("quotes.credit.more")}</summary><ul>{rest.map(r => <li key={r}>{say(r)}</li>)}</ul></details>}
  </div>;
}
/** 8A: one guidance reason as a sentence in the user's language and the workspace currency. */
function reasonText(r: Reason) {
  const used = "used" in r && r.used ? " " + t("guidance.usedTag") : "";
  switch (r.code) {
    case "history": return t("guidance.r.history", { count: fmt.int(r.count), price: money(r.cents), date: fmt.date(r.date) }) + used;
    case "similar": return t("guidance.r.similar", { tier: r.tier, price: money(r.cents), count: fmt.int(r.count), customers: fmt.int(r.customers) }) + used;
    case "target": return (r.floorCents === null ? t("guidance.r.targetNoFloor", { price: money(r.cents) }) : t("guidance.r.target", { price: money(r.cents), floor: money(r.floorCents) })) + used;
    case "book": return t("guidance.r.book", { price: money(r.cents) }) + used;
    case "costRise": return t(r.applied ? "guidance.r.costRiseApplied" : "guidance.r.costRise");
    case "floor": return t("guidance.r.floor", { price: money(r.cents) });
    case "start": return t("guidance.r.start", { price: money(r.cents) });
    default: return t("guidance.r.none");
  }
}
const BASIS: Record<Basis, MessageKey> = { history: "guidance.basis.history", similar: "guidance.basis.similar", target: "guidance.basis.target", book: "guidance.basis.book", none: "guidance.basis.none" };

export function QuotesView({ client, userId, caps, tier, busy, operation, relayEnabled = false }: { client: VaultClient; userId: string; caps: Cap[]; tier: string | undefined; busy: boolean; operation: Op; relayEnabled?: boolean }) {
  // Sharing works only when the server has the relay on and this role may collaborate; otherwise no one else can see a quote.
  const canApprove = caps.includes("quoteApprove"), seesCost = caps.includes("cost"), canShare = caps.includes("collaborate") && relayEnabled;
  const tabs: Tab[] = ["check", "new", ...(canApprove ? ["inbox" as const] : []), "history", "winloss"];
  const [tab, setTab] = useState<Tab>("check"), [note, setNote] = useState("");
  // "#quotes-<tab>" opens a tab (Home > Create new, the command palette); "#quotes-open-<id>" (a Home work-list row) opens that quote;
  // "#quotes-check-product-<id>" or "#quotes-check-customer-<id>" (a Sales Rep's palette pick) opens Price Check with the field filled.
  useEffect(() => {
    const read = () => {
      const m = /^#quotes-open-(.+)$/.exec(location.hash), tabHash = /^#quotes-(check|new|inbox|history|winloss)$/.exec(location.hash), fill = /^#quotes-check-(product|customer)-(.+)$/.exec(location.hash);
      if (m) open(decodeURIComponent(m[1]));
      else if (fill) { const v = decodeURIComponent(fill[2]); setCheck(c => fill[1] === "product" ? { ...c, productId: v } : { ...c, customerId: v }); setTab("check"); }
      else if (tabHash && tabs.includes(tabHash[1] as Tab)) { setNote(""); setTab(tabHash[1] as Tab); }
      else if (location.hash === "#quotes") { setNote(""); setTab("check"); } // the sidebar's Quotes link opens the first page
    };
    read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The page list is in the sidebar (23 Nov 2026): when this view moves itself (an opened quote shows on the Quote page),
  // the address bar follows so the sidebar and breadcrumb mark the right page.
  useEffect(() => {
    const now = location.hash.slice(1);
    if (now.startsWith("quotes") && pageOfHash(now, tabs.map(x => ({ hash: "quotes-" + x }))) !== "quotes-" + tab) markSubPage("quotes-" + tab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [check, setCheck] = useState({ productId: "", customerId: "", quantity: "1" }), [point, setPoint] = useState<PricePoint | null>(null);
  const [customer, setCustomer] = useState(""), [quote, setQuote] = useState<QuoteView | null>(null), [lines, setLines] = useState<{ productId: string; quantity: string; price: string }[]>([]);
  const [add, setAdd] = useState({ productId: "", quantity: "1" }), [reason, setReason] = useState(""), [decisionNote, setDecisionNote] = useState("");
  const [list, setList] = useState<QuoteSummary[]>([]), [confirmNew, setConfirmNew] = useState(false);
  // 11.2: the validity date being typed; it follows the open quote.
  const [validity, setValidity] = useState("");
  useEffect(() => { setValidity(quote?.validUntil ?? ""); }, [quote?.id, quote?.validUntil]);
  // 8A: guidance and cross-sell for the open quote, refreshed whenever its lines change.
  const [guide, setGuide] = useState<Results["quoteGuidance"] | null>(null), [cross, setCross] = useState<Results["quoteCrossSell"] | null>(null);
  const quoteKey = quote ? `${quote.id}|${quote.updatedAt}|${quote.lines.map(l => l.productId + ":" + l.unitCents).join(",")}` : "";
  useEffect(() => {
    if (!quote || !quote.lines.length) { setGuide(null); setCross(null); return; }
    let on = true;
    void Promise.all([client.call("quoteGuidance", { id: quote.id }), client.call("quoteCrossSell", { id: quote.id })]).then(([g, x]) => { if (on) { setGuide(g); setCross(x); } }).catch(() => { if (on) { setGuide(null); setCross(null); } });
    return () => { on = false; };
  }, [client, quoteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async (pendingOnly: boolean) => setList(await client.call("quoteList", { pendingOnly }));
  useEffect(() => { if (tab === "inbox" || tab === "history") void load(tab === "inbox").catch(e => setNote(e instanceof Error ? e.message : msg("common.operationFailed"))); }, [tab, client]);
  if (tier === "starter") return <Card title={t("quotes.heading")}><p>{t("quotes.needsProfessional")}</p></Card>;

  const show = (v: QuoteView) => { setQuote(v); setLines(v.lines.map(l => ({ productId: l.productId, quantity: trimQty(l.quantity), price: centsToText(l.unitCents) }))); };
  // The worker says which moves this person can make next; the buttons follow that list only.
  const next = quote?.allowedNext ?? [], editable = next.includes("edit");
  // Typed quantities and prices that differ from the saved lines. Submit saves them first, so a typed price is never dropped.
  const dirty = !!quote && editable && (lines.length !== quote.lines.length || lines.some((l, i) => l.quantity.trim() !== trimQty(quote.lines[i].quantity) || l.price.trim() !== centsToText(quote.lines[i].unitCents)));
  const save = async (changed: typeof lines): Promise<QuoteView | null> => {
    const input: LineInput[] = [];
    for (const l of changed) {
      const unit = l.price.trim() === "" ? null : priceToCents(l.price);
      if (l.price.trim() !== "" && unit === null) { setNote(msg("quotes.priceFormat")); return null; }
      input.push({ productId: l.productId, quantity: l.quantity, unitCents: unit });
    }
    const v = await client.call("quoteLines", { id: quote!.id, lines: input }); show(v); return v;
  };
  const submit = async () => {
    let v: QuoteView | null = quote;
    if (dirty) { v = await save(lines); if (!v) return; }
    // A typed price can take a line below its floor: then the reason box appears and nothing is sent yet.
    if (v!.needsApproval && !reason.trim()) { setNote(msg("quotes.reasonNowNeeded")); return; }
    show(await client.call("quoteSubmit", { id: v!.id, reason: reason.trim() || null })); setNote(msg(v!.needsApproval ? "quotes.exceptionRequested" : "quotes.submitted"));
  };
  const open = (id: string) => void operation(async () => { show(await client.call("quoteGet", { id })); setTab("new"); });

  const reset = () => { setConfirmNew(false); setQuote(null); setLines([]); setReason(""); setDecisionNote(""); };
  return <>
    <p role="status">{say(note)}</p>
    <div>

    {tab === "check" && <Card title={t("quotes.check.heading")} headingId="price-check-heading" description={t("quotes.check.body")}>
      <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); void operation(async () => { setPoint(await client.call("priceCheck", { productId: check.productId.trim(), customerId: check.customerId.trim() || null, quantity: check.quantity.trim() || "1" })); }); }}>
        <Lookup client={client} kind="product" label={t("quotes.sku")} value={check.productId} onChange={v => setCheck(c => ({ ...c, productId: v }))} testId="check-sku"/>
        <Lookup client={client} kind="customer" label={t("quotes.customer")} value={check.customerId} onChange={v => setCheck(c => ({ ...c, customerId: v }))} testId="check-customer"/>
        <Field label={t("quotes.quantity")}><input value={check.quantity} inputMode="decimal" onChange={e => setCheck({ ...check, quantity: e.target.value })} maxLength={20}/></Field>
        <Button variant="primary" type="submit" disabled={busy || !check.productId.trim()}>{t("quotes.check.run")}</Button>
      </form>
      {/* 11.4: the chosen customer's book prices at quantity 1, as a file (prices only). */}
      <div className={styles.row} data-testid="price-list-export">
        <span className={styles.muted}>{t("qdoc.priceListHelp")}</span>
        <Button size="sm" icon="download" disabled={busy || !check.customerId.trim()} data-testid="price-list-csv" onClick={() => void operation(async () => { const f = await client.call("priceList", { customerId: check.customerId.trim(), format: "csv" }); saveFile(f.name, f.blob); setNote(msg("qdoc.priceListSaved", { count: f.rows })); })}>{t("qdoc.priceListCsv")}</Button>
        <Button size="sm" icon="download" disabled={busy || !check.customerId.trim()} data-testid="price-list-xlsx" onClick={() => void operation(async () => { const f = await client.call("priceList", { customerId: check.customerId.trim(), format: "xlsx" }); saveFile(f.name, f.blob); setNote(msg("qdoc.priceListSaved", { count: f.rows })); })}>{t("qdoc.priceListXlsx")}</Button>
      </div>
      {point && <div data-testid="price-check-result" data-zone={point.guard}>
        <h3><span translate="no">{point.productId}</span> {point.description}</h3>
        <Answer guard={point.guard}/>
        <p>{t("quotes.bookPrice", { price: money(point.bookCents), source: t(SOURCE[point.source]) })}</p>
        {point.customerId && <div className={styles.row}><span>{t("quotes.customerTier", { name: point.customerName || point.customerId, tier: point.tier || t("quotes.none") })}</span><Credit credit={point.credit}/></div>}
        <Thermometer value={point.bookCents} floor={point.floorCents} target={point.targetCents} start={point.startCents} label={t("quotes.meterLabel", { sku: point.productId })}/>
      </div>}
    </Card>}

    {tab === "new" && !quote && <Card title={t("quotes.new.heading")} headingId="new-quote-heading">
      <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); void operation(async () => { show(await client.call("quoteCreate", { customerId: customer.trim() })); }); }}>
        <Lookup client={client} kind="customer" label={t("quotes.customer")} value={customer} onChange={setCustomer} testId="quote-customer"/>
        <Button variant="primary" type="submit" disabled={busy || !customer.trim()}>{t("quotes.new.start")}</Button>
      </form></Card>}

    {tab === "new" && quote && <Card headingId="quote-heading" data-testid="quote" data-status={quote.status}
      title={<><span translate="no">{quote.number}</span> <Badge tone={STATUS_TONE[quote.status]} data-testid="quote-status">{t(STATUS[quote.status])}</Badge> <Zone guard={quote.worst}/></>}
      actions={<>
        {/* Phase 11: copy, revise a sent quote as a new version, and the customer PDF (prices only). */}
        {next.includes("pdf") && <Button icon="download" disabled={busy} data-testid="quote-pdf" onClick={() => void operation(async () => { const f = await client.call("quotePdf", { id: quote.id, locale: getLocale() }); saveFile(f.name, new Blob([f.bytes as BlobPart], { type: "application/pdf" })); setNote(msg("qdoc.pdfSaved", { name: f.name })); })}>{t("qdoc.pdfButton")}</Button>}
        {next.includes("revise") && <Button disabled={busy} data-testid="quote-revise" onClick={() => void operation(async () => { show(await client.call("quoteRevise", { id: quote.id })); setReason(""); setDecisionNote(""); setNote(msg("qdoc.revised")); })}>{t("qdoc.reviseButton")}</Button>}
        {next.includes("copy") && <Button disabled={busy || dirty} data-testid="quote-copy" onClick={() => void operation(async () => { show(await client.call("quoteCopy", { id: quote.id })); setReason(""); setDecisionNote(""); setNote(msg("qdoc.copied")); })}>{t("qdoc.copyButton")}</Button>}
        <Button icon="plus" disabled={busy} data-testid="quote-new-another" onClick={() => { if (dirty) setConfirmNew(true); else reset(); }}>{t("quotes.new.another")}</Button></>}>
      {confirmNew && <Notice tone="warn" role="alert" data-testid="quote-discard-confirm" title={t("quotes.discard.title")} actions={<>
        <Button variant="danger" size="sm" onClick={reset}>{t("quotes.discard.yes")}</Button>
        <Button size="sm" onClick={() => setConfirmNew(false)}>{t("quotes.discard.no")}</Button></>}>{t("quotes.discard.body")}</Notice>}
      <Answer guard={quote.worst}/>
      <div className={styles.row}><span>{t("quotes.customerTier", { name: quote.customerName || quote.customerId, tier: quote.tier || t("quotes.none") })}</span><Credit credit={quote.credit}/></div>
      <div className={styles.row} data-testid="quote-validity">
        {quote.validUntil ? <Badge tone={quote.expired ? "bad" : "info"} data-testid="quote-valid-until" data-expired={quote.expired ? "yes" : "no"}>{t(quote.expired ? "qdoc.expiredOn" : "qdoc.validUntilShort", { date: fmt.date(quote.validUntil) })}</Badge> : <span className={styles.muted}>{t("qdoc.noValidity")}</span>}
        {quote.revisionOf && <span className={styles.muted} data-testid="quote-revision-of">{t("qdoc.revisionOfLine", { number: quote.revisionOf.number })}</span>}
      </div>
      {editable && <form className={styles.quoteForm} data-testid="quote-validity-form" onSubmit={e => { e.preventDefault(); void operation(async () => { show(await client.call("quoteValidity", { id: quote.id, validUntil: validity || null })); setNote(msg("qdoc.validitySaved")); }); }}>
        <Field label={t("qdoc.validUntil")}><input type="date" value={validity} onChange={e => setValidity(e.target.value)} data-testid="quote-validity-input"/></Field>
        <Button type="submit" disabled={busy || validity === (quote.validUntil ?? "")}>{t("qdoc.validitySave")}</Button>
      </form>}
      {quote.warnings.length > 0 && <Notice tone="warn" role="note"><ul>{quote.warnings.map(w => <li key={w}>{say(w)}</li>)}</ul></Notice>}
      <dl className={styles.totals}>
        <div><dt>{t("quotes.total")}</dt><dd data-testid="quote-total">{fmt.currency(quote.totalCents)}</dd></div>
        <div><dt>{t("quotes.position")}</dt><dd>{quote.positionBp === null ? t("quotes.none") : fmt.percent((Number(quote.positionBp) / 100).toFixed(1))}</dd></div>
        {seesCost && <div><dt>{t("quotes.margin")}</dt><dd data-testid="quote-margin">{quote.marginRate == null ? t("quotes.none") : fmt.percent(quote.marginRate)}</dd></div>}
        {seesCost && <div><dt>{t("quotes.marginAmount")}</dt><dd>{money(quote.marginCents)}</dd></div>}
      </dl>
      {seesCost && !!quote.uncostedLines && <p className={styles.muted}>{t("quotes.uncosted", { count: quote.uncostedLines })}</p>}
      <DataGrid label={t("quotes.linesLabel")} testId="quote-lines" rows={quote.lines} rowKey={l => String(l.lineNo)} rowProps={l => ({ "data-zone": l.guard })} columns={[
        // 8.14: the row shows the zone pill; the thermometer opens with the row's "Price position" detail instead of drawing in every row.
        { id: "sku", name: t("quotes.sku"), value: l => l.productId, cell: l => <span className={styles.wrap}><span translate="no">{l.productId}</span><br/><span className={styles.muted}>{l.description}</span>
          <details className={styles.lineDetail} data-testid={`line-position-${l.lineNo}`}><summary>{t("quotes.positionDetail")}</summary><Thermometer value={l.unitCents} floor={l.floorCents} target={l.targetCents} start={l.startCents} label={t("quotes.meterLabel", { sku: l.productId })}/></details></span> },
        { id: "quantity", name: t("quotes.quantity"), type: "decimal", value: l => trimQty(l.quantity), cell: l => { const i = quote.lines.indexOf(l); return editable ? <input aria-label={t("quotes.quantityFor", { sku: l.productId })} inputMode="decimal" value={lines[i]?.quantity ?? ""} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}/> : fmt.decimal(trimQty(l.quantity)); } },
        { id: "unit", name: t("quotes.unitPrice"), type: "money", value: l => String(l.unitCents), cell: l => { const i = quote.lines.indexOf(l); return editable ? <input aria-label={t("quotes.priceFor", { sku: l.productId })} inputMode="decimal" value={lines[i]?.price ?? ""} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} data-testid={`price-${l.lineNo}`}/> : fmt.currency(l.unitCents); } },
        { id: "book", name: t("quotes.book"), type: "money", value: l => l.bookCents === null || l.bookCents === undefined ? null : String(l.bookCents), cell: l => <>{money(l.bookCents)}<br/><span className={styles.muted}>{t(SOURCE[l.source])}</span></> },
        { id: "zone", name: t("quotes.zone"), value: l => t(GUARD[l.guard]), cell: l => <Zone guard={l.guard}/> },
        { id: "suggested", name: t("guidance.column"), type: "money", value: l => guide?.lines.find(g => g.lineNo === l.lineNo)?.suggestedCents ?? null, cell: l => {
          const g = guide?.lines.find(x => x.lineNo === l.lineNo), i = quote.lines.indexOf(l);
          if (!g) return "";
          return <div className={styles.wrap} data-testid={`guidance-${l.lineNo}`} data-suggested={g.suggestedCents ?? ""} data-basis={g.basis}>
            {g.suggestedCents === null ? t("guidance.basis.none") : <><strong>{money(g.suggestedCents)}</strong><br/><span className={styles.muted}>{t(BASIS[g.basis])}</span></>}
            <details><summary>{t("guidance.why")}</summary><ul className={styles.small}>{g.reasons.map((r, n) => <li key={n}>{reasonText(r)}</li>)}</ul></details>
            {editable && g.suggestedCents !== null && g.suggestedCents !== String(l.unitCents) && <Button size="sm" disabled={busy} aria-label={t("guidance.useFor", { sku: l.productId })} data-testid={`guidance-use-${l.lineNo}`}
              onClick={() => void operation(async () => { await save(lines.map((x, j) => j === i ? { ...x, price: centsToText(g.suggestedCents!) } : x)); })}>{t("guidance.use")}</Button>}
          </div>;
        } },
        { id: "total", name: t("quotes.lineTotal"), type: "money", value: l => String(l.totalCents) },
        ...(seesCost ? [{ id: "margin", name: t("quotes.lineMargin"), type: "percent" as const, value: (l: QuoteView["lines"][number]) => l.marginRate == null ? null : String(l.marginRate), cell: (l: QuoteView["lines"][number]) => l.marginRate == null ? t("quotes.none") : fmt.percent(l.marginRate) }] : []),
        ...(editable ? [{ id: "actions", name: t("quotes.actions"), cell: (l: QuoteView["lines"][number]) => <Button size="sm" variant="ghost" disabled={busy} onClick={() => void operation(async () => { await save(lines.filter((_, j) => j !== quote.lines.indexOf(l))); })}>{t("quotes.remove")}</Button> }] : []),
      ]}/>
      {quote.lines.length > 0 && <p className={styles.small}>{t("guidance.note")}</p>}
      {quote.lines.length > 0 && cross && <section aria-labelledby="cross-heading" data-testid="cross-sell">
        <h3 id="cross-heading">{t("cross.heading")}</h3><p className={styles.small}>{t("cross.help")}</p>
        {!cross.suggestions.length ? <p className={styles.muted} data-testid="cross-sell-empty">{t("cross.none")}</p> :
        <DataGrid label={t("cross.heading")} testId="cross-sell-grid" rows={cross.suggestions} rowKey={x => x.productId} columns={[
          { id: "item", name: t("cross.item"), value: x => x.productId, cell: x => <span className={styles.wrap}><span translate="no">{x.productId}</span>{x.description ? <><br/><span className={styles.muted}>{x.description}</span></> : null}</span> },
          { id: "basedOn", name: t("cross.basedOn"), value: x => x.basedOn, cell: x => <span translate="no">{x.basedOn}</span> },
          { id: "together", name: t("cross.together"), type: "int", num: true, value: x => x.together },
          { id: "confidence", name: t("cross.confidence"), type: "percent", num: true, value: x => x.confidence, cell: x => fmt.percent(x.confidence) },
          { id: "lift", name: t("cross.lift"), type: "decimal", num: true, value: x => x.lift, cell: x => fmt.decimal(x.lift) },
          ...(editable ? [{ id: "add", name: t("quotes.actions"), cell: (x: Results["quoteCrossSell"]["suggestions"][number]) => <Button size="sm" disabled={busy} aria-label={t("cross.addFor", { sku: x.productId })} data-testid={`cross-add-${x.productId}`}
            onClick={() => void operation(async () => { await save([...lines, { productId: x.productId, quantity: "1", price: "" }]); })}>{t("cross.add")}</Button> }] : []),
        ]}/>}
      </section>}
      {editable && <>
        {dirty && <p className={styles.muted} role="status" data-testid="quote-unsaved">{t("quotes.unsaved")}</p>}
        <Button disabled={busy || !lines.length} onClick={() => void operation(async () => { await save(lines); })}>{t("quotes.reprice")}</Button>
        <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); if (!add.productId.trim()) return; void operation(async () => { await save([...lines, { productId: add.productId.trim(), quantity: add.quantity.trim() || "1", price: "" }]); setAdd({ productId: "", quantity: "1" }); }); }}>
          <Lookup client={client} kind="product" label={t("quotes.addSku")} value={add.productId} onChange={v => setAdd(a => ({ ...a, productId: v }))} testId="add-sku"/>
          <Field label={t("quotes.quantity")}><input value={add.quantity} inputMode="decimal" onChange={e => setAdd({ ...add, quantity: e.target.value })} maxLength={20}/></Field>
          <Button type="submit" disabled={busy || !add.productId.trim()}>{t("quotes.addLine")}</Button>
        </form>
        {quote.needsApproval && <Field label={t("quotes.reason")}><textarea className={styles.textarea} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="exception-reason"/></Field>}
        <Button variant="primary" disabled={busy || !lines.length || (!dirty && quote.needsApproval && !reason.trim())} data-testid="quote-submit" onClick={() => void operation(submit)}>{t(quote.needsApproval ? "quotes.requestException" : "quotes.submit")}</Button>
      </>}
      {quote.exceptionReason && <p><strong>{t("quotes.reasonLabel")}</strong> {quote.exceptionReason}</p>}
      {quote.decidedAt && <p>{t("quotes.decided", { status: t(STATUS[quote.status]), date: fmt.date(quote.decidedAt.slice(0, 10)) })}{quote.decisionNote && <span> {quote.decisionNote}</span>}</p>}
      {next.includes("withdraw") && <div className={styles.row}>
        <Button disabled={busy} data-testid="quote-withdraw" onClick={() => void operation(async () => { const reasonWas = quote.exceptionReason ?? ""; show(await client.call("quoteWithdraw", { id: quote.id })); setReason(reasonWas); setNote(msg("quotes.withdrawn")); })}>{t("quotes.withdraw")}</Button>
      </div>}
      {next.includes("withdraw") && !canShare && <p className={styles.muted} role="note" data-testid="quote-sharing-off">{t("quotes.sharingOff")}</p>}
      {next.includes("withdraw") && canShare && <div className={styles.row}>
        {!quote.relayObject && <Button disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteShare", { id: quote.id, preset: "standard" })); setNote(msg("quotes.shared")); })}>{t("quotes.share")}</Button>}
        {quote.relayObject && <Button disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteRelaySync", { id: quote.id })); })}>{t("quotes.checkDecision")}</Button>}
      </div>}
      {next.includes("decide") && <div>
        <Field label={t("quotes.decisionNote")}><textarea className={styles.textarea} value={decisionNote} maxLength={500} onChange={e => setDecisionNote(e.target.value)}/></Field>
        <div className={styles.row}>
          <Button variant="primary" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "approve", note: decisionNote.trim() || null })); setNote(msg("quotes.approvedNote")); })}>{t("quotes.approve")}</Button>
          <Button disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "reject", note: decisionNote.trim() || null })); setNote(msg("quotes.rejectedNote")); })}>{t("quotes.reject")}</Button>
        </div></div>}
      {quote.status !== "draft" && (quote.mine || canApprove || seesCost) && <OutcomePanel client={client} quote={quote} busy={busy} operation={operation} onSaved={v => { show(v); setNote(msg("winloss.saved")); }}/>}
    </Card>}
    {tab === "winloss" && <WinLossReport client={client} busy={busy} operation={operation}/>}

    {(tab === "inbox" || tab === "history") && <Card title={t(tab === "inbox" ? "quotes.inbox.heading" : "quotes.history.heading")} headingId="quote-list-heading">
      {!list.length ? <p>{t(tab === "inbox" ? "quotes.inbox.empty" : "quotes.history.empty")}</p> : <DataGrid label={t(tab === "inbox" ? "quotes.inbox.heading" : "quotes.history.heading")} testId="quote-list" rows={list} rowKey={q => q.id} columns={[
        { id: "number", name: t("quotes.number"), value: q => q.number, cell: q => <Button size="sm" variant="ghost" disabled={busy} onClick={() => open(q.id)}><span translate="no">{q.number}</span></Button> },
        { id: "customer", name: t("quotes.customer"), value: q => q.customerName || q.customerId },
        { id: "status", name: t("quotes.statusLabel"), value: q => t(STATUS[q.status]) },
        { id: "zone", name: t("quotes.zone"), value: q => t(GUARD[q.worst]), cell: q => <Zone guard={q.worst}/> },
        { id: "total", name: t("quotes.total"), type: "money", value: q => String(q.totalCents) },
        { id: "updated", name: t("quotes.updated"), type: "date", value: q => q.updatedAt.slice(0, 10) },
      ]}/>}
    </Card>}
    </div>
  </>;
}
