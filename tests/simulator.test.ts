// Chunk 7E-2: the Scale-only historical scenario simulator. A hand-checked fixture (every answer worked out in the
// comments), the playground replayed against the engine's own line waterfall (lineFromCents with rha rounding),
// guardrails, cancellation and the Scale/role gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duckdbConnection, rows } from './helpers/duckdb-node';
import { schemaSql, TABLES, SCHEMA_VERSION } from '../lib/vault/schema';
import type { Engine } from '../lib/vault/engine';
import { VaultError, type Request } from '../lib/vault/protocol';
import { simulate, simRows, simOptions, checkScenario, percentBp, SIM_GRID, SIM_MAX_LINES, type SimChange } from '../lib/vendor/simulate';
import { lineFromCents } from '../lib/margin/engine';
import { rha, rateBp, basisPointsDecimal } from '../lib/margin/decimal';
import { generatePlayground } from '../lib/studio/playground';
import { ACTION_CAP, capsFor } from '../lib/roles/access';
import { READ_ONLY_ACTIONS } from '../lib/vault/licence';
import { ROLE_IDS } from '../lib/vault/schema';
import { VaultService } from '../lib/vault/service';
import { dispatch } from '../lib/vault/dispatch';

async function vault(extra = '') {
  const c = await duckdbConnection();
  c.query('DROP VIEW IF EXISTS rebate_sales');
  for (const t of [...TABLES].reverse()) c.query('DROP TABLE IF EXISTS ' + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'scale','unit','tip',0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'2026-03-01');${extra}`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const HAND = `INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('A','Valve','Valves',600,1000),('B','Pump','Pumps',1000,2000);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','One','T1'),('C2','Two','T2');
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,line_kind) VALUES
 ('s',1,'A','C1','2026-01-10',1,1001,105,50,0,600,2,'sale'),('s',2,'B','C2','2026-01-20',2,2000,0,0,200,NULL,3,'sale'),
 ('s',3,'A','C2','2026-02-05',-1,-505,-50,0,0,-300,4,'credit'),('s',4,'B','C1','2025-12-31',1,999,0,0,0,500,5,'sale');`;
const never = new AbortController().signal, quiet = () => undefined;
const ch = (kind: SimChange['kind'], scope: SimChange['scope'], value: string, pct: string): SimChange => ({ kind, scope, value, pct });

test('7E-2 scenario input is validated: months, percent text, scopes, duplicates and limits', () => {
  assert.equal(percentBp('2.5'), 250); assert.equal(percentBp('-1.25'), -125); assert.equal(percentBp('+100'), 10000); assert.equal(percentBp('-90'), -9000); assert.equal(percentBp('0'), 0);
  for (const bad of ['100.01', '-90.01', '1.234', '1e2', '', ' ', '١', 'NaN', '--1']) assert.throws(() => percentBp(bad), VaultError, bad);
  const ok = checkScenario({ from: '2025-11', to: '2026-02', changes: [ch('price', 'all', '', '1')] });
  assert.deepEqual(ok.months, ['2025-11', '2025-12', '2026-01', '2026-02']);
  const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;
  assert.throws(() => checkScenario({ from: '2026-02', to: '2026-01', changes: [ch('price', 'all', '', '1')] }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2023-01', to: '2026-01', changes: [ch('price', 'all', '', '1')] }), code('SIM')); // 37 months
  assert.doesNotThrow(() => checkScenario({ from: '2023-02', to: '2026-01', changes: [ch('price', 'all', '', '1')] })); // 36 months
  assert.throws(() => checkScenario({ from: '2026-13', to: '2026-13', changes: [ch('price', 'all', '', '1')] }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [] }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: Array.from({ length: 21 }, (_, i) => ch('price', 'product', 'P' + i, '1')) }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [ch('cost', 'customer', 'C1', '1')] }), code('SIM')); // cost does not depend on the buyer
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [ch('price', 'category', '', '1')] }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [ch('price', 'category', 'V', '1'), ch('price', 'category', ' V ', '2')] }), code('SIM'));
  assert.throws(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [{ kind: 'volume', scope: 'all', value: '', pct: '1' }] }), code('SIM'));
  assert.throws(() => checkScenario(null), code('SIM'));
  // SQL text in a value is data, never SQL.
  assert.doesNotThrow(() => checkScenario({ from: '2026-01', to: '2026-01', changes: [ch('price', 'product', "A' OR 1=1 --", '1')] }));
});

test('7E-2 hand-checked replay: rounding, credits, unknown cost, precedence, breakdown and temporary storage only', async () => {
  const { c, e } = await vault(HAND);
  try {
    const before = rows(c, 'SELECT * FROM sales_lines ORDER BY line_id');
    const stages: string[] = [];
    // Valves +10% beats all lines +5%; cost -10%. Period 2026-01..2026-02 excludes line 4 (2025-12).
    const r = await simulate(e, { from: '2026-01', to: '2026-02', changes: [ch('price', 'all', '', '5'), ch('price', 'category', 'Valves', '10'), ch('cost', 'all', '', '-10')] }, never, (stage, done, total) => stages.push(`${done}/${total}`));
    assert.deepEqual(stages, ['0/2', '1/2', '2/2']);
    // Line 1 (A, +10%): list 1001→1101.1→1101, discount 105→115.5→116 (half away from zero), cost 600→540. Pocket 846→935, margin 246→395.
    // Line 2 (B, +5%): list 2000→2100, rebate 200→210, cost unknown. Pocket 1800→1890, margin unknown.
    // Line 3 (credit, A, +10%): list -505→-555.5→-556, discount -50→-55, cost -300→-270. Pocket -455→-501, margin -155→-231.
    assert.equal(r.lines, '3'); assert.equal(r.changedLines, '3'); assert.equal(r.uncostedLines, '1');
    assert.deepEqual(r.actual, { list: '2496', discount: '55', rebate: '200', freight: '50', pocket: '2191', cost: '300', costedPocket: '391', margin: '91', rate: '23.27' });
    assert.deepEqual(r.scenario, { list: '2645', discount: '61', rebate: '210', freight: '50', pocket: '2324', cost: '270', costedPocket: '434', margin: '164', rate: '37.79' });
    assert.deepEqual(r.delta, { list: '149', pocket: '133', cost: '-30', margin: '73' });
    assert.equal(r.from, '2026-01'); assert.equal(r.to, '2026-02'); assert.equal(r.months, '2');
    // The engine's own waterfall agrees with every line.
    assert.deepEqual(lineFromCents({ list: BigInt(1101), discount: BigInt(116), rebate: BigInt(0), freight: BigInt(50), cost: BigInt(540) }), { pocket: BigInt(935), margin: BigInt(395), rateBp: BigInt(4225) });
    const cat = await simRows(e, 'category');
    assert.deepEqual(cat.rows.map(x => [x.key, x.lines, x.actual_pocket, x.scenario_pocket, x.actual_margin, x.scenario_margin, x.margin_change, x.actual_rate, x.scenario_rate, x.uncosted]),
      [['Pumps', '1', '1800', '1890', '0', '0', '0', null, null, '1'], ['Valves', '2', '391', '434', '91', '164', '73', '23.27', '37.79', '0']]);
    const months = await simRows(e, 'month', 0, { sort: { col: 'key', dir: 'desc' } });
    assert.deepEqual(months.rows.map(x => [x.key, x.scenario_pocket]), [['2026-02', '-501'], ['2026-01', '2825']]);
    const tiers = await simRows(e, 'tier', 0, { filters: [{ col: 'key', values: ['T1'] }], totals: ['scenario_pocket'] });
    assert.deepEqual(tiers.rows.map(x => [x.key, x.scenario_pocket]), [['T1', '935']]); assert.equal(tiers.grid.matched, '1'); assert.equal(tiers.grid.total, '2');
    const cust = await simRows(e, 'customer'); assert.deepEqual(cust.rows.map(x => [x.key, x.label]), [['C1', 'One'], ['C2', 'Two']]);
    const prod = await simRows(e, 'product'); assert.deepEqual(prod.rows.map(x => [x.key, x.label]), [['A', 'Valve'], ['B', 'Pump']]);
    await assert.rejects(simRows(e, 'region'), VaultError); await assert.rejects(simRows(e, 'category', 0, { sort: { col: 'nope', dir: 'asc' } }), VaultError);
    assert.deepEqual(Object.keys(SIM_GRID).sort(), ['actual_margin', 'actual_pocket', 'actual_rate', 'changed', 'key', 'label', 'lines', 'margin_change', 'scenario_margin', 'scenario_pocket', 'scenario_rate', 'uncosted']);
    // Precedence: SKU beats customer beats category beats all. Line 1 (A, C1) takes the SKU's +1%: list 1011, discount 106.05→106, pocket 855.
    // Line 2 (B, C2) matches nothing but "all" (0%). January scenario pocket = 855 + 1800 = 2655.
    await simulate(e, { from: '2026-01', to: '2026-01', changes: [ch('price', 'all', '', '0'), ch('price', 'category', 'Valves', '7'), ch('price', 'customer', 'C1', '20'), ch('price', 'product', 'A', '1')] }, never, quiet);
    assert.deepEqual((await simRows(e, 'month')).rows.map(x => [x.key, x.scenario_pocket, x.changed]), [['2026-01', '2655', '1']]);
    // A value with SQL text matches nothing and changes nothing.
    const inj = await simulate(e, { from: '2026-01', to: '2026-02', changes: [ch('price', 'product', "A' OR 1=1 --", '50')] }, never, quiet);
    assert.equal(inj.changedLines, '0'); assert.deepEqual(inj.scenario, inj.actual);
    // Nothing in the vault changed; the run lives in a temporary table only.
    assert.deepEqual(rows(c, 'SELECT * FROM sales_lines ORDER BY line_id'), before);
    assert.deepEqual(rows(c, "SELECT table_name FROM information_schema.tables WHERE table_name = 'md_sim'").map(x => x.table_name), ['md_sim']);
    assert.equal(rows(c, "SELECT count(*) AS n FROM duckdb_tables() WHERE table_name = 'md_sim' AND temporary").at(0)!.n, '1');
    await assert.rejects(simulate(e, { from: '2024-01', to: '2024-02', changes: [ch('price', 'all', '', '1')] }, never, quiet), (x: unknown) => x instanceof VaultError && x.code === 'SIM');
    const opts = await simOptions(e); assert.deepEqual(opts, { first: '2025-12', lastMonth: '2026-02', categories: ['Pumps', 'Valves'] });
  } finally { c.close(); }
});

test('7E-2 cancel stops between months and leaves no partial run; the 2M-line guardrail refuses before any work', async () => {
  const { c, e } = await vault(HAND);
  try {
    const ctl = new AbortController(); let calls = 0;
    await assert.rejects(simulate(e, { from: '2025-12', to: '2026-02', changes: [ch('price', 'all', '', '1')] }, ctl.signal, () => { if (++calls === 2) ctl.abort(); }), (x: unknown) => x instanceof VaultError && x.code === 'CANCELLED');
    assert.equal(calls, 2);
    assert.equal(rows(c, "SELECT count(*) AS n FROM duckdb_tables() WHERE table_name = 'md_sim'").at(0)!.n, '0');
    await assert.rejects(simRows(e, 'month'));
    c.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row)
      SELECT 's', 100 + i, 'A', 'C1', DATE '2024-06-15', 1, 1, 0, 0, 0, 1, 2 FROM range(${SIM_MAX_LINES + 1}) t(i)`);
    let progressed = false;
    await assert.rejects(simulate(e, { from: '2024-06', to: '2024-06', changes: [ch('price', 'all', '', '1')] }, never, () => { progressed = true; }), (x: unknown) => x instanceof VaultError && x.code === 'SIM' && x.message.includes('replays at most'));
    assert.equal(progressed, false);
  } finally { c.close(); }
});

/** Cents from a CSV amount ("416.64", "-12.30"). */
const cents = (v: string) => { const neg = v.startsWith('-'), [w, f = ''] = v.replace('-', '').split('.'); const n = BigInt(w) * BigInt(100) + BigInt((f + '00').slice(0, 2)); return neg ? -n : n; };
const csv = (text: string) => text.trim().split(/\r?\n/).slice(1).map(l => l.split(','));
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

test('7E-2 playground: the simulator totals equal the engine replaying every line (actual and scenario)', async () => {
  const { files } = generatePlayground(), file = (p: string) => files.find(f => f.name.includes(p))!.text;
  const items = csv(file('item master')), custs = csv(file('customers')), sales = csv(file('sales history'));
  const category = new Map(items.map(r => [r[0], r[2]]));
  const { c, e } = await vault();
  try {
    c.query('INSERT INTO products(product_id,description,category,uom,current_cost,list_price) VALUES ' + items.map(r => `(${q(r[0])},${q(r[1])},${q(r[2])},${q(r[3])},${cents(r[4])},${cents(r[5])})`).join(','));
    c.query('INSERT INTO customers(customer_id,name,tier,branch,region) VALUES ' + custs.map(r => `(${q(r[0])},${q(r[1])},${q(r[2])},${q(r[3])},${q(r[4])})`).join(','));
    for (let i = 0; i < sales.length; i += 5000) c.query('INSERT INTO sales_lines(source_id,line_id,invoice_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,line_kind) VALUES ' +
      sales.slice(i, i + 5000).map(r => `('s',${r[0]},${q(r[1])},${q(r[2])},${q(r[3])},DATE ${q(r[4])},${r[5]},${cents(r[6])},${cents(r[7])},${cents(r[8])},${cents(r[9])},${r[10] === '' ? 'NULL' : cents(r[10])},${Number(r[0]) + 1},${cents(r[6]) < BigInt(0) ? "'credit'" : "'sale'"})`).join(','));
    assert.equal(rows(c, 'SELECT count(*) AS n FROM sales_lines')[0].n, String(sales.length));
    const changes = [ch('price', 'all', '', '2.5'), ch('price', 'category', 'Valves', '-1.25'), ch('price', 'customer', 'C-0007', '3'), ch('price', 'product', 'P-00001', '10'),
      ch('cost', 'all', '', '1.75'), ch('cost', 'category', 'Pumps', '-2'), ch('cost', 'product', 'P-00002', '33.33')];
    const from = '2025-01', to = '2025-12';
    // The engine, independently: pick the most specific change per kind, scale each component once with rha, then lineFromCents.
    const pick = (kind: string, r: string[]) => { const f = (scope: string, v: string) => changes.find(x => x.kind === kind && x.scope === scope && x.value === v);
      return BigInt(percentBp((f('product', r[2]) ?? f('customer', r[3]) ?? f('category', category.get(r[2]) ?? '') ?? f('all', '') ?? { pct: '0' }).pct)); };
    const sc = (x: bigint, bp: bigint) => rha(x * (BigInt(10000) + bp), BigInt(10000));
    const Z = BigInt(0), sum = { a: { list: Z, discount: Z, rebate: Z, freight: Z, pocket: Z, cost: Z, cp: Z }, s: { list: Z, discount: Z, rebate: Z, freight: Z, pocket: Z, cost: Z, cp: Z } };
    let n = 0, uncosted = 0, changed = 0;
    for (const r of sales) {
      if (r[4] < from + '-01' || r[4] > to + '-31') continue;
      n++; const pb = pick('price', r), cb = pick('cost', r), cost = r[10] === '' ? null : cents(r[10]);
      if (cost === null) uncosted++; if (pb !== Z || (cb !== Z && cost !== null)) changed++;
      const sides = [['a', cents(r[6]), cents(r[7]), cents(r[9]), cost], ['s', sc(cents(r[6]), pb), sc(cents(r[7]), pb), sc(cents(r[9]), pb), cost === null ? null : sc(cost, cb)]] as const;
      for (const [k, list, discount, rebate, c2] of sides) {
        const freight = cents(r[8]), w = lineFromCents({ list, discount, rebate, freight, cost: c2 }), t = sum[k];
        t.list += list; t.discount += discount; t.rebate += rebate; t.freight += freight; t.pocket += w.pocket;
        if (c2 !== null) { t.cost += c2; t.cp += w.pocket; }
      }
    }
    const side = (t: typeof sum.a) => ({ list: String(t.list), discount: String(t.discount), rebate: String(t.rebate), freight: String(t.freight), pocket: String(t.pocket), cost: String(t.cost), costedPocket: String(t.cp), margin: String(t.cp - t.cost), rate: basisPointsDecimal(rateBp(t.cp - t.cost, t.cp)!) });
    const steps: string[] = [];
    const r = await simulate(e, { from, to, changes }, never, (_s, d, t) => steps.push(d + '/' + t));
    assert.equal(steps.length, 13); assert.equal(steps.at(-1), '12/12');
    assert.equal(r.lines, String(n)); assert.ok(n > 50_000, 'the playground year is replayed'); assert.equal(r.uncostedLines, String(uncosted)); assert.equal(r.changedLines, String(changed));
    assert.deepEqual(r.actual, side(sum.a)); assert.deepEqual(r.scenario, side(sum.s));
    assert.notEqual(r.actual.margin, r.scenario.margin);
    // With no change the scenario is exactly what happened.
    const zero = await simulate(e, { from, to, changes: [ch('price', 'all', '', '0')] }, never, quiet);
    assert.deepEqual(zero.scenario, zero.actual); assert.deepEqual(zero.actual, side(sum.a)); assert.equal(zero.changedLines, '0');
    // The breakdown adds up to the totals, by month and by category.
    await simulate(e, { from, to, changes }, never, quiet);
    for (const dim of ['month', 'category', 'tier'] as const) {
      const g = await simRows(e, dim, 0, { totals: ['scenario_margin', 'actual_pocket', 'lines'] });
      assert.equal(g.grid.totals!.scenario_margin.sum, r.scenario.margin, dim); assert.equal(g.grid.totals!.actual_pocket.sum, r.actual.pocket, dim); assert.equal(g.grid.totals!.lines.sum, r.lines, dim);
    }
    assert.equal((await simRows(e, 'month')).grid.total, '12');
  } finally { c.close(); }
});

test('7E-2 gates: Scale licence in the worker, pricing roles only, never a Sales Rep; read-only commands', async () => {
  for (const a of ['simOptions', 'simRun', 'simRows'] as const) { assert.equal(ACTION_CAP[a], 'pricing'); assert.ok(READ_ONLY_ACTIONS.has(a), a); }
  for (const role of ROLE_IDS) for (const named of [false, true]) { const caps = capsFor(role, named); if (caps.includes('pricing')) assert.ok(caps.includes('cost'), `${role} simulates and sees cost`); }
  for (const r of ['sales_rep', 'accountant', 'sales_manager'] as const) assert.ok(!capsFor(r, false).includes('pricing'), r);
  const { c, e } = await vault(HAND + "INSERT INTO role_assignments VALUES('owner','Owner','owner','owner','2026-01-01'),('rep','Rep','sales_rep','owner','2026-01-01'),('acct','Acct','accountant','owner','2026-01-01');");
  try {
    const make = (userId: string, tier: 'starter' | 'professional' | 'scale') => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: 'test' }, writable: async () => e, save: async () => undefined, touch: () => undefined });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: 'test', device: 'test', tier, state: 'active', issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: '' }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown = {}) => dispatch(s, { id: 'x', action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined });
    const scenario = { from: '2026-01', to: '2026-02', changes: [ch('price', 'all', '', '1')] };
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    for (const tier of ['starter', 'professional'] as const) {
      await assert.rejects(call(make('owner', tier), 'simRun', { scenario }), is('LICENCE'), tier);
      await assert.rejects(call(make('owner', tier), 'simOptions'), is('LICENCE'), tier);
      await assert.rejects(call(make('owner', tier), 'simRows', { dim: 'month' }), is('LICENCE'), tier);
    }
    for (const user of ['rep', 'acct']) for (const a of ['simOptions', 'simRun', 'simRows']) await assert.rejects(call(make(user, 'scale'), a, { scenario, dim: 'month' }), is('FORBIDDEN'), user + ' ' + a);
    const owner = make('owner', 'scale');
    await assert.rejects(call(owner, 'simRows', { dim: 'month' }), is('SIM'));
    const run = await call(owner, 'simRun', { scenario }) as Awaited<ReturnType<VaultService['simRun']>>;
    assert.equal(run.lines, '3');
    assert.equal((await call(owner, 'simOptions') as Awaited<ReturnType<VaultService['simOptions']>>).last?.lines, '3');
    assert.equal((await call(owner, 'simRows', { dim: 'month' }) as Awaited<ReturnType<VaultService['simRows']>>).rows.length, 2);
    // After the data changes, the run is stale and has to be run again.
    (owner as unknown as { dataVersion: number }).dataVersion++;
    await assert.rejects(call(owner, 'simRows', { dim: 'month' }), is('SIM'));
    assert.equal((await call(owner, 'simOptions') as Awaited<ReturnType<VaultService['simOptions']>>).last, null);
    assert.equal(rows(c, "SELECT count(*) AS n FROM audit_log").at(0)!.n, '0', 'a simulation writes nothing, not even an audit row');
  } finally { c.close(); }
});
