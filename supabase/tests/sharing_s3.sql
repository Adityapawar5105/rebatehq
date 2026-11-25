-- Team sharing S3 (migration 20261126120000_sharing_s3_storage.sql): the private relay-packs bucket, its two policies and
-- the relay_storage_allowed rule, checked as `authenticated` exactly as Supabase Storage calls it. Uses the S2 fixtures
-- (tenant A: epoch A3 with book wraps for A and R and a cost wrap for A only; book and cost version 1 signed by A).
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok((SELECT count(*)=1 FROM storage.buckets WHERE id='relay-packs' AND NOT public AND file_size_limit=524400 AND allowed_mime_types=ARRAY['application/octet-stream'])
 AND (SELECT array_agg(p.proname::text ORDER BY p.proname)=ARRAY['relay_channel_allowed','relay_storage_allowed'] AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=public, pg_temp'])
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='rebatehq_storage')
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rebatehq_storage')
 AND has_schema_privilege('authenticated','rebatehq_storage','USAGE') AND has_function_privilege('authenticated','rebatehq_storage.relay_storage_allowed(text,boolean)','EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','service_role','rebatehq_app']) r WHERE has_schema_privilege(r,'rebatehq_storage','USAGE') OR has_function_privilege(r,'rebatehq_storage.relay_storage_allowed(text,boolean)','EXECUTE'))
 AND NOT has_function_privilege('anon','rebatehq_storage.relay_storage_allowed(text,boolean)','EXECUTE'),
 'S3: the relay-packs bucket is private, capped at one chunk and octet-stream only; its rule and the S4 channel rule are the only objects in rebatehq_storage, callable by authenticated alone');
SELECT extensions.ok((SELECT array_agg(policyname||':'||cmd||':'||array_to_string(roles,',') ORDER BY policyname)=ARRAY['relay_packs_read:SELECT:authenticated','relay_packs_write:INSERT:authenticated']
  FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND (qual LIKE '%relay-packs%' OR with_check LIKE '%relay-packs%'))
 AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('UPDATE','DELETE','ALL') AND (coalesce(qual,'')||coalesce(with_check,'')) LIKE '%relay-packs%'),
 'S3: only read and insert policies on relay-packs; no chunk can be updated or deleted');
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_R_ID__');
SET LOCAL ROLE authenticated;
DO $$ DECLARE book text:='__PHASE1_RELAY_TENANT_A_ID__/book/__PHASE1_SHARE_BOOK_V1_ID__/0'; cost text:='__PHASE1_RELAY_TENANT_A_ID__/cost/__PHASE1_SHARE_COST_V1_ID__/0'; BEGIN
 IF current_user<>'authenticated' THEN RAISE EXCEPTION 'S3 unsafe storage role'; END IF;
 IF NOT rebatehq_storage.relay_storage_allowed(book,false) THEN RAISE EXCEPTION 'S3 a rep cannot read the book pack'; END IF;
 IF rebatehq_storage.relay_storage_allowed(cost,false) THEN RAISE EXCEPTION 'S3 a rep can read a cost chunk'; END IF;
 IF rebatehq_storage.relay_storage_allowed(book,true) THEN RAISE EXCEPTION 'S3 a rep can write a chunk'; END IF;
 IF rebatehq_storage.relay_storage_allowed('__PHASE1_RELAY_TENANT_B_ID__/book/__PHASE1_SHARE_BOOK_V1_ID__/0',false) THEN RAISE EXCEPTION 'S3 another tenant path allowed'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('__PHASE1_RELAY_USER_A_ID__');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT rebatehq_storage.relay_storage_allowed('__PHASE1_RELAY_TENANT_A_ID__/cost/__PHASE1_SHARE_COST_V1_ID__/0',true) THEN RAISE EXCEPTION 'S3 the signer cannot upload its chunk'; END IF;
 IF rebatehq_storage.relay_storage_allowed('__PHASE1_RELAY_TENANT_A_ID__/cost/__PHASE1_SHARE_COST_V1_ID__/128',true) THEN RAISE EXCEPTION 'S3 chunk 128 allowed'; END IF;
 IF rebatehq_storage.relay_storage_allowed('__PHASE1_RELAY_TENANT_A_ID__/cost/__PHASE1_SHARE_BOOK_V1_ID__/0',true) THEN RAISE EXCEPTION 'S3 a chunk under the wrong pack allowed'; END IF;
 IF rebatehq_storage.relay_storage_allowed('../__PHASE1_RELAY_TENANT_A_ID__/cost/__PHASE1_SHARE_COST_V1_ID__/0',false) THEN RAISE EXCEPTION 'S3 a malformed path allowed'; END IF;
END $$;
RESET ROLE;
SELECT pg_temp.use_identity('');
SELECT extensions.ok(true,'S3: relay_storage_allowed lets a holder read and the signer write, and refuses a rep cost, other tenants, wrong packs and malformed paths');
