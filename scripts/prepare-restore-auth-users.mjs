import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const inventoryPath = process.argv[2];
if (!inventoryPath) throw new Error("Usage: node scripts/prepare-restore-auth-users.mjs <dump-inventory.json>");
const databaseUrl = process.env.RESTORE_TEST_TARGET_DATABASE_URL;
if (!databaseUrl) throw new Error("RESTORE_TEST_TARGET_DATABASE_URL is required.");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
assert.ok(Array.isArray(inventory.authUserIds), "Dump inventory must include the source auth.users foreign-key IDs.");
assert.ok(inventory.authUserIds.every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)), "Auth dependency IDs must be UUIDs.");

const pool = new Pool({ connectionString: databaseUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true } });
try {
  const prerequisites = await pool.query(`
    SELECT to_regclass('auth.users') IS NOT NULL AS auth_users_exists,
           to_regnamespace('extensions') IS NOT NULL AS extensions_schema_exists,
           EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS pgcrypto_exists
  `);
  assert.equal(prerequisites.rows[0]?.auth_users_exists, true, "Fresh Supabase target must provide auth.users before restore.");
  assert.equal(prerequisites.rows[0]?.extensions_schema_exists, true, "Fresh Supabase target must provide the platform extensions schema.");
  assert.equal(prerequisites.rows[0]?.pgcrypto_exists, true, "Fresh Supabase target must provide pgcrypto; extensions is intentionally not restored from source.");

  let inserted = 0;
  for (const id of inventory.authUserIds) {
    const email = `restore-ref-${id}@example.invalid`;
    const result = await pool.query(`
      INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      VALUES ($1::uuid,'authenticated','authenticated',$2::text,'',NULL,now(),now())
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `, [id, email]);
    inserted += result.rowCount;
  }
  const found = inventory.authUserIds.length
    ? Number((await pool.query("SELECT count(*)::int AS count FROM auth.users WHERE id=ANY($1::uuid[])", [inventory.authUserIds])).rows[0].count)
    : 0;
  assert.equal(found, inventory.authUserIds.length, "Not every application foreign-key auth.users ID exists in the target after creating stand-ins.");
  process.stdout.write(`Prepared ${inserted} synthetic auth.users stand-in(s); verified ${found} referenced IDs. No source emails, password hashes, or auth secrets were copied.\n`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const fs = await import("node:fs");
    fs.appendFileSync(summary, `### Restore auth dependency preparation\n\n- Synthetic ` + "`auth.users`" + ` stand-ins inserted: ${inserted}; total referenced IDs verified: ${found}.\n- Only source IDs required by public foreign keys were carried forward; email addresses, password hashes, and other auth fields were not copied.\n- The fresh Supabase target's platform ` + "`extensions`" + ` schema and ` + "`pgcrypto`" + ` extension were checked and retained in place.\n\n`, "utf8");
  }
} finally {
  await pool.end();
}
