// Text exports (CSV/TSV/TXT): encoding detection, chunked decoding and a streaming
// RFC 4180 tokenizer. Never holds a whole large file as one string or row array.
import { DELIMITERS, StudioError, type Delimiter, type Encoding } from "./formats";
import { msg } from "../i18n/core";
export const MAX_COLUMNS = 256, MAX_CELL = 4000, CHUNK_BYTES = 4 * 1024 * 1024;

export function detectEncoding(head: Uint8Array): { encoding: Encoding; bom: number } {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { encoding: "utf-8", bom: 3 };
  if (head[0] === 0xff && head[1] === 0xfe) return { encoding: "utf-16le", bom: 2 };
  if (head[0] === 0xfe && head[1] === 0xff) return { encoding: "utf-16be", bom: 2 };
  const n = Math.min(head.length, 4096);
  let even = 0, odd = 0;
  for (let i = 0; i < n; i++) if (head[i] === 0) i % 2 ? odd++ : even++;
  if (n >= 16 && odd > n / 8 && even < n / 64) return { encoding: "utf-16le", bom: 0 };
  if (n >= 16 && even > n / 8 && odd < n / 64) return { encoding: "utf-16be", bom: 0 };
  // stream:true buffers an incomplete trailing sequence instead of failing on it.
  try { new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true }); return { encoding: "utf-8", bom: 0 }; }
  catch { return { encoding: "windows-1252", bom: 0 }; }
}
export function bomLength(head: Uint8Array, encoding: Encoding) {
  if (encoding === "utf-8") return head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  if (encoding === "utf-16le") return head[0] === 0xff && head[1] === 0xfe ? 2 : 0;
  if (encoding === "utf-16be") return head[0] === 0xfe && head[1] === 0xff ? 2 : 0;
  return 0;
}
/** Decode a Blob in bounded chunks; multi-byte characters split across chunks are kept whole. */
export async function* decodeChunks(file: Blob, encoding: Encoding, signal?: AbortSignal, limit = Infinity) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const decoder = new TextDecoder(encoding, { fatal: encoding !== "windows-1252" });
  const end = Math.min(file.size, limit);
  try {
    for (let at = bomLength(head, encoding); at < end; at += CHUNK_BYTES) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(await file.slice(at, Math.min(end, at + CHUNK_BYTES)).arrayBuffer());
      const text = decoder.decode(bytes, { stream: at + CHUNK_BYTES < end });
      if (text) yield { text, bytes: Math.min(end, at + CHUNK_BYTES) };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TypeError) throw new StudioError(msg("issue.text.theFileIsNot", { encoding: encoding.toUpperCase() }));
    throw error;
  }
}
/** cut: indexes of cells truncated at MAX_CELL; oversized is also true when the row had too many columns. */
export type RowSink = (cells: string[], record: number, oversized: boolean, cut: number[]) => void;
/**
 * Streaming CSV tokenizer. `record` is the 1-based record number; blank lines count
 * as records so numbers match an editor's line numbers when no field spans lines.
 */
export class CsvTokenizer {
  private row: string[] = []; private field = ""; private inQuotes = false; private quoteSeen = false;
  private pendingCR = false; private oversized = false; private wide = false; private cut: number[] = []; private record = 1; private started = false;
  constructor(private delimiter: Delimiter, private sink: RowSink) {}
  push(text: string) {
    const d = this.delimiter.charCodeAt(0), n = text.length;
    let i = 0;
    if (this.pendingCR) { this.pendingCR = false; if (text.charCodeAt(0) === 10) i = 1; }
    while (i < n) {
      if (this.inQuotes) {
        const q = text.indexOf('"', i);
        if (q < 0) { this.append(text.slice(i)); return; }
        this.append(text.slice(i, q));
        if (q + 1 >= n) { this.quoteSeen = true; this.inQuotes = false; return; } // decided by next chunk
        if (text.charCodeAt(q + 1) === 34) { this.append('"'); i = q + 2; continue; }
        this.inQuotes = false; i = q + 1; continue;
      }
      if (this.quoteSeen) {
        this.quoteSeen = false;
        if (text.charCodeAt(i) === 34) { this.append('"'); this.inQuotes = true; i++; continue; } // escaped quote across chunks
      }
      let j = i;
      while (j < n) { const c = text.charCodeAt(j); if (c === d || c === 10 || c === 13 || (c === 34 && !this.started && j === i)) break; j++; }
      if (j > i) { this.append(text.slice(i, j)); this.started = true; }
      if (j >= n) return;
      const c = text.charCodeAt(j);
      if (c === 34) { this.inQuotes = true; this.started = true; i = j + 1; continue; }
      if (c === d) { this.endField(); i = j + 1; continue; }
      this.endField(); this.endRow();
      if (c === 13) { if (j + 1 >= n) { this.pendingCR = true; return; } i = text.charCodeAt(j + 1) === 10 ? j + 2 : j + 1; }
      else i = j + 1;
    }
  }
  end() { this.quoteSeen = false; if (this.started || this.row.length) { this.endField(); this.endRow(); } }
  private append(s: string) {
    if (this.field.length + s.length > MAX_CELL) { this.oversized = true; if (this.cut.at(-1) !== this.row.length) this.cut.push(this.row.length); this.field += s.slice(0, Math.max(0, MAX_CELL - this.field.length)); }
    else this.field += s;
  }
  private endField() {
    if (this.row.length >= MAX_COLUMNS) { this.oversized = true; this.wide = true; } else this.row.push(this.field);
    this.field = ""; this.started = false;
  }
  private endRow() {
    const blank = this.row.length === 1 && this.row[0] === "";
    // A row with too many columns reports no cut list: it is always rejected.
    this.sink(blank ? [] : this.row, this.record, this.oversized, this.wide ? [] : this.cut);
    this.row = []; this.oversized = false; this.wide = false; this.cut = []; this.record++;
  }
}
/** Tokenize a small decoded sample completely (bounded by `maxRows`). */
export function sampleRows(text: string, delimiter: Delimiter, maxRows = 200) {
  const rows: string[][] = [];
  const t = new CsvTokenizer(delimiter, cells => { if (rows.length < maxRows) rows.push(cells); });
  t.push(text); t.end();
  return rows;
}
/** Pick the delimiter that gives the most consistent multi-column rows in the sample. */
export function detectDelimiter(text: string, preferred?: Delimiter): Delimiter {
  let best: Delimiter = preferred || ",", bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = new Map<number, number>();
    for (const row of sampleRows(text, d, 100)) if (row.length > 1) counts.set(row.length, (counts.get(row.length) || 0) + 1);
    let mode = 0, freq = 0;
    for (const [cols, n] of counts) if (n > freq || (n === freq && cols > mode)) { mode = cols; freq = n; }
    const score = freq * Math.min(mode, 50) + (d === preferred ? 0.5 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
