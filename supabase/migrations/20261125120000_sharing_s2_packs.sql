-- Team sharing S2 (blueprint section 22, item 38; SHARING_DESIGN.md sections 3.3, 4 and 7).
-- Ciphertext only, as in 7A. Adds:
--   * epoch format 2: the Owner-signed sharing grid (role table and pack ticks) stored with the epoch;
--   * relay_pack_wrap: one wrapped key per data pack per entitled device (who holds which pack is metadata the
--     server needs for routing; the keys stay wrapped);
--   * relay_pack_version: a signed hash chain per pack whose manifest is encrypted under that pack's key. Only a
--     person whose active device holds the pack's key in the latest epoch can select its rows, so a device without
--     a cost pack never receives even the ciphertext row (decision 16 applies to the signal too);
--   * larger lifetime limits (the quotas stay in the trigger).
-- Storage and Realtime policies are not here: they ship with the releases that exercise them (S3, S4).
-- Rollback: leave RELAY_ENABLED off; format 1 epochs keep working. Never edit this file once locked.
BEGIN;

ALTER TABLE public.relay_epoch ADD COLUMN format smallint NOT NULL DEFAULT 1 CHECK(format IN (1,2));
ALTER TABLE public.relay_epoch ADD COLUMN grid jsonb;
ALTER TABLE public.relay_epoch ADD CONSTRAINT relay_epoch_grid_format CHECK((format=1 AND grid IS NULL) OR (format=2 AND grid IS NOT NULL AND jsonb_typeof(grid)='object' AND octet_length(grid::text)<=65536));
ALTER TABLE public.relay_epoch DROP CONSTRAINT relay_epoch_epoch_number_check;
ALTER TABLE public.relay_epoch ADD CONSTRAINT relay_epoch_epoch_number_check CHECK(epoch_number BETWEEN 1 AND 100000);
ALTER TABLE public.relay_epoch DROP CONSTRAINT relay_epoch_base_sequence_check;
ALTER TABLE public.relay_epoch ADD CONSTRAINT relay_epoch_base_sequence_check CHECK(base_sequence BETWEEN 0 AND 999999999);
ALTER TABLE public.relay_event DROP CONSTRAINT relay_event_sequence_check;
ALTER TABLE public.relay_event ADD CONSTRAINT relay_event_sequence_check CHECK(sequence BETWEEN 1 AND 999999999);

CREATE TABLE public.relay_pack_wrap (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 epoch_id uuid NOT NULL,
 pack text NOT NULL CHECK(pack IN ('items','customers','book','contracts','guards','cost','cost_floors','supplier','rules','competitors','documents','results')),
 recipient_device uuid NOT NULL,
 ephemeral_public bytea NOT NULL CHECK(octet_length(ephemeral_public)=65 AND get_byte(ephemeral_public,0)=4),
 iv bytea NOT NULL CHECK(octet_length(iv)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext)=48),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,epoch_id,pack,recipient_device),
 FOREIGN KEY(tenant_id,epoch_id) REFERENCES public.relay_epoch(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_device) REFERENCES public.relay_device_key(tenant_id,id)
);
CREATE INDEX relay_pack_wrap_reader_idx ON public.relay_pack_wrap(tenant_id,epoch_id,pack,recipient_device);

CREATE TABLE public.relay_pack_version (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 epoch_id uuid NOT NULL,
 pack text NOT NULL CHECK(pack IN ('items','customers','book','contracts','guards','cost','cost_floors','supplier','rules','competitors','documents','results')),
 version bigint NOT NULL CHECK(version BETWEEN 1 AND 999999999),
 previous_hash bytea NOT NULL CHECK(octet_length(previous_hash)=32),
 kind text NOT NULL CHECK(kind IN ('snapshot','delta')),
 base_version bigint NOT NULL CHECK(base_version>=0 AND base_version<version AND ((kind='snapshot' AND base_version=0) OR (kind='delta' AND base_version>=1))),
 sender_user uuid NOT NULL,
 sender_device uuid NOT NULL,
 iv bytea NOT NULL CHECK(octet_length(iv)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 17 AND 16384),
 ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes=octet_length(ciphertext)),
 signature bytea NOT NULL CHECK(octet_length(signature)=64),
 content_hash bytea NOT NULL CHECK(octet_length(content_hash)=32),
 signed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,pack,version),
 FOREIGN KEY(tenant_id,epoch_id) REFERENCES public.relay_epoch(tenant_id,id),
 FOREIGN KEY(tenant_id,sender_device,sender_user) REFERENCES public.relay_device_key(tenant_id,id,user_id)
);
CREATE INDEX relay_pack_version_rate_idx ON public.relay_pack_version(tenant_id,sender_device,received_at DESC);

-- Whether the signed-in person has an active device that holds this pack's key in the latest epoch.
CREATE FUNCTION public.relay_pack_reader(p_tenant uuid,p_pack text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.relay_allowed(p_tenant,false) AND EXISTS(
  SELECT 1 FROM public.relay_pack_wrap w
  JOIN public.relay_device_key k ON k.tenant_id=w.tenant_id AND k.id=w.recipient_device
  JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
  WHERE w.tenant_id=p_tenant AND w.pack=p_pack AND k.user_id=auth.uid() AND d.status='active'
  AND w.epoch_id=(SELECT e.id FROM public.relay_epoch e WHERE e.tenant_id=p_tenant ORDER BY e.epoch_number DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.relay_pack_reader(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.relay_pack_reader(uuid,text) TO rebatehq_app;

CREATE OR REPLACE FUNCTION public.relay_check_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE latest public.relay_epoch%ROWTYPE; last_sequence bigint; last_hash bytea;
 eligible uuid[]; eligible_roles text[]; uid uuid; parent_signer uuid; parent_devices uuid[]; parent_format smallint;
 last_version bigint; last_pack_hash bytea;
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
   IF (SELECT count(*) FROM public.relay_device_key WHERE tenant_id=NEW.tenant_id)>=1000
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
 IF NOT NEW.sender_device=ANY(latest.device_ids) OR EXISTS(
  SELECT 1 FROM unnest(NEW.recipient_ids||NEW.mention_ids) recipient
  WHERE NOT EXISTS(SELECT 1 FROM public.relay_device_key k WHERE k.tenant_id=NEW.tenant_id AND k.id=ANY(latest.device_ids) AND k.user_id=recipient)) THEN
  RAISE EXCEPTION 'invalid relay participant' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id)>=1000000
 OR COALESCE((SELECT sum(ciphertext_bytes) FROM public.relay_event WHERE tenant_id=NEW.tenant_id),0)+NEW.ciphertext_bytes>1073741824
 OR (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id AND sender_device=NEW.sender_device AND received_at>clock_timestamp()-interval '1 minute')>=60 THEN
  RAISE EXCEPTION 'relay message quota exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.relay_check_insert() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.relay_check_insert() TO CURRENT_USER;

-- Retain the audit contract; the two new relay tables are metadata-only like the four 7A tables.
CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b jsonb; a jsonb; tid uuid; eid text; actor uuid;
BEGIN
 actor:=public.verified_request_actor();
 IF TG_OP<>'INSERT' THEN b:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN a:=to_jsonb(NEW); END IF;
 tid:=COALESCE((a->>'tenant_id')::uuid,(b->>'tenant_id')::uuid);
 eid:=COALESCE(a->>'id',b->>'id',a->>'user_id',b->>'user_id',tid::text);
 IF TG_TABLE_NAME='connector_secret' THEN b:=b-'ciphertext'-'nonce'-'auth_tag'; a:=a-'ciphertext'-'nonce'-'auth_tag'; END IF;
 IF TG_TABLE_NAME IN ('relay_device_key','relay_epoch','relay_key_wrap','relay_event','relay_pack_wrap','relay_pack_version') THEN
  IF b IS NOT NULL THEN b:=jsonb_build_object('tenant_id',tid,'id',eid); END IF;
  IF a IS NOT NULL THEN a:=jsonb_build_object('tenant_id',tid,'id',eid); END IF;
 END IF;
 INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,before,after,ip,user_agent)
 VALUES(tid,actor,TG_TABLE_NAME||'.'||lower(TG_OP),TG_TABLE_NAME,eid,b,a,NULLIF(current_setting('app.client_ip',true),'')::inet,left(current_setting('app.user_agent',true),1000));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.audit_row_change() TO CURRENT_USER;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['relay_pack_wrap','relay_pack_version'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
REVOKE ALL ON public.relay_pack_wrap,public.relay_pack_version FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.relay_pack_wrap,public.relay_pack_version TO rebatehq_app;

-- Every member may read the pack wraps: the signed epoch covers them, so verifying it needs them all.
CREATE POLICY relay_pack_wrap_select ON public.relay_pack_wrap FOR SELECT TO rebatehq_app USING(public.relay_allowed(tenant_id,false));
CREATE POLICY relay_pack_wrap_insert ON public.relay_pack_wrap FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,true) AND EXISTS(SELECT 1 FROM public.relay_epoch e JOIN public.licence_device d ON d.tenant_id=e.tenant_id AND d.id=e.signer_device AND d.user_id=e.signer_user WHERE e.tenant_id=relay_pack_wrap.tenant_id AND e.id=relay_pack_wrap.epoch_id AND e.signer_user=auth.uid() AND e.format=2 AND d.status='active' AND relay_pack_wrap.recipient_device=ANY(e.device_ids)));
-- A pack's versions only reach a person whose active device holds that pack in the latest epoch.
CREATE POLICY relay_pack_version_select ON public.relay_pack_version FOR SELECT TO rebatehq_app USING(public.relay_pack_reader(tenant_id,pack));
CREATE POLICY relay_pack_version_insert ON public.relay_pack_version FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,false) AND sender_user=auth.uid() AND EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=relay_pack_version.tenant_id AND d.id=relay_pack_version.sender_device AND d.user_id=auth.uid() AND d.status='active'));

CREATE TRIGGER relay_pack_wrap_validate BEFORE INSERT ON public.relay_pack_wrap FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_pack_version_validate BEFORE INSERT ON public.relay_pack_version FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_pack_wrap_audit_row AFTER INSERT ON public.relay_pack_wrap FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER relay_pack_version_audit_row AFTER INSERT ON public.relay_pack_version FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
COMMIT;
