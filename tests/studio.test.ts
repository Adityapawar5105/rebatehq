import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { CsvTokenizer, decodeChunks, detectDelimiter, detectEncoding, sampleRows, CHUNK_BYTES } from "../lib/studio/text";
import { align, canonicalValue, classifyRow, detectDateFormat, detectDecimal, detectHeader, fingerprint, headerNames, isoDate, kindOf, missingRequired, type Settings } from "../lib/studio/formats";
import { detectRole } from "../lib/studio/mapper";
import { checkZip, jsonGrid, sheetGrid, sheetNames, xmlGrid } from "../lib/studio/sheets";
import { CsvWriter, Normalizer, streamGrid, streamText } from "../lib/studio/rows";
import { issueColumn, issueMessage, output } from "../lib/studio/load";
import { ROLE_FIELDS } from "../lib/studio/formats";
import * as fx from "./helpers/studio-fixtures";

const base: Settings = { sheet: null, headerRow: 0, headerDepth: 1, delimiter: ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" };
function tokenize(chunks: string[], delimiter: Settings["delimiter"] = ",") {
  const rows: Array<{ cells: string[]; record: number }> = [];
  const t = new CsvTokenizer(delimiter, (cells, record) => rows.push({ cells, record }));
  for (const c of chunks) t.push(c); t.end();
  return rows;
}
async function convertFile(file: File, settings: Settings) {
  const out: Array<{ cells: string[]; row: number }> = [];
  const n = new Normalizer(settings, (cells, row) => out.push({ cells, row }));
  await streamText(file, settings, n);
  return { out, n };
}

test("tokenizer handles quotes, escaped quotes, CRLF and blank records at any chunk boundary", () => {
  const text = 'a,b,c\r\n"x, 1","say ""hi""",3\r\n\r\nlast,"multi\nline",\n';
  const whole = tokenize([text]);
  for (let cut = 1; cut < text.length; cut++) assert.deepEqual(tokenize([text.slice(0, cut), text.slice(cut)]), whole, `split at ${cut}`);
  assert.deepEqual(whole.map(r => r.cells), [["a", "b", "c"], ["x, 1", 'say "hi"', "3"], [], ["last", "multi\nline", ""]]);
  assert.deepEqual(whole.map(r => r.record), [1, 2, 3, 4]);
});
test("tokenizer flags oversized cells and too many columns instead of growing without bound", () => {
  const flagged: boolean[] = [];
  const t = new CsvTokenizer(",", (_c, _r, oversized) => flagged.push(oversized));
  t.push("x".repeat(5000) + "\n" + Array(300).fill("a").join(",") + "\nok\n"); t.end();
  assert.deepEqual(flagged, [true, true, false]);
});
test("encoding detection: UTF-8 BOM, UTF-16 with and without BOM, Windows-1252, and split multi-byte characters", async () => {
  assert.deepEqual(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), { encoding: "utf-8", bom: 3 });
  assert.equal(detectEncoding(fx.salesUtf16().bytes).encoding, "utf-16le");
  const noBom = fx.salesUtf16().bytes.slice(2);
  assert.equal(detectEncoding(noBom).encoding, "utf-16le");
  assert.equal(detectEncoding(fx.customers1252().bytes).encoding, "windows-1252");
  // "é" is two UTF-8 bytes; force a chunk boundary between them.
  const big = "a".repeat(CHUNK_BYTES - 1) + "éb";
  let text = ""; for await (const c of decodeChunks(new Blob([big]), "utf-8")) text += c.text;
  assert.equal(text, big);
  await assert.rejects(async () => { for await (const _ of decodeChunks(new Blob([new Uint8Array([0x61, 0xe9, 0x20])]), "utf-8")) { /* drain */ } }, /not valid UTF-8/);
});
test("delimiter, decimal and date detection", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3\n4;5;6\n"), ";");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3\n"), "\t");
  assert.equal(detectDelimiter("a|b|c\n1|2|3\n"), "|");
  assert.equal(detectDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(detectDecimal([["12,50", "3,1"]], ";"), "comma");
  assert.equal(detectDecimal([["12.50", "3.1"]], ","), "dot");
  assert.deepEqual(detectDateFormat([["2026-03-05"]]), { format: "YYYY-MM-DD", ambiguous: false });
  assert.deepEqual(detectDateFormat([["25/03/2026"]]), { format: "DD/MM/YYYY", ambiguous: false });
  assert.deepEqual(detectDateFormat([["03/25/2026"]]), { format: "MM/DD/YYYY", ambiguous: false });
  assert.deepEqual(detectDateFormat([["03/04/2026"]]), { format: "MM/DD/YYYY", ambiguous: true });
  assert.deepEqual(detectDateFormat([["05.03.2026"]]), { format: "DD.MM.YYYY", ambiguous: false });
  assert.equal(isoDate("31/02/2026", "DD/MM/YYYY"), null);
  assert.equal(isoDate("5.3.2026", "DD.MM.YYYY"), "2026-03-05");
});
test("header detection skips preamble rows and combines merged two-row headers", () => {
  const rows = [["Sales export"], [], fx.SALES_HEADER, ...fx.salesRows(1, 3, "2026-01")];
  assert.deepEqual(detectHeader(rows), { headerRow: 2, headerDepth: 1 });
  const grouped = [["Item", "", "Pricing", ""], ["product_id", "description", "list_price", "current_cost"], ["P-1", "Valve", "12.50", "8.00"]];
  assert.deepEqual(detectHeader(grouped, true), { headerRow: 1, headerDepth: 2 });
  assert.deepEqual(headerNames(grouped, 1, 2), ["Item product_id", "Item description", "Pricing list_price", "Pricing current_cost"]);
  assert.deepEqual(headerNames([["a", "", "a"]], 0, 1), ["a", "Column B", "a (2)"]);
});
test("role detection and canonical alignment ignore case, spaces, punctuation and column order", () => {
  const headers = ["Cost Amount", "LINE ID", "product-id", "Customer_ID", "sale date", "Quantity", "list amount", "discount_amount", "freight_amount", "rebate_amount", "Notes"];
  const role = detectRole("export.csv", headers);
  assert.equal(role.role, "sales_history");
  assert.equal(missingRequired("sales_history", align("sales_history", headers)).length, 0);
  assert.equal(align("sales_history", headers).find(a => a.field === "cost_amount")!.index, 0);
  assert.equal(detectRole("items.csv", fx.ITEM_HEADER).role, "item_master");
  assert.equal(detectRole("vendor.csv", ["vendor", "product_id", "cost", "effective_date"]).role, "vendor_cost");
  assert.equal(detectRole("data.csv", ["alpha", "beta"]).role, null);
  assert.deepEqual(missingRequired("price_list", align("price_list", ["price", "valid_from"])), ["product_id or category"]);
});
test("row classification skips totals, footers and blanks but keeps data", () => {
  assert.equal(classifyRow(["Total", "", "1255"], 10), "total");
  assert.equal(classifyRow(["Subtotal - Valves", "", ""], 10), "total");
  assert.equal(classifyRow(["Printed 2026-04-01, page 1 of 1"], 10), "footer");
  assert.equal(classifyRow(["", "", ""], 10), "blank");
  assert.equal(classifyRow(["P-1", "", ""], 10), "data");
});
test("normalizer rejects rows with extra values and pads short rows, with row locations", async () => {
  const file = new File(["Report\nline_id,product_id\n1,P-1\n2,P-2,extra\n3\n\nTotal,\n"], "x.csv");
  const { out, n } = await convertFile(file, { ...base, headerRow: 1 });
  assert.deepEqual(out, [{ cells: ["1", "P-1"], row: 3 }, { cells: ["3", ""], row: 5 }]);
  assert.equal(n.stats.rejected, 1); assert.equal(n.stats.skipped, 2);
  assert.deepEqual(n.stats.issues[0].row, 4);
});
test("Windows-1252 and UTF-16 text convert to clean UTF-8 rows", async () => {
  const c = fx.customers1252();
  const { out } = await convertFile(fx.toFile(c), { ...base, delimiter: ";", encoding: "windows-1252" });
  assert.deepEqual(out[0].cells, ["C-3", "Café Supply", "Bronze"]);
  const u = await convertFile(fx.toFile(fx.salesUtf16()), { ...base, encoding: "utf-16le" });
  assert.equal(u.out.length, 3); assert.equal(u.out[0].cells[0], "80001");
});
test("every spreadsheet format reads through SheetJS with formulas ignored and dates exact", async () => {
  for (const type of ["xlsx", "xlsb", "biff8", "ods"] as const) {
    const f = fx.salesXlsx(type);
    if (type !== "biff8") await checkZip(f.bytes, type === "xlsb" ? "xlsb" : type === "ods" ? "ods" : "xlsx");
    assert.deepEqual(sheetNames(f.bytes), ["Q1 2026", "Notes"], type);
    const grid = sheetGrid(f.bytes, "Q1 2026");
    const h = detectHeader(grid.rows, grid.merged);
    assert.equal(grid.rowNumbers[h.headerRow], 3, type);
    const out: Array<{ cells: string[]; row: number }> = [];
    const n = new Normalizer({ headerRow: h.headerRow, headerDepth: h.headerDepth }, (cells, row) => out.push({ cells, row }));
    streamGrid(grid, n);
    assert.equal(out.length, 10, type); assert.equal(out[0].row, 4, type); assert.equal(n.stats.skipped, 2, type);
    assert.deepEqual(out[0].cells, ["50001", "P-1", "C-1", "2026-02-01", "2", "125.5", "5", "2.25", "0", "80.1"], type);
    // SheetJS writes formulas only to XLSX here; its XLSB/XLS/ODS writers store the value alone.
    if (type === "xlsx") assert.ok(grid.issues.some(i => /Formula ignored/.test(i.message) && i.row === 14), type);
  }
});
test("XLSM macros are ignored with a notice; unsafe paths, entities and encrypted entries are rejected", async () => {
  const zip = await JSZip.loadAsync(fx.salesXlsx().bytes);
  zip.file("xl/vbaProject.bin", new Uint8Array([1, 2, 3]));
  const notices = await checkZip(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), "xlsm");
  assert.ok(notices.some(n => /Macros are present/.test(n)));
  const evil = await JSZip.loadAsync(fx.salesXlsx().bytes);
  evil.file("../escape.xml", "<x/>");
  await assert.rejects(checkZip(await evil.generateAsync({ type: "uint8array" }), "xlsx"), /unsafe file paths/);
  const xxe = await JSZip.loadAsync(fx.salesXlsx().bytes);
  xxe.file("xl/sharedStrings.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><sst/>');
  await assert.rejects(checkZip(await xxe.generateAsync({ type: "uint8array", compression: "DEFLATE" }), "xlsx"), /DOCTYPE or entity/);
  await assert.rejects(checkZip(new Uint8Array([1, 2, 3, 4]), "xlsx"), /not a valid/);
  // Phase 16 audit: a local header whose sizes disagree with the central directory is refused.
  const lying = new Uint8Array(await (await JSZip.loadAsync(fx.salesXlsx().bytes)).generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  assert.ok((await checkZip(lying, "xlsx")).length >= 0, "an untouched workbook passes");
  const at = new DataView(lying.buffer).getUint32(0, true) === 0x04034b50 ? 0 : -1; assert.equal(at, 0);
  new DataView(lying.buffer).setUint32(22, new DataView(lying.buffer).getUint32(22, true) + 4096, true);
  await assert.rejects(checkZip(lying, "xlsx"), /entry/);
});
test("merged cells fill from their top-left value", () => {
  const ws = XLSX.utils.aoa_to_sheet([["Group", null, "Other"], ["a", "b", "c"]]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  const bytes = new Uint8Array(XLSX.write({ SheetNames: ["S"], Sheets: { S: ws } }, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  const grid = sheetGrid(bytes, "S");
  assert.deepEqual(grid.rows[0], ["Group", "Group", "Other"]); assert.ok(grid.merged);
});
test("JSON and XML flatten nested records; XML entity declarations are rejected", () => {
  const j = jsonGrid(new TextDecoder().decode(fx.priceJson().bytes));
  assert.deepEqual(j.rows[0], ["product_id", "tier", "price", "valid_from", "terms.qty_break", "category", "valid_to"]);
  assert.equal(j.rows.length, 3); assert.ok(j.keyed);
  const x = xmlGrid(new TextDecoder().decode(fx.rebateXml().bytes));
  assert.equal(x.rows.length, 3);
  assert.equal(detectRole("rebates.xml", x.rows[0]).role, "rebate_agreement");
  assert.throws(() => xmlGrid('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'), /DOCTYPE/);
  assert.throws(() => jsonGrid("{not json"), /not valid JSON/);
});
test("clean CSV output normalizes known columns and neutralizes formulas", () => {
  const s = { decimal: "comma" as const, dateFormat: "DD.MM.YYYY" as const };
  assert.equal(canonicalValue("amount", "125,5", s), "125.50");
  assert.equal(canonicalValue("amount", "1.234,50", s), "1.234,50"); // grouping kept verbatim; the import rejects it
  assert.equal(canonicalValue("date", "05.03.2026", s), "2026-03-05");
  assert.equal(canonicalValue("quantity", "2,5", s), "2.5");
  const w = new CsvWriter("download"); w.header(["a", "b"]); w.row(["=HYPERLINK(1)", 'x"y'], 2);
  return w.blob().text().then(text => assert.equal(text, '"a","b"\r\n"\'=HYPERLINK(1)","x""y"\r\n'));
});
test("internal CSV keeps original row numbers and verbatim values", async () => {
  const w = new CsvWriter("internal"); w.header(["x", "y"]); w.row(["=1", "a,b"], 7);
  assert.equal(await w.blob().text(), '"__md_row","c0","c1"\n"7","=1","a,b"\n');
});
test("issue messages and columns never include cell values", () => {
  const file = { ord: 0, role: "sales_history" as const, name: "f.csv", bytes: 1, fingerprint: "", alignment: align("sales_history", fx.SALES_HEADER), settings: base, keyed: false, headers: fx.SALES_HEADER, colOffset: 0 };
  assert.equal(issueColumn("list_amount:invalid", file), "F");
  assert.match(issueMessage("list_amount:invalid", base), /non-negative amount/);
  assert.equal(issueColumn("list_amount:invalid", { ...file, keyed: true }), "list_amount");
  const field = (role: keyof typeof ROLE_FIELDS, name: string) => ROLE_FIELDS[role].find(f => f.name === name)!;
  assert.equal(output(field("sales_history", "list_amount")).name, "list_cents");
  assert.equal(output(field("sales_history", "cost_amount")).name, "cost_cents");
  assert.equal(output(field("item_master", "current_cost")).name, "current_cost");
});
test("recipe fingerprints depend on kind and normalized headers only", () => {
  assert.equal(fingerprint("csv", ["Line ID", "SKU"]), fingerprint("csv", ["line_id", "sku"]));
  assert.notEqual(fingerprint("csv", ["a"]), fingerprint("tsv", ["a"]));
  assert.equal(kindOf("Report.XLSB"), "xlsb"); assert.equal(kindOf("x.docx"), null);
  // 7F-2: text-based PDF tables, Parquet and .prn print reports are converter inputs.
  assert.equal(kindOf("x.pdf"), "pdf"); assert.equal(kindOf("x.parquet"), "parquet"); assert.equal(kindOf("x.PRN"), "prn");
});
test("sampleRows is bounded", () => { assert.equal(sampleRows("a\n".repeat(500), ",", 60).length, 60); });
