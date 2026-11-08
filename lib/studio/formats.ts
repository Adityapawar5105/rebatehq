import { msg } from "../i18n/core";
// Import Studio shared types, canonical role columns and header/role detection.
// Pure functions: no DOM, DuckDB or Node APIs, so they run in the worker and in unit tests.
export type Role = "sales_history" | "item_master" | "customer_list" | "vendor_cost" | "rebate_agreement" | "price_list" | "order_header" | "ar_aging";
export type Kind = "csv" | "tsv" | "txt" | "xlsx" | "xlsm" | "xls" | "xlsb" | "ods" | "json" | "xml";
export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
export type Delimiter = "," | ";" | "\t" | "|";
export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "DD.MM.YYYY" | "DD-MM-YYYY";
export type Settings = { sheet: string | null; headerRow: number; headerDepth: 1 | 2 | 3; delimiter: Delimiter; encoding: Encoding; decimal: "dot" | "comma"; dateFormat: DateFormat; sourceCurrency?: string; fxRate?: string };
export type StudioIssue = { row: number; column: string; message: string };
export class StudioError extends Error {}

export const ROLES: Role[] = ["sales_history", "item_master", "customer_list", "vendor_cost", "price_list", "rebate_agreement", "order_header", "ar_aging"];
export const ROLE_LABELS: Record<Role, string> = {
  sales_history: msg("filetype.salesHistory"), item_master: msg("filetype.itemMaster"), customer_list: msg("filetype.customerList"),
  vendor_cost: msg("filetype.vendorCostSheet"), rebate_agreement: msg("filetype.rebateAgreement"), price_list: msg("filetype.priceList"), order_header: msg("filetype.orderHeadersJoinedTo"), ar_aging: msg("filetype.arAging"),
};
export const DATE_FORMATS: DateFormat[] = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "DD-MM-YYYY"];
export const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];

export type FieldType = "line_id" | "id" | "text" | "code" | "date" | "quantity" | "quantity0" | "amount" | "rate";
export type Field = { name: string; type: FieldType; required: boolean; max?: number };
const f = (name: string, type: FieldType, required = false, max?: number): Field => ({ name, type, required, max });
/**
 * Canonical columns per role. Column mapping from other ERP header names is chunk
 * 4C-2; here headers align only when their normalized name equals a canonical name.
 */
export const ROLE_FIELDS: Record<Role, Field[]> = {
  // Blank discount/freight/rebate load as 0; a blank cost stays unknown (NULL), never 0.
  // line_type (6A) only filters rows during conversion: non-item lines (G/L accounts, charges, comments) are skipped.
  sales_history: [f("line_id", "line_id", true), f("invoice_id", "text", false, 64), f("product_id", "id", true), f("customer_id", "id", true), f("sale_date", "date", true), f("quantity", "quantity", true), f("list_amount", "amount", true), f("discount_amount", "amount"), f("freight_amount", "amount"), f("rebate_amount", "amount"), f("cost_amount", "amount"), f("line_type", "text", false, 40)],
  item_master: [f("product_id", "id", true), f("description", "text", false, 500), f("category", "text", false, 200), f("uom", "code", false, 16), f("current_cost", "amount"), f("list_price", "amount")],
  customer_list: [f("customer_id", "id", true), f("name", "text", false, 300), f("tier", "text", false, 100), f("branch", "text", false, 100), f("region", "text", false, 100), f("payment_terms", "text", false, 100)],
  vendor_cost: [f("vendor", "text", true, 200), f("product_id", "id", true), f("cost", "amount", true), f("effective_date", "date", true)],
  price_list: [f("product_id", "id"), f("category", "text", false, 200), f("customer_id", "id"), f("tier", "text", false, 100), f("qty_break", "quantity0"), f("price", "amount", true), f("valid_from", "date", true), f("valid_to", "date")],
  rebate_agreement: [f("program_id", "text", true, 100), f("party", "id", true), f("rate_percent", "rate", true), f("threshold_amount", "amount"), f("period_start", "date", true), f("period_end", "date", true),f('calculation_mode','text',false,16),f('to_amount','amount'),f('eligible_skus','text',false,500),f('excluded_skus','text',false,500),f('party_type','text',false,16),f('rebate_treatment','text',false,16)],
  // 6A: an order-header export (customer, date, freight per invoice) joined to a lines file by invoice number. Never stored on its own.
  order_header: [f("invoice_id", "text", true, 64), f("customer_id", "id", true), f("sale_date", "date", true), f("freight_amount", "amount")],
  // 7B: accounts-receivable aging per customer, for the Quote Desk credit signal. Balances are line totals in the
  // workspace currency; a credit (negative) balance is rejected to Fix Later rather than guessed.
  ar_aging: [f("customer_id", "id", true), f("as_of_date", "date"), f("current_amount", "amount"), f("due_1_30_amount", "amount"), f("due_31_60_amount", "amount"), f("due_61_90_amount", "amount"), f("due_over_90_amount", "amount"), f("credit_limit_amount", "amount"), f("dso_days", "quantity0")],
};
/** Roles whose rows load into the vault; customer rebate agreements are enabled in 7D-1. */
export const LOADABLE: Role[] = ["sales_history", "item_master", "customer_list", "vendor_cost", "price_list", "ar_aging","rebate_agreement"];
/** Roles a batch can use: the loadable ones plus order headers, which fill in sales lines and are not stored themselves. */
export const USABLE: Role[] = [...LOADABLE, "order_header"];
export const FILE_HINTS: Array<[Role, RegExp]> = [
  ["sales_history", /sales|invoice|history|orders?/i], ["item_master", /item|product|catalog|sku/i],
  ["customer_list", /customer|account|client/i], ["vendor_cost", /vendor|supplier|cost/i],
  ["rebate_agreement", /rebate|program|agreement/i], ["price_list", /price|matrix|tariff/i], ["order_header", /head(er)?s?\b|^orders?\.\w+$/i], ["ar_aging", /aging|ageing|receivable|\bar[\s_-]|overdue|credit/i],
];

export function normalizeHeader(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
export function columnLetter(index: number) { let s = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }

export type Alignment = { field: string; index: number }[];
/** Canonical field -> header index (first occurrence wins). Unmatched fields are absent. */
export function align(role: Role, headers: string[]): Alignment {
  const seen = new Map<string, number>();
  headers.forEach((h, i) => { const key = normalizeHeader(h); if (key && !seen.has(key)) seen.set(key, i); });
  return ROLE_FIELDS[role].flatMap(field => { const index = seen.get(normalizeHeader(field.name)); return index === undefined ? [] : [{ field: field.name, index }]; });
}
export function missingRequired(role: Role, alignment: Alignment) {
  const have = new Set(alignment.map(a => a.field));
  const missing = ROLE_FIELDS[role].filter(field => field.required && !have.has(field.name)).map(field => field.name);
  if (role === "price_list" && !have.has("product_id") && !have.has("category")) missing.push("product_id or category");
  return missing;
}

const NUMERIC = /^[+-]?(\d+([.,]\d+)?|\d{1,3}([ ,.]\d{3})+([.,]\d+)?)$/;
const DATE_LIKE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/;
const textish = (v: string) => v !== "" && !NUMERIC.test(v) && !DATE_LIKE.test(v);
const nonEmpty = (row: string[]) => row.reduce((n, v) => n + (v !== "" ? 1 : 0), 0);
/**
 * Pick the header row among the first rows: mostly text cells, with canonical-name
 * matches weighted heavily. Depth 2 when the row above is a sparser text row (a
 * merged group header). Returns 0-based indexes into `rows`.
 */
export function detectHeader(rows: string[][], merged = false): { headerRow: number; headerDepth: 1 | 2 } {
  const canonical = new Set(ROLES.flatMap(role => ROLE_FIELDS[role].map(field => normalizeHeader(field.name))));
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r], filled = nonEmpty(row);
    if (filled < 2) continue;
    const text = row.filter(textish).length;
    if (text / filled < 0.6) continue;
    // Header names are rarely plain numbers; a row with many is data (6A: headerless exports).
    if (row.filter(v => NUMERIC.test(v)).length / filled > 0.25) continue;
    const next = rows[r + 1];
    const matches = row.filter(v => canonical.has(normalizeHeader(v))).length;
    const score = matches * 3 + text + (next && nonEmpty(next) >= 2 ? 1 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  // No row looks like headers in a multi-column file: it has no header row (columns become A, B, C...).
  if (bestScore < 0 && rows.slice(0, 5).some(row => nonEmpty(row) >= 2)) return { headerRow: NO_HEADER, headerDepth: 1 };
  const above = best > 0 ? rows[best - 1] : null;
  const depth = above && merged && nonEmpty(above) >= 1 && nonEmpty(above) < nonEmpty(rows[best]) && above.filter(v => v !== "").every(textish) ? 2 : 1;
  return { headerRow: best, headerDepth: depth };
}
/** headerRow value meaning "this file has no header row": every row is data, columns are named by letter. */
export const NO_HEADER = -1;
/** Combine 1-3 header rows into one name per column; parents fill right across blanks. */
export function headerNames(rows: string[][], headerRow: number, depth: number) {
  if (headerRow < 0) return Array.from({ length: Math.max(0, ...rows.slice(0, 200).map(r => r.length)) }, (_, c) => `Column ${columnLetter(c)}`);
  const top = Math.max(0, headerRow - depth + 1), width = Math.max(0, ...rows.slice(top, headerRow + 1).map(r => r.length));
  const parts: string[][] = Array.from({ length: width }, () => []);
  for (let r = top; r <= headerRow; r++) {
    let carry = "";
    for (let c = 0; c < width; c++) {
      const value = (rows[r]?.[c] ?? "").trim();
      const part = value || (r < headerRow ? carry : "");
      if (value) carry = value;
      if (part && parts[c].at(-1) !== part) parts[c].push(part);
    }
  }
  const names = parts.map((p, c) => p.join(" ") || `Column ${columnLetter(c)}`), seen = new Map<string, number>();
  return names.map(name => { const key = normalizeHeader(name), n = (seen.get(key) || 0) + 1; seen.set(key, n); return n > 1 ? `${name} (${n})` : name; });
}
export const TOTAL = /^(sub[ -]?total|grand total|total)\b/i;
export const FOOTER =/\b(page \d+|printed|generated|report|confidential|end of|continued)\b|^\*+$/i;
export type RowVerdict = "data" | "blank" | "total" | "footer";
/** Classify a data-area row. Totals, page/footer labels and blanks are skipped, never loaded. */
export function classifyRow(cells: string[], headerCount: number): RowVerdict {
  const filled = cells.filter(v => v !== "");
  if (!filled.length) return "blank";
  if (cells.slice(0, 3).some(v => TOTAL.test(v))) return "total";
  if (filled.length === 1 && headerCount >= 3 && textish(filled[0]) && (FOOTER.test(filled[0]) || filled[0].length > 15 && filled[0].includes(" "))) return "footer";
  return "data";
}
/** Decimal style from data cells: comma when comma decimals clearly dominate. */
export function detectDecimal(rows: string[][], delimiter: Delimiter): "dot" | "comma" {
  let comma = 0, dot = 0;
  for (const row of rows) for (const v of row) { if (/^-?\d+,\d{1,4}$/.test(v)) comma++; else if (/^-?\d+\.\d{1,4}$/.test(v)) dot++; }
  return comma > dot && (delimiter !== "," || comma > 0 && dot === 0) ? "comma" : "dot";
}
/** Date order from data cells; ambiguous slash dates default to US month-first with a notice. */
export function detectDateFormat(rows: string[][]): { format: DateFormat; ambiguous: boolean } {
  let iso = 0, dayFirst = false, monthFirst = false, sep = "", other = 0;
  for (const row of rows) for (const raw of row) {
    const v = raw.replace(/[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, ""); // ignore a time of day
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { iso++; continue; }
    const m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(v);
    if (!m) continue;
    other++; sep ||= m[2];
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[3]) > 12) monthFirst = true;
  }
  if (!other || iso >= other) return { format: "YYYY-MM-DD", ambiguous: false };
  if (sep === ".") return { format: "DD.MM.YYYY", ambiguous: false };
  if (sep === "-") return { format: "DD-MM-YYYY", ambiguous: !dayFirst };
  if (dayFirst && !monthFirst) return { format: "DD/MM/YYYY", ambiguous: false };
  return { format: "MM/DD/YYYY", ambiguous: !monthFirst };
}
/** Parse a date in the chosen format to ISO; null when it is not a real calendar date. */
export function isoDate(value: string, format: DateFormat) {
  const patterns: Record<DateFormat, [RegExp, number, number, number]> = {
    "YYYY-MM-DD": [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, 1, 2, 3], "MM/DD/YYYY": [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, 3, 1, 2],
    "DD/MM/YYYY": [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, 3, 2, 1], "DD.MM.YYYY": [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, 3, 2, 1], "DD-MM-YYYY": [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, 3, 2, 1],
  };
  const [re, yi, mi, di] = patterns[format], m = re.exec(value);
  if (!m) return null;
  const y = Number(m[yi]), mo = Number(m[mi]), d = Number(m[di]), t = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2100 || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/**
 * Clean-CSV form of a value in a known column: dot decimals, two-decimal amounts,
 * ISO dates. Values that do not parse are kept verbatim (the import reports them).
 */
export function canonicalValue(type: FieldType, value: string, settings: Pick<Settings, "decimal" | "dateFormat">) {
  if (!value) return value;
  if (type === "date") return isoDate(value, settings.dateFormat) ?? value;
  if (type === "amount" || type === "quantity" || type === "quantity0") {
    const m = (settings.decimal === "comma" ? /^(\d+)(?:,(\d+))?$/ : /^(\d+)(?:\.(\d+))?$/).exec(value);
    if (!m) return value;
    if (type === "amount") return (m[2] ?? "").length > 2 ? value : `${m[1]}.${(m[2] ?? "").padEnd(2, "0")}`;
    return m[2] ? `${m[1]}.${m[2]}` : m[1];
  }
  return value;
}
/** Stable header fingerprint for converter recipes (FNV-1a over kind + normalized headers). */
export function fingerprint(kind: Kind, headers: string[]) {
  let h = 0x811c9dc5;
  for (const ch of [kind, ...headers.map(normalizeHeader)].join("\u0001")) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${kind}:${headers.length}:${h.toString(16).padStart(8, "0")}`;
}
export function kindOf(name: string): Kind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
  return (["csv", "tsv", "txt", "xlsx", "xlsm", "xls", "xlsb", "ods", "json", "xml"] as const).find(k => k === ext) || null;
}
export const SPREADSHEET: Kind[] = ["xlsx", "xlsm", "xls", "xlsb", "ods"];
export const TEXT: Kind[] = ["csv", "tsv", "txt"];
