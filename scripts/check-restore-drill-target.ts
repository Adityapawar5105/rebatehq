import assert from "node:assert/strict";
import { Client } from "pg";

async function main() {
  const databaseUrl = process.env.RESTORE_TEST_TARGET_DATABASE_URL;
  if (!databaseUrl) throw new Error("RESTORE_TEST_TARGET_DATABASE_URL is required.");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true },
  });
  try {
    await client.connect();
    const result = await client.query("SELECT to_regclass('public.tenant') IS NULL AS empty_app_schema");
    assert.equal(result.rows[0]?.empty_app_schema, true, "Restore target must be a fresh Supabase project with no MarginDesk public schema.");
    process.stdout.write("Restore target is fresh (public.tenant does not exist).\n");
  } finally {
    await client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Restore target is not fresh."}\n`);
  process.exitCode = 1;
});
