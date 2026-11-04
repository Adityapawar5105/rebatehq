-- Restore-only procedure, not a migration. Run AFTER the schema dump and its
-- GRANT statements, BEFORE data. Preserve all intended application grants.
-- Object ownership comes from the restored tenant tables; extension members
-- and objects owned by platform roles are never modified. No function list.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $cleanup$
DECLARE
  v_owner record;
  v_object record;
  v_acl record;
  v_default record;
  v_banned oid[];
  v_owner_count integer:=0;
  v_scope text;
  v_kind text;
BEGIN
  IF to_regclass('public.tenant') IS NULL OR to_regrole('rebatehq_app') IS NULL
    OR to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Restore cleanup requires restored application schema/role and Supabase platform roles';
  END IF;
  v_banned:=ARRAY[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid];
  FOR v_owner IN
    SELECT DISTINCT r.oid,r.rolname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  LOOP
    v_owner_count:=v_owner_count+1;
    IF v_owner.rolname LIKE 'supabase_%' OR v_owner.rolname IN ('anon','authenticated','service_role','authenticator','dashboard_user','rebatehq_app') THEN
      RAISE EXCEPTION 'Unexpected platform/application login owner % for application tables; refusing cleanup',v_owner.rolname;
    END IF;
    IF v_owner.rolname<>current_user AND NOT pg_has_role(current_user,v_owner.oid,'MEMBER') THEN
      RAISE EXCEPTION 'Restore role % cannot clean ACLs owned by %',current_user,v_owner.rolname;
    END IF;
    FOR v_object IN
      SELECT c.oid,c.relname,c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relowner=v_owner.oid AND c.relkind IN ('r','p','S','v','m','f')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    LOOP
      v_kind:=CASE WHEN v_object.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END;
      FOR v_acl IN
        SELECT DISTINCT a.grantee,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE c.oid=v_object.oid AND a.grantee=ANY(v_banned)
      LOOP
        RAISE NOTICE 'Restore cleanup: REVOKE ALL ON % public.% FROM %',v_kind,v_object.relname,v_acl.grantee_sql;
        EXECUTE format('REVOKE ALL ON %s public.%I FROM %s',v_kind,v_object.relname,v_acl.grantee_sql);
      END LOOP;
      FOR v_acl IN
        SELECT DISTINCT a.attname,x.privilege_type,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
        FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee
        WHERE a.attrelid=v_object.oid AND a.attnum>0 AND NOT a.attisdropped AND x.grantee=ANY(v_banned)
      LOOP
        EXECUTE format('REVOKE %s (%I) ON TABLE public.%I FROM %s',v_acl.privilege_type,v_acl.attname,v_object.relname,v_acl.grantee_sql);
      END LOOP;
    END LOOP;
    FOR v_object IN
      SELECT p.oid,p.proname,p.prokind,pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proowner=v_owner.oid
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
    LOOP
      FOR v_acl IN
        SELECT DISTINCT a.grantee,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE p.oid=v_object.oid AND a.grantee=ANY(v_banned)
      LOOP
        RAISE NOTICE 'Restore cleanup: REVOKE ALL ON FUNCTION public.%(%) FROM %',v_object.proname,v_object.args,v_acl.grantee_sql;
        EXECUTE format('REVOKE ALL ON %s public.%I(%s) FROM %s',CASE WHEN v_object.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,v_object.proname,v_object.args,v_acl.grantee_sql);
      END LOOP;
    END LOOP;
    FOR v_default IN
      SELECT DISTINCT d.defaclnamespace,d.defaclobjtype,a.grantee,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee_sql
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee
      WHERE d.defaclrole=v_owner.oid AND d.defaclnamespace IN (0,'public'::regnamespace)
        AND d.defaclobjtype IN ('r','S','f') AND a.grantee=ANY(v_banned)
    LOOP
      v_scope:=CASE WHEN v_default.defaclnamespace=0 THEN '' ELSE ' IN SCHEMA public' END;
      v_kind:=CASE v_default.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE 'FUNCTIONS' END;
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM %s',v_owner.rolname,v_scope,v_kind,v_default.grantee_sql);
    END LOOP;
    -- A missing global function ACL means PostgreSQL's implicit PUBLIC EXECUTE
    -- applies. Schema-local REVOKE cannot cancel that built-in global default.
    IF NOT EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole=v_owner.oid AND defaclnamespace=0 AND defaclobjtype='f') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',v_owner.rolname);
    END IF;
  END LOOP;
  IF v_owner_count=0 THEN RAISE EXCEPTION 'Restore cleanup found no application owners'; END IF;
END $cleanup$;
COMMIT;
