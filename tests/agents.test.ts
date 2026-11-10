// Chunk 8B-1: Margin Drain agents and cost index triggers. Every expected amount is worked out by hand in the comments.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, tablesFor, upgradeSql } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as agents from "../lib/agents/agents";
import * as ci from "../lib/agents/costindex";
import type { LeakResult } from "../lib/margin/leaks";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";
import { ROLE_FIELDS, LOADABLE } from "../lib/studio/formats";
import { detectRole } from "../lib/studio/mapper";
import { commitSql, removeChildrenSql } from "../lib/studio/load";

const TODAY = "2026-11-10";
async function vault(extra = "") {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
INSERT INTO source_files VALUES('ix','copper.csv','customer_list',1,'2026-06-02');
INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('P1','Valve','Valves',6000,10000),('P2','Pipe','Pipe',1000,1500),('P3','Hose','Hoses',500,900),('P4','Seal','Valves',333,600),('P5','Gauge','Valves',NULL,800);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','One','T1'),('C2','Two','T2');
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g','unit_price',12000,10000,8000,'T1','Valves');${extra}`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const leakResult = (findings: { id: string; cents: string }[]): LeakResult => ({ findings: findings.map(f => ({ ...f, type: "discount_outlier", label: "Discount outlier", title: "Title " + f.id, scope: {}, lines: "3", formula: "", detail: "" })), totalCents: "0", overlapCents: "0", overlapLines: "0", dedupedCents: "0", checked: { saleLines: "0", creditLines: "0", uncostedLines: "0", untieredLines: "0", tiers: "0" }, ms: 0 });
const FIXTURE = `
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES
 ('m1','P1','Valves',NULL,'T1',0,7500,'2026-01-01',NULL),('m2','P1','Valves','C1',NULL,0,7000,'2026-01-01','2026-11-20'),
 ('m3','P1','Valves',NULL,'T1',0,7900,'2027-01-01',NULL),('m4','P4','Valves',NULL,'T1',0,9000,'2026-01-01','2026-12-25'),('m5','P2','Pipe',NULL,'T2',0,100,'2026-01-01',NULL);
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES
 ('v1','V','P1',5000,'2026-01-01','f'),('v2','V','P1',5200,'2026-10-31','f'),('v3','V','P2',1000,'2026-01-01','f'),('v4','V','P2',1020,'2026-10-31','f'),
 ('v5','W','P3',400,'2026-01-01','f'),('v6','W','P3',500,'2026-07-01','f'),('v7','V','P4',300,'2026-12-01','f');
INSERT INTO cost_index_points VALUES('ix','Copper','2026-01-01',100,2),('ix','Copper','2026-06-01',106.5,3),('ix','Copper','2027-01-01',200,4);`;

test("8B-1 schema v18: five local tables, cost_index source kind, earlier money untouched", async () => {
  assert.equal(SCHEMA_VERSION, 18);
  assert.deepEqual(tablesFor(18).filter(t => !tablesFor(17).includes(t)), ["cost_index_points", "cost_index_triggers", "agent_settings", "agent_runs", "agent_inbox"]);
  assert.equal(upgradeSql(18), "");
  const c = await duckdbConnection();
  try {
    c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
    c.query(schemaSql(17));
    c.query("INSERT INTO source_files VALUES('a','ar.csv','customer_list',1,'2026-01-01'); INSERT INTO source_kinds VALUES('a','ar_aging')");
    c.query(upgradeSql(17));
    assert.deepEqual(q(c, "SELECT * FROM source_kinds"), [{ source_id: "a", kind: "ar_aging" }]);
    c.query("INSERT INTO source_kinds VALUES('b','cost_index')");
    assert.throws(() => c.query("INSERT INTO source_kinds VALUES('c','other')"));
    assert.throws(() => c.query("INSERT INTO agent_settings VALUES(1,true,5,0,500,30,300,'x')"), "intervals under 15 minutes are refused");
  } finally { c.close(); }
});

test("8B-1 cost index import role: fields, detection, load and removal SQL", () => {
  assert.deepEqual(ROLE_FIELDS.cost_index.map(f => [f.name, f.type, f.required]), [["index_name", "text", true], ["period_date", "date", true], ["index_value", "quantity", true]]);
  assert.ok(LOADABLE.includes("cost_index"));
  assert.equal(detectRole("copper-lme.csv", ["index_name", "period_date", "index_value"]).role, "cost_index");
  assert.ok(commitSql(new Set(["cost_index"])).includes("INSERT INTO cost_index_points(source_id,index_name,period_date,index_value,source_row)"));
  assert.ok(removeChildrenSql("s1", false, false, true).includes("DELETE FROM cost_index_points WHERE source_id='s1'"));
  assert.ok(!removeChildrenSql("s1").includes("cost_index_points"), "older vault versions have no index table");
});

test("8B-1 cost index triggers: exact index, FX buffer and expected-cost math", async () => {
  const { c, e } = await vault(FIXTURE);
  try {
    // Copper on or before the base date 2026-01-15 is 100.0000; on or before today 106.5000 (the 2027 point is ahead).
    // Index change = 6.5000 / 100 = 650 bp >= 500 threshold. Pass-through 50%: 325 bp.
    // EUR 1.080000 -> 1.134000 = +500 bp exactly; the 300 bp buffer absorbs 300, so 200 bp passes: cost change 525 bp.
    const t = await ci.triggerSql(e, { name: "Copper valves", index: "Copper", scope: "category", value: "Valves", baseDate: "2026-01-15", thresholdPct: "5", passThroughPct: "50", fx: { currency: "EUR", base: "1.08", now: "1.134", bufferPct: "3" } }, "po", "2026-11-10T00:00:00Z");
    c.query(t.sql);
    let [v] = await ci.triggers(e, TODAY);
    assert.deepEqual({ status: v.status, base: v.baseValue, basePeriod: v.basePeriod, latest: v.latestValue, period: v.latestPeriod, index: v.indexChangeBp, fx: v.fxChangeBp, cost: v.costChangeBp, skus: v.skus },
      { status: "triggered", base: "100.0000", basePeriod: "2026-01-01", latest: "106.5000", period: "2026-06-01", index: "650", fx: "500", cost: "525", skus: "2" });
    // P1 6,000 x 1.0525 = 6,315; P4 333 x 1.0525 = 350.4825 -> 350. P5 has no cost and is not listed.
    const skus = await ci.triggerSkus(e, t.id, 0, {}, TODAY);
    assert.deepEqual(skus.rows.map(r => [r.product_id, r.current_cost, r.expected_cost, r.change]), [["P1", "6000", "6315", "315"], ["P4", "333", "350", "17"]]);
    // Without the FX part and a higher threshold the trigger is quiet: 650 < 700.
    c.query(`UPDATE cost_index_triggers SET threshold_bp = 700, fx_currency = NULL, fx_base = NULL, fx_now = NULL, fx_buffer_bp = NULL`);
    [v] = await ci.triggers(e, TODAY);
    assert.equal(v.status, "quiet"); assert.equal(v.costChangeBp, "325");
    // A base date before the first point: no evaluation.
    c.query(`UPDATE cost_index_triggers SET base_date = '2025-06-01'`);
    [v] = await ci.triggers(e, TODAY);
    assert.equal(v.status, "insufficient"); assert.equal(v.indexChangeBp, null);
    // Validation: percent text, scope, unknown series, FX rates and currency.
    const ok = { name: "X", index: "Copper", scope: "product" as const, value: "P1", baseDate: "2026-01-15", thresholdPct: "5", passThroughPct: "100" };
    for (const badInput of [{ ...ok, thresholdPct: "0" }, { ...ok, passThroughPct: "101" }, { ...ok, thresholdPct: "1.234" }, { ...ok, baseDate: "2026-02-30" }, { ...ok, scope: "tier" }, { ...ok, name: "" },
      { ...ok, fx: { currency: "XXX", base: "1", now: "1", bufferPct: "0" } }, { ...ok, fx: { currency: "EUR", base: "0", now: "1", bufferPct: "0" } }, { ...ok, fx: { currency: "EUR", base: "1.1234567", now: "1", bufferPct: "0" } }])
      await assert.rejects(ci.triggerSql(e, badInput as ci.TriggerInput, "po", "x"), VaultError, JSON.stringify(badInput));
    await assert.rejects(ci.triggerSql(e, { ...ok, index: "Nickel" }, "po", "x"), (x: unknown) => x instanceof VaultError && /at least one point/.test(x.message));
    assert.deepEqual((await ci.series(e)).map(s => [s.name, s.points, s.last, s.lastValue]), [["Copper", "3", "2027-01-01", "200.0000"]]);
  } finally { c.close(); }
});

test("8B-1 agent rules on fixtures: leaks, floors, expiring contracts, cost rises and index triggers", async () => {
  const { c, e } = await vault(FIXTURE);
  try {
    c.query((await ci.triggerSql(e, { name: "Copper valves", index: "Copper", scope: "category", value: "Valves", baseDate: "2026-01-15", thresholdPct: "5", passThroughPct: "50" }, "po", "x")).sql);
    const steps: number[] = [];
    const found = await agents.collect(e, agents.DEFAULTS, async () => leakResult([{ id: "L1", cents: "15000" }, { id: "L2", cents: "5000" }]), TODAY, undefined, n => steps.push(n));
    assert.deepEqual(steps, [0, 1, 2, 3, 4, 5, 6]);
    const by = (rule: string) => found.filter(f => f.rule === rule);
    // Leaks: only L1 reaches the $100.00 threshold.
    assert.deepEqual(by("leak").map(f => [f.key, f.amountCents]), [["leak|L1", "15000"]]);
    // Floors (T1/Valves floor 8,000): m1 7,500 (gap 500) and C1's contract m2 7,000 (gap 1,000); m3 starts in 2027; m4 is above.
    assert.deepEqual(by("below_floor").map(f => [f.key, f.amountCents, f.detail.tier]), [["below_floor|m1", "500", "T1"], ["below_floor|m2", "1000", "T1"]]);
    // Contracts ending within 30 days of 2026-11-10: m2 (2026-11-20); m4 (2026-12-25) is 45 days out.
    assert.deepEqual(by("contract_expiry").map(f => f.key), ["contract_expiry|m2|2026-11-20"]);
    // Cost rises in the last 90 days of at least 3%: V/P1 5,000 -> 5,200 (+400 bp). V/P2 +200 bp is under; W/P3 is 132 days old; V/P4 is dated ahead.
    assert.deepEqual(by("cost_rise").map(f => [f.key, f.amountCents, f.detail.riseBp]), [["cost_rise|V|P1|2026-10-31", "200", "400"]]);
    assert.deepEqual(by("index_trigger").map(f => [f.subject, f.detail.costChangeBp]), [["Copper valves", "325"]]);
    assert.deepEqual(by("customer_health"), [], "no sales, no health alerts (the 7C-3b rule is reused as is)");
    const tighter = await agents.collect(e, { ...agents.DEFAULTS, leakThresholdCents: "0", costRiseBp: 200, expiryDays: 60 }, async () => leakResult([{ id: "L1", cents: "15000" }, { id: "L2", cents: "5000" }]), TODAY);
    assert.equal(tighter.filter(f => f.rule === "leak").length, 2); assert.equal(tighter.filter(f => f.rule === "cost_rise").length, 2); assert.equal(tighter.filter(f => f.rule === "contract_expiry").length, 2);
    const ctl = new AbortController(); ctl.abort();
    await assert.rejects(agents.collect(e, agents.DEFAULTS, async () => leakResult([]), TODAY, ctl.signal));
  } finally { c.close(); }
});

test("8B-1 inbox: new, seen again, read, dismissed, resolved and back again; run log and schedule", async () => {
  const { c, e } = await vault();
  try {
    const f = (key: string, amount: string | null = null): agents.Finding => ({ key, rule: "leak", subject: key, detail: { title: "T" }, amountCents: amount });
    let r = await agents.reconcileSql(e, [f("a", "100"), f("b"), f("c")], "open", "2026-11-10T08:00:00Z", "2026-11-10T08:00:05Z"); c.query(r.sql);
    assert.deepEqual(r.stats, { findings: "3", fresh: "3", resolved: "0" });
    c.query(agents.markSql("a", "read")); c.query(agents.markSql("b", "dismissed"));
    // Second run: a (read) seen again with a new amount, b (dismissed) seen again, c gone, d new.
    r = await agents.reconcileSql(e, [f("a", "250"), f("b"), f("d")], "schedule", "2026-11-10T09:00:00Z", "2026-11-10T09:00:05Z"); c.query(r.sql);
    assert.deepEqual(r.stats, { findings: "3", fresh: "1", resolved: "1" });
    const status = () => Object.fromEntries(q(c, "SELECT key, status FROM agent_inbox ORDER BY key").map(x => [x.key, x.status]));
    assert.deepEqual(status(), { a: "read", b: "dismissed", c: "resolved", d: "new" });
    assert.equal(q(c, "SELECT amount_cents::VARCHAR AS v FROM agent_inbox WHERE key='a'")[0].v, "250");
    // c comes back: it is new again; marking a resolved finding is refused silently.
    c.query(agents.markSql("c", "read"));
    r = await agents.reconcileSql(e, [f("a"), f("b"), f("c"), f("d")], "manual", "2026-11-10T10:00:00Z", "2026-11-10T10:00:05Z"); c.query(r.sql);
    assert.equal(status().c, "new");
    assert.deepEqual(await agents.counts(e), { new: "2", read: "1", dismissed: "1", resolved: "0" });
    const page = await agents.inbox(e, 0, { filters: [{ col: "status", values: ["new"] }] });
    assert.deepEqual(page.rows.map(x => x.key).sort(), ["c", "d"]); assert.equal(page.grid.total, "4");
    assert.deepEqual(await agents.lastRun(e), { startedAt: "2026-11-10T10:00:00Z", finishedAt: "2026-11-10T10:00:05Z", reason: "manual", findings: "4", fresh: "0", resolved: "0" });
    const last = await agents.lastRun(e);
    assert.equal(agents.due(agents.DEFAULTS, null, 0), true, "never run: due");
    assert.equal(agents.due(agents.DEFAULTS, last, Date.parse("2026-11-10T10:59:00Z")), false);
    assert.equal(agents.due(agents.DEFAULTS, last, Date.parse("2026-11-10T11:00:05Z")), true, "60 minutes after the last check");
    assert.equal(agents.due({ ...agents.DEFAULTS, enabled: false }, null, 0), false);
    for (const [k, s] of [["", "read"], ["a", "resolved"], ["a", "gone"]]) assert.throws(() => agents.markSql(k, s), VaultError);
  } finally { c.close(); }
});

test("8B-1 settings: defaults, validation and saving", async () => {
  const { c, e } = await vault();
  try {
    assert.deepEqual(await agents.settings(e), agents.DEFAULTS);
    const good = { enabled: true, intervalMinutes: 30, leakThresholdCents: "25000", healthThresholdBp: 700, expiryDays: 60 as const, costRiseBp: 250 };
    c.query(agents.settingsSql(good, "2026-11-10T00:00:00Z"));
    assert.deepEqual(await agents.settings(e), { ...good, updatedAt: "2026-11-10T00:00:00Z" });
    for (const bad of [{ ...good, intervalMinutes: 10 }, { ...good, intervalMinutes: 1441 }, { ...good, expiryDays: 45 }, { ...good, leakThresholdCents: "-1" }, { ...good, leakThresholdCents: "1.5" }, { ...good, healthThresholdBp: 0 }, { ...good, enabled: "yes" }, null])
      assert.throws(() => agents.settingsSql(bad, "x"), VaultError, JSON.stringify(bad));
  } finally { c.close(); }
});

test("8B-1 service: scheduled checks run only for cost roles on Professional/Scale, never reset the idle timer; capabilities", async () => {
  for (const a of ["agentState", "agentRows", "agentRun", "agentMark", "indexState", "indexSkus"] as const) assert.equal(ACTION_CAP[a], "cost", a);
  for (const a of ["agentSettingsSave", "indexTriggerSave", "indexTriggerDelete"] as const) assert.equal(ACTION_CAP[a], "pricing", a);
  for (const a of ["agentState", "agentRows", "indexState", "indexSkus"] as const) assert.ok(READ_ONLY_ACTIONS.has(a));
  for (const a of ["agentRun", "agentMark", "agentSettingsSave", "indexTriggerSave"] as const) assert.ok(!READ_ONLY_ACTIONS.has(a));
  const { c, e } = await vault(FIXTURE + `INSERT INTO role_assignments VALUES('own','Owner','owner','own','2026-01-01'),('rep','Rep','sales_rep','own','2026-01-01'),('sm','SM','sales_manager','own','2026-01-01');`);
  try {
    let touches = 0;
    const make = (userId: string, tier: "starter" | "professional") => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "t" }, writable: async () => e, save: async () => undefined, touch: () => { touches++; return { ok: true }; }, leakResult: async () => leakResult([{ id: "L1", cents: "20000" }]) });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "t", device: "d", tier, state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown = {}) => dispatch(s, { id: "x", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<any>;
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    assert.equal(await make("own", "starter").agentsDue(), false, "Starter has no agents");
    assert.equal(await make("rep", "professional").agentsDue(), false, "a Sales Rep's session never runs cost checks");
    const owner = make("own", "professional"), version = (owner as unknown as { dataVersion: number }).dataVersion;
    assert.equal(await owner.agentsDue(), true);
    assert.equal(touches, 0, "a scheduled check must not keep the vault unlocked");
    assert.equal((owner as unknown as { dataVersion: number }).dataVersion, version, "agent bookkeeping is not a data change");
    assert.equal(q(c, "SELECT reason FROM agent_runs")[0].reason, "open", "the first check after unlock is the open check");
    assert.equal(await owner.agentsDue(), false, "not due again for 60 minutes");
    assert.ok(q(c, "SELECT count(*) AS n FROM agent_inbox")[0].n !== "0");
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "agents.checked"));
    const state = await call(owner, "agentState"); assert.equal(state.last.reason, "open"); assert.equal(state.due, false);
    await call(owner, "agentRun"); assert.equal((await call(owner, "agentState")).last.reason, "manual");
    await call(owner, "agentSettingsSave", { input: { enabled: false, intervalMinutes: 15, leakThresholdCents: "0", healthThresholdBp: 500, expiryDays: 30, costRiseBp: 300 } });
    await assert.rejects(call(make("sm", "professional"), "agentSettingsSave", { input: agents.DEFAULTS }), is("FORBIDDEN"), "a Sales Manager reads the inbox but does not change the agents");
    assert.ok(await call(make("sm", "professional"), "agentState"));
    for (const a of ["agentState", "agentRows", "agentRun", "indexState"]) await assert.rejects(call(make("rep", "professional"), a), is("FORBIDDEN"), a);
    for (const a of ["agentState", "indexState"]) await assert.rejects(call(make("own", "starter"), a), is("LICENCE"), a);
    const saved = await call(owner, "indexTriggerSave", { input: { name: "Copper", index: "Copper", scope: "category", value: "Valves", baseDate: "2026-01-15", thresholdPct: "5", passThroughPct: "50" } });
    assert.equal(saved.triggers.length, 1); assert.equal(saved.series[0].name, "Copper");
    assert.equal((await call(owner, "indexTriggerDelete", { id: saved.triggers[0].id })).triggers.length, 0);
  } finally { c.close(); }
});
