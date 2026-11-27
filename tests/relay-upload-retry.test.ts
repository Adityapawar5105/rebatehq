// Review R2 (SECURITY_REVIEW.md R26): a chunk upload is retried, a chunk the server already holds counts as uploaded,
// and the "still uploading" window runs on the server's receive time and clock, not on either device's clock.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayDirectory, relayPage, relayPackPage } from "../lib/relay/store";
import { RelayError, type Grid } from "../lib/relay/protocol";
import { RelaySession, emptyRelay, NOT_READY_MS, putChunk } from "../lib/relay/session";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";
import type { ChunkStore } from "../lib/relay/http";

const store = (failures: string[]): ChunkStore & { puts: number } => {
  const s = { puts: 0, async put() { s.puts++; const f = failures.shift(); if (f) throw new RelayError(f, f); }, async get() { return new Uint8Array(); } };
  return s;
};

test("R26: a failed chunk upload is retried; an existing chunk counts as uploaded; access and size refusals are not retried", async () => {
  const signal = new AbortController().signal, body = new Uint8Array(40);
  const flaky = store(["NETWORK", "NETWORK"]); await putChunk(flaky, "p", body, signal, [0, 0]); assert.equal(flaky.puts, 3);
  const down = store(["NETWORK", "NETWORK", "NETWORK"]); await assert.rejects(putChunk(down, "p", body, signal, [0, 0]), (e: any) => e.code === "NETWORK"); assert.equal(down.puts, 3);
  const lost = store(["NETWORK", "EXISTS"]); await putChunk(lost, "p", body, signal, [0, 0]); assert.equal(lost.puts, 2, "a retry after a lost response finds the chunk there");
  for (const code of ["ACCESS", "LIMIT"]) { const s = store([code]); await assert.rejects(putChunk(s, "p", body, signal, [0, 0]), (e: any) => e.code === code); assert.equal(s.puts, 1); }
});

test("R26: a receiver whose clock is an hour ahead still sees a just-received version as 'not ready' while its chunks upload", async () => {
  const db = await testDatabase();
  try {
    const { actors } = await relayFixture(db), [owner, , rep] = actors, saved = new Map<string, any>(), objects = new Map<string, Uint8Array>();
    let hold = false; const held: [string, Uint8Array][] = [];
    const client = (p: typeof owner) => new RelaySession(p.actor, structuredClone(saved.get(p.actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, p.actor, () => relayDirectory(db, p.actor)),
      page: (after, epoch) => asRelay(db, p.actor, () => relayPage(db, p.actor, after, epoch)),
      // As the browser does since R26: ask for the server's receive times.
      packPage: (pack, after) => asRelay(db, p.actor, () => relayPackPage(db, p.actor, pack, after, true)),
      async post(value) { await asRelay(db, p.actor, () => relayPost(db, p.actor, value)); },
      chunks: {
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
    // The receiver's clock is an hour ahead of the publisher's: by its own clock the signed createdAt looks an hour old,
    // which the old window treated as a lost upload. (PGlite reads Date.now for its own clock, so only the session's
    // Date.now is moved, after the server rows exist; the store's "now" uses new Date(), which is not moved.)
    assert.ok(NOT_READY_MS < 60 * 60_000);
    const real = Date.now; Date.now = () => real() + 60 * 60_000;
    try { await assert.rejects(client(rep).packReceive("book"), (e: any) => e.code === "NOT_READY", "the server received it just now, so it is still uploading"); }
    finally { Date.now = real; }
    for (const [k, v] of held) objects.set(k, v);
    assert.deepEqual((await client(rep).packReceive("book"))?.steps.at(-1)?.data, book);
  } finally { await db.close(); }
});
