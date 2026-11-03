// Spreadsheet (XLSX/XLSM/XLS/XLSB/ODS), JSON and XML readers producing a bounded
// string grid. Formulas are never evaluated (cached results are not read) and
// macros are never run: SheetJS only exposes them as data, which we discard.
import * as XLSX from "xlsx";
import { XMLParser } from "fast-xml-parser";
import { MAX_COLUMNS, MAX_CELL } from "./text";
import { StudioError, columnLetter, type Kind, type StudioIssue } from "./formats";
export const MAX_SHEET_BYTES = 64 * 1024 * 1024, MAX_SHEET_ROWS = 300_000, MAX_SHEET_CELLS = 4_000_000, MAX_DOC_BYTES = 64 * 1024 * 1024;
export type Grid = { rows: string[][]; rowNumbers: number[]; colOffset: number; merged: boolean; notices: string[]; issues: StudioIssue[]; keyed: boolean };

async function head(bytes: Uint8Array, method: number) {
  if (method === 0) return new TextDecoder().decode(bytes.subarray(0, 4096));
  const reader = new Blob([bytes.slice(0, 65536)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  let text = "";
  try {
    while (text.length < 4096) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value, { stream: true }); }
  } catch (error) { if (!text) throw error; } // A truncated 64 KiB slice ends mid-stream.
  finally { await reader.cancel().catch(() => undefined); }
  return text;
}
/** Validate a ZIP-based workbook before SheetJS sees it. Returns user-facing notices. */
export async function checkZip(bytes: Uint8Array, kind: Kind) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), notices = new Set<string>();
  if (bytes.length < 22 || v.getUint32(0, true) !== 0x04034b50) throw new StudioError(`This is not a valid .${kind} file.`);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw new StudioError("Unsupported workbook ZIP directory.");
  const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true);
  if (count < 1 || count > 2048 || start + v.getUint32(end + 12, true) !== end) throw new StudioError("Invalid or oversized workbook directory.");
  let at = start, total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) throw new StudioError("Invalid workbook ZIP entry.");
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), packed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true);
    const n = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    if (at + 46 + n + extra + comment > end) throw new StudioError("Invalid workbook ZIP entry.");
    if (flags & 1) throw new StudioError("Password-protected or encrypted workbooks are not supported. Save an unprotected copy.");
    if (packed === 0xffffffff || size === 0xffffffff || (method !== 0 && method !== 8)) throw new StudioError("Unsupported workbook compression. Save the file again from Excel or LibreOffice.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + n)); at += 46 + n + extra + comment;
    if (names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").some(x => x === "..")) throw new StudioError("The workbook contains unsafe file paths.");
    names.add(name);
    if (size > 256 * 1024 * 1024 || (total += size) > 512 * 1024 * 1024 || (size > 1_000_000 && size / Math.max(1, packed) > 200)) throw new StudioError("The workbook expands beyond safe limits.");
    if (/vbaProject|\/macros?\//i.test(name)) notices.add("Macros are present. They were ignored and never run.");
    if (/externalLinks?\//i.test(name)) notices.add("Links to other workbooks were ignored; no external file was opened.");
    if (/embeddings\/|activeX\//i.test(name)) notices.add("Embedded objects and controls were ignored.");
    if (/\.(xml|rels)$/i.test(name) && local + 30 <= bytes.length) {
      const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      // Entity declarations may only appear in the prolog, so the first 4 KiB is enough.
      const prolog = await head(bytes.subarray(dataAt, dataAt + packed), method).catch(() => { throw new StudioError("A workbook part could not be read."); });
      if (/<!\s*(DOCTYPE|ENTITY)/i.test(prolog)) throw new StudioError("Workbook XML with DOCTYPE or entity declarations is not accepted.");
    }
  }
  if (at !== end) throw new StudioError("Invalid workbook directory length.");
  return [...notices];
}
export function sheetNames(bytes: Uint8Array) {
  const names = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
  if (!names.length) throw new StudioError("The workbook has no sheets.");
  return names;
}
function pad(n: number, w: number) { return String(n).padStart(w, "0"); }
function numberText(value: number) {
  const text = String(value);
  return /e/i.test(text) ? null : text;
}
function cellText(cell: XLSX.CellObject | undefined, row: number, col: string, issues: StudioIssue[]) {
  if (!cell) return "";
  if (cell.f) { issues.push({ row, column: col, message: "Formula ignored; its cached result was not read. Type the value or export values only." }); return ""; }
  if (cell.t === "s") return String(cell.v ?? "");
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "e") { issues.push({ row, column: col, message: "Spreadsheet error value; the cell was left blank." }); return ""; }
  if (cell.t === "d" && cell.v instanceof Date) { const d = cell.v; return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; }
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) { const p = XLSX.SSF.parse_date_code(cell.v); return p ? `${p.y}-${pad(p.m, 2)}-${pad(p.d, 2)}` : ""; }
    const text = numberText(cell.v);
    if (text === null) issues.push({ row, column: col, message: "Number too large or small to read exactly; the cell was left blank." });
    return text ?? "";
  }
  return "";
}
/** Read one sheet into a bounded grid. Merged cells are filled from their top-left value. */
export function sheetGrid(bytes: Uint8Array, sheet: string, zipNotices: string[] = []): Grid {
  const wb = XLSX.read(bytes, { type: "array", dense: true, cellFormula: true, cellNF: true, cellText: false, cellDates: false, cellHTML: false, bookVBA: true, sheets: sheet, sheetRows: MAX_SHEET_ROWS + 50 });
  const notices = [...zipNotices];
  if ((wb as { vbaraw?: unknown }).vbaraw && !notices.some(n => n.startsWith("Macros"))) notices.push("Macros are present. They were ignored and never run.");
  const ws = wb.Sheets[sheet];
  if (!ws) throw new StudioError("That sheet was not found in the workbook.");
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1"), height = range.e.r - range.s.r + 1;
  if (height >= MAX_SHEET_ROWS + 50) throw new StudioError(`This sheet has more than ${MAX_SHEET_ROWS.toLocaleString("en-US")} rows. Save it as CSV and import the CSV instead.`);
  const width = Math.min(range.e.c - range.s.c + 1, MAX_COLUMNS);
  if (range.e.c - range.s.c + 1 > MAX_COLUMNS) notices.push(`Only the first ${MAX_COLUMNS} columns were read.`);
  if (height * width > MAX_SHEET_CELLS) throw new StudioError("This sheet is too large to convert in the browser. Save it as CSV and import the CSV instead.");
  const data = (ws as { "!data"?: XLSX.CellObject[][] })["!data"] || [], rows: string[][] = [], rowNumbers: number[] = [], issues: StudioIssue[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line = data[r] || [], out: string[] = new Array(width);
    for (let c = 0; c < width; c++) { const text = cellText(line[range.s.c + c], r + 1, columnLetter(range.s.c + c), issues); out[c] = text.length > MAX_CELL ? text.slice(0, MAX_CELL) : text; }
    rows.push(out); rowNumbers.push(r + 1);
  }
  const merges = ws["!merges"] || [];
  for (const m of merges) {
    const top = m.s.r - range.s.r, left = m.s.c - range.s.c, value = rows[top]?.[left] ?? "";
    for (let r = Math.max(0, top); r <= Math.min(rows.length - 1, m.e.r - range.s.r); r++)
      for (let c = Math.max(0, left); c <= Math.min(width - 1, m.e.c - range.s.c); c++) if (rows[r][c] === "") rows[r][c] = value;
  }
  if (merges.length) notices.push("Merged cells were filled from their top-left value.");
  const hiddenCols = (ws["!cols"] || []).filter(c => c?.hidden).length, hiddenRows = (ws["!rows"] || []).filter(r => r?.hidden).length;
  if (hiddenCols || hiddenRows) notices.push(`The sheet has ${hiddenRows} hidden row(s) and ${hiddenCols} hidden column(s); they were read like visible cells.`);
  return { rows, rowNumbers, colOffset: range.s.c, merged: merges.length > 0, notices, issues, keyed: false };
}
function flatten(value: unknown, prefix: string, out: Map<string, string>, notices: Set<string>, depth = 0) {
  if (value === null || value === undefined) { out.set(prefix, ""); return; }
  if (Array.isArray(value)) {
    if (value.every(v => v === null || typeof v !== "object")) out.set(prefix, value.map(v => v ?? "").join("; "));
    else { notices.add("Nested lists were kept as JSON text."); out.set(prefix, JSON.stringify(value).slice(0, MAX_CELL)); }
    return;
  }
  if (typeof value === "object" && depth < 8) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out, notices, depth + 1);
    return;
  }
  out.set(prefix, String(value).slice(0, MAX_CELL));
}
/** Turn a list of records into a grid whose first row is the union of flattened keys. */
function recordsGrid(records: unknown[], notices: Set<string>): Grid {
  const keys: string[] = [], index = new Map<string, number>(), flat: Map<string, string>[] = [];
  for (const record of records) {
    const out = new Map<string, string>(); flatten(record, "", out, notices);
    for (const k of out.keys()) if (!index.has(k)) { if (keys.length >= MAX_COLUMNS) { notices.add(`Only the first ${MAX_COLUMNS} fields were read.`); continue; } index.set(k, keys.length); keys.push(k || "value"); }
    flat.push(out);
  }
  const rows = [keys, ...flat.map(out => { const row = new Array(keys.length).fill(""); for (const [k, v] of out) { const i = index.get(k); if (i !== undefined) row[i] = v; } return row; })];
  return { rows, rowNumbers: rows.map((_, i) => i + 1), colOffset: 0, merged: false, notices: [...notices], issues: [], keyed: true };
}
function largestRecordList(root: unknown) {
  let best: unknown[] | null = null;
  const queue: Array<{ v: unknown; d: number }> = [{ v: root, d: 0 }];
  while (queue.length) {
    const { v, d } = queue.shift()!;
    if (Array.isArray(v)) { if (v.some(x => x && typeof x === "object" && !Array.isArray(x)) && (!best || v.length > best.length)) best = v; if (d < 4) for (const x of v.slice(0, 1)) queue.push({ v: x, d: d + 1 }); }
    else if (v && typeof v === "object" && d < 4) for (const x of Object.values(v)) queue.push({ v: x, d: d + 1 });
  }
  return best;
}
export function jsonGrid(text: string): Grid {
  let root: unknown;
  try { root = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new StudioError("The JSON file is not valid JSON."); }
  const records = largestRecordList(root) || (root && typeof root === "object" ? [root] : null);
  if (!records?.length) throw new StudioError("No records were found in the JSON file. Use an array of objects.");
  if (records.length > MAX_SHEET_ROWS) throw new StudioError(`The JSON file has more than ${MAX_SHEET_ROWS.toLocaleString("en-US")} records. Convert it to CSV first.`);
  return recordsGrid(records, new Set());
}
export function xmlGrid(text: string): Grid {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new StudioError("XML with DOCTYPE or entity declarations is not accepted.");
  let root: unknown;
  try {
    root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", processEntities: false, htmlEntities: false, parseTagValue: false, parseAttributeValue: false, trimValues: true, ignoreDeclaration: true, ignorePiTags: true, textNodeName: "value" }).parse(text, true);
  } catch { throw new StudioError("The XML file is not well-formed."); }
  const records = largestRecordList(root);
  const single = records || (() => { let v = root; for (let d = 0; d < 3 && v && typeof v === "object" && Object.keys(v).length === 1; d++) v = Object.values(v)[0]; return v && typeof v === "object" ? [v] : null; })();
  if (!single?.length) throw new StudioError("No repeating records were found in the XML file.");
  if (single.length > MAX_SHEET_ROWS) throw new StudioError(`The XML file has more than ${MAX_SHEET_ROWS.toLocaleString("en-US")} records. Convert it to CSV first.`);
  return recordsGrid(single, new Set());
}
