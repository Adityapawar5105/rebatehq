import assert from "node:assert/strict";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { APPLICATION_SCHEMAS, EXCLUDED_SUPABASE_SCHEMAS } from "./restore-dump-scope.mjs";

const { Pool } = pg;

const relationPattern = '("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)(?:\\.("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*))?';
const createTablePattern = new RegExp(`^\\s*CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${relationPattern})`, "i");
const copyPattern = new RegExp(`^\\s*COPY\\s+(${relationPattern})\\s*\\([\\s\\S]*\\)\\s+FROM\\s+stdin\\s*;\\s*$`, "i");

function unquoteIdentifier(value) {
  return value?.startsWith('"') ? value.slice(1, -1).replace(/""/g, '"') : value;
}

function parseRelation(match) {
  if (!match) return null;
  const relation = match[1];
  const parts = relation.split(".");
  const names = parts.map(unquoteIdentifier);
  return { schema: names.length === 2 ? names[0] : "public", table: names.at(-1) };
}

export function parseDumpTableNames(sql, kind) {
  const pattern = kind === "schema" ? createTablePattern : copyPattern;
  const found = new Map();
  for (const line of sql.split(/\r\n|\n|\r/)) {
    const match = pattern.exec(line);
    const relation = parseRelation(match);
    if (relation) found.set(`${relation.schema}.${relation.table}`, relation);
  }
  return [...found.values()].sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`));
}

export function assertApplicationTableMinimum(tables, expected = 29) {
  const count = tables.filter(table => table.schema === "public").length;
  assert.ok(count >= expected, `Restore inventory found ${count} public application tables; expected at least ${expected} after Chunk 2A.`);
  return count;
}

export function redactDataDumpContext(sql, lineNumber = 448, radius = 5) {
  const lines = sql.split(/\r\n|\n|\r/);
  const start = Math.max(1, lineNumber - radius);
  const end = Math.min(lines.length, lineNumber + radius);
  let inCopy = false;
  const safeLines = [];
  for (let index = 1; index <= end; index += 1) {
    const line = lines[index - 1];
    if (/^\\\.$/.test(line.trim())) {
      inCopy = false;
      if (index >= start) safeLines.push(`${index}: \\.`);
      continue;
    }
    if (copyPattern.test(line)) {
      inCopy = true;
      if (index >= start) safeLines.push(`${index}: ${line.trim()}`);
      continue;
    }
    if (index < start) {
      if (inCopy) continue;
      continue;
    }
    if (inCopy) safeLines.push(`${index}: [COPY DATA REDACTED]`);
    else safeLines.push(`${index}: ${line}`);
  }
  return { start, end, totalLines: lines.length, lines: safeLines };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function groupTables(tables) {
  return Object.fromEntries([...new Set(tables.map(table => table.schema))].sort().map(schema => [
    schema,
    tables.filter(table => table.schema === schema).map(table => table.table),
  ]));
}

async function main() {
  const [schemaDumpPath, dataDumpPath, inventoryPath] = process.argv.slice(2);
  if (!schemaDumpPath || !dataDumpPath || !inventoryPath) {
    throw new Error("Usage: node scripts/inspect-restore-dump.mjs <schema.sql> <data.sql> <inventory.json>");
  }
  const databaseUrl = process.env.RESTORE_TEST_SOURCE_DATABASE_URL;
  if (!databaseUrl) throw new Error("RESTORE_TEST_SOURCE_DATABASE_URL is required to inspect source rows.");
  const schemaSql = readFileSync(schemaDumpPath, "utf8");
  const dataSql = readFileSync(dataDumpPath, "utf8");
  const schemaTables = parseDumpTableNames(schemaSql, "schema");
  const dataTables = parseDumpTableNames(dataSql, "data");
  assert.ok(schemaTables.length > 0, "Schema dump contains no CREATE TABLE statements; refusing a vacuous restore inventory.");
  assertApplicationTableMinimum(schemaTables);
  assert.ok(dataTables.length > 0, "Data dump contains no COPY table statements; refusing a vacuous restore inventory.");
  for (const table of [...schemaTables, ...dataTables]) {
    assert.ok(APPLICATION_SCHEMAS.includes(table.schema), `Dump contains non-application schema ${table.schema}.${table.table}.`);
  }
  const schemaTableKeys = new Set(schemaTables.map(({ schema, table }) => `${schema}.${table}`));
  for (const { schema, table } of dataTables) {
    assert.ok(schemaTableKeys.has(`${schema}.${table}`), `Data dump table ${schema}.${table} is absent from the schema dump.`);
  }

  const pool = new Pool({ connectionString: databaseUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true } });
  try {
    const authUsersPresent = (await pool.query("SELECT to_regclass('auth.users') IS NOT NULL AS present")).rows[0].present;
    assert.equal(authUsersPresent, true, "Source Supabase database must contain auth.users for dependency inspection.");
    const migrationFiles = readdirSync("supabase/migrations").filter(file => file.endsWith(".sql")).sort();
    assert.ok(migrationFiles.length > 0, "No MarginDesk migrations found for restore inventory inspection.");
    const migrations = migrationFiles.map(file => ({ name: file, sql: readFileSync(`supabase/migrations/${file}`, "utf8") }));
    const migrationSql = migrations.map(item => item.sql).join("\n");
    const hasAuthTrigger = migrations.some(({ sql }) => [...sql.matchAll(/CREATE\s+TRIGGER\b[\s\S]*?;/gi)].some(match => /\bON\s+auth\./i.test(match[0])));
    assert.equal(hasAuthTrigger, false, "Application migrations must not install triggers on Supabase-managed auth tables.");
    const migrationFootprint = {
      migrations: migrationFiles,
      applicationSchemas: ["public"],
      createsApplicationSchema: /CREATE\s+SCHEMA\b/i.test(migrationSql),
      extensionStatements: [...migrationSql.matchAll(/CREATE\s+EXTENSION[^;]*;/gi)].map(match => match[0].replace(/\s+/g, " ").trim()),
      createsAuthTableTriggers: hasAuthTrigger,
    };
    assert.equal(migrationFootprint.createsApplicationSchema, false, "Application migrations unexpectedly create another schema; update the explicit dump allowlist only after review.");

    const authFkResult = await pool.query(`
      SELECT tn.nspname AS table_schema, tc.relname AS table_name, con.conname AS constraint_name,
             la.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class tc ON tc.oid=con.conrelid
      JOIN pg_namespace tn ON tn.oid=tc.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS local_key(attnum,ord) ON true
      JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS foreign_key(attnum,ord) ON foreign_key.ord=local_key.ord
      JOIN pg_attribute la ON la.attrelid=tc.oid AND la.attnum=local_key.attnum
      JOIN pg_attribute ra ON ra.attrelid=con.confrelid AND ra.attnum=foreign_key.attnum
      WHERE con.contype='f' AND con.confrelid=to_regclass('auth.users') AND ra.attname='id'
        AND tn.nspname=ANY($1::text[])
      GROUP BY tn.nspname,tc.relname,con.conname,la.attname
      ORDER BY tn.nspname,tc.relname,con.conname,la.attname
    `, [APPLICATION_SCHEMAS]);
    const authForeignKeys = [];
    const authUserIds = new Set();
    for (const foreignKey of authFkResult.rows) {
      const query = `SELECT DISTINCT ${quoteIdentifier(foreignKey.column_name)}::text AS id FROM ${quoteIdentifier(foreignKey.table_schema)}.${quoteIdentifier(foreignKey.table_name)} WHERE ${quoteIdentifier(foreignKey.column_name)} IS NOT NULL`;
      const ids = (await pool.query(query)).rows.map(row => row.id);
      for (const id of ids) {
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `Unexpected non-UUID auth.users reference in ${foreignKey.table_name}.${foreignKey.column_name}.`);
        authUserIds.add(id);
      }
      const rowCountQuery = `SELECT count(*)::text AS row_count FROM ${quoteIdentifier(foreignKey.table_schema)}.${quoteIdentifier(foreignKey.table_name)} WHERE ${quoteIdentifier(foreignKey.column_name)} IS NOT NULL`;
      const referencingRows = (await pool.query(rowCountQuery)).rows[0].row_count;
      authForeignKeys.push({
        table: `${foreignKey.table_schema}.${foreignKey.table_name}`,
        constraint: foreignKey.constraint_name,
        column: foreignKey.column_name,
        referencingRows,
        distinctReferencedUsers: ids.length,
      });
    }
    const resolvedAuthIds = authUserIds.size
      ? Number((await pool.query("SELECT count(*)::int AS count FROM auth.users WHERE id=ANY($1::uuid[])", [[...authUserIds]])).rows[0].count)
      : 0;
    assert.equal(resolvedAuthIds, authUserIds.size, "Source application data has an auth.users foreign key pointing to a missing user.");
    const authTriggerResult = await pool.query(`
      SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname AS trigger_name,p.proname AS function_name
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE n.nspname='auth' AND NOT t.tgisinternal
      ORDER BY c.relname,t.tgname
    `);
    const sourceRows = {};
    for (const { schema, table } of schemaTables) {
      const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
      const result = await pool.query(`SELECT count(*)::text AS row_count FROM ${relation}`);
      sourceRows[`${schema}.${table}`] = result.rows[0].row_count;
    }
    const inventory = {
      applicationSchemas: [...APPLICATION_SCHEMAS],
      schemaTables,
      dataTables,
      sourceRows,
      authForeignKeys,
      authUserIds: [...authUserIds].sort(),
      sourceAuthTriggerInventory: authTriggerResult.rows,
      migrationFootprint,
    };
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

    const dumpLineContext = redactDataDumpContext(dataSql, 448, 5);
    process.stdout.write(`Application-owned schemas included: ${APPLICATION_SCHEMAS.join(", ")}\n`);
    process.stdout.write(`Supabase-managed schemas excluded: ${EXCLUDED_SUPABASE_SCHEMAS.join(", ")}, and every schema outside the allowlist.\n`);
    process.stdout.write(`Migration footprint: ${JSON.stringify(migrationFootprint)}\n`);
    process.stdout.write(`Schema dump tables by schema: ${JSON.stringify(groupTables(schemaTables))}\n`);
    process.stdout.write(`Data dump tables by schema: ${JSON.stringify(groupTables(dataTables))}\n`);
    process.stdout.write(`Source row counts for included application tables: ${JSON.stringify(sourceRows)}\n`);
    process.stdout.write(`Public foreign keys to auth.users(id): ${JSON.stringify(authForeignKeys)}\n`);
    process.stdout.write(`Distinct auth.users IDs referenced by application data: ${authUserIds.size} (IDs and auth fields are not printed or dumped).\n`);
    process.stdout.write(`Application-created triggers on auth tables: none. Existing source auth triggers: ${JSON.stringify(authTriggerResult.rows)}\n`);
    process.stdout.write(`margindesk-data.sql lines ${dumpLineContext.start}-${dumpLineContext.end} around line 448 (COPY row contents redacted; file has ${dumpLineContext.totalLines} lines):\n${dumpLineContext.lines.join("\n")}\n`);

    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const tableRows = schemaTables.map(({ schema, table }) => `| ${schema}.${table} | ${sourceRows[`${schema}.${table}`]} | ${dataTables.some(item => item.schema === schema && item.table === table) ? "yes" : "no"} |`);
      const fkRows = authForeignKeys.map(item => `| ${item.table}.${item.column} | ${item.constraint} | ${item.referencingRows} | ${item.distinctReferencedUsers} |`);
      appendFileSync(summary, [
        "### Restore dump inventory",
        "",
        `- Included schemas: ${APPLICATION_SCHEMAS.join(", ")}`,
        `- Excluded Supabase-managed schemas: ${EXCLUDED_SUPABASE_SCHEMAS.join(", ")}; all schemas outside the allowlist are excluded.`,
        `- Source schema dump tables: ${schemaTables.length} (minimum 29); data dump COPY tables: ${dataTables.length}.`,
        "- Source counts are for application-owned public tables only.",
        "",
        "| Table | Source rows | In data dump |",
        "|---|---:|:---:|",
        ...tableRows,
        "",
        "#### auth.users dependencies",
        "",
        "| Referencing table.column | Constraint | Referencing rows | Distinct IDs |",
        "|---|---|---:|---:|",
        ...(fkRows.length ? fkRows : ["| (none) | — | 0 | 0 |"]),
        `- Synthetic auth.users stand-ins required: ${authUserIds.size}; source auth fields and IDs are not emitted to logs.`,
        "- Data dump line 448 context is printed in the job log; COPY payload rows are redacted.",
        "",
      ].join("\n"), "utf8");
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("inspect-restore-dump.mjs")) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Restore dump inspection failed."}\n`);
    process.exitCode = 1;
  });
}
