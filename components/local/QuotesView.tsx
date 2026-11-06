"use client";
// Quote Desk and Price Check (chunk 7B). Cost and margin appear only when the worker sends them,
// which it does only for the "cost" capability (decision 16): this screen never derives them.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Cap } from "@/lib/roles/access";
import type { Guard, LineInput, PricePoint, PriceSource, QuoteStatus, QuoteSummary, QuoteView } from "@/lib/quotes/quotes";
import type { CreditSignal } from "@/lib/quotes/credit";
import { fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from "./vault.module.css";

type Op = (f: () => Promise<void>) => Promise<void>;
type Tab = "check" | "new" | "inbox" | "history";
const TAB: Record<Tab, MessageKey> = { check: "quotes.tab.check", new: "quotes.tab.new", inbox: "quotes.tab.inbox", history: "quotes.tab.history" };
const GUARD: Record<Guard, MessageKey> = { green: "quotes.zone.green", yellow: "quotes.zone.yellow", red: "quotes.zone.red", unset: "quotes.zone.unset" };
const SOURCE: Record<PriceSource, MessageKey> = { customer: "quotes.source.customer", tier: "quotes.source.tier", category: "quotes.source.category", list: "quotes.source.list", none: "quotes.source.none" };
const STATUS: Record<QuoteStatus, MessageKey> = { draft: "quotes.status.draft", submitted: "quotes.status.submitted", pending: "quotes.status.pending", approved: "quotes.status.approved", rejected: "quotes.status.rejected" };
const CREDIT: Record<CreditSignal["level"], MessageKey> = { green: "quotes.credit.green", amber: "quotes.credit.amber", red: "quotes.credit.red", unknown: "quotes.credit.unknown" };
// Style hooks use tone names, not colour words (theme test: colours come only from tokens).
const TONE: Record<string, string> = { green: "ok", yellow: "warn", amber: "warn", red: "bad" };
const money = (v: string | null | undefined) => v === null || v === undefined ? t("quotes.none") : fmt.money(v);

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
  return <div className={styles.thermo} role="meter" aria-label={label} aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={Math.min(hi, Math.max(lo, v))} aria-valuetext={t("quotes.meterText", { zone: t(GUARD[zone]), price: fmt.money(value) })}>
    <div className={styles.thermoTrack} aria-hidden="true">
      <span className={styles.thermoRed} style={{ width: `${at(f)}%` }}/>
      <span className={styles.thermoYellow} style={{ left: `${at(f)}%`, width: `${at(tg) - at(f)}%` }}/>
      <span className={styles.thermoGreen} style={{ left: `${at(tg)}%`, width: `${100 - at(tg)}%` }}/>
      <span className={styles.thermoMark} style={{ left: `${at(v)}%` }}/>
    </div>
    <div className={styles.thermoScale} aria-hidden="true"><span>{t("quotes.floorShort", { price: fmt.money(floor) })}</span><span>{t("quotes.targetShort", { price: fmt.money(target) })}</span><span>{t("quotes.startShort", { price: fmt.money(start) })}</span></div>
  </div>;
}

function Zone({ guard }: { guard: Guard }) { return <span className={styles.pill} data-tone={TONE[guard] ?? "none"} data-zone={guard}>{t(GUARD[guard])}</span>; }

function Credit({ credit }: { credit: CreditSignal }) {
  return <div className={styles.creditBox} data-tone={TONE[credit.level] ?? "none"} data-level={credit.level} data-testid="credit-signal">
    <strong>{t(CREDIT[credit.level])}</strong>{credit.asOf && <span className={styles.muted}> {t("quotes.credit.asOf", { date: fmt.date(credit.asOf) })}</span>}
    <ul>{credit.reasons.map(r => <li key={r}>{say(r)}</li>)}</ul>
  </div>;
}

export function QuotesView({ client, userId, caps, tier, busy, operation }: { client: VaultClient; userId: string; caps: Cap[]; tier: string | undefined; busy: boolean; operation: Op }) {
  const canApprove = caps.includes("quoteApprove"), seesCost = caps.includes("cost"), canShare = caps.includes("collaborate");
  const tabs: Tab[] = ["check", "new", ...(canApprove ? ["inbox" as const] : []), "history"];
  const [tab, setTab] = useState<Tab>("check"), [note, setNote] = useState("");
  const [check, setCheck] = useState({ productId: "", customerId: "", quantity: "1" }), [point, setPoint] = useState<PricePoint | null>(null);
  const [customer, setCustomer] = useState(""), [quote, setQuote] = useState<QuoteView | null>(null), [lines, setLines] = useState<{ productId: string; quantity: string; price: string }[]>([]);
  const [add, setAdd] = useState({ productId: "", quantity: "1" }), [reason, setReason] = useState(""), [decisionNote, setDecisionNote] = useState("");
  const [list, setList] = useState<QuoteSummary[]>([]);
  const load = async (pendingOnly: boolean) => setList(await client.call("quoteList", { pendingOnly }));
  useEffect(() => { if (tab === "inbox" || tab === "history") void load(tab === "inbox").catch(e => setNote(e instanceof Error ? e.message : msg("common.operationFailed"))); }, [tab, client]);
  if (tier === "starter") return <section className={styles.card}><h2>{t("quotes.heading")}</h2><p>{t("quotes.needsProfessional")}</p></section>;

  const show = (v: QuoteView) => { setQuote(v); setLines(v.lines.map(l => ({ productId: l.productId, quantity: trimQty(l.quantity), price: centsToText(l.unitCents) }))); };
  const editable = !!quote && quote.mine && (quote.status === "draft" || quote.status === "rejected");
  const save = async (next: typeof lines) => {
    const input: LineInput[] = [];
    for (const l of next) {
      const unit = l.price.trim() === "" ? null : priceToCents(l.price);
      if (l.price.trim() !== "" && unit === null) { setNote(msg("quotes.priceFormat")); return; }
      input.push({ productId: l.productId, quantity: l.quantity, unitCents: unit });
    }
    show(await client.call("quoteLines", { id: quote!.id, lines: input }));
  };
  const open = (id: string) => void operation(async () => { show(await client.call("quoteGet", { id })); setTab("new"); });

  return <>
    <p role="status">{say(note)}</p>
    <div className={styles.tabs} role="group" aria-label={t("quotes.tabsLabel")}>{tabs.map(x => <button key={x} type="button" aria-pressed={tab === x} onClick={() => { setNote(""); setTab(x); }}>{t(TAB[x])}</button>)}</div>

    {tab === "check" && <section className={styles.card} aria-labelledby="price-check-heading"><h2 id="price-check-heading">{t("quotes.check.heading")}</h2><p className={styles.muted}>{t("quotes.check.body")}</p>
      <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); void operation(async () => { setPoint(await client.call("priceCheck", { productId: check.productId.trim(), customerId: check.customerId.trim() || null, quantity: check.quantity.trim() || "1" })); }); }}>
        <label>{t("quotes.sku")}<input value={check.productId} autoFocus autoComplete="off" onChange={e => setCheck({ ...check, productId: e.target.value })} maxLength={64} data-testid="check-sku"/></label>
        <label>{t("quotes.customer")}<input value={check.customerId} autoComplete="off" onChange={e => setCheck({ ...check, customerId: e.target.value })} maxLength={64} data-testid="check-customer"/></label>
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
        <label>{t("quotes.customer")}<input value={customer} autoComplete="off" onChange={e => setCustomer(e.target.value)} maxLength={64} data-testid="quote-customer"/></label>
        <button className={styles.primary} type="submit" disabled={busy || !customer.trim()}>{t("quotes.new.start")}</button>
      </form></section>}

    {tab === "new" && quote && <section className={styles.card} aria-labelledby="quote-heading" data-testid="quote" data-status={quote.status}>
      <div className={styles.row}><h2 id="quote-heading" className={styles.inlineHeading}><span translate="no">{quote.number}</span></h2><span className={styles.pill}>{t(STATUS[quote.status])}</span><Zone guard={quote.worst}/>
        <button type="button" disabled={busy} onClick={() => { setQuote(null); setLines([]); setReason(""); setDecisionNote(""); }}>{t("quotes.new.another")}</button></div>
      <p>{t("quotes.customerTier", { name: quote.customerName || quote.customerId, tier: quote.tier || t("quotes.none") })}</p>
      <Credit credit={quote.credit}/>
      {quote.warnings.length > 0 && <div className={styles.warning} role="note"><ul>{quote.warnings.map(w => <li key={w}>{say(w)}</li>)}</ul></div>}
      <dl className={styles.totals}>
        <div><dt>{t("quotes.total")}</dt><dd data-testid="quote-total">{fmt.money(quote.totalCents)}</dd></div>
        <div><dt>{t("quotes.position")}</dt><dd>{quote.positionBp === null ? t("quotes.none") : fmt.percent((Number(quote.positionBp) / 100).toFixed(1))}</dd></div>
        {seesCost && <div><dt>{t("quotes.margin")}</dt><dd data-testid="quote-margin">{quote.marginRate == null ? t("quotes.none") : fmt.percent(quote.marginRate)}</dd></div>}
        {seesCost && <div><dt>{t("quotes.marginAmount")}</dt><dd>{money(quote.marginCents)}</dd></div>}
      </dl>
      {seesCost && !!quote.uncostedLines && <p className={styles.muted}>{t("quotes.uncosted", { count: quote.uncostedLines })}</p>}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr>
        {[t("quotes.sku"), t("quotes.quantity"), t("quotes.unitPrice"), t("quotes.book"), t("quotes.zone"), t("quotes.lineTotal"), ...(seesCost ? [t("quotes.lineMargin")] : []), ...(editable ? [t("quotes.actions")] : [])].map(h => <th key={h} scope="col">{h}</th>)}
      </tr></thead><tbody>{quote.lines.map((l, i) => <tr key={l.lineNo} data-zone={l.guard}>
        <td className={styles.wrap}><span translate="no">{l.productId}</span><br/><span className={styles.muted}>{l.description}</span>
          <Thermometer value={l.unitCents} floor={l.floorCents} target={l.targetCents} start={l.startCents} label={t("quotes.meterLabel", { sku: l.productId })}/></td>
        <td>{editable ? <input aria-label={t("quotes.quantityFor", { sku: l.productId })} inputMode="decimal" value={lines[i]?.quantity ?? ""} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}/> : fmt.decimal(trimQty(l.quantity))}</td>
        <td>{editable ? <input aria-label={t("quotes.priceFor", { sku: l.productId })} inputMode="decimal" value={lines[i]?.price ?? ""} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} data-testid={`price-${l.lineNo}`}/> : fmt.money(l.unitCents)}</td>
        <td>{money(l.bookCents)}<br/><span className={styles.muted}>{t(SOURCE[l.source])}</span></td>
        <td><Zone guard={l.guard}/></td>
        <td>{fmt.money(l.totalCents)}</td>
        {seesCost && <td>{l.marginRate == null ? t("quotes.none") : fmt.percent(l.marginRate)}</td>}
        {editable && <td><button type="button" disabled={busy} onClick={() => void operation(() => save(lines.filter((_, j) => j !== i)))}>{t("quotes.remove")}</button></td>}
      </tr>)}</tbody></table></div>
      {editable && <>
        <button type="button" disabled={busy || !lines.length} onClick={() => void operation(() => save(lines))}>{t("quotes.reprice")}</button>
        <form className={styles.quoteForm} onSubmit={e => { e.preventDefault(); if (!add.productId.trim()) return; void operation(async () => { await save([...lines, { productId: add.productId.trim(), quantity: add.quantity.trim() || "1", price: "" }]); setAdd({ productId: "", quantity: "1" }); }); }}>
          <label>{t("quotes.addSku")}<input value={add.productId} autoComplete="off" onChange={e => setAdd({ ...add, productId: e.target.value })} maxLength={64} data-testid="add-sku"/></label>
          <label>{t("quotes.quantity")}<input value={add.quantity} inputMode="decimal" onChange={e => setAdd({ ...add, quantity: e.target.value })} maxLength={20}/></label>
          <button type="submit" disabled={busy || !add.productId.trim()}>{t("quotes.addLine")}</button>
        </form>
        {quote.needsApproval && <label>{t("quotes.reason")}<textarea className={styles.textarea} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} data-testid="exception-reason"/></label>}
        <button className={styles.primary} type="button" disabled={busy || !quote.lines.length || (quote.needsApproval && !reason.trim())} onClick={() => void operation(async () => { show(await client.call("quoteSubmit", { id: quote.id, reason: reason.trim() || null })); setNote(msg(quote.needsApproval ? "quotes.exceptionRequested" : "quotes.submitted")); })}>{t(quote.needsApproval ? "quotes.requestException" : "quotes.submit")}</button>
      </>}
      {quote.exceptionReason && <p><strong>{t("quotes.reasonLabel")}</strong> {quote.exceptionReason}</p>}
      {quote.decidedAt && <p>{t("quotes.decided", { status: t(STATUS[quote.status]), date: fmt.date(quote.decidedAt.slice(0, 10)) })}{quote.decisionNote && <span> {quote.decisionNote}</span>}</p>}
      {quote.status === "pending" && quote.mine && canShare &&<div className={styles.row}>
        {!quote.relayObject && <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteShare", { id: quote.id, preset: "standard" })); setNote(msg("quotes.shared")); })}>{t("quotes.share")}</button>}
        {quote.relayObject && <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteRelaySync", { id: quote.id })); })}>{t("quotes.checkDecision")}</button>}
      </div>}
      {quote.status === "pending" && canApprove && !quote.mine && <div>
        <label>{t("quotes.decisionNote")}<textarea className={styles.textarea} value={decisionNote} maxLength={500} onChange={e => setDecisionNote(e.target.value)}/></label>
        <div className={styles.row}>
          <button className={styles.primary} type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "approve", note: decisionNote.trim() || null })); setNote(msg("quotes.approvedNote")); })}>{t("quotes.approve")}</button>
          <button type="button" disabled={busy} onClick={() => void operation(async () => { show(await client.call("quoteDecide", { id: quote.id, decision: "reject", note: decisionNote.trim() || null })); setNote(msg("quotes.rejectedNote")); })}>{t("quotes.reject")}</button>
        </div></div>}
    </section>}

    {(tab === "inbox" || tab === "history") && <section className={styles.card} aria-labelledby="quote-list-heading"><h2 id="quote-list-heading">{t(tab === "inbox" ? "quotes.inbox.heading" : "quotes.history.heading")}</h2>
      {!list.length ? <p>{t(tab === "inbox" ? "quotes.inbox.empty" : "quotes.history.empty")}</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr>
        {[t("quotes.number"), t("quotes.customer"), t("quotes.statusLabel"), t("quotes.zone"), t("quotes.total"), t("quotes.updated")].map(h => <th key={h} scope="col">{h}</th>)}
      </tr></thead><tbody>{list.map(q => <tr key={q.id}>
        <td><button type="button" disabled={busy} onClick={() => open(q.id)}><span translate="no">{q.number}</span></button></td>
        <td>{q.customerName || q.customerId}</td><td>{t(STATUS[q.status])}</td><td><Zone guard={q.worst}/></td><td>{fmt.money(q.totalCents)}</td><td>{fmt.date(q.updatedAt.slice(0, 10))}</td>
      </tr>)}</tbody></table></div>}
    </section>}
  </>;
}
