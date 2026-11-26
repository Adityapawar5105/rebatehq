// Review R2 (B3): the relay log is folded into a local checkpoint instead of growing until the 7A client limits (10,000
// events, 256 epochs) stopped every device for good. Small thresholds here; the real ones are RELAY_TAIL in session.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayDirectory } from "../lib/relay/store";
import { RelaySession, emptyRelay, RELAY_TAIL, relayObjects, relayThreads, type RelayState } from "../lib/relay/session";
import type { Grid, Post } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";
import type { RoleId } from "../lib/roles/access";

const ticks = () => ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"];
const gridOf = (people: Record<string, RoleId>) => (users: string[], previous: Grid | null): Grid =>
  previous ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: people[u] ?? "sales_rep", extras: [] })), ticks: ticks() };

async function team(db: any) {
  const fixture = await relayFixture(db), [a, b, c] = fixture.actors, saved = new Map<string, RelayState>();
  const client = (p: typeof a) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
    directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
    page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
    async post(value: Post) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
  }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
  for (const p of [a, b, c]) await client(p).register();
  const people = { [a.actor.userId]: "owner", [b.actor.userId]: "sales_manager", [c.actor.userId]: "sales_rep" } as Record<string, RoleId>;
  const v = await client(a).view(), root = await client(a).rotate(v.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), gridOf(people));
  await client(b).join(root.fingerprint); await client(c).join(root.fingerprint);
  return { owner: a, manager: b, rep: c, client, saved };
}
// What a person sees, without positions that differ only by where a log starts.
const seen = (s: RelayState) => ({
  objects: relayObjects(s).objects.map(o => ({ id: o.id, title: o.subject.title, comments: o.comments.map(c => c.text) })),
  threads: relayThreads(s).threads.filter(t => t.pack === "items").map(t => ({ id: t.id, resolved: t.resolved, messages: t.messages.map(m => m.text) })),
});

test("review R2: a compacted relay log shows exactly what the full log shows, and old objects and threads stay usable", async () => {
  const db = await testDatabase(), before = { ...RELAY_TAIL };
  try {
    const { owner, manager, rep, client, saved } = await team(db);
    // The Owner and the rep compact at 10 kept entries; the Sales Manager keeps the full log and syncs only at the end.
    RELAY_TAIL.keep = 5; RELAY_TAIL.max = 10;
    const shared = await client(rep).share({ objectKind: "quote", title: "Q-OLD", reference: "R-1", amountMinor: "100", currency: "USD", preset: "standard" });
    const object = shared.objects[0].id;
    await client(rep).threadOpen({ type: "item", ref: ["P1"], label: "Ball valve" }, "first", [], null);
    const thread = (await client(owner).sync(), client(owner).threads().threads[0].id);
    for (let i = 0; i < 12; i++) { await client(i % 2 ? rep : owner).comment(object, `comment ${i}`, []); await client(i % 2 ? owner : rep).threadReply(thread, `reply ${i}`, []); }
    await client(owner).sync(); await client(rep).sync();
    const o = saved.get(owner.actor.deviceId)!;
    assert.ok(o.base, "the Owner's log was folded into a checkpoint");
    assert.ok(o.entries.length <= RELAY_TAIL.max, `kept ${o.entries.length} entries`);
    // Work on an object and a thread that began before the checkpoint still goes through.
    await client(owner).comment(object, "after the checkpoint", []);
    await client(rep).threadReply(thread, "reply after the checkpoint", []);
    await client(owner).threadStatus(thread, true);
    await client(owner).sync(); await client(rep).sync();
    RELAY_TAIL.keep = 100_000; RELAY_TAIL.max = 100_000;
    await client(manager).sync();
    const full = saved.get(manager.actor.deviceId)!;
    assert.equal(full.base, undefined, "the reference device kept every entry");
    assert.deepEqual(seen(saved.get(owner.actor.deviceId)!), seen(full), "the Owner's compacted view equals the full log");
    assert.deepEqual(seen(saved.get(rep.actor.deviceId)!), seen(full), "so does the rep's");
    const t = relayThreads(full).threads.find(x => x.id === thread)!;
    assert.equal(t.resolved, true); assert.equal(t.messages.length, 1 + 12 + 1);
    assert.equal(relayObjects(full).objects[0].comments.length, 13);
    // Nothing was rejected, so the sync status is not a conflict on a compacted device.
    assert.equal((await client(owner).view()).sync.status, "synced");
    assert.deepEqual([...relayObjects(saved.get(owner.actor.deviceId)!).rejected, ...relayThreads(saved.get(owner.actor.deviceId)!).rejected], []);
  } finally { Object.assign(RELAY_TAIL, before); await db.close(); }
});

test("review R2: rotations after compaction are verified, and every key epoch is kept", async () => {
  const db = await testDatabase(), before = { ...RELAY_TAIL };
  try {
    const { owner, rep, client, saved } = await team(db);
    RELAY_TAIL.keep = 3; RELAY_TAIL.max = 6;
    const shared = await client(rep).share({ objectKind: "quote", title: "Q-ROT", reference: "R-2", amountMinor: "100", currency: "USD", preset: "standard" });
    const object = shared.objects[0].id;
    const rotate = async () => { const v = await client(owner).view(); await client(owner).rotate(v.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), (_users, previous) => previous!); };
    for (let round = 0; round < 3; round++) { await rotate(); for (let i = 0; i < 4; i++) await client(round % 2 ? owner : rep).comment(object, `r${round}-${i}`, []); }
    await client(owner).sync(); await client(rep).sync();
    const o = saved.get(owner.actor.deviceId)!;
    assert.ok(o.base && o.entries.length <= RELAY_TAIL.max);
    assert.equal(o.epochs.length, 4, "every key epoch is kept: pack versions and thread holders need their signed wraps");
    // Sharing still works across the rotation: the rep's comment after it reaches the Owner.
    await client(rep).comment(object, "after the rotations", []);
    await client(owner).sync();
    assert.equal(relayObjects(saved.get(owner.actor.deviceId)!).objects[0].comments.at(-1)!.text, "after the rotations");
  } finally { Object.assign(RELAY_TAIL, before); await db.close(); }
});

test("review R2: a sync that applies nothing does not save the vault again until QUIET_SAVE_MS has passed", async () => {
  const db = await testDatabase();
  try {
    const { owner, rep, client, saved } = await team(db);
    await client(owner).sync();
    const stamp = saved.get(owner.actor.deviceId)!.lastSyncedAt;
    await client(owner).sync(); await client(owner).sync();
    assert.equal(saved.get(owner.actor.deviceId)!.lastSyncedAt, stamp, "two quiet syncs wrote nothing");
    await client(rep).share({ objectKind: "quote", title: "Q-NEW", reference: "R-3", amountMinor: "100", currency: "USD", preset: "standard" });
    await client(owner).sync();
    assert.notEqual(saved.get(owner.actor.deviceId)!.lastSyncedAt, stamp, "a sync that applied an event saves");
    assert.equal(relayObjects(saved.get(owner.actor.deviceId)!).objects[0].subject.title, "Q-NEW");
    // An old saved time makes a quiet sync save again, so the last-synced time does not drift for long.
    const old = saved.get(owner.actor.deviceId)!; old.lastSyncedAt = new Date(Date.now() - 16 * 60_000).toISOString(); saved.set(owner.actor.deviceId, old);
    await client(owner).sync();
    assert.ok(Date.parse(saved.get(owner.actor.deviceId)!.lastSyncedAt!) > Date.now() - 60_000);
  } finally { await db.close(); }
});
