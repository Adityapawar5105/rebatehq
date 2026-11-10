// Chunk 7F-2 (blueprint section 9, converter table): column boundaries for fixed-width print reports and text-based
// PDF tables. Both are lines of positioned text: characters for fixed-width files, points for PDF text runs. A position
// that is blank in nearly every line is a gap between columns; each run of such gaps becomes one boundary at its
// middle. Boundaries are plain integers so the user can see and correct them in the preview. Pure functions only.
import { StudioError } from "./formats";
import type { Grid } from "./sheets";
import { msg } from "../i18n/core";

/** A piece of text on a line, from x0 (inclusive) to x1 (exclusive), in the line's units. */
export type Segment = { x0: number; x1: number; text: string };
/** A line of positioned text; `row` is where it came from (file line number, or PDF page * 10000 + line). */
export type Line = { row: number; segments: Segment[] };
/** At most this many columns, like delimited text (lib/studio/text.ts MAX_COLUMNS). */
export const MAX_BOUNDARIES = 255, MAX_POSITION = 100_000;
/** A gap is a column break when at most this share of the lines covers it. */
export const GAP_SHARE = 0.1;

/** Segments of one fixed-width line: runs of non-space characters (tabs count as one blank each). */
export function fixedSegments(line: string): Segment[] {
  const out: Segment[] = [];
  for (const m of line.matchAll(/[^ \t]+/g)) out.push({ x0: m.index!, x1: m.index! + m[0].length, text: m[0] });
  return out;
}
/** Pieces of a line separated by at least `gap` blank units (words of one cell stay together). */
export function chunkCount(line: Line, gap: number) {
  let n = 0, end = -Infinity;
  for (const s of [...line.segments].sort((a, b) => a.x0 - b.x0)) { if (s.x0 - end >= gap) n++; end = Math.max(end, s.x1); }
  return n;
}
/**
 * Detect boundaries from coverage. `minGap` is the narrowest blank run that separates columns (1 character for
 * fixed-width text; a few points for PDF text, where word spacing inside a cell is narrower than a column gap).
 * Only typical table lines count: titles, totals and page footers have far fewer pieces than the table's rows (pieces
 * are text separated by at least `chunkGap`), and would otherwise cover the gaps between columns.
 */
export function detectBoundaries(lines: Line[], minGap = 1, chunkGap = Math.max(2, minGap)): number[] {
  const filled = lines.filter(l => l.segments.length);
  if (!filled.length) return [];
  const counts = filled.map(l => chunkCount(l, chunkGap)), multi = counts.filter(c => c >= 2).sort((a, b) => a - b);
  const typical = multi.length ? multi[Math.floor(multi.length / 2)] : 1;
  const used = filled.filter((_, i) => counts[i] >= Math.max(2, Math.ceil(typical * 0.6)));
  if (!used.length) return [];
  let width = 0;
  for (const l of used) for (const s of l.segments) width = Math.max(width, Math.min(MAX_POSITION, Math.ceil(s.x1)));
  const cover = new Uint32Array(width + 1);
  for (const l of used) {
    // Count each position once per line, however many segments overlap it.
    const marks = new Uint8Array(width + 1);
    for (const s of l.segments) for (let p = Math.max(0, Math.floor(s.x0)); p < Math.min(width, Math.ceil(s.x1)); p++) marks[p] = 1;
    for (let p = 0; p < width; p++) cover[p] += marks[p];
  }
  const limit = Math.floor(used.length * GAP_SHARE);
  let first = 0; while (first < width && cover[first] <= limit) first++;
  let last = width - 1; while (last > first && cover[last] <= limit) last--;
  const out: number[] = [];
  for (let p = first; p <= last; p++) {
    if (cover[p] > limit) continue;
    let q = p; while (q + 1 <= last && cover[q + 1] <= limit) q++;
    if (q - p + 1 >= minGap) out.push(Math.floor((p + q + 1) / 2));
    p = q;
  }
  return out.slice(0, MAX_BOUNDARIES);
}
/** Validate user-entered boundaries: whole numbers, strictly increasing, within limits. */
export function checkBoundaries(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_BOUNDARIES || !value.every(v => Number.isInteger(v) && v > 0 && v <= MAX_POSITION)) throw new StudioError(msg("layout.invalidBoundaries", { max: MAX_BOUNDARIES }));
  for (let i = 1; i < value.length; i++) if (value[i] <= value[i - 1]) throw new StudioError(msg("layout.invalidBoundaries", { max: MAX_BOUNDARIES }));
  return value as number[];
}
/** Parse "8, 20, 31" from the preview's boundary field. */
export function parseBoundaries(text: string): number[] {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.every(p => /^\d{1,6}$/.test(p))) throw new StudioError(msg("layout.invalidBoundaries", { max: MAX_BOUNDARIES }));
  return checkBoundaries(parts.map(Number));
}
/** Cells of a fixed-width line: the raw text between boundaries, trimmed. */
export function sliceFixed(line: string, boundaries: number[]): string[] {
  const cuts = [0, ...boundaries, Number.MAX_SAFE_INTEGER];
  const cells: string[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) cells.push(line.slice(cuts[i], cuts[i + 1]).trim());
  while (cells.length > 1 && cells.at(-1) === "") cells.pop();
  return cells.every(c => c === "") ? [] : cells;
}
/** Cells of a PDF line: each text run goes to the column holding its centre; runs in one column join with a space. */
export function placeSegments(line: Line, boundaries: number[]): string[] {
  const cells: string[][] = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const s of [...line.segments].sort((a, b) => a.x0 - b.x0)) {
    const mid = (s.x0 + s.x1) / 2;
    let c = 0; while (c < boundaries.length && mid >= boundaries[c]) c++;
    cells[c].push(s.text.trim());
  }
  const out = cells.map(parts => parts.filter(Boolean).join(" "));
  while (out.length > 1 && out.at(-1) === "") out.pop();
  return out.every(c => c === "") ? [] : out;
}

/** Narrowest blank band (points) that separates two PDF columns; word spacing inside a cell is narrower. */
export const PDF_MIN_GAP = 4;
/** The grid of a PDF at the given boundaries (points). Blank lines are left to the row pipeline to skip. */
export function pdfGrid(lines: Line[], boundaries: number[], pages: number, empty: number[] = []): Grid {
  return { rows: lines.map(l => placeSegments(l, boundaries)), rowNumbers: lines.map(l => l.row), colOffset: 0, merged: false, keyed: false, issues: [],
    notices: [msg("pdf.read", { pages, lines: lines.length }), ...(empty.length ? [msg("pdf.pagesSkipped", { count: empty.length, pages: empty.slice(0, 20).join(", ") + (empty.length > 20 ? "…" : "") })] : [])] };
}
