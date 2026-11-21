// Roadmap 15.3 (21 Nov 2026): claim payment tracking and the accrual export for finance. Local only: nothing is
// posted to an accounting system. Money is integer minor units; the export is exact decimal text, formula-safe.
import * as XLSX from "xlsx";
import type { Engine } from "../vault/engine";
import { sqlText as Q, minorUnits, validDate } from "../spike/exact";
import { rows } from "../pricing/rules";
import { centsText } from "../margin/decimal";
import { csvRow, csvSafeCell } from "../csv";
import { workspaceCurrency } from "../vault/currency";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { hasRebates } from "./input";
import { get, type ClaimStatus } from "./supplier";

export const PAYMENT_METHODS = ["transfer", "cheque", "credit_memo", "deduction", "other"] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaymentInput = { claim: string; received: string; amount: string; reference: string; method: PaymentMethod };
export type Payment = { id: string; received: string; amount: string; reference: string; method: PaymentMethod; recordedBy: string; recordedAt: string; voided: boolean };
export type ClaimBalance = { claimed: string; paid: string; outstanding: string; shortPaid: string; daysPastDue: number | null; payments: Payment[] };
function bad(): never { throw new VaultError("SUPPLIER", msg("payment.invalid")); }
const text = (v: unknown, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) bad(); return v.trim(); };
/** Statuses a payment can be recorded against: the claim went to the supplier and is not closed. */
const PAYABLE: ClaimStatus[] = ["submitted", "approved"];
const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);

export async function balance(e: Engine, claimId: string, today: string): Promise<ClaimBalance> {
  const c = await get(e, claimId);
  const list = (await rows(e, `SELECT id,received_on::VARCHAR received,amount_cents::VARCHAR amount,reference,method,recorded_by,recorded_at,voided_at FROM claim_payments WHERE claim_id=${Q(c.id)} ORDER BY received_on,recorded_at,id`))
    .map(r => ({ id: String(r.id), received: String(r.received), amount: String(r.amount), reference: String(r.reference), method: r.method as PaymentMethod, recordedBy: String(r.recorded_by), recordedAt: String(r.recorded_at), voided: r.voided_at !== null }));
  const claimed = BigInt(c.claimed ?? "0"), paid = list.filter(p => !p.voided).reduce((s, p) => s + BigInt(p.amount), BigInt(0));
  const open = c.status === "submitted" || c.status === "approved", outstanding = open && claimed > paid ? claimed - paid : BigInt(0);
  const shortPaid = c.status === "paid" && claimed > paid && list.length ? claimed - paid : BigInt(0);
  return { claimed: String(claimed), paid: String(paid), outstanding: String(outstanding), shortPaid: String(shortPaid), daysPastDue: outstanding > BigInt(0) && today > c.due ? days(c.due, today) : null, payments: list };
}
/** One payment against a submitted or approved claim, never more than the open balance. A claim the payments now
 * cover in full is marked paid. Returns the SQL for the caller's audited transaction. */
export async function paymentSql(e: Engine, input: PaymentInput, actor: string, at: string, today: string) {
  if (!input || typeof input !== "object") bad();
  const c = await get(e, text(input.claim, 100));
  if (!PAYABLE.includes(c.status) || c.claimed === null) throw new VaultError("SUPPLIER", msg("payment.notPayable"));
  const received = text(input.received, 10); if (!validDate(received) || received > today) bad();
  const reference = text(input.reference, 100), method = input.method;
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) bad();
  let amount: bigint; try { amount = minorUnits(text(input.amount, 20)); } catch { bad(); }
  const b = await balance(e, c.id, today);
  if (amount <= BigInt(0)) bad();
  if (amount > BigInt(b.outstanding)) throw new VaultError("SUPPLIER", msg("payment.overBalance", { open: centsText(BigInt(b.outstanding)) }));
  const id = crypto.randomUUID(), full = amount === BigInt(b.outstanding);
  return { id, full, sql: `INSERT INTO claim_payments VALUES(${Q(id)},${Q(c.id)},DATE ${Q(received)},${amount},${Q(reference)},${Q(method)},${Q(actor)},${Q(at)},NULL,NULL);${full ? `UPDATE supplier_claims SET status='paid',updated_at=${Q(at)} WHERE id=${Q(c.id)};` : ""}` };
}
/** A mistaken payment is voided, never deleted; a paid claim it no longer covers goes back to approved. */
export async function voidSql(e: Engine, paymentId: string, actor: string, at: string, today: string) {
  const r = (await rows(e, `SELECT claim_id,voided_at FROM claim_payments WHERE id=${Q(text(paymentId, 64))}`))[0];
  if (!r || r.voided_at !== null) bad();
  const c = await get(e, String(r.claim_id)), b = await balance(e, c.id, today);
  const p = b.payments.find(x => x.id === paymentId)!, reopen = c.status === "paid" && BigInt(b.paid) - BigInt(p.amount) < BigInt(c.claimed ?? "0");
  return { claim: c.id, sql: `UPDATE claim_payments SET voided_by=${Q(actor)},voided_at=${Q(at)} WHERE id=${Q(paymentId)};${reopen ? `UPDATE supplier_claims SET status='approved',updated_at=${Q(at)} WHERE id=${Q(c.id)};` : ""}` };
}

export const FINANCE_HEADERS = ["record_type", "period", "reference", "counterparty", "currency", "booking_mode", "accrued", "booked", "adjustment", "liability", "claim_status", "due_date", "claimed", "paid", "outstanding", "days_past_due", "exported_at"];
/** Customer rebate accruals by programme and sale month (the adjustment and liability finance books), then supplier
 * claims sent to suppliers with what was paid and what is still owed. Exact decimal text; no note or free text but
 * references and names the person entered. */
export async function financeRows(e: Engine, today: string, at: string) {
  const currency = await workspaceCurrency(e), out: Record<string, string>[] = [];
  if (await hasRebates(e)) for (const r of await rows(e, `SELECT strftime(s.sale_date,'%Y-%m') period,p.reference,p.customer_id,p.booking_mode,sum(a.accrued_cents)::VARCHAR accrued,sum(a.booked_cents)::VARCHAR booked,
 sum(CASE WHEN p.booking_mode='replace' THEN a.accrued_cents-a.booked_cents ELSE a.accrued_cents END)::VARCHAR adjustment
 FROM rebate_accruals a JOIN rebate_programs p ON p.id=a.program_id AND p.enabled JOIN sales_lines s ON s.source_id=a.source_id AND s.line_id=a.line_id GROUP BY ALL ORDER BY p.reference,period`)) {
    const booked = BigInt(String(r.booked)), adjustment = BigInt(String(r.adjustment));
    out.push({ record_type: "customer_accrual", period: String(r.period), reference: String(r.reference), counterparty: String(r.customer_id), currency, booking_mode: String(r.booking_mode), accrued: centsText(BigInt(String(r.accrued))), booked: centsText(booked), adjustment: centsText(adjustment), liability: centsText(booked + adjustment), exported_at: at });
  }
  for (const c of await rows(e, `SELECT id,reference,supplier,status,due_date::VARCHAR due,strftime(period_end,'%Y-%m') period FROM supplier_claims WHERE status IN ('submitted','approved','paid') ORDER BY due_date,reference`)) {
    const b = await balance(e, String(c.id), today);
    out.push({ record_type: "supplier_claim", period: String(c.period), reference: String(c.reference), counterparty: String(c.supplier), currency, claim_status: String(c.status), due_date: String(c.due), claimed: centsText(BigInt(b.claimed)), paid: centsText(BigInt(b.paid)), outstanding: centsText(BigInt(b.outstanding)), days_past_due: b.daysPastDue === null ? "" : String(b.daysPastDue), exported_at: at });
  }
  return out;
}
export function financeFile(data: Record<string, string>[], format: "csv" | "xlsx", today: string) {
  const table = [FINANCE_HEADERS, ...data.map(r => FINANCE_HEADERS.map(k => r[k] ?? ""))];
  let blob: Blob;
  if (format === "xlsx") { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(table.map(r => r.map(csvSafeCell))), "Rebates"); blob = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); }
  else blob = new Blob(["﻿" + table.map(csvRow).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  return { name: `rebatehq-rebate-finance-${today}.${format}`, blob, rows: String(data.length) };
}
