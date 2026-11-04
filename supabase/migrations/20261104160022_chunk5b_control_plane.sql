BEGIN;

-- Global issuer material is not tenant business data. The nullable tenant_id
-- explicitly denotes global scope; no app/anon/authenticated role can read it.
CREATE SCHEMA rebatehq_private;
REVOKE ALL ON SCHEMA rebatehq_private FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
CREATE TABLE rebatehq_private.actor_key (
  id text PRIMARY KEY CHECK(id='actor-v1'),
  tenant_id uuid CHECK(tenant_id IS NULL),
  secret bytea NOT NULL CHECK(octet_length(secret)=32)
);
ALTER TABLE rebatehq_private.actor_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.actor_key FORCE ROW LEVEL SECURITY;
REVOKE ALL ON rebatehq_private.actor_key FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
CREATE SEQUENCE rebatehq_private.login_budget AS bigint START 1;
REVOKE ALL ON SEQUENCE rebatehq_private.login_budget FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;

CREATE FUNCTION public.verified_request_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE body text; mac text; key_bytes bytea; claims jsonb; actor uuid;
BEGIN
  -- Operator seeds/restores can write without pretending to be an end user.
  IF COALESCE(current_setting('role',true),'none') IN ('none','') AND EXISTS
    (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN auth.uid(); END IF;
  body:=current_setting('app.identity_payload',true); mac:=current_setting('app.identity_signature',true);
  IF COALESCE(body,'')='' AND auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF length(COALESCE(body,''))>2048 OR COALESCE(mac,'')!~'^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'verified request identity required' USING ERRCODE='42501'; END IF;
  SELECT secret INTO key_bytes FROM rebatehq_private.actor_key WHERE id='actor-v1';
  IF key_bytes IS NULL OR extensions.digest(decode(mac,'hex'),'sha256') IS DISTINCT FROM
    extensions.digest(extensions.hmac(convert_to(body,'UTF8'),key_bytes,'sha256'),'sha256') THEN
    RAISE EXCEPTION 'invalid request identity signature' USING ERRCODE='42501'; END IF;
  claims:=body::jsonb;
  IF NOT claims ?& ARRAY['sub','actor','pid','tx','exp','nonce'] THEN RAISE EXCEPTION 'incomplete identity' USING ERRCODE='42501'; END IF;
  IF (claims->>'pid')::integer<>pg_backend_pid() OR claims->>'tx'<>txid_current()::text
    OR (claims->>'exp')::bigint<extract(epoch FROM clock_timestamp())
    OR (claims->>'exp')::bigint>extract(epoch FROM clock_timestamp())+600
    OR NULLIF(claims->>'sub','')::uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'request identity is stale or has a different subject' USING ERRCODE='42501'; END IF;
  actor:=NULLIF(claims->>'actor','')::uuid;
  IF auth.uid() IS NOT NULL AND actor IS NULL THEN RAISE EXCEPTION 'actor required' USING ERRCODE='42501'; END IF;
  RETURN actor;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid request identity' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.verified_request_actor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verified_request_actor() TO rebatehq_app;

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
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,before,after,ip,user_agent)
  VALUES(tid,actor,TG_TABLE_NAME||'.'||lower(TG_OP),TG_TABLE_NAME,eid,b,a,
    NULLIF(current_setting('app.client_ip',true),'')::inet,left(current_setting('app.user_agent',true),1000));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.audit_row_change() TO CURRENT_USER;
ALTER POLICY audit_log_append ON public.audit_log WITH CHECK
 (tenant_id IS NOT NULL AND actor_id=public.verified_request_actor() AND public.is_tenant_member(tenant_id));

CREATE FUNCTION public.append_control_audit(p_tenant uuid,p_action text,p_entity text,p_id text,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=public.verified_request_actor();
BEGIN
  IF actor IS NULL OR NOT public.is_tenant_member(p_tenant) THEN RAISE EXCEPTION 'verified member required' USING ERRCODE='42501'; END IF;
  IF p_action='auth.login_failed' OR length(p_action)>100 OR length(p_entity)>100 OR length(COALESCE(p_id,''))>200 THEN RAISE EXCEPTION 'invalid audit event' USING ERRCODE='22023'; END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,before,after)
  VALUES(p_tenant,actor,p_action,p_entity,p_id,p_before,p_after);
END $$;
REVOKE ALL ON FUNCTION public.append_control_audit(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.append_control_audit(uuid,text,text,text,jsonb,jsonb) TO rebatehq_app;

CREATE FUNCTION public.audit_actor_key_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,after)
    VALUES(NULL,NULL,'auth.actor_key_rotated','auth_key',jsonb_build_object('operation',TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_actor_key_change() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.audit_actor_key_change() TO CURRENT_USER;
CREATE TRIGGER actor_key_audit_row AFTER INSERT OR UPDATE OR DELETE ON rebatehq_private.actor_key
 FOR EACH ROW EXECUTE FUNCTION public.audit_actor_key_change();

CREATE OR REPLACE FUNCTION public.record_failed_login(p_email text,p_ip text,p_user_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE email_hash text; address inet; bucket bigint; ticket bigint; last_ticket bigint;
BEGIN
  IF p_email IS NULL OR octet_length(p_email)>320 OR octet_length(COALESCE(p_ip,''))>45
    OR octet_length(COALESCE(p_user_agent,''))>1000 THEN RAISE EXCEPTION 'failed-login input exceeds limits' USING ERRCODE='22023'; END IF;
  email_hash:=encode(extensions.digest(lower(trim(p_email)),'sha256'),'hex');
  BEGIN address:=NULLIF(p_ip,'')::inet; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid address' USING ERRCODE='22023'; END;
  -- Global budget is deliberately nontransactional: ROLLBACK cannot erase attempts.
  PERFORM pg_advisory_xact_lock(5140401);
  bucket:=floor(extract(epoch FROM clock_timestamp())/600)::bigint*10000;
  SELECT last_value INTO last_ticket FROM rebatehq_private.login_budget;
  IF last_ticket<bucket THEN PERFORM setval('rebatehq_private.login_budget',bucket,true); END IF;
  IF last_ticket>=bucket+1000 THEN RAISE EXCEPTION 'failed-login database rate limit' USING ERRCODE='54000'; END IF;
  ticket:=nextval('rebatehq_private.login_budget');
  IF ticket-bucket>1000 THEN RAISE EXCEPTION 'failed-login database rate limit' USING ERRCODE='54000'; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE action='auth.login_failed' AND created_at>clock_timestamp()-interval '10 minutes'
      AND (entity_id=email_hash OR (address IS NOT NULL AND ip=address)))>=8 THEN
    RAISE EXCEPTION 'failed-login database rate limit' USING ERRCODE='54000'; END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,after,ip,user_agent)
   VALUES(NULL,NULL,'auth.login_failed','auth_user',email_hash,jsonb_build_object('email_hash',email_hash),address,p_user_agent);
END $$;
REVOKE ALL ON FUNCTION public.record_failed_login(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_failed_login(text,text,text) TO rebatehq_app;

CREATE TABLE public.workspace_licence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenant(tenant_id),
  tier text NOT NULL CHECK(tier IN ('starter','professional','scale')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  valid_until timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.licence_seat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.workspace_licence(tenant_id),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,user_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES public.membership(tenant_id,user_id)
);
CREATE TABLE public.licence_location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.workspace_licence(tenant_id),
  name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  erp_profile text NOT NULL CHECK(erp_profile IN ('generic','netsuite','p21','infor','bc','quickbooks')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name)
);
CREATE TABLE public.licence_device (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.workspace_licence(tenant_id),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,user_id) REFERENCES public.licence_seat(tenant_id,user_id) ON DELETE CASCADE
);

CREATE FUNCTION public.control_member(p_tenant uuid,p_owner boolean DEFAULT false) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.verified_request_actor() IS NOT NULL AND
 CASE WHEN p_owner THEN public.is_tenant_role(p_tenant,ARRAY['owner']) ELSE public.is_tenant_member(p_tenant) END
$$;
REVOKE ALL ON FUNCTION public.control_member(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.control_member(uuid,boolean) TO rebatehq_app;

CREATE FUNCTION public.enforce_licence_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE licence public.workspace_licence%ROWTYPE; cap integer; count_used integer;
BEGIN
  -- Let WITH CHECK reject foreign rows, before privileged cap lookups or locks.
  IF current_setting('role',true)='rebatehq_app' AND NOT public.control_member(NEW.tenant_id,TG_TABLE_NAME<>'licence_device') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.id<>OLD.id THEN RAISE EXCEPTION 'licence row identity is immutable' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME IN ('licence_seat','licence_device') THEN
   IF TG_OP='UPDATE' AND NEW.user_id<>OLD.user_id THEN RAISE EXCEPTION 'seat/device user is immutable' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT * INTO licence FROM public.workspace_licence WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  IF licence.tenant_id IS NULL OR licence.status<>'active' OR licence.valid_until<=now() THEN RAISE EXCEPTION 'Upgrade or renew the workspace licence' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='licence_seat' AND TG_OP='INSERT' THEN
    cap:=CASE licence.tier WHEN 'starter' THEN 1 WHEN 'professional' THEN 5 ELSE 15 END;
    SELECT count(*) INTO count_used FROM public.licence_seat WHERE tenant_id=NEW.tenant_id;
    IF count_used>=cap THEN RAISE EXCEPTION 'Seat limit reached; upgrade the workspace licence' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.membership WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND status='active') THEN RAISE EXCEPTION 'Active workspace member required' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='licence_location' AND TG_OP='INSERT' AND licence.tier='starter' THEN
    IF EXISTS(SELECT 1 FROM public.licence_location WHERE tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Location/ERP limit reached; upgrade to Professional' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='licence_device' THEN
    IF TG_OP='INSERT' THEN
      NEW.status:=CASE WHEN public.is_tenant_role(NEW.tenant_id,ARRAY['owner']) AND NEW.user_id=auth.uid()
        AND NOT EXISTS(SELECT 1 FROM public.licence_device WHERE tenant_id=NEW.tenant_id) THEN 'active' ELSE 'pending' END;
    ELSIF OLD.status='revoked' AND NEW.status<>'revoked' THEN RAISE EXCEPTION 'Revoked device cannot be reactivated' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_licence_limits() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.enforce_licence_limits() TO CURRENT_USER;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspace_licence','licence_seat','licence_location','licence_device'] LOOP
  EXECUTE format('CREATE INDEX %I ON public.%I(tenant_id)',t||'_tenant_idx',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',t||'_audit_row',t);
 END LOOP;
END $$;
GRANT SELECT ON workspace_licence,licence_seat,licence_location,licence_device TO rebatehq_app;
GRANT INSERT,DELETE ON licence_seat,licence_location TO rebatehq_app;
GRANT UPDATE ON licence_location,licence_device TO rebatehq_app;
GRANT INSERT ON licence_device TO rebatehq_app;
CREATE POLICY workspace_licence_select ON workspace_licence FOR SELECT TO rebatehq_app USING(public.control_member(tenant_id,false));
CREATE POLICY licence_seat_select ON licence_seat FOR SELECT TO rebatehq_app USING(public.control_member(tenant_id,false));
CREATE POLICY licence_seat_insert ON licence_seat FOR INSERT TO rebatehq_app WITH CHECK(public.control_member(tenant_id,true));
CREATE POLICY licence_seat_delete ON licence_seat FOR DELETE TO rebatehq_app USING(public.control_member(tenant_id,true));
CREATE POLICY licence_location_select ON licence_location FOR SELECT TO rebatehq_app USING(public.control_member(tenant_id,false));
CREATE POLICY licence_location_insert ON licence_location FOR INSERT TO rebatehq_app WITH CHECK(public.control_member(tenant_id,true));
CREATE POLICY licence_location_update ON licence_location FOR UPDATE TO rebatehq_app USING(public.control_member(tenant_id,true)) WITH CHECK(public.control_member(tenant_id,true));
CREATE POLICY licence_location_delete ON licence_location FOR DELETE TO rebatehq_app USING(public.control_member(tenant_id,true));
CREATE POLICY licence_device_select ON licence_device FOR SELECT TO rebatehq_app USING(public.control_member(tenant_id,false) AND (user_id=auth.uid() OR public.is_tenant_role(tenant_id,ARRAY['owner'])));
CREATE POLICY licence_device_insert ON licence_device FOR INSERT TO rebatehq_app WITH CHECK(public.control_member(tenant_id,false) AND user_id=auth.uid());
CREATE POLICY licence_device_update ON licence_device FOR UPDATE TO rebatehq_app USING(public.control_member(tenant_id,true)) WITH CHECK(public.control_member(tenant_id,true));
CREATE TRIGGER licence_seat_limits BEFORE INSERT OR UPDATE ON licence_seat FOR EACH ROW EXECUTE FUNCTION public.enforce_licence_limits();
CREATE TRIGGER licence_location_limits BEFORE INSERT OR UPDATE ON licence_location FOR EACH ROW EXECUTE FUNCTION public.enforce_licence_limits();
CREATE TRIGGER licence_device_limits BEFORE INSERT OR UPDATE ON licence_device FOR EACH ROW EXECUTE FUNCTION public.enforce_licence_limits();

CREATE FUNCTION public.invite_licence_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.workspace_licence%ROWTYPE; used integer; cap integer;
BEGIN
 IF COALESCE(current_setting('role',true),'none') IN ('none','') AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW; END IF;
 SELECT * INTO l FROM public.workspace_licence WHERE tenant_id=NEW.tenant_id FOR UPDATE;
 IF l.tenant_id IS NULL OR l.status<>'active' OR l.valid_until<=now() THEN RAISE EXCEPTION 'An active licence is required to invite users' USING ERRCODE='23514'; END IF;
 cap:=CASE l.tier WHEN 'starter' THEN 1 WHEN 'professional' THEN 5 ELSE 15 END;
 SELECT (SELECT count(*) FROM public.licence_seat WHERE tenant_id=NEW.tenant_id)+(SELECT count(*) FROM public.invite WHERE tenant_id=NEW.tenant_id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) INTO used;
 IF used>=cap THEN RAISE EXCEPTION 'Invitation seat limit reached; upgrade your licence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.invite_licence_limit() FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
GRANT EXECUTE ON FUNCTION public.invite_licence_limit() TO CURRENT_USER;
CREATE TRIGGER invite_licence_limit BEFORE INSERT ON invite FOR EACH ROW EXECUTE FUNCTION public.invite_licence_limit();

-- Workspace bootstrap is control-plane only; it no longer inserts margin_policy.
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tid uuid;
BEGIN
 IF public.verified_request_actor() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'verified sign-in required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.tenant(name,created_by) VALUES(trim(p_name),auth.uid()) RETURNING tenant_id INTO tid;
 INSERT INTO public.membership(tenant_id,user_id,email,role) SELECT tid,auth.uid(),lower(email),'owner' FROM auth.users WHERE id=auth.uid();
 RETURN tid;
END $$;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text) TO rebatehq_app;

CREATE OR REPLACE FUNCTION public.accept_tenant_invite(p_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inv public.invite%ROWTYPE; email_address text;
BEGIN
 IF public.verified_request_actor() IS NULL THEN RAISE EXCEPTION 'verified sign-in required' USING ERRCODE='42501'; END IF;
 SELECT lower(email) INTO email_address FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 SELECT * INTO inv FROM public.invite WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
 IF inv.id IS NULL OR inv.email<>email_address OR email_address IS NULL THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.workspace_licence WHERE tenant_id=inv.tenant_id FOR UPDATE;
 INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES(inv.tenant_id,auth.uid(),email_address,inv.role)
   ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='active',role=EXCLUDED.role,email=EXCLUDED.email;
 INSERT INTO public.licence_seat(tenant_id,user_id) VALUES(inv.tenant_id,auth.uid());
 UPDATE public.invite SET accepted_at=now() WHERE id=inv.id;
 RETURN inv.tenant_id;
END $$;
REVOKE ALL ON FUNCTION public.accept_tenant_invite(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO rebatehq_app;
COMMIT;
