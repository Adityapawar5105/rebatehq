-- Chunk 2B. Rollback: export pricing rules, tiers and rebate entries first;
-- drop the four new tables in reverse FK order, then added customer/agreement
-- columns. Legacy agreement/progress columns remain for rollback/reference.
-- Reverting loses edited tiers/returns unless that export is preserved.
BEGIN;
CREATE TABLE public.customer_group (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(trim(name))>0),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
);
ALTER TABLE public.customer ADD COLUMN group_id uuid;
ALTER TABLE public.customer ADD CONSTRAINT customer_group_tenant_fk FOREIGN KEY(tenant_id,group_id) REFERENCES public.customer_group(tenant_id,id);
CREATE INDEX customer_group_lookup_idx ON public.customer(tenant_id,group_id);
CREATE TABLE public.customer_price (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 customer_id uuid, group_id uuid, product_id uuid NOT NULL,
 rule_kind text NOT NULL CHECK(rule_kind IN ('contract','customer','group')),
 contract_ref text,
 price numeric(18,4) NOT NULL CHECK(price>=0),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 min_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK(min_quantity>=0),
 max_quantity numeric(18,4), effective_from date NOT NULL, effective_to date,
 source text NOT NULL CHECK(length(trim(source))>0),
 CHECK(price<>'NaN'::numeric AND min_quantity<>'NaN'::numeric AND (max_quantity IS NULL OR max_quantity<>'NaN'::numeric)),
 CHECK(max_quantity IS NULL OR max_quantity>min_quantity),
 CHECK(effective_to IS NULL OR effective_to>effective_from),
 CHECK((rule_kind IN ('contract','customer') AND customer_id IS NOT NULL AND group_id IS NULL)
    OR (rule_kind='group' AND group_id IS NOT NULL AND customer_id IS NULL)),
 CHECK(rule_kind<>'contract' OR length(trim(contract_ref))>0 AND contract_ref IS NOT NULL),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,customer_id) REFERENCES public.customer(tenant_id,id),
 FOREIGN KEY(tenant_id,group_id) REFERENCES public.customer_group(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id),
 CONSTRAINT customer_price_no_overlap EXCLUDE USING gist
 (tenant_id WITH =, product_id WITH =, rule_kind WITH =, (COALESCE(customer_id,group_id)) WITH =,
 daterange(effective_from,effective_to,'[)') WITH &&, numrange(min_quantity,max_quantity,'[)') WITH &&)
);
ALTER TABLE public.quote_line ADD COLUMN price_explanation jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.rebate_agreement ADD COLUMN calculation_mode text NOT NULL DEFAULT 'retroactive'
 CHECK(calculation_mode IN ('incremental','retroactive'));
ALTER TABLE public.rebate_agreement ADD COLUMN excluded_skus text[] NOT NULL DEFAULT '{}';
CREATE TABLE public.rebate_tier (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 agreement_id uuid NOT NULL,
 from_amount numeric(18,4) NOT NULL CHECK(from_amount>=0),
 to_amount numeric(18,4), rate numeric(7,3) NOT NULL CHECK(rate BETWEEN 0 AND 100),
 CHECK(from_amount<>'NaN'::numeric AND (to_amount IS NULL OR to_amount<>'NaN'::numeric)),
 CHECK(to_amount IS NULL OR to_amount>from_amount),
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,agreement_id) REFERENCES public.rebate_agreement(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT rebate_tier_no_overlap EXCLUDE USING gist
 (tenant_id WITH =,agreement_id WITH =,numrange(from_amount,to_amount,'[)') WITH &&)
);
ALTER TABLE public.rebate_agreement ADD CONSTRAINT rebate_agreement_currency_identity UNIQUE(tenant_id,id,currency);
CREATE TABLE public.rebate_entry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 agreement_id uuid NOT NULL,
 entry_type text NOT NULL CHECK(entry_type IN ('sale','return','credit_memo','rebate_credit')),
 amount numeric(18,4) NOT NULL CHECK(amount>=0 AND amount<>'NaN'::numeric),
 currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 occurred_on date NOT NULL, sku text,
 source_ref text NOT NULL CHECK(length(trim(source_ref))>0),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,agreement_id,source_ref),
 FOREIGN KEY(tenant_id,agreement_id,currency) REFERENCES public.rebate_agreement(tenant_id,id,currency) ON DELETE CASCADE
);
-- Preserve existing terms as one retroactive tier, including the two seeded
-- agreements. Do not fabricate tiers from unapproved demo nextRate hints.
INSERT INTO public.rebate_tier(tenant_id,agreement_id,from_amount,rate)
 SELECT tenant_id,id,threshold_amount,rate_pct FROM public.rebate_agreement;
-- Snapshot progress is cumulative, not a transaction ledger. Backfill ONLY
-- the latest snapshot per agreement, retaining source IDs to prevent double count.
WITH latest AS (SELECT DISTINCT ON(tenant_id,agreement_id) * FROM public.rebate_progress
 ORDER BY tenant_id,agreement_id,updated_at DESC,id DESC), normalized AS (
 SELECT p.*, CASE WHEN t.is_demo AND a.name='NorthStar Metals — quarterly growth rebate'
   AND a.party_id='NorthStar Metals' AND a.rate_pct=2 AND a.threshold_amount=20000
   AND a.period_start='2026-07-01' AND a.period_end='2026-09-30'
   AND p.eligible_spend=29500 AND p.modeled_amount=350 AND p.recorded_credits=0
   AND (SELECT count(*) FROM public.supplier_credit c WHERE c.tenant_id=p.tenant_id AND c.vendor_name=a.party_id
     AND ((c.credit_date='2026-08-31' AND c.amount=200 AND c.reference='Remit 08-31')
       OR (c.credit_date='2026-09-30' AND c.amount=150 AND c.reference='Remit 09-30')))=2
   THEN 350 ELSE p.recorded_credits END AS allocated_credits
 FROM latest p JOIN public.rebate_agreement a ON a.tenant_id=p.tenant_id AND a.id=p.agreement_id
 JOIN public.tenant t ON t.tenant_id=p.tenant_id
)
-- The exact demo condition repairs the known legacy importer field mix-up,
-- supported by its two documented remittances. Other customer data is untouched.
INSERT INTO public.rebate_entry(tenant_id,agreement_id,entry_type,amount,currency,occurred_on,source_ref)
 SELECT p.tenant_id,p.agreement_id,x.kind,x.amount,p.currency,p.period_end,
 'progress:'||p.id||':'||x.kind||CASE WHEN x.kind='rebate_credit' AND p.allocated_credits<>p.recorded_credits THEN ':documented-demo-credit-repair' ELSE '' END
 FROM normalized p CROSS JOIN LATERAL (VALUES('sale',p.eligible_spend),('rebate_credit',p.allocated_credits)) x(kind,amount);
CREATE INDEX customer_group_tenant_idx ON public.customer_group(tenant_id);
CREATE TRIGGER customer_group_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.customer_group FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY customer_group_select ON public.customer_group FOR SELECT TO margindesk_app USING (public.is_tenant_member(tenant_id));
CREATE POLICY customer_group_insert ON public.customer_group FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY customer_group_update ON public.customer_group FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY customer_group_delete ON public.customer_group FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.customer_group FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_group TO margindesk_app;
CREATE INDEX customer_price_tenant_idx ON public.customer_price(tenant_id);
CREATE TRIGGER customer_price_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.customer_price FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY customer_price_select ON public.customer_price FOR SELECT TO margindesk_app USING (public.is_tenant_member(tenant_id) AND (customer_id IS NULL OR EXISTS(SELECT 1 FROM public.customer c WHERE c.tenant_id=customer_price.tenant_id AND c.id=customer_price.customer_id)));
CREATE POLICY customer_price_insert ON public.customer_price FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY customer_price_update ON public.customer_price FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY customer_price_delete ON public.customer_price FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.customer_price FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_price TO margindesk_app;
CREATE INDEX rebate_tier_tenant_idx ON public.rebate_tier(tenant_id);
CREATE TRIGGER rebate_tier_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.rebate_tier FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY rebate_tier_select ON public.rebate_tier FOR SELECT TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_tier_insert ON public.rebate_tier FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_tier_update ON public.rebate_tier FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_tier_delete ON public.rebate_tier FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.rebate_tier FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rebate_tier TO margindesk_app;
CREATE INDEX rebate_entry_tenant_idx ON public.rebate_entry(tenant_id);
CREATE TRIGGER rebate_entry_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.rebate_entry FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY rebate_entry_select ON public.rebate_entry FOR SELECT TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_entry_insert ON public.rebate_entry FOR INSERT TO margindesk_app WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_entry_update ON public.rebate_entry FOR UPDATE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst'])) WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager','analyst']));
CREATE POLICY rebate_entry_delete ON public.rebate_entry FOR DELETE TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.rebate_entry FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rebate_entry TO margindesk_app;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_group','customer_price','rebate_tier','rebate_entry'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
COMMIT;
