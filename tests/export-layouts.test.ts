// Roadmap 15.6: a workspace's own ERP export layout (column editor), checked in the worker and stored in the vault.
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as layouts from "../lib/pricing/layouts";
import type { Receipt } from "../lib/pricing/market";

const spec = (extra: Partial<layouts.LayoutSpec> = {}): layouts.LayoutSpec => ({ name: "Acme ERP", columns: [{ header: "ItemNo", field: "product_id" }, { header: "PriceGroup", field: "tier" }, { header: "Amount", field: "price" }, { header: "ValidFrom", field: "effective_from" }, { header: "Company", field: "constant", value: "01" }], delimiter: ";", decimal: "comma", date: "DD.MM.YYYY", header: true, ...extra });
const receipt: Receipt = { headers: [], currency: "EUR", rows: [
  { product: "SKU-1", category: "", customer: "", tier: "T1", quantity: "0.0000", from: "2026-12-01", to: "", kind: "matrix", price: "1250" },
  { product: "=CMD()", category: "", customer: "", tier: "T;2", quantity: "0.0000", from: "2026-12-01", to: "2027-01-31", kind: "matrix", price: "100005" },
] };

test("15.6 a layout needs a name, 1 to 30 distinct headed columns with product and price, and consistent file options", () => {
  assert.deepEqual(layouts.checkLayout(spec()), spec());
  assert.throws(() => layouts.checkLayout({ ...spec(), name: " " }), /Check the layout/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: [] }), /Check the layout/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: Array.from({ length: 31 }, (_, i) => ({ header: "H" + i, field: i ? "tier" : "product_id" })) }), /Check the layout/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: [{ header: "A", field: "product_id" }, { header: "a", field: "price" }] }), /same header/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: [{ header: "A", field: "product_id" }, { header: "B", field: "tier" }] }), /product and the price/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: [{ header: "A", field: "product_id" }, { header: "B", field: "cost" as never }] }), /Check the layout/, "only exported fields");
  assert.throws(() => layouts.checkLayout({ ...spec(), delimiter: ",", decimal: "comma" }), /comma separator/);
  assert.throws(() => layouts.checkLayout({ ...spec(), date: "YY/MM/DD" as never }), /Check the layout/);
  assert.throws(() => layouts.checkLayout({ ...spec(), columns: [{ header: "A\u0007", field: "product_id" }, { header: "B", field: "price" }] }), /Check the layout/);
});

test("15.6 the file is the receipt's prices in the layout's order, formats and separator; cells stay formula-safe", async () => {
  assert.deepEqual(layouts.layoutTable(spec(), receipt), [["ItemNo", "PriceGroup", "Amount", "ValidFrom", "Company"], ["SKU-1", "T1", "12,50", "01.12.2026", "01"], ["'=CMD()", "T;2", "1000,05", "01.12.2026", "01"]]);
  assert.deepEqual(layouts.layoutTable(spec({ header: false, decimal: "dot", delimiter: "\t", date: "YYYYMMDD" }), receipt)[0], ["SKU-1", "T1", "12.50", "20261201", "01"]);
  assert.equal(layouts.formatDate("2026-03-04", "MM/DD/YYYY"), "03/04/2026");
  const csv = new TextDecoder().decode(await layouts.layoutFile(spec(), receipt, "csv").blob.arrayBuffer());
  assert.equal(csv.split("\r\n")[2], "'=CMD();\"T;2\";1000,05;01.12.2026;01", "a cell holding the separator is quoted");
  const file = layouts.layoutFile(spec(), receipt, "xlsx"); assert.equal(file.name, "rebatehq-acme-erp-prices.xlsx");
  assert.equal(XLSX.utils.sheet_to_json<string[]>(XLSX.read(new Uint8Array(await file.blob.arrayBuffer())).Sheets.Prices, { header: 1 }).length, 3);
});

test("15.6 layouts are stored in the vault; names are unique; edit and delete by id", async () => {
  const c = await duckdbConnection(); c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t); c.query(schemaSql(SCHEMA_VERSION));
  const e = { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine;
  try {
    const a = await layouts.saveSql(e, spec(), undefined, "owner", "2026-11-22T00:00:00Z"); c.query(a.sql);
    assert.deepEqual((await layouts.layouts(e)).map(l => [l.name, l.columns.length, l.updatedBy]), [["Acme ERP", 5, "owner"]]);
    await assert.rejects(layouts.saveSql(e, spec({ name: "acme erp" }), undefined, "owner", "t"), /already has this name/);
    const b = await layouts.saveSql(e, spec({ name: "Acme ERP v2" }), a.id, "owner", "t"); c.query(b.sql); assert.equal(b.id, a.id);
    assert.deepEqual((await layouts.layouts(e)).map(l => l.name), ["Acme ERP v2"]);
    await assert.rejects(layouts.saveSql(e, spec(), "missing", "owner", "t"), /Check the layout/);
    c.query(await layouts.deleteSql(e, a.id)); assert.equal((await layouts.layouts(e)).length, 0);
  } finally { c.close(); }
});
