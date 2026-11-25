// Team sharing S3 (migration 20261126120000_sharing_s3_storage.sql): the rule Supabase Storage applies to encrypted pack
// chunks, run in PGlite as `authenticated` with only auth.uid(), exactly as Storage calls it.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayDirectory } from "../lib/relay/store";
import { newEpoch, encryptPackVersion } from "../lib/relay/crypto";
import { ZERO_HASH, RelayError, type Grid } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";

const manifest = { kind: "manifest" as const, rows: "1", contentHash: "a".repeat(64), chunks: [{ n: "0", bytes: "40", sha256: "b".repeat(64) }] };
async function as(db: any, userId: string | null, sql: string, args: unknown[] = []) {
  await db.exec("BEGIN"); await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId ?? ""]); await db.exec("SET LOCAL ROLE authenticated");
  try { return (await db.query(sql, args)).rows; } finally { await db.exec("ROLLBACK"); }
}
test("S3 Storage rule: holders read their packs, only the signing publisher writes, and everyone else gets nothing", async () => {
  const db = await testDatabase();
  try {
    const { tenantId, actors } = await relayFixture(db), [owner, manager, rep] = actors, other = await relayFixture(db);
    for (const a of actors) await asRelay(db, a.actor, () => relayPost(db, a.actor, { action: "register", device: a.identity.device }));
    const d = await asRelay(db, owner.actor, () => relayDirectory(db, owner.actor));
    const grid: Grid = { v: "1", namedOwner: null, people: [{ userId: owner.actor.userId, role: "owner", extras: [] }, { userId: manager.actor.userId, role: "sales_manager", extras: [] }, { userId: rep.actor.userId, role: "sales_rep", extras: [] }].sort((a, b) => a.userId < b.userId ? -1 : 1) as Grid["people"], ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
    const { epoch, packKeys } = await newEpoch(owner.identity, d.devices, null, d.head, grid);
    await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "epoch", epoch }));
    const cost = await encryptPackVersion(owner.identity, epoch, packKeys.cost!, { version: "0", hash: ZERO_HASH }, "cost", "snapshot", "0", manifest);
    const book = await encryptPackVersion(owner.identity, epoch, packKeys.book!, { version: "0", hash: ZERO_HASH }, "book", "snapshot", "0", manifest);
    for (const p of [cost, book]) await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "pack", pack: p }));
    const path = (pack: string, id: string, n = 0, tenant = tenantId) => `${tenant}/${pack}/${id}/${n}`;
    const allowed = async (user: string | null, name: string, write: boolean) => (await as(db, user, "SELECT rebatehq_storage.relay_storage_allowed($1,$2) AS ok", [name, write]))[0].ok as boolean;
    // Reading.
    assert.equal(await allowed(owner.actor.userId, path("cost", cost.id), false), true);
    assert.equal(await allowed(manager.actor.userId, path("cost", cost.id), false), true, "a Sales Manager holds cost");
    assert.equal(await allowed(rep.actor.userId, path("cost", cost.id), false), false, "decision 16: a rep can never fetch a cost chunk");
    assert.equal(await allowed(rep.actor.userId, path("book", book.id), false), true);
    assert.equal(await allowed(rep.actor.userId, path("book", cost.id), false), false, "the version must be of that pack");
    assert.equal(await allowed(other.actors[0].actor.userId, path("book", book.id), false), false, "another workspace");
    assert.equal(await allowed(null, path("book", book.id), false), false, "no sign-in");
    // Writing: only the signer of that version, for a real chunk number and a well-formed path.
    assert.equal(await allowed(owner.actor.userId, path("book", book.id, 3), true), true);
    assert.equal(await allowed(manager.actor.userId, path("book", book.id), true), false, "a holder who did not sign it");
    assert.equal(await allowed(owner.actor.userId, path("book", book.id, 128), true), false, "at most 128 chunks");
    for (const bad of [`${tenantId}/book/${book.id}`, `${tenantId}/book/${book.id}/0/x`, `${tenantId}/invoices/${book.id}/0`, `../${tenantId}/book/${book.id}/0`, `${tenantId}/book/${book.id}/01`])
      assert.equal(await allowed(owner.actor.userId, bad, true), false, bad);
    // Suspending the rep or ending the licence closes reads at once.
    await db.query("UPDATE public.membership SET status='suspended' WHERE tenant_id=$1 AND user_id=$2", [tenantId, rep.actor.userId]);
    assert.equal(await allowed(rep.actor.userId, path("book", book.id), false), false);
    await db.query("UPDATE public.workspace_licence SET tier='starter' WHERE tenant_id=$1", [tenantId]);
    assert.equal(await allowed(owner.actor.userId, path("book", book.id), false), false);
    // The policies exist, read and insert only, on the private bucket; nothing can update or delete a chunk.
    const policies = (await db.query("SELECT policyname,cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname")).rows;
    assert.deepEqual(policies.map((p: any) => [p.policyname, p.cmd]), [["relay_packs_read", "SELECT"], ["relay_packs_write", "INSERT"]]);
    assert.deepEqual((await db.query("SELECT public,file_size_limit::text AS l FROM storage.buckets WHERE id='relay-packs'")).rows, [{ public: false, l: "524400" }]);
  } finally { await db.close(); }
});

test("S3 publish and receive through sessions: a rep gets book prices, never a cost chunk; tampering fails; a rotation re-publishes", async () => {
  const { RelaySession, emptyRelay } = await import("../lib/relay/session");
  const { relayPage, relayPackPage } = await import("../lib/relay/store");
  const db = await testDatabase();
  try {
    const { actors } = await relayFixture(db), [owner, manager, rep] = actors, saved = new Map<string, any>(), objects = new Map<string, Uint8Array>(), refused: string[] = [];
    const client = (p: typeof owner) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
      page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
      packPage: (pack, after) => asRelay(db, p.actor, () => relayPackPage(db, p.actor, pack, after)),
      async post(value) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
      // Storage stand-in: the same relay_storage_allowed rule Supabase Storage applies, as `authenticated`.
      chunks: {
        async put(path, bytes) { if (!(await as(db, p.actor.userId, "SELECT rebatehq_storage.relay_storage_allowed($1,true) AS ok", [path]))[0].ok || objects.has(path)) { refused.push(path); throw new Error("403"); } objects.set(path, new Uint8Array(bytes)); },
        async get(path) { if (!(await as(db, p.actor.userId, "SELECT rebatehq_storage.relay_storage_allowed($1,false) AS ok", [path]))[0].ok) { refused.push(path); throw new Error("403"); } return objects.get(path)!; },
      },
    }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
    for (const p of actors) await client(p).register();
    const grid = (users: string[], prev: Grid | null): Grid => prev ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: (u === owner.actor.userId ? "owner" : u === manager.actor.userId ? "sales_manager" : "sales_rep") as Grid["people"][number]["role"], extras: [] })), ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
    const v0 = await client(owner).view(), confirm = (v: typeof v0) => v.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint }));
    const root = await client(owner).rotate(confirm(v0), grid);
    await client(manager).join(root.fingerprint); await client(rep).join(root.fingerprint);
    const { PACKS } = await import("../lib/sharing/packs");
    const book = [{ part: 0, columns: PACKS.book.parts[0].columns.map(c => c.name), rows: [["m1", "P1", "Valves", "T01", "0", "10500", "2025-01-01", null]] }];
    const cost = PACKS.cost.parts.map((p, i) => ({ part: i, columns: p.columns.map(c => c.name), rows: i === 0 ? [["P1", "4321"]] : [] }));
    await client(owner).packPublish("book", book); await client(owner).packPublish("cost", cost);
    assert.ok([...objects.keys()].every(k => /^[0-9a-f-]{36}\/(book|cost)\/[0-9a-f-]{36}\/0$/.test(k)));
    assert.ok(![...objects.values()].some(b => Buffer.from(b).toString("latin1").includes("10500")), "only ciphertext in Storage");
    // The rep receives book prices, verified end to end; cost is neither held nor fetchable.
    const got = await client(rep).packReceive("book");
    assert.deepEqual(got?.data, book); assert.equal(got?.version, "1");
    assert.ok(!client(rep).heldPacks().includes("cost"));
    assert.equal(await client(rep).packReceive("cost"), null, "a rep sees no cost version at all");
    const costPath = [...objects.keys()].find(k => k.includes("/cost/"))!;
    await assert.rejects(as(db, rep.actor.userId, "SELECT 1").then(() => client(rep)["packTransport"]().chunks.get(costPath)));
    assert.ok(refused.includes(costPath), "decision 16: Storage refuses the rep a cost chunk");
    assert.deepEqual((await client(manager).packReceive("cost"))?.data, cost, "a Sales Manager receives cost");
    // Nobody but the signer can add a chunk, and nothing can replace one.
    const bookPath = [...objects.keys()].find(k => k.includes("/book/"))!;
    await assert.rejects(client(manager)["packTransport"]().chunks.put(bookPath.replace(/\/0$/, "/1"), new Uint8Array(40)));
    await assert.rejects(client(owner)["packTransport"]().chunks.put(bookPath, new Uint8Array(40)), "a chunk is never replaced");
    // A changed byte in Storage is caught before anything is applied.
    const bad = new Uint8Array(objects.get(bookPath)!); bad[20] ^= 1; objects.set(bookPath, bad);
    await client(owner).packPublish("book", book); // version 2, under the same epoch
    const v2path = [...objects.keys()].filter(k => k.includes("/book/") && k !== bookPath)[0]; const b2 = new Uint8Array(objects.get(v2path)!); b2[30] ^= 1; objects.set(v2path, b2);
    await assert.rejects(client(rep).packReceive("book"), "a tampered chunk fails the manifest check");
    objects.set(v2path, b2.map((x, i) => i === 30 ? x ^ 1 : x));
    assert.equal((await client(rep).packReceive("book"))?.version, "2");
    // After a rotation the publisher re-publishes under new keys, and every holder can read it.
    await client(owner).rotate(confirm(await client(owner).view()), grid);
    await client(owner).packPublish("book", book);
    await client(rep).sync();
    assert.equal((await client(rep).packReceive("book"))?.version, "3");
  } finally { await db.close(); }
});

test("S4 not ready yet: a version whose chunks are still uploading is skipped quietly, then received; an old gap is a failure", async () => {
  const { RelaySession, emptyRelay, NOT_READY_MS } = await import("../lib/relay/session");
  const { relayPage, relayPackPage } = await import("../lib/relay/store");
  const db = await testDatabase();
  try {
    const { actors } = await relayFixture(db), [owner, , rep] = actors, saved = new Map<string, any>(), objects = new Map<string, Uint8Array>();
    let hold = false; const held: [string, Uint8Array][] = [];
    const client = (p: typeof owner) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
      page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
      packPage: (pack, after) => asRelay(db, p.actor, () => relayPackPage(db, p.actor, pack, after)),
      async post(value) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
      chunks: {
        // The doorbell can ring between the version row and its chunks: hold uploads back to reproduce that window.
        async put(path, bytes) { if (hold) { held.push([path, new Uint8Array(bytes)]); return; } objects.set(path, new Uint8Array(bytes)); },
        async get(path) { const b = objects.get(path); if (!b) throw new RelayError("ACCESS", "missing"); return b; },
      },
    }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
    for (const p of actors) await client(p).register();
    const roles: Record<string, Grid["people"][number]["role"]> = { [owner.actor.userId]: "owner", [actors[1].actor.userId]: "sales_manager", [rep.actor.userId]: "sales_rep" };
    const grid = (users: string[], prev: Grid | null): Grid => prev ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: roles[u] ?? "sales_rep", extras: [] })), ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
    const v0 = await client(owner).view();
    const root = await client(owner).rotate(v0.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), grid);
    await client(rep).join(root.fingerprint);
    const { PACKS } = await import("../lib/sharing/packs");
    const book = [{ part: 0, columns: PACKS.book.parts[0].columns.map(c => c.name), rows: [["m1", "P1", "Valves", "T01", "0", "10500", "2025-01-01", null]] }];
    hold = true; await client(owner).packPublish("book", book); hold = false;
    await assert.rejects(client(rep).packReceive("book"), (e: any) => e.code === "NOT_READY", "a just-signed version without chunks is not ready, not a failure");
    for (const [k, v] of held) objects.set(k, v);
    assert.deepEqual((await client(rep).packReceive("book"))?.data, book, "once the chunks land, the next ring or poll receives it");
    // A version still without chunks long after it was signed (a restore, a lost upload) is a real failure.
    const old = Date.now; Date.now = () => old() + NOT_READY_MS + 60_000;
    try {
      hold = true; await client(owner).packPublish("book", book); hold = false;
      await assert.rejects(client(rep).packReceive("book"), (e: any) => e.code === "ACCESS");
    } finally { Date.now = old; }
  } finally { await db.close(); }
});
