const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "restore-drill.yml"), "utf8");

test("role dump filter logs redacted diagnostics and restores only explicitly owned role statements", async () => {
  const { inspectAndFilterRolesDump } = await import("../scripts/filter-restore-roles.mjs");
  const dump = [
    ...Array.from({ length: 15 }, (_, index) => `-- filler ${index + 1}`),
    'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
    "SET default_transaction_read_only = off;",
    "SET client_encoding = 'UTF8';",
    "SET standard_conforming_strings = on;",
    "CREATE ROLE postgres WITH SUPERUSER LOGIN PASSWORD 'SCRAM-secret-value';",
    "ALTER ROLE postgres SET search_path TO 'public';",
    "ALTER ROLE postgres SET log_min_messages TO 'warning';",
    "CREATE ROLE anon WITH NOLOGIN;",
    "ALTER ROLE anon SET statement_timeout TO '3s';",
    "CREATE ROLE margindesk_app WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;",
    "ALTER ROLE margindesk_app NOINHERIT;",
    "GRANT supabase_admin TO postgres;",
    "GRANT supabase_admin TO margindesk_app;",
    "RESET ALL;",
  ].join("\n");
  const result = inspectAndFilterRolesDump(dump);
  assert.match(result.restoreSql, /CREATE ROLE margindesk_app/);
  assert.match(result.restoreSql, /ALTER ROLE margindesk_app NOINHERIT/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO margindesk_app/);
  assert.match(result.restoreSql, /SET default_transaction_read_only = off;/);
  assert.match(result.restoreSql, /SET client_encoding = 'UTF8';/);
  assert.match(result.restoreSql, /SET standard_conforming_strings = on;/);
  assert.match(result.restoreSql, /RESET ALL;/);
  assert.doesNotMatch(result.restoreSql, /CREATE ROLE postgres|CREATE ROLE anon/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO margindesk_app/);
  assert.equal(result.skipped.length, 7);
  assert.equal(result.retainedOwned.length, 2);
  assert.ok(result.retainedOwned.some(statement => statement.includes("ALTER ROLE margindesk_app")), "ALTER ROLE margindesk_app is retained.");
  assert.equal(result.retainedAppGrants.length, 1, "A grant involving margindesk_app must be retained rather than skipped.");
  assert.ok(result.skipped.some(item => item.statement.includes("GRANT SET ON PARAMETER") && item.reason.includes("supabase_realtime_admin")));
  assert.ok(result.diagnostics.some(line => line.includes("16:")), "line 16 and context must be logged");
  assert.ok(result.diagnostics.some(line => line.includes('16: GRANT SET ON PARAMETER "log_min_messages"')));
  assert.ok(result.diagnostics.some(line => line.includes("parameter=log_min_messages")));
  assert.ok(result.diagnostics.some(line => line.includes("role=postgres parameter=log_min_messages")));
  assert.doesNotMatch(result.diagnostics.join("\n"), /SCRAM-secret-value/);
  assert.ok(result.diagnostics.some(line => line.startsWith("SKIPPED [") && line.includes("GRANT SET ON PARAMETER")));
  assert.equal(result.retainedSession.length, 4);
});

test("role dump filter fails closed for any skipped role outside the explicit managed-role allowlist", async () => {
  const { inspectAndFilterRolesDump } = await import("../scripts/filter-restore-roles.mjs");
  const dump = [
    "CREATE ROLE margindesk_app WITH NOLOGIN;",
    "CREATE ROLE customer_custom_role WITH NOLOGIN;",
  ].join("\n");
  const result = inspectAndFilterRolesDump(dump);
  assert.match(result.errors.join("\n"), /outside the explicit owned\/managed role allowlists/);
});

test("parameter grants to margindesk_app, PUBLIC, or unknown roles fail; unknown session SET fails", async () => {
  const { inspectAndFilterRolesDump } = await import("../scripts/filter-restore-roles.mjs");
  const prefix = "CREATE ROLE margindesk_app WITH NOLOGIN;\n";
  for (const target of ["margindesk_app", "PUBLIC", "customer_unknown_role"]) {
    const result = inspectAndFilterRolesDump(`${prefix}GRANT SET ON PARAMETER \"log_min_messages\" TO ${target};`);
    assert.match(result.errors.join("\n"), /Parameter privilege grant is not allowlisted/);
  }
  const unknownSet = inspectAndFilterRolesDump(`${prefix}SET statement_timeout = '9s';`);
  assert.match(unknownSet.errors.join("\n"), /unallowlisted session setting/);

  const alterSystem = inspectAndFilterRolesDump(`${prefix}GRANT ALTER SYSTEM ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";`);
  assert.equal(alterSystem.errors.length, 0);
  assert.ok(alterSystem.skipped.some(item => item.statement.includes("GRANT ALTER SYSTEM ON PARAMETER")));
  const alterSystemToApp = inspectAndFilterRolesDump(`${prefix}GRANT ALTER SYSTEM ON PARAMETER "log_min_messages" TO "margindesk_app";`);
  assert.match(alterSystemToApp.errors.join("\n"), /Parameter privilege grant is not allowlisted/);
});

test("restore workflow filters roles, snapshots source before shutdown, and keeps post-restore steps strict", () => {
  const snapshotIndex = workflow.indexOf("verify-restore-equivalence.mjs --snapshot");
  const stopSourceIndex = workflow.indexOf("Stop and discard source stack before starting a fresh target");
  assert.ok(snapshotIndex >= 0 && stopSourceIndex > snapshotIndex, "Source ACL and row-count evidence must be captured before stopping it.");
  assert.match(workflow, /filter-restore-roles\.mjs/);
  assert.match(workflow, /--file=\/tmp\/margindesk-roles\.sql --file=\/tmp\/margindesk-schema\.sql/);
  assert.match(workflow, /--file \/restore\/margindesk-roles\.sql --file \/restore\/schema\.sql/);
  assert.match(workflow, /--set ON_ERROR_STOP=1/);
  assert.match(workflow, /verify-restore-equivalence\.mjs --compare/);
  assert.match(workflow, /pnpm check:restore-sentinel/);
  assert.match(workflow, /pnpm setup:test-db-role/);
  assert.match(workflow, /pnpm check:db-role/);
  assert.match(workflow, /pnpm test:db/);
  assert.match(workflow, /Stop and discard source stack before starting a fresh target \(local\)[\s\S]*?if: always\(\) && inputs\.target == 'local'/);
  assert.match(workflow, /Stop local target stack[\s\S]*?if: always\(\) && inputs\.target == 'local'/);
  assert.doesNotMatch(workflow, /supabase stop[^\n]*(?:\|\|\s*true|;\s*true)/);
});
