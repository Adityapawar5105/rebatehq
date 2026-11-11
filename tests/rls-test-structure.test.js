const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "tests", "phase1_rls.sql"), "utf8");
const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202610240001_phase1_foundation.sql"), "utf8");
const aclMigration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202610250001_revoke_platform_public_privileges.sql"), "utf8");
const functionAclMigration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202610250002_revoke_platform_function_privileges.sql"), "utf8");
const registry = fs.readFileSync(path.join(__dirname, "..", "config", "function-acl-allowlist.sql"), "utf8");
const runner = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-db.ts"), "utf8");
const repeatability = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-db-repeatability.ts"), "utf8");
const rowCountHelpers = fs.readFileSync(path.join(__dirname, "..", "scripts", "tenant-row-counts.mjs"), "utf8");
const roleSetup = fs.readFileSync(path.join(__dirname, "..", "scripts", "setup-test-app-role.ts"), "utf8");

test("the restricted-role pgTAP checks capture results and run assertions after RESET ROLE", () => {
  const roleStart = sql.indexOf("SET LOCAL ROLE rebatehq_app;");
  const roleEnd = sql.indexOf("RESET ROLE;", roleStart);
  assert.ok(roleStart >= 0 && roleEnd > roleStart, "The app-role section must have a matching RESET ROLE.");

  const restrictedSection = sql.slice(roleStart, roleEnd);
  assert.doesNotMatch(restrictedSection, /\bextensions\./i, "The restricted role must not need pgTAP schema access.");
  assert.doesNotMatch(restrictedSection.replaceAll('pg_temp.use_identity','test_identity'), /\bpg_temp\b/i, 'Only the rollback-only signed identity helper may be invoked; no test-table data access');
  assert.match(restrictedSection, /app\.phase1_role_context/, "The effective role and role flags must be captured while the app role is active.");
  assert.match(restrictedSection, /app\.phase1_audit_app_result/, "Append-only errors must be captured while the app role is active.");

  const assertions = sql.slice(roleEnd);
  assert.match(assertions, /extensions\.ok\([\s\S]*phase1_role_context/, "The captured role assertion must run after RESET ROLE.");
  assert.match(assertions, /extensions\.is\([\s\S]*phase1_audit_app_result/, "The captured audit assertions must run after RESET ROLE.");
});

test("RLS fixtures prove tenant-positive paths, exact RLS write failures, and TRUNCATE protection", () => {
  assert.match(sql, /extensions\.plan\(169 \+ CASE WHEN current_setting\('app\.restore_test_mode',true\)='true' THEN 3 ELSE 0 END\)/, "Fresh runs plan 169 checks after 8D; restored-data runs add three restore-only checks.");
  assert.match(sql, /phase1_tenant_a_fixtures/, "Every application table must have a Tenant A fixture row.");
  assert.match(sql, /CREATE TEMP TABLE phase1_rls_fixture_keys/, "Fixture rows must be enumerated explicitly by table and generated primary key.");
  assert.match(sql, /replace\('__PHASE1_INVITE_A_ID__','-',''\)/, "Fixture invite tokens must be unique to generated fixture IDs.");
  assert.match(sql, /replace\(v_insert->>'id','-',''\)/, "Positive-control invite tokens must be unique to their generated row IDs.");
  assert.match(sql, /Expected exactly one suite-created Tenant A fixture row in public\.% keyed by %; found %/, "Missing or duplicate fixtures must name the table and key.");
  assert.match(sql, /Expected exactly one suite-created Tenant B fixture row in public\.% keyed by %; found %/, "Missing or duplicate fixtures must name the table and key.");
  assert.doesNotMatch(sql, /Tenant A fixture clone failed|regexp_replace\([^\n]*'2\$','3'|SELECT[\s\S]{0,100}WHERE tenant_id[^\n]*LIMIT 1/i, "Tenant A rows must not be cloned from arbitrary restored data.");
  assert.match(sql, /phase1_rls_fixture_keys[\s\S]*?\(4,'quote'[\s\S]*?\(5,'quote_line'[\s\S]*?\(6,'approval'[\s\S]*?\(7,'rebate_agreement'[\s\S]*?\(8,'rebate_progress'/, "Fixture keys must follow the quote dependency order.");
  assert.match(sql, /n<>expected_count THEN RAISE EXCEPTION 'Explicit fixture key list covers % tables/, "An uncovered tenant table must fail before any isolation loop.");
  assert.match(sql, /CREATE TEMP TABLE phase1_rls_tables[\s\S]*?SELECT c\.relname[\s\S]*?n\.nspname='public'/, "The isolation suite must enumerate every public application table, including new migrations.");
  assert.match(sql, /Tenant B fixture graph covers % tables; expected %/, "New tables without an explicit Tenant B fixture must fail before isolation checks.");
  assert.match(sql, /phase1_positive_select_result/, "Positive own-row SELECT controls must run as the app role.");
  assert.match(sql, /phase1_positive_insert_result/, "Positive INSERT controls must run wherever policy allows.");
  assert.match(sql, /position\('row-level security' in lower\(v_msg\)\)=0/, "Cross-tenant UPDATE/INSERT must distinguish RLS violations from table ACL denial.");
  assert.match(sql, /TRUNCATE public\.audit_log/, "The restricted role must attempt audit_log TRUNCATE.");
  assert.match(sql, /Statement-level trigger rejects audit_log TRUNCATE/, "Elevated-role TRUNCATE must be blocked by the statement trigger.");
  assert.match(sql, /has_table_privilege\('rebatehq_app',[^\n]*'TRUNCATE'\)/, "The app role must be checked for TRUNCATE ACLs.");
  assert.match(sql, /quote policy evaluates auth\.uid\(\).*without auth schema USAGE/i, "Policy evaluation must prove auth.uid works without schema USAGE.");
  assert.match(sql, /through the Supabase platform PUBLIC grant/i);
  assert.match(sql, /auth_uid_authenticated_policy_query/);
  assert.match(sql, /auth_uid_missing_context_policy_query/);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE)\b[^;]*\bauth\.uid\s*\(/i, "The migration/test must not try to manage Supabase-owned auth.uid ACLs.");
  assert.match(sql, /App role has no table privileges in auth schema/, "Auth schema access must not imply auth table access.");
  assert.match(sql, /Tenant A can UPDATE its own alert row/, "Allowed UPDATE requires a positive control.");
  assert.match(sql, /Tenant A can DELETE its own inserted alert row/, "Allowed DELETE requires a positive control.");
  assert.match(sql, /tenant rep can see an alert but cannot DELETE/, "A policy-forbidden role needs a DELETE denial control.");
  assert.match(sql, /record_failed_login always writes fixed auth\.login_failed with NULL tenant and actor/);
  assert.match(sql, /record_failed_login EXECUTE is revoked from PUBLIC, anon, and authenticated/);
  assert.match(sql, /All public SECURITY DEFINER EXECUTE ACLs match the owner\/app allowlist/);
  assert.match(sql, /INCLUDE FUNCTION ACL ALLOWLIST/, "The runner must load the single registry.");
  assert.match(runner, /loadDatabaseTestSql/);
  assert.match(registry, /listed_signature IS NULL/, "Unexpected functions must fail the registry check.");
  assert.match(registry, /expected_grantees IS DISTINCT FROM actual_grantees/, "Unexpected or missing grantees must fail the ACL check.");
  assert.match(sql, /public_security_definer_default_execute/, "Applicable default function grants must be printed for diagnosis.");
  assert.match(sql, /rebatehq_app has no role memberships that could supply hidden privileges/);
  assert.match(sql, /App role cannot directly insert a null-tenant/);
  assert.match(sql, /phase1_ci_diagnostic/);
  assert.match(sql, /public_security_definer_default_execute/);
  assert.match(sql, /rebatehq_app_memberships/);
  assert.match(sql, /No application table or column ACL grants any privilege to anon, authenticated, or PUBLIC/);
  assert.match(sql, /service_role application table privilege allowlist is empty/);
  assert.match(sql, /Public default privileges for application object owners grant nothing/);
  assert.match(sql, /'MAINTAIN'/, "All PostgreSQL 17 table privilege types must be considered for platform roles.");
  assert.match(sql, /has_column_privilege\('anon'/, "Inherited or effective column grants to anon must fail the ACL check.");
  assert.match(sql, /has_column_privilege\('service_role'/, "Inherited or effective column grants to service_role must fail the ACL check.");
  assert.match(sql, /anon has no effective CRUD table privileges/);
  assert.match(sql, /Every public function has a manifest entry and exactly its explicit EXECUTE grantee allowlist/);
  assert.match(sql, /Every public SECURITY DEFINER function is owned by the migration role and pins search_path/);
  assert.match(sql, /anon receives permission denied when calling every app-exposed function, independent of RLS/);
  assert.match(sql, /authenticated receives permission denied when calling every app-exposed function, independent of RLS/);
  assert.match(sql, /app\.phase1_anon_function_exec_result/);
  assert.match(sql, /app\.phase1_authenticated_function_exec_result/);
  assert.match(sql, /has_function_privilege\(current_user,p\.oid,'EXECUTE'\)/);
  assert.match(runner, /expectedFixturePlan = 169/);
  assert.match(runner, /restoreFixturePlan = 172/);
  assert.match(runner, /planned !== expectedPlan/);
  assert.match(runner, /all \$\{expectedPlan\} checks passing/);
  assert.match(runner, /materializeFixtureIds/);
  assert.match(runner, /assertFixtureIdsDoNotCollide/);
  assert.match(runner, /Legacy fixed-ID fixture\/sentinel diagnostic/);
  assert.match(runner, /RESTORE_BASELINE_PATH/);
  assert.match(runner, /phase1_restore_expected_tenant_counts/);
  assert.match(sql, /Restore-only: sentinel tenant and rebate agreement are present with the source content hash/);
  assert.match(sql, /Restore-only: every table\/tenant row count still matches the source baseline/);
  assert.match(sql, /Restore-only: synthetic Tenant A sees zero rows from the real restored sentinel tenant in every application table/);
  assert.match(sql, /phase1_restore_real_isolation_result/);
  assert.match(sql, /SELECT \* FROM extensions\.finish\(\);\s*ROLLBACK;/, "Fixture rows and settings must roll back after pgTAP finishes.");
  assert.doesNotMatch(sql, /ON CONFLICT/i, "Fixtures must not silently reuse incomplete pre-existing rows.");
  assert.doesNotMatch(sql, /(?:10000000|20000000|30000000|37000000)-0000-4000-8000-00000000000[123]/, "Historical fixed fixture UUIDs must not be embedded in the suite.");
  for (const [before, after] of [["INSERT INTO public.tenant", "INSERT INTO public.membership"], ["INSERT INTO public.membership", "INSERT INTO public.invite"], ["INSERT INTO public.invite", "INSERT INTO public.quote"], ["INSERT INTO public.quote(", "INSERT INTO public.approval"]]) {
    assert.ok(sql.indexOf(before) >= 0 && sql.indexOf(after) > sql.indexOf(before), `${before} must be seeded before ${after}.`);
  }
  assert.match(roleSetup, /quotedRoleGrant\(admin, "authenticated", testLogin, version\)/, "The disposable test login must be able to SET ROLE authenticated for the ACL probe.");
  assert.match(sql, /permission denied for table tenant/);
  assert.match(sql, /permission denied for table alert/);
  assert.match(aclMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM %s/);
  assert.match(aclMigration, /REVOKE %s \(%I\) ON TABLE public\.%I FROM %s/);
  assert.match(aclMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %s/);
  assert.doesNotMatch(aclMigration, /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[^;]*\b(?:anon|authenticated|service_role|PUBLIC)\b/i);
  assert.match(functionAclMigration, /n\.nspname='public' AND p\.proowner=v_migration_owner/);
  assert.match(functionAclMigration, /REVOKE ALL ON FUNCTION %s FROM %s/);
  assert.match(functionAclMigration, /GRANT EXECUTE ON FUNCTION %s TO %I/);
  assert.match(functionAclMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE EXECUTE ON FUNCTIONS FROM %s/);
  assert.doesNotMatch(functionAclMigration, /GRANT EXECUTE ON FUNCTION[^;]*\b(?:anon|authenticated|service_role|PUBLIC)\b/i);
  assert.doesNotMatch(sql, /SAVEPOINT auth_uid_execute_probe|ROLLBACK TO SAVEPOINT auth_uid_execute_probe/);
  assert.match(runner, /ran !== planned/);
  assert.match(runner, /Looks like you planned/);
});

test("database repeatability command runs the suite twice and proves no tenant rows remain", () => {
  assert.match(repeatability, /const before = await snapshotTenantRows\(pool\)/);
  assert.match(repeatability, /await runDatabaseSuite\(\)[\s\S]*?const afterFirst = await snapshotTenantRows\(pool\)/);
  assert.match(repeatability, /assertTenantRowCountsEqual\(before, afterFirst/);
  assert.match(repeatability, /await runDatabaseSuite\(\)[\s\S]*?const afterSecond = await snapshotTenantRows\(pool\)/);
  assert.match(repeatability, /assertTenantRowCountsEqual\(before, afterSecond/);
  assert.match(repeatability, /GROUP BY c\.relname\s+ORDER BY c\.relname/, "Tenant tables must be uniquely and deterministically sorted by name.");
  assert.match(repeatability, /tables\.rows\.length >= 24/);
  assert.match(rowCountHelpers, /public\.\$\{tableName\}/, "Count mismatch errors must identify the public table.");
});

test("auth function access stays minimal and failed-login audit writes use the definer function", () => {
  assert.doesNotMatch(migration, /GRANT\s+USAGE\s+ON\s+SCHEMA\s+auth\s+TO\s+rebatehq_app/i);
  assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE)\b[^;]*\bauth\.uid\s*\(/i);
  const auditInsertPolicy = migration.match(/CREATE POLICY audit_log_append[\s\S]*?;/i)?.[0] ?? "";
  assert.match(auditInsertPolicy, /FOR INSERT TO margindesk_app/i);
  assert.doesNotMatch(auditInsertPolicy, /tenant_id\s+IS\s+NULL/i);
});

test("table loops are guarded against empty fixtures and SQL errors include server context", () => {
  assert.doesNotMatch(sql, /\bc\s+record\b/i, "Avoid ambiguous/unassigned RECORD loop variables in test SQL.");
  assert.match(sql, /Explicit fixture graph needs at least 16 tenant tables/);
  assert.match(sql, /Tenant B fixture graph covers % tables; expected %/);
  assert.match(sql, /Tenant A fixture graph covers % tables; expected %/);
  assert.match(sql, /Tenant A positive SELECT loop expected at least 16 tables/);
  assert.match(sql, /Tenant B cross-SELECT loop expected at least 16 tables/);
  assert.match(sql, /positive INSERT loop expected at least 14 policy-allowed tables/);
  assert.match(sql, /Cross-tenant UPDATE loop expected at least 14 eligible tables/);
  assert.match(sql, /Cross-tenant DELETE loop expected at least 14 eligible tables/);
  assert.match(sql, /Cross-tenant INSERT loop expected at least 14 eligible tables/);
  for (const field of ["where", "routine", "position", "detail", "hint"]) {
    assert.match(runner, new RegExp(`pgError\\.${field}`), `Postgres error field ${field} should be emitted.`);
  }
  assert.match(runner, /REDACTED_DATABASE_URL/);
  assert.match(runner, /Policies whose stored expressions reference auth/);
  assert.match(runner, /Executable functions whose definitions\/reference touch auth/);
});
