// 7B Quote Desk, Price Check and the AR aging credit signal, run through the real worker dispatcher.
// Decision 16: no payload a Sales Rep can receive carries cost or margin (keys or values).
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, SCHEMA_VERSION } from "../lib/vault/schema";
import { ACTION_CAP, capsFor, type RoleId } from "../lib/roles/access";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { creditSignal, CREDIT_RULES } from "../lib/quotes/credit";
import { pricePoint } from "../lib/quotes/quotes";
import { plainText } from "../lib/i18n/core";
import type { Engine } from "../lib/vault/engine";

type Conn = Awaited<ReturnType<typeof duckdbConnection>>;
const people: Record<string, RoleId> = { owner1: "owner", po: "pricing_owner", pm: "pricing_manager", sm: "sales_manager", rep: "sales_rep", rep2: "sales_rep", acct: "accountant", adm: "admin" };
const COST = "4321"; // P1's unit cost: a distinctive value that must never reach a rep
async function vault() {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(SCHEMA_VERSION)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0);
INSERT INTO pricing_settings VALUES(1,'po','Pat Owner',7);
INSERT INTO role_assignments VALUES ${Object.entries(people).map(([id, role]) => `('${id}','${id}','${role}','owner1','2025-01-01')`).join(",")};
INSERT INTO products(product_id,description,category,uom,current_cost,list_price) VALUES('P1','Ball valve','Valves','EA',${COST},12000),('P2','Gate valve','Valves','EA',NULL,9000),('P3','Hose','Hoses','EA',100,500);
INSERT INTO customers(customer_id,name,tier) VALUES('C1','Acme','T01'),('C2','Beta','T02'),('C3','Corex','T01'),('C4','Delta','');
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g1','unit_price',11000,10000,8000,'T01','Valves');
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES
 ('m1','P1','Valves',NULL,'T01',0,10500,'2025-01-01',NULL),('m2','P1','Valves',NULL,'T01',100,9900,'2025-01-01',NULL),
 ('m3','P1','Valves','C3',NULL,0,10200,'2025-01-01',NULL),('m4',NULL,'Valves',NULL,'T01',0,9500,'2025-01-01',NULL),
 ('m5','P1','Valves',NULL,'T01',0,1,'2024-01-01','2025-01-01'),('m6','P1','Valves',NULL,'T01',0,2,'2099-01-01',NULL);
INSERT INTO credit_profiles VALUES('C1','2025-05-31',100000,0,0,0,20000,500000,30,'s1',1),('C2','2025-05-31',100000,0,0,0,0,500000,20,'s1',2);`);
  return { c, e: { conn: c } as unknown as Engine };
}
function serviceFor(c: Conn, userId: string, tier = "professional") {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" }; // async, like the worker
  s.licence = { tier, assert() {}, guard() {}, view: () => null, claims: { tier } };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as VaultService;
}
const call = <A extends Request["action"]>(s: VaultService, action: A, data: Extract<Request, { action: A }>["data"]) =>
  dispatch(s, { id: "1", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<never>;
const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;

/** Every key and string in a payload, for the decision 16 scan. */
function leaks(payload: unknown, path = "$"): string[] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "bigint") return String(payload).includes(COST) ? [`${path} = ${String(payload)}`] : [];
  if (Array.isArray(payload)) return payload.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (typeof payload === "object") return Object.entries(payload as Record<string, unknown>).flatMap(([k, v]) => [...(/cost|margin/i.test(k) ? [`${path}.${k}`] : []), ...leaks(v, `${path}.${k}`)]);
  return [];
}

test("7B price resolution: customer price, then tier with quantity breaks, then category, then the item list price", async () => {
  const { c, e } = await vault();
  try {
    const at = "2025-06-01";
    const p1 = await pricePoint(e, "P1", "C1", "1", at);
    assert.deepEqual([p1.bookCents, p1.source, p1.guard, p1.startCents, p1.targetCents, p1.floorCents], ["10500", "tier", "green", "11000", "10000", "8000"]); // expired and future rows are ignored
    assert.deepEqual([(await pricePoint(e, "P1", "C1", "150", at)).bookCents, (await pricePoint(e, "P1", "C1", "150", at)).guard], ["9900", "yellow"]);
    assert.equal((await pricePoint(e, "P1", "C1", "100", at)).bookCents, "9900"); // the break applies at its quantity
    assert.deepEqual([(await pricePoint(e, "P1", "C3", "1", at)).bookCents, (await pricePoint(e, "P1", "C3", "1", at)).source], ["10200", "customer"]);
    assert.deepEqual([(await pricePoint(e, "P2", "C1", "1", at)).bookCents, (await pricePoint(e, "P2", "C1", "1", at)).source], ["9500", "category"]);
    const list = await pricePoint(e, "P2", "C4", "1", at); assert.deepEqual([list.bookCents, list.source, list.guard], ["9000", "list", "unset"]);
    assert.equal((await pricePoint(e, "P2", null, "1", at)).credit.level, "unknown");
    assert.equal((await pricePoint(e, "P1", "C1", "1", at)).credit.level, "red"); // 16.7% over 90 days
    await assert.rejects(pricePoint(e, "NOPE", "C1", "1", at), code("QUOTE")); await assert.rejects(pricePoint(e, "P1", "NOPE", "1", at), code("QUOTE"));
    for (const bad of ["0", "-1", "1e3", "1.23456", "", "1;DROP TABLE quotes"]) await assert.rejects(pricePoint(e, "P1", "C1", bad, at), code("QUOTE"), bad);
    assert.deepEqual(leaks(p1), [], "a price point never carries cost");
  } finally { c.close(); }
});

test("7B credit signal from AR aging: green, amber and red thresholds", () => {
  const p = (o: Partial<Parameters<typeof creditSignal>[0] & object>) => creditSignal({ asOf: "2025-05-31", current: BigInt(100000), d1_30: BigInt(0), d31_60: BigInt(0), d61_90: BigInt(0), d90plus: BigInt(0), limit: BigInt(500000), dso: "30", ...o });
  assert.equal(creditSignal(null).level, "unknown");
  assert.equal(p({}).level, "green");
  assert.equal(p({ d61_90: BigInt(12000) }).level, "amber"); // 10.7% over 60 days
  assert.equal(p({ d90plus: BigInt(12000) }).level, "red"); // 10.7% over 90 days
  assert.equal(p({ d90plus: BigInt(5000) }).level, "green"); // under 10%
  assert.equal(p({ limit: BigInt(120000) }).level, "amber"); // 83% of the limit
  assert.equal(p({ limit: BigInt(90000) }).level, "red"); // over the limit
  assert.equal(p({ limit: BigInt(0) }).level, "red"); // a balance and no credit
  assert.equal(p({ limit: null }).level, "green"); // no limit on file is not a risk by itself
  assert.equal(p({ dso: String(CREDIT_RULES.dsoAmber + 1) }).level, "amber");
  assert.equal(p({ dso: String(CREDIT_RULES.dsoRed + 1) }).level, "red");
  assert.ok(plainText(p({ d90plus: BigInt(12000) }).reasons[0]).includes("90 days"));
});

test("7B quote lifecycle: soft warnings, a red line needs a reason, nobody approves their own quote", async () => {
  const { c } = await vault();
  try {
    const rep = serviceFor(c, "rep"), po = serviceFor(c, "po"), sm = serviceFor(c, "sm");
    let v = await call(rep, "quoteCreate", { customerId: "C1" }) as { id: string; number: string; status: string };
    assert.match(v.number, /^Q-\d{4}-0001$/); assert.equal(v.status, "draft");
    const id = v.id;
    let view = await call(rep, "quoteLines", { id, lines: [{ productId: "P1", quantity: "10" }, { productId: "P2", quantity: "2.5" }] }) as Record<string, never>;
    const lines = view.lines as unknown as { unitCents: string; guard: string; totalCents: string }[];
    assert.deepEqual(lines.map(l => [l.unitCents, l.guard, l.totalCents]), [["10500", "green", "105000"], ["9500", "yellow", "23750"]]);
    assert.equal(view.totalCents, "128750"); assert.equal(view.needsApproval, false);
    assert.ok((view.warnings as string[]).some(w => plainText(w).includes("below its target")));
    assert.ok((view.warnings as string[]).some(w => plainText(w).includes("pays slowly")), "a slow payer with a discount is flagged");
    view = await call(rep, "quoteLines", { id, lines: [{ productId: "P1", quantity: "10", unitCents: "7000" }] }) as Record<string, never>;
    assert.equal(view.needsApproval, true); assert.equal(view.worst, "red");
    await assert.rejects(call(rep, "quoteSubmit", { id, reason: null }), code("QUOTE"));
    await assert.rejects(call(rep, "quoteLines", { id, lines: [{ productId: "P1", quantity: "1", unitCents: "12.5" }] }), code("QUOTE"));
    view = await call(rep, "quoteSubmit", { id, reason: "Match a competitor bid" }) as Record<string, never>;
    assert.equal(view.status, "pending");
    await assert.rejects(call(rep, "quoteLines", { id, lines: [] }), code("QUOTE")); // locked while pending
    await assert.rejects(call(rep, "quoteDecide", { id, decision: "approve", note: null }), code("FORBIDDEN"));
    await assert.rejects(call(serviceFor(c, "pm"), "quoteDecide", { id, decision: "approve", note: null }), code("FORBIDDEN")); // a Pricing Manager does not approve quotes
    assert.deepEqual((await call(po, "quoteList", { pendingOnly: true }) as { id: string }[]).map(x => x.id), [id]);
    view = await call(po, "quoteDecide", { id, decision: "reject", note: "Hold at floor" }) as Record<string, never>;
    assert.equal(view.status, "rejected"); assert.equal(view.decidedBy, "po");
    view = await call(rep, "quoteLines", { id, lines: [{ productId: "P1", quantity: "10", unitCents: "8000" }] }) as Record<string, never>;
    assert.equal(view.status, "draft"); assert.equal(view.worst, "yellow");
    assert.equal((await call(rep, "quoteSubmit", { id, reason: null }) as Record<string, never>).status, "submitted");
    // The Pricing Owner's own exception needs someone else.
    const own = (await call(po, "quoteCreate", { customerId: "C2" }) as { id: string }).id;
    await call(po, "quoteLines", { id: own, lines: [{ productId: "P3", quantity: "1", unitCents: "1" }] });
    assert.equal((await call(po, "quoteSubmit", { id: own, reason: null }) as Record<string, never>).status, "submitted"); // no guardrail: not red
    const own2 = (await call(po, "quoteCreate", { customerId: "C1" }) as { id: string; number: string });
    assert.match(own2.number, /-0003$/);
    await call(po, "quoteLines", { id: own2.id, lines: [{ productId: "P1", quantity: "1", unitCents: "1" }] });
    await call(po, "quoteSubmit", { id: own2.id, reason: "Sample" });
    await assert.rejects(call(po, "quoteDecide", { id: own2.id, decision: "approve", note: null }), code("QUOTE"));
    assert.equal((await call(sm, "quoteDecide", { id: own2.id, decision: "approve", note: null }) as Record<string, never>).status, "approved"); // the Sales Manager approves discounted quotes (blueprint section 3)
    // Reps see their own quotes only; another rep cannot open them.
    assert.deepEqual((await call(rep, "quoteList", {}) as { id: string }[]).map(x => x.id), [id]);
    assert.equal((await call(po, "quoteList", {}) as unknown[]).length, 3);
    await assert.rejects(call(serviceFor(c, "rep2"), "quoteGet", { id }), code("FORBIDDEN"));
    await assert.rejects(call(serviceFor(c, "rep2"), "quoteLines", { id, lines: [] }), code("QUOTE"));
    // A cost role sees margin; the audit log keeps codes and IDs, not prices.
    const smView = await call(sm, "quoteGet", { id }) as Record<string, never>;
    assert.equal(smView.costCents, "43210"); assert.equal(smView.marginCents, "36790"); assert.equal(smView.marginRate, "45.99");
    const audit = q(c, "SELECT action, details FROM audit_log WHERE action LIKE 'quote.%' ORDER BY sequence");
    assert.ok(audit.length >= 8 && audit.every(a => !/8000|7000|10500|Match a competitor/.test(String(a.details))), JSON.stringify(audit));
    assert.equal(q(c, `SELECT count(*) AS n FROM quote_lines WHERE quote_id='${id}' AND cost_cents=${COST}`)[0].n, "1"); // the snapshot is kept for cost roles
  } finally { c.close(); }
});

test("7B Quote Desk and Price Check need Professional", async () => {
  const { c } = await vault();
  try {
    const starter = serviceFor(c, "rep", "starter");
    await assert.rejects(call(starter, "priceCheck", { productId: "P1", customerId: "C1", quantity: "1" }), code("LICENCE"));
    await assert.rejects(call(starter, "quoteCreate", { customerId: "C1" }), code("LICENCE"));
    await assert.rejects(call(serviceFor(c, "acct"), "quoteCreate", { customerId: "C1" }), code("FORBIDDEN")); // Accountant and Admin/IT do not quote
    await assert.rejects(call(serviceFor(c, "adm"), "priceCheck", { productId: "P1", customerId: null, quantity: "1" }), code("FORBIDDEN"));
  } finally { c.close(); }
});

// Decision 16 (blueprint section 22, item 21). Every command a Sales Rep can reach is listed here and
// either scanned (its real payload is checked for cost and margin keys and for the cost value) or
// reviewed (it cannot carry cost). Adding a rep-reachable command fails this test until it is classified.
const SCANNED = ["quoteGuidance","quoteCrossSell","scorecard","scorecardOptIn","rebateProgress","status", "home", "checklist", "search", "roleList", "pricingState", "priceCheck", "quoteCreate", "quoteLines", "quoteSubmit", "quoteGet", "quoteList"] as const;
const REVIEWED: Record<string, string> = {
  relayLocal: "v2.6 gap 2: a yes/no for this device's local relay identity, read from the vault; no cost, no network",
  gridTotals: "7V-3a: totals of numbers the caller already holds; returns only sums, counts, minimum and maximum of them",
  init: "vault bootstrap state", create: "creates an empty vault", unlock: "returns status (scanned)", lock: "returns status", touch: "idle timer", cancel: "cancels a job", save: "returns status",
  storage: "browser storage quota", licenceSet: "licence claims", rolePreview: "returns status (scanned) and can only remove capabilities", backupRestore: "replaces the vault, returns status",
  quoteShare: "shares the quote number and price total only (no cost) through the ciphertext relay", quoteRelaySync: "returns the quote view (scanned as quoteGet)",
  relayView: "7A relay: only what a member chose to share", relayRegister: "7A relay", relayJoin: "7A relay", relayRotate: "7A relay", relaySync: "7A relay", relayShare: "7A relay: the sharer types the amount",
  relayRequest: "7A relay", relayDecide: "7A relay", relayComment: "7A relay: free text", relayRetry: "7A relay", relayDiscard: "7A relay",
};
test("decision 16: no Sales Rep payload contains cost or margin", async (context) => {
  // Keep the strict value scan: a random UUID can otherwise contain the short cost sentinel.
  // Deterministic valid fixture IDs remove that collision without exempting any payload field.
  let fixtureId=0;
  context.mock.method(globalThis.crypto,"randomUUID",()=>`90000000-0000-4000-8000-${String(++fixtureId).padStart(12,"0")}` as ReturnType<Crypto["randomUUID"]>);
  assert.ok(leaks({id:`fixture-${COST}`}).length>0,"The scanner must still reject the sentinel inside an ID");
  const caps = capsFor("sales_rep", false);
  const repActions = (Object.keys(ACTION_CAP) as Array<keyof typeof ACTION_CAP>).filter(a => ACTION_CAP[a] === null || caps.includes(ACTION_CAP[a]!));
  assert.deepEqual([...repActions].sort(), [...SCANNED, ...Object.keys(REVIEWED)].sort(), "classify every command a Sales Rep can call");
  assert.ok(!caps.includes("cost"));
  const { c } = await vault();
  try {
    c.query("INSERT INTO access_settings VALUES(1,true)"); // a stored 5A "reps may see cost" switch changes nothing
    const rep = serviceFor(c, "rep") as unknown as Record<string, unknown>;
    rep.status = async () => ({ access: await (rep as unknown as VaultService).access() }); // the real status needs storage; its access part is what varies by role
    const s = rep as unknown as VaultService, payloads: Record<string, unknown> = {};
    const created = await call(s, "quoteCreate", { customerId: "C1" }) as { id: string }; payloads.quoteCreate = created;
    payloads.quoteLines = await call(s, "quoteLines", { id: created.id, lines: [{ productId: "P1", quantity: "10" }, { productId: "P2", quantity: "1", unitCents: "7000" }] });
    payloads.quoteSubmit = await call(s, "quoteSubmit", { id: created.id, reason: "Competitor" });
    payloads.quoteGet = await call(s, "quoteGet", { id: created.id });
    payloads.quoteList = await call(s, "quoteList", {});
    const rebate = await import('../lib/rebate/store');
    c.query("INSERT INTO source_files VALUES('rebate-test','synthetic.csv','sales_history',0,'2026-01-01'); INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES('rebate-test',1,'P1','C1','2026-03-31',1,2950000,0,0,35000,4321,2)");
    const plan=await rebate.saveSql({conn:c} as unknown as Engine,{reference:'Customer program',customer:'C1',mode:'retroactive',treatment:'replace',from:'2026-01-01',to:'2026-12-31',eligible:'',excluded:'',enabled:true,tiers:[{from:'0',to:'',rate:'2'},{from:'40000',to:'',rate:'3'}].slice(0,1)},'owner1');
    c.query(plan.sql);await rebate.rebuildAccruals({conn:c} as unknown as Engine);
    payloads.rebateProgress=await call(s,'rebateProgress',{});
    assert.equal((payloads.rebateProgress as {rows:{earned:string}[]}).rows[0].earned,'59000');
    for(const action of ['rebateState','rebateRows','rebateSave','rebateDelete','rebateRecalculate'] as const)await assert.rejects(call(s,action,{id:plan.id} as never),code('FORBIDDEN'));
    // 8A: deal guidance (history, similar customers, a recent cost rise) and cross-sell, with data behind every signal.
    c.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES
      ('rebate-test',11,'P1','C3','2026-03-01',1,10300,0,0,0,${COST},3,'INV1'),('rebate-test',12,'P3','C3','2026-03-01',1,500,0,0,0,100,4,'INV1'),
      ('rebate-test',13,'P1','C3','2026-03-05',2,20400,0,0,0,${COST},5,'INV2'),('rebate-test',14,'P3','C3','2026-03-05',1,500,0,0,0,100,6,'INV2'),
      ('rebate-test',15,'P1','C2','2026-03-07',1,10100,0,0,0,${COST},7,'INV3'),('rebate-test',16,'P3','C2','2026-03-07',1,500,0,0,0,100,8,'INV3'),
      ('rebate-test',17,'P2','C2','2026-03-08',1,9000,0,0,0,NULL,9,'INV4'),('rebate-test',18,'P2','C3','2026-03-09',1,9000,0,0,0,NULL,10,'INV5');
      INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('v1','V','P1',4000,current_date - 200,'f'),('v2','V','P1',4500,current_date - 10,'f')`);
    payloads.quoteGuidance = await call(s, "quoteGuidance", { id: created.id });
    payloads.quoteCrossSell = await call(s, "quoteCrossSell", { id: created.id });
    assert.ok(JSON.stringify(payloads.quoteGuidance).includes('"costRise"') && JSON.stringify(payloads.quoteGuidance).includes('"history"'), "the guidance scan must cover history and the cost-rise flag");
    assert.deepEqual((payloads.quoteCrossSell as { suggestions: { productId: string }[] }).suggestions.map(x => x.productId), ["P3"], "the cross-sell scan must cover a real suggestion");
    payloads.priceCheck = await call(s, "priceCheck", { productId: "P1", customerId: "C1", quantity: "1" });
    payloads.pricingState = await call(s, "pricingState", {});
    // 7V-3b row notes never reach a Sales Rep: not in a search result, and not searchable by them.
    c.query("UPDATE products SET notes='Private NOTE-SENTINEL-7Q item' WHERE product_id='P1'; UPDATE customers SET notes='NOTE-SENTINEL-7Q customer' WHERE customer_id='C1'");
    payloads.search = await call(s, "search", { text: "P1" });
    assert.ok(!JSON.stringify(payloads.search).includes('NOTE-SENTINEL-7Q'), 'A Sales Rep search result carries a row note');
    assert.deepEqual(await call(s, 'search', { text: 'SENTINEL-7Q' }), [], 'A Sales Rep can search inside row notes');
    const ownerHits = await call(serviceFor(c, 'po'), 'search', { text: 'SENTINEL-7Q' }) as { kind: string; note?: string }[];
    assert.deepEqual(ownerHits.map(h => h.kind).sort(), ['customer', 'product'], 'The Pricing Owner finds rows by their notes');
    for (const action of ['customerList', 'productList', 'noteSet', 'sourceRemovePreview'] as const) await assert.rejects(call(s, action, { kind: 'product', id: 'P1', text: 'x' } as never), code('FORBIDDEN'));
    payloads.scorecard=await call(s,'scorecard',{});payloads.scorecardOptIn=await call(s,'scorecardOptIn',{optIn:true});
    payloads.roleList = await call(s, "roleList", {});
    payloads.checklist = await call(s, "checklist", {});
    payloads.home = await call(s, "home", {});
    payloads.status = await call(s, "status", {});
    assert.deepEqual(Object.keys(payloads).sort(), [...SCANNED].sort());
    for (const [action, payload] of Object.entries(payloads)) assert.deepEqual(leaks(payload), [], `${action} leaks cost or margin to a Sales Rep`);
    // The same quote, opened by a cost role, does carry margin: the scan above is not vacuous.
    assert.ok(leaks(await call(serviceFor(c, "sm"), "quoteGet", { id: created.id })).length > 0);
  } finally { c.close(); }
});

test("7B AR aging import: recognised, validated, one profile per customer, and removable with its file", async () => {
  const { detectRole, suggestMapping } = await import("../lib/studio/mapper");
  const { createStage, resetStage, validate, commitSql, removeChildrenSql } = await import("../lib/studio/load");
  const headers = ["Customer", "As of", "Current", "1-30", "31-60", "61-90", "Over 90", "Credit Limit", "DSO"];
  assert.equal(detectRole("ar-aging-may.csv", headers).role, "ar_aging");
  const mapped = Object.fromEntries(suggestMapping("ar_aging", headers).map(f => [f.field, "index" in f.source ? headers[f.source.index] : f.source.kind]));
  assert.deepEqual(mapped, { customer_id: "Customer", as_of_date: "As of", current_amount: "Current", due_1_30_amount: "1-30", due_31_60_amount: "31-60", due_61_90_amount: "61-90", due_over_90_amount: "Over 90", credit_limit_amount: "Credit Limit", dso_days: "DSO" });
  const { c } = await vault();
  const engine = { conn: c } as unknown as Engine;
  try {
    c.query("DELETE FROM credit_profiles");
    await resetStage(engine); await createStage(engine, "ar_aging");
    c.query(`INSERT INTO st_ar_aging VALUES (0,2,'C1','2026-05-31','1000.00','0','0','0','250.00','5000.00','38'),(0,3,'NEW','2026-05-31','10.00',NULL,NULL,NULL,NULL,NULL,NULL),(0,4,'C2','2026-05-31','-5.00','0','0','0','0','0','0'),(0,5,'C3','2026-05-31','abc','0','0','0','0','0','0')`);
    const file = { ord: 0, role: "ar_aging" as const, name: "ar.csv", bytes: 1, fingerprint: "", alignment: [], settings: { sheet: null, headerRow: 0, headerDepth: 1, delimiter: ",", encoding: "utf-8", decimal: "dot", dateFormat: "YYYY-MM-DD" }, keyed: false, headers: [], colOffset: 0 } as never;
    await validate(engine, "ar_aging", [file], null);
    const errs = q(c, "SELECT src_row::VARCHAR AS r, err FROM ty_ar_aging ORDER BY src_row").map(x => [x.r, x.err]);
    assert.deepEqual(errs.slice(0, 2), [["2", null], ["3", null]]); assert.ok(errs[2][1] && errs[3][1], "negative and non-numeric balances go to Fix Later");
    c.query("CREATE TEMP TABLE studio_files AS SELECT 0 AS file_ord, 'src-ar' AS source_id, 'ar.csv' AS name; CREATE TEMP TABLE studio_messages(file_ord INTEGER, code VARCHAR, column_name VARCHAR, message VARCHAR)");
    c.query("INSERT INTO source_files VALUES('src-ar','ar.csv','customer_list',1,'2026-06-01'); INSERT INTO source_kinds VALUES('src-ar','ar_aging')"); // as Studio.commit stores it
    c.query(commitSql(new Set(["ar_aging"])));
    assert.deepEqual(q(c, "SELECT customer_id, current_cents::VARCHAR AS c, d90_plus_cents::VARCHAR AS d, credit_limit_cents::VARCHAR AS l, dso_days::VARCHAR AS dso FROM credit_profiles ORDER BY customer_id"), [
      { customer_id: "C1", c: "100000", d: "25000", l: "500000", dso: "38.0000" }, { customer_id: "NEW", c: "1000", d: "0", l: null, dso: null }]);
    assert.equal(q(c, "SELECT count(*) AS n FROM customers WHERE customer_id='NEW'")[0].n, "1", "an unknown customer is added to the list");
    assert.equal((await (await import("../lib/quotes/quotes")).credit(engine, "C1")).level, "red"); // 20% over 90 days
    c.query("DROP TABLE studio_files; DROP TABLE studio_messages"); await resetStage(engine);
    c.query(removeChildrenSql("src-ar"));
    assert.equal(q(c, "SELECT count(*) AS n FROM credit_profiles")[0].n, "0");
  } finally { c.close(); }
});

test("7B exception through the 7A relay: only the quote number and price total are shared; a decision counts only from a real approver for the unchanged quote", async () => {
  const { c } = await vault();
  try {
    c.query("UPDATE vault_meta SET currency='CAD' WHERE id=1");
    const rep = serviceFor(c, "rep") as unknown as Record<string, unknown>, sent: unknown[] = [];
    let approval: { status: string; decisions: { userId: string; decision: string }[] } | null = null, amountMinor: string | null = null, sharedCurrency = "CAD", nextId = 1;
    rep.relay = async (request: { action: string; data: { input?: { reference: string; amount: string } } }) => {
      sent.push(request);
      if (request.action === "relayShare") { amountMinor = String(Math.round(Number(request.data.input!.amount) * 100)); nextId++; }
      const share = [...sent].reverse().find(r => (r as { action: string }).action === "relayShare") as { data: { input: { reference: string } } } | undefined;
      const subject = share ? { ...share.data.input, amountMinor, currency: sharedCurrency } : null;
      return { objects: subject ? [{ id: "obj-other", author: "rep2", subject, approval: { status: "approved", decisions: [{ userId: "sm", decision: "approve" }] } }, { id: `obj-${nextId - 1}`, author: "rep", subject, approval }] : [] };
    };
    const s = rep as unknown as VaultService, po = serviceFor(c, "po");
    const id = (await call(s, "quoteCreate", { customerId: "C1" }) as { id: string }).id;
    await call(s, "quoteLines", { id, lines: [{ productId: "P1", quantity: "3", unitCents: "7000" }] });
    await assert.rejects(call(s, "quoteShare", { id, preset: "standard" }), code("QUOTE")); // a draft is not an exception yet
    await call(s, "quoteSubmit", { id, reason: "Competitor" });
    let shared = await call(s, "quoteShare", { id, preset: "standard" }) as Record<string, string>;
    assert.equal(shared.relayObject, "obj-1", "the rep's own shared object is linked, not another member's with the same number");
    const input = (sent[0] as { data: { input: Record<string, string> } }).data.input;
    assert.deepEqual({ ...input, title: plainText(input.title) }, { objectKind: "quote", title: `Price exception for quote ${shared.number}`, reference: shared.number, amount: "210.00", currency: "CAD", preset: "standard" });
    assert.deepEqual(leaks(sent), [], "no cost or margin goes to the relay");
    assert.equal((await call(s, "quoteRelaySync", { id }) as Record<string, string>).status, "pending"); // not decided yet
    // An approval from someone without quoteApprove in this vault, or from the author, is refused.
    approval = { status: "approved", decisions: [{ userId: "rep2", decision: "approve" }] };
    await assert.rejects(call(s, "quoteRelaySync", { id }), code("QUOTE"));
    approval = { status: "approved", decisions: [{ userId: "rep", decision: "approve" }] };
    await assert.rejects(call(s, "quoteRelaySync", { id }), code("QUOTE"));
    approval = { status: "approved", decisions: [{userId:"sm",decision:"approve"}] };
    sharedCurrency="USD"; await assert.rejects(call(s,"quoteRelaySync",{id}),code("QUOTE")); sharedCurrency="CAD";
    // A stale approval: rejected locally, edited to a lower price and resubmitted. The old link is gone.
    await call(po, "quoteDecide", { id, decision: "reject", note: null });
    const edited = await call(s, "quoteLines", { id, lines: [{ productId: "P1", quantity: "3", unitCents: "6000" }] }) as Record<string, string | null>;
    assert.equal(edited.relayObject, null, "editing clears the link to the old shared exception");
    await call(s, "quoteSubmit", { id, reason: "Competitor" });
    approval = { status: "approved", decisions: [{ userId: "sm", decision: "approve" }] };
    assert.equal((await call(s, "quoteRelaySync", { id }) as Record<string, string>).status, "pending", "an unlinked quote ignores relay approvals");
    shared = await call(s, "quoteShare", { id, preset: "standard" }) as Record<string, string>;
    assert.equal(shared.relayObject, "obj-2");
    amountMinor = "21000"; // the shared subject no longer matches the quote total (18000)
    await assert.rejects(call(s, "quoteRelaySync", { id }), code("QUOTE"));
    amountMinor = "18000";
    const done = await call(s, "quoteRelaySync", { id }) as Record<string, string>;
    assert.equal(done.status, "approved"); assert.equal(done.decidedBy, "relay:obj-2");
    await assert.rejects(call(serviceFor(c, "adm"), "quoteShare", { id, preset: "standard" }), code("FORBIDDEN"));
  } finally { c.close(); }
});

test("7B relay approvers need an explicit role: an empty roles table or an unknown person grants nothing", async () => {
  const { assignedCaps } = await import("../lib/roles/store");
  const { c, e } = await vault();
  try {
    assert.ok((await assignedCaps(e, "sm")).includes("quoteApprove")); assert.ok(!(await assignedCaps(e, "rep")).includes("quoteApprove"));
    assert.deepEqual(await assignedCaps(e, "stranger"), []);
    c.query("DELETE FROM role_assignments"); // a vault from before roles existed: accessFor treats the opener as Owner, this must not
    assert.deepEqual(await assignedCaps(e, "stranger"), []); assert.deepEqual(await assignedCaps(e, "sm"), []);
    assert.ok((await assignedCaps(e, "po")).includes("quoteApprove"), "the named Pricing Owner still counts");
  } finally { c.close(); }
});

test('7D-1 signed licence tier gates all rebate operations and import activation; Accountant keeps no general data access',async()=>{
 const {c}=await vault();try{const starter=serviceFor(c,'owner1','starter');
 for(const action of ['rebateProgress','rebateState','rebateRows','rebateSave','rebateDelete','rebateRecalculate'] as const)await assert.rejects(call(starter,action,{id:'missing'} as never),code('LICENCE'));
 starter.studioState=async()=>({files:[{role:'rebate_agreement'}]} as never);await assert.rejects(call(starter,'studioPlan',{}),code('LICENCE'));await assert.rejects(call(starter,'studioCommit',{acknowledge:true}),code('LICENCE'));
 const acct=serviceFor(c,'acct');assert.ok((await acct.access()).caps.includes('rebateManage'));await assert.rejects(call(acct,'studioAdd',{files:[]}),code('FORBIDDEN'));assert.deepEqual((await call(acct,'rebateState',{}) as {programs:unknown[]}).programs,[]);
 }finally{c.close();}
});

test('7D-2 every supplier payload and write is worker-denied for reps; Starter and manager capabilities stay narrow',async()=>{
 const {c}=await vault();try{const rep=serviceFor(c,'rep'),starter=serviceFor(c,'owner1','starter');
 for(const action of ['supplierClaims','supplierPurchases','supplierProgress','supplierClaimPreview','supplierClaimSave','supplierClaimStatus','supplierClaimExport'] as const){await assert.rejects(call(rep,action,{id:'missing'} as never),code('FORBIDDEN'));await assert.rejects(call(starter,action,{id:'missing'} as never),code('LICENCE'));}
 const sm=serviceFor(c,'sm');await assert.rejects(call(sm,'supplierClaimSave',{} as never),code('FORBIDDEN'));
 starter.studioState=async()=>({files:[{role:'purchases'}]} as never);await assert.rejects(call(starter,'studioPlan',{}),code('LICENCE'));const acct=serviceFor(c,'acct');await assert.rejects(call(acct,'studioPlan',{}),code('FORBIDDEN'));
 }finally{c.close();}
});
