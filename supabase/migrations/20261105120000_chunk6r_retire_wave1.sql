-- Chunk 6R: legacy business-table retirement, wave 1 (RETIREMENT_PROPOSAL.md,
-- approved 5 Nov 2026; blueprint section 22, item 15).
--
-- Customer pricing data lives in the local encrypted vault (4B-5A); these server
-- tables have had no reachable writer since 5B switched the legacy routes off.
-- Precondition checked 5 Nov 2026: the user's Supabase account has no projects,
-- so no hosted database holds rows in them. Wave-2 tables (quotes, approvals,
-- rebates, supplier credits, alerts, FX) stay until chunk 8R. They keep their
-- customer/product/unit ID columns, but those IDs no longer reference a server
-- table, so the three foreign keys from quote and quote_line are dropped first.
-- No CASCADE is used: if anything else still depended on these tables, the
-- DROP TABLE below would fail instead of silently removing it.

DO $wave1$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid IN ('public.quote'::regclass, 'public.quote_line'::regclass)
      AND c.confrelid IN ('public.customer'::regclass, 'public.product'::regclass, 'public.uom'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    n := n + 1;
  END LOOP;
  IF n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 quote/quote_line foreign keys to customer, product and uom; found %', n;
  END IF;
END
$wave1$;

DROP TABLE
  public.cost_component,
  public.invoice_line,
  public.invoice,
  public.sales_order,
  public.customer_price,
  public.price_list_item,
  public.price_list_version,
  public.price_list,
  public.cost_history,
  public.uom_conversion,
  public.uom,
  public.product,
  public.customer,
  public.customer_group,
  public.margin_policy,
  public.margin_snapshot,
  public.data_quality_issue,
  public.import_job,
  public.column_mapping_template,
  public.connector_secret,
  public.connector_sync_run,
  public.plan_feature;

-- Functions that only served the dropped tables. The product trigger that called
-- sync_product_standard_cost_history went with the product table.
DROP FUNCTION public.convert_quantity(uuid, uuid, numeric, text, text, date);
DROP FUNCTION public.record_data_quality_issue(uuid, text, text, text, date, jsonb);
DROP FUNCTION public.sync_product_standard_cost_history();
