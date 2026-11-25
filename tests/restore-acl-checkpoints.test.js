const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("restore ACL checkpoint query executes and names the exact stage that loses an app grant", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { FUNCTION_ACL_SQL, assertAppGrantsPreserved } = await import("../scripts/inspect-restore-function-acls.mjs");
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE rebatehq_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon;
      CREATE FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) RETURNS numeric LANGUAGE sql AS $$ SELECT $3 $$;
      CREATE FUNCTION public.record_data_quality_issue(uuid,text,text,text,date,jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT $1 $$;
      REVOKE ALL ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date), public.record_data_quality_issue(uuid,text,text,text,date,jsonb) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date), public.record_data_quality_issue(uuid,text,text,text,date,jsonb) TO rebatehq_app;
    `);
    const source = (await db.query(FUNCTION_ACL_SQL)).rows;
    assert.equal(new Set(source.map(row => row.function_name)).size, 2);
    assert.ok(source.every(row => row.owner === "postgres" && row.grantor === "postgres"));
    await db.exec("GRANT EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) TO anon");
    const schema = (await db.query(FUNCTION_ACL_SQL)).rows;
    assertAppGrantsPreserved(source,schema,"source","after-schema");
    await db.exec("REVOKE ALL ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) FROM anon");
    const cleanup = (await db.query(FUNCTION_ACL_SQL)).rows;
    assertAppGrantsPreserved(schema,cleanup,"after-schema","after-cleanup");
    assert.deepEqual(cleanup,source);
    await db.exec("REVOKE EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) FROM rebatehq_app");
    const broken = (await db.query(FUNCTION_ACL_SQL)).rows;
    assert.throws(() => assertAppGrantsPreserved(cleanup,broken,"after-cleanup","after-data"), /after-cleanup -> after-data[\s\S]*convert_quantity/);
    assert.throws(() => assertAppGrantsPreserved([],[],"source","after-schema"), /vacuous comparison/);
  } finally { await db.close(); }
});

test("workflow order diagnostic prints every named step and local/hosted conditions in execution order", async () => {
  const { formatRestoreStepOrder } = await import("../scripts/inspect-restore-function-acls.mjs");
  const workflow = fs.readFileSync(path.join(__dirname,"..",".github/workflows/restore-drill.yml"),"utf8");
  const result = formatRestoreStepOrder(workflow);
  assert.equal(result.split("\n").length-1,[...workflow.matchAll(/^      - name:/gm)].length);
  assert.match(result,/Start source Supabase and apply migrations \(local\) \[if: inputs.target == 'local'\]/);
  assert.ok(result.indexOf("Capture source function ACL checkpoint") < result.indexOf("Restore owned roles and application schema (local)"));
  assert.ok(result.indexOf("Capture function ACLs immediately after schema restore") < result.indexOf("Remove target platform ACL additions (local)"));
  assert.ok(result.indexOf("Capture function ACLs after data restore") < result.indexOf("Compare restored role attributes"));
  assert.match(result,/Stop local target stack \[if: always\(\) && inputs.target == 'local'\]/);
});

test("restore checkpoint focus functions exist after every migration and keep their app grant (6R regression)", async () => {
  // Restore Drill #17 failed because the checkpoint still required two functions 6R dropped.
  const { FOCUS_FUNCTIONS } = await import("../scripts/inspect-restore-function-acls.mjs");
  const registry = fs.readFileSync(path.join(__dirname, "..", "config", "function-acl-allowlist.sql"), "utf8");
  assert.ok(FOCUS_FUNCTIONS.length >= 2);
  for (const name of FOCUS_FUNCTIONS) assert.match(registry, new RegExp(`'public\\.${name}\\([^)]*\\)',ARRAY\\[[^\\]]*'rebatehq_app'`), `${name} must be registered with a rebatehq_app grant`);
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const { FUNCTION_ACL_SQL } = await import("../scripts/inspect-restore-function-acls.mjs");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    await db.exec(fs.readFileSync(path.join(__dirname, "helpers", "storage-stub.sql"), "utf8"));
    for (const name of fs.readdirSync(path.join(__dirname, "..", "supabase", "migrations")).filter(n => n.endsWith(".sql")).sort())
      await db.exec(fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", name), "utf8"));
    const rows = (await db.query(FUNCTION_ACL_SQL)).rows;
    for (const name of FOCUS_FUNCTIONS) assert.ok(rows.some(row => row.function_name === name && row.grantee === "rebatehq_app"), `${name} exists with its rebatehq_app EXECUTE grant after all migrations`);
  } finally { await db.close(); }
});
