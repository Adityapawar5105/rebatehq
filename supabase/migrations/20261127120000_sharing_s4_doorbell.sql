-- Team sharing S4 (blueprint section 22, item 38; SHARING_DESIGN.md sections 5 and 7): a content-free Realtime doorbell.
-- Each new pack version rings the private channel   pack:<tenant>:<pack>   with only its version number. A device that
-- holds that pack's key hears it and syncs at once; everyone else keeps the 60-second poll, which stays the path that
-- guarantees delivery. A device without a cost pack can never join a cost channel, so it is not even told that cost
-- changed (decision 16).
--   * public.relay_pack_doorbell(): the AFTER INSERT trigger on relay_pack_version. SECURITY DEFINER, because the app
--     role has no access to the Supabase-managed realtime schema; realtime.send itself only warns on failure, and any
--     other error is swallowed here, so a doorbell can never block a relay write.
--   * rebatehq_storage.relay_channel_allowed(topic): the join rule Supabase Realtime checks as `authenticated`, beside
--     the Storage rule in the schema the Data API does not expose.
--   * one SELECT policy on realtime.messages (receive only). There is no INSERT policy, so no client can broadcast.
-- The realtime schema is managed by Supabase: no GRANT or REVOKE is made on it, and the policy is created only where
-- realtime.messages exists (without it, joins are refused and the poll still delivers). Restores re-apply the policy
-- with scripts/restore-storage-objects.sql, since dumps exclude realtime.
BEGIN;

CREATE FUNCTION rebatehq_storage.relay_channel_allowed(p_topic text) RETURNS boolean
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

CREATE FUNCTION public.relay_pack_doorbell() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Only the version number: no pack content, key, hash, sender or size.
 PERFORM realtime.send(jsonb_build_object('v',NEW.version::text),'pack','pack:'||NEW.tenant_id::text||':'||NEW.pack,true);
 RETURN NULL;
EXCEPTION WHEN OTHERS THEN
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.relay_pack_doorbell() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.relay_pack_doorbell() TO CURRENT_USER;
CREATE TRIGGER relay_pack_doorbell AFTER INSERT ON public.relay_pack_version FOR EACH ROW EXECUTE FUNCTION public.relay_pack_doorbell();

DO $policy$ BEGIN
 IF to_regclass('realtime.messages') IS NOT NULL THEN
  CREATE POLICY relay_pack_doorbell_read ON realtime.messages FOR SELECT TO authenticated
   USING(extension='broadcast' AND rebatehq_storage.relay_channel_allowed(realtime.topic()));
 END IF;
END $policy$;
COMMIT;
