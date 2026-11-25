// Regression (26 Nov 2026): the relay store read the head with `SELECT sequence::text AS sequence ... ORDER BY sequence`, so
// ORDER BY sorted the text alias and "9" came after "10". A workspace that passed nine events failed every sync with
// "could not be verified", and a pack's tenth version broke publishing. Found by the S5b relay gate.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayPackPage, relayDirectory, relayHead } from "../lib/relay/store";
import { RelaySession, emptyRelay, type RelayState } from "../lib/relay/session";
import type { Grid, Post } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";
import { PACKS } from "../lib/sharing/packs";

test("relay heads sort as numbers: syncs work past 9 events and publishing works past a pack's ninth version", async () => {
  const db = await testDatabase();
  try {
    const { actors, tenantId } = await relayFixture(db), [owner, , rep] = actors, saved = new Map<string, RelayState>(), objects = new Map<string, Uint8Array>();
    const client = (p: typeof owner) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
      page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
      packPage: (pack, after) => asRelay(db, p.actor, () => relayPackPage(db, p.actor, pack, after)),
      async post(value: Post) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
      chunks: { async put(path, bytes) { objects.set(path, new Uint8Array(bytes)); }, async get(path) { return objects.get(path)!; } },
    }, async v => { saved.set(p.actor.deviceId, structuredClone(v)); }, new AbortController().signal);
    for (const p of actors) await client(p).register();
    const roles: Record<string, Grid["people"][number]["role"]> = { [owner.actor.userId]: "owner", [actors[1].actor.userId]: "sales_manager", [rep.actor.userId]: "sales_rep" };
    const grid = (users: string[], prev: Grid | null): Grid => prev ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: roles[u] ?? "sales_rep", extras: [] })), ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
    const v = await client(owner).view(), root = await client(owner).rotate(v.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), grid);
    await client(rep).join(root.fingerprint);
    const shared = await client(rep).share({ objectKind: "quote", title: "T", reference: "R", amountMinor: "100", currency: "USD", preset: "standard" });
    for (let i = 0; i < 11; i++) await client(rep).comment(shared.objects[0].id, `c${i}`, []);
    assert.equal((await asRelay(db, owner.actor, () => relayHead(db, tenantId))).sequence, "12");
    const view = await client(owner).sync();
    assert.equal(view.head.sequence, "12"); assert.equal(view.sync.status, "synced");
    // Pack versions: eleven publishes in a row, each chained on the last, and a rep receives the eleventh.
    const book = (price: string) => [{ part: 0, columns: PACKS.book.parts[0].columns.map(c => c.name), rows: [["m1", "P1", "Valves", "T01", "0", price, "2025-01-01", null]] }];
    for (let i = 1; i <= 11; i++) assert.equal((await client(owner).packPublish("book", book(String(10000 + i)))).version, String(i));
    const got = (await client(rep).packReceive("book"))!;
    assert.equal(got.version, "11"); assert.deepEqual(got.steps.at(-1)!.data, book("10011"));
  } finally { await db.close(); }
});
