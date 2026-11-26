-- Review R2 (26 Nov 2026, flaw 3.5): Supabase Storage and Realtime are reached directly with the person's own token, so
-- they never pass the app's context, which hides a workspace once its Owner deletes it. The two rules now refuse a
-- deleted workspace too: after "Delete workspace", no member can list or download its pack chunks or join its doorbell
-- channels. Everything else in both rules is unchanged from the S3 and S4 migrations.
BEGIN;

CREATE OR REPLACE FUNCTION rebatehq_storage.relay_storage_allowed(p_name text,p_write boolean) RETURNS boolean
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
   JOIN public.tenant w ON w.tenant_id=m.tenant_id AND w.deleted_at IS NULL
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

CREATE OR REPLACE FUNCTION rebatehq_storage.relay_channel_allowed(p_topic text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a text[]; t uuid; uid uuid; latest uuid;
BEGIN
 uid:=auth.uid();
 IF uid IS NULL OR p_topic IS NULL THEN RETURN false; END IF;
 a:=string_to_array(p_topic,':');
 IF array_length(a,1)<>3 OR a[1]<>'pack'
  OR a[2]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR a[3] NOT IN ('items','customers','book','contracts','guards','cost','cost_floors','supplier','rules','competitors','documents','results') THEN RETURN false; END IF;
 t:=a[2]::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.membership m JOIN public.workspace_licence l USING(tenant_id)
   JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
   JOIN public.tenant w ON w.tenant_id=m.tenant_id AND w.deleted_at IS NULL
   WHERE m.tenant_id=t AND m.user_id=uid AND m.status='active' AND l.status='active'
   AND l.tier IN ('professional','scale') AND l.valid_until>statement_timestamp()) THEN RETURN false; END IF;
 SELECT e.id INTO latest FROM public.relay_epoch e WHERE e.tenant_id=t ORDER BY e.epoch_number DESC LIMIT 1;
 IF latest IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.relay_pack_wrap w
   JOIN public.relay_device_key k ON k.tenant_id=w.tenant_id AND k.id=w.recipient_device
   JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
   WHERE w.tenant_id=t AND w.epoch_id=latest AND w.pack=a[3] AND k.user_id=uid AND d.status='active');
END $$;
REVOKE ALL ON FUNCTION rebatehq_storage.relay_channel_allowed(text) FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION rebatehq_storage.relay_channel_allowed(text) TO authenticated;

COMMIT;
