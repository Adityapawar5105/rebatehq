-- Product rename (MarginDesk -> RebateHQ): rename the application database role and the
-- stored import price-list name. Earlier migrations are unchanged and still create
-- margindesk_app; policies, grants and role memberships follow the role through the rename.
-- Deploy the app build that uses SET LOCAL ROLE rebatehq_app together with this migration.

DO $$
BEGIN
  IF to_regrole('margindesk_app') IS NOT NULL THEN
    IF to_regrole('rebatehq_app') IS NOT NULL THEN
      RAISE EXCEPTION 'Both margindesk_app and rebatehq_app exist; resolve manually before migrating';
    END IF;
    ALTER ROLE margindesk_app RENAME TO rebatehq_app;
  ELSIF to_regrole('rebatehq_app') IS NULL THEN
    RAISE EXCEPTION 'Neither margindesk_app nor rebatehq_app exists';
  END IF;
END $$;

UPDATE public.price_list
   SET name = 'RebateHQ file imports'
 WHERE name = 'MarginDesk file imports';
