// Team sharing S4b (SHARING_DESIGN.md section 5): small deltas. A publish after the first sends only the rows that changed
// and the keys removed; the receiver rebuilds the full pack, checks it against the publisher's digest and applies it as it
// would a snapshot. Covers the delta format, the chain through real relay sessions, and both vaults end to end.
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { applyDelta, checkDelta, diffPack, needsSnapshot, packDigest, toData, toRows, SNAPSHOT_EVERY_MS, type DeltaData } from "../lib/sharing/delta";
import { sealPack, openDelta, openPack } from "../lib/sharing/publish";
import { PACKS, type PackData } from "../lib/sharing/packs";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayPackPage, relayDirectory } from "../lib/relay/store";
import { RelaySession, emptyRelay } from "../lib/relay/session";
import type { Grid } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS, schemaSql, upgradeSql, tablesFor, SCHEMA_VERSION } from "../lib/vault/schema";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { VaultService } from "../lib/vault/service";

const cols = (pack: keyof typeof PACKS, part = 0) => PACKS[pack].parts[part].columns.map(c => c.name);
const bookRow = (id: string, product: string, price: string) => [id, product, "Valves", "T01", "0", price, "2025-01-01", null];
const book = (...rows: (string | null)[][]): PackData => [{ part: 0, columns: cols("book"), rows }];
const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const strip = (d: DeltaData & { size?: number; total?: number }): DeltaData => ({ kind: d.kind, base: d.base, result: d.result, parts: d.parts });

test("S4b delta: whole rows changed and keys removed; the rebuilt pack must match the publisher's digest", async () => {
  const before = book(bookRow("m1", "P1", "10500"), bookRow("m2", "P2", "9000"), bookRow("m3", "P3", "7000"));
  const after = book(bookRow("m1", "P1", "10400"), bookRow("m3", "P3", "7000"), bookRow("m4", "P4", "5000"));
  const d = await diffPack("book", toRows("book", before), toRows("book", after), "4");
  assert.equal(d.size, 3, "one changed, one added, one removed"); assert.equal(d.total, 3);
  assert.deepEqual(d.parts[0].rows.map(r => r[0]).sort(), ["m1", "m4"], "unchanged rows are not sent");
  assert.equal(d.parts[0].removed.length, 1);
  const rebuilt = await applyDelta("book", toRows("book", before), strip(d));
  assert.equal(await packDigest("book", rebuilt), await packDigest("book", toRows("book", after)));
  assert.deepEqual(toData("book", rebuilt)[0].rows.map(r => r[0]), ["m1", "m3", "m4"].sort());
  // Order does not change the digest; content does.
  assert.equal(await packDigest("book", toRows("book", book(...[...after[0].rows].reverse()))), d.result);
  await assert.rejects(applyDelta("book", toRows("book", book(bookRow("m9", "P9", "1"))), strip(d)), (e: any) => e.code === "CONTENT", "applied to the wrong base, the digest fails");
  await assert.rejects(applyDelta("book", toRows("book", before), { ...strip(d), result: "0".repeat(64) }), (e: any) => e.code === "CONTENT");
  // A delta that touches only one part of a multi-part pack leaves the other parts as they were.
  const cost: PackData = PACKS.cost.parts.map((p, i) => ({ part: i, columns: p.columns.map(c => c.name), rows: i === 0 ? [["P1", "4321"]] : i === 2 ? [["Valves", "replacement"]] : [] }));
  const cost2: PackData = cost.map((p, i) => i === 0 ? { ...p, rows: [["P1", "4400"]] } : p);
  const dc = await diffPack("cost", toRows("cost", cost), toRows("cost", cost2), "1");
  assert.equal(dc.size, 1); assert.deepEqual(toData("cost", await applyDelta("cost", toRows("cost", cost), strip(dc))), cost2);
});

test("S4b delta format is checked as strictly as a full pack, and survives sealing and opening", async () => {
  const d = strip(await diffPack("book", toRows("book", book(bookRow("m1", "P1", "10500"))), toRows("book", book(bookRow("m1", "P1", "10400"))), "2"));
  assert.equal(checkDelta("book", d), d);
  const bad = (v: unknown) => assert.throws(() => checkDelta("book", v), (e: any) => e.code === "CONTENT");
  bad({ ...d, extra: 1 }); bad({ ...d, base: "0" }); bad({ ...d, base: "01" }); bad({ ...d, result: "x" }); bad({ ...d, kind: "snapshot" });
  bad({ ...d, parts: [] }); bad({ ...d, parts: [{ ...d.parts[0], removed: [["P1"]] }] }, ); bad({ ...d, parts: [{ ...d.parts[0], removed: [["P1", "Valves", "T01", "0", "x".repeat(4001)]] }] });
  bad({ ...d, parts: [{ ...d.parts[0], more: 1 }] });
  assert.throws(() => checkDelta("items", { kind: "delta", base: "1", result: d.result, parts: [{ part: 0, columns: [...cols("items").slice(0, -1), "current_cost"], rows: [], removed: [] }] }), "decision 16: a planted cost column in a delta is refused");
  const k = key(), id = crypto.randomUUID(), { chunks, manifest } = await sealPack("book", d, k, id);
  assert.equal(manifest.rows, "1");
  assert.deepEqual(await openDelta("book", manifest, chunks, k, id), d);
  await assert.rejects(openPack("book", manifest, chunks, k, id), "a delta never opens as a full pack");
  const full = await sealPack("book", book(bookRow("m1", "P1", "1")), k, id);
  await assert.rejects(openDelta("book", full.manifest, full.chunks, k, id), "nor a full pack as a delta");
});

test("S4b snapshot rules: rotation, no earlier publish, a week, 50 deltas, or more than a quarter of the pack", () => {
  const now = Date.parse("2026-11-25T12:00:00Z"), last = { version: "5", hash: "h", snapshotAt: new Date(now - 86_400_000).toISOString(), deltas: 3 };
  assert.equal(needsSnapshot({ rotated: false, last, size: 10, total: 100, now }), false);
  assert.equal(needsSnapshot({ rotated: true, last, size: 1, total: 100, now }), true);
  assert.equal(needsSnapshot({ rotated: false, last: null, size: 1, total: 100, now }), true);
  assert.equal(needsSnapshot({ rotated: false, last: { ...last, snapshotAt: new Date(now - SNAPSHOT_EVERY_MS).toISOString() }, size: 1, total: 100, now }), true);
  assert.equal(needsSnapshot({ rotated: false, last: { ...last, deltas: 50 }, size: 1, total: 100, now }), true);
  assert.equal(needsSnapshot({ rotated: false, last, size: 26, total: 100, now }), true);
  assert.equal(needsSnapshot({ rotated: false, last, size: 25, total: 100, now }), false);
});

const grid = (roles: Record<string, Grid["people"][number]["role"]>) => (users: string[], prev: Grid | null): Grid =>
  prev ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: roles[u] ?? "sales_rep", extras: [] })), ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
async function sharing(db: any) {
  const { actors } = await relayFixture(db), [owner, manager, rep] = actors, saved = new Map<string, any>(), objects = new Map<string, Uint8Array>();
  const client = (p: typeof owner) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
    directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
    page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
    packPage: (pack, after) => asRelay(db, p.actor, () => relayPackPage(db, p.actor, pack, after)),
    async post(value) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
    chunks: { async put(path, bytes) { objects.set(path, new Uint8Array(bytes)); }, async get(path) { const b = objects.get(path); if (!b) throw new Error("missing"); return b; } },
  }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
  for (const p of actors) await client(p).register();
  const roles = { [owner.actor.userId]: "owner", [manager.actor.userId]: "sales_manager", [rep.actor.userId]: "sales_rep" } as const;
  const v0 = await client(owner).view();
  const root = await client(owner).rotate(v0.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), grid(roles));
  await client(rep).join(root.fingerprint); await client(manager).join(root.fingerprint);
  return { owner, manager, rep, client, saved, objects, roles };
}

test("S4b chain through relay sessions: a delta follows its base; a new device gets the snapshot and the deltas; a moved head forces a snapshot", async () => {
  const db = await testDatabase();
  try {
    const { owner, manager, rep, client } = await sharing(db);
    const v1 = book(bookRow("m1", "P1", "10500"), bookRow("m2", "P2", "9000")), v2 = book(bookRow("m1", "P1", "10400"), bookRow("m2", "P2", "9000"));
    const r1 = await client(owner).packPublish("book", v1);
    assert.equal(r1.kind, "snapshot");
    const g1 = (await client(rep).packReceive("book"))!;
    assert.deepEqual(g1.steps.map(s => s.kind), ["snapshot"]);
    await client(rep).packMarkApplied("book", g1.version, g1.head);
    const d2 = strip(await diffPack("book", toRows("book", v1), toRows("book", v2), r1.version));
    const r2 = await client(owner).packPublish("book", v2, { data: d2, baseHash: r1.hash });
    assert.equal(r2.kind, "delta"); assert.equal(r2.rows, "1", "only the changed row travels");
    const g2 = (await client(rep).packReceive("book"))!;
    assert.deepEqual(g2.steps.map(s => [s.kind, s.version]), [["delta", "2"]], "a seat that holds version 1 fetches only the delta");
    assert.deepEqual(g2.steps[0].data, d2);
    // Not marked applied (a crash before the vault's write committed): the same steps come back, nothing is lost.
    assert.deepEqual((await client(rep).packReceive("book"))!.steps.map(s => s.version), ["2"]);
    // A device with nothing applied yet starts from the snapshot and replays the delta after it.
    const g3 = (await client(manager).packReceive("book"))!;
    assert.deepEqual(g3.steps.map(s => [s.kind, s.version]), [["snapshot", "1"], ["delta", "2"]]);
    // A delta made against a version that is no longer the head (another publisher went in between) goes as a snapshot.
    const r3 = await client(owner).packPublish("book", v2, { data: { ...d2, base: r1.version }, baseHash: r1.hash });
    assert.equal(r3.kind, "snapshot");
    assert.deepEqual((await client(manager).packReceive("book"))!.steps.map(s => [s.kind, s.version]), [["snapshot", "3"]], "the newest snapshot wins");
    await client(rep).packMarkApplied("book", g2.version, g2.head);
    assert.deepEqual((await client(rep).packReceive("book"))!.steps.map(s => [s.kind, s.version]), [["snapshot", "3"]]);
    // packReset forgets the walk, so the next receive starts again from the newest snapshot.
    const s = client(rep); s.packReset("book");
    assert.deepEqual((await s.packReceive("book"))!.steps.map(x => x.version), ["3"]);
  } finally { await db.close(); }
});

// The test helper shares one DuckDB database between connections, so each vault here gets its own attached catalog.
async function vault(name: string) {
  const c = await duckdbConnection();
  c.query(`ATTACH ':memory:' AS ${name}; USE ${name};`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0)`);
  return c;
}
type Svc = { publishAll(s: RelaySession, rotated: boolean): Promise<{ published: { pack: string; version: string; kind: string; rows: string }[]; fresh: boolean }>; receiveAll(s: RelaySession, view: undefined): Promise<void> };
function service(c: Awaited<ReturnType<typeof duckdbConnection>>, userId: string) {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" };
  s.licence = { tier: "professional", assert() {}, guard() {}, view: () => null, claims: { tier: "professional" }, writable: true };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as Svc;
}

test("S4b end to end through both vaults: only what changed is sent; cost changes reach no rep; nothing changed sends a fresh copy; a missing base recovers", async () => {
  const db = await testDatabase();
  const tag = Date.now().toString(36), pub = await vault("pub_" + tag), seat = await vault("seat_" + tag);
  try {
    const { owner, rep, client, saved } = await sharing(db);
    pub.query(`INSERT INTO role_assignments VALUES('${owner.actor.userId}','Olive','owner','${owner.actor.userId}','2025-01-01');
INSERT INTO products(product_id,description,category,uom,current_cost,list_price,notes,barcode) VALUES('P1','Ball valve','Valves','EA',4321,12000,NULL,NULL),('P2','Gate valve','Valves','EA',NULL,9000,NULL,NULL);
INSERT INTO price_guardrails(id,scope,start,target,floor,tier,category,floor_from_cost) VALUES('g2','unit_price',9000,8000,7000,'T02','Valves',false);
INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES('m1','P1','Valves',NULL,'T01',0,10500,'2025-01-01',NULL),('m2','P2','Valves',NULL,'T01',0,9000,'2025-01-01',NULL),${[3, 4, 5, 6, 7, 8].map(i => `('m${i}','P2','Valves',NULL,'T0${i}',0,${8000 + i},'2025-01-01',NULL)`).join(",")};`);
    seat.query(`INSERT INTO role_assignments VALUES('${rep.actor.userId}','Raj','sales_rep','${owner.actor.userId}','2025-01-01');`);
    const P = service(pub, owner.actor.userId), R = service(seat, rep.actor.userId);
    const price = (id: string) => q(seat, `SELECT price::VARCHAR p FROM price_matrix WHERE id='${id}'`)[0]?.p;
    const books = () => Object.fromEntries(q(seat, "SELECT pack,version FROM shared_books").map(r => [r.pack, r.version]));
    // The first publish (a rotation) sends every pack in full.
    const first = await P.publishAll(client(owner), true);
    assert.ok(first.published.length >= 6 && first.published.every(x => x.kind === "snapshot"));
    assert.ok(q(pub, "SELECT deltas_since FROM shared_published").every(r => Number(r.deltas_since) === 0));
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10500");
    const bookV1 = books().book;
    assert.ok(!q(seat, "SELECT DISTINCT pack FROM shared_pack_rows").some(r => r.pack === "cost" || r.pack === "cost_floors"), "decision 16: a rep's vault keeps no cost rows");
    // One price of eight changes: only the book pack goes, as a one-row delta.
    pub.query("UPDATE price_matrix SET price=10400 WHERE id='m1'");
    const second = await P.publishAll(client(owner), false);
    assert.deepEqual(second.published.map(x => [x.pack, x.kind, x.rows]), [["book", "delta", "1"]]); assert.equal(second.fresh, false);
    assert.equal(q(pub, "SELECT deltas_since::VARCHAR n FROM shared_published WHERE pack='book'")[0].n, "1");
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10400"); assert.equal(price("m2"), "9000", "rows outside the delta are kept");
    assert.ok(Number(books().book) > Number(bookV1));
    assert.ok(q(seat, "SELECT key FROM shared_changes WHERE pack='book'").length === 1, "What changed lists the one row");
    // A cost change alone publishes only cost: nothing for the rep to fetch, and its copy stays as it is.
    const repBooks = books();
    pub.query("UPDATE products SET current_cost=4400 WHERE product_id='P1'");
    const third = await P.publishAll(client(owner), false);
    assert.deepEqual(third.published.map(x => x.pack), ["cost"], "SHARING_DESIGN.md section 5: a cost-only delta sends non-cost devices nothing");
    await R.receiveAll(client(rep), undefined);
    assert.deepEqual(books(), repBooks);
    // Nothing changed: Publish now sends a fresh full copy of every pack (how a seat whose copy failed recovers).
    const fourth = await P.publishAll(client(owner), false);
    assert.equal(fourth.fresh, true); assert.ok(fourth.published.length >= 6 && fourth.published.every(x => x.kind === "snapshot"));
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10400");
    // A crash after the vault applied a delta but before the relay state recorded it: the replay is harmless.
    pub.query("UPDATE price_matrix SET price=10300 WHERE id='m1'");
    assert.equal((await P.publishAll(client(owner), false)).published[0].kind, "delta");
    const before = structuredClone(saved.get(rep.actor.deviceId));
    await R.receiveAll(client(rep), undefined);
    saved.set(rep.actor.deviceId, before);
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10300");
    // A vault without the base rows (upgraded from v24, or the rows lost) starts again from the newest snapshot.
    pub.query("UPDATE price_matrix SET price=10200 WHERE id='m1'");
    assert.equal((await P.publishAll(client(owner), false)).published[0].kind, "delta");
    seat.query("DELETE FROM shared_pack_rows WHERE pack='book'");
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10200");
    assert.equal(q(seat, "SELECT count(*)::VARCHAR n FROM shared_pack_rows WHERE pack='book'")[0].n, "8");
    // A file import in between: the next delta does not apply to it, so the walk starts again from the snapshot.
    seat.query("UPDATE shared_books SET via='file' WHERE pack='book'");
    pub.query("UPDATE price_matrix SET price=10100 WHERE id='m1'");
    await P.publishAll(client(owner), false);
    await R.receiveAll(client(rep), undefined);
    assert.equal(price("m1"), "10100");
    // A seat that once held cost (its role changed under the signed grid) drops the cost rows it kept as a delta base.
    seat.query("INSERT INTO shared_pack_rows VALUES('cost',0,'[\"P1\"]','[\"P1\",\"4321\"]')");
    await R.receiveAll(client(rep), undefined);
    assert.deepEqual(q(seat, "SELECT count(*)::VARCHAR n FROM shared_pack_rows WHERE pack='cost'"), [{ n: "0" }]);
    assert.ok(q(pub, "SELECT action FROM audit_log").some(r => r.action === "share.published"));
  } finally { pub.close(); seat.close(); await db.close(); }
});

test("S4b v25: the upgrade from v24 adds the two delta tables and nothing else", async () => {
  assert.equal(SCHEMA_VERSION, 25);
  assert.deepEqual(tablesFor(25).filter(t => !tablesFor(24).includes(t)), ["shared_pack_rows", "shared_published"]);
  const c = await duckdbConnection(), name = "up_" + Date.now().toString(36);
  try {
    c.query(`ATTACH ':memory:' AS ${name}; USE ${name};`);
    c.query(schemaSql(24)); c.query("INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,24,'professional','unit','tip',0,0)");
    c.query(`BEGIN; ${upgradeSql(24)} UPDATE vault_meta SET schema_version=25 WHERE id=1; COMMIT`);
    assert.deepEqual(q(c, "SELECT count(*)::VARCHAR n FROM shared_pack_rows"), [{ n: "0" }]);
    assert.throws(() => c.query("INSERT INTO shared_published VALUES('book','1','h','1','2026-11-25',-1)"), "deltas_since cannot go negative");
  } finally { c.close(); }
});

test("S4b: the stored pack rows are a delta base only; no read command, screen or export selects them", () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(`${dir}/${d.name}`) : /\.tsx?$/.test(d.name) ? [`${dir}/${d.name}`] : []);
  const users = [...files("lib"), ...files("components"), ...files("app")].filter(f => readFileSync(f, "utf8").includes("shared_pack_rows"));
  assert.deepEqual(users.sort(), ["lib/vault/schema.ts", "lib/vault/service.ts"]);
  const src = readFileSync("lib/vault/service.ts", "utf8");
  const reads = src.split("\n").filter(l => /FROM shared_pack_rows/.test(l) && !/DELETE FROM shared_pack_rows/.test(l));
  assert.equal(reads.length, 2, "one read in packRows, one count before clearing a seat that lost cost");
  assert.ok(reads.some(l => l.includes("SELECT part,row_key,row_json")) && reads.some(l => l.includes("SELECT count(*)")));
  const calls = [...src.matchAll(/this\.packRows\(/g)].length;
  assert.equal(calls, 2, "packRows is called only by publishAll and receivePack");
});
