// Chunk 7F-2: Phase 2 converters (fixed-width print reports, text-based PDF tables, Parquet) and folder re-import.
// Every fixture is synthetic and built here; the expected rows are written out by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { Studio, fileFingerprint, loadRecipes, recipeSql } from "../lib/studio/studio";
import { detectBoundaries, fixedSegments, sliceFixed, placeSegments, parseBoundaries, checkBoundaries, chunkCount, PDF_MIN_GAP } from "../lib/studio/layout";
import { FixedTokenizer, detectLayout, sampleFixed } from "../lib/studio/text";
import { classifyRow, kindOf, StudioError } from "../lib/studio/formats";
import { parquetGrid, readParquet, type ParquetTable } from "../lib/studio/parquet";
import { pdfLines } from "../lib/studio/pdf";
import { makePdf, tablePage } from "./helpers/pdf";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";

const never = new AbortController().signal;
/** Save a recipe the way the app does: the mapping is confirmed first. */
async function recipeOf(studio: Studio, id: string, name: string) { await studio.update(id, { confirmed: true }); return studio.recipeFor(id, name); }
/** Rows of the clean CSV the studio writes for a file (the whole row pipeline: header, skips, trimming). */
async function cleanRows(studio: Studio, id: string) {
  const out = await studio.download(id, never), text = await out.blob.text();
  return { rows: text.trim().split(/\r?\n/).map(l => l.split(",").map(v => v.replace(/^"|"$/g, "").replaceAll('""', '"'))), rejected: out.rejected };
}

// A print-to-file sales report: a title, a header, a page break with the header repeated, a total and page footers.
const fx = (c: string[]) => c[0].padEnd(9) + c[1].padEnd(12) + c[2].padEnd(13) + c[3].padEnd(12) + c[4].padStart(8) + "  " + c[5].padStart(11) + "  " + c[6].padStart(11);
const HEAD = ["line_id", "product_id", "customer_id", "sale_date", "quantity", "list_amount", "cost_amount"];
const REPORT = [
  "SALES BY ITEM REPORT                                   Page 1", "",
  fx(HEAD),
  fx(["1", "P-100", "C-1", "2026-01-05", "2", "200.00", "120.00"]),
  fx(["2", "P-200", "C-2", "2026-01-06", "10", "1250.50", "900.00"]),
  "Printed 2026-02-01                                     Page 1", "",
  fx(HEAD),
  fx(["3", "P-100", "C-3", "2026-01-07", "1", "100.00", "60.00"]),
  "Total" + " ".repeat(41) + "13".padStart(8) + "  " + "1550.50".padStart(11),
  "Printed 2026-02-01                                     Page 2",
].join("\r\n") + "\r\n";

test("7F-2 layout: boundaries from aligned gaps, typical lines only, slicing and manual input", () => {
  const lines = REPORT.split("\r\n").map((l, i) => ({ row: i + 1, segments: fixedSegments(l) }));
  // Title, total and footers have 2-3 pieces against the table's 7, so only the table rows count.
  assert.deepEqual(lines.map(l => chunkCount(l, 2)).filter(Boolean), [2, 7, 7, 7, 2, 7, 7, 3, 2]);
  const b = detectBoundaries(lines, 1);
  // Columns start at 0, 9, 21, 34, 46 (quantity, right-aligned to 53), 56 (list, right-aligned to 66) and 69 (cost); each
  // boundary is the middle of the blank run before a column in every table line (cost: blanks 67-68, boundary 68).
  assert.deepEqual(b, [8, 20, 33, 45, 55, 68]);
  assert.deepEqual(sliceFixed(fx(["2", "P-200", "C-2", "2026-01-06", "10", "1250.50", "900.00"]), b), ["2", "P-200", "C-2", "2026-01-06", "10", "1250.50", "900.00"]);
  assert.deepEqual(sliceFixed("", b), []); assert.deepEqual(sliceFixed("   ", b), []);
  assert.deepEqual(sliceFixed("A        B", [8]), ["A", "B"]);
  assert.deepEqual(parseBoundaries(" 8, 20 ;33  45"), [8, 20, 33, 45]);
  for (const bad of ["8,8", "20,8", "a", "-1", "0", "1.5", "8,,x"]) assert.throws(() => parseBoundaries(bad), StudioError, bad);
  assert.throws(() => checkBoundaries(Array.from({ length: 256 }, (_, i) => i + 1)), StudioError);
  assert.throws(() => checkBoundaries([100_001]), StudioError); assert.throws(() => checkBoundaries("8,20"), StudioError);
  // PDF runs go to the column holding their centre; two runs in one column join with a space.
  assert.deepEqual(placeSegments({ row: 1, segments: [{ x0: 150, x1: 180, text: "Brass" }, { x0: 50, x1: 80, text: "P-1" }, { x0: 183, x1: 200, text: "valve" }, { x0: 330, x1: 350, text: "12.50" }] }, [120, 300]), ["P-1", "Brass valve", "12.50"]);
  assert.deepEqual(detectBoundaries([], 1), []);
});

test("7F-2 fixed-width: detection, streaming across chunks, repeated headers, totals and page footers skipped", async () => {
  assert.equal(kindOf("REPORT.PRN"), "prn"); assert.equal(kindOf("x.parquet"), "parquet"); assert.equal(kindOf("x.pdf"), "pdf");
  assert.deepEqual(detectLayout(REPORT, ",", false), { layout: "fixed", boundaries: [8, 20, 33, 45, 55, 68] });
  assert.equal(detectLayout("a,b,c\n1,2,3\n4,5,6\n", ",").layout, "delimited", "a CSV stays delimited");
  assert.equal(detectLayout("a b\n", ",").layout, "delimited", "too little to tell");
  // The tokenizer keeps lines whole across chunk edges, including a CRLF split between chunks.
  const got: string[][] = [], t = new FixedTokenizer([3], (cells, rec, over) => { got.push([String(rec), String(over), ...cells]); });
  for (const piece of ["ab", "c de\r", "\nfgh ij\rkl", "m  n"]) t.push(piece);
  t.end();
  assert.deepEqual(got, [["1", "false", "abc", "de"], ["2", "false", "fgh", "ij"], ["3", "false", "klm", "n"]]);
  const long: boolean[] = [], lt = new FixedTokenizer([2], (_c, _r, over) => long.push(over)); lt.push("x".repeat(70_000) + "\n"); lt.end();
  assert.deepEqual(long, [true], "an over-long line is cut and rejected, never held whole");
  assert.deepEqual(sampleFixed("aa  bb\n", [3]), [["aa", "bb"]]);
  // Footers cut by the boundaries are recognised: two or three cells (at most half the columns), with "Page n" or "Printed".
  assert.equal(classifyRow(["Printed 2026-02-01", "", "", "", "Page 2"], 7), "footer");
  assert.equal(classifyRow(["Printed", "2026-02-01", "", "", "", "Page 2", ""], 7), "footer");
  assert.equal(classifyRow(["P-1", "Page 2", "x", "y"], 4), "data", "more than half the columns filled is data");
  assert.equal(classifyRow(["P-1", "Page 2"], 2), "data", "a two-column table keeps such rows");

  const studio = new Studio();
  await studio.add([new File([REPORT], "SALES BY ITEM.prn")], []);
  let view = studio.state([]).files[0];
  assert.equal(view.layout?.mode, "fixed"); assert.deepEqual(view.layout?.boundaries, [8, 20, 33, 45, 55, 68]);
  assert.equal(view.role, "sales_history"); assert.deepEqual(view.headers, HEAD);
  assert.ok(view.layout!.raw[2].startsWith("line_id  product_id"), "the ruler shows the raw lines");
  const clean = await cleanRows(studio, view.id);
  assert.deepEqual(clean.rows, [HEAD, ["1", "P-100", "C-1", "2026-01-05", "2", "200.00", "120.00"], ["2", "P-200", "C-2", "2026-01-06", "10", "1250.50", "900.00"], ["3", "P-100", "C-3", "2026-01-07", "1", "100.00", "60.00"]]);
  assert.equal(clean.rejected, "0");
  // Manual correction: one boundary too few merges two columns; "Detect again" restores them.
  await studio.update(view.id, { boundaries: [8, 20, 33, 55, 68] });
  view = studio.state([]).files[0];
  assert.equal(view.headers.length, 6); assert.match(view.headers[3], /^sale_date\s+quantity$/, view.headers.join("|"));
  await studio.update(view.id, { boundaries: null });
  assert.deepEqual(studio.state([]).files[0].layout?.boundaries, [8, 20, 33, 45, 55, 68]);
  await assert.rejects(studio.update(view.id, { boundaries: [20, 8] }), StudioError);
  // Switching to delimited and back.
  await studio.update(view.id, { layout: "delimited" });
  assert.equal(studio.state([]).files[0].layout?.mode, "delimited");
  await studio.update(view.id, { layout: "fixed" });
  assert.deepEqual(studio.state([]).files[0].layout?.boundaries, [8, 20, 33, 45, 55, 68]);
  // A recipe keeps the layout and boundaries and matches next month's report.
  const recipe = { id: "r1", ...(await recipeOf(studio, view.id, "Monthly print")) };
  assert.equal(recipe.settings.layout, "fixed"); assert.deepEqual(recipe.settings.boundaries, [8, 20, 33, 45, 55, 68]);
  const next = new Studio(); await next.add([new File([REPORT.replace("2026-01-05", "2026-02-05")], "february.prn")], [recipe]);
  assert.equal(next.state([]).files[0].appliedRecipe, "Monthly print");
  // A layout change on a spreadsheet or JSON file is refused.
  const json = new Studio(); await json.add([new File(['[{"product_id":"A"}]'], "items.json")], []);
  await assert.rejects(json.update(json.state([]).files[0].id, { layout: "fixed" }), StudioError);
});

const PRICE_HEAD = ["product_id", "description", "current_cost", "list_price"], XS = [50, 150, 320, 420];
const PRICES = makePdf([
  [[50, 770, "Item price list"], ...tablePage([PRICE_HEAD, ["P-100", "Brass valve 1/2 in", "12.50", "20.00"], ["P-200", "Steel pipe", "8.00", "13.25"]], XS), [280, 40, "Page 1 of 2"]],
  [...tablePage([PRICE_HEAD, ["P-300", "Gasket kit", "3.10", "5.00"]], XS), [50, 40, "Printed 2026-02-01"], [480, 40, "Page 2 of 2"]],
]);

test("7F-2 PDF tables: text runs to columns across pages, repeated headers and footers skipped, manual breaks", async () => {
  const read = await pdfLines(PRICES);
  assert.equal(read.pages, 2);
  assert.deepEqual(read.lines.map(l => l.segments.map(s => s.text).join("|")), ["Item price list", "product_id|description|current_cost|list_price", "P-100|Brass valve 1/2 in|12.50|20.00", "P-200|Steel pipe|8.00|13.25", "Page 1 of 2",
    "product_id|description|current_cost|list_price", "P-300|Gasket kit|3.10|5.00", "Printed 2026-02-01|Page 2 of 2"]);
  const b = detectBoundaries(read.lines, PDF_MIN_GAP);
  assert.equal(b.length, 3); assert.ok(b[0] > 100 && b[0] < 150 && b[1] > 230 && b[1] < 320 && b[2] > 370 && b[2] < 420, b.join(","));
  const studio = new Studio();
  await studio.add([new File([PRICES as BlobPart], "price list.pdf")], []);
  let view = studio.state([]).files[0];
  assert.equal(view.kind, "pdf"); assert.equal(view.layout?.mode, "pdf"); assert.equal(view.role, "item_master"); assert.deepEqual(view.headers, PRICE_HEAD);
  assert.ok(view.notices.some(n => n.startsWith("2 pages read, 8 lines of text")), view.notices.join(" / "));
  const clean = await cleanRows(studio, view.id);
  assert.deepEqual(clean.rows, [PRICE_HEAD, ["P-100", "Brass valve 1/2 in", "12.50", "20.00"], ["P-200", "Steel pipe", "8.00", "13.25"], ["P-300", "Gasket kit", "3.10", "5.00"]]);
  // Manual correction: a single break at 140 points gives two columns.
  await studio.update(view.id, { boundaries: [140] });
  view = studio.state([]).files[0];
  assert.deepEqual(view.headers, ["product_id", "description current_cost list_price"]);
  await assert.rejects(studio.update(view.id, { layout: "fixed" }), StudioError, "a PDF has no delimiter choice");
  await studio.update(view.id, { boundaries: null });
  assert.deepEqual(studio.state([]).files[0].headers, PRICE_HEAD);
  // A recipe saved from the PDF re-applies its breaks to next month's PDF.
  const recipe = { id: "r2", ...(await recipeOf(studio, view.id, "Supplier price PDF")) };
  const again = new Studio(); await again.add([new File([PRICES as BlobPart], "price list march.pdf")], [recipe]);
  assert.equal(again.state([]).files[0].appliedRecipe, "Supplier price PDF");
  // Scanned (no text), damaged and over-long PDFs are refused with a reason; never OCR.
  const empty = new Studio();
  await assert.rejects(empty.add([new File([makePdf([[]]) as BlobPart], "scan.pdf")], []), (e: unknown) => e instanceof StudioError && /no text to read.*does not use OCR/.test(e.message));
  await assert.rejects(empty.add([new File(["%PDF-1.4\nnot really a pdf"], "broken.pdf")], []), (e: unknown) => e instanceof StudioError && /could not be read/.test(e.message));
  await assert.rejects(empty.add([new File([new Uint8Array(0)], "zero.pdf")], []), StudioError);
});

test("7F-2 Parquet: DuckDB rows become a keyed grid; nulls, limits and reader failures", async () => {
  const table: ParquetTable = { columns: ["customer_id", "name", "tier"], rows: [["C-1", "North Supply", "T1"], ["C-2", null, "T2"]], total: 2 };
  const grid = parquetGrid(table);
  assert.equal(grid.keyed, true); assert.deepEqual(grid.rows, [["customer_id", "name", "tier"], ["C-1", "North Supply", "T1"], ["C-2", "", "T2"]]);
  assert.ok(grid.notices[0].startsWith("2 rows and 3 columns read with DuckDB"));
  assert.throws(() => parquetGrid({ columns: [], rows: [], total: 0 }), StudioError);
  assert.throws(() => parquetGrid({ columns: ["a"], rows: [], total: 300_001 }), /more than 300,000 rows/);
  assert.throws(() => parquetGrid({ columns: Array.from({ length: 257 }, (_, i) => "c" + i), rows: [], total: 1 }), StudioError);
  await assert.rejects(readParquet(undefined, new Uint8Array([1])), /could not start/);
  await assert.rejects(readParquet(async () => { throw new Error("Invalid Input Error: secret cell value"); }, new Uint8Array([1])), (e: unknown) => e instanceof StudioError && !e.message.includes("secret"));
  let limit = 0;
  const studio = new Studio();
  await studio.add([new File([new Uint8Array([80, 65, 82, 49])], "customers.parquet")], [], null, "USD", { parquet: async (_bytes, l) => { limit = l; return table; } });
  assert.equal(limit, 300_000);
  const view = studio.state([]).files[0];
  assert.equal(view.kind, "parquet"); assert.equal(view.role, "customer_list"); assert.equal(view.layout, null);
  assert.deepEqual((await cleanRows(studio, view.id)).rows, [["customer_id", "name", "tier"], ["C-1", "North Supply", "T1"], ["C-2", "", "T2"]]);
});

async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'starter','unit','tip',0);
INSERT INTO role_assignments VALUES('owner','Owner','owner','owner','2026-01-01'),('rep','Rep','sales_rep','owner','2026-01-01');`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) }, db: {} } as unknown as Engine };
}

test("7F-2 recipes keep layout and boundaries; malformed stored recipes are ignored", async () => {
  const { c, e } = await vault();
  try {
    const studio = new Studio(); await studio.add([new File([REPORT], "report.prn")], []);
    const r = await recipeOf(studio, studio.state([]).files[0].id, "Print");
    c.query(recipeSql(r));
    c.query(`INSERT INTO converter_recipes VALUES('bad1','Bad layout','x','${JSON.stringify({ ...r.settings, layout: "columns" })}','2026-01-01'),('bad2','Bad breaks','x','${JSON.stringify({ ...r.settings, boundaries: [9, 3] })}','2026-01-01')`);
    const loaded = await loadRecipes(e);
    assert.deepEqual(loaded.map(x => x.name), ["Print"]);
    assert.deepEqual(loaded[0].settings.boundaries, [8, 20, 33, 45, 55, 68]);
  } finally { c.close(); }
});

test("7F-2 folder re-import: only recipe matches are added; imported, unknown and unreadable files are listed", async () => {
  const { c, e } = await vault();
  try {
    const first = new Studio(); await first.add([new File([REPORT], "report.prn")], []);
    c.query(recipeSql(await recipeOf(first, first.state([]).files[0].id, "Print")));
    const imported = new File([REPORT], "january.prn"), fresh = new File([REPORT.replace("2026-01-05", "2026-02-05")], "february.prn");
    c.query(`INSERT INTO source_files VALUES('s1','january.prn','sales_history',1,'2026-02-01');
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at,fingerprint) VALUES('b1','s1',3,0,'2026-02-01','${await fileFingerprint(imported)}')`);
    const make = (userId: string) => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "test" }, writable: async () => e, save: async () => undefined, touch: () => undefined });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "test", device: "test", tier: "starter", state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown) => dispatch(s, { id: "x", action, data } as Request, { signal: () => never, progress: () => undefined }) as Promise<any>;
    const owner = make("owner");
    const out = await call(owner, "studioFolder", { files: [imported, fresh, new File(["a,b\n1,2\n"], "other.csv"), new File(["x"], "notes.docx"), new File(["%PDF-1.4 broken"], "scan.pdf")] });
    assert.deepEqual(out.folder.added, ["february.prn"]);
    assert.deepEqual(out.folder.skipped.map((s: { name: string; reason: string }) => [s.name, s.reason.split("⁣")[0]]), [
      ["january.prn", "already imported, unchanged"], ["notes.docx", "not a file type RebateHQ reads"], ["other.csv", "no saved recipe matches its columns"], ["scan.pdf", "This PDF could not be read."]]);
    assert.equal(out.files.length, 1); assert.equal(out.files[0].appliedRecipe, "Print");
    await assert.rejects(call(owner, "studioFolder", { files: ["not a file"] }), (x: unknown) => x instanceof VaultError && x.code === "FOLDER");
    await assert.rejects(call(make("rep"), "studioFolder", { files: [fresh] }), (x: unknown) => x instanceof VaultError && x.code === "FORBIDDEN");
    assert.equal(q(c, "SELECT count(*) AS n FROM sales_lines")[0].n, "0", "re-import only stages the batch; nothing loads until confirmed");
  } finally { c.close(); }
  for (const a of ["folderGet", "folderSet", "studioFolder"] as const) assert.equal(ACTION_CAP[a], "data");
  assert.ok(READ_ONLY_ACTIONS.has("folderGet") && READ_ONLY_ACTIONS.has("folderSet") && !READ_ONLY_ACTIONS.has("studioFolder"));
});

test("v2.6 gap 4: a partly scanned PDF keeps its text pages and names the pages without text; a scan names the alternatives", async () => {
  const pdf = makePdf([tablePage([PRICE_HEAD, ["P-1", "Valve", "1.00", "2.00"]], XS), [], tablePage([PRICE_HEAD, ["P-2", "Pipe", "3.00", "4.00"]], XS)]);
  const read = await pdfLines(pdf);
  assert.equal(read.pages, 3); assert.deepEqual(read.empty, [2]);
  const studio = new Studio(); await studio.add([new File([pdf as BlobPart], "mixed.pdf")], []);
  const view = studio.state([]).files[0];
  assert.ok(view.notices.some(n => n.startsWith("Page 2 has no text (probably a scanned page) and was left out")), view.notices.join(" / "));
  assert.deepEqual((await cleanRows(studio, view.id)).rows, [PRICE_HEAD, ["P-1", "Valve", "1.00", "2.00"], ["P-2", "Pipe", "3.00", "4.00"]]);
  const many = await pdfLines(makePdf([tablePage([PRICE_HEAD, ["P-1", "Valve", "1.00", "2.00"]], XS), [], []]));
  assert.deepEqual(many.empty, [2, 3]);
  const scan = new Studio();
  await assert.rejects(scan.add([new File([makePdf([[], []]) as BlobPart], "scan.pdf")], []), (e: unknown) => e instanceof StudioError && /fixed-width converter/.test(e.message) && /CSV/.test(e.message) && /does not use OCR/.test(e.message));
});
