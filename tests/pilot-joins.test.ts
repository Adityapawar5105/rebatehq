// Chunk 6A follow-up: the four parked pilot gaps, reproduced with synthetic values only.
// Header/line exports (Northwind), item-list cost (QuickBooks), sheets over 300,000 rows
// (Online Retail II) and German/French/Spanish/Dutch headers (SAP Business One).
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import type { Settings } from "../lib/studio/formats";
import { detectRole, mappingProblems, needsConfirmation, suggestMapping, type MappedField } from "../lib/studio/mapper";
import { Studio } from "../lib/studio/studio";
import { createStage, fillItemCost, joinHeaders, markUnjoined, resetStage, spreadFreight, validate, type StagedFile } from "../lib/studio/load";
import { sheetGrid, MAX_SHEET_ROWS } from "../lib/studio/sheets";
import { sampleSheet, streamSheet, unescapeXml } from "../lib/studio/xlsxstream";
import { schemaSql, tablesFor } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";

const show = (fields: MappedField[], headers: string[]) => Object.fromEntries(fields.map(f => [f.field, "index" in f.source ? `${f.source.kind}:${headers[f.source.index]}` : f.source.kind]));
const base: Settings = { sheet: null, headerRow: 0, headerDepth: 1, delimiter: ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" };
const staged = (ord: number, role: StagedFile["role"], extra: Partial<StagedFile> = {}): StagedFile => ({ ord, role, name: `${role}.csv`, bytes: 1, fingerprint: "", alignment: [], settings: base, keyed: false, headers: [], colOffset: 0, ...extra });

// Northwind shape: customer, date and freight live in the order header file.
const ORDERS = "orderID,customerID,employeeID,orderDate,requiredDate,shippedDate,shipVia,freight,shipName\n10248,VINET,5,1996-07-04,1996-08-01,1996-07-16,3,32.38,Vins\n10249,TOMSP,6,1996-07-05,1996-08-16,1996-07-10,1,11.61,Toms\n";
const DETAILS = "orderID,productID,unitPrice,quantity,discount\n10248,11,14.00,12,0\n10248,42,9.80,10,0.15\n10249,14,18.60,9,0.05\n10249,51,42.40,40,0\n";
test("6A: an order header file is recognised and fills customer, date and freight of its lines file", async () => {
  assert.equal(detectRole("orders.csv", ORDERS.split("\n")[0].split(",")).role, "order_header");
  assert.equal(detectRole("order_details.csv", DETAILS.split("\n")[0].split(",")).role, "sales_history", "a file with a quantity column is never a header file");
  const studio = new Studio();
  await studio.add([new File([DETAILS], "order_details.csv")], []);
  let lines = studio.state([]).files[0];
  assert.deepEqual(lines.missing.sort(), ["customer_id", "sale_date"], "alone, the lines file cannot load");
  await studio.add([new File([ORDERS], "orders.csv")], []);
  const [l, h] = studio.state([]).files; lines = l;
  assert.equal(h.role, "order_header"); assert.deepEqual(h.missing, []); assert.match(h.reason ?? "", /confirm/, "the inferred header mapping is confirmed like any other");
  assert.deepEqual(Object.fromEntries(h.fields.map(f => [f.field, f.header])), { invoice_id: "orderID", customer_id: "customerID", sale_date: "orderDate", freight_amount: "freight" });
  const src = Object.fromEntries(lines.fields.map(f => [f.field, f.source.kind]));
  assert.equal(src.customer_id, "header"); assert.equal(src.sale_date, "header"); assert.equal(src.freight_amount, "header");
  assert.equal(src.discount_amount, "fraction", "Northwind discounts are 0-1 shares");
  assert.deepEqual(lines.missing, []); assert.ok(lines.needsConfirmation, "joined fields must be confirmed");
  assert.ok(mappingProblems("sales_history", { customer_id: { kind: "header" }, invoice_id: { kind: "none" } }).includes("invoice_id (needed to join the order header file)"));
});

test("6A: header join, missing headers and the exact freight spread (DuckDB)", async () => {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(8)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(8));
  const engine = { conn: c } as unknown as Engine;
  await resetStage(engine);
  for (const role of ["order_header", "sales_history"] as const) await createStage(engine, role);
  c.query(`INSERT INTO st_order_header VALUES (1,2,'INV1','C-1','2026-01-05','10.00'),(1,3,'INV2','C-2','2026-01-06','0.01'),(1,4,'INV3','C-3','2026-01-07','5.00'),(1,5,'INV4','C-4','2026-13-01','1.00')`);
  // line_id, invoice_id, product_id, customer_id, sale_date, quantity, list, discount, freight, rebate, cost, line_type
  c.query(`INSERT INTO st_sales_history VALUES
(0,2,'1','INV1','P1',NULL,NULL,'1','10.00','0',NULL,'0',NULL,NULL),(0,3,'2','INV1','P1',NULL,NULL,'1','20.00','0',NULL,'0',NULL,NULL),(0,4,'3','INV1','P2',NULL,NULL,'1','0.00','0',NULL,'0',NULL,NULL),
(0,5,'4','INV2','P1',NULL,NULL,'1','0.00','0',NULL,'0',NULL,NULL),(0,6,'5','INV2','P2',NULL,NULL,'1','0.00','0',NULL,'0',NULL,NULL),
(0,7,'6','INV3','P1',NULL,NULL,'x','5.00','0',NULL,'0',NULL,NULL),(0,8,'7','INV9','P1',NULL,NULL,'1','5.00','0',NULL,'0',NULL,NULL),(0,9,'8','INV4','P1',NULL,NULL,'1','5.00','0',NULL,'0',NULL,NULL)`);
  const header = staged(1, "order_header"), lines = staged(0, "sales_history", { fromHeader: ["customer_id", "sale_date", "freight_amount"] });
  await validate(engine, "order_header", [lines, header], null);
  assert.deepEqual(q(c, "SELECT src_row, err FROM ty_order_header ORDER BY src_row").map(r => r.err), [null, null, null, "sale_date:invalid"], "a header row with a bad date is reported, not joined");
  const joins = await joinHeaders(engine, [lines, header]);
  assert.deepEqual(joins?.get(0), { joined: 6, unjoined: 2 });
  await validate(engine, "sales_history", [lines, header], null);
  await markUnjoined(engine, [lines, header]);
  const freight = await spreadFreight(engine, [lines, header]);
  assert.deepEqual(freight, { spread: 2, unspread: 1 }, "INV3's only line failed, so its freight cannot be spread");
  assert.deepEqual(q(c, "SELECT src_row::VARCHAR AS row, customer_id, sale_date::VARCHAR AS day, freight_cents::VARCHAR AS f, err FROM ty_sales_history ORDER BY src_row"), [
    { row: "2", customer_id: "C-1", day: "2026-01-05", f: "333", err: null },
    { row: "3", customer_id: "C-1", day: "2026-01-05", f: "667", err: null },
    { row: "4", customer_id: "C-1", day: "2026-01-05", f: "0", err: null },
    { row: "5", customer_id: "C-2", day: "2026-01-06", f: "1", err: null },
    { row: "6", customer_id: "C-2", day: "2026-01-06", f: "0", err: null },
    { row: "7", customer_id: "C-3", day: "2026-01-07", f: null, err: "quantity:invalid" },
    { row: "8", customer_id: null, day: null, f: null, err: "no_header" },
    { row: "9", customer_id: null, day: null, f: null, err: "no_header" }]);
  assert.equal(q(c, "SELECT sum(freight_cents)::VARCHAR AS s FROM ty_sales_history WHERE invoice_id='INV1'")[0].s, "1000", "the lines add up to the header's freight exactly");
  await resetStage(engine);
});

test("6A: cost from the item list when the sales file has none (DuckDB)", async () => {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(8)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(8));
  c.query("INSERT INTO products(product_id,current_cost) VALUES ('P1',250),('P2',999)");
  const engine = { conn: c } as unknown as Engine;
  await resetStage(engine);
  for (const role of ["item_master", "sales_history"] as const) await createStage(engine, role);
  c.query(`INSERT INTO st_item_master VALUES (1,2,'P2','Washer',NULL,NULL,'12.34',NULL),(1,3,'P3','No cost',NULL,NULL,NULL,NULL)`);
  c.query(`INSERT INTO st_sales_history VALUES (0,2,'1','I1','P2','C','2026-01-05','3','60.00','0','0','0',NULL,NULL),(0,3,'2','I1','P1','C','2026-01-05','1.5','9.00','0','0','0',NULL,NULL),(0,4,'3','I1','P3','C','2026-01-05','2','9.00','0','0','0',NULL,NULL),(0,5,'4','I2','P1','C','2026-01-05','0.0001','9.00','0','0','0',NULL,NULL)`);
  const items = staged(1, "item_master"), lines = staged(0, "sales_history", { itemCost: true });
  await validate(engine, "item_master", [lines, items], null);
  await validate(engine, "sales_history", [lines, items], null);
  assert.deepEqual(await fillItemCost(engine, [lines, items], true), { costed: 3, unknown: 1 });
  assert.deepEqual(q(c, "SELECT product_id, cost_cents::VARCHAR AS cost FROM ty_sales_history ORDER BY src_row"), [
    { product_id: "P2", cost: "3702" }, // the batch's item list (12.34) wins over the vault's 9.99
    { product_id: "P1", cost: "375" }, // 1.5 x 2.50 from the vault
    { product_id: "P3", cost: null }, // no cost anywhere: unknown, never 0
    { product_id: "P1", cost: "0" }]); // 0.0001 x 2.50 = 0.025 cents rounds to 0
  await resetStage(engine);
  // Suggested only when an item list with a cost is in the batch, and always confirmed.
  const studio = new Studio();
  await studio.add([new File(["Invoice,Item,Customer,Date,Qty,Amount\n1001,FAST-01,C-1,2026-01-05,10,12.50\n"], "sales.csv"), new File(["Item,Description,Cost,Price\nFAST-01,Hex bolt,0.80,1.25\n"], "item-list.csv")], []);
  const sales = studio.state([]).files.find(f => f.role === "sales_history")!;
  const cost = sales.fields.find(f => f.field === "cost_amount")!;
  assert.equal(cost.source.kind, "item_cost"); assert.equal(cost.confidence, 0.7); assert.ok(sales.needsConfirmation);
});

test("6A: German, French, Spanish and Dutch headers map without a recipe", () => {
  const sap = ["Belegnummer", "Position", "Kundennummer", "Buchungsdatum", "Artikelnummer", "Artikelbeschreibung", "Menge", "Einzelpreis", "Rabatt %", "Zeilensumme", "Einstandspreis", "Frachtkosten"];
  assert.equal(detectRole("sap-b1-verkaufszeilen.csv", sap).role, "sales_history");
  const m = suggestMapping("sales_history", sap);
  assert.deepEqual(show(m, sap), { line_id: "generate", invoice_id: "column:Belegnummer", product_id: "column:Artikelnummer", customer_id: "column:Kundennummer", sale_date: "column:Buchungsdatum", quantity: "column:Menge", list_amount: "unit:Einzelpreis", discount_amount: "percent:Rabatt %", freight_amount: "column:Frachtkosten", rebate_amount: "zero", cost_amount: "unit:Einstandspreis", line_type: "none" });
  assert.deepEqual(m.find(f => f.field === "line_id")!.source, { kind: "generate", lineNo: 1 }, "Position is the line number");
  assert.ok(needsConfirmation(m), "inferred mappings are still confirmed by the user");
  const kunden = ["Kundennummer", "Kundenname", "Preisgruppe"];
  assert.equal(detectRole("sap-b1-kunden.csv", kunden).role, "customer_list");
  assert.deepEqual(show(suggestMapping("customer_list", kunden), kunden).tier, "column:Preisgruppe");
  const fr = ["N° facture", "Date facture", "Code client", "Référence article", "Quantité", "Prix unitaire", "Remise", "Frais de port"];
  assert.deepEqual(show(suggestMapping("sales_history", fr), fr), { line_id: "generate", invoice_id: "column:N° facture", product_id: "column:Référence article", customer_id: "column:Code client", sale_date: "column:Date facture", quantity: "column:Quantité", list_amount: "unit:Prix unitaire", discount_amount: "column:Remise", freight_amount: "column:Frais de port", rebate_amount: "zero", cost_amount: "none", line_type: "none" });
  const es = ["Factura", "Fecha", "Cliente", "Artículo", "Cantidad", "Precio unitario"], nl = ["Factuurnummer", "Factuurdatum", "Klantnummer", "Artikelcode", "Aantal", "Prijs"];
  for (const h of [es, nl]) { const s = show(suggestMapping("sales_history", h), h); for (const f of ["invoice_id", "sale_date", "customer_id", "product_id", "quantity"]) assert.ok(String(s[f]).startsWith("column:"), `${h.join("|")}: ${f}`); assert.ok(String(s.list_amount).startsWith("unit:")); }
});

test("6A: duplicate rules are unchanged by the repeat pre-filter that keeps 1M-row reviews in memory (DuckDB)", async () => {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(8)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(8));
  const engine = { conn: c } as unknown as Engine;
  await resetStage(engine); await createStage(engine, "sales_history"); await createStage(engine, "price_list");
  // Same line ID: an exact copy (duplicate_row) and a changed copy (duplicate_key); other lines untouched.
  c.query(`INSERT INTO st_sales_history VALUES (0,2,'7','I','P','C','2026-01-05','1','10.00','0','0','0',NULL,NULL),(0,3,'8','I','P','C','2026-01-05','1','10.00','0','0','0',NULL,NULL),
(0,4,'7','I','P','C','2026-01-05','1','10.00','0','0','0',NULL,NULL),(1,2,'7','I','P','C','2026-01-05','2','10.00','0','0','0',NULL,NULL),(1,3,'9','I','P','C','2026-01-05','1','10.00','0','0','0',NULL,NULL)`);
  await validate(engine, "sales_history", [staged(0, "sales_history"), staged(1, "sales_history")], null);
  assert.deepEqual(q(c, "SELECT file_ord::VARCHAR || ':' || src_row::VARCHAR AS at, err FROM ty_sales_history ORDER BY file_ord, src_row").map(r => `${r.at}=${r.err}`), ["0:2=null", "0:3=null", "0:4=duplicate_row", "1:2=duplicate_key", "1:3=null"]);
  // Price keys with NULL parts still group NULL with NULL, as before.
  c.query(`INSERT INTO st_price_list VALUES (0,2,'P',NULL,NULL,'T1',NULL,'5.00','2026-01-01',NULL),(0,3,'P',NULL,NULL,'T1',NULL,'5.00','2026-01-01',NULL),(0,4,'P',NULL,NULL,'T2',NULL,'5.00','2026-01-01',NULL)`);
  await validate(engine, "price_list", [staged(0, "price_list")], null);
  assert.deepEqual(q(c, "SELECT err FROM ty_price_list ORDER BY src_row").map(r => r.err), [null, "duplicate_row", null]);
  assert.equal(q(c, "SELECT count(*)::VARCHAR AS n FROM duckdb_tables() WHERE table_name='studio_repeats'")[0].n, "0", "the helper table is dropped");
  await resetStage(engine);
});

/** Build an XLSX workbook in memory with SheetJS (cell types, styles and formulas as Excel writes them). */
function workbook(rows: (string | number | boolean | Date | null)[][], formula = false, bookSST = false) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  if (formula) ws["D3"] = { t: "n", v: 30, f: "B3*2" };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sales & Returns");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true, bookSST }));
}
test("6A: the streaming sheet reader gives the same cells as the grid reader", async () => {
  const bytes = workbook([["Invoice", "Qty", "Item", "Note"], ["A<1>", 1.5, "Fast & \"bolt\"", true], [null, 15, "Café", null], ["A3", 1e21, "x", "y"], [], ["A6", 0.1 + 0.2, new Date(Date.UTC(2026, 0, 5)), "z"]], true, true);
  const grid = sheetGrid(bytes, "Sales & Returns"), issues: { row: number; column: string; message: string }[] = [], rows: string[][] = [], numbers: number[] = [];
  const r = await streamSheet(bytes, "Sales & Returns", (cells, row) => { rows.push(cells); numbers.push(row); }, issues);
  assert.deepEqual(rows, grid.rows); assert.deepEqual(numbers, grid.rowNumbers);
  assert.deepEqual(issues.map(i => i.message.split(";")[0]), grid.issues.map(i => i.message.split(";")[0]), "formulas and inexact numbers are reported the same way");
  assert.equal(r.issueCount, issues.length);
  assert.equal(unescapeXml("a&amp;b&#x41;&#66;_x000D_"), "a&bAB\r");
});
test("6A: a sheet over 300,000 rows is previewed from its first rows and streamed in full", async () => {
  const rows: (string | number)[][] = [["Invoice", "StockCode", "Quantity"]];
  for (let i = 1; i <= MAX_SHEET_ROWS + 100; i++) rows.push([`I${i}`, `S${i % 50}`, i % 7 + 1]);
  const bytes = workbook(rows);
  assert.throws(() => sheetGrid(bytes, "Sales & Returns"), /more than 300,000 rows/);
  const sample = await sampleSheet(bytes, "Sales & Returns");
  assert.equal(sample.rows.length, 400); assert.equal(sample.streamed.totalRows, MAX_SHEET_ROWS + 101); assert.deepEqual(sample.rows[1], ["I1", "S1", "2"]);
  const studio = new Studio(); await studio.add([new File([bytes as Uint8Array<ArrayBuffer>], "online_retail_II.xlsx")], []);
  const view = studio.state([]).files[0];
  assert.equal(view.estimatedRows, String(MAX_SHEET_ROWS + 100)); assert.ok(view.notices.some(n => n.includes("read in a stream")), view.notices.join(" / "));
  const dl = await studio.download(view.id, new AbortController().signal);
  assert.equal(dl.rows, String(MAX_SHEET_ROWS + 100), "every row is converted");
});
