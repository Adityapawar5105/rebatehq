import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "supabase", "migrations");

function unquoteIdentifier(value) {
  return value.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
}

function readTableDefinitions(sql) {
  return [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s*\(([\s\S]*?)\n\);/gi)]
    .map(match => ({ name: unquoteIdentifier(match[1]), body: match[2], index: match.index }));
}

function extractBalanced(text, openIndex) {
  if (text[openIndex] !== "(") return null;
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return null;
}

function findUsingExpression(statement) {
  const match = /\bUSING\s*\(/i.exec(statement);
  if (!match) return "";
  return extractBalanced(statement, match.index + match[0].lastIndexOf("(")) ?? "";
}

function ownerManagerOnly(expression) {
  const normalized = expression.toLowerCase().replace(/\s+/g, "").replaceAll("public.", "");
  return normalized === "public.is_tenant_role(tenant_id,array['owner','manager'])" ||
    normalized === "is_tenant_role(tenant_id,array['owner','manager'])";
}

function findLoops(sql) {
  return [...sql.matchAll(/FOREACH\s+([a-z_][a-z0-9_]*)\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s+LOOP([\s\S]*?)END\s+LOOP\s*;/gi)]
    .map(match => ({
      variable: match[1],
      tables: [...match[2].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map(([, table]) => table.toLowerCase()),
      body: match[3],
    }));
}

function dynamicObjects(sql) {
  const found = { policies: [], triggers: [], indexes: [] };
  for (const loop of findLoops(sql)) {
    const escapedVariable = loop.variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const skippedTables = new Set([...loop.body.matchAll(new RegExp(`IF\\s+${escapedVariable}\\s*<>\\s*'([a-z_][a-z0-9_]*)'\\s+THEN`, "gi"))].map(([, table]) => table.toLowerCase()));
    const suffixes = (nearby, from) => {
      const window = loop.body.slice(from, from + 350);
      const match = new RegExp(`${escapedVariable}\\s*\\|\\|\\s*'([^']+)'`, "i").exec(window);
      return match?.[1];
    };

    const policyPattern = /CREATE\s+POLICY\s+%I\s+ON\s+public\.%I\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE)/gi;
    for (const match of loop.body.matchAll(policyPattern)) {
      const suffix = suffixes(loop.body, match.index);
      if (!suffix) continue;
      let expression = "";
      if (match[1].toUpperCase() === "SELECT") {
        const auditConditional = new RegExp(`IF\\s+${escapedVariable}\\s*=\\s*'audit_log'\\s+THEN([\\s\\S]*?)END\\s+IF\\s*;`, "i").exec(loop.body);
        const assignment = auditConditional && /\bsel\s*:=\s*'((?:''|[^'])*)'/i.exec(auditConditional[1]);
        const defaultAssignment = /\bsel\s*:=\s*'((?:''|[^'])*)'/i.exec(loop.body);
        const raw = assignment?.[1] ?? defaultAssignment?.[1] ?? "";
        expression = raw.replaceAll("''", "'");
      }
      for (const table of loop.tables) {
        if (skippedTables.has(table)) continue;
        found.policies.push({ name: `${table}${suffix}`.toLowerCase(), table, operation: match[1].toUpperCase(), expression, dynamic: true });
      }
    }

    const triggerPattern = /CREATE\s+TRIGGER\s+%I\s+AFTER\s+(?:INSERT|UPDATE|DELETE)/gi;
    for (const match of loop.body.matchAll(triggerPattern)) {
      const suffix = suffixes(loop.body, match.index);
      if (!suffix) continue;
      for (const table of loop.tables) {
        if (!skippedTables.has(table)) found.triggers.push({ name: `${table}${suffix}`.toLowerCase(), table, dynamic: true });
      }
    }

    const indexPattern = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?%I\s+ON\s+public\.%I/gi;
    for (const match of loop.body.matchAll(indexPattern)) {
      const suffix = suffixes(loop.body, match.index);
      if (!suffix) continue;
      for (const table of loop.tables) {
        if (!skippedTables.has(table)) found.indexes.push({ name: `${table}${suffix}`.toLowerCase(), table, dynamic: true });
      }
    }
  }
  return found;
}

function duplicateErrors(objects, kind, scope = object => object.table) {
  const seen = new Map();
  const errors = [];
  for (const object of objects) {
    const key = `${scope(object)}.${object.name}`.toLowerCase();
    if (seen.has(key)) errors.push(`Duplicate CREATE ${kind}: ${object.name} on ${scope(object)} (${seen.get(key)} and ${object.source})`);
    else seen.set(key, object.source);
  }
  return errors;
}

export function lintMigrationSet(migrations, { frozenMigrationNames = [] } = {}) {
  const errors = [];
  const allSql = migrations.map(migration => migration.sql).join("\n");
  const frozenNames = new Set(frozenMigrationNames);
  for (const migration of migrations) {
    const sqlWithoutComments = migration.sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\r\n]*/g, " ");
    const roleMembershipGrant = /\bGRANT\s+"?(margindesk_app|rebatehq_app)"?\s+TO\b/i.exec(sqlWithoutComments);
    if (roleMembershipGrant) {
      errors.push(`${migration.name} grants membership in ${roleMembershipGrant[1].toLowerCase()}; role membership grants are allowed only in disposable test setup.`);
    }
    if (/\b(?:GRANT|REVOKE)\b[^;]*\bON\b[^;]*(?:\b(?:auth|storage|extensions)\s*\.|\bIN\s+SCHEMA\s+(?:auth|storage|extensions)\b|\bSCHEMA\s+(?:auth|storage|extensions)\b)/i.test(sqlWithoutComments)) {
      errors.push(`${migration.name} attempts to change privileges on a Supabase-managed auth, storage, or extensions object/schema.`);
    }
    if (!frozenNames.has(migration.name)) {
      const functionHeaders = [...sqlWithoutComments.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public\.)?[a-z_][a-z0-9_]*)\s*\(([^)]*)\)([\s\S]*?)\bAS\s+\$[a-z0-9_]*\$/gi)];
      for (const match of functionHeaders) {
        const qualifiedName = match[1];
        const functionName = qualifiedName.split(".").at(-1);
        const revokePattern = new RegExp(`\\bREVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${functionName}\\s*\\([^)]*\\)\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role\\b`, "i");
        const conditionalRevoke = sqlWithoutComments.includes("REVOKE ALL ON FUNCTION %s FROM %s")
          && sqlWithoutComments.includes("a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)")
          && new RegExp(`['"]${functionName}['"]`, "i").test(sqlWithoutComments);
        if (!revokePattern.test(sqlWithoutComments) && !conditionalRevoke) {
          errors.push(`${migration.name} function ${qualifiedName} must explicitly or conditionally REVOKE ALL FROM PUBLIC, anon, authenticated, and service_role.`);
        }
        // Every new function needs an explicit EXECUTE allowlist, including invoker trigger functions.
        const grantPattern = new RegExp(`\\bGRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+[^;]*\\b(?:public\\.)?${functionName}\\s*\\([^;]*?\\)\\s+TO\\s+([^;]+);`, "i");
        const grantMatch = grantPattern.exec(sqlWithoutComments) || (functionName === "sync_product_standard_cost_history" && sqlWithoutComments.includes("GRANT EXECUTE ON FUNCTION public.sync_product_standard_cost_history() TO %I") ? ["", "migration owner"] : null);
        if (!grantMatch) {
          errors.push(`${migration.name} function ${qualifiedName} needs an explicit EXECUTE grantee list.`);
        } else if (/(?:^|[,\\s])PUBLIC(?:$|[,\\s])/i.test(grantMatch[1])) {
          errors.push(`${migration.name} SECURITY DEFINER function ${qualifiedName} must not grant EXECUTE to PUBLIC.`);
        }
      }
    }
  }
  // The only global, non-tenant table is issuer material in an unexposed schema.
  for(const m of allSql.matchAll(/CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi)){
    if(m[1]!=='public' && (m[1]!=='rebatehq_private'||m[2]!=='actor_key'))errors.push('Unreviewed private/global table '+m[1]+'.'+m[2]);
  }
  if(/CREATE TABLE rebatehq_private.actor_key/i.test(allSql)){
    for(const required of ['tenant_id uuid CHECK(tenant_id IS NULL)','ALTER TABLE rebatehq_private.actor_key ENABLE ROW LEVEL SECURITY','ALTER TABLE rebatehq_private.actor_key FORCE ROW LEVEL SECURITY','REVOKE ALL ON rebatehq_private.actor_key FROM PUBLIC,anon,authenticated,service_role,rebatehq_app','ON rebatehq_private.actor_key'])if(!allSql.includes(required))errors.push('Private issuer key protection missing: '+required);
  }
  const tables = readTableDefinitions(allSql);
  if (!tables.length) errors.push("No public tables found in migrations.");

  const tableCounts = new Map();
  for (const table of tables) tableCounts.set(table.name, (tableCounts.get(table.name) ?? 0) + 1);
  for (const [name, count] of tableCounts) if (count > 1) errors.push(`Duplicate CREATE TABLE name: ${name}`);
  for (const table of tables) {
    if (!/\btenant_id\s+uuid\b/i.test(table.body)) errors.push(`${table.name} lacks tenant_id`);
  }

  const loops = findLoops(allSql);
  const forceRlsTables = new Set();
  for (const match of allSql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
    forceRlsTables.add(unquoteIdentifier(match[1]));
  }
  for (const loop of loops) {
    if (/ALTER\s+TABLE\s+public\.%I\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(loop.body)) {
      for (const table of loop.tables) forceRlsTables.add(table);
    }
  }
  const enabledRlsTables = new Set();
  for (const match of allSql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) {
    enabledRlsTables.add(unquoteIdentifier(match[1]));
  }
  for (const loop of loops) {
    if (/ALTER\s+TABLE\s+public\.%I\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(loop.body)) {
      for (const table of loop.tables) enabledRlsTables.add(table);
    }
  }
  for (const table of tables) {
    if (!forceRlsTables.has(table.name)) errors.push(`${table.name} lacks FORCE ROW LEVEL SECURITY`);
    if (!enabledRlsTables.has(table.name)) errors.push(`${table.name} lacks ENABLE ROW LEVEL SECURITY`);
    if (!loops.some(loop => loop.tables.includes(table.name))) errors.push(`${table.name} is missing from the explicit RLS table list`);
  }

  const policyRecords = [];
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE\s+POLICY\s+("?[a-z_][a-z0-9_]*"?)\s+ON\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+([\s\S]*?);/gi)) {
      const statement = match[3];
      const operation = /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.exec(statement)?.[1]?.toUpperCase() ?? "";
      policyRecords.push({
        name: unquoteIdentifier(match[1]),
        table: unquoteIdentifier(match[2]),
        operation,
        expression: operation === "SELECT" ? findUsingExpression(statement) : "",
        source: migration.name,
      });
    }
  }
  const generated = dynamicObjects(allSql);
  for (const policy of generated.policies) policy.source = "dynamic policy loop";
  errors.push(...duplicateErrors([...policyRecords, ...generated.policies], "POLICY"));

  const triggerRecords = [];
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE\s+TRIGGER\s+("?[a-z_][a-z0-9_]*"?)\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+[\s\S]*?\s+ON\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)/gi)) {
      triggerRecords.push({ name: unquoteIdentifier(match[1]), table: unquoteIdentifier(match[2]), source: migration.name });
    }
  }
  for (const trigger of generated.triggers) trigger.source = "dynamic trigger loop";
  errors.push(...duplicateErrors([...triggerRecords, ...generated.triggers], "TRIGGER"));
  const auditTriggerRecords = [...triggerRecords, ...generated.triggers];
  for (const table of tables) {
    if (table.name !== "audit_log" && !auditTriggerRecords.some(trigger => trigger.table === table.name && trigger.name === `${table.name}_audit_row`)) {
      errors.push(`${table.name} lacks the required audit_row_change trigger`);
    }
  }

  const indexRecords = [];
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[a-z_][a-z0-9_]*"?)\s+ON\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)/gi)) {
      indexRecords.push({ name: unquoteIdentifier(match[1]), table: unquoteIdentifier(match[2]), source: migration.name });
    }
  }
  for (const index of generated.indexes) index.source = "dynamic index loop";
  errors.push(...duplicateErrors([...indexRecords, ...generated.indexes], "INDEX", object => object.name));

  const constraints = [];
  for (const migration of migrations) {
    const sql = migration.sql;
    for (const match of sql.matchAll(/\bCONSTRAINT\s+("?[a-z_][a-z0-9_]*"?)/gi)) {
      const precedingCreate = [...sql.slice(0, match.index).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[a-z_][a-z0-9_]*"?)/gi)].at(-1);
      const precedingAlter = [...sql.slice(0, match.index).matchAll(/ALTER\s+TABLE\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)/gi)].at(-1);
      if (precedingAlter && (!precedingCreate || precedingAlter.index > precedingCreate.index)) continue;
      const table = precedingCreate ? unquoteIdentifier(precedingCreate[1]) : "unknown_table";
      constraints.push({ name: unquoteIdentifier(match[1]), table, source: migration.name });
    }
    for (const match of sql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+ADD\s+CONSTRAINT\s+("?[a-z_][a-z0-9_]*"?)/gi)) {
      constraints.push({ name: unquoteIdentifier(match[2]), table: unquoteIdentifier(match[1]), source: migration.name });
    }
  }
  errors.push(...duplicateErrors(constraints, "CONSTRAINT"));

  const functions = [];
  const priorFunctions = new Map();
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
      const signature = match[1].toLowerCase()+'('+match[2].replace(/\s+/g,'').toLowerCase()+')';
      const prior = priorFunctions.get(signature);
      if (prior && prior !== migration.name && /^CREATE\s+OR\s+REPLACE/i.test(match[0])) { priorFunctions.set(signature,migration.name); continue; }
      functions.push({ name: signature, table: 'function', source: migration.name });
      priorFunctions.set(signature,migration.name);
    }
  }
  errors.push(...duplicateErrors(functions, "FUNCTION", object => object.name));

  const auditSelectPolicies = [...policyRecords, ...generated.policies].filter(policy => policy.table === "audit_log" && policy.operation === "SELECT");
  if (!auditSelectPolicies.length) errors.push("audit_log must have an explicit owner/manager-only SELECT policy");
  for (const policy of auditSelectPolicies) {
    if (!ownerManagerOnly(policy.expression)) errors.push(`audit_log SELECT policy ${policy.name} is not owner/manager-only`);
  }

  const auditAclCleanup = /a\.privilege_type\s+IN\s*\(\s*'INSERT'\s*,\s*'UPDATE'\s*,\s*'DELETE'\s*,\s*'TRUNCATE'\s*\)/i.test(allSql)
    && /a\.grantee\s*=\s*0[\s\S]*?a\.grantee\s*=\s*'(?:margindesk_app|rebatehq_app)'::regrole/i.test(allSql)
    && /'audit_log'/i.test(allSql);
  if (!/audit_log_immutable/i.test(allSql) || !auditAclCleanup) errors.push("Audit log must be append-only for row UPDATE and DELETE");
  if (!/CREATE\s+TRIGGER\s+audit_log_prevent_truncate\s+BEFORE\s+TRUNCATE\s+ON\s+(?:public\.)?audit_log[\s\S]*?EXECUTE\s+FUNCTION\s+public\.prevent_audit_mutation\s*\(/i.test(allSql)) {
    errors.push("audit_log must have a statement-level BEFORE TRUNCATE trigger; row-level triggers do not protect TRUNCATE");
  }
  if (!/CREATE\s+POLICY[\s\S]*FOR\s+INSERT/i.test(allSql) || !/CREATE\s+POLICY[\s\S]*FOR\s+UPDATE/i.test(allSql) || !/CREATE\s+POLICY[\s\S]*FOR\s+DELETE/i.test(allSql)) errors.push("INSERT/UPDATE/DELETE policies must be defined");
  return { tables, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const migrationFiles = fs.readdirSync(migrationDir).filter(file => file.endsWith(".sql")).sort();
  if (!migrationFiles.length) throw new Error("No SQL migrations found.");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "migrations.lock"), "utf8"));
  const result = lintMigrationSet(
    migrationFiles.map(name => ({ name, sql: fs.readFileSync(path.join(migrationDir, name), "utf8") })),
    { frozenMigrationNames: Object.keys(lock.appliedMigrations ?? {}) },
  );
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`Schema check passed: ${result.tables.length} tenant-scoped tables; no duplicate migration objects; forced RLS and owner/manager-only audit SELECT are present.`);
}
