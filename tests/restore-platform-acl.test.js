const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname,'..');
const cleanup = readFileSync(path.join(root,'scripts/restore-platform-acl-cleanup.sql'),'utf8');
const historicalCleanup = readFileSync(path.join(root,'supabase/migrations/202610250002_revoke_platform_function_privileges.sql'),'utf8');

const roles = `CREATE ROLE margindesk_app; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`;
const oldFunctions = `
CREATE FUNCTION public.is_tenant_member(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.is_tenant_role(uuid,text[]) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.is_tenant_role_any_status(uuid,text[]) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.audit_row_change() RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.prevent_audit_mutation() RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION public.create_tenant_with_owner(text) RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION public.accept_tenant_invite(text) RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION public.record_failed_login(text,text,text) RETURNS void LANGUAGE sql AS $$SELECT$$;
`;
// A later migration creates these after the locked historical cleanup.
// Bodies are deliberately minimal: this regression tests restore ACLs, while
// chunk2a-pgtap.test.js exercises the actual cost/UOM function bodies.
const laterMigration = `
CREATE FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT $3$$;
CREATE FUNCTION public.record_data_quality_issue(uuid,text,text,text,date,jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$SELECT $1$$;
GRANT EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date),public.record_data_quality_issue(uuid,text,text,text,date,jsonb) TO margindesk_app;
`;
const functionSnapshotSql = `
SELECT 'public.'||p.oid::regprocedure::text AS object_name,r.rolname AS owner_name,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
  array_to_string(p.proconfig,',') AS search_path_setting,
  jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
    'grantor',grantor.rolname,'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY a.grantee,a.grantor,a.privilege_type) AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
LEFT JOIN pg_roles grantee ON grantee.oid=a.grantee JOIN pg_roles grantor ON grantor.oid=a.grantor
WHERE n.nspname='public' GROUP BY p.oid,r.rolname ORDER BY p.oid::regprocedure::text`;

test('restore cleanup preserves later-migration dump grants; actual old cleanup reproduces Drill #9 failure', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { assertFunctionAclSectionsEqual,compareFunctionAclSections } = await import('../scripts/verify-restore-equivalence.mjs');
  const source = new PGlite(); const target = new PGlite();
  try {
    await source.exec(roles + `CREATE TABLE public.tenant(tenant_id uuid);` + oldFunctions);
    await source.exec(historicalCleanup);
    await source.exec(laterMigration);
    const sourceFunctions = (await source.query(functionSnapshotSql)).rows;
    const definitions = (await source.query(`SELECT pg_get_functiondef(p.oid) AS ddl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows;
    // Read the dump's grants from SOURCE catalogs, not an application allowlist.
    const dumpGrants = (await source.query(`SELECT format('GRANT %s ON FUNCTION %s TO %s%s;',a.privilege_type,p.oid::regprocedure,
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END,CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END) AS ddl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(p.proacl) a
      LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' ORDER BY p.oid,a.grantee`)).rows;
    await target.exec(roles + `
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
      CREATE TABLE public.tenant(tenant_id uuid);
      CREATE SEQUENCE public.restore_sequence;
      GRANT SELECT ON public.tenant TO margindesk_app;
      GRANT USAGE ON public.restore_sequence TO margindesk_app;
      GRANT SELECT (tenant_id) ON public.tenant TO anon;
      CREATE ROLE supabase_fixture;
      CREATE FUNCTION public.platform_owned() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
      ALTER FUNCTION public.platform_owned() OWNER TO supabase_fixture;
    `);
    for (const row of definitions) await target.exec(row.ddl);
    for (const row of dumpGrants) await target.exec(row.ddl);
    const appSnapshot = async () => (await target.query(functionSnapshotSql)).rows.filter(fn => fn.owner_name==='postgres');
    const log = (label,rows) => console.log(`${label}: ${JSON.stringify(rows.filter(fn=>/convert_quantity|record_data_quality_issue/.test(fn.object_name)))}`);
    log('SOURCE',sourceFunctions);
    log('AFTER SCHEMA DUMP INCLUDING ITS GRANTS',await appSnapshot());
    const platformBefore = (await target.query(functionSnapshotSql)).rows.find(fn=>fn.owner_name==='supabase_fixture');
    await target.exec(cleanup);
    const afterCleanup = await appSnapshot();
    log('AFTER RESTORE-ONLY CLEANUP',afterCleanup);
    assertFunctionAclSectionsEqual(sourceFunctions,afterCleanup);
    await target.exec(cleanup); // Idempotency with no application grants rebuilt.
    assertFunctionAclSectionsEqual(sourceFunctions,await appSnapshot());
    assert.deepEqual((await target.query(functionSnapshotSql)).rows.find(fn=>fn.owner_name==='supabase_fixture'),platformBefore,'platform-owned public function must not change');
    await target.exec(`INSERT INTO public.tenant VALUES('20000000-0000-4000-8000-000000000099');`);
    log('AFTER DATA RESTORE',await appSnapshot());
    assertFunctionAclSectionsEqual(sourceFunctions,await appSnapshot());
    const privileges = (await target.query(`SELECT
      has_table_privilege('margindesk_app','public.tenant','SELECT') AS app_table,
      has_sequence_privilege('margindesk_app','public.restore_sequence','USAGE') AS app_sequence,
      has_any_column_privilege('anon','public.tenant','SELECT') AS anon_column,
      has_table_privilege('authenticated','public.tenant','SELECT') AS browser_table,
      has_sequence_privilege('service_role','public.restore_sequence','USAGE') AS platform_sequence`)).rows[0];
    assert.deepEqual(privileges,{app_table:true,app_sequence:true,anon_column:false,browser_table:false,platform_sequence:false});
    await target.exec(`CREATE TABLE public.future_table(tenant_id uuid); CREATE SEQUENCE public.future_sequence;
      CREATE FUNCTION public.future_function() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;`);
    assert.equal((await target.query(`SELECT count(*)::int AS n FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace IN (0,'public'::regnamespace)
      AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)`)).rows[0].n,0);
    await target.exec('DROP FUNCTION public.future_function(); DROP TABLE public.future_table; DROP SEQUENCE public.future_sequence;');
    await target.exec(historicalCleanup);
    const broken = await appSnapshot();
    log('AFTER HISTORICAL MIGRATION REPLAY (REGRESSION REPRODUCTION ONLY)',broken);
    assert.throws(()=>assertFunctionAclSectionsEqual(sourceFunctions,broken),/margindesk_app/);
    const diff=compareFunctionAclSections(sourceFunctions,broken);
    assert.equal(Object.keys(diff).length,2);
    for (const signature of ['public.convert_quantity(uuid,uuid,numeric,text,text,date)','public.record_data_quality_issue(uuid,text,text,text,date,jsonb)']) {
      assert.equal(diff[signature].margindesk_app.sourceOnly[0].privilege,'EXECUTE');
      assert.deepEqual(diff[signature].margindesk_app.restoredOnly,[]);
    }
  } finally { await source.close(); await target.close(); }
});

test('restore-only cleanup contains no grant statements or function allowlist',()=>{
  const sql=cleanup.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(sql,/\bGRANT\s+(?:ALL|EXECUTE|SELECT|USAGE)/i);
  assert.doesNotMatch(sql,/convert_quantity|record_data_quality_issue|is_tenant_member/);
});
