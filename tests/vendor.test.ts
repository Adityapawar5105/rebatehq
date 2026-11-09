// Chunk 7E-1: vendor price review and purchase price variance, run in DuckDB on a fixture whose every answer
// is worked out by hand in the comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duckdbConnection } from './helpers/duckdb-node';
import { schemaSql, TABLES, SCHEMA_VERSION } from '../lib/vault/schema';
import type { Engine } from '../lib/vault/engine';
import { VaultError } from '../lib/vault/protocol';
import { vendorSheets, vendorReview, vendorReviewQuotes, ppv, ppvLines, REVIEW_GRID, PPV_GRID } from '../lib/vendor/review';
import { ACTION_CAP } from '../lib/roles/access';
import { READ_ONLY_ACTIONS } from '../lib/vault/licence';
import { capsFor, sectionsFor } from '../lib/roles/access';

async function vault() {
  const c = await duckdbConnection();
  c.query('DROP VIEW IF EXISTS rebate_sales');
  for (const t of [...TABLES].reverse()) c.query('DROP TABLE IF EXISTS ' + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
INSERT INTO source_files VALUES('old','costs-jan.csv','vendor_cost',1,'2026-01-02'),('new','costs-mar.csv','vendor_cost',1,'2026-03-02'),('apr','costs-apr.csv','vendor_cost',1,'2026-04-02'),('sales','sales.csv','sales_history',1,'2026-03-05'),('po','po.csv','sales_history',1,'2026-03-05');
INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('A','Valve','Valves',600,1000),('B','Pump','Pumps',1000,2000),('D','Hose','Hoses',NULL,90),('E','Seal','Valves',40,90),('F','Gauge','Valves',300,500);
INSERT INTO customers(customer_id) VALUES('C1');
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file,source_id,source_row) VALUES
 ('o1','V','A',500,'2026-01-01','costs-jan.csv','old',2),('o2','V','B',1000,'2026-01-01','costs-jan.csv','old',3),('o3','V','F',300,'2026-03-01','costs-jan.csv','old',4),
 ('a1','V','E',45,'2026-04-01','costs-apr.csv','apr',2),
 ('n1','V','A',550,'2026-03-01','costs-mar.csv','new',2),('n2','V','B',1000,'2026-03-01','costs-mar.csv','new',3),('n3','V','Z',100,'2026-03-01','costs-mar.csv','new',4),
 ('n4','V','D',70,'2026-03-01','costs-mar.csv','new',5),('n5','V','E',42,'2026-03-01','costs-mar.csv','new',6),('n6','V','F',310,'2026-03-01','costs-mar.csv','new',7);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES
 ('sales',1,'A','C1','2026-03-01',4,4000,0,0,0,2400,2),('sales',2,'A','C1','2025-01-01',100,100000,0,0,0,60000,3);
INSERT INTO rules VALUES('r1','Valve pass-through','{"name":"Valve pass-through","category":"Valves","vendor":"V","threshold":"500","increase":"450"}','Valves','2026-01-01');
INSERT INTO rule_revisions VALUES('r1',1,'{"name":"Valve pass-through","category":"Valves","vendor":"V","threshold":"500","increase":"450"}','x','2026-01-01');
INSERT INTO quotes(id,number,customer_id,status,created_by,created_at,updated_at) VALUES('q1','Q-1','C1','pending','u','2026-03-01','2026-03-01'),('q2','Q-2','C1','approved','u','2026-03-01','2026-03-01');
INSERT INTO quote_lines(quote_id,line_no,product_id,quantity,unit_price_cents,price_source,guard_status,cost_cents) VALUES('q1',1,'A',10,900,'list','green',500),('q2',1,'A',10,900,'list','green',500);
INSERT INTO purchases(source_id,line_id,receipt_ref,supplier,product_id,receipt_date,quantity,amount_cents,entry_kind,uom,source_row) VALUES
 ('po',1,'R-1','V','A','2026-02-01',10,5000,'receipt','EA',2),('po',2,'R-2','W','A','2026-02-10',5,3000,'receipt','EA',3),('po',3,'R-3','V','A','2026-02-20',-2,-1000,'return','EA',4),
 ('po',4,'R-4','V','B','2026-02-01',3,3000,'receipt','EA',5),('po',5,'R-5','V','Q','2026-02-01',1,100,'receipt','EA',6)`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;

test('7E-1 lists supplier cost sheets with their line and vendor counts', async () => {
  const { c, e } = await vault();
  try {
    const sheets = await vendorSheets(e);
    assert.deepEqual(sheets.map(s => [s.id, s.lines, s.vendors]), [['apr', '1', '1'], ['new', '6', '1'], ['old', '3', '1']]);
  } finally { c.close(); }
});

test('7E-1 vendor review: previous cost, change, conflicts, margin effect, quotes and rules, exactly', async () => {
  const { c, e } = await vault();
  try {
    const r = await vendorReview(e, 'new', 365);
    const by = Object.fromEntries(r.rows.map(x => [x.product_id, x]));
    // A: 500 (Jan, vendor V) to 550 = +50, +10.00%. Recent volume 4 (the 100-unit line is over a year older than
    // the latest invoice), so the margin effect is -(50 x 4) = -200. One open quote; the 5% Valves rule triggers.
    assert.deepEqual([by.A.previous_cost, by.A.change, by.A.change_pct, by.A.status, by.A.volume, by.A.margin_impact, by.A.open_quotes, by.A.rules],
      ['500', '50', '10.00', 'increase', '4.0000', '-200', '1', 'Valve pass-through']);
    assert.equal(by.B.status, 'unchanged'); assert.equal(by.B.change, '0');
    assert.equal(by.Z.status, 'unknown_sku', 'a SKU missing from the item master is flagged');
    assert.equal(by.D.status, 'first_cost', 'no earlier vendor cost and no item cost: nothing to compare');
    assert.equal(by.E.status, 'backdated', 'a later cost (April) is already on file');
    assert.equal(by.F.status, 'conflict', 'another file has a different cost on the same date');
    assert.deepEqual(r.totals, { lines: '6', increases: '1', decreases: '0', conflicts: '3', firstCosts: '1', marginImpact: '-200', ruleLines: '1', quotes: '1' });
    // E (backdated) still compares with the item cost 40 (no earlier vendor cost): 42 - 40 = +2 x 0 volume.
    assert.equal(by.E.previous_cost, null); assert.equal(by.E.change, '2');
    // F compares with the vendor's previous cost before 2026-03-01 (none) then the item cost 300: +10, with no sales.
    // Only A has recent sales, so the sheet's margin effect is A's -200; the sum of the rows agrees.
    const sum = r.rows.reduce((s, x) => s + BigInt(x.margin_impact ?? '0'), BigInt(0));
    assert.equal(r.totals.marginImpact, String(sum));
    const filtered = await vendorReview(e, 'new', 365, 0, { filters: [{ col: 'status', values: ['conflict', 'backdated', 'unknown_sku'] }], sort: { col: 'product_id', dir: 'desc' } });
    assert.deepEqual(filtered.rows.map(x => x.product_id), ['Z', 'F', 'E']); assert.equal(filtered.grid.matched, '3');
    await assert.rejects(vendorReview(e, 'sales', 365), code('VENDOR'), 'only vendor cost sheets can be reviewed');
    await assert.rejects(vendorReview(e, 'new', 30), code('VENDOR'));
    await assert.rejects(vendorReview(e, 'new', 365, 0, { sort: { col: 'id', dir: 'asc' } }), code('FILTER'));
  } finally { c.close(); }
});

test('7E-1 affected open quotes show the margin at the quoted price before and after the new cost', async () => {
  const { c, e } = await vault();
  try {
    const q = await vendorReviewQuotes(e, 'new');
    // Only the pending quote counts (Q-2 is approved). (900 - 500) x 10 = 4,000 before; (900 - 550) x 10 = 3,500 after.
    assert.deepEqual(q.rows.map(r => [r.number, r.product_id, r.quote_cost, r.new_cost, r.margin_before, r.margin_after]), [['Q-1', 'A', '500', '550', '4000', '3500']]);
  } finally { c.close(); }
});

test('7E-1 purchase price variance: unit range, suppliers, weighted average and variance to standard, to the cent', async () => {
  const { c, e } = await vault();
  try {
    const p = await ppv(e);
    const a = p.rows.find(r => r.product_id === 'A')!;
    // Receipts 10 @ 5,000 (500/unit) from V and 5 @ 3,000 (600/unit) from W; a return of 2 for -1,000.
    // Net qty 13, net spend 7,000; standard 600: variance 7,000 - 7,800 = -800. Average receipt unit 8,000/15 = 533.33 -> 533.
    assert.deepEqual([a.receipts, a.suppliers, a.quantity, a.spend, a.min_unit, a.max_unit, a.spread, a.avg_unit, a.standard, a.variance],
      ['2', '2', '13.0000', '7000', '500', '600', '100', '533', '600', '-800']);
    const q = p.rows.find(r => r.product_id === 'Q')!;
    assert.equal(q.variance, null, 'no item master cost: no standard, no variance');
    assert.deepEqual(p.totals, { skus: '3', multiSupplier: '1', spread: '1', variance: String(-800 + 0), noStandard: '1' });
    const feb = await ppv(e, { from: '2026-02-05', to: '2026-02-28' });
    assert.deepEqual(feb.rows.map(r => [r.product_id, r.quantity, r.spend]), [['A', '3.0000', '2000']]);
    const lines = await ppvLines(e, 'A', {}, 0, { sort: { col: 'receipt_date', dir: 'asc' } });
    assert.deepEqual(lines.rows.map(r => [r.supplier, r.entry_kind, r.unit, r.variance]), [['V', 'receipt', '500', '-1000'], ['W', 'receipt', '600', '0'], ['V', 'return', null, '200']]);
    await assert.rejects(ppv(e, { from: 'yesterday' }), code('VENDOR'));
  } finally { c.close(); }
});

test('7E-1 vendor commands need cost, are read-only, and the Vendors section is not shown to a Sales Rep', () => {
  for (const a of ['vendorSheets', 'vendorReview', 'vendorReviewQuotes', 'vendorPpv', 'vendorPpvLines'] as const) { assert.equal(ACTION_CAP[a], 'cost'); assert.ok(READ_ONLY_ACTIONS.has(a)); }
  assert.ok(!sectionsFor(capsFor('sales_rep', false)).includes('Vendors'));
  assert.ok(sectionsFor(capsFor('pricing_manager', false)).includes('Vendors'));
  assert.ok('margin_impact' in REVIEW_GRID && 'variance' in PPV_GRID);
});
