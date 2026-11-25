// Team sharing S3: restore dumps exclude the Supabase storage schema, so the restore drill re-applies the relay-packs
// bucket and policies from scripts/restore-storage-objects.sql. It must stay identical to the migration's definitions.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const policies = sql => [...sql.matchAll(/CREATE POLICY[\s\S]*?\);/g)].map(m => m[0].replace(/\s+/g, " "));
const bucket = sql => (/VALUES\('relay-packs'[^;\n]*/.exec(sql) || [""])[0];

test("the restore drill re-applies exactly the migration's relay-packs bucket and policies", () => {
  const migration = read("supabase/migrations/20261126120000_sharing_s3_storage.sql"), restore = read("scripts/restore-storage-objects.sql");
  assert.equal(policies(migration).length, 2);
  assert.deepEqual(policies(restore), policies(migration));
  assert.equal(bucket(restore), bucket(migration));
  assert.match(restore, /DROP POLICY IF EXISTS relay_packs_read ON storage\.objects;/);
  assert.match(restore, /ON CONFLICT \(id\) DO UPDATE/);
  const drill = read(".github/workflows/restore-drill.yml");
  assert.match(drill, /cp scripts\/restore-storage-objects\.sql/);
  const local = drill.indexOf("Re-apply Storage bucket and policies (local)"), hosted = drill.indexOf("Re-apply Storage bucket and policies (hosted)");
  assert.ok(local > 0 && hosted > 0);
  assert.ok(drill.indexOf("Restore application data (hosted)") < local, "after the data restore");
  assert.ok(hosted < drill.indexOf("Re-run full RLS and append-only suite"), "before pgTAP");
  assert.match(read("RESTORE_RUNBOOK.md"), /restore-storage-objects\.sql/);
});

test("the re-apply script runs twice in PGlite after every migration and leaves one bucket and two policies", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    await db.exec(read("tests/helpers/storage-stub.sql"));
    for (const name of fs.readdirSync(path.join(root, "supabase/migrations")).filter(n => n.endsWith(".sql")).sort()) await db.exec(read("supabase/migrations/" + name));
    // As after a restore: the dump brought rebatehq_storage, but the storage rows and policies are gone.
    await db.exec("DROP POLICY relay_packs_read ON storage.objects;DROP POLICY relay_packs_write ON storage.objects;DELETE FROM storage.buckets;");
    for (let i = 0; i < 2; i++) await db.exec(read("scripts/restore-storage-objects.sql"));
    assert.deepEqual((await db.query("SELECT id,public,file_size_limit::text AS l FROM storage.buckets")).rows, [{ id: "relay-packs", public: false, l: "524400" }]);
    assert.deepEqual((await db.query("SELECT policyname,cmd FROM pg_policies WHERE schemaname='storage' ORDER BY policyname")).rows.map(r => [r.policyname, r.cmd]), [["relay_packs_read", "SELECT"], ["relay_packs_write", "INSERT"]]);
  } finally { await db.close(); }
});
