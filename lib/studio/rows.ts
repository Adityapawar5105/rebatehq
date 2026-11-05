// Row pipeline shared by every format: preamble -> header block -> data rows.
// Blank, total and footer rows are skipped; malformed rows are rejected with a
// location. Writers emit clean UTF-8 CSV as Blob parts, never one giant string.
import { csvSafeCell } from "../csv";
import { FOOTER, TOTAL, classifyRow, headerNames, type Settings, type StudioIssue } from "./formats";
import { CsvTokenizer, decodeChunks } from "./text";
import type { Grid } from "./sheets";
import { msg } from "../i18n/core";
export const MAX_STORED_ISSUES = 10_000;
export type Stats = { read: number; skipped: number; rejected: number; issues: StudioIssue[]; issueCount: number; rejectedRows: number[] };
export const emptyStats = (): Stats => ({ read: 0, skipped: 0, rejected: 0, issues: [], issueCount: 0, rejectedRows: [] });
export function addIssue(stats: Stats, issue: StudioIssue) { stats.issueCount++; if (stats.issues.length < MAX_STORED_ISSUES) stats.issues.push(issue); }
type DataSink = (cells: string[], row: number) => void;
const UNNAMED = /^Column [A-Z]+$/;
/**
 * Leading unnamed columns that hold report section headings (QuickBooks "Sales by Item
 * Detail" puts the item, its group and type in rows of their own above the lines). A row
 * that fills exactly one such column and nothing else is a heading: its value is copied
 * into that column of the rows below until the next heading at that level or above.
 */
export function headingColumns(headers: string[]) {
  let lead = 0; while (lead < headers.length && UNNAMED.test(headers[lead])) lead++;
  return lead < headers.length ? lead : 0;
}
/** A heading row's level (column index), or null when the row is not a heading. */
export function headingLevel(cells: string[], lead: number) {
  if (!lead || cells.slice(lead).some(v => v.trim() !== "")) return null;
  const filled = cells.slice(0, lead).flatMap((v, i) => v.trim() ? [i] : []);
  if (filled.length !== 1) return null;
  const v = cells[filled[0]].trim();
  return TOTAL.test(v) || FOOTER.test(v) ? null : filled[0];
}
/** Feed raw records in order; emits headers once, then aligned data rows. */
export class Normalizer {
  headers: string[] | null = null;
  /** Section-heading rows copied down (counted in stats.skipped too). */
  headings = 0;
  private block: string[][] = [];
  private lead = 0;
  private carry: string[] = [];
  /** Rows whose only problem is a long cell in an unused column (an embedded image, a long note). */
  longCellsIgnored = 0;
  /**
   * allowLong: whether a row may load although these cells were cut at 4,000 characters.
   * The import passes "none of them is mapped"; the clean-CSV download never allows it.
   */
  constructor(private settings: Pick<Settings, "headerRow" | "headerDepth">, private onData: DataSink, public stats: Stats = emptyStats(), private letter: (index: number) => string = String, private allowLong: (cut: number[]) => boolean = () => false) {}
  accept(cells: string[], row: number, index: number, oversized = false, cut: number[] = []) {
    const { headerRow, headerDepth } = this.settings;
    if (!this.headers) {
      if (headerRow < 0) this.headers = headerNames([cells], headerRow, 1); // no header row: this row is data
      else {
        if (index < headerRow - headerDepth + 1) return; // preamble above the header block
        this.block.push(cells);
        if (index === headerRow) { this.headers = headerNames(this.block, this.block.length - 1, this.block.length); this.block = []; this.lead = headingColumns(this.headers); }
        return;
      }
    }
    // Blank and footer rows are classified first so carried headings never fill them in.
    const early = classifyRow(cells, this.headers.length);
    if (early === "blank" || early === "footer") { this.stats.skipped++; return; }
    if (this.lead) {
      const level = headingLevel(cells, this.lead);
      if (level !== null) { this.carry[level] = cells[level].trim(); this.carry.length = level + 1; this.headings++; this.stats.skipped++; return; }
      if (cells.slice(0, this.lead).some(v => TOTAL.test(v.trim()))) { this.stats.skipped++; return; }
      if (this.carry.length) { cells = [...cells]; for (let i = 0; i < this.lead; i++) if (!cells[i]?.trim() && this.carry[i]) cells[i] = this.carry[i]; }
    }
    const width = this.headers.length, verdict = classifyRow(cells, width);
    if (verdict !== "data") { this.stats.skipped++; return; }
    this.stats.read++;
    if (oversized && cut.length && this.allowLong(cut)) { this.longCellsIgnored++; oversized = false; }
    if (oversized) { this.reject(row); addIssue(this.stats, { row, column: "", message: msg("issue.row.aCellIsLonger") }); return; }
    if (cells.length > width && cells.slice(width).some(v => v !== "")) { this.reject(row); addIssue(this.stats, { row, column: this.letter(width), message: msg("issue.row.theRowHasMore") }); return; }
    const out = cells.length === width ? cells : cells.length > width ? cells.slice(0, width) : [...cells, ...new Array(width - cells.length).fill("")];
    this.onData(out.map(v => v.trim()), row);
  }
  private reject(row: number) { this.stats.rejected++; if (this.stats.rejectedRows.length < MAX_STORED_ISSUES) this.stats.rejectedRows.push(row); }
}
export async function streamText(file: Blob, settings: Settings, normalizer: Normalizer, signal?: AbortSignal, progress?: (bytes: number) => void) {
  let index = 0;
  const tokenizer = new CsvTokenizer(settings.delimiter, (cells, record, oversized, cut) => { normalizer.accept(cells, record, index++, oversized, cut); });
  for await (const { text, bytes } of decodeChunks(file, settings.encoding, signal)) { tokenizer.push(text); progress?.(bytes); }
  tokenizer.end();
}
export function streamGrid(grid: Grid, normalizer: Normalizer, signal?: AbortSignal) {
  for (let i = 0; i < grid.rows.length; i++) { if (i % 10000 === 0) signal?.throwIfAborted(); normalizer.accept(grid.rows[i], grid.rowNumbers[i], i); }
}
const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
/**
 * internal: `__md_row` + c0..cN, values verbatim (read by DuckDB as VARCHAR).
 * download: real header names, formula-neutralised cells, CRLF, no row column.
 */
export class CsvWriter {
  private parts: Blob[] = []; private buffer: string[] = []; private size = 0; rows = 0;
  constructor(private mode: "internal" | "download") {}
  header(names: string[]) { this.push(this.mode === "internal" ? ["__md_row", ...names.map((_, i) => `c${i}`)].map(quote).join(",") : names.map(v => quote(csvSafeCell(v))).join(",")); }
  row(cells: string[], row: number) { this.rows++; this.push(this.mode === "internal" ? `"${row}",${cells.map(quote).join(",")}` : cells.map(v => quote(csvSafeCell(v))).join(",")); }
  private push(line: string) {
    this.buffer.push(line); this.size += line.length;
    if (this.size > 1 << 20) this.flush();
  }
  private flush() { if (this.buffer.length) { this.parts.push(new Blob([this.buffer.join(this.mode === "internal" ? "\n" : "\r\n") + (this.mode === "internal" ? "\n" : "\r\n")])); this.buffer = []; this.size = 0; } }
  blob() { this.flush(); return new Blob(this.parts, { type: "text/csv;charset=utf-8" }); }
}
