// Review R2 (flaw 3.6): a new device could not join after a Pricing Owner rotated, because a joiner with no earlier epoch
// required the newest epoch's signer to be a grid Owner. It now walks the chain from the newest Owner-signed epoch.
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

test("review R2: a device joins after a Pricing Owner rotation, from the Owner fingerprint the Pricing Owner's screen shows", async () => {
  const db = await testDatabase();
  try {
    const fixture = await relayFixture(db), [a, b, c] = fixture.actors, saved = new Map<string, RelayState>();
    const client = (actor: { tenantId: string; userId: string; deviceId: string }) => new RelaySession(actor, structuredClone(saved.get(actor.deviceId) ?? emptyRelay()), {
      directory: () => asRelay(db, actor, () => relayDirectory(db, actor)),
      page: (after, epoch) => asRelay(db, actor, () => relayPage(db, actor, after, epoch)),
      async post(value: Post) { await asRelay(db, actor, () => relayPost(db, actor, value)); },
    }, async v => { saved.set(actor.deviceId, structuredClone(v)); }, new AbortController().signal);
    for (const p of [a, b, c]) await client(p.actor).register();
    const people: Record<string, RoleId> = { [a.actor.userId]: "owner", [b.actor.userId]: "pricing_owner", [c.actor.userId]: "sales_rep" };
    const grid = (users: string[], previous: Grid | null): Grid => previous ?? { v: "1", namedOwner: null, people: users.map(u => ({ userId: u, role: people[u], extras: [] })), ticks: ticks() };
    const confirm = async (who: typeof a.actor) => (await client(who).view()).devices.map(d => ({ deviceId: d.deviceId, fingerprint: d.fingerprint }));
    const root = await client(a.actor).rotate(await confirm(a.actor), grid);
    await client(b.actor).join(root.fingerprint); await client(c.actor).join(root.fingerprint);
    // The rep signs in on a second device; the Pricing Owner approves it with a rotation (no grid change).
    const second = { tenantId: fixture.tenantId, userId: c.actor.userId, deviceId: crypto.randomUUID() };
    await db.query("INSERT INTO public.licence_device(id,tenant_id,user_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,'active')", [second.deviceId, second.tenantId, second.userId]); await db.query("UPDATE public.licence_device SET status='active' WHERE id=$1::uuid", [second.deviceId]); // the Owner approves it
    await client(second).register();
    const rotated = await client(b.actor).rotate(await confirm(b.actor), grid);
    assert.equal(rotated.administratorFingerprint, root.fingerprint, "the fingerprint to give a joiner stays the Owner's");
    const joined = await client(second).join(rotated.administratorFingerprint);
    assert.equal(joined.joined, true);
    assert.deepEqual([...joined.packs].sort(), [...RECOMMENDED.sales_rep].sort(), "the second device holds exactly the rep's packs");
    // A fingerprint nobody signed with is still refused.
    const third = { tenantId: fixture.tenantId, userId: c.actor.userId, deviceId: crypto.randomUUID() };
    await db.query("INSERT INTO public.licence_device(id,tenant_id,user_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,'active')", [third.deviceId, third.tenantId, third.userId]); await db.query("UPDATE public.licence_device SET status='active' WHERE id=$1::uuid", [third.deviceId]);
    await client(third).register(); await client(b.actor).rotate(await confirm(b.actor), grid);
    await assert.rejects(client(third).join("a".repeat(64)), (e: any) => e?.code === "VERIFY");
  } finally { await db.close(); }
});
