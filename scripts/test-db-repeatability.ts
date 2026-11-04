import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { assertTenantRowCountsEqual } from "./tenant-row-counts.mjs";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function snapshotTenantRows(pool: Pool): Promise<Record<string, Array<{ tenant_id: string | null; row_count: string }>>> {
  const tables = await pool.query<{ table_name: string }>(`
    SELECT c.relname::text AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped
    GROUP BY c.relname
    ORDER BY c.relname
  `);
  assert.ok(tables.rows.length >= 42, `Repeatability check found only ${tables.rows.length} tenant tables; expected at least 42 after Chunk 5B.`);
  const result: Record<string, Array<{ tenant_id: string | null; row_count: string }>> = {};
  for (const { table_name: table } of tables.rows) {
    result[table] = (await pool.query<{ tenant_id: string | null; row_count: string }>(
      `SELECT tenant_id::text,count(*)::text AS row_count FROM public.${quoteIdentifier(table)} GROUP BY tenant_id::text ORDER BY tenant_id::text NULLS FIRST`,
    )).rows;
  }
  return result;
}

async function runDatabaseSuite(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const windows = process.platform === "win32";
    const command = windows ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
    const args = windows ? ["/d", "/s", "/c", "pnpm test:db"] : ["test:db"];
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`pnpm test:db exited with code ${code ?? "unknown"}.`)));
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required for repeatability verification.");
  const pool = new Pool({
    connectionString,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(connectionString) ? false : { rejectUnauthorized: true },
  });
  try {
    const before = await snapshotTenantRows(pool);
    process.stdout.write("Repeatability baseline captured for every public tenant table.\n");
    await runDatabaseSuite();
    const afterFirst = await snapshotTenantRows(pool);
    assertTenantRowCountsEqual(before, afterFirst, "The first pgTAP run left application tenant rows behind");
    process.stdout.write("First pgTAP run passed; tenant row counts match the pre-run baseline.\n");
    await runDatabaseSuite();
    const afterSecond = await snapshotTenantRows(pool);
    assertTenantRowCountsEqual(before, afterSecond, "The second pgTAP run left application tenant rows behind or changed source data");
    process.stdout.write("Second pgTAP run passed on the same database; tenant row counts still match the original baseline.\n");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : "Database repeatability check failed."}\n`);
  process.exitCode = 1;
});
