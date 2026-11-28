-- Review R3 (28 Nov 2026; OPERATIONS.md "Customer leaves"): removing a deleted workspace's control-plane rows 30 days
-- after its Owner deleted it. The tenant foreign keys do not cascade, so the old `DELETE FROM tenant` in
-- scripts/purge-deleted-tenants.ts could never succeed; it stayed suspended. This function deletes the workspace's rows
-- children first, in all 14 tables that hold them, then the tenant row, and returns how many rows each table lost.
--   * Operator only: SECURITY INVOKER, callable by its owner alone, and it refuses a caller without BYPASSRLS (every
--     tenant table forces row-level security). No app or Supabase role may execute it.
--   * Never early: the workspace must have been deleted at least 30 days ago (the shortest allowed window).
--   * The audit log is append-only and keeps its rows, including the audit rows these deletes write.
--   * Encrypted pack chunks in Storage are removed by the purge script through the Storage API before this runs.
BEGIN;

CREATE FUNCTION rebatehq_private.purge_deleted_tenant(p_tenant uuid, p_after interval DEFAULT interval '30 days')
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE deleted timestamptz; counts jsonb := '{}'::jsonb; n bigint; t text;
BEGIN
  IF NOT COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'The tenant purge needs a migration administrator.' USING ERRCODE = '42501';
  END IF;
  IF p_after IS NULL OR p_after < interval '30 days' THEN
    RAISE EXCEPTION 'A deleted workspace is kept at least 30 days.' USING ERRCODE = '22023';
  END IF;
  SELECT w.deleted_at INTO deleted FROM public.tenant w WHERE w.tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such workspace.' USING ERRCODE = '22023'; END IF;
  IF deleted IS NULL THEN RAISE EXCEPTION 'The workspace is not deleted.' USING ERRCODE = '22023'; END IF;
  IF deleted > now() - p_after THEN RAISE EXCEPTION 'The workspace was deleted less than % ago.', p_after USING ERRCODE = '22023'; END IF;
  -- Children before parents.
  FOREACH t IN ARRAY ARRAY['relay_pack_version','relay_pack_wrap','relay_event','relay_key_wrap','relay_epoch','relay_device_key',
                           'bench_consent','licence_device','licence_seat','licence_location','workspace_licence','invite','membership'] LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', t) USING p_tenant;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object(t, n);
  END LOOP;
  DELETE FROM public.tenant WHERE tenant_id = p_tenant;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN counts || jsonb_build_object('tenant', n);
END $$;
REVOKE ALL ON FUNCTION rebatehq_private.purge_deleted_tenant(uuid,interval) FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;

COMMIT;
