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
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";
import { DataGrid } from "@/components/ui/DataGrid";
import { OutcomePanel, WinLossReport } from "./WinLoss";
import { Lookup } from "./Lookup";

type Op = (f: () => Promise<void>) => Promise<void>;
type Tab = "check" | "new" | "inbox" | "history" | "winloss";
const TAB: Record<Tab, MessageKey> = { check: "quotes.tab.check", new: "quotes.tab.new", inbox: "quotes.tab.inbox", history: "quotes.tab.history", winloss: "winloss.tab" };
const GUARD: Record<Guard, MessageKey> = { green: "quotes.zone.green", yellow: "quotes.zone.yellow", red: "quotes.zone.red", unset: "quotes.zone.unset" };
const SOURCE: Record<PriceSource, MessageKey> = { customer: "quotes.source.customer", tier: "quotes.source.tier", category: "quotes.source.category", list: "quotes.source.list", none: "quotes.source.none" };
const STATUS: Record<QuoteStatus, MessageKey> = { draft: "quotes.status.draft", submitted: "quotes.status.submitted", pending: "quotes.status.pending", approved: "quotes.status.approved", rejected: "quotes.status.rejected" };
const CREDIT: Record<CreditSignal["level"], MessageKey> = { green: "quotes.credit.green", amber: "quotes.credit.amber", red: "quotes.credit.red", unknown: "quotes.credit.unknown" };
// Style hooks use tone names, not colour words (theme test: colours come only from tokens).
const TONE: Record<string, string> = { green: "ok", yellow: "warn", amber: "warn", red: "bad" };
const money = (v: string | null | undefined) => v === null || v === undefined ? t("quotes.none") : fmt.currency(v);

/** A typed price ("12.34" or "12,34") to whole cents, or null when it is not a valid amount. */
export function priceToCents(text: string): string | null {
  const v = text.trim().replace(/,(\d{1,2})$/, ".$1");
  const m = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(v);
  return m ? (BigInt(m[1]) * BigInt(100) + BigInt((m[2] || "").padEnd(2, "0"))).toString() : null;
}
const trimQty = (q: string) => q.includes(".") ? q.replace(/0+$/, "").replace(/\.$/, "") : q;
const centsToText = (c: string) => { const n = BigInt(c); return `${n / BigInt(100)}.${(n % BigInt(100)).toString().padStart(2, "0")}`; };

/** Where a price sits against floor, target and start. Prices only: no cost is involved. */
export function Thermometer({ value, floor, target, start, label }: { value: string | null; floor: string | null; target: string | null; start: string | null; label: string }) {
  if (value === null || floor === null || target === null || start === null) return <p className={styles.muted}>{t("quotes.noGuardrail")}</p>;
  const f = Number(floor), tg = Number(target), s = Number(start), v = Number(value), span = Math.max(s - f, 1);
  const lo = Math.max(0, f - span * 0.25), hi = s + span * 0.15, at = (x: number) => Math.min(100, Math.max(0, (x - lo) / (hi - lo) * 100));
  const zone: Guard = v < f ? "red" : v < tg ? "yellow" : "green";
  return <div className={styles.thermo} role="meter" aria-label={label} aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={Math.min(hi, Math.max(lo, v))} aria-valuetext={t("quotes.meterText", { zone: t(GUARD[zone]), price: fmt.currency(value) })}>
    <div className={styles.thermoTrack} aria-hidden="true">
      <span className={styles.thermoRed} style={{ width: `${at(f)}%` }}/>
      <span className={styles.thermoYellow} style={{ left: `${at(f)}%`, width: `${at(tg) - at(f)}%` }}/>
      <span className={styles.thermoGreen} style={{ left: `${at(tg)}%`, width: `${100 - at(tg)}%` }}/>
      <span className={styles.thermoMark} style={{ left: `${at(v)}%` }}/>
    </div>
    <div className={styles.thermoScale} aria-hidden="true"><span>{t("quotes.floorShort", { price: fmt.currency(floor) })}</span><span>{t("quotes.targetShort", { price: fmt.currency(target) })}</span><span>{t("quotes.startShort", { price: fmt.currency(start) })}</span></div>
  </div>;
}

function Zone({ guard }: { guard: Guard }) { return <span className={styles.pill} data-tone={TONE[guard] ?? "none"} data-zone={guard}>{t(GUARD[guard])}</span>; }

function Credit({ credit }: { credit: CreditSignal }) {
  return <div className={styles.creditBox} data-tone={TONE[credit.level] ?? "none"} data-level={credit.level} data-testid="credit-signal">
    <strong>{t(CREDIT[credit.level])}</strong>{credit.asOf && <span className={styles.muted}> {t("quotes.credit.asOf", { date: fmt.date(credit.asOf) })}</span>}
    <ul>{credit.reasons.map(r => <li key={r}>{say(r)}</li>)}</ul>
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
      else if (tabHash && tabs.includes(tabHash[1] as Tab)) setTab(tabHash[1] as Tab);
    };
    read(); window.addEventListener("hashchange", read); return () => window.removeEventListener("hashchange", read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [check, setCheck] = useState({ productId: "", customerId: "", quantity: "1" }), [point, setPoint] = useState<PricePoint | null>(null);
  const [customer, setCustomer] = useState(""), [quote, setQuote] = useState<QuoteView | null>(null), [lines, setLines] = useState<{ productId: string; quantity: string; price: string }[]>([]);
  const [add, setAdd] = useState({ productId: "", quantity: "1" }), [reason, setReason] = useState(""), [decisionNote, setDecisionNote] = useState("");
  const [list, setList] = useState<QuoteSummary[]>([]);
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
  if (tier === "starter") return <section className={styles.card}><h2>{t("quotes.heading")}</h2><p>{t("quotes.needsProfessional")}</p></section>;

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

  return <>
    <p role="status">{say(note)}</p>
    <div className={styles.tabs} role="group" aria-label={t("quotes.tabsLabel")}>{tabs.map(x => <button key={x} type="button" aria-pressed={tab === x} onClick={() => { setNote(""); setTab(x); }}>{t(TAB[x])}</button>)}</div>

    {tab === "check" && <section className={styles.card} aria-labelledby="price-check-heading"><h2 id="price-check-heading">{t("quotes.check.heading")}</h2><p className={styles.muted}>{t("quotes.check.body")}</p>
      <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); void operation(async () => { setPoint(await client.call("priceCheck", { productId: check.productId.trim(), customerId: check.customerId.trim() || null, quantity: check.quantity.trim() || "1" })); }); }}>
        <Lookup client={client} kind="product" label={t("quotes.sku")} value={check.productId} onChange={v => setCheck(c => ({ ...c, productId: v }))} testId="check-sku"/>
        <Lookup client={client} kind="customer" label={t("quotes.customer")} value={check.customerId} onChange={v => setCheck(c => ({ ...c, customerId: v }))} testId="check-customer"/>
        <label>{t("quotes.quantity")}<input value={check.quantity} inputMode="decimal" onChange={e => setCheck({ ...check, quantity: e.target.value })} maxLength={20}/></label>
        <button className={styles.primary} type="submit" disabled={busy || !check.productId.trim()}>{t("quotes.check.run")}</button>
      </form>
      {point && <div data-testid="price-check-result" data-zone={point.guard}>
        <h3><span translate="no">{point.productId}</span> {point.description}</h3>
        <p>{t("quotes.bookPrice", { price: money(point.bookCents), source: t(SOURCE[point.source]) })} <Zone guard={point.guard}/></p>
        {point.customerId && <p>{t("quotes.customerTier", { name: point.customerName || point.customerId, tier: point.tier || t("quotes.none") })}</p>}
        <Thermometer value={point.bookCents} floor={point.floorCents} target={point.targetCents} start={point.startCents} label={t("quotes.meterLabel", { sku: point.productId })}/>
        {point.customerId && <Credit credit={point.credit}/>}
      </div>}
    </section>}

    {tab === "new" && !quote && <section className={styles.card} aria-labelledby="new-quote-heading"><h2 id="new-quote-heading">{t("quotes.new.heading")}</h2>
      <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); void operation(async () => { show(await client.call("quoteCreate", { customerId: customer.trim() })); }); }}>
        <Lookup client={client} kind="customer" label={t("quotes.customer")} value={customer} onChange={setCustomer} testId="quote-customer"/>
        <button className={styles.primary} type="submit" disabled={busy || !customer.trim()}>{t("quotes.new.start")}</button>
      </form></section>}

    {tab === "new" && quote && <section className={styles.card} aria-labelledby="quote-heading" data-testid="quote" data-status={quote.status}>
      <div className={styles.row}><h2 id="quote-heading" className={styles.inlineHeading}><span translate="no">{quote.number}</span></h2><span className={styles.pill}>{t(STATUS[quote.status])}</span><Zone guard={quote.worst}/>
        <button type="button" disabled={busy} onClick={() => { setQuote(null); setLines([]); setReason(""); setDecisionNote(""); }}>{t("quotes.new.another")}</button></div>
      <p>{t("quotes.customerTier", { name: quote.customerName || quote.customerId, tier: quote.tier || t("quotes.none") })}</p>
      <Credit credit={quote.credit}/>
      {quote.warnings.length > 0 && <div className={styles.warning} role="note"><ul>{quote.warnings.map(w => <li key={w}>{say(w)}</li>)}</ul></div>}
      <dl className={styles.totals}>
        <div><dt>{t("quotes.total")}</dt><dd data-testid="quote-total">{fmt.currency(quote.totalCents)}</dd></div>
        <div><dt>{t("quotes.position")}</dt><dd>{quote.positionBp === null ? t("quotes.none") : fmt.percent((Number(quote.positionBp) / 100).toFixed(1))}</dd></div>
        {seesCost && <div><dt>{t("quotes.margin")}</dt><dd data-testid="quote-margin">{quote.marginRate == null ? t("quotes.none") : fmt.percent(quote.marginRate)}</dd></div>}
        {seesCost && <div><dt>{t("quotes.marginAmount")}</dt><dd>{money(quote.marginCents)}</dd></div>}
      </dl>
      {seesCost && !!quote.uncostedLines && <p className={styles.muted}>{t("quotes.uncosted", { count: quote.uncostedLines })}</p>}
      <DataGrid label={t("quotes.linesLabel")} testId="quote-lines" rows={quote.lines} rowKey={l => String(l.lineNo)} rowProps={l => ({ "data-zone": l.guard })} columns={[
        { id: "sku", name: t("quotes.sku"), value: l => l.productId, cell: l => <span className={styles.wrap}><span translate="no">{l.productId}</span><br/><span className={styles.muted}>{l.description}</span>
          <Thermometer value={l.unitCents} floor={l.floorCents} target={l.targetCents} start={l.startCents} label={t("quotes.meterLabel", { sku: l.productId })}/></span> },
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
            {editable && g.suggestedCents !== null && g.suggestedCents !== String(l.unitCents) && <button type="button" disabled={busy} aria-label={t("guidance.useFor", { sku: l.productId })} data-testid={`guidance-use-${l.lineNo}`}
              onClick={() => void operation(async () => { await save(lines.map((x, j) => j === i ? { ...x, price: centsToText(g.suggestedCents!) } : x)); })}>{t("guidance.use")}</button>}
          </div>;
        } },
        { id: "total", name: t("quotes.lineTotal"), type: "money", value: l => String(l.totalCents) },
        ...(seesCost ? [{ id: "margin", name: t("quotes.lineMargin"), type: "percent" as const, value: (l: QuoteView["lines"][number]) => l.marginRate == null ? null : String(l.marginRate), cell: (l: QuoteView["lines"][number]) => l.marginRate == null ? t("quotes.none") : fmt.percent(l.marginRate) }] : []),
        ...(editable ? [{ id: "actions", name: t("quotes.actions"), cell: (l: QuoteView["lines"][number]) => <button type="button" disabled={busy} onClick={() => void operation(async () => { await save(lines.filter((_, j) => j !== quote.lines.indexOf(l))); })}>{t("quotes.remove")}</button> }] : []),
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
          ...(editable ? [{ id: "add", name: t("quotes.actions"), cell: (x: Results["quoteCrossSell"]["suggestions"][number]) => <button type="button" disabled={busy} aria-label={t("cross.addFor", { sku: x.productId })} data-testid={`cross-add-${x.productId}`}
            onClick={() => void operation(async () => { await save([...lines, { productId: x.productId, quantity: "1", price: "" }]); })}>{t("cross.add")}</button> }] : []),
        ]}/>}
      </section>}
      {editable && <>
        {dirty && <p className={styles.muted} role="status" data-testid="quote-unsaved">{t("quotes.unsaved")}</p>}
        <button type="button" disabled={busy || !lines.length} onClick={() => void operation(async () => { await save(lines); })}>{t("quotes.reprice")}</button>
        <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); if (!add.productId.trim()) return; void operation(async () => { await save([...lines, { productId: add.productId.trim(), quantity: add.quantity.trim() || "1", price: "" }]); setAdd({ productId: "", quantity: "1" }); }); }}>
          <Lookup client={client} kind="product" label={t("quotes.addSku")} value={add.productId} onChange={v => setAdd(a => ({ ...a, productId: v }))} testId="add-sku"/>
          <label>{t("quotes.quantity")}<input value={add.quantity} inputMode="decimal" onChange={e => setAdd({ ...add, quantity: e.target.value })} maxLength={20}/></label>
          <button type="submit" disabled={busy || !add.productId.trim()}>{t("quotes.addLine")}</button>
        </form>
        {quote.needsApproval && <label>{t("quotes.reason")}<textarea className={styles.textarea} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="exception-reason"/></label>}
        <button className={styles.primary} type="button" disabled={busy || !lines.length || (!dirty && quote.needsApproval && !reason.trim())} data-testid="quote-submit" onClick={() => void operation(submit)}>{t(quote.needsApproval ? "quotes.requestException" : "quotes.submit")}</button>
      </>}
      {quote.exceptionReason && <p><strong>{t("quotes.reasonLabel")}</strong> {quote.exceptionReason}</p>}
      {quote.decidedAt && <p>{t("quotes.decided", { status: t(STATUS[quote.status]), date: fmt.date(quote.decidedAt.slice(0, 10)) })}{quote.decisionNote && <span> {quote.decisionNote}</span>}</p>}
      {next.includes("withdraw") && <div className={styles.row}>
        <button type="button" disabled={busy} data-testid="quote-withdraw" onClick={() => void operation(async () => { const reasonWas = quote.exceptionReason ?? ""; show(await client.call("quoteWithdraw", { id: quote.id })); setReason(reasonWas); setNote(msg("quotes.withdrawn")); })}>{t("quotes.withdraw")}</button>
      </div>}
      {next.includes("withdraw") && !canShare && <p className={styles.muted} role="note" data-testid="quote-sharing-off">{t("quotes.sharingOff")}</p>}
      {next.includes("withdraw") && canShare && <div className={styles.row}>
        {!quote.relayObject && <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteShare", { id: quote.id, preset: "standard" })); setNote(msg("quotes.shared")); })}>{t("quotes.share")}</button>}
        {quote.relayObject && <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteRelaySync", { id: quote.id })); })}>{t("quotes.checkDecision")}</button>}
      </div>}
      {next.includes("decide") && <div>
        <label>{t("quotes.decisionNote")}<textarea className={styles.textarea} value={decisionNote} maxLength={500} onChange={e => setDecisionNote(e.target.value)}/></label>
        <div className={styles.row}>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "approve", note: decisionNote.trim() || null })); setNote(msg("quotes.approvedNote")); })}>{t("quotes.approve")}</button>
          <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "reject", note: decisionNote.trim() || null })); setNote(msg("quotes.rejectedNote")); })}>{t("quotes.reject")}</button>
        </div></div>}
      {quote.status !== "draft" && (quote.mine || canApprove || seesCost) && <OutcomePanel client={client} quote={quote} busy={busy} operation={operation} onSaved={v => { show(v); setNote(msg("winloss.saved")); }}/>}
    </section>}
    {tab === "winloss" && <WinLossReport client={client} busy={busy} operation={operation}/>}

    {(tab === "inbox" || tab === "history") && <section className={styles.card} aria-labelledby="quote-list-heading"><h2 id="quote-list-heading">{t(tab === "inbox" ? "quotes.inbox.heading" : "quotes.history.heading")}</h2>
      {!list.length ? <p>{t(tab === "inbox" ? "quotes.inbox.empty" : "quotes.history.empty")}</p> : <DataGrid label={t(tab === "inbox" ? "quotes.inbox.heading" : "quotes.history.heading")} testId="quote-list" rows={list} rowKey={q => q.id} columns={[
        { id: "number", name: t("quotes.number"), value: q => q.number, cell: q => <button type="button" disabled={busy} onClick={() => open(q.id)}><span translate="no">{q.number}</span></button> },
        { id: "customer", name: t("quotes.customer"), value: q => q.customerName || q.customerId },
        { id: "status", name: t("quotes.statusLabel"), value: q => t(STATUS[q.status]) },
        { id: "zone", name: t("quotes.zone"), value: q => t(GUARD[q.worst]), cell: q => <Zone guard={q.worst}/> },
        { id: "total", name: t("quotes.total"), type: "money", value: q => String(q.totalCents) },
        { id: "updated", name: t("quotes.updated"), type: "date", value: q => q.updatedAt.slice(0, 10) },
      ]}/>}
    </section>}
  </>;
}
