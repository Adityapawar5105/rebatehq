// ERP column mapper: canonical names, generic synonyms and ERP profiles with a
// confidence per field. Pure functions (no DOM/DuckDB), unit-tested in Node.
// ERP profiles are built from public documentation and are UNVERIFIED until a real
// export from that ERP has been tested; the user always sees and confirms the mapping.
import { FILE_HINTS, ROLES, ROLE_FIELDS, normalizeHeader, type Role } from "./formats";
import { msg } from "../i18n/core";

export type ErpProfile = "generic" | "netsuite" | "p21" | "infor" | "bc" | "quickbooks";
/** column: value from a column; unit: unit price/cost x quantity; zero: not in file, use 0;
 *  none: not in file, leave unknown; generate: line ID from invoice number (+ line number). */
export type FieldSource =
  | { kind: "column"; index: number } | { kind: "unit"; index: number } | { kind: "zero" } | { kind: "none" }
  | { kind: "generate"; lineNo: number | null }
  /** 6A: a discount given as a percent (0-100) or a share (0-1) of the line's list amount. */
  | { kind: "percent"; index: number } | { kind: "fraction"; index: number }
  /** 6A: from the order header file in the same batch, matched by invoice number (customer, date; freight is spread over the lines). */
  | { kind: "header" }
  /** 6A: not in the sales file: quantity x the current cost on the item list (in this batch or already in the vault). */
  | { kind: "item_cost" };
/** Sources that read one column of the file. */
export const COLUMN_KINDS = ["column", "unit", "percent", "fraction"] as const;
export const columnOf = (s: FieldSource) => s.kind === "column" || s.kind === "unit" || s.kind === "percent" || s.kind === "fraction" ? s.index : null;
export type Mapping = Record<string, FieldSource>;
export type MappedField = { field: string; source: FieldSource; confidence: number; reason: string };

/** Alternatives each field may use when no column holds it. */
export const ALTERNATIVES: Partial<Record<Role, Record<string, FieldSource["kind"][]>>> = {
  sales_history: { line_id: ["generate"], customer_id: ["header"], sale_date: ["header"], list_amount: ["unit"], discount_amount: ["zero", "percent", "fraction"], freight_amount: ["zero", "header"], rebate_amount: ["zero"], cost_amount: ["unit", "none", "item_cost"] },
};
/** Sources that are not read from the file's own columns. */
export const DERIVED_KINDS: FieldSource["kind"][] = ["unit", "zero", "generate", "percent", "fraction", "header", "item_cost"];
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
  tier: { column: n("tier", "price tier", "customer tier", "price level", "price class", "pricing tier", "customer price group", "price group", "customer discount group", "discount group") },
  line_type: { column: n("line type", "item type", "type of line") },
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
// "Order ID" (Northwind, many web shops) is the invoice key of order-based exports.
SYNONYMS.invoice_id.column.push(...n("order id", "order number", "sales order", "sales order no"));
/**
 * 6A: German, French, Spanish and Dutch header names (SAP Business One, DATEV, Sage and
 * Exact exports). normalizeHeader drops accented letters the same way for the file's
 * headers, so "Stückpreis" is listed as written. Line totals that may be net of discount
 * ("Zeilensumme", "Montant HT") are deliberately not mapped to the list amount.
 */
const LOCALIZED: Record<string, { column?: string[]; unit?: string[] }> = {
  invoice_id: { column: ["belegnummer", "beleg nr", "rechnungsnummer", "rechnung nr", "rechnungsnr", "auftragsnummer", "numéro de facture", "n° facture", "facture", "número factura", "nº factura", "factura", "factuurnummer", "factuur"] },
  product_id: { column: ["artikelnummer", "artikel nr", "artikelnr", "artikel", "materialnummer", "material nr", "référence article", "réf article", "article", "code article", "código artículo", "artículo", "referencia", "artikelcode"] },
  customer_id: { column: ["kundennummer", "kunden nr", "kundennr", "kunde", "debitor", "debitorennummer", "code client", "client", "numéro client", "código cliente", "cliente", "klantnummer", "klant"] },
  sale_date: { column: ["buchungsdatum", "belegdatum", "rechnungsdatum", "lieferdatum", "datum", "date facture", "date de facture", "date pièce", "fecha", "fecha factura", "factuurdatum"] },
  quantity: { column: ["menge", "anzahl", "liefermenge", "quantité", "qté", "cantidad", "aantal"] },
  list_amount: { column: ["betrag", "montant", "importe", "bedrag"], unit: ["einzelpreis", "verkaufspreis", "stückpreis", "preis", "prix unitaire", "prix", "precio unitario", "precio", "eenheidsprijs", "prijs"] },
  discount_amount: { column: ["rabatt", "rabattbetrag", "remise", "descuento", "korting"] },
  freight_amount: { column: ["fracht", "frachtkosten", "versandkosten", "porto", "frais de port", "port", "flete", "gastos de envío", "vracht", "verzendkosten"] },
  cost_amount: { column: ["einstandsbetrag", "wareneinsatz", "coût total", "coste total", "kostprijs totaal"], unit: ["einstandspreis", "einkaufspreis", "ek preis", "prix de revient", "coût unitaire", "coste unitario", "costo unitario", "kostprijs"] },
  description: { column: ["artikelbeschreibung", "artikelbezeichnung", "bezeichnung", "beschreibung", "désignation", "libellé", "descripción", "omschrijving"] },
  category: { column: ["warengruppe", "artikelgruppe", "kategorie", "famille", "catégorie", "categoría", "familia", "productgroep"] },
  uom: { column: ["einheit", "mengeneinheit", "unité", "unidad", "eenheid"] },
  current_cost: { column: ["einstandspreis", "einkaufspreis", "prix de revient", "coste", "kostprijs"] },
  list_price: { column: ["listenpreis", "verkaufspreis", "prix de vente", "prix catalogue", "precio de venta", "precio lista", "verkoopprijs"] },
  name: { column: ["kundenname", "nom", "nom client", "raison sociale", "nombre", "nombre cliente", "klantnaam", "naam"] },
  tier: { column: ["preisgruppe", "kundenpreisgruppe", "preisliste", "groupe de prix", "catégorie tarifaire", "grupo de precios", "tarifa", "prijsgroep"] },
  branch: { column: ["filiale", "niederlassung", "lager", "agence", "sucursal", "filiaal"] },
  region: { column: ["land", "pays", "país"] },
  payment_terms: { column: ["zahlungsbedingungen", "zahlungsbedingung", "conditions de paiement", "condiciones de pago", "betalingsvoorwaarden"] },
  vendor: { column: ["lieferant", "kreditor", "fournisseur", "proveedor", "leverancier"] },
};
// Each name also counts without its accents ("Quantité" and "Quantite" exports both occur).
const unaccented = (names: string[]) => names.flatMap(x => [x, x.normalize("NFD").replace(/\p{M}/gu, "")]);
for (const [field, names] of Object.entries(LOCALIZED)) {
  const s = SYNONYMS[field];
  s.column.push(...n(...unaccented(names.column ?? [])));
  if (names.unit) (s.unit ??= []).push(...n(...unaccented(names.unit)));
}
const LINE_NO = n("line no", "line number", "line", "line num", "lineno", "seq", "sequence", "position", "pos", "zeile", "zeilennr", "ligne", "linea", "línea", "regel");
/** A master list's own key column often has a bare name ("No." in Business Central). */
const LIST_KEY = n("no", "nr", "number", "id", "code", "key", "nummer", "numero", "numéro", "número", "codigo", "código");
const LIST_KEY_FIELD: Partial<Record<Role, string>> = { customer_list: "customer_id", item_master: "product_id" };
/** When no customer ID column exists, the customer's name is the key (NetSuite and QuickBooks use "Name"). */
const CUSTOMER_NAME = n("name", "customer name", "company", "company name", "account name", "customer full name", "kundenname", "nom client", "nombre cliente", "klantnaam");
/** A discount column holding a percent rather than an amount ("Line Discount %", "Rabatt %"). */
export const isPercentHeader = (header: string) => /%|\bpct\b|percent|prozent|pourcentage|porcentaje|procent/i.test(header);
type ProfileField = { column?: string[]; unit?: string[] };
/** ERP-specific header names (normalized). Source: public documentation; unverified. markers: extra names that identify the ERP's export. */
export const PROFILES: Record<ErpProfile, { label: string; note: string; fields: Record<string, ProfileField>; lineNo: string[]; markers?: string[] }> = {
  generic: { label: msg("mapper.genericExport"), note: msg("mapper.commonDistributorHeaderNames"), fields: {}, lineNo: [] },
  netsuite: { label: "Oracle NetSuite (saved search)", note: msg("mapper.unverifiedFromNetsuiteSaved"), lineNo: n("line", "line id"), markers: n("internal id", "est gross profit"),
    fields: { invoice_id: { column: n("document number") }, sale_date: { column: n("date") }, customer_id: { column: n("customer", "name") }, product_id: { column: n("item") }, quantity: { column: n("quantity") }, list_amount: { column: n("amount"), unit: n("item rate", "rate") }, cost_amount: { column: n("est extended cost"), unit: n("est unit cost") } } },
  p21: { label: "Epicor Prophet 21", note: msg("mapper.unverifiedFromP21Invoice"), lineNo: n("line no", "line number"),
    fields: { invoice_id: { column: n("invoice no") }, line_id: { column: n("invoice line uid") }, product_id: { column: n("item id") }, customer_id: { column: n("customer id") }, quantity: { column: n("qty shipped") }, list_amount: { column: n("extended price"), unit: n("unit price") }, cost_amount: { column: n("extended cost"), unit: n("cost", "unit cost") }, sale_date: { column: n("invoice date") } } },
  infor: { label: "Infor CloudSuite Distribution (SX.e/CSD)", note: msg("mapper.unverifiedFromSxE"), lineNo: n("lineno", "line no"),
    fields: { invoice_id: { column: n("orderno", "invoice no", "invno") }, product_id: { column: n("shipprod", "prod") }, customer_id: { column: n("custno") }, quantity: { column: n("qtyship") }, list_amount: { column: n("netamt"), unit: n("price") }, cost_amount: { unit: n("prodcost") }, sale_date: { column: n("invoicedt") } } },
  bc: { label: "Microsoft Dynamics 365 Business Central", note: msg("mapper.unverifiedFromBusinessCentral"), lineNo: n("line no"),
    fields: { invoice_id: { column: n("document no") }, product_id: { column: n("no", "item no") }, customer_id: { column: n("sell to customer no", "bill to customer no") }, quantity: { column: n("quantity") }, list_amount: { unit: n("unit price", "unit price excl vat") }, discount_amount: { column: n("line discount amount") }, cost_amount: { unit: n("unit cost lcy", "unit cost") }, sale_date: { column: n("posting date") }, line_type: { column: n("type") } } },
  quickbooks: { label: "QuickBooks Enterprise (Sales by Item Detail)", note: msg("mapper.unverifiedFromTheSales"), lineNo: [], markers: n("balance", "memo"),
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
    const score = names.filter(x => keys.has(x)).length + (p.lineNo.some(x => keys.has(x)) ? 0.5 : 0) + (p.markers ?? []).filter(x => keys.has(x)).length;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
type Candidate = { field: string; index: number; kind: "column" | "unit" | "percent"; score: number; reason: string };
function candidates(role: Role, headers: string[], profile: ErpProfile) {
  const keys = headers.map(normalizeHeader), out: Candidate[] = [], fields = ROLE_FIELDS[role].map(f => f.name);
  const alt = ALTERNATIVES[role] ?? {};
  for (const field of fields) {
    const p = PROFILES[profile].fields[field], g = SYNONYMS[field];
    keys.forEach((key, index) => {
      if (!key) return;
      // "Discount %" normalizes like "Discount": read it as a percent of list, never as an amount.
      if (field === "discount_amount" && isPercentHeader(headers[index])) {
        if (alt[field]?.includes("percent") && (g?.column.some(s => key.includes(s)) || key.includes("discount") || key.includes("rabatt"))) out.push({ field, index, kind: "percent", score: 0.85, reason: msg("mapper.discountOfListCheck") });
        return;
      }
      if (LIST_KEY_FIELD[role] === field && LIST_KEY.includes(key)) { out.push({ field, index, kind: "column", score: 0.75, reason: msg("mapper.theListSKey") }); return; }
      if (key === normalizeHeader(field)) { out.push({ field, index, kind: "column", score: 1, reason: msg("mapper.exactColumnName") }); return; }
      if (p?.column?.includes(key)) out.push({ field, index, kind: "column", score: 0.95, reason: msg("mapper.columnName", { label: PROFILES[profile].label }) });
      if (p?.unit?.includes(key) && alt[field]?.includes("unit")) out.push({ field, index, kind: "unit", score: 0.9, reason: msg("mapper.unitValueXQuantity2", { label: PROFILES[profile].label }) });
      if (g?.column.includes(key)) out.push({ field, index, kind: "column", score: 0.9, reason: msg("mapper.commonHeaderName") });
      if (g?.unit?.includes(key) && alt[field]?.includes("unit")) out.push({ field, index, kind: "unit", score: 0.85, reason: msg("mapper.unitValueXQuantity") });
      // Fuzzy: the header contains a known name of 5+ letters (e.g. "Net Sales Amount").
      else if (g && !g.column.includes(key) && g.column.some(s => s.length >= 5 && key.includes(s))) out.push({ field, index, kind: "column", score: 0.6, reason: msg("mapper.partialHeaderMatchCheck") });
    });
  }
  return out;
}
/** Suggest a mapping: best candidates assigned greedily, one column per field. */
export function suggestMapping(role: Role, headers: string[], profile: ErpProfile = detectProfile(headers)): MappedField[] {
  const fields = ROLE_FIELDS[role], alt = ALTERNATIVES[role] ?? {};
  // Ties keep column order (a stable sort): "Order Date" before "Shipped Date", the first of equally good names.
  const all = candidates(role, headers, profile).sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "column" ? -1 : 1));
  const used = new Set<number>(), result = new Map<string, MappedField>();
  for (const c of all) {
    if (result.has(c.field) || used.has(c.index)) continue;
    result.set(c.field, { field: c.field, source: { kind: c.kind, index: c.index }, confidence: c.score, reason: c.reason }); used.add(c.index);
  }
  const keys = headers.map(normalizeHeader);
  // No customer ID column: the customer name is the key (it may also be the list's name column).
  if ((role === "sales_history" || role === "customer_list") && !result.has("customer_id")) {
    const at = keys.findIndex(k => CUSTOMER_NAME.includes(k));
    if (at >= 0) result.set("customer_id", { field: "customer_id", source: { kind: "column", index: at }, confidence: 0.7, reason: msg("mapper.theCustomerNameIs") });
  }
  const lineNo = keys.findIndex((k, i) => !used.has(i) && ([...LINE_NO, ...PROFILES[profile].lineNo]).includes(k));
  for (const f of fields) {
    if (result.has(f.name)) continue;
    const options = alt[f.name] ?? [];
    if (options.includes("generate") && result.has("invoice_id")) result.set(f.name, { field: f.name, source: { kind: "generate", lineNo: lineNo >= 0 ? lineNo : null }, confidence: 0.8, reason: lineNo >= 0 ? msg("mapper.generatedFromInvoiceNumber2") : msg("mapper.generatedFromInvoiceNumber") });
    else if (options.includes("zero")) result.set(f.name, { field: f.name, source: { kind: "zero" }, confidence: 0.8, reason: msg("mapper.notInFile0") });
    else if (options.includes("none") || !f.required) result.set(f.name, { field: f.name, source: { kind: "none" }, confidence: f.required ? 0 : 1, reason: f.required ? msg("mapper.notFound2") : msg("mapper.notInFile") });
    else result.set(f.name, { field: f.name, source: { kind: "none" }, confidence: 0, reason: msg("mapper.notFound") });
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
  if (role === "sales_history" && (mapping.line_id?.kind === "generate") && mapping.invoice_id?.kind !== "column") problems.push(msg("mapper.invoiceIdNeededTo2"));
  if ((mapping.list_amount?.kind === "unit" || mapping.cost_amount?.kind === "unit" || mapping.cost_amount?.kind === "item_cost") && mapping.quantity?.kind !== "column") problems.push(msg("mapper.quantityNeededForUnit"));
  if (role === "sales_history" && Object.values(mapping).some(s => s.kind === "header") && mapping.invoice_id?.kind !== "column") problems.push(msg("mapper.invoiceIdNeededTo"));
  const share = mapping.discount_amount?.kind;
  if ((share === "percent" || share === "fraction") && mapping.list_amount?.kind !== "column" && mapping.list_amount?.kind !== "unit") problems.push(msg("mapper.listAmountNeededFor"));
  if (role === "price_list" && mapping.product_id?.kind !== "column" && mapping.category?.kind !== "column") problems.push("product_id or category");
  return problems;
}
/** A mapping needs an explicit check when anything was inferred rather than matched exactly. */
export function needsConfirmation(fields: MappedField[]) {
  return fields.some(f => (f.source.kind === "column" && f.confidence < 1) || DERIVED_KINDS.includes(f.source.kind) || (f.source.kind === "none" && f.confidence === 0));
}
/** Lines files (with a quantity column) are never order headers, although they also hold invoice, customer and date. */
function looksLikeLines(headers: string[]) {
  return suggestMapping("sales_history", headers).find(x => x.field === "quantity")?.source.kind === "column";
}
/** Role score: required-field coverage (alternatives count half) and how much of the file the role explains. */
export function roleScore(role: Role, headers: string[]) {
  if (role === "order_header" && looksLikeLines(headers)) return 0;
  const fields = suggestMapping(role, headers), required = ROLE_FIELDS[role].filter(f => f.required);
  const cover = required.reduce((s, f) => { const m = fields.find(x => x.field === f.name)!; return s + (m.source.kind === "column" ? m.confidence : m.source.kind === "unit" ? 0.75 : m.source.kind === "generate" ? 0.5 : 0); }, 0) / Math.max(1, required.length);
  const explained = new Set(fields.flatMap(f => { const i = columnOf(f.source); return i === null ? [] : [i]; })).size / Math.max(1, headers.filter(h => normalizeHeader(h)).length);
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
