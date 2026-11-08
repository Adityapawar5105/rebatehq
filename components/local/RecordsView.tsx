"use client";
// Customers and item master grids with freeform row notes (chunk 7V-3b, blueprint v2.5 items 26-27). Both are
// worker grids: sort and filter run over every row in the local vault. Notes are plain text (rendered as text,
// never HTML), at most 1,000 characters, saved only in the encrypted vault. Shown to roles with `data` only.
import { useEffect, useState } from "react";
import type { VaultClient } from "@/lib/vault/client";
import type { Results } from "@/lib/vault/protocol";
import type { GridQuery } from "@/lib/grid/core";
import { NOTE_LIMIT, noteLength } from "@/lib/notes/limit";
import { errorText, fmt, t } from "@/lib/i18n";
import { Button, Card, EmptyState, Notice, Skeleton } from "@/components/ui/ui";
import { DataGrid } from "@/components/ui/DataGrid";
import styles from "./vault.module.css";

type Kind = "customer" | "product";
/** One note, shown as text with an inline editor. */
function NoteCell({ client, kind, id, value, onSaved }: { client: VaultClient; kind: Kind; id: string; value: string | null; onSaved: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false), [text, setText] = useState(value ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const count = noteLength(text), over = count > NOTE_LIMIT;
  if (!editing) return <div className={styles.noteCell}>
    {value && <p className={styles.noteText} translate="no" data-testid="note-text">{value}</p>}
    <Button size="sm" variant="ghost" aria-label={t("notes.editFor", { id })} onClick={() => { setText(value ?? ""); setError(""); setEditing(true); }} data-testid="note-edit">{t("notes.edit")}</Button>
  </div>;
  return <form className={styles.noteCell} onSubmit={e => { e.preventDefault(); if (over) return; setBusy(true); setError("");
    void client.call("noteSet", { kind, id, text }).then(r => { onSaved(r.notes); setEditing(false); }).catch(err => setError(errorText(err))).finally(() => setBusy(false)); }}>
    <textarea className={styles.noteInput} aria-label={t("notes.noteFor", { id })} value={text} rows={3} onChange={e => setText(e.target.value)} disabled={busy} autoFocus
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} data-testid="note-input"/>
    <span className={over ? styles.noteOver : styles.small} aria-live="polite">{t("notes.count", { count: fmt.int(count), limit: fmt.int(NOTE_LIMIT) })}</span>
    {error && <Notice tone="warn" role="alert">{error}</Notice>}
    <span className={styles.row}>
      <Button size="sm" variant="primary" type="submit" disabled={busy || over} data-testid="note-save">{t("notes.save")}</Button>
      <Button size="sm" disabled={busy} onClick={() => setEditing(false)}>{t("notes.cancel")}</Button>
    </span>
  </form>;
}

function useWorkerGrid<T extends { offset: number; grid: Results["customerList"]["grid"] }>(load: (offset: number, grid: GridQuery) => Promise<T>, version: string) {
  const [view, setView] = useState<T | null>(null), [gq, setGq] = useState<GridQuery>({}), [error, setError] = useState("");
  const run = (offset: number, grid: GridQuery) => { setError(""); return load(offset, grid).then(setView).catch(e => setError(errorText(e))); };
  useEffect(() => { void run(0, gq); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  return { view, setView, gq, error, page: (offset: number) => run(offset, gq), query: (q: GridQuery) => { setGq(q); void run(0, q); } };
}

export function RecordsView({ client, version }: { client: VaultClient; version: string }) {
  const customers = useWorkerGrid((offset, grid) => client.call("customerList", { offset, grid }), version);
  const items = useWorkerGrid((offset, grid) => client.call("productList", { offset, grid }), version);
  const [note, setNote] = useState("");
  const saved = () => setNote(t("notes.saved"));
  const pager = (v: { offset: number; grid: { matched: string } }, page: (o: number) => unknown) => <div className={styles.row}>
    <Button size="sm" icon="chevronLeft" disabled={!v.offset} onClick={() => void page(Math.max(0, v.offset - 50))}>{t("ops.previous")}</Button>
    <Button size="sm" disabled={v.offset + 50 >= Number(v.grid.matched)} onClick={() => void page(v.offset + 50)}>{t("ops.next")}</Button>
  </div>;
  const c = customers.view, p = items.view;
  return <>
    <Card headingId="customers-heading" title={t("notes.customers")} description={t("notes.customersHelp")} data-testid="customer-list">
      <p className={styles.small}>{t("notes.localOnly")}</p>
      <p role="status" className={styles.small}>{note}</p>
      {customers.error && <Notice tone="warn" role="alert">{customers.error}</Notice>}
      {!c ? !customers.error && <Skeleton/> : !c.rows.length && !customers.gq.filters?.length ? <EmptyState icon="users" title={t("notes.none")}/> : <>
        <DataGrid label={t("notes.customers")} testId="customer-grid" rows={c.rows} rowKey={r => r.customer_id}
          remote={{ query: customers.gq, onQuery: customers.query, meta: c.grid, fetch: q => client.call("customerList", { offset: 0, grid: q }).then(v => v.grid) }} columns={[
            { id: "customer_id", name: t("notes.customerId"), value: r => r.customer_id, cell: r => <span translate="no">{r.customer_id}</span> },
            { id: "name", name: t("notes.name"), value: r => r.name, cell: r => <span translate="no">{r.name}</span> },
            { id: "tier", name: t("notes.tier"), value: r => r.tier, cell: r => <span translate="no">{r.tier}</span> },
            { id: "branch", name: t("notes.branch"), value: r => r.branch, cell: r => <span translate="no">{r.branch}</span> },
            { id: "region", name: t("notes.region"), value: r => r.region, cell: r => <span translate="no">{r.region}</span> },
            { id: "payment_terms", name: t("notes.terms"), value: r => r.payment_terms, cell: r => <span translate="no">{r.payment_terms}</span> },
            { id: "lines", name: t("notes.lines"), type: "int", num: true, value: r => r.lines },
            { id: "notes", name: t("notes.note"), value: r => r.notes, cell: r => <NoteCell client={client} kind="customer" id={r.customer_id} value={r.notes}
              onSaved={v => { customers.setView(x => x && { ...x, rows: x.rows.map(y => y.customer_id === r.customer_id ? { ...y, notes: v } : y) }); saved(); }}/> },
          ]}/>
        {pager(c, customers.page)}
      </>}
    </Card>
    <Card headingId="items-heading" title={t("notes.items")} description={t("notes.itemsHelp")} data-testid="item-list">
      {items.error && <Notice tone="warn" role="alert">{items.error}</Notice>}
      {!p ? !items.error && <Skeleton/> : !p.rows.length && !items.gq.filters?.length ? <EmptyState icon="tag" title={t("notes.noneItems")}/> : <>
        <DataGrid label={t("notes.items")} testId="item-grid" rows={p.rows} rowKey={r => r.product_id}
          remote={{ query: items.gq, onQuery: items.query, meta: p.grid, fetch: q => client.call("productList", { offset: 0, grid: q }).then(v => v.grid) }} columns={[
            { id: "product_id", name: t("notes.productId"), value: r => r.product_id, cell: r => <span translate="no">{r.product_id}</span> },
            { id: "description", name: t("notes.description"), value: r => r.description, cell: r => <span translate="no">{r.description}</span> },
            { id: "category", name: t("notes.category"), value: r => r.category, cell: r => <span translate="no">{r.category}</span> },
            { id: "uom", name: t("notes.uom"), value: r => r.uom, cell: r => <span translate="no">{r.uom}</span> },
            { id: "list_price", name: t("notes.listPrice"), type: "money", num: true, value: r => r.list_price },
            ...(p.withCost ? [{ id: "current_cost", name: t("notes.cost"), type: "money" as const, num: true, value: (r: Results["productList"]["rows"][number]) => r.current_cost }] : []),
            { id: "lines", name: t("notes.lines"), type: "int", num: true, value: r => r.lines },
            { id: "notes", name: t("notes.note"), value: r => r.notes, cell: r => <NoteCell client={client} kind="product" id={r.product_id} value={r.notes}
              onSaved={v => { items.setView(x => x && { ...x, rows: x.rows.map(y => y.product_id === r.product_id ? { ...y, notes: v } : y) }); saved(); }}/> },
          ]}/>
        {pager(p, items.page)}
      </>}
    </Card>
  </>;
}
