const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "restore-drill.yml"), "utf8");

test("role dump filter logs redacted diagnostics and restores only explicitly owned role statements", async () => {
  const { inspectAndFilterRolesDump } = await import("../scripts/filter-restore-roles.mjs");
  const dump = [
    ...Array.from({ length: 15 }, (_, index) => `-- filler ${index + 1}`),
    "-- role dump header",
    "CREATE ROLE postgres WITH SUPERUSER LOGIN PASSWORD 'SCRAM-secret-value';",
    "ALTER ROLE postgres SET search_path TO 'public';",
    "ALTER ROLE postgres SET log_min_messages TO 'warning';",
    "CREATE ROLE anon WITH NOLOGIN;",
    "ALTER ROLE anon SET statement_timeout TO '3s';",
    "CREATE ROLE margindesk_app WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;",
    "ALTER ROLE margindesk_app NOINHERIT;",
    "GRANT supabase_admin TO postgres;",
    "GRANT supabase_admin TO margindesk_app;",
  ].join("\n");
  const result = inspectAndFilterRolesDump(dump);
  assert.match(result.restoreSql, /CREATE ROLE margindesk_app/);
  assert.match(result.restoreSql, /ALTER ROLE margindesk_app NOINHERIT/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO margindesk_app/);
  assert.doesNotMatch(result.restoreSql, /CREATE ROLE postgres|CREATE ROLE anon/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO margindesk_app/);
  assert.equal(result.skipped.length, 6);
  assert.ok(result.diagnostics.some(line => line.includes("16:")), "line 16 and context must be logged");
  assert.ok(result.diagnostics.some(line => line.includes("parameter=log_min_messages")));
  assert.ok(result.diagnostics.some(line => line.includes("role=postgres parameter=log_min_messages")));
  assert.doesNotMatch(result.diagnostics.join("\n"), /SCRAM-secret-value/);
  assert.ok(result.diagnostics.some(line => line.startsWith("SKIPPED:")));
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
});
