-- Team sharing S3 (blueprint section 22, item 38; SHARING_DESIGN.md sections 5 and 7). The user chose Supabase Storage
-- with direct downloads (25 Nov 2026). Encrypted pack chunks live in one private bucket, at
--   <tenant>/<pack>/<pack version id>/<chunk number>
-- Storage checks requests as `authenticated` with only auth.uid() (no app request context), so the decision is one
-- reviewed SECURITY DEFINER helper that Storage may call. It allows:
--   read:  an active seated member on Professional or Scale whose active device holds the pack's key in the latest epoch,
--          for a version that exists (a device without a cost pack can never fetch a cost chunk);
--   write: the publisher who signed that pack version in the latest epoch, within an hour of signing.
-- There are no UPDATE or DELETE policies, so a chunk can never be replaced. The bucket's size limit caps a chunk.
-- Bytes are ciphertext only; the chunk list and hashes are in the signed, encrypted manifest of the pack version.
-- The helper lives alone in schema rebatehq_storage, which the Data API does not expose: no public function is ever granted to
-- `authenticated` (config/function-acl-allowlist.sql), so it cannot be called as an RPC.
-- The Storage schema is managed by Supabase: no GRANT or REVOKE is made on it. Restores: see RESTORE_RUNBOOK.md.
BEGIN;

CREATE SCHEMA rebatehq_storage;
REVOKE ALL ON SCHEMA rebatehq_storage FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT USAGE ON SCHEMA rebatehq_storage TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('relay-packs','relay-packs',false,524400,ARRAY['application/octet-stream']);

CREATE FUNCTION rebatehq_storage.relay_storage_allowed(p_name text,p_write boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a text[]; t uuid; v uuid; uid uuid; latest uuid;
BEGIN
 uid:=auth.uid();
 IF uid IS NULL OR p_name IS NULL THEN RETURN false; END IF;
 a:=string_to_array(p_name,'/');
 IF array_length(a,1)<>4
  OR a[1]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR a[2] NOT IN ('items','customers','book','contracts','guards','cost','cost_floors','supplier','rules','competitors','documents','results')
  OR a[3]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR a[4]!~'^(0|[1-9][0-9]?|1[01][0-9]|12[0-7])$' THEN RETURN false; END IF;
 t:=a[1]::uuid; v:=a[3]::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.membership m JOIN public.workspace_licence l USING(tenant_id)
   JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
   WHERE m.tenant_id=t AND m.user_id=uid AND m.status='active' AND l.status='active'
   AND l.tier IN ('professional','scale') AND l.valid_until>statement_timestamp()) THEN RETURN false; END IF;
 SELECT e.id INTO latest FROM public.relay_epoch e WHERE e.tenant_id=t ORDER BY e.epoch_number DESC LIMIT 1;
 IF latest IS NULL THEN RETURN false; END IF;
 IF p_write THEN
  RETURN EXISTS(SELECT 1 FROM public.relay_pack_version pv JOIN public.licence_device d ON d.tenant_id=pv.tenant_id AND d.id=pv.sender_device AND d.user_id=pv.sender_user
   WHERE pv.tenant_id=t AND pv.id=v AND pv.pack=a[2] AND pv.sender_user=uid AND pv.epoch_id=latest AND d.status='active'
   AND pv.received_at>clock_timestamp()-interval '1 hour');
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.relay_pack_version pv WHERE pv.tenant_id=t AND pv.id=v AND pv.pack=a[2])
  AND EXISTS(SELECT 1 FROM public.relay_pack_wrap w
   JOIN public.relay_device_key k ON k.tenant_id=w.tenant_id AND k.id=w.recipient_device
   JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
   WHERE w.tenant_id=t AND w.epoch_id=latest AND w.pack=a[2] AND k.user_id=uid AND d.status='active');
END $$;
REVOKE ALL ON FUNCTION rebatehq_storage.relay_storage_allowed(text,boolean) FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION rebatehq_storage.relay_storage_allowed(text,boolean) TO authenticated;

CREATE POLICY relay_packs_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='relay-packs' AND rebatehq_storage.relay_storage_allowed(name,false));
CREATE POLICY relay_packs_write ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='relay-packs' AND rebatehq_storage.relay_storage_allowed(name,true));
COMMIT;
