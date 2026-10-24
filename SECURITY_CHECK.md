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

## 1. Connection role and RLS context

### Which role does the app pool use?

`APP_DATABASE_URL` is the PostgreSQL login used by the `pg.Pool` in [`lib/db.ts`](./lib/db.ts). The login must be a dedicated non-superuser role that is a member of `margindesk_app`. Each request transaction then runs `SET LOCAL ROLE margindesk_app`, so SQL statements execute under that restricted role while `session_user` continues to identify the login used by the pool. Separately, `scripts/test-db.ts` connects with `TEST_DATABASE_URL`; CI sets it from the disposable local Supabase `DB_URL`. The setup script grants this test login membership in `margindesk_app` only on the disposable test database, using `WITH INHERIT FALSE, SET TRUE` on PostgreSQL 16+ (the Supabase config currently selects PostgreSQL 17). It logs the live server major version and test-login `LOGIN`, `SUPERUSER`, and `BYPASSRLS` attributes without logging connection credentials. Those live values remain **unverified** until a passing CI run.

The migration creates `margindesk_app` as `NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`. Before assuming the app role, `withDatabase` checks the actual `session_user` in `pg_roles` and rejects a login with `rolsuper=true`, `rolbypassrls=true`, or no membership in `margindesk_app`. [`scripts/check-app-db-role.ts`](./scripts/check-app-db-role.ts) checks both the pool login and effective role. Immediately after its `SET LOCAL ROLE margindesk_app`, the pgTAP suite asserts `current_user='margindesk_app'` and that the role is neither superuser nor `BYPASSRLS`; `RESET ROLE` remains before the elevated audit-trigger assertions. The live result remains **unverified** pending CI.

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

### Is the Supabase service-role key used by user-facing code?

No user-facing source path should reference a service-role credential. Supabase SSR uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; SQL uses the restricted `APP_DATABASE_URL`. `pnpm test` runs [`scripts/check-service-role.mjs`](./scripts/check-service-role.mjs), which scans the present app, components, and library directories, any present conventional client-source directories, text-based public assets, and root browser/prototype files. It warns when an optional source directory is absent and fails if it finds no files. The tracked `legacy/` path contains only an empty `.gitkeep` placeholder and is not shipped source. The local scan passed and checked 86 user-facing files; CI status is **unverified** pending a passing `MarginDesk CI` run. This source scan does not substitute for keeping secrets out of deployment configuration and logs.

## 2. Tenant isolation across public tables

[`supabase/tests/phase1_rls.sql`](./supabase/tests/phase1_rls.sql) creates a fixture row for Tenant B in every current application-owned public table with `tenant_id`, snapshots complete fixture rows before assuming `margindesk_app` with Tenant A’s authenticated subject, and replays each complete row for the INSERT checks. It rejects anything other than SQLSTATE `42501`, so a missing-column or constraint error cannot falsely pass as an RLS denial. Dynamic loops exercise every application-owned public base table and fail if:

- any table is missing `tenant_id`, enabled RLS, or forced RLS;
- Tenant A can select, update, or delete a Tenant B row;
- Tenant A can insert a row carrying Tenant B’s `tenant_id` (the expected denial is SQLSTATE `42501`);
- a request with no authenticated user context can see tenant data.

The migration also checks tenant columns and forced RLS during installation. `pnpm test` runs [`scripts/check-schema.mjs`](./scripts/check-schema.mjs), which statically checks every migration for duplicate policies, triggers, indexes, function signatures, and named constraints; missing tenant-table FORCE RLS; and audit SELECT policies broader than owners/managers. Fixture tests exercise each failure case. These local static checks pass, but applying the migration to a clean Supabase database and the Postgres integration suite remain **unverified** until a passing CI run is linked above; see [`README.md`](./README.md) for CI/local commands.

## 3. Append-only audit log

The migration installs a `BEFORE UPDATE OR DELETE` trigger that raises an exception and grants `margindesk_app` only `INSERT` on `audit_log`, explicitly revoking `UPDATE`, `DELETE`, and `TRUNCATE`. Production migrations must never grant membership in `margindesk_app` to a login; `pnpm check:schema` now rejects that statement, with a fixture proving the check fails. The database integration test executes `UPDATE` and `DELETE` attempts as `margindesk_app` and expects SQLSTATE `42501`. Those database attempts and the static check's CI result remain **unverified** until `pnpm test:db` and `pnpm test` pass in CI and the run link/date is added above.

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

In this workspace, unit/security tests (23 total), typecheck, production build, schema guard, and service-role scan passed. The migration lint fixtures cover duplicate policies (including a policy generated by a loop), triggers, indexes, function signatures, named constraints, missing FORCE RLS, and an overly broad audit SELECT policy. The service-role scanner checked 86 user-facing files, and its fixture tests reject a client file containing the service-role environment key and an empty scan. Docker and `psql` are unavailable, so the migration has not been applied to a clean local database; `pnpm test:db` previously stopped before SQL with `ECONNREFUSED 127.0.0.1:54322`. The hosted CI path has not run. The runtime role, SQL RLS/audit/approval checks, clean-database migration application, and restore drill remain **unverified**; no CI run link/date is available to record.
