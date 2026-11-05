import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { loadDatabaseTestSql } from "./load-db-test-sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFile = path.join(root, "supabase", "tests", "phase1_rls.sql");

type RestoreBaseline = {
  tenantRowCounts?: Record<string, Array<{ tenant_id: string | null; row_count: string }>>;
  sentinel?: { tenant_id: string; id: string; content_hash: string };
};

const expectedFixturePlan = 152;
const restoreFixturePlan = 155;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`;
}

function materializeFixtureIds(template: string): { sql: string; ids: Map<string, string> } {
  const tokens = [...new Set([...template.matchAll(/__PHASE1_([A-Z0-9_]+_ID)__/g)].map(match => match[0]))];
  if (tokens.length === 0) throw new Error("The pgTAP SQL has no generated fixture ID placeholders.");
  const ids = new Map<string, string>();
  for (const token of tokens) {
    ids.set(token, randomUUID());
  }
  if (new Set(ids.values()).size !== ids.size) throw new Error("Generated duplicate pgTAP fixture UUIDs; refusing to run.");
  let sql = template;
  for (const [token, value] of ids) sql = sql.replaceAll(token, value);
  if (/__PHASE1_[A-Z0-9_]+_ID__/.test(sql)) throw new Error("Unresolved generated pgTAP fixture ID placeholder.");
  return { sql, ids };
}

async function assertFixtureIdsDoNotCollide(client: Client, ids: Map<string, string>): Promise<void> {
  const checkedIds = new Map(ids);
  const uniqueIds = [...new Set(checkedIds.values())];
  const reverse = new Map([...checkedIds.entries()].map(([token, value]) => [value, token]));
  const appColumns = await client.query<{ table_name: string; column_names: string[] }>(`
    SELECT c.relname::text AS table_name,
           array_agg(a.attname::text ORDER BY a.attnum) AS column_names
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
      AND a.attname IN ('id','tenant_id')
    GROUP BY c.relname
  `);
  const collisions: string[] = [];
  for (const table of appColumns.rows) {
    const predicates = table.column_names.map(column => `existing_row.${quoteIdentifier(column)}=candidate.id`);
    const found = await client.query<{ collision: string }>(
      `SELECT candidate.id::text AS collision
       FROM unnest($1::uuid[]) AS candidate(id)
       WHERE EXISTS (
         SELECT 1 FROM public.${quoteIdentifier(table.table_name)} existing_row
         WHERE ${predicates.join(" OR ")}
       )`,
      [uniqueIds],
    );
    for (const row of found.rows) {
      const token = reverse.get(row.collision);
      collisions.push(`${token ?? "generated UUID"} already exists in public.${table.table_name}`);
    }
  }
  const auth = await client.query<{ id: string }>("SELECT id::text FROM auth.users WHERE id=ANY($1::uuid[])", [uniqueIds]);
  for (const row of auth.rows) collisions.push(`${reverse.get(row.id) ?? "generated UUID"} already exists in auth.users`);
  if (collisions.length) {
    throw new Error(`Generated pgTAP fixture UUID collision; refusing to seed fixtures: ${[...new Set(collisions)].join("; ")}`);
  }
  process.stdout.write(`Generated ${ids.size} independent pgTAP fixture UUIDs; checked for collisions across ${appColumns.rowCount} application tables and auth.users (none found).\n`);
}

async function reportLegacyFixtureIds(client: Client): Promise<void> {
  const legacyIds = [
    "10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003", "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002", "37000000-0000-4000-8000-000000000001",
    "37000000-0000-4000-8000-000000000002", "37000000-0000-4000-8000-000000000003",
    "61000000-0000-4000-8000-000000000001", "62000000-0000-4000-8000-000000000001",
  ];
  const tables = await client.query<{ table_name: string; column_names: string[] }>(`
    SELECT c.relname::text AS table_name,array_agg(a.attname::text ORDER BY a.attnum) AS column_names
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0
      AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
    GROUP BY c.relname ORDER BY c.relname
  `);
  const locations: string[] = [];
  for (const table of tables.rows) {
    const valueRows = table.column_names.map(column =>
      `(${quoteLiteral(column)},existing_row.${quoteIdentifier(column)})`,
    );
    const result = await client.query<{ id: string; column_name: string }>(
      `SELECT DISTINCT candidate.id::text AS id,id_match.column_name
       FROM public.${quoteIdentifier(table.table_name)} existing_row
       CROSS JOIN LATERAL (VALUES ${valueRows.join(",")}) AS id_match(column_name,candidate_id)
       JOIN unnest($1::uuid[]) candidate(id) ON candidate.id=id_match.candidate_id`,
      [legacyIds],
    );
    for (const row of result.rows) locations.push(`${row.id} in public.${table.table_name}.${row.column_name}`);
  }
  const authUsers = await client.query<{ id: string }>("SELECT id::text FROM auth.users WHERE id=ANY($1::uuid[])", [legacyIds]);
  for (const row of authUsers.rows) locations.push(`${row.id} in auth.users`);
  process.stdout.write(`Legacy fixed-ID fixture/sentinel diagnostic (these IDs are no longer used by pgTAP fixtures): ${locations.length ? locations.join("; ") : "no legacy tenant/user/customer/quote/sentinel IDs found"}.\n`);
}

async function prepareRestoreBaseline(client: Client): Promise<boolean> {
  const restoreMode = process.env.RESTORE_TEST_MODE === "true";
  if (!restoreMode) return false;
  const baselinePath = process.env.RESTORE_BASELINE_PATH;
  if (!baselinePath) throw new Error("RESTORE_TEST_MODE=true requires RESTORE_BASELINE_PATH from the source equivalence snapshot.");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as RestoreBaseline;
  if (!baseline.sentinel?.tenant_id || !baseline.sentinel.id || !baseline.sentinel.content_hash) {
    throw new Error("Restore baseline lacks the source sentinel tenant, record ID, or content hash.");
  }
  const countRows = Object.entries(baseline.tenantRowCounts ?? {}).flatMap(([tableName, rows]) =>
    rows.map(row => ({ tableName, tenantId: row.tenant_id, count: row.row_count })),
  );
  if (countRows.length === 0) throw new Error("Restore baseline contains no per-tenant row counts.");
  await client.query(`
    CREATE TEMP TABLE phase1_restore_expected_tenant_counts (
      table_name text NOT NULL, tenant_id text NULL, row_count bigint NOT NULL
    ) ON COMMIT DROP
  `);
  await client.query(`
    INSERT INTO pg_temp.phase1_restore_expected_tenant_counts(table_name,tenant_id,row_count)
    SELECT * FROM unnest($1::text[],$2::text[],$3::bigint[])
  `, [
    countRows.map(row => row.tableName),
    countRows.map(row => row.tenantId),
    countRows.map(row => row.count),
  ]);
  await client.query(`SELECT
    set_config('app.restore_test_mode','true',true),
    set_config('app.restore_sentinel_tenant_id',$1,true),
    set_config('app.restore_sentinel_record_id',$2,true),
    set_config('app.restore_sentinel_content_hash',$3,true)
  `, [baseline.sentinel.tenant_id, baseline.sentinel.id, baseline.sentinel.content_hash]);
  process.stdout.write(`Restore-only pgTAP controls loaded: ${countRows.length} source tenant/table row-count entries and sentinel ${baseline.sentinel.tenant_id}/${baseline.sentinel.id}.\n`);
  return true;
}

type PgDiagnosticError = Error & {
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  where?: string;
  routine?: string;
};

function safeDiagnostic(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\bpostgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b(password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

async function runPgtap(connectionString: string) {
  const client = new Client({
    connectionString,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(connectionString) ? false : { rejectUnauthorized: true },
  });
  try {
    await client.connect();
    const diagnostics = await client.query<{
      login_role: string;
      server_version_num: number;
      login_super: boolean;
      login_bypass: boolean;
    }>(`SELECT session_user::text AS login_role,
               current_setting('server_version_num')::int AS server_version_num,
               r.rolsuper AS login_super,r.rolbypassrls AS login_bypass
        FROM pg_roles r WHERE r.rolname=session_user`);
    const connection = diagnostics.rows[0];
    if (!connection) throw new Error("Could not inspect the TEST_DATABASE_URL connection role.");
    process.stdout.write(
      `pgTAP connection: PostgreSQL ${Math.floor(connection.server_version_num / 10000)}, role ${connection.login_role} ` +
      `(SUPERUSER=${connection.login_super}, BYPASSRLS=${connection.login_bypass}).\n`,
    );
    const extensionAccess = await client.query<{
      schema_name: string;
      schema_owner: string;
      connection_usage: boolean;
      app_usage: boolean;
      pgtap_owner: string | null;
    }>(`SELECT n.nspname::text AS schema_name,
               pg_get_userbyid(n.nspowner)::text AS schema_owner,
               has_schema_privilege(session_user,n.oid,'USAGE') AS connection_usage,
               has_schema_privilege('rebatehq_app',n.oid,'USAGE') AS app_usage,
               (SELECT pg_get_userbyid(e.extowner)::text FROM pg_extension e
                WHERE e.extname='pgtap' AND e.extnamespace=n.oid) AS pgtap_owner
        FROM pg_namespace n WHERE n.nspname='extensions'`);
    const extension = extensionAccess.rows[0];
    if (extension) {
      process.stdout.write(
        `Extension schema ${extension.schema_name}: owner=${extension.schema_owner}, ` +
        `TEST_DATABASE_URL_USAGE=${extension.connection_usage}, rebatehq_app_USAGE=${extension.app_usage}, ` +
        `pgTAP_owner=${extension.pgtap_owner ?? "not-installed-yet"}.\n`,
      );
    } else {
      process.stdout.write("Extension schema extensions does not exist before the pgTAP test starts.\n");
    }
    const template = await loadDatabaseTestSql();
    const materialized = materializeFixtureIds(template);
    const sql = materialized.sql;
    await reportLegacyFixtureIds(client);
    await assertFixtureIdsDoNotCollide(client, materialized.ids);
    const bootstrap = /^\s*BEGIN\s*;\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgtap\s+WITH\s+SCHEMA\s+extensions\s*;\s*/i.exec(sql);
    if (!bootstrap) throw new Error("The pgTAP SQL file must begin with BEGIN; and CREATE EXTENSION pgtap WITH SCHEMA extensions;.");
    try {
      await client.query(bootstrap[0]);
    } catch (error) {
      const pgError = error as Error & { code?: string };
      throw new Error(`pgTAP bootstrap failed as TEST_DATABASE_URL role ${connection.login_role}${pgError.code ? ` (SQLSTATE ${pgError.code})` : ""}: ${pgError.message}`);
    }
    const restoreMode = await prepareRestoreBaseline(client);
    const installedPgtap = await client.query<{
      extension_schema: string;
      extension_owner: string;
      schema_owner: string;
      connection_usage: boolean;
      app_usage: boolean;
    }>(`SELECT n.nspname::text AS extension_schema,
               pg_get_userbyid(e.extowner)::text AS extension_owner,
               pg_get_userbyid(n.nspowner)::text AS schema_owner,
               has_schema_privilege(session_user,n.oid,'USAGE') AS connection_usage,
               has_schema_privilege('rebatehq_app',n.oid,'USAGE') AS app_usage
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
        WHERE e.extname='pgtap'`);
    const pgtap = installedPgtap.rows[0];
    if (!pgtap) throw new Error("pgTAP extension was not installed after its bootstrap statement.");
    process.stdout.write(
      `pgTAP installed in schema ${pgtap.extension_schema}; extension owner=${pgtap.extension_owner}; ` +
      `schema owner=${pgtap.schema_owner}; TEST_DATABASE_URL_USAGE=${pgtap.connection_usage}; ` +
      `rebatehq_app_USAGE=${pgtap.app_usage}.\n`,
    );
    const authPolicyRefs = await client.query<{ schemaname: string; tablename: string; policyname: string; expression: string }>(
      `SELECT schemaname::text,tablename::text,policyname::text,
              concat_ws(' ',qual,with_check)::text AS expression
       FROM pg_policies
       WHERE concat_ws(' ',qual,with_check) ILIKE '%auth.%'
       ORDER BY schemaname,tablename,policyname`,
    );
    const authFunctionRefs = await client.query<{
      schema_name: string;
      function_name: string;
      identity_arguments: string;
      security_definer: boolean;
      search_path: string | null;
    }>(
      `SELECT n.nspname::text AS schema_name,p.proname::text AS function_name,
              pg_get_function_identity_arguments(p.oid)::text AS identity_arguments,
              p.prosecdef AS security_definer,
              (SELECT setting FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) setting
               WHERE setting LIKE 'search_path=%' LIMIT 1)::text AS search_path
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE has_function_privilege('rebatehq_app',p.oid,'EXECUTE')
         AND (p.prosrc ILIKE '%auth.%' OR (n.nspname='auth' AND p.proname='uid'))
       ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`,
    );
    process.stdout.write(
      `Policies whose stored expressions reference auth.*: ${authPolicyRefs.rows.map(row =>
        `${row.schemaname}.${row.tablename}.${row.policyname} [${row.expression.trim()}]`,
      ).join('; ') || 'none found'}.\n` +
      `Executable functions whose definitions/reference touch auth.*: ${authFunctionRefs.rows.map(row =>
        `${row.schema_name}.${row.function_name}(${row.identity_arguments}) SECURITY DEFINER=${row.security_definer} ${row.search_path ?? 'search_path=UNPINNED'}`,
      ).join('; ') || 'none found'}.\n`,
    );
    const pgtapFunctions = await client.query<{ name: string; executable: boolean }>(
      `SELECT p.proname::text AS name,
              has_function_privilege(session_user,p.oid,'EXECUTE') AS executable
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname=$1::text AND p.proname=ANY($2::text[])
       ORDER BY p.proname`,
      [pgtap.extension_schema, ["plan", "ok", "is", "throws_ok", "finish"]],
    );
    const missingPgtapFunctions = pgtapFunctions.rows.filter(row => !row.executable).map(row => row.name);
    process.stdout.write(
      `pgTAP function EXECUTE for TEST_DATABASE_URL role: ${missingPgtapFunctions.length ? `missing ${[...new Set(missingPgtapFunctions)].join(", ")}` : "available for plan/ok/is/throws_ok/finish overloads"}.\n`,
    );
    let result;
    try {
      result = await client.query(sql.slice(bootstrap[0].length));
    } catch (error) {
      const pgError = error as PgDiagnosticError;
      const position = Number(pgError.position);
      const absolutePosition = Number.isInteger(position) && position > 0 ? bootstrap[0].length + position : undefined;
      const line = Number.isInteger(position) && position > 0
        ? sql.slice(0, absolutePosition! - 1).split("\n").length
        : undefined;
      const beforeError = absolutePosition ? sql.slice(0, absolutePosition - 1) : "";
      const roleSwitch = beforeError.lastIndexOf("SET LOCAL ROLE rebatehq_app");
      const resetRole = beforeError.lastIndexOf("RESET ROLE");
      const roleContext = roleSwitch > resetRole ? "while current_user should be rebatehq_app" : "as the TEST_DATABASE_URL connection role";
      const fields = [
        ["where/context", pgError.where],
        ["routine", pgError.routine],
        ["position", pgError.position],
        ["internal position", pgError.internalPosition],
        ["detail", pgError.detail],
        ["hint", pgError.hint],
      ] as const;
      const fieldOutput = fields
        .map(([name, value]) => safeDiagnostic(value) ? `${name}: ${safeDiagnostic(value)}` : undefined)
        .filter((value): value is string => Boolean(value));
      const diagnosticOutput = fieldOutput.length ? `\n${fieldOutput.join("\n")}` : "";
      throw new Error(`Database test SQL failed${line ? ` at ${testFile}:${line}` : ""} ${roleContext}${pgError.code ? ` (SQLSTATE ${pgError.code})` : ""}: ${safeDiagnostic(pgError.message) ?? "Database query failed."}${diagnosticOutput}`);
    }
    const batches = Array.isArray(result) ? result : [result];
    const rows = batches.flatMap(batch => batch.rows as Array<Record<string, unknown>>);
    const authUidDiagnostics = rows
      .map(row => row.phase1_ci_diagnostic)
      .filter((value): value is string => typeof value === "string");
    for (const diagnostic of authUidDiagnostics) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(diagnostic) as Record<string, unknown>;
      } catch {
        process.stdout.write(`Auth UID privilege diagnostics (raw): ${diagnostic}\n`);
        continue;
      }
      process.stdout.write(
        `Auth UID and SECURITY DEFINER ACL evidence (Supabase-managed auth.uid; no migration grant/revoke attempted): ${JSON.stringify(parsed)}\n`,
      );
    }
    const lines = rows
      .filter(row => !Object.hasOwn(row, "phase1_ci_diagnostic"))
      .flatMap(row => Object.values(row).map(String));
    const tap = lines.filter(line => /^(?:ok|not ok)\s+\d+\b|^1\.\.\d+\b|^# (?:Looks like|Failed)/.test(line));
    const output = tap.join("\n");
    const plan = output.match(/^1\.\.(\d+)$/m);
    const passed = [...output.matchAll(/^ok\s+\d+\b/gm)].length;
    const failed = [...output.matchAll(/^not ok\s+\d+\b/gm)].length;
    const reportedMismatch = output.match(/^# Looks like you planned (\d+) tests but ran (\d+)$/m);
    const planned = plan ? Number(plan[1]) : 0;
    const ran = passed + failed;
    const expectedPlan = restoreMode ? restoreFixturePlan : expectedFixturePlan;
    if (!plan || planned !== expectedPlan || ran !== planned || passed !== planned || failed !== 0 || reportedMismatch) {
      const mismatch = reportedMismatch ? `; pgTAP reports planned ${reportedMismatch[1]} but ran ${reportedMismatch[2]}` : "";
      throw new Error(`pgTAP did not report all ${expectedPlan} checks passing (planned=${planned}, result_lines=${ran}${mismatch}).\n${output || "No TAP output was returned."}`);
    }
    process.stdout.write(`${output}\n`);
  } finally {
    await client.end();
  }
}

async function runLocalSupabase() {
  const { spawn } = await import("node:child_process");
  // The CLI must receive the same manifest and UUID materialization as the
  // direct-connection runner; the raw template is intentionally incomplete.
  const generatedName = `phase1-materialized-${randomUUID()}.sql`;
  const generatedPath = path.join(root, generatedName);
  await writeFile(generatedPath, materializeFixtureIds(await loadDatabaseTestSql()).sql, { flag: "wx" });
  try { await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm exec supabase test db ${generatedName}`]
      : ["exec", "supabase", "test", "db", generatedName];
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`supabase test db exited with code ${code ?? "unknown"}`)));
  }); } finally { await unlink(generatedPath); }
}

async function main() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (connectionString) await runPgtap(connectionString);
  else await runLocalSupabase();
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Database integration test failed."}\n`);
  process.exitCode = 1;
});
