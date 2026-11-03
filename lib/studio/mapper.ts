// ERP column mapper: canonical names, generic synonyms and ERP profiles with a
// confidence per field. Pure functions (no DOM/DuckDB), unit-tested in Node.
// ERP profiles are built from public documentation and are UNVERIFIED until a real
// export from that ERP has been tested; the user always sees and confirms the mapping.
import { FILE_HINTS, ROLES, ROLE_FIELDS, normalizeHeader, type Role } from "./formats";

export type ErpProfile = "generic" | "netsuite" | "p21" | "infor" | "bc" | "quickbooks";
/** column: value from a column; unit: unit price/cost x quantity; zero: not in file, use 0;
 *  none: not in file, leave unknown; generate: line ID from invoice number (+ line number). */
export type FieldSource =
  | { kind: "column"; index: number } | { kind: "unit"; index: number } | { kind: "zero" } | { kind: "none" }
  | { kind: "generate"; lineNo: number | null };
export type Mapping = Record<string, FieldSource>;
export type MappedField = { field: string; source: FieldSource; confidence: number; reason: string };

/** Alternatives each field may use when no column holds it. */
export const ALTERNATIVES: Partial<Record<Role, Record<string, FieldSource["kind"][]>>> = {
  sales_history: { line_id: ["generate"], list_amount: ["unit"], discount_amount: ["zero"], freight_amount: ["zero"], rebate_amount: ["zero"], cost_amount: ["unit", "none"] },
};
const n = (...names: string[]) => names.map(normalizeHeader);
/** Generic synonyms seen in distributor exports, per canonical field (normalized). */
const SYNONYMS: Record<string, { column: string[]; unit?: string[] }> = {
  line_id: { column: n("line id", "line uid", "invoice line id", "detail id", "transaction line id", "line key") },
  invoice_id: { column: n("invoice id", "invoice", "invoice no", "invoice number", "invoice num", "inv no", "document no", "document number", "doc no", "order no", "transaction id", "num") },
  product_id: { column: n("product id", "sku", "item", "item no", "item number", "item id", "item code", "stock code", "stock no", "part", "part no", "part number", "product", "product code", "material") },
  customer_id: { column: n("customer id", "customer", "customer no", "customer number", "cust id", "cust no", "cust", "account", "account no", "sold to", "bill to", "customer code") },
  sale_date: { column: n("sale date", "date", "invoice date", "posting date", "ship date", "shipped date", "order date", "document date", "transaction date", "tran date") },
  quantity: { column: n("quantity", "qty", "qty shipped", "quantity shipped", "units", "ship qty", "qty invoiced", "quantity invoiced", "qty ordered") },
  list_amount: { column: n("list amount", "amount", "extended price", "ext price", "line total", "sales amount", "net amount", "extended amount", "line amount", "net sales", "sales", "revenue", "gross amount"), unit: n("unit price", "price", "sell price", "selling price", "sales price", "net price", "rate", "item rate", "unit sell", "price each") },
  discount_amount: { column: n("discount amount", "discount", "disc amt", "line discount", "line discount amount", "discount total") },
  freight_amount: { column: n("freight amount", "freight", "shipping", "delivery charge", "freight cost", "shipping cost") },
  rebate_amount: { column: n("rebate amount", "rebate", "off invoice rebate", "rebate total") },
  cost_amount: { column: n("cost amount", "extended cost", "ext cost", "line cost", "cogs", "total cost", "cost of goods", "cost of sales"), unit: n("unit cost", "cost each", "avg cost", "average cost", "cost") },
  description: { column: n("description", "item description", "product description", "desc", "item name", "product name") },
  category: { column: n("category", "product category", "item category", "product group", "item group", "class", "product line") },
  uom: { column: n("uom", "unit", "unit of measure", "base uom", "sales uom") },
  current_cost: { column: n("current cost", "unit cost", "cost", "standard cost", "replacement cost", "avg cost", "average cost", "last cost") },
  list_price: { column: n("list price", "price", "unit price", "sell price", "base price", "msrp") },
  name: { column: n("name", "customer name", "company", "company name", "account name") },
  tier: { column: n("tier", "price tier", "customer tier", "price level", "price class", "pricing tier") },
  branch: { column: n("branch", "location", "warehouse", "store") },
  region: { column: n("region", "territory", "country", "state") },
  payment_terms: { column: n("payment terms", "terms") },
  vendor: { column: n("vendor", "supplier", "vendor name", "supplier name", "manufacturer") },
  cost: { column: n("cost", "unit cost", "new cost", "vendor cost", "price", "net cost") },
  effective_date: { column: n("effective date", "date", "valid from", "start date", "effective") },
  price: { column: n("price", "unit price", "contract price", "net price") },
  valid_from: { column: n("valid from", "start date", "effective date", "from date") },
  valid_to: { column: n("valid to", "end date", "expiry date", "expiration date", "to date") },
  qty_break: { column: n("qty break", "quantity break", "min qty", "minimum quantity", "break qty") },
};
const LINE_NO = n("line no", "line number", "line", "line num", "lineno", "seq", "sequence");
type ProfileField = { column?: string[]; unit?: string[] };
/** ERP-specific header names (normalized). Source: public documentation; unverified. */
export const PROFILES: Record<ErpProfile, { label: string; note: string; fields: Record<string, ProfileField>; lineNo: string[] }> = {
  generic: { label: "Generic export", note: "Common distributor header names.", fields: {}, lineNo: [] },
  netsuite: { label: "Oracle NetSuite (saved search)", note: "Unverified: from NetSuite saved-search column labels in public documentation.", lineNo: n("line", "line id"),
    fields: { invoice_id: { column: n("document number") }, sale_date: { column: n("date") }, customer_id: { column: n("customer", "name") }, product_id: { column: n("item") }, quantity: { column: n("quantity") }, list_amount: { column: n("amount"), unit: n("item rate", "rate") }, cost_amount: { column: n("est extended cost"), unit: n("est unit cost") } } },
  p21: { label: "Epicor Prophet 21", note: "Unverified: from P21 invoice report field names in public documentation.", lineNo: n("line no", "line number"),
    fields: { invoice_id: { column: n("invoice no") }, line_id: { column: n("invoice line uid") }, product_id: { column: n("item id") }, customer_id: { column: n("customer id") }, quantity: { column: n("qty shipped") }, list_amount: { column: n("extended price"), unit: n("unit price") }, cost_amount: { column: n("extended cost"), unit: n("cost", "unit cost") }, sale_date: { column: n("invoice date") } } },
  infor: { label: "Infor CloudSuite Distribution (SX.e/CSD)", note: "Unverified: from SX.e order-entry field names in public documentation.", lineNo: n("lineno", "line no"),
    fields: { invoice_id: { column: n("orderno", "invoice no", "invno") }, product_id: { column: n("shipprod", "prod") }, customer_id: { column: n("custno") }, quantity: { column: n("qtyship") }, list_amount: { column: n("netamt"), unit: n("price") }, cost_amount: { unit: n("prodcost") }, sale_date: { column: n("invoicedt") } } },
  bc: { label: "Microsoft Dynamics 365 Business Central", note: "Unverified: from Business Central sales-line field captions in public documentation.", lineNo: n("line no"),
    fields: { invoice_id: { column: n("document no") }, product_id: { column: n("no", "item no") }, customer_id: { column: n("sell to customer no", "bill to customer no") }, quantity: { column: n("quantity") }, list_amount: { unit: n("unit price", "unit price excl vat") }, discount_amount: { column: n("line discount amount") }, cost_amount: { unit: n("unit cost lcy", "unit cost") }, sale_date: { column: n("posting date") } } },
  quickbooks: { label: "QuickBooks Enterprise (Sales by Item Detail)", note: "Unverified: from the Sales by Item Detail report columns in public documentation.", lineNo: [],
    fields: { invoice_id: { column: n("num") }, sale_date: { column: n("date") }, customer_id: { column: n("name") }, product_id: { column: n("item") }, quantity: { column: n("qty") }, list_amount: { column: n("amount"), unit: n("sales price") } } },
};
export const PROFILE_IDS = Object.keys(PROFILES) as ErpProfile[];
/** Pick the ERP profile whose specific header names best match (generic when none stands out). */
export function detectProfile(headers: string[]): ErpProfile {
  const keys = new Set(headers.map(normalizeHeader));
  // Only names distinctive to an ERP count; "InvoiceNo" or "Unit Price" say nothing about which ERP.
  const generic = new Set(Object.values(SYNONYMS).flatMap(s => [...s.column, ...(s.unit ?? [])]));
  let best: ErpProfile = "generic", bestScore = 1;
  for (const id of PROFILE_IDS) {
    if (id === "generic") continue;
    const p = PROFILES[id], names = Object.values(p.fields).flatMap(f => [...(f.column ?? []), ...(f.unit ?? [])]).filter(x => !generic.has(x));
    const score = names.filter(x => keys.has(x)).length + (p.lineNo.some(x => keys.has(x)) ? 0.5 : 0);
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
type Candidate = { field: string; index: number; kind: "column" | "unit"; score: number; reason: string };
function candidates(role: Role, headers: string[], profile: ErpProfile) {
  const keys = headers.map(normalizeHeader), out: Candidate[] = [], fields = ROLE_FIELDS[role].map(f => f.name);
  const alt = ALTERNATIVES[role] ?? {};
  for (const field of fields) {
    const p = PROFILES[profile].fields[field], g = SYNONYMS[field];
    keys.forEach((key, index) => {
      if (!key) return;
      if (key === normalizeHeader(field)) { out.push({ field, index, kind: "column", score: 1, reason: "Exact column name" }); return; }
      if (p?.column?.includes(key)) out.push({ field, index, kind: "column", score: 0.95, reason: `${PROFILES[profile].label} column name` });
      if (p?.unit?.includes(key) && alt[field]?.includes("unit")) out.push({ field, index, kind: "unit", score: 0.9, reason: `${PROFILES[profile].label} unit value x quantity` });
      if (g?.column.includes(key)) out.push({ field, index, kind: "column", score: 0.9, reason: "Common header name" });
      if (g?.unit?.includes(key) && alt[field]?.includes("unit")) out.push({ field, index, kind: "unit", score: 0.85, reason: "Unit value x quantity" });
      // Fuzzy: the header contains a known name of 5+ letters (e.g. "Net Sales Amount").
      else if (g && !g.column.includes(key) && g.column.some(s => s.length >= 5 && key.includes(s))) out.push({ field, index, kind: "column", score: 0.6, reason: "Partial header match; check it" });
    });
  }
  return out;
}
/** Suggest a mapping: best candidates assigned greedily, one column per field. */
export function suggestMapping(role: Role, headers: string[], profile: ErpProfile = detectProfile(headers)): MappedField[] {
  const fields = ROLE_FIELDS[role], alt = ALTERNATIVES[role] ?? {};
  const all = candidates(role, headers, profile).sort((a, b) => b.score - a.score || (a.kind === "column" ? -1 : 1));
  const used = new Set<number>(), result = new Map<string, MappedField>();
  for (const c of all) {
    if (result.has(c.field) || used.has(c.index)) continue;
    result.set(c.field, { field: c.field, source: { kind: c.kind, index: c.index }, confidence: c.score, reason: c.reason }); used.add(c.index);
  }
  const keys = headers.map(normalizeHeader);
  const lineNo = keys.findIndex((k, i) => !used.has(i) && ([...LINE_NO, ...PROFILES[profile].lineNo]).includes(k));
  for (const f of fields) {
    if (result.has(f.name)) continue;
    const options = alt[f.name] ?? [];
    if (options.includes("generate") && result.has("invoice_id")) result.set(f.name, { field: f.name, source: { kind: "generate", lineNo: lineNo >= 0 ? lineNo : null }, confidence: 0.8, reason: lineNo >= 0 ? "Generated from invoice number and line number" : "Generated from invoice number and line order" });
    else if (options.includes("zero")) result.set(f.name, { field: f.name, source: { kind: "zero" }, confidence: 0.8, reason: "Not in file: 0 will be used" });
    else if (options.includes("none") || !f.required) result.set(f.name, { field: f.name, source: { kind: "none" }, confidence: f.required ? 0 : 1, reason: f.required ? "Not found" : "Not in file" });
    else result.set(f.name, { field: f.name, source: { kind: "none" }, confidence: 0, reason: "Not found" });
  }
  return fields.map(f => result.get(f.name)!);
}
export function toMapping(fields: MappedField[]): Mapping { return Object.fromEntries(fields.map(f => [f.field, f.source])); }
/** Required fields that have neither a column nor an allowed alternative. */
export function mappingProblems(role: Role, mapping: Mapping) {
  const alt = ALTERNATIVES[role] ?? {}, problems: string[] = [];
  for (const f of ROLE_FIELDS[role]) {
    const s = mapping[f.name];
    if (!s) { if (f.required) problems.push(f.name); continue; }
    if (s.kind !== "column" && s.kind !== "none" && !alt[f.name]?.includes(s.kind)) problems.push(f.name);
    else if (f.required && s.kind === "none") problems.push(f.name);
  }
  if (role === "sales_history" && (mapping.line_id?.kind === "generate") && mapping.invoice_id?.kind !== "column") problems.push("invoice_id (needed to generate line IDs)");
  if ((mapping.list_amount?.kind === "unit" || mapping.cost_amount?.kind === "unit") && mapping.quantity?.kind !== "column") problems.push("quantity (needed for unit x quantity)");
  if (role === "price_list" && mapping.product_id?.kind !== "column" && mapping.category?.kind !== "column") problems.push("product_id or category");
  return problems;
}
/** A mapping needs an explicit check when anything was inferred rather than matched exactly. */
export function needsConfirmation(fields: MappedField[]) {
  return fields.some(f => (f.source.kind === "column" && f.confidence < 1) || f.source.kind === "unit" || f.source.kind === "zero" || f.source.kind === "generate" || (f.source.kind === "none" && f.confidence === 0));
}
/** Role score: required-field coverage (alternatives count half) and how much of the file the role explains. */
export function roleScore(role: Role, headers: string[]) {
  const fields = suggestMapping(role, headers), required = ROLE_FIELDS[role].filter(f => f.required);
  const cover = required.reduce((s, f) => { const m = fields.find(x => x.field === f.name)!; return s + (m.source.kind === "column" ? m.confidence : m.source.kind === "unit" ? 0.75 : m.source.kind === "generate" ? 0.5 : 0); }, 0) / Math.max(1, required.length);
  const explained = new Set(fields.flatMap(f => f.source.kind === "column" || f.source.kind === "unit" ? [f.source.index] : [])).size / Math.max(1, headers.filter(h => normalizeHeader(h)).length);
  return Math.round((cover * 0.5 + explained * 0.5) * 100) / 100;
}
/**
 * Score every role (mapping 0.85, file name 0.15). The 4C-1 detector trusted a single
 * matching column, so a real sales export with "CustomerID" was read as a customer
 * list; coverage of the whole file now decides.
 */
export function detectRole(fileName: string, headers: string[]) {
  const scores = {} as Record<Role, number>;
  for (const role of ROLES) {
    const hint = FILE_HINTS.find(([r]) => r === role)?.[1].test(fileName) ? 1 : 0;
    scores[role] = Math.round((roleScore(role, headers) * 0.85 + hint * 0.15) * 100) / 100;
  }
  const best = [...ROLES].sort((a, b) => scores[b] - scores[a])[0];
  return { role: scores[best] >= 0.45 ? best : null, confidence: scores[best], scores };
}
/** Deterministic 53-bit line ID from a key (two FNV-1a 32-bit hashes). Re-importing the same file gives the same IDs. */
export function lineIdFor(key: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return String((a % 2097152) * 4294967296 + b + 1);
}
