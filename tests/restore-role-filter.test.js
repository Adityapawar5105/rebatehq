const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "restore-drill.yml"), "utf8");
const equivalence = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify-restore-equivalence.mjs"), "utf8");

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
    "CREATE ROLE rebatehq_app WITH NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;",
    "ALTER ROLE rebatehq_app NOINHERIT;",
    "GRANT supabase_admin TO postgres;",
    "GRANT supabase_admin TO rebatehq_app;",
    "RESET ALL;",
  ].join("\n");
  const result = inspectAndFilterRolesDump(dump);
  assert.match(result.restoreSql, /CREATE ROLE rebatehq_app/);
  assert.match(result.restoreSql, /ALTER ROLE rebatehq_app NOINHERIT/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO rebatehq_app/);
  assert.match(result.restoreSql, /SET default_transaction_read_only = off;/);
  assert.match(result.restoreSql, /SET client_encoding = 'UTF8';/);
  assert.match(result.restoreSql, /SET standard_conforming_strings = on;/);
  assert.match(result.restoreSql, /RESET ALL;/);
  assert.doesNotMatch(result.restoreSql, /CREATE ROLE postgres|CREATE ROLE anon/);
  assert.match(result.restoreSql, /GRANT supabase_admin TO rebatehq_app/);
  assert.equal(result.skipped.length, 7);
  assert.equal(result.retainedOwned.length, 2);
  assert.ok(result.retainedOwned.some(statement => statement.includes("ALTER ROLE rebatehq_app")), "ALTER ROLE rebatehq_app is retained.");
  assert.equal(result.retainedAppGrants.length, 1, "A grant involving rebatehq_app must be retained rather than skipped.");
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
    "CREATE ROLE rebatehq_app WITH NOLOGIN;",
    "CREATE ROLE customer_custom_role WITH NOLOGIN;",
  ].join("\n");
  const result = inspectAndFilterRolesDump(dump);
  assert.match(result.errors.join("\n"), /outside the explicit owned\/managed role allowlists/);
});

test("parameter grants to rebatehq_app, PUBLIC, or unknown roles fail; unknown session SET fails", async () => {
  const { inspectAndFilterRolesDump } = await import("../scripts/filter-restore-roles.mjs");
  const prefix = "CREATE ROLE rebatehq_app WITH NOLOGIN;\n";
  for (const target of ["rebatehq_app", "PUBLIC", "customer_unknown_role"]) {
    const result = inspectAndFilterRolesDump(`${prefix}GRANT SET ON PARAMETER \"log_min_messages\" TO ${target};`);
    assert.match(result.errors.join("\n"), /Parameter privilege grant is not allowlisted/);
  }
  const unknownSet = inspectAndFilterRolesDump(`${prefix}SET statement_timeout = '9s';`);
  assert.match(unknownSet.errors.join("\n"), /unallowlisted session setting/);

  const alterSystem = inspectAndFilterRolesDump(`${prefix}GRANT ALTER SYSTEM ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";`);
  assert.equal(alterSystem.errors.length, 0);
  assert.ok(alterSystem.skipped.some(item => item.statement.includes("GRANT ALTER SYSTEM ON PARAMETER")));
  const alterSystemToApp = inspectAndFilterRolesDump(`${prefix}GRANT ALTER SYSTEM ON PARAMETER "log_min_messages" TO "rebatehq_app";`);
  assert.match(alterSystemToApp.errors.join("\n"), /Parameter privilege grant is not allowlisted/);
});

test("restore workflow filters roles, snapshots source before shutdown, and keeps post-restore steps strict", () => {
  const snapshotIndex = workflow.indexOf("verify-restore-equivalence.mjs --snapshot");
  const stopSourceIndex = workflow.indexOf("Stop and discard source stack before starting a fresh target");
  const seedIndex = workflow.indexOf("Seed a sentinel in the disposable source database");
  const dumpIndex = workflow.indexOf("Dump source roles, schema, and data");
  assert.ok(snapshotIndex >= 0 && stopSourceIndex > snapshotIndex, "Source ACL and row-count evidence must be captured before stopping it.");
  assert.ok(seedIndex >= 0 && seedIndex < dumpIndex, "The sentinel must be seeded before the dump.");
  assert.doesNotMatch(workflow, /supabase\/migrations\/|application-function-acl-migration|application-acl-migration|Apply current application ACL migrations/, "Restore must never replay historical migrations on source or target.");
  assert.match(workflow, /cp scripts\/restore-platform-acl-cleanup\.sql/);
  assert.match(workflow, /--file=\/tmp\/restore-platform-acl-cleanup\.sql/);
  assert.match(workflow, /--file \/restore\/restore-platform-acl-cleanup\.sql/);
  assert.match(workflow, /inspect-restore-function-acls\.mjs --order/);
  for (const stage of ["source","after-schema","after-cleanup","after-data"]) {
    assert.match(workflow, new RegExp(`inspect-restore-function-acls\\.mjs ${stage} `));
  }
  assert.match(workflow, /filter-restore-roles\.mjs/);
  assert.match(workflow, /restore-dump-scope\.mjs/);
  assert.match(workflow, /--data-only --use-copy --schema "\$schema_allowlist"/);
  assert.match(workflow, /inspect-restore-dump\.mjs/);
  assert.match(workflow, /Restore owned roles and application schema \(local\)/);
  assert.match(workflow, /Restore owned roles and application schema \(hosted\)/);
  const extensionIndex = workflow.indexOf("Install and verify required range-constraint extension");
  const schemaRestoreIndex = workflow.indexOf("Restore owned roles and application schema (local)");
  assert.ok(extensionIndex >= 0 && extensionIndex < schemaRestoreIndex, "btree_gist must be present before restoring its public exclusion constraints.");
  assert.match(workflow, /CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions/);
  assert.match(workflow, /Remove target platform ACL additions \(local\)/);
  assert.match(workflow, /Remove target platform ACL additions \(hosted\)/);
  assert.match(workflow, /prepare-restore-auth-users\.mjs/);
  assert.match(workflow, /Restore application data \(local\)/);
  assert.match(workflow, /Restore application data \(hosted\)/);
  assert.match(workflow, /--set ON_ERROR_STOP=1/);
  assert.match(workflow, /verify-restore-equivalence\.mjs --compare/);
  assert.match(workflow, /--file=\/tmp\/rebatehq-roles\.sql --file=\/tmp\/rebatehq-schema\.sql/);
  assert.match(workflow, /--file \/restore\/rebatehq-roles\.sql --file \/restore\/schema\.sql/);
  assert.ok(workflow.indexOf("prepare-restore-auth-users.mjs") < workflow.indexOf("Restore application data (local)"), "Referenced auth users must exist before public data restore.");
  assert.ok(workflow.indexOf("prepare-restore-auth-users.mjs") < workflow.indexOf("Restore application data (hosted)"), "Referenced auth users must exist before public data restore.");
  assert.ok(workflow.indexOf("Remove target platform ACL additions (local)") < workflow.indexOf("Restore application data (local)"), "Platform defaults must be cleaned before data restore.");
  assert.ok(workflow.indexOf("Remove target platform ACL additions (hosted)") < workflow.indexOf("Restore application data (hosted)"), "Platform defaults must be cleaned before data restore.");
  assert.match(workflow, /Remove target platform ACL additions \(local\)[\s\S]*?client_min_messages=warning[\s\S]*?ON_ERROR_STOP=1[\s\S]*?no privileges \(were granted\|could be revoked\|were revoked\)/);
  assert.match(workflow, /Remove target platform ACL additions \(hosted\)[\s\S]*?client_min_messages=warning[\s\S]*?ON_ERROR_STOP=1[\s\S]*?no privileges \(were granted\|could be revoked\|were revoked\)/);
  const checkpointIndexes = ["source","after-schema","after-cleanup","after-data"].map(stage => workflow.indexOf(`inspect-restore-function-acls.mjs ${stage} `));
  assert.ok(checkpointIndexes.every((index,i) => index >= 0 && (i === 0 || index > checkpointIndexes[i-1])), "Function ACL checkpoints must run in source/schema/cleanup/data order.");
  assert.ok(checkpointIndexes[0] < stopSourceIndex);
  assert.ok(checkpointIndexes[1] > workflow.indexOf("Restore owned roles and application schema (hosted)"));
  assert.ok(checkpointIndexes[1] < workflow.indexOf("Remove target platform ACL additions (local)"));
  assert.ok(checkpointIndexes[2] > workflow.indexOf("Remove target platform ACL additions (hosted)"));
  assert.ok(checkpointIndexes[2] < workflow.indexOf("Restore application data (local)"));
  assert.ok(checkpointIndexes[3] > workflow.indexOf("Restore application data (hosted)"));
  assert.ok(checkpointIndexes[3] < workflow.indexOf("verify-restore-equivalence.mjs --compare"));
  assert.match(workflow, /pnpm check:restore-sentinel/);
  assert.match(equivalence, /md5\(jsonb_build_object\([\s\S]*?created_at_utc[\s\S]*?content_hash/);
  assert.match(equivalence, /restore sentinel identity and content hash/);
  assert.match(workflow, /pnpm setup:test-db-role/);
  assert.match(workflow, /pnpm check:db-role/);
  assert.match(workflow, /Re-run full RLS and append-only suite against restored database[\s\S]*?RESTORE_TEST_MODE: "true"[\s\S]*?RESTORE_BASELINE_PATH: \$\{\{ runner\.temp \}\}\/rebatehq-dump\/source-equivalence\.json[\s\S]*?pnpm test:db:repeat/);
  assert.match(workflow, /Stop and discard source stack before starting a fresh target \(local\)[\s\S]*?if: always\(\) && inputs\.target == 'local'/);
  assert.match(workflow, /Stop local target stack[\s\S]*?if: always\(\) && inputs\.target == 'local'/);
  assert.doesNotMatch(workflow, /supabase stop[^\n]*(?:\|\|\s*true|;\s*true)/);
});

test("restore dump schema builder permits only owned schemas and rejects a storage-inclusive dump", async () => {
  const { APPLICATION_SCHEMAS, EXCLUDED_SUPABASE_SCHEMAS, assertMigrationsFitApplicationSchemas, buildApplicationDumpArgs } = await import("../scripts/restore-dump-scope.mjs");
  assert.deepEqual(APPLICATION_SCHEMAS, ["public", "rebatehq_private"]);
  assert.ok(EXCLUDED_SUPABASE_SCHEMAS.includes("storage"));
  assert.ok(assertMigrationsFitApplicationSchemas() >= 1, "All current SQL migrations must fit the reviewed application schema scope.");
  assert.deepEqual(buildApplicationDumpArgs(), ["--schema", "public,rebatehq_private"]);
  assert.throws(() => buildApplicationDumpArgs(["public", "storage"]), /only the application schema allowlist/);
  assert.throws(() => buildApplicationDumpArgs(["public", "auth"]), /only the application schema allowlist/);
});

test("restore dump inspection parses application tables and redacts COPY payload near line 448", async () => {
  const { parseDumpTableNames, redactDataDumpContext, assertApplicationTableMinimum } = await import("../scripts/inspect-restore-dump.mjs");
  const schema = "CREATE TABLE public.alpha (id uuid);\nCREATE TABLE public.beta (id uuid);";
  const data = "COPY public.alpha (id) FROM stdin;\nsecret-user-row\n\\.\nCOPY public.beta (id) FROM stdin;\nother-secret\n\\.";
  assert.deepEqual(parseDumpTableNames(schema, "schema"), [
    { schema: "public", table: "alpha" },
    { schema: "public", table: "beta" },
  ]);
  assert.deepEqual(parseDumpTableNames(data, "data"), [
    { schema: "public", table: "alpha" },
    { schema: "public", table: "beta" },
  ]);
  const context = redactDataDumpContext(data, 2, 1);
  assert.match(context.lines.join("\n"), /\[COPY DATA REDACTED\]/);
  assert.doesNotMatch(context.lines.join("\n"), /secret-user-row|other-secret/);
  const tenantTables = Array.from({ length: 24 }, (_, index) => ({ schema: "public", table: `tenant_table_${index}` }));
  assert.equal(assertApplicationTableMinimum(tenantTables), 24);
  assert.throws(() => assertApplicationTableMinimum(tenantTables.slice(0, 23)), /expected at least 24 after Chunk 7A/);
});
