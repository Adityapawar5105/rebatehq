const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "tests", "phase1_rls.sql"), "utf8");
const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "202610240001_phase1_foundation.sql"), "utf8");
const runner = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-db.ts"), "utf8");

test("the restricted-role pgTAP checks capture results and run assertions after RESET ROLE", () => {
  const roleStart = sql.indexOf("SET LOCAL ROLE margindesk_app;");
  const roleEnd = sql.indexOf("RESET ROLE;", roleStart);
  assert.ok(roleStart >= 0 && roleEnd > roleStart, "The app-role section must have a matching RESET ROLE.");

  const restrictedSection = sql.slice(roleStart, roleEnd);
  assert.doesNotMatch(restrictedSection, /\bextensions\./i, "The restricted role must not need pgTAP schema access.");
  assert.doesNotMatch(restrictedSection, /\bpg_temp\b/i, "The restricted role must not need temporary-table schema access.");
  assert.match(restrictedSection, /app\.phase1_role_context/, "The effective role and role flags must be captured while the app role is active.");
  assert.match(restrictedSection, /app\.phase1_audit_app_result/, "Append-only errors must be captured while the app role is active.");

  const assertions = sql.slice(roleEnd);
  assert.match(assertions, /extensions\.ok\([\s\S]*phase1_role_context/, "The captured role assertion must run after RESET ROLE.");
  assert.match(assertions, /extensions\.is\([\s\S]*phase1_audit_app_result/, "The captured audit assertions must run after RESET ROLE.");
});

test("RLS fixtures prove tenant-positive paths, exact RLS write failures, and TRUNCATE protection", () => {
  assert.match(sql, /extensions\.plan\(45\)/, "The pgTAP plan must match the current checks.");
  assert.match(sql, /phase1_tenant_a_fixtures/, "Every application table must have a Tenant A fixture row.");
  assert.match(sql, /phase1_positive_select_result/, "Positive own-row SELECT controls must run as the app role.");
  assert.match(sql, /phase1_positive_insert_result/, "Positive INSERT controls must run wherever policy allows.");
  assert.match(sql, /position\('row-level security' in lower\(v_msg\)\)=0/, "Cross-tenant UPDATE/INSERT must distinguish RLS violations from table ACL denial.");
  assert.match(sql, /TRUNCATE public\.audit_log/, "The restricted role must attempt audit_log TRUNCATE.");
  assert.match(sql, /Statement-level trigger rejects audit_log TRUNCATE/, "Elevated-role TRUNCATE must be blocked by the statement trigger.");
  assert.match(sql, /has_table_privilege\('margindesk_app',[^\n]*'TRUNCATE'\)/, "The app role must be checked for TRUNCATE ACLs.");
  assert.match(sql, /customer policy evaluates auth\.uid\(\).*without auth schema USAGE/i, "Policy evaluation must prove auth.uid works without schema USAGE.");
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION auth\.uid\(\) FROM margindesk_app/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION auth\.uid\(\) FROM PUBLIC/);
  assert.match(sql, /App role has no table privileges in auth schema/, "Auth schema access must not imply auth table access.");
  assert.match(sql, /Tenant A can UPDATE its own customer row/, "Allowed UPDATE requires a positive control.");
  assert.match(sql, /Tenant A can DELETE its own inserted customer row/, "Allowed DELETE requires a positive control.");
  assert.match(sql, /tenant rep can see a product but cannot DELETE/, "A policy-forbidden role needs a DELETE denial control.");
  assert.match(sql, /record_failed_login always writes fixed auth\.login_failed with NULL tenant and actor/);
  assert.match(sql, /record_failed_login EXECUTE is revoked from PUBLIC, anon, and authenticated/);
  assert.match(sql, /record_failed_login EXECUTE is limited to its owner and margindesk_app/);
  assert.match(sql, /margindesk_app has no role memberships that could supply hidden privileges/);
  assert.match(sql, /App role cannot directly insert a null-tenant/);
  assert.match(sql, /phase1_ci_diagnostic/);
  assert.match(sql, /auth_function_default_execute_privileges/);
  assert.match(sql, /margindesk_app_memberships/);
  assert.doesNotMatch(sql, /SAVEPOINT auth_uid_execute_probe|ROLLBACK TO SAVEPOINT auth_uid_execute_probe/);
  assert.match(runner, /ran !== planned/);
  assert.match(runner, /Looks like you planned/);
});

test("auth function access stays minimal and failed-login audit writes use the definer function", () => {
  assert.doesNotMatch(migration, /GRANT\s+USAGE\s+ON\s+SCHEMA\s+auth\s+TO\s+margindesk_app/i);
  assert.match(migration, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+auth\.uid\(\)\s+TO\s+margindesk_app/i);
  const auditInsertPolicy = migration.match(/CREATE POLICY audit_log_append[\s\S]*?;/i)?.[0] ?? "";
  assert.match(auditInsertPolicy, /FOR INSERT TO margindesk_app/i);
  assert.doesNotMatch(auditInsertPolicy, /tenant_id\s+IS\s+NULL/i);
});

test("table loops are guarded against empty fixtures and SQL errors include server context", () => {
  assert.doesNotMatch(sql, /\bc\s+record\b/i, "Avoid ambiguous/unassigned RECORD loop variables in test SQL.");
  assert.match(sql, /Expected at least 24 tenant tables before fixture loop/);
  assert.match(sql, /Tenant B fixture loop covered % tables/);
  assert.match(sql, /Tenant A fixture loop covered % tables/);
  assert.match(sql, /Tenant A positive SELECT loop expected at least 24 tables/);
  assert.match(sql, /Tenant B cross-SELECT loop expected at least 24 tables/);
  assert.match(sql, /positive INSERT loop expected at least 22 policy-allowed tables/);
  assert.match(sql, /Cross-tenant UPDATE loop expected at least 22 eligible tables/);
  assert.match(sql, /Cross-tenant DELETE loop expected at least 22 eligible tables/);
  assert.match(sql, /Cross-tenant INSERT loop expected at least 22 eligible tables/);
  for (const field of ["where", "routine", "position", "detail", "hint"]) {
    assert.match(runner, new RegExp(`pgError\\.${field}`), `Postgres error field ${field} should be emitted.`);
  }
  assert.match(runner, /REDACTED_DATABASE_URL/);
  assert.match(runner, /Policies whose stored expressions reference auth/);
  assert.match(runner, /Executable functions whose definitions\/reference touch auth/);
});
