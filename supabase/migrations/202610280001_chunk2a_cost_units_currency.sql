-- Chunk 2A: effective-dated costs, UOM conversion, FX, data-quality issues,
-- and transaction currency/UOM metadata.
-- Rollback: export cost_history first (the product trigger's changes are the
-- authoritative cost history), then drop the new triggers/functions/tables in
-- reverse dependency order, remove the added columns/constraints from existing
-- tables, and restore the original product.unit_cost-only behavior. This is a
-- destructive rollback for recorded history and must not be run after writes
-- without preserving that data.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.tenant
  ADD COLUMN default_cost_basis text NOT NULL DEFAULT 'standard',
  ADD CONSTRAINT tenant_default_cost_basis_check CHECK (default_cost_basis IN ('standard','average','landed')),
  ADD CONSTRAINT tenant_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');

CREATE TABLE public.uom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code=upper(trim(code)) AND length(code) BETWEEN 1 AND 16),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,code)
);
CREATE INDEX uom_tenant_idx ON public.uom(tenant_id);

CREATE TABLE public.cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  cost numeric(18,4) NOT NULL CHECK (cost >= 0),
  basis text NOT NULL CHECK (basis IN ('standard','average','landed')),
  effective_from date NOT NULL,
  effective_to date,
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 120),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  currency char(3) NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to),
  CHECK (currency ~ '^[A-Z]{3}$'),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES public.product(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX cost_history_tenant_idx ON public.cost_history(tenant_id);
CREATE INDEX cost_history_product_basis_from_idx ON public.cost_history(tenant_id,product_id,basis,effective_from DESC);
ALTER TABLE public.cost_history ADD CONSTRAINT cost_history_no_overlapping_ranges
  EXCLUDE USING gist (tenant_id WITH =, product_id WITH =, basis WITH =,
    daterange(effective_from,effective_to,'[)') WITH &&);

CREATE TABLE public.uom_conversion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
  product_id uuid,
  from_uom_id uuid NOT NULL,
  to_uom_id uuid NOT NULL,
  factor numeric(20,10) NOT NULL CHECK (factor > 0),
  direction text NOT NULL CHECK (direction IN ('multiply','divide')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_uom_id <> to_uom_id),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,product_id) REFERENCES public.product(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,from_uom_id) REFERENCES public.uom(tenant_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,to_uom_id) REFERENCES public.uom(tenant_id,id) ON DELETE RESTRICT
);
CREATE INDEX uom_conversion_tenant_idx ON public.uom_conversion(tenant_id);
CREATE UNIQUE INDEX uom_conversion_tenant_pair_unique
  ON public.uom_conversion(tenant_id,from_uom_id,to_uom_id) WHERE product_id IS NULL;
CREATE UNIQUE INDEX uom_conversion_product_pair_unique
  ON public.uom_conversion(tenant_id,product_id,from_uom_id,to_uom_id) WHERE product_id IS NOT NULL;

CREATE TABLE public.fx_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
  rate_date date NOT NULL,
  from_currency char(3) NOT NULL CHECK (from_currency ~ '^[A-Z]{3}$'),
  to_currency char(3) NOT NULL CHECK (to_currency ~ '^[A-Z]{3}$'),
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,rate_date,from_currency,to_currency)
);
CREATE INDEX fx_rate_tenant_idx ON public.fx_rate(tenant_id);
CREATE INDEX fx_rate_lookup_idx ON public.fx_rate(tenant_id,from_currency,to_currency,rate_date DESC);

CREATE TABLE public.data_quality_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
  issue_code text NOT NULL CHECK (issue_code IN ('cost_history_gap','uom_conversion_missing','fx_rate_missing')),
  entity_type text NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 60),
  entity_id text NOT NULL CHECK (length(trim(entity_id)) BETWEEN 1 AND 160),
  occurred_on date NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id,id)
);
CREATE INDEX data_quality_issue_tenant_idx ON public.data_quality_issue(tenant_id);
CREATE INDEX data_quality_issue_open_idx ON public.data_quality_issue(tenant_id,issue_code,entity_type,entity_id,occurred_on) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX data_quality_issue_open_unique
  ON public.data_quality_issue(tenant_id,issue_code,entity_type,entity_id,occurred_on) WHERE resolved_at IS NULL;

-- The locked Phase 1 price-list item already has a surrogate UUID key and
-- effective dates. Keep that key, backfill legacy null starts, and reject any
-- overlapping prices for the same tenant/list/product.
-- Phase 1 only supported tenant currency in the UI. Its USD defaults were
-- placeholders, so existing transaction/catalog values inherit tenant currency.
UPDATE public.price_list pl SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=pl.tenant_id;
UPDATE public.quote q SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=q.tenant_id;
UPDATE public.invoice i SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=i.tenant_id;
UPDATE public.price_list_item SET effective_from=current_date WHERE effective_from IS NULL;
ALTER TABLE public.price_list_item ALTER COLUMN effective_from SET NOT NULL;
WITH next_start AS (
  SELECT id,lead(effective_from) OVER (
    PARTITION BY tenant_id,price_list_id,product_id ORDER BY effective_from,id
  ) AS following_start
  FROM public.price_list_item
)
UPDATE public.price_list_item i SET effective_to=n.following_start
FROM next_start n
WHERE i.id=n.id AND i.effective_to IS NULL AND n.following_start>i.effective_from;
DO $$
DECLARE v_overlap record;
BEGIN
  SELECT a.id AS first_id,b.id AS second_id,a.tenant_id,a.price_list_id,a.product_id
  INTO v_overlap
  FROM public.price_list_item a JOIN public.price_list_item b
    ON a.tenant_id=b.tenant_id AND a.price_list_id=b.price_list_id AND a.product_id=b.product_id AND a.id<b.id
   AND daterange(a.effective_from,a.effective_to,'[)') && daterange(b.effective_from,b.effective_to,'[)')
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'Cannot backfill overlapping price-list intervals for items % and % (tenant %, list %, product %)',v_overlap.first_id,v_overlap.second_id,v_overlap.tenant_id,v_overlap.price_list_id,v_overlap.product_id; END IF;
END $$;
ALTER TABLE public.price_list_item ADD CONSTRAINT price_list_item_valid_effective_range
  CHECK (effective_to IS NULL OR effective_from < effective_to);
ALTER TABLE public.price_list_item ADD CONSTRAINT price_list_item_no_overlapping_ranges
  EXCLUDE USING gist (tenant_id WITH =, price_list_id WITH =, product_id WITH =,
    daterange(effective_from,effective_to,'[)') WITH &&);

-- Create canonical UOM rows for existing product base units before adding the
-- tenant-scoped UOM foreign keys.
INSERT INTO public.uom(tenant_id,code,display_name)
SELECT DISTINCT p.tenant_id,upper(trim(p.uom)),upper(trim(p.uom))
FROM public.product p WHERE p.uom IS NOT NULL AND trim(p.uom)<>''
ON CONFLICT (tenant_id,code) DO NOTHING;

ALTER TABLE public.price_list_item ADD COLUMN currency char(3);
UPDATE public.price_list_item i SET currency=pl.currency
FROM public.price_list pl WHERE pl.tenant_id=i.tenant_id AND pl.id=i.price_list_id;
ALTER TABLE public.price_list_item ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.price_list_item ADD CONSTRAINT price_list_item_currency_check CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.sales_order ADD COLUMN transaction_date date;
UPDATE public.sales_order SET transaction_date=to_date(month_key||'-01','YYYY-MM-DD');
ALTER TABLE public.sales_order ALTER COLUMN transaction_date SET NOT NULL;
ALTER TABLE public.sales_order ADD COLUMN currency char(3);
UPDATE public.sales_order s SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=s.tenant_id;
ALTER TABLE public.sales_order ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.sales_order ADD COLUMN uom_code text;
UPDATE public.sales_order s SET uom_code=upper(trim(p.uom)) FROM public.product p
WHERE p.tenant_id=s.tenant_id AND p.id=s.product_id AND p.uom IS NOT NULL AND trim(p.uom)<>'';

ALTER TABLE public.quote_line ADD COLUMN currency char(3);
UPDATE public.quote_line l SET currency=q.currency FROM public.quote q WHERE q.tenant_id=l.tenant_id AND q.id=l.quote_id;
ALTER TABLE public.quote_line ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.quote_line ADD COLUMN uom_code text;
UPDATE public.quote_line l SET uom_code=upper(trim(p.uom)) FROM public.product p
WHERE p.tenant_id=l.tenant_id AND p.id=l.product_id AND p.uom IS NOT NULL AND trim(p.uom)<>'';

ALTER TABLE public.invoice_line ADD COLUMN currency char(3);
UPDATE public.invoice_line l SET currency=i.currency FROM public.invoice i WHERE i.tenant_id=l.tenant_id AND i.id=l.invoice_id;
ALTER TABLE public.invoice_line ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.invoice_line ADD COLUMN uom_code text;
UPDATE public.invoice_line l SET uom_code=upper(trim(p.uom)) FROM public.product p
WHERE p.tenant_id=l.tenant_id AND p.id=l.product_id AND p.uom IS NOT NULL AND trim(p.uom)<>'';

ALTER TABLE public.cost_component ADD COLUMN currency char(3);
UPDATE public.cost_component c SET currency=q.currency
FROM public.quote_line l JOIN public.quote q ON q.tenant_id=l.tenant_id AND q.id=l.quote_id
WHERE c.tenant_id=l.tenant_id AND c.quote_line_id=l.id;
UPDATE public.cost_component c SET currency=i.currency
FROM public.invoice_line l JOIN public.invoice i ON i.tenant_id=l.tenant_id AND i.id=l.invoice_id
WHERE c.tenant_id=l.tenant_id AND c.invoice_line_id=l.id AND c.currency IS NULL;
UPDATE public.cost_component c SET currency=t.currency
FROM public.tenant t WHERE t.tenant_id=c.tenant_id AND c.currency IS NULL;
ALTER TABLE public.cost_component ALTER COLUMN currency SET NOT NULL;

ALTER TABLE public.supplier_credit ADD COLUMN currency char(3);
UPDATE public.supplier_credit s SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=s.tenant_id;
ALTER TABLE public.supplier_credit ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.rebate_agreement ADD COLUMN currency char(3);
UPDATE public.rebate_agreement r SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=r.tenant_id;
ALTER TABLE public.rebate_agreement ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.rebate_progress ADD COLUMN currency char(3);
UPDATE public.rebate_progress r SET currency=a.currency FROM public.rebate_agreement a WHERE a.tenant_id=r.tenant_id AND a.id=r.agreement_id;
ALTER TABLE public.rebate_progress ALTER COLUMN currency SET NOT NULL;
ALTER TABLE public.margin_snapshot ADD COLUMN currency char(3);
UPDATE public.margin_snapshot m SET currency=t.currency FROM public.tenant t WHERE t.tenant_id=m.tenant_id;
ALTER TABLE public.margin_snapshot ALTER COLUMN currency SET NOT NULL;

ALTER TABLE public.sales_order ADD CONSTRAINT sales_order_uom_fk
  FOREIGN KEY (tenant_id,uom_code) REFERENCES public.uom(tenant_id,code);
ALTER TABLE public.quote_line ADD CONSTRAINT quote_line_uom_fk
  FOREIGN KEY (tenant_id,uom_code) REFERENCES public.uom(tenant_id,code);
ALTER TABLE public.invoice_line ADD CONSTRAINT invoice_line_uom_fk
  FOREIGN KEY (tenant_id,uom_code) REFERENCES public.uom(tenant_id,code);

-- Product base costs are the standard basis from the migration date forward.
INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,source,created_by,currency)
SELECT p.tenant_id,p.id,p.unit_cost,'standard',current_date,'phase1_product_unit_cost_backfill',NULL,t.currency
FROM public.product p JOIN public.tenant t ON t.tenant_id=p.tenant_id;

ALTER TABLE public.sales_order ADD CONSTRAINT sales_order_nonnegative_costs_check
  CHECK (freight_per_unit>=0 AND payment_terms_per_unit>=0 AND discount_pct BETWEEN 0 AND 100 AND off_invoice_rebate_pct BETWEEN 0 AND 100 AND quantity>0);
ALTER TABLE public.quote_line ADD CONSTRAINT quote_line_nonnegative_components_check
  CHECK (freight>=0 AND payment_terms_cost>=0 AND accessory_amount>=0 AND quantity>0);
ALTER TABLE public.invoice_line ADD CONSTRAINT invoice_line_nonnegative_amounts_check
  CHECK (quantity>0 AND net_sales>=0 AND discount_amount>=0 AND rebate_amount>=0);
ALTER TABLE public.cost_component ADD CONSTRAINT cost_component_nonnegative_amount_check CHECK (amount>=0);
ALTER TABLE public.rebate_agreement ADD CONSTRAINT rebate_agreement_valid_rate_check CHECK (rate_pct BETWEEN 0 AND 100 AND threshold_amount>=0);
ALTER TABLE public.rebate_progress ADD CONSTRAINT rebate_progress_nonnegative_amounts_check CHECK (eligible_spend>=0 AND modeled_amount>=0 AND recorded_credits>=0);
ALTER TABLE public.supplier_credit ADD CONSTRAINT supplier_credit_nonnegative_amount_check CHECK (amount>=0);
ALTER TABLE public.margin_policy ADD CONSTRAINT margin_policy_percentage_bounds_check
  CHECK (walkaway_margin_pct>=0 AND target_margin_pct<=100);
ALTER TABLE public.quote_line ADD CONSTRAINT quote_line_list_price_nonnegative_check CHECK (list_price>=0);
ALTER TABLE public.price_list ADD CONSTRAINT price_list_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.quote ADD CONSTRAINT quote_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.invoice ADD CONSTRAINT invoice_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.sales_order ADD CONSTRAINT sales_order_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.quote_line ADD CONSTRAINT quote_line_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.invoice_line ADD CONSTRAINT invoice_line_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.cost_component ADD CONSTRAINT cost_component_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.supplier_credit ADD CONSTRAINT supplier_credit_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.rebate_agreement ADD CONSTRAINT rebate_agreement_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.rebate_progress ADD CONSTRAINT rebate_progress_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE public.margin_snapshot ADD CONSTRAINT margin_snapshot_currency_code_check CHECK (currency ~ '^[A-Z]{3}$');

-- Only remove existing default ACL entries for platform/browser roles. This
-- conditional loop avoids issuing ineffective REVOKE statements on clean CI.
DO $$
DECLARE v_default record; v_grantee text; v_scope text; v_owner name:=current_user;
BEGIN
  FOR v_default IN
    SELECT d.defaclnamespace,a.grantee,r.rolname,d.defaclobjtype,a.privilege_type
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND d.defaclnamespace IN (0,'public'::regnamespace)
      AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
      AND ((d.defaclobjtype='r' AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
        OR (d.defaclobjtype='S' AND a.privilege_type IN ('USAGE','SELECT','UPDATE'))
        OR (d.defaclobjtype='f' AND a.privilege_type='EXECUTE'))
  LOOP
    v_grantee:=CASE WHEN v_default.grantee=0 THEN 'PUBLIC' ELSE format('%I',v_default.rolname) END;
    v_scope:=CASE WHEN v_default.defaclnamespace=0 THEN '' ELSE ' IN SCHEMA public' END;
    IF v_default.defaclobjtype='r' THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON TABLES FROM %s',v_owner,v_scope,v_grantee);
    ELSIF v_default.defaclobjtype='S' THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON SEQUENCES FROM %s',v_owner,v_scope,v_grantee);
    ELSE
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE EXECUTE ON FUNCTIONS FROM %s',v_owner,v_scope,v_grantee);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.record_data_quality_issue(
  p_tenant_id uuid,p_issue_code text,p_entity_type text,p_entity_id text,p_occurred_on date,p_details jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'Tenant access denied' USING ERRCODE='42501'; END IF;
  IF p_issue_code NOT IN ('cost_history_gap','uom_conversion_missing','fx_rate_missing') THEN
    RAISE EXCEPTION 'Unsupported data-quality issue code' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.data_quality_issue(tenant_id,issue_code,entity_type,entity_id,occurred_on,details,created_by)
  VALUES(p_tenant_id,p_issue_code,p_entity_type,p_entity_id,p_occurred_on,COALESCE(p_details,'{}'::jsonb),auth.uid())
  ON CONFLICT (tenant_id,issue_code,entity_type,entity_id,occurred_on) WHERE resolved_at IS NULL
  DO UPDATE SET details=EXCLUDED.details
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.convert_quantity(
  p_tenant_id uuid,p_product_id uuid,p_quantity numeric,p_from_code text,p_to_code text,p_occurred_on date DEFAULT current_date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_from uuid; v_to uuid; v_factor numeric; v_direction text; v_result numeric; v_issue_id uuid;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'Tenant access denied' USING ERRCODE='42501'; END IF;
  IF p_quantity IS NULL OR p_quantity<0 THEN RAISE EXCEPTION 'Quantity must be non-negative' USING ERRCODE='22023'; END IF;
  SELECT id INTO v_from FROM public.uom WHERE tenant_id=p_tenant_id AND code=upper(trim(p_from_code));
  SELECT id INTO v_to FROM public.uom WHERE tenant_id=p_tenant_id AND code=upper(trim(p_to_code));
  IF v_from IS NOT NULL AND v_from=v_to THEN RETURN round(p_quantity,4); END IF;
  IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
    SELECT c.factor,c.direction INTO v_factor,v_direction
    FROM public.uom_conversion c
    WHERE c.tenant_id=p_tenant_id AND c.from_uom_id=v_from AND c.to_uom_id=v_to
      AND (c.product_id=p_product_id OR c.product_id IS NULL)
    ORDER BY (c.product_id IS NOT NULL) DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT c.factor,c.direction INTO v_factor,v_direction
      FROM public.uom_conversion c
      WHERE c.tenant_id=p_tenant_id AND c.from_uom_id=v_to AND c.to_uom_id=v_from
        AND (c.product_id=p_product_id OR c.product_id IS NULL)
      ORDER BY (c.product_id IS NOT NULL) DESC LIMIT 1;
      IF FOUND THEN
        v_direction:=CASE WHEN v_direction='multiply' THEN 'divide' ELSE 'multiply' END;
      END IF;
    END IF;
  END IF;
  IF v_factor IS NULL THEN
    v_issue_id:=public.record_data_quality_issue(p_tenant_id,'uom_conversion_missing','product',COALESCE(p_product_id::text,'unknown'),p_occurred_on,
      jsonb_build_object('from',p_from_code,'to',p_to_code));
    RETURN NULL;
  END IF;
  v_result:=CASE WHEN v_direction='multiply' THEN p_quantity*v_factor ELSE p_quantity/v_factor END;
  RETURN round(v_result,4);
END $$;

CREATE OR REPLACE FUNCTION public.sync_product_standard_cost_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_currency char(3); v_today date:=current_date;
BEGIN
  SELECT currency INTO v_currency FROM public.tenant WHERE tenant_id=NEW.tenant_id;
  IF NEW.uom IS NOT NULL AND trim(NEW.uom)<>'' THEN
    INSERT INTO public.uom(tenant_id,code,display_name)
    VALUES(NEW.tenant_id,upper(trim(NEW.uom)),upper(trim(NEW.uom)))
    ON CONFLICT (tenant_id,code) DO NOTHING;
  END IF;
  IF TG_OP='UPDATE' AND NEW.unit_cost IS NOT DISTINCT FROM OLD.unit_cost THEN RETURN NEW; END IF;
  UPDATE public.cost_history SET effective_to=v_today
  WHERE tenant_id=NEW.tenant_id AND product_id=NEW.id AND basis='standard'
    AND effective_to IS NULL AND effective_from<v_today;
  DELETE FROM public.cost_history
  WHERE tenant_id=NEW.tenant_id AND product_id=NEW.id AND basis='standard' AND effective_from=v_today;
  INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,source,created_by,currency)
  VALUES(NEW.tenant_id,NEW.id,NEW.unit_cost,'standard',v_today,'product_unit_cost',auth.uid(),v_currency);
  RETURN NEW;
END $$;
CREATE TRIGGER product_sync_standard_cost_history
  AFTER INSERT OR UPDATE OF unit_cost ON public.product
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_standard_cost_history();

CREATE TRIGGER cost_history_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.cost_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER uom_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.uom
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER uom_conversion_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.uom_conversion
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER fx_rate_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.fx_rate
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER data_quality_issue_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.data_quality_issue
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_history','uom','uom_conversion','fx_rate','data_quality_issue'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

-- Explicit policies for each operation. Cost and FX data stay hidden from reps.
CREATE POLICY cost_history_select ON public.cost_history FOR SELECT TO margindesk_app
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY cost_history_insert ON public.cost_history FOR INSERT TO margindesk_app
  WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY cost_history_update ON public.cost_history FOR UPDATE TO margindesk_app
  USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY cost_history_delete ON public.cost_history FOR DELETE TO margindesk_app
  USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));

CREATE POLICY uom_select ON public.uom FOR SELECT TO margindesk_app USING (public.is_tenant_member(tenant_id));
CREATE POLICY uom_insert ON public.uom FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY uom_update ON public.uom FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY uom_delete ON public.uom FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));

CREATE POLICY uom_conversion_select ON public.uom_conversion FOR SELECT TO margindesk_app USING (public.is_tenant_member(tenant_id));
CREATE POLICY uom_conversion_insert ON public.uom_conversion FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY uom_conversion_update ON public.uom_conversion FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY uom_conversion_delete ON public.uom_conversion FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));

CREATE POLICY fx_rate_select ON public.fx_rate FOR SELECT TO margindesk_app USING (public.is_tenant_member(tenant_id));
CREATE POLICY fx_rate_insert ON public.fx_rate FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY fx_rate_update ON public.fx_rate FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY fx_rate_delete ON public.fx_rate FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));

CREATE POLICY data_quality_issue_select ON public.data_quality_issue FOR SELECT TO margindesk_app
  USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY data_quality_issue_insert ON public.data_quality_issue FOR INSERT TO margindesk_app WITH CHECK (false);
CREATE POLICY data_quality_issue_update ON public.data_quality_issue FOR UPDATE TO margindesk_app
  USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY data_quality_issue_delete ON public.data_quality_issue FOR DELETE TO margindesk_app
  USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));

-- Remove any platform/browser ACL entries only when present, then grant the
-- minimum table operations to the server role. No TRUNCATE is granted.
DO $$
DECLARE v_acl record; v_grantee text;
BEGIN
  FOR v_acl IN
    SELECT c.oid,a.grantee,r.rolname,a.privilege_type
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['cost_history','uom','uom_conversion','fx_rate','data_quality_issue'])
      AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
  LOOP
    v_grantee:=CASE WHEN v_acl.grantee=0 THEN 'PUBLIC' ELSE format('%I',v_acl.rolname) END;
    EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',v_acl.oid::regclass,v_grantee);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO margindesk_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cost_history,public.uom,public.uom_conversion,public.fx_rate TO margindesk_app;
GRANT SELECT,UPDATE,DELETE ON public.data_quality_issue TO margindesk_app;

-- Equivalent to explicit REVOKE ALL from PUBLIC, anon, authenticated, and
-- service_role, but executed only for direct ACL entries that exist so the
-- migration warning gate never sees a silently ignored revoke.
DO $$
DECLARE v_acl record; v_grantee text;
BEGIN
  FOR v_acl IN
    SELECT p.oid,a.grantee,r.rolname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid=a.grantee
    WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
      'record_data_quality_issue','convert_quantity','sync_product_standard_cost_history'
    ]) AND a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)
      AND a.privilege_type='EXECUTE'
  LOOP
    v_grantee:=CASE WHEN v_acl.grantee=0 THEN 'PUBLIC' ELSE format('%I',v_acl.rolname) END;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',v_acl.oid::regprocedure,v_grantee);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.record_data_quality_issue(uuid,text,text,text,date,jsonb) TO margindesk_app;
GRANT EXECUTE ON FUNCTION public.convert_quantity(uuid,uuid,numeric,text,text,date) TO margindesk_app;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.sync_product_standard_cost_history() TO %I',current_user);
END $$;

-- The locked Phase 1 ACL migration verifies its 24-table foundation before
-- this migration adds the five Chunk 2A tables. Assert the completed inventory.
DO $$
DECLARE v_tenant_table_count integer;
BEGIN
  SELECT count(*) INTO v_tenant_table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id'
      AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');
  IF v_tenant_table_count<29 THEN
    RAISE EXCEPTION 'Chunk 2A expected at least 29 tenant tables after migration; found %',v_tenant_table_count;
  END IF;
END $$;

COMMIT;
