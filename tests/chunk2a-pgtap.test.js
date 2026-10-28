const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const root = path.join(__dirname, "..");
const foundation = fs.readFileSync(path.join(root, "supabase/migrations/202610240001_phase1_foundation.sql"), "utf8");
const chunk2a = fs.readFileSync(path.join(root, "supabase/migrations/202610280001_chunk2a_cost_units_currency.sql"), "utf8");
const databaseTests = fs.readFileSync(path.join(root, "supabase/tests/phase1_rls.sql"), "utf8");

function materialize(sql) {
  const tokens = [...new Set([...sql.matchAll(/__PHASE1_([A-Z0-9_]+_ID)__/g)].map(match => match[0]))];
  let result = sql;
  for (const token of tokens) result = result.replaceAll(token, randomUUID());
  assert.doesNotMatch(result, /__PHASE1_[A-Z0-9_]+_ID__/);
  return result;
}

test("full pgTAP SQL executes in PGlite with assertion stubs and planned checks match", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`
      CREATE SCHEMA extensions;
      CREATE SCHEMA auth;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY, aud text, role text, email text UNIQUE, encrypted_password text,
        email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;

      CREATE FUNCTION extensions.plan(p_count integer) RETURNS text LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM set_config('app.pgtap_plan',p_count::text,true);
        PERFORM set_config('app.pgtap_ran','0',true);
        RETURN '1..'||p_count;
      END $$;
      CREATE FUNCTION extensions.ok(p_value boolean,p_description text) RETURNS text LANGUAGE plpgsql AS $$
      DECLARE v_number integer;
      BEGIN
        v_number:=COALESCE(NULLIF(current_setting('app.pgtap_ran',true),''),'0')::integer+1;
        PERFORM set_config('app.pgtap_ran',v_number::text,true);
        IF p_value IS DISTINCT FROM true THEN RAISE EXCEPTION 'pgTAP stub check % failed: %',v_number,p_description; END IF;
        RETURN 'ok '||v_number||' - '||p_description;
      END $$;
      CREATE FUNCTION extensions.is(p_actual text,p_expected text,p_description text) RETURNS text LANGUAGE plpgsql AS $$
      DECLARE v_number integer;
      BEGIN
        v_number:=COALESCE(NULLIF(current_setting('app.pgtap_ran',true),''),'0')::integer+1;
        PERFORM set_config('app.pgtap_ran',v_number::text,true);
        IF p_actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'pgTAP stub check % failed: % (actual %, expected %)',v_number,p_description,p_actual,p_expected; END IF;
        RETURN 'ok '||v_number||' - '||p_description;
      END $$;
      CREATE FUNCTION extensions.is(p_actual integer,p_expected integer,p_description text) RETURNS text LANGUAGE plpgsql AS $$
      DECLARE v_number integer;
      BEGIN
        v_number:=COALESCE(NULLIF(current_setting('app.pgtap_ran',true),''),'0')::integer+1;
        PERFORM set_config('app.pgtap_ran',v_number::text,true);
        IF p_actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'pgTAP stub check % failed: % (actual %, expected %)',v_number,p_description,p_actual,p_expected; END IF;
        RETURN 'ok '||v_number||' - '||p_description;
      END $$;
      CREATE FUNCTION extensions.throws_ok(p_sql text,p_state text,p_message text,p_description text) RETURNS text LANGUAGE plpgsql AS $$
      DECLARE v_number integer; v_state text:='00000'; v_message text:='statement unexpectedly succeeded';
      BEGIN
        v_number:=COALESCE(NULLIF(current_setting('app.pgtap_ran',true),''),'0')::integer+1;
        PERFORM set_config('app.pgtap_ran',v_number::text,true);
        BEGIN EXECUTE p_sql;
        EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
        END;
        IF v_state IS DISTINCT FROM p_state OR (p_message IS NOT NULL AND v_message IS DISTINCT FROM p_message) THEN
          RAISE EXCEPTION 'pgTAP stub check % failed: % (actual SQLSTATE %, message %; expected SQLSTATE %, message %)',v_number,p_description,v_state,v_message,p_state,p_message;
        END IF;
        RETURN 'ok '||v_number||' - '||p_description;
      END $$;
      CREATE FUNCTION extensions.finish() RETURNS text LANGUAGE plpgsql AS $$
      DECLARE v_plan integer; v_ran integer;
      BEGIN
        v_plan:=current_setting('app.pgtap_plan')::integer;
        v_ran:=current_setting('app.pgtap_ran')::integer;
        IF v_plan<>v_ran THEN RAISE EXCEPTION 'planned % pgTAP checks but ran %',v_plan,v_ran; END IF;
        RETURN '1..'||v_plan||' ('||v_ran||' checks passed)';
      END $$;
    `);
    await db.exec(foundation);
    await db.exec(chunk2a);
    const { loadDatabaseTestSql } = await import("../scripts/load-db-test-sql.mjs");
    const sql = materialize(await loadDatabaseTestSql()).replace(
      /^CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;\s*$/m,
      "-- pgTAP assertion functions are locally stubbed for this PGlite run.",
    );
    await db.exec(sql);

    // Prove the shared registry rejects unknown functions and altered ACLs,
    // instead of checking only the currently expected happy-path inventory.
    const registry = fs.readFileSync(path.join(root, 'config/function-acl-allowlist.sql'), 'utf8');
    await db.exec("BEGIN; SELECT set_config('app.phase1_migration_owner',current_user,true);");
    await db.exec(registry);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_temp.phase1_function_acl_errors')).rows[0].n, 0);
    await db.exec('CREATE FUNCTION public.unregistered_later_function() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;');
    assert.ok((await db.query("SELECT reason FROM pg_temp.phase1_function_acl_errors WHERE signature='public.unregistered_later_function()'")).rows.some(row => row.reason === 'no allowlist entry'));
    await db.exec('DROP FUNCTION public.unregistered_later_function(); GRANT EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) TO anon;');
    assert.ok((await db.query("SELECT actual_grantees FROM pg_temp.phase1_function_acl_errors WHERE oid='public.convert_quantity(uuid,uuid,numeric,text,text,date)'::regprocedure")).rows[0].actual_grantees.includes('anon'));
    await db.exec('REVOKE EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) FROM anon; REVOKE EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) FROM margindesk_app;');
    assert.equal((await db.query("SELECT reason FROM pg_temp.phase1_function_acl_errors WHERE oid='public.convert_quantity(uuid,uuid,numeric,text,text,date)'::regprocedure")).rows[0].reason, 'EXECUTE grantees differ');
    await db.exec('ROLLBACK;');

    // Exercise the restore-only baseline and real-tenant isolation branches on
    // an already populated database, as Restore Drill does after data restore.
    const sentinelTenant = "61000000-0000-4000-8000-000000000001";
    const sentinelProduct = "62000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'PGlite restore sentinel','USD')", [sentinelTenant]);
    await db.query(`INSERT INTO public.product(tenant_id,id,sku,name,category,uom,unit_cost,list_price)
      VALUES($1,$2,'RESTORE-SENTINEL','PGlite restore product','Test','EA',30,100)`, [sentinelTenant,sentinelProduct]);
    const sentinel = (await db.query(`SELECT md5(jsonb_build_object(
      'tenant_id',p.tenant_id,'id',p.id,'sku',p.sku,'name',p.name,'category',p.category,
      'supplier',p.supplier,'uom',p.uom,'unit_cost',p.unit_cost,'freight_cost',p.freight_cost,
      'payment_terms_cost',p.payment_terms_cost,'list_price',p.list_price,'tier_prices',p.tier_prices,
      'active',p.active,'created_at_utc',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text) AS content_hash FROM public.product p WHERE p.tenant_id=$1 AND p.id=$2`, [sentinelTenant,sentinelProduct])).rows[0].content_hash;
    await db.exec(`
      CREATE TEMP TABLE phase1_restore_expected_tenant_counts(table_name text NOT NULL,tenant_id text,row_count bigint NOT NULL);
      DO $$ DECLARE t text; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
        LOOP
          EXECUTE format('INSERT INTO pg_temp.phase1_restore_expected_tenant_counts SELECT %L,tenant_id::text,count(*) FROM public.%I GROUP BY tenant_id::text',t,t);
        END LOOP;
      END $$;
    `);
    await db.query(`SELECT set_config('app.restore_test_mode','true',false),
      set_config('app.restore_sentinel_tenant_id',$1,false),
      set_config('app.restore_sentinel_product_id',$2,false),
      set_config('app.restore_sentinel_content_hash',$3,false)`, [sentinelTenant,sentinelProduct,sentinel]);
    await db.exec(sql);
  } finally {
    await db.close();
  }
});
