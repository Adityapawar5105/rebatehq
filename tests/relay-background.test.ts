// Team sharing S4: the background sync behind the doorbell. It runs only for an unlocked, writable, joined device; the
// 60-second poll is the path that guarantees delivery and the doorbell only makes it sooner; it never counts as the person
// being active and never surfaces an error.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyRelay } from "../lib/relay/session";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";

async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
  c.query(schemaSql(SCHEMA_VERSION));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count,pricing_revision) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0,0)`);
  return c;
}
function service(c: Awaited<ReturnType<typeof duckdbConnection>>, licence: Record<string, unknown>) {
  const s = new VaultService(() => undefined) as unknown as Record<string, any>;
  s.engine = { conn: { query: async (sql: string) => c.query(sql) } }; s.identity = { userId: "u", tenantId: "t" };
  s.licence = { tier: "professional", writable: true, claims: { device: "d" }, assert() {}, guard() {}, ...licence };
  const calls: string[] = [], quiet: boolean[] = [];
  s.relaySession = async () => { calls.push("session"); quiet.push(s.quiet); return { sync: async () => ({}), isPublisher: () => true, heldPacks: () => [] }; };
  s.mirrorGrid = async () => undefined; s.watchBell = () => undefined;
  return { s: s as any, calls, quiet };
}
const joined = (c: Awaited<ReturnType<typeof duckdbConnection>>) => c.query(`INSERT INTO relay_state VALUES(1,'${JSON.stringify({ ...emptyRelay(), identity: { device: { deviceId: "d" } }, epochs: [{ epoch: { id: "e1", v: "2" } }] }).replace(/'/g, "''")}')`);

test("S4 background sync: only an unlocked, writable, joined device syncs, on the poll or at once on a ring", async () => {
  const c = await vault();
  try {
    // Not joined: no network at all.
    let { s, calls } = service(c, {});
    assert.equal(await s.relayBackground(), false); assert.deepEqual(calls, []);
    joined(c);
    for (const licence of [{ writable: false }, { tier: "starter" }, { claims: null }]) {
      ({ s, calls } = service(c, licence));
      assert.equal(await s.relayBackground(true), false, JSON.stringify(licence)); assert.deepEqual(calls, []);
    }
    const run = service(c, {});
    await run.s.relayBackground(); assert.deepEqual(run.calls, ["session"], "the first poll syncs");
    await run.s.relayBackground(); assert.deepEqual(run.calls, ["session"], "within a minute the poll waits");
    await run.s.relayBackground(true); assert.deepEqual(run.calls, ["session", "session"], "a ring syncs at once");
    assert.deepEqual(run.quiet, [true, true], "background work never counts as the person being active");
    assert.equal(run.s.quiet, false);
    // A failing network is swallowed: the page never sees a background error.
    run.s.relaySession = async () => { throw new Error("offline"); };
    assert.equal(await run.s.relayBackground(true), false);
    // Locking stops it.
    run.s.engine = null; assert.equal(await run.s.relayBackground(true), false);
  } finally { c.close(); }
});

test("S4 wiring: the worker polls on its minute tick and debounces rings; the page refreshes; the socket is the only new traffic", () => {
  const worker = readFileSync("lib/vault/worker.ts", "utf8");
  assert.match(worker, /service\.onRelayRing\(/); assert.match(worker, /relayDue\(\);\},60_000\)/); assert.match(worker, /setTimeout\(\(\) => \{ ringTimer = null; relayDue\(true\); \}, 1500\)/);
  assert.match(readFileSync("components/local/VaultApp.tsx", "utf8"), /event\.event === "relay"/);
  const bell = readFileSync("lib/relay/doorbell.ts", "utf8");
  assert.match(bell, /transport: WebSocket/); assert.doesNotMatch(bell, /longPollFallbackMs\s*:/, "no long-poll fallback: no HTTP traffic from the doorbell");
  assert.match(bell, /config: \{ private: true/); assert.match(bell, /`pack:\$\{tenant\}:\$\{pack\}`/);
  assert.match(readFileSync("proxy.ts", "utf8"), /blob: \$\{connectOrigin\} \$\{socketOrigin\}/);
  const service = readFileSync("lib/vault/service.ts", "utf8");
  assert.match(service, /this\.stopBell\(\); this\.lastBackground = 0;/, "locking stops the doorbell");
});
