// Chunk 7F-2: text-based PDF tables (blueprint section 9: "Table extraction (pdf.js), with preview and manual
// correction"). pdf.js is bundled into the vault worker (legacy build, its own worker module run in the same thread),
// never loaded from a CDN, with eval, font loading, scripting and every fetch switched off. Only the PDF's text layer
// is read: a scanned PDF has none and is refused (no OCR). Text runs become positioned lines in points; the shared
// layout module (lib/studio/layout.ts) finds the columns, and the user can correct them in the preview. This module is
// imported on demand, so pdf.js loads only when a PDF is added (scripts/build-spike.mjs splits it into its own chunk).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { StudioError } from "./formats";
import { MAX_SHEET_ROWS } from "./sheets";
import type { Line, Segment } from "./layout";
import { msg } from "../i18n/core";

export const MAX_PDF_PAGES = 500;
/**
 * pdf.js's worker module, loaded once. Evaluated inside a Web Worker it would take over that worker's message port (it
 * starts listening and posts "ready" to the page, which would reach the vault client). Defining 'window' only while the
 * module is evaluated makes it register its handler for in-thread use instead, as on a normal page.
 */
let workerModule: Promise<unknown> | null = null;
function loadPdfWorker() {
  return workerModule ??= (async () => {
    const g = globalThis as { window?: unknown }, had = Object.prototype.hasOwnProperty.call(g, "window");
    if (!had) g.window = g;
    try { return await import("pdfjs-dist/legacy/build/pdf.worker.mjs"); } finally { if (!had) delete g.window; }
  })();
}
type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Positioned text lines of every page, top to bottom. Lines are numbered 1, 2, 3... across the document. */
export async function pdfLines(bytes: Uint8Array, signal?: AbortSignal): Promise<{ lines: Line[]; pages: number; empty: number[] }> {
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await loadPdfWorker(); // run pdf.js's worker code here, no extra Worker
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, disableStream: true,
    disableRange: true, enableXfa: false, isOffscreenCanvasSupported: false, stopAtErrors: false, verbosity: 0, useWorkerFetch: false, standardFontDataUrl: undefined, cMapUrl: undefined, wasmUrl: undefined } as Parameters<typeof pdfjs.getDocument>[0]);
  let doc: Awaited<typeof task.promise>;
  try { doc = await task.promise; }
  catch (error) {
    await task.destroy().catch(() => undefined);
    if ((error as { name?: string })?.name === "PasswordException") throw new StudioError(msg("pdf.password"));
    throw new StudioError(msg("pdf.unreadable"));
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new StudioError(msg("pdf.tooManyPages", { max: MAX_PDF_PAGES }));
    const lines: Line[] = [], empty: number[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const before = lines.length;
      signal?.throwIfAborted();
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      page.cleanup();
      const items = (content.items as TextItem[]).filter(i => typeof i.str === "string" && i.str.trim() && Array.isArray(i.transform))
        .map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5], w: Math.max(0, i.width), h: Math.abs(i.transform[3]) || i.height || 10 }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      let current: { y: number; h: number; segments: Segment[] } | null = null;
      const flush = () => { if (current) { lines.push({ row: lines.length + 1, segments: current.segments.sort((a, b) => a.x0 - b.x0) }); current = null; } };
      for (const i of items) {
        if (!current || Math.abs(current.y - i.y) > Math.max(2, Math.min(current.h, i.h) * 0.5)) { flush(); current = { y: i.y, h: i.h, segments: [] }; }
        current.segments.push({ x0: i.x, x1: i.x + i.w, text: i.text });
      }
      flush();
      if (lines.length === before) empty.push(p); // a page with no text layer (a scanned page): reported, never silently dropped
      if (lines.length > MAX_SHEET_ROWS) throw new StudioError(msg("pdf.tooManyLines", { max: MAX_SHEET_ROWS }));
    }
    if (!lines.length) throw new StudioError(msg("pdf.noText"));
    return { lines, pages: doc.numPages, empty };
  } finally { await task.destroy().catch(() => undefined); }
}
