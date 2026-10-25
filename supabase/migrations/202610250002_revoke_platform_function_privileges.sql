BEGIN;

-- Tighten every public function owned by the role applying this migration.
-- Application API/policy functions have an explicit margindesk_app allowlist;
-- trigger functions remain executable only by their owner.
SET LOCAL search_path = pg_catalog, public;

DO $$
DECLARE
  v_migration_owner oid := (SELECT oid FROM pg_roles WHERE rolname=current_user);
  v_app_role oid := to_regrole('margindesk_app');
  v_anon oid := to_regrole('anon');
  v_authenticated oid := to_regrole('authenticated');
  v_service_role oid := to_regrole('service_role');
  v_function record;
  v_acl record;
  v_owner record;
  v_default record;
  v_signature text;
  v_grantee_sql text;
  v_scope_sql text;
  v_function_count integer;
BEGIN
  IF v_migration_owner IS NULL OR v_app_role IS NULL OR v_anon IS NULL
     OR v_authenticated IS NULL OR v_service_role IS NULL THEN
    RAISE EXCEPTION 'Migration requires its owner plus margindesk_app, anon, authenticated, and service_role';
  END IF;

  -- Keep this explicit inventory in sync with the pgTAP allowlist. A function
  -- not listed here stays owner-only; the tests fail if a new app function is
  -- added without a reviewed per-function entry.
  IF to_regprocedure('public.is_tenant_member(uuid)') IS NULL
     OR to_regprocedure('public.is_tenant_role(uuid,text[])') IS NULL
     OR to_regprocedure('public.is_tenant_role_any_status(uuid,text[])') IS NULL
     OR to_regprocedure('public.audit_row_change()') IS NULL
     OR to_regprocedure('public.prevent_audit_mutation()') IS NULL
     OR to_regprocedure('public.create_tenant_with_owner(text)') IS NULL
     OR to_regprocedure('public.accept_tenant_invite(text)') IS NULL
     OR to_regprocedure('public.record_failed_login(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Expected public application function is missing; update the explicit function ACL allowlist';
  END IF;

  SELECT count(*) INTO v_function_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proowner=v_migration_owner;
  IF v_function_count < 8 THEN
    RAISE EXCEPTION 'Expected at least 8 public functions owned by migration role %, found %',current_user,v_function_count;
  END IF;

  FOR v_function IN
    SELECT p.oid,p.proowner,p.proname,
           p.oid IN (
             'public.is_tenant_member(uuid)'::regprocedure,
             'public.is_tenant_role(uuid,text[])'::regprocedure,
             'public.is_tenant_role_any_status(uuid,text[])'::regprocedure,
             'public.create_tenant_with_owner(text)'::regprocedure,
             'public.accept_tenant_invite(text)'::regprocedure,
             'public.record_failed_login(text,text,text)'::regprocedure
           ) AS app_allowed
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proowner=v_migration_owner
    ORDER BY p.oid::regprocedure::text
  LOOP
    v_signature:=v_function.oid::regprocedure::text;
    IF position('.' IN v_signature)=0 THEN
      v_signature:='public.'||v_signature;
    END IF;

    -- Revoke each existing non-owner grantee exactly once. This includes the
    -- Supabase roles, PUBLIC, and any unexpected direct grantee. The app role
    -- remains only on the six functions it calls; trigger functions are owner-only.
    FOR v_acl IN
      SELECT DISTINCT acl.grantee,
             CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(grantee_role.rolname) END AS grantee_sql
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
      WHERE p.oid=v_function.oid AND acl.privilege_type='EXECUTE'
        AND acl.grantee<>v_migration_owner
        AND (acl.grantee<>v_app_role OR NOT v_function.app_allowed)
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',v_signature,v_acl.grantee_sql);
    END LOOP;

    IF v_function.app_allowed AND NOT EXISTS (
      SELECT 1 FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=v_function.oid AND acl.grantee=v_app_role AND acl.privilege_type='EXECUTE'
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',v_signature,'margindesk_app');
    END IF;
  END LOOP;

  -- Restrict future public functions for roles that own application tables,
  -- their sequences, or the public functions being secured above.
  FOR v_owner IN
    SELECT DISTINCT owner_role.oid,owner_role.rolname
    FROM (
      SELECT c.relowner AS owner_oid
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
      UNION
      SELECT seq_class.relowner
      FROM pg_class seq_class JOIN pg_namespace sequence_schema ON sequence_schema.oid=seq_class.relnamespace
      JOIN pg_depend dependency ON dependency.classid='pg_class'::regclass AND dependency.objid=seq_class.oid
        AND dependency.refclassid='pg_class'::regclass AND dependency.deptype IN ('a','i')
      JOIN pg_class app_table ON app_table.oid=dependency.refobjid
      JOIN pg_namespace app_schema ON app_schema.oid=app_table.relnamespace
      WHERE sequence_schema.nspname='public' AND seq_class.relkind='S' AND app_schema.nspname='public'
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=app_table.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
      UNION
      SELECT p.proowner
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proowner=v_migration_owner
    ) application_owners
    JOIN pg_roles owner_role ON owner_role.oid=application_owners.owner_oid
    ORDER BY owner_role.rolname
  LOOP
    IF v_owner.oid<>v_migration_owner AND NOT pg_has_role(current_user,v_owner.oid,'MEMBER') THEN
      RAISE EXCEPTION 'Migration role % cannot change default privileges for application object owner %',current_user,v_owner.rolname;
    END IF;

    FOR v_default IN
      SELECT DISTINCT d.defaclnamespace,acl.grantee,
             CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(grantee_role.rolname) END AS grantee_sql
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace IN (0,'public'::regnamespace)
        AND d.defaclobjtype='f' AND acl.privilege_type='EXECUTE'
        AND acl.grantee<>v_owner.oid
    LOOP
      v_scope_sql:=CASE WHEN v_default.defaclnamespace=0 THEN '' ELSE ' IN SCHEMA public' END;
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE EXECUTE ON FUNCTIONS FROM %s',
        v_owner.rolname,v_scope_sql,v_default.grantee_sql
      );
    END LOOP;

    -- The built-in default grants EXECUTE to PUBLIC when there is no explicit
    -- global function ACL. Remove that inherited grant for future functions.
    IF NOT EXISTS (
      SELECT 1 FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'
        AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_default_acl d
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'
    ) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',v_owner.rolname);
    END IF;
  END LOOP;
END $$;

COMMIT;
