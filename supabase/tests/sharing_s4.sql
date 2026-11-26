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
