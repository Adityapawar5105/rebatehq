# MarginDesk Phase 1 security verification

**Status as of 2026-10-25:** Phase 1 CI passed in [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24. The run completed migration application, runtime role verification, and all 45 pgTAP checks with planned equal to ran. The restore drill remains **unverified**.

| Acceptance item | Status | Evidence required to mark verified |
|---|---|---|
| App pool login is non-superuser and has no `BYPASSRLS` | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | pnpm check:db-role passed |
| Request without authenticated context sees zero tenant rows | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Runtime role check and pgTAP missing-context controls passed |
| RLS select/insert/update/delete tenant isolation | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | All pgTAP isolation and positive-control checks passed |
| Audit log rejects app-role UPDATE and DELETE | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | ACL denials and elevated mutation-trigger checks passed |
| Rep response redaction and no self-approval | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Unit/API guard and database self-approval checks passed |
| No user-facing service-role credential use | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Source scan passed |
| Applied-migration hash lock and expanded future-migration gates | **unverified** | Added after CI #14; awaiting a run that exercises these new checks |
| Backup/restore dump, fresh target, sentinel, and post-restore tests | **unverified** | Restore workflow has not passed |

### Current pgTAP check ledger

The passing PostgreSQL 17 run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24 completed every CI step. The test job passed all 45 pgTAP checks with planned equal to ran. Its auth.uid() diagnostics confirmed the function is owned by supabase_auth_admin and app EXECUTE comes through the Supabase platform PUBLIC grant. The migration makes no ineffective grant/revoke attempt on auth.uid(). Check 42's SECURITY DEFINER ACL allowlist passed after cleanup; all 45 ledger checks are marked with this CI evidence below. The restore drill is tracked separately and remains unverified.

| # | Check | What it proves | Status / CI evidence |
|---:|---|---|---|
| 1 | Every application table has `tenant_id` | Tenant key coverage | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 2 | RLS enabled and forced on every application table | Owners cannot bypass table policies | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 3 | `margindesk_app` is NOLOGIN/NOSUPERUSER/NOBYPASSRLS | Restricted role attributes | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 4 | Browser role has no direct product SELECT grant | Browser roles cannot query product tables directly | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 5 | App role has `public` schema USAGE | Public objects resolve for the app role | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 6 | App role has NO `auth` schema USAGE | No app-pool SQL path needs schema resolution | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 7 | App role has no table privileges in `auth` | Auth rows stay inaccessible even with function EXECUTE | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 8 | App role has PL/pgSQL USAGE | Role can execute the restricted test blocks | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 9 | App role can execute `auth.uid()` through the Supabase platform PUBLIC grant | Effective permission is present and the catalog contains PUBLIC EXECUTE; diagnostic prints owner and full ACL | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 10 | App role can EXECUTE `is_tenant_member(uuid)` | Membership policy helper is callable | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 11 | App role can EXECUTE `is_tenant_role(uuid,text[])` | Role policy helper is callable | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 12 | App role can EXECUTE `is_tenant_role_any_status(uuid,text[])` | Deleted-tenant policy helper is callable | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 13 | Required per-table ACLs exist | RLS checks are not masked by missing table grants | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 14 | Audit log has no app/PUBLIC UPDATE, DELETE, or TRUNCATE | Audit mutation ACLs are absent | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 15 | PUBLIC has no tenant-table write/TRUNCATE grants | No implicit public write access | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 16 | App lacks tenant/membership writes forbidden by policy | ACLs do not exceed those policy operations | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 17 | App has no tenant-table TRUNCATE | RLS cannot be bypassed with TRUNCATE | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 18 | Effective role flags captured after `SET ROLE` | Session is actually restricted and non-bypass | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 19 | Assigned-rep customer policy evaluates `auth.uid()` | Stored policy evaluation works without schema USAGE | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 20 | Tenant A SELECTs its own row from every table | Positive read control for all tenant tables | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 21 | Tenant A INSERT succeeds per allowed table | Positive insert controls prevent vacuous denials; failures name the table | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 22 | Tenant A UPDATEs its own customer row | Positive control for an allowed UPDATE policy | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 23 | Tenant A DELETEs its own inserted customer row | Positive control for an allowed DELETE policy | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 24 | Rep sees a product but cannot DELETE it | Policy-forbidden role denial with visible target | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 25 | Tenant A cannot SELECT Tenant B rows | Cross-tenant reads return zero rows | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 26 | Tenant A cross-tenant UPDATE is rejected by RLS | WITH CHECK emits the RLS violation, not ACL denial | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 27 | Tenant A cross-tenant DELETE affects zero rows | RLS filters inaccessible target rows | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 28 | Tenant A cross-tenant INSERT is rejected by RLS | WITH CHECK emits the RLS violation, not ACL denial | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 29 | Quote creator cannot approve own quote | Self-approval remains blocked | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 30 | Rep cannot read audit log | Audit reads remain owner/manager-only | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 31 | Missing user context sees zero tenant rows | RLS fails closed without JWT subject | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 32 | App role cannot UPDATE audit log | ACL denial protects append-only rows | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 33 | App role cannot DELETE audit log | ACL denial protects append-only rows | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 34 | App role cannot TRUNCATE audit log | ACL denial protects the whole table | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 35 | Elevated UPDATE hits immutability trigger | Database trigger blocks privileged mutation | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 36 | Elevated DELETE hits immutability trigger | Database trigger blocks privileged mutation | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 37 | Elevated TRUNCATE hits statement trigger | Database trigger blocks privileged truncation | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 38 | App role cannot directly insert null-tenant failed-login audit row | No direct app write path for null-tenant audit events | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 39 | `record_failed_login` writes fixed null-tenant/null-actor `auth.login_failed`, even for a known email and spoofed actor GUC | No caller-controlled tenant or actor is recorded; failed-login audit does not reveal tenant membership | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 40 | `record_failed_login` signature and body have no actor/tenant inputs and use fixed values | Caller cannot pass an actor, tenant, or alternate action | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 41 | `record_failed_login` EXECUTE is revoked from PUBLIC, anon, and authenticated | Only the server app role and function owner can call it | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 42 | Every public SECURITY DEFINER function matches the explicit owner/app allowlist, with no extra default EXECUTE grants | Unknown functions, PUBLIC/other grantees, missing required app grants, and broad defaults fail; diagnostics print owner, grantor, grantee, ACL and defaults | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 43 | `margindesk_app` has no role memberships | No inherited role can silently restore revoked privileges | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 44 | Authenticated policy query returns the assigned customer row as `margindesk_app` | Stored policy evaluation succeeds using Supabase platform-managed PUBLIC EXECUTE; row count is logged | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |
| 45 | The same policy query returns zero rows without authenticated context | RLS fails closed; row count and SQL outcome are logged | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** |

All 45 pgTAP checks were verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24. The restore drill remains unverified.

## 1. Connection role and RLS context

### Which role does the app pool use?

`APP_DATABASE_URL` is the PostgreSQL login used by the `pg.Pool` in [`lib/db.ts`](./lib/db.ts). The login must be a dedicated non-superuser role that is a member of `margindesk_app`. Each request transaction then runs `SET LOCAL ROLE margindesk_app`, so SQL statements execute under that restricted role while `session_user` continues to identify the login used by the pool. Separately, `scripts/test-db.ts` connects with `TEST_DATABASE_URL`; CI sets it from the disposable local Supabase `DB_URL`. The setup script grants this test login membership in `margindesk_app` only on the disposable test database, using `WITH INHERIT FALSE, SET TRUE` on PostgreSQL 16+ (the Supabase config currently selects PostgreSQL 17). It logs the live server major version and test-login `LOGIN`, `SUPERUSER`, and `BYPASSRLS` attributes without logging connection credentials. Runtime role and membership checks passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

The migration creates `margindesk_app` as `NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`. CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24 verified the role attributes, runtime login membership, and captured effective role flags. The pgTAP suite captures `current_user`, `rolsuper`, and `rolbypassrls` while `margindesk_app` is active, then checks those values after `RESET ROLE`. It does not grant the app role access to the pgTAP extension schema or temporary fixture tables.

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

Expected: `effective_role=margindesk_app`; both superuser and bypass columns are false; `login_is_app_member=true`. These values were verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

### How is the authenticated request context applied?

[`lib/db.ts`](./lib/db.ts) performs these operations in one transaction, in order:

1. `BEGIN`.
2. Validate the PostgreSQL login role flags and membership.
3. `SET LOCAL ROLE margindesk_app`.
4. Set transaction-local `request.jwt.claim.sub`, `request.jwt.claim.role`, and `request.jwt.claims` from the user ID returned by Supabase Auth’s verified `getUser()` call. The claims are cleared at transaction end.
5. Set `app.real_actor_id`, client IP, and user agent for audit triggers.
6. Run the tenant query and commit; errors roll the transaction back.

RLS helpers use auth.uid() and active membership checks. CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24 passed both the runtime check that clears request context and the pgTAP controls that return zero tenant rows without authenticated claims.

### Auth privilege decision

The application-code search found no direct SQL call to `auth.*` through the app pool, server library, or API routes. `scripts/seed-demo.ts` reads `auth.users` only through its `SEED_DATABASE_URL` administrative pool; its application import runs separately through `withDatabase`. Calls such as `supabase.auth.getUser()` use the Supabase Auth client and are not SQL access to the `auth` schema. Therefore the app role does **not** receive `USAGE` on schema `auth`; check 6 asserts its absence and check 7 asserts it has no Auth-table privileges.

Stored RLS expressions reference `auth.uid()`, but PostgreSQL evaluates their stored function reference without requiring schema USAGE at query time. The app role has no direct ACL entry or role membership for this function. The reported PostgreSQL 17 catalog evidence identifies the effective permission path as Supabase PUBLIC EXECUTE, owned and granted by `supabase_auth_admin`; the migration role cannot alter that ACL. The migration now makes no auth-schema/function GRANT or REVOKE attempt. Check 9 requires effective EXECUTE plus a PUBLIC ACL entry, and its logged owner/ACL make a platform change visible. Checks 44 and 45 execute the same customer policy query as `margindesk_app` with authenticated context and with the subject/claims removed; expected results are one row and zero rows respectively. This platform dependency and the authenticated/missing-context controls passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

The current migration's auth-referencing policy inventory (the runner prints the live catalog inventory in CI) is `membership_select`, `customer_select`, `quote_select`, `quote_insert`, `quote_delete`, `quote_update`, `quote_line_select`, `quote_line_insert`, `quote_line_update`, `quote_line_delete`, `approval_select`, `approval_insert`, `approval_update`, `sales_order_select`, and `audit_log_append`. Some also call `public.is_tenant_*` helpers that read `auth.uid()`. These stored policy expressions do not cause the app role to issue a schema-qualified `auth.uid()` SQL call.

Executable public functions whose definitions reference `auth.*` are `is_tenant_member(uuid)`, `is_tenant_role(uuid,text[])`, `is_tenant_role_any_status(uuid,text[])`, `create_tenant_with_owner(text)`, and `accept_tenant_invite(text)`; they are `SECURITY DEFINER` with pinned `search_path=public,extensions,pg_temp`. `record_failed_login` no longer reads `auth.*`; it emits only a fixed null-tenant/null-actor login-failure event. `auth.uid()` is an invoker function with no pinned search path. The code search found no app-pool direct SQL calls to the `auth` schema. The supplied CI evidence establishes the PUBLIC grant path; checks 6, 7, 9, 19, and 39–45 passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

### Failed-login audit and rate limiting

The undeployed migration gives `public.record_failed_login(text,text,text)` `EXECUTE` only to `margindesk_app` (plus the function owner), revoking it from PUBLIC, `anon`, and `authenticated`. It has no caller-supplied actor or tenant arguments and always inserts `tenant_id=NULL`, `actor_id=NULL`, and `action='auth.login_failed'`; a check calls it with a known test email while setting a spoofed `app.real_actor_id`. `app/api/auth/login/route.ts` rate-limits login attempts to 8 per 10 minutes through `lib/rate-limit.ts`; production requires configured Upstash Redis and fails closed without it. Supabase Auth also has `email_sent=8` in `supabase/config.toml`. The database function itself has no independent rate limiter, so its safety depends on the restricted app role and the rate-limited login route. The prior failing CI summary did not include the exact unexpected function grantee. The migration now conditionally removes every existing non-owner grant from public SECURITY DEFINER functions it owns, then grants only the app allowlist; the diagnostic prints each current ACL owner/grantor/grantee and applicable defaults, and check 42 rejects any extra role.

### Open audit actor-setting item

`lib/db.ts` sets `app.real_actor_id` from request context on every `withDatabase` transaction. `lib/context.ts` sets it to the authenticated actor, including the original actor during development impersonation; the development impersonation route uses the signed token helpers in `lib/impersonation.ts`. The `audit_log_append` policy also trusts this custom GUC, which any code executing as `margindesk_app` can set. Open item: replace this trust with a SECURITY DEFINER audit append function or a server-signed actor value before production use. This request records the risk only; no code change is made for it.

### Is the Supabase service-role key used by user-facing code?

No user-facing source path should reference a service-role credential. Supabase SSR uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; SQL uses the restricted `APP_DATABASE_URL`. `pnpm test` runs [`scripts/check-service-role.mjs`](./scripts/check-service-role.mjs), which scans the present app, components, and library directories, any present conventional client-source directories, text-based public assets, and root browser/prototype files. It warns when an optional source directory is absent and fails if it finds no files. The tracked `legacy/` path contains only an empty `.gitkeep` placeholder and is not shipped source. The local scan passed and checked 86 user-facing files; the source scan also passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24. This source scan does not substitute for keeping secrets out of deployment configuration and logs.

## 2. Tenant isolation across public tables

[`supabase/tests/phase1_rls.sql`](./supabase/tests/phase1_rls.sql) creates fixture rows for both tenants in every current application-owned public table with `tenant_id`. Tenant A fixtures are cloned in FK order with tenant-local IDs and references, and complete row snapshots pass into the restricted-role section through transaction-local settings; the app role needs no temporary-schema grant. Named pgTAP checks separately identify missing schema USAGE, PL/pgSQL USAGE, helper EXECUTE, and each missing table operation. Dynamic loops exercise every application-owned public base table and fail if:

- any table is missing `tenant_id`, enabled RLS, or forced RLS;
- Tenant A can select, update, or delete a Tenant B row;
- Tenant A cannot move an A-visible row to Tenant B or insert a Tenant B row; both must fail with SQLSTATE `42501` and an error message identifying the RLS policy, not a table permission denial;
- Tenant A can select its own seeded row in every tenant table and can insert on every table whose RLS policy allows INSERT; it also updates its own customer and deletes its own inserted customer; a rep can see but cannot delete a product under the analyst/manager-only DELETE policy; missing grants or policy failures are reported by table name;
- Tenant A cannot use TRUNCATE, and Tenant B deletes remain RLS-filtered to zero rows (PostgreSQL DELETE policies filter rows instead of raising an exception);
- a request with no authenticated user context can see tenant data.

The restricted test section touches only `public` tenant tables, the stored policy reference to `auth.uid()`, the public membership/role helpers, `pg_catalog` views and built-ins, and transaction-local request/test settings. Before role switching, the suite checks `USAGE` on `public`, absence of `auth` schema/table privileges, effective `auth.uid()` EXECUTE through the platform PUBLIC ACL, each policy-helper EXECUTE grant, PL/pgSQL USAGE for its `DO` blocks, and required per-table grants. It does not read `pg_temp`, invoke pgTAP, or use sequences while acting as `margindesk_app`. The test login handles fixture setup and pgTAP; the app role performs only policy operations under test. The SQL suite and migration passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24. Docker and `psql` remain unavailable in this local workspace.

The migration also checks tenant columns and forced RLS during installation. CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24 passed the then-current duplicate-object/schema checks, clean migration application, and PostgreSQL integration tests. Since that run, the static lint was extended to require audit triggers and safe ACL declarations in future SECURITY DEFINER functions; a SHA-256 migration freeze check was also added. These new gates and their fixture tests pass locally, but remain **unverified in CI** until a later run exercises them. The expanded lint checks tenant columns, forced RLS, audit coverage, and owner/manager-only audit SELECT; see [`README.md`](./README.md) for CI/local commands.

## 3. Append-only audit log

The migration installs a row-level `BEFORE UPDATE OR DELETE` trigger and a statement-level `BEFORE TRUNCATE` trigger. This is necessary because TRUNCATE bypasses row triggers and RLS. `margindesk_app` receives only `SELECT` and `INSERT` on `audit_log`; UPDATE, DELETE, and TRUNCATE are revoked, and PUBLIC receives no write or TRUNCATE grant on tenant tables. Table grants on other tenant tables match operations allowed by at least one RLS policy. pgTAP checks app-role ACL denial and exercises the elevated-role update/delete/truncate triggers. Production migrations must never grant membership in `margindesk_app` to a login; `pnpm check:schema` rejects that statement, with a fixture proving the check fails. Database execution passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

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

The TypeScript test verifies each route uses the guard and that representative safe payloads pass while cost, freight/terms cost components, COGS, pocket price/margin, and margin-dollar fields fail. Reps do not have `quotes.approve`; [`lib/quote-approval.ts`](./lib/quote-approval.ts) rejects the quote creator, and the SQL test also attempts an own-approval update under RLS. The API guard tests and SQL self-approval policy test passed in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.

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

In this workspace on 2026-10-25, `pnpm test` passed (33 tests), `pnpm typecheck` passed, and `pnpm build` passed. The temporary PGlite smoke harness applied the current migration and emitted 45 passing assertion lines using minimal Supabase Auth and pgTAP stubs; its pgTAP behavior is stubbed and it is not PostgreSQL 17/Supabase verification. Docker and `psql` are unavailable; `pnpm test:db` cannot be verified locally without a database at `127.0.0.1:54322`. CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24 passed its local Supabase migration, role check, and all 45 pgTAP checks. The restore drill remains **unverified**.
