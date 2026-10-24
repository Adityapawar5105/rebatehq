import { appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

async function main() {
const adminUrl = process.env.SEED_DATABASE_URL;
if (!adminUrl) throw new Error("Set SEED_DATABASE_URL to the disposable local Supabase postgres connection.");
const roleName = "margindesk_app_login";
const password = randomBytes(32).toString("base64url");
const admin = new Pool({ connectionString: adminUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(adminUrl) ? false : { rejectUnauthorized: true } });
try {
  const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [roleName]);
  const statement = await admin.query<{ sql: string }>(
    "SELECT format($1, $2, $3) AS sql",
    [exists.rowCount ? "ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L" : "CREATE ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L", roleName, password]
  );
  await admin.query(statement.rows[0].sql);
  await admin.query("GRANT margindesk_app TO margindesk_app_login");
  const appUrl = new URL(adminUrl);
  appUrl.username = roleName;
  appUrl.password = password;
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `APP_DATABASE_URL=${appUrl.toString()}\n`);
    process.stdout.write("Restricted app database login added to the CI environment.\n");
  } else {
    process.stdout.write(`Set this for the next command (local disposable DB only):\n$env:APP_DATABASE_URL = '${appUrl.toString()}'\n`);
  }
} finally {
  await admin.end();
}
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Could not prepare the disposable app database login."}\n`);
  process.exitCode = 1;
});
