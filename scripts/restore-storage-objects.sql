-- Restore-only procedure, not a migration (team sharing S3 and S4). Restore dumps exclude the Supabase-managed storage and
-- realtime schemas, so a restored project has the rebatehq_storage rules but neither the relay-packs bucket, its two
-- policies, nor the Realtime doorbell policy.
-- Run AFTER the schema and data restore. Idempotent. Must match the S3 and S4 migrations exactly
-- (tests/restore-storage-objects.test.js compares them). Chunks themselves are not restored: publishers re-publish.
BEGIN;
DO $check$ BEGIN
  IF to_regprocedure('rebatehq_storage.relay_storage_allowed(text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Restore the application schema (with rebatehq_storage) before the Storage objects';
  END IF;
END $check$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('relay-packs','relay-packs',false,524400,ARRAY['application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=524400,allowed_mime_types=ARRAY['application/octet-stream'];
DROP POLICY IF EXISTS relay_packs_read ON storage.objects;
DROP POLICY IF EXISTS relay_packs_write ON storage.objects;
CREATE POLICY relay_packs_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='relay-packs' AND rebatehq_storage.relay_storage_allowed(name,false));
CREATE POLICY relay_packs_write ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='relay-packs' AND rebatehq_storage.relay_storage_allowed(name,true));
-- S4 (20261127120000_sharing_s4_doorbell.sql): receive-only doorbell policy, where Realtime has created its table.
DO $realtime$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS relay_pack_doorbell_read ON realtime.messages;
    CREATE POLICY relay_pack_doorbell_read ON realtime.messages FOR SELECT TO authenticated
   USING(extension='broadcast' AND rebatehq_storage.relay_channel_allowed(realtime.topic()));
  END IF;
END $realtime$;
COMMIT;
