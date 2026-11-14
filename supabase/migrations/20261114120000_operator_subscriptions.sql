-- Operator view of subscriptions (14 Nov 2026, blueprint section 22 item 31).
-- The operator looks a customer up by email in the Supabase dashboard and sees their workspace, plan tier,
-- whether it is a pilot or paid, its status and expiry; the plan is changed from the SQL editor (or by editing
-- the workspace_licence row). Nothing here is reachable by the app, anon, authenticated or service_role:
-- the view and function live in the private schema, whose USAGE is already revoked from every API role.

-- Pilot or paid. Every licence issued so far came from the pilot tooling with no payment, so existing rows are pilots.
ALTER TABLE public.workspace_licence ADD COLUMN plan_type text NOT NULL DEFAULT 'pilot' CHECK (plan_type IN ('pilot','paid'));

-- One row per sign-in email and workspace it belongs to (a user with no workspace yet still gets one row).
-- Read-only; it runs with its owner's rights, so it is revoked from every API role below.
CREATE VIEW rebatehq_private.subscriptions AS
SELECT u.email::text AS email,
       t.name AS workspace,
       m.role AS workspace_role,
       m.status AS membership_status,
       COALESCE(l.tier, 'none') AS tier,
       l.plan_type,
       l.status AS licence_status,
       l.valid_until,
       (l.status = 'active' AND l.valid_until > now()) AS licence_current,
       EXISTS (SELECT 1 FROM public.licence_seat s WHERE s.tenant_id = m.tenant_id AND s.user_id = u.id) AS has_seat,
       (SELECT count(*) FROM public.licence_seat s WHERE s.tenant_id = m.tenant_id)::int AS seats_used,
       CASE l.tier WHEN 'starter' THEN 1 WHEN 'professional' THEN 5 WHEN 'scale' THEN 15 END AS seats_allowed,
       CASE l.tier WHEN 'starter' THEN 200000 WHEN 'professional' THEN 1000000 WHEN 'scale' THEN 2000000 END AS line_cap,
       l.issued_at,
       u.id AS user_id,
       m.tenant_id,
       l.id AS licence_id
FROM auth.users u
LEFT JOIN (public.membership m JOIN public.tenant t ON t.tenant_id = m.tenant_id AND t.deleted_at IS NULL) ON m.user_id = u.id
LEFT JOIN public.workspace_licence l ON l.tenant_id = m.tenant_id;
REVOKE ALL ON rebatehq_private.subscriptions FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;

-- Set the plan of the workspace this email owns: tier, pilot or paid, and expiry (kept when NULL; a new licence
-- defaults to 90 days). The owner gets the first seat, as in scripts/issue-licence.ts. A downgrade that would
-- leave more seats or locations than the new tier allows is refused. Audited by the workspace_licence trigger.
-- Run from the SQL editor, for example:  SELECT rebatehq_private.set_subscription('owner@example.com', 'scale', 'paid', '2027-11-14');
CREATE FUNCTION rebatehq_private.set_subscription(p_email text, p_tier text, p_plan_type text DEFAULT NULL, p_valid_until timestamptz DEFAULT NULL)
RETURNS TABLE(email text, workspace text, tier text, plan_type text, status text, valid_until timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE target uuid; owned int; seat_cap int; seats int; locations int;
BEGIN
  IF p_tier NOT IN ('starter','professional','scale') THEN RAISE EXCEPTION 'Tier must be starter, professional or scale.'; END IF;
  IF p_plan_type IS NOT NULL AND p_plan_type NOT IN ('pilot','paid') THEN RAISE EXCEPTION 'Plan type must be pilot or paid.'; END IF;
  IF p_valid_until IS NOT NULL AND p_valid_until <= now() THEN RAISE EXCEPTION 'The expiry must be in the future.'; END IF;
  SELECT count(*), min(m.tenant_id::text)::uuid INTO owned, target
    FROM auth.users u JOIN public.membership m ON m.user_id = u.id AND m.role = 'owner' AND m.status = 'active'
    JOIN public.tenant t ON t.tenant_id = m.tenant_id AND t.deleted_at IS NULL
   WHERE lower(u.email) = lower(trim(p_email));
  IF owned = 0 THEN RAISE EXCEPTION 'No active workspace owner with that email. They must sign in and create a workspace first.'; END IF;
  IF owned > 1 THEN RAISE EXCEPTION 'That email owns % workspaces; edit the right row in public.workspace_licence instead.', owned; END IF;
  seat_cap := CASE p_tier WHEN 'starter' THEN 1 WHEN 'professional' THEN 5 ELSE 15 END;
  SELECT (SELECT count(*) FROM licence_seat s WHERE s.tenant_id = target), (SELECT count(*) FROM licence_location x WHERE x.tenant_id = target) INTO seats, locations;
  IF seats > seat_cap OR (p_tier = 'starter' AND locations > 1) THEN RAISE EXCEPTION 'Remove extra seats or locations before moving this workspace to %.', p_tier; END IF;
  INSERT INTO workspace_licence AS w (tenant_id, tier, plan_type, valid_until)
  VALUES (target, p_tier, COALESCE(p_plan_type, 'pilot'), COALESCE(p_valid_until, now() + interval '90 days'))
  ON CONFLICT (tenant_id) DO UPDATE SET tier = EXCLUDED.tier, status = 'active',
    plan_type = COALESCE(p_plan_type, w.plan_type), valid_until = COALESCE(p_valid_until, w.valid_until), issued_at = now();
  INSERT INTO licence_seat (tenant_id, user_id)
  SELECT m.tenant_id, m.user_id FROM membership m
   WHERE m.tenant_id = target AND m.role = 'owner' AND m.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM licence_seat s WHERE s.tenant_id = m.tenant_id AND s.user_id = m.user_id)
   ORDER BY m.created_at LIMIT 1;
  RETURN QUERY SELECT s.email, s.workspace, s.tier, s.plan_type, s.licence_status, s.valid_until FROM rebatehq_private.subscriptions s WHERE s.tenant_id = target AND lower(s.email) = lower(trim(p_email));
END $$;
REVOKE ALL ON FUNCTION rebatehq_private.set_subscription(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
