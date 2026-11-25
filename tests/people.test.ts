// Settings › Team and roles › People (25 Nov 2026): the server's members and invitations become plain props, the role
// pairs the signed-grid verifier refuses are caught at edit time, and roleList reports what each person receives.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamDirectory, roleConflict } from "../lib/team";
import { emptyRelay } from "../lib/relay/session";
import type { Grid } from "../lib/relay/protocol";
import { RECOMMENDED, COST_PACKS } from "../lib/sharing/catalog";
import { duckdbConnection } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION, ROLE_IDS } from "../lib/vault/schema";
import { VaultService } from "../lib/vault/service";

test("people: members and invitations become plain props with dates as text and unknown roles as rep", () => {
  const d = teamDirectory(
    [{ user_id: "u1", email: "a@example.invalid", role: "owner", status: "active", created_at: new Date("2026-01-02T03:04:05Z") }, { user_id: "u2", email: "b@example.invalid", role: "superuser", status: "suspended", created_at: "2026-02-01" }],
    [{ email: "c@example.invalid", role: "manager", expires_at: new Date("2026-03-01T00:00:00Z"), created_at: "2026-02-20" }], true);
  assert.deepEqual(d.members, [
    { userId: "u1", email: "a@example.invalid", role: "owner", status: "active", joinedAt: "2026-01-02T03:04:05.000Z" },
    { userId: "u2", email: "b@example.invalid", role: "rep", status: "suspended", joinedAt: "2026-02-01" }]);
  assert.deepEqual(d.invites, [{ email: "c@example.invalid", role: "manager", expiresAt: "2026-03-01T00:00:00.000Z", sentAt: "2026-02-20" }]);
  assert.equal(d.canInvite, true);
});

test("people: the pairs the S2 grid verifier refuses are caught when a role is chosen", () => {
  assert.equal(roleConflict("owner", false, "manager"), "people.needsOwner");
  assert.equal(roleConflict("owner", false, "owner"), null);
  for (const w of ["analyst", "rep"] as const) assert.equal(roleConflict("pricing_owner", false, w), "people.needsManager");
  assert.equal(roleConflict("pricing_owner", false, "manager"), null);
  assert.equal(roleConflict("sales_manager", true, "rep"), "people.needsManager", "the named Pricing Owner publishes whatever their role");
  for (const r of ["pricing_manager", "sales_manager", "sales_rep", "accountant", "admin"]) assert.equal(roleConflict(r, false, "rep"), null);
  assert.equal(roleConflict("owner", false, null), null, "no server data (the lab): nothing to compare");
});

test("people: /home passes members and invitations as props, only for a role that may read users; the vault page asks for nothing new", () => {
  const home = readFileSync("app/home/page.tsx", "utf8");
  assert.match(home, /can\(context\.role, "users\.read"\)/);
  assert.match(home, /FROM membership WHERE tenant_id=\$1/); assert.match(home, /FROM invite WHERE tenant_id=\$1 AND accepted_at IS NULL AND revoked_at IS NULL/);
  const view = readFileSync("components/local/PeopleView.tsx", "utf8") + readFileSync("components/local/RolesView.tsx", "utf8");
  assert.doesNotMatch(view, /fetch\(|\/api\//, "Team and roles makes no request of its own: writes to workspace access stay on the account Users page");
});

async function vault() {
  const c = await duckdbConnection();
  c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${t}`);
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

test("people: roleList says whether sharing is on, whether edits are a draft, and the built packs each person receives", async () => {
  const c = await vault();
  try {
    c.query("INSERT INTO role_assignments VALUES('boss','Boss','owner','boss','2025-01-01'),('raj','Raj','sales_rep','boss','2025-01-01'),('sam','Sam','sales_manager','boss','2025-01-01');INSERT INTO pricing_settings VALUES(1,'boss','Boss',7)");
    const boss = service(c, "boss");
    const off = await boss.roleList();
    assert.deepEqual(off.sharing, { joined: false, canSign: false, draft: false, receives: null }, "sharing off: nothing to show");
    const grid: Grid = { v: "1", namedOwner: "boss", people: [{ userId: "boss", role: "owner", extras: [] }, { userId: "raj", role: "sales_rep", extras: [] }, { userId: "sam", role: "sales_manager", extras: [] }],
      ticks: ROLE_IDS.map(r => [r, [...RECOMMENDED[r]]]) as Grid["ticks"] };
    c.query(`INSERT INTO relay_state VALUES(1,'${JSON.stringify({ ...emptyRelay(), epochs: [{ epoch: { v: "2", grid } }] }).replace(/'/g, "''")}')`);
    const on = await boss.roleList();
    assert.equal(on.sharing.joined, true); assert.equal(on.sharing.canSign, true); assert.equal(on.sharing.draft, false);
    const r = on.sharing.receives!;
    assert.ok(r.raj.includes("book") && !r.raj.some(p => COST_PACKS.includes(p as never)), "decision 16: a rep receives prices, never a cost pack");
    assert.ok(r.sam.includes("cost"), "a Sales Manager receives cost");
    assert.ok(Object.values(r).flat().every(p => ["items", "customers", "book", "contracts", "guards", "cost", "cost_floors"].includes(p)), "only packs that are built");
    // A rep's own vault sees only themselves and no receive list: it cannot manage roles.
    const raj = await service(c, "raj").roleList();
    assert.equal(raj.canManage, false); assert.equal(raj.sharing.receives, null); assert.equal(raj.sharing.canSign, false);
  } finally { c.close(); }
});
