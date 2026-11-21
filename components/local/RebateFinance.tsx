"use client";
// Roadmap 15.3 (22 Nov 2026): what suppliers actually paid against a claim, and the accrual export for finance.
// Nothing is posted to an accounting system: the person records a remittance here and downloads a file there.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { ClaimStatus } from "@/lib/rebate/supplier";
import type { PaymentMethod } from "@/lib/rebate/finance";
import { fmt, t } from "@/lib/i18n";
import { businessToday } from "@/lib/vault/today";
import { Button, ButtonLink, Card, DataTable, Field, Grid, Notice } from "@/components/ui/ui";

const METHODS: Record<PaymentMethod, "payment.method.transfer" | "payment.method.cheque" | "payment.method.credit_memo" | "payment.method.deduction" | "payment.method.other"> = { transfer: "payment.method.transfer", cheque: "payment.method.cheque", credit_memo: "payment.method.credit_memo", deduction: "payment.method.deduction", other: "payment.method.other" };
type Operation = (work: () => Promise<void>) => Promise<void>;

export function ClaimPayments({ client, claimId, status, manage, busy, operation, onChanged }: { client: VaultClient; claimId: string; status: ClaimStatus; manage: boolean; busy: boolean; operation: Operation; onChanged: () => Promise<void> }) {
  const [balance, setBalance] = useState<Results["supplierClaimBalance"] | null>(null), [failed, setFailed] = useState(false);
  const [form, setForm] = useState({ received: businessToday(), amount: "", reference: "", method: "transfer" as PaymentMethod });
  useEffect(() => { let on = true; setBalance(null); setFailed(false); void client.call("supplierClaimBalance", { id: claimId }).then(b => { if (on) setBalance(b); }).catch(() => { if (on) setFailed(true); }); return () => { on = false; }; }, [client, claimId, status]);
  if (!["submitted", "approved", "paid"].includes(status)) return null;
  const payable = status === "submitted" || status === "approved";
  const changed = async (next: Results["supplierClaimBalance"]) => { setBalance(next); await onChanged(); };
  return <section data-testid="claim-payments" aria-busy={!balance && !failed}>
    <h3>{t("payment.heading")}</h3>
    <p>{t("payment.help")}</p>
    {failed && <Notice tone="warn" role="alert">{t("supplier.loadFailed")}</Notice>}
    {balance && <>
      <p data-testid="claim-balance" data-outstanding={balance.outstanding}>{t("payment.claimed")}: <strong>{fmt.currency(balance.claimed)}</strong> · {t("payment.paid")}: <strong>{fmt.currency(balance.paid)}</strong> · {t("payment.outstanding")}: <strong>{fmt.currency(balance.outstanding)}</strong>
        {balance.daysPastDue !== null && <> · <strong data-testid="claim-past-due">{t("payment.pastDue", { count: balance.daysPastDue })}</strong></>}
        {balance.shortPaid !== "0" && <> · <strong data-testid="claim-short-paid">{t("payment.shortPaid", { amount: fmt.currency(balance.shortPaid) })}</strong></>}</p>
      {balance.payments.length ? <DataTable label={t("payment.heading")}><thead><tr><th scope="col">{t("payment.received")}</th><th scope="col">{t("payment.amount")}</th><th scope="col">{t("payment.reference")}</th><th scope="col">{t("payment.method")}</th>{manage && <th scope="col">{t("rebate.actions")}</th>}</tr></thead>
        <tbody>{balance.payments.map(p => <tr key={p.id} data-testid="claim-payment-row" data-voided={p.voided ? "yes" : "no"}><td>{fmt.date(p.received)}</td><td>{p.voided ? <s>{fmt.currency(p.amount)}</s> : fmt.currency(p.amount)}</td><td translate="no">{p.reference}</td><td>{t(METHODS[p.method])}{p.voided && <> · {t("payment.voided")}</>}</td>
          {manage && <td>{!p.voided && <Button size="sm" disabled={busy} onClick={() => void operation(async () => changed(await client.call("supplierPaymentVoid", { id: p.id })))}>{t("payment.void")}</Button>}</td>}</tr>)}</tbody></DataTable>
        : <p>{t("payment.none")}</p>}
      {manage && payable && balance.outstanding !== "0" && <form data-testid="claim-payment-form" onSubmit={e => { e.preventDefault(); void operation(async () => { await changed(await client.call("supplierPaymentRecord", { input: { claim: claimId, ...form } })); setForm(f => ({ ...f, amount: "", reference: "" })); }); }}>
        <Grid>
          <Field label={t("payment.received")}><input type="date" required max={businessToday()} value={form.received} onChange={e => setForm(f => ({ ...f, received: e.target.value }))} data-testid="payment-received"/></Field>
          <Field label={t("payment.amount")}><input inputMode="decimal" required value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="payment-amount"/></Field>
          <Field label={t("payment.reference")}><input required maxLength={100} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} data-testid="payment-reference"/></Field>
          <Field label={t("payment.method")}><select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value as PaymentMethod }))} data-testid="payment-method">{(Object.keys(METHODS) as PaymentMethod[]).map(m => <option key={m} value={m}>{t(METHODS[m])}</option>)}</select></Field>
        </Grid>
        <Button type="submit" variant="primary" disabled={busy} data-testid="payment-record">{t("payment.record")}</Button>
      </form>}
    </>}
  </section>;
}

export function FinanceExport({ client, busy, operation }: { client: VaultClient; busy: boolean; operation: Operation }) {
  const [file, setFile] = useState<{ name: string; url: string; format: string; rows: string } | null>(null);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  const make = (format: "csv" | "xlsx") => void operation(async () => { const f = await client.call("rebateFinanceExport", { format }); setFile({ name: f.name, url: URL.createObjectURL(f.blob), format, rows: f.rows }); });
  return <Card title={t("finance.heading")} description={t("finance.help")} data-testid="finance-export">
    <Button disabled={busy} onClick={() => make("csv")} data-testid="finance-csv">{t("finance.csv")}</Button>
    <Button disabled={busy} onClick={() => make("xlsx")}>{t("finance.xlsx")}</Button>
    {file && <><p data-testid="finance-rows">{t("finance.ready", { count: Number(file.rows) })}</p><ButtonLink variant="primary" href={file.url} onClick={e => { e.currentTarget.download = file.name; }} data-testid="finance-download">{t("finance.download", { format: file.format.toUpperCase() })}</ButtonLink></>}
  </Card>;
}
