import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFile = path.join(root, "supabase", "tests", "phase1_rls.sql");

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
               has_schema_privilege('margindesk_app',n.oid,'USAGE') AS app_usage,
               (SELECT pg_get_userbyid(e.extowner)::text FROM pg_extension e
                WHERE e.extname='pgtap' AND e.extnamespace=n.oid) AS pgtap_owner
        FROM pg_namespace n WHERE n.nspname='extensions'`);
    const extension = extensionAccess.rows[0];
    if (extension) {
      process.stdout.write(
        `Extension schema ${extension.schema_name}: owner=${extension.schema_owner}, ` +
        `TEST_DATABASE_URL_USAGE=${extension.connection_usage}, margindesk_app_USAGE=${extension.app_usage}, ` +
        `pgTAP_owner=${extension.pgtap_owner ?? "not-installed-yet"}.\n`,
      );
    } else {
      process.stdout.write("Extension schema extensions does not exist before the pgTAP test starts.\n");
    }
    const sql = await readFile(testFile, "utf8");
    const bootstrap = /^\s*BEGIN\s*;\s*CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgtap\s+WITH\s+SCHEMA\s+extensions\s*;\s*/i.exec(sql);
    if (!bootstrap) throw new Error("The pgTAP SQL file must begin with BEGIN; and CREATE EXTENSION pgtap WITH SCHEMA extensions;.");
    try {
      await client.query(bootstrap[0]);
    } catch (error) {
      const pgError = error as Error & { code?: string };
      throw new Error(`pgTAP bootstrap failed as TEST_DATABASE_URL role ${connection.login_role}${pgError.code ? ` (SQLSTATE ${pgError.code})` : ""}: ${pgError.message}`);
    }
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
               has_schema_privilege('margindesk_app',n.oid,'USAGE') AS app_usage
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
        WHERE e.extname='pgtap'`);
    const pgtap = installedPgtap.rows[0];
    if (!pgtap) throw new Error("pgTAP extension was not installed after its bootstrap statement.");
    process.stdout.write(
      `pgTAP installed in schema ${pgtap.extension_schema}; extension owner=${pgtap.extension_owner}; ` +
      `schema owner=${pgtap.schema_owner}; TEST_DATABASE_URL_USAGE=${pgtap.connection_usage}; ` +
      `margindesk_app_USAGE=${pgtap.app_usage}.\n`,
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
       WHERE has_function_privilege('margindesk_app',p.oid,'EXECUTE')
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
      const roleSwitch = beforeError.lastIndexOf("SET LOCAL ROLE margindesk_app");
      const resetRole = beforeError.lastIndexOf("RESET ROLE");
      const roleContext = roleSwitch > resetRole ? "while current_user should be margindesk_app" : "as the TEST_DATABASE_URL connection role";
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
    const lines = rows.flatMap(row => Object.values(row).map(String));
    const tap = lines.filter(line => /^(?:ok|not ok)\s+\d+\b|^1\.\.\d+\b|^# (?:Looks like|Failed)/.test(line));
    const output = tap.join("\n");
    const plan = output.match(/^1\.\.(\d+)$/m);
    const passed = [...output.matchAll(/^ok\s+\d+\b/gm)].length;
    const failed = [...output.matchAll(/^not ok\s+\d+\b/gm)].length;
    if (!plan || Number(plan[1]) !== 37 || passed !== 37 || failed !== 0) {
      throw new Error(`pgTAP did not report all 37 checks passing.\n${output || "No TAP output was returned."}`);
    }
    process.stdout.write(`${output}\n`);
  } finally {
    await client.end();
  }
}

async function runLocalSupabase() {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm exec supabase test db"]
      : ["exec", "supabase", "test", "db"];
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`supabase test db exited with code ${code ?? "unknown"}`)));
  });
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
