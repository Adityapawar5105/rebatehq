// Team sharing S5a (SHARING_DESIGN.md section 8): threads, tasks, the inbox and the activity feed over the relay, with no
// server change. A thread body is sealed under the pack key of its object, so a rep device never reads a cost thread.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayDirectory } from "../lib/relay/store";
import { RelaySession, emptyRelay, type RelayState } from "../lib/relay/session";
import { sealThread, openThread } from "../lib/relay/crypto";
import type { Grid, Post } from "../lib/relay/protocol";
import { COST_PACKS, RECOMMENDED, ALL_PACKS } from "../lib/sharing/catalog";
import { foldThreads, inboxFor, TARGET_PACK, TARGET_TYPES, THREAD_OBJECT_KIND } from "../lib/sharing/threads";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, SCHEMA_VERSION, ROLE_IDS } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { ACTIONS } from "../lib/roles/access";
import { GOVERNED, NOT_GOVERNED } from "../lib/sharing/governed";
import type { Request } from "../lib/vault/protocol";
import type { RoleId } from "../lib/roles/access";

const ticks = () => ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"];
const gridOf = (people: Record<string, RoleId>) => (users: string[], previous: Grid | null): Grid =>
  previous ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: people[u] ?? "sales_rep", extras: [] })), ticks: ticks() };
const code = (c: string) => (e: any) => e?.code === c;

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
  return { owner: a, manager: b, rep: c, client, saved, people };
}

test("S5a target map: one pack per target, and anything cost can be worked out from is a cost pack", () => {
  for (const t of TARGET_TYPES) assert.ok((ALL_PACKS as readonly string[]).includes(TARGET_PACK[t]), t);
  for (const t of ["cost", "leak", "claim", "vendor"] as const) assert.ok(COST_PACKS.includes(TARGET_PACK[t]), `${t} must map to a cost pack`);
  for (const t of ["item", "customer", "price", "contract", "guardrail", "quote"] as const) assert.ok(!COST_PACKS.includes(TARGET_PACK[t]), `${t} is readable by a rep`);
  assert.equal(THREAD_OBJECT_KIND, "price_change", "the outer kind is one of the three the 7A relay allows, the same for every thread");
});

test("S5a seal: a thread body opens only with its pack key and only for the event, thread, pack and sender it was sealed for", async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const b = { eventId: crypto.randomUUID(), tenantId: crypto.randomUUID(), epochId: crypto.randomUUID(), objectId: crypto.randomUUID(), pack: "items" as const, senderUser: crypto.randomUUID() };
  const body = { kind: "reply" as const, text: "S5A-SEALED" }, sealed = await sealThread(key, b, body);
  assert.ok(!atob(sealed.body).includes("S5A-SEALED"));
  assert.deepEqual(await openThread(key, b, sealed), body);
  for (const moved of [{ eventId: crypto.randomUUID() }, { objectId: crypto.randomUUID() }, { pack: "book" as const }, { senderUser: crypto.randomUUID() }, { epochId: crypto.randomUUID() }])
    await assert.rejects(openThread(key, { ...b, ...moved }, sealed), code("DECRYPT"), JSON.stringify(Object.keys(moved)));
  await assert.rejects(openThread(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))), b, sealed), code("DECRYPT"), "another pack key");
  await assert.rejects(sealThread(key, b, { kind: "reply", text: "x".repeat(2001) } as never), "text is capped");
});

test("S5a threads through sessions: open, mention, reply, resolve, task; a rep never reads or joins a cost thread", async () => {
  const db = await testDatabase();
  try {
    const { owner, manager, rep, client, saved } = await team(db);
    const O = owner.actor.userId, M = manager.actor.userId, R = rep.actor.userId;
    // The rep opens a thread on an item and mentions the Owner.
    await client(rep).threadOpen({ type: "item", ref: ["P1"], label: "Ball valve" }, "S5A-PRIVATE-ITEM is out of stock?", [O], null);
    const seen = (await client(owner).sync(), client(owner).threads().threads);
    assert.equal(seen.length, 1); assert.equal(seen[0].pack, "items"); assert.deepEqual(seen[0].target.ref, ["P1"]);
    assert.deepEqual(inboxFor(seen, O).map(i => i.kind), ["mention"]);
    const itemThread = seen[0].id;
    // The Sales Manager opens a thread on a leak finding (cost) and mentions the Owner; the rep's device cannot read it.
    await client(manager).threadOpen({ type: "leak", ref: ["C1", "P1"], label: "Acme leak" }, "S5A-PRIVATE-COST margin 12%", [O], null);
    await client(owner).sync(); assert.equal(client(owner).threads().threads.length, 2);
    await client(rep).sync();
    assert.deepEqual(client(rep).threads().threads.map(t => t.id), [itemThread], "decision 16: the rep folds only the item thread");
    const costEntry = saved.get(rep.actor.deviceId)!.entries.find(e => e.content?.kind === "thread" && e.content.pack === "cost")!;
    assert.deepEqual(costEntry.sealed, { state: "nokey" }, "the rep's device holds the event but cannot open its body");
    assert.ok(!JSON.stringify(saved.get(rep.actor.deviceId)).includes("S5A-PRIVATE-COST"), "nothing of a cost thread is stored on the rep device");
    // A rep cannot open a cost thread (no key), and nobody can mention or assign a rep on one.
    await assert.rejects(client(rep).threadOpen({ type: "cost", ref: ["P1"], label: "Cost" }, "x", [], null), code("ACCESS"));
    const costThread = client(owner).threads().threads.find(t => t.pack === "cost")!.id;
    await assert.rejects(client(manager).threadReply(costThread, "for the rep", [R]), code("CONTENT"));
    await assert.rejects(client(owner).threadTask(costThread, { assignee: R, due: null, done: false }), code("CONTENT"));
    // Replies, a task for the rep, resolve and reopen on the item thread.
    await client(owner).threadReply(itemThread, "Checking with the warehouse", []);
    await client(owner).threadTask(itemThread, { assignee: R, due: "2026-12-01", done: false });
    await client(rep).sync();
    const repInbox = inboxFor(client(rep).threads().threads, R);
    assert.deepEqual(repInbox.map(i => i.kind).sort(), ["reply", "task"], "a reply in a thread the rep wrote in, and the task");
    await client(rep).threadTask(itemThread, { assignee: R, due: "2026-12-01", done: true });
    await client(rep).threadStatus(itemThread, true);
    await assert.rejects(client(rep).threadStatus(itemThread, true), code("CONTENT"), "resolving twice is refused before it is sent");
    await client(owner).sync();
    const t = client(owner).threads().threads.find(x => x.id === itemThread)!;
    assert.equal(t.resolved, true); assert.deepEqual(t.task, { assignee: R, due: "2026-12-01", done: true });
    assert.deepEqual(t.events.map(e => e.kind), ["open", "reply", "task", "task", "resolved"]);
    assert.equal(client(owner).threads().rejected.length, 0);
    // 7A references still work beside threads, and the sync status shows no conflict.
    const shared = await client(rep).share({ objectKind: "quote", title: "Q-1", reference: "R-1", amountMinor: "100", currency: "USD", preset: "standard" });
    assert.equal(shared.sync.status, "synced"); assert.equal(shared.objects.length, 1, "thread events are not 7A objects");
    // Only ciphertext reaches the server.
    assert.ok(!JSON.stringify((await db.query("SELECT * FROM public.relay_event")).rows).includes("S5A-PRIVATE"));
    assert.ok(!JSON.stringify((await db.query("SELECT * FROM public.relay_event")).rows).includes("Ball valve"));
    // An older app quarantined thread events (unknown content); this version reads them again on the next sync.
    const old = structuredClone(saved.get(manager.actor.deviceId)!);
    for (const e of old.entries) if (e.content?.kind === "thread") { e.content = null; delete e.sealed; }
    saved.set(manager.actor.deviceId, old);
    await client(manager).sync();
    assert.equal(client(manager).threads().threads.length, 2, "re-read after an upgrade");
    // The fold refuses a thread event from a device that does not hold the pack, and a mention of someone who cannot read.
    const epochs = saved.get(owner.actor.deviceId)!.epochs.map(e => e.epoch), entries = saved.get(owner.actor.deviceId)!.entries;
    const cost = entries.find(e => e.content?.kind === "thread" && e.content.pack === "cost")!;
    const forged = structuredClone(cost); forged.event.id = crypto.randomUUID(); forged.event.objectId = crypto.randomUUID(); forged.event.senderDevice = rep.actor.deviceId; forged.event.senderUser = R;
    const mention = structuredClone(cost); mention.event.id = crypto.randomUUID(); mention.event.objectId = crypto.randomUUID(); mention.event.mentions = [R];
    const out = foldThreads([...entries, forged, mention], epochs);
    assert.deepEqual(out.rejected.sort(), [forged.event.id, mention.event.id].sort());
    assert.equal(out.threads.length, 2, "rejected events change nothing");
    void M;
  } finally { await db.close(); }
});

async function vault(name: string) {
  const c = await duckdbConnection();
  c.query(`ATTACH ':memory:' AS ${name}; USE ${name};`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0)`);
  return c;
}
function service(c: Awaited<ReturnType<typeof duckdbConnection>>, userId: string) {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" };
  s.licence = { tier: "professional", assert() {}, guard() {}, view: () => null, claims: { tier: "professional" }, writable: true };
  s.writable = async () => s.engine; s.save = async () => undefined; s.touch = () => undefined;
  return s as unknown as VaultService;
}
const call = <A extends Request["action"]>(s: VaultService, action: A, data: Extract<Request, { action: A }>["data"]) =>
  dispatch(s, { id: "1", action, data } as Request, { signal: () => new AbortController().signal, progress: () => undefined }) as Promise<any>;

test("S5a vault reads: thread list by object, inbox with unread and tasks, activity feed; a role without cost never sees a cost thread", async () => {
  const db = await testDatabase(), tag = Date.now().toString(36);
  const repVault = await vault("rv_" + tag), ownerVault = await vault("ov_" + tag);
  try {
    const { owner, manager, rep, client, saved } = await team(db);
    const O = owner.actor.userId, R = rep.actor.userId;
    await client(owner).threadOpen({ type: "item", ref: ["P1"], label: "Ball valve" }, "Please check @Raj", [R], { assignee: R, due: "2026-12-01", done: false });
    await client(manager).threadOpen({ type: "leak", ref: ["C1"], label: "Acme" }, "S5A-VAULT-COST", [O], null);
    await client(rep).sync(); await client(owner).sync();
    repVault.query(`INSERT INTO relay_state VALUES(1,'${JSON.stringify(saved.get(rep.actor.deviceId)).replaceAll("'", "''")}');INSERT INTO role_assignments VALUES('${R}','Raj','sales_rep','${O}','2025-01-01'),('${O}','Olive','owner','${O}','2025-01-01')`);
    ownerVault.query(`INSERT INTO relay_state VALUES(1,'${JSON.stringify(saved.get(owner.actor.deviceId)).replaceAll("'", "''")}');INSERT INTO role_assignments VALUES('${O}','Olive','owner','${O}','2025-01-01')`);
    const r = service(repVault, R), o = service(ownerVault, O);
    const list = await call(r, "threadList", { target: { type: "item", ref: ["P1"] } });
    assert.equal(list.threads.length, 1); assert.equal(list.people.find((p: any) => p.userId === R).name, "Raj");
    assert.equal((await call(r, "threadList", { target: { type: "item", ref: ["P2"] } })).threads.length, 0, "threads are listed per object");
    assert.ok(!JSON.stringify(await call(r, "threadList", { target: null })).includes("S5A-VAULT-COST"));
    assert.ok(!("cost" in list.readers), "a rep is never offered cost readers");
    const inbox = await call(r, "inboxState", {});
    assert.deepEqual(inbox.items.map((i: any) => i.kind), ["mention", "task"]); assert.equal(inbox.unread, "2"); assert.equal(inbox.tasks.length, 1);
    assert.equal((await call(r, "inboxSeen", {})).unread, "0");
    assert.equal(JSON.parse(String(repVault.query("SELECT payload FROM relay_state").toArray()[0].payload)).inboxSeen, saved.get(rep.actor.deviceId)!.head.sequence);
    const feed = await call(r, "activityFeed", {});
    assert.ok(feed.items.some((i: any) => i.kind === "thread.open" && i.label === "Ball valve"));
    assert.ok(!JSON.stringify(feed).includes("Acme"), "the cost thread is not in the rep's feed");
    // The Owner's vault sees both, and a role without cost in the same vault would not.
    assert.equal((await call(o, "threadList", { target: null })).threads.length, 2);
    ownerVault.query(`UPDATE role_assignments SET role='sales_rep' WHERE user_id='${O}'`);
    (o as unknown as { accessCache: unknown }).accessCache = null;
    assert.equal((await call(o, "threadList", { target: null })).threads.length, 1, "decision 16: the vault role filters cost threads too");
    // And it cannot write to one either: open, reply, resolve or assign (checked before any network call).
    const costId = foldThreads(saved.get(owner.actor.deviceId)!.entries, saved.get(owner.actor.deviceId)!.epochs.map(e => e.epoch)).threads.find(t => t.pack === "cost")!.id;
    const session = { threads: () => foldThreads(saved.get(owner.actor.deviceId)!.entries, saved.get(owner.actor.deviceId)!.epochs.map(e => e.epoch)) };
    const svc = o as unknown as { threadPackAllowed(s: unknown, id: string): Promise<void>; threadTargetAllowed(t: string): Promise<void> };
    await assert.rejects(svc.threadPackAllowed(session, costId), code("FORBIDDEN"));
    await assert.rejects(svc.threadTargetAllowed("leak"), code("FORBIDDEN"));
    await svc.threadTargetAllowed("item");
  } finally { repVault.close(); ownerVault.close(); await db.close(); }
});

test("S5a commands are classified: reads are local, writes are relay state and never governed", () => {
  for (const a of ["threadList", "inboxState", "activityFeed"] as const) assert.deepEqual(ACTIONS[a], { cap: "collaborate", mode: "read" });
  for (const a of ["inboxSeen", "relayThreadOpen", "relayThreadReply", "relayThreadStatus", "relayThreadTask"] as const) {
    assert.deepEqual(ACTIONS[a], { cap: "collaborate", mode: "write" });
    assert.ok(a in NOT_GOVERNED && !(a in GOVERNED), `${a}: a read-only seat can still discuss shared data`);
  }
});
