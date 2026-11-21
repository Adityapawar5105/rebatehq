// Roadmap 15.6 (22 Nov 2026): a workspace's own ERP export layout, for an ERP that is none of the six built in. A
// layout picks the columns (each a header and one exported field, or a fixed value), their order, the separator,
// the decimal mark, the date format and whether a header row is written. It reshapes the same approved rows the
// export receipt records, so a custom file holds exactly the prices the built-in export would.
import * as XLSX from "xlsx";
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { rows } from "./rules";
import { centsText } from "../margin/decimal";
import { csvSafeCell } from "../csv";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import type { Receipt } from "./market";
import { LAYOUT_FIELDS, DELIMITERS, DATE_FORMATS, formatDate, type Layout, type LayoutColumn, type LayoutField, type LayoutSpec } from "./layout-spec";
export * from "./layout-spec";

function bad(): never { throw new VaultError("PRICING", msg("layout.invalid")); }
const text = (v: unknown, max: number, empty = false) => { if (typeof v !== "string" || v.length > max || /[\x00-\x1f\x7f]/.test(v) || (!empty && !v.trim())) bad(); return v.trim(); };

export function checkLayout(input: unknown): LayoutSpec {
  if (!input || typeof input !== "object") bad();
  const i = input as Record<string, unknown>;
  const name = text(i.name, 60);
  if (!Array.isArray(i.columns) || i.columns.length < 1 || i.columns.length > 30) bad();
  const columns = i.columns.map((c: unknown) => {
    if (!c || typeof c !== "object") bad();
    const { header, field, value } = c as Record<string, unknown>;
    if (!(LAYOUT_FIELDS as readonly unknown[]).includes(field)) bad();
    return field === "constant" ? { header: text(header, 60), field: "constant" as const, value: text(value ?? "", 60, true) } : { header: text(header, 60), field: field as LayoutField };
  });
  const lower = columns.map(c => c.header.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new VaultError("PRICING", msg("layout.duplicateHeader"));
  if (!columns.some(c => c.field === "product_id") || !columns.some(c => c.field === "price")) throw new VaultError("PRICING", msg("layout.needsProductPrice"));
  if (!(DELIMITERS as readonly unknown[]).includes(i.delimiter) || !["dot", "comma"].includes(i.decimal as string) || !(DATE_FORMATS as readonly unknown[]).includes(i.date) || typeof i.header !== "boolean") bad();
  if (i.delimiter === "," && i.decimal === "comma") throw new VaultError("PRICING", msg("layout.commaClash"));
  return { name, columns, delimiter: i.delimiter as LayoutSpec["delimiter"], decimal: i.decimal as LayoutSpec["decimal"], date: i.date as LayoutSpec["date"], header: i.header };
}
export async function layouts(e: Engine): Promise<Layout[]> {
  return (await rows(e, "SELECT id,layout_json,updated_by,updated_at FROM export_layouts ORDER BY lower(name),id")).map(r => ({ ...JSON.parse(String(r.layout_json)) as LayoutSpec, id: String(r.id), updatedBy: String(r.updated_by), updatedAt: String(r.updated_at) }));
}
export async function layout(e: Engine, id: unknown) { const l = (await layouts(e)).find(x => x.id === id); if (!l) bad(); return l; }
export async function saveSql(e: Engine, input: unknown, id: unknown, actor: string, at: string) {
  const spec = checkLayout(input), existing = await layouts(e);
  if (id !== undefined && id !== null && !existing.some(l => l.id === id)) bad();
  if (existing.some(l => l.id !== id && l.name.toLowerCase() === spec.name.toLowerCase())) throw new VaultError("PRICING", msg("layout.duplicateName"));
  const key = typeof id === "string" ? id : crypto.randomUUID(), json = JSON.stringify(spec);
  return { id: key, sql: `DELETE FROM export_layouts WHERE id=${Q(key)};INSERT INTO export_layouts VALUES(${Q(key)},${Q(spec.name)},${Q(json)},${Q(actor)},${Q(at)});` };
}
export async function deleteSql(e: Engine, id: unknown) { const l = await layout(e, id); return `DELETE FROM export_layouts WHERE id=${Q(l.id)};`; }

const number = (v: string, decimal: LayoutSpec["decimal"]) => decimal === "comma" ? v.replace(".", ",") : v;
/** The layout's table: optional header row, then one row per exported price, every cell formula-safe. */
export function layoutTable(l: LayoutSpec, receipt: Receipt) {
  const cell = (c: LayoutColumn, r: Receipt["rows"][number]) => {
    switch (c.field) {
      case "product_id": return r.product; case "tier": return r.tier; case "price": return number(centsText(BigInt(r.price)), l.decimal);
      case "effective_from": return formatDate(r.from, l.date); case "valid_to": return r.to ? formatDate(r.to, l.date) : ""; case "customer_id": return r.customer;
      case "category": return r.category; case "qty_break": return number(r.quantity, l.decimal); case "currency": return receipt.currency ?? ""; case "constant": return c.value ?? "";
    }
  };
  const body = receipt.rows.map(r => l.columns.map(c => csvSafeCell(cell(c, r))));
  return l.header ? [l.columns.map(c => csvSafeCell(c.header)), ...body] : body;
}
export function layoutFile(l: LayoutSpec, receipt: Receipt, format: "csv" | "xlsx") {
  const table = layoutTable(l, receipt), slug = l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "custom";
  let blob: Blob;
  if (format === "xlsx") { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(table), "Prices"); blob = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); }
  else {
    const quote = (v: string) => v.includes(l.delimiter) || /["\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
    blob = new Blob(["﻿" + table.map(r => r.map(quote).join(l.delimiter)).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  }
  return { name: `rebatehq-${slug}-prices.${format}`, blob };
}
