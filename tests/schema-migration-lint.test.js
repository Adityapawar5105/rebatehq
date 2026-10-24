const assert = require("node:assert/strict");
const test = require("node:test");

function validMigration() {
  return `
CREATE TABLE public.customer (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL
);
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY,
  tenant_id uuid
);
ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['customer','audit_log'] LOOP
    NULL;
  END LOOP;
END $$;
CREATE POLICY customer_select ON public.customer FOR SELECT TO margindesk_app USING (true);
CREATE POLICY customer_insert ON public.customer FOR INSERT TO margindesk_app WITH CHECK (true);
CREATE POLICY customer_update ON public.customer FOR UPDATE TO margindesk_app USING (true) WITH CHECK (true);
CREATE POLICY customer_delete ON public.customer FOR DELETE TO margindesk_app USING (true);
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO margindesk_app USING (public.is_tenant_role(tenant_id,ARRAY['owner','manager']));
CREATE POLICY audit_log_append ON public.audit_log FOR INSERT TO PUBLIC WITH CHECK (true);
CREATE FUNCTION public.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
REVOKE UPDATE,DELETE,TRUNCATE ON audit_log FROM margindesk_app;
`;
}

async function assertLintFailure(sql, expected) {
  const { lintMigrationSet } = await import("../scripts/check-schema.mjs");
  const { errors } = lintMigrationSet([{ name: "fixture.sql", sql }]);
  assert.ok(errors.some(error => expected.test(error)), `Expected ${expected} in:\n${errors.join("\n")}`);
}

test("migration lint catches duplicate policies expanded from a loop", async () => {
  const sql = `${validMigration()}
DO $$ DECLARE t text; sel text := 'public.is_tenant_member(tenant_id)'; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO margindesk_app USING (%s)',t||'_select',t,sel);
  END LOOP;
END $$;
`;
  await assertLintFailure(sql, /Duplicate CREATE POLICY: audit_log_select on audit_log/);
});

test("migration lint catches duplicate triggers", async () => {
  const sql = `${validMigration()}
CREATE TRIGGER duplicate_trigger BEFORE UPDATE ON public.customer FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
CREATE TRIGGER duplicate_trigger AFTER INSERT ON public.customer FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
`;
  await assertLintFailure(sql, /Duplicate CREATE TRIGGER/);
});

test("migration lint catches duplicate index names", async () => {
  const sql = `${validMigration()}
CREATE INDEX repeated_index ON public.customer (tenant_id);
CREATE INDEX repeated_index ON public.audit_log (tenant_id);
`;
  await assertLintFailure(sql, /Duplicate CREATE INDEX/);
});

test("migration lint catches duplicate named constraints", async () => {
  const sql = `${validMigration()}
CREATE TABLE public.constraint_fixture (
  tenant_id uuid,
  CONSTRAINT repeated_constraint CHECK (tenant_id IS NOT NULL),
  CONSTRAINT repeated_constraint CHECK (tenant_id IS NOT NULL)
);
`;
  await assertLintFailure(sql, /Duplicate CREATE CONSTRAINT/);
});

test("migration lint catches duplicate function signatures", async () => {
  const sql = `${validMigration()}
CREATE FUNCTION public.duplicate_function(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.duplicate_function(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`;
  await assertLintFailure(sql, /Duplicate CREATE FUNCTION/);
});

test("migration lint requires FORCE ROW LEVEL SECURITY on every tenant table", async () => {
  const sql = validMigration().replace("ALTER TABLE public.customer FORCE ROW LEVEL SECURITY;\n", "");
  await assertLintFailure(sql, /customer lacks FORCE ROW LEVEL SECURITY/);
});

test("migration lint rejects audit SELECT policies broader than owners and managers", async () => {
  const sql = validMigration().replace(
    "ARRAY['owner','manager']));",
    "ARRAY['owner','manager','analyst']));",
  );
  await assertLintFailure(sql, /audit_log SELECT policy audit_log_select is not owner\/manager-only/);
});

test("migration lint rejects grants of margindesk_app membership", async () => {
  await assertLintFailure(`${validMigration()}\nGRANT margindesk_app TO postgres;`, /grants membership in margindesk_app/);
  await assertLintFailure(`${validMigration()}\nGRANT "margindesk_app" TO postgres;`, /grants membership in margindesk_app/);
});

test("migration lint rejects privilege changes on Supabase-managed schemas", async () => {
  for (const statement of [
    "GRANT EXECUTE ON FUNCTION auth.uid() TO margindesk_app;",
    "REVOKE SELECT ON storage.objects FROM authenticated;",
    "GRANT USAGE ON SCHEMA extensions TO margindesk_app;",
  ]) {
    await assertLintFailure(`${validMigration()}\n${statement}`, /Supabase-managed auth, storage, or extensions/);
  }
});
