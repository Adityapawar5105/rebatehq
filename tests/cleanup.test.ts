// 5A item master cleanup: every fix has an undo, uses real DuckDB SQL, and units follow the Chunk 2A rules.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import { REBUILD_SQL } from "../lib/margin/aggregate";
import { plan, scan, undoPlan, history } from "../lib/cleanup/item-master";
import { canonicalUnit, convertQuantity } from "../lib/cleanup/uom";
import { removeChildrenSql } from "../lib/studio/load";
import type { Engine } from "../lib/vault/engine";
const LINE = (id: number, product: string, cost: string, qty = 1) => `('s',${id},'${product}','C','2025-01-0${id}',${qty},1000,100,0,0,${cost},${id + 1})`;
async function vault() {
  const c = await duckdbConnection(); // the test DuckDB is shared by every connection, so start each test from an empty schema
  for (const table of [...tablesFor(7)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query("DROP TABLE IF EXISTS md_cleanup_lines"); c.query(schemaSql(7));
  c.query(`INSERT INTO vault_meta VALUES(1,7,'starter','unit','tip',0,0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'x'),('m','items.csv','item_master',1,'x');
INSERT INTO customers(customer_id,tier) VALUES('C','T01');
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,source_id,source_row) VALUES
 ('AB-100','','','EA',NULL,NULL,NULL,NULL),('ab-100','Brass valve','Valves','Each',600,1000,'m',2),('AB-100 ','', '', 'ea',NULL,NULL,NULL,NULL),
 ('PX-1','','Pumps','EA',NULL,NULL,NULL,NULL),('PX-2','','Pumps','EA',NULL,NULL,NULL,NULL),('PX-3','','Pumps','EA',NULL,NULL,NULL,NULL),('PX-4','','','EA',NULL,NULL,NULL,NULL),('PX-5','','','Bx',NULL,NULL,NULL,NULL),
 ('ZZ-1','','','Furlong',NULL,NULL,NULL,NULL),('QQ-1','','Misc','',NULL,NULL,NULL,NULL),('LONE','','','EA',NULL,NULL,NULL,NULL);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES
 ${LINE(1, "AB-100", "500")},${LINE(2, "ab-100", "500")},${LINE(3, "ab-100", "NULL")},${LINE(4, "AB-100 ", "500")},${LINE(5, "PX-1", "400")};
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('v1','S','ab-100',600,'2025-01-01','f'),('v2','S','AB-100',650,'2025-02-01','f');
INSERT INTO price_matrix(id,product_id,tier,price,valid_from) VALUES('p1','AB-100 ','T01',1000,'2025-01-01');
${REBUILD_SQL}`);
  return { c, e: { conn: c } as unknown as Engine };
}
const snapshot = (c: Awaited<ReturnType<typeof duckdbConnection>>) => JSON.stringify({
  lines: q(c, "SELECT line_id, product_id, cost_cents, quantity, list_cents FROM sales_lines ORDER BY line_id"),
  products: q(c, "SELECT * FROM products ORDER BY product_id"), vendor: q(c, "SELECT id, product_id FROM vendor_costs ORDER BY id"), price: q(c, "SELECT id, product_id FROM price_matrix ORDER BY id"),
});
async function run(c: Awaited<ReturnType<typeof duckdbConnection>>, e: Engine, kind: "merge_duplicates" | "normalize_uom" | "set_category", key: string, target: string | null = null) {
  const p = await plan(e, kind, key, target, "owner-1", "2025-03-01T00:00:00.000Z");
  c.query(`BEGIN; ${p.sql} COMMIT`); if (p.finishSql) c.query(`BEGIN; ${p.finishSql} COMMIT`); c.query(REBUILD_SQL);
  return p;
}
const undo = async (c: Awaited<ReturnType<typeof duckdbConnection>>, e: Engine, id: string) => { const u = await undoPlan(e, id, "owner-1", "2025-03-02T00:00:00.000Z"); c.query(`BEGIN; ${u.sql} COMMIT`); c.query(REBUILD_SQL); return u; };

test("unit rules: spelling variants unify, unknown or blank units are never guessed, conversions round to four decimals", () => {
  assert.equal(canonicalUnit("Each"), "EA"); assert.equal(canonicalUnit(" cs. "), "CS"); assert.equal(canonicalUnit("Boxes"), "BX"); assert.equal(canonicalUnit("PCS"), "PC");
  assert.notEqual(canonicalUnit("PC"), canonicalUnit("EA")); // different meaning: a registered conversion is needed
  assert.equal(canonicalUnit("Furlong"), null); assert.equal(canonicalUnit(""), null); assert.equal(canonicalUnit(null), null);
  const rules = [{ from: "CS", to: "EA", factor: "12" }, { from: "EA", to: "PC", factor: "1" }];
  assert.equal(convertQuantity("10", "CS", "EA", rules), "120.0000"); // direct
  assert.equal(convertQuantity("120", "EA", "CS", rules), "10.0000"); // reverse of a registered pair
  assert.equal(convertQuantity("1", "EA", "CS", rules), "0.0833"); // 1/12 = 0.08333.. -> 4 decimals
  assert.equal(convertQuantity("5", "each", "EA", rules), "5.0000"); // same unit
  assert.equal(convertQuantity("0.0001", "CS", "EA", [{ from: "CS", to: "EA", factor: "0.5" }]), "0.0001"); // 0.00005 rounds half away from zero
  assert.equal(convertQuantity("-0.0001", "CS", "EA", [{ from: "CS", to: "EA", factor: "0.5" }]), "-0.0001");
  assert.equal(convertQuantity("3", "CS", "BX", rules), null); // no conversion: never guessed
  assert.equal(convertQuantity("3", "", "EA", rules), null); assert.equal(convertQuantity("3", "CS", undefined, rules), null); // missing is not EA
  assert.equal(convertQuantity("3", "Furlong", "EA", rules), null);
  assert.equal(convertQuantity("3", "CS", "EA", [{ from: "CS", to: "EA", factor: "0" }]), null);
});
test("scan finds look-alike IDs, odd unit spellings and uncategorised products, with evidence-based category suggestions", async () => {
  const { c, e } = await vault();
  try {
    const s = await scan(e);
    assert.equal(s.duplicates.length, 1);
    const g = s.duplicates[0];
    assert.equal(g.members.length, 3); assert.equal(g.confidence, "certain"); // AB-100, ab-100, "AB-100 " differ by case/space only
    assert.equal(g.canonical, "ab-100"); // most lines (2) and from the item master
    assert.equal(g.lines, "4");
    const byFrom = Object.fromEntries(s.units.map(u => [u.from, u]));
    assert.deepEqual(Object.keys(byFrom).sort(), ["", "Bx", "Each", "Furlong", "ea"]);
    assert.equal(byFrom.Each.to, "EA"); assert.equal(byFrom.Bx.to, "BX"); assert.equal(byFrom.Furlong.to, null); assert.equal(byFrom.Furlong.kind, "unknown"); assert.equal(byFrom[""].kind, "missing");
    const px = s.categories.find(x => x.key === "PX")!;
    assert.equal(px.products, "2"); assert.equal(px.suggestion, "Pumps"); assert.equal(px.support, "3"); // 3 of 3 categorised PX products agree
    const ab = s.categories.find(x => x.key === "AB");
    assert.equal(ab?.suggestion ?? null, null); // only one categorised AB product: not enough evidence
    assert.ok(!s.categories.some(x => x.key === "LONE" && x.suggestion));
  } finally { c.close(); }
});
test("merge duplicates re-points lines, costs and prices, fills the kept product, and undo restores every cell", async () => {
  const { c, e } = await vault();
  try {
    const before = snapshot(c), sumBefore = q(c, "SELECT sum(list_cents-discount_cents) AS pocket, sum(cost_cents) AS cost, count(*) AS n FROM sales_lines")[0];
    const p = await run(c, e, "merge_duplicates", "AB100");
    assert.match(p.summary, /Merge 2 look-alike product IDs/); assert.equal(p.cells, 6); // 2 invoice lines + 1 vendor cost + 1 price row + 2 duplicate product rows
    assert.deepEqual(q(c, "SELECT DISTINCT product_id FROM sales_lines WHERE line_id<=4").map(r => r.product_id), ["ab-100"]);
    assert.deepEqual(q(c, "SELECT product_id FROM products WHERE upper(trim(product_id))='AB-100'").map(r => r.product_id), ["ab-100"]);
    assert.deepEqual(q(c, "SELECT DISTINCT product_id FROM vendor_costs").map(r => r.product_id), ["ab-100"]);
    assert.deepEqual(q(c, "SELECT product_id FROM price_matrix").map(r => r.product_id), ["ab-100"]);
    // Invoice facts never change: same lines, same totals, same cost.
    assert.deepEqual(q(c, "SELECT sum(list_cents-discount_cents) AS pocket, sum(cost_cents) AS cost, count(*) AS n FROM sales_lines")[0], sumBefore);
    assert.equal(q(c, "SELECT lines FROM agg_p WHERE product_id='ab-100' AND line_kind='sale'")[0].lines, "4"); // the pre-aggregate follows the merge
    assert.equal(q(c, "SELECT count(*) AS n FROM cleanup_changes WHERE fix_id='" + p.fixId + "' AND tbl='sales_lines'")[0].n, "2");
    const u = await undo(c, e, p.fixId);
    assert.equal(u.skipped, 0); assert.equal(snapshot(c), before); // identical to the original, cell for cell
    assert.equal(q(c, "SELECT lines FROM agg_p WHERE product_id='AB-100 ' AND line_kind='sale'")[0].lines, "1");
    await assert.rejects(undoPlan(e, p.fixId, "owner-1", "x"), /already undone/);
    assert.equal(q(c, "SELECT count(*) AS n FROM cleanup_fixes WHERE undone_at IS NOT NULL")[0].n, "1");
  } finally { c.close(); }
});
test("merge fills empty fields of the kept product from the duplicates and undo takes them back", async () => {
  const { c, e } = await vault();
  try {
    c.query("UPDATE products SET description='', category='', current_cost=NULL, list_price=NULL WHERE product_id='ab-100'; UPDATE products SET description='Brass valve 1in', category='Valves', current_cost=555 WHERE product_id='AB-100 '");
    const before = snapshot(c);
    const p = await run(c, e, "merge_duplicates", "AB100");
    const kept = q(c, "SELECT description, category, current_cost, list_price FROM products WHERE product_id='ab-100'")[0];
    assert.deepEqual(kept, { description: "Brass valve 1in", category: "Valves", current_cost: "555", list_price: null });
    const u = await undo(c, e, p.fixId); assert.equal(u.skipped, 0); assert.equal(snapshot(c), before);
  } finally { c.close(); }
});
test("Phase 16 audit: a merge moves a duplicate's barcode to the kept item, and undo puts every barcode back", async () => {
  const { c, e } = await vault();
  try {
    c.query("ALTER TABLE products ADD COLUMN barcode VARCHAR"); // vault v22
    c.query("UPDATE products SET barcode='012345678905' WHERE product_id='AB-100 '; UPDATE products SET barcode='036000291452' WHERE product_id='AB-100'");
    const barcodes = () => JSON.stringify(q(c, "SELECT product_id, barcode FROM products WHERE barcode IS NOT NULL ORDER BY product_id"));
    const before = barcodes();
    const p = await run(c, e, "merge_duplicates", "AB100");
    const kept = q(c, "SELECT barcode FROM products WHERE product_id='ab-100'")[0].barcode;
    assert.ok(["012345678905", "036000291452"].includes(String(kept)), "the kept item has no barcode after the merge");
    const u = await undo(c, e, p.fixId); assert.equal(u.skipped, 0); assert.equal(barcodes(), before, "undo lost a barcode");
  } finally { c.close(); }
});
test("Phase 16 audit: removing an item file clears the barcodes it supplied, like its other fields", async () => {
  const c = await duckdbConnection();
  for (const table of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query("DROP VIEW IF EXISTS rebate_sales"); c.query(schemaSql(SCHEMA_VERSION));
  try {
    c.query("INSERT INTO source_files VALUES('m','items.csv','item_master',1,'x'); INSERT INTO products(product_id,description,source_id,source_row,barcode) VALUES('ab-100','Brass valve','m',2,'012345678905')");
    assert.ok(!removeChildrenSql("m").includes("barcode"), "older vaults have no barcode column");
    c.query(`BEGIN; ${removeChildrenSql("m", false, false, false, false, true)} COMMIT`);
    assert.deepEqual(q(c, "SELECT description, barcode, source_id FROM products WHERE product_id='ab-100'")[0], { description: "", barcode: null, source_id: null });
  } finally { c.close(); }
});
test("undo restores only cells still holding the fix's value and reports what it left alone", async () => {
  const { c, e } = await vault();
  try {
    const p = await run(c, e, "normalize_uom", "Each"); // one product stored as "Each"
    assert.equal(q(c, "SELECT uom FROM products WHERE product_id='ab-100'")[0].uom, "EA");
    c.query("UPDATE products SET uom='CS' WHERE product_id='ab-100'"); // someone edited it afterwards
    const u = await undo(c, e, p.fixId);
    assert.equal(u.restored, 0); assert.equal(u.skipped, 1);
    assert.equal(q(c, "SELECT uom FROM products WHERE product_id='ab-100'")[0].uom, "CS"); // the later edit survives
    const p2 = await run(c, e, "normalize_uom", "ea"); assert.equal(p2.cells, 1);
    const u2 = await undo(c, e, p2.fixId); assert.equal(u2.restored, 1); assert.equal(q(c, "SELECT uom FROM products WHERE product_id='AB-100 '")[0].uom, "ea");
  } finally { c.close(); }
});
test("unit and category fixes are exact, never guess, validate input, and undo cleanly", async () => {
  const { c, e } = await vault();
  try {
    const before = snapshot(c);
    await assert.rejects(plan(e, "normalize_uom", "Furlong", null, "o", "t"), /never guessed/); // unknown unit needs an explicit choice
    await assert.rejects(plan(e, "normalize_uom", "Furlong", "XX", "o", "t"), /never guessed/); // and only a known unit
    const f = await run(c, e, "normalize_uom", "Furlong", "FT"); assert.equal(q(c, "SELECT uom FROM products WHERE product_id='ZZ-1'")[0].uom, "FT");
    const m = await run(c, e, "normalize_uom", "", "EA"); assert.equal(q(c, "SELECT uom FROM products WHERE product_id='QQ-1'")[0].uom, "EA"); // a blank unit is chosen, not assumed
    await assert.rejects(plan(e, "set_category", "AB", null, "o", "t"), /not enough evidence/);
    await assert.rejects(plan(e, "set_category", "PX", "x\u0001", "o", "t"), /control characters/);
    const k = await run(c, e, "set_category", "PX"); // suggestion: Pumps
    assert.deepEqual(q(c, "SELECT product_id, category FROM products WHERE product_id LIKE 'PX-%' ORDER BY 1").map(r => r.category), ["Pumps", "Pumps", "Pumps", "Pumps", "Pumps"]);
    await assert.rejects(plan(e, "merge_duplicates", "NOPE", null, "o", "t"), /no longer exists/);
    const h = await history(e); assert.equal(h.length, 3); assert.ok(h.every(x => x.undoneAt === null));
    for (const x of [k, m, f]) await undo(c, e, x.fixId);
    assert.equal(snapshot(c), before);
  } finally { c.close(); }
});
test("a failed second step of a merge leaves the data valid and the merge can be finished", async () => {
  const { c, e } = await vault();
  try {
    const p = await plan(e, "merge_duplicates", "AB-100".replace("-", ""), null, "o", "2025-03-01T00:00:00.000Z");
    c.query(`BEGIN; ${p.sql} COMMIT`); // first transaction only: duplicates are unreferenced but still present
    assert.equal(q(c, "SELECT count(*) AS n FROM sales_lines WHERE product_id IN ('AB-100','AB-100 ')")[0].n, "0");
    assert.equal(q(c, "SELECT count(*) AS n FROM products WHERE upper(trim(product_id))='AB-100'")[0].n, "3");
    c.query(REBUILD_SQL);
    const again = await run(c, e, "merge_duplicates", "AB100"); // finishes it
    assert.equal(q(c, "SELECT count(*) AS n FROM products WHERE upper(trim(product_id))='AB-100'")[0].n, "1");
    assert.ok(again.cells >= 2);
    const u = await undo(c, e, p.fixId); // undo of the first fix still works when the rows were never removed
    assert.ok(u.restored >= 3);
    assert.equal(q(c, "SELECT count(*) AS n FROM products WHERE upper(trim(product_id))='AB-100'")[0].n, "3");
  } finally { c.close(); }
});
