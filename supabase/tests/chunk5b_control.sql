-- 5B operation-specific controls; all fixtures belong to this rollback transaction.
RESET ROLE;
INSERT INTO public.licence_location(tenant_id,name,erp_profile) VALUES('__PHASE1_TENANT_A_ID__','A','generic'),('__PHASE1_TENANT_B_ID__','B','generic');
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
INSERT INTO public.licence_device(id,tenant_id,user_id) VALUES(gen_random_uuid(),'__PHASE1_TENANT_A_ID__','__PHASE1_USER_A_ID__');
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_USER_B_ID__');
SET LOCAL ROLE rebatehq_app;
INSERT INTO public.licence_device(id,tenant_id,user_id) VALUES(gen_random_uuid(),'__PHASE1_TENANT_B_ID__','__PHASE1_USER_B_ID__');
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
SELECT extensions.ok((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped))>=42,'5B: at least 42 public tenant tables, including all four licence tables');
SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND tg.tgname='workspace_licence_audit_row') FROM pg_class c WHERE c.oid='public.workspace_licence'::regclass),'5B workspace_licence: forced RLS, tenant index and audit trigger');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.workspace_licence'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.workspace_licence'::regclass AND a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole)),'5B workspace_licence: exact privilege allowlist, no platform grants or TRUNCATE');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe role'; END IF;
 SELECT count(*) INTO n FROM public.workspace_licence WHERE tenant_id='__PHASE1_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION 'workspace_licence positive own SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.workspace_licence WHERE tenant_id='__PHASE1_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION 'workspace_licence cross SELECT visible'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B workspace_licence: positive own SELECT and zero cross-tenant SELECT under non-bypass app role');
SET LOCAL ROLE anon;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.workspace_licence','INSERT INTO public.workspace_licence DEFAULT VALUES','UPDATE public.workspace_licence SET id=id WHERE false','DELETE FROM public.workspace_licence WHERE false','TRUNCATE public.workspace_licence'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'workspace_licence anon unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.workspace_licence','INSERT INTO public.workspace_licence DEFAULT VALUES','UPDATE public.workspace_licence SET id=id WHERE false','DELETE FROM public.workspace_licence WHERE false','TRUNCATE public.workspace_licence'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'workspace_licence authenticated unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SELECT extensions.ok(true,'5B workspace_licence: anon and authenticated denied at privilege level');
SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND tg.tgname='licence_seat_audit_row') FROM pg_class c WHERE c.oid='public.licence_seat'::regclass),'5B licence_seat: forced RLS, tenant index and audit trigger');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['DELETE','INSERT','SELECT']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_seat'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_seat'::regclass AND a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole)),'5B licence_seat: exact privilege allowlist, no platform grants or TRUNCATE');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe role'; END IF;
 SELECT count(*) INTO n FROM public.licence_seat WHERE tenant_id='__PHASE1_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION 'licence_seat positive own SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.licence_seat WHERE tenant_id='__PHASE1_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION 'licence_seat cross SELECT visible'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_seat: positive own SELECT and zero cross-tenant SELECT under non-bypass app role');
SET LOCAL ROLE anon;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_seat','INSERT INTO public.licence_seat DEFAULT VALUES','UPDATE public.licence_seat SET id=id WHERE false','DELETE FROM public.licence_seat WHERE false','TRUNCATE public.licence_seat'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_seat anon unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_seat','INSERT INTO public.licence_seat DEFAULT VALUES','UPDATE public.licence_seat SET id=id WHERE false','DELETE FROM public.licence_seat WHERE false','TRUNCATE public.licence_seat'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_seat authenticated unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_seat: anon and authenticated denied at privilege level');
SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND tg.tgname='licence_location_audit_row') FROM pg_class c WHERE c.oid='public.licence_location'::regclass),'5B licence_location: forced RLS, tenant index and audit trigger');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_location'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_location'::regclass AND a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole)),'5B licence_location: exact privilege allowlist, no platform grants or TRUNCATE');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe role'; END IF;
 SELECT count(*) INTO n FROM public.licence_location WHERE tenant_id='__PHASE1_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION 'licence_location positive own SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.licence_location WHERE tenant_id='__PHASE1_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION 'licence_location cross SELECT visible'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_location: positive own SELECT and zero cross-tenant SELECT under non-bypass app role');
SET LOCAL ROLE anon;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_location','INSERT INTO public.licence_location DEFAULT VALUES','UPDATE public.licence_location SET id=id WHERE false','DELETE FROM public.licence_location WHERE false','TRUNCATE public.licence_location'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_location anon unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_location','INSERT INTO public.licence_location DEFAULT VALUES','UPDATE public.licence_location SET id=id WHERE false','DELETE FROM public.licence_location WHERE false','TRUNCATE public.licence_location'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_location authenticated unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_location: anon and authenticated denied at privilege level');
SELECT extensions.ok((SELECT c.relrowsecurity AND c.relforcerowsecurity AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=c.oid AND a.attname='tenant_id') AND EXISTS(SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid=c.oid AND tg.tgname='licence_device_audit_row') FROM pg_class c WHERE c.oid='public.licence_device'::regclass),'5B licence_device: forced RLS, tenant index and audit trigger');
SELECT extensions.ok((SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)=ARRAY['INSERT','SELECT','UPDATE']::text[] FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_device'::regclass AND a.grantee='rebatehq_app'::regrole) AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.licence_device'::regclass AND a.grantee NOT IN(c.relowner,'rebatehq_app'::regrole)),'5B licence_device: exact privilege allowlist, no platform grants or TRUNCATE');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; BEGIN
 IF current_user<>'rebatehq_app' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe role'; END IF;
 SELECT count(*) INTO n FROM public.licence_device WHERE tenant_id='__PHASE1_TENANT_A_ID__';IF n<1 THEN RAISE EXCEPTION 'licence_device positive own SELECT failed'; END IF;
 SELECT count(*) INTO n FROM public.licence_device WHERE tenant_id='__PHASE1_TENANT_B_ID__';IF n<>0 THEN RAISE EXCEPTION 'licence_device cross SELECT visible'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_device: positive own SELECT and zero cross-tenant SELECT under non-bypass app role');
SET LOCAL ROLE anon;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_device','INSERT INTO public.licence_device DEFAULT VALUES','UPDATE public.licence_device SET id=id WHERE false','DELETE FROM public.licence_device WHERE false','TRUNCATE public.licence_device'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_device anon unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $denied$ DECLARE statement text; msg text; BEGIN
 FOREACH statement IN ARRAY ARRAY['SELECT 1 FROM public.licence_device','INSERT INTO public.licence_device DEFAULT VALUES','UPDATE public.licence_device SET id=id WHERE false','DELETE FROM public.licence_device WHERE false','TRUNCATE public.licence_device'] LOOP
  BEGIN EXECUTE statement;RAISE EXCEPTION 'licence_device authenticated unexpectedly allowed %',statement;
  EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('permission denied for table' in msg)=0 THEN RAISE EXCEPTION 'Wrong ACL denial: %',msg;END IF;END;
 END LOOP;
END $denied$;
RESET ROLE;
SELECT extensions.ok(true,'5B licence_device: anon and authenticated denied at privilege level');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE n integer; msg text; BEGIN
 INSERT INTO public.licence_location(tenant_id,name,erp_profile) VALUES('__PHASE1_TENANT_A_ID__','positive','netsuite');
 UPDATE public.licence_location SET name='positive-updated' WHERE tenant_id='__PHASE1_TENANT_A_ID__' AND name='positive';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'own UPDATE failed'; END IF;
 DELETE FROM public.licence_location WHERE tenant_id='__PHASE1_TENANT_A_ID__' AND name='positive-updated';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'own DELETE failed'; END IF;
 BEGIN INSERT INTO public.licence_location(tenant_id,name,erp_profile) VALUES('__PHASE1_TENANT_B_ID__','forbidden','generic');RAISE EXCEPTION 'cross INSERT allowed';EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in msg)=0 THEN RAISE EXCEPTION 'wrong denial: %',msg; END IF;END;
 BEGIN UPDATE public.licence_location SET tenant_id='__PHASE1_TENANT_B_ID__' WHERE tenant_id='__PHASE1_TENANT_A_ID__';RAISE EXCEPTION 'tenant reassignment allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.licence_location SET name='forbidden' WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'foreign UPDATE allowed'; END IF;
 DELETE FROM public.licence_location WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'foreign DELETE allowed'; END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B: own location INSERT/UPDATE/DELETE succeed, cross writes blocked');
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE a uuid; n integer; BEGIN
 PERFORM set_config('app.real_actor_id','__PHASE1_USER_B_ID__',true);
 PERFORM public.append_control_audit('__PHASE1_TENANT_A_ID__','test.actor_signed','licence','probe',NULL,NULL);
 SELECT actor_id INTO a FROM audit_log WHERE tenant_id='__PHASE1_TENANT_A_ID__' AND action='test.actor_signed';
 IF a IS DISTINCT FROM '__PHASE1_USER_A_ID__'::uuid THEN RAISE EXCEPTION 'actor GUC spoof worked'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub','__PHASE1_USER_B_ID__',true);
  PERFORM public.append_control_audit('__PHASE1_TENANT_A_ID__','test.actor_forged','licence','probe',NULL,NULL);
  RAISE EXCEPTION 'forged JWT accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM rebatehq_private.actor_key;RAISE EXCEPTION 'app read signing key';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B: signed actor ignores spoofable GUC, raw JWT forgery fails 42501, signing key inaccessible');
DO $$ BEGIN
 IF has_schema_privilege('rebatehq_app','rebatehq_private','USAGE') OR has_table_privilege('rebatehq_app','rebatehq_private.actor_key','SELECT') THEN RAISE EXCEPTION 'key exposed';END IF;
END $$;
SELECT extensions.ok(true,'5B: private issuer key and rate-limit sequence are not exposed to the app role');
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE i integer; blocked boolean:=false; BEGIN
 BEGIN PERFORM record_failed_login(repeat('x',321),'','');RAISE EXCEPTION 'unbounded email';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM record_failed_login('x',repeat('x',46),'');RAISE EXCEPTION 'unbounded IP';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM record_failed_login('x','',repeat('x',1001));RAISE EXCEPTION 'unbounded agent';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 FOR i IN 1..8 LOOP PERFORM record_failed_login('bounded-__PHASE1_USER_A_ID__@example.test','192.0.2.240','test');END LOOP;
 BEGIN PERFORM record_failed_login('bounded-__PHASE1_USER_A_ID__@example.test','192.0.2.240','test');EXCEPTION WHEN program_limit_exceeded THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'direct app login calls bypassed rate limit';END IF;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B: failed-login byte limits and direct-call DB rate limit enforced');
SELECT pg_temp.use_identity('');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE t text; n integer; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_licence','licence_seat','licence_location','licence_device'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;IF n<>0 THEN RAISE EXCEPTION '% leaked without context',t;END IF;
 END LOOP;
END $$;
RESET ROLE;
SELECT extensions.ok(true,'5B: all licence tables return zero rows without authenticated context');

-- Positive write controls per remaining table; foreign writes must be genuine RLS denials.
SELECT pg_temp.use_identity('__PHASE1_USER_A_ID__');
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('__PHASE1_5B_SEAT_USER_ID__','seat-__PHASE1_5B_SEAT_USER_ID__@example.test',now());
INSERT INTO membership(tenant_id,user_id,email,role) VALUES('__PHASE1_TENANT_A_ID__','__PHASE1_5B_SEAT_USER_ID__','seat-__PHASE1_5B_SEAT_USER_ID__@example.test','rep');
SET LOCAL ROLE rebatehq_app;
DO $writes$ DECLARE n integer; msg text; did uuid; BEGIN
 INSERT INTO licence_seat(tenant_id,user_id) VALUES('__PHASE1_TENANT_A_ID__','__PHASE1_5B_SEAT_USER_ID__');
 DELETE FROM licence_seat WHERE tenant_id='__PHASE1_TENANT_A_ID__' AND user_id='__PHASE1_5B_SEAT_USER_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'licence_seat positive DELETE';END IF;
 INSERT INTO licence_device(id,tenant_id,user_id,status) VALUES(gen_random_uuid(),'__PHASE1_TENANT_A_ID__','__PHASE1_USER_A_ID__','active') RETURNING id INTO did;
 IF (SELECT status FROM licence_device WHERE id=did)<>'pending' THEN RAISE EXCEPTION 'Additional device self-approved';END IF;
 UPDATE licence_device SET status='active' WHERE id=did;GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Device positive UPDATE';END IF;
 UPDATE licence_device SET status='revoked' WHERE id=did;
 BEGIN UPDATE licence_device SET status='active' WHERE id=did;RAISE EXCEPTION 'Revoked device reactivated';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO licence_seat(tenant_id,user_id) VALUES('__PHASE1_TENANT_B_ID__','__PHASE1_USER_A_ID__');RAISE EXCEPTION 'Seat foreign INSERT';EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in msg)=0 THEN RAISE EXCEPTION 'Seat wrong denial %',msg;END IF;END;
 BEGIN INSERT INTO licence_device(id,tenant_id,user_id) VALUES(gen_random_uuid(),'__PHASE1_TENANT_B_ID__','__PHASE1_USER_A_ID__');RAISE EXCEPTION 'Device foreign INSERT';EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in msg)=0 THEN RAISE EXCEPTION 'Device wrong denial %',msg;END IF;END;
 BEGIN UPDATE licence_device SET tenant_id='__PHASE1_TENANT_B_ID__' WHERE id=did;RAISE EXCEPTION 'Device tenant reassignment';EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in msg)=0 THEN RAISE EXCEPTION 'Device wrong UPDATE denial %',msg;END IF;END;
 UPDATE licence_device SET status='revoked' WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Foreign device UPDATE';END IF;
 DELETE FROM licence_seat WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Foreign seat DELETE';END IF;
 BEGIN UPDATE workspace_licence SET tier='scale';RAISE EXCEPTION 'App issued licence';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES('__PHASE1_TENANT_A_ID__','scale',now());RAISE EXCEPTION 'App inserted licence';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $writes$;
RESET ROLE;
SELECT extensions.ok(true,'5B: seat INSERT/DELETE, device INSERT/UPDATE/revoke work; foreign writes fail RLS, app cannot issue licences');
SELECT pg_temp.use_identity('__PHASE1_USER_REP_ID__');
SET LOCAL ROLE rebatehq_app;
DO $rep$ DECLARE n integer; msg text; BEGIN
 BEGIN INSERT INTO licence_location(tenant_id,name,erp_profile) VALUES('__PHASE1_TENANT_B_ID__','rep denied','generic');RAISE EXCEPTION 'Rep managed locations';EXCEPTION WHEN insufficient_privilege THEN GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;IF position('row-level security' in msg)=0 THEN RAISE EXCEPTION 'Rep wrong denial %',msg;END IF;END;
 UPDATE licence_location SET name='rep denied' WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Rep updated location';END IF;
 DELETE FROM licence_seat WHERE tenant_id='__PHASE1_TENANT_B_ID__';GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Rep removed seat';END IF;
END $rep$;
RESET ROLE;
SELECT extensions.ok(true,'5B: a rep cannot manage licence seats or locations');
DO $caps$ DECLARE tier_name text; cap integer; tid uuid; uid uuid; member_id uuid; i integer; n integer; BEGIN
 FOREACH tier_name IN ARRAY ARRAY['starter','professional','scale'] LOOP
  cap:=CASE tier_name WHEN 'starter' THEN 1 WHEN 'professional' THEN 5 ELSE 15 END;tid:=gen_random_uuid();uid:=gen_random_uuid();
  INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(uid,uid||'@example.test',now());
  INSERT INTO tenant(tenant_id,name) VALUES(tid,'5B cap fixture');INSERT INTO membership(tenant_id,user_id,email,role) VALUES(tid,uid,uid||'@example.test','owner');
  INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES(tid,tier_name,now()+interval '1 day');
  FOR i IN 1..cap LOOP
   IF i=1 THEN member_id:=uid;ELSE member_id:=gen_random_uuid();INSERT INTO auth.users(id,email) VALUES(member_id,member_id||'@example.test');INSERT INTO membership(tenant_id,user_id,email,role) VALUES(tid,member_id,member_id||'@example.test','rep');END IF;
   PERFORM pg_temp.use_identity(uid::text);EXECUTE 'SET LOCAL ROLE rebatehq_app';
   INSERT INTO licence_seat(tenant_id,user_id) VALUES(tid,member_id);EXECUTE 'RESET ROLE';
  END LOOP;
  member_id:=gen_random_uuid();INSERT INTO auth.users(id,email) VALUES(member_id,member_id||'@example.test');INSERT INTO membership(tenant_id,user_id,email,role) VALUES(tid,member_id,member_id||'@example.test','rep');
  EXECUTE 'SET LOCAL ROLE rebatehq_app';
  BEGIN INSERT INTO licence_seat(tenant_id,user_id) VALUES(tid,member_id);RAISE EXCEPTION '% seat cap bypassed',tier_name;EXCEPTION WHEN check_violation THEN NULL;END;
  BEGIN INSERT INTO invite(tenant_id,email,role,token_hash,invited_by,expires_at) VALUES(tid,member_id||'@example.test','rep',replace(gen_random_uuid()::text,'-',''),uid,now()+interval '1 day');RAISE EXCEPTION '% invite cap bypassed',tier_name;EXCEPTION WHEN check_violation THEN NULL;END;
  INSERT INTO licence_location(tenant_id,name,erp_profile) VALUES(tid,'one','generic');
  IF tier_name='starter' THEN BEGIN INSERT INTO licence_location(tenant_id,name,erp_profile) VALUES(tid,'two','netsuite');RAISE EXCEPTION 'Starter location cap bypassed';EXCEPTION WHEN check_violation THEN NULL;END;
  ELSE INSERT INTO licence_location(tenant_id,name,erp_profile) VALUES(tid,'two','netsuite');END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $caps$;
SELECT extensions.ok(true,'5B: Starter 1, Professional 5, Scale 15 seats and invitations, and location/profile caps at each boundary');
-- Sequence-backed global budget cannot be reset by a caller rolling back its audit insert.
SELECT set_config('app.chunk5b_budget_before',(SELECT last_value::text FROM rebatehq_private.login_budget),true);
SAVEPOINT login_budget_rollback;
SET LOCAL ROLE rebatehq_app;
SELECT record_failed_login('rollback-__PHASE1_USER_A_ID__@example.test','192.0.2.243','rollback probe');
RESET ROLE;
ROLLBACK TO SAVEPOINT login_budget_rollback;
SELECT extensions.ok((SELECT last_value FROM rebatehq_private.login_budget)>current_setting('app.chunk5b_budget_before')::bigint,'5B: failed-login global budget survives rollback (assertion recorded after rollback)');
