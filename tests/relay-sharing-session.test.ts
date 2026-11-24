// Team sharing S2b (SHARING_DESIGN.md sections 3.3 and 4): the worker's relay session signs and reads format 2 epochs,
// each device keeps only its pack keys, and a receiving vault mirrors the signed role table into Team and roles.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayDirectory } from "../lib/relay/store";
import { RelaySession, emptyRelay, type RelayState, type RelayView } from "../lib/relay/session";
import type { Grid, Post } from "../lib/relay/protocol";
import { ALL_PACKS, COST_PACKS, RECOMMENDED } from "../lib/sharing/catalog";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, ROLE_IDS } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";
import type { RoleId } from "../lib/roles/access";

const ticks = () => ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"];
const gridOf = (people: Record<string, RoleId>, named: string | null = null) => (users: string[], previous: Grid | null): Grid =>
  previous ?? { v: "1", namedOwner: named, people: users.map(u => ({ userId: u, role: people[u] ?? "sales_rep", extras: [] })), ticks: ticks() };

test("S2b sessions: the Owner signs a grid; each joined device holds only its packs; events still flow; a non-publisher cannot rotate", async () => {
  const db = await testDatabase();
  try {
    const fixture = await relayFixture(db), [a, b, c] = fixture.actors, saved = new Map<string, RelayState>();
    const client = (p: typeof a) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
      page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
      async post(value: Post) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
    }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
    for (const p of [a, b, c]) await client(p).register();
    const people = { [a.actor.userId]: "owner", [b.actor.userId]: "sales_manager", [c.actor.userId]: "sales_rep" } as Record<string, RoleId>;
    const initial = await client(a).view(), confirmations = initial.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint }));
    const root = await client(a).rotate(confirmations, gridOf(people));
    assert.deepEqual(root.packs, [...ALL_PACKS], "the Owner holds every pack");
    assert.equal(root.ownerDevices, 1, "one Owner device: the recovery kit prompt shows");
    await client(b).join(root.fingerprint); await client(c).join(root.fingerprint);
    const bv = await client(b).sync(), cv = await client(c).sync();
    assert.deepEqual(bv.packs, ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors", "documents", "results"]);
    assert.deepEqual(cv.packs, ["items", "customers", "book", "contracts", "guards", "documents"]);
    assert.ok(!cv.packs.some(p => (COST_PACKS as readonly string[]).includes(p)), "decision 16: no cost pack key on the rep device");
    assert.ok(!Object.keys(saved.get(c.actor.deviceId)!.epochs.at(-1)!.packs ?? {}).includes("cost"), "and none stored in its vault");
    assert.deepEqual(cv.grid!.people.map(p => p.role).sort(), ["owner", "sales_manager", "sales_rep"]);
    // 7A comments and approvals keep working on a format 2 epoch.
    const shared = await client(c).share({ objectKind: "quote", title: "S2B-PRIVATE-TITLE", reference: "S2B-REF", amountMinor: "1000", currency: "USD", preset: "standard" });
    await client(c).comment(shared.objects[0].id, "S2B-PRIVATE-COMMENT", []);
    assert.equal((await client(a).sync()).objects[0].comments[0].text, "S2B-PRIVATE-COMMENT");
    // A Sales Manager is a server manager but not a grid publisher: the server refuses the rotation it signs.
    const view = await client(b).view();
    await assert.rejects(client(b).rotate(view.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), gridOf(people)));
    // The Owner rotates again with an unchanged grid; every device follows and keeps only its packs.
    const again = await client(a).view();
    await client(a).rotate(again.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), gridOf(people));
    assert.deepEqual((await client(c).sync()).packs, cv.packs);
    for (const t of ["relay_epoch", "relay_pack_wrap", "relay_event"]) assert.ok(!JSON.stringify((await db.query(`SELECT * FROM public.${t}`)).rows).includes("S2B-PRIVATE"));
  } finally { await db.close(); }
});

async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0)`);
  return c;
}
function service(c: Awaited<ReturnType<typeof duckdbConnection>>, userId: string) {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" };
  s.licence = { tier: "professional", assert() {}, guard() {}, view: () => null, claims: { tier: "professional" }, writable: true };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as Pick<VaultService, "access" | "pricingState"> & { mirrorGrid(session: { grid(): Grid | null }, view: Partial<RelayView>): Promise<void>; gridBuilder(): Promise<(u: string[], p: Grid | null) => Grid> };
}

test("S2b role mirror: a rep's own vault takes its role from the signed grid and loses cost; an Owner's vault is never overwritten", async () => {
  const c = await vault();
  try {
    // The rep created this vault, so it made them its Owner and named Pricing Owner.
    c.query("INSERT INTO role_assignments VALUES('rep','Raj','owner','rep','2025-01-01');INSERT INTO pricing_settings VALUES(1,'rep','Raj',7)");
    const rep = service(c, "rep");
    assert.ok((await rep.access()).caps.includes("cost"), "before joining, the creator is the vault's Owner");
    const grid: Grid = { v: "1", namedOwner: "po", people: [{ userId: "boss", role: "owner", extras: [] }, { userId: "po", role: "pricing_owner", extras: [] }, { userId: "rep", role: "sales_rep", extras: [] }], ticks: ticks() };
    await rep.mirrorGrid({ grid: () => grid }, { devices: [{ userId: "po", label: "po@example.invalid" } as RelayView["devices"][number]] });
    assert.deepEqual(q(c, "SELECT user_id,role FROM role_assignments ORDER BY user_id"), [{ user_id: "boss", role: "owner" }, { user_id: "po", role: "pricing_owner" }, { user_id: "rep", role: "sales_rep" }]);
    assert.deepEqual(q(c, "SELECT owner_id,owner_name FROM pricing_settings"), [{ owner_id: "po", owner_name: "po@example.invalid" }]);
    const access = await rep.access();
    assert.equal(access.role, "sales_rep"); assert.ok(!access.caps.includes("cost"), "decision 16: after joining, the rep's own vault gives them no cost");
    assert.ok(q(c, "SELECT action FROM audit_log").some(r => r.action === "roles.mirrored_from_grid"));
    const n = q(c, "SELECT count(*)::VARCHAR n FROM audit_log")[0].n;
    await rep.mirrorGrid({ grid: () => grid }, { devices: [] });
    assert.equal(q(c, "SELECT count(*)::VARCHAR n FROM audit_log")[0].n, n, "an unchanged grid writes nothing");
    // No named Pricing Owner in the grid: none is named here either.
    await rep.mirrorGrid({ grid: () => ({ ...grid, namedOwner: null }) }, { devices: [] });
    assert.equal(((await rep.pricingState()) as { owner: unknown }).owner, null);
  } finally { c.close(); }
  const d = await vault();
  try {
    d.query("INSERT INTO role_assignments VALUES('boss','Boss','owner','boss','2025-01-01'),('sam','Sam','sales_manager','boss','2025-01-01');INSERT INTO pricing_settings VALUES(1,'boss','Boss',7)");
    const boss = service(d, "boss");
    const build = await boss.gridBuilder(), g = build(["boss", "new", "sam"], null);
    assert.deepEqual(g.people.map(p => [p.userId, p.role]), [["boss", "owner"], ["new", "sales_rep"], ["sam", "sales_manager"]], "anyone without a role here is a Sales Rep");
    assert.equal(g.namedOwner, "boss");
    await boss.mirrorGrid({ grid: () => ({ ...g, people: g.people.map(p => ({ ...p, role: p.userId === "sam" ? "sales_rep" : p.role })) }) }, { devices: [] });
    assert.deepEqual(q(d, "SELECT user_id,role FROM role_assignments ORDER BY user_id"), [{ user_id: "boss", role: "owner" }, { user_id: "sam", role: "sales_manager" }], "the Owner's vault is the grid's source");
    // A Pricing Owner rotating keeps the previous grid: only an Owner changes it.
    const po = service(d, "sam"), prev: Grid = { ...g, people: g.people.map(p => p.userId === "sam" ? { ...p, role: "pricing_owner" } : p) };
    assert.equal((await po.gridBuilder())(["boss", "new", "sam"], prev), prev);
  } finally { d.close(); }
});
