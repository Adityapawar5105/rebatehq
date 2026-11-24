// Team sharing release S1 (SHARING_DESIGN.md; blueprint section 22, item 38): the encrypted hand-off file.
// Proves the column allow-list, the decision 16 scan, the cost lock, the file format (wrong code, a changed byte,
// another workspace, a backup file) and that applying a pack replaces same-key rows without touching notes.
import test from "node:test";
import assert from "node:assert/strict";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, upgradeSql, SCHEMA_VERSION, TABLES } from "../lib/vault/schema";
import { ACTION_CAP, ACTIONS, capsFor, ROLES, type RoleId } from "../lib/roles/access";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import { readHeader } from "../lib/vault/crypto";
import { HELD, PACKS, PACK_IDS, SOURCE_TABLES, applyPack, packAllowed, readPack, scanPack, selection, type PackData } from "../lib/sharing/packs";
import { newCode, normaliseCode, openHandoff, packHash, sealHandoff, type Payload } from "../lib/sharing/handoff";
import type { Engine } from "../lib/vault/engine";

type Conn = Awaited<ReturnType<typeof duckdbConnection>>;
const COST = "4321", VENDOR = "4567", COST_FLOOR = "8765"; // sentinels that must never reach a copy without cost
const people: Record<string, RoleId> = { owner1: "owner", po: "pricing_owner", pm: "pricing_manager", sm: "sales_manager", rep: "sales_rep", acct: "accountant", adm: "admin" };
async function fresh(version = SCHEMA_VERSION) {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales");
  for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
  c.query(schemaSql(version));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${version},'professional','unit','tip',0,0)`);
  return c;
}
async function publisher() {
  const c = await fresh();
  c.query(`INSERT INTO pricing_settings VALUES(1,'po','Pat Owner',7);
INSERT INTO role_assignments VALUES ${Object.entries(people).map(([id, role]) => `('${id}','${id} name','${role}','owner1','2025-01-01')`).join(",")};
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,notes,barcode) VALUES('P1','Ball valve','Valves','EA',${COST},12000,'publisher note','0123'),('P2','Gate valve','Valves','EA',NULL,9000,NULL,NULL);
INSERT INTO customers(customer_id,name,tier,notes) VALUES('C1','Acme','T01','publisher customer note'),('C2','Beta','T02',NULL);
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category,floor_from_cost) VALUES('g1','unit_price',11000,10000,${COST_FLOOR},'T01','Valves',true),('g2','unit_price',9000,8000,7000,'T02','Valves',false);
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES
 ('m1','P1','Valves',NULL,'T01',0,10500,'2025-01-01',NULL),('m2','P1','Valves',NULL,'T01',100,9900,'2025-01-01',NULL),('m3','P1','Valves','C1',NULL,0,10200,'2025-01-01',NULL);
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('v1','SteelWorks','P1',${VENDOR},'2025-02-01','sheet.csv');
INSERT INTO cost_basis_settings VALUES('Valves','replacement');`);
  return c;
}
const engine = (c: Conn) => ({ conn: { query: async (sql: string) => c.query(sql) } }) as unknown as Engine;
function serviceFor(c: Conn, userId: string, tier = "professional", tenantId = "t1") {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = engine(c); s.identity = { userId, tenantId };
  s.licence = { tier, assert() {}, guard() {}, view: () => null, claims: { tier }, writable: true };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as VaultService;
}
const call = <A extends Request["action"]>(s: VaultService, action: A, data: Extract<Request, { action: A }>["data"]) =>
  dispatch(s, { id: "1", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<never>;
const code = (c: string) => (e: unknown) => e instanceof VaultError && e.code === c;
/** Every key and value in a payload, for the decision 16 scan (as in tests/quotes.test.ts). */
function leaks(payload: unknown, path = "$"): string[] {
  if (payload === null || payload === undefined) return [];
  if (typeof payload === "string" || typeof payload === "number") return [COST, VENDOR, COST_FLOOR].some(v => String(payload).includes(v)) ? [`${path} = ${String(payload)}`] : [];
  if (Array.isArray(payload)) return payload.flatMap((v, i) => leaks(v, `${path}[${i}]`));
  if (typeof payload === "object") return Object.entries(payload as Record<string, unknown>).flatMap(([k, v]) => [...(/cost|margin/i.test(k) ? [`${path}.${k}`] : []), ...leaks(v, `${path}.${k}`)]);
  return [];
}

test("S1 allow-list: every column of every shared table is carried by a pack or held back, and no pack without cost carries cost", async () => {
  const c = await fresh();
  try {
    for (const table of SOURCE_TABLES) {
      const real = q(c, `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`).map(r => r.column_name!);
      const carried = new Set(PACK_IDS.flatMap(p => PACKS[p].parts.filter(x => x.table === table).flatMap(x => x.columns.map(k => k.name))));
      for (const column of real) assert.ok(carried.has(column) !== (column in HELD[table]), `${table}.${column} must be either carried or held back (not both, not neither)`);
      for (const column of carried) assert.ok(real.includes(column), `${table}.${column} is carried but does not exist`);
    }
    const COST_COLUMNS = ["products.current_cost", "vendor_costs.cost", "vendor_costs.vendor", "cost_basis_settings.basis"];
    for (const p of PACK_IDS.filter(p => !PACKS[p].cost))
      for (const part of PACKS[p].parts) for (const k of part.columns) assert.ok(!COST_COLUMNS.includes(`${part.table}.${k.name}`) && !/cost|margin/i.test(k.name), `${p} carries ${part.table}.${k.name}`);
    assert.deepEqual(PACK_IDS.filter(p => PACKS[p].cost), ["cost", "cost_floors"]);
    // The guards pack never reads a floor flagged as based on cost.
    assert.match(PACKS.guards.parts[0].columns.find(k => k.name === "floor")!.read!, /floor_from_cost THEN target/);
  } finally { c.close(); }
});

test("S1 cost lock (D18): roles without cost can never be sent or load a cost pack; prerequisites travel together", () => {
  for (const r of ROLES) for (const p of PACK_IDS) assert.equal(packAllowed(p, r.id), !PACKS[p].cost || capsFor(r.id, false).includes("cost"), `${r.id} / ${p}`);
  assert.equal(packAllowed("cost", "sales_rep"), false); assert.equal(packAllowed("cost", "admin"), false); assert.equal(packAllowed("cost_floors", "sales_rep"), false);
  assert.equal(packAllowed("cost", "sales_manager"), true); assert.equal(packAllowed("cost", "accountant"), true);
  assert.deepEqual(selection(["cost_floors", "guards", "items"]), ["items", "guards", "cost_floors"]);
  assert.throws(() => selection(["cost"]), code("SHARE")); assert.throws(() => selection(["cost_floors"]), code("SHARE"));
  assert.throws(() => selection([]), code("SHARE")); assert.throws(() => selection(["items", "invoices"]), code("SHARE"));
  // Only publishers export; everyone with a vault may import (the worker still refuses cost for a role without it).
  for (const r of ROLES) assert.equal(capsFor(r.id, false).includes("share"), r.id === "owner" || r.id === "pricing_owner", r.id);
  assert.ok(capsFor("pricing_manager", true).includes("share"), "the named Pricing Owner publishes");
  assert.equal(ACTION_CAP.shareExport, "share"); assert.equal(ACTIONS.shareImport.mode, "write"); assert.equal(ACTION_CAP.shareImport, "view");
});

test("S1 scan: a planted cost column, an extra column or a badly typed value stops the pack", async () => {
  const c = await publisher();
  try {
    const items = await readPack(engine(c), "items");
    assert.deepEqual(leaks(items), [], "the item pack carries no cost");
    const planted: PackData = [{ ...items[0], columns: [...items[0].columns.slice(0, -1), "current_cost"] }];
    assert.throws(() => scanPack("items", planted), code("SHARE"));
    assert.throws(() => scanPack("items", [{ ...items[0], columns: [...items[0].columns, "extra"], rows: items[0].rows.map(r => [...r, "x"]) }]), code("SHARE"));
    assert.throws(() => scanPack("book", [{ part: 0, columns: PACKS.book.parts[0].columns.map(k => k.name), rows: [["m", "P1", "V", "T", "0", "12.5", "2025-01-01", null]] }]), code("SHARE"), "money must be whole cents");
    const guards = await readPack(engine(c), "guards");
    assert.deepEqual(leaks(guards), [], "a floor based on cost is replaced by the target");
    assert.deepEqual(guards[0].rows[0], ["T01", "Valves", "11000", "10000", "10000"]);
    assert.ok(JSON.stringify(await readPack(engine(c), "cost_floors")).includes(COST_FLOOR));
  } finally { c.close(); }
});

test("S1 file: one-time code, wrong code, a changed byte, another workspace and a vault backup are all refused", async () => {
  const c = await publisher();
  let payload: Payload;
  try {
    const packs: Payload["packs"] = {}, hashes: Payload["hashes"] = {};
    for (const p of ["items", "book"] as const) { packs[p] = await readPack(engine(c), p); hashes[p] = await packHash(packs[p]!); }
    payload = { v: 1, tenant: "t1", currency: "USD", id: crypto.randomUUID(), exportedAt: new Date().toISOString(), exportedBy: { userId: "po", name: "Pat" }, recipient: { role: "sales_rep", name: "Raj" }, packs, hashes };
  } finally { c.close(); }
  const one = newCode(), two = newCode();
  assert.match(one, /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/); assert.notEqual(one, two);
  assert.equal(normaliseCode(one.toLowerCase().replace(/-/g, " ")), one.replace(/-/g, ""));
  assert.throws(() => normaliseCode("too short"), code("SHARE"));
  const file = await sealHandoff(payload, one);
  const text = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
  for (const plain of ["Ball valve", "10500", "Acme", "P1"]) assert.ok(!text.includes(plain), `the file must not contain ${plain} in clear`);
  const opened = await openHandoff(file, one.toLowerCase(), "t1");
  assert.deepEqual(opened.packs, payload.packs); assert.equal(opened.recipient.name, "Raj");
  await assert.rejects(openHandoff(file, two, "t1"), code("SHARE"));
  await assert.rejects(openHandoff(file, one, "t2"), code("SHARE"), "another workspace");
  const bytes = new Uint8Array(await file.arrayBuffer()); bytes[bytes.length - 40] ^= 1;
  await assert.rejects(openHandoff(new Blob([bytes]), one, "t1"), code("SHARE"), "a changed byte");
  await assert.rejects(readHeader(file, "t1"), "a hand-off file is never a vault or backup");
  await assert.rejects(openHandoff(new Blob([new TextEncoder().encode("MDVAULT1....")]), one, "t1"), code("SHARE"));
});

test("S1 end to end through the worker: a sales copy has no cost, applies over same-key rows and keeps local notes", async (context) => {
  let id = 0; context.mock.method(globalThis.crypto, "randomUUID", () => `90000000-0000-4000-8000-${String(++id).padStart(12, "0")}` as ReturnType<Crypto["randomUUID"]>);
  let c = await publisher(), file: Blob, secret: string, full: Blob, fullCode: string;
  try {
    const po = serviceFor(c, "po");
    await assert.rejects(call(serviceFor(c, "rep"), "shareExport", { packs: ["items"], role: "sales_rep", name: "" }), code("FORBIDDEN"), "only publishers export");
    await assert.rejects(call(serviceFor(c, "pm"), "shareCounts", {}), code("FORBIDDEN"));
    await assert.rejects(call(po, "shareExport", { packs: ["items", "cost"], role: "sales_rep", name: "Raj" }), code("SHARE"), "cost is locked for a Sales Rep");
    await assert.rejects(call(po, "shareExport", { packs: ["items", "guards", "cost_floors"], role: "admin", name: "" }), code("SHARE"));
    await assert.rejects(call(serviceFor(c, "po", "starter"), "shareExport", { packs: ["items"], role: "sales_rep", name: "" }), code("LICENCE"));
    const counts = await call(po, "shareCounts", {}) as { pack: string; rows: string }[];
    assert.equal(counts.find(x => x.pack === "book")!.rows, "2"); assert.equal(counts.find(x => x.pack === "cost")!.rows, "3");
    const out = await call(po, "shareExport", { packs: ["items", "customers", "book", "contracts", "guards"], role: "sales_rep", name: "Raj" }) as { blob: Blob; code: string; name: string };
    file = out.blob; secret = out.code; assert.match(out.name, /\.rhqshare$/);
    const opened = await openHandoff(file, secret, "t1");
    assert.deepEqual(leaks(opened.packs), [], "decision 16: the sales copy carries no cost key or value");
    assert.ok(!JSON.stringify(opened).includes("publisher note"), "notes stay on the device that wrote them");
    const fullOut = await call(po, "shareExport", { packs: [...PACK_IDS], role: "sales_manager", name: "Sam" }) as { blob: Blob; code: string };
    full = fullOut.blob; fullCode = fullOut.code;
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "share.exported"));
    assert.ok(!JSON.stringify(q(c, "SELECT details FROM audit_log")).includes(COST));
  } finally { c.close(); }

  // A rep's own vault, with an own price row for the same key and an own note on P1.
  c = await fresh();
  try {
    c.query(`INSERT INTO role_assignments VALUES('rep','Raj','sales_rep','owner1','2025-01-01'),('owner1','O','owner','owner1','2025-01-01');
INSERT INTO products(product_id,description,category,uom,notes) VALUES('P1','old name','Valves','EA','my own note');
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES('own','P1','Valves',NULL,'T01',0,11111,'2025-01-01',NULL),('keep','P9','Other',NULL,'T09',0,500,'2025-01-01',NULL);`);
    const rep = serviceFor(c, "rep");
    await assert.rejects(call(rep, "shareImportPreview", { file: file!, code: newCode() }), code("SHARE"));
    await assert.rejects(call(serviceFor(c, "rep", "professional", "t2"), "shareImportPreview", { file: file!, code: secret! }), code("SHARE"));
    await assert.rejects(call(rep, "shareImport", { file: full!, code: fullCode! }), code("FORBIDDEN"), "a rep cannot load a cost pack");
    const preview = await call(rep, "shareImportPreview", { file: file!, code: secret! }) as { publisher: string; recipientRole: string; packs: { pack: string; older: boolean }[] };
    assert.equal(preview.publisher, "po name"); assert.equal(preview.recipientRole, "sales_rep");
    assert.deepEqual(preview.packs.map(p => p.pack), ["items", "customers", "book", "contracts", "guards"]);
    const done = await call(rep, "shareImport", { file: file!, code: secret! }) as { changed: string; state: unknown };
    assert.deepEqual(leaks(done), [], "decision 16: the import result carries no cost");
    assert.deepEqual(q(c, "SELECT product_id,description,current_cost,notes,barcode FROM products ORDER BY 1"), [
      { product_id: "P1", description: "Ball valve", current_cost: null, notes: "my own note", barcode: "0123" },
      { product_id: "P2", description: "Gate valve", current_cost: null, notes: null, barcode: null }]);
    assert.deepEqual(q(c, "SELECT id,price::VARCHAR p,source_id FROM price_matrix ORDER BY id").map(r => [r.id, r.p, r.source_id]),
      [["keep", "500", null], ["m1", "10500", "shared:book"], ["m2", "9900", "shared:book"], ["m3", "10200", "shared:contracts"]], "the same-key row is replaced; others stay");
    assert.deepEqual(q(c, "SELECT tier,floor::VARCHAR f,coalesce(floor_from_cost,false)::VARCHAR x FROM price_guardrails ORDER BY tier"), [{ tier: "T01", f: "10000", x: "false" }, { tier: "T02", f: "7000", x: "false" }]);
    assert.ok(q(c, "SELECT key,before_value,after_value FROM shared_changes WHERE pack='book'").some(r => r.before_value === "11111" && r.after_value === "10500"));
    const state = await call(rep, "shareState", {}) as { books: { pack: string; publisher: string }[]; canExport: boolean };
    assert.equal(state.books.length, 5); assert.equal(state.canExport, false);
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "share.imported"));
    // Importing the same file again changes nothing; an older file is refused.
    assert.equal((await call(rep, "shareImport", { file: file!, code: secret! }) as { changed: string }).changed, "0");
    c.query("UPDATE shared_books SET published_at='2099-01-01T00:00:00.000Z' WHERE pack='book'");
    await assert.rejects(call(rep, "shareImport", { file: file!, code: secret! }), code("SHARE"));
  } finally { c.close(); }

  // A Sales Manager's vault takes the full copy: cost and the floor based on cost arrive, flagged.
  c = await fresh();
  try {
    c.query("INSERT INTO role_assignments VALUES('sm','Sam','sales_manager','owner1','2025-01-01'),('owner1','O','owner','owner1','2025-01-01')");
    await call(serviceFor(c, "sm"), "shareImport", { file: full!, code: fullCode! });
    assert.deepEqual(q(c, "SELECT current_cost::VARCHAR c FROM products WHERE product_id='P1'"), [{ c: COST }]);
    assert.deepEqual(q(c, "SELECT floor::VARCHAR f,floor_from_cost::VARCHAR x FROM price_guardrails WHERE tier='T01'"), [{ f: COST_FLOOR, x: "true" }]);
    assert.deepEqual(q(c, "SELECT vendor,cost::VARCHAR c,source_id FROM vendor_costs"), [{ vendor: "SteelWorks", c: VENDOR, source_id: "shared:cost" }]);
    assert.deepEqual(q(c, "SELECT * FROM cost_basis_settings"), [{ product_group: "Valves", basis: "replacement" }]);
  } finally { c.close(); }
});

test("S1 v24: the upgrade keeps every guardrail (not based on cost) and adds the two shared tables", async () => {
  const c = await fresh(23);
  try {
    c.query("INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g','unit_price',3,2,1,'T','C')");
    c.query(upgradeSql(23));
    assert.deepEqual(q(c, "SELECT id,floor::VARCHAR f,floor_from_cost::VARCHAR x FROM price_guardrails"), [{ id: "g", f: "1", x: "false" }]);
    assert.deepEqual(tablesFor(24).filter(t => !tablesFor(23).includes(t)), ["shared_books", "shared_changes"]);
    assert.equal(SCHEMA_VERSION, 24);
    assert.throws(() => c.query("INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category) VALUES('g2','unit_price',3,2,1,'T','C')"), "the tier and category index is rebuilt");
  } finally { c.close(); }
});

test("S1 v24: a new vault migrates from v1 to v24 in one transaction, as the worker does", async () => {
  const c = await duckdbConnection();
  try {
    c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
    c.query(`BEGIN; ${schemaSql(1)} INSERT INTO vault_meta VALUES(1,1,'scale','s','g',0); COMMIT`);
    c.query(`BEGIN; ${upgradeSql(1)} UPDATE vault_meta SET schema_version=${SCHEMA_VERSION} WHERE id=1; COMMIT`);
    assert.deepEqual(q(c, "SELECT index_name FROM duckdb_indexes() WHERE table_name='price_guardrails'"), [{ index_name: "guardrail_tier_category_v24" }]);
  } finally { c.close(); }
});

test("S1 apply is idempotent and removes rows an earlier shared copy had but the new one does not", async () => {
  const c = await fresh();
  try {
    const book = (rows: Array<Array<string | null>>): PackData => [{ part: 0, columns: PACKS.book.parts[0].columns.map(k => k.name), rows }];
    await applyPack(engine(c), "book", book([["a", "P1", "V", "T", "0", "100", "2025-01-01", null], ["b", "P2", "V", "T", "0", "200", "2025-01-01", null]]));
    const again = await applyPack(engine(c), "book", book([["a", "P1", "V", "T", "0", "100", "2025-01-01", null]]));
    assert.deepEqual(q(c, "SELECT id FROM price_matrix"), [{ id: "a" }]);
    assert.deepEqual(again.changes, [{ key: "P2 · T · 0", before: "200", after: null }]);
  } finally { c.close(); }
});

test("S1 floors based on cost: inside one vault a role without cost sees the target in their place (Pricing and Price Check)", async () => {
  const c = await publisher();
  try {
    const rep = serviceFor(c, "rep"), sm = serviceFor(c, "sm");
    const repState = await call(rep, "pricingState", {}) as { guards: { tier: string; floor: string; protectedFloor?: boolean }[] };
    assert.deepEqual(leaks(repState), [], "decision 16: Pricing state for a rep carries no cost-based floor");
    assert.deepEqual(repState.guards.map(g => [g.tier, g.floor, g.protectedFloor]), [["T01", "10000", false], ["T02", "7000", false]]);
    const smState = await call(sm, "pricingState", {}) as { guards: { tier: string; floor: string; protectedFloor?: boolean }[] };
    assert.deepEqual(smState.guards.map(g => [g.tier, g.floor, g.protectedFloor]), [["T01", COST_FLOOR, true], ["T02", "7000", false]]);
    const repPoint = await call(rep, "priceCheck", { productId: "P1", customerId: "C1", quantity: "1" }) as { floorCents: string };
    assert.equal(repPoint.floorCents, "10000"); assert.deepEqual(leaks(repPoint), []);
    assert.equal((await call(sm, "priceCheck", { productId: "P1", customerId: "C1", quantity: "1" }) as { floorCents: string }).floorCents, COST_FLOOR);
    // A rep's quote line keeps the target as its floor, so pricing between floor and target needs approval.
    const q = await call(rep, "quoteCreate", { customerId: "C1" }) as { id: string };
    const v = await call(rep, "quoteLines", { id: q.id, lines: [{ productId: "P1", quantity: "1", unitCents: "9000" }] });
    assert.deepEqual(leaks(v), []);
    assert.deepEqual(q2(c, q.id), [{ floor: "10000", zone: "red" }]);
  } finally { c.close(); }
});
function q2(c: Conn, id: string) { return q(c, `SELECT floor_cents::VARCHAR AS floor, guard_status AS zone FROM quote_lines WHERE quote_id='${id}'`); }

test("S1 a sales copy imported where floors based on cost already exist keeps them", async () => {
  const c = await fresh();
  try {
    c.query(`INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category,floor_from_cost) VALUES('mine','unit_price',11000,10000,${COST_FLOOR},'T01','Valves',true),('typed','unit_price',9000,8000,7000,'T02','Valves',false)`);
    const guards: PackData = [{ part: 0, columns: PACKS.guards.parts[0].columns.map(k => k.name), rows: [["T01", "Valves", "11500", "10500", "10500"], ["T02", "Valves", "9000", "8000", "6000"]] }];
    await applyPack(engine(c), "guards", guards);
    assert.deepEqual(q(c, "SELECT tier,target::VARCHAR t,floor::VARCHAR f,floor_from_cost::VARCHAR x FROM price_guardrails ORDER BY tier"),
      [{ tier: "T01", t: "10500", f: COST_FLOOR, x: "true" }, { tier: "T02", t: "8000", f: "6000", x: "false" }]);
  } finally { c.close(); }
});
