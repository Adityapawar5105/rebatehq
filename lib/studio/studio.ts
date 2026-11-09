import { batchFx, workspaceCurrency } from '../vault/currency';
import {rebuildAccruals} from '../rebate/store';
import {hasSupplier} from '../rebate/input';
import {hasRebates} from '../rebate/input';
import { fitsLicenceCapacity } from "../licence-policy";
// Import Studio orchestration inside the vault worker. Files stay in worker memory
// (File handles; bounded grids for spreadsheets/JSON/XML) and nothing is uploaded.
import JSZip from "jszip";
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { appendAudit } from "../vault/audit";
import { CAPS, type Tier } from "../vault/protocol";
import {
  DATE_FORMATS, DELIMITERS, LOADABLE, USABLE, ROLES, ROLE_FIELDS, ROLE_LABELS, SPREADSHEET, StudioError, TEXT, canonicalValue, columnLetter, detectDateFormat, detectDecimal,
  NO_HEADER, detectHeader, fingerprint, headerNames, isoDate, kindOf, normalizeHeader, type FieldType, type Kind, type Role, type Settings, type StudioIssue,
} from "./formats";
import { ALTERNATIVES, PROFILES, PROFILE_IDS, columnOf, detectProfile, detectRole, lineIdFor, mappingProblems, needsConfirmation, suggestMapping, type ErpProfile, type FieldSource, type MappedField } from "./mapper";
import { NOTE_TEXT, cleanDate, cleanId, cleanNumber, lineTotal, shareOf, toCents, type CleanNote } from "./clean";
import { bomLength, detectDelimiter, detectEncoding, sampleRows } from "./text";
import { MAX_DOC_BYTES, MAX_SHEET_BYTES, MAX_SHEET_ROWS, checkZip, jsonGrid, sheetGrid, sheetNames, xmlGrid, type Grid } from "./sheets";
import { sampleSheet, sheetSize, streamSheet } from "./xlsxstream";
import { CsvWriter, Normalizer, emptyStats, headingColumns, headingLevel, streamGrid, streamText, type Stats } from "./rows";
/** Line types that are product lines; with a line type column mapped, other lines (G/L accounts, charges, comments) are skipped. */
const ITEM_LINE = new Set(["item", "items", "inventory", "inventorypart", "noninventorypart", "noninventory", "product", "stock", "nonstock", "goods", "merchandise", "part", "assembly", "kit", "artikel"]);
export const isItemLine = (value: string) => ITEM_LINE.has(normalizeHeader(value));
import { CODES, capUsage, commitSql, counts, createStage, dropOutsideRange, fillItemCost, finishRemovalSql, issueColumn, issueMessage, joinHeaders, markUnjoined, removeChildrenSql, resetStage, salesRanges, sampleIssues, spreadFreight, stageFile, validate, type StagedFile } from "./load";
import { msg, tierRef } from "../i18n/core";

export const MAX_TEXT_BYTES = 256 * 1024 * 1024, MAX_FILES = 64, SAMPLE_BYTES = 256 * 1024;
export type Recipe = { id: string; name: string; profile: string; settings: Settings & { kind: Kind; role: Role | null; erp?: ErpProfile; mapping?: Record<string, FieldSource> } };
/** One canonical field's mapping as shown to the user. `options` lists allowed non-column sources. */
export type FieldMapView = { field: string; required: boolean; source: FieldSource; header: string | null; column: string | null; confidence: number; reason: string; options: FieldSource["kind"][] };
export type FileView = {
  id: string; name: string; bytes: string; kind: Kind; sheets: string[]; settings: Settings; role: Role | null; roleConfidence: number;
  roleScores: Record<Role, number>; headers: string[]; mapped: { field: string; header: string; column: string }[]; missing: string[]; ignored: string[];
  fields: FieldMapView[]; erp: ErpProfile; erpOptions: { id: ErpProfile; label: string; note: string }[]; needsConfirmation: boolean; confirmed: boolean;
  preview: { row: number; cells: string[] }[]; headerRowNumber: number; headerRowOptions: { index: number; row: number }[]; notices: string[];
  issues: StudioIssue[]; loadable: boolean; reason: string | null; estimatedRows: string; recipe: { id: string; name: string } | null;
  appliedRecipe: string | null; replaces: string | null; fixedLayout: boolean; textFormat: boolean; columnLabels: string[];
  range: { from: string | null; to: string | null };
};
export type FileReport = { id: string; name: string; role: Role; rowsRead: string; rowsLoaded: string; rowsRejected: string; rowsSkipped: string; issueCount: string; issues: StudioIssue[]; dateRange: { from: string; to: string } | null; fx: {sourceCurrency:string;workspaceCurrency:string;fxRate:string}; cleaned: { field: string; note: string; count: string }[] };
export type BatchReport = { rebateTerms?:boolean; files: FileReport[]; warnings: string[]; loaded: string; rejected: string; capOk: boolean; capMessage: string | null; replaces: string | null };
export type StudioState = { files: FileView[]; report: BatchReport | null; recipes: { id: string; name: string; role: Role | null }[] };
export type SourceView = { id: string; name: string; role: string; importedAt: string; rowsLoaded: string; rowsRejected: string; issues: string; sourceCurrency: string; workspaceCurrency: string; fxRate: string; headerFx: string };
export type Progress = (stage: string, done: string, total: string) => void;
type Entry = {
  id: string; file: File; kind: Kind; settings: Settings; role: Role | null; roleManual: boolean; sheets: string[]; zipNotices: string[];
  bytes: Uint8Array | null; grid: Grid | null; sample: string[][]; sampleBytes: number; sampleRecords: number; notices: string[]; replaces: string | null; appliedRecipe: string | null;
  erp: ErpProfile; overrides: Record<string, FieldSource>; confirmed: boolean;
  /** Leading unnamed columns that carry report section headings in the sample (6A). */
  headings: number[];
  /** Sales files only: import just these dates (ISO, inclusive); null = no limit (blueprint engine rule 9). */
  range: DateRange;
};
export type DateRange = { from: string | null; to: string | null };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
type Notes = Map<string, Map<CleanNote, number>>;
function note(notes: Notes, field: string, list: CleanNote[]) {
  if (!list.length) return;
  let m = notes.get(field); if (!m) notes.set(field, m = new Map());
  for (const n of list) m.set(n, (m.get(n) ?? 0) + 1);
}
function clean(type: FieldType, value: string, settings: Settings, notes: Notes, field: string) {
  const r = type === "date" ? cleanDate(value, settings.dateFormat) : type === "amount" || type === "rate" || type.startsWith("quantity") ? cleanNumber(value, settings.decimal) : type === "id" || type === "line_id" ? cleanId(value) : { value, notes: [] };
  note(notes, field, r.notes); return r.value;
}
/**
 * Build one canonical row (ROLE_FIELDS order) from source cells using the mapping:
 * cleaned values, unit x quantity totals, zero/unknown defaults and generated line IDs.
 */
/** Non-item rows when a line type column is mapped: a non-item type, or a blank type on a row with no product (a comment). */
export function nonItemLine(role: Role, mapping: Record<string, FieldSource>, cells: string[]) {
  const t = mapping.line_type, p = mapping.product_id;
  if (role !== "sales_history" || t?.kind !== "column") return false;
  const type = (cells[t.index] ?? "").trim(), product = p ? (cells[columnOf(p) ?? -1] ?? "").trim() : "";
  return type ? !isItemLine(type) : !product;
}
const STEP: Partial<Record<FieldSource["kind"], number>> = { unit: 1, generate: 1, percent: 2, fraction: 2 };
/** @internal exported for unit tests. */
export function canonicalRow(role: Role, mapping: Record<string, FieldSource>, settings: Settings, cells: string[], row: number, invoiceLines: Map<string, number>, notes: Notes) {
  const fields = ROLE_FIELDS[role], values = new Map<string, string>();
  const cell = (s: FieldSource) => { const i = columnOf(s); return i === null ? "" : cells[i] ?? ""; };
  // Columns first, then unit x quantity and generated IDs, then shares of the list amount.
  const order = [...fields].sort((a, b) => (STEP[mapping[a.name]?.kind ?? "none"] ?? 0) - (STEP[mapping[b.name]?.kind ?? "none"] ?? 0));
  for (const f of order) {
    const s = mapping[f.name] ?? { kind: "none" as const };
    if (s.kind === "column") {
      const v = clean(f.type, cell(s), settings, notes, f.name);
      // Money stored with 4 decimals (SQL Server "money", ERP extended amounts) rounds to the cent; unit prices keep theirs.
      const cents = f.type === "amount" && (!settings.fxRate || settings.fxRate === "1") ? toCents(v) : null;
      if (cents !== null && cents !== v) note(notes, f.name, ["rounded"]);
      values.set(f.name, cents ?? v);
    }
    else if (s.kind === "zero") values.set(f.name, "0");
    else if (s.kind === "none" || s.kind === "header" || s.kind === "item_cost") values.set(f.name, ""); // header and item cost are filled in SQL
    else if (s.kind === "unit") {
      const unit = clean("amount", cell(s), settings, notes, f.name), total = lineTotal(unit, values.get("quantity") ?? "");
      values.set(f.name, total ?? unit);
    } else if (s.kind === "percent" || s.kind === "fraction") {
      const rate = clean("quantity0", cell(s), settings, notes, f.name);
      values.set(f.name, rate === "" ? "" : shareOf(values.get("list_amount") ?? "", rate, s.kind === "percent" ? 100 : 1) ?? rate);
    } else {
      const invoice = values.get("invoice_id") ?? "";
      let key: string;
      if (!invoice) key = `row\u0001${row}`;
      else if (s.lineNo !== null) key = `${invoice}\u0001${cleanId(cells[s.lineNo] ?? "").value}`;
      else { const k = (invoiceLines.get(invoice) ?? 0) + 1; invoiceLines.set(invoice, k); key = `${invoice}\u0001#${k}`; }
      values.set(f.name, lineIdFor(key));
    }
  }
  return fields.map(f => values.get(f.name) ?? "");
}
const id = () => crypto.randomUUID();
/** Size plus SHA-256 of the first and last 64 KiB: catches renamed or re-saved copies without hashing huge files. */
export async function fileFingerprint(file: Blob) {
  const edge = 65536, head = await file.slice(0, edge).arrayBuffer(), tail = file.size > edge ? await file.slice(Math.max(edge, file.size - edge)).arrayBuffer() : new ArrayBuffer(0);
  const both = new Uint8Array(head.byteLength + tail.byteLength); both.set(new Uint8Array(head)); both.set(new Uint8Array(tail), head.byteLength);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", both));
  return `${file.size}:${[...hash].map(b => b.toString(16).padStart(2, "0")).join("")}`;
}
const clip = (v: string) => v.length > 120 ? v.slice(0, 117) + "..." : v;
export function safeName(name: string) { return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120) || "converted"; }

export class Studio {
  private entries = new Map<string, Entry>();
  private order: string[] = [];
  private report: BatchReport | null = null;
  private staged: { files: StagedFile[]; stats: Map<number, Stats>; entries: Entry[]; replaces: string | null; roles: Set<Role> } | null = null;

  clear() { this.entries.clear(); this.order = []; this.report = null; this.staged = null; }
  private invalidate() { this.report = null; this.staged = null; }
  private get(fileId: string) { const e = this.entries.get(fileId); if (!e) throw new StudioError(msg("import.thatFileIsNo2")); return e; }

  async add(files: File[], recipes: Recipe[], replaces: string | null = null, currency = "USD") {
    if (!files.length) throw new StudioError(msg("import.chooseAtLeastOne"));
    if (replaces && (files.length !== 1 || this.order.length)) throw new StudioError(msg("import.replaceOneImportedFile"));
    if (this.order.length && [...this.entries.values()].some(e => e.replaces)) throw new StudioError(msg("import.finishOrClearThe"));
    if (this.order.length + files.length > MAX_FILES) throw new StudioError(msg("import.addAtMostFiles", { maxfiles: MAX_FILES }));
    const added: Entry[] = [];
    for (const file of files) { const entry = await this.inspect(file, recipes, replaces); entry.settings.sourceCurrency = currency; entry.settings.fxRate = "1"; added.push(entry); };
    for (const e of added) { this.entries.set(e.id, e); this.order.push(e.id); }
    this.invalidate();
  }
  private async inspect(file: File, recipes: Recipe[], replaces: string | null): Promise<Entry> {
    const kind = kindOf(file.name);
    if (!kind) throw new StudioError(msg("import.useCsvTsvTxt", { name: file.name }));
    if (file.name.length > 200 || file.size < 1) throw new StudioError(msg("import.chooseANonEmpty", { name: file.name }));
    const limit = TEXT.includes(kind) ? MAX_TEXT_BYTES : SPREADSHEET.includes(kind) ? MAX_SHEET_BYTES : MAX_DOC_BYTES;
    if (file.size > limit) throw new StudioError(msg(TEXT.includes(kind) ? "import.tooLargeText" : "import.tooLargeSheet", { name: file.name, value: Math.round(limit / 1048576) }));
    const entry: Entry = { id: id(), file, kind, role: null, roleManual: false, sheets: [], zipNotices: [], bytes: null, grid: null, sample: [], sampleBytes: 0, sampleRecords: 1, notices: [], replaces, appliedRecipe: null, erp: "generic", overrides: {}, confirmed: false, headings: [], range: { from: null, to: null },
      settings: { sheet: null, headerRow: 0, headerDepth: 1, delimiter: kind === "tsv" ? "\t" : ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" } };
    try {
      if (TEXT.includes(kind)) {
        const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        entry.settings.encoding = detectEncoding(head).encoding;
        const text = await this.sampleText(entry);
        entry.settings.delimiter = detectDelimiter(text, kind === "tsv" ? "\t" : undefined);
        entry.sample = sampleRows(text, entry.settings.delimiter, 60);
      } else if (SPREADSHEET.includes(kind)) {
        entry.bytes = new Uint8Array(await file.arrayBuffer());
        if (kind !== "xls") entry.zipNotices = await checkZip(entry.bytes, kind);
        entry.sheets = sheetNames(entry.bytes); entry.settings.sheet = entry.sheets[0];
        entry.grid = await this.loadSheet(entry, entry.sheets[0]);
      } else {
        const text = await file.text();
        entry.grid = kind === "json" ? jsonGrid(text) : xmlGrid(text);
      }
    } catch (error) {
      if (error instanceof StudioError) throw new StudioError(`${file.name}: ${error.message}`);
      throw new StudioError(msg("import.theFileCouldNot", { name: file.name, kind: kind.toUpperCase() }));
    }
    this.detect(entry);
    const match = this.matchRecipe(entry, recipes);
    if (match) this.applySettings(entry, match);
    return entry;
  }
  private async sampleText(entry: Entry) {
    const head = new Uint8Array(await entry.file.slice(0, SAMPLE_BYTES).arrayBuffer());
    const text = new TextDecoder(entry.settings.encoding).decode(head.subarray(bomLength(head, entry.settings.encoding)), { stream: true });
    entry.sampleBytes = head.length; entry.sampleRecords = Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
    return text;
  }
  private rows(entry: Entry) { return entry.grid ? entry.grid.rows : entry.sample; }
  private rowNumber(entry: Entry, index: number) { return entry.grid ? entry.grid.rowNumbers[index] ?? index + 1 : index + 1; }
  private detect(entry: Entry) {
    const rows = this.rows(entry);
    if (entry.grid?.keyed) { entry.settings.headerRow = 0; entry.settings.headerDepth = 1; }
    else { const h = detectHeader(rows, !!entry.grid?.merged); entry.settings.headerRow = h.headerRow; entry.settings.headerDepth = h.headerDepth; }
    const data = rows.slice(entry.settings.headerRow + 1, entry.settings.headerRow + 200);
    entry.settings.decimal = detectDecimal(data, entry.grid ? "," : entry.settings.delimiter);
    const date = detectDateFormat(data);
    entry.settings.dateFormat = date.format;
    entry.notices = date.ambiguous ? [msg("import.datesSuchAs03", { format: date.format })] : [];
    const headers = this.headers(entry);
    this.findHeadings(entry, headers);
    if (!entry.roleManual) entry.role = detectRole(entry.file.name, headers).role;
    entry.erp = detectProfile(headers); entry.overrides = {}; entry.confirmed = false;
  }
  /** Report section headings in leading unnamed columns (QuickBooks-style): copied down at import. */
  private findHeadings(entry: Entry, headers: string[]) {
    const lead = entry.settings.headerRow === NO_HEADER ? 0 : headingColumns(headers), levels = new Set<number>();
    if (lead) for (const cells of this.rows(entry).slice(entry.settings.headerRow + 1, entry.settings.headerRow + 400)) { const l = headingLevel(cells, lead); if (l !== null) levels.add(l); }
    entry.headings = [...levels].sort((a, b) => a - b);
  }
  private structureNotices(entry: Entry, headers: string[]) {
    const out: string[] = [];
    if (entry.settings.headerRow === NO_HEADER) out.push(msg("import.noHeaderRowWas"));
    if (entry.headings.length) out.push(msg("import.rowsThatFillOnly", { value: entry.headings.map(i => headers[i]?.replace("Column ", "") ?? "").join(", ") }));
    return out;
  }
  /** Suggested mapping for the current role/headers/ERP profile, with the user's choices applied. */
  private mapping(entry: Entry): MappedField[] {
    if (!entry.role) return [];
    const headers = this.headers(entry);
    return suggestMapping(entry.role, headers, entry.erp).map(m => this.refine(entry, m)).map(m => {
      const o = entry.overrides[m.field], at = o ? columnOf(o) : null;
      if (!o || (at !== null && at >= headers.length)) return m;
      return { ...m, source: o, confidence: 1, reason: msg("import.chosenByYou") };
    });
  }
  /** Suggestions that need sample values: the item from section headings, and a discount stored as a 0-1 share. */
  private refine(entry: Entry, m: MappedField): MappedField {
    if (entry.role === "sales_history" && m.field === "product_id" && m.source.kind === "none" && entry.headings.length)
      return { field: m.field, source: { kind: "column", index: entry.headings.at(-1)! }, confidence: 0.7, reason: msg("import.takenFromTheReport") };
    // 6A: a lines file without customer, date or freight takes them from an order header file in the batch.
    if (entry.role === "sales_history" && ["customer_id", "sale_date", "freight_amount"].includes(m.field) && (m.source.kind === "none" || m.source.kind === "zero")) {
      const header = this.others(entry).find(e => e.role === "order_header");
      if (header && this.mappingOf(header)[m.field]?.kind === "column")
        return { field: m.field, source: { kind: "header" }, confidence: 0.7, reason: m.field === "freight_amount" ? msg("import.fromTheOrderHeader2") : msg("import.fromTheOrderHeader") };
    }
    // 6A: no cost in the sales file, but an item list in the batch has one: quantity x that cost.
    if (entry.role === "sales_history" && m.field === "cost_amount" && m.source.kind === "none") {
      const items = this.others(entry).find(e => e.role === "item_master");
      if (items && this.mappingOf(items).current_cost?.kind === "column")
        return { field: m.field, source: { kind: "item_cost" }, confidence: 0.7, reason: msg("import.notInThisFile") };
    }
    // Only a loosely named column ("discount"), never "discount_amount" or "Disc Amt": small amounts are real amounts.
    if (m.field === "discount_amount" && m.source.kind === "column" && m.confidence < 1 && !/amount|amt|value|total|\$/i.test(this.headers(entry)[m.source.index] ?? "")) {
      const at = m.source.index, values = this.rows(entry).slice(entry.settings.headerRow + 1, entry.settings.headerRow + 200)
        .map(r => cleanNumber(r[at] ?? "", entry.settings.decimal).value).filter(v => /^-?\d+(\.\d+)?$/.test(v)).map(Number);
      if (values.length >= 3 && values.every(v => v >= 0 && v <= 1) && values.some(v => v > 0 && v < 1))
        return { field: m.field, source: { kind: "fraction", index: at }, confidence: 0.7, reason: msg("import.valuesAreBetween0") };
    }
    return m;
  }
  private others(entry: Entry) { return this.order.flatMap(x => { const e = this.entries.get(x); return e && e !== entry ? [e] : []; }); }
  private mappingOf(entry: Entry) { return Object.fromEntries(this.mapping(entry).map(m => [m.field, m.source])) as Record<string, FieldSource>; }
  private headers(entry: Entry) {
    const rows = this.rows(entry);
    return rows.length ? headerNames(rows, Math.min(entry.settings.headerRow, rows.length - 1), entry.settings.headerDepth) : [];
  }
  private matchRecipe(entry: Entry, recipes: Recipe[]) {
    for (const recipe of recipes) {
      if (recipe.settings.kind !== entry.kind) continue;
      if (entry.grid && !entry.grid.keyed && recipe.settings.sheet !== entry.settings.sheet) continue;
      const rows = entry.grid ? entry.grid.rows : entry.settings.delimiter === recipe.settings.delimiter ? entry.sample : null;
      if (!rows?.length) continue;
      const headers = headerNames(rows, Math.min(recipe.settings.headerRow, rows.length - 1), recipe.settings.headerDepth);
      if (fingerprint(entry.kind, headers) === recipe.profile) return recipe;
    }
    return null;
  }
  private applySettings(entry: Entry, recipe: Recipe) {
    const { kind: _kind, role, erp, mapping, sourceCurrency: _currency, fxRate: _fx, ...settings } = recipe.settings;
    entry.settings = { ...entry.settings, ...settings, sheet: entry.settings.sheet };
    if (role) { entry.role = role; entry.roleManual = true; }
    if (erp && PROFILE_IDS.includes(erp)) entry.erp = erp;
    // A saved recipe was checked when it was saved, so its mapping counts as confirmed.
    entry.overrides = mapping ? { ...mapping } : {}; entry.confirmed = !!mapping;
    entry.appliedRecipe = recipe.name;
  }
  async update(fileId: string, patch: Partial<Settings> & { role?: Role | null; erp?: ErpProfile; field?: { name: string; source: FieldSource }; confirmed?: boolean; range?: DateRange }) {
    const entry = this.get(fileId), before = entry.settings;
    if (patch.range) {
      const { from, to } = patch.range, ok = (d: string | null) => d === null || (ISO_DAY.test(d) && isoDate(d, "YYYY-MM-DD") === d);
      if (!ok(from) || !ok(to) || (from && to && from > to)) throw new StudioError(msg("import.chooseARealStart"));
      entry.range = { from, to }; this.invalidate(); return;
    }
    if (patch.erp && PROFILE_IDS.includes(patch.erp)) { entry.erp = patch.erp; entry.overrides = {}; entry.confirmed = false; }
    if (patch.field) { this.setField(entry, patch.field.name, patch.field.source); entry.confirmed = false; }
    if (patch.confirmed !== undefined) {
      if (patch.confirmed && entry.role && mappingProblems(entry.role, this.mappingOf(entry)).length) throw new StudioError(msg("import.mapEveryRequiredField"));
      entry.confirmed = patch.confirmed;
    }
    if ((patch.erp || patch.field || patch.confirmed !== undefined) && Object.keys(patch).every(k => ["erp","field","confirmed"].includes(k))) { entry.appliedRecipe = null; this.invalidate(); return; }
    const next: Settings = { ...before };
    if (patch.sheet !== undefined && entry.sheets.includes(String(patch.sheet))) next.sheet = String(patch.sheet);
    if (patch.encoding && ["utf-8", "utf-16le", "utf-16be", "windows-1252"].includes(patch.encoding)) next.encoding = patch.encoding;
    if (patch.delimiter && DELIMITERS.includes(patch.delimiter)) next.delimiter = patch.delimiter;
    if (patch.decimal === "dot" || patch.decimal === "comma") next.decimal = patch.decimal;
    if (patch.dateFormat && DATE_FORMATS.includes(patch.dateFormat)) next.dateFormat = patch.dateFormat;
    if (patch.headerDepth === 1 || patch.headerDepth === 2 || patch.headerDepth === 3) next.headerDepth = patch.headerDepth;
    if (patch.headerRow !== undefined && Number.isInteger(patch.headerRow) && patch.headerRow >= NO_HEADER && patch.headerRow < 40) next.headerRow = patch.headerRow;
    if (patch.sourceCurrency !== undefined) next.sourceCurrency = patch.sourceCurrency;
    if (patch.fxRate !== undefined) next.fxRate = patch.fxRate;
    entry.settings = next;
    if (next.sheet !== before.sheet && entry.bytes) { entry.grid = await this.loadSheet(entry, next.sheet!); this.detect(entry); }
    else if (TEXT.includes(entry.kind) && (next.encoding !== before.encoding || next.delimiter !== before.delimiter)) entry.sample = sampleRows(await this.sampleText(entry), next.delimiter, 60);
    if (patch.role !== undefined) { entry.role = patch.role && ROLES.includes(patch.role) ? patch.role : null; entry.roleManual = true; }
    else if (!entry.roleManual) entry.role = detectRole(entry.file.name, this.headers(entry)).role;
    // Column indexes or the role may have changed: drop column choices and re-check.
    const moved = next.sheet !== before.sheet || next.headerRow !== before.headerRow || next.headerDepth !== before.headerDepth || next.delimiter !== before.delimiter || next.encoding !== before.encoding || patch.role !== undefined;
    if (moved) { entry.overrides = {}; entry.confirmed = false; this.findHeadings(entry, this.headers(entry)); if (patch.role === undefined) entry.erp = detectProfile(this.headers(entry)); }
    entry.appliedRecipe = null; this.invalidate();
  }
  private setField(entry: Entry, name: string, source: FieldSource) {
    if (!entry.role) throw new StudioError(msg("import.chooseWhatThisFile3"));
    const field = ROLE_FIELDS[entry.role].find(f => f.name === name), width = this.headers(entry).length;
    if (!field) throw new StudioError(msg("import.unknownFieldForThis"));
    const allowed = ALTERNATIVES[entry.role]?.[name] ?? [];
    const ok = source.kind === "column" ? Number.isInteger(source.index) && source.index >= 0 && source.index < width
      : source.kind === "unit" || source.kind === "percent" || source.kind === "fraction" ? allowed.includes(source.kind) && Number.isInteger(source.index) && source.index >= 0 && source.index < width
      : source.kind === "generate" ? allowed.includes("generate") && (source.lineNo === null || (Number.isInteger(source.lineNo) && source.lineNo >= 0 && source.lineNo < width))
      : source.kind === "zero" || source.kind === "header" || source.kind === "item_cost" ? allowed.includes(source.kind) : source.kind === "none" ? !field.required || allowed.includes("none") : false;
    if (!ok) throw new StudioError(msg("import.thatSourceIsNot", { name }));
    entry.overrides[name] = source;
  }
  drop(fileId: string) { this.get(fileId); this.entries.delete(fileId); this.order = this.order.filter(x => x !== fileId); this.invalidate(); }

  view(entry: Entry, recipes: Recipe[]): FileView {
    const rows = this.rows(entry), headers = this.headers(entry), detected = detectRole(entry.file.name, headers);
    const role = entry.role, mapped = this.mapping(entry), mapping = Object.fromEntries(mapped.map(m => [m.field, m.source])) as Record<string, FieldSource>;
    const idx = (s: FieldSource) => s.kind === "generate" ? s.lineNo : columnOf(s);
    const used = new Set(mapped.flatMap(m => { const i = idx(m.source); return i === null ? [] : [i]; })), missing = role ? mappingProblems(role, mapping) : [];
    const letter = (i: number) => entry.grid?.keyed ? headers[i] : columnLetter((entry.grid?.colOffset ?? 0) + i);
    const start = Math.max(0, entry.settings.headerRow - entry.settings.headerDepth + 1 - 2);
    const confirm = needsConfirmation(mapped);
    const reason = !role ? msg("import.chooseWhatThisFile2") : !USABLE.includes(role) ? msg("import.filesCanBeConverted", { value: ROLE_LABELS[role] })
      : missing.length ? msg("import.mapTheseFieldS", { missing: missing.join(", ") }) : confirm && !entry.confirmed ? msg("import.checkTheColumnMapping2") : null;
    // Text files: records in the 256 KiB sample scaled to the file size (exact for small files).
    const dataRows = entry.grid ? (entry.grid.streamed?.totalRows ?? entry.grid.rows.length) - entry.settings.headerRow - 1 : Math.round(entry.file.size * entry.sampleRecords / Math.max(1, entry.sampleBytes)) - entry.settings.headerRow - 1;
    const recipe = this.matchRecipe(entry, recipes);
    return {
      id: entry.id, name: entry.file.name, bytes: String(entry.file.size), kind: entry.kind, sheets: entry.sheets, settings: entry.settings, role,
      roleConfidence: role ? detected.scores[role] : 0, roleScores: detected.scores, headers,
      mapped: mapped.flatMap(m => m.source.kind === "column" ? [{ field: m.field, header: headers[m.source.index], column: letter(m.source.index) }] : []), missing,
      ignored: headers.filter((_, i) => !used.has(i)), headerRowNumber: this.rowNumber(entry, entry.settings.headerRow),
      fields: role ? mapped.map(m => { const i = idx(m.source); return { field: m.field, required: !!ROLE_FIELDS[role].find(f => f.name === m.field)?.required, source: m.source, header: i === null ? null : headers[i] ?? null, column: i === null ? null : letter(i), confidence: m.confidence, reason: m.reason, options: ALTERNATIVES[role]?.[m.field] ?? [] }; }) : [],
      erp: entry.erp, erpOptions: PROFILE_IDS.map(p => ({ id: p, label: PROFILES[p].label, note: PROFILES[p].note })), needsConfirmation: confirm, confirmed: entry.confirmed,
      headerRowOptions: rows.slice(0, 40).map((_, i) => ({ index: i, row: this.rowNumber(entry, i) })),
      preview: rows.slice(start, start + 22).map((cells, i) => ({ row: this.rowNumber(entry, start + i), cells: cells.slice(0, 30).map(clip) })),
      notices: [...(entry.grid?.notices ?? []), ...entry.notices, ...this.structureNotices(entry, headers), ...(entry.appliedRecipe ? [msg("import.recipeWasApplied", { appliedRecipe: entry.appliedRecipe })] : [])],
      issues: (entry.grid?.issues ?? []).slice(0, 50), loadable: reason === null, reason, estimatedRows: String(Math.max(0, dataRows)),
      recipe: recipe && recipe.name !== entry.appliedRecipe ? { id: recipe.id, name: recipe.name } : null, appliedRecipe: entry.appliedRecipe,
      replaces: entry.replaces, fixedLayout: !!entry.grid?.keyed, textFormat: TEXT.includes(entry.kind),
      range: entry.range,
      columnLabels: Array.from({ length: Math.min(30, Math.max(0, ...rows.slice(start, start + 22).map(r => r.length))) }, (_, i) => letter(i)),
    };
  }
  state(recipes: Recipe[]): StudioState {
    return { files: this.order.map(x => this.view(this.entries.get(x)!, recipes)), report: this.report, recipes: recipes.map(r => ({ id: r.id, name: r.name, role: r.settings.role })) };
  }
  recipeFor(fileId: string, name: string): Omit<Recipe, "id"> {
    const entry = this.get(fileId), label = name.trim();
    if (!label || label.length > 80) throw new StudioError(msg("import.nameTheRecipeAfter"));
    if (entry.role && needsConfirmation(this.mapping(entry)) && !entry.confirmed) throw new StudioError(msg("import.confirmTheColumnMapping"));
    const {sourceCurrency: _currency, fxRate: _fx, ...portable} = entry.settings;
    return { name: label, profile: fingerprint(entry.kind, this.headers(entry)), settings: { ...portable, kind: entry.kind, role: entry.role, erp: entry.erp, mapping: this.mappingOf(entry) } };
  }
  apply(fileId: string, recipe: Recipe) {
    const entry = this.get(fileId);
    if (this.matchRecipe(entry, [recipe])?.id !== recipe.id) throw new StudioError(msg("import.thisRecipeSHeaders"));
    this.applySettings(entry, recipe); this.invalidate();
  }

  /** XLSX/XLSM sheets over the grid limit are previewed from their first rows and streamed at import (6A). */
  private async loadSheet(entry: Entry, sheet: string): Promise<Grid> {
    if (entry.kind === "xlsx" || entry.kind === "xlsm") {
      const size = await sheetSize(entry.bytes!, sheet).catch(() => null);
      if (size && size.lastRow - size.firstRow + 1 > MAX_SHEET_ROWS) { const grid = await sampleSheet(entry.bytes!, sheet); grid.notices.unshift(...entry.zipNotices); return grid; }
    }
    return sheetGrid(entry.bytes!, sheet, entry.zipNotices);
  }
  /** Feed every row to the normalizer. Returns the cell issues found while reading (null: they are in the grid). */
  private async run(entry: Entry, normalizer: Normalizer, signal: AbortSignal, progress?: (bytes: number) => void): Promise<{ issues: StudioIssue[]; count: number } | null> {
    if (entry.grid?.streamed) { const issues: StudioIssue[] = []; const r = await streamSheet(entry.bytes!, entry.settings.sheet!, (cells, row, index) => normalizer.accept(cells, row, index), issues, signal); return { issues, count: r.issueCount }; }
    if (entry.grid) streamGrid(entry.grid, normalizer, signal);
    else await streamText(entry.file, entry.settings, normalizer, signal, progress);
    return null;
  }
  /** Clean, formula-safe UTF-8 CSV of one file for download. */
  async download(fileId: string, signal: AbortSignal) {
    const entry = this.get(fileId), writer = new CsvWriter("download");
    let headed = false, types: (FieldType | null)[] = [];
    const normalizer = new Normalizer(entry.settings, (cells, row) => {
      if (!headed) {
        writer.header(normalizer.headers!); headed = true;
        const fields = entry.role ? ROLE_FIELDS[entry.role] : [], mapping = this.mappingOf(entry);
        types = normalizer.headers!.map((_, i) => fields.find(f => { const s = mapping[f.name]; return s?.kind === "column" && s.index === i; })?.type ?? null);
      }
      writer.row(cells.map((v, i) => types[i] ? canonicalValue(types[i]!, v, entry.settings) : v), row);
    });
    await this.run(entry, normalizer, signal);
    if (!headed && normalizer.headers) writer.header(normalizer.headers);
    const base = entry.file.name.replace(/\.[^.]+$/, ""), sheet = entry.sheets.length > 1 ? ` - ${entry.settings.sheet}` : "";
    return { name: safeName(base + sheet) + ".csv", blob: writer.blob(), rows: String(writer.rows), rejected: String(normalizer.stats.rejected) };
  }
  async zip(signal: AbortSignal) {
    if (!this.order.length) throw new StudioError(msg("import.addFilesToConvert"));
    const zip = new JSZip(), names = new Set<string>();
    for (const x of this.order) {
      const file = await this.download(x, signal);
      let name = file.name; for (let n = 2; names.has(name.toLowerCase()); n++) name = file.name.replace(/\.csv$/, ` (${n}).csv`);
      names.add(name.toLowerCase()); zip.file(name, file.blob);
    }
    return { name: "rebatehq-converted.zip", blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }) };
  }

  async plan(engine: Engine, tier: Tier, signal: AbortSignal, progress: Progress) {
    this.invalidate();
    const currency = await workspaceCurrency(engine);
    const entries = this.order.map(x => this.entries.get(x)!);
    if (!entries.length) throw new StudioError(msg("import.addFilesToImport"));
    const warnings: string[] = [], replaces = entries.find(e => e.replaces)?.replaces ?? null;
    for (const e of entries) {
      const fx = batchFx(e.settings.sourceCurrency ?? currency, currency, e.settings.fxRate ?? '1');
      e.settings = {...e.settings, sourceCurrency: fx.sourceCurrency, fxRate: fx.fxRate};
      if (!e.role) throw new StudioError(msg("import.chooseWhatThisFile", { name: e.file.name }));
      if (!USABLE.includes(e.role)) continue;
      const mapped = this.mapping(e), missing = mappingProblems(e.role, this.mappingOf(e));
      if (missing.length) throw new StudioError(msg("import.mapInPreviewAnd", { name: e.file.name, missing: missing.join(", ") }));
      if (needsConfirmation(mapped) && !e.confirmed) throw new StudioError(msg("import.checkTheColumnMapping", { name: e.file.name }));
    }
    const load = entries.filter(e => USABLE.includes(e.role!));
    for (const e of entries.filter(x => !USABLE.includes(x.role!))) warnings.push(msg("import.filesAreConvertedOnly", { name: e.file.name, value: ROLE_LABELS[e.role!] }));
    if (!load.some(e => LOADABLE.includes(e.role!))) throw new StudioError(load.length ? msg("import.orderHeaderFilesOnly") : msg("import.noFileInThis"));
    const headerFile = load.some(e => e.role === "order_header");
    for (const e of load) if (e.role === "sales_history" && !headerFile && Object.values(this.mappingOf(e)).some(s => s.kind === "header"))
      throw new StudioError(msg("import.someFieldsComeFrom", { name: e.file.name }));
    if (headerFile && !load.some(e => e.role === "sales_history" && Object.values(this.mappingOf(e)).some(s => s.kind === "header")))
      warnings.push(msg("import.theOrderHeaderFile"));
    if (replaces) {
      const role = (await engine.conn.query(`SELECT coalesce(k.kind, s.role) AS role FROM source_files s LEFT JOIN source_kinds k ON k.source_id=s.id WHERE s.id=${sqlText(replaces)}`)).toArray()[0]?.role;
      if (!role) throw new StudioError(msg("import.theFileBeingReplaced"));
      if (role !== load[0].role) throw new StudioError(msg("import.theReplacementMustAlso", { value: ROLE_LABELS[role as Role] ?? role }));
    }
    const roles = new Set(load.map(e => e.role!)), files: StagedFile[] = [], stats = new Map<number, Stats>(), cleanups = new Map<number, FileReport["cleaned"]>();
    // Staging more data rows than the plan's line cap cannot load and can exhaust the 512 MB
    // engine budget, so the batch stops with the cap message instead (6A).
    const rowCap = CAPS[tier].lines; let batchRows = 0;
    const tooBig = () => new StudioError(msg("import.thisBatchHasMore", { rowCap: rowCap, tier: tierRef(tier) }));
    const dateAt = ROLE_FIELDS.sales_history.findIndex(f => f.name === "sale_date");
    try {
      await resetStage(engine);
      for (const role of roles) await createStage(engine, role);
      for (let ord = 0; ord < load.length; ord++) {
        const e = load[ord], writer = new CsvWriter("internal"), role = e.role!, mapping = this.mappingOf(e), canonical = ROLE_FIELDS[role].map(f => f.name);
        progress(msg("import.convertingOf2", { name: e.file.name, value: ord + 1, length: load.length }), "0", String(e.file.size));
        const letter = (i: number) => e.grid?.keyed ? (this.headers(e)[i] ?? "") : columnLetter((e.grid?.colOffset ?? 0) + i);
        const invoiceLines = new Map<string, number>(), notes: Notes = new Map();
        writer.header(canonical);
        let nonItem = 0, outside = 0;
        const used = new Set(Object.values(mapping).flatMap(s => { const i = s.kind === "generate" ? s.lineNo : columnOf(s); return i === null ? [] : [i]; }));
        const range = role === "sales_history" && (e.range.from || e.range.to) ? e.range : null;
        const normalizer: Normalizer = new Normalizer(e.settings, (cells, row) => {
          // A mapped line type skips G/L account, charge and comment lines: they are not product sales.
          if (nonItemLine(role, mapping, cells)) { nonItem++; normalizer.stats.read--; normalizer.stats.skipped++; return; }
          const out = canonicalRow(role, mapping, e.settings, cells, row, invoiceLines, notes);
          // Rows outside the chosen dates are skipped; an unreadable date still goes to validation (and Fix Later).
          const day = range ? out[dateAt] : "";
          if (range && ISO_DAY.test(day) && ((range.from && day < range.from) || (range.to && day > range.to))) { outside++; normalizer.stats.read--; normalizer.stats.skipped++; return; }
          if ((role === "sales_history" || role === "purchases") && ++batchRows > rowCap) throw tooBig();
          writer.row(out, row);
        }, emptyStats(), letter, cut => cut.every(i => !used.has(i)));
        const read = await this.run(e, normalizer, signal, bytes => progress(msg("import.convertingOf", { name: e.file.name, value: ord + 1, length: load.length }), String(bytes), String(e.file.size)));
        const headers = normalizer.headers ?? [];
        for (const issue of read?.issues ?? e.grid?.issues ?? []) normalizer.stats.issues.push(issue);
        normalizer.stats.issueCount += read?.count ?? e.grid?.issues.length ?? 0;
        const alignment = Object.entries(mapping).flatMap(([field, s]) => { const index = columnOf(s); return index === null ? [] : [{ field, index }]; });
        const staged: StagedFile = { ord, role, name: e.file.name, bytes: e.file.size, fingerprint: await fileFingerprint(e.file), alignment, settings: e.settings, keyed: !!e.grid?.keyed, headers, colOffset: e.grid?.colOffset ?? 0, generatedIds: mapping.line_id?.kind === "generate" && mapping.line_id.lineNo === null,
          fromHeader: Object.entries(mapping).flatMap(([field, s]) => s.kind === "header" ? [field] : []), itemCost: mapping.cost_amount?.kind === "item_cost" };
        signal.throwIfAborted();
        await stageFile(engine, staged, writer.blob());
        const structure = [...(normalizer.headings ? [{ field: "rows", note: msg("import.sectionHeadingsCopiedInto"), count: String(normalizer.headings) }] : []),
          ...(nonItem ? [{ field: "line_type", note: msg("import.skippedLinesThatAre"), count: String(nonItem) }] : []),
          ...(outside ? [{ field: "sale_date", note: msg("import.skippedRowsOutsideThe2", { value: range!.from ?? msg("import.rangeStart"), value2: range!.to ?? msg("import.rangeEnd") }), count: String(outside) }] : []),
          ...(normalizer.longCellsIgnored ? [{ field: "rows", note: msg("import.loadedRowsWithA"), count: String(normalizer.longCellsIgnored) }] : [])];
        files.push(staged); stats.set(ord, normalizer.stats); cleanups.set(ord, [...structure, ...[...notes].flatMap(([field, m]) => [...m].map(([n, count]) => ({ field, note: NOTE_TEXT[n], count: String(count) })))]);
      }
      if(roles.has("rebate_agreement"))warnings.push(msg("rebate.importWarning"));
      progress(msg("import.checkingValuesDuplicatesAnd"), "0", "1");
      // Headers and item lists first: sales lines take customer, date and freight from the one and cost from the other.
      const sequence = (["order_header", "item_master", "customer_list", "ar_aging", "vendor_cost", "price_list", "sales_history", "rebate_agreement", "purchases"] as const).filter(r => roles.has(r));
      for (const role of sequence) {
        signal.throwIfAborted();
        if (role === "sales_history") {
          const joins = await joinHeaders(engine, files);
          for (const [ord, j] of joins ?? []) {
            const f = files[ord], st = stats.get(ord)!, notes = cleanups.get(ord)!;
            if (j.joined) notes.push({ field: (f.fromHeader ?? []).join(", "), note: msg("import.filledFromTheOrder"), count: String(j.joined) });
            const range = load[ord].range;
            if (f.fromHeader?.includes("sale_date") && (range.from || range.to)) {
              const dropped = await dropOutsideRange(engine, ord, range);
              if (dropped) { st.read -= dropped; st.skipped += dropped; notes.push({ field: "sale_date", note: msg("import.skippedRowsOutsideThe", { value: range.from ?? msg("import.rangeStart"), value2: range.to ?? msg("import.rangeEnd") }), count: String(dropped) }); }
            }
          }
        }
        await validate(engine, role, files, replaces);
        if (role === "sales_history") {
          await markUnjoined(engine, files);
          const freight = await spreadFreight(engine, files);
          if (freight.spread) for (const f of files.filter(x => x.fromHeader?.includes("freight_amount"))) cleanups.get(f.ord)!.push({ field: "freight_amount", note: msg("import.orderFreightSpreadOver"), count: msg("import.orders", { spread: freight.spread }) });
          if (freight.unspread) warnings.push(msg("import.freightOnOrderS", { unspread: freight.unspread }));
          const cost = await fillItemCost(engine, files, roles.has("item_master"));
          if (cost.costed || cost.unknown) for (const f of files.filter(x => x.itemCost)) {
            if (cost.costed) cleanups.get(f.ord)!.push({ field: "cost_amount", note: msg("import.quantityXTheItem"), count: String(cost.costed) });
            if (cost.unknown) cleanups.get(f.ord)!.push({ field: "cost_amount", note: msg("import.leftUnknownTheItem"), count: String(cost.unknown) });
          }
        }
      }
      const reports: FileReport[] = [];
      let loaded = BigInt(0), rejected = BigInt(0);
      for (const f of files) if (f.role === "order_header") cleanups.get(f.ord)!.push({ field: "rows", note: msg("import.orderHeaderRowsOnly"), count: "all" });
      for (const role of sequence) for (const c of await counts(engine, role)) {
        const file = files[c.ord], st = stats.get(c.ord)!, sampled = await sampleIssues(engine, role, c.ord);
        const issues = [...st.issues.slice(0, 50), ...sampled.map(s => ({ row: s.row, column: issueColumn(s.code, file), message: issueMessage(s.code, file.settings) }))].sort((a, b) => a.row - b.row).slice(0, 100);
        const bad = BigInt(c.bad) + BigInt(st.rejected);
        if (role !== "order_header") { loaded += BigInt(c.ok); rejected += bad; }
        reports.push({ id: load[c.ord].id, name: file.name, role, fx: batchFx(file.settings.sourceCurrency ?? currency,currency,file.settings.fxRate ?? "1"), rowsRead: String(st.read), rowsLoaded: c.ok, rowsRejected: String(bad), rowsSkipped: String(st.skipped), issueCount: String(BigInt(c.bad) + BigInt(st.issueCount)), issues, dateRange: null, cleaned: cleanups.get(c.ord) ?? [] });
      }
      for (const f of files) if (!reports.some(r => r.id === load[f.ord].id)) {
        const st = stats.get(f.ord)!; rejected += BigInt(st.rejected);
        reports.push({ id: load[f.ord].id, name: f.name, role: f.role, fx: batchFx(f.settings.sourceCurrency ?? currency,currency,f.settings.fxRate ?? "1"), rowsRead: String(st.read), rowsLoaded: "0", rowsRejected: String(st.rejected), rowsSkipped: String(st.skipped), issueCount: String(st.issueCount), issues: st.issues.slice(0, 100), dateRange: null, cleaned: cleanups.get(f.ord) ?? [] });
      }
      if (roles.has("sales_history")) {
        const ranges = await salesRanges(engine, replaces);
        for (const r of ranges.batch) { const rep = reports.find(x => x.id === load[r.ord].id); if (rep) rep.dateRange = { from: r.from, to: r.to }; }
        for (let i = 0; i < ranges.batch.length; i++) {
          const a = ranges.batch[i];
          for (const b of ranges.batch.slice(i + 1)) if (a.from <= b.to && b.from <= a.to) warnings.push(msg("import.andCoverOverlappingDates", { name: files[a.ord].name, name2: files[b.ord].name, from: a.from, to: a.to, from2: b.from, to2: b.to }));
          for (const v of ranges.vault) if (a.from <= v.to && v.from <= a.to) warnings.push(msg("import.overlapsTheDatesOf", { name: files[a.ord].name, name2: v.name, from: v.from, to: v.to }));
        }
      }
      const prints = files.map(f => sqlText(f.fingerprint)).join(",");
      for (const r of (await engine.conn.query(`SELECT b.fingerprint, s.name, s.imported_at FROM import_batches b JOIN source_files s ON s.id=b.source_id WHERE b.fingerprint IN (${prints})${replaces ? ` AND s.id<>${sqlText(replaces)}` : ""}`)).toArray())
        warnings.push(msg("import.looksIdenticalToA", { name: String(r.name), value: String(r.imported_at).slice(0, 10) }));
      const usage = await capUsage(engine, roles, replaces), cap = CAPS[tier];
      const capOk = fitsLicenceCapacity(tier,usage.products,usage.lines);
      this.report = { rebateTerms:roles.has("rebate_agreement"),files: reports.sort((a, b) => load.findIndex(e => e.id === a.id) - load.findIndex(e => e.id === b.id)), warnings, loaded: loaded.toString(), rejected: rejected.toString(), capOk,
        capMessage: capOk ? null : msg("import.thisImportExceedsYour", { tier: tierRef(tier), lines: cap.lines, products: cap.products, lines2: usage.lines.toString(), products2: usage.products.toString() }), replaces };
      this.staged = { files, stats, entries: load, replaces, roles };
      return this.report;
    } catch (error) { await resetStage(engine).catch(() => undefined); throw error; }
  }
  /** Commit the planned batch. The caller made the engine writable and saves afterwards. */
  async commit(engine: Engine, acknowledge: boolean) {
    const staged = this.staged, report = this.report;
    if (!staged || !report) throw new StudioError(msg("import.reviewTheBatchAgain"));
    if (report.loaded === "0") throw new StudioError(msg("import.noValidRowsTo"));
    if (report.rejected !== "0" && !acknowledge) throw new StudioError(msg("import.confirmThatRejectedRows"));
    if(staged.roles.has("rebate_agreement")&&!acknowledge)throw new StudioError(msg("rebate.importWarning"));
    if (!report.capOk) throw new StudioError(report.capMessage!);
    // Order header files only filled in sales lines during review; they are not stored as sources.
    const kept = staged.files.filter(f => f.role !== "order_header"), headerNames = staged.files.filter(f => f.role === "order_header").map(f => f.name).join(", ");
    const now = new Date().toISOString(), sources = kept.map(() => id());
    const values = kept.map((f, i) => `(${f.ord},${sqlText(sources[i])},${sqlText(f.name)})`).join(",");
    const messages = kept.flatMap(f => CODES(f.role).map(code => `(${f.ord},${sqlText(code)},${sqlText(issueColumn(code, f))},${sqlText(issueMessage(code, f.settings))})`)).join(",");
    await engine.conn.query("BEGIN");
    try {
      if (staged.replaces) await engine.conn.query(removeChildrenSql(staged.replaces,await hasRebates(engine),await hasSupplier(engine)));
      await engine.conn.query(`CREATE TEMP TABLE studio_files AS SELECT * FROM (VALUES ${values}) v(file_ord, source_id, name);
CREATE TEMP TABLE studio_messages AS SELECT * FROM (VALUES ${messages}) v(file_ord, code, column_name, message)`);
      for (const [i, f] of kept.entries()) {
        const r = report.files.find(x => x.id === staged.entries[f.ord].id)!;
        await engine.conn.query(`INSERT INTO source_files VALUES (${sqlText(sources[i])},${sqlText(f.name)},${sqlText(["ar_aging","rebate_agreement","purchases"].includes(f.role) ? "customer_list" : f.role)},${f.bytes},${sqlText(now)});${["ar_aging","rebate_agreement","purchases"].includes(f.role) ? `INSERT INTO source_kinds VALUES (${sqlText(sources[i])},${sqlText(f.role)});` : ""}
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at,content_sha256,fingerprint,rows_skipped,source_currency,workspace_currency,fx_rate,header_fx) VALUES (${sqlText(id())},${sqlText(sources[i])},${r.rowsLoaded},${r.rowsRejected},${sqlText(now)},NULL,${sqlText(f.fingerprint)},${r.rowsSkipped},${sqlText(f.settings.sourceCurrency ?? "USD")},${sqlText(await workspaceCurrency(engine))},${sqlText(f.settings.fxRate ?? "1")},${sqlText(JSON.stringify(staged.files.filter(h=>h.role === "order_header").map(h=>({sourceCurrency:h.settings.sourceCurrency,fxRate:h.settings.fxRate}))))})`);
      }
      await engine.conn.query(commitSql(new Set([...staged.roles].filter(r => r !== "order_header"))));
      await rebuildAccruals(engine);
      for (const [i, f] of kept.entries()) {
        const issues = staged.stats.get(f.ord)!.issues;
        for (let at = 0; at < issues.length; at += 500) await engine.conn.query(`INSERT INTO import_issues(id,source_id,row_number,column_name,message,status,code) VALUES ${issues.slice(at, at + 500).map(x => `(${sqlText(id())},${sqlText(sources[i])},${Math.max(1, x.row)},${sqlText(x.column)},${sqlText(x.message)},'open','structure')`).join(",")}`);
        // Rows rejected before mapping (wrong column count, oversized cells) can only be dismissed in Fix Later.
        const rows = staged.stats.get(f.ord)!.rejectedRows;
        for (let at = 0; at < rows.length; at += 500) await engine.conn.query(`INSERT INTO rejected_rows VALUES ${rows.slice(at, at + 500).map(r => `(${sqlText(sources[i])},${Math.max(1, r)},${sqlText(f.role)},'structure',${Array(12).fill("NULL").join(",")},'open')`).join(",")} ON CONFLICT DO NOTHING`);
        const r = report.files.find(x => x.id === staged.entries[f.ord].id)!;
        await appendAudit(engine, "import.committed", { source_id: sources[i], ...(!["rebate_agreement","purchases"].includes(f.role)?{file_name:f.name}:{}), role: f.role, rows_loaded: r.rowsLoaded, rows_rejected: r.rowsRejected, ...(staged.replaces ? { replaces: staged.replaces } : {}), ...(f.fromHeader?.length && headerNames ? { header_files: headerNames } : {}), ...(f.itemCost ? { cost_source: msg("import.itemListCurrentCost") } : {}) });
      }
      await engine.conn.query("COMMIT");
    } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
    let cleanup = true;
    if (staged.replaces) {
      try { await engine.conn.query(`BEGIN; ${finishRemovalSql(staged.replaces,await hasSupplier(engine))} COMMIT`); } catch { await engine.conn.query("ROLLBACK").catch(() => undefined); cleanup = false; }
    }
    await resetStage(engine).catch(() => undefined);
    const result = { loaded: report.loaded, rejected: report.rejected, files: String(kept.length), cleanup };
    this.clear(); return result;
  }
}
/** Remove one imported file and exactly its rows (two transactions; see finishRemovalSql). */
export async function removeSource(engine: Engine, source: string) {
  const row = (await engine.conn.query(`SELECT s.name,coalesce(k.kind,s.role) AS role FROM source_files s LEFT JOIN source_kinds k ON k.source_id=s.id WHERE s.id=${sqlText(source)}`)).toArray()[0];
  if (!row) throw new StudioError(msg("import.thatFileIsNo"));
  await engine.conn.query("BEGIN");
  try {
    await engine.conn.query(removeChildrenSql(source,await hasRebates(engine),await hasSupplier(engine)));
    await rebuildAccruals(engine);
    await appendAudit(engine, "import.removed", { source_id: source, ...(!["rebate_agreement","purchases"].includes(String(row.role))?{file_name:String(row.name)}:{}) });
    await engine.conn.query("COMMIT");
  } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
  try { await engine.conn.query(`BEGIN; ${finishRemovalSql(source,await hasSupplier(engine))} COMMIT`); return true; }
  catch { await engine.conn.query("ROLLBACK").catch(() => undefined); return false; }
}
export async function listSources(engine: Engine): Promise<SourceView[]> {
  return (await engine.conn.query(`SELECT s.id, s.name, coalesce(k.kind, s.role) AS role, s.imported_at, coalesce(b.rows_loaded,0)::VARCHAR AS loaded, coalesce(b.rows_rejected,0)::VARCHAR AS rejected, b.source_currency, b.workspace_currency, b.fx_rate, b.header_fx,
(SELECT count(*) FROM import_issues i WHERE i.source_id=s.id)::VARCHAR AS issues FROM source_files s LEFT JOIN source_kinds k ON k.source_id=s.id LEFT JOIN import_batches b ON b.source_id=s.id ORDER BY s.imported_at DESC, s.name`)).toArray()
    .map(r => ({ id: String(r.id), name: String(r.name), role: String(r.role), importedAt: String(r.imported_at), rowsLoaded: String(r.loaded), rowsRejected: String(r.rejected), issues: String(r.issues), sourceCurrency: String(r.source_currency ?? "USD"), workspaceCurrency: String(r.workspace_currency ?? "USD"), fxRate: String(r.fx_rate ?? "1"), headerFx: String(r.header_fx ?? "[]") }));
}
export async function loadRecipes(engine: Engine): Promise<Recipe[]> {
  const rows = (await engine.conn.query("SELECT id, name, profile, settings FROM converter_recipes ORDER BY name LIMIT 200")).toArray();
  return rows.flatMap(r => {
    try {
      const s = JSON.parse(String(r.settings));
      const valid = DELIMITERS.includes(s.delimiter) && DATE_FORMATS.includes(s.dateFormat) && ["dot", "comma"].includes(s.decimal) && [1, 2, 3].includes(s.headerDepth) && Number.isInteger(s.headerRow) && kindOf("x." + s.kind) === s.kind && (s.role === null || ROLES.includes(s.role));
      // Mappings are re-checked against the file when applied; keep only well-formed sources here.
      const sourceOk = (x: FieldSource) => x && ["column", "unit", "percent", "fraction", "zero", "none", "generate", "header", "item_cost"].includes(x.kind) && (!("index" in x) || Number.isInteger(x.index));
      if (s.mapping && (typeof s.mapping !== "object" || !Object.values(s.mapping as Record<string, FieldSource>).every(sourceOk))) delete s.mapping;
      if (s.erp && !PROFILE_IDS.includes(s.erp)) delete s.erp;
      return valid ? [{ id: String(r.id), name: String(r.name), profile: String(r.profile), settings: s }] : [];
    } catch { return []; }
  });
}
export function recipeSql(recipe: Omit<Recipe, "id">) {
  const now = new Date().toISOString();
  return `DELETE FROM converter_recipes WHERE name=${sqlText(recipe.name)} AND profile=${sqlText(recipe.profile)};
INSERT INTO converter_recipes VALUES (${sqlText(id())},${sqlText(recipe.name)},${sqlText(recipe.profile)},${sqlText(JSON.stringify(recipe.settings))},${sqlText(now)})`;
}
