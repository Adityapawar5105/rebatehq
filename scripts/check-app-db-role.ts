import assert from "node:assert/strict";
import { closeDatabasePool, withDatabase } from "@/lib/db";

async function main() {
try {
  const result = await withDatabase({}, async db => (await db.query<{
    login_role: string; active_role: string; login_super: boolean; login_bypass: boolean;
    app_super: boolean; app_bypass: boolean; app_member: boolean; visible_tenants: number;
  }>(`SELECT session_user::text AS login_role,current_user::text AS active_role,
        login.rolsuper AS login_super,login.rolbypassrls AS login_bypass,
        app.rolsuper AS app_super,app.rolbypassrls AS app_bypass,
        pg_has_role(session_user,'rebatehq_app','member') AS app_member,
        (SELECT count(*)::int FROM public.tenant) AS visible_tenants
      FROM pg_roles login JOIN pg_roles app ON app.rolname=current_user
      WHERE login.rolname=session_user`)).rows[0]);
  assert.ok(result, "The restricted database login metadata is visible.");
  assert.equal(result.active_role, "rebatehq_app");
  assert.equal(result.login_super, false);
  assert.equal(result.login_bypass, false);
  assert.equal(result.app_super, false);
  assert.equal(result.app_bypass, false);
  assert.equal(result.app_member, true);
  assert.equal(result.visible_tenants, 0, "A database request with no verified auth user sees no tenants.");
  process.stdout.write(`PASS: pool login ${result.login_role} is NOSUPERUSER/NOBYPASSRLS, assumes rebatehq_app, and an unauthenticated transaction sees zero tenant rows.\n`);
} finally {
  await closeDatabasePool();
}
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Database role check failed."}\n`);
  process.exitCode = 1;
});
