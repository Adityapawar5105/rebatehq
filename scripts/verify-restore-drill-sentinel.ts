import assert from "node:assert/strict";
import { Client } from "pg";

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true },
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM public.licence_location
        WHERE tenant_id='61000000-0000-4000-8000-000000000001'
          AND id='62000000-0000-4000-8000-000000000001'
          AND name='RESTORE-SENTINEL'
      ) AS restored
    `);
    assert.equal(result.rows[0]?.restored, true, "Seed sentinel must exist in restored database.");
    process.stdout.write("Restore sentinel is present in the restored database.\n");
  } finally {
    await client.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Restore sentinel was not found."}\n`);
  process.exitCode = 1;
});
