-- Review R2, the rest (27 Nov 2026; SECURITY_REVIEW.md R25 and the review's "lower event quota" item). Two changes to the
-- relay insert trigger; everything else is the S2 body unchanged.
--   * Event quota: a device whose person does not publish under the signed sharing grid (not an Owner, Pricing Owner or
--     the named Pricing Owner) may send 20 events a minute and 2,000 a day, instead of 60 a minute. A person typing
--     comments, thread messages and task changes stays far below both; a rep device can no longer fill the workspace's
--     1,000,000-event log in days. A workspace without a signed grid (format 1) keeps the earlier limit for everyone.
--   * Device keys: the 1,000-key limit counts only keys of active devices, so revoked devices no longer use it up for
--     good. A lifetime bound of 10,000 keys still caps the table.
BEGIN;

CREATE OR REPLACE FUNCTION public.relay_check_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE latest public.relay_epoch%ROWTYPE; last_sequence bigint; last_hash bytea;
 eligible uuid[]; eligible_roles text[]; uid uuid; parent_signer uuid; parent_devices uuid[]; parent_format smallint;
 last_version bigint; last_pack_hash bytea; publisher boolean; minute_cap integer;
BEGIN
 -- Operator fixtures/restores use the same reviewed privilege boundary as
 -- verified_request_actor. A restricted runtime login cannot enter this path.
 IF COALESCE(current_setting('role',true),'none') IN ('none','') AND EXISTS
 (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW; END IF;
 -- Let WITH CHECK produce a real RLS violation for unauthorised rows; do not
 -- replace it with a missing-table privilege error or leak another tenant's head.
 IF NOT public.relay_allowed(NEW.tenant_id,TG_TABLE_NAME IN ('relay_epoch','relay_key_wrap','relay_pack_wrap')) THEN RETURN NEW; END IF;
 uid:=auth.uid();
 IF TG_TABLE_NAME='relay_device_key' THEN
  IF NEW.user_id<>uid OR NOT EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.id AND d.user_id=uid AND d.status='active') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='relay_epoch' THEN
  IF NEW.signer_user<>uid OR NOT EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.signer_device AND d.user_id=uid AND d.status='active') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME IN ('relay_event','relay_pack_version') THEN
  IF NEW.sender_user<>uid OR NOT EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.sender_device AND d.user_id=uid AND d.status='active') THEN RETURN NEW; END IF;
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.tenant_id::text,7142));
 NEW.received_at:=clock_timestamp();
 IF TG_TABLE_NAME='relay_device_key' THEN
   IF NEW.user_id<>uid THEN RETURN NEW; END IF;
   IF (SELECT count(*) FROM public.relay_device_key k JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
       WHERE k.tenant_id=NEW.tenant_id AND d.status='active')>=1000
    OR (SELECT count(*) FROM public.relay_device_key WHERE tenant_id=NEW.tenant_id)>=10000
    OR (SELECT count(*) FROM public.relay_device_key WHERE tenant_id=NEW.tenant_id AND user_id=uid AND received_at>clock_timestamp()-interval '1 minute')>=10 THEN
    RAISE EXCEPTION 'relay registration quota exceeded' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO latest FROM public.relay_epoch WHERE tenant_id=NEW.tenant_id ORDER BY epoch_number DESC LIMIT 1;
 SELECT array_agg(k.id ORDER BY k.id),array_agg(m.role::text ORDER BY k.id) INTO eligible,eligible_roles
 FROM public.relay_device_key k JOIN public.membership m ON m.tenant_id=k.tenant_id AND m.user_id=k.user_id
 JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
 JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
 WHERE k.tenant_id=NEW.tenant_id AND m.status='active' AND d.status='active';
 SELECT sequence,content_hash INTO last_sequence,last_hash FROM public.relay_event WHERE tenant_id=NEW.tenant_id ORDER BY sequence DESC LIMIT 1;
 last_sequence:=COALESCE(last_sequence,0);last_hash:=COALESCE(last_hash,decode(repeat('0',64),'hex'));
 IF TG_TABLE_NAME='relay_epoch' THEN
   IF NEW.signer_user<>uid THEN RETURN NEW; END IF;
   IF NEW.epoch_number<>COALESCE(latest.epoch_number,0)+1 OR NEW.previous_hash<>COALESCE(latest.content_hash,decode(repeat('0',64),'hex'))
    OR NEW.base_sequence<>last_sequence OR NEW.base_hash<>last_hash THEN
    RAISE EXCEPTION 'relay head changed' USING ERRCODE='40001'; END IF;
   IF NEW.device_ids IS DISTINCT FROM eligible OR NEW.member_roles IS DISTINCT FROM eligible_roles THEN
    RAISE EXCEPTION 'relay roster changed; verify devices and rotate' USING ERRCODE='23514'; END IF;
   -- A workspace that has signed a sharing grid never goes back to keys without one.
   IF latest.format=2 AND NEW.format<>2 THEN RAISE EXCEPTION 'relay sharing grid required' USING ERRCODE='23514'; END IF;
   -- The signed roles must match server membership: a grid Owner is a workspace owner; a Pricing Owner or the named
   -- Pricing Owner is an owner or manager; and the first grid is signed by its own Owner.
   IF NEW.format=2 AND (EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grid->'people') p LEFT JOIN public.membership m ON m.tenant_id=NEW.tenant_id AND m.user_id::text=p->>'userId' AND m.status='active'
     WHERE m.user_id IS NULL OR (p->>'role'='owner' AND m.role<>'owner') OR ((p->>'role'='pricing_owner' OR p->>'userId'=NEW.grid->>'namedOwner') AND m.role NOT IN ('owner','manager')))
    OR (COALESCE(latest.format,1)<>2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.grid->'people') p WHERE p->>'userId'=NEW.signer_user::text AND p->>'role'='owner'))) THEN
    RAISE EXCEPTION 'relay sharing grid does not match membership' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME IN ('relay_key_wrap','relay_pack_wrap') THEN
   SELECT signer_user,device_ids,format INTO parent_signer,parent_devices,parent_format FROM public.relay_epoch WHERE tenant_id=NEW.tenant_id AND id=NEW.epoch_id;
   IF parent_signer IS DISTINCT FROM uid THEN RETURN NEW; END IF;
   IF latest.id IS DISTINCT FROM NEW.epoch_id OR NOT NEW.recipient_device=ANY(parent_devices) OR (TG_TABLE_NAME='relay_pack_wrap' AND parent_format<>2) THEN
    RAISE EXCEPTION 'invalid relay key recipient' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.sender_user<>uid THEN RETURN NEW; END IF;
 IF latest.id IS NULL OR latest.id<>NEW.epoch_id OR latest.device_ids IS DISTINCT FROM eligible OR latest.member_roles IS DISTINCT FROM eligible_roles THEN
  RAISE EXCEPTION 'relay key rotation required' USING ERRCODE='23514'; END IF;
 IF (SELECT array_agg(recipient_device ORDER BY recipient_device) FROM public.relay_key_wrap WHERE tenant_id=NEW.tenant_id AND epoch_id=NEW.epoch_id) IS DISTINCT FROM latest.device_ids THEN
  RAISE EXCEPTION 'relay key publication incomplete' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='relay_pack_version' THEN
   -- Only a publisher under the signed grid (Owner, Pricing Owner, named Pricing Owner) whose device holds the pack.
   IF latest.format<>2 OR NOT (COALESCE(latest.grid->>'namedOwner'=NEW.sender_user::text,false) OR EXISTS(SELECT 1 FROM jsonb_array_elements(latest.grid->'people') p
     WHERE p->>'userId'=NEW.sender_user::text AND p->>'role' IN ('owner','pricing_owner')))
    OR NOT EXISTS(SELECT 1 FROM public.relay_pack_wrap w WHERE w.tenant_id=NEW.tenant_id AND w.epoch_id=NEW.epoch_id AND w.pack=NEW.pack AND w.recipient_device=NEW.sender_device) THEN
    RAISE EXCEPTION 'invalid pack publisher' USING ERRCODE='23514'; END IF;
   SELECT version,content_hash INTO last_version,last_pack_hash FROM public.relay_pack_version WHERE tenant_id=NEW.tenant_id AND pack=NEW.pack ORDER BY version DESC LIMIT 1;
   IF NEW.version<>COALESCE(last_version,0)+1 OR NEW.previous_hash<>COALESCE(last_pack_hash,decode(repeat('0',64),'hex')) THEN
    RAISE EXCEPTION 'relay pack head changed' USING ERRCODE='40001'; END IF;
   IF (SELECT count(*) FROM public.relay_pack_version WHERE tenant_id=NEW.tenant_id)>=200000
   OR COALESCE((SELECT sum(ciphertext_bytes) FROM public.relay_pack_version WHERE tenant_id=NEW.tenant_id),0)+NEW.ciphertext_bytes>268435456
   OR (SELECT count(*) FROM public.relay_pack_version WHERE tenant_id=NEW.tenant_id AND sender_device=NEW.sender_device AND received_at>clock_timestamp()-interval '1 minute')>=120 THEN
    RAISE EXCEPTION 'relay pack quota exceeded' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.sequence<>last_sequence+1 OR NEW.previous_hash<>last_hash THEN RAISE EXCEPTION 'relay head changed' USING ERRCODE='40001'; END IF;
 publisher:=COALESCE(latest.format,1)<>2 OR COALESCE(latest.grid->>'namedOwner'=NEW.sender_user::text,false) OR EXISTS(SELECT 1 FROM jsonb_array_elements(latest.grid->'people') p
   WHERE p->>'userId'=NEW.sender_user::text AND p->>'role' IN ('owner','pricing_owner'));
 minute_cap:=CASE WHEN publisher THEN 60 ELSE 20 END;
 IF NOT NEW.sender_device=ANY(latest.device_ids) OR EXISTS(
  SELECT 1 FROM unnest(NEW.recipient_ids||NEW.mention_ids) recipient
  WHERE NOT EXISTS(SELECT 1 FROM public.relay_device_key k WHERE k.tenant_id=NEW.tenant_id AND k.id=ANY(latest.device_ids) AND k.user_id=recipient)) THEN
  RAISE EXCEPTION 'invalid relay participant' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id)>=1000000
 OR COALESCE((SELECT sum(ciphertext_bytes) FROM public.relay_event WHERE tenant_id=NEW.tenant_id),0)+NEW.ciphertext_bytes>1073741824
 OR (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id AND sender_device=NEW.sender_device AND received_at>clock_timestamp()-interval '1 minute')>=minute_cap
 OR (NOT publisher AND (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id AND sender_device=NEW.sender_device AND received_at>clock_timestamp()-interval '1 day')>=2000) THEN
  RAISE EXCEPTION 'relay message quota exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.relay_check_insert() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.relay_check_insert() TO CURRENT_USER;
COMMIT;
