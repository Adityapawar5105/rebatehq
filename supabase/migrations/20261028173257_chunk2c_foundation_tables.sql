-- Chunk 2C: secured persistence only; no UI, public sharing, workers or connectors.
-- Rollback: export these five tables first, then DROP them in reverse dependency
-- order; drop only the three import_job constraints named below. Do not replay
-- historical migrations or remove existing import jobs / margin snapshots.
BEGIN;
ALTER TABLE public.import_job ADD CONSTRAINT import_job_counts_nonnegative
 CHECK (accepted_rows >= 0 AND rejected_rows >= 0);
ALTER TABLE public.import_job ADD CONSTRAINT import_job_type_nonempty
 CHECK (length(btrim(import_type)) BETWEEN 1 AND 100);
ALTER TABLE public.import_job ADD CONSTRAINT import_job_summary_object
 CHECK (jsonb_typeof(summary)='object');

CREATE TABLE public.column_mapping_template (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 import_type text NOT NULL CHECK (length(btrim(import_type)) BETWEEN 1 AND 100),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(column_mapping)='object'),
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id), UNIQUE (tenant_id,name,version)
);
CREATE TABLE public.connector_sync_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
 direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
 processed_count bigint NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
 failed_count bigint NOT NULL DEFAULT 0 CHECK (failed_count >= 0 AND failed_count <= processed_count),
 started_at timestamptz,
 finished_at timestamptz,
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at)),
 CHECK (status NOT IN ('succeeded','failed','cancelled') OR finished_at IS NOT NULL),
 CHECK (status <> 'running' OR started_at IS NOT NULL),
 UNIQUE (tenant_id,id)
);
-- Never store raw tokens, recipient payloads, costs, margin, or arbitrary JSON.
-- This is private link metadata only; no anonymous grants or redemption route.
CREATE TABLE public.quote_share_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 quote_id uuid NOT NULL,
 token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at),
 CHECK (revoked_at IS NULL OR revoked_at >= created_at),
 UNIQUE (tenant_id,id), UNIQUE (token_hash),
 FOREIGN KEY (tenant_id,quote_id) REFERENCES public.quote(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE public.approval_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disabled')),
 minimum_margin_pct numeric(7,3) NOT NULL CHECK (minimum_margin_pct >= 0 AND minimum_margin_pct <= 100),
 approver_role text NOT NULL CHECK (approver_role IN ('owner','manager')),
 priority integer NOT NULL DEFAULT 0 CHECK (priority >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id), UNIQUE (tenant_id,name)
);
-- Tenant-local configuration, NOT an authoritative billing entitlement. No
-- application feature/plan authorization is enabled by this persistence chunk.
CREATE TABLE public.plan_feature (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id) ON DELETE CASCADE,
 feature_key text NOT NULL CHECK (feature_key ~ '^[a-z][a-z0-9_]{0,63}$'),
 enabled boolean NOT NULL DEFAULT false,
 usage_limit bigint CHECK (usage_limit >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,id), UNIQUE (tenant_id,feature_key)
);

CREATE INDEX column_mapping_template_tenant_idx ON public.column_mapping_template(tenant_id);
CREATE TRIGGER column_mapping_template_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.column_mapping_template
 FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY column_mapping_template_select ON public.column_mapping_template FOR SELECT TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY column_mapping_template_insert ON public.column_mapping_template FOR INSERT TO margindesk_app
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY column_mapping_template_update ON public.column_mapping_template FOR UPDATE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']))
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY column_mapping_template_delete ON public.column_mapping_template FOR DELETE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.column_mapping_template FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.column_mapping_template TO margindesk_app;

CREATE INDEX connector_sync_run_tenant_idx ON public.connector_sync_run(tenant_id);
CREATE TRIGGER connector_sync_run_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.connector_sync_run
 FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY connector_sync_run_select ON public.connector_sync_run FOR SELECT TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY connector_sync_run_insert ON public.connector_sync_run FOR INSERT TO margindesk_app
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY connector_sync_run_update ON public.connector_sync_run FOR UPDATE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']))
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY connector_sync_run_delete ON public.connector_sync_run FOR DELETE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.connector_sync_run FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.connector_sync_run TO margindesk_app;

CREATE INDEX quote_share_link_tenant_idx ON public.quote_share_link(tenant_id);
CREATE TRIGGER quote_share_link_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.quote_share_link
 FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY quote_share_link_select ON public.quote_share_link FOR SELECT TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY quote_share_link_insert ON public.quote_share_link FOR INSERT TO margindesk_app
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY quote_share_link_update ON public.quote_share_link FOR UPDATE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']))
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY quote_share_link_delete ON public.quote_share_link FOR DELETE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
REVOKE ALL ON TABLE public.quote_share_link FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.quote_share_link TO margindesk_app;

CREATE INDEX approval_rule_tenant_idx ON public.approval_rule(tenant_id);
CREATE TRIGGER approval_rule_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.approval_rule
 FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY approval_rule_select ON public.approval_rule FOR SELECT TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY approval_rule_insert ON public.approval_rule FOR INSERT TO margindesk_app
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner']));
CREATE POLICY approval_rule_update ON public.approval_rule FOR UPDATE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner']))
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner']));
CREATE POLICY approval_rule_delete ON public.approval_rule FOR DELETE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner']));
REVOKE ALL ON TABLE public.approval_rule FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.approval_rule TO margindesk_app;

CREATE INDEX plan_feature_tenant_idx ON public.plan_feature(tenant_id);
CREATE TRIGGER plan_feature_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.plan_feature
 FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE POLICY plan_feature_select ON public.plan_feature FOR SELECT TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY plan_feature_insert ON public.plan_feature FOR INSERT TO margindesk_app
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner']));
CREATE POLICY plan_feature_update ON public.plan_feature FOR UPDATE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner']))
 WITH CHECK (public.is_tenant_role(tenant_id,ARRAY['owner']));
CREATE POLICY plan_feature_delete ON public.plan_feature FOR DELETE TO margindesk_app
 USING (public.is_tenant_role(tenant_id,ARRAY['owner']));
REVOKE ALL ON TABLE public.plan_feature FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.plan_feature TO margindesk_app;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['column_mapping_template','connector_sync_run','quote_share_link','approval_rule','plan_feature'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
COMMIT;
