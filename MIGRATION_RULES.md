# Migration rules

Applied migrations are immutable. The passing Phase 1 baseline is recorded in [`migrations.lock`](./migrations.lock) from [MarginDesk CI #14](https://github.com/Adityapawar5105/rebatehq/actions/runs/40137557258) on 2026-10-24. Add schema changes in a new, timestamped SQL migration. Never edit a locked migration. When a new migration has passed CI and is applied, add its SHA-256 to `migrations.lock` and advance `appliedThrough` in a follow-up change.

Every new application table must:

- include `tenant_id uuid` (nullable only when its data model requires it);
- enable and force row-level security, with policies scoped to the intended roles and tenant;
- be included in the explicit table list used for RLS and audit triggers;
- receive the `audit_row_change` trigger unless it is the append-only `audit_log` table itself;
- have a valid tenant fixture in `supabase/tests/phase1_rls.sql`. The pgTAP harness enumerates every application table in `public`, fails if a fixture is missing, and runs own-tenant positive controls and cross-tenant isolation checks against that set.

Every new function must be created with a pinned `search_path` if it is `SECURITY DEFINER`, followed by an explicit `REVOKE ALL ON FUNCTION ... FROM PUBLIC`. Add only the required role grants with an explicit grantee list; never grant EXECUTE to `PUBLIC`. In the same change, update the single checked-in registry [`config/function-acl-allowlist.sql`](./config/function-acl-allowlist.sql) with its schema-qualified signature (argument types, not argument names) and exact EXECUTE grantees. `$owner` resolves to the catalog owner; it does not hardcode the CI login. The registry covers every public function, including SECURITY INVOKER and trigger functions. The existing pgTAP checks consume this registry and reject unknown or missing functions, unexpected owners, extra or missing grantees, and non-owner EXECUTE grant options. Do not add a second function allowlist to a restore script or test. Keep function default EXECUTE privileges restricted.

Never replay historical migrations over a restored schema. The schema dump already contains the complete migrated definition and intended grants; an old migration's grant list cannot account for functions added later. Use only the restore procedure's platform-grant cleanup, which revokes platform access and preserves the dump's application grants. Source and restored function ACLs must remain exactly equal.

Never GRANT or REVOKE privileges on Supabase-managed `auth`, `storage`, or `extensions` objects. Use a narrowly scoped function in an application-owned schema when the product needs a privileged operation.

Every pull request runs these gates:

- `pnpm check:migrations-lock` checks the SHA-256 of each applied migration;
- `pnpm check:schema` checks duplicate objects, tenant columns, RLS, audit coverage, and the owner/manager-only audit read policy;
- `pnpm test` checks service-role usage and migration/test structure;
- CI applies all migrations with warning capture and fails on ineffective GRANT/REVOKE warnings;
- `pnpm test:db` runs the full pgTAP tenant-isolation, role, audit, and append-only suite against every application table.

Keep every database assertion non-vacuous: provide valid positive fixtures and assert expected RLS failures are policy violations rather than missing table privileges. Do not delete or relax checks to obtain a passing run.
