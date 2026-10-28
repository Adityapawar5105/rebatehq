const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const root = path.join(__dirname, '..');
const migrationName = '20261028173257_chunk2c_foundation_tables.sql';
const migration = fs.readFileSync(path.join(root, 'supabase/migrations', migrationName), 'utf8');

test('Chunk 2C upgrades populated Phase 2B without changing imports or margin snapshots', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`CREATE SCHEMA extensions; CREATE SCHEMA auth;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    for (const name of fs.readdirSync(path.join(root, 'supabase/migrations')).filter(n => n.endsWith('.sql') && n < migrationName).sort()) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
    }
    const tenant = randomUUID();
    await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'Existing 2B tenant','USD')", [tenant]);
    for (const status of ['dry_run','committed','failed']) {
      await db.query(`INSERT INTO public.import_job(tenant_id,import_type,status,accepted_rows,rejected_rows,summary)
        VALUES($1,'prototype',$2,10,2,'{"errors":2}')`, [tenant,status]);
    }
    await db.query(`INSERT INTO public.margin_snapshot(tenant_id,entity_type,entity_id,period_month,order_count,pocket_revenue,pocket_margin,margin_pct,currency)
      VALUES($1::uuid,'company',$1::uuid::text,'2026-10-01',2,100,-10,-10,'USD')`, [tenant]);
    const readExisting = async () => ({
      imports: (await db.query('SELECT to_jsonb(x) AS row FROM public.import_job x ORDER BY id')).rows,
      snapshots: (await db.query('SELECT to_jsonb(x) AS row FROM public.margin_snapshot x ORDER BY id')).rows,
    });
    const before = await readExisting();
    await db.exec(migration);
    assert.deepEqual(await readExisting(), before, 'Seeded rows must be unchanged by the upgrade');
    const inventory = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnotnull
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity`)).rows;
    // audit_log deliberately permits NULL tenant for controlled failed-login logging.
    assert.equal(inventory.length, 37);
    await assert.rejects(db.query("UPDATE public.import_job SET rejected_rows=-1 WHERE tenant_id=$1", [tenant]), e => e.code==='23514');
  } finally { await db.close(); }
});
