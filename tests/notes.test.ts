// Chunk 7V-3b: freeform row notes on customers and products (blueprint v2.5, section 22 items 26-27).
// Plain text, at most 1,000 code points, kept through re-import, file removal (which says how many notes go with
// the rows it drops), item merges and their undo. The customer list and item master grids meet the grid standard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duckdbConnection, rows as q } from './helpers/duckdb-node';
import { schemaSql, upgradeSql, tablesFor, TABLES, SCHEMA_VERSION } from '../lib/vault/schema';
import type { Engine } from '../lib/vault/engine';
import { VaultError } from '../lib/vault/protocol';
import { checkNote, noteSql, customerList, productList, removalNotes, NOTE_LIMIT } from '../lib/notes/notes';
import { commitSql, removeChildrenSql, finishRemovalSql } from '../lib/studio/load';
import { plan, scan, undoPlan } from '../lib/cleanup/item-master';
import { REBUILD_SQL } from '../lib/margin/aggregate';
import { ACTION_CAP } from '../lib/roles/access';
import { READ_ONLY_ACTIONS } from '../lib/vault/licence';

type Conn = Awaited<ReturnType<typeof duckdbConnection>>;
async function vault(version = SCHEMA_VERSION) {
  const c = await duckdbConnection();
  c.query('DROP VIEW IF EXISTS rebate_sales');
  for (const t of [...TABLES].reverse()) c.query('DROP TABLE IF EXISTS ' + t);
  c.query('DROP TABLE IF EXISTS studio_affected; DROP TABLE IF EXISTS md_cleanup_lines');
  c.query(schemaSql(version));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${version},'professional','unit','tip',0)`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const LINE = (src: string, id: number, product: string, customer: string) => `('${src}',${id},'${product}','${customer}','2026-01-0${id}',1,1000,0,0,0,500,${id + 1})`;
const LINE_COLS = 'source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row';
const note = (c: Conn, table: string, key: string, id: string) => { const r = q(c, `SELECT notes FROM ${table} WHERE ${key}='${id}'`)[0]; return r === undefined ? 'missing row' : r.notes; };
const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;

test('7V-3b schema v15 adds an empty note to every existing customer and product, and nothing else', async () => {
  const { c } = await vault(14);
  try {
    c.query(`INSERT INTO products(product_id,description) VALUES('P1','Valve');INSERT INTO customers(customer_id,name) VALUES('C1','Acme')`);
    const before = q(c, 'SELECT product_id, description FROM products');
    c.query(upgradeSql(14));
    assert.deepEqual(q(c, 'SELECT product_id, description FROM products'), before);
    assert.equal(note(c, 'products', 'product_id', 'P1'), null); assert.equal(note(c, 'customers', 'customer_id', 'C1'), null);
    assert.equal(SCHEMA_VERSION, 16); assert.equal(tablesFor(15).length, 45);
  } finally { c.close(); }
});

test('7V-3b a note is plain text of at most 1,000 code points; an empty note is no note', () => {
  assert.equal(checkNote('  Call before quoting\r\nNet 30  '), 'Call before quoting\nNet 30');
  assert.equal(checkNote('   '), null); assert.equal(checkNote(''), null);
  assert.equal(checkNote('😀'.repeat(NOTE_LIMIT)), '😀'.repeat(NOTE_LIMIT), 'an emoji counts as one character');
  assert.equal(checkNote('é'.repeat(NOTE_LIMIT)), 'é'.repeat(NOTE_LIMIT));
  for (const bad of ['x'.repeat(NOTE_LIMIT + 1), '😀'.repeat(NOTE_LIMIT + 1), 'bell\u0007', 'nul\u0000', 42, null, undefined, { text: 'x' }])
    assert.throws(() => checkNote(bad), code('NOTE'), String(bad).slice(0, 20));
});

test('7V-3b saving a note stores the text literally, refuses unknown rows and kinds, and clears with an empty note', async () => {
  const { c, e } = await vault();
  try {
    c.query(`INSERT INTO products(product_id) VALUES('P1');INSERT INTO customers(customer_id) VALUES('C1')`);
    const text = "O'Brien's =SUM(A1) <b>not html</b> 100%";
    c.query(await noteSql(e, 'product', 'P1', text));
    assert.equal(note(c, 'products', 'product_id', 'P1'), text);
    c.query(await noteSql(e, 'customer', 'C1', 'Prefers email'));
    assert.equal(note(c, 'customers', 'customer_id', 'C1'), 'Prefers email');
    c.query(await noteSql(e, 'customer', 'C1', '  '));
    assert.equal(note(c, 'customers', 'customer_id', 'C1'), null);
    await assert.rejects(noteSql(e, 'product', 'NOPE', 'x'), code('NOTE'));
    await assert.rejects(noteSql(e, 'vendor', 'P1', 'x'), code('NOTE'));
    await assert.rejects(noteSql(e, 'product', 'P1', 'x'.repeat(1001)), code('NOTE'));
  } finally { c.close(); }
});

test('7V-3b customer list and item master are worker grids; current cost is a column only for cost roles', async () => {
  const { c, e } = await vault();
  try {
    c.query(`INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'x');
INSERT INTO products(product_id,description,category,current_cost,list_price,notes) VALUES('P1','Valve','Valves',600,1000,'Fragile'),('P2','Pump','Pumps',900,2000,NULL),('P3','Hose','Hoses',50,90,'Fragile');
INSERT INTO customers(customer_id,name,tier,notes) VALUES('C1','Acme','T1','Prefers email'),('C2','Beta','T2',NULL);
INSERT INTO sales_lines(${LINE_COLS}) VALUES ${LINE('s', 1, 'P1', 'C1')},${LINE('s', 2, 'P1', 'C1')},${LINE('s', 3, 'P2', 'C2')}`);
    const all = await productList(e, true);
    assert.deepEqual(all.rows.map(r => [r.product_id, r.lines, r.current_cost, r.notes]), [['P1', '2', '600', 'Fragile'], ['P2', '1', '900', null], ['P3', '0', '50', 'Fragile']]);
    const fragile = await productList(e, true, 0, { filters: [{ col: 'notes', values: ['Fragile'] }], sort: { col: 'list_price', dir: 'desc' } });
    assert.deepEqual(fragile.rows.map(r => r.product_id), ['P1', 'P3']); assert.equal(fragile.grid.matched, '2');
    const blanks = await productList(e, true, 0, { filters: [{ col: 'notes', values: [null] }] });
    assert.deepEqual(blanks.rows.map(r => r.product_id), ['P2']);
    const noCost = await productList(e, false);
    assert.ok(noCost.rows.every(r => r.current_cost === null) && !JSON.stringify(noCost).includes('"600"'), 'a role without cost receives no cost');
    await assert.rejects(productList(e, false, 0, { sort: { col: 'current_cost', dir: 'asc' } }), code('FILTER'));
    const customers = await customerList(e, 0, { sort: { col: 'lines', dir: 'desc' } });
    assert.deepEqual(customers.rows.map(r => [r.customer_id, r.lines, r.notes]), [['C1', '2', 'Prefers email'], ['C2', '1', null]]);
  } finally { c.close(); }
});

test('7V-3b notes survive re-import and removing an unrelated file; removal says how many notes go with the rows it drops', async () => {
  const { c, e } = await vault();
  try {
    // Re-import updates the named columns only, and removal resets them, so notes are never overwritten.
    const writes = commitSql(new Set(['sales_history', 'item_master', 'customer_list'])) + removeChildrenSql('s1', true) + finishRemovalSql('s1');
    assert.doesNotMatch(writes, /notes/i, 'an import or removal statement writes the notes column');
    c.query(`INSERT INTO source_files VALUES('s1','jan.csv','sales_history',1,'x'),('s2','feb.csv','sales_history',1,'x'),('m1','items.csv','item_master',1,'x');
INSERT INTO products(product_id,source_id,source_row,notes) VALUES('P1',NULL,NULL,'only in January'),('P2',NULL,NULL,'also in February'),('P3','m1',2,'from the item file');
INSERT INTO customers(customer_id,notes) VALUES('C1','January customer'),('C2','February customer');
INSERT INTO sales_lines(${LINE_COLS}) VALUES ${LINE('s1', 1, 'P1', 'C1')},${LINE('s1', 2, 'P2', 'C1')},${LINE('s2', 3, 'P2', 'C2')}`);
    assert.deepEqual(await removalNotes(e, 's1'), { products: '1', customers: '1' });
    assert.deepEqual(await removalNotes(e, 's2'), { products: '0', customers: '1' });
    assert.deepEqual(await removalNotes(e, 'm1'), { products: '1', customers: '0' });
    c.query(`BEGIN; ${removeChildrenSql('s1')} COMMIT`); c.query(`BEGIN; ${finishRemovalSql('s1')} COMMIT`);
    assert.equal(note(c, 'products', 'product_id', 'P1'), 'missing row', 'P1 was used only by the removed file');
    assert.equal(note(c, 'customers', 'customer_id', 'C1'), 'missing row');
    assert.equal(note(c, 'products', 'product_id', 'P2'), 'also in February', 'a row still used keeps its note');
    assert.equal(note(c, 'customers', 'customer_id', 'C2'), 'February customer');
    assert.equal(note(c, 'products', 'product_id', 'P3'), 'from the item file', 'removing an unrelated file keeps notes');
  } finally { c.close(); }
});

async function mergeVault() {
  const v = await vault();
  v.c.query(`INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'x'),('m','items.csv','item_master',1,'x');
INSERT INTO customers(customer_id,tier) VALUES('C','T01');
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,source_id,source_row,notes) VALUES
 ('ab-100','Brass valve','Valves','EA',600,1000,'m',2,'Kept product note'),('AB-100','','','EA',NULL,NULL,NULL,NULL,'Duplicate note'),('AB-100 ','','','EA',NULL,NULL,NULL,NULL,NULL);
INSERT INTO sales_lines(${LINE_COLS}) VALUES ${LINE('s', 1, 'AB-100', 'C')},${LINE('s', 2, 'ab-100', 'C')},${LINE('s', 3, 'ab-100', 'C')},${LINE('s', 4, 'AB-100 ', 'C')};
${REBUILD_SQL}`);
  return v;
}
test('7V-3b a merge keeps the kept product\'s note and appends the duplicates\' notes; undo restores every note', async () => {
  const { c, e } = await mergeVault();
  try {
    const group = (await scan(e)).duplicates.find(g => g.members.some(m => m.product === 'AB-100'))!;
    assert.equal(group.canonical, 'ab-100');
    const p = await plan(e, 'merge_duplicates', group.key, null, 'owner', '2026-01-01T00:00:00.000Z');
    c.query(`BEGIN; ${p.sql} COMMIT`); if (p.finishSql) c.query(`BEGIN; ${p.finishSql} COMMIT`); c.query(REBUILD_SQL);
    assert.equal(note(c, 'products', 'product_id', 'ab-100'), 'Kept product note\nDuplicate note');
    assert.equal(note(c, 'products', 'product_id', 'AB-100'), 'missing row');
    const u = await undoPlan(e, p.fixId, 'owner', '2026-01-02T00:00:00.000Z');
    c.query(`BEGIN; ${u.sql} COMMIT`); c.query(REBUILD_SQL);
    assert.equal(note(c, 'products', 'product_id', 'ab-100'), 'Kept product note');
    assert.equal(note(c, 'products', 'product_id', 'AB-100'), 'Duplicate note');
    assert.equal(note(c, 'products', 'product_id', 'AB-100 '), null);
  } finally { c.close(); }
});
test('7V-3b a merge that would make the kept note longer than 1,000 characters is refused, changing nothing', async () => {
  const { c, e } = await mergeVault();
  try {
    c.query(`UPDATE products SET notes='${'k'.repeat(600)}' WHERE product_id='ab-100'; UPDATE products SET notes='${'d'.repeat(600)}' WHERE product_id='AB-100'`);
    const group = (await scan(e)).duplicates.find(g => g.members.some(m => m.product === 'AB-100'))!;
    const before = q(c, 'SELECT product_id, notes FROM products ORDER BY product_id');
    await assert.rejects(plan(e, 'merge_duplicates', group.key, null, 'owner', '2026-01-01T00:00:00.000Z'), (err: unknown) => err instanceof VaultError);
    assert.deepEqual(q(c, 'SELECT product_id, notes FROM products ORDER BY product_id'), before);
  } finally { c.close(); }
});

test('7V-3b note commands need the data capability; lists and the removal preview are read-only, saving is not', () => {
  for (const a of ['customerList', 'productList', 'noteSet', 'sourceRemovePreview'] as const) assert.equal(ACTION_CAP[a], 'data');
  for (const a of ['customerList', 'productList', 'sourceRemovePreview'] as const) assert.ok(READ_ONLY_ACTIONS.has(a));
  assert.ok(!READ_ONLY_ACTIONS.has('noteSet'));
});
