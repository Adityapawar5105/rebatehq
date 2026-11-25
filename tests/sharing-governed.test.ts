// Team sharing S3 (SHARING_DESIGN.md section 6): on a receiving seat the worker refuses a write to data the publisher shares
// through the relay. Every write command must be classified, so a new one cannot slip past the rule unnoticed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIONS } from "../lib/roles/access";
import { GOVERNED, NOT_GOVERNED, IMPORT_PACKS } from "../lib/sharing/governed";
import { PACK_IDS } from "../lib/sharing/packs";
import { ROLES as FILE_KINDS } from "../lib/studio/formats";
import { emptyRelay } from "../lib/relay/session";
import type { Grid } from "../lib/relay/protocol";
import { RECOMMENDED } from "../lib/sharing/catalog";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, ROLE_IDS } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";

test("S3 read-only seats: every write command is classified once, with known packs and file kinds", () => {
  const writes = Object.entries(ACTIONS).filter(([, v]) => v.mode !== "read").map(([k]) => k);
  for (const a of writes) assert.ok((a in GOVERNED) !== (a in NOT_GOVERNED), `${a} must be in exactly one of GOVERNED or NOT_GOVERNED`);
  for (const a of [...Object.keys(GOVERNED), ...Object.keys(NOT_GOVERNED)]) assert.ok(writes.includes(a), `${a} is not a write command`);
  for (const rule of Object.values(GOVERNED)) if (Array.isArray(rule)) for (const p of rule) assert.ok((PACK_IDS as readonly string[]).includes(p), p);
  for (const [kind, packs] of Object.entries(IMPORT_PACKS)) { assert.ok((FILE_KINDS as readonly string[]).includes(kind), kind); for (const p of packs) assert.ok((PACK_IDS as readonly string[]).includes(p), p); }
  assert.ok(!("sales_history" in IMPORT_PACKS) && !("purchases" in IMPORT_PACKS), "these imports only add missing IDs, never overwrite a shared row");
  assert.match(readFileSync("lib/vault/dispatch.ts", "utf8"), /service\.licenceGuard\(request\.action\);\s*await service\.sharedGuard\(request\.action\);\s*const \{ progress \}/, "the guard runs before every command");
});

async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0)`);
  return c;
}
function service(c: Awaited<ReturnType<typeof duckdbConnection>>, userId: string, files: { role: string }[] = []) {
  const s = new VaultService(() => undefined) as unknown as Record<string, unknown>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId, tenantId: "t" };
  s.licence = { tier: "professional", assert() {}, guard() {}, view: () => null, claims: { tier: "professional" }, writable: true };
  s.studioState = async () => ({ files, report: null, recipes: [] });
  return s as unknown as VaultService;
}
const grid: Grid = { v: "1", namedOwner: "po", people: [{ userId: "boss", role: "owner", extras: [] }, { userId: "pm", role: "pricing_manager", extras: [] }, { userId: "po", role: "pricing_owner", extras: [] }],
  ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
const relay = (lastSyncedAt: string) => `INSERT INTO relay_state VALUES(1,'${JSON.stringify({ ...emptyRelay(), lastSyncedAt, epochs: [{ epoch: { v: "2", grid } }] }).replace(/'/g, "''")}')`;
const book = (pack: string, via: string) => `INSERT INTO shared_books VALUES('${pack}','3','po','Pat Owner','2026-11-20T00:00:00Z','2026-11-21T00:00:00Z','${via}',10,'h',NULL)`;
const refused = async (p: Promise<unknown>) => { try { await p; return false; } catch (e) { assert.equal((e as { code?: string }).code, "SHARE"); return true; } };

test("S3 read-only seats: a Pricing Manager cannot change shared guardrails, items or prices; publishers, file copies and other data can", async () => {
  const c = await vault();
  try {
    c.query(relay(new Date().toISOString())); c.query(book("guards", "relay")); c.query(book("items", "relay")); c.query(book("customers", "file"));
    const pm = service(c, "pm");
    assert.equal(await refused(pm.sharedGuard("guardSet")), true, "shared guardrails are read-only on a receiving seat");
    assert.equal(await refused(pm.sharedGuard("cleanupApply")), true, "item cleanup would edit shared items");
    assert.equal(await refused(pm.sharedGuard("playgroundLoad")), true, "sample data would overwrite shared rows");
    assert.equal(await refused(pm.sharedGuard("costBasisSet")), false, "cost is not shared here");
    assert.equal(await refused(pm.sharedGuard("quoteCreate")), false, "quotes are never governed");
    assert.equal(await refused(pm.sharedGuard("noteSet")), false, "own notes stay local and editable");
    // Imports: decided by the staged files' kinds.
    assert.equal(await refused(service(c, "pm", [{ role: "item_master" }]).sharedGuard("studioCommit")), true, "an item master import overwrites shared items");
    assert.equal(await refused(service(c, "pm", [{ role: "sales_history" }, { role: "purchases" }]).sharedGuard("studioCommit")), false, "sales and purchases only add missing IDs");
    assert.equal(await refused(service(c, "pm", [{ role: "customer_list" }]).sharedGuard("studioPlan")), false, "customers arrived by file, not the relay: the local owner may replace them");
    // A publisher under the signed grid (the named Pricing Owner, or the Owner) is never a receiving seat.
    for (const u of ["po", "boss"]) assert.equal(await refused(service(c, u).sharedGuard("guardSet")), false, u);
    // The message names the publisher and the pack.
    await assert.rejects(pm.sharedGuard("guardSet"), (e: Error) => /Pat Owner/.test(e.message));
  } finally { c.close(); }
});

test("S3 read-only seats: shareState marks a receiving seat and reports the last sync, so staleness is measured from it", async () => {
  const c = await vault();
  try {
    const synced = "2026-11-01T00:00:00Z";
    c.query(relay(synced)); c.query(book("book", "relay"));
    const s = await service(c, "pm").shareState();
    assert.equal(s.receiving, true); assert.equal(s.lastSyncedAt, synced);
    assert.equal((await service(c, "po").shareState()).receiving, false, "the publisher's own vault is not a receiving seat");
    const { daysSince, STALE_DAYS } = await import("../lib/sharing/stale");
    assert.equal(daysSince(synced, Date.parse("2026-11-09T00:00:00Z")), 8); assert.ok(8 > STALE_DAYS);
    assert.equal(daysSince(null), 0, "never synced: no staleness claim");
  } finally { c.close(); }
  const d = await vault();
  try {
    d.query(book("book", "file"));
    const s = await service(d, "pm").shareState();
    assert.equal(s.receiving, false, "without sharing, a hand-off file copy keeps S1 behaviour"); assert.equal(s.lastSyncedAt, null);
  } finally { d.close(); }
});
