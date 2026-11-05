// 6A: streaming reader for XLSX/XLSM sheets over the 300,000-row grid limit. The
// workbook ZIP was already checked by checkZip (no encryption, safe paths, no DTDs,
// bounded expansion). The sheet XML is inflated and parsed in chunks, so no grid of
// the whole sheet is ever built. Same cell rules as sheetGrid: formulas are never
// evaluated and their cached results are not read; error cells are left blank.
import * as XLSX from "xlsx";
import { MAX_CELL, MAX_COLUMNS } from "./text";
import { StudioError, columnLetter, type StudioIssue } from "./formats";
import type { Grid } from "./sheets";
import { msg } from "../i18n/core";

type Part = { method: number; packed: number; dataAt: number };
/** Central directory: part name -> where its (possibly deflated) bytes start. */
function parts(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<string, Part>();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new StudioError(msg("sheet.stream.unsupportedWorkbookZipDirectory"));
  let at = v.getUint32(end + 16, true);
  for (let i = 0, count = v.getUint16(end + 10, true); i < count; i++) {
    const method = v.getUint16(at + 10, true), packed = v.getUint32(at + 20, true), n = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true), local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + n)); at += 46 + n + extra + comment;
    out.set(name, { method, packed, dataAt: local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true) });
  }
  return out;
}
async function* chunks(bytes: Uint8Array, part: Part, signal?: AbortSignal) {
  const raw = bytes.subarray(part.dataAt, part.dataAt + part.packed), decoder = new TextDecoder("utf-8");
  if (part.method === 0) { yield decoder.decode(raw); return; }
  const reader = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  try {
    for (;;) { signal?.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; yield decoder.decode(value, { stream: true }); }
    const tail = decoder.decode(); if (tail) yield tail;
  } finally { await reader.cancel().catch(() => undefined); }
}
async function text(bytes: Uint8Array, part: Part | undefined) { if (!part) return ""; let s = ""; for await (const c of chunks(bytes, part)) s += c; return s; }
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** XML character references and OOXML's _xHHHH_ escapes. */
export function unescapeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()])
    .replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}
/** Text of <t> runs, skipping phonetic (<rPh>) runs. */
function runs(xml: string) { let s = ""; for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) s += m[1] ?? ""; return unescapeXml(s); }
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
type Book = { sheetPath: string; shared: string[]; dateStyles: Set<number>; date1904: boolean };
async function book(bytes: Uint8Array, sheet: string): Promise<Book> {
  const zip = parts(bytes), workbook = await text(bytes, zip.get("xl/workbook.xml")), rels = await text(bytes, zip.get("xl/_rels/workbook.xml.rels"));
  const tag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]).find(t => unescapeXml(attr(t, "name") ?? "") === sheet);
  const rid = tag && /\br:id="([^"]+)"/.exec(tag)?.[1];
  const rel = rid ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => attr(t, "Id") === rid) : null;
  const target = rel ? attr(rel, "Target") : null;
  if (!target) throw new StudioError(msg("sheet.stream.thatSheetWasNot2"));
  const sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  const shared: string[] = [];
  for (const m of (await text(bytes, zip.get("xl/sharedStrings.xml"))).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(runs(m[1] ?? ""));
  const styles = await text(bytes, zip.get("xl/styles.xml")), custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) { const id = Number(attr(m[0], "numFmtId")), code = attr(m[0], "formatCode"); if (Number.isInteger(id) && code !== null) custom.set(id, unescapeXml(code)); }
  const dateStyles = new Set<number>(), xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => { const id = Number(attr(m[0], "numFmtId") ?? 0), code = custom.get(id); if (code !== undefined ? XLSX.SSF.is_date(code) : DATE_IDS.has(id)) dateStyles.add(i); });
  return { sheetPath, shared, dateStyles, date1904: /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook) };
}
const decodeRef = (ref: string) => { const m = /^([A-Z]{1,3})(\d+)$/.exec(ref); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { c: c - 1, r: Number(m[2]) }; };
const pad = (n: number, w: number) => String(n).padStart(w, "0");
/** The sheet's declared size (<dimension>), or null when the sheet does not declare one. */
export async function sheetSize(bytes: Uint8Array, sheet: string, known?: Book) {
  const b = known ?? await book(bytes, sheet), part = parts(bytes).get(b.sheetPath);
  if (!part) throw new StudioError(msg("sheet.stream.thatSheetWasNot"));
  let head = "";
  for await (const c of chunks(bytes, part)) { head += c; if (head.length > 8192 || head.includes("<sheetData")) break; }
  const m = /<dimension\b[^>]*\bref="([A-Z]+\d+)(?::([A-Z]+\d+))?"/.exec(head);
  const a = m && decodeRef(m[1]), z = m && decodeRef(m[2] ?? m[1]);
  return a && z ? { firstRow: a.r, lastRow: z.r, firstCol: a.c, lastCol: z.c } : null;
}
type RowSink = (cells: string[], row: number, index: number) => void;
class Stop extends Error {}
/**
 * Stream one sheet's rows in order, from its first declared row: missing rows come out
 * blank so row indexes match the preview. At most MAX_COLUMNS columns are read.
 */
export async function streamSheet(bytes: Uint8Array, sheet: string, sink: RowSink, issues: StudioIssue[], signal?: AbortSignal) {
  const b = await book(bytes, sheet), size = await sheetSize(bytes, sheet, b), part = parts(bytes).get(b.sheetPath)!;
  if (!size) throw new StudioError(msg("sheet.stream.thisSheetDoesNot2"));
  const width = Math.min(size.lastCol - size.firstCol + 1, MAX_COLUMNS), rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let buffer = "", next = size.firstRow, index = 0, done = false, issueCount = 0;
  const issue = (x: StudioIssue) => { issueCount++; if (issues.length < 10_000) issues.push(x); };
  const emit = (cells: string[], row: number) => { sink(cells, row, index++); };
  const cellText = (attrs: string, inner: string, row: number, col: number) => {
    const where = columnLetter(col);
    if (inner.includes("<f")) { issue({ row, column: where, message: msg("sheet.stream.formulaIgnoredItsCached") }); return ""; }
    const t = attr(attrs, "t") ?? "n", v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    if (t === "inlineStr") return runs(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
    if (v === undefined) return "";
    if (t === "s") return b.shared[Number(v)] ?? "";
    if (t === "str") return unescapeXml(v);
    if (t === "b") return v === "1" ? "TRUE" : "FALSE";
    if (t === "e") { issue({ row, column: where, message: msg("sheet.stream.spreadsheetErrorValueThe") }); return ""; }
    if (t === "d") return /^\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? "";
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    if (b.dateStyles.has(Number(attr(attrs, "s") ?? 0))) { const p = XLSX.SSF.parse_date_code(n, { date1904: b.date1904 }); return p ? `${p.y}-${pad(p.m, 2)}-${pad(p.d, 2)}` : ""; }
    const s = String(n);
    if (/e/i.test(s)) { issue({ row, column: where, message: msg("sheet.stream.numberTooLargeOr") }); return ""; }
    return s;
  };
  for await (const chunk of chunks(bytes, part, signal)) {
    buffer += chunk;
    let consumed = 0, m: RegExpExecArray | null;
    rowRe.lastIndex = 0;
    while ((m = rowRe.exec(buffer))) {
      consumed = rowRe.lastIndex;
      const r = Number(attr(m[1], "r") ?? next);
      if (!Number.isInteger(r) || r < next) continue; // out-of-order rows are not valid OOXML; skip rather than reorder
      while (next < r) emit(new Array(width).fill(""), next++);
      const cells: string[] = new Array(width).fill("");
      let col = 0;
      for (const c of (m[2] ?? "").matchAll(cellRe)) {
        const ref = attr(c[1], "r"), at = ref ? decodeRef(ref)?.c ?? col : col; col = at + 1;
        const i = at - size.firstCol;
        if (i < 0 || i >= width) continue;
        const value = cellText(c[1], c[2] ?? "", r, at);
        cells[i] = value.length > MAX_CELL ? value.slice(0, MAX_CELL) : value;
      }
      emit(cells, r); next = r + 1;
    }
    buffer = buffer.slice(consumed);
    // Keep only from the start of an unfinished row; stop after the sheet data.
    if (buffer.includes("</sheetData>")) { done = true; break; }
    const open = buffer.indexOf("<row"); buffer = open >= 0 ? buffer.slice(open) : buffer.slice(-16);
  }
  if (!done && buffer.includes("<row")) throw new StudioError(msg("sheet.stream.theSheetEndedPart"));
  return { rows: index, issueCount, firstRow: size.firstRow, firstCol: size.firstCol, width, wider: size.lastCol - size.firstCol + 1 > MAX_COLUMNS };
}
/** A preview grid of the first rows of a large sheet; the import streams the rest. */
export async function sampleSheet(bytes: Uint8Array, sheet: string, limit = 400): Promise<Grid & { streamed: { totalRows: number } }> {
  const size = await sheetSize(bytes, sheet);
  if (!size) throw new StudioError(msg("sheet.stream.thisSheetDoesNot"));
  const rows: string[][] = [], rowNumbers: number[] = [], issues: StudioIssue[] = [];
  try { await streamSheet(bytes, sheet, (cells, row) => { rows.push(cells); rowNumbers.push(row); if (rows.length >= limit) throw new Stop(); }, issues); }
  catch (error) { if (!(error instanceof Stop)) throw error; }
  const notices = [msg("sheet.stream.thisSheetHasAbout", { value: size.lastRow - size.firstRow + 1 })];
  if (size.lastCol - size.firstCol + 1 > MAX_COLUMNS) notices.push(msg("sheet.stream.onlyTheFirstColumns", { maxcolumns: MAX_COLUMNS }));
  return { rows, rowNumbers, colOffset: size.firstCol, merged: false, notices, issues, keyed: false, streamed: { totalRows: size.lastRow - size.firstRow + 1 } };
}
