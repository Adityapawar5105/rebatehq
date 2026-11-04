// Chunk 6A regression fixtures: each failure shape found by the pilot-file runs
// (PILOT_FILES.md), reproduced with synthetic values only. No real export data.
import test from "node:test";
import assert from "node:assert/strict";
import { NO_HEADER, ROLE_FIELDS, detectHeader, headerNames, type Settings } from "../lib/studio/formats";
import { detectProfile, suggestMapping, type FieldSource, type MappedField } from "../lib/studio/mapper";
import { cleanNumber, shareOf, toCents } from "../lib/studio/clean";
import { Normalizer, streamText } from "../lib/studio/rows";
import { Studio, canonicalRow, isItemLine, nonItemLine } from "../lib/studio/studio";
import { createStage, resetStage, validate, type StagedFile } from "../lib/studio/load";
import { schemaSql, tablesFor, upgradeSql } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";

const show = (fields: MappedField[], headers: string[]) => Object.fromEntries(fields.map(f => [f.field, "index" in f.source ? `${f.source.kind}:${headers[f.source.index]}` : f.source.kind]));
const base: Settings = { sheet: null, headerRow: 0, headerDepth: 1, delimiter: ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" };
async function rowsOf(text: string, settings: Settings) {
  const out: string[][] = [], n = new Normalizer(settings, cells => out.push(cells));
  await streamText(new Blob([text]), settings, n);
  return { out, n };
}

// AdventureWorks data-warehouse shape: pipe-delimited, no header row, numeric keys.
const HEADERLESS = ["349|20101229|676|SO43659|1|1|2024.9940|2024.9940|0.0|1898.0944|2010-12-29 00:00:00.000", "350|20101229|676|SO43659|2|3|2024.9940|6074.9820|0.0|5694.2832|2010-12-29 00:00:00.000", "351|20101229|676|SO43659|3|1|2024.9940|2024.9940|0.0|1898.0944|2010-12-29 00:00:00.000"].join("\n") + "\n";
test("6A: a headerless export is detected and every row is read as data", async () => {
  const rows = HEADERLESS.trim().split("\n").map(l => l.split("|"));
  assert.deepEqual(detectHeader(rows), { headerRow: NO_HEADER, headerDepth: 1 });
  assert.deepEqual(headerNames(rows, NO_HEADER, 1).slice(0, 3), ["Column A", "Column B", "Column C"]);
  const { out } = await rowsOf(HEADERLESS, { ...base, delimiter: "|", headerRow: NO_HEADER });
  assert.equal(out.length, 3, "the first row is data, not headers");
  assert.equal(out[0][0], "349");
  // A one-column list with a header keeps its header row.
  assert.equal(detectHeader([["sku"], ["A-1"], ["A-2"]]).headerRow, 0);
  // A normal header row still wins.
  assert.equal(detectHeader([["Invoice", "Item", "Qty"], ["1001", "A-1", "3"]]).headerRow, 0);
  const studio = new Studio(); await studio.add([new File([HEADERLESS], "FactResellerSales.csv")], []);
  const view = studio.state([]).files[0];
  assert.equal(view.settings.headerRow, NO_HEADER); assert.equal(view.settings.delimiter, "|");
  assert.ok(view.notices.some(n => n.startsWith("No header row")), view.notices.join(" / "));
  await studio.update(view.id, { headerRow: 0 }); assert.equal(studio.state([]).files[0].settings.headerRow, 0, "the user can still pick a header row");
  await studio.update(view.id, { headerRow: NO_HEADER }); assert.equal(studio.state([]).files[0].settings.headerRow, NO_HEADER, "and choose 'No header row'");
});

// QuickBooks Desktop "Sales by Item Detail" CSV: item names are section headings in unnamed columns.
const QB = [",,,,Type,Date,Num,Memo,Name,Qty,Sales Price,Amount,Balance", "Inventory,,,,,,,,,,,,", ",Fasteners,,,,,,,,,,,", ",,FAST-01,,,,,,,,,,",
  ",,,,Invoice,01/05/2026,1001,Hex bolt,C-0003,10,1.25,12.50,12.50", ",,,,Invoice,01/09/2026,1007,Hex bolt,C-0004,4,1.25,5.00,17.50", ",,Total FAST-01,,,,,,,14,,17.50,17.50",
  ",,FAST-02,,,,,,,,,,", ",,,,Credit Memo,01/12/2026,1010,Washer,C-0003,-2,2.00,-4.00,-4.00", ",,Total FAST-02,,,,,,,-2,,-4.00,-4.00", ",Total Fasteners,,,,,,,,,,13.50,", "Total Inventory,,,,,,,,,,,13.50,", "TOTAL,,,,,,,,,,,13.50,", "", "\"Tuesday, July 07, 2026 09:14 AM GMT-05:00\",,,,,,,,,,,,"].join("\r\n") + "\r\n";
test("6A: report section headings are copied down and heading/total rows are skipped", async () => {
  const { out, n } = await rowsOf(QB, base);
  assert.equal(out.length, 3, JSON.stringify(out));
  assert.deepEqual(out.map(r => [r[0], r[1], r[2], r[6]]), [["Inventory", "Fasteners", "FAST-01", "1001"], ["Inventory", "Fasteners", "FAST-01", "1007"], ["Inventory", "Fasteners", "FAST-02", "1010"]]);
  assert.equal(n.headings, 4);
  const studio = new Studio(); await studio.add([new File([QB], "quickbooks-sales-by-item-detail.csv")], []);
  const view = studio.state([]).files[0];
  assert.equal(view.erp, "quickbooks"); assert.equal(view.role, "sales_history");
  assert.ok(view.notices.some(x => x.startsWith("Rows that fill only column A, B, C")), view.notices.join(" / "));
  const m = Object.fromEntries(view.fields.map(f => [f.field, f.header]));
  assert.equal(m.product_id, "Column C", "the item comes from the deepest heading"); assert.equal(m.customer_id, "Name"); assert.equal(m.invoice_id, "Num");
  assert.ok(view.needsConfirmation);
  const dl = await studio.download(view.id, new AbortController().signal);
  const csv = (await dl.blob.text()).trim().split("\r\n");
  assert.equal(csv.length, 4); assert.ok(csv[1].startsWith('"Inventory","Fasteners","FAST-01"'), csv[1]);
});

test("6A: list key, customer name and price-group columns map without guessing", () => {
  const bc = ["No.", "Name", "Customer Price Group"];
  assert.deepEqual(show(suggestMapping("customer_list", bc), bc), { customer_id: "column:No.", name: "column:Name", tier: "column:Customer Price Group", branch: "none", region: "none", payment_terms: "none" });
  const ns = ["Name", "Price Level"], nsm = suggestMapping("customer_list", ns);
  assert.deepEqual(show(nsm, ns), { customer_id: "column:Name", name: "column:Name", tier: "column:Price Level", branch: "none", region: "none", payment_terms: "none" });
  assert.equal(nsm.find(f => f.field === "customer_id")!.confidence, 0.7, "a name used as the key must be confirmed");
  const items = ["No.", "Description", "Unit Cost"];
  assert.equal(show(suggestMapping("item_master", items), items).product_id, "column:No.");
  // A price list's "Name" is not taken as a customer.
  assert.equal(show(suggestMapping("price_list", ["Name", "Price", "Valid From"]), ["Name", "Price", "Valid From"]).customer_id, "none");
});

test("6A: NetSuite and QuickBooks exports are recognised from their own column names", () => {
  const ns = ["Internal ID", "Type", "Document Number", "Date", "Name", "Item", "Quantity", "Item Rate", "Amount", "Est. Extended Cost"];
  assert.equal(detectProfile(ns), "netsuite");
  const m = suggestMapping("sales_history", ns, "netsuite");
  assert.deepEqual(show(m, ns), { line_id: "generate", invoice_id: "column:Document Number", product_id: "column:Item", customer_id: "column:Name", sale_date: "column:Date", quantity: "column:Quantity", list_amount: "column:Amount", discount_amount: "zero", freight_amount: "zero", rebate_amount: "zero", cost_amount: "column:Est. Extended Cost", line_type: "none" });
  assert.equal(m.find(f => f.field === "cost_amount")!.confidence, 0.95);
  assert.equal(detectProfile(["Type", "Date", "Num", "Memo", "Name", "Qty", "Sales Price", "Amount", "Balance"]), "quickbooks");
  assert.equal(detectProfile(["Invoice", "Item", "Customer", "Date", "Qty", "Amount"]), "generic");
});

test("6A: a discount given as a percent or a 0-1 share becomes an exact amount", async () => {
  assert.equal(shareOf("30.00", "30", 100), "9.00"); assert.equal(shareOf("33.33", "15", 100), "5.00");
  assert.equal(shareOf("0.10", "0.05", 1), "0.01"); assert.equal(shareOf("-20.00", "30", 100), "-6.00"); assert.equal(shareOf("x", "1", 1), null);
  const pct = ["Invoice", "Item", "Customer", "Date", "Qty", "Unit Price", "Discount %"];
  assert.equal(show(suggestMapping("sales_history", pct), pct).discount_amount, "percent:Discount %");
  const both = [...pct, "Line Discount Amount"];
  assert.equal(show(suggestMapping("sales_history", both), both).discount_amount, "column:Line Discount Amount", "an amount column wins over a percent");
  const mapping: Record<string, FieldSource> = { line_id: { kind: "generate", lineNo: null }, invoice_id: { kind: "column", index: 0 }, product_id: { kind: "column", index: 1 }, customer_id: { kind: "column", index: 2 }, sale_date: { kind: "column", index: 3 }, quantity: { kind: "column", index: 4 }, list_amount: { kind: "unit", index: 5 }, discount_amount: { kind: "percent", index: 6 } };
  const at = (row: string[], m = mapping, s = base) => { const out = canonicalRow("sales_history", m, s, row, 2, new Map(), new Map()); return out[ROLE_FIELDS.sales_history.findIndex(f => f.name === "discount_amount")]; };
  assert.equal(at(["1001", "A-1", "C-1", "2026-01-05", "3", "10.00", "30"]), "9.00");
  assert.equal(at(["1001", "A-1", "C-1", "2026-01-05", "3", "10,00", "12,5"], mapping, { ...base, decimal: "comma" }), "3.75");
  assert.equal(at(["1001", "A-1", "C-1", "2026-01-05", "3", "10.00", "0.05"], { ...mapping, discount_amount: { kind: "fraction", index: 6 } }), "1.50");
  assert.equal(at(["1001", "A-1", "C-1", "2026-01-05", "3", "10.00", ""]), "", "a blank percent stays blank (loads as 0)");
  // Northwind shape: "discount" holds 0-1 shares, so the suggestion is a share, not an amount.
  const nw = "orderID,productID,customerID,orderDate,unitPrice,quantity,discount\n10248,11,VINET,1996-07-04,14.00,12,0\n10248,42,VINET,1996-07-04,9.80,10,0.15\n10249,14,TOMSP,1996-07-05,18.60,9,0.05\n10250,41,HANAR,1996-07-08,7.70,10,0\n";
  const studio = new Studio(); await studio.add([new File([nw], "order_details.csv")], []);
  const d = studio.state([]).files[0].fields.find(f => f.field === "discount_amount")!;
  assert.deepEqual(d.source, { kind: "fraction", index: 6 }); assert.equal(d.confidence, 0.7);
  // Small discount AMOUNTS stay amounts: an exact "discount_amount" column or a header that says amount.
  for (const h of ["discount_amount", "Disc Amt", "Discount Amount"]) {
    const amounts = `line_id,product_id,customer_id,sale_date,quantity,list_amount,${h},freight_amount,rebate_amount,cost_amount\n1,P,C,2025-01-01,1,9.00,0.50,0.25,0.00,8.00\n2,P,C,2025-01-01,1,9.00,0.25,0.25,0.00,8.00\n3,P,C,2025-01-01,1,9.00,0.75,0.25,0.00,8.00\n`;
    const s2 = new Studio(); await s2.add([new File([amounts], "sales.csv")], []);
    const v = s2.state([]).files[0];
    assert.equal(v.fields.find(f => f.field === "discount_amount")!.source.kind, "column", h);
    if (h === "discount_amount") assert.equal(v.needsConfirmation, false, "canonical headers still need no confirmation");
  }
});

test("6A: a long cell in an unmapped column (an embedded image) no longer rejects the row", async () => {
  const photo = "47494638".repeat(1200), text = `1|AR-5381|Adjustable Race|${photo}|0.00\n2|BA-8327|Bearing Ball|${photo}|1.50\n3|${"X".repeat(4100)}|Too long id||2.00\n`;
  const s = { ...base, delimiter: "|" as const, headerRow: NO_HEADER };
  const run = async (allow: (cut: number[]) => boolean) => { const out: string[][] = [], n = new Normalizer(s, c => out.push(c), undefined, String, allow); await streamText(new Blob([text]), s, n); return { out, n }; };
  const unmapped = new Set([0, 1, 2, 4]), lenient = await run(cut => cut.every(i => !unmapped.has(i)));
  assert.equal(lenient.out.length, 2, "rows whose long cell is in an unused column load");
  assert.equal(lenient.n.longCellsIgnored, 2); assert.equal(lenient.n.stats.rejected, 1, "a long value in a mapped column is still rejected");
  const strict = await run(() => false);
  assert.equal(strict.out.length, 0); assert.equal(strict.n.stats.rejected, 3, "the clean-CSV download keeps rejecting long cells");
});

test("6A: amounts stored with four decimals round to the cent; unit prices keep their precision", () => {
  assert.equal(toCents("2024.9940"), "2024.99"); assert.equal(toCents("343.6496"), "343.65"); assert.equal(toCents("0.1250"), "0.13");
  assert.equal(toCents("0.1249"), "0.12"); assert.equal(toCents("-1.005"), "-1.01"); assert.equal(toCents("-0.004"), "0.00"); assert.equal(toCents("12.5"), "12.5"); assert.equal(toCents("x"), null);
  const mapping: Record<string, FieldSource> = { line_id: { kind: "generate", lineNo: 1 }, invoice_id: { kind: "column", index: 0 }, product_id: { kind: "column", index: 2 }, customer_id: { kind: "column", index: 3 }, sale_date: { kind: "column", index: 4 }, quantity: { kind: "column", index: 5 }, list_amount: { kind: "column", index: 6 }, cost_amount: { kind: "unit", index: 7 } };
  const notes = new Map(), out = canonicalRow("sales_history", mapping, base, ["SO43659", "1", "349", "676", "2010-12-29", "1000", "2024.9940", "0.4250"], 2, new Map(), notes);
  const at = (f: string) => out[ROLE_FIELDS.sales_history.findIndex(x => x.name === f)];
  assert.equal(at("list_amount"), "2024.99"); assert.equal(at("cost_amount"), "425.00", "unit cost x quantity uses the unrounded unit");
  assert.ok(notes.get("list_amount")?.has("rounded"));
  // SQL Server writes fractions below 1 without a leading zero.
  assert.equal(cleanNumber(".9999", "dot").value, "0.9999"); assert.equal(cleanNumber("-.5", "dot").value, "-0.5"); assert.equal(cleanNumber(",25", "comma").value, "0.25");
  assert.equal(cleanNumber(",25", "dot").value, ",25", "a leading comma in dot-decimal files stays ambiguous and is rejected");
});

test("6A: identical lines with their own line numbers are both kept; without line numbers the copy waits in Fix Later", async () => {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(7)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(7));
  const engine = { conn: c } as unknown as Engine;
  const errs = async (generatedIds: boolean) => {
    await resetStage(engine); await createStage(engine, "sales_history");
    // The same item twice on one invoice: lines 10000 and 20000 (Business Central) get distinct generated IDs.
    c.query(`INSERT INTO st_sales_history VALUES (0,2,'101','INV1','FAST-01','C-1','2026-01-05','3','30.00','0','0','0','20.00','Item'),(0,3,'102','INV1','FAST-01','C-1','2026-01-05','3','30.00','0','0','0','20.00','Item')`);
    const file: StagedFile = { ord: 0, role: "sales_history", name: "lines.csv", bytes: 1, fingerprint: "", alignment: [], settings: base, keyed: false, headers: [], colOffset: 0, generatedIds };
    await validate(engine, "sales_history", [file], null);
    return q(c, "SELECT src_row, err FROM ty_sales_history ORDER BY src_row").map(r => r.err);
  };
  assert.deepEqual(await errs(false), [null, null], "line numbers prove they are two lines");
  assert.deepEqual(await errs(true), [null, "duplicate_row"], "with IDs from line order only, an exact copy is held back");
  await resetStage(engine);
});

test("6A: vault v8 keeps every v7 sales line and accepts row 1 of a headerless file", async () => {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(8)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(7));
  c.query(`INSERT INTO source_files VALUES('s','a.csv','sales_history',1,'x'); INSERT INTO products(product_id) VALUES('P'); INSERT INTO customers(customer_id) VALUES('C');
INSERT INTO sales_lines VALUES('s',7,'P','C','2026-01-05',2,1000,100,0,0,600,2,'INV1','sale'),('s',8,'P','C','2026-01-06',-1,-500,0,0,0,-300,3,'CM1','credit')`);
  assert.throws(() => c.query("INSERT INTO sales_lines VALUES('s',9,'P','C','2026-01-07',1,10,0,0,0,NULL,1,NULL,'sale')"), "v7 refused row 1");
  c.query(upgradeSql(7));
  assert.deepEqual(q(c, "SELECT line_id, quantity::VARCHAR AS qty, list_cents, cost_cents, source_row, invoice_id, line_kind FROM sales_lines ORDER BY line_id"), [
    { line_id: "7", qty: "2.0000", list_cents: "1000", cost_cents: "600", source_row: "2", invoice_id: "INV1", line_kind: "sale" },
    { line_id: "8", qty: "-1.0000", list_cents: "-500", cost_cents: "-300", source_row: "3", invoice_id: "CM1", line_kind: "credit" }]);
  c.query("INSERT INTO sales_lines VALUES('s',9,'P','C','2026-01-07',1,10,0,0,0,NULL,1,NULL,'sale')");
  assert.throws(() => c.query("INSERT INTO sales_lines VALUES('s',10,'P','C','2026-01-07',1,10,0,0,0,NULL,0,NULL,'sale')"), "row 0 is still refused");
  assert.throws(() => c.query("INSERT INTO sales_lines VALUES('s',11,'P','C','2026-01-07',1,-10,0,0,0,NULL,4,NULL,'sale')"), "sign rules survive the rebuild");
  assert.equal(q(c, "SELECT count(*) AS n FROM duckdb_indexes() WHERE table_name='sales_lines'")[0].n, "2");
});

test("6A: a sales file can be limited to a date range; bad ranges are refused", async () => {
  const csv = "invoice_id,line_id,product_id,customer_id,sale_date,quantity,list_amount\nI1,1,P,C,2026-01-05,1,10.00\n";
  const studio = new Studio(); await studio.add([new File([csv], "sales.csv")], []);
  const id = studio.state([]).files[0].id;
  assert.deepEqual(studio.state([]).files[0].range, { from: null, to: null });
  await studio.update(id, { range: { from: "2026-01-01", to: "2026-03-31" } });
  assert.deepEqual(studio.state([]).files[0].range, { from: "2026-01-01", to: "2026-03-31" });
  await assert.rejects(studio.update(id, { range: { from: "2026-04-01", to: "2026-03-31" } }), /start date on or before/);
  await assert.rejects(studio.update(id, { range: { from: "2026-02-30", to: null } }), /real start date/);
  await assert.rejects(studio.update(id, { range: { from: "01/02/2026", to: null } }));
  await studio.update(id, { range: { from: null, to: null } }); assert.deepEqual(studio.state([]).files[0].range, { from: null, to: null });
});

test("6A: a mapped line type skips G/L account, charge and comment lines", () => {
  assert.ok(isItemLine("Item") && isItemLine("Inventory Part") && isItemLine("Non-inventory Part"));
  assert.ok(!isItemLine("G/L Account") && !isItemLine("Charge (Item)") && !isItemLine("Resource"));
  const m: Record<string, FieldSource> = { product_id: { kind: "column", index: 1 }, line_type: { kind: "column", index: 0 } };
  assert.equal(nonItemLine("sales_history", m, ["Item", "FAST-01"]), false);
  assert.equal(nonItemLine("sales_history", m, ["G/L Account", "6810"]), true, "freight posted to a G/L account is not a product sale");
  assert.equal(nonItemLine("sales_history", m, ["", ""]), true, "a comment line");
  assert.equal(nonItemLine("sales_history", m, ["", "FAST-01"]), false, "a blank type with a product is kept");
  assert.equal(nonItemLine("sales_history", { product_id: m.product_id }, ["G/L Account", "6810"]), false, "no line type mapped: nothing is filtered");
  const bc = ["Document No.", "Line No.", "Sell-to Customer No.", "Posting Date", "Type", "No.", "Description", "Quantity", "Unit Price Excl. VAT", "Line Discount Amount", "Unit Cost (LCY)"];
  assert.equal(detectProfile(bc), "bc");
  assert.equal(show(suggestMapping("sales_history", bc, "bc"), bc).line_type, "column:Type");
});
