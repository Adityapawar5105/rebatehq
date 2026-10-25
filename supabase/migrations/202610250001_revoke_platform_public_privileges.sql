BEGIN;

-- Supabase installs broad default grants in public. Application tables are
-- accessed through the restricted server role and RLS, so browser roles and
-- service_role must have no direct table or column privileges.
DO $$
DECLARE
  v_table record;
  v_grantee record;
  v_column record;
  v_owner record;
  v_default record;
  v_grantee_sql text;
  v_scope_sql text;
  v_object_sql text;
  v_table_count integer;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase role anon, authenticated, or service_role is missing';
  END IF;

  SELECT count(*) INTO v_table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');
  IF v_table_count < 24 THEN
    RAISE EXCEPTION 'Expected at least 24 application tenant tables; found %',v_table_count;
  END IF;

  FOR v_table IN
    SELECT c.oid,c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    ORDER BY c.oid
  LOOP
    FOR v_grantee IN
      SELECT DISTINCT acl.grantee,
             CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
      FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
      LEFT JOIN pg_roles r ON r.oid=acl.grantee
      WHERE c.oid=v_table.oid
        AND acl.grantee IN (0,to_regrole('anon')::oid,to_regrole('authenticated')::oid,to_regrole('service_role')::oid)
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %s',v_table.relname,v_grantee.grantee_sql);
    END LOOP;

    FOR v_column IN
      SELECT DISTINCT a.attname,acl.grantee,acl.privilege_type,
             CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
      LEFT JOIN pg_roles r ON r.oid=acl.grantee
      WHERE a.attrelid=v_table.oid AND a.attnum>0 AND NOT a.attisdropped
        AND acl.grantee IN (0,to_regrole('anon')::oid,to_regrole('authenticated')::oid,to_regrole('service_role')::oid)
    LOOP
      EXECUTE format('REVOKE %s (%I) ON TABLE public.%I FROM %s',v_column.privilege_type,v_column.attname,v_table.relname,v_column.grantee_sql);
    END LOOP;
  END LOOP;

  -- Restrict future defaults for every role that owns an application table,
  -- application sequence, or public SECURITY DEFINER function. Revoke only
  -- entries that exist so CI's ignored-privilege warning gate remains strict.
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
      WHERE n.nspname='public'
        AND p.proname=ANY(ARRAY['is_tenant_member','is_tenant_role','is_tenant_role_any_status','audit_row_change','prevent_audit_mutation','create_tenant_with_owner','accept_tenant_invite','record_failed_login'])
    ) object_owners
    JOIN pg_roles owner_role ON owner_role.oid=object_owners.owner_oid
    ORDER BY owner_role.rolname
  LOOP
    IF v_owner.rolname<>current_user AND NOT pg_has_role(current_user,v_owner.oid,'MEMBER') THEN
      RAISE EXCEPTION 'Migration role % cannot change default privileges for application object owner %',current_user,v_owner.rolname;
    END IF;

    FOR v_default IN
      SELECT DISTINCT d.defaclnamespace,d.defaclobjtype,acl.grantee,
             CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident(grantee_role.rolname) END AS grantee_sql
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace IN (0,'public'::regnamespace)
        AND d.defaclobjtype IN ('r','S','f')
        AND acl.grantee IN (0,to_regrole('anon')::oid,to_regrole('authenticated')::oid,to_regrole('service_role')::oid)
    LOOP
      v_scope_sql:=CASE WHEN v_default.defaclnamespace=0 THEN '' ELSE ' IN SCHEMA public' END;
      v_object_sql:=CASE v_default.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS' END;
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %s',v_owner.rolname,v_scope_sql,v_object_sql,v_default.grantee_sql);
    END LOOP;

    -- PostgreSQL grants EXECUTE on new functions to PUBLIC by default unless
    -- an owner-level default ACL has already removed it.
    IF NOT EXISTS (
      SELECT 1 FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'
        AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_default_acl d WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'
    ) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',v_owner.rolname);
    END IF;
  END LOOP;
END $$;

COMMIT;
