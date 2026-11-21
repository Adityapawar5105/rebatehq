"use client";
// Roadmap 15.6 (22 Nov 2026): the column editor for a workspace's own ERP export layout. Each column is a header and
// one exported field (or a fixed value); the order, separator, decimal mark, date format and header row are chosen
// here. The worker checks the layout again before saving it, and the file is built in the worker.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import { DATE_FORMATS, DELIMITERS, LAYOUT_FIELDS, formatDate, type Layout, type LayoutColumn, type LayoutField, type LayoutSpec } from "@/lib/pricing/layout-spec";
import { t } from "@/lib/i18n";
import { Button, Card, Checkbox, DataTable, Field, Grid, Notice } from "@/components/ui/ui";

type FieldKey = "layout.field.product_id" | "layout.field.tier" | "layout.field.price" | "layout.field.effective_from" | "layout.field.valid_to" | "layout.field.customer_id" | "layout.field.category" | "layout.field.qty_break" | "layout.field.currency" | "layout.field.constant";
const FIELD: Record<LayoutField, FieldKey> = { product_id: "layout.field.product_id", tier: "layout.field.tier", price: "layout.field.price", effective_from: "layout.field.effective_from", valid_to: "layout.field.valid_to", customer_id: "layout.field.customer_id", category: "layout.field.category", qty_break: "layout.field.qty_break", currency: "layout.field.currency", constant: "layout.field.constant" };
const DELIMITER: Record<LayoutSpec["delimiter"], "layout.delimiter.comma" | "layout.delimiter.semicolon" | "layout.delimiter.tab" | "layout.delimiter.pipe"> = { ",": "layout.delimiter.comma", ";": "layout.delimiter.semicolon", "\t": "layout.delimiter.tab", "|": "layout.delimiter.pipe" };
const blank = (): LayoutSpec => ({ name: "", columns: [{ header: "Item", field: "product_id" }, { header: "Price", field: "price" }, { header: "Effective date", field: "effective_from" }], delimiter: ",", decimal: "dot", date: "YYYY-MM-DD", header: true });

export function useExportLayouts(client: VaultClient, enabled: boolean) {
  const [list, setList] = useState<Layout[]>([]);
  useEffect(() => { if (!enabled) return; let on = true; void client.call("exportLayouts", {}).then(v => { if (on) setList(v); }).catch(() => undefined); return () => { on = false; }; }, [client, enabled]);
  return [list, setList] as const;
}

export function ExportLayoutEditor({ client, busy, run, list, setList }: { client: VaultClient; busy: boolean; run: (work: () => Promise<void>) => void; list: Layout[]; setList: (l: Layout[]) => void }) {
  const [form, setForm] = useState<LayoutSpec>(blank), [editing, setEditing] = useState<string | null>(null);
  const setColumn = (i: number, patch: Partial<LayoutColumn>) => setForm(f => ({ ...f, columns: f.columns.map((c, n) => n === i ? { ...c, ...patch } : c) }));
  const move = (i: number, by: number) => setForm(f => { const c = [...f.columns], j = i + by; if (j < 0 || j >= c.length) return f; [c[i], c[j]] = [c[j], c[i]]; return { ...f, columns: c }; });
  const sample = form.columns.map(c => c.field === "price" ? (form.decimal === "comma" ? "12,50" : "12.50") : c.field === "effective_from" ? formatDate("2026-12-01", form.date) : c.field === "constant" ? (c.value ?? "") : c.field === "product_id" ? "SKU-100" : "…");
  const sep = form.delimiter === "\t" ? " ⇥ " : form.delimiter;
  return <Card title={t("layout.heading")} description={t("layout.help")} data-testid="layout-editor">
    {list.length > 0 && <ul>{list.map(l => <li key={l.id} data-testid="layout-item"><span translate="no">{l.name}</span> <Button size="sm" disabled={busy} onClick={() => { setEditing(l.id); setForm({ name: l.name, columns: l.columns, delimiter: l.delimiter, decimal: l.decimal, date: l.date, header: l.header }); }}>{t("layout.edit")}</Button> <Button size="sm" disabled={busy} onClick={() => run(async () => { setList(await client.call("exportLayoutDelete", { id: l.id })); if (editing === l.id) { setEditing(null); setForm(blank()); } })}>{t("layout.delete")}</Button></li>)}</ul>}
    <form onSubmit={e => { e.preventDefault(); run(async () => { setList(await client.call("exportLayoutSave", { input: form, ...(editing ? { id: editing } : {}) })); setEditing(null); setForm(blank()); }); }}>
      <Grid>
        <Field label={t("layout.name")}><input required maxLength={60} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="layout-name"/></Field>
        <Field label={t("layout.delimiter")}><select value={form.delimiter} onChange={e => setForm(f => ({ ...f, delimiter: e.target.value as LayoutSpec["delimiter"] }))} data-testid="layout-delimiter">{DELIMITERS.map(d => <option key={d} value={d}>{t(DELIMITER[d])}</option>)}</select></Field>
        <Field label={t("layout.decimal")}><select value={form.decimal} onChange={e => setForm(f => ({ ...f, decimal: e.target.value as LayoutSpec["decimal"] }))} data-testid="layout-decimal"><option value="dot">{t("layout.decimal.dot")}</option><option value="comma">{t("layout.decimal.comma")}</option></select></Field>
        <Field label={t("layout.date")}><select value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value as LayoutSpec["date"] }))} data-testid="layout-date">{DATE_FORMATS.map(d => <option key={d} value={d}>{d}</option>)}</select></Field>
      </Grid>
      <Checkbox label={t("layout.headerRow")} checked={form.header} onChange={e => setForm(f => ({ ...f, header: e.target.checked }))}/>
      <DataTable label={t("layout.columns")}><thead><tr><th scope="col">{t("layout.header")}</th><th scope="col">{t("layout.field")}</th><th scope="col">{t("layout.fixedValue")}</th><th scope="col">{t("rebate.actions")}</th></tr></thead>
        <tbody>{form.columns.map((c, i) => <tr key={i} data-testid="layout-column">
          <td><input aria-label={t("layout.header")} required maxLength={60} value={c.header} onChange={e => setColumn(i, { header: e.target.value })}/></td>
          <td><select aria-label={t("layout.field")} value={c.field} onChange={e => setColumn(i, { field: e.target.value as LayoutField, value: e.target.value === "constant" ? c.value ?? "" : undefined })}>{LAYOUT_FIELDS.map(f => <option key={f} value={f}>{t(FIELD[f])}</option>)}</select></td>
          <td>{c.field === "constant" && <input aria-label={t("layout.fixedValue")} maxLength={60} value={c.value ?? ""} onChange={e => setColumn(i, { value: e.target.value })}/>}</td>
          <td><Button size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("layout.up")}>↑</Button><Button size="sm" disabled={i === form.columns.length - 1} onClick={() => move(i, 1)} aria-label={t("layout.down")}>↓</Button><Button size="sm" disabled={form.columns.length === 1} onClick={() => setForm(f => ({ ...f, columns: f.columns.filter((_, n) => n !== i) }))}>{t("layout.remove")}</Button></td>
        </tr>)}</tbody></DataTable>
      <Button disabled={form.columns.length >= 30} onClick={() => setForm(f => ({ ...f, columns: [...f.columns, { header: "", field: "tier" }] }))} data-testid="layout-add-column">{t("layout.addColumn")}</Button>
      <Notice><span translate="no" data-testid="layout-preview">{form.header ? form.columns.map(c => c.header).join(sep) + " / " : ""}{sample.join(sep)}</span></Notice>
      <Button type="submit" variant="primary" disabled={busy} data-testid="layout-save">{t(editing ? "layout.update" : "layout.save")}</Button>
      {editing && <Button onClick={() => { setEditing(null); setForm(blank()); }}>{t("common.close")}</Button>}
    </form>
  </Card>;
}
