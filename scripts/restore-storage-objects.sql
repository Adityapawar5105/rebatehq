-- Restore-only procedure, not a migration (team sharing S3). Restore dumps exclude the Supabase-managed storage schema,
-- so a restored project has rebatehq_storage.relay_storage_allowed but neither the relay-packs bucket nor its two policies.
-- Run AFTER the schema and data restore. Idempotent. Must match 20261126120000_sharing_s3_storage.sql exactly
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
COMMIT;
