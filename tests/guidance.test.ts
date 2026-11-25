// Chunk 8A: explainable deal guidance and cross-sell. Every expected price, count, confidence and lift below is
// worked out by hand from the fixture rows.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import { lineGuidance, medianCents, quoteGuidance, type Reason } from "../lib/quotes/guidance";
import { crossSell, MIN_TOGETHER } from "../lib/quotes/crosssell";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { ACTION_CAP } from "../lib/roles/access";
import { READ_ONLY_ACTIONS } from "../lib/vault/licence";

const TODAY = "2026-11-10";
async function vault(extra = "") {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'2026-10-01');
INSERT INTO products(product_id,description,category,current_cost,list_price) VALUES('A','Valve','Valves',6000,11000),('B','Gasket','Valves',100,500),('C','Hose','Hoses',200,900),('D','Clamp','Hoses',50,300),('E','Tape','Misc',10,100);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','One','T1'),('C2','Two','T1'),('C3','Three','T1'),('C4','Four','T2');
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g','unit_price',12000,10000,8000,'T1','Valves');${extra}`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const line = (id: number, p: string, cust: string, d: string, qty: number, list: number, disc = 0, inv: string | null = null) => `('s',${id},'${p}','${cust}','${d}',${qty},${list},${disc},0,0,0,${id + 1},${inv === null ? "NULL" : `'${inv}'`})`;
const sales = (rows: string[]) => `INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES ${rows.join(",")};`;
const input = (over: Partial<Parameters<typeof lineGuidance>[1]> = {}) => ({ productId: "A", customerId: "C1", tier: "T1", quotedCents: "10500", bookCents: "11000", startCents: "12000", targetCents: "10000", floorCents: "8000", today: TODAY, ...over });
const codes = (r: Reason[]) => r.map(x => x.code + ("used" in x && x.used ? "*" : "") + ("applied" in x ? (x.applied ? "+" : "-") : ""));

test("8A median of whole cents: middle value, or the two middle values averaged half away from zero", () => {
  assert.equal(medianCents([]), null);
  assert.equal(medianCents([BigInt(9900), BigInt(9500), BigInt(9700)]), BigInt(9700));
  assert.equal(medianCents([BigInt(1), BigInt(2)]), BigInt(2), "1.5 rounds half away from zero");
  assert.equal(medianCents([BigInt(9700), BigInt(9900), BigInt(9500), BigInt(10100)]), BigInt(9800));
});

test("8A guidance: customer history first, then similar customers, then target, then book; clamps and reasons", async () => {
  // C1's history of A: net units 9,500 (list 10,000 - discount 500), 9,700 (19,400 for 2), 9,900; a 2024 sale is outside the year.
  // Similar T1 customers: C2 10,500 and 11,000; C3 10,800 (C4 is tier T2 and does not count).
  const { c, e } = await vault(sales([line(1, "A", "C1", "2026-08-01", 1, 10000, 500), line(2, "A", "C1", "2026-09-01", 2, 19400), line(3, "A", "C1", "2026-10-01", 1, 9900),
    line(4, "A", "C1", "2024-01-01", 1, 1000), line(5, "A", "C2", "2026-09-10", 1, 10500), line(6, "A", "C2", "2026-09-20", 1, 11000), line(7, "A", "C3", "2026-09-15", 1, 10800), line(8, "A", "C4", "2026-09-15", 1, 1)]));
  try {
    let g = await lineGuidance(e, input());
    assert.equal(g.basis, "history"); assert.equal(g.suggestedCents, "9700");
    assert.deepEqual(codes(g.reasons), ["history*", "similar", "target", "book"]);
    assert.deepEqual(g.reasons[0], { code: "history", cents: "9700", count: "3", date: "2026-10-01", used: true });
    assert.deepEqual(g.reasons[1], { code: "similar", cents: "10800", count: "3", customers: "2", tier: "T1", used: false });
    // A recent supplier cost rise holds the suggestion at the target (9,700 -> 10,000); an older rise does not count.
    c.query(`INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('v1','V','A',5000,'2026-01-01','f'),('v2','V','A',5600,'2026-10-20','f')`);
    g = await lineGuidance(e, input());
    assert.equal(g.suggestedCents, "10000"); assert.deepEqual(codes(g.reasons), ["history*", "similar", "target", "book", "costRise+"]);
    assert.ok(!JSON.stringify(g).includes("5600") && !JSON.stringify(g).includes("5000"), "the cost rise is a flag, never an amount");
    assert.equal((await lineGuidance(e, input({ today: "2027-03-01" }))).suggestedCents, "9700", "a rise more than 90 days old is ignored");
    c.query("DELETE FROM vendor_costs");
    // A customer with no history of A: the other T1 customers decide. C1 9,500 / 9,700 / 9,900, C2 10,500 / 11,000 and C3
    // 10,800 give six lines from three customers; the median is (9,900 + 10,500) / 2 = 10,200.
    g = await lineGuidance(e, input({ customerId: "C9", tier: "T1" }));
    assert.equal(g.basis, "similar"); assert.equal(g.suggestedCents, "10200");
    assert.deepEqual(g.reasons[0], { code: "similar", cents: "10200", count: "6", customers: "3", tier: "T1", used: true });
    // Too few similar customers (only C2 once C1's and C3's lines of A are gone) falls back to the target.
    c.query("DELETE FROM sales_lines WHERE product_id = 'A' AND customer_id IN ('C1', 'C3')");
    g = await lineGuidance(e, input({ customerId: "C9" }));
    assert.equal(g.basis, "target"); assert.equal(g.suggestedCents, "10000"); assert.deepEqual(codes(g.reasons), ["target*", "book"]);
    // No guardrail and no history: the book price; nothing at all: no suggestion.
    g = await lineGuidance(e, input({ productId: "E", startCents: null, targetCents: null, floorCents: null }));
    assert.equal(g.basis, "book"); assert.equal(g.suggestedCents, "11000");
    g = await lineGuidance(e, input({ productId: "E", bookCents: null, startCents: null, targetCents: null, floorCents: null }));
    assert.equal(g.suggestedCents, null); assert.deepEqual(g.reasons, [{ code: "none" }]);
    // History below the floor is raised to the floor; above the start price it is held at the start.
    c.query(sales([line(20, "B", "C1", "2026-10-01", 1, 7000), line(21, "C", "C1", "2026-10-01", 1, 13000)]));
    g = await lineGuidance(e, input({ productId: "B" }));
    assert.equal(g.suggestedCents, "8000"); assert.deepEqual(codes(g.reasons).slice(-1), ["floor"]);
    g = await lineGuidance(e, input({ productId: "C" }));
    assert.equal(g.suggestedCents, "12000"); assert.deepEqual(codes(g.reasons).slice(-1), ["start"]);
    // Only the five newest lines count as history.
    c.query(sales([10, 11, 12, 13, 14, 15].map((n, i) => line(30 + i, "D", "C1", `2026-0${i + 4}-01`, 1, n * 1000))));
    g = await lineGuidance(e, input({ productId: "D", startCents: null, targetCents: null, floorCents: null }));
    assert.equal(g.suggestedCents, "13000", "median of 11,000..15,000"); assert.equal((g.reasons[0] as { count: string }).count, "5");
  } finally { c.close(); }
});

test("8A quote guidance reads each line's stored book price and guardrail", async () => {
  const { c, e } = await vault(sales([line(1, "A", "C1", "2026-10-01", 1, 9900)]) + `
INSERT INTO quotes(id,number,customer_id,status,created_by,created_at,updated_at) VALUES('q','Q-1','C1','draft','rep','2026-11-01','2026-11-01');
INSERT INTO quote_lines(quote_id,line_no,product_id,quantity,unit_price_cents,book_price_cents,price_source,start_cents,target_cents,floor_cents,guard_status,cost_cents) VALUES
 ('q',1,'A',1,10500,11000,'list',12000,10000,8000,'green',6000),('q',2,'E',1,100,100,'list',NULL,NULL,NULL,'unset',10)`);
  try {
    const g = await quoteGuidance(e, "q", TODAY);
    assert.deepEqual(g.lines.map(l => [l.lineNo, l.productId, l.quotedCents, l.suggestedCents, l.basis]), [[1, "A", "10500", "9900", "history"], [2, "E", "100", "100", "book"]]);
    assert.ok(!JSON.stringify(g).includes("6000"), "the stored line cost never enters the guidance");
    assert.deepEqual(await quoteGuidance(e, "missing", TODAY), { quoteId: "missing", lines: [] });
  } finally { c.close(); }
});

test("8A cross-sell: baskets, confidence and lift worked out by hand; thresholds and exclusions", async () => {
  // Six baskets in the year: I1 {A,B,C}, I2 {A,B}, I3 {A,B,D}, I4 {C}, C2's purchases on 2026-10-05 without an invoice {A,D}, I6 {E}.
  // A is in 4 baskets; B in 3; C in 2; D in 2; E in 1.
  //   A->B: together 3, confidence 3/4 = 75.00%, lift = 3 x 6 / (4 x 3) = 1.50 (kept: 3 baskets, lift >= 1.20).
  //   A->D: together 2: below the 3-basket minimum.  A->C: together 1.
  const { c, e } = await vault(sales([
    line(1, "A", "C2", "2026-10-01", 1, 100, 0, "I1"), line(2, "B", "C2", "2026-10-01", 1, 100, 0, "I1"), line(3, "C", "C2", "2026-10-01", 1, 100, 0, "I1"),
    line(4, "A", "C3", "2026-10-02", 1, 100, 0, "I2"), line(5, "B", "C3", "2026-10-02", 1, 100, 0, "I2"),
    line(6, "A", "C3", "2026-10-03", 1, 100, 0, "I3"), line(7, "B", "C3", "2026-10-03", 1, 100, 0, "I3"), line(8, "D", "C3", "2026-10-03", 1, 100, 0, "I3"),
    line(9, "C", "C4", "2026-10-04", 1, 100, 0, "I4"),
    line(10, "A", "C2", "2026-10-05", 1, 100), line(11, "D", "C2", "2026-10-05", 1, 100),
    line(12, "E", "C1", "2026-10-06", 1, 100, 0, "I6"),
    line(13, "B", "C4", "2025-01-01", 1, 100, 0, "OLD"), line(14, "A", "C4", "2025-01-01", 1, 100, 0, "OLD")]));
  try {
    assert.equal(MIN_TOGETHER, 3);
    assert.deepEqual(await crossSell(e, "C1", ["A"]), [{ productId: "B", description: "Gasket", category: "Valves", basedOn: "A", together: "3", confidence: "75.00", lift: "1.50" }]);
    assert.deepEqual(await crossSell(e, "C1", ["A", "B"]), [], "products already on the quote are never suggested");
    assert.deepEqual(await crossSell(e, "C3", ["A"]), [], "a product the customer already buys is not suggested");
    assert.deepEqual(await crossSell(e, "C1", []), []);
    // Lift below 1.20 is dropped: with B in every basket, A->B lift falls to 1.00.
    c.query(sales(["I4", "I6"].map((inv, i) => line(40 + i, "B", "C4", "2026-10-07", 1, 100, 0, inv)).concat([line(42, "B", "C2", "2026-10-05", 1, 100)])));
    assert.deepEqual(await crossSell(e, "C1", ["A"]), []);
    // SQL text in a product id is data.
    assert.deepEqual(await crossSell(e, "C1", ["A') OR 1=1 --"]), []);
  } finally { c.close(); }
});

test("8A commands: Quote Desk tier, quote capability, own quotes only, read-only", async () => {
  assert.equal(ACTION_CAP.quoteGuidance, "quote"); assert.equal(ACTION_CAP.quoteCrossSell, "quote");
  assert.ok(READ_ONLY_ACTIONS.has("quoteGuidance") && READ_ONLY_ACTIONS.has("quoteCrossSell"));
  const { c, e } = await vault(`INSERT INTO role_assignments VALUES('rep1','Rep one','sales_rep','owner','2026-01-01'),('rep2','Rep two','sales_rep','owner','2026-01-01'),('acct','Acct','accountant','owner','2026-01-01'),('own','Owner','owner','owner','2026-01-01');
INSERT INTO quotes(id,number,customer_id,status,created_by,created_at,updated_at) VALUES('q','Q-1','C1','draft','rep1','2026-11-01','2026-11-01');`);
  try {
    const make = (userId: string, tier: "starter" | "professional") => {
      const s = new VaultService(() => undefined); s.engine = e;
      Object.assign(s, { identity: { userId, tenantId: "t" }, writable: async () => e, save: async () => undefined, touch: () => undefined });
      const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: userId, workspace: "t", device: "d", tier, state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" }; return s;
    };
    const call = (s: VaultService, action: string) => dispatch(s, { id: "x", action, data: { id: "q" } } as Request, { signal: () => new AbortController().signal, progress: () => undefined });
    const is = (code: string) => (x: unknown) => x instanceof VaultError && x.code === code;
    for (const a of ["quoteGuidance", "quoteCrossSell"]) {
      assert.ok(await call(make("rep1", "professional"), a), a);
      assert.ok(await call(make("own", "professional"), a), "a cost role may open any quote");
      await assert.rejects(call(make("rep2", "professional"), a), is("FORBIDDEN"), "another rep's quote");
      await assert.rejects(call(make("acct", "professional"), a), is("FORBIDDEN"), "no quote capability");
      await assert.rejects(call(make("rep1", "starter"), a), is("LICENCE"), "Quote Desk is Professional and Scale");
    }
  } finally { c.close(); }
});

test("v2.6 gap 2: the relay set-up card's check is local: identity of this device, read from the vault, no request", async () => {
  assert.equal(ACTION_CAP.relayLocal, "collaborate"); assert.ok(READ_ONLY_ACTIONS.has("relayLocal"));
  const { c, e } = await vault();
  try {
    const s = new VaultService(() => undefined); s.engine = e;
    const now = Math.floor(Date.now() / 1000); s.licence.claims = { v: 1, sub: "u", workspace: "t", device: "dev-1", tier: "professional", state: "active", issued: now, expires: now + 3600, offlineUntil: now + 86400, reason: "" };
    const fetches: unknown[] = []; const real = globalThis.fetch; globalThis.fetch = (async (...a: unknown[]) => { fetches.push(a); throw new Error("no network"); }) as typeof fetch;
    try {
      const none = { identity: false, pending: false, lastSyncedAt: null, live: null }; // live: the S4 doorbell, not started here
      assert.deepEqual(await s.relayLocal(), none, "no relay state yet");
      c.query(`INSERT INTO relay_state VALUES(1,'${JSON.stringify({ version: "1", identity: { device: { deviceId: "dev-2" } }, lastSyncedAt: "2026-11-20T10:00:00.000Z", pending: { sequence: "2" } })}')`);
      assert.deepEqual(await s.relayLocal(), none, "another device's identity does not count, nor its sync state");
      c.query(`UPDATE relay_state SET payload='${JSON.stringify({ version: "1", identity: { device: { deviceId: "dev-1" } } })}'`);
      assert.deepEqual(await s.relayLocal(), { identity: true, pending: false, lastSyncedAt: null, live: null });
      // Roadmap 8.4: the sharing card's status comes from the same local row.
      c.query(`UPDATE relay_state SET payload='${JSON.stringify({ version: "1", identity: { device: { deviceId: "dev-1" } }, lastSyncedAt: "2026-11-20T10:00:00.000Z", pending: null, pendingEpoch: { epoch: {} } })}'`);
      assert.deepEqual(await s.relayLocal(), { identity: true, pending: true, lastSyncedAt: "2026-11-20T10:00:00.000Z", live: null });
      c.query("UPDATE relay_state SET payload='not json'");
      assert.deepEqual(await s.relayLocal(), none);
      assert.equal(fetches.length, 0, "the check never touches the network");
    } finally { globalThis.fetch = real; }
  } finally { c.close(); }
});
