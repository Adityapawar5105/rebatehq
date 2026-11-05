-- Created with the Supabase CLI, then ordered after the locked 12:00 6R file.
-- 7A: ciphertext relay only. No legacy business table is reused or changed.
-- Rollback: disable RELAY_ENABLED; preserve encrypted relay backups. A later
-- corrective migration may remove these objects after reviewed data retention.
-- Never edit an applied migration or replay old ACL migrations after restore.
BEGIN;

-- id is already globally unique; this additional control-plane key permits a
-- composite tenant FK without relying on a trigger to enforce tenant equality.
ALTER TABLE public.licence_device ADD CONSTRAINT licence_device_tenant_id_id_key UNIQUE(tenant_id,id);

CREATE TABLE public.relay_device_key (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 user_id uuid NOT NULL,
 agreement_public bytea NOT NULL CHECK(octet_length(agreement_public)=65 AND get_byte(agreement_public,0)=4),
 signing_public bytea NOT NULL CHECK(octet_length(signing_public)=65 AND get_byte(signing_public,0)=4),
 possession_proof bytea NOT NULL CHECK(octet_length(possession_proof)=64),
 signed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,id,user_id),
 FOREIGN KEY(tenant_id,id) REFERENCES public.licence_device(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES public.membership(tenant_id,user_id)
);
CREATE INDEX relay_device_key_tenant_idx ON public.relay_device_key(tenant_id,user_id);
CREATE TABLE public.relay_epoch (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 epoch_number bigint NOT NULL CHECK(epoch_number BETWEEN 1 AND 256),
 previous_hash bytea NOT NULL CHECK(octet_length(previous_hash)=32),
 base_sequence bigint NOT NULL CHECK(base_sequence BETWEEN 0 AND 10000),
 base_hash bytea NOT NULL CHECK(octet_length(base_hash)=32),
 signer_user uuid NOT NULL,
 signer_device uuid NOT NULL,
 device_ids uuid[] NOT NULL CHECK(cardinality(device_ids) BETWEEN 1 AND 60 AND array_position(device_ids,NULL) IS NULL),
 member_roles text[] NOT NULL CHECK(cardinality(member_roles)=cardinality(device_ids) AND array_position(member_roles,NULL) IS NULL AND member_roles<@ARRAY['owner','manager','rep','analyst']::text[]),
 signature bytea NOT NULL CHECK(octet_length(signature)=64),
 content_hash bytea NOT NULL CHECK(octet_length(content_hash)=32),
 signed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,epoch_number),
 FOREIGN KEY(tenant_id,signer_device,signer_user) REFERENCES public.relay_device_key(tenant_id,id,user_id)
);
CREATE INDEX relay_epoch_tenant_idx ON public.relay_epoch(tenant_id,epoch_number DESC);
CREATE TABLE public.relay_key_wrap (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 epoch_id uuid NOT NULL,
 recipient_device uuid NOT NULL,
 ephemeral_public bytea NOT NULL CHECK(octet_length(ephemeral_public)=65 AND get_byte(ephemeral_public,0)=4),
 iv bytea NOT NULL CHECK(octet_length(iv)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext)=48),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,epoch_id,recipient_device),
 FOREIGN KEY(tenant_id,epoch_id) REFERENCES public.relay_epoch(tenant_id,id),
 FOREIGN KEY(tenant_id,recipient_device) REFERENCES public.relay_device_key(tenant_id,id)
);
CREATE INDEX relay_key_wrap_tenant_idx ON public.relay_key_wrap(tenant_id,epoch_id);
CREATE TABLE public.relay_event (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id),
 epoch_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 10000),
 previous_hash bytea NOT NULL CHECK(octet_length(previous_hash)=32),
 sender_user uuid NOT NULL,
 sender_device uuid NOT NULL,
 object_id uuid NOT NULL,
 object_kind text NOT NULL CHECK(object_kind IN ('quote','price_change','rebate')),
 recipient_ids uuid[] NOT NULL CHECK(cardinality(recipient_ids)<=60 AND array_position(recipient_ids,NULL) IS NULL),
 mention_ids uuid[] NOT NULL CHECK(cardinality(mention_ids)<=60 AND array_position(mention_ids,NULL) IS NULL),
 iv bytea NOT NULL CHECK(octet_length(iv)=12),
 ciphertext bytea NOT NULL CHECK(octet_length(ciphertext) BETWEEN 17 AND 16384),
 ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes=octet_length(ciphertext)),
 signature bytea NOT NULL CHECK(octet_length(signature)=64),
 content_hash bytea NOT NULL CHECK(octet_length(content_hash)=32),
 signed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(tenant_id,id),
 UNIQUE(tenant_id,sequence),
 FOREIGN KEY(tenant_id,epoch_id) REFERENCES public.relay_epoch(tenant_id,id),
 FOREIGN KEY(tenant_id,sender_device,sender_user) REFERENCES public.relay_device_key(tenant_id,id,user_id)
);
CREATE INDEX relay_event_tenant_idx ON public.relay_event(tenant_id,sequence);
CREATE INDEX relay_event_rate_idx ON public.relay_event(tenant_id,sender_device,received_at DESC);

CREATE FUNCTION public.relay_allowed(p_tenant uuid,p_admin boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.verified_request_actor()=auth.uid()
 AND EXISTS(SELECT 1 FROM public.membership m JOIN public.workspace_licence l USING(tenant_id)
 JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
 WHERE m.tenant_id=p_tenant AND m.user_id=auth.uid() AND m.status='active'
 AND (NOT p_admin OR m.role IN ('owner','manager')) AND l.status='active'
 AND l.tier IN ('professional','scale') AND l.valid_until>statement_timestamp())
$$;
REVOKE ALL ON FUNCTION public.relay_allowed(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.relay_allowed(uuid,boolean) TO rebatehq_app;

-- Relay members need eligible public keys/identity labels, not other users'
-- licence-device control rows. Keep that narrow projection behind this gate.
CREATE FUNCTION public.relay_directory(p_tenant uuid)
RETURNS TABLE(device_id uuid,user_id uuid,member_role text,email text,agreement_public bytea,signing_public bytea,possession_proof bytea,signed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT k.id,k.user_id,m.role::text,m.email,k.agreement_public,k.signing_public,k.possession_proof,k.signed_at
 FROM public.relay_device_key k JOIN public.membership m ON m.tenant_id=k.tenant_id AND m.user_id=k.user_id
 JOIN public.licence_seat s ON s.tenant_id=m.tenant_id AND s.user_id=m.user_id
 JOIN public.licence_device d ON d.tenant_id=k.tenant_id AND d.id=k.id AND d.user_id=k.user_id
 WHERE k.tenant_id=p_tenant AND public.relay_allowed(p_tenant,false) AND m.status='active' AND d.status='active'
 ORDER BY k.id
$$;
REVOKE ALL ON FUNCTION public.relay_directory(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.relay_directory(uuid) TO rebatehq_app;

CREATE FUNCTION public.relay_check_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE latest public.relay_epoch%ROWTYPE; last_sequence bigint; last_hash bytea;
 eligible uuid[]; eligible_roles text[]; uid uuid; parent_signer uuid; parent_devices uuid[];
BEGIN
 -- Operator fixtures/restores use the same reviewed privilege boundary as
 -- verified_request_actor. A restricted runtime login cannot enter this path.
 IF COALESCE(current_setting('role',true),'none') IN ('none','') AND EXISTS
 (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW; END IF;
 -- Let WITH CHECK produce a real RLS violation for unauthorised rows; do not
 -- replace it with a missing-table privilege error or leak another tenant's head.
 IF NOT public.relay_allowed(NEW.tenant_id,TG_TABLE_NAME IN ('relay_epoch','relay_key_wrap')) THEN RETURN NEW; END IF;
 uid:=auth.uid();
 IF TG_TABLE_NAME='relay_device_key' THEN
  IF NEW.user_id<>uid OR NOT EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.id AND d.user_id=uid AND d.status='active') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='relay_epoch' THEN
  IF NEW.signer_user<>uid OR NOT EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=NEW.tenant_id AND d.id=NEW.signer_device AND d.user_id=uid AND d.status='active') THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='relay_event' THEN
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
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='relay_key_wrap' THEN
   SELECT signer_user,device_ids INTO parent_signer,parent_devices FROM public.relay_epoch WHERE tenant_id=NEW.tenant_id AND id=NEW.epoch_id;
   IF parent_signer IS DISTINCT FROM uid THEN RETURN NEW; END IF;
   IF latest.id IS DISTINCT FROM NEW.epoch_id OR NOT NEW.recipient_device=ANY(parent_devices) THEN
    RAISE EXCEPTION 'invalid relay key recipient' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.sender_user<>uid THEN RETURN NEW; END IF;
 IF latest.id IS NULL OR latest.id<>NEW.epoch_id OR latest.device_ids IS DISTINCT FROM eligible OR latest.member_roles IS DISTINCT FROM eligible_roles THEN
  RAISE EXCEPTION 'relay key rotation required' USING ERRCODE='23514'; END IF;
 IF NEW.sequence<>last_sequence+1 OR NEW.previous_hash<>last_hash THEN RAISE EXCEPTION 'relay head changed' USING ERRCODE='40001'; END IF;
 IF (SELECT array_agg(recipient_device ORDER BY recipient_device) FROM public.relay_key_wrap WHERE tenant_id=NEW.tenant_id AND epoch_id=NEW.epoch_id) IS DISTINCT FROM latest.device_ids THEN
  RAISE EXCEPTION 'relay key publication incomplete' USING ERRCODE='23514'; END IF;
 IF NOT NEW.sender_device=ANY(latest.device_ids) OR EXISTS(
  SELECT 1 FROM unnest(NEW.recipient_ids||NEW.mention_ids) recipient
  WHERE NOT EXISTS(SELECT 1 FROM public.relay_device_key k WHERE k.tenant_id=NEW.tenant_id AND k.id=ANY(latest.device_ids) AND k.user_id=recipient)) THEN
  RAISE EXCEPTION 'invalid relay participant' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id)>=10000
 OR COALESCE((SELECT sum(ciphertext_bytes) FROM public.relay_event WHERE tenant_id=NEW.tenant_id),0)+NEW.ciphertext_bytes>16777216
 OR (SELECT count(*) FROM public.relay_event WHERE tenant_id=NEW.tenant_id AND sender_device=NEW.sender_device AND received_at>clock_timestamp()-interval '1 minute')>=60 THEN
  RAISE EXCEPTION 'relay message quota exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.relay_check_insert() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.relay_check_insert() TO CURRENT_USER;

-- Retain the existing audit contract and add a metadata-only relay branch.
-- Ciphertext/wrapped keys/public keys are not duplicated into audit JSON.
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
 IF TG_TABLE_NAME IN ('relay_device_key','relay_epoch','relay_key_wrap','relay_event') THEN
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
 FOREACH t IN ARRAY ARRAY['relay_device_key','relay_epoch','relay_key_wrap','relay_event'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
REVOKE ALL ON public.relay_device_key,public.relay_epoch,public.relay_key_wrap,public.relay_event FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.relay_device_key,public.relay_epoch,public.relay_key_wrap,public.relay_event TO rebatehq_app;

CREATE POLICY relay_device_key_select ON public.relay_device_key FOR SELECT TO rebatehq_app USING(public.relay_allowed(tenant_id,false));
CREATE POLICY relay_device_key_insert ON public.relay_device_key FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,false) AND user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=relay_device_key.tenant_id AND d.id=relay_device_key.id AND d.user_id=auth.uid() AND d.status='active'));
CREATE POLICY relay_epoch_select ON public.relay_epoch FOR SELECT TO rebatehq_app USING(public.relay_allowed(tenant_id,false));
CREATE POLICY relay_epoch_insert ON public.relay_epoch FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,true) AND signer_user=auth.uid() AND EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=relay_epoch.tenant_id AND d.id=relay_epoch.signer_device AND d.user_id=auth.uid() AND d.status='active'));
CREATE POLICY relay_key_wrap_select ON public.relay_key_wrap FOR SELECT TO rebatehq_app USING(public.relay_allowed(tenant_id,false));
CREATE POLICY relay_key_wrap_insert ON public.relay_key_wrap FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,true) AND EXISTS(SELECT 1 FROM public.relay_epoch e JOIN public.licence_device d ON d.tenant_id=e.tenant_id AND d.id=e.signer_device AND d.user_id=e.signer_user WHERE e.tenant_id=relay_key_wrap.tenant_id AND e.id=relay_key_wrap.epoch_id AND e.signer_user=auth.uid() AND d.status='active' AND relay_key_wrap.recipient_device=ANY(e.device_ids)));
CREATE POLICY relay_event_select ON public.relay_event FOR SELECT TO rebatehq_app USING(public.relay_allowed(tenant_id,false));
CREATE POLICY relay_event_insert ON public.relay_event FOR INSERT TO rebatehq_app WITH CHECK(public.relay_allowed(tenant_id,false) AND sender_user=auth.uid() AND EXISTS(SELECT 1 FROM public.licence_device d WHERE d.tenant_id=relay_event.tenant_id AND d.id=relay_event.sender_device AND d.user_id=auth.uid() AND d.status='active'));

CREATE TRIGGER relay_device_key_validate BEFORE INSERT ON public.relay_device_key FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_epoch_validate BEFORE INSERT ON public.relay_epoch FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_key_wrap_validate BEFORE INSERT ON public.relay_key_wrap FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_event_validate BEFORE INSERT ON public.relay_event FOR EACH ROW EXECUTE FUNCTION public.relay_check_insert();
CREATE TRIGGER relay_device_key_audit_row AFTER INSERT ON public.relay_device_key FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER relay_epoch_audit_row AFTER INSERT ON public.relay_epoch FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER relay_key_wrap_audit_row AFTER INSERT ON public.relay_key_wrap FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER relay_event_audit_row AFTER INSERT ON public.relay_event FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
COMMIT;
