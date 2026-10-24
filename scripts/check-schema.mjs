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

export function lintMigrationSet(migrations) {
  const errors = [];
  const allSql = migrations.map(migration => migration.sql).join("\n");
  for (const migration of migrations) {
    const sqlWithoutComments = migration.sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\r\n]*/g, " ");
    if (/\bGRANT\s+"?margindesk_app"?\s+TO\b/i.test(sqlWithoutComments)) {
      errors.push(`${migration.name} grants membership in margindesk_app; role membership grants are allowed only in disposable test setup.`);
    }
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
      const table = precedingCreate ? unquoteIdentifier(precedingCreate[1]) : "unknown_table";
      constraints.push({ name: unquoteIdentifier(match[1]), table, source: migration.name });
    }
    for (const match of sql.matchAll(/ALTER\s+TABLE\s+(?:public\.)?("?[a-z_][a-z0-9_]*"?)\s+ADD\s+CONSTRAINT\s+("?[a-z_][a-z0-9_]*"?)/gi)) {
      constraints.push({ name: unquoteIdentifier(match[2]), table: unquoteIdentifier(match[1]), source: migration.name });
    }
  }
  errors.push(...duplicateErrors(constraints, "CONSTRAINT"));

  const functions = [];
  for (const migration of migrations) {
    for (const match of migration.sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
      functions.push({ name: `${match[1].toLowerCase()}(${match[2].replace(/\s+/g, "").toLowerCase()})`, table: "function", source: migration.name });
    }
  }
  errors.push(...duplicateErrors(functions, "FUNCTION", object => object.name));

  const auditSelectPolicies = [...policyRecords, ...generated.policies].filter(policy => policy.table === "audit_log" && policy.operation === "SELECT");
  if (!auditSelectPolicies.length) errors.push("audit_log must have an explicit owner/manager-only SELECT policy");
  for (const policy of auditSelectPolicies) {
    if (!ownerManagerOnly(policy.expression)) errors.push(`audit_log SELECT policy ${policy.name} is not owner/manager-only`);
  }

  if (!/audit_log_immutable/i.test(allSql) || !/REVOKE\s+UPDATE,DELETE,TRUNCATE\s+ON\s+audit_log/i.test(allSql)) errors.push("Audit log must be append-only for row UPDATE and DELETE");
  if (!/CREATE\s+TRIGGER\s+audit_log_prevent_truncate\s+BEFORE\s+TRUNCATE\s+ON\s+(?:public\.)?audit_log[\s\S]*?EXECUTE\s+FUNCTION\s+public\.prevent_audit_mutation\s*\(/i.test(allSql)) {
    errors.push("audit_log must have a statement-level BEFORE TRUNCATE trigger; row-level triggers do not protect TRUNCATE");
  }
  if (!/CREATE\s+POLICY[\s\S]*FOR\s+INSERT/i.test(allSql) || !/CREATE\s+POLICY[\s\S]*FOR\s+UPDATE/i.test(allSql) || !/CREATE\s+POLICY[\s\S]*FOR\s+DELETE/i.test(allSql)) errors.push("INSERT/UPDATE/DELETE policies must be defined");
  return { tables, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const migrationFiles = fs.readdirSync(migrationDir).filter(file => file.endsWith(".sql")).sort();
  if (!migrationFiles.length) throw new Error("No SQL migrations found.");
  const result = lintMigrationSet(migrationFiles.map(name => ({ name, sql: fs.readFileSync(path.join(migrationDir, name), "utf8") })));
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(`Schema check passed: ${result.tables.length} tenant-scoped tables; no duplicate migration objects; forced RLS and owner/manager-only audit SELECT are present.`);
}
