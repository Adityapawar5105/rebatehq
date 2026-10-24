const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "tests", "phase1_rls.sql"), "utf8");

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
  assert.match(sql, /extensions\.plan\(32\)/, "The pgTAP plan must match the current checks.");
  assert.match(sql, /phase1_tenant_a_fixtures/, "Every application table must have a Tenant A fixture row.");
  assert.match(sql, /phase1_positive_select_result/, "Positive own-row SELECT controls must run as the app role.");
  assert.match(sql, /phase1_positive_insert_result/, "Positive INSERT controls must run wherever policy allows.");
  assert.match(sql, /position\('row-level security' in lower\(v_msg\)\)=0/, "Cross-tenant UPDATE/INSERT must distinguish RLS violations from table ACL denial.");
  assert.match(sql, /TRUNCATE public\.audit_log/, "The restricted role must attempt audit_log TRUNCATE.");
  assert.match(sql, /Statement-level trigger rejects audit_log TRUNCATE/, "Elevated-role TRUNCATE must be blocked by the statement trigger.");
  assert.match(sql, /has_table_privilege\('margindesk_app',[^\n]*'TRUNCATE'\)/, "The app role must be checked for TRUNCATE ACLs.");
});
