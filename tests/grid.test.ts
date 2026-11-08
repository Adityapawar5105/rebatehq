// Chunk 7V-3a: the grid standard (blueprint v2.5, section 22 items 26-27). Sort, multi-value filter and the
// selection totals are exact (no floating point, no formula evaluation), worker grids sort and filter over the
// whole result with only code-defined column names, and no grid exposes a column a role cannot see.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duckdbConnection } from './helpers/duckdb-node';
import { schemaSql, TABLES, SCHEMA_VERSION } from '../lib/vault/schema';
import type { Engine } from '../lib/vault/engine';
import { VaultError } from '../lib/vault/protocol';
import { applyQuery, average, checkQuery, compareDecimal, distinctOf, GridInputError, totalsOf, type ClientColumn, type GridSpec } from '../lib/grid/core';
import { gridPage, memoryPage, valuesTotals } from '../lib/grid/sql';
import { expiry, EXPIRY_GRID, EXCEPTION_GRID } from '../lib/pricing/ops';
import { PROGRESS_GRID, EVIDENCE_GRID } from '../lib/rebate/store';
import { ACTION_CAP } from '../lib/roles/access';
import { READ_ONLY_ACTIONS } from '../lib/vault/licence';

async function engine() {
  const c = await duckdbConnection();
  c.query('SET autoinstall_known_extensions=false;SET autoload_known_extensions=false');
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
type Row = { id: string; name: string | null; amt: string | null; qty: string; d: string };
const ROWS: Row[] = [
  { id: 'a', name: 'Écrou', amt: '1000', qty: '1.5', d: '2026-03-01' },
  { id: 'b', name: 'bolt', amt: '-250', qty: '10', d: '2026-01-15' },
  { id: 'c', name: 'Bolt', amt: '99', qty: '2.25', d: '2025-12-31' },
  { id: 'd', name: null, amt: null, qty: '0.5', d: '2026-02-01' },
  { id: 'e', name: 'valve', amt: '100000000000000000001', qty: '9', d: '2026-01-15' },
];
const COLS: ClientColumn<Row>[] = [
  { id: 'name', type: 'text', value: r => r.name }, { id: 'amt', type: 'money', value: r => r.amt },
  { id: 'qty', type: 'decimal', value: r => r.qty }, { id: 'd', type: 'date', value: r => r.d },
];
const SPEC: GridSpec = { name: 'text', amt: 'money', qty: 'decimal', d: 'date' };
const ids = (rows: Row[]) => rows.map(r => r.id).join('');

test('7V-3a exact decimal comparison handles sign, scale, leading zeros and values beyond 2^53', () => {
  assert.equal(compareDecimal('10', '9'), 1);
  assert.equal(compareDecimal('-0.5', '0'), -1);
  assert.equal(compareDecimal('-0', '0'), 0);
  assert.equal(compareDecimal('2.50', '2.5'), 0);
  assert.equal(compareDecimal('007', '7'), 0);
  assert.equal(compareDecimal('-10', '-9'), -1);
  assert.equal(compareDecimal('100000000000000000001', '100000000000000000000'), 1);
});

test('7V-3a browser grids sort by type, keep blanks last both ways, break ties by row order and filter by value', () => {
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'amt', dir: 'asc' } }, 'en')), 'bcaed');
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'amt', dir: 'desc' } }, 'en')), 'eacbd');
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'd', dir: 'asc' } }, 'en')), 'cbeda');
  // Case- and accent-insensitive text order; equal names keep their original order (b before c).
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'name', dir: 'asc' } }, 'en')), 'bcaed');
  assert.equal(ids(applyQuery(ROWS, COLS, { filters: [{ col: 'name', values: ['bolt', null] }] }, 'en')), 'bd');
  assert.equal(ids(applyQuery(ROWS, COLS, { filters: [{ col: 'd', values: ['2026-01-15'] }], sort: { col: 'amt', dir: 'desc' } }, 'en')), 'eb');
  const list = distinctOf(ROWS, COLS, { filters: [{ col: 'name', values: ['bolt'] }, { col: 'd', values: ['2026-01-15'] }] }, 'd', 'en');
  assert.deepEqual(list.values.map(v => v.value), ['2026-01-15'], 'distinct values honour every other column filter');
  assert.deepEqual(distinctOf(ROWS, COLS, {}, 'name', 'en', 'BOL').values.map(v => v.value), ['bolt', 'Bolt']);
  assert.equal(distinctOf(ROWS, COLS, {}, 'name', 'en').values[0].value, null, 'blanks list first');
});

test('7V-3a quantity sort is numeric, not text order', () => {
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'qty', dir: 'asc' } }, 'en')), 'daceb');
  assert.equal(ids(applyQuery(ROWS, COLS, { sort: { col: 'qty', dir: 'desc' } }, 'en')), 'becad');
});

test('7V-3a averages round half away from zero at the documented places', () => {
  assert.equal(average('money', '5', '2'), '3');
  assert.equal(average('money', '-5', '2'), '-3');
  assert.equal(average('money', '4', '3'), '1');
  assert.equal(average('int', '7', '3'), '2.33');
  assert.equal(average('int', '8', '3'), '2.67');
  assert.equal(average('decimal', '1.00005', '1'), '1.0001');
  assert.equal(average('percent', '-0.00005', '1'), '-0.0001');
  assert.equal(average('money', '0', '0'), null);
  const t = totalsOf('money', ['1000', '-250', null, '99']);
  assert.deepEqual(t, { count: '3', sum: '849', avg: '283', min: '-250', max: '1000' });
  assert.deepEqual(totalsOf('decimal', ['1.5', '10', '2.25']), { count: '3', sum: '13.75', avg: '4.5833', min: '1.5', max: '10' });
});

test('7V-3a grid queries accept only the grid\'s own columns and bounded values', () => {
  assert.deepEqual(checkQuery(SPEC, { sort: { col: 'amt', dir: 'desc' }, filters: [{ col: 'name', values: ['x', null] }], totals: ['amt', 'name'] }),
    { sort: { col: 'amt', dir: 'desc' }, filters: [{ col: 'name', values: ['x', null] }], totals: ['amt'] });
  const bad = [{ sort: { col: 'cost', dir: 'asc' } }, { sort: { col: 'amt', dir: 'up' } }, { sort: { col: 'g"."amt', dir: 'asc' } },
    { filters: [{ col: 'amt', values: [1] }] }, { filters: [{ col: 'amt', values: Array(1001).fill('1') }] }, { filters: [{ col: 'amt', values: [] }, { col: 'amt', values: [] }] },
    { distinct: { col: 'toString' } }, { distinct: { col: 'amt', search: 'x'.repeat(161) } }, { totals: 'amt' }, [1], 'x'];
  for (const q of bad) assert.throws(() => checkQuery(SPEC, q), GridInputError, JSON.stringify(q).slice(0, 60));
});

test('7V-3a worker grids filter, sort, page, list distinct values and total the whole result in DuckDB', async () => {
  const { c, e } = await engine();
  try {
    c.query("CREATE OR REPLACE TABLE gt(id VARCHAR, name VARCHAR, amt BIGINT, qty DECIMAL(18,4), d DATE)");
    c.query(`INSERT INTO gt VALUES ${ROWS.filter(r => r.id !== 'e').map(r => `('${r.id}',${r.name === null ? 'NULL' : `'${r.name}'`},${r.amt ?? 'NULL'},${r.qty},'${r.d}')`).join(',')}`);
    for (let i = 0; i < 1200; i++) c.query(`INSERT INTO gt VALUES ('z${String(i).padStart(4, '0')}','item ${i}',${i},${i % 7},'2026-04-01')`);
    const base = "SELECT id,name,amt::VARCHAR AS amt,qty::VARCHAR AS qty,d::VARCHAR AS d FROM gt";
    const page = await gridPage(e, base, SPEC, { sort: { col: 'amt', dir: 'desc' }, filters: [{ col: 'd', values: ['2026-04-01'] }] }, { fallback: 'g.id', limit: 3, offset: 0 });
    assert.deepEqual(page.rows.map(r => r.amt), ['1199', '1198', '1197'], 'numeric order over the whole result, not text order');
    assert.equal(page.grid.matched, '1200'); assert.equal(page.grid.total, '1204');
    const second = await gridPage(e, base, SPEC, { sort: { col: 'amt', dir: 'asc' } }, { fallback: 'g.id', limit: 2, offset: 1 });
    assert.deepEqual(second.rows.map(r => r.id), ['z0000', 'z0001'], 'paging continues the sorted order after -250');
    const blanks = await gridPage(e, base, SPEC, { filters: [{ col: 'name', values: [null] }] }, { fallback: 'g.id', limit: 10, offset: 0 });
    assert.deepEqual(blanks.rows.map(r => r.id), ['d']);
    const quoted = await gridPage(e, base, SPEC, { filters: [{ col: 'name', values: ["x' OR '1'='1"] }] }, { fallback: 'g.id', limit: 10, offset: 0 });
    assert.equal(quoted.grid.matched, '0', 'a filter value is data, never SQL');
    const meta = await gridPage(e, base, SPEC, { filters: [{ col: 'd', values: ['2026-04-01'] }], distinct: { col: 'qty' }, totals: ['amt', 'qty'] }, { fallback: 'g.id', limit: 1, offset: 0 });
    assert.deepEqual(meta.grid.distinct!.values.map(v => [v.value, v.count]), [['0.0000', '172'], ['1.0000', '172'], ['2.0000', '172'], ['3.0000', '171'], ['4.0000', '171'], ['5.0000', '171'], ['6.0000', '171']]);
    const n = 1200, sum = (n * (n - 1)) / 2;
    assert.deepEqual(meta.grid.totals!.amt, { count: '1200', sum: String(sum), avg: '600', min: '0', max: '1199' });
    assert.equal(meta.grid.totals!.qty.sum, String([...Array(n).keys()].reduce((s, i) => s + (i % 7), 0)));
    const capped = await gridPage(e, base, SPEC, { distinct: { col: 'name' } }, { fallback: 'g.id', limit: 1, offset: 0 });
    assert.equal(capped.grid.distinct!.values.length, 500); assert.equal(capped.grid.distinct!.more, true);
    const searched = await gridPage(e, base, SPEC, { distinct: { col: 'name', search: 'ITEM 119' } }, { fallback: 'g.id', limit: 1, offset: 0 });
    assert.deepEqual(searched.grid.distinct!.values.map(v => v.value), ['item 119', 'item 1190', 'item 1191', 'item 1192', 'item 1193', 'item 1194', 'item 1195', 'item 1196', 'item 1197', 'item 1198', 'item 1199']);
    const mem = await memoryPage(e, ROWS, COLS, SPEC, { sort: { col: 'amt', dir: 'asc' }, totals: ['amt'] }, { limit: 2, offset: 0 });
    assert.deepEqual(mem.rows.map(r => r.id), ['b', 'c']);
    assert.deepEqual(mem.grid.totals!.amt, totalsOf('money', ROWS.map(r => r.amt)), 'DuckDB and the exact BigInt fallback agree');
  } finally { c.close(); }
});

test('7V-3a selection totals run in DuckDB, exactly, and refuse anything that is not a number', async () => {
  const { c, e } = await engine();
  try {
    const values = [['1000', '1.5'], ['-250', '10'], [null, '2.25'], ['99', null]];
    const [money, qty] = await valuesTotals(e, ['money', 'decimal'], values);
    assert.deepEqual(money, totalsOf('money', values.map(v => v[0])));
    assert.deepEqual(qty, totalsOf('decimal', values.map(v => v[1])));
    assert.deepEqual((await valuesTotals(e, ['money'], []))[0], { count: '0', sum: '0', avg: null, min: null, max: null });
    for (const [types, rows] of [[['money'], [['=1+1']]], [['money'], [["1'); DROP TABLE x; --"]]], [['text'], [['1']]], [['money'], [['1', '2']]], [['money'], Array(5001).fill(['1'])], [[], []]] as [unknown, unknown][])
      await assert.rejects(valuesTotals(e, types, rows), (err: unknown) => err instanceof VaultError && err.code === 'FILTER');
  } finally { c.close(); }
});

test('7V-3a a real command: contract expiry sorts and filters over every matching price row', async () => {
  const { c, e } = await engine();
  try {
    for (const t of [...TABLES].reverse()) c.query('DROP TABLE IF EXISTS ' + t);
    c.query(schemaSql(SCHEMA_VERSION));
    c.query(`INSERT INTO products(product_id,category) VALUES('A','Parts'),('B','Parts');INSERT INTO customers(customer_id,tier) VALUES('C','T');
      INSERT INTO price_matrix(id,product_id,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES
      ('m1','A','C',NULL,0,900,'2026-01-01','2026-11-20'),('m2','B',NULL,'T',5,800,'2026-01-01','2026-11-10'),('m3','A',NULL,'T',10,700,'2026-01-01','2026-12-01'),('m4','B',NULL,'T',0,600,'2026-01-01','2027-06-01')`);
    const all = await expiry(e, 30, '2026-11-08');
    assert.deepEqual(all.rows.map(r => r.id), ['m2', 'm1', 'm3']); assert.equal(all.count, '3');
    const sorted = await expiry(e, 30, '2026-11-08', 0, { sort: { col: 'quantity_break', dir: 'desc' }, filters: [{ col: 'product_id', values: ['A'] }] });
    assert.deepEqual(sorted.rows.map(r => r.id), ['m3', 'm1']); assert.equal(sorted.grid.matched, '2'); assert.equal(sorted.grid.total, '3');
    await assert.rejects(expiry(e, 30, '2026-11-08', 0, { sort: { col: 'price', dir: 'asc' } }), (err: unknown) => err instanceof VaultError && err.code === 'FILTER');
  } finally { c.close(); }
});

test('7V-3a grids reachable by a Sales Rep expose no cost or margin column, and totals are a read-only, classified command', () => {
  const costWords = /cost|margin|pocket|gap|floor/i;
  for (const [name, spec] of Object.entries({ PROGRESS_GRID })) for (const col of Object.keys(spec)) assert.doesNotMatch(col, costWords, `${name}.${col}`);
  assert.equal(ACTION_CAP.gridTotals, 'view');
  assert.ok(READ_ONLY_ACTIONS.has('gridTotals'));
  // The cost-capable grids keep their cost columns behind their commands' own capabilities.
  assert.equal(ACTION_CAP.priceExceptions, 'cost'); assert.ok('gap' in EXCEPTION_GRID);
  assert.equal(ACTION_CAP.rebateRows, 'cost'); assert.ok('accrued' in EVIDENCE_GRID);
  assert.ok('valid_to' in EXPIRY_GRID);
});
