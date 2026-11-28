-- Team sharing S4 (migration 20261127120000_sharing_s4_doorbell.sql): the content-free Realtime doorbell. Uses the S2
-- fixtures (tenant A: epoch A3 with book wraps for A and R and a cost wrap for A only; book and cost version 1 by A).
RESET ROLE;
SELECT pg_temp.use_identity('');
-- Receive only: one SELECT policy on realtime.messages, nothing that lets a client broadcast; the trigger is the only sender.
SELECT extensions.ok(
  (to_regclass('realtime.messages') IS NULL OR (
    (SELECT array_agg(policyname||':'||cmd||':'||array_to_string(roles,',')) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND (qual LIKE '%relay_channel_allowed%' OR with_check LIKE '%relay_channel_allowed%'))=ARRAY['relay_pack_doorbell_read:SELECT:authenticated']
    AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%relay_channel_allowed%')))
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.relay_pack_version'::regclass AND tgname='relay_pack_doorbell' AND NOT tgisinternal)
  AND (SELECT prosecdef AND proconfig=ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.relay_pack_doorbell()'::regprocedure)
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','rebatehq_app']) r WHERE has_function_privilege(r,'public.relay_pack_doorbell()','EXECUTE')),
 'S4: the doorbell is receive-only for authenticated, sent only by a SECURITY DEFINER trigger nobody else may call');
-- Content-free: the trigger builds a payload of the version number alone, and every message it sent says no more.
SELECT extensions.ok(
  pg_get_functiondef('public.relay_pack_doorbell()'::regprocedure) LIKE '%jsonb_build_object(''v'',NEW.version::text)%'
  AND (to_regclass('realtime.messages') IS NULL OR NOT EXISTS(SELECT 1 FROM realtime.messages WHERE topic LIKE 'pack:%' AND (event<>'pack' OR NOT private OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('v','id'))))),
 'S4: a doorbell carries only the version number (and Realtime''s own message id), on a private channel');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF current_user<>'authenticated' THEN RAISE EXCEPTION 'S4 unsafe realtime role'; END IF;
 IF NOT rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:book') THEN RAISE EXCEPTION 'S4 a rep cannot hear book prices'; END IF;
 IF rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:cost') THEN RAISE EXCEPTION 'S4 a rep can hear cost changes'; END IF;
 IF rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_B_ID__:book') THEN RAISE EXCEPTION 'S4 another tenant channel allowed'; END IF;
 IF rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:invoices') OR rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:book:x')
  OR rebatehq_storage.relay_channel_allowed('relay:__PHASE1_RELAY_TENANT_A_ID__') OR rebatehq_storage.relay_channel_allowed(NULL) THEN RAISE EXCEPTION 'S4 a malformed channel allowed'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:cost') THEN RAISE EXCEPTION 'S4 the cost holder cannot hear cost'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'S4: relay_channel_allowed lets a pack holder join its channel and refuses a rep cost, other tenants and malformed channels');
-- Review R2 (migration 20261128120000_review_r2_deleted_workspaces.sql): once the Owner deletes the workspace, neither rule
-- lets a member read its pack chunks or join its doorbell channels. The deletion is undone so later checks see tenant A.
RESET ROLE;
UPDATE public.tenant SET deleted_at=now() WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF rebatehq_storage.relay_storage_allowed('__PHASE1_RELAY_TENANT_A_ID__/book/__PHASE1_SHARE_BOOK_V1_ID__/0',false) THEN RAISE EXCEPTION 'R2 a deleted workspace chunk is readable'; END IF;
 IF rebatehq_storage.relay_channel_allowed('pack:__PHASE1_RELAY_TENANT_A_ID__:book') THEN RAISE EXCEPTION 'R2 a deleted workspace channel can be joined'; END IF;
END $$;
RESET ROLE;
UPDATE public.tenant SET deleted_at=NULL WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'Review R2: a deleted workspace''s pack chunks and doorbell channels are refused to its members');
-- Review R2, the rest (migration 20261129120000_review_r2_relay_quotas.sql). Tenant A's latest epoch is A3, format 2:
-- A is the grid Owner (a publisher), R a Sales Rep (not a publisher). Operator rows stand in for earlier traffic.
RESET ROLE;
SELECT pg_temp.use_identity('');
DO $$ DECLARE s bigint; BEGIN
 -- Earlier checks left events of both devices in this minute: move them out, so the counts below are exact.
 UPDATE public.relay_event SET received_at=clock_timestamp()-interval '2 hours' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND sender_device IN ('__PHASE1_RELAY_DEVICE_R_ID__','__PHASE1_RELAY_DEVICE_A_ID__');
 SELECT COALESCE(max(sequence),0) INTO s FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
 INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at,received_at)
 SELECT gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+g,decode(repeat('71',32),'hex'),'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',gen_random_uuid(),'quote','{}','{}',
  decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2q'||g)||md5('r2q'||g),'hex'),now(),clock_timestamp()
 FROM generate_series(1,19) g;
END $$;
-- As R: the 20th event in a minute is accepted, the 21st refused.
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE s bigint; h bytea; BEGIN
 IF current_user<>'rebatehq_app' THEN RAISE EXCEPTION 'R2Q unsafe role'; END IF;
 FOR i IN 1..2 LOOP
  SELECT sequence,content_hash INTO s,h FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' ORDER BY sequence DESC LIMIT 1;
  BEGIN
   INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
   VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+1,h,'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',gen_random_uuid(),'quote','{}','{}',
    decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2q-r'||i)||md5('r2q-r'||i),'hex'),now());
   IF i=2 THEN RAISE EXCEPTION 'R2Q a rep device sent a 21st event in one minute'; END IF;
  EXCEPTION WHEN check_violation THEN
   IF i=1 THEN RAISE EXCEPTION 'R2Q the 20th rep event was refused: %',SQLERRM; END IF;
   IF SQLERRM NOT LIKE 'relay message quota exceeded%' THEN RAISE EXCEPTION 'R2Q wrong refusal: %',SQLERRM; END IF;
  END;
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'Review R2: a device that does not publish may send 20 relay events a minute, not 21');
-- A day: move R's events out of the last minute, then top R up to 1,999 events in the last day.
DO $$ DECLARE s bigint; n bigint; BEGIN
 UPDATE public.relay_event SET received_at=clock_timestamp()-interval '2 hours' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND sender_device='__PHASE1_RELAY_DEVICE_R_ID__';
 SELECT count(*) INTO n FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND sender_device='__PHASE1_RELAY_DEVICE_R_ID__';
 IF n>1999 THEN RAISE EXCEPTION 'R2Q fixture already has % rep events',n; END IF;
 SELECT COALESCE(max(sequence),0) INTO s FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
 INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at,received_at)
 SELECT gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+g,decode(repeat('71',32),'hex'),'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',gen_random_uuid(),'quote','{}','{}',
  decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2d'||g)||md5('r2d'||g),'hex'),now(),clock_timestamp()-interval '2 hours'
 FROM generate_series(1,(1999-n)::integer) g;
END $$;
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE s bigint; h bytea; BEGIN
 FOR i IN 1..2 LOOP
  SELECT sequence,content_hash INTO s,h FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' ORDER BY sequence DESC LIMIT 1;
  BEGIN
   INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
   VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+1,h,'__PHASE1_RELAY_USER_R_ID__','__PHASE1_RELAY_DEVICE_R_ID__',gen_random_uuid(),'quote','{}','{}',
    decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2d-r'||i)||md5('r2d-r'||i),'hex'),now());
   IF i=2 THEN RAISE EXCEPTION 'R2Q a rep device sent a 2,001st event in one day'; END IF;
  EXCEPTION WHEN check_violation THEN
   IF i=1 THEN RAISE EXCEPTION 'R2Q the 2,000th rep event of the day was refused: %',SQLERRM; END IF;
   IF SQLERRM NOT LIKE 'relay message quota exceeded%' THEN RAISE EXCEPTION 'R2Q wrong refusal: %',SQLERRM; END IF;
  END;
 END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'Review R2: a device that does not publish may send 2,000 relay events a day, not 2,001');
-- The Owner (a publisher) keeps 60 a minute: 25 events already this minute, and one more is accepted.
DO $$ DECLARE s bigint; BEGIN
 SELECT COALESCE(max(sequence),0) INTO s FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__';
 INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at,received_at)
 SELECT gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+g,decode(repeat('71',32),'hex'),'__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',gen_random_uuid(),'quote','{}','{}',
  decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2a'||g)||md5('r2a'||g),'hex'),now(),clock_timestamp()
 FROM generate_series(1,25) g;
END $$;
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ DECLARE s bigint; h bytea; BEGIN
 SELECT sequence,content_hash INTO s,h FROM public.relay_event WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' ORDER BY sequence DESC LIMIT 1;
 BEGIN
  INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at)
  VALUES(gen_random_uuid(),'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_SHARE_EPOCH_A3_ID__',s+1,h,'__PHASE1_RELAY_USER_A_ID__','__PHASE1_RELAY_DEVICE_A_ID__',gen_random_uuid(),'quote','{}','{}',
   decode(repeat('72',12),'hex'),decode(repeat('73',32),'hex'),32,decode(repeat('74',64),'hex'),decode(md5('r2a-a')||md5('r2a-a'),'hex'),now());
 EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'R2Q the Owner''s 26th event in a minute was refused: %',SQLERRM;
 END;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'Review R2: a publisher keeps the 60-a-minute event limit');
-- R25: 1,000 keys of revoked devices no longer block a new device's key.
DO $$ BEGIN
 INSERT INTO public.licence_device(id,tenant_id,user_id) SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__' FROM generate_series(1,1001) g;
 UPDATE public.licence_device SET status='revoked' WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__' AND id::text LIKE '00000000-0000-4000-8000-%' AND id<>'00000000-0000-4000-8000-000000001001'::uuid;
 UPDATE public.licence_device SET status='active' WHERE id='00000000-0000-4000-8000-000000001001'::uuid;
 INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at,received_at)
 SELECT ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__',decode('04'||repeat('61',64),'hex'),decode('04'||repeat('62',64),'hex'),decode(repeat('63',64),'hex'),now(),clock_timestamp()-interval '2 minutes'
 FROM generate_series(1,1000) g;
 IF (SELECT count(*) FROM public.relay_device_key WHERE tenant_id='__PHASE1_RELAY_TENANT_A_ID__')<1000 THEN RAISE EXCEPTION 'R2Q key fixture too small'; END IF;
END $$;
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE rebatehq_app;
DO $$ BEGIN
 INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at)
 VALUES('00000000-0000-4000-8000-000000001001','__PHASE1_RELAY_TENANT_A_ID__','__PHASE1_RELAY_USER_A_ID__',decode('04'||repeat('61',64),'hex'),decode('04'||repeat('62',64),'hex'),decode(repeat('63',64),'hex'),now());
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'R2Q revoked device keys still block a new key: %',SQLERRM;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'Review R2 (R25): keys of revoked devices do not count toward the 1,000 device-key limit');
-- Review R3 (migration 20261130120000_r3_tenant_purge.sql): the 30-day purge of a deleted workspace. Relay tenant B is
-- purged; tenant A must keep every row. The suite runs in one transaction that is rolled back.
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(
  (SELECT NOT p.prosecdef AND n.nspname='rebatehq_private' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid='rebatehq_private.purge_deleted_tenant(uuid,interval)'::regprocedure)
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','rebatehq_app']) r WHERE has_function_privilege(r,'rebatehq_private.purge_deleted_tenant(uuid,interval)','EXECUTE')),
 'Review R3: the purge is an invoker function in the private schema that no app or Supabase role may execute');
DO $$ BEGIN
 BEGIN PERFORM rebatehq_private.purge_deleted_tenant('__PHASE1_RELAY_TENANT_B_ID__'); RAISE EXCEPTION 'R3P purged a live workspace';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.tenant SET deleted_at=now()-interval '29 days' WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';
 BEGIN PERFORM rebatehq_private.purge_deleted_tenant('__PHASE1_RELAY_TENANT_B_ID__'); RAISE EXCEPTION 'R3P purged a workspace deleted 29 days ago';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.tenant SET deleted_at=now()-interval '31 days' WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__';
 BEGIN PERFORM rebatehq_private.purge_deleted_tenant('__PHASE1_RELAY_TENANT_B_ID__', interval '7 days'); RAISE EXCEPTION 'R3P accepted a 7-day window';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT extensions.ok(true,'Review R3: the purge refuses a live workspace, one deleted 29 days ago, and a window under 30 days');
CREATE FUNCTION pg_temp.r3_rows(p uuid) RETURNS jsonb LANGUAGE plpgsql AS $r3$
DECLARE t text; n bigint; o jsonb := '{}'::jsonb;
BEGIN
 FOREACH t IN ARRAY ARRAY['relay_pack_version','relay_pack_wrap','relay_event','relay_key_wrap','relay_epoch','relay_device_key',
                          'bench_consent','licence_device','licence_seat','licence_location','workspace_licence','invite','membership','tenant'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',t) INTO n USING p;
  o := o || jsonb_build_object(t,n);
 END LOOP;
 RETURN o;
END $r3$;
SELECT set_config('app.r3_a_before',pg_temp.r3_rows('__PHASE1_RELAY_TENANT_A_ID__')::text,true);
SELECT set_config('app.r3_b_before',pg_temp.r3_rows('__PHASE1_RELAY_TENANT_B_ID__')::text,true);
SELECT set_config('app.r3_b_audit',(SELECT count(*) FROM public.audit_log WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__')::text,true);
SELECT set_config('app.r3_result',rebatehq_private.purge_deleted_tenant('__PHASE1_RELAY_TENANT_B_ID__')::text,true);
SELECT extensions.ok(
  NOT EXISTS(SELECT 1 FROM jsonb_each_text(pg_temp.r3_rows('__PHASE1_RELAY_TENANT_B_ID__')) WHERE value<>'0')
  AND current_setting('app.r3_result')::jsonb->>'tenant'='1'
  AND (SELECT sum(value::bigint) FROM jsonb_each_text(current_setting('app.r3_b_before')::jsonb))>1
  AND (SELECT count(*) FROM public.audit_log WHERE tenant_id='__PHASE1_RELAY_TENANT_B_ID__')>=current_setting('app.r3_b_audit')::bigint,
 'Review R3: a workspace deleted over 30 days ago loses every row in all 14 tables, and its audit rows stay');
SELECT extensions.ok(pg_temp.r3_rows('__PHASE1_RELAY_TENANT_A_ID__')=current_setting('app.r3_a_before')::jsonb,
 'Review R3: purging one workspace leaves every row of the others');
