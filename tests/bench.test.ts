// Chunk 8D: opt-in anonymous benchmarks. Exact bands worked out by hand; the payload check is property-tested.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, tablesFor, upgradeSql } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as P from "../lib/bench/payload";
import * as L from "../lib/bench/local";
import { pseudonym, share, BenchError } from "../lib/bench/store";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";

// 240 Wire lines (electrical) over 24 customers, 10 each: list 100.00, discount 10.00, rebate 2.00, freight 3.00, cost 60.00.
// Pocket = 85.00 a line. Margin (85 − 60) / 85 = 29.41% → band 29; discount 10/100 → 10; rebate 2/100 → 2; freight 3/85 =
// 3.53% → 3. Five Pipe lines (plumbing) are too few. Quarterly pocket revenue 240 × 85 + 5 × 40 = 20,600.00 → S1.
async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  const lines: string[] = [];
  for (let i = 1; i <= 240; i++) lines.push(`('s',${i},'W1','C${(i % 24) + 1}','2025-02-${String((i % 27) + 1).padStart(2, "0")}',1,10000,1000,300,200,6000,${i + 1},'sale')`);
  for (let i = 241; i <= 245; i++) lines.push(`('s',${i},'P1','C1','2025-03-03',1,5000,1000,0,0,3000,${i + 1},'sale')`);
  lines.push(`('s',246,'W1','C2','2025-04-01',1,10000,0,0,0,6000,247,'sale')`, `('s',247,'W1','C3','2025-01-20',-1,-10000,0,0,0,-6000,248,'credit')`);
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'2025-04-01');
INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('W1','Wire','Wire',6000,10000),('P1','Pipe','Pipe',3000,5000),('X1','Gadget','Gadgets',100,200);
INSERT INTO customers(customer_id,name,tier) SELECT 'C'||g,'Customer '||g,'T1' FROM range(1,25) t(g);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,line_kind) VALUES ${lines.join(",")};`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}

test("8D schema v21: three local tables, family codes checked", async () => {
  assert.equal(SCHEMA_VERSION, 21);
  assert.deepEqual(tablesFor(21).filter(t => !tablesFor(20).includes(t)), ["bench_family_map", "bench_shares", "bench_figures"]);
  assert.ok(upgradeSql(20).startsWith("CREATE TABLE bench_family_map")); assert.equal(upgradeSql(21), "");
  const { c } = await vault();
  try { assert.throws(() => c.query("INSERT INTO bench_family_map VALUES('Wire','tools','x')")); } finally { c.close(); }
});

test("8D bands, size bands and quarters", () => {
  assert.equal(P.bandOf(BigInt(2500), BigInt(8500)), 29);
  assert.equal(P.bandOf(BigInt(-1), BigInt(100)), -1, "a small negative rate rounds down");
  assert.equal(P.bandOf(BigInt(-50), BigInt(100)), -20, "clipped at -20");
  assert.equal(P.bandOf(BigInt(95), BigInt(100)), 80, "clipped at 80");
  assert.deepEqual([P.sizeBandOf(BigInt(99_999_999)), P.sizeBandOf(BigInt(100_000_000)), P.sizeBandOf(BigInt(1_999_999_999)), P.sizeBandOf(BigInt(2_000_000_000))], ["S1", "S2", "S3", "S4"]);
  assert.deepEqual(P.quarterDates("2025-Q1"), { from: "2025-01-01", to: "2025-03-31" });
  assert.deepEqual(P.quarterDates("2024-Q4"), { from: "2024-10-01", to: "2024-12-31" });
  assert.equal(P.lastCompleteQuarter(new Date("2026-11-11T00:00:00Z")), "2026-Q3");
  assert.equal(P.lastCompleteQuarter(new Date("2026-02-01T00:00:00Z")), "2025-Q4");
  assert.equal(P.quartersSince2024(new Date("2026-11-11T00:00:00Z")).length, 12);
});

test("8D payload check: only the exact shape passes (property test)", () => {
  const good = { v: 1, quarter: "2025-Q1", sizeBand: "S1", rows: [{ family: "electrical", metric: "pocket_margin", band: 29 }] };
  assert.deepEqual(P.checkPayload(good), good);
  const mutations: unknown[] = [null, [], "x", { ...good, v: 2 }, { ...good, extra: 1 }, { ...good, quarter: "2025-Q5" }, { ...good, sizeBand: "S5" }, { ...good, rows: [] },
    { ...good, rows: [{ ...good.rows[0], customer: "C1" }] }, { ...good, rows: [{ ...good.rows[0], band: 29.5 }] }, { ...good, rows: [{ ...good.rows[0], band: "29" }] },
    { ...good, rows: [{ ...good.rows[0], band: 81 }] }, { ...good, rows: [{ ...good.rows[0], family: "Wire" }] }, { ...good, rows: [good.rows[0], good.rows[0]] }];
  for (const m of mutations) assert.throws(() => P.checkPayload(m), `accepted ${JSON.stringify(m)}`);
  // Random objects built from plausible keys and values almost never match; any that pass carry only allowed keys.
  let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const keys = ["v", "quarter", "sizeBand", "rows", "customer", "sku", "category", "revenue"], values = [1, 2, "2025-Q1", "S2", "electrical", 22, -21, 3.5, null, "C1"];
  for (let i = 0; i < 2000; i++) {
    const obj: Record<string, unknown> = {}; for (const k of keys) if (rnd(2)) obj[k] = k === "rows" ? Array.from({ length: rnd(3) }, () => ({ family: P.FAMILIES[rnd(12)], metric: P.METRICS[rnd(4)], band: values[rnd(values.length)], ...(rnd(4) ? {} : { note: "x" }) })) : values[rnd(values.length)];
    try { const p = P.checkPayload(obj); assert.deepEqual(Object.keys(p).sort(), ["quarter", "rows", "sizeBand", "v"]); for (const r of p.rows) assert.deepEqual(Object.keys(r).sort(), ["band", "family", "metric"]); } catch (e) { assert.equal((e as Error).message, "invalid benchmark payload"); }
  }
});

test("8D preview on the device: family minimums, exact bands and the only payload", async () => {
  const { c, e } = await vault();
  try {
    assert.deepEqual((await L.mapping(e)).map(m => [m.category, m.family]), [["Gadgets", null], ["Pipe", null], ["Wire", null]]);
    c.query(L.mappingSql({ Wire: "electrical", Pipe: "plumbing", Gadgets: null }, "2026-11-11"));
    assert.throws(() => L.mappingSql({ Wire: "tools" }, "x"), VaultError);
    const p = await L.preview(e, "2025-Q1"), by = Object.fromEntries(p.families.map(f => [f.family, f]));
    assert.equal(p.sizeBand, "S1"); assert.equal(p.unmapped, "0");
    // 24 customers with 10 lines each: the largest has 850.00 of 20,400.00 = 4.16% (416 bp).
    assert.deepEqual({ ...by.electrical }, { family: "electrical", lines: "240", customers: "24", topShareBp: "416", included: true, reason: "ok", bands: { pocket_margin: 29, discount_rate: 10, rebate_rate: 2, freight_rate: 3 } });
    assert.deepEqual([by.plumbing.included, by.plumbing.reason], [false, "lines"]);
    assert.deepEqual(p.payload, { v: 1, quarter: "2025-Q1", sizeBand: "S1", rows: [{ family: "electrical", metric: "pocket_margin", band: 29 }, { family: "electrical", metric: "discount_rate", band: 10 }, { family: "electrical", metric: "rebate_rate", band: 2 }, { family: "electrical", metric: "freight_rate", band: 3 }] });
    const json = JSON.stringify(p.payload);
    for (const secret of ["Wire", "Customer", "C1", "W1", "20600", "Pipe"]) assert.ok(!json.includes(secret), `the payload carries ${secret}`);
    // One customer above 25%: move 80 lines to C1 (90 of 240 = 37.5%).
    c.query("UPDATE sales_lines SET customer_id='C1' WHERE product_id='W1' AND line_id<=80");
    const conc = await L.preview(e, "2025-Q1");
    assert.deepEqual([conc.families.find(f => f.family === "electrical")!.reason, conc.payload], ["concentration", null]);
    await assert.rejects(L.preview(e, "2025-Q9"), VaultError);
  } finally { c.close(); }
});

test("8D local records: shares, figures and withdrawal", async () => {
  const { c, e } = await vault();
  try {
    const payload = { v: 1, quarter: "2025-Q1", sizeBand: "S1", rows: [{ family: "electrical", metric: "pocket_margin", band: 29 }] };
    assert.throws(() => L.shareSql(payload, 2, "own", "t"), VaultError, "stored count must match the rows sent");
    c.query(L.shareSql(payload, 1, "own", "2026-11-11").sql);
    c.query(L.figuresSql("2025-Q1", [{ sizeBand: "S1", family: "electrical", metric: "pocket_margin", p25: 20, p50: 25, p75: 30, releasedAt: "2025-05-15T00:00:00Z" }], "2026-11-11"));
    assert.throws(() => L.figuresSql("2025-Q1", [{ sizeBand: "S1", family: "electrical", metric: "pocket_margin", p25: 21, p50: 25, p75: 30, releasedAt: "x" }], "t"), VaultError, "edges are 5-point ranges");
    const s = await L.state(e);
    assert.deepEqual([s.shares[0].quarter, s.shares[0].rows, s.shares[0].withdrawnAt, s.figures.length], ["2025-Q1", 1, null, 1]);
    c.query(L.withdrawnSql("2026-11-12"));
    const w = await L.state(e); assert.deepEqual([w.shares[0].withdrawnAt, w.figures.length], ["2026-11-12", 0]);
  } finally { c.close(); }
});

test("8D server boundary: keyed pseudonyms and a checked payload before any SQL", async () => {
  const key = "11".repeat(32), tenant = "6a000000-0000-4000-8000-000000000001";
  assert.deepEqual(pseudonym(tenant, "2025-Q1", key), createHmac("sha256", Buffer.from(key, "hex")).update(`${tenant}|2025-Q1`).digest());
  assert.notDeepEqual(pseudonym(tenant, "2025-Q1", key), pseudonym(tenant, "2025-Q2", key), "a different pseudonym every quarter");
  assert.throws(() => pseudonym(tenant, "2025-Q1", ""), BenchError, "no key, no benchmarks");
  let called = 0; const db = { query: async () => { called++; return { rows: [{ n: 1 }] }; } } as never;
  await assert.rejects(share(db, tenant, { v: 1, quarter: "2025-Q1", sizeBand: "S1", rows: [{ family: "electrical", metric: "pocket_margin", band: 29, customer: "C1" }] }), BenchError);
  assert.equal(called, 0, "an invalid payload never reaches the database");
});

test("8D service: cost roles read, only the Owner writes; Professional/Scale; no Sales Rep", async () => {
  assert.ok(["benchState", "benchPreview", "benchMapSave", "benchShared", "benchFiguresSave", "benchWithdrawn"].every(a => ACTION_CAP[a as keyof typeof ACTION_CAP] === "cost"));
  assert.ok(READ_ONLY_ACTIONS.has("benchState") && READ_ONLY_ACTIONS.has("benchPreview") && !READ_ONLY_ACTIONS.has("benchShared"));
  const { c, e } = await vault();
  c.query("INSERT INTO role_assignments VALUES('own','Owner','owner','own','2026-01-01'),('sm','SM','sales_manager','own','2026-01-01'),('rep','Rep','sales_rep','own','2026-01-01')");
  try {
    const make = (userId: string, tier: "starter" | "professional") => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "t" }, writable: async () => e, save: async () => undefined, touch: () => ({ ok: true }) });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "t", device: "d", tier, state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown = {}) => dispatch(s, { id: "x", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<any>;
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    const st = await call(make("own", "professional"), "benchMapSave", { mapping: { Wire: "electrical" } });
    assert.equal(st.owner, true); assert.equal(st.mapping.find((m: { category: string }) => m.category === "Wire").family, "electrical");
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "bench.mapping_saved"));
    const sm = await call(make("sm", "professional"), "benchPreview", { quarter: "2025-Q1" });
    assert.equal(sm.payload.rows.length, 4, "a Sales Manager can read the bands");
    await assert.rejects(call(make("sm", "professional"), "benchMapSave", { mapping: { Wire: null } }), is("FORBIDDEN"), "only the Owner maps families");
    await assert.rejects(call(make("sm", "professional"), "benchShared", { payload: sm.payload, stored: 4 }), is("FORBIDDEN"));
    await call(make("own", "professional"), "benchShared", { payload: sm.payload, stored: 4 });
    assert.ok(q(c, "SELECT action, details FROM audit_log").some(r => r.action === "bench.shared" && !String(r.details).includes("electrical")), "the audit entry has the quarter and a count only");
    for (const a of ["benchState", "benchPreview"]) await assert.rejects(call(make("rep", "professional"), a, { quarter: "2025-Q1" }), is("FORBIDDEN"), a);
    await assert.rejects(call(make("own", "starter"), "benchState"), is("LICENCE"));
  } finally { c.close(); }
});
