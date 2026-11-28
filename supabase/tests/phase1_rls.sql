BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(164 + CASE WHEN current_setting('app.restore_test_mode',true)='true' THEN 3 ELSE 0 END);
SELECT set_config('app.phase1_migration_owner',current_user,true);
-- INCLUDE FUNCTION ACL ALLOWLIST

-- Test helper simulates the trusted web request signer within this rollback transaction.
-- Never call it in the actor-forgery assertions. It is not installed by a migration.
CREATE FUNCTION pg_temp.use_identity(subject text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $identity$
DECLARE body text; key_bytes bytea;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',subject,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',NULLIF(subject,''),'role','authenticated')::text,true);
 SELECT secret INTO key_bytes FROM rebatehq_private.actor_key WHERE id='actor-v1';
 IF key_bytes IS NULL THEN RAISE EXCEPTION 'Install the actor signing key before database tests'; END IF;
 body:=jsonb_build_object('sub',subject,'actor',subject,'pid',pg_backend_pid(),'tx',txid_current()::text,'exp',floor(extract(epoch FROM clock_timestamp()))+300,'nonce',gen_random_uuid())::text;
 PERFORM set_config('app.identity_payload',body,true);
 PERFORM set_config('app.identity_signature',encode(extensions.hmac(convert_to(body,'UTF8'),key_bytes,'sha256'),'hex'),true);
END $identity$;
GRANT EXECUTE ON FUNCTION pg_temp.use_identity(text) TO rebatehq_app;


-- The runner replaces every named fixture ID with an independent fresh UUID
-- and checks them against public.id/public.tenant_id and auth.users. All test
-- rows are explicitly inserted in dependency order and rolled back at the end.

-- Include every application-owned public table before seeding; restore-only
-- count checks must observe only the already-restored baseline rows.
CREATE TEMP TABLE phase1_rls_tables(table_name text PRIMARY KEY);
INSERT INTO pg_temp.phase1_rls_tables(table_name)
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
  )
ORDER BY c.oid;

DO $$ DECLARE t text; n integer; v_sentinel jsonb; v_expected_hash text; v_actual_hash text;
  v_count_match boolean:=true; v_sentinel_present boolean:=false; v_detail text:=''; BEGIN
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_tables;
  IF n<15 THEN RAISE EXCEPTION 'Expected at least 15 application tenant tables after team sharing S2; found %',n; END IF;
  IF current_setting('app.restore_test_mode',true)='true' THEN
    v_expected_hash:=current_setting('app.restore_sentinel_content_hash');
    -- 8R: the sentinel is a licence location (same hash as scripts/verify-restore-equivalence.mjs).
    SELECT jsonb_build_object('tenant_id',l.tenant_id::text,'id',l.id::text,
      'content_hash',md5(jsonb_build_object(
        'tenant_id',l.tenant_id,'id',l.id,'name',l.name,'erp_profile',l.erp_profile,
        'created_at_utc',to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )::text)) INTO v_sentinel
    FROM public.licence_location l
    WHERE l.tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid
      AND l.id=current_setting('app.restore_sentinel_record_id')::uuid
      AND l.name='RESTORE-SENTINEL';
    v_actual_hash:=v_sentinel->>'content_hash';
    v_sentinel_present:=v_sentinel IS NOT NULL
      AND v_sentinel->>'tenant_id'=current_setting('app.restore_sentinel_tenant_id')
      AND v_sentinel->>'id'=current_setting('app.restore_sentinel_record_id')
      AND v_actual_hash=v_expected_hash
      AND EXISTS (SELECT 1 FROM public.tenant
        WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid);

    CREATE TEMP TABLE phase1_restore_actual_tenant_counts(
      table_name text NOT NULL,tenant_id text NULL,row_count bigint NOT NULL
    ) ON COMMIT DROP;
    FOR t IN SELECT table_name FROM pg_temp.phase1_rls_tables LOOP
      EXECUTE format(
        'INSERT INTO pg_temp.phase1_restore_actual_tenant_counts(table_name,tenant_id,row_count) SELECT %L,tenant_id::text,count(*) FROM public.%I GROUP BY tenant_id::text',
        t,t
      );
    END LOOP;
    SELECT NOT EXISTS (
      (SELECT table_name,tenant_id,row_count FROM pg_temp.phase1_restore_actual_tenant_counts
       EXCEPT SELECT table_name,tenant_id,row_count FROM pg_temp.phase1_restore_expected_tenant_counts)
      UNION ALL
      (SELECT table_name,tenant_id,row_count FROM pg_temp.phase1_restore_expected_tenant_counts
       EXCEPT SELECT table_name,tenant_id,row_count FROM pg_temp.phase1_restore_actual_tenant_counts)
    ) INTO v_count_match;
    v_detail:=jsonb_build_object('sentinel',v_sentinel,'expected_sentinel_hash',v_expected_hash,
      'per_tenant_counts_match',v_count_match,'baseline_entries',
      (SELECT count(*) FROM pg_temp.phase1_restore_expected_tenant_counts))::text;
  END IF;
  PERFORM set_config('app.phase1_restore_baseline_result',jsonb_build_object(
    'restore_mode',current_setting('app.restore_test_mode',true)='true',
    'sentinel_matches',v_sentinel_present,'counts_match',v_count_match,'detail',v_detail
  )::text,true);
END $$;

-- 8R: 4 foundation tables keep fixtures here (wave-1 and wave-2 tables were dropped). The licence, relay and
-- benchmark-consent tables are tested in chunk5b_control.sql, chunk7a_relay.sql and chunk8d_bench.sql.
DELETE FROM pg_temp.phase1_rls_tables WHERE table_name IN ('workspace_licence','licence_seat','licence_location','licence_device','relay_device_key','relay_epoch','relay_key_wrap','relay_event','relay_pack_wrap','relay_pack_version','bench_consent');
-- Suite-owned auth users and tenants are inserted before dependent rows.
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES
 ('__PHASE1_USER_A_ID__','authenticated','authenticated','phase1-a-__PHASE1_USER_A_ID__@example.invalid','',now(),now(),now()),
 ('__PHASE1_USER_B_ID__','authenticated','authenticated','phase1-b-__PHASE1_USER_B_ID__@example.invalid','',now(),now(),now()),
 ('__PHASE1_USER_REP_ID__','authenticated','authenticated','phase1-rep-__PHASE1_USER_REP_ID__@example.invalid','',now(),now(),now());
INSERT INTO public.tenant(tenant_id,name,created_by) VALUES
 ('__PHASE1_TENANT_A_ID__','Phase 1 tenant A','__PHASE1_USER_A_ID__'),
 ('__PHASE1_TENANT_B_ID__','Phase 1 tenant B','__PHASE1_USER_B_ID__');
INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES
 ('__PHASE1_TENANT_A_ID__','__PHASE1_USER_A_ID__','phase1-a-__PHASE1_USER_A_ID__@example.invalid','owner'),
 ('__PHASE1_TENANT_B_ID__','__PHASE1_USER_B_ID__','phase1-b-__PHASE1_USER_B_ID__@example.invalid','owner'),
 ('__PHASE1_TENANT_B_ID__','__PHASE1_USER_REP_ID__','phase1-rep-__PHASE1_USER_REP_ID__@example.invalid','rep');

INSERT INTO public.invite(id,tenant_id,email,role,token_hash,invited_by,expires_at) VALUES
 ('__PHASE1_INVITE_A_ID__','__PHASE1_TENANT_A_ID__','new-a@example.invalid','rep',replace('__PHASE1_INVITE_A_ID__','-',''),'__PHASE1_USER_A_ID__',now()+interval '7 days'),
 ('__PHASE1_INVITE_B_ID__','__PHASE1_TENANT_B_ID__','new-b@example.invalid','rep',replace('__PHASE1_INVITE_B_ID__','-',''),'__PHASE1_USER_B_ID__',now()+interval '7 days');

INSERT INTO public.audit_log(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES
 ('__PHASE1_AUDIT_A_ID__','__PHASE1_TENANT_A_ID__','__PHASE1_USER_A_ID__','test.fixture','tenant','__PHASE1_TENANT_A_ID__'),
 ('__PHASE1_AUDIT_B_ID__','__PHASE1_TENANT_B_ID__','__PHASE1_USER_B_ID__','test.fixture','tenant','__PHASE1_TENANT_B_ID__');

-- Capture only the explicitly seeded fixture rows by their known primary keys.
-- No restored row is eligible, and no arbitrary LIMIT or cross-tenant row cloning is used.
CREATE TEMP TABLE phase1_rls_insert_fixtures(table_name text PRIMARY KEY, row_data jsonb);
CREATE TEMP TABLE phase1_rls_tenant_a_fixtures(table_name text PRIMARY KEY, row_data jsonb);
CREATE TEMP TABLE phase1_rls_fixture_keys(
  sort_order smallint PRIMARY KEY,
  table_name text NOT NULL UNIQUE,
  key_column text NOT NULL,
  tenant_a_key uuid NOT NULL,
  tenant_b_key uuid NOT NULL
);
INSERT INTO pg_temp.phase1_rls_fixture_keys(sort_order,table_name,key_column,tenant_a_key,tenant_b_key) VALUES
 (1,'tenant','tenant_id','__PHASE1_TENANT_A_ID__','__PHASE1_TENANT_B_ID__'),
 (2,'membership','user_id','__PHASE1_USER_A_ID__','__PHASE1_USER_B_ID__'),
 (3,'invite','id','__PHASE1_INVITE_A_ID__','__PHASE1_INVITE_B_ID__'),
 (4,'audit_log','id','__PHASE1_AUDIT_A_ID__','__PHASE1_AUDIT_B_ID__');
DO $$ DECLARE v_fixture phase1_rls_fixture_keys%ROWTYPE; n integer; expected_count integer; BEGIN
  SELECT count(*) INTO expected_count FROM pg_temp.phase1_rls_tables;
  IF expected_count<4 THEN RAISE EXCEPTION 'Explicit fixture graph needs at least 4 tenant tables; found %',expected_count; END IF;
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_fixture_keys;
  IF n<>expected_count THEN RAISE EXCEPTION 'Explicit fixture key list covers % tables; public tenant table inventory has %',n,expected_count; END IF;
  FOR v_fixture IN SELECT * FROM pg_temp.phase1_rls_fixture_keys ORDER BY sort_order LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_temp.phase1_rls_tables WHERE table_name=v_fixture.table_name) THEN
      RAISE EXCEPTION 'Explicit fixture graph references missing tenant table public.%',v_fixture.table_name;
    END IF;
    EXECUTE format(
      'INSERT INTO pg_temp.phase1_rls_insert_fixtures(table_name,row_data) SELECT %L,to_jsonb(x) FROM public.%I x WHERE %I=$1',
      v_fixture.table_name,v_fixture.table_name,v_fixture.key_column
    ) USING v_fixture.tenant_b_key;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Expected exactly one suite-created Tenant B fixture row in public.% keyed by %; found %',v_fixture.table_name,v_fixture.key_column,n; END IF;
    IF (SELECT row_data->>'tenant_id' FROM pg_temp.phase1_rls_insert_fixtures WHERE table_name=v_fixture.table_name)
       IS DISTINCT FROM (SELECT row_data->>'tenant_id' FROM pg_temp.phase1_rls_insert_fixtures WHERE table_name='tenant') THEN
      RAISE EXCEPTION 'Tenant B fixture row has the wrong tenant_id in public.% keyed by %',v_fixture.table_name,v_fixture.key_column;
    END IF;
    EXECUTE format(
      'INSERT INTO pg_temp.phase1_rls_tenant_a_fixtures(table_name,row_data) SELECT %L,to_jsonb(x) FROM public.%I x WHERE %I=$1',
      v_fixture.table_name,v_fixture.table_name,v_fixture.key_column
    ) USING v_fixture.tenant_a_key;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Expected exactly one suite-created Tenant A fixture row in public.% keyed by %; found %',v_fixture.table_name,v_fixture.key_column,n; END IF;
    IF (SELECT row_data->>'tenant_id' FROM pg_temp.phase1_rls_tenant_a_fixtures WHERE table_name=v_fixture.table_name)
       IS DISTINCT FROM (SELECT row_data->>'tenant_id' FROM pg_temp.phase1_rls_tenant_a_fixtures WHERE table_name='tenant') THEN
      RAISE EXCEPTION 'Tenant A fixture row has the wrong tenant_id in public.% keyed by %',v_fixture.table_name,v_fixture.key_column;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_insert_fixtures;
  IF n<>expected_count THEN RAISE EXCEPTION 'Tenant B fixture graph covers % tables; expected %',n,expected_count; END IF;
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_tenant_a_fixtures;
  IF n<>expected_count THEN RAISE EXCEPTION 'Tenant A fixture graph covers % tables; expected %',n,expected_count; END IF;
END $$;
SELECT set_config(
  'app.phase1_tenant_b_fixtures',
  (SELECT jsonb_object_agg(table_name,row_data)::text FROM pg_temp.phase1_rls_insert_fixtures),
  true
);
SELECT set_config(
  'app.phase1_tenant_a_fixtures',
  (SELECT jsonb_object_agg(table_name,row_data)::text FROM pg_temp.phase1_rls_tenant_a_fixtures),
  true
);

SELECT extensions.ok(NOT EXISTS (
 SELECT 1 FROM pg_temp.phase1_rls_tables t WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='tenant_id'
 )
), 'Every application table carries tenant_id');
SELECT extensions.ok(NOT EXISTS (
 SELECT 1 FROM pg_temp.phase1_rls_tables t
 JOIN pg_class c ON c.relname=t.table_name
 JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
 WHERE NOT c.relrowsecurity OR NOT c.relforcerowsecurity
), 'RLS is enabled and forced on every application table');
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rebatehq_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin), 'rebatehq_app is NOLOGIN, NOSUPERUSER, and NOBYPASSRLS');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.invite','SELECT'), 'Browser role has no direct invite table grant');
SELECT extensions.ok(has_schema_privilege('rebatehq_app','public','USAGE'),'App role has public schema USAGE');
SELECT extensions.ok(NOT has_schema_privilege('rebatehq_app','auth','USAGE'),'App role has NO auth schema USAGE');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relkind IN ('r','p','v','m','f')
    AND (has_table_privilege('rebatehq_app',c.oid,'SELECT')
      OR has_any_column_privilege('rebatehq_app',c.oid,'SELECT')
      OR has_table_privilege('rebatehq_app',c.oid,'INSERT')
      OR has_any_column_privilege('rebatehq_app',c.oid,'INSERT')
      OR has_table_privilege('rebatehq_app',c.oid,'UPDATE')
      OR has_any_column_privilege('rebatehq_app',c.oid,'UPDATE')
      OR has_table_privilege('rebatehq_app',c.oid,'DELETE')
      OR has_table_privilege('rebatehq_app',c.oid,'TRUNCATE')
      OR has_table_privilege('rebatehq_app',c.oid,'REFERENCES')
      OR has_any_column_privilege('rebatehq_app',c.oid,'REFERENCES')
      OR has_table_privilege('rebatehq_app',c.oid,'TRIGGER'))
), 'App role has no table privileges in auth schema');
SELECT extensions.ok(has_language_privilege('rebatehq_app','plpgsql','USAGE'),'App role has PL/pgSQL USAGE');
SELECT extensions.ok(
  has_function_privilege('rebatehq_app','auth.uid()','EXECUTE')
  AND EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='auth.uid()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'
  ),
  'App role can execute auth.uid() through the Supabase platform PUBLIC grant'
);
SELECT extensions.ok(has_function_privilege('rebatehq_app','public.is_tenant_member(uuid)','EXECUTE'),'App role has EXECUTE on public.is_tenant_member(uuid)');
SELECT extensions.ok(has_function_privilege('rebatehq_app','public.is_tenant_role(uuid,text[])','EXECUTE'),'App role has EXECUTE on public.is_tenant_role(uuid,text[])');
SELECT extensions.ok(has_function_privilege('rebatehq_app','public.is_tenant_role_any_status(uuid,text[])','EXECUTE'),'App role has EXECUTE on public.is_tenant_role_any_status(uuid,text[])');
WITH required AS (
  SELECT t.table_name,op.privilege
  FROM pg_temp.phase1_rls_tables t
  CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) op(privilege)
  WHERE op.privilege='SELECT'
     OR (op.privilege='INSERT' AND t.table_name NOT IN ('tenant','membership'))
     OR (op.privilege='UPDATE' AND t.table_name<>'audit_log')
     OR (op.privilege='DELETE' AND t.table_name NOT IN ('tenant','audit_log'))
), missing AS (
  SELECT r.table_name,r.privilege FROM required r
  WHERE NOT has_table_privilege('rebatehq_app',format('public.%I',r.table_name),r.privilege)
)
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM missing),
  'App table grants are present; missing='||COALESCE((SELECT string_agg(table_name||'.'||privilege,', ' ORDER BY table_name,privilege) FROM missing),'none'));
SELECT extensions.ok(
  NOT has_table_privilege('rebatehq_app','public.audit_log','UPDATE')
  AND NOT has_table_privilege('rebatehq_app','public.audit_log','DELETE')
  AND NOT has_table_privilege('rebatehq_app','public.audit_log','TRUNCATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='public.audit_log'::regclass AND a.grantee=0 AND a.privilege_type IN ('UPDATE','DELETE','TRUNCATE')
  ),
  'audit_log has no UPDATE, DELETE, or TRUNCATE grant to rebatehq_app or PUBLIC');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_temp.phase1_rls_tables t
  WHERE EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid=format('public.%I',t.table_name)::regclass AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
  )
),'PUBLIC has no write or TRUNCATE grants on tenant tables');
SELECT extensions.ok(
  NOT has_table_privilege('rebatehq_app','public.tenant','INSERT')
  AND NOT has_table_privilege('rebatehq_app','public.tenant','DELETE')
  AND NOT has_table_privilege('rebatehq_app','public.membership','INSERT'),
  'App role has no tenant or membership write operations forbidden to every policy');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_temp.phase1_rls_tables t
  WHERE t.table_name<>'audit_log' AND has_table_privilege('rebatehq_app',format('public.%I',t.table_name),'TRUNCATE')
),'App role has no TRUNCATE privilege on tenant tables');

SELECT extensions.ok(NOT EXISTS (
  SELECT 1
  FROM pg_temp.phase1_rls_tables t
  JOIN pg_class c ON c.relname=t.table_name
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
  CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) table_privilege(privilege)
  WHERE acl.grantee IN (0,'anon'::regrole,'authenticated'::regrole)
     OR has_table_privilege('anon',c.oid,table_privilege.privilege)
     OR has_table_privilege('authenticated',c.oid,table_privilege.privilege)
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
         AND (
           EXISTS (
             SELECT 1 FROM aclexplode(a.attacl) column_acl
             WHERE column_acl.grantee IN (0,'anon'::regrole,'authenticated'::regrole)
           )
           OR
           has_column_privilege('anon',a.attrelid,a.attnum,'SELECT')
           OR has_column_privilege('anon',a.attrelid,a.attnum,'INSERT')
           OR has_column_privilege('anon',a.attrelid,a.attnum,'UPDATE')
           OR has_column_privilege('anon',a.attrelid,a.attnum,'REFERENCES')
           OR has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')
           OR has_column_privilege('authenticated',a.attrelid,a.attnum,'INSERT')
           OR has_column_privilege('authenticated',a.attrelid,a.attnum,'UPDATE')
           OR has_column_privilege('authenticated',a.attrelid,a.attnum,'REFERENCES')
         )
     )
), 'No application table or column ACL grants any privilege to anon, authenticated, or PUBLIC');

SELECT extensions.ok(NOT EXISTS (
  SELECT 1
  FROM pg_temp.phase1_rls_tables t
  JOIN pg_class c ON c.relname=t.table_name
  JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
  CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) table_privilege(privilege)
  WHERE acl.grantee='service_role'::regrole
     OR has_table_privilege('service_role',c.oid,table_privilege.privilege)
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
         AND (
           EXISTS (SELECT 1 FROM aclexplode(a.attacl) column_acl WHERE column_acl.grantee='service_role'::regrole)
           OR has_column_privilege('service_role',a.attrelid,a.attnum,'SELECT')
           OR has_column_privilege('service_role',a.attrelid,a.attnum,'INSERT')
           OR has_column_privilege('service_role',a.attrelid,a.attnum,'UPDATE')
           OR has_column_privilege('service_role',a.attrelid,a.attnum,'REFERENCES')
         )
     )
), 'service_role application table privilege allowlist is empty (service_role bypasses RLS and the app does not use it)');

WITH app_owners AS (
  SELECT DISTINCT c.relowner AS owner_oid
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
  UNION
  SELECT seq_class.relowner
  FROM pg_class seq_class JOIN pg_namespace sequence_schema ON sequence_schema.oid=seq_class.relnamespace
  JOIN pg_depend dependency ON dependency.classid='pg_class'::regclass AND dependency.objid=seq_class.oid
    AND dependency.refclassid='pg_class'::regclass AND dependency.deptype IN ('a','i')
  JOIN pg_class app_table ON app_table.oid=dependency.refobjid
  JOIN pg_namespace app_schema ON app_schema.oid=app_table.relnamespace
  WHERE sequence_schema.nspname='public' AND seq_class.relkind='S' AND app_schema.nspname='public'
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=app_table.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
  UNION
  SELECT DISTINCT p.proowner
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND EXISTS (SELECT 1 FROM pg_temp.phase1_function_allowlist a WHERE to_regprocedure(a.signature)=p.oid)
), explicit_bad_defaults AS (
  SELECT 1
  FROM pg_default_acl d JOIN app_owners o ON o.owner_oid=d.defaclrole
  CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
  WHERE d.defaclnamespace IN (0,'public'::regnamespace)
    AND d.defaclobjtype IN ('r','S','f')
    AND acl.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
), inherited_builtin_public_function AS (
  SELECT 1 FROM app_owners o
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_default_acl d WHERE d.defaclrole=o.owner_oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'
  ) AND EXISTS (
    SELECT 1 FROM aclexplode(acldefault('f',o.owner_oid)) acl
    WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
  )
)
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM explicit_bad_defaults)
  AND NOT EXISTS (SELECT 1 FROM inherited_builtin_public_function),
  'Public default privileges for application object owners grant nothing to anon, authenticated, service_role, or PUBLIC');

SET LOCAL ROLE anon;
DO $$
DECLARE
  v_operation text;
  v_state text;
  v_message text;
  v_count bigint;
  v_result jsonb:='{}'::jsonb;
BEGIN
  FOREACH v_operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    v_state:='succeeded';
    v_message:='';
    BEGIN
      IF v_operation='SELECT' THEN
        EXECUTE 'SELECT count(*) FROM public.tenant' INTO v_count;
      ELSIF v_operation='INSERT' THEN
        EXECUTE 'INSERT INTO public.tenant(name) VALUES (''__anon_privilege_probe__'')';
      ELSIF v_operation='UPDATE' THEN
        EXECUTE 'UPDATE public.invite SET email=email WHERE false';
      ELSE
        EXECUTE 'DELETE FROM public.invite WHERE false';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
    END;
    v_result:=v_result||jsonb_build_object(v_operation,jsonb_build_object('sqlstate',v_state,'message',v_message));
  END LOOP;
  PERFORM set_config('app.phase1_anon_privilege_result',v_result::text,true);
END $$;
RESET ROLE;
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_temp.phase1_rls_tables t
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) op(privilege)
    WHERE has_table_privilege('anon',format('public.%I',t.table_name),op.privilege)
  )
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'SELECT'->>'sqlstate')='42501'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'SELECT'->>'message') ILIKE '%permission denied for table tenant%'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'INSERT'->>'sqlstate')='42501'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'INSERT'->>'message') ILIKE '%permission denied for table tenant%'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'UPDATE'->>'sqlstate')='42501'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'UPDATE'->>'message') ILIKE '%permission denied for table invite%'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'DELETE'->>'sqlstate')='42501'
  AND (current_setting('app.phase1_anon_privilege_result')::jsonb->'DELETE'->>'message') ILIKE '%permission denied for table invite%',
  'anon has no effective CRUD table privileges across the application schema; representative statements fail at ACL checks: '||current_setting('app.phase1_anon_privilege_result')
);

INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) VALUES('__PHASE1_TENANT_A_ID__','scale',now()+interval '7 days'),('__PHASE1_TENANT_B_ID__','scale',now()+interval '7 days');
INSERT INTO public.licence_seat(tenant_id,user_id) VALUES('__PHASE1_TENANT_A_ID__','__PHASE1_USER_A_ID__'),('__PHASE1_TENANT_B_ID__','__PHASE1_USER_B_ID__');

SET LOCAL ROLE rebatehq_app;
SELECT set_config(
  'app.phase1_role_context',
  (SELECT jsonb_build_object(
     'current_user',current_user,
     'rolsuper',rolsuper,
     'rolbypassrls',rolbypassrls
   )::text
   FROM pg_roles WHERE rolname=current_user),
  true
);
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"__PHASE1_USER_A_ID__","role":"authenticated"}';

DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  PERFORM pg_temp.use_identity('__PHASE1_USER_REP_ID__');
  PERFORM set_config('request.jwt.claims','{"sub":"__PHASE1_USER_REP_ID__","role":"authenticated"}',true);
  BEGIN
    SELECT count(*) INTO n FROM public.membership
      WHERE tenant_id='__PHASE1_TENANT_B_ID__'
        AND user_id='__PHASE1_USER_REP_ID__';
    PERFORM set_config('app.phase1_auth_policy_result',jsonb_build_object('passed',n=1,'visible_rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_auth_policy_result',jsonb_build_object('passed',false,'visible_rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
  PERFORM pg_temp.use_identity('__PHASE1_USER_A_ID__');
  PERFORM set_config('request.jwt.claims','{"sub":"__PHASE1_USER_A_ID__","role":"authenticated"}',true);
END $$;

DO $$ DECLARE v_state text; v_msg text; BEGIN
  BEGIN
    INSERT INTO public.audit_log(id,tenant_id,actor_id,action,entity_type,entity_id)
      VALUES(gen_random_uuid(),NULL,NULL,'auth.login_failed','auth_user','phase1-direct-null-write');
    PERFORM set_config('app.phase1_direct_null_audit_result',jsonb_build_object('passed',false,'state','00000','message','unexpectedly inserted')::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_direct_null_audit_result',jsonb_build_object(
      'passed',v_state='42501' AND position('row-level security' in lower(v_msg))>0,
      'state',v_state,'message',v_msg
    )::text,true);
  END;
END $$;

DO $$ DECLARE v_state text; v_msg text; BEGIN
  BEGIN
    -- Spoof the ordinary app setting deliberately. The SECURITY DEFINER
    -- function must ignore it and write a null actor and null tenant.
    PERFORM set_config('app.real_actor_id','__PHASE1_USER_B_ID__',true);
    PERFORM public.record_failed_login('phase1-a-__PHASE1_USER_A_ID__@example.invalid','192.0.2.45','pgTAP controlled-path probe');
    PERFORM set_config('app.phase1_failed_login_result',jsonb_build_object('passed',true,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_failed_login_result',jsonb_build_object('passed',false,'state',v_state,'message',v_msg)::text,true);
  END;
  -- Do not let the deliberate spoof setting contaminate later tenant-A
  -- positive controls in this transaction.
  PERFORM set_config('app.real_actor_id','__PHASE1_USER_A_ID__',true);
END $$;

DO $$ DECLARE t text; n integer; v_missing text:=''; v_state text; v_msg text; BEGIN
  SELECT count(*) INTO n FROM jsonb_object_keys(current_setting('app.phase1_tenant_a_fixtures')::jsonb);
  IF n<4 THEN RAISE EXCEPTION 'Tenant A positive SELECT loop expected at least 4 tables; found %',n; END IF;
  FOR t IN SELECT jsonb_object_keys(current_setting('app.phase1_tenant_a_fixtures')::jsonb) LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING '__PHASE1_TENANT_A_ID__'::uuid;
      IF n=0 THEN v_missing:=concat_ws(', ',v_missing,t||' (no visible seeded row)'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      v_missing:=concat_ws(', ',v_missing,t||' ('||v_state||': '||v_msg||')');
    END;
  END LOOP;
  PERFORM set_config('app.phase1_positive_select_result',jsonb_build_object('passed',v_missing='','detail',COALESCE(v_missing,'none'))::text,true);
END $$;

DO $$ DECLARE t text; v_row jsonb; v_insert jsonb; v_state text; v_msg text; n integer; v_failed text:=''; BEGIN
  SELECT count(*) INTO n FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb) WHERE key NOT IN ('tenant','membership');
  IF n<2 THEN RAISE EXCEPTION 'Tenant A positive INSERT loop expected at least 2 policy-allowed tables; found %',n; END IF;
  FOR t,v_row IN SELECT key,value FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb)
    WHERE key NOT IN ('tenant','membership') LOOP
    v_insert:=jsonb_set(v_row,'{id}',to_jsonb(gen_random_uuid()),true);
    IF t='invite' THEN
      v_insert:=jsonb_set(v_insert,'{token_hash}',to_jsonb(replace(v_insert->>'id','-','')),true);
      v_insert:=jsonb_set(v_insert,'{email}',to_jsonb('phase1-positive-'||(v_insert->>'id')||'@example.invalid'),true);
    ELSIF t='audit_log' THEN
      v_insert:=jsonb_set(v_insert,'{actor_id}',to_jsonb('__PHASE1_USER_A_ID__'::uuid),true);
      v_insert:=jsonb_set(v_insert,'{action}',to_jsonb('test.positive_insert'::text),true);
    END IF;
    BEGIN
      EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).* RETURNING 1',t,t) INTO n USING v_insert;
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n<>1 THEN v_failed:=concat_ws(', ',v_failed,t||' inserted '||n||' rows'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      v_failed:=concat_ws(', ',v_failed,t||' ('||v_state||': '||v_msg||')');
    END;
  END LOOP;
  PERFORM set_config('app.phase1_positive_insert_result',jsonb_build_object('passed',v_failed='','detail',COALESCE(v_failed,'none'))::text,true);
END $$;

DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    UPDATE public.invite SET expires_at=now()+interval '6 days'
      WHERE tenant_id='__PHASE1_TENANT_A_ID__'
        AND id='__PHASE1_INVITE_A_ID__';
    GET DIAGNOSTICS n=ROW_COUNT;
    PERFORM set_config('app.phase1_positive_update_result',jsonb_build_object('passed',n=1,'rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_positive_update_result',jsonb_build_object('passed',false,'rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
END $$;

DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    DELETE FROM public.invite WHERE tenant_id='__PHASE1_TENANT_A_ID__'
      AND email LIKE 'phase1-positive-%@example.invalid';
    GET DIAGNOSTICS n=ROW_COUNT;
    PERFORM set_config('app.phase1_positive_delete_result',jsonb_build_object('passed',n=1,'rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_positive_delete_result',jsonb_build_object('passed',false,'rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
END $$;

DO $$ DECLARE v_before integer; v_deleted integer; v_after integer; v_state text; v_msg text; BEGIN
  PERFORM pg_temp.use_identity('__PHASE1_USER_REP_ID__');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"sub":"__PHASE1_USER_REP_ID__","role":"authenticated"}',true);
  BEGIN
    SELECT count(*) INTO v_before FROM public.membership
      WHERE tenant_id='__PHASE1_TENANT_B_ID__'
        AND user_id='__PHASE1_USER_REP_ID__';
    DELETE FROM public.membership WHERE tenant_id='__PHASE1_TENANT_B_ID__'
      AND user_id='__PHASE1_USER_REP_ID__';
    GET DIAGNOSTICS v_deleted=ROW_COUNT;
    SELECT count(*) INTO v_after FROM public.membership
      WHERE tenant_id='__PHASE1_TENANT_B_ID__'
        AND user_id='__PHASE1_USER_REP_ID__';
    PERFORM set_config('app.phase1_rep_delete_result',jsonb_build_object(
      'passed',v_before=1 AND v_deleted=0 AND v_after=1,'visible_before',v_before,
      'deleted',v_deleted,'visible_after',v_after,'state',NULL,'message',NULL
    )::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_rep_delete_result',jsonb_build_object(
      'passed',false,'visible_before',COALESCE(v_before,0),'deleted',COALESCE(v_deleted,0),
      'visible_after',COALESCE(v_after,0),'state',v_state,'message',v_msg
    )::text,true);
  END;
  PERFORM pg_temp.use_identity('__PHASE1_USER_A_ID__');
  PERFORM set_config('request.jwt.claims','{"sub":"__PHASE1_USER_A_ID__","role":"authenticated"}',true);
END $$;

DO $$ DECLARE t text; n integer; v_missing text:=''; v_state text; v_msg text; BEGIN
  SELECT count(*) INTO n FROM jsonb_object_keys(current_setting('app.phase1_tenant_b_fixtures')::jsonb);
  IF n<4 THEN RAISE EXCEPTION 'Tenant B cross-SELECT loop expected at least 4 tables; found %',n; END IF;
  FOR t IN SELECT jsonb_object_keys(current_setting('app.phase1_tenant_b_fixtures')::jsonb) LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING '__PHASE1_TENANT_B_ID__'::uuid;
      IF n<>0 THEN v_missing:=concat_ws(', ',v_missing,t||' ('||n||' rows visible)'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      v_missing:=concat_ws(', ',v_missing,t||' ('||v_state||': '||v_msg||')');
    END;
  END LOOP;
  PERFORM set_config('app.phase1_cross_select_result',jsonb_build_object('passed',v_missing='','detail',COALESCE(v_missing,'none'))::text,true);
END $$;

-- In restore mode Tenant A is still the fresh suite-owned tenant, while the
-- denied tenant is the restored source sentinel tenant. The earlier baseline
-- check proves that this target tenant has real restored tenant/product rows.
DO $$ DECLARE t text; n integer; expected_count integer; v_bad text:='';
  v_state text; v_msg text; BEGIN
  IF current_setting('app.restore_test_mode',true)='true' THEN
    SELECT count(*) INTO expected_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
    IF expected_count<15 THEN RAISE EXCEPTION 'Restore isolation check expected at least 15 tenant tables; found %',expected_count; END IF;
    FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t)
          INTO n USING current_setting('app.restore_sentinel_tenant_id')::uuid;
        IF n<>0 THEN v_bad:=concat_ws(', ',v_bad,t||' ('||n||' restored tenant rows visible)'); END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
        v_bad:=concat_ws(', ',v_bad,t||' ('||v_state||': '||v_msg||')');
      END;
    END LOOP;
    PERFORM set_config('app.phase1_restore_real_isolation_result',jsonb_build_object(
      'passed',v_bad='','detail',COALESCE(v_bad,'none'),'checked_tables',expected_count
    )::text,true);
  END IF;
END $$;

-- A cross-tenant UPDATE starts from an A-visible row and changes its tenant_id;
-- RLS WITH CHECK must reject it.
DO $$ DECLARE t text; v_state text; v_msg text; v_bad text:=''; n integer; BEGIN
  SELECT count(*) INTO n FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb) WHERE key<>'audit_log';
  IF n<3 THEN
    RAISE EXCEPTION 'Cross-tenant UPDATE loop expected at least 3 eligible tables';
  END IF;
  FOR t IN SELECT key FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb)
    WHERE key<>'audit_log' LOOP
    v_state:='00000'; v_msg:='';
    BEGIN
      EXECUTE format('UPDATE public.%I SET tenant_id=$1 WHERE tenant_id=$2',t)
        USING '__PHASE1_TENANT_B_ID__'::uuid,'__PHASE1_TENANT_A_ID__'::uuid;
      v_bad:=concat_ws(', ',v_bad,t||' unexpectedly updated rows');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      IF v_state<>'42501' OR position('row-level security' in lower(v_msg))=0 THEN
        v_bad:=concat_ws(', ',v_bad,t||' ('||v_state||': '||v_msg||')');
      END IF;
    END;
  END LOOP;
  PERFORM set_config('app.phase1_cross_update_result',jsonb_build_object('passed',v_bad='','detail',COALESCE(v_bad,'none'))::text,true);
END $$;

-- DELETE policies hide Tenant B rows (PostgreSQL reports zero affected rows,
-- rather than raising an error). ACL checks above prove DELETE is granted for
-- each tested operation, so permission denial cannot masquerade as RLS.
DO $$ DECLARE t text; n integer; v_bad text:=''; v_state text; v_msg text; BEGIN
  SELECT count(*) INTO n FROM jsonb_each(current_setting('app.phase1_tenant_b_fixtures')::jsonb) WHERE key NOT IN ('tenant','audit_log');
  IF n<2 THEN
    RAISE EXCEPTION 'Cross-tenant DELETE loop expected at least 2 eligible tables';
  END IF;
  FOR t IN SELECT key FROM jsonb_each(current_setting('app.phase1_tenant_b_fixtures')::jsonb)
    WHERE key NOT IN ('tenant','audit_log') LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id=$1',t) USING '__PHASE1_TENANT_B_ID__'::uuid;
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n<>0 THEN v_bad:=concat_ws(', ',v_bad,t||' deleted '||n||' rows'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      v_bad:=concat_ws(', ',v_bad,t||' ('||v_state||': '||v_msg||')');
    END;
  END LOOP;
  PERFORM set_config('app.phase1_cross_delete_result',jsonb_build_object('passed',v_bad='','detail',COALESCE(v_bad,'none'))::text,true);
END $$;

DO $$ DECLARE t text; v_row jsonb; v_state text; v_msg text; v_bad text:=''; n integer; BEGIN
  SELECT count(*) INTO n FROM jsonb_each(current_setting('app.phase1_tenant_b_fixtures')::jsonb) WHERE key NOT IN ('tenant','membership');
  IF n<2 THEN
    RAISE EXCEPTION 'Cross-tenant INSERT loop expected at least 2 eligible tables';
  END IF;
  FOR t,v_row IN SELECT key,value FROM jsonb_each(current_setting('app.phase1_tenant_b_fixtures')::jsonb)
    WHERE key NOT IN ('tenant','membership') LOOP
    v_state:='00000'; v_msg:='';
    BEGIN
      EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',t,t) USING v_row;
      v_bad:=concat_ws(', ',v_bad,t||' unexpectedly inserted a Tenant B row');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      IF v_state<>'42501' OR position('row-level security' in lower(v_msg))=0 THEN
        v_bad:=concat_ws(', ',v_bad,t||' ('||v_state||': '||v_msg||')');
      END IF;
    END;
  END LOOP;
  PERFORM set_config('app.phase1_cross_insert_result',jsonb_build_object('passed',v_bad='','detail',COALESCE(v_bad,'none'))::text,true);
END $$;

-- This authenticated rep belongs to Tenant B, which has an audit fixture.
-- A zero count therefore proves the audit policy is role-restricted, not just
-- tenant-isolated.
SELECT pg_temp.use_identity('__PHASE1_USER_REP_ID__');
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"__PHASE1_USER_REP_ID__","role":"authenticated"}';
SELECT set_config(
  'app.phase1_rep_audit_rows',
  (SELECT count(*)::text FROM public.audit_log WHERE tenant_id='__PHASE1_TENANT_B_ID__'),
  true
);

SELECT pg_temp.use_identity('');
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{}';
SELECT set_config(
  'app.phase1_missing_auth_rows',
  (SELECT count(*)::text FROM public.membership WHERE tenant_id='__PHASE1_TENANT_B_ID__'),
  true
);

DO $$ DECLARE v_update_state text:='00000'; v_delete_state text:='00000'; v_truncate_state text:='00000'; v_update_msg text; v_delete_msg text; v_truncate_msg text; BEGIN
  BEGIN
    UPDATE public.audit_log SET action='tampered' WHERE tenant_id='__PHASE1_TENANT_A_ID__';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_update_state=RETURNED_SQLSTATE, v_update_msg=MESSAGE_TEXT;
  END;
  BEGIN
    DELETE FROM public.audit_log WHERE tenant_id='__PHASE1_TENANT_A_ID__';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_delete_state=RETURNED_SQLSTATE, v_delete_msg=MESSAGE_TEXT;
  END;
  BEGIN
    TRUNCATE public.audit_log;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_truncate_state=RETURNED_SQLSTATE, v_truncate_msg=MESSAGE_TEXT;
  END;
  PERFORM set_config('app.phase1_audit_app_result',jsonb_build_object(
    'update_state',v_update_state,'delete_state',v_delete_state,'truncate_state',v_truncate_state,
    'update_message',COALESCE(v_update_msg,''),'delete_message',COALESCE(v_delete_msg,''),'truncate_message',COALESCE(v_truncate_msg,'')
  )::text,true);
END $$;


RESET ROLE;

SELECT extensions.ok(
  current_setting('app.phase1_role_context')::jsonb->>'current_user'='rebatehq_app'
  AND current_setting('app.phase1_role_context')::jsonb->>'rolsuper'='false'
  AND current_setting('app.phase1_role_context')::jsonb->>'rolbypassrls'='false',
  'SET ROLE used NOSUPERUSER and NOBYPASSRLS rebatehq_app'
);
SELECT extensions.ok(current_setting('app.phase1_auth_policy_result')::jsonb->>'passed'='true',
  'A membership policy evaluates auth.uid() for the rep''s own row without auth schema USAGE');
SELECT extensions.ok(
  current_setting('app.phase1_positive_select_result')::jsonb->>'passed'='true',
  'Tenant A can SELECT its own seeded row in every tenant table: '||(current_setting('app.phase1_positive_select_result')::jsonb->>'detail')
);
SELECT extensions.ok(
  current_setting('app.phase1_positive_insert_result')::jsonb->>'passed'='true',
  'Tenant A INSERT succeeds per allowed table; failed table(s): '||(current_setting('app.phase1_positive_insert_result')::jsonb->>'detail')
);
SELECT extensions.ok(current_setting('app.phase1_positive_update_result')::jsonb->>'passed'='true',
  'Tenant A can UPDATE its own invite row under an allowed policy');
SELECT extensions.ok(current_setting('app.phase1_positive_delete_result')::jsonb->>'passed'='true',
  'Tenant A can DELETE its own inserted invite row under an allowed policy');
SELECT extensions.ok(current_setting('app.phase1_rep_delete_result')::jsonb->>'passed'='true',
  'A tenant rep can see its own membership but cannot DELETE it where policy forbids it');
SELECT extensions.ok(
  current_setting('app.phase1_cross_select_result')::jsonb->>'passed'='true',
  'Tenant A SELECT of Tenant B rows returns zero rows: '||(current_setting('app.phase1_cross_select_result')::jsonb->>'detail')
);
SELECT extensions.ok(
  current_setting('app.phase1_cross_update_result')::jsonb->>'passed'='true',
  'Tenant A cross-tenant UPDATE is rejected by RLS WITH CHECK (42501): '||(current_setting('app.phase1_cross_update_result')::jsonb->>'detail')
);
SELECT extensions.ok(
  current_setting('app.phase1_cross_delete_result')::jsonb->>'passed'='true',
  'Tenant A cross-tenant DELETE is RLS-filtered to zero rows: '||(current_setting('app.phase1_cross_delete_result')::jsonb->>'detail')
);
SELECT extensions.ok(
  current_setting('app.phase1_cross_insert_result')::jsonb->>'passed'='true',
  'Tenant A cross-tenant INSERT fails with an RLS violation (42501): '||(current_setting('app.phase1_cross_insert_result')::jsonb->>'detail')
);
SELECT extensions.is(current_setting('app.phase1_rep_audit_rows')::int,0,'A tenant rep cannot read audit_log rows');
SELECT extensions.is(current_setting('app.phase1_missing_auth_rows')::int,0,'No authenticated user context returns zero tenant rows');
SELECT extensions.is(current_setting('app.phase1_audit_app_result')::jsonb->>'update_state','42501','App role cannot UPDATE audit_log');
SELECT extensions.is(current_setting('app.phase1_audit_app_result')::jsonb->>'delete_state','42501','App role cannot DELETE audit_log');
SELECT extensions.ok(
  current_setting('app.phase1_audit_app_result')::jsonb->>'truncate_state'='42501'
  AND position('permission denied for table audit_log' in lower(current_setting('app.phase1_audit_app_result')::jsonb->>'truncate_message'))>0,
  'App role TRUNCATE audit_log is denied by the table ACL'
);
SELECT extensions.throws_ok('UPDATE public.audit_log SET action=''tampered'' WHERE id=''__PHASE1_AUDIT_B_ID__''','55000',NULL,'Database immutability trigger rejects UPDATE even with elevated rights');
SELECT extensions.throws_ok('DELETE FROM public.audit_log WHERE id=''__PHASE1_AUDIT_B_ID__''','55000',NULL,'Database immutability trigger rejects DELETE even with elevated rights');
SELECT extensions.throws_ok('TRUNCATE public.audit_log','55000',NULL,'Statement-level trigger rejects audit_log TRUNCATE even with elevated rights');

SELECT extensions.ok(current_setting('app.phase1_direct_null_audit_result')::jsonb->>'passed'='true',
  'App role cannot directly insert a null-tenant auth.login_failed audit row');
SELECT extensions.ok(
  current_setting('app.phase1_failed_login_result')::jsonb->>'passed'='true'
  AND EXISTS (SELECT 1 FROM public.audit_log WHERE tenant_id IS NULL AND actor_id IS NULL
    AND action='auth.login_failed' AND entity_type='auth_user' AND ip='192.0.2.45')
  AND NOT EXISTS (SELECT 1 FROM public.audit_log WHERE ip='192.0.2.45'
    AND (tenant_id IS NOT NULL OR actor_id IS NOT NULL OR action<>'auth.login_failed')),
  'record_failed_login always writes fixed auth.login_failed with NULL tenant and actor, despite a known email and spoofed actor setting'
);
SELECT extensions.ok(
  (SELECT p.proargnames=ARRAY['p_email','p_ip','p_user_agent']::text[]
      AND position('VALUES(NULL,NULL,''auth.login_failed''' IN p.prosrc)>0
   FROM pg_proc p WHERE p.oid='public.record_failed_login(text,text,text)'::regprocedure),
  'record_failed_login accepts no caller actor/tenant arguments and uses fixed NULL tenant/actor and action'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='public.record_failed_login(text,text,text)'::regprocedure
      AND a.grantee=0 AND a.privilege_type='EXECUTE'
  )
  AND NOT has_function_privilege('anon','public.record_failed_login(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.record_failed_login(text,text,text)','EXECUTE'),
  'record_failed_login EXECUTE is revoked from PUBLIC, anon, and authenticated'
);
SELECT extensions.ok(
  has_function_privilege('rebatehq_app','public.record_failed_login(text,text,text)','EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_temp.phase1_function_acl_errors WHERE prosecdef IS TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclobjtype='f' AND d.defaclnamespace IN (0,'public'::regnamespace)
      AND acl.privilege_type='EXECUTE' AND acl.grantee<>d.defaclrole
      AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef AND p.proowner=d.defaclrole)
  ),
  'All public SECURITY DEFINER EXECUTE ACLs match the owner/app allowlist; no extra default grants exist'
);
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_auth_members WHERE member='rebatehq_app'::regrole
), 'rebatehq_app has no role memberships that could supply hidden privileges');

-- Check the actual platform ACL; Supabase owns auth.uid(), so this migration
-- role cannot manage its grants. The connection/runner prints the full ACL.
SET LOCAL ROLE rebatehq_app;
SELECT pg_temp.use_identity('__PHASE1_USER_REP_ID__');
SET LOCAL request.jwt.claims = '{"sub":"__PHASE1_USER_REP_ID__","role":"authenticated"}';
DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.membership
      WHERE tenant_id='__PHASE1_TENANT_B_ID__'
        AND user_id='__PHASE1_USER_REP_ID__';
    PERFORM set_config('app.phase1_auth_uid_authenticated_result',jsonb_build_object('passed',n=1,'state','00000','message',NULL,'visible_rows',n)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_auth_uid_authenticated_result',jsonb_build_object('passed',false,'state',v_state,'message',v_msg,'visible_rows',NULL)::text,true);
  END;
END $$;
RESET ROLE;
SELECT extensions.ok(
  current_setting('app.phase1_auth_uid_authenticated_result')::jsonb->>'passed'='true',
  'Authenticated membership policy query returns the rep''s own row as rebatehq_app'
);

SET LOCAL ROLE rebatehq_app;
SELECT pg_temp.use_identity('');
SET LOCAL request.jwt.claims = '{}';
DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.membership
      WHERE tenant_id='__PHASE1_TENANT_B_ID__'
        AND user_id='__PHASE1_USER_REP_ID__';
    PERFORM set_config('app.phase1_auth_uid_no_context_result',jsonb_build_object('passed',n=0,'state','00000','message',NULL,'visible_rows',n)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_auth_uid_no_context_result',jsonb_build_object('passed',false,'state',v_state,'message',v_msg,'visible_rows',NULL)::text,true);
  END;
END $$;
RESET ROLE;

-- Emit the complete live privilege path and function ACL audit into the CI log.
SELECT jsonb_build_object(
  'auth_uid_owner',(SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.oid='auth.uid()'::regprocedure),
  'auth_uid_app_execute',has_function_privilege('rebatehq_app','auth.uid()','EXECUTE'),
  'auth_uid_authenticated_policy_query',current_setting('app.phase1_auth_uid_authenticated_result')::jsonb,
  'auth_uid_missing_context_policy_query',current_setting('app.phase1_auth_uid_no_context_result')::jsonb,
  'auth_uid_acl',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'grantor',grantor_role.rolname,
      'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable
    ) ORDER BY acl.grantee,acl.privilege_type),'[]'::jsonb)
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
    LEFT JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
    WHERE p.oid='auth.uid()'::regprocedure
  ),
  'rebatehq_app_memberships',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role',granted_role.rolname,'grantor',grantor_role.rolname,
      'inherit',m.inherit_option,'set',m.set_option,'admin',m.admin_option
    ) ORDER BY granted_role.rolname),'[]'::jsonb)
    FROM pg_auth_members m
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE m.member='rebatehq_app'::regrole
  ),
  'record_failed_login',(
    SELECT jsonb_build_object(
      'owner',pg_get_userbyid(p.proowner),
      'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'grantor',grantor_role.rolname,
        'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
        'privilege',acl.privilege_type,'grantable',acl.is_grantable
      ) ORDER BY acl.grantee,acl.privilege_type)
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee),'[]'::jsonb),
      'default_execute',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'schema',COALESCE(schema_name.nspname,'<all schemas>'),
        'grantee',CASE WHEN default_acl.grantee=0 THEN 'PUBLIC' ELSE default_grantee.rolname END,
        'grantor',default_grantor.rolname,'grantable',default_acl.is_grantable
      ) ORDER BY default_acl.grantee)
      FROM pg_default_acl d
      LEFT JOIN pg_namespace schema_name ON schema_name.oid=d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) default_acl
      LEFT JOIN pg_roles default_grantee ON default_grantee.oid=default_acl.grantee
      LEFT JOIN pg_roles default_grantor ON default_grantor.oid=default_acl.grantor
      WHERE d.defaclrole=p.proowner AND d.defaclobjtype='f'
        AND d.defaclnamespace IN (0,'public'::regnamespace)
        AND default_acl.privilege_type='EXECUTE'),'[]'::jsonb)
    ) FROM pg_proc p WHERE p.oid='public.record_failed_login(text,text,text)'::regprocedure
  ),
  'public_security_definer_acl',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'signature',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      'owner',pg_get_userbyid(p.proowner),
      'acl',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'grantor',grantor_role.rolname,
        'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
        'privilege',acl.privilege_type,'grantable',acl.is_grantable
      ) ORDER BY acl.grantee,acl.privilege_type)
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee),'[]'::jsonb)
    ) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
  ),
  'public_security_definer_default_execute',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'owner',owner_role.rolname,
      'schema',COALESCE(schema_name.nspname,'<all schemas>'),
      'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
      'grantor',grantor_role.rolname,'grantable',acl.is_grantable
    ) ORDER BY owner_role.rolname,schema_name.nspname,acl.grantee),'[]'::jsonb)
    FROM pg_default_acl d
    JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole
    LEFT JOIN pg_namespace schema_name ON schema_name.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
    LEFT JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
    WHERE d.defaclobjtype='f' AND d.defaclnamespace IN (0,'public'::regnamespace)
      AND acl.privilege_type='EXECUTE'
      AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosecdef AND p.proowner=d.defaclrole)
  )
)::text AS phase1_ci_diagnostic;

SELECT extensions.ok(
  current_setting('app.phase1_auth_uid_no_context_result')::jsonb->>'passed'='true',
  'The same membership policy query returns zero rows as rebatehq_app without authenticated context'
);

-- This strengthened existing check covers every public function and exact ACL
-- through one versioned manifest (plan counts: see the plan() call at the top).
SELECT jsonb_build_object('function_acl_manifest_errors',COALESCE(
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY signature) FROM pg_temp.phase1_function_acl_errors e),'[]'::jsonb
))::text AS phase1_ci_diagnostic;
SELECT extensions.ok(
  (SELECT count(*) FROM pg_temp.phase1_function_allowlist)>=11
  AND (SELECT count(*) FROM pg_temp.phase1_public_function_inventory)>=11
  AND NOT EXISTS (SELECT 1 FROM pg_temp.phase1_function_acl_errors)
  AND NOT EXISTS (
    SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE d.defaclrole=current_setting('app.phase1_migration_owner')::regrole
      AND d.defaclnamespace IN (0,'public'::regnamespace) AND d.defaclobjtype='f'
      AND acl.privilege_type='EXECUTE' AND acl.grantee<>d.defaclrole
  ),
  'Every public function has a manifest entry and exactly its explicit EXECUTE grantee allowlist; future defaults grant nothing'
);

SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND (p.proowner<>current_setting('app.phase1_migration_owner')::regrole
      OR NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) AS config(setting) WHERE config.setting LIKE 'search_path=%'
      ))
), 'Every public SECURITY DEFINER function is owned by the migration role and pins search_path');

-- Derive browser-role call probes from the same exact-signature manifest.
SELECT set_config('app.phase1_function_permission_probes',COALESCE((
 SELECT jsonb_agg(format('SELECT %I.%I(%s)',n.nspname,p.proname,(
   SELECT string_agg('NULL::'||format_type(arg.type_oid,NULL),',' ORDER BY arg.ordinality)
   FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY arg(type_oid,ordinality)
 )) ORDER BY a.signature)
 FROM pg_temp.phase1_function_allowlist a JOIN pg_proc p ON p.oid=to_regprocedure(a.signature)
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE 'rebatehq_app'=ANY(a.grantees)
),'[]'::jsonb)::text,true);

SET LOCAL ROLE anon;
DO $$
DECLARE
  v_sql text;
  v_state text;
  v_message text;
  v_attempts jsonb:='[]'::jsonb;
  v_executable_count integer;
  v_tested integer:=0;
BEGIN
  SELECT count(*) INTO v_executable_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proowner=current_setting('app.phase1_migration_owner')::regrole
    AND has_function_privilege(current_user,p.oid,'EXECUTE');
  FOR v_sql IN SELECT jsonb_array_elements_text(current_setting('app.phase1_function_permission_probes')::jsonb) LOOP
    v_tested:=v_tested+1;
    v_state:='00000';
    v_message:='function call unexpectedly succeeded';
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
    END;
    v_attempts:=v_attempts||jsonb_build_array(jsonb_build_object('sql',v_sql,'sqlstate',v_state,'message',v_message));
  END LOOP;
  PERFORM set_config('app.phase1_anon_function_exec_result',jsonb_build_object(
    'effective_executable_count',v_executable_count,'tested',v_tested,'attempts',v_attempts
  )::text,true);
END $$;
RESET ROLE;
SELECT extensions.ok(
  current_setting('app.phase1_anon_function_exec_result')::jsonb->>'effective_executable_count'='0'
  AND (current_setting('app.phase1_anon_function_exec_result')::jsonb->>'tested')::int>=8
  AND (current_setting('app.phase1_anon_function_exec_result')::jsonb->>'tested')::int=jsonb_array_length(current_setting('app.phase1_function_permission_probes')::jsonb)
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(current_setting('app.phase1_anon_function_exec_result')::jsonb->'attempts') AS attempts(attempt)
    WHERE attempt->>'sqlstate'<>'42501' OR attempt->>'message' NOT ILIKE '%permission denied for function%'
  ), 'anon receives permission denied when calling every app-exposed function, independent of RLS'
);

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_sql text;
  v_state text;
  v_message text;
  v_attempts jsonb:='[]'::jsonb;
  v_executable_count integer;
  v_tested integer:=0;
BEGIN
  SELECT count(*) INTO v_executable_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proowner=current_setting('app.phase1_migration_owner')::regrole
    AND has_function_privilege(current_user,p.oid,'EXECUTE');
  FOR v_sql IN SELECT jsonb_array_elements_text(current_setting('app.phase1_function_permission_probes')::jsonb) LOOP
    v_tested:=v_tested+1;
    v_state:='00000';
    v_message:='function call unexpectedly succeeded';
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
    END;
    v_attempts:=v_attempts||jsonb_build_array(jsonb_build_object('sql',v_sql,'sqlstate',v_state,'message',v_message));
  END LOOP;
  PERFORM set_config('app.phase1_authenticated_function_exec_result',jsonb_build_object(
    'effective_executable_count',v_executable_count,'tested',v_tested,'attempts',v_attempts
  )::text,true);
END $$;
RESET ROLE;
SELECT extensions.ok(
  current_setting('app.phase1_authenticated_function_exec_result')::jsonb->>'effective_executable_count'='0'
  AND (current_setting('app.phase1_authenticated_function_exec_result')::jsonb->>'tested')::int>=8
  AND (current_setting('app.phase1_authenticated_function_exec_result')::jsonb->>'tested')::int=jsonb_array_length(current_setting('app.phase1_function_permission_probes')::jsonb)
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(current_setting('app.phase1_authenticated_function_exec_result')::jsonb->'attempts') AS attempts(attempt)
    WHERE attempt->>'sqlstate'<>'42501' OR attempt->>'message' NOT ILIKE '%permission denied for function%'
  ), 'authenticated receives permission denied when calling every app-exposed function, independent of RLS'
);

SELECT extensions.ok(
  current_setting('app.phase1_restore_baseline_result')::jsonb->>'sentinel_matches'='true',
  'Restore-only: sentinel tenant and licence location are present with the source content hash: '||
    (current_setting('app.phase1_restore_baseline_result')::jsonb->>'detail')
) WHERE current_setting('app.restore_test_mode',true)='true';
SELECT extensions.ok(
  current_setting('app.phase1_restore_baseline_result')::jsonb->>'counts_match'='true',
  'Restore-only: every table/tenant row count still matches the source baseline before suite fixtures: '||
    (current_setting('app.phase1_restore_baseline_result')::jsonb->>'detail')
) WHERE current_setting('app.restore_test_mode',true)='true';
SELECT extensions.ok(
  current_setting('app.phase1_restore_real_isolation_result')::jsonb->>'passed'='true'
    AND (current_setting('app.phase1_restore_real_isolation_result')::jsonb->>'checked_tables')::integer>=13,
  'Restore-only: synthetic Tenant A sees zero rows from the real restored sentinel tenant in every application table: '||
    (current_setting('app.phase1_restore_real_isolation_result')::jsonb->>'detail')
) WHERE current_setting('app.restore_test_mode',true)='true';

-- 8R: no authenticated context hides every remaining public tenant table the app role may read.
SET LOCAL ROLE rebatehq_app;
SELECT pg_temp.use_identity(''),set_config('request.jwt.claims','{}',true);
DO $$ DECLARE t text; n integer; checked integer:=0; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe no-context test role'; END IF;
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r' AND has_table_privilege(current_user,c.oid,'SELECT')
     AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) ORDER BY 1 LOOP
  checked:=checked+1;
  EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION '%: unauthenticated context exposed % rows',t,n; END IF;
 END LOOP;
 IF checked<15 THEN RAISE EXCEPTION 'No-context loop expected at least 15 readable tenant tables, checked %',checked; END IF;
 PERFORM set_config('app.phase1_no_context_tables',checked::text,true);
END $$;
RESET ROLE;
SELECT extensions.ok(current_setting('app.phase1_no_context_tables')::int>=13,'Every readable public tenant table returns zero rows without user context ('||current_setting('app.phase1_no_context_tables')||' tables)');

-- A manager can neither read nor change invites: they are owner-only. Tenant B's owner stays a manager for the
-- included 5B, 7A and 8D checks below, as before 8R.
UPDATE public.membership SET role='manager' WHERE tenant_id='__PHASE1_TENANT_B_ID__' AND user_id='__PHASE1_USER_B_ID__';
SET LOCAL ROLE rebatehq_app;
SELECT pg_temp.use_identity('__PHASE1_USER_B_ID__'),
 set_config('request.jwt.claims','{"sub":"__PHASE1_USER_B_ID__","role":"authenticated"}',true),
 set_config('app.real_actor_id','__PHASE1_USER_B_ID__',true);
DO $$ DECLARE n integer; message text; v_row jsonb; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe manager policy test role'; END IF;
 SELECT count(*) INTO n FROM public.invite WHERE tenant_id='__PHASE1_TENANT_B_ID__';
 IF n<>0 THEN RAISE EXCEPTION 'invite: manager SELECT exposed % rows',n; END IF;
 UPDATE public.invite SET email=email WHERE tenant_id='__PHASE1_TENANT_B_ID__'; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'invite: manager UPDATE allowed'; END IF;
 DELETE FROM public.invite WHERE tenant_id='__PHASE1_TENANT_B_ID__'; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'invite: manager DELETE allowed'; END IF;
 v_row:=current_setting('app.phase1_tenant_b_fixtures')::jsonb->'invite' || jsonb_build_object('id',gen_random_uuid(),'token_hash',replace(gen_random_uuid()::text,'-',''),'email','phase1-manager-'||gen_random_uuid()||'@example.invalid','invited_by','__PHASE1_USER_B_ID__');
 BEGIN
  INSERT INTO public.invite SELECT (jsonb_populate_record(NULL::public.invite,v_row)).*;
  RAISE EXCEPTION 'invite: manager INSERT allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF position('row-level security' in lower(message))=0 THEN RAISE EXCEPTION 'invite: wrong manager denial %',message; END IF;
 END;
 PERFORM set_config('app.phase1_manager_invite','true',true);
END $$;
RESET ROLE;
SELECT extensions.ok(current_setting('app.phase1_manager_invite')='true','Only owners may read or change invites; a manager can do neither');

-- INCLUDE CHUNK 5B CHECKS
-- INCLUDE CHUNK 7A CHECKS
-- INCLUDE CHUNK 8D CHECKS
-- INCLUDE SHARING S2 CHECKS
-- INCLUDE SHARING S3 CHECKS
-- INCLUDE SHARING S4 CHECKS
SELECT * FROM extensions.finish();
ROLLBACK;
