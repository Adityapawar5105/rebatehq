const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const repoRoot = path.join(__dirname, "..");
const phase1Sql = fs.readFileSync(path.join(repoRoot, "supabase", "tests", "phase1_rls.sql"), "utf8").replace(/\r\n/g,"\n");
const pgliteModule = import("@electric-sql/pglite");

// 8R: the 4 tables that keep fixtures in phase1_rls.sql (wave-1 and wave-2 tables were dropped). The quote and
// approval tables whose FK edge once broke arbitrary cloning (6R era) no longer exist on the server.
const tables = ["tenant", "membership", "invite", "audit_log"];
const existingTenant = "20000000-0000-4000-8000-000000000001";
const otherTenant = "20000000-0000-4000-8000-000000000002";
const existingOwner = "30000000-0000-4000-8000-000000000001";
const existingRep = "30000000-0000-4000-8000-000000000002";
const otherOwner = "30000000-0000-4000-8000-000000000003";

function extractFixtureGraph() {
  const startMarker = "-- Suite-owned auth users and tenants are inserted before dependent rows.";
  const endMarker = "SELECT extensions.ok(NOT EXISTS (\n SELECT 1 FROM pg_temp.phase1_rls_tables t WHERE NOT EXISTS (";
  const start = phase1Sql.indexOf(startMarker);
  const end = phase1Sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Could not find the explicit fixture graph SQL block.");
  return phase1Sql.slice(start, end);
}

function extractTableInventory() {
  const startMarker = "CREATE TEMP TABLE phase1_rls_tables(table_name text PRIMARY KEY);";
  const endMarker = "DO $$ DECLARE t text; n integer; v_sentinel jsonb;";
  const start = phase1Sql.indexOf(startMarker);
  const end = phase1Sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Could not find the tenant table inventory SQL.");
  return phase1Sql.slice(start, end);
}

function extractPositiveInsertLoop() {
  const start = phase1Sql.indexOf("DO $$ DECLARE t text; v_row jsonb; v_insert jsonb;");
  const end = phase1Sql.indexOf("END $$;", start);
  assert.ok(start >= 0 && end > start, "Could not find the positive-insert control loop SQL.");
  return phase1Sql.slice(start, end + "END $$;".length);
}

function materialize(sql, existingIds = undefined) {
  const tokens = [...new Set([...sql.matchAll(/__PHASE1_([A-Z0-9_]+_ID)__/g)].map(match => match[0]))];
  const ids = existingIds ?? new Map(tokens.map(token => [token, randomUUID()]));
  let output = sql;
  for (const [token, id] of ids) output = output.replaceAll(token, id);
  assert.doesNotMatch(output, /__PHASE1_[A-Z0-9_]+_ID__/);
  assert.equal(new Set(ids.values()).size, ids.size, "Fixture IDs must be independent and unique.");
  return { sql: output, ids };
}

async function createHarnessSchema(db) {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, aud text, role text, email text UNIQUE, encrypted_password text,
      email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE public.tenant (
      tenant_id uuid PRIMARY KEY, name text, created_by uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.membership (
      tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), user_id uuid NOT NULL REFERENCES auth.users(id),
      email text, role text, PRIMARY KEY(tenant_id,user_id)
    );
    CREATE TABLE public.invite (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), email text, role text,
      token_hash text NOT NULL UNIQUE, invited_by uuid REFERENCES auth.users(id), expires_at timestamptz
    );
    CREATE TABLE public.audit_log (
      id uuid PRIMARY KEY, tenant_id uuid, actor_id uuid, action text, entity_type text, entity_id text
    );
  `);
}

async function seedRestoredRows(db) {
  await db.query(`INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) VALUES
    ($1,'authenticated','authenticated','old-owner@example.invalid','',now(),now()),
    ($2,'authenticated','authenticated','old-rep@example.invalid','',now(),now()),
    ($3,'authenticated','authenticated','other-owner@example.invalid','',now(),now())`, [existingOwner, existingRep, otherOwner]);
  await db.query(`INSERT INTO public.tenant(tenant_id,name,created_by) VALUES
    ($1,'Restored tenant one',$3),($2,'Restored tenant two',$4)`, [existingTenant, otherTenant, existingOwner, otherOwner]);
  await db.query(`INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES
    ($1,$3,'old-owner@example.invalid','owner'),($1,$4,'old-rep@example.invalid','rep'),
    ($2,$5,'other-owner@example.invalid','owner')`, [existingTenant, otherTenant, existingOwner, existingRep, otherOwner]);

  await db.query(`INSERT INTO public.invite(id,tenant_id,email,role,token_hash,invited_by,expires_at) VALUES
    ($1,$2,'old-one@example.invalid','rep','old-invite-token-one',$3,now()+interval '7 days'),
    ($4,$2,'old-two@example.invalid','manager','old-invite-token-two',$3,now()+interval '7 days'),
    ($5,$6,'other@example.invalid','analyst','other-invite-token',$7,now()+interval '7 days')`, [
      randomUUID(), existingTenant, existingOwner, randomUUID(), randomUUID(), otherTenant, otherOwner,
    ]);

  let counter = 1;
  for (const tenantId of [existingTenant, existingTenant, otherTenant]) {
    const id = `90000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
    await db.query("INSERT INTO public.audit_log(id,tenant_id,action,entity_type,entity_id) VALUES($1,$2,'restored.row','tenant',$3)", [id, tenantId, tenantId]);
  }
}

async function snapshotAllTenantTables(db) {
  const snapshot = {};
  for (const table of tables) {
    const result = await db.query(`SELECT count(*)::int AS count FROM public."${table}"`);
    snapshot[table] = result.rows[0].count;
  }
  return snapshot;
}

test("PGlite runs the explicit fixture graph against restored rows and rolls back cleanly", async () => {
  const { PGlite } = await pgliteModule;
  const db = new PGlite();
  try {
    await createHarnessSchema(db);
    await seedRestoredRows(db);

    const sourceCounts = {};
    for (const table of tables) {
      const count = await db.query(`SELECT count(*)::int AS count FROM public."${table}" WHERE tenant_id=$1`, [existingTenant]);
      sourceCounts[table] = count.rows[0].count;
    }
    assert.equal(sourceCounts.membership, 2);
    assert.equal(sourceCounts.invite, 2);
    assert.ok(tables.every(table => sourceCounts[table] >= 1), "Every tenant table has pre-existing source rows.");

    const positiveInvite = await db.query(`
      WITH sample AS (SELECT jsonb_build_object('id',$1::text) AS v_insert)
      SELECT jsonb_set(v_insert,'{token_hash}',to_jsonb(replace(v_insert->>'id','-','')),true) AS with_token,
             jsonb_set(v_insert,'{email}',to_jsonb('phase1-positive-'||(v_insert->>'id')||'@example.invalid'),true) AS with_email
      FROM sample
    `, [randomUUID()]);
    assert.match(positiveInvite.rows[0].with_token.token_hash, /^[0-9a-f]{32}$/);
    assert.match(positiveInvite.rows[0].with_email.email, /^phase1-positive-[0-9a-f-]{36}@example\.invalid$/);

    const tableInventory = extractTableInventory();
    const beforeGraph = await snapshotAllTenantTables(db);
    assert.ok(tables.every(table => beforeGraph[table] >= 2), "The restored-data harness must have multiple pre-existing rows in every tenant table.");
    for (let run = 1; run <= 2; run += 1) {
      const runGraph = materialize(extractFixtureGraph());
      await db.exec("BEGIN;");
      await db.exec(tableInventory);
      await db.exec(runGraph.sql);
      await db.exec(materialize(extractPositiveInsertLoop(), runGraph.ids).sql);
      const positiveInsertResult = await db.query("SELECT current_setting('app.phase1_positive_insert_result')::jsonb AS result");
      assert.equal(positiveInsertResult.rows[0].result.passed, true, `Positive insert SQL should execute for every fixture table: ${JSON.stringify(positiveInsertResult.rows[0].result)}`);

      const actualTables = (await db.query("SELECT table_name FROM pg_temp.phase1_rls_tables ORDER BY table_name")).rows.map(row => row.table_name);
      assert.deepEqual(actualTables, [...tables].sort());
      const tenantAFixtures = await db.query("SELECT table_name,row_data FROM pg_temp.phase1_rls_tenant_a_fixtures ORDER BY table_name");
      const tenantBFixtures = await db.query("SELECT table_name,row_data FROM pg_temp.phase1_rls_insert_fixtures ORDER BY table_name");
      assert.equal(tenantAFixtures.rows.length, 4);
      assert.equal(tenantBFixtures.rows.length, 4);

      const ids = runGraph.ids;
      const tenantA = ids.get("__PHASE1_TENANT_A_ID__");
      const tenantB = ids.get("__PHASE1_TENANT_B_ID__");
      for (const row of tenantAFixtures.rows) assert.equal(row.row_data.tenant_id, tenantA, `Tenant A map must reference the suite-created tenant for ${row.table_name}.`);
      for (const row of tenantBFixtures.rows) assert.equal(row.row_data.tenant_id, tenantB, `Tenant B map must reference the suite-created tenant for ${row.table_name}.`);
      const storedInvite = await db.query("SELECT invited_by::text FROM public.invite WHERE tenant_id=$1 AND id=$2", [tenantA, ids.get("__PHASE1_INVITE_A_ID__")]);
      assert.equal(storedInvite.rows[0].invited_by, ids.get("__PHASE1_USER_A_ID__"));
      const preservedSourceRows = await db.query("SELECT count(*)::int AS count FROM public.invite WHERE tenant_id=$1", [existingTenant]);
      assert.equal(preservedSourceRows.rows[0].count, 2, "The builder must leave restored source invites untouched.");
      await db.exec("ROLLBACK;");
      assert.deepEqual(await snapshotAllTenantTables(db), beforeGraph, `Fixture graph run ${run} must leave every tenant table unchanged after rollback.`);
    }
    console.log("Explicit Tenant A/B fixture graph passed twice with 4 tenant tables and pre-existing multi-row restored data; both transactions rolled back with unchanged row counts.");
  } finally {
    await db.close();
  }
});
