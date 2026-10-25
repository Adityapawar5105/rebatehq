import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

export const RESTORE_OWNED_ROLES = new Set(["margindesk_app"]);
export const SUPABASE_MANAGED_ROLES = new Set([
  "anon", "authenticated", "authenticator", "dashboard_user", "postgres", "pgbouncer", "service_role",
  "supabase_admin", "supabase_auth_admin", "supabase_etl_admin", "supabase_functions_admin",
  "supabase_graphql_admin", "supabase_pooler_admin", "supabase_read_only_user", "supabase_realtime_admin",
  "supabase_replication_admin", "supabase_storage_admin",
  "pg_checkpoint", "pg_create_subscription", "pg_database_owner", "pg_execute_server_program",
  "pg_maintain", "pg_monitor", "pg_read_all_data", "pg_read_all_settings", "pg_read_all_stats",
  "pg_read_server_files", "pg_signal_backend", "pg_stat_scan_tables", "pg_use_reserved_connections",
  "pg_write_all_data", "pg_write_server_files",
]);
const ALLOWED_SESSION_STATEMENTS = new Set([
  "SET CLIENT_ENCODING = 'UTF8';",
  "SET STANDARD_CONFORMING_STRINGS = ON;",
  "SET DEFAULT_TRANSACTION_READ_ONLY = OFF;",
  "RESET ALL;",
]);

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let single = false;
  let double = false;
  let lineComment = false;
  let blockComment = 0;
  let dollarTag = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "/" && next === "*") { blockComment += 1; i += 1; }
      else if (char === "*" && next === "/") { blockComment -= 1; i += 1; }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; dollarTag = null; }
      continue;
    }
    if (single) {
      if (char === "'" && next === "'") i += 1;
      else if (char === "'") single = false;
      continue;
    }
    if (double) {
      if (char === '"' && next === '"') i += 1;
      else if (char === '"') double = false;
      continue;
    }
    if (char === "-" && next === "-") { lineComment = true; i += 1; continue; }
    if (char === "/" && next === "*") { blockComment = 1; i += 1; continue; }
    if (char === "'") { single = true; continue; }
    if (char === '"') { double = true; continue; }
    if (char === "$" ) {
      const match = /^\$[a-zA-Z0-9_]*\$/.exec(sql.slice(i));
      if (match) { dollarTag = match[0]; i += dollarTag.length - 1; continue; }
    }
    if (char === ";") {
      const statement = sql.slice(start, i + 1).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing.replace(/(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/g, "").trim()) {
    throw new Error(`Unterminated SQL statement in roles dump: ${redact(trailing)}`);
  }
  return statements;
}

function unquoteIdentifier(value) {
  return value.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
}

function redact(statement) {
  return statement
    .replace(/\b(password|identified\s+by)\s+(?:'[^']*'|\S+)/gi, "$1 [REDACTED]")
    .replace(/\b(set\s+[a-z0-9_.]*(?:password|secret|token|credential|private_key)[a-z0-9_.]*\s+to\s+)(?:'[^']*'|\S+)/gi, "$1[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s'";]+/gi, "[REDACTED_DATABASE_URL]");
}

function identifierAfter(sql, keyword) {
  const match = new RegExp(`^${keyword}\\s+("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)`, "i").exec(sql);
  return match ? unquoteIdentifier(match[1]) : null;
}

function roleList(text) {
  return text.split(",").map(part => {
    const match = /^\s*("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)/.exec(part);
    return match ? unquoteIdentifier(match[1]) : null;
  });
}

export function inspectAndFilterRolesDump(sql) {
  const lines = sql.split(/\r\n|\n|\r/);
  const lineStart = Math.min(lines.length || 1, Math.max(1, 16 - 5));
  const lineEnd = Math.min(lines.length, 16 + 5);
  const diagnostics = [`roles.sql lines ${lineStart}-${lineEnd} (secrets redacted):`];
  for (let line = lineStart; line <= lineEnd; line += 1) diagnostics.push(`${line}: ${redact(lines[line - 1])}`);

  const statements = splitSqlStatements(sql);
  const setStatements = statements.filter(statement => /^\s*ALTER\s+ROLE\b[\s\S]*?\bSET\b/i.test(statement));
  diagnostics.push("ALTER ROLE ... SET statements (role, parameter, redacted statement):");
  if (!setStatements.length) diagnostics.push("(none)");
  for (const statement of setStatements) {
    const clean = statement.replace(/--[^\n]*/g, " ").trim();
    const role = identifierAfter(clean, "ALTER\\s+ROLE");
    const setting = /\bSET\s+([a-zA-Z_][a-zA-Z0-9_.]*)\b/i.exec(clean)?.[1] ?? "<unparsed>";
    diagnostics.push(`role=${role ?? "<unparsed>"} parameter=${setting}: ${redact(statement)}`);
  }

  const restore = [];
  const retainedOwned = [];
  const retainedAppGrants = [];
  const retainedSession = [];
  const skipped = [];
  const errors = [];
  for (const statement of statements) {
    const clean = statement.replace(/--[^\n]*/g, " ").trim();
    if (!clean) continue;
    const canonical = clean.replace(/\s+/g, " ").toUpperCase();
    if (ALLOWED_SESSION_STATEMENTS.has(canonical)) {
      restore.push(statement);
      retainedSession.push(redact(statement));
      continue;
    }
    if (/^(?:SET|RESET)\b/i.test(clean)) {
      errors.push(`Role dump contains an unallowlisted session setting: ${redact(statement)}`);
      continue;
    }
    let role = null;
    let keep = false;
    let referencedRoles = [];
    let skipReason = "";
    if (/^CREATE\s+ROLE\b/i.test(clean)) {
      role = identifierAfter(clean, "CREATE\\s+ROLE");
      referencedRoles = role ? [role] : [];
      keep = role !== null && RESTORE_OWNED_ROLES.has(role);
    } else if (/^ALTER\s+ROLE\b/i.test(clean)) {
      role = identifierAfter(clean, "ALTER\\s+ROLE");
      referencedRoles = role ? [role] : [];
      keep = role !== null && RESTORE_OWNED_ROLES.has(role);
    } else if (/^GRANT\s+(?:SET|ALTER\s+SYSTEM)\s+ON\s+PARAMETER\b/i.test(clean)) {
      const match = /^GRANT\s+(SET|ALTER\s+SYSTEM)\s+ON\s+PARAMETER\s+("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)\s+TO\s+("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*|PUBLIC)\s*;$/i.exec(clean);
      const parameter = match?.[2] ? unquoteIdentifier(match[2]) : null;
      const grantee = match?.[3] ? unquoteIdentifier(match[3]) : null;
      if (!match || !grantee || grantee.toLowerCase() === "public" || RESTORE_OWNED_ROLES.has(grantee) || !SUPABASE_MANAGED_ROLES.has(grantee)) {
        errors.push(`Parameter privilege grant is not allowlisted for a Supabase-managed role: ${redact(statement)}`);
        continue;
      }
      skipReason = `Supabase-managed parameter privilege ${match[1]} on ${parameter} for existing platform role ${grantee}`;
    } else if (/^(?:GRANT|REVOKE)\b/i.test(clean)) {
      const match = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+(TO|FROM)\s+([\s\S]+?)(?:\s+(?:WITH|GRANTED|GRANTOR)\b[\s\S]*)?;$/i.exec(clean);
      if (match) {
        const granted = roleList(match[2]);
        const grantees = roleList(match[4]);
        referencedRoles = [...granted, ...grantees];
        if (referencedRoles.includes("margindesk_app")) {
          if (referencedRoles.some(name => name === null || (!RESTORE_OWNED_ROLES.has(name) && !SUPABASE_MANAGED_ROLES.has(name)))) {
            errors.push(`Membership statement involving an owned role references a role outside the explicit allowlists: ${redact(statement)}`);
            continue;
          }
          keep = true;
        }
      }
    }
    if (keep) {
      restore.push(statement);
      if (role && RESTORE_OWNED_ROLES.has(role)) retainedOwned.push(redact(statement));
      if (/^(?:GRANT|REVOKE)\b/i.test(clean) && referencedRoles.includes("margindesk_app")) {
        retainedAppGrants.push(redact(statement));
      }
      continue;
    }
    if (skipReason) {
      skipped.push({ statement: redact(statement), reason: skipReason });
      continue;
    }
    if (!referencedRoles.length || referencedRoles.some(name => name === null || !SUPABASE_MANAGED_ROLES.has(name))) {
      errors.push(`Role dump contains a statement outside the explicit owned/managed role allowlists: ${redact(statement)}`);
      continue;
    }
    skipped.push({ statement: redact(statement), reason: `Existing Supabase-managed role ${referencedRoles.join(", ")}; target platform roles are preserved` });
  }

  diagnostics.push(`Role statements retained for owned roles: ${retainedOwned.length}`);
  diagnostics.push(`Statements retained for owned role margindesk_app: ${retainedOwned.length}`);
  for (const statement of retainedOwned) diagnostics.push(`RETAINED [margindesk_app]: ${statement}`);
  diagnostics.push(`Membership grant statements retained for margindesk_app: ${retainedAppGrants.length}`);
  for (const statement of retainedAppGrants) diagnostics.push(`RETAINED [grant involving margindesk_app]: ${statement}`);
  diagnostics.push(`Allowlisted session statements retained: ${retainedSession.length}`);
  for (const statement of retainedSession) diagnostics.push(`RETAINED [session allowlist]: ${statement}`);
  diagnostics.push(`Allowlisted platform-role statements skipped: ${skipped.length}`);
  for (const item of skipped) diagnostics.push(`SKIPPED [${item.reason}]: ${item.statement}`);
  if (!restore.some(statement => /^\s*CREATE\s+ROLE\s+(?:"margindesk_app"|margindesk_app)(?:\s|;)/i.test(statement))) {
    errors.push("roles.sql did not contain CREATE ROLE margindesk_app; refusing a partial role restore.");
  }
  return { restoreSql: `${restore.join("\n\n")}\n`, diagnostics, retainedOwned, retainedAppGrants, retainedSession, skipped, errors };
}

if (process.argv[1] && process.argv[1].endsWith("filter-restore-roles.mjs")) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) throw new Error("Usage: node scripts/filter-restore-roles.mjs <roles.sql> <filtered-roles.sql>");
  const result = inspectAndFilterRolesDump(readFileSync(inputPath, "utf8"));
  for (const line of result.diagnostics) process.stdout.write(`${line}\n`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, [
      "### Filtered role dump",
      "",
      "Only explicitly allowlisted `margindesk_app` role statements and four exact dump-session statements were retained. Platform-managed statements were skipped only under the bounded role/parameter allowlists.",
      "",
      `Retained ${result.retainedOwned.length} ` + "`margindesk_app`" + " role statement(s):",
      "",
      ...result.retainedOwned.map(statement => `- \`${statement.replace(/`/g, "'")}\``),
      "",
      `Retained ${result.retainedAppGrants.length} membership statement(s) involving ` + "`margindesk_app`" + ":",
      "",
      ...result.retainedAppGrants.map(statement => `- \`${statement.replace(/`/g, "'")}\``),
      "",
      `Retained ${result.retainedSession.length} exact session statement(s):`,
      "",
      ...result.retainedSession.map(statement => `- \`${statement.replace(/`/g, "'")}\``),
      "",
      `Skipped ${result.skipped.length} allowlisted statement(s), with reasons:`,
      "",
      ...result.skipped.map(item => `- ${item.reason}: \`${item.statement.replace(/`/g, "'")}\``),
      ...result.errors.map(error => `- ERROR: ${error.replace(/`/g, "'")}`),
      "",
    ].join("\n"), "utf8");
  }
  if (result.errors.length) throw new Error(result.errors.join("\n"));
  writeFileSync(outputPath, result.restoreSql, "utf8");
}
