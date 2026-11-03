// Row pipeline shared by every format: preamble -> header block -> data rows.
// Blank, total and footer rows are skipped; malformed rows are rejected with a
// location. Writers emit clean UTF-8 CSV as Blob parts, never one giant string.
import { csvSafeCell } from "../csv";
import { classifyRow, headerNames, type Settings, type StudioIssue } from "./formats";
import { CsvTokenizer, decodeChunks } from "./text";
import type { Grid } from "./sheets";
export const MAX_STORED_ISSUES = 10_000;
export type Stats = { read: number; skipped: number; rejected: number; issues: StudioIssue[]; issueCount: number; rejectedRows: number[] };
export const emptyStats = (): Stats => ({ read: 0, skipped: 0, rejected: 0, issues: [], issueCount: 0, rejectedRows: [] });
export function addIssue(stats: Stats, issue: StudioIssue) { stats.issueCount++; if (stats.issues.length < MAX_STORED_ISSUES) stats.issues.push(issue); }
type DataSink = (cells: string[], row: number) => void;
/** Feed raw records in order; emits headers once, then aligned data rows. */
export class Normalizer {
  headers: string[] | null = null;
  private block: string[][] = [];
  constructor(private settings: Pick<Settings, "headerRow" | "headerDepth">, private onData: DataSink, public stats: Stats = emptyStats(), private letter: (index: number) => string = String) {}
  accept(cells: string[], row: number, index: number, oversized = false) {
    const { headerRow, headerDepth } = this.settings;
    if (!this.headers) {
      if (index < headerRow - headerDepth + 1) return; // preamble above the header block
      this.block.push(cells);
      if (index === headerRow) { this.headers = headerNames(this.block, this.block.length - 1, this.block.length); this.block = []; }
      return;
    }
    const width = this.headers.length, verdict = classifyRow(cells, width);
    if (verdict !== "data") { this.stats.skipped++; return; }
    this.stats.read++;
    if (oversized) { this.reject(row); addIssue(this.stats, { row, column: "", message: "A cell is longer than 4,000 characters or the row has more than 256 columns. The row was not loaded." }); return; }
    if (cells.length > width && cells.slice(width).some(v => v !== "")) { this.reject(row); addIssue(this.stats, { row, column: this.letter(width), message: "The row has more values than there are column headers. The row was not loaded." }); return; }
    const out = cells.length === width ? cells : cells.length > width ? cells.slice(0, width) : [...cells, ...new Array(width - cells.length).fill("")];
    this.onData(out.map(v => v.trim()), row);
  }
  private reject(row: number) { this.stats.rejected++; if (this.stats.rejectedRows.length < MAX_STORED_ISSUES) this.stats.rejectedRows.push(row); }
}
export async function streamText(file: Blob, settings: Settings, normalizer: Normalizer, signal?: AbortSignal, progress?: (bytes: number) => void) {
  let index = 0;
  const tokenizer = new CsvTokenizer(settings.delimiter, (cells, record, oversized) => { normalizer.accept(cells, record, index++, oversized); });
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
