-- The single reviewed EXECUTE-grantee registry for every public function.
-- Loaded only inside the rollback transaction by the database test runner.
-- $owner resolves to each function's catalog owner, never a hardcoded login.
CREATE TEMP TABLE phase1_function_allowlist (
  signature text PRIMARY KEY,
  grantees text[] NOT NULL CHECK (
    '$owner'=ANY(grantees)
    AND NOT grantees && ARRAY['PUBLIC','anon','authenticated','service_role']::text[]
  )
);
INSERT INTO pg_temp.phase1_function_allowlist(signature,grantees) VALUES
 ('public.is_tenant_member(uuid)',ARRAY['$owner','rebatehq_app']),
 ('public.is_tenant_role(uuid,text[])',ARRAY['$owner','rebatehq_app']),
 ('public.is_tenant_role_any_status(uuid,text[])',ARRAY['$owner','rebatehq_app']),
 ('public.audit_row_change()',ARRAY['$owner']),
 ('public.prevent_audit_mutation()',ARRAY['$owner']),
 ('public.create_tenant_with_owner(text)',ARRAY['$owner','rebatehq_app']),
 ('public.accept_tenant_invite(text)',ARRAY['$owner','rebatehq_app']),
 ('public.record_failed_login(text,text,text)',ARRAY['$owner','rebatehq_app']),
 ('public.verified_request_actor()',ARRAY['$owner','rebatehq_app']),
 ('public.append_control_audit(uuid,text,text,text,jsonb,jsonb)',ARRAY['$owner','rebatehq_app']),
 ('public.audit_actor_key_change()',ARRAY['$owner']),
 ('public.control_member(uuid,boolean)',ARRAY['$owner','rebatehq_app']),
 ('public.enforce_licence_limits()',ARRAY['$owner']),
 ('public.invite_licence_limit()',ARRAY['$owner']),
 ('public.relay_allowed(uuid,boolean)',ARRAY['$owner','rebatehq_app']),
 ('public.relay_directory(uuid)',ARRAY['$owner','rebatehq_app']),
 ('public.relay_pack_reader(uuid,text)',ARRAY['$owner','rebatehq_app']),
 ('public.relay_check_insert()',ARRAY['$owner']),
 ('public.bench_owner(uuid,boolean)',ARRAY['$owner','rebatehq_app']),
 ('public.bench_quarter_end(text)',ARRAY['$owner','rebatehq_app']),
 ('public.bench_submit(uuid,bytea,text,text,jsonb)',ARRAY['$owner','rebatehq_app']),
 ('public.bench_withdraw(uuid,bytea[])',ARRAY['$owner','rebatehq_app']),
 ('public.bench_figures(uuid,bytea,text)',ARRAY['$owner','rebatehq_app']),
 ('public.bench_publish(text,numeric,integer)',ARRAY['$owner']);

CREATE TEMP VIEW phase1_public_function_inventory AS
SELECT p.oid,p.proowner,p.prosecdef,p.proacl,
       format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes)) AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public';

CREATE TEMP VIEW phase1_function_acl_errors AS
WITH compared AS (
  SELECT f.*,a.signature AS listed_signature,
    ARRAY(SELECT CASE WHEN grantee='$owner' THEN pg_get_userbyid(f.proowner)::text ELSE grantee END
      FROM unnest(a.grantees) grantee ORDER BY 1) AS expected_grantees,
    ARRAY(SELECT CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee)::text END
      FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) acl
      WHERE acl.privilege_type='EXECUTE' ORDER BY 1) AS actual_grantees,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) acl
      WHERE acl.is_grantable AND acl.grantee<>f.proowner) AS extra_grant_option
  FROM pg_temp.phase1_public_function_inventory f
  LEFT JOIN pg_temp.phase1_function_allowlist a ON to_regprocedure(a.signature)=f.oid
)
SELECT oid,signature,prosecdef,expected_grantees,actual_grantees,
  CASE WHEN listed_signature IS NULL THEN 'no allowlist entry'
       WHEN proowner<>current_setting('app.phase1_migration_owner')::regrole THEN 'unexpected owner'
       WHEN extra_grant_option THEN 'unexpected EXECUTE grant option'
       ELSE 'EXECUTE grantees differ' END AS reason
FROM compared
WHERE listed_signature IS NULL OR expected_grantees IS DISTINCT FROM actual_grantees
  OR proowner<>current_setting('app.phase1_migration_owner')::regrole OR extra_grant_option
UNION ALL
SELECT NULL::oid,a.signature,NULL::boolean,a.grantees,ARRAY[]::text[],'allowlisted function missing'
FROM pg_temp.phase1_function_allowlist a
WHERE NOT EXISTS(SELECT 1 FROM pg_temp.phase1_public_function_inventory f WHERE f.oid=to_regprocedure(a.signature));
