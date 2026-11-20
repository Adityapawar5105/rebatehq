import {matrixLookup} from '../pricing/book';
import { businessToday } from "../vault/today";
// Quote Desk and Price Check (chunk 7B). Runs in the vault worker against the local DuckDB.
// Prices are whole cents per unit; quantities are decimals; totals are exact integer cents.
// Decision 16: the views below carry cost and margin ONLY when the caller passes withCost
// (the "cost" capability). A Sales Rep sees price, start/target/floor and the zone, never cost.
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { guardStatus } from "../pricing/rules";
import { rateBp } from "../margin/decimal";
import { rhaSql } from "../margin/sql";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { creditSignal, type CreditSignal } from "./credit";
import { outcomeOf, type OutcomeView } from "./winloss";

export type Guard = "green" | "yellow" | "red" | "unset";
export type PriceSource = "customer" | "tier" | "category" | "list" | "none";
export type PricePoint = {
  productId: string; description: string; category: string; uom: string;
  customerId: string | null; customerName: string; tier: string;
  /** Book price for the quantity and date, in cents per unit, from the price list (else the item list price). */
  bookCents: string | null; source: PriceSource; qtyBreak: string | null;
  startCents: string | null; targetCents: string | null; floorCents: string | null; guard: Guard;
  credit: CreditSignal;
};
export type QuoteStatus = "draft" | "submitted" | "pending" | "approved" | "rejected";
/** What the caller may do next with a quote (Phase 1, 20 Nov 2026). The screen shows buttons from this list only. */
export type QuoteAction = "edit" | "submit" | "withdraw" | "decide";
/**
 * Every allowed status move, in one place (the supplier-claims pattern, lib/rebate/supplier.ts).
 * Editing a draft or rejected quote saves it as a draft; submit goes to "submitted", or "pending" when a line is
 * below its floor; a pending quote is approved, rejected, or withdrawn by its author back to a draft.
 */
export const TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ["draft", "submitted", "pending"],
  rejected: ["draft", "submitted", "pending"],
  pending: ["approved", "rejected", "draft"],
  submitted: [],
  approved: [],
};
export const canMove = (from: string, to: QuoteStatus) => (TRANSITIONS as Record<string, readonly QuoteStatus[]>)[from]?.includes(to) ?? false;
/** The single guard for a status move; the message says why the move is refused. */
export function assertMove(from: string, to: QuoteStatus, key: "quote.notEditable" | "quote.notPending") { if (!canMove(from, to)) bad(key); }
/** The moves this caller can make: authors edit, submit and withdraw their own quotes; approvers decide other people's. */
export function allowedNext(status: QuoteStatus, mine: boolean, canApprove: boolean): QuoteAction[] {
  const out: QuoteAction[] = [];
  if (mine && canMove(status, "draft") && status !== "pending") out.push("edit", "submit");
  if (mine && status === "pending") out.push("withdraw");
  if (!mine && canApprove && canMove(status, "approved")) out.push("decide");
  return out;
}
export type QuoteLineView = { lineNo: number; productId: string; description: string; quantity: string; unitCents: string; bookCents: string | null; source: PriceSource; startCents: string | null; targetCents: string | null; floorCents: string | null; guard: Guard; totalCents: string; costCents?: string | null; marginCents?: string | null; marginRate?: string | null };
export type QuoteView = {
  id: string; number: string; customerId: string; customerName: string; tier: string; status: QuoteStatus; createdBy: string; createdAt: string; updatedAt: string;
  exceptionReason: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; relayObject: string | null;
  lines: QuoteLineView[]; totalCents: string; worst: Guard; credit: CreditSignal; warnings: string[];
  /** Price position: sum of quoted prices against the sum of targets, in basis points (no cost involved). */
  positionBp: string | null; needsApproval: boolean; mine: boolean;
  /** The moves this caller can make next (never cost). */
  allowedNext: QuoteAction[];
  /** 8C-1 win/loss outcome, when recorded. */
  outcome: OutcomeView | null;
  costCents?: string | null; marginCents?: string | null; marginRate?: string | null; uncostedLines?: number;
};
export type QuoteSummary = { id: string; number: string; customerId: string; customerName: string; status: QuoteStatus; totalCents: string; worst: Guard; updatedAt: string; createdBy: string };
export type LineInput = { productId: string; quantity: string; unitCents?: string | null };

const bad = (key: Parameters<typeof msg>[0], params?: Parameters<typeof msg>[1]): never => { throw new VaultError("QUOTE", msg(key, params)); };
async function rows(e: Engine, sql: string) { return (await e.conn.query(sql)).toArray().map(r => ({ ...r })) as Record<string, unknown>[]; }
const str = (v: unknown) => v === null || v === undefined ? null : String(v);
const today = () => businessToday();
const ID = /^[^\x00-\x1f]{1,64}$/;
const QTY = /^(0|[1-9]\d{0,12})(\.\d{1,4})?$/, CENTS = /^(0|[1-9]\d{0,12})$/;
export const MAX_LINES = 200;
const RANK: Record<Guard, number> = { unset: 0, green: 1, yellow: 2, red: 3 };
const worstOf = (gs: Guard[]) => gs.reduce<Guard>((w, g) => RANK[g] > RANK[w] ? g : w, gs.length ? "green" : "unset");

/** Book price and guardrail for one SKU, customer, quantity and date. */
export async function pricePoint(e: Engine, productId: string, customerId: string | null, quantity: string, date = today()): Promise<PricePoint> {
  if (!ID.test(productId)) bad("quote.chooseProduct");
  if (customerId !== null && !ID.test(customerId)) bad("quote.chooseCustomer");
  if (!QTY.test(quantity) || Number(quantity) <= 0) bad("quote.quantityInvalid");
  const p = (await rows(e, `SELECT product_id, description, category, uom, list_price::VARCHAR AS list FROM products WHERE product_id=${Q(productId)}`))[0];
  if (!p) bad("quote.unknownProduct", { id: productId });
  const c = customerId === null ? null : (await rows(e, `SELECT customer_id, name, tier FROM customers WHERE customer_id=${Q(customerId)}`))[0];
  if (customerId !== null && !c) bad("quote.unknownCustomer", { id: customerId });
  const tier = String(c?.tier ?? ""), cat = String(p.category ?? "");
  // Most specific valid row wins: the customer's own price, then the tier, then a category-wide price;
  // a product row beats a category row; the highest quantity break at or below the quantity; the newest start.
  const found = (await rows(e,matrixLookup({product:Q(productId),category:Q(cat),customer:customerId===null?'NULL':Q(customerId),tier:Q(tier),quantity,date:'DATE '+Q(date)})))[0];
  const m:Record<string,unknown>|null=found?{...found,price:String(found.price),qb:String(found.qty_break)}:null;
  const source: PriceSource = m ? m.customer_id !== null ? "customer" : m.product_id === null ? "category" : "tier" : p.list !== null ? "list" : "none";
  const book = m ? String(m.price) : str(p.list);
  const g = (await rows(e, `SELECT start::VARCHAR AS s, target::VARCHAR AS t, floor::VARCHAR AS f FROM price_guardrails WHERE tier=${Q(tier)} AND category=${Q(cat)}`))[0];
  return {
    productId: String(p.product_id), description: String(p.description ?? ""), category: cat, uom: String(p.uom ?? ""),
    customerId: c ? String(c.customer_id) : null, customerName: String(c?.name ?? ""), tier,
    bookCents: book, source, qtyBreak: m ? String(m.qb) : null,
    startCents: str(g?.s), targetCents: str(g?.t), floorCents: str(g?.f),
    guard: g && book !== null ? guardStatus(BigInt(book), BigInt(String(g.t)), BigInt(String(g.f))) as Guard : "unset",
    credit: customerId === null ? creditSignal(null) : await credit(e, customerId),
  };
}

export async function credit(e: Engine, customerId: string): Promise<CreditSignal> {
  const r = (await rows(e, `SELECT strftime(as_of,'%Y-%m-%d') AS as_of, current_cents::VARCHAR AS c0, d1_30_cents::VARCHAR AS c1, d31_60_cents::VARCHAR AS c2, d61_90_cents::VARCHAR AS c3, d90_plus_cents::VARCHAR AS c4, credit_limit_cents::VARCHAR AS lim, dso_days::VARCHAR AS dso FROM credit_profiles WHERE customer_id=${Q(customerId)}`))[0];
  if (!r) return creditSignal(null);
  return creditSignal({ asOf: str(r.as_of), current: BigInt(String(r.c0)), d1_30: BigInt(String(r.c1)), d31_60: BigInt(String(r.c2)), d61_90: BigInt(String(r.c3)), d90plus: BigInt(String(r.c4)), limit: r.lim === null ? null : BigInt(String(r.lim)), dso: str(r.dso) });
}

/** SQL for a new draft quote with the next number (Q-YYYY-0001, per vault and year). */
export async function createSql(e: Engine, customerId: string, userId: string, at: string) {
  if (!ID.test(customerId)) bad("quote.chooseCustomer");
  if (!(await rows(e, `SELECT 1 FROM customers WHERE customer_id=${Q(customerId)}`)).length) bad("quote.unknownCustomer", { id: customerId });
  const year = at.slice(0, 4), n = Number((await rows(e, `SELECT count(*) AS n FROM quotes WHERE number LIKE ${Q(`Q-${year}-%`)}`))[0].n) + 1;
  const id = crypto.randomUUID(), number = `Q-${year}-${String(n).padStart(4, "0")}`;
  return { id, number, sql: `INSERT INTO quotes(id,number,customer_id,status,created_by,created_at,updated_at) VALUES(${Q(id)},${Q(number)},${Q(customerId)},'draft',${Q(userId)},${Q(at)},${Q(at)});` };
}

async function quoteRow(e: Engine, id: string) {
  const q = (await rows(e, `SELECT * FROM quotes WHERE id=${Q(id)}`))[0];
  if (!q) bad("quote.notFound");
  return q;
}
/** Replace a draft's lines: each line is priced and checked against its guardrail now, and keeps that snapshot. */
export async function linesSql(e: Engine, id: string, lines: LineInput[], userId: string, at: string) {
  const q = await quoteRow(e, id);
  assertMove(String(q.status), "draft", "quote.notEditable");
  if (String(q.status) === "pending") bad("quote.notEditable"); // a pending quote is withdrawn first (quoteWithdraw)
  if (String(q.created_by) !== userId) bad("quote.notYours");
  if (!Array.isArray(lines) || lines.length > MAX_LINES) bad("quote.tooManyLines", { max: MAX_LINES });
  const values: string[] = [];
  for (const [i, l] of lines.entries()) {
    const qty = String(l?.quantity ?? "");
    const point = await pricePoint(e, String(l?.productId ?? ""), String(q.customer_id), qty);
    const unit = l?.unitCents === undefined || l.unitCents === null || l.unitCents === "" ? point.bookCents ?? "0" : String(l.unitCents);
    if (!CENTS.test(unit)) bad("quote.priceInvalid");
    const guard: Guard = point.targetCents !== null && point.floorCents !== null ? guardStatus(BigInt(unit), BigInt(point.targetCents), BigInt(point.floorCents)) as Guard : "unset";
    const cost = str((await rows(e, `SELECT current_cost::VARCHAR AS c FROM products WHERE product_id=${Q(point.productId)}`))[0]?.c);
    const n = (v: string | null) => v === null ? "NULL" : v;
    values.push(`(${Q(id)},${i + 1},${Q(point.productId)},${qty},${unit},${n(point.bookCents)},${Q(point.source)},${n(point.startCents)},${n(point.targetCents)},${n(point.floorCents)},${Q(guard)},${n(cost)})`);
  }
  return `DELETE FROM quote_lines WHERE quote_id=${Q(id)};${values.length ? `INSERT INTO quote_lines VALUES ${values.join(",")};` : ""}
UPDATE quotes SET status='draft', updated_at=${Q(at)}, decided_by=NULL, decided_at=NULL, decision_note=NULL, relay_object=NULL WHERE id=${Q(id)};`; // a changed quote never inherits an approval shared for its old lines
}

/** Submit: a line below its floor needs an exception reason and the Pricing Owner's approval; below target is a soft warning. */
export async function submitSql(e: Engine, id: string, reason: string | null, userId: string, at: string) {
  const q = await quoteRow(e, id);
  assertMove(String(q.status), "submitted", "quote.notEditable");
  if (String(q.created_by) !== userId) bad("quote.notYours");
  const lines = await rows(e, `SELECT guard_status FROM quote_lines WHERE quote_id=${Q(id)}`);
  if (!lines.length) bad("quote.noLines");
  const text = (reason ?? "").trim();
  if (text.length > 500 || /[\x00-\x08\x0b-\x1f]/.test(text)) bad("quote.reasonInvalid");
  const red = lines.some(l => l.guard_status === "red");
  if (red && !text) bad("quote.reasonRequired");
  const status: QuoteStatus = red ? "pending" : "submitted";
  return { status, sql: `UPDATE quotes SET status=${Q(status)}, exception_reason=${text ? Q(text) : "NULL"}, updated_at=${Q(at)} WHERE id=${Q(id)};` };
}

/** Approve or reject a pending exception. Nobody approves their own quote. */
export async function decideSql(e: Engine, id: string, decision: "approve" | "reject", note: string | null, userId: string, at: string, via: string | null = null) {
  const q = await quoteRow(e, id);
  assertMove(String(q.status), "approved", "quote.notPending");
  if (via === null && String(q.created_by) === userId) bad("quote.noSelfApproval");
  if (decision !== "approve" && decision !== "reject") bad("quote.decisionInvalid");
  const text = (note ?? "").trim();
  if (text.length > 500 || /[\x00-\x08\x0b-\x1f]/.test(text)) bad("quote.reasonInvalid");
  return `UPDATE quotes SET status=${Q(decision === "approve" ? "approved" : "rejected")}, decided_by=${Q(via ?? userId)}, decided_at=${Q(at)}, decision_note=${text ? Q(text) : "NULL"}, updated_at=${Q(at)}${via === null ? ", relay_object=NULL" : ""} WHERE id=${Q(id)};`;
}

/** Withdraw: the author takes a pending quote back to a draft to change it. Any approval link is dropped, so a
 * decision made on the old lines can never apply to the changed quote. */
export async function withdrawSql(e: Engine, id: string, userId: string, at: string) {
  const q = await quoteRow(e, id);
  if (String(q.status) !== "pending") bad("quote.notPending");
  assertMove(String(q.status), "draft", "quote.notPending");
  if (String(q.created_by) !== userId) bad("quote.notYours");
  return `UPDATE quotes SET status='draft', exception_reason=NULL, decided_by=NULL, decided_at=NULL, decision_note=NULL, relay_object=NULL, updated_at=${Q(at)} WHERE id=${Q(id)};`;
}

export async function linkSql(e: Engine, id: string, relayObject: string, at: string) {
  await quoteRow(e, id);
  return `UPDATE quotes SET relay_object=${Q(relayObject)}, updated_at=${Q(at)} WHERE id=${Q(id)};`;
}

/** One quote, with cost and margin only for a caller allowed to see cost. */
export async function view(e: Engine, id: string, userId: string, withCost: boolean, canApprove = false): Promise<QuoteView> {
  const q = await quoteRow(e, id);
  const c = (await rows(e, `SELECT name, tier FROM customers WHERE customer_id=${Q(String(q.customer_id))}`))[0];
  const total = (qty: string, unit: string) => rhaSql(`CAST(${unit} AS HUGEINT)*CAST(${qty}*10000 AS HUGEINT)`, "10000");
  const ls = await rows(e, `SELECT l.line_no, l.product_id, coalesce(p.description,'') AS description, l.quantity::VARCHAR AS qty, l.unit_price_cents::VARCHAR AS unit, l.book_price_cents::VARCHAR AS book, l.price_source,
 l.start_cents::VARCHAR AS s, l.target_cents::VARCHAR AS t, l.floor_cents::VARCHAR AS f, l.guard_status, l.cost_cents::VARCHAR AS cost,
 CAST(${total("l.quantity", "l.unit_price_cents")} AS BIGINT)::VARCHAR AS line_total,
 CASE WHEN l.cost_cents IS NULL THEN NULL ELSE CAST(${total("l.quantity", "l.cost_cents")} AS BIGINT)::VARCHAR END AS line_cost,
 CASE WHEN l.target_cents IS NULL THEN NULL ELSE CAST(${total("l.quantity", "l.target_cents")} AS BIGINT)::VARCHAR END AS line_target
FROM quote_lines l LEFT JOIN products p USING(product_id) WHERE l.quote_id=${Q(id)} ORDER BY l.line_no`);
  let sum = BigInt(0), cost = BigInt(0), costedPrice = BigInt(0), uncosted = 0, targeted = BigInt(0), targetSum = BigInt(0);
  const lines = ls.map(r => {
    const lineTotal = BigInt(String(r.line_total)); sum += lineTotal;
    if (r.line_cost === null) uncosted++; else { cost += BigInt(String(r.line_cost)); costedPrice += lineTotal; }
    if (r.line_target !== null) { targeted += lineTotal; targetSum += BigInt(String(r.line_target)); }
    const base: QuoteLineView = { lineNo: Number(r.line_no), productId: String(r.product_id), description: String(r.description), quantity: String(r.qty), unitCents: String(r.unit), bookCents: str(r.book), source: String(r.price_source) as PriceSource, startCents: str(r.s), targetCents: str(r.t), floorCents: str(r.f), guard: String(r.guard_status) as Guard, totalCents: lineTotal.toString() };
    if (!withCost) return base;
    const lc = r.line_cost === null ? null : BigInt(String(r.line_cost)), margin = lc === null ? null : lineTotal - lc;
    return { ...base, costCents: str(r.cost), marginCents: margin === null ? null : margin.toString(), marginRate: margin === null ? null : bp(rateBp(margin, lineTotal)) };
  });
  const credit_ = await credit(e, String(q.customer_id)), worst = worstOf(lines.map(l => l.guard).filter(g => g !== "unset"));
  const warnings: string[] = [];
  if (lines.some(l => l.guard === "red")) warnings.push(msg("quote.warnBelowFloor"));
  else if (lines.some(l => l.guard === "yellow")) warnings.push(msg("quote.warnBelowTarget"));
  if ((credit_.level === "red" || credit_.level === "amber") && lines.some(l => l.guard === "yellow" || l.guard === "red")) warnings.push(msg("quote.warnSlowPayer"));
  if (lines.some(l => l.guard === "unset")) warnings.push(msg("quote.warnNoGuardrail"));
  const out: QuoteView = {
    id, number: String(q.number), customerId: String(q.customer_id), customerName: String(c?.name ?? ""), tier: String(c?.tier ?? ""), status: String(q.status) as QuoteStatus,
    createdBy: String(q.created_by), createdAt: String(q.created_at), updatedAt: String(q.updated_at), exceptionReason: str(q.exception_reason), decidedBy: str(q.decided_by), decidedAt: str(q.decided_at), decisionNote: str(q.decision_note), relayObject: str(q.relay_object),
    lines, totalCents: sum.toString(), worst, credit: credit_, warnings,
    positionBp: targetSum > BigInt(0) ? (targeted * BigInt(10000) / targetSum).toString() : null,
    needsApproval: lines.some(l => l.guard === "red"), mine: String(q.created_by) === userId, outcome: await outcomeOf(e, id),
    allowedNext: allowedNext(String(q.status) as QuoteStatus, String(q.created_by) === userId, canApprove),
  };
  if (withCost) { const m = costedPrice - cost; Object.assign(out, { costCents: uncosted === lines.length && lines.length ? null : cost.toString(), marginCents: costedPrice === BigInt(0) && uncosted ? null : m.toString(), marginRate: bp(rateBp(m, costedPrice)), uncostedLines: uncosted }); }
  return out;
}
const bp = (v: bigint | null) => v === null ? null : (Number(v) / 100).toFixed(2);

/** Quote history. `pendingOnly` is the approval inbox; `mineOnly` limits a rep to their own quotes. */
export async function list(e: Engine, opts: { pendingOnly?: boolean; userId: string; mineOnly: boolean }): Promise<QuoteSummary[]> {
  const where = [opts.pendingOnly ? "q.status='pending'" : "true", opts.mineOnly ? `q.created_by=${Q(opts.userId)}` : "true"].join(" AND ");
  const r = await rows(e, `SELECT q.id, q.number, q.customer_id, coalesce(c.name,'') AS name, q.status, q.updated_at, q.created_by,
 coalesce((SELECT sum(CAST(${rhaSql("CAST(l.unit_price_cents AS HUGEINT)*CAST(l.quantity*10000 AS HUGEINT)", "10000")} AS BIGINT)) FROM quote_lines l WHERE l.quote_id=q.id),0)::VARCHAR AS total,
 coalesce((SELECT max(CASE guard_status WHEN 'red' THEN 3 WHEN 'yellow' THEN 2 WHEN 'green' THEN 1 ELSE 0 END) FROM quote_lines l WHERE l.quote_id=q.id),0) AS worst
FROM quotes q LEFT JOIN customers c USING(customer_id) WHERE ${where} ORDER BY q.updated_at DESC, q.number DESC LIMIT 200`);
  const W: Guard[] = ["unset", "green", "yellow", "red"];
  return r.map(x => ({ id: String(x.id), number: String(x.number), customerId: String(x.customer_id), customerName: String(x.name), status: String(x.status) as QuoteStatus, totalCents: String(x.total), worst: W[Number(x.worst)], updatedAt: String(x.updated_at), createdBy: String(x.created_by) }));
}
