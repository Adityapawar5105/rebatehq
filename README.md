# MarginDesk Phase 1

MarginDesk is being moved from a browser-local prototype to a multi-tenant app for mid-market distributors. Phase 1 adds the production foundation: Supabase Auth magic links, tenant and role enforcement, PostgreSQL RLS, audit logging, and a safe prototype import/export path. It does not add new pricing, rebate, or ERP features.

## Local app

Requirements: Node.js 20.9 or newer, pnpm 10, and Docker for local Supabase database tests.

```powershell
pnpm install
Copy-Item .env.example .env.local
# Fill in the local Supabase URL, publishable key, and the dedicated NOBYPASSRLS app login URL.
pnpm exec supabase start
pnpm dev
```

Open `http://localhost:3000`. Supabase local development sends magic links to its local Inbucket email viewer. Apply migrations with `pnpm exec supabase db reset`.

## Verification

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm check:service-role
pnpm check:db-role
pnpm test:db
```

`pnpm test` runs the Phase 0 margin-engine golden tests, role/import/CSV/secrets/rep-response tests, a static migration guard, and a scan for service-role credentials in user-facing code. `pnpm test:db` runs the pgTAP isolation and audit suite. It uses `TEST_DATABASE_URL` when set (including hosted disposable restore targets); otherwise it delegates to `supabase test db` for the local stack. `pnpm check:db-role` connects through `APP_DATABASE_URL`, checks the actual pool login and effective app role, and verifies that a request without user context sees zero tenants.

### Phase 1 verification status — 2026-10-24

- TypeScript, unit/security checks, schema checks, and production build: **passed** in this workspace.
- GitHub Actions database workflow: **unverified** until a passing run is linked here. It starts a fresh local Supabase stack, runs `supabase db reset` to apply every migration, derives `SEED_DATABASE_URL` and `TEST_DATABASE_URL` from `supabase status`, creates a random non-bypass app login, checks the runtime pool role, and runs `pnpm test:db`. It needs no GitHub secrets.
- Local Postgres RLS integration tests: **unverified**. This workspace has no Docker/Postgres; a previous `pnpm test:db` attempt stopped before SQL with `ECONNREFUSED 127.0.0.1:54322`.
- Runtime connection-role check: **unverified** in a real database run; it is included in CI with a locally generated restricted login.
- Restore drill: **unverified** until the manual restore workflow has a passing run linked here. The default local mode dumps the migrated and seeded local DB, discards it, starts a fresh Supabase stack, restores roles/schema/data, checks the sentinel, and re-runs app-role and pgTAP checks. See [`OPERATIONS.md`](./OPERATIONS.md).

#### Run the database checks locally (Windows PowerShell)

```powershell
pnpm exec supabase start -x studio,edge-runtime,storage-api,imgproxy,logflare,vector
pnpm exec supabase db reset
$env:SEED_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
pnpm setup:test-db-role
```

Copy the `$env:APP_DATABASE_URL = '...'` assignment printed by the setup command into the same PowerShell session, then run:

```powershell
pnpm check:db-role
pnpm test:db
pnpm exec supabase stop --no-backup
```

The checked-in GitHub Actions workflow performs these steps on pull requests, pushes to `main`/`master`, or manual `workflow_dispatch`. It needs no database or Supabase secrets. Push the branch to GitHub, then open **Actions → MarginDesk CI → Run workflow**. The database URLs are derived from the local CLI status output, and the restricted app-login password is generated randomly for the disposable local stack and written only to the job environment.

Run **Actions → MarginDesk Restore Drill → Run workflow** to exercise a logical dump and restore. `local` mode needs no secrets. `hosted` mode requires the two disposable database URL secrets documented by name in `.env.example`; source must already have the MarginDesk migration applied and target must be a fresh empty Supabase project. Never point the workflow at production.

## Phase 1 security model

- Supabase Auth owns verified email sessions. No user can join an existing tenant without an owner-issued, single-use, seven-day invitation.
- A dedicated PostgreSQL login is a member of `margindesk_app`, which is `NOLOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`. Each server request verifies the Supabase user, opens a short transaction, sets `LOCAL ROLE margindesk_app`, sets the JWT claims and `app.real_actor_id`, and lets tenant-scoped RLS filter records. The pool rejects a session login that is superuser, `BYPASSRLS`, or not a member of `margindesk_app`.
- Browser roles have no direct grants on public business tables. User data goes through Next.js APIs. User-facing code never uses the Supabase service-role key.
- The shared [`margin-engine.js`](./margin-engine.js) remains unchanged and is used for server quote recomputation and prototype import snapshots. Client-provided prices, margin values, and guardrail zones are discarded.
- Rep responses omit costs, margin dollars, and cost components. Reps see only their own quotes, assigned customers, product prices, guardrail zone, and headroom.
- Business writes are recorded by database triggers in an append-only audit log. Manual actions add specific action names alongside row mutation events.

## Prototype data migration

1. Open the static local prototype `index.html` in the browser where the data exists.
2. Open its local settings/Connectors view and choose **Export this browser data as JSON**. Inspect the export before sending or importing it.
3. In the hosted app, sign in as the destination tenant owner and open Account → Data migration & export.
4. Select the JSON, run a dry run, review row counts and warnings, then confirm the same file within 30 minutes.

The import is single-use per tenant, limited to 2 MB, and recomputes quote margins and monthly snapshots on the server. Demo role-switch values are not migrated; invite real users. `seed_data.json` contains synthetic fixture data only.

## Scripts and operations

- `pnpm seed:demo` creates an owner-owned demo tenant from `seed_data.json`. It requires an existing verified `DEMO_OWNER_USER_ID`, `SEED_DATABASE_URL`, and `APP_DATABASE_URL`.
- `pnpm import:prototype <file>` validates and records a dry run. Add `--commit` to commit a matching fresh dry run. Set `TENANT_ID` and `ACTOR_ID`.
- `scripts/purge-deleted-tenants.ts` removes business data for tenants disabled for 30 days; it preserves audit rows. Review `OPERATIONS.md` before running it.
- `supabase/migrations/` is canonical. `schema.sql` mirrors the Phase 1 migration for older tooling.
- Vercel deploys the Next.js app. Follow [`OPERATIONS.md`](./OPERATIONS.md) for project setup, backup, restore, and retention.

## Current limits and deferred work

- Phase 1 includes foundation pages for Dashboard, Price Lists, Quoting, and Rebates. Advanced price import/publishing, supplier file comparison, full quote configuration, rebate claim workflows, and ERP/CRM sync remain Phase 2 or later.
- There is no managed Supabase project or production credentials in this workspace. Live email delivery, hosted auth, deployment, and a managed-database restore drill remain operator setup items.
- Local database/pgTAP checks require Docker. The checks and CI workflow are included; the local test result is explicitly **unverified** until the workflow or local Supabase run completes successfully.
- The virus-scan adapter is a placeholder. Files are processed in memory and not stored; connect a managed scanner before enabling persisted uploads.
- Owner export omits connector credential ciphertext; connectors must be reauthorized after restore.
- The current audit log is append-only and retained independently after tenant purge. Do not treat audit retention as a substitute for a legal retention policy.
