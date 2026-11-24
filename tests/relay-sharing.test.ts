// Team sharing S2a (SHARING_DESIGN.md sections 3.3, 4 and 7; blueprint section 22, item 38): epoch format 2 with the
// Owner-signed grid and pack keys, signed pack versions, and the sharing migration in PGlite with real keys.
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./helpers/database";
import { relayFixture, asRelay } from "./helpers/relay-fixtures";
import { relayPost, relayDirectory, relayPage, relayPackPage } from "../lib/relay/store";
import { newEpoch, verifyEpoch, unwrapPacks, epochBody, signValue, sha, fingerprint, expectedPackWraps, encryptPackVersion, verifyPackVersion, decryptPackVersion, generateIdentity, type Identity } from "../lib/relay/crypto";
import { ZERO_HASH, EpochSchema, type Epoch, type EpochV2, type Grid, type DirectoryDevice, type Manifest } from "../lib/relay/protocol";
import { ALL_PACKS, COST_PACKS, COST_ROLES, RECOMMENDED, VAULT_ROLES, packsFor } from "../lib/sharing/catalog";
import { ROLE_IDS } from "../lib/vault/schema";
import { capsFor, ROLES, type RoleId } from "../lib/roles/access";

const MARK = "PACK-PRIVATE-MARKER";
const manifest: Manifest = { kind: "manifest", rows: "3", contentHash: "a".repeat(64), chunks: [{ n: "0", bytes: "100", sha256: "b".repeat(64) }] };
function gridFor(people: { userId: string; role: RoleId; extras?: string[] }[], named: string | null = null, ticks = RECOMMENDED): Grid {
  return { v: "1", namedOwner: named, people: [...people].sort((a, b) => a.userId < b.userId ? -1 : 1).map(p => ({ userId: p.userId, role: p.role, extras: (p.extras ?? []) as Grid["people"][number]["extras"] })),
    ticks: ROLES.map(r => [r.id, [...ticks[r.id]]]) as Grid["ticks"] };
}
const dir = (i: Identity, role: "owner" | "manager" | "rep" | "analyst"): DirectoryDevice => ({ ...i.device, role });
async function resign(owner: Identity, e: EpochV2): Promise<EpochV2> {
  const out = { ...e, signature: "", hash: "" };
  out.signature = await signValue(owner.signingPrivate, epochBody(out)); out.hash = await sha([epochBody(out), out.signature]);
  return EpochSchema.parse(out) as EpochV2;
}
async function team() {
  const tenant = crypto.randomUUID(), make = () => generateIdentity(tenant, crypto.randomUUID(), crypto.randomUUID());
  const [owner, po, sm, rep] = await Promise.all([make(), make(), make(), make()]);
  const roster = [dir(owner, "owner"), dir(po, "manager"), dir(sm, "manager"), dir(rep, "rep")].sort((a, b) => a.deviceId < b.deviceId ? -1 : 1);
  const grid = gridFor([{ userId: owner.device.userId, role: "owner" }, { userId: po.device.userId, role: "pricing_owner" }, { userId: sm.device.userId, role: "sales_manager" }, { userId: rep.device.userId, role: "sales_rep" }]);
  return { tenant, owner, po, sm, rep, roster, grid };
}

test("S2 catalog: the cost lock comes from the cost capability; publishers get every pack; the recommended ticks never tick a lock", () => {
  assert.deepEqual([...VAULT_ROLES], [...ROLE_IDS], "the catalogue's role list is the vault's");
  assert.deepEqual([...COST_ROLES], ROLE_IDS.filter(r => capsFor(r, false).includes("cost")), "the catalogue's cost roles are exactly the roles with the cost capability");
  for (const r of ROLES) {
    const cost = capsFor(r.id, false).includes("cost"), got = packsFor(r.id, false, RECOMMENDED);
    if (!cost) assert.deepEqual(got.filter(p => COST_PACKS.includes(p)), [], `${r.id} must never get a cost pack`);
    assert.deepEqual([...RECOMMENDED[r.id]].filter(p => !cost && COST_PACKS.includes(p)), [], `${r.id}: the recommended preset ticks a locked cell`);
  }
  assert.deepEqual(packsFor("sales_rep", true, RECOMMENDED), [...ALL_PACKS], "the named Pricing Owner publishes, whatever their role");
  assert.deepEqual(packsFor("sales_rep", false, RECOMMENDED, ["cost", "competitors"]), ["items", "customers", "book", "contracts", "guards", "documents"], "an extra cost pack for a rep is dropped");
  assert.deepEqual(packsFor("sales_manager", false, RECOMMENDED), ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors", "documents", "results"]);
});

test("S2 epoch format 2: each device unwraps only its entitled packs; a rep device holds no cost pack key", async () => {
  const { owner, po, sm, rep, roster, grid } = await team();
  const { epoch, packKeys } = await newEpoch(owner, roster, null, { sequence: "0", hash: ZERO_HASH }, grid);
  assert.equal(epoch.v, "2"); assert.equal(Object.keys(packKeys).length, ALL_PACKS.length);
  const verified = await verifyEpoch(epoch, null, await fingerprint(owner.device));
  assert.equal((epoch as EpochV2).packWraps.length, expectedPackWraps(grid, epoch.members).length);
  assert.deepEqual(Object.keys(await unwrapPacks(owner, verified)), [...ALL_PACKS]);
  assert.deepEqual(Object.keys(await unwrapPacks(po, verified)), [...ALL_PACKS]);
  assert.deepEqual(Object.keys(await unwrapPacks(sm, verified)), ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors", "documents", "results"]);
  const repKeys = await unwrapPacks(rep, verified);
  assert.deepEqual(Object.keys(repKeys), ["items", "customers", "book", "contracts", "guards", "documents"]);
  assert.ok(!(epoch as EpochV2).packWraps.some(w => w.deviceId === rep.device.deviceId && COST_PACKS.includes(w.pack)), "no cost wrap exists for the rep device at all");
  assert.equal(repKeys.book, packKeys.book, "the same pack key reaches every entitled device");
});

test("S2 verifiers refuse a grid that ticks cost for a rep, extra or missing wraps, a non-publisher signer, a grid edit by a non-Owner and a downgrade", async () => {
  const { owner, po, sm, rep, roster, grid } = await team(), head = { sequence: "0", hash: ZERO_HASH }, pin = await fingerprint(owner.device);
  const { epoch } = await newEpoch(owner, roster, null, head, grid), e = epoch as EpochV2;
  // A grid that ticks cost for Sales Reps, re-signed by the Owner: refused even though the signature is valid.
  const costForReps = await resign(owner, { ...e, grid: { ...e.grid, ticks: e.grid.ticks.map(([r, p]) => [r, r === "sales_rep" ? [...ALL_PACKS] : p]) as Grid["ticks"] } });
  await assert.rejects(verifyEpoch(costForReps, null, pin));
  const costExtra = await resign(owner, { ...e, grid: { ...e.grid, people: e.grid.people.map(p => p.userId === rep.device.userId ? { ...p, extras: ["cost"] } : p) as Grid["people"] } });
  await assert.rejects(verifyEpoch(costExtra, null, pin), "an extra cost pack for a rep is refused, not trimmed");
  const repCostWrap = e.packWraps.find(w => w.pack === "cost")!;
  await assert.rejects(verifyEpoch(await resign(owner, { ...e, packWraps: [...e.packWraps, { ...repCostWrap, id: crypto.randomUUID(), deviceId: rep.device.deviceId }] }), null, pin), "an extra wrap");
  await assert.rejects(verifyEpoch(await resign(owner, { ...e, packWraps: e.packWraps.slice(1) }), null, pin), "a missing wrap");
  // A Sales Manager is a server manager (may sign 7A epochs) but not a publisher under the grid.
  const bySm = await newEpoch(sm, roster, null, head, grid);
  await assert.rejects(verifyEpoch(bySm.epoch, null, await fingerprint(sm.device)));
  // The Pricing Owner may rotate keys, but only an Owner changes the grid.
  const verified = await verifyEpoch(epoch, null, pin), next = { sequence: "0", hash: ZERO_HASH };
  await verifyEpoch((await newEpoch(po, roster, verified, next, grid)).epoch, verified);
  const changed = gridFor(grid.people.map(p => ({ ...p, extras: p.userId === sm.device.userId ? ["competitors"] : [] })));
  await assert.rejects(verifyEpoch((await newEpoch(po, roster, verified, next, changed)).epoch, verified), "the Pricing Owner cannot change the grid");
  await verifyEpoch((await newEpoch(owner, roster, verified, next, changed)).epoch, verified);
  await assert.rejects(verifyEpoch((await newEpoch(owner, roster, verified, next)).epoch, verified), "no downgrade to keys without a grid");
  await assert.rejects(newEpoch(owner, roster, null, head, gridFor([{ userId: owner.device.userId, role: "owner" }])), "every member must be in the role table");
});

test("S2 pack versions: only a publisher holding the pack signs one; the chain is per pack; the manifest opens only with the pack key", async () => {
  const { owner, sm, rep, roster, grid } = await team();
  const { epoch, packKeys } = await newEpoch(owner, roster, null, { sequence: "0", hash: ZERO_HASH }, grid);
  const v1 = await encryptPackVersion(owner, epoch, packKeys.cost!, { version: "0", hash: ZERO_HASH }, "cost", "snapshot", "0", manifest);
  await verifyPackVersion(v1, epoch, { version: "0", hash: ZERO_HASH });
  assert.deepEqual(await decryptPackVersion(v1, packKeys.cost!), manifest);
  await assert.rejects(decryptPackVersion(v1, packKeys.book!), "another pack's key opens nothing");
  await assert.rejects(verifyPackVersion(v1, epoch, { version: "1", hash: v1.hash }), "a replay is refused");
  const smKeys = await unwrapPacks(sm, epoch);
  await assert.rejects(encryptPackVersion(sm, epoch, smKeys.cost!, { version: "1", hash: v1.hash }, "cost", "delta", "1", manifest), "a Sales Manager reads cost but does not publish");
  const delta = await encryptPackVersion(owner, epoch, packKeys.cost!, { version: "1", hash: v1.hash }, "cost", "delta", "1", manifest);
  await verifyPackVersion(delta, epoch, { version: "1", hash: v1.hash });
  assert.ok(!Object.keys(await unwrapPacks(rep, epoch)).includes("cost"));
});

test("S2 migration in PGlite: format 2 epochs round-trip; a rep cannot select a cost pack's rows or head; only publishers append; audit is metadata only", async () => {
  const db = await testDatabase();
  try {
    const { tenantId, actors } = await relayFixture(db), [owner, manager, rep] = actors;
    for (const a of actors) await asRelay(db, a.actor, () => relayPost(db, a.actor, { action: "register", device: a.identity.device }));
    const d = await asRelay(db, owner.actor, () => relayDirectory(db, owner.actor));
    const grid = gridFor([{ userId: owner.actor.userId, role: "owner" }, { userId: manager.actor.userId, role: "sales_manager" }, { userId: rep.actor.userId, role: "sales_rep" }]);
    const { epoch, packKeys } = await newEpoch(owner.identity, d.devices, null, d.head, grid);
    await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "epoch", epoch }));
    await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "epoch", epoch }));
    const page = await asRelay(db, rep.actor, () => relayPage(db, rep.actor, "0", "0"));
    assert.equal(page.epochs[0].v, "2");
    const seen = await verifyEpoch(page.epochs[0], null, await fingerprint(owner.identity.device)) as Epoch;
    assert.deepEqual(Object.keys(await unwrapPacks(rep.identity, seen)), ["items", "customers", "book", "contracts", "guards", "documents"]);
    // The Owner publishes a cost pack and a book pack.
    const cost = await encryptPackVersion(owner.identity, epoch, packKeys.cost!, { version: "0", hash: ZERO_HASH }, "cost", "snapshot", "0", { ...manifest, contentHash: "c".repeat(64) });
    const book = await encryptPackVersion(owner.identity, epoch, packKeys.book!, { version: "0", hash: ZERO_HASH }, "book", "snapshot", "0", manifest);
    for (const p of [cost, book]) { await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "pack", pack: p })); await asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "pack", pack: p })); }
    const repCost = await asRelay(db, rep.actor, () => relayPackPage(db, rep.actor, "cost", "0"));
    assert.deepEqual(repCost, { versions: [], head: { version: "0", hash: ZERO_HASH } }, "decision 16: no cost row and no cost head for the rep");
    const raw = await asRelay<{ rows: unknown[] }>(db, rep.actor, () => db.query("SELECT * FROM public.relay_pack_version WHERE tenant_id=$1::uuid AND pack='cost'", [tenantId]));
    assert.equal(raw.rows.length, 0, "row-level security hides cost pack rows from the rep");
    assert.equal((await asRelay(db, rep.actor, () => relayPackPage(db, rep.actor, "book", "0"))).versions.length, 1);
    const smCost = await asRelay(db, manager.actor, () => relayPackPage(db, manager.actor, "cost", "0"));
    assert.equal(smCost.versions.length, 1); await verifyPackVersion(smCost.versions[0], seen, { version: "0", hash: ZERO_HASH });
    // A Sales Manager holds the cost key but is not a publisher: the store and the database both refuse.
    const smKeys = await unwrapPacks(manager.identity, seen);
    const forged = await encryptPackVersion(owner.identity, epoch, packKeys.book!, { version: "1", hash: book.hash }, "book", "delta", "1", manifest);
    await assert.rejects(asRelay(db, manager.actor, () => relayPost(db, manager.actor, { action: "pack", pack: forged })), "someone else's version");
    assert.ok(smKeys.cost);
    await assert.rejects(asRelay(db, manager.actor, () => db.query(`INSERT INTO public.relay_pack_version(id,tenant_id,epoch_id,pack,version,previous_hash,kind,base_version,sender_user,sender_device,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
      VALUES(gen_random_uuid(),$1::uuid,$2::uuid,'book',2,decode($3,'hex'),'delta',1,$4::uuid,$5::uuid,decode(repeat('11',12),'hex'),decode(repeat('22',40),'hex'),40,decode(repeat('33',64),'hex'),decode(repeat('44',32),'hex'),now())`,
      [tenantId, epoch.id, book.hash, manager.actor.userId, manager.actor.deviceId])), /invalid pack publisher/);
    // No step back to keys without a grid.
    const d2 = await asRelay(db, owner.actor, () => relayDirectory(db, owner.actor));
    const v1 = await newEpoch(owner.identity, d2.devices, seen, d2.head);
    await assert.rejects(asRelay(db, owner.actor, () => relayPost(db, owner.actor, { action: "epoch", epoch: v1.epoch })));
    // Metadata-only audit, and no marker anywhere.
    const audit = await db.query("SELECT entity_type,before,after FROM public.audit_log WHERE entity_type IN ('relay_pack_wrap','relay_pack_version') AND tenant_id=$1::uuid", [tenantId]);
    assert.ok(audit.rows.length >= 3);
    for (const row of audit.rows) { assert.equal(row.before, null); assert.deepEqual(Object.keys(row.after).sort(), ["id", "tenant_id"]); }
    for (const t of ["relay_epoch", "relay_pack_wrap", "relay_pack_version"]) assert.ok(!JSON.stringify((await db.query(`SELECT * FROM public.${t} WHERE tenant_id=$1::uuid`, [tenantId])).rows).includes(MARK));
    assert.ok(!JSON.stringify((await db.query("SELECT grid FROM public.relay_epoch WHERE tenant_id=$1::uuid", [tenantId])).rows).match(/_cents|amount|"price"/), "the grid holds roles and pack names only");
  } finally { await db.close(); }
});

test("S2 signed roles match server membership: a grid Owner is a workspace owner, publishers are owners or managers, and the first grid comes from an Owner", async () => {
  const { owner, po, sm, rep, roster, grid } = await team(), head = { sequence: "0", hash: ZERO_HASH };
  const asOwner = (u: string) => gridFor(grid.people.map(p => ({ ...p, role: p.userId === u ? "owner" as RoleId : p.role })));
  // The rep (server role rep) claimed as an Owner, and as the named Pricing Owner: both refused.
  const pin = await fingerprint(owner.device);
  await verifyEpoch((await newEpoch(owner, roster, null, head, grid)).epoch, null, pin); // the control: the same grid with true roles verifies
  await assert.rejects(verifyEpoch((await newEpoch(owner, roster, null, head, asOwner(rep.device.userId))).epoch, null, pin), "a server rep cannot be a grid Owner");
  await assert.rejects(verifyEpoch((await newEpoch(owner, roster, null, head, gridFor(grid.people, rep.device.userId))).epoch, null, pin), "a server rep cannot be the named Pricing Owner");
  // The Pricing Owner may not sign the first grid; the Owner may.
  await assert.rejects(verifyEpoch((await newEpoch(po, roster, null, head, grid)).epoch, null, await fingerprint(po.device)));
  await verifyEpoch((await newEpoch(owner, roster, null, head, grid)).epoch, null, pin);
  void sm;
});

test("S2 migration refuses a grid that does not match membership (a manager claimed as Owner)", async () => {
  const db = await testDatabase();
  try {
    const { actors } = await relayFixture(db), [owner, manager] = actors;
    for (const a of actors) await asRelay(db, a.actor, () => relayPost(db, a.actor, { action: "register", device: a.identity.device }));
    const d = await asRelay(db, owner.actor, () => relayDirectory(db, owner.actor));
    // Signed by the manager's device, with the manager listed as an Owner: the client check is skipped by posting directly.
    const bad = gridFor([{ userId: owner.actor.userId, role: "owner" }, { userId: manager.actor.userId, role: "owner" }, { userId: actors[2].actor.userId, role: "sales_rep" }]);
    const { epoch } = await newEpoch(manager.identity, d.devices, null, d.head, bad);
    await assert.rejects(asRelay(db, manager.actor, () => db.query(`INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at,format,grid)
      VALUES($1::uuid,$2::uuid,1,decode(repeat('00',32),'hex'),0,decode(repeat('00',32),'hex'),$3::uuid,$4::uuid,$5::uuid[],$6::text[],decode(repeat('11',64),'hex'),decode(repeat('22',32),'hex'),now(),2,$7::jsonb)`,
      [epoch.id, owner.actor.tenantId, manager.actor.userId, manager.actor.deviceId, epoch.members.map(m => m.deviceId), epoch.members.map(m => m.role), JSON.stringify(bad)])), /does not match membership/);
  } finally { await db.close(); }
});
