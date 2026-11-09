import {hasSupplier} from '../rebate/input';
// Freeform row notes (chunk 7V-3b, blueprint v2.5 items 26-27): a plain-text note of at most 1,000 characters
// on each customer and product. Notes stay in the encrypted local vault: they are never relayed, never sent to
// the server, never in ERP exports and never shown to a role without the `data` capability (Sales Reps).
// They are rendered as text, never HTML. Also the customer list and item master grids (the grid standard).
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { sqlText as Q } from "../spike/exact";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridSpec } from "../grid/core";

import { NOTE_LIMIT, noteLength } from "./limit";
export { NOTE_LIMIT, noteLength };
export type NoteKind = "customer" | "product";
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** A valid note, trimmed; an empty note is stored as no note (NULL). */
export function checkNote(text: unknown): string | null {
  if (typeof text !== "string" || CONTROL.test(text)) throw new VaultError("NOTE", msg("notes.invalid"));
  const value = text.replace(/\r\n?/g, "\n").trim();
  if (noteLength(value) > NOTE_LIMIT) throw new VaultError("NOTE", msg("notes.tooLong", { limit: NOTE_LIMIT }));
  return value ? value : null;
}
const KEY: Record<NoteKind, { table: string; id: string }> = { customer: { table: "customers", id: "customer_id" }, product: { table: "products", id: "product_id" } };
const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? null : String(v);

/** The SQL that saves one note; refuses an unknown row or a bad note before anything is written. */
export async function noteSql(e: Engine, kind: unknown, id: unknown, text: unknown): Promise<string> {
  if (kind !== "customer" && kind !== "product") throw new VaultError("NOTE", msg("notes.invalid"));
  if (typeof id !== "string" || !id || id.length > 200) throw new VaultError("NOTE", msg("notes.invalid"));
  const value = checkNote(text), k = KEY[kind];
  if (!(await rows(e, `SELECT 1 FROM ${k.table} WHERE ${k.id}=${Q(id)}`)).length) throw new VaultError("NOTE", msg("notes.missingRow"));
  return `UPDATE ${k.table} SET notes=${value === null ? "NULL" : Q(value)} WHERE ${k.id}=${Q(id)};`;
}

export const CUSTOMER_GRID: GridSpec = { customer_id: "text", name: "text", tier: "text", branch: "text", region: "text", payment_terms: "text", lines: "int", notes: "text" };
export const PRODUCT_GRID: GridSpec = { product_id: "text", description: "text", category: "text", uom: "text", list_price: "money", current_cost: "money", lines: "int", notes: "text" };
export type CustomerRow = { customer_id: string; name: string; tier: string; branch: string; region: string; payment_terms: string; lines: string; notes: string | null };
export type ProductRow = { product_id: string; description: string; category: string; uom: string; list_price: string | null; current_cost: string | null; lines: string; notes: string | null };

/** The customer list grid (worker grid; sort and filter over every customer). Callers hold the `data` capability. */
export async function customerList(e: Engine, offset = 0, grid?: unknown) {
  const base = `SELECT c.customer_id, c.name, c.tier, c.branch, c.region, c.payment_terms, coalesce(n.lines,0)::VARCHAR AS lines, c.notes
FROM customers c LEFT JOIN (SELECT customer_id, count(*) AS lines FROM sales_lines GROUP BY 1) n USING(customer_id)`;
  const page = await gridPage(e, base, CUSTOMER_GRID, gridQuery(CUSTOMER_GRID, grid), { fallback: "g.customer_id", limit: 50, offset: Math.max(0, Math.floor(offset)) });
  return { rows: page.rows.map(r => ({ customer_id: String(r.customer_id), name: String(r.name ?? ""), tier: String(r.tier ?? ""), branch: String(r.branch ?? ""), region: String(r.region ?? ""), payment_terms: String(r.payment_terms ?? ""), lines: String(r.lines), notes: S(r.notes) })) as CustomerRow[], offset, grid: page.grid };
}
/** The item master grid. Current cost is a column only for a role with the `cost` capability (decision 16). */
export async function productList(e: Engine, withCost: boolean, offset = 0, grid?: unknown) {
  const spec: GridSpec = withCost ? PRODUCT_GRID : Object.fromEntries(Object.entries(PRODUCT_GRID).filter(([k]) => k !== "current_cost"));
  const base = `SELECT p.product_id, p.description, p.category, p.uom, p.list_price::VARCHAR AS list_price, ${withCost ? "p.current_cost::VARCHAR AS current_cost," : ""} coalesce(n.lines,0)::VARCHAR AS lines, p.notes
FROM products p LEFT JOIN (SELECT product_id, count(*) AS lines FROM sales_lines GROUP BY 1) n USING(product_id)`;
  const page = await gridPage(e, base, spec, gridQuery(spec, grid), { fallback: "g.product_id", limit: 50, offset: Math.max(0, Math.floor(offset)) });
  return { withCost, rows: page.rows.map(r => ({ product_id: String(r.product_id), description: String(r.description ?? ""), category: String(r.category ?? ""), uom: String(r.uom ?? ""), list_price: S(r.list_price), current_cost: withCost ? S(r.current_cost) : null, lines: String(r.lines), notes: S(r.notes) })) as ProductRow[], offset, grid: page.grid };
}

/** How many notes removing this source file would delete with the customer and product rows that removal drops
 * (rows owned by no other file and used by no other file's invoice lines). Mirrors lib/studio/load.ts. */
export async function removalNotes(e: Engine, sourceId: string) {
  const s = Q(sourceId),purchases=await hasSupplier(e);
  const r = (await rows(e, `SELECT
 (SELECT count(*) FROM products p WHERE coalesce(p.notes,'')<>'' AND (p.source_id IS NULL OR p.source_id=${s})
   AND p.product_id IN (SELECT product_id FROM sales_lines WHERE source_id=${s} UNION SELECT product_id FROM products WHERE source_id=${s} ${purchases?`UNION SELECT product_id FROM purchases WHERE source_id=${s}`:''})
   AND p.product_id NOT IN (SELECT product_id FROM sales_lines WHERE source_id<>${s}) ${purchases?`AND p.product_id NOT IN(SELECT product_id FROM purchases WHERE source_id<>${s})`:''})::VARCHAR AS products,
 (SELECT count(*) FROM customers c WHERE coalesce(c.notes,'')<>'' AND (c.source_id IS NULL OR c.source_id=${s})
   AND c.customer_id IN (SELECT customer_id FROM sales_lines WHERE source_id=${s} UNION SELECT customer_id FROM customers WHERE source_id=${s} UNION SELECT customer_id FROM credit_profiles WHERE source_id=${s})
   AND c.customer_id NOT IN (SELECT customer_id FROM sales_lines WHERE source_id<>${s}))::VARCHAR AS customers`))[0];
  return { products: String(r.products), customers: String(r.customers) };
}
