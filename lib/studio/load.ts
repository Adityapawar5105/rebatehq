// DuckDB side of the Import Studio: stage converted files, validate exactly, find
// duplicates, then commit or remove with source tracking. Only row/column
// locations and fixed messages leave this module; engine errors (which can embed
// cell values) are replaced by generic text.
import * as duckdb from "@duckdb/duckdb-wasm";
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { ROLE_FIELDS, columnLetter, type Alignment, type DateFormat, type Field, type Role, type Settings } from "./formats";
import { msg } from "../i18n/core";
// Staged values are canonical (cleaned in JS: dot decimals, ISO dates), one column per
// ROLE_FIELDS entry. `alignment` maps fields back to source columns for issue labels.
export type StagedFile = { ord: number; role: Role; name: string; bytes: number; fingerprint: string; alignment: Alignment; settings: Settings; keyed: boolean; headers: string[]; colOffset: number; generatedIds?: boolean;
  /** Sales fields taken from the batch's order header file (6A). */
  fromHeader?: string[];
  /** Cost is quantity x the item list's current cost (6A). */
  itemCost?: boolean };
const CANONICAL: Pick<Settings, "decimal" | "dateFormat"> = { decimal: "dot", dateFormat: "YYYY-MM-DD" };
const STRPTIME: Record<DateFormat, string> = { "YYYY-MM-DD": "%Y-%m-%d", "MM/DD/YYYY": "%m/%d/%Y", "DD/MM/YYYY": "%d/%m/%Y", "DD.MM.YYYY": "%d.%m.%Y", "DD-MM-YYYY": "%d-%m-%Y" };
const q = (name: string) => `"${name}"`;
const stage = (role: Role) => `st_${role}`, typed = (role: Role) => `ty_${role}`;
/** Output column name and SQL type for a canonical field (amounts become whole cents). */
export function output(field: Field) {
  if (field.type === "amount") return { name: field.name.replace(/_amount$/, "") + (field.name.endsWith("_amount") ? "_cents" : ""), type: "BIGINT" };
  return { name: field.name, type: field.type === "line_id" ? "BIGINT" : field.type === "date" ? "DATE" : field.type.startsWith("quantity") ? "DECIMAL(18,4)" : "VARCHAR" };
}
function fieldSql(field: Field, settings: Pick<Settings, "decimal" | "dateFormat">) {
  const x = q(field.name), sep = settings.decimal === "comma" ? "," : "\\.", fmt = sqlText(STRPTIME[settings.dateFormat]);
  const num = (digits: number, scale: number) => `regexp_full_match(${x},'^(0|[1-9][0-9]{0,${digits}})(${sep}[0-9]{1,${scale}})?$')`;
  const dec = (scale: number) => `try_cast(replace(${x},',','.') AS DECIMAL(18,${scale}))`;
  switch (field.type) {
    case "line_id": return { ok: `regexp_full_match(${x},'^[1-9][0-9]{0,17}$')`, value: `try_cast(${x} AS BIGINT)` };
    case "id": return { ok: `length(${x})<=64 AND NOT regexp_matches(${x},'[\\x00-\\x1f\\x7f]')`, value: x };
    case "text": case "code": return { ok: `length(${x})<=${field.max ?? 200}`, value: x };
    case "date": return { ok: `year(try_strptime(${x},${fmt})) BETWEEN 1900 AND 2100`, value: `CAST(try_strptime(${x},${fmt}) AS DATE)` };
    case "quantity": return { ok: `${num(13, 4)} AND ${dec(4)}>0`, value: dec(4) };
    case "quantity0": return { ok: num(13, 4), value: dec(4) };
    case "amount": return { ok: num(12, 2), value: `(${dec(2)}*100)::BIGINT` };
  }
}
export function issueMessage(code: string, settings: Settings) {
  const [name, kind] = code.split(":"), field = Object.values(ROLE_FIELDS).flat().find(f => f.name === name);
  if (code === "duplicate_row") return msg("issue.exactCopyOfAn");
  if (code === "duplicate_key") return msg("issue.repeatsTheKeyOf");
  if (code === "exists") return msg("issue.alreadyLoadedFromAnother");
  if (code === "scope") return msg("issue.giveAProductId");
  if (code === "valid_to:range") return msg("issue.validToMustBe");
  if (code === "no_header") return msg("issue.noRowInThe");
  if (kind === "required") return msg("issue.isRequiredButEmpty", { name });
  if (code === "credit:sign") return msg("issue.aReturnWithA");
  if (kind === "negative") return name === "quantity" ? msg("issue.negativeQuantityAReturn") : msg("issue.negativeOnAPositive", { name });
  switch (field?.type) {
    case "line_id": return msg("issue.useAPositiveWhole");
    case "id": return msg("issue.useAnIdOf");
    case "text": case "code": return msg("issue.useAtMostCharacters", { value: field.max ?? 200 });
    case "date": return msg("issue.useARealDate", { dateFormat: settings.dateFormat });
    case "quantity": return msg("issue.useAQuantityAbove", { value: msg(settings.decimal === "comma" ? "issue.decimalComma" : "issue.decimalDot") });
    case "quantity0": return msg("issue.useANonNegative2", { value: msg(settings.decimal === "comma" ? "issue.decimalComma" : "issue.decimalDot") });
    case "amount": return msg("issue.useANonNegative", { value: msg(settings.decimal === "comma" ? "issue.decimalComma" : "issue.decimalDot") });
  }
  return msg("issue.invalidValue");
}
/** Source column label for an error code: the letter (or field name for JSON/XML). */
export function issueColumn(code: string, file: StagedFile) {
  const name = code.split(":")[0], at = file.alignment.find(a => a.field === name);
  if (!at) return "";
  return file.keyed ? file.headers[at.index] : columnLetter(file.colOffset + at.index);
}
export const CODES = (role: Role) => [...ROLE_FIELDS[role].flatMap(f => [`${f.name}:required`, `${f.name}:invalid`, `${f.name}:negative`]), "duplicate_row", "duplicate_key", "exists", "scope", "valid_to:range", "no_header"];
const KEYS: Record<Exclude<Role, "rebate_agreement">, string[]> = {
  sales_history: ["line_id"], item_master: ["product_id"], customer_list: ["customer_id"], order_header: ["invoice_id"],
  vendor_cost: ["vendor", "product_id", "effective_date"], price_list: ["product_id", "category", "customer_id", "tier", "qty_break", "valid_from"],
};
export async function resetStage(engine: Engine) {
  for (const role of Object.keys(KEYS) as Role[]) await engine.conn.query(`DROP TABLE IF EXISTS temp.${stage(role)}; DROP TABLE IF EXISTS temp.${typed(role)}`);
  await engine.conn.query("DROP TABLE IF EXISTS temp.studio_files; DROP TABLE IF EXISTS temp.studio_messages; DROP TABLE IF EXISTS temp.studio_affected; DROP TABLE IF EXISTS temp.studio_headers; DROP TABLE IF EXISTS temp.studio_unjoined");
}
export async function createStage(engine: Engine, role: Role) {
  const cols = ROLE_FIELDS[role].map(f => `${q(f.name)} VARCHAR`).join(",");
  await engine.conn.query(`CREATE TEMP TABLE ${stage(role)}(file_ord INTEGER, src_row BIGINT, ${cols})`);
}
/** Load one converted internal CSV (canonical columns c0..cN in ROLE_FIELDS order) into its role's stage. */
export async function stageFile(engine: Engine, file: StagedFile, blob: Blob) {
  const path = `studio-${crypto.randomUUID()}.csv`, width = ROLE_FIELDS[file.role].length;
  await engine.db.registerFileHandle(path, new File([blob], path), duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  try {
    const columns = ["__md_row", ...Array.from({ length: width }, (_, i) => `c${i}`)].map(c => `${sqlText(c)}:'VARCHAR'`).join(",");
    const values = ROLE_FIELDS[file.role].map((_, i) => `nullif(c${i},'')`).join(",");
    await engine.conn.query(`INSERT INTO ${stage(file.role)} SELECT ${file.ord}, CAST(__md_row AS BIGINT), ${values} FROM read_csv(${sqlText(path)},header=true,auto_detect=false,delim=',',quote='"',escape='"',strict_mode=true,columns={${columns}})`);
  } finally { await engine.db.dropFile(path); }
}
/** Build typed rows with the first failing field per row, then mark duplicates. */
export async function validate(engine: Engine, role: Exclude<Role, "rebate_agreement">, files: StagedFile[], replaces: string | null) {
  const fields = ROLE_FIELDS[role];
  const parts = files.filter(f => f.role === role).map(file => {
    const sql = fields.map(f => ({ f, ...fieldSql(f, CANONICAL), out: output(f) }));
    const signed = (f: Field) => f.type === "amount" || f.type.startsWith("quantity");
    const err = `coalesce(${sql.map(s => `CASE WHEN ${q(s.f.name)} IS NULL THEN ${s.f.required ? sqlText(s.f.name + ":required") : "NULL"}${signed(s.f) ? ` WHEN ${q(s.f.name)} LIKE '-%' THEN ${sqlText(s.f.name + ":negative")}` : ""} WHEN NOT coalesce(${s.ok},false) THEN ${sqlText(s.f.name + ":invalid")} END`).join(",")})`;
    return `SELECT file_ord, src_row, ${sql.map(s => `CASE WHEN ${q(s.f.name)} IS NOT NULL AND coalesce(${s.ok},false) THEN ${s.value} END::${s.out.type} AS ${q(s.out.name)}`).join(",")}, ${err} AS err FROM ${stage(role)} WHERE file_ord=${file.ord}`;
  });
  await engine.conn.query(`CREATE TEMP TABLE ${typed(role)} AS ${parts.join(" UNION ALL ")}`);
  const t = typed(role), outs = fields.map(f => q(output(f).name)), key = KEYS[role].map(k => q(output(fields.find(f => f.name === k)!).name));
  if (role === "price_list") await engine.conn.query(`UPDATE ${t} SET err='scope' WHERE err IS NULL AND product_id IS NULL AND category IS NULL; UPDATE ${t} SET err='valid_to:range' WHERE err IS NULL AND valid_to IS NOT NULL AND valid_to<=valid_from`);
  const hash = `md5(concat_ws('|',${outs.map(c => `coalesce(${c}::VARCHAR,'\u0001')`).join(",")}))`;
  // 6A: a window over every row (1M rows with md5 strings) exhausted the 512 MB budget. A
  // 64-bit hash count finds the few keys that repeat; the exact window runs on those rows only.
  // A hash collision only adds rows to the exact check; it never marks a row by itself.
  const keyed = (cols: string[]) => `hash(${cols.map(k => `coalesce(${k}::VARCHAR,'')`).join(",")})`;
  const repeats = async (expr: string, where: string) => {
    await engine.conn.query(`DROP TABLE IF EXISTS temp.studio_repeats; CREATE TEMP TABLE studio_repeats AS SELECT ${expr} AS k FROM ${t} WHERE ${where} GROUP BY 1 HAVING count(*)>1`);
    return Number((await engine.conn.query("SELECT count(*)::VARCHAR AS n FROM studio_repeats")).toArray()[0].n) > 0;
  };
  if (await repeats(keyed(key), "err IS NULL")) await engine.conn.query(`UPDATE ${t} SET err=d.code FROM (
SELECT file_ord, src_row, CASE WHEN h=first_h THEN 'duplicate_row' ELSE 'duplicate_key' END AS code FROM (
 SELECT file_ord, src_row, ${hash} AS h, first_value(${hash}) OVER w AS first_h, row_number() OVER w AS rn FROM ${t} WHERE err IS NULL AND ${keyed(key)} IN (SELECT k FROM studio_repeats)
 WINDOW w AS (PARTITION BY ${key.map(k => `coalesce(${k}::VARCHAR,'')`).join(",")} ORDER BY file_ord, src_row)) WHERE rn>1) d
WHERE ${t}.file_ord=d.file_ord AND ${t}.src_row=d.src_row`);
  // Generated line IDs differ per row, so exact copies are found on every other field.
  const generated = files.filter(f => f.role === role && f.generatedIds).map(f => f.ord);
  if (role === "sales_history" && generated.length) {
    const others = outs.filter(c => c !== '"line_id"'), rest = `md5(concat_ws('|',${others.map(c => `coalesce(${c}::VARCHAR,'\u0001')`).join(",")}))`;
    const scope = `err IS NULL AND file_ord IN (${generated.join(",")})`;
    if (await repeats(keyed(others), scope)) await engine.conn.query(`UPDATE ${t} SET err='duplicate_row' FROM (
SELECT file_ord, src_row FROM (SELECT file_ord, src_row, row_number() OVER (PARTITION BY ${rest} ORDER BY file_ord, src_row) AS rn FROM ${t} WHERE ${scope} AND ${keyed(others)} IN (SELECT k FROM studio_repeats)) WHERE rn>1) d
WHERE ${t}.file_ord=d.file_ord AND ${t}.src_row=d.src_row`);
  }
  await engine.conn.query("DROP TABLE IF EXISTS temp.studio_repeats");
  // Rows of the file being replaced do not count as existing.
  const other = (alias = "") => replaces ? `${alias}source_id IS DISTINCT FROM ${sqlText(replaces)}` : "true";
  const exists: Record<typeof role, string> = {
    sales_history: `line_id IN (SELECT line_id FROM sales_lines WHERE ${other()})`,
    item_master: `product_id IN (SELECT product_id FROM products WHERE source_id IS NOT NULL AND ${other()})`,
    customer_list: `customer_id IN (SELECT customer_id FROM customers WHERE source_id IS NOT NULL AND ${other()})`,
    vendor_cost: `EXISTS (SELECT 1 FROM vendor_costs v WHERE v.vendor=${t}.vendor AND v.product_id=${t}.product_id AND v.effective_date=${t}.effective_date AND ${other("v.")})`,
    price_list: `EXISTS (SELECT 1 FROM price_matrix p WHERE p.product_id IS NOT DISTINCT FROM ${t}.product_id AND p.category IS NOT DISTINCT FROM ${t}.category AND p.customer_id IS NOT DISTINCT FROM ${t}.customer_id AND p.tier IS NOT DISTINCT FROM ${t}.tier AND p.qty_break=coalesce(${t}.qty_break,0) AND p.valid_from=${t}.valid_from AND ${other("p.")})`,
    order_header: "false", // headers are never stored, so nothing can already exist
  };
  await engine.conn.query(`UPDATE ${t} SET err='exists' WHERE err IS NULL AND ${exists[role]}`);
}
const SALES = stage("sales_history"), TY_SALES = typed("sales_history");
/**
 * 6A header/line exports: fill the customer and date of staged sales lines from the
 * batch's valid order header rows, matched by invoice number. Call after the header
 * file is validated and before the sales lines are. Returns the invoice numbers'
 * coverage; lines without a header row are marked by markUnjoined after validation.
 */
export async function joinHeaders(engine: Engine, files: StagedFile[]) {
  await engine.conn.query("DROP TABLE IF EXISTS temp.studio_headers; DROP TABLE IF EXISTS temp.studio_unjoined");
  const joined = files.filter(f => f.role === "sales_history" && f.fromHeader?.length);
  if (!joined.length) return;
  await engine.conn.query(`CREATE TEMP TABLE studio_headers AS SELECT invoice_id, customer_id, strftime(sale_date,'%Y-%m-%d') AS sale_date, freight_cents FROM ${typed("order_header")} WHERE err IS NULL;
CREATE TEMP TABLE studio_unjoined AS SELECT file_ord, src_row FROM ${SALES} s WHERE file_ord IN (${joined.map(f => f.ord).join(",")}) AND NOT EXISTS (SELECT 1 FROM studio_headers h WHERE h.invoice_id=s.invoice_id)`);
  const out = new Map<number, { joined: number; unjoined: number }>();
  for (const f of joined) {
    const set = (f.fromHeader ?? []).filter(x => x === "customer_id" || x === "sale_date").map(x => `${q(x)}=h.${q(x)}`);
    if (set.length) await engine.conn.query(`UPDATE ${SALES} SET ${set.join(",")} FROM studio_headers h WHERE ${SALES}.file_ord=${f.ord} AND ${SALES}.invoice_id=h.invoice_id`);
    const r = (await engine.conn.query(`SELECT count(*)::VARCHAR AS n, (SELECT count(*) FROM studio_unjoined WHERE file_ord=${f.ord})::VARCHAR AS u FROM ${SALES} WHERE file_ord=${f.ord}`)).toArray()[0];
    out.set(f.ord, { joined: Number(r.n) - Number(r.u), unjoined: Number(r.u) });
  }
  return out;
}
/** Drop staged lines of one file outside a date range (dates that came from the header file). Returns how many. */
export async function dropOutsideRange(engine: Engine, ord: number, range: { from: string | null; to: string | null }) {
  const cond = [range.from ? `sale_date<${sqlText(range.from)}` : null, range.to ? `sale_date>${sqlText(range.to)}` : null].filter(Boolean).join(" OR ");
  if (!cond) return 0;
  const where = `file_ord=${ord} AND sale_date IS NOT NULL AND (${cond})`;
  const n = Number((await engine.conn.query(`SELECT count(*)::VARCHAR AS n FROM ${SALES} WHERE ${where}`)).toArray()[0].n);
  if (n) await engine.conn.query(`DELETE FROM ${SALES} WHERE ${where}; DELETE FROM studio_unjoined WHERE file_ord=${ord} AND src_row NOT IN (SELECT src_row FROM ${SALES} WHERE file_ord=${ord})`);
  return n;
}
/** Lines whose customer or date had to come from a header row that does not exist (after validation). */
export async function markUnjoined(engine: Engine, files: StagedFile[]) {
  const ords = files.filter(f => f.role === "sales_history" && f.fromHeader?.some(x => x === "customer_id" || x === "sale_date")).map(f => f.ord);
  if (!ords.length) return;
  await engine.conn.query(`UPDATE ${TY_SALES} SET err='no_header' WHERE file_ord IN (${ords.join(",")}) AND EXISTS (SELECT 1 FROM studio_unjoined u WHERE u.file_ord=${TY_SALES}.file_ord AND u.src_row=${TY_SALES}.src_row)`);
}
/**
 * Spread each header's freight over its valid lines in proportion to their list amounts
 * (equally when they are all zero). Whole cents: each line gets the floor of its share and
 * the leftover cents go to the largest remainders, so the lines add up to the header exactly.
 * Returns the number of headers with freight whose lines all failed (their freight is not loaded).
 */
export async function spreadFreight(engine: Engine, files: StagedFile[]) {
  const ords = files.filter(f => f.role === "sales_history" && f.fromHeader?.includes("freight_amount")).map(f => f.ord);
  if (!ords.length) return { spread: 0, unspread: 0 };
  const scope = `file_ord IN (${ords.join(",")})`;
  await engine.conn.query(`UPDATE ${TY_SALES} SET freight_cents=0 WHERE ${scope} AND err IS NULL`);
  await engine.conn.query(`UPDATE ${TY_SALES} SET freight_cents=a.cents FROM (
WITH l AS (SELECT t.file_ord, t.src_row, t.invoice_id, t.list_cents::HUGEINT AS list, h.freight_cents::HUGEINT AS f FROM ${TY_SALES} t JOIN studio_headers h ON h.invoice_id=t.invoice_id WHERE t.err IS NULL AND t.${scope} AND h.freight_cents>0),
w AS (SELECT *, sum(list) OVER (PARTITION BY invoice_id) AS tot, count(*) OVER (PARTITION BY invoice_id) AS n FROM l),
b AS (SELECT *, CASE WHEN tot>0 THEN list ELSE 1 END AS wt, CASE WHEN tot>0 THEN tot ELSE n END AS den FROM w),
c AS (SELECT *, (f*wt)//den AS base, (f*wt)%den AS rem FROM b),
d AS (SELECT *, f-sum(base) OVER (PARTITION BY invoice_id) AS leftover, row_number() OVER (PARTITION BY invoice_id ORDER BY rem DESC, file_ord, src_row) AS rk FROM c)
SELECT file_ord, src_row, (base+CASE WHEN rk<=leftover THEN 1 ELSE 0 END)::BIGINT AS cents FROM d) a
WHERE ${TY_SALES}.file_ord=a.file_ord AND ${TY_SALES}.src_row=a.src_row`);
  const r = (await engine.conn.query(`SELECT count(DISTINCT h.invoice_id) FILTER (WHERE v.invoice_id IS NOT NULL)::VARCHAR AS spread, count(DISTINCT h.invoice_id) FILTER (WHERE v.invoice_id IS NULL)::VARCHAR AS unspread
FROM studio_headers h JOIN (SELECT DISTINCT invoice_id FROM ${SALES} WHERE ${scope}) s ON s.invoice_id=h.invoice_id
LEFT JOIN (SELECT DISTINCT invoice_id FROM ${TY_SALES} WHERE ${scope} AND err IS NULL) v ON v.invoice_id=h.invoice_id WHERE h.freight_cents>0`)).toArray()[0];
  return { spread: Number(r.spread), unspread: Number(r.unspread) };
}
/**
 * 6A: cost from the item list. Valid lines of these files get quantity x the item's current
 * cost, rounded half away from zero to the cent: from a valid item list row in this batch,
 * else from the item already in the vault. Lines whose item has no cost stay unknown.
 */
export async function fillItemCost(engine: Engine, files: StagedFile[], batchItems: boolean) {
  const ords = files.filter(f => f.role === "sales_history" && f.itemCost).map(f => f.ord);
  if (!ords.length) return { costed: 0, unknown: 0 };
  const scope = `file_ord IN (${ords.join(",")})`;
  await engine.conn.query(`UPDATE ${TY_SALES} SET cost_cents=CAST(round(${TY_SALES}.quantity*c.cost) AS BIGINT) FROM (
SELECT product_id, cost FROM (SELECT product_id, current_cost::DECIMAL(18,0) AS cost, 0 AS pri FROM ${batchItems ? `${typed("item_master")} WHERE err IS NULL AND current_cost IS NOT NULL` : "products WHERE false"}
 UNION ALL SELECT product_id, current_cost::DECIMAL(18,0), 1 FROM products WHERE current_cost IS NOT NULL) QUALIFY row_number() OVER (PARTITION BY product_id ORDER BY pri)=1) c
WHERE ${TY_SALES}.product_id=c.product_id AND ${TY_SALES}.${scope} AND ${TY_SALES}.quantity IS NOT NULL`);
  const r = (await engine.conn.query(`SELECT count(*) FILTER (WHERE cost_cents IS NOT NULL)::VARCHAR AS costed, count(*) FILTER (WHERE cost_cents IS NULL)::VARCHAR AS unknown FROM ${TY_SALES} WHERE ${scope} AND err IS NULL`)).toArray()[0];
  return { costed: Number(r.costed), unknown: Number(r.unknown) };
}
export async function counts(engine: Engine, role: Role) {
  return (await engine.conn.query(`SELECT file_ord, count(*) FILTER (WHERE err IS NULL)::VARCHAR AS ok, count(*) FILTER (WHERE err IS NOT NULL)::VARCHAR AS bad FROM ${typed(role)} GROUP BY file_ord`)).toArray().map(r => ({ ord: Number(r.file_ord), ok: String(r.ok), bad: String(r.bad) }));
}
export async function sampleIssues(engine: Engine, role: Role, ord: number, limit = 100) {
  return (await engine.conn.query(`SELECT src_row::VARCHAR AS row, err FROM ${typed(role)} WHERE file_ord=${ord} AND err IS NOT NULL ORDER BY src_row LIMIT ${limit}`)).toArray().map(r => ({ row: Number(r.row), code: String(r.err) }));
}
export async function salesRanges(engine: Engine, replaces: string | null) {
  // Every row with a readable date counts, so re-imported (rejected) rows still show overlap.
  const batch = (await engine.conn.query(`SELECT file_ord, min(sale_date)::VARCHAR AS a, max(sale_date)::VARCHAR AS b FROM ${typed("sales_history")} WHERE sale_date IS NOT NULL GROUP BY file_ord`)).toArray().map(r => ({ ord: Number(r.file_ord), from: String(r.a), to: String(r.b) }));
  const vault = (await engine.conn.query(`SELECT s.name, min(l.sale_date)::VARCHAR AS a, max(l.sale_date)::VARCHAR AS b FROM sales_lines l JOIN source_files s ON s.id=l.source_id WHERE ${replaces ? `l.source_id<>${sqlText(replaces)}` : "true"} GROUP BY s.name`)).toArray().map(r => ({ name: String(r.name), from: String(r.a), to: String(r.b) }));
  return { batch, vault };
}
export async function capUsage(engine: Engine, roles: Set<Role>, replaces: string | null) {
  const lines = (await engine.conn.query(`SELECT (SELECT count(*) FROM sales_lines WHERE ${replaces ? `source_id<>${sqlText(replaces)}` : "true"}) + ${roles.has("sales_history") ? `(SELECT count(*) FROM ${typed("sales_history")} WHERE err IS NULL)` : "0"} AS n`)).toArray()[0].n;
  const sources = ["SELECT product_id FROM products", ...(roles.has("sales_history") ? [`SELECT product_id FROM ${typed("sales_history")} WHERE err IS NULL`] : []), ...(roles.has("item_master") ? [`SELECT product_id FROM ${typed("item_master")} WHERE err IS NULL`] : [])];
  const products = (await engine.conn.query(`SELECT count(DISTINCT product_id) AS n FROM (${sources.join(" UNION ALL ")})`)).toArray()[0].n;
  return { lines: BigInt(lines), products: BigInt(products) };
}
const PRODUCT_RESET = "description='',category='',uom='EA',current_cost=NULL,list_price=NULL,source_id=NULL,source_row=NULL";
const CUSTOMER_RESET = "name='',tier='',branch='',region='',payment_terms='',source_id=NULL,source_row=NULL";
/**
 * Step 1 of removing a source: delete its child rows and un-own master rows. DuckDB
 * cannot delete a parent row in the transaction that deleted its children, so the
 * source row and now-unused products/customers go in step 2 (finishRemoval).
 */
export function removeChildrenSql(source: string) {
  const s = sqlText(source);
  return `CREATE TEMP TABLE IF NOT EXISTS studio_affected(kind VARCHAR, id VARCHAR);
INSERT INTO studio_affected SELECT DISTINCT 'p', product_id FROM sales_lines WHERE source_id=${s} UNION SELECT 'p', product_id FROM products WHERE source_id=${s}
 UNION SELECT DISTINCT 'c', customer_id FROM sales_lines WHERE source_id=${s} UNION SELECT 'c', customer_id FROM customers WHERE source_id=${s};
DELETE FROM sales_lines WHERE source_id=${s}; DELETE FROM vendor_costs WHERE source_id=${s}; DELETE FROM price_matrix WHERE source_id=${s};
UPDATE products SET ${PRODUCT_RESET} WHERE source_id=${s}; UPDATE customers SET ${CUSTOMER_RESET} WHERE source_id=${s};
DELETE FROM import_issues WHERE source_id=${s}; DELETE FROM import_batches WHERE source_id=${s}; DELETE FROM rejected_rows WHERE source_id=${s};`;
}
export function finishRemovalSql(source: string) {
  return `DELETE FROM source_files WHERE id=${sqlText(source)};
DELETE FROM products WHERE source_id IS NULL AND product_id IN (SELECT id FROM studio_affected WHERE kind='p') AND product_id NOT IN (SELECT product_id FROM sales_lines);
DELETE FROM customers WHERE source_id IS NULL AND customer_id IN (SELECT id FROM studio_affected WHERE kind='c') AND customer_id NOT IN (SELECT customer_id FROM sales_lines);
DROP TABLE studio_affected;`;
}
/** Insert valid typed rows for every role in the batch (inside the caller's transaction). */
export function commitSql(roles: Set<Role>) {
  const v = (role: Role) => `(SELECT t.*, m.source_id FROM ${typed(role)} t JOIN studio_files m USING(file_ord) WHERE t.err IS NULL)`;
  const out: string[] = [];
  if (roles.has("sales_history")) out.push(`INSERT INTO products(product_id) SELECT DISTINCT product_id FROM ${v("sales_history")} WHERE product_id NOT IN (SELECT product_id FROM products);
INSERT INTO customers(customer_id) SELECT DISTINCT customer_id FROM ${v("sales_history")} WHERE customer_id NOT IN (SELECT customer_id FROM customers);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id)
 SELECT source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,coalesce(discount_cents,0),coalesce(freight_cents,0),coalesce(rebate_cents,0),cost_cents,src_row,invoice_id FROM ${v("sales_history")} ORDER BY customer_id,sale_date,line_id;`);
  if (roles.has("item_master")) out.push(`UPDATE products SET description=coalesce(t.description,''),category=coalesce(t.category,''),uom=coalesce(t.uom,'EA'),current_cost=t.current_cost,list_price=t.list_price,source_id=t.source_id,source_row=t.src_row FROM ${v("item_master")} t WHERE products.product_id=t.product_id;
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,source_id,source_row) SELECT product_id,coalesce(description,''),coalesce(category,''),coalesce(uom,'EA'),current_cost,list_price,source_id,src_row FROM ${v("item_master")} WHERE product_id NOT IN (SELECT product_id FROM products);`);
  if (roles.has("customer_list")) out.push(`UPDATE customers SET name=coalesce(t.name,''),tier=coalesce(t.tier,''),branch=coalesce(t.branch,''),region=coalesce(t.region,''),payment_terms=coalesce(t.payment_terms,''),source_id=t.source_id,source_row=t.src_row FROM ${v("customer_list")} t WHERE customers.customer_id=t.customer_id;
INSERT INTO customers(customer_id,name,tier,branch,region,payment_terms,source_id,source_row) SELECT customer_id,coalesce(name,''),coalesce(tier,''),coalesce(branch,''),coalesce(region,''),coalesce(payment_terms,''),source_id,src_row FROM ${v("customer_list")} WHERE customer_id NOT IN (SELECT customer_id FROM customers);`);
  if (roles.has("vendor_cost")) out.push(`INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file,source_id,source_row) SELECT gen_random_uuid()::VARCHAR,vendor,product_id,cost,effective_date,(SELECT name FROM studio_files f WHERE f.file_ord=t.file_ord),source_id,src_row FROM ${v("vendor_cost")} t;`);
  if (roles.has("price_list")) out.push(`INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to,source_id,source_row) SELECT gen_random_uuid()::VARCHAR,product_id,category,customer_id,tier,coalesce(qty_break,0),price,valid_from,valid_to,source_id,src_row FROM ${v("price_list")};`);
  for (const role of roles) out.push(`INSERT INTO import_issues(id,source_id,row_number,column_name,message,status,code) SELECT gen_random_uuid()::VARCHAR, m.source_id, t.src_row, s.column_name, s.message, 'open', t.err FROM ${typed(role)} t JOIN studio_files m USING(file_ord) JOIN studio_messages s ON s.file_ord=t.file_ord AND s.code=t.err WHERE t.err IS NOT NULL;
${keepRejectedSql(role)}`);
  return out.join("\n");
}
/** Keep every rejected staged row (canonical values) so Fix Later can correct and reload it. */
function keepRejectedSql(role: Role) {
  const fields = ROLE_FIELDS[role], slots = Array.from({ length: 12 }, (_, i) => i < fields.length ? `s.${q(fields[i].name)}` : "NULL").join(",");
  return `INSERT INTO rejected_rows SELECT m.source_id, s.src_row, ${sqlText(role)}, t.err, ${slots}, 'open' FROM ${stage(role)} s JOIN ${typed(role)} t ON t.file_ord=s.file_ord AND t.src_row=s.src_row JOIN studio_files m ON m.file_ord=s.file_ord WHERE t.err IS NOT NULL ON CONFLICT DO NOTHING;`;
}
