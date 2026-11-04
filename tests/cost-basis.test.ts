// 5A cost basis selector: margins under invoice / last / average / replacement cost, checked against
// numbers worked out by hand (see the comment on each product).
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor } from "../lib/vault/schema";
import { REBUILD_SQL } from "../lib/margin/aggregate";
import { costBasis, basisSql, NO_CATEGORY } from "../lib/cost/basis";
import type { Engine } from "../lib/vault/engine";
async function fixture() {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(7)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(7));
  c.query(`INSERT INTO vault_meta VALUES(1,7,'starter','unit','tip',0,0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'x');
INSERT INTO customers(customer_id,tier) VALUES('C','T01');
INSERT INTO products(product_id,category,current_cost) VALUES('P1','Valves',1600),('P2','Valves',NULL),('P3','Pumps',900),('P4','Pumps',NULL),('P5','',NULL);
-- P1: dated costs 1000, 1200, 1500 -> last 1500, average 3700/3, replacement = item master 1600
-- P3: no vendor costs -> last and average unknown, replacement = item master 900
-- P4: costs 1 and 2 -> last 2, average 1.5, replacement = last (2)
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES
 ('a1','V','P1',1000,'2025-01-01','f'),('a2','V','P1',1200,'2025-02-01','f'),('a3','V','P1',1500,'2025-03-01','f'),('d1','V','P4',1,'2025-01-01','f'),('d2','V','P4',2,'2025-02-01','f');
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,line_kind) VALUES
 ('s',1,'P1','C','2025-04-01',3,6000,0,0,0,3600,2,'sale'),   -- P1 sale: qty 3, pocket 6000, invoice cost 3600
 ('s',2,'P1','C','2025-04-02',-1,-2000,0,0,0,-1200,3,'credit'), -- P1 credit: qty -1, pocket -2000, invoice cost -1200
 ('s',3,'P2','C','2025-04-03',2,5000,0,0,0,2000,4,'sale'),   -- P2: no cost under any basis except the invoice
 ('s',4,'P3','C','2025-04-04',4,8000,0,0,0,2400,5,'sale'),   -- P3: qty 4, pocket 8000, invoice cost 2400
 ('s',5,'P4','C','2025-04-05',1,10,0,0,0,1,6,'sale'),        -- P4: qty 1, pocket 10
 ('s',6,'P4','C','2025-04-06',-1,-10,0,0,0,-1,7,'credit'),
 ('s',7,'P5','C','2025-04-07',1,700,0,0,0,NULL,8,'sale');    -- P5: no category, no cost at all
${REBUILD_SQL}`);
  return { c, e: { conn: c } as unknown as Engine };
}
test("margins under each basis match the hand-calculated fixtures", async () => {
  const { c, e } = await fixture();
  try {
    const v = await costBasis(e), valves = v.groups.find(g => g.group === "Valves")!, pumps = v.groups.find(g => g.group === "Pumps")!, none = v.groups.find(g => g.group === NO_CATEGORY)!;
    // Valves = P1 (+P2). Invoice: P1 sale 6000-3600 and credit -2000+1200, P2 5000-2000 => pocket 9000, cost 4400, margin 4600.
    assert.deepEqual(valves.invoice, { pocket: "9000", cost: "4400", margin: "4600", rate: "51.11%", uncostedLines: "0" });
    // Last cost 1500: P1 net qty 2 => cost 4500-1500 = 3000 on pocket 4000 => margin 1000 (25.00%). P2 has no cost: 1 line unknown.
    assert.deepEqual(valves.last, { pocket: "4000", cost: "3000", margin: "1000", rate: "25.00%", uncostedLines: "1" });
    // Average cost 3700/3: sale 3 x = 3700, credit -1 x = round(-1233.33) = -1233 => cost 2467, margin 4000-2467 = 1533 (38.33%).
    assert.deepEqual(valves.average, { pocket: "4000", cost: "2467", margin: "1533", rate: "38.33%", uncostedLines: "1" });
    // Replacement cost 1600: 4800 - 1600 = 3200 => margin 800 (20.00%).
    assert.deepEqual(valves.replacement, { pocket: "4000", cost: "3200", margin: "800", rate: "20.00%", uncostedLines: "1" });
    // Pumps = P3 (qty 4) + P4 (sale and credit of qty 1 at pocket 10).
    // Invoice: P3 8000-2400, P4 10-1 and -10+1 => pocket 8000, cost 2400, margin 5600.
    assert.deepEqual(pumps.invoice, { pocket: "8000", cost: "2400", margin: "5600", rate: "70.00%", uncostedLines: "0" });
    // Last: P3 unknown (its 1 line left out); P4 last 2: sale cost 2, credit -2 => pocket 0, cost 0 => margin 0, rate n/a.
    assert.deepEqual(pumps.last, { pocket: "0", cost: "0", margin: "0", rate: "n/a", uncostedLines: "1" });
    // Average: P4 average 1.5 => sale round(1.5)=2, credit round(-1.5)=-2 (half away from zero) => cost 0 again; P3 unknown.
    assert.deepEqual(pumps.average, { pocket: "0", cost: "0", margin: "0", rate: "n/a", uncostedLines: "1" });
    // Replacement: P3 900 x 4 = 3600 on pocket 8000, P4 replacement = last 2 => net 0. margin 4400 (55.00%).
    assert.deepEqual(pumps.replacement, { pocket: "8000", cost: "3600", margin: "4400", rate: "55.00%", uncostedLines: "0" });
    // No category: one uncosted line under every basis, including the invoice.
    assert.deepEqual(none.invoice, { pocket: "0", cost: "0", margin: "0", rate: "n/a", uncostedLines: "1" });
    for (const k of ["last", "average", "replacement"] as const) assert.equal(none[k].uncostedLines, "1");
    // Totals add up group by group; nothing is costed at zero silently.
    assert.equal(v.total.last.margin, "1000"); assert.equal(v.total.replacement.margin, String(800 + 4400)); assert.equal(v.total.invoice.margin, "10200");
    assert.equal(v.total.lines, "7");
  } finally { c.close(); }
});
test("the chosen basis is stored per group and drives the selected margin; clearing it returns to invoice cost", async () => {
  const { c, e } = await fixture();
  try {
    c.query(basisSql("Valves", "average")); c.query(basisSql(NO_CATEGORY, "replacement"));
    let v = await costBasis(e);
    const valves = v.groups.find(g => g.group === "Valves")!;
    assert.equal(valves.selected, "average"); assert.equal(valves.selectedMargin, "1533"); assert.equal(valves.selectedRate, "38.33%");
    assert.equal(v.groups.find(g => g.group === "Pumps")!.selected, null); assert.equal(v.groups.find(g => g.group === "Pumps")!.selectedMargin, "5600"); // default: invoice cost
    assert.equal(q(c, "SELECT product_group FROM cost_basis_settings WHERE basis='replacement'")[0].product_group, ""); // "(No category)" is stored as the empty category
    assert.equal(v.total.selectedMargin, String(1533 + 5600 + 0));
    c.query(basisSql("Valves", null));
    v = await costBasis(e); assert.equal(v.groups.find(g => g.group === "Valves")!.selected, null);
    assert.throws(() => basisSql("Valves", "fifo" as never), /last, average or replacement/); assert.throws(() => basisSql("", "last"), /product group/);
  } finally { c.close(); }
});
