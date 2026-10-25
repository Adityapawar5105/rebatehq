import { appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const roleName = "margindesk_app_login";

function sqlFailure(step: string, displaySql: string, error: unknown, secret?: string): Error {
  const rawDetail = error instanceof Error ? error.message.split("\n")[0] : "unknown database error";
  const detail = secret ? rawDetail.replaceAll(secret, "[redacted]") : rawDetail;
  return new Error(`SQL step failed: ${step}\n${displaySql}\n${detail}`);
}

async function quotedRoleGrant(admin: Pool, grantedRole: string, memberRole: string, version: number) {
  const template = version >= 160000
    ? "GRANT %I TO %I WITH INHERIT FALSE, SET TRUE"
    : "GRANT %I TO %I";
  const built = await admin.query<{ sql: string }>(
    "SELECT format($1::text, $2::text, $3::text) AS sql",
    [template, grantedRole, memberRole],
  );
  await admin.query(built.rows[0].sql);
}

async function main() {
  const adminUrl = process.env.SEED_DATABASE_URL;
  if (!adminUrl) throw new Error("Set SEED_DATABASE_URL to the disposable local Supabase postgres connection.");
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error("GITHUB_ENV is required so the generated password can be passed without printing or writing it elsewhere.");
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("Set TEST_DATABASE_URL to the disposable database connection used by pnpm test:db.");
  const testLogin = decodeURIComponent(new URL(testUrl).username);
  if (!testLogin) throw new Error("TEST_DATABASE_URL must include its database login username.");
  const adminTarget = new URL(adminUrl);
  const testTarget = new URL(testUrl);
  if (adminTarget.hostname !== testTarget.hostname || adminTarget.port !== testTarget.port || adminTarget.pathname !== testTarget.pathname) {
    throw new Error("SEED_DATABASE_URL and TEST_DATABASE_URL must target the same disposable database.");
  }
  const password = randomBytes(32).toString("base64url");
  // GitHub masks subsequent log occurrences of this value. The value is never
  // included in an error, status message, or generated source file.
  process.stdout.write(`::add-mask::${password}\n`);
  const admin = new Pool({ connectionString: adminUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(adminUrl) ? false : { rejectUnauthorized: true } });
  try {
    let version: number;
    let testRole: { rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean } | undefined;
    try {
      const database = await admin.query<{ server_version_num: number }>(
        "SELECT current_setting('server_version_num')::int AS server_version_num",
      );
      version = database.rows[0].server_version_num;
      const role = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
        "SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1::text",
        [testLogin],
      );
      testRole = role.rows[0];
      if (!testRole) throw new Error("The TEST_DATABASE_URL login does not exist in the target database.");
      process.stdout.write(`Disposable test database: PostgreSQL ${Math.floor(version / 10000)}; test login ${testRole.rolname} (LOGIN=${testRole.rolcanlogin}, SUPERUSER=${testRole.rolsuper}, BYPASSRLS=${testRole.rolbypassrls}).\n`);
    } catch (error) {
      throw sqlFailure("inspect disposable test database role", "SELECT server_version_num and pg_roles attributes for TEST_DATABASE_URL login", error, password);
    }

    let exists;
    try {
      exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1::text", [roleName]);
    } catch (error) {
      throw sqlFailure("check app login role", "SELECT 1 FROM pg_roles WHERE rolname=$1::text", error, password);
    }

    const ddlTemplate = exists.rowCount
      ? "ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L"
      : "CREATE ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L";
    let statement: { sql: string };
    try {
      statement = (await admin.query<{ sql: string }>(
        "SELECT format($1::text, $2::text, $3::text) AS sql",
        [ddlTemplate, roleName, password],
      )).rows[0];
    } catch (error) {
      throw sqlFailure("build app login DDL", "SELECT format($1::text, $2::text, $3::text) AS sql", error, password);
    }

    try {
      await admin.query(statement.sql);
    } catch (error) {
      throw sqlFailure("create or alter app login", statement.sql.replace(/PASSWORD\s+'[^']*'/i, "PASSWORD '[redacted]'"), error, password);
    }
    try {
      await quotedRoleGrant(admin, "margindesk_app", roleName, version);
    } catch (error) {
      throw sqlFailure("grant application role membership", "GRANT margindesk_app TO margindesk_app_login WITH INHERIT FALSE, SET TRUE (PostgreSQL 16+)", error, password);
    }
    try {
      if (testLogin === "margindesk_app") {
        throw new Error("TEST_DATABASE_URL must connect as a login distinct from margindesk_app.");
      }
      await quotedRoleGrant(admin, "margindesk_app", testLogin, version);
    } catch (error) {
      throw sqlFailure("grant test connection role membership", "GRANT margindesk_app TO <TEST_DATABASE_URL login> WITH INHERIT FALSE, SET TRUE (PostgreSQL 16+)", error, password);
    }
    try {
      // CI-only membership lets the disposable pgTAP connection SET ROLE anon
      // for real ACL-denial probes; no production migration grants this role.
      await quotedRoleGrant(admin, "anon", testLogin, version);
    } catch (error) {
      throw sqlFailure("grant disposable test login anon role-switch permission", "GRANT anon TO <TEST_DATABASE_URL login> WITH INHERIT FALSE, SET TRUE (PostgreSQL 16+)", error, password);
    }

    const appUrl = new URL(adminUrl);
    appUrl.username = roleName;
    appUrl.password = password;
    await appendFile(githubEnv, `APP_DATABASE_URL=${appUrl.toString()}\n`);
    process.stdout.write("Restricted app database login added to the CI environment.\n");
  } finally {
    await admin.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Could not prepare the disposable app database login."}\n`);
  process.exitCode = 1;
});
