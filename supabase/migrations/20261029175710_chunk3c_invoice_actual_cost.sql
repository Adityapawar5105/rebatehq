-- Chunk 3C distinguishes sourced invoice actuals from standard product costs.
-- No historical actuals are inferred or backfilled. Existing invoice-line RLS,
-- exact table grants and audit trigger cover these nullable fields.
-- Rollback: export the two evidence columns, drop the named check/index and
-- then drop only actual_cost_amount and actual_cost_source. No historical replay.
BEGIN;
ALTER TABLE public.invoice_line ADD COLUMN actual_cost_amount numeric(18,4);
ALTER TABLE public.invoice_line ADD COLUMN actual_cost_source text;
ALTER TABLE public.invoice_line ADD CONSTRAINT invoice_line_actual_cost_evidence_check
 CHECK ((actual_cost_amount IS NULL AND actual_cost_source IS NULL)
 OR (actual_cost_amount IS NOT NULL AND actual_cost_amount >= 0
     AND actual_cost_amount <> 'NaN'::numeric
     AND actual_cost_source IS NOT NULL
     AND length(btrim(actual_cost_source)) BETWEEN 1 AND 200));
CREATE INDEX cost_component_invoice_evidence_idx
 ON public.cost_component(tenant_id,invoice_line_id,component_type)
 WHERE invoice_line_id IS NOT NULL;
COMMIT;
