BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

-- Fixed local-only actors and two isolated tenants. The transaction rolls back.
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
VALUES
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','phase1-a@example.invalid','',now(),now(),now()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','phase1-b@example.invalid','',now(),now(),now())
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tenant(tenant_id,name,created_by) VALUES
 ('20000000-0000-4000-8000-000000000001','Phase 1 tenant A','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','Phase 1 tenant B','10000000-0000-4000-8000-000000000002')
ON CONFLICT(tenant_id) DO NOTHING;
INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','phase1-a@example.invalid','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','phase1-b@example.invalid','owner')
ON CONFLICT(tenant_id,user_id) DO NOTHING;

INSERT INTO public.customer(tenant_id,id,account_no,name,assigned_rep_id) VALUES
 ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','A-001','Tenant A customer','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','B-001','Tenant B customer','10000000-0000-4000-8000-000000000002')
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
  );

-- Preserve valid Tenant B rows before assuming the app role. Replaying each
-- complete row ensures NOT NULL/FK/check constraints cannot masquerade as an
-- RLS denial in the cross-tenant INSERT assertions below.
CREATE TEMP TABLE phase1_rls_insert_fixtures(table_name text PRIMARY KEY, row_data jsonb);
DO $$ DECLARE t text; n integer; BEGIN
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
END $$;
GRANT SELECT ON phase1_rls_insert_fixtures TO margindesk_app;
GRANT SELECT ON phase1_rls_tables TO margindesk_app;

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
SELECT extensions.ok(NOT EXISTS (
 SELECT 1 FROM pg_temp.phase1_rls_tables t
 WHERE NOT has_table_privilege('margindesk_app',format('public.%I',t.table_name),'SELECT')
    OR NOT has_table_privilege('margindesk_app',format('public.%I',t.table_name),'INSERT')
    OR (t.table_name <> 'audit_log' AND (
      NOT has_table_privilege('margindesk_app',format('public.%I',t.table_name),'UPDATE')
      OR NOT has_table_privilege('margindesk_app',format('public.%I',t.table_name),'DELETE')
    ))
    OR (t.table_name = 'audit_log' AND (
      has_table_privilege('margindesk_app',format('public.%I',t.table_name),'UPDATE')
      OR has_table_privilege('margindesk_app',format('public.%I',t.table_name),'DELETE')
    ))
), 'App role has intended table grants so isolation checks exercise RLS; audit log remains append-only');

SET LOCAL ROLE margindesk_app;
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';

DO $$ DECLARE t text; n integer; BEGIN
  FOR t IN SELECT table_name FROM pg_temp.phase1_rls_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING '20000000-0000-4000-8000-000000000002'::uuid;
    IF n<>0 THEN RAISE EXCEPTION 'cross-tenant rows visible in %',t; END IF;
  END LOOP;
END $$;
SELECT extensions.ok(true,'Tenant A cannot select Tenant B rows in any public tenant table');

DO $$ DECLARE t text; n integer; BEGIN
  FOR t IN SELECT table_name FROM pg_temp.phase1_rls_tables LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET tenant_id=tenant_id WHERE tenant_id=$1',t) USING '20000000-0000-4000-8000-000000000002'::uuid;
      GET DIAGNOSTICS n=ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN n:=0;
    END;
    IF n<>0 THEN RAISE EXCEPTION 'cross-tenant UPDATE affected % rows in %',n,t; END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id=$1',t) USING '20000000-0000-4000-8000-000000000002'::uuid;
      GET DIAGNOSTICS n=ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN n:=0;
    END;
    IF n<>0 THEN RAISE EXCEPTION 'cross-tenant DELETE affected % rows in %',n,t; END IF;
  END LOOP;
END $$;
SELECT extensions.ok(true,'Tenant A cannot update or delete Tenant B rows in any public tenant table');

DO $$ DECLARE t text; v_row jsonb; v_blocked boolean; BEGIN
  FOR t,v_row IN SELECT table_name,row_data FROM pg_temp.phase1_rls_insert_fixtures LOOP
    v_blocked:=false;
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',t,t
      ) USING v_row;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLSTATE <> '42501' THEN
        RAISE EXCEPTION 'Expected RLS 42501 for cross-tenant INSERT into %, got %: %',t,SQLSTATE,SQLERRM;
      END IF;
      v_blocked:=true;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Expected RLS 42501 for cross-tenant INSERT into %, got %: %',t,SQLSTATE,SQLERRM;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'cross-tenant INSERT unexpectedly passed RLS for %',t; END IF;
  END LOOP;
END $$;
SELECT extensions.ok(true,'Tenant A cannot insert rows under Tenant B in any public tenant table');

DO $$ DECLARE n integer; BEGIN
  UPDATE public.approval SET status='approved',decided_by='10000000-0000-4000-8000-000000000001',decided_at=now()
    WHERE tenant_id='20000000-0000-4000-8000-000000000001' AND id='39000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'user approved an approval they requested'; END IF;
END $$;
SELECT extensions.ok((SELECT status='pending' FROM public.approval WHERE tenant_id='20000000-0000-4000-8000-000000000001' AND id='39000000-0000-4000-8000-000000000001'),'A user cannot decide their own quote approval');

SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{}';
SELECT extensions.is((SELECT count(*)::int FROM public.product WHERE tenant_id='20000000-0000-4000-8000-000000000002'),0,'No authenticated user context returns zero tenant rows');

SELECT extensions.throws_ok('UPDATE public.audit_log SET action=''tampered'' WHERE tenant_id=''20000000-0000-4000-8000-000000000001''','42501',NULL,'App role cannot UPDATE audit_log');
SELECT extensions.throws_ok('DELETE FROM public.audit_log WHERE tenant_id=''20000000-0000-4000-8000-000000000001''','42501',NULL,'App role cannot DELETE audit_log');
RESET ROLE;
SELECT extensions.throws_ok('UPDATE public.audit_log SET action=''tampered'' WHERE id=''51000000-0000-4000-8000-000000000002''','55000',NULL,'Database immutability trigger rejects UPDATE even with elevated rights');
SELECT extensions.throws_ok('DELETE FROM public.audit_log WHERE id=''51000000-0000-4000-8000-000000000002''','55000',NULL,'Database immutability trigger rejects DELETE even with elevated rights');
SELECT * FROM extensions.finish();
ROLLBACK;
