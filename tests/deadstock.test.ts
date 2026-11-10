// Chunk 8B-2: the dead-stock clearance optimiser. Every expected amount is worked out by hand in the comments.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, tablesFor, upgradeSql } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as dead from "../lib/inventory/deadstock";
import { clearanceDraft, approvalMatrixSql } from "../lib/pricing/ops";
import { VaultService } from "../lib/vault/service";
import { VaultError, type Request } from "../lib/vault/protocol";
import { dispatch } from "../lib/vault/dispatch";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";
import { ROLE_FIELDS, LOADABLE } from "../lib/studio/formats";
import { detectRole } from "../lib/studio/mapper";
import { commitSql, removeChildrenSql } from "../lib/studio/load";

const TODAY = "2026-11-10";
// Settings for the fixture: idle 90 days, cost of capital 12.00% a year, storage $0.05 per unit per month, 6 months.
const SET: dead.DeadSettings = { idleDays: 90, capitalRateBp: 1200, storageCents: "5", horizonMonths: 6, updatedAt: null };
async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'2026-11-01'),('i','stock.csv','customer_list',1,'2026-11-01');
INSERT INTO products(product_id,description,category,uom,current_cost,list_price) VALUES
 ('D1','Valve','Valves','EA',6000,10000),('D2','Seal','Valves','EA',333,345),('D3','Hose','Hoses','EA',NULL,400),('D4','Gauge','Gauges','EA',NULL,800),
 ('A1','Valve two','Valves','EA',5000,9000),('A2','Valve three','Valves','EA',100,200),('A3','Valve four','Valves','EA',100,200),('A4','Valve five','Valves','EA',100,200),('A5','Valve box','Valves','BOX',100,200);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','One','T1');
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('v1','V','D3',400,'2026-01-01','f'),('v2','V','D3',450,'2026-09-01','f');
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g','unit_price',12000,10000,9700,'T1','Valves');
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind) VALUES
 ('s',1,'D1','C1','2026-07-01',2,20000,0,0,0,12000,2,'I1','sale'),('s',2,'D1','C1','2026-10-15',-1,-10000,0,0,0,-6000,3,'I2','credit'),
 ('s',3,'A1','C1','2026-10-01',5,45000,0,0,0,25000,4,'I3','sale'),('s',4,'A2','C1','2026-09-15',2,400,0,0,0,200,5,'I4','sale'),
 ('s',5,'A3','C1','2026-10-20',9,1800,0,0,0,900,6,'I5','sale'),('s',6,'A4','C1','2026-10-21',1,200,0,0,0,100,7,'I6','sale'),('s',7,'A5','C1','2026-10-22',50,10000,0,0,0,5000,8,'I7','sale');
INSERT INTO inventory_levels(source_id,product_id,location,on_hand,source_row) VALUES
 ('i','D1','North',4,2),('i','D1','South',6,3),('i','D2','',2.5,4),('i','D3','',1,5),('i','D4','',3,6),('i','A1','',20,7),('i','A2','',0,8),('i','ZZ','',7,9);`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}

test("8B-2 schema v19: stock on hand, dead-stock settings and clearance drafts", async () => {
  assert.equal(SCHEMA_VERSION, 19);
  assert.deepEqual(tablesFor(19).filter(t => !tablesFor(18).includes(t)), ["inventory_levels", "dead_stock_settings"]);
  assert.equal(upgradeSql(19), "");
  const c = await duckdbConnection();
  try {
    c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
    c.query(schemaSql(18));
    c.query("INSERT INTO source_kinds VALUES('a','cost_index'); INSERT INTO price_changesets VALUES('r','planner',NULL,'category','Valves',450,'u','2026-01-01')");
    c.query(upgradeSql(18));
    assert.deepEqual(q(c, "SELECT * FROM source_kinds"), [{ source_id: "a", kind: "cost_index" }]);
    assert.equal(q(c, "SELECT count(*) n FROM price_changesets WHERE run_id='r' AND increase_bp=450")[0].n, "1", "earlier drafts survive the upgrade");
    c.query("INSERT INTO source_kinds VALUES('b','inventory'); INSERT INTO price_changesets VALUES('k','clearance',NULL,'clearance','2',NULL,'u','2026-01-01')");
    assert.throws(() => c.query("INSERT INTO inventory_levels VALUES('i','P','',-1,2)"), "negative stock is refused");
    assert.throws(() => c.query("INSERT INTO dead_stock_settings VALUES(1,60,1000,0,12,'x')"), "fewer than 90 idle days is refused");
  } finally { c.close(); }
});

test("8B-2 stock-on-hand import role: fields, detection, load and removal SQL", () => {
  assert.deepEqual(ROLE_FIELDS.inventory.map(f => [f.name, f.type, f.required]), [["product_id", "id", true], ["location", "text", false], ["on_hand", "quantity0", true]]);
  assert.ok(LOADABLE.includes("inventory"));
  assert.equal(detectRole("stock-on-hand.csv", ["product_id", "location", "on_hand"]).role, "inventory");
  assert.ok(commitSql(new Set(["inventory"])).includes("INSERT INTO inventory_levels(source_id,product_id,location,on_hand,source_row)"));
  assert.ok(removeChildrenSql("s1", false, false, false, true).includes("DELETE FROM inventory_levels WHERE source_id='s1'"));
  assert.ok(!removeChildrenSql("s1").includes("inventory_levels"), "older vault versions have no stock table");
});

test("8B-2 dead stock: idle items, capital, carrying cost, clearance price floored at replacement cost, substitutes", async () => {
  const { c, e } = await vault();
  try {
    const all = (await dead.page(e, SET, TODAY)).rows, by = Object.fromEntries(all.map(r => [r.product_id, r]));
    // A1 sold on 1 October and A2 has zero on hand: neither is dead. D1's last sale is 1 July (the October credit is not
    // a sale): 132 days idle. ZZ is not in the item master and is left out.
    assert.deepEqual(all.map(r => r.product_id).sort(), ["D1", "D2", "D3", "D4"]);
    // D1: 4 + 6 = 10 on hand at $60.00. Capital 10 × 6,000 = 60,000. Carrying per month 60,000 × 12% / 12 = 600, plus
    // 10 × 5 = 50: 650. One unit over 6 months: 6,000 × 12% × 6 / 12 = 360, plus 5 × 6 = 30: 390. Clearance price
    // 10,000 − 390 = 9,610, above cost. Substitutes: Valves/EA items sold in the window by units, A3 (9), A1 (5), A2 (2).
    assert.deepEqual({ ...by.D1, description: undefined }, { product_id: "D1", description: undefined, category: "Valves", uom: "EA", on_hand: "10.0000", last_sale: "2026-07-01", idle_days: "132", unit_cost: "6000",
      capital: "60000", carrying_month: "650", price: "10000", suggested: "9610", markdown: "390", status: "suggested", substitutes: "A3, A1, A2" });
    // D2, never sold: 2.5 at $3.33. Capital 832.5 → 833. Carrying 2.5 × 333 × 12% / 12 = 8.325 → 8, plus 2.5 × 5 = 12.5 → 13:
    // 21. One unit: 333 × 12% × 6 / 12 = 19.98 → 20, plus 30: 50. 345 − 50 = 295 is below cost, so the price is 333.
    assert.deepEqual([by.D2.last_sale, by.D2.idle_days, by.D2.capital, by.D2.carrying_month, by.D2.suggested, by.D2.markdown, by.D2.status], [null, null, "833", "21", "333", "12", "floored"]);
    // D3 has no item master cost: the newest vendor cost, 450, is the replacement cost. Its list price 400 is already below
    // it: the price is kept. Carrying 1 × 450 × 12% / 12 = 4.5 → 5, plus 5: 10. No other Hoses item sold.
    assert.deepEqual([by.D3.unit_cost, by.D3.capital, by.D3.carrying_month, by.D3.suggested, by.D3.markdown, by.D3.status, by.D3.substitutes], ["450", "450", "10", "400", "0", "at_cost", ""]);
    assert.deepEqual([by.D4.unit_cost, by.D4.capital, by.D4.suggested, by.D4.status], [null, null, null, "no_cost"]);
    // Totals: 60,000 + 833 + 450 = 61,283 tied up; 650 + 21 + 10 = 681 a month.
    assert.deepEqual(await dead.summary(e, SET, TODAY), { skus: "4", capital: "61283", carryingMonth: "681", noCost: "1", priced: "2", stockRows: "8", unknownItems: "1" });
    // A longer idle window: A2/A3/A4 sold within 90 days but D1's 132 days are under 180, so D1 is no longer dead.
    assert.ok(!(await dead.page(e, { ...SET, idleDays: 180 }, TODAY)).rows.some(r => r.product_id === "D1"));
    // The grid standard: filter and sort in the worker.
    const sorted = await dead.page(e, SET, TODAY, 0, { sort: { col: "capital", dir: "desc" }, filters: [{ col: "status", values: ["suggested", "floored"] }] });
    assert.deepEqual(sorted.rows.map(r => r.product_id), ["D1", "D2"]); assert.equal(sorted.grid.matched, "2");
  } finally { c.close(); }
});

test("8B-2 settings: defaults, validation and saving", async () => {
  const { c, e } = await vault();
  try {
    assert.deepEqual(await dead.settings(e), dead.DEFAULTS);
    await e.conn.query(dead.settingsSql({ idleDays: 120, capitalRateBp: 1200, storageCents: "5", horizonMonths: 6 }, "2026-11-10T00:00:00Z"));
    assert.deepEqual(await dead.settings(e), { idleDays: 120, capitalRateBp: 1200, storageCents: "5", horizonMonths: 6, updatedAt: "2026-11-10T00:00:00Z" });
    for (const bad of [{ idleDays: 60 }, { capitalRateBp: 10001 }, { storageCents: "-1" }, { storageCents: "1.5" }, { horizonMonths: 0 }, { horizonMonths: 37 }])
      assert.throws(() => dead.settingsSql({ ...dead.DEFAULTS, ...bad }, "x"), VaultError);
  } finally { c.close(); }
});

test("8B-2 clearance draft: worker-picked prices, kept at the guardrail floor, through the normal changeset and approval", async () => {
  const { c, e } = await vault();
  try {
    // D3 is already below cost and D4 has no cost: only D1 and D2 are drafted.
    const picks = await dead.picks(e, SET, TODAY, ["D1", "D2", "D3", "D4"]);
    assert.deepEqual(picks, [{ product_id: "D1", suggested: "9610" }, { product_id: "D2", suggested: "333" }]);
    await assert.rejects(dead.picks(e, SET, TODAY, []), VaultError);
    const run = await clearanceDraft(e, picks, "owner");
    // D1 sold to tier T1, whose Valves floor is 97.00: 96.10 is raised to the floor. D2 never sold: the list price row.
    assert.deepEqual(q(c, `SELECT product_id, tier, before_cents b, after_cents a, guard_status AS guard FROM rule_changes WHERE run_id='${run}' ORDER BY product_id`),
      [{ product_id: "D1", tier: "T1", b: "10000", a: "9700", guard: "yellow" }, { product_id: "D2", tier: "", b: "345", a: "333", guard: "unset" }]);
    assert.deepEqual(q(c, `SELECT kind, segment_type, segment_value FROM price_changesets WHERE run_id='${run}'`), [{ kind: "clearance", segment_type: "clearance", segment_value: "2" }]);
    assert.deepEqual(q(c, `SELECT status FROM rule_runs WHERE id='${run}'`), [{ status: "preview" }]);
    c.query((await approvalMatrixSql(e, run))!);
    assert.deepEqual(q(c, `SELECT product_id, coalesce(tier,'') tier, price FROM price_matrix WHERE id LIKE '${run}%' ORDER BY product_id`), [{ product_id: "D1", tier: "T1", price: "9700" }, { product_id: "D2", tier: "", price: "333" }]);
    await assert.rejects(clearanceDraft(e, [], "owner"), VaultError);
  } finally { c.close(); }
});

test("8B-2 service: Professional/Scale, cost to read, pricing and a named owner to draft; capabilities", async () => {
  assert.deepEqual(["deadState", "deadRows", "deadSettingsSave", "deadDraft"].map(a => ACTION_CAP[a as keyof typeof ACTION_CAP]), ["cost", "cost", "pricing", "pricing"]);
  assert.ok(READ_ONLY_ACTIONS.has("deadState") && READ_ONLY_ACTIONS.has("deadRows") && !READ_ONLY_ACTIONS.has("deadDraft") && !READ_ONLY_ACTIONS.has("deadSettingsSave"));
  const { c, e } = await vault();
  c.query("INSERT INTO role_assignments VALUES('own','Owner','owner','own','2026-01-01'),('rep','Rep','sales_rep','own','2026-01-01'),('sm','SM','sales_manager','own','2026-01-01'); INSERT INTO pricing_settings VALUES(1,'own','Owner',7)");
  try {
    const make = (userId: string, tier: "starter" | "professional") => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "t" }, writable: async () => e, save: async () => undefined, touch: () => ({ ok: true }) });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "t", device: "d", tier, state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string, data: unknown = {}) => dispatch(s, { id: "x", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<any>;
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    const owner = make("own", "professional");
    const saved = await call(owner, "deadSettingsSave", { input: { idleDays: 90, capitalRateBp: 1200, storageCents: "5", horizonMonths: 6 } });
    assert.deepEqual([saved.summary.capital, saved.summary.carryingMonth, saved.page.grid.total], ["61283", "681", "4"]);
    assert.equal((await call(owner, "deadRows", { offset: 0, grid: { filters: [{ col: "status", values: ["floored"] }] } })).rows[0].product_id, "D2");
    const draft = await call(owner, "deadDraft", { ids: ["D1", "D2"] });
    assert.equal(draft.count, "2"); assert.equal(draft.status, "preview");
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "dead.draft_created"));
    await assert.rejects(call(owner, "deadDraft", { ids: ["D3"] }), is("DEADSTOCK"), "nothing to draft");
    assert.ok(await call(make("sm", "professional"), "deadState"));
    await assert.rejects(call(make("sm", "professional"), "deadDraft", { ids: ["D1"] }), is("FORBIDDEN"), "a Sales Manager reads but does not draft");
    for (const a of ["deadState", "deadRows"]) await assert.rejects(call(make("rep", "professional"), a), is("FORBIDDEN"), a);
    await assert.rejects(call(make("own", "starter"), "deadState"), is("LICENCE"), "Starter has no dead-stock optimiser");
  } finally { c.close(); }
});
