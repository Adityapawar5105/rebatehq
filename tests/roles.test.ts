// 5A roles: capabilities per role, and proof that the worker's command door refuses a role before any query runs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { duckdbConnection, rows as q } from "./helpers/duckdb-node";
import { schemaSql, tablesFor, ROLE_IDS } from "../lib/vault/schema";
import { ACTION_CAP, CAPS_ALL, ROLES, capsFor, intersect, sectionsFor, type Cap, type RoleId } from "../lib/roles/access";
import { accessFor, removeSql, setSql } from "../lib/roles/store";
import { VaultService } from "../lib/vault/service";
import { dispatch } from "../lib/vault/dispatch";
import { VaultError, type Request } from "../lib/vault/protocol";
import type { Engine } from "../lib/vault/engine";
const people: Record<string, RoleId> = { owner1: "owner", po: "pricing_owner", pm: "pricing_manager", sm: "sales_manager", rep: "sales_rep", acct: "accountant", adm: "admin" };
async function vault(repSeesCost = false) {
  const c = await duckdbConnection();
  for (const table of [...tablesFor(7)].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(7));
  c.query(`INSERT INTO vault_meta VALUES(1,7,'starter','unit','tip',0,0); INSERT INTO pricing_settings VALUES(1,'po','Pat Owner',7); INSERT INTO access_settings VALUES(1,${repSeesCost});
INSERT INTO role_assignments VALUES ${Object.entries(people).map(([id, role]) => `('${id}','${id}','${role}','owner1','2025-01-01')`).join(",")}`);
  return { c, e: { conn: c } as unknown as Engine };
}
function serviceFor(c: Awaited<ReturnType<typeof duckdbConnection>>, userId: string) {
  const s = new VaultService(() => undefined) as unknown as { engine: unknown; identity: unknown; viewAs: RoleId | null; accessCache: unknown; access: VaultService["access"]; guard: VaultService["guard"] };
  s.engine = { conn: c }; s.identity = { userId, tenantId: "t" }; return s;
}
const allowed = (caps: Cap[]) => (Object.keys(ACTION_CAP) as Array<keyof typeof ACTION_CAP>).filter(a => ACTION_CAP[a] === null || caps.includes(ACTION_CAP[a]!));
test("every role has the capabilities the blueprint gives it; reps never get cost by default", () => {
  assert.equal(ROLES.length, 7); assert.deepEqual(ROLES.map(r => r.id), [...ROLE_IDS]);
  const has = (role: RoleId, cap: Cap, named = false, rep = false) => capsFor(role, named, rep).includes(cap);
  for (const role of ROLE_IDS) assert.ok(has(role, "view") && has(role, "guards"), `${role} sees counts and price floors`);
  assert.deepEqual(capsFor("pricing_owner", false, false), CAPS_ALL); assert.ok(has("pricing_owner", "approve"));
  assert.ok(!has("owner", "approve")); assert.ok(has("owner", "approve", true)); // approval belongs to the named Pricing Owner
  assert.ok(has("owner", "cost") && has("owner", "roles") && has("owner", "backup") && has("owner", "data"));
  assert.ok(has("pricing_manager", "pricing") && has("pricing_manager", "export") && has("pricing_manager", "data") && !has("pricing_manager", "approve") && !has("pricing_manager", "roles"));
  assert.ok(has("sales_manager", "cost") && !has("sales_manager", "pricing") && !has("sales_manager", "data") && !has("sales_manager", "export"));
  assert.ok(!has("sales_rep", "cost"), "a rep never sees cost by default"); assert.ok(has("sales_rep", "cost", false, true), "unless the owner allows it");
  assert.ok(!has("sales_rep", "data") && !has("sales_rep", "pricing") && !has("sales_rep", "export") && !has("sales_rep", "approve") && !has("sales_rep", "roles"));
  assert.ok(!has("admin", "cost") && !has("admin", "pricing") && has("admin", "roles") && has("admin", "backup") && has("admin", "audit"));
  assert.ok(has("accountant", "cost") && has("accountant", "reconcile") && !has("accountant", "pricing") && !has("accountant", "data"));
  assert.deepEqual(sectionsFor(capsFor("sales_rep", false, false)), ["Home", "Pricing"]);
  assert.ok(!sectionsFor(capsFor("sales_rep", false, false)).includes("Margin"));
  assert.deepEqual(sectionsFor(capsFor("admin", false, false)), ["Home", "Pricing", "Reports", "Settings"]); // Reports holds the audit log for Admin / IT
  assert.deepEqual(intersect(capsFor("owner", false, false), capsFor("sales_rep", false, false)), ["view", "guards"]);
});
test("every command is classified, and the dispatcher handles exactly the classified commands", () => {
  const source = readFileSync(new URL("../lib/vault/dispatch.ts", import.meta.url), "utf8");
  const handled = [...source.matchAll(/case "([A-Za-z]+)":/g)].map(m => m[1]).sort();
  assert.deepEqual(handled, Object.keys(ACTION_CAP).filter(a => a !== "cancel").sort()); // `cancel` is answered by the worker itself
  const protocol = readFileSync(new URL("../lib/vault/protocol.ts", import.meta.url), "utf8");
  for (const action of Object.keys(ACTION_CAP)) assert.ok(new RegExp(`\\b${action}:`).test(protocol), `${action} is in the protocol`);
  // Every command that returns cost-derived numbers is behind the cost capability.
  for (const a of ["marginWaterfall", "marginDrill", "marginWhale", "marginMath", "leaks", "leakRows", "leakReport", "roi", "costBasis"] as const) assert.equal(ACTION_CAP[a], "cost", a);
  for (const a of ["ruleApprove"] as const) assert.equal(ACTION_CAP[a], "approve");
});
test("the worker refuses each role exactly what its capabilities exclude, before any query runs", async () => {
  const { c } = await vault();
  try {
    for (const [userId, role] of Object.entries(people)) {
      const s = serviceFor(c, userId), caps = capsFor(role, userId === "po", false);
      const access = await s.access();
      assert.equal(access.role, role); assert.deepEqual(access.caps, caps);
      for (const action of Object.keys(ACTION_CAP) as Array<keyof typeof ACTION_CAP>) {
        const cap = ACTION_CAP[action], ok = cap === null || caps.includes(cap);
        if (ok) { await s.guard(cap); continue; }
        await assert.rejects(s.guard(cap), (e: unknown) => e instanceof VaultError && e.code === "FORBIDDEN", `${role} must not run ${action}`);
        // Through the real dispatcher: it throws before touching the service methods (which would fail on this stub).
        await assert.rejects(dispatch(s as unknown as VaultService, { id: "1", action, data: {} } as unknown as Request, { signal: () => new AbortController().signal, progress: () => undefined }), (e: unknown) => e instanceof VaultError && e.code === "FORBIDDEN");
      }
    }
    const rep = allowed(capsFor("sales_rep", false, false));
    for (const cost of ["marginWaterfall", "marginDrill", "marginMath", "leaks", "leakReport", "roi", "costBasis", "ruleSimulate", "rulePreview", "cleanupApply", "studioAdd", "priceExport", "ruleApprove", "backupNow", "roleSet"]) assert.ok(!rep.includes(cost as never), `rep cannot ${cost}`);
    assert.ok(rep.includes("pricingState") && rep.includes("home") && rep.includes("status"));
  } finally { c.close(); }
});
test("the owner's switch gives reps cost, and nothing else; a preview can only remove capabilities", async () => {
  const { c } = await vault(true);
  try {
    const rep = await serviceFor(c, "rep").access();
    assert.ok(rep.caps.includes("cost") && rep.repSeesCost); assert.ok(!rep.caps.includes("data") && !rep.caps.includes("pricing"));
    c.query("UPDATE access_settings SET rep_sees_cost=false");
    const s = serviceFor(c, "owner1"); assert.ok((await s.access()).caps.includes("cost"));
    s.viewAs = "sales_rep"; s.accessCache = null; const view = await s.access();
    assert.equal(view.role, "sales_rep"); assert.equal(view.viewAs, "sales_rep"); assert.deepEqual(view.caps, ["view", "guards"]);
    await assert.rejects(s.guard("cost"), /cannot do this/); await s.guard(ACTION_CAP.rolePreview); // leaving a preview is always allowed
    const rep2 = serviceFor(c, "rep"); rep2.viewAs = "owner"; rep2.accessCache = null; // a rep "previewing" Owner gains nothing
    assert.deepEqual((await rep2.access()).caps, ["view", "guards"]);
  } finally { c.close(); }
});
test("an unassigned person is a Sales Rep; a vault with no roles at all belongs to whoever opens it", async () => {
  const { c, e } = await vault();
  try {
    assert.equal((await accessFor(e, "stranger", null)).role, "sales_rep"); assert.equal((await accessFor(e, "stranger", null)).assigned, false);
    c.query("DELETE FROM role_assignments");
    assert.equal((await accessFor(e, "stranger", null)).role, "owner"); // legacy vault, not yet seeded
  } finally { c.close(); }
});
test("role changes follow the rules: no self-edits, last Owner and named Pricing Owner are protected, only Owners grant Owner", async () => {
  const { c, e } = await vault();
  try {
    const owner = { userId: "owner1", role: "owner" as RoleId, namedOwner: false }, admin = { userId: "adm", role: "admin" as RoleId, namedOwner: false }, po = { userId: "po", role: "pricing_owner" as RoleId, namedOwner: true };
    await assert.rejects(setSql(e, owner, { userId: "owner1", name: "Me", role: "sales_rep" }, "t"), /own role/);
    await assert.rejects(setSql(e, admin, { userId: "rep", name: "Rae", role: "owner" }, "t"), /Only an Owner can grant/);
    await assert.rejects(setSql(e, admin, { userId: "owner1", name: "Olga", role: "sales_rep" }, "t"), /Only an Owner can change/);
    await assert.rejects(setSql(e, owner, { userId: "rep", name: "Rae", role: "wizard" as RoleId }, "t"), /seven roles/);
    await assert.rejects(setSql(e, owner, { userId: "bad id!", name: "Rae", role: "sales_rep" }, "t"), /sign-in ID/);
    await assert.rejects(setSql(e, owner, { userId: "po", name: "Pat", role: "sales_rep" }, "t"), /named Pricing Owner/);
    await assert.rejects(setSql(e, po, { userId: "owner1", name: "Olga", role: "sales_manager" }, "t"), /at least one Owner/); // the last Owner
    c.query((await setSql(e, owner, { userId: "newbie", name: "Nia", role: "sales_manager" }, "2025-02-01")).sql);
    assert.deepEqual(q(c, "SELECT role, display_name FROM role_assignments WHERE user_id='newbie'")[0], { role: "sales_manager", display_name: "Nia" });
    c.query((await setSql(e, owner, { userId: "newbie", name: "Nia", role: "owner" }, "2025-02-02")).sql); // a second Owner exists now
    c.query((await setSql(e, po, { userId: "owner1", name: "Olga", role: "pricing_manager" }, "2025-02-03")).sql);
    assert.equal(q(c, "SELECT role FROM role_assignments WHERE user_id='owner1'")[0].role, "pricing_manager");
    await assert.rejects(removeSql(e, { userId: "newbie" }, "newbie"), /own access/); await assert.rejects(removeSql(e, owner, "po"), /named Pricing Owner/);
    await assert.rejects(removeSql(e, owner, "ghost"), /no role/); await assert.rejects(removeSql(e, po, "newbie"), /at least one Owner/);
    c.query(await removeSql(e, owner, "rep")); assert.equal(q(c, "SELECT count(*) AS n FROM role_assignments WHERE user_id='rep'")[0].n, "0");
  } finally { c.close(); }
});
test("a vault cannot be created without naming a Pricing Owner", async () => {
  const service = { licenceGuard:()=>undefined, guard: async () => undefined, create: async () => { throw new Error("must not run"); } } as unknown as VaultService;
  for (const ownerName of ["", "   ", undefined as unknown as string]) await assert.rejects(dispatch(service, { id: "1", action: "create", data: { passphrase: "a long passphrase", tier: "starter", ownerName } } as Request, { signal: () => new AbortController().signal, progress: () => undefined }), (e: unknown) => e instanceof VaultError && e.code === "OWNER");
});
