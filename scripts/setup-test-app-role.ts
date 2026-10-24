import { appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const roleName = "margindesk_app_login";

function sqlFailure(step: string, displaySql: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message.split("\n")[0] : "unknown database error";
  return new Error(`SQL step failed: ${step}\n${displaySql}\n${detail}`);
}

async function main() {
  const adminUrl = process.env.SEED_DATABASE_URL;
  if (!adminUrl) throw new Error("Set SEED_DATABASE_URL to the disposable local Supabase postgres connection.");
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) throw new Error("GITHUB_ENV is required so the generated password can be passed without printing or writing it elsewhere.");
  const password = randomBytes(32).toString("base64url");
  // GitHub masks subsequent log occurrences of this value. The value is never
  // included in an error, status message, or generated source file.
  process.stdout.write(`::add-mask::${password}\n`);
  const admin = new Pool({ connectionString: adminUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(adminUrl) ? false : { rejectUnauthorized: true } });
  try {
    let exists;
    try {
      exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1::text", [roleName]);
    } catch (error) {
      throw sqlFailure("check app login role", "SELECT 1 FROM pg_roles WHERE rolname=$1::text", error);
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
      throw sqlFailure("build app login DDL", "SELECT format($1::text, $2::text, $3::text) AS sql", error);
    }

    try {
      await admin.query(statement.sql);
    } catch (error) {
      throw sqlFailure("create or alter app login", statement.sql.replace(/PASSWORD\s+'[^']*'/i, "PASSWORD '[redacted]'"), error);
    }
    try {
      await admin.query("GRANT margindesk_app TO margindesk_app_login");
    } catch (error) {
      throw sqlFailure("grant application role membership", "GRANT margindesk_app TO margindesk_app_login", error);
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
