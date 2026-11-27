// Review R2, the rest (migration 20261129120000_review_r2_relay_quotas.sql): a device that does not publish under the
// signed grid may send 20 events a minute; a publisher keeps 60. The real server trigger runs here (PGlite), through
// the same session code the vault worker uses. pgTAP checks the daily cap and the device-key count in CI.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayPage, relayDirectory } from "../lib/relay/store";
import { RelaySession, emptyRelay, type RelayState } from "../lib/relay/session";
import type { Grid, Post } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";
import type { RoleId } from "../lib/roles/access";

const ticks = () => ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"];
const gridOf = (people: Record<string, RoleId>) => (users: string[], previous: Grid | null): Grid =>
  previous ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: people[u] ?? "sales_rep", extras: [] })), ticks: ticks() };

test("review R2: a rep device is held to 20 relay events a minute, the Owner's device is not", async () => {
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
    const v = await client(a).view(), root = await client(a).rotate(v.devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint })), gridOf(people));
    await client(b).join(root.fingerprint); await client(c).join(root.fingerprint);

    const rep = c, owner = a;
    await client(rep).threadOpen({ type: "item", ref: ["P1"], label: "Ball valve" }, "first", [], null);
    const thread = client(rep).threads().threads[0]!.id;
    for (let i = 2; i <= 20; i++) await client(rep).threadReply(thread, `reply ${i}`, []);
    await assert.rejects(client(rep).threadReply(thread, "the 21st this minute", []), "a rep device sent a 21st event in one minute");
    const repEvents = (await db.query("SELECT count(*)::int AS n FROM public.relay_event WHERE sender_device=$1::uuid", [rep.actor.deviceId])).rows[0].n;
    assert.equal(repEvents, 20, "exactly 20 rep events were stored");

    // The Owner publishes under the grid: 25 events in the same minute are all accepted.
    for (let i = 1; i <= 25; i++) await client(owner).threadReply(thread, `owner ${i}`, []);
    const ownerEvents = (await db.query("SELECT count(*)::int AS n FROM public.relay_event WHERE sender_device=$1::uuid", [owner.actor.deviceId])).rows[0].n;
    assert.equal(ownerEvents, 25);
  } finally { await db.close(); }
});

test("review R2 (R25): the sharing panel warns from 50 devices, against the protocol's 60-device limit", async () => {
  const { RELAY_LIMITS } = await import("../lib/relay/protocol");
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("components/local/RelayPanel.tsx", "utf8");
  assert.match(panel, new RegExp(`const DEVICE_LIMIT = ${RELAY_LIMITS.devices}, DEVICE_WARN = 50;`));
  assert.match(panel, /data-testid="relay-device-limit"/);
});
