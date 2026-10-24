BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE ROLE margindesk_app NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  ALTER ROLE margindesk_app NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
END $$;
GRANT USAGE ON SCHEMA public TO margindesk_app;
GRANT USAGE ON SCHEMA auth TO margindesk_app;
GRANT EXECUTE ON FUNCTION auth.uid() TO margindesk_app;

-- The tenant root uses tenant_id as its primary key; every other public table
-- carries a NOT NULL tenant_id and a tenant-scoped index.
CREATE TABLE tenant (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  currency char(3) NOT NULL DEFAULT 'USD',
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE membership (
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','manager','analyst','rep')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id)
);

CREATE TABLE invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email=lower(email)),
  role text NOT NULL CHECK (role IN ('manager','analyst','rep')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  account_no text NOT NULL,
  name text NOT NULL,
  region text,
  tier text,
  email text,
  phone text,
  assigned_rep_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,account_no)
);

CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  supplier text,
  uom text,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  freight_cost numeric(18,4) NOT NULL DEFAULT 0 CHECK (freight_cost >= 0),
  payment_terms_cost numeric(18,4) NOT NULL DEFAULT 0 CHECK (payment_terms_cost >= 0),
  list_price numeric(18,4) NOT NULL DEFAULT 0 CHECK (list_price >= 0),
  tier_prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,sku)
);

CREATE TABLE price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  name text NOT NULL,
  customer_tier text,
  currency char(3) NOT NULL DEFAULT 'USD',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE TABLE price_list_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL,
  version_no integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','reverted')),
  source_name text,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,price_list_id,version_no),
  FOREIGN KEY (tenant_id,price_list_id) REFERENCES price_list(tenant_id,id)
);
CREATE TABLE price_list_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL,
  product_id uuid NOT NULL,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  version_id uuid,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,price_list_id) REFERENCES price_list(tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES product(tenant_id,id),
  FOREIGN KEY (tenant_id,version_id) REFERENCES price_list_version(tenant_id,id)
);

CREATE TABLE margin_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('global','category','customer_tier')),
  scope_key text NOT NULL DEFAULT '',
  target_margin_pct numeric(7,3) NOT NULL,
  floor_margin_pct numeric(7,3) NOT NULL,
  walkaway_margin_pct numeric(7,3) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (walkaway_margin_pct <= floor_margin_pct AND floor_margin_pct < target_margin_pct),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,scope_type,scope_key)
);

CREATE TABLE quote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL CHECK (status IN ('draft','pending_approval','approved','denied','sent','signed','expired')),
  currency char(3) NOT NULL DEFAULT 'USD',
  pocket_price numeric(18,4) NOT NULL DEFAULT 0,
  cogs_total numeric(18,4) NOT NULL DEFAULT 0,
  pocket_margin numeric(18,4) NOT NULL DEFAULT 0,
  margin_pct numeric(7,3) NOT NULL DEFAULT 0,
  margin_zone text NOT NULL CHECK (margin_zone IN ('green','yellow','red')),
  headroom numeric(18,4) NOT NULL DEFAULT 0,
  policy_version integer NOT NULL DEFAULT 1,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customer(tenant_id,id)
);
CREATE TABLE quote_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  quote_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  list_price numeric(18,4) NOT NULL,
  discount_pct numeric(7,3) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  off_invoice_rebate_pct numeric(7,3) NOT NULL DEFAULT 0 CHECK (off_invoice_rebate_pct BETWEEN 0 AND 100),
  freight numeric(18,4) NOT NULL DEFAULT 0,
  payment_terms_cost numeric(18,4) NOT NULL DEFAULT 0,
  accessory_amount numeric(18,4) NOT NULL DEFAULT 0,
  pocket_price numeric(18,4) NOT NULL,
  cogs_total numeric(18,4) NOT NULL,
  pocket_margin numeric(18,4) NOT NULL,
  margin_pct numeric(7,3) NOT NULL,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES quote(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,product_id) REFERENCES product(tenant_id,id)
);
CREATE TABLE approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  quote_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  decided_by uuid REFERENCES auth.users(id),
  status text NOT NULL CHECK (status IN ('pending','approved','denied')),
  decision_note text,
  margin_pct_at_decision numeric(7,3),
  policy_version integer,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,quote_id) REFERENCES quote(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE sales_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  source_id text NOT NULL,
  customer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  discount_pct numeric(7,3) NOT NULL DEFAULT 0,
  discount_approved boolean,
  off_invoice_rebate_pct numeric(7,3) NOT NULL DEFAULT 0,
  freight_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  payment_terms_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  month_key text NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,source_id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customer(tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES product(tenant_id,id)
);
CREATE TABLE rebate_agreement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id text NOT NULL,
  name text NOT NULL,
  rate_pct numeric(7,3) NOT NULL,
  threshold_amount numeric(18,2) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  eligible_skus text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_start <= period_end), UNIQUE (tenant_id,id)
);
CREATE TABLE rebate_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  eligible_spend numeric(18,2) NOT NULL DEFAULT 0,
  modeled_amount numeric(18,2) NOT NULL DEFAULT 0,
  recorded_credits numeric(18,2) NOT NULL DEFAULT 0,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,agreement_id) REFERENCES rebate_agreement(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  invoice_date date NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  source_ref text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES customer(tenant_id,id)
);
CREATE TABLE invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity numeric(18,4) NOT NULL,
  net_sales numeric(18,4) NOT NULL,
  discount_amount numeric(18,4) NOT NULL DEFAULT 0,
  rebate_amount numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,invoice_id) REFERENCES invoice(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,product_id) REFERENCES product(tenant_id,id)
);
CREATE TABLE cost_component (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  quote_line_id uuid,
  invoice_line_id uuid,
  sales_order_id uuid,
  component_type text NOT NULL CHECK (component_type IN ('freight','payment_terms','off_invoice_rebate','discount','other')),
  amount numeric(18,4) NOT NULL,
  source_ref text,
  CHECK (num_nonnulls(quote_line_id,invoice_line_id,sales_order_id)=1), UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,quote_line_id) REFERENCES quote_line(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,invoice_line_id) REFERENCES invoice_line(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,sales_order_id) REFERENCES sales_order(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE supplier_credit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  credit_date date NOT NULL,
  amount numeric(18,2) NOT NULL,
  reference text,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id,id)
);
CREATE TABLE alert (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('info','review','urgent')),
  message text NOT NULL,
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (tenant_id,id)
);
CREATE TABLE margin_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('company','product','customer')),
  entity_id text NOT NULL,
  period_month date NOT NULL,
  order_count integer NOT NULL CHECK (order_count >= 0),
  pocket_revenue numeric(18,4) NOT NULL,
  pocket_margin numeric(18,4) NOT NULL,
  margin_pct numeric(7,3) NOT NULL,
  engine_version text NOT NULL DEFAULT 'phase0.1',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,entity_type,entity_id,period_month)
);
CREATE TABLE connector_secret (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  provider text NOT NULL,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  auth_tag text NOT NULL,
  key_version text NOT NULL DEFAULT '1',
  created_by uuid REFERENCES auth.users(id),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,provider)
);
CREATE TABLE import_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(tenant_id) ON DELETE CASCADE,
  import_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('dry_run','committed','failed')),
  source_name text,
  source_hash text,
  accepted_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpers are SECURITY DEFINER only so policy checks can read membership without
-- exposing that table or causing recursive RLS. Fixed search_path prevents hijacking.
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m JOIN public.tenant t USING (tenant_id)
    WHERE m.tenant_id=p_tenant_id AND m.user_id=auth.uid() AND m.status='active' AND t.deleted_at IS NULL
  )
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_role(p_tenant_id uuid, p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.membership m JOIN public.tenant t USING (tenant_id)
    WHERE m.tenant_id=p_tenant_id AND m.user_id=auth.uid() AND m.status='active'
      AND t.deleted_at IS NULL AND m.role=ANY(p_roles)
  )
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_role_any_status(p_tenant_id uuid, p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.membership m WHERE m.tenant_id=p_tenant_id AND m.user_id=auth.uid() AND m.status='active' AND m.role=ANY(p_roles))
$$;

-- Audit all business mutations in the same transaction. Secrets are excluded from snapshots.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_tenant uuid; v_id text; v_actor uuid;
        v_ip text; v_agent text;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after := to_jsonb(NEW); END IF;
  v_tenant := COALESCE((v_after->>'tenant_id')::uuid,(v_before->>'tenant_id')::uuid);
  v_id := COALESCE(v_after->>'id',v_before->>'id',v_after->>'user_id',v_before->>'user_id',v_tenant::text);
  v_actor := COALESCE(NULLIF(current_setting('app.real_actor_id',true),'')::uuid,auth.uid());
  v_ip := current_setting('app.client_ip',true);
  v_agent := current_setting('app.user_agent',true);
  IF TG_TABLE_NAME='connector_secret' THEN
    v_before := v_before - 'ciphertext' - 'nonce' - 'auth_tag';
    v_after := v_after - 'ciphertext' - 'nonce' - 'auth_tag';
  END IF;
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,before,after,ip,user_agent)
  VALUES (v_tenant,v_actor,TG_TABLE_NAME||'.'||lower(TG_OP),TG_TABLE_NAME,v_id,v_before,v_after,NULLIF(v_ip,'')::inet,left(v_agent,1000));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','membership','invite','customer','product','price_list','price_list_version','price_list_item','margin_policy','quote','quote_line','approval','sales_order','rebate_agreement','rebate_progress','invoice','invoice_line','cost_component','supplier_credit','alert','margin_snapshot','connector_secret','import_job','audit_log'] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(tenant_id)',t||'_tenant_idx',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    IF t <> 'audit_log' THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',t||'_audit_row',t);
    END IF;
  END LOOP;
END $$;

-- Application role policies. Browser roles receive no direct table grants; the
-- Next.js server uses a dedicated login that can SET ROLE margindesk_app.
DO $$
DECLARE t text; sel text; ins text; upd text; del text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','membership','invite','customer','product','price_list','price_list_version','price_list_item','margin_policy','quote','quote_line','approval','sales_order','rebate_agreement','rebate_progress','invoice','invoice_line','cost_component','supplier_credit','alert','margin_snapshot','connector_secret','import_job','audit_log'] LOOP
    sel := 'public.is_tenant_member(tenant_id)';
    IF t='membership' THEN sel := '(user_id=auth.uid() OR public.is_tenant_role(tenant_id,ARRAY[''owner'']))'; END IF;
    IF t='invite' THEN sel := 'public.is_tenant_role(tenant_id,ARRAY[''owner''])'; END IF;
    IF t='customer' THEN sel := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'']) OR (public.is_tenant_role(tenant_id,ARRAY[''rep'']) AND assigned_rep_id=auth.uid()))'; END IF;
    IF t='quote' THEN sel := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'']) OR (public.is_tenant_role(tenant_id,ARRAY[''rep'']) AND created_by=auth.uid()))'; END IF;
    IF t='quote_line' THEN sel := 'EXISTS (SELECT 1 FROM public.quote q WHERE q.tenant_id=quote_line.tenant_id AND q.id=quote_line.quote_id AND (public.is_tenant_role(q.tenant_id,ARRAY[''owner'',''manager'',''analyst'']) OR q.created_by=auth.uid()))'; END IF;
    IF t='approval' THEN sel := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'']) OR requested_by=auth.uid())'; END IF;
    IF t='sales_order' THEN sel := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'']) OR EXISTS (SELECT 1 FROM public.customer c WHERE c.tenant_id=sales_order.tenant_id AND c.id=sales_order.customer_id AND c.assigned_rep_id=auth.uid()))'; END IF;
    IF t IN ('rebate_agreement','rebate_progress','invoice','invoice_line','cost_component','supplier_credit','margin_snapshot','connector_secret','import_job') THEN sel := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst''])'; END IF;
    IF t='audit_log' THEN sel := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])'; END IF;
    IF t='connector_secret' THEN sel := 'public.is_tenant_role(tenant_id,ARRAY[''owner''])'; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO margindesk_app USING (%s)',t||'_select',t,sel);

    ins := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])';
    upd := ins; del := ins;
    IF t IN ('product','price_list','price_list_item','price_list_version','sales_order','invoice','invoice_line','supplier_credit','import_job') THEN
      ins := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst''])';
      upd := ins; del := ins;
    END IF;
    IF t='price_list_item' THEN
      ins := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])';
      upd := ins; del := ins;
    END IF;
    IF t='price_list_version' THEN
      ins := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'']) OR (status=''draft'' AND public.is_tenant_role(tenant_id,ARRAY[''analyst''])))';
      upd := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'']) OR (status=''draft'' AND public.is_tenant_role(tenant_id,ARRAY[''analyst''])))';
      del := '(public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'']) OR (status=''draft'' AND public.is_tenant_role(tenant_id,ARRAY[''analyst''])))';
    END IF;
    IF t='sales_order' THEN ins:='public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst''])'; upd:=ins; del:=ins; END IF;
    IF t='quote' THEN
      ins := '(created_by=auth.uid() AND public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'',''rep'']))';
      upd := '(created_by=auth.uid() OR public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'']))';
      del := '(created_by=auth.uid() OR public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'']))';
    END IF;
    IF t='quote_line' THEN
      ins := 'EXISTS (SELECT 1 FROM public.quote q WHERE q.tenant_id=quote_line.tenant_id AND q.id=quote_line.quote_id AND q.created_by=auth.uid() AND q.status IN (''draft'',''pending_approval'',''approved''))';
      upd := 'EXISTS (SELECT 1 FROM public.quote q WHERE q.tenant_id=quote_line.tenant_id AND q.id=quote_line.quote_id AND q.created_by=auth.uid() AND q.status IN (''draft'',''pending_approval''))';
      del := upd;
    END IF;
    IF t='approval' THEN
      ins := 'requested_by=auth.uid() AND public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst'',''rep''])';
      upd := 'requested_by<>auth.uid() AND public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])';
      del := 'public.is_tenant_role(tenant_id,ARRAY[''owner''])';
    END IF;
    IF t='margin_policy' THEN ins := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])'; upd:=ins; del:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; END IF;
    IF t IN ('rebate_agreement','rebate_progress','alert') THEN
      ins := 'public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager''])'; upd:=ins; del:='public.is_tenant_role(tenant_id,ARRAY[''owner''])';
    END IF;
    IF t='membership' THEN ins:='false'; upd:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; del:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; END IF;
    IF t='invite' THEN ins:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; upd:=ins; del:=ins; END IF;
    IF t='tenant' THEN ins:='false'; upd:='(public.is_tenant_role(tenant_id,ARRAY[''owner'']) OR (deleted_at IS NOT NULL AND public.is_tenant_role_any_status(tenant_id,ARRAY[''owner''])))'; del:='false'; END IF;
    IF t IN ('cost_component','margin_snapshot') THEN ins:='public.is_tenant_role(tenant_id,ARRAY[''owner'',''manager'',''analyst''])'; upd:=ins; del:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; END IF;
    IF t='connector_secret' THEN ins:='public.is_tenant_role(tenant_id,ARRAY[''owner''])'; upd:=ins; del:=ins; END IF;
    IF t <> 'audit_log' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO margindesk_app WITH CHECK (%s)',t||'_insert',t,ins);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO margindesk_app USING (%s) WITH CHECK (%s)',t||'_update',t,upd,upd);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO margindesk_app USING (%s)',t||'_delete',t,del);
    END IF;
  END LOOP;
END $$;
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY audit_log_append ON audit_log FOR INSERT TO PUBLIC WITH CHECK ((tenant_id IS NOT NULL AND actor_id=COALESCE(NULLIF(current_setting('app.real_actor_id',true),'')::uuid,auth.uid()) AND public.is_tenant_member(tenant_id)) OR (tenant_id IS NULL AND actor_id IS NULL AND action='auth.login_failed'));

-- Cost and margin columns are not exposed through PostgREST. The web server
-- queries them with margindesk_app after verifying membership and role.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
GRANT SELECT ON tenant,membership,invite,customer,product,price_list,price_list_version,price_list_item,margin_policy,quote,quote_line,approval,sales_order,rebate_agreement,rebate_progress,invoice,invoice_line,cost_component,supplier_credit,alert,margin_snapshot,connector_secret,import_job,audit_log TO margindesk_app;
GRANT INSERT,UPDATE,DELETE ON tenant,membership,invite,customer,product,price_list,price_list_version,price_list_item,margin_policy,quote,quote_line,approval,sales_order,rebate_agreement,rebate_progress,invoice,invoice_line,cost_component,supplier_credit,alert,margin_snapshot,connector_secret,import_job TO margindesk_app;
GRANT INSERT ON audit_log TO margindesk_app;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_log FROM margindesk_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid),public.is_tenant_role(uuid,text[]) TO margindesk_app;

CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'verified sign-in required' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.tenant(name,created_by) VALUES (trim(p_name),auth.uid()) RETURNING tenant_id INTO v_tenant;
  INSERT INTO public.membership(tenant_id,user_id,email,role) SELECT v_tenant,auth.uid(),lower(email),'owner' FROM auth.users WHERE id=auth.uid();
  INSERT INTO public.margin_policy(tenant_id,scope_type,scope_key,target_margin_pct,floor_margin_pct,walkaway_margin_pct,updated_by)
    VALUES(v_tenant,'global','',30,22,18,auth.uid());
  RETURN v_tenant;
END $$;
CREATE OR REPLACE FUNCTION public.accept_tenant_invite(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_invite public.invite%ROWTYPE; v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign-in required' USING ERRCODE='42501'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'verified email required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_invite FROM public.invite
    WHERE token_hash=encode(digest(p_token,'sha256'),'hex') AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()
    FOR UPDATE;
  IF NOT FOUND OR v_invite.email<>v_email THEN RAISE EXCEPTION 'invite is invalid, expired, or for another email' USING ERRCODE='42501'; END IF;
  INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES(v_invite.tenant_id,auth.uid(),v_email,v_invite.role)
    ON CONFLICT (tenant_id,user_id) DO UPDATE SET email=EXCLUDED.email,role=EXCLUDED.role,status='active';
  UPDATE public.invite SET accepted_at=now() WHERE id=v_invite.id;
  RETURN v_invite.tenant_id;
END $$;
CREATE OR REPLACE FUNCTION public.record_failed_login(p_email text,p_ip text,p_user_agent text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_hash text := encode(digest(lower(trim(p_email)),'sha256'),'hex');
BEGIN
  INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,after,ip,user_agent)
  SELECT m.tenant_id,u.id,'auth.login_failed','auth_user',v_hash,jsonb_build_object('email_hash',v_hash),NULLIF(p_ip,'')::inet,left(p_user_agent,1000)
  FROM auth.users u LEFT JOIN public.membership m ON m.user_id=u.id AND m.status='active'
  WHERE lower(u.email)=lower(trim(p_email));
  IF NOT FOUND THEN
    INSERT INTO public.audit_log(tenant_id,actor_id,action,entity_type,entity_id,after,ip,user_agent)
    VALUES(NULL,NULL,'auth.login_failed','auth_user',v_hash,jsonb_build_object('email_hash',v_hash),NULLIF(p_ip,'')::inet,left(p_user_agent,1000));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_tenant_with_owner(text),public.accept_tenant_invite(text),public.record_failed_login(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text),public.accept_tenant_invite(text),public.record_failed_login(text,text,text) TO margindesk_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid),public.is_tenant_role(uuid,text[]),public.is_tenant_role_any_status(uuid,text[]),public.create_tenant_with_owner(text),public.accept_tenant_invite(text),public.record_failed_login(text,text,text) TO margindesk_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','membership','invite','customer','product','price_list','price_list_version','price_list_item','margin_policy','quote','quote_line','approval','sales_order','rebate_agreement','rebate_progress','invoice','invoice_line','cost_component','supplier_credit','alert','margin_snapshot','connector_secret','import_job','audit_log'] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(tenant_id)',t||'_tenant_scope_idx',t);
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_tables p JOIN pg_class c ON c.relname=p.tablename JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE p.schemaname='public' AND n.nspname='public' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns col WHERE col.table_schema='public' AND col.table_name=p.tablename AND col.column_name='tenant_id'
    ))
  ) THEN RAISE EXCEPTION 'Phase 1 schema check failed: every public table must have tenant_id and RLS'; END IF;
END $$;
COMMIT;
