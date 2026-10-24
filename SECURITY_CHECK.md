# MarginDesk Phase 1 security verification

**Status as of 2026-10-25:** no passing GitHub Actions run link is available yet. Every CI acceptance item below is **unverified** until the corresponding workflow run passes. Local source and unit checks have passed, but they are not evidence of PostgreSQL behavior. No result below claims a database test passed unless it ran.

| Acceptance item | Status | Evidence required to mark verified |
|---|---|---|
| App pool login is non-superuser and has no `BYPASSRLS` | **unverified** | Passing `MarginDesk CI` link/date and `pnpm check:db-role` output |
| Request without authenticated context sees zero tenant rows | **unverified** | Passing `MarginDesk CI` link/date and runtime-role check |
| RLS select/insert/update/delete tenant isolation | **unverified** | Passing `pnpm test:db` pgTAP output against Postgres |
| Audit log rejects app-role UPDATE and DELETE | **unverified** | Passing `pnpm test:db` pgTAP output against Postgres |
| Rep response redaction and no self-approval | **unverified** (local unit tests passed) | Passing `MarginDesk CI` link/date |
| No user-facing service-role credential use | **unverified** (local source scan passed) | Passing `MarginDesk CI` link/date and scan output |
| Backup/restore dump, fresh target, sentinel, and post-restore tests | **unverified** | Passing `MarginDesk Restore Drill` link/date and job summary |

### Current pgTAP check ledger

The latest reported CI run had 34/37 checks pass and is not a passing run. This change expands the suite to 41 checks, so every check below remains **unverified** until a green PostgreSQL 17 CI run is linked. The test runner prints live `pg_policies` rows whose expressions reference `auth.*` and executable `pg_proc` entries whose definitions reference it, including `prosecdef` and `search_path`. The SQL suite evaluates an `auth.uid()`-dependent customer policy as `margindesk_app` without auth schema USAGE, then probes the app role's EXECUTE grant inside a savepoint and rolls back.

| # | Check | What it proves | Status / CI evidence |
|---:|---|---|---|
| 1 | Every application table has `tenant_id` | Tenant key coverage | **unverified** |
| 2 | RLS enabled and forced on every application table | Owners cannot bypass table policies | **unverified** |
| 3 | `margindesk_app` is NOLOGIN/NOSUPERUSER/NOBYPASSRLS | Restricted role attributes | **unverified** |
| 4 | Browser role has no direct product SELECT grant | Browser roles cannot query product tables directly | **unverified** |
| 5 | App role has `public` schema USAGE | Public objects resolve for the app role | **unverified** |
| 6 | App role has NO `auth` schema USAGE | No app-pool SQL path needs schema resolution | **unverified** |
| 7 | App role has no table privileges in `auth` | Auth rows stay inaccessible even with function EXECUTE | **unverified** |
| 8 | App role has PL/pgSQL USAGE | Role can execute the restricted test blocks | **unverified** |
| 9 | App role can EXECUTE `auth.uid()` | The specific Auth helper is callable | **unverified** |
| 10 | App role can EXECUTE `is_tenant_member(uuid)` | Membership policy helper is callable | **unverified** |
| 11 | App role can EXECUTE `is_tenant_role(uuid,text[])` | Role policy helper is callable | **unverified** |
| 12 | App role can EXECUTE `is_tenant_role_any_status(uuid,text[])` | Deleted-tenant policy helper is callable | **unverified** |
| 13 | Required per-table ACLs exist | RLS checks are not masked by missing table grants | **unverified** |
| 14 | Audit log has no app/PUBLIC UPDATE, DELETE, or TRUNCATE | Audit mutation ACLs are absent | **unverified** |
| 15 | PUBLIC has no tenant-table write/TRUNCATE grants | No implicit public write access | **unverified** |
| 16 | App lacks tenant/membership writes forbidden by policy | ACLs do not exceed those policy operations | **unverified** |
| 17 | App has no tenant-table TRUNCATE | RLS cannot be bypassed with TRUNCATE | **unverified** |
| 18 | Effective role flags captured after `SET ROLE` | Session is actually restricted and non-bypass | **unverified** |
| 19 | Assigned-rep customer policy evaluates `auth.uid()` | Stored policy evaluation works without schema USAGE | **unverified** |
| 20 | Tenant A SELECTs its own row from every table | Positive read control for all tenant tables | **unverified** |
| 21 | Tenant A INSERT succeeds per allowed table | Positive insert controls prevent vacuous denials; failures name the table | **unverified** |
| 22 | Tenant A UPDATEs its own customer row | Positive control for an allowed UPDATE policy | **unverified** |
| 23 | Tenant A DELETEs its own inserted customer row | Positive control for an allowed DELETE policy | **unverified** |
| 24 | Rep sees a product but cannot DELETE it | Policy-forbidden role denial with visible target | **unverified** |
| 25 | Tenant A cannot SELECT Tenant B rows | Cross-tenant reads return zero rows | **unverified** |
| 26 | Tenant A cross-tenant UPDATE is rejected by RLS | WITH CHECK emits the RLS violation, not ACL denial | **unverified** |
| 27 | Tenant A cross-tenant DELETE affects zero rows | RLS filters inaccessible target rows | **unverified** |
| 28 | Tenant A cross-tenant INSERT is rejected by RLS | WITH CHECK emits the RLS violation, not ACL denial | **unverified** |
| 29 | Quote creator cannot approve own quote | Self-approval remains blocked | **unverified** |
| 30 | Rep cannot read audit log | Audit reads remain owner/manager-only | **unverified** |
| 31 | Missing user context sees zero tenant rows | RLS fails closed without JWT subject | **unverified** |
| 32 | App role cannot UPDATE audit log | ACL denial protects append-only rows | **unverified** |
| 33 | App role cannot DELETE audit log | ACL denial protects append-only rows | **unverified** |
| 34 | App role cannot TRUNCATE audit log | ACL denial protects the whole table | **unverified** |
| 35 | Elevated UPDATE hits immutability trigger | Database trigger blocks privileged mutation | **unverified** |
| 36 | Elevated DELETE hits immutability trigger | Database trigger blocks privileged mutation | **unverified** |
| 37 | Elevated TRUNCATE hits statement trigger | Database trigger blocks privileged truncation | **unverified** |
| 38 | App role cannot directly insert null-tenant failed-login audit row | No direct app write path for null-tenant audit events | **unverified** |
| 39 | `record_failed_login` writes the null-tenant event | The SECURITY DEFINER function is the controlled failed-login path | **unverified** |
| 40 | With PUBLIC EXECUTE revoked, app policy query still succeeds | The app role's own `auth.uid()` EXECUTE grant is sufficient | **unverified** |
| 41 | Revoking app EXECUTE makes that policy query fail | The app-role EXECUTE grant is necessary; rollback restores it | **unverified** |

No check is marked verified because no passing run link/date is available.

## 1. Connection role and RLS context

### Which role does the app pool use?

`APP_DATABASE_URL` is the PostgreSQL login used by the `pg.Pool` in [`lib/db.ts`](./lib/db.ts). The login must be a dedicated non-superuser role that is a member of `margindesk_app`. Each request transaction then runs `SET LOCAL ROLE margindesk_app`, so SQL statements execute under that restricted role while `session_user` continues to identify the login used by the pool. Separately, `scripts/test-db.ts` connects with `TEST_DATABASE_URL`; CI sets it from the disposable local Supabase `DB_URL`. The setup script grants this test login membership in `margindesk_app` only on the disposable test database, using `WITH INHERIT FALSE, SET TRUE` on PostgreSQL 16+ (the Supabase config currently selects PostgreSQL 17). It logs the live server major version and test-login `LOGIN`, `SUPERUSER`, and `BYPASSRLS` attributes without logging connection credentials. Those live values remain **unverified** until a passing CI run.

The migration creates `margindesk_app` as `NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`. Before assuming the app role, `withDatabase` checks the actual `session_user` in `pg_roles` and rejects a login with `rolsuper=true`, `rolbypassrls=true`, or no membership in `margindesk_app`. [`scripts/check-app-db-role.ts`](./scripts/check-app-db-role.ts) checks both the pool login and effective role. The pgTAP suite captures `current_user`, `rolsuper`, and `rolbypassrls` while `margindesk_app` is active, captures isolation and expected-error results in transaction-local settings, and issues `RESET ROLE`. It then evaluates those captured values with pgTAP as the test connection role. The app role no longer calls pgTAP in `extensions` or reads fixture tables in `pg_temp`; no extension-schema or temporary-table grants were added. `test-db.ts` now reports the installed pgTAP schema and extension/schema owners plus the test-login and app-role schema/function access flags. The prior CI output did not include an SQL position or extension-owner query, so the exact failing statement and owner remain **unverified** until the instrumented suite runs in CI.

Evidence command to run over the same connection string configured as `APP_DATABASE_URL`:

```sql
BEGIN;
SET LOCAL ROLE margindesk_app;
SELECT session_user AS pool_login, current_user AS effective_role,
       login.rolsuper AS login_is_superuser,
       login.rolbypassrls AS login_bypasses_rls,
       app.rolsuper AS app_is_superuser,
       app.rolbypassrls AS app_bypasses_rls,
       pg_has_role(session_user, 'margindesk_app', 'member') AS login_is_app_member
FROM pg_roles AS login
JOIN pg_roles AS app ON app.rolname=current_user
WHERE login.rolname=session_user;
ROLLBACK;
```

Expected: `effective_role=margindesk_app`; both superuser and bypass columns are false; `login_is_app_member=true`. CI evidence is **unverified** until `pnpm check:db-role` passes against Postgres and its run link/date is recorded above.

### How is the authenticated request context applied?

[`lib/db.ts`](./lib/db.ts) performs these operations in one transaction, in order:

1. `BEGIN`.
2. Validate the PostgreSQL login role flags and membership.
3. `SET LOCAL ROLE margindesk_app`.
4. Set transaction-local `request.jwt.claim.sub`, `request.jwt.claim.role`, and `request.jwt.claims` from the user ID returned by Supabase Auth’s verified `getUser()` call. The claims are cleared at transaction end.
5. Set `app.real_actor_id`, client IP, and user agent for audit triggers.
6. Run the tenant query and commit; errors roll the transaction back.

RLS helpers use `auth.uid()` and active membership checks. The database integration test clears the user subject and JWT claims and asserts that a `product` query returns zero rows; the runtime check similarly asserts zero visible tenants with `withDatabase({})`. Both database assertions are **unverified** until a passing CI database run is linked above.

### Auth privilege decision

The application-code search found no direct SQL call to `auth.*` through the app pool, server library, or API routes. `scripts/seed-demo.ts` reads `auth.users` only through its `SEED_DATABASE_URL` administrative pool; its application import runs separately through `withDatabase`. Calls such as `supabase.auth.getUser()` use the Supabase Auth client and are not SQL access to the `auth` schema. Therefore the app role does **not** receive `USAGE` on schema `auth`; check 6 asserts its absence and check 7 asserts it has no Auth-table privileges.

Stored RLS expressions do reference `auth.uid()`, but PostgreSQL evaluates their stored function reference without requiring schema USAGE at query time. The app role does need EXECUTE on the function. Check 19 proves that a rep can see its assigned customer through the RLS policy with auth schema USAGE absent. Checks 40–41 revoke PUBLIC EXECUTE and then the app grant inside a savepoint: policy evaluation succeeds with only the app grant, fails with SQLSTATE `42501` after that grant is revoked, and the savepoint rollback restores the original ACL. The migration grants only `EXECUTE ON FUNCTION auth.uid()` to `margindesk_app` and does not grant auth schema USAGE.

The current migration's auth-referencing policy inventory (the runner prints the live catalog inventory in CI) is `membership_select`, `customer_select`, `quote_select`, `quote_insert`, `quote_delete`, `quote_update`, `quote_line_select`, `quote_line_insert`, `quote_line_update`, `quote_line_delete`, `approval_select`, `approval_insert`, `approval_update`, `sales_order_select`, and `audit_log_append`. Some also call `public.is_tenant_*` helpers that read `auth.uid()`. These stored policy expressions do not cause the app role to issue a schema-qualified `auth.uid()` SQL call.

Executable public functions whose definitions reference `auth.*` are `is_tenant_member(uuid)`, `is_tenant_role(uuid,text[])`, `is_tenant_role_any_status(uuid,text[])`, `create_tenant_with_owner(text)`, `accept_tenant_invite(text)`, and `record_failed_login(text,text,text)`. Each is `SECURITY DEFINER` with pinned `search_path=public,extensions,pg_temp`. `auth.uid()` is an invoker function with no pinned search path. The policy inventory and the probe show that its stored OID can be evaluated without auth schema USAGE, while the app role's explicit EXECUTE privilege is required. This decision follows the absence of direct app-pool SQL calls; checks 6, 7, 9, 19, 40, and 41 remain **unverified** pending CI.

### Is the Supabase service-role key used by user-facing code?

No user-facing source path should reference a service-role credential. Supabase SSR uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; SQL uses the restricted `APP_DATABASE_URL`. `pnpm test` runs [`scripts/check-service-role.mjs`](./scripts/check-service-role.mjs), which scans the present app, components, and library directories, any present conventional client-source directories, text-based public assets, and root browser/prototype files. It warns when an optional source directory is absent and fails if it finds no files. The tracked `legacy/` path contains only an empty `.gitkeep` placeholder and is not shipped source. The local scan passed and checked 86 user-facing files; CI status is **unverified** pending a passing `MarginDesk CI` run. This source scan does not substitute for keeping secrets out of deployment configuration and logs.

## 2. Tenant isolation across public tables

[`supabase/tests/phase1_rls.sql`](./supabase/tests/phase1_rls.sql) creates fixture rows for both tenants in every current application-owned public table with `tenant_id`. Tenant A fixtures are cloned in FK order with tenant-local IDs and references, and complete row snapshots pass into the restricted-role section through transaction-local settings; the app role needs no temporary-schema grant. Named pgTAP checks separately identify missing schema USAGE, PL/pgSQL USAGE, helper EXECUTE, and each missing table operation. Dynamic loops exercise every application-owned public base table and fail if:

- any table is missing `tenant_id`, enabled RLS, or forced RLS;
- Tenant A can select, update, or delete a Tenant B row;
- Tenant A cannot move an A-visible row to Tenant B or insert a Tenant B row; both must fail with SQLSTATE `42501` and an error message identifying the RLS policy, not a table permission denial;
- Tenant A can select its own seeded row in every tenant table and can insert on every table whose RLS policy allows INSERT; it also updates its own customer and deletes its own inserted customer; a rep can see but cannot delete a product under the analyst/manager-only DELETE policy; missing grants or policy failures are reported by table name;
- Tenant A cannot use TRUNCATE, and Tenant B deletes remain RLS-filtered to zero rows (PostgreSQL DELETE policies filter rows instead of raising an exception);
- a request with no authenticated user context can see tenant data.

The restricted test section touches only `public` tenant tables, `auth.uid()`, the public membership/role helpers, `pg_catalog` views and built-ins, and transaction-local request/test settings. Before role switching, the suite checks `USAGE` on `public` and `auth`, confirms there are no `auth` table grants, checks `EXECUTE` on `auth.uid()` and each policy helper, checks `USAGE` on `plpgsql` for its `DO` blocks, and verifies required per-table grants. It does not read `pg_temp`, invoke pgTAP, or use sequences while acting as `margindesk_app`. The test login handles fixture setup and pgTAP; the app role performs only the policy operations under test. These checks have not run against PostgreSQL locally because Docker and `psql` are unavailable.

The migration also checks tenant columns and forced RLS during installation. `pnpm test` runs [`scripts/check-schema.mjs`](./scripts/check-schema.mjs), which statically checks every migration for duplicate policies, triggers, indexes, function signatures, and named constraints; missing tenant-table FORCE RLS; and audit SELECT policies broader than owners/managers. Fixture tests exercise each failure case. These local static checks pass, but applying the migration to a clean Supabase database and the Postgres integration suite remain **unverified** until a passing CI run is linked above; see [`README.md`](./README.md) for CI/local commands.

## 3. Append-only audit log

The migration installs a row-level `BEFORE UPDATE OR DELETE` trigger and a statement-level `BEFORE TRUNCATE` trigger. This is necessary because TRUNCATE bypasses row triggers and RLS. `margindesk_app` receives only `SELECT` and `INSERT` on `audit_log`; UPDATE, DELETE, and TRUNCATE are revoked, and PUBLIC receives no write or TRUNCATE grant on tenant tables. Table grants on other tenant tables match operations allowed by at least one RLS policy. pgTAP checks app-role ACL denial and exercises the elevated-role update/delete/truncate triggers. Production migrations must never grant membership in `margindesk_app` to a login; `pnpm check:schema` rejects that statement, with a fixture proving the check fails. Database execution remains **unverified** until `pnpm test:db` passes in CI and the run link/date is added above.

## 4. Rep API redaction and self-approval

`assertRepResponseSafe` in [`lib/rep-response.ts`](./lib/rep-response.ts) fails closed if a rep payload contains cost fields/components or dollar-margin fields. It is applied to every rep-accessible workspace data API:

| Rep-accessible method | Response guard |
|---|---|
| `GET /api/customers` | checked |
| `GET /api/products` | checked |
| `GET /api/quotes` | checked |
| `POST /api/quotes` | checked |
| `POST /api/quotes/:quoteId/send` | checked |
| `GET /api/policy` | checked; percentage guardrails remain available, no margin dollars |
| `GET /api/search` | checked |
| `POST /api/tenant/switch` | checked; returns only `{ok:true}` |

The TypeScript test verifies each route uses the guard and that representative safe payloads pass while cost, freight/terms cost components, COGS, pocket price/margin, and margin-dollar fields fail. Reps do not have `quotes.approve`; [`lib/quote-approval.ts`](./lib/quote-approval.ts) rejects the quote creator, and the SQL test also attempts an own-approval update under RLS. Local unit checks pass; CI status and the SQL approval-policy test are **unverified** until a passing run is linked above.

## Verification commands and current results

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm exec supabase start -x studio,edge-runtime,storage-api,imgproxy,logflare,vector
pnpm exec supabase db reset
$env:SEED_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
pnpm setup:test-db-role
# Copy the APP_DATABASE_URL assignment printed by setup into this PowerShell session.
pnpm check:db-role
pnpm test:db
```

In this workspace, `pnpm test` passed (28 tests), `pnpm typecheck` passed, and `pnpm build` passed. The migration lint fixtures cover duplicate policies (including a policy generated by a loop), triggers, indexes, function signatures, named constraints, missing FORCE RLS, and an overly broad audit SELECT policy. The service-role scanner checked 86 user-facing files, and its fixture tests reject a client file containing the service-role environment key and an empty scan. A temporary PGlite smoke runner applied the migration and executed all 41 SQL checks with minimal Supabase Auth and pgTAP stubs; all emitted `ok`, including the no-auth-schema-USAGE policy test, the app-only EXECUTE probe, per-table unique INSERT controls, and the controlled failed-login audit path. This does **not** count as database verification because PGlite and the pgTAP stubs are not the PostgreSQL 17/Supabase CI environment. Docker and `psql` are unavailable, and the fresh `pnpm test:db` attempt stopped before SQL with `ECONNREFUSED 127.0.0.1:54322`. The hosted CI path has not run. The runtime role, SQL RLS/ACL/audit/approval/TRUNCATE checks, clean-database migration application, and restore drill remain **unverified**; no CI run link/date is available to record.
