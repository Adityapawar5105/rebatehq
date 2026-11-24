-- 7A: explicit rollback-only fixtures. No restored row is a fixture source.
RESET ROLE;
SELECT pg_temp.use_identity('');
CREATE TEMP TABLE relay_test_people(label text PRIMARY KEY,tenant_id uuid,user_id uuid,device_id uuid,member_role text);
INSERT INTO pg_temp.relay_test_people VALUES
 ('A','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__','owner'),
 ('B','__PHASE1_RELAY_TENANT_B_ID__','__PHASE1_RELAY_USER_B_ID__','__PHASE1_RELAY_DEVICE_B_ID__','owner'),
 ('R','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__','rep');
INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 SELECT user_id,'authenticated','authenticated',user_id::text||'@example.invalid','',now(),now(),now() FROM pg_temp.relay_test_people;
INSERT INTO public.tenant(tenant_id,name,created_by) SELECT tenant_id,'7A fixture '||label,user_id FROM pg_temp.relay_test_people WHERE label IN ('A','B');
INSERT INTO public.membership(tenant_id,user_id,email,role) SELECT tenant_id,user_id,user_id::text||'@example.invalid',member_role FROM pg_temp.relay_test_people;
INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) SELECT tenant_id,'professional',now()+interval '30 days' FROM pg_temp.relay_test_people WHERE label IN ('A','B');
INSERT INTO public.licence_seat(tenant_id,user_id) SELECT tenant_id,user_id FROM pg_temp.relay_test_people;
INSERT INTO public.licence_device(id,tenant_id,user_id) SELECT device_id,tenant_id,user_id FROM pg_temp.relay_test_people;
INSERT INTO public.licence_device(id,tenant_id,user_id) VALUES('__PHASE1_RELAY_DEVICE_A2_ID__','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__');
UPDATE public.licence_device SET status='active' WHERE tenant_id IN ('__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_TENANT_B_ID__');
-- SQL policy fixtures need structurally valid points; real curve/signature validity
-- is tested separately by the crypto/store/browser suites with generated keypairs.
INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at)
 SELECT device_id,tenant_id,user_id,decode('04'||repeat('11',64),'hex'),decode('04'||repeat('22',64),'hex'),decode(repeat('33',64),'hex'),now() FROM pg_temp.relay_test_people;
INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at)
 SELECT CASE label WHEN 'A' THEN '__PHASE1_RELAY_EPOCH_A_ID__'::uuid ELSE '__PHASE1_RELAY_EPOCH_B_ID__'::uuid END,
 p.tenant_id,1,decode(repeat('00',32),'hex'),0,decode(repeat('00',32),'hex'),p.user_id,p.device_id,
 ARRAY(SELECT q.device_id FROM pg_temp.relay_test_people q WHERE q.tenant_id=p.tenant_id ORDER BY q.device_id),
 ARRAY(SELECT q.member_role FROM pg_temp.relay_test_people q WHERE q.tenant_id=p.tenant_id ORDER BY q.device_id),
 decode(repeat('33',64),'hex'),decode(repeat('44',32),'hex'),now() FROM pg_temp.relay_test_people p WHERE label IN ('A','B');
INSERT INTO public.relay_key_wrap(id,tenant_id,epoch_id,recipient_device,ephemeral_public,iv,ciphertext)
 SELECT CASE label WHEN 'B' THEN '__PHASE1_RELAY_WRAP_B_ID__'::uuid ELSE gen_random_uuid() END,tenant_id,
 CASE label WHEN 'B' THEN '__PHASE1_RELAY_EPOCH_B_ID__'::uuid ELSE '__PHASE1_RELAY_EPOCH_A_ID__'::uuid END,
 device_id,decode('04'||repeat('55',64),'hex'),decode(repeat('66',12),'hex'),decode(repeat('77',48),'hex') FROM pg_temp.relay_test_people;
INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
 SELECT CASE label WHEN 'A' THEN '__PHASE1_RELAY_EVENT_A_ID__'::uuid ELSE '__PHASE1_RELAY_EVENT_B_ID__'::uuid END,tenant_id,
 CASE label WHEN 'A' THEN '__PHASE1_RELAY_EPOCH_A_ID__'::uuid ELSE '__PHASE1_RELAY_EPOCH_B_ID__'::uuid END,
 1,decode(repeat('00',32),'hex'),user_id,device_id,gen_random_uuid(),'quote',ARRAY[]::uuid[],ARRAY[]::uuid[],
 decode(repeat('66',12),'hex'),decode(repeat('88',32),'hex'),32,decode(repeat('33',64),'hex'),decode(repeat('99',32),'hex'),now()
 FROM pg_temp.relay_test_people WHERE label IN ('A','B');
CREATE TEMP TABLE relay_test_negative(table_name text PRIMARY KEY,row_data jsonb);
INSERT INTO pg_temp.relay_test_negative SELECT 'relay_device_key',to_jsonb(x) FROM public.relay_device_key x WHERE id='__PHASE1_RELAY_DEVICE_B_ID__';
INSERT INTO pg_temp.relay_test_negative SELECT 'relay_epoch',to_jsonb(x) FROM public.relay_epoch x WHERE id='__PHASE1_RELAY_EPOCH_B_ID__';
INSERT INTO pg_temp.relay_test_negative SELECT 'relay_key_wrap',to_jsonb(x) FROM public.relay_key_wrap x WHERE id='__PHASE1_RELAY_WRAP_B_ID__';
INSERT INTO pg_temp.relay_test_negative SELECT 'relay_event',to_jsonb(x) FROM public.relay_event x WHERE id='__PHASE1_RELAY_EVENT_B_ID__';
DO $$ BEGIN IF (SELECT count(*) FROM pg_temp.relay_test_people)<>3 OR (SELECT count(*) FROM pg_temp.relay_test_negative)<>4 THEN RAISE EXCEPTION '7A fixture graph incomplete'; END IF; END $$;
SELECT set_config('app.relay_negative',(SELECT jsonb_object_agg(table_name,row_data)::text FROM pg_temp.relay_test_negative),true);
-- Real positive INSERT controls in dependency order, using the restricted role.
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe positive role'; END IF;
 INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at)
 VALUES('__PHASE1_RELAY_DEVICE_A2_ID__','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__',decode('04'||repeat('aa',64),'hex'),decode('04'||repeat('bb',64),'hex'),decode(repeat('cc',64),'hex'),now());
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_device_key: positive own INSERT under non-bypass role');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe epoch role'; END IF;
 INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at)
 SELECT '__PHASE1_RELAY_EPOCH_A2_ID__','__PHASE1_RELAY_TENANT_A_ID__',2,decode(repeat('44',32),'hex'),1,decode(repeat('99',32),'hex'),
 '__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',array_agg(k.id ORDER BY k.id),array_agg(m.role::text ORDER BY k.id),decode(repeat('dd',64),'hex'),decode(repeat('ee',32),'hex'),now()
 FROM public.relay_device_key k JOIN public.membership m ON m.tenant_id=k.tenant_id AND m.user_id=k.user_id WHERE k.tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_epoch: positive own INSERT, complete current roster and exact head');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe wrap role'; END IF;
 INSERT INTO public.relay_key_wrap(id,tenant_id,epoch_id,recipient_device,ephemeral_public,iv,ciphertext)
 SELECT gen_random_uuid(),tenant_id,'__PHASE1_RELAY_EPOCH_A2_ID__',id,decode('04'||repeat('ab',64),'hex'),decode(repeat('cd',12),'hex'),decode(repeat('ef',48),'hex') FROM public.relay_device_key WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_key_wrap: positive own INSERT for every epoch recipient');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe event role'; END IF;
 INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
 VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_EPOCH_A2_ID__',2,decode(repeat('99',32),'hex'),'__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',gen_random_uuid(),'price_change',ARRAY[]::uuid[],ARRAY[]::uuid[],decode(repeat('01',12),'hex'),decode(repeat('02',32),'hex'),32,decode(repeat('03',64),'hex'),decode(repeat('04',32),'hex'),now());
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_event: positive own INSERT with current key and chained sequence');

SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=c.oid AND g.tgname='relay_device_key_audit_row') FROM pg_class c WHERE c.oid='public.relay_device_key'::regclass),'7A relay_device_key: forced RLS, tenant index, audit');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['INSERT','SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_device_key'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_device_key'::regclass AND (a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole) OR (a.grantee='rebatehq_app'::regrole AND a.is_grantable))),'7A relay_device_key: exact owner/app INSERT SELECT ACL, no platform/PUBLIC/TRUNCATE/grant option');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
DO $$ DECLARE n integer; BEGIN
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_device_key WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<1 THEN RAISE EXCEPTION '7A restored sentinel missing from relay_device_key'; END IF;
 END IF;
END $$;
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_device_key WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION '7A relay_device_key positive SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.relay_device_key WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION '7A relay_device_key cross SELECT leaked'; END IF;
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_device_key WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<>0 THEN RAISE EXCEPTION '7A relay_device_key restored tenant leaked'; END IF;
 END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_device_key: positive own SELECT and invisible other tenant (including restored sentinel in restore mode)');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 r:=current_setting('app.relay_negative')::jsonb->'relay_device_key';r:=r||jsonb_build_object('id',gen_random_uuid());
 BEGIN INSERT INTO public.relay_device_key SELECT (jsonb_populate_record(NULL::public.relay_device_key,r)).*;
 RAISE EXCEPTION '7A relay_device_key cross INSERT allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
 IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A relay_device_key denial was not RLS: %',msg; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_device_key: cross INSERT rejected by RLS 42501, not missing table privilege');
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_device_key;IF n<>0 THEN RAISE EXCEPTION '7A relay_device_key no-context SELECT leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_device_key: missing authenticated context returns zero rows');
DO $$ DECLARE role_name text; statement text; msg text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.relay_device_key','INSERT INTO public.relay_device_key DEFAULT VALUES','UPDATE public.relay_device_key SET id=id WHERE false','DELETE FROM public.relay_device_key WHERE false','TRUNCATE public.relay_device_key'] LOOP
   BEGIN EXECUTE statement;RAISE EXCEPTION '7A relay_device_key browser role gained %',statement;
   EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL failure %',msg; END IF;END;
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT extensions.ok(true,'7A relay_device_key: anon/authenticated lack CRUD/TRUNCATE at ACL level');

SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=c.oid AND g.tgname='relay_epoch_audit_row') FROM pg_class c WHERE c.oid='public.relay_epoch'::regclass),'7A relay_epoch: forced RLS, tenant index, audit');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['INSERT','SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_epoch'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_epoch'::regclass AND (a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole) OR (a.grantee='rebatehq_app'::regrole AND a.is_grantable))),'7A relay_epoch: exact owner/app INSERT SELECT ACL, no platform/PUBLIC/TRUNCATE/grant option');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
DO $$ DECLARE n integer; BEGIN
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_epoch WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<1 THEN RAISE EXCEPTION '7A restored sentinel missing from relay_epoch'; END IF;
 END IF;
END $$;
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_epoch WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION '7A relay_epoch positive SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.relay_epoch WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION '7A relay_epoch cross SELECT leaked'; END IF;
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_epoch WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<>0 THEN RAISE EXCEPTION '7A relay_epoch restored tenant leaked'; END IF;
 END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_epoch: positive own SELECT and invisible other tenant (including restored sentinel in restore mode)');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 r:=current_setting('app.relay_negative')::jsonb->'relay_epoch';r:=r||jsonb_build_object('id',gen_random_uuid());
 BEGIN INSERT INTO public.relay_epoch SELECT (jsonb_populate_record(NULL::public.relay_epoch,r)).*;
 RAISE EXCEPTION '7A relay_epoch cross INSERT allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
 IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A relay_epoch denial was not RLS: %',msg; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_epoch: cross INSERT rejected by RLS 42501, not missing table privilege');
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_epoch;IF n<>0 THEN RAISE EXCEPTION '7A relay_epoch no-context SELECT leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_epoch: missing authenticated context returns zero rows');
DO $$ DECLARE role_name text; statement text; msg text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.relay_epoch','INSERT INTO public.relay_epoch DEFAULT VALUES','UPDATE public.relay_epoch SET id=id WHERE false','DELETE FROM public.relay_epoch WHERE false','TRUNCATE public.relay_epoch'] LOOP
   BEGIN EXECUTE statement;RAISE EXCEPTION '7A relay_epoch browser role gained %',statement;
   EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL failure %',msg; END IF;END;
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT extensions.ok(true,'7A relay_epoch: anon/authenticated lack CRUD/TRUNCATE at ACL level');

SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=c.oid AND g.tgname='relay_key_wrap_audit_row') FROM pg_class c WHERE c.oid='public.relay_key_wrap'::regclass),'7A relay_key_wrap: forced RLS, tenant index, audit');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['INSERT','SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_key_wrap'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_key_wrap'::regclass AND (a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole) OR (a.grantee='rebatehq_app'::regrole AND a.is_grantable))),'7A relay_key_wrap: exact owner/app INSERT SELECT ACL, no platform/PUBLIC/TRUNCATE/grant option');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
DO $$ DECLARE n integer; BEGIN
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_key_wrap WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<1 THEN RAISE EXCEPTION '7A restored sentinel missing from relay_key_wrap'; END IF;
 END IF;
END $$;
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_key_wrap WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION '7A relay_key_wrap positive SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.relay_key_wrap WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION '7A relay_key_wrap cross SELECT leaked'; END IF;
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_key_wrap WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<>0 THEN RAISE EXCEPTION '7A relay_key_wrap restored tenant leaked'; END IF;
 END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_key_wrap: positive own SELECT and invisible other tenant (including restored sentinel in restore mode)');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 r:=current_setting('app.relay_negative')::jsonb->'relay_key_wrap';r:=r||jsonb_build_object('id',gen_random_uuid());
 BEGIN INSERT INTO public.relay_key_wrap SELECT (jsonb_populate_record(NULL::public.relay_key_wrap,r)).*;
 RAISE EXCEPTION '7A relay_key_wrap cross INSERT allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
 IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A relay_key_wrap denial was not RLS: %',msg; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_key_wrap: cross INSERT rejected by RLS 42501, not missing table privilege');
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_key_wrap;IF n<>0 THEN RAISE EXCEPTION '7A relay_key_wrap no-context SELECT leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_key_wrap: missing authenticated context returns zero rows');
DO $$ DECLARE role_name text; statement text; msg text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.relay_key_wrap','INSERT INTO public.relay_key_wrap DEFAULT VALUES','UPDATE public.relay_key_wrap SET id=id WHERE false','DELETE FROM public.relay_key_wrap WHERE false','TRUNCATE public.relay_key_wrap'] LOOP
   BEGIN EXECUTE statement;RAISE EXCEPTION '7A relay_key_wrap browser role gained %',statement;
   EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL failure %',msg; END IF;END;
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT extensions.ok(true,'7A relay_key_wrap: anon/authenticated lack CRUD/TRUNCATE at ACL level');

SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=c.oid AND g.tgname='relay_event_audit_row') FROM pg_class c WHERE c.oid='public.relay_event'::regclass),'7A relay_event: forced RLS, tenant index, audit');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['INSERT','SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_event'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.relay_event'::regclass AND (a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole) OR (a.grantee='rebatehq_app'::regrole AND a.is_grantable))),'7A relay_event: exact owner/app INSERT SELECT ACL, no platform/PUBLIC/TRUNCATE/grant option');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
DO $$ DECLARE n integer; BEGIN
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_event WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<1 THEN RAISE EXCEPTION '7A restored sentinel missing from relay_event'; END IF;
 END IF;
END $$;
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION '7A relay_event positive SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION '7A relay_event cross SELECT leaked'; END IF;
 IF current_setting('app.restore_test_mode',true)='true' THEN
  SELECT count(*) INTO n FROM public.relay_event WHERE tenant_id=current_setting('app.restore_sentinel_tenant_id')::uuid;
  IF n<>0 THEN RAISE EXCEPTION '7A relay_event restored tenant leaked'; END IF;
 END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_event: positive own SELECT and invisible other tenant (including restored sentinel in restore mode)');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 r:=current_setting('app.relay_negative')::jsonb->'relay_event';r:=r||jsonb_build_object('id',gen_random_uuid());
 BEGIN INSERT INTO public.relay_event SELECT (jsonb_populate_record(NULL::public.relay_event,r)).*;
 RAISE EXCEPTION '7A relay_event cross INSERT allowed';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
 IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A relay_event denial was not RLS: %',msg; END IF; END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_event: cross INSERT rejected by RLS 42501, not missing table privilege');
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe app role'; END IF;
 SELECT count(*) INTO n FROM public.relay_event;IF n<>0 THEN RAISE EXCEPTION '7A relay_event no-context SELECT leaked'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_event: missing authenticated context returns zero rows');
DO $$ DECLARE role_name text; statement text; msg text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.relay_event','INSERT INTO public.relay_event DEFAULT VALUES','UPDATE public.relay_event SET id=id WHERE false','DELETE FROM public.relay_event WHERE false','TRUNCATE public.relay_event'] LOOP
   BEGIN EXECUTE statement;RAISE EXCEPTION '7A relay_event browser role gained %',statement;
   EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL failure %',msg; END IF;END;
  END LOOP;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SELECT extensions.ok(true,'7A relay_event: anon/authenticated lack CRUD/TRUNCATE at ACL level');

-- A real rep may append their own encrypted event, but never publish an epoch.
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe rep role'; END IF;
 INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
 VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_EPOCH_A2_ID__',3,decode(repeat('04',32),'hex'),'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',gen_random_uuid(),'rebate',ARRAY[]::uuid[],ARRAY[]::uuid[],decode(repeat('05',12),'hex'),decode(repeat('06',32),'hex'),32,decode(repeat('07',64),'hex'),decode(repeat('08',32),'hex'),now());
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_event: rep positive own INSERT');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe rep epoch role'; END IF;
 SELECT to_jsonb(e) INTO r FROM public.relay_epoch e WHERE id='__PHASE1_RELAY_EPOCH_A2_ID__';
 IF r IS NULL THEN RAISE EXCEPTION '7A rep read positive missing'; END IF;
 r:=r||jsonb_build_object('id',gen_random_uuid(),'epoch_number',3,'signer_user','__PHASE1_RELAY_USER_R_ID__','signer_device','__PHASE1_RELAY_DEVICE_R_ID__');
 BEGIN INSERT INTO public.relay_epoch SELECT (jsonb_populate_record(NULL::public.relay_epoch,r)).*;RAISE EXCEPTION '7A rep published an epoch';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A wrong rep denial %',msg; END IF;END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A relay_epoch: rep INSERT fails with genuine RLS 42501');
SELECT extensions.ok((SELECT count(*) FROM pg_temp.phase1_function_allowlist WHERE signature IN ('public.relay_allowed(uuid,boolean)','public.relay_directory(uuid)','public.relay_check_insert()'))=3 AND NOT EXISTS(SELECT 1 FROM pg_temp.phase1_function_acl_errors WHERE signature IN ('public.relay_allowed(uuid,boolean)','public.relay_directory(uuid)','public.relay_check_insert()')),'7A: every new helper/trigger has its exact EXECUTE allowlist');
SELECT extensions.ok((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('relay_device_key','relay_epoch','relay_key_wrap','relay_event'))=4,'7A: all four relay tables exist (non-vacuous inventory)');
DO $$ DECLARE t text; actual text[]; expected text[]; checked integer:=0; BEGIN
 -- Team sharing S2: the epoch's grid (roles and pack names only) and the two pack tables are reviewed here too.
 FOREACH t IN ARRAY ARRAY['relay_device_key','relay_epoch','relay_key_wrap','relay_event','relay_pack_wrap','relay_pack_version'] LOOP
  checked:=checked+1;
  expected:=CASE t
   WHEN 'relay_device_key' THEN ARRAY['id','tenant_id','user_id','agreement_public','signing_public','possession_proof','signed_at','received_at']
   WHEN 'relay_epoch' THEN ARRAY['id','tenant_id','epoch_number','previous_hash','base_sequence','base_hash','signer_user','signer_device','device_ids','member_roles','signature','content_hash','signed_at','received_at','format','grid']
   WHEN 'relay_pack_wrap' THEN ARRAY['id','tenant_id','epoch_id','pack','recipient_device','ephemeral_public','iv','ciphertext','received_at']
   WHEN 'relay_pack_version' THEN ARRAY['id','tenant_id','epoch_id','pack','version','previous_hash','kind','base_version','sender_user','sender_device','iv','ciphertext','ciphertext_bytes','signature','content_hash','signed_at','received_at']
   WHEN 'relay_key_wrap' THEN ARRAY['id','tenant_id','epoch_id','recipient_device','ephemeral_public','iv','ciphertext','received_at']
   ELSE ARRAY['id','tenant_id','epoch_id','sequence','previous_hash','sender_user','sender_device','object_id','object_kind','recipient_ids','mention_ids','iv','ciphertext','ciphertext_bytes','signature','content_hash','signed_at','received_at'] END;
  SELECT array_agg(x ORDER BY x) INTO expected FROM unnest(expected)x;
  SELECT array_agg(column_name::text ORDER BY column_name) INTO actual FROM information_schema.columns WHERE table_schema='public' AND table_name=t;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION '7A unreviewed/plaintext column in %: %',t,actual; END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE a.attrelid=('public.'||t)::regclass AND acl.grantee<>(SELECT relowner FROM pg_class WHERE oid=a.attrelid)) THEN RAISE EXCEPTION '7A unexpected column grant on %',t; END IF;
 END LOOP;
 IF checked<>6 THEN RAISE EXCEPTION '7A column loop did not cover six tables'; END IF;
END $$;
SELECT extensions.ok(true,'7A: exact metadata/ciphertext column inventory, no plaintext business columns or hidden column grants');
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.audit_log WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND entity_type IN ('relay_device_key','relay_epoch','relay_key_wrap','relay_event');
 IF n<12 THEN RAISE EXCEPTION '7A relay audit coverage missing; found %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_log WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND entity_type IN ('relay_device_key','relay_epoch','relay_key_wrap','relay_event') AND (before IS NOT NULL OR NOT (after ?& ARRAY['id','tenant_id']) OR after-ARRAY['id','tenant_id']<>'{}'::jsonb)) THEN RAISE EXCEPTION '7A relay audit duplicated content'; END IF;
END $$;
SELECT extensions.ok(true,'7A: each insert audited with IDs only, without key/ciphertext/business content');
-- Revocation is final. These fixture-only changes are rolled back with the suite.
UPDATE public.licence_device SET status='revoked' WHERE id='__PHASE1_RELAY_DEVICE_A2_ID__';
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe revoked-device role'; END IF;
 SELECT to_jsonb(e) INTO r FROM public.relay_event e WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND sequence=3;
 IF r IS NULL THEN RAISE EXCEPTION '7A event positive source absent'; END IF;
 r:=r||jsonb_build_object('id',gen_random_uuid(),'sequence',4,'sender_user','__PHASE1_RELAY_USER_A_ID__','sender_device','__PHASE1_RELAY_DEVICE_A2_ID__','previous_hash',decode(repeat('08',32),'hex'));
 BEGIN INSERT INTO public.relay_event SELECT (jsonb_populate_record(NULL::public.relay_event,r)).*;RAISE EXCEPTION '7A revoked device wrote';
 EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A wrong revoked denial %',msg; END IF;END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A: revoked device INSERT rejected by RLS despite an active user seat');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE r jsonb; msg text; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe rotation-required role'; END IF;
 SELECT to_jsonb(e) INTO r FROM public.relay_event e WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND sequence=3;
 r:=r||jsonb_build_object('id',gen_random_uuid(),'sequence',4,'sender_user','__PHASE1_RELAY_USER_A_ID__','sender_device','__PHASE1_RELAY_DEVICE_A_ID__','previous_hash',decode(repeat('08',32),'hex'));
 BEGIN INSERT INTO public.relay_event SELECT (jsonb_populate_record(NULL::public.relay_event,r)).*;RAISE EXCEPTION '7A stale epoch accepted';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF msg<>'relay key rotation required' THEN RAISE EXCEPTION '7A wrong rotation error %',msg; END IF;END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A: active senders must rotate after another device is revoked');
UPDATE public.membership SET status='suspended' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND user_id='__PHASE1_RELAY_USER_R_ID__';
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE t text; n integer; checked integer:=0; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe removed-member role'; END IF;
 FOREACH t IN ARRAY ARRAY['relay_device_key','relay_epoch','relay_key_wrap','relay_event'] LOOP
  checked:=checked+1;EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;IF n<>0 THEN RAISE EXCEPTION '7A suspended member read %',t; END IF;
 END LOOP;
 IF checked<>4 THEN RAISE EXCEPTION '7A removal loop vacuous'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A: suspended member sees zero relay rows across every table');
UPDATE public.workspace_licence SET tier='starter' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE t text; n integer; checked integer:=0; r jsonb; msg text; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION '7A unsafe Starter role'; END IF;
 FOREACH t IN ARRAY ARRAY['relay_device_key','relay_epoch','relay_key_wrap','relay_event'] LOOP
  checked:=checked+1;EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;IF n<>0 THEN RAISE EXCEPTION '7A Starter read %',t; END IF;
  r:=current_setting('app.relay_negative')::jsonb->t;r:=r||jsonb_build_object('id',gen_random_uuid(),'tenant_id','__PHASE1_RELAY_TENANT_A_ID__');
  BEGIN EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',t,t) USING r;RAISE EXCEPTION '7A Starter wrote %',t;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in lower(msg))=0 THEN RAISE EXCEPTION '7A wrong Starter denial %',msg; END IF;END;
 END LOOP;
 IF checked<>4 THEN RAISE EXCEPTION '7A Starter loop vacuous'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'7A: Starter cannot SELECT or INSERT any relay table, even with existing keys/seat');
-- Constraint probes run as the operator, so RLS/quotas cannot cause false passes.
DO $$ DECLARE r jsonb; BEGIN
 SELECT to_jsonb(e) INTO r FROM public.relay_event e WHERE id='__PHASE1_RELAY_EVENT_A_ID__';
 BEGIN INSERT INTO public.relay_event SELECT (jsonb_populate_record(NULL::public.relay_event,r||jsonb_build_object('id',gen_random_uuid(),'sequence',0))).*;RAISE EXCEPTION '7A zero sequence accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN INSERT INTO public.relay_event SELECT (jsonb_populate_record(NULL::public.relay_event,r||jsonb_build_object('id',gen_random_uuid(),'ciphertext',decode(repeat('aa',16),'hex'),'ciphertext_bytes',16))).*;RAISE EXCEPTION '7A short ciphertext accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT to_jsonb(e) INTO r FROM public.relay_key_wrap e WHERE id='__PHASE1_RELAY_WRAP_B_ID__';
 BEGIN INSERT INTO public.relay_key_wrap SELECT (jsonb_populate_record(NULL::public.relay_key_wrap,r||jsonb_build_object('id',gen_random_uuid(),'ciphertext',decode(repeat('aa',47),'hex')))).*;RAISE EXCEPTION '7A short wrapped key accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
SELECT extensions.ok(true,'7A: positive counters, AEAD payload/tag lengths and wrapped-key size enforced by constraints');
