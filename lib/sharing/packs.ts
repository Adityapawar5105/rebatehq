// Team sharing (SHARING_DESIGN.md, blueprint section 22 item 38): what each data pack carries, how it is read on the
// publishing device and how it is applied on a receiving one. Every column a pack carries is listed here (an allow-list);
// tests/sharing.test.ts fails when a column of a source table is neither carried nor held back, so a new column is never
// shared by accident. Packs without cost never carry a cost column (decision 16); the scan below runs before every export.
import { sqlText as Q } from "../spike/exact";
import { VaultError } from "../vault/protocol";
import { capsFor, type RoleId } from "../roles/access";
import { msg } from "../i18n/core";
import type { Engine } from "../vault/engine";

export const PACK_IDS = ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors"] as const;
export type PackId = typeof PACK_IDS[number];
export const PACK_LABEL = { items: "share.pack.items", customers: "share.pack.customers", book: "share.pack.book", contracts: "share.pack.contracts", guards: "share.pack.guards", cost: "share.pack.cost", cost_floors: "share.pack.cost_floors" } as const satisfies Record<PackId, string>;
export type ColType = "text" | "money" | "decimal" | "date";
type Part = {
  /** Source table and the rows of it this pack covers. */
  table: string; where: string;
  /** Carried columns: name, type, and the expression read on the publishing device (defaults to the column). */
  columns: Array<{ name: string; type: ColType; read?: string }>;
  /** Columns that identify a row on the receiving device; a received row replaces the device's own row with the same key. */
  key: string[];
};
export type PackDef = { id: PackId; cost: boolean; needs: PackId[]; parts: Part[] };
const col = (name: string, type: ColType = "text", read?: string) => ({ name, type, ...(read ? { read } : {}) });

export const PACKS: Record<PackId, PackDef> = {
  items: { id: "items", cost: false, needs: [], parts: [{ table: "products", where: "TRUE", key: ["product_id"],
    columns: [col("product_id"), col("description"), col("category"), col("uom"), col("list_price", "money"), col("barcode")] }] },
  customers: { id: "customers", cost: false, needs: [], parts: [{ table: "customers", where: "TRUE", key: ["customer_id"],
    columns: [col("customer_id"), col("name"), col("tier"), col("branch"), col("region"), col("payment_terms")] }] },
  book: { id: "book", cost: false, needs: [], parts: [{ table: "price_matrix", where: "customer_id IS NULL", key: ["product_id", "category", "tier", "qty_break", "valid_from"],
    columns: [col("id"), col("product_id"), col("category"), col("tier"), col("qty_break", "decimal"), col("price", "money"), col("valid_from", "date"), col("valid_to", "date")] }] },
  contracts: { id: "contracts", cost: false, needs: [], parts: [{ table: "price_matrix", where: "customer_id IS NOT NULL", key: ["product_id", "category", "customer_id", "tier", "qty_break", "valid_from"],
    columns: [col("id"), col("product_id"), col("category"), col("customer_id"), col("tier"), col("qty_break", "decimal"), col("price", "money"), col("valid_from", "date"), col("valid_to", "date")] }] },
  // A floor flagged as based on cost is never sent without cost: the pack carries the target in its place, so a
  // receiving rep treats anything under target as needing approval (fail closed). The real floor travels in cost_floors.
  guards: { id: "guards", cost: false, needs: [], parts: [{ table: "price_guardrails", where: "tier IS NOT NULL", key: ["tier", "category"],
    columns: [col("tier"), col("category"), col("start", "money"), col("target", "money"), col("floor", "money", "CASE WHEN floor_from_cost THEN target ELSE floor END")] }] },
  cost: { id: "cost", cost: true, needs: ["items"], parts: [
    { table: "products", where: "current_cost IS NOT NULL", key: ["product_id"], columns: [col("product_id"), col("current_cost", "money")] },
    { table: "vendor_costs", where: "TRUE", key: ["id"], columns: [col("id"), col("vendor"), col("product_id"), col("cost", "money"), col("effective_date", "date")] },
    { table: "cost_basis_settings", where: "TRUE", key: ["product_group"], columns: [col("product_group"), col("basis")] },
  ] },
  cost_floors: { id: "cost_floors", cost: true, needs: ["guards"], parts: [{ table: "price_guardrails", where: "tier IS NOT NULL AND floor_from_cost", key: ["tier", "category"],
    columns: [col("tier"), col("category"), col("floor", "money")] }] },
};

/**
 * Every column of every source table, carried by a pack or held back with a reason. tests/sharing.test.ts compares this
 * with the real schema, so adding a column to one of these tables fails until it is classified here.
 */
export const HELD: Record<string, Record<string, string>> = {
  products: { source_id: "where the row came from on this device", source_row: "where the row came from on this device", notes: "row notes stay on the device that wrote them (7V-3b)" },
  customers: { source_id: "provenance", source_row: "provenance", notes: "row notes stay on the device that wrote them (7V-3b)" },
  price_matrix: { source_id: "provenance; set to shared:<pack> on the receiving device", source_row: "provenance" },
  price_guardrails: { id: "a new ID is made on the receiving device", scope: "always unit_price for tier guardrails", floor_from_cost: "decides which pack a floor travels in" },
  vendor_costs: { source_file: "a file name on the publishing device", source_id: "provenance", source_row: "provenance" },
  cost_basis_settings: {},
};
export const SOURCE_TABLES = Object.keys(HELD);

/** The cost lock (decision D18): a pack with cost is never sent to, or loaded by, a role without the cost capability. */
export const packAllowed = (pack: PackId, role: RoleId, namedOwner = false) => !PACKS[pack].cost || capsFor(role, namedOwner).includes("cost");

const bad = (text: string): never => { throw new VaultError("SHARE", text); };
/** A pack selection in canonical order, with every pack's prerequisites present. */
export function selection(packs: unknown): PackId[] {
  if (!Array.isArray(packs) || !packs.length || packs.some(p => !(PACK_IDS as readonly string[]).includes(p as string))) return bad(msg("share.err.choosePacks"));
  const chosen = PACK_IDS.filter(p => packs.includes(p));
  for (const p of chosen) for (const n of PACKS[p].needs) if (!chosen.includes(n)) bad(msg("share.err.needs", { pack: msg(PACK_LABEL[p]), needs: msg(PACK_LABEL[n]) }));
  return chosen;
}

export type PackData = { part: number; columns: string[]; rows: Array<Array<string | null>> }[];
const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => Object.fromEntries(Object.entries(r)));
/** Read one pack on the publishing device. Values are strings (money and counts are exact), or null. */
export async function readPack(e: Engine, pack: PackId): Promise<PackData> {
  const out: PackData = [];
  for (const [i, p] of PACKS[pack].parts.entries()) {
    const select = p.columns.map(c => `CAST(${c.read ?? c.name} AS VARCHAR) AS ${c.name}`).join(",");
    const found = await rows(e, `SELECT ${select} FROM ${p.table} WHERE ${p.where} ORDER BY ${p.key.join(",")}`);
    out.push({ part: i, columns: p.columns.map(c => c.name), rows: found.map(r => p.columns.map(c => r[c.name] === null || r[c.name] === undefined ? null : String(r[c.name]))) });
  }
  scanPack(pack, out);
  return out;
}

/**
 * The decision 16 scan, run before export and again before a pack is applied: a pack's columns are exactly its
 * allow-list, a pack without cost has no column named like cost or margin, and every value has the declared type.
 */
export function scanPack(pack: PackId, data: PackData) {
  const def = PACKS[pack];
  if (!Array.isArray(data) || data.length !== def.parts.length) bad(msg("share.err.damaged"));
  for (const [i, p] of def.parts.entries()) {
    const d = data[i];
    if (!d || d.part !== i || JSON.stringify(d.columns) !== JSON.stringify(p.columns.map(c => c.name)) || !Array.isArray(d.rows)) bad(msg("share.err.damaged"));
    if (!def.cost && d.columns.some(c => /cost|margin/i.test(c))) bad(msg("share.err.costInPack"));
    for (const r of d.rows) {
      if (!Array.isArray(r) || r.length !== p.columns.length) bad(msg("share.err.damaged"));
      p.columns.forEach((c, j) => { if (!valid(c.type, r[j])) bad(msg("share.err.damaged")); });
    }
  }
}
function valid(type: ColType, v: unknown) {
  if (v === null) return true;
  if (typeof v !== "string" || v.length > 4000) return false;
  if (type === "money") return /^-?(0|[1-9]\d{0,17})$/.test(v);
  if (type === "decimal") return /^-?\d{1,14}(\.\d{1,4})?$/.test(v);
  if (type === "date") return /^\d{4}-\d\d-\d\d$/.test(v);
  return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
}
const literal = (type: ColType, v: string | null) => v === null ? "NULL" : type === "text" ? Q(v) : type === "date" ? `DATE ${Q(v)}` : type === "decimal" ? `CAST(${Q(v)} AS DECIMAL(18,4))` : v;
const keyMatch = (key: string[], a: string, b: string) => key.map(k => `${a}.${k} IS NOT DISTINCT FROM ${b}.${k}`).join(" AND ");

/** What applying a pack changed: prices for the price packs, a count for the others. */
export type Change = { key: string; before: string | null; after: string | null };
const qty = (v: unknown) => v === null || v === undefined ? "" : String(v).replace(/(.d*?)0+$/, "$1").replace(/.$/, "");
const CHANGED: Partial<Record<PackId, { value: string; label: (r: Record<string, unknown>) => string }>> = {
  book: { value: "price", label: r => [r.product_id ?? r.category, r.tier, qty(r.qty_break)].filter(v => v !== null && v !== undefined && v !== "").join(" · ") },
  contracts: { value: "price", label: r => [r.customer_id, r.product_id ?? r.category, qty(r.qty_break)].filter(v => v !== null && v !== undefined && v !== "").join(" · ") },
  guards: { value: "target", label: r => [r.tier, r.category].join(" · ") },
};
export const CHANGE_LIMIT = 2000;

/**
 * SQL-backed apply of one pack inside the caller's transaction. A received row replaces the device's own row with the
 * same key; rows from an earlier copy of the same pack that the new copy no longer has are removed (prices, guardrails
 * and vendor costs). Items and customers are never deleted, because sales lines may still point at them.
 */
export async function applyPack(e: Engine, pack: PackId, data: PackData): Promise<{ rows: number; changes: Change[] }> {
  scanPack(pack, data);
  const def = PACKS[pack], tag = Q(`shared:${pack}`);
  let changes: Change[] = [];
  for (const [i, p] of def.parts.entries()) {
    const d = data[i], tmp = `md_share_${pack}_${i}`;
    await e.conn.query(`DROP TABLE IF EXISTS ${tmp}; CREATE TEMP TABLE ${tmp}(${p.columns.map(c => `${c.name} ${c.type === "money" ? "BIGINT" : c.type === "decimal" ? "DECIMAL(18,4)" : c.type === "date" ? "DATE" : "VARCHAR"}`).join(",")})`);
    for (let at = 0; at < d.rows.length; at += 500)
      await e.conn.query(`INSERT INTO ${tmp} VALUES ${d.rows.slice(at, at + 500).map(r => `(${r.map((v, j) => literal(p.columns[j].type, v)).join(",")})`).join(",")}`);
    const names = p.columns.map(c => c.name), cols = names.join(",");
    const watch = i === 0 ? CHANGED[pack] : undefined;
    if (watch) await e.conn.query(`DROP TABLE IF EXISTS md_share_before; CREATE TEMP TABLE md_share_before AS SELECT ${p.key.join(",")},CAST(${watch.value} AS VARCHAR) AS v FROM ${p.table} WHERE ${p.where}`);
    if (pack === "items" || pack === "customers") {
      const id = p.key[0], rest = names.filter(n => n !== id);
      await e.conn.query(`UPDATE ${p.table} SET ${rest.map(n => `${n}=s.${n}`).join(",")} FROM ${tmp} s WHERE ${p.table}.${id}=s.${id};
        INSERT INTO ${p.table}(${cols},source_id) SELECT ${cols},${tag} FROM ${tmp} s WHERE NOT EXISTS(SELECT 1 FROM ${p.table} t WHERE t.${id}=s.${id})`);
    } else if (pack === "cost" && p.table === "products") {
      await e.conn.query(`UPDATE products SET current_cost=s.current_cost FROM ${tmp} s WHERE products.product_id=s.product_id`);
    } else if (pack === "cost" && p.table === "cost_basis_settings") {
      await e.conn.query(`DELETE FROM cost_basis_settings; INSERT INTO cost_basis_settings SELECT ${cols} FROM ${tmp}`);
    } else if (pack === "cost") {
      await e.conn.query(`DELETE FROM vendor_costs WHERE source_id=${tag} OR id IN (SELECT id FROM ${tmp});
        INSERT INTO vendor_costs(${cols},source_file,source_id) SELECT ${cols},'shared',${tag} FROM ${tmp}`);
    } else if (pack === "cost_floors") {
      await e.conn.query(`UPDATE price_guardrails SET floor=s.floor,floor_from_cost=true FROM ${tmp} s WHERE price_guardrails.tier=s.tier AND price_guardrails.category IS NOT DISTINCT FROM s.category AND s.floor<=price_guardrails.target`);
    } else if (pack === "guards") {
      await e.conn.query(`DELETE FROM price_guardrails t WHERE tier IS NOT NULL AND (EXISTS(SELECT 1 FROM ${tmp} s WHERE ${keyMatch(p.key, "s", "t")}) OR t.id LIKE 'shared-%');
        INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category,floor_from_cost) SELECT 'shared-'||md5(tier||'|'||coalesce(category,'')),'unit_price',start,target,floor,tier,category,false FROM ${tmp}`);
    } else {
      await e.conn.query(`DELETE FROM price_matrix t WHERE ${p.where} AND (t.source_id=${tag} OR EXISTS(SELECT 1 FROM ${tmp} s WHERE ${keyMatch(p.key, "s", "t")}) OR t.id IN (SELECT id FROM ${tmp}));
        INSERT INTO price_matrix(${cols},source_id) SELECT ${cols},${tag} FROM ${tmp}`);
    }
    if (watch) {
      const found = await rows(e, `SELECT ${p.key.map(k => `CAST(coalesce(n.${k},b.${k}) AS VARCHAR) AS ${k}`).join(",")},b.v AS before,CAST(n.${watch.value} AS VARCHAR) AS after
        FROM (SELECT * FROM ${p.table} WHERE ${p.where}) n FULL OUTER JOIN md_share_before b ON ${keyMatch(p.key, "n", "b")}
        WHERE b.v IS DISTINCT FROM CAST(n.${watch.value} AS VARCHAR) ORDER BY 1,2 LIMIT ${CHANGE_LIMIT}`);
      changes = found.map(r => ({ key: watch.label(r), before: r.before === null ? null : String(r.before), after: r.after === null ? null : String(r.after) }));
      await e.conn.query("DROP TABLE md_share_before");
    }
    await e.conn.query(`DROP TABLE ${tmp}`);
  }
  return { rows: data.reduce((n, d) => n + d.rows.length, 0), changes };
}
