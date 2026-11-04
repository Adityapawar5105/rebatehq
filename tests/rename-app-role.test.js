const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const root = path.join(__dirname, '..');
const migrationName = '20261104120000_rename_app_role_to_rebatehq.sql';
const migration = fs.readFileSync(path.join(root, 'supabase/migrations', migrationName), 'utf8');

async function database() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec(`CREATE SCHEMA extensions; CREATE SCHEMA auth;
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const name of fs.readdirSync(path.join(root, 'supabase/migrations')).filter(n => n.endsWith('.sql') && n < migrationName).sort()) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  return db;
}

test('role rename keeps grants, policies and function ACLs and renames only the import price list', async () => {
  const db = await database();
  try {
    const tenant = randomUUID();
    await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'Existing tenant','USD')", [tenant]);
    await db.query("INSERT INTO public.price_list(id,tenant_id,name,currency) VALUES($1,$3,'MarginDesk file imports','USD'),($2,$3,'Customer list','USD')", [randomUUID(), randomUUID(), tenant]);
    const privileges = async role => (await db.query(`SELECT
      has_table_privilege($1,'public.customer','SELECT') AS select_customer,
      has_table_privilege($1,'public.audit_log','UPDATE') AS update_audit,
      has_function_privilege($1,'public.is_tenant_member(uuid)','EXECUTE') AS member_fn,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polroles @> ARRAY[$1::regrole::oid]) AS policies`, [role])).rows[0];
    const before = await privileges('margindesk_app');
    assert.equal(before.select_customer, true);
    assert.equal(before.update_audit, false);
    assert.ok(before.policies > 0);

    await db.exec(migration);

    assert.equal((await db.query("SELECT to_regrole('margindesk_app') AS old_role,to_regrole('rebatehq_app') AS new_role")).rows[0].old_role, null);
    assert.deepEqual(await privileges('rebatehq_app'), before, 'Renamed role must keep identical grants, policies and function ACLs');
    const attributes = (await db.query("SELECT rolcanlogin,rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='rebatehq_app'")).rows[0];
    assert.deepEqual(attributes, { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false });
    const names = (await db.query('SELECT name FROM public.price_list ORDER BY name')).rows.map(r => r.name);
    assert.deepEqual(names, ['Customer list', 'RebateHQ file imports']);

    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT name FROM public.price_list ORDER BY name')).rows.map(r => r.name), names, 'Re-running the migration must be a no-op');
  } finally { await db.close(); }
});

test('role rename refuses to run when both role names exist or neither exists', async () => {
  const db = await database();
  try {
    await db.exec('CREATE ROLE rebatehq_app');
    await assert.rejects(db.exec(migration), /Both margindesk_app and rebatehq_app exist/);
    await db.exec('DROP ROLE rebatehq_app; ALTER ROLE margindesk_app RENAME TO unrelated_role');
    await assert.rejects(db.exec(migration), /Neither margindesk_app nor rebatehq_app exists/);
  } finally { await db.close(); }
});
