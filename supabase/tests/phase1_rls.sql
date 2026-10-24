BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(45);

-- Fixed local-only actors and two isolated tenants. The transaction rolls back.
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','phase1-a@example.invalid','',now(),now(),now()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','phase1-b@example.invalid','',now(),now(),now()),
 ('10000000-0000-4000-8000-000000000003','authenticated','authenticated','phase1-rep@example.invalid','',now(),now(),now())
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tenant(tenant_id,name,created_by) VALUES
 ('20000000-0000-4000-8000-000000000001','Phase 1 tenant A','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','Phase 1 tenant B','10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id) DO NOTHING;
INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','phase1-a@example.invalid','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','phase1-b@example.invalid','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','phase1-rep@example.invalid','rep')
ON CONFLICT(tenant_id,user_id) DO NOTHING;

INSERT INTO public.customer(tenant_id,id,account_no,name,assigned_rep_id) VALUES
 ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','A-001','Tenant A customer','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','B-001','Tenant B customer','10000000-0000-4000-8000-000000000003')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.product(tenant_id,id,sku,name,category,list_price,unit_cost) VALUES
 ('20000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','A-SKU','Tenant A product','Test',100,60),
 ('20000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002','B-SKU','Tenant B product','Test',100,60)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.invite(id,tenant_id,email,role,token_hash,invited_by,expires_at) VALUES
 ('32000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','new-b@example.invalid','rep',repeat('b',64),'10000000-0000-4000-8000-000000000002',now()+interval '7 days')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.price_list(tenant_id,id,name) VALUES
 ('20000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','B price list')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.price_list_version(tenant_id,id,price_list_id,version_no,status,created_by) VALUES
 ('20000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002',1,'draft','10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.price_list_item(tenant_id,id,price_list_id,product_id,unit_price,version_id) VALUES
 ('20000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002',100,'34000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.margin_policy(tenant_id,id,scope_type,scope_key,target_margin_pct,floor_margin_pct,walkaway_margin_pct,updated_by) VALUES
 ('20000000-0000-4000-8000-000000000002','36000000-0000-4000-8000-000000000002','global','',30,22,18,'10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id,id) DO NOTHING;

INSERT INTO public.quote(tenant_id,id,customer_id,created_by,status,pocket_price,cogs_total,pocket_margin,margin_pct,margin_zone,headroom) VALUES
 ('20000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','pending_approval',100,60,40,40,'green',22),
 ('20000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','pending_approval',100,60,40,40,'green',22)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.quote_line(tenant_id,id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct) VALUES
 ('20000000-0000-4000-8000-000000000002','38000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002',1,100,100,60,40,40)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.approval(tenant_id,id,quote_id,requested_by,status,margin_pct_at_decision,policy_version) VALUES
 ('20000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','pending',40,1),
 ('20000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','pending',40,1)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.sales_order(tenant_id,id,source_id,customer_id,product_id,quantity,month_key) VALUES
 ('20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','B-SO-1','30000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002',1,'2026-10')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.rebate_agreement(tenant_id,id,party_type,party_id,name,rate_pct,threshold_amount,period_start,period_end) VALUES
 ('20000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','vendor','B-VENDOR','B rebate',2,1000,'2026-01-01','2026-12-31')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.rebate_progress(tenant_id,id,agreement_id,period_start,period_end,eligible_spend,modeled_amount,recorded_credits) VALUES
 ('20000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','2026-01-01','2026-12-31',1000,20,10)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.invoice(tenant_id,id,customer_id,invoice_date,source_ref) VALUES
 ('20000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','2026-10-01','B-INV-1')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.invoice_line(tenant_id,id,invoice_id,product_id,quantity,net_sales) VALUES
 ('20000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','43000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000002',1,100)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.cost_component(tenant_id,id,invoice_line_id,component_type,amount) VALUES
 ('20000000-0000-4000-8000-000000000002','45000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','freight',5)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.supplier_credit(tenant_id,id,vendor_name,credit_date,amount,reference) VALUES
 ('20000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','B vendor','2026-10-02',5,'B-CREDIT')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.alert(tenant_id,id,severity,message) VALUES
 ('20000000-0000-4000-8000-000000000002','47000000-0000-4000-8000-000000000002','review','Tenant B fixture alert')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.margin_snapshot(tenant_id,id,entity_type,entity_id,period_month,order_count,pocket_revenue,pocket_margin,margin_pct) VALUES
 ('20000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','company','20000000-0000-4000-8000-000000000002','2026-10-01',1,100,40,40)
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.connector_secret(tenant_id,id,provider,ciphertext,nonce,auth_tag,created_by) VALUES
 ('20000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000002','netsuite','ciphertext','nonce','tag','10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.import_job(tenant_id,id,import_type,status,created_by) VALUES
 ('20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','prototype','dry_run','10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id,id) DO NOTHING;
INSERT INTO public.audit_log(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES
 ('51000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','test.fixture','tenant','20000000-0000-4000-8000-000000000002')
ON CONFLICT(id) DO NOTHING;

-- Include every application-owned public table, including tables added after
-- this test was written. Extension-owned objects are platform plumbing, not
-- tenant tables, and are intentionally excluded.
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

-- Preserve valid Tenant B rows before assuming the app role. Replaying each
-- complete row ensures NOT NULL/FK/check constraints cannot masquerade as an
-- RLS denial in the cross-tenant INSERT assertions below.
CREATE TEMP TABLE phase1_rls_insert_fixtures(table_name text PRIMARY KEY, row_data jsonb);
DO $$ DECLARE t text; n integer; expected_count integer; BEGIN
  SELECT count(*) INTO expected_count FROM pg_temp.phase1_rls_tables;
  IF expected_count < 24 THEN RAISE EXCEPTION 'Expected at least 24 tenant tables before fixture loop; found %',expected_count; END IF;
  FOR t IN SELECT table_name FROM pg_temp.phase1_rls_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=t AND column_name='tenant_id'
    ) THEN
      RAISE EXCEPTION 'Application table % is missing tenant_id',t;
    END IF;
    EXECUTE format(
      'INSERT INTO pg_temp.phase1_rls_insert_fixtures(table_name,row_data) SELECT %L,to_jsonb(x) FROM public.%I x WHERE tenant_id=$1 LIMIT 1',
      t,t
    ) USING '20000000-0000-4000-8000-000000000002'::uuid;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n=0 THEN
      RAISE EXCEPTION 'Tenant B fixture row is missing for application table %',t;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_insert_fixtures;
  IF n < 24 OR n <> expected_count THEN RAISE EXCEPTION 'Tenant B fixture loop covered % tables; expected at least 24 and one per tenant table (% expected)',n,expected_count; END IF;
END $$;
-- Build a corresponding Tenant A row for every tenant table. IDs and public
-- foreign keys get an A-side UUID; auth user references point to user A.
-- tenant and membership already have valid A rows, and audit gets its own row.
INSERT INTO public.audit_log(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES
 ('51000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test.fixture','tenant','20000000-0000-4000-8000-000000000001')
ON CONFLICT(id) DO NOTHING;
DO $$ DECLARE t text; v_row jsonb; col_name name; auth_ref boolean; public_ref boolean; n integer; BEGIN
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_insert_fixtures;
  IF n < 24 THEN RAISE EXCEPTION 'Tenant A clone loop needs at least 24 source fixtures; found %',n; END IF;
  FOR t,v_row IN
    SELECT f.table_name,f.row_data FROM pg_temp.phase1_rls_insert_fixtures f
    JOIN pg_class class_row ON class_row.relname=f.table_name JOIN pg_namespace ns ON ns.oid=class_row.relnamespace AND ns.nspname='public'
    ORDER BY class_row.oid
  LOOP
    IF t NOT IN ('tenant','membership','audit_log') THEN
      v_row:=jsonb_set(v_row,'{tenant_id}',to_jsonb('20000000-0000-4000-8000-000000000001'::uuid),true);
      SELECT count(*) INTO n FROM pg_attribute a
      WHERE a.attrelid=format('public.%I',t)::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype;
      IF n=0 THEN RAISE EXCEPTION 'Tenant A clone loop found no UUID columns on public.%',t; END IF;
      FOR col_name,auth_ref,public_ref IN
        SELECT a.attname::name,
               COALESCE(bool_or(rn.nspname='auth'),false),
               COALESCE(bool_or(rn.nspname='public'),false)
        FROM pg_attribute a
        LEFT JOIN pg_constraint fk ON fk.contype='f' AND fk.conrelid=a.attrelid AND a.attnum=ANY(fk.conkey)
        LEFT JOIN pg_class refc ON refc.oid=fk.confrelid
        LEFT JOIN pg_namespace rn ON rn.oid=refc.relnamespace
        WHERE a.attrelid=format('public.%I',t)::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
        GROUP BY a.attname
      LOOP
        IF col_name='tenant_id' THEN CONTINUE;
        ELSIF auth_ref THEN
          v_row:=jsonb_set(v_row,ARRAY[col_name::text],to_jsonb('10000000-0000-4000-8000-000000000001'::uuid),true);
        ELSIF col_name='id' OR public_ref THEN
          IF v_row->>col_name::text IS NOT NULL THEN
            v_row:=jsonb_set(v_row,ARRAY[col_name::text],to_jsonb(regexp_replace(v_row->>col_name::text,'2$','3')::uuid),true);
          END IF;
        END IF;
      END LOOP;
      IF t='invite' THEN
        v_row:=jsonb_set(v_row,'{token_hash}',to_jsonb(repeat('a',64)),true);
        v_row:=jsonb_set(v_row,'{email}',to_jsonb('new-a@example.invalid'::text),true);
      ELSIF t='margin_snapshot' THEN
        v_row:=jsonb_set(v_row,'{entity_id}',to_jsonb('20000000-0000-4000-8000-000000000001'::text),true);
      END IF;
      EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',t,t) USING v_row;
    END IF;
  END LOOP;
END $$;
-- Carry the admin-built fixture snapshot across SET ROLE in a transaction-local
-- custom setting. The restricted app role never needs access to pg_temp or
-- the extensions schema to run these policy checks.
SELECT set_config(
  'app.phase1_tenant_b_fixtures',
  (SELECT jsonb_object_agg(table_name,row_data)::text FROM pg_temp.phase1_rls_insert_fixtures),
  true
);
CREATE TEMP TABLE phase1_rls_tenant_a_fixtures(table_name text PRIMARY KEY,row_data jsonb);
DO $$ DECLARE t text; n integer; expected_count integer; BEGIN
  SELECT count(*) INTO expected_count FROM pg_temp.phase1_rls_tables;
  IF expected_count < 24 THEN RAISE EXCEPTION 'Tenant A fixture loop needs at least 24 tenant tables; found %',expected_count; END IF;
  FOR t IN SELECT table_name FROM pg_temp.phase1_rls_tables LOOP
    EXECUTE format(
      'INSERT INTO pg_temp.phase1_rls_tenant_a_fixtures(table_name,row_data) SELECT %L,to_jsonb(x) FROM public.%I x WHERE tenant_id=$1 LIMIT 1',
      t,t
    ) USING '20000000-0000-4000-8000-000000000001'::uuid;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n=0 THEN RAISE EXCEPTION 'Tenant A positive-control fixture row is missing for public.%',t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_temp.phase1_rls_tenant_a_fixtures;
  IF n < 24 OR n <> expected_count THEN RAISE EXCEPTION 'Tenant A fixture loop covered % tables; expected at least 24 and one per tenant table (% expected)',n,expected_count; END IF;
END $$;
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
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname='margindesk_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin), 'margindesk_app is NOLOGIN, NOSUPERUSER, and NOBYPASSRLS');
SELECT extensions.ok(NOT has_table_privilege('authenticated','public.product','SELECT'), 'Browser role has no direct product table grant');
SELECT extensions.ok(has_schema_privilege('margindesk_app','public','USAGE'),'App role has public schema USAGE');
SELECT extensions.ok(NOT has_schema_privilege('margindesk_app','auth','USAGE'),'App role has NO auth schema USAGE');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth' AND c.relkind IN ('r','p','v','m','f')
    AND (has_table_privilege('margindesk_app',c.oid,'SELECT')
      OR has_any_column_privilege('margindesk_app',c.oid,'SELECT')
      OR has_table_privilege('margindesk_app',c.oid,'INSERT')
      OR has_any_column_privilege('margindesk_app',c.oid,'INSERT')
      OR has_table_privilege('margindesk_app',c.oid,'UPDATE')
      OR has_any_column_privilege('margindesk_app',c.oid,'UPDATE')
      OR has_table_privilege('margindesk_app',c.oid,'DELETE')
      OR has_table_privilege('margindesk_app',c.oid,'TRUNCATE')
      OR has_table_privilege('margindesk_app',c.oid,'REFERENCES')
      OR has_any_column_privilege('margindesk_app',c.oid,'REFERENCES')
      OR has_table_privilege('margindesk_app',c.oid,'TRIGGER'))
), 'App role has no table privileges in auth schema');
SELECT extensions.ok(has_language_privilege('margindesk_app','plpgsql','USAGE'),'App role has PL/pgSQL USAGE');
SELECT extensions.ok(
  has_function_privilege('margindesk_app','auth.uid()','EXECUTE')
  AND EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='auth.uid()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'
  ),
  'App role can execute auth.uid() through the Supabase platform PUBLIC grant'
);
SELECT extensions.ok(has_function_privilege('margindesk_app','public.is_tenant_member(uuid)','EXECUTE'),'App role has EXECUTE on public.is_tenant_member(uuid)');
SELECT extensions.ok(has_function_privilege('margindesk_app','public.is_tenant_role(uuid,text[])','EXECUTE'),'App role has EXECUTE on public.is_tenant_role(uuid,text[])');
SELECT extensions.ok(has_function_privilege('margindesk_app','public.is_tenant_role_any_status(uuid,text[])','EXECUTE'),'App role has EXECUTE on public.is_tenant_role_any_status(uuid,text[])');
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
  WHERE NOT has_table_privilege('margindesk_app',format('public.%I',r.table_name),r.privilege)
)
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM missing),
  'App table grants are present; missing='||COALESCE((SELECT string_agg(table_name||'.'||privilege,', ' ORDER BY table_name,privilege) FROM missing),'none'));
SELECT extensions.ok(
  NOT has_table_privilege('margindesk_app','public.audit_log','UPDATE')
  AND NOT has_table_privilege('margindesk_app','public.audit_log','DELETE')
  AND NOT has_table_privilege('margindesk_app','public.audit_log','TRUNCATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='public.audit_log'::regclass AND a.grantee=0 AND a.privilege_type IN ('UPDATE','DELETE','TRUNCATE')
  ),
  'audit_log has no UPDATE, DELETE, or TRUNCATE grant to margindesk_app or PUBLIC');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_temp.phase1_rls_tables t
  WHERE EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid=format('public.%I',t.table_name)::regclass AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
  )
),'PUBLIC has no write or TRUNCATE grants on tenant tables');
SELECT extensions.ok(
  NOT has_table_privilege('margindesk_app','public.tenant','INSERT')
  AND NOT has_table_privilege('margindesk_app','public.tenant','DELETE')
  AND NOT has_table_privilege('margindesk_app','public.membership','INSERT'),
  'App role has no tenant or membership write operations forbidden to every policy');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM pg_temp.phase1_rls_tables t
  WHERE t.table_name<>'audit_log' AND has_table_privilege('margindesk_app',format('public.%I',t.table_name),'TRUNCATE')
),'App role has no TRUNCATE privilege on tenant tables');

SET LOCAL ROLE margindesk_app;
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
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  BEGIN
    SELECT count(*) INTO n FROM public.customer
      WHERE tenant_id='20000000-0000-4000-8000-000000000002'
        AND id='30000000-0000-4000-8000-000000000002';
    PERFORM set_config('app.phase1_auth_policy_result',jsonb_build_object('passed',n=1,'visible_rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_auth_policy_result',jsonb_build_object('passed',false,'visible_rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
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
    PERFORM set_config('app.real_actor_id','10000000-0000-4000-8000-000000000002',true);
    PERFORM public.record_failed_login('phase1-a@example.invalid','192.0.2.45','pgTAP controlled-path probe');
    PERFORM set_config('app.phase1_failed_login_result',jsonb_build_object('passed',true,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_failed_login_result',jsonb_build_object('passed',false,'state',v_state,'message',v_msg)::text,true);
  END;
  -- Do not let the deliberate spoof setting contaminate later tenant-A
  -- positive controls in this transaction.
  PERFORM set_config('app.real_actor_id','10000000-0000-4000-8000-000000000001',true);
END $$;

DO $$ DECLARE t text; n integer; v_missing text:=''; v_state text; v_msg text; BEGIN
  SELECT count(*) INTO n FROM jsonb_object_keys(current_setting('app.phase1_tenant_a_fixtures')::jsonb);
  IF n<24 THEN RAISE EXCEPTION 'Tenant A positive SELECT loop expected at least 24 tables; found %',n; END IF;
  FOR t IN SELECT jsonb_object_keys(current_setting('app.phase1_tenant_a_fixtures')::jsonb) LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING '20000000-0000-4000-8000-000000000001'::uuid;
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
  IF n<22 THEN RAISE EXCEPTION 'Tenant A positive INSERT loop expected at least 22 policy-allowed tables; found %',n; END IF;
  FOR t,v_row IN SELECT key,value FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb)
    WHERE key NOT IN ('tenant','membership') LOOP
    v_insert:=jsonb_set(v_row,'{id}',to_jsonb(gen_random_uuid()),true);
    IF t='customer' THEN v_insert:=jsonb_set(v_insert,'{account_no}',to_jsonb('A-positive-control'::text),true);
    ELSIF t='product' THEN v_insert:=jsonb_set(v_insert,'{sku}',to_jsonb('A-POSITIVE-CONTROL'::text),true);
    ELSIF t='invite' THEN
      v_insert:=jsonb_set(v_insert,'{token_hash}',to_jsonb(repeat('c',64)),true);
      v_insert:=jsonb_set(v_insert,'{email}',to_jsonb('new-c@example.invalid'::text),true);
    ELSIF t='price_list_version' THEN v_insert:=jsonb_set(v_insert,'{version_no}',to_jsonb((v_row->>'version_no')::integer+1),true);
    ELSIF t='margin_policy' THEN v_insert:=jsonb_set(v_insert,'{scope_key}',to_jsonb('positive-control'::text),true);
    ELSIF t='sales_order' THEN v_insert:=jsonb_set(v_insert,'{source_id}',to_jsonb('A-POSITIVE-CONTROL'::text),true);
    ELSIF t='margin_snapshot' THEN v_insert:=jsonb_set(v_insert,'{entity_id}',to_jsonb('positive-control'::text),true);
    ELSIF t='connector_secret' THEN v_insert:=jsonb_set(v_insert,'{provider}',to_jsonb('positive-control'::text),true);
    ELSIF t='audit_log' THEN
      v_insert:=jsonb_set(v_insert,'{actor_id}',to_jsonb('10000000-0000-4000-8000-000000000001'::uuid),true);
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
    UPDATE public.customer SET name='Tenant A customer updated by positive control'
      WHERE tenant_id='20000000-0000-4000-8000-000000000001'
        AND id='30000000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS n=ROW_COUNT;
    PERFORM set_config('app.phase1_positive_update_result',jsonb_build_object('passed',n=1,'rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_positive_update_result',jsonb_build_object('passed',false,'rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
END $$;

DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    DELETE FROM public.customer WHERE tenant_id='20000000-0000-4000-8000-000000000001'
      AND account_no='A-positive-control';
    GET DIAGNOSTICS n=ROW_COUNT;
    PERFORM set_config('app.phase1_positive_delete_result',jsonb_build_object('passed',n=1,'rows',n,'state',NULL,'message',NULL)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_positive_delete_result',jsonb_build_object('passed',false,'rows',0,'state',v_state,'message',v_msg)::text,true);
  END;
END $$;

DO $$ DECLARE v_before integer; v_deleted integer; v_after integer; v_state text; v_msg text; BEGIN
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
  BEGIN
    SELECT count(*) INTO v_before FROM public.product
      WHERE tenant_id='20000000-0000-4000-8000-000000000002'
        AND id='31000000-0000-4000-8000-000000000002';
    DELETE FROM public.product WHERE tenant_id='20000000-0000-4000-8000-000000000002'
      AND id='31000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS v_deleted=ROW_COUNT;
    SELECT count(*) INTO v_after FROM public.product
      WHERE tenant_id='20000000-0000-4000-8000-000000000002'
        AND id='31000000-0000-4000-8000-000000000002';
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
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
END $$;

DO $$ DECLARE t text; n integer; v_missing text:=''; v_state text; v_msg text; BEGIN
  SELECT count(*) INTO n FROM jsonb_object_keys(current_setting('app.phase1_tenant_b_fixtures')::jsonb);
  IF n<24 THEN RAISE EXCEPTION 'Tenant B cross-SELECT loop expected at least 24 tables; found %',n; END IF;
  FOR t IN SELECT jsonb_object_keys(current_setting('app.phase1_tenant_b_fixtures')::jsonb) LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING '20000000-0000-4000-8000-000000000002'::uuid;
      IF n<>0 THEN v_missing:=concat_ws(', ',v_missing,t||' ('||n||' rows visible)'); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
      v_missing:=concat_ws(', ',v_missing,t||' ('||v_state||': '||v_msg||')');
    END;
  END LOOP;
  PERFORM set_config('app.phase1_cross_select_result',jsonb_build_object('passed',v_missing='','detail',COALESCE(v_missing,'none'))::text,true);
END $$;

-- A cross-tenant UPDATE starts from an A-visible row and changes its tenant_id;
-- RLS WITH CHECK must reject it. Approval is intentionally skipped because its
-- UPDATE policy forbids a requester from modifying their own approval.
DO $$ DECLARE t text; v_state text; v_msg text; v_bad text:=''; n integer; BEGIN
  SELECT count(*) INTO n FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb) WHERE key NOT IN ('audit_log','approval');
  IF n<22 THEN
    RAISE EXCEPTION 'Cross-tenant UPDATE loop expected at least 22 eligible tables';
  END IF;
  FOR t IN SELECT key FROM jsonb_each(current_setting('app.phase1_tenant_a_fixtures')::jsonb)
    WHERE key NOT IN ('audit_log','approval') LOOP
    v_state:='00000'; v_msg:='';
    BEGIN
      EXECUTE format('UPDATE public.%I SET tenant_id=$1 WHERE tenant_id=$2',t)
        USING '20000000-0000-4000-8000-000000000002'::uuid,'20000000-0000-4000-8000-000000000001'::uuid;
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
  IF n<22 THEN
    RAISE EXCEPTION 'Cross-tenant DELETE loop expected at least 22 eligible tables';
  END IF;
  FOR t IN SELECT key FROM jsonb_each(current_setting('app.phase1_tenant_b_fixtures')::jsonb)
    WHERE key NOT IN ('tenant','audit_log') LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id=$1',t) USING '20000000-0000-4000-8000-000000000002'::uuid;
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
  IF n<22 THEN
    RAISE EXCEPTION 'Cross-tenant INSERT loop expected at least 22 eligible tables';
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

DO $$ DECLARE n integer; v_pending boolean; BEGIN
  BEGIN
    UPDATE public.approval SET status='approved',decided_by='10000000-0000-4000-8000-000000000001',decided_at=now()
      WHERE tenant_id='20000000-0000-4000-8000-000000000001' AND id='39000000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS n=ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n:=0;
  END;
  SELECT status='pending' INTO v_pending FROM public.approval
    WHERE tenant_id='20000000-0000-4000-8000-000000000001' AND id='39000000-0000-4000-8000-000000000001';
  PERFORM set_config('app.phase1_own_approval_ok',(n=0 AND COALESCE(v_pending,false))::text,true);
END $$;

-- This authenticated rep belongs to Tenant B, which has an audit fixture.
-- A zero count therefore proves the audit policy is role-restricted, not just
-- tenant-isolated.
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
SELECT set_config(
  'app.phase1_rep_audit_rows',
  (SELECT count(*)::text FROM public.audit_log WHERE tenant_id='20000000-0000-4000-8000-000000000002'),
  true
);

SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{}';
SELECT set_config(
  'app.phase1_missing_auth_rows',
  (SELECT count(*)::text FROM public.product WHERE tenant_id='20000000-0000-4000-8000-000000000002'),
  true
);

DO $$ DECLARE v_update_state text:='00000'; v_delete_state text:='00000'; v_truncate_state text:='00000'; v_update_msg text; v_delete_msg text; v_truncate_msg text; BEGIN
  BEGIN
    UPDATE public.audit_log SET action='tampered' WHERE tenant_id='20000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_update_state=RETURNED_SQLSTATE, v_update_msg=MESSAGE_TEXT;
  END;
  BEGIN
    DELETE FROM public.audit_log WHERE tenant_id='20000000-0000-4000-8000-000000000001';
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
  current_setting('app.phase1_role_context')::jsonb->>'current_user'='margindesk_app'
  AND current_setting('app.phase1_role_context')::jsonb->>'rolsuper'='false'
  AND current_setting('app.phase1_role_context')::jsonb->>'rolbypassrls'='false',
  'SET ROLE used NOSUPERUSER and NOBYPASSRLS margindesk_app'
);
SELECT extensions.ok(current_setting('app.phase1_auth_policy_result')::jsonb->>'passed'='true',
  'A customer policy evaluates auth.uid() for its assigned rep without auth schema USAGE');
SELECT extensions.ok(
  current_setting('app.phase1_positive_select_result')::jsonb->>'passed'='true',
  'Tenant A can SELECT its own seeded row in every tenant table: '||(current_setting('app.phase1_positive_select_result')::jsonb->>'detail')
);
SELECT extensions.ok(
  current_setting('app.phase1_positive_insert_result')::jsonb->>'passed'='true',
  'Tenant A INSERT succeeds per allowed table; failed table(s): '||(current_setting('app.phase1_positive_insert_result')::jsonb->>'detail')
);
SELECT extensions.ok(current_setting('app.phase1_positive_update_result')::jsonb->>'passed'='true',
  'Tenant A can UPDATE its own customer row under an allowed policy');
SELECT extensions.ok(current_setting('app.phase1_positive_delete_result')::jsonb->>'passed'='true',
  'Tenant A can DELETE its own inserted customer row under an allowed policy');
SELECT extensions.ok(current_setting('app.phase1_rep_delete_result')::jsonb->>'passed'='true',
  'A tenant rep can see a product but cannot DELETE where policy forbids it');
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
SELECT extensions.ok(current_setting('app.phase1_own_approval_ok')::boolean,'A user cannot decide their own quote approval');
SELECT extensions.is(current_setting('app.phase1_rep_audit_rows')::int,0,'A tenant rep cannot read audit_log rows');
SELECT extensions.is(current_setting('app.phase1_missing_auth_rows')::int,0,'No authenticated user context returns zero tenant rows');
SELECT extensions.is(current_setting('app.phase1_audit_app_result')::jsonb->>'update_state','42501','App role cannot UPDATE audit_log');
SELECT extensions.is(current_setting('app.phase1_audit_app_result')::jsonb->>'delete_state','42501','App role cannot DELETE audit_log');
SELECT extensions.ok(
  current_setting('app.phase1_audit_app_result')::jsonb->>'truncate_state'='42501'
  AND position('permission denied for table audit_log' in lower(current_setting('app.phase1_audit_app_result')::jsonb->>'truncate_message'))>0,
  'App role TRUNCATE audit_log is denied by the table ACL'
);
SELECT extensions.throws_ok('UPDATE public.audit_log SET action=''tampered'' WHERE id=''51000000-0000-4000-8000-000000000002''','55000',NULL,'Database immutability trigger rejects UPDATE even with elevated rights');
SELECT extensions.throws_ok('DELETE FROM public.audit_log WHERE id=''51000000-0000-4000-8000-000000000002''','55000',NULL,'Database immutability trigger rejects DELETE even with elevated rights');
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
  has_function_privilege('margindesk_app','public.record_failed_login(text,text,text)','EXECUTE')
  AND NOT EXISTS (
    WITH allowlist(signature,app_allowed) AS (VALUES
      ('is_tenant_member(p_tenant_id uuid)',true),
      ('is_tenant_role(p_tenant_id uuid, p_roles text[])',true),
      ('is_tenant_role_any_status(p_tenant_id uuid, p_roles text[])',true),
      ('audit_row_change()',false),
      ('prevent_audit_mutation()',false),
      ('create_tenant_with_owner(p_name text)',true),
      ('accept_tenant_invite(p_token text)',true),
      ('record_failed_login(p_email text, p_ip text, p_user_agent text)',true)
    ), defs AS (
      SELECT p.oid,p.proowner,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef
    )
    SELECT 1 FROM defs d LEFT JOIN allowlist a USING(signature)
    WHERE a.signature IS NULL
       OR EXISTS (
         SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
         WHERE p.oid=d.oid AND acl.privilege_type='EXECUTE'
           AND acl.grantee NOT IN (d.proowner,CASE WHEN a.app_allowed THEN 'margindesk_app'::regrole ELSE d.proowner END)
       )
       OR (a.app_allowed AND NOT EXISTS (
         SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
         WHERE p.oid=d.oid AND acl.grantee='margindesk_app'::regrole AND acl.privilege_type='EXECUTE'
       ))
  )
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
  SELECT 1 FROM pg_auth_members WHERE member='margindesk_app'::regrole
), 'margindesk_app has no role memberships that could supply hidden privileges');

-- Check the actual platform ACL; Supabase owns auth.uid(), so this migration
-- role cannot manage its grants. The connection/runner prints the full ACL.
SET LOCAL ROLE margindesk_app;
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.customer
      WHERE tenant_id='20000000-0000-4000-8000-000000000002'
        AND id='30000000-0000-4000-8000-000000000002';
    PERFORM set_config('app.phase1_auth_uid_authenticated_result',jsonb_build_object('passed',n=1,'state','00000','message',NULL,'visible_rows',n)::text,true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
    PERFORM set_config('app.phase1_auth_uid_authenticated_result',jsonb_build_object('passed',false,'state',v_state,'message',v_msg,'visible_rows',NULL)::text,true);
  END;
END $$;
RESET ROLE;
SELECT extensions.ok(
  current_setting('app.phase1_auth_uid_authenticated_result')::jsonb->>'passed'='true',
  'Authenticated customer policy query returns its assigned row as margindesk_app'
);

SET LOCAL ROLE margindesk_app;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
DO $$ DECLARE n integer; v_state text; v_msg text; BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.customer
      WHERE tenant_id='20000000-0000-4000-8000-000000000002'
        AND id='30000000-0000-4000-8000-000000000002';
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
  'auth_uid_app_execute',has_function_privilege('margindesk_app','auth.uid()','EXECUTE'),
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
  'margindesk_app_memberships',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role',granted_role.rolname,'grantor',grantor_role.rolname,
      'inherit',m.inherit_option,'set',m.set_option,'admin',m.admin_option
    ) ORDER BY granted_role.rolname),'[]'::jsonb)
    FROM pg_auth_members m
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    JOIN pg_roles grantor_role ON grantor_role.oid=m.grantor
    WHERE m.member='margindesk_app'::regrole
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
  'The same customer policy query returns zero rows as margindesk_app without authenticated context'
);
SELECT * FROM extensions.finish();
ROLLBACK;
