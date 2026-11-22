// Spreadsheet (XLSX/XLSM/XLS/XLSB/ODS), JSON and XML readers producing a bounded
// string grid. Formulas are never evaluated (cached results are not read) and
// macros are never run: SheetJS only exposes them as data, which we discard.
import * as XLSX from "xlsx";
import { XMLParser } from "fast-xml-parser";
import { MAX_COLUMNS, MAX_CELL } from "./text";
import { StudioError, columnLetter, type Kind, type StudioIssue } from "./formats";
import { msg } from "../i18n/core";
export const MAX_SHEET_BYTES = 64 * 1024 * 1024, MAX_SHEET_ROWS = 300_000, MAX_SHEET_CELLS = 4_000_000, MAX_DOC_BYTES = 64 * 1024 * 1024;
/** streamed (6A): rows holds only a preview; the import reads the whole sheet with streamSheet. */
export type Grid = { rows: string[][]; rowNumbers: number[]; colOffset: number; merged: boolean; notices: string[]; issues: StudioIssue[]; keyed: boolean; streamed?: { totalRows: number } };

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
  if (bytes.length < 22 || v.getUint32(0, true) !== 0x04034b50) throw new StudioError(msg("sheet.thisIsNotA", { kind }));
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw new StudioError(msg("sheet.unsupportedWorkbookZipDirectory"));
  const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true);
  if (count < 1 || count > 2048 || start + v.getUint32(end + 12, true) !== end) throw new StudioError(msg("sheet.invalidOrOversizedWorkbook"));
  let at = start, total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) throw new StudioError(msg("sheet.invalidWorkbookZipEntry2"));
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), packed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true);
    const n = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    if (at + 46 + n + extra + comment > end) throw new StudioError(msg("sheet.invalidWorkbookZipEntry"));
    if (flags & 1) throw new StudioError(msg("sheet.passwordProtectedOrEncrypted"));
    if (packed === 0xffffffff || size === 0xffffffff || (method !== 0 && method !== 8)) throw new StudioError(msg("sheet.unsupportedWorkbookCompressionSave"));
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + n)); at += 46 + n + extra + comment;
    if (names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").some(x => x === "..")) throw new StudioError(msg("sheet.theWorkbookContainsUnsafe"));
    names.add(name);
    if (size > 256 * 1024 * 1024 || (total += size) > 512 * 1024 * 1024 || (size > 1_000_000 && size / Math.max(1, packed) > 200)) throw new StudioError(msg("sheet.theWorkbookExpandsBeyond"));
    // Phase 16 audit: the limits above use the central directory's sizes. A local header that carries its own sizes
    // (no data descriptor) must agree, or a crafted file could declare small sizes here and expand further when read.
    if (local + 30 > end || v.getUint32(local, true) !== 0x04034b50) throw new StudioError(msg("sheet.invalidWorkbookZipEntry"));
    if (!(flags & 8) && (v.getUint32(local + 18, true) !== packed || v.getUint32(local + 22, true) !== size)) throw new StudioError(msg("sheet.invalidWorkbookZipEntry"));
    if (/vbaProject|\/macros?\//i.test(name)) notices.add(msg("sheet.macrosArePresentThey2"));
    if (/externalLinks?\//i.test(name)) notices.add(msg("sheet.linksToOtherWorkbooks"));
    if (/embeddings\/|activeX\//i.test(name)) notices.add(msg("sheet.embeddedObjectsAndControls"));
    if (/\.(xml|rels)$/i.test(name) && local + 30 <= bytes.length) {
      const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      // Entity declarations may only appear in the prolog, so the first 4 KiB is enough.
      const prolog = await head(bytes.subarray(dataAt, dataAt + packed), method).catch(() => { throw new StudioError(msg("sheet.aWorkbookPartCould")); });
      if (/<!\s*(DOCTYPE|ENTITY)/i.test(prolog)) throw new StudioError(msg("sheet.workbookXmlWithDoctype"));
    }
  }
  if (at !== end) throw new StudioError(msg("sheet.invalidWorkbookDirectoryLength"));
  return [...notices];
}
export function sheetNames(bytes: Uint8Array) {
  const names = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
  if (!names.length) throw new StudioError(msg("sheet.theWorkbookHasNo"));
  return names;
}
function pad(n: number, w: number) { return String(n).padStart(w, "0"); }
function numberText(value: number) {
  const text = String(value);
  return /e/i.test(text) ? null : text;
}
function cellText(cell: XLSX.CellObject | undefined, row: number, col: string, issues: StudioIssue[]) {
  if (!cell) return "";
  if (cell.f) { issues.push({ row, column: col, message: msg("sheet.formulaIgnoredItsCached") }); return ""; }
  if (cell.t === "s") return String(cell.v ?? "");
  if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
  if (cell.t === "e") { issues.push({ row, column: col, message: msg("sheet.spreadsheetErrorValueThe") }); return ""; }
  if (cell.t === "d" && cell.v instanceof Date) { const d = cell.v; return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; }
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) { const p = XLSX.SSF.parse_date_code(cell.v); return p ? `${p.y}-${pad(p.m, 2)}-${pad(p.d, 2)}` : ""; }
    const text = numberText(cell.v);
    if (text === null) issues.push({ row, column: col, message: msg("sheet.numberTooLargeOr") });
    return text ?? "";
  }
  return "";
}
/** Read one sheet into a bounded grid. Merged cells are filled from their top-left value. */
export function sheetGrid(bytes: Uint8Array, sheet: string, zipNotices: string[] = []): Grid {
  const wb = XLSX.read(bytes, { type: "array", dense: true, cellFormula: true, cellNF: true, cellText: false, cellDates: false, cellHTML: false, bookVBA: true, sheets: sheet, sheetRows: MAX_SHEET_ROWS + 50 });
  const notices = [...zipNotices];
  if ((wb as { vbaraw?: unknown }).vbaraw && !notices.some(n => n.startsWith("Macros"))) notices.push(msg("sheet.macrosArePresentThey"));
  const ws = wb.Sheets[sheet];
  if (!ws) throw new StudioError(msg("sheet.thatSheetWasNot"));
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1"), height = range.e.r - range.s.r + 1;
  if (height >= MAX_SHEET_ROWS + 50) throw new StudioError(msg("sheet.thisSheetHasMore", { maxsheetrows: MAX_SHEET_ROWS }));
  const width = Math.min(range.e.c - range.s.c + 1, MAX_COLUMNS);
  if (range.e.c - range.s.c + 1 > MAX_COLUMNS) notices.push(msg("sheet.onlyTheFirstColumns", { maxcolumns: MAX_COLUMNS }));
  if (height * width > MAX_SHEET_CELLS) throw new StudioError(msg("sheet.thisSheetIsToo"));
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
  if (merges.length) notices.push(msg("sheet.mergedCellsWereFilled"));
  const hiddenCols = (ws["!cols"] || []).filter(c => c?.hidden).length, hiddenRows = (ws["!rows"] || []).filter(r => r?.hidden).length;
  if (hiddenCols || hiddenRows) notices.push(msg("sheet.theSheetHasHidden", { hiddenRows, hiddenCols }));
  return { rows, rowNumbers, colOffset: range.s.c, merged: merges.length > 0, notices, issues, keyed: false };
}
function flatten(value: unknown, prefix: string, out: Map<string, string>, notices: Set<string>, depth = 0) {
  if (value === null || value === undefined) { out.set(prefix, ""); return; }
  if (Array.isArray(value)) {
    if (value.every(v => v === null || typeof v !== "object")) out.set(prefix, value.map(v => v ?? "").join("; "));
    else { notices.add(msg("sheet.nestedListsWereKept")); out.set(prefix, JSON.stringify(value).slice(0, MAX_CELL)); }
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
    for (const k of out.keys()) if (!index.has(k)) { if (keys.length >= MAX_COLUMNS) { notices.add(msg("sheet.onlyTheFirstFields", { maxcolumns: MAX_COLUMNS })); continue; } index.set(k, keys.length); keys.push(k || "value"); }
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
  try { root = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new StudioError(msg("sheet.theJsonFileIs")); }
  const records = largestRecordList(root) || (root && typeof root === "object" ? [root] : null);
  if (!records?.length) throw new StudioError(msg("sheet.noRecordsWereFound"));
  if (records.length > MAX_SHEET_ROWS) throw new StudioError(msg("sheet.theJsonFileHas", { maxsheetrows: MAX_SHEET_ROWS }));
  return recordsGrid(records, new Set());
}
export function xmlGrid(text: string): Grid {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new StudioError(msg("sheet.xmlWithDoctypeOr"));
  let root: unknown;
  try {
    root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", processEntities: false, htmlEntities: false, parseTagValue: false, parseAttributeValue: false, trimValues: true, ignoreDeclaration: true, ignorePiTags: true, textNodeName: "value" }).parse(text, true);
  } catch { throw new StudioError(msg("sheet.theXmlFileIs")); }
  const records = largestRecordList(root);
  const single = records || (() => { let v = root; for (let d = 0; d < 3 && v && typeof v === "object" && Object.keys(v).length === 1; d++) v = Object.values(v)[0]; return v && typeof v === "object" ? [v] : null; })();
  if (!single?.length) throw new StudioError(msg("sheet.noRepeatingRecordsWere"));
  if (single.length > MAX_SHEET_ROWS) throw new StudioError(msg("sheet.theXmlFileHas", { maxsheetrows: MAX_SHEET_ROWS }));
  return recordsGrid(single, new Set());
}
