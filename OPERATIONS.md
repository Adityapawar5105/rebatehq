# MarginDesk operations (Phase 1)

## Environments

Keep three separate Supabase projects, Vercel deployments, and Upstash databases for development, staging, and production. Never copy live customer data into development. Set the environment variables in `.env.example` separately for each deployment. Preview deployments must use staging services. Only the public Supabase URL and publishable key may use the `NEXT_PUBLIC_` prefix.

`APP_DATABASE_URL` must connect as a dedicated login that is a member of `margindesk_app`; it must not be the `postgres`, `service_role`, or `BYPASSRLS` credential. Create it after applying the migration:

```sql
CREATE ROLE margindesk_app_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'use-a-generated-secret';
GRANT margindesk_app TO margindesk_app_login;
```

Use the Supabase transaction pooler for the web runtime. The `pg` adapter begins a transaction, runs `SET LOCAL ROLE margindesk_app`, sets the verified Supabase user claims, and keeps all tenant work in that transaction. Rotate the login password and update `APP_DATABASE_URL` when personnel or environments change.

`SEED_DATABASE_URL` is a privileged direct database URL used only by operator scripts and migrations. It must not be configured in Vercel runtime functions. Use the Supabase project SQL editor or a controlled migration runner for production schema changes. The seed and retention scripts require this variable explicitly.

## Phase 1 CI evidence status

**As of 2026-10-25: all CI acceptance items are unverified.** No GitHub Actions run link is available yet. Do not change an item to verified until the linked workflow run has passed and its URL and date are recorded here and in [`SECURITY_CHECK.md`](./SECURITY_CHECK.md).

| Check | Status | CI evidence |
|---|---|---|
| Supabase local stack starts and all migrations apply | **unverified** | No run link/date |
| Restricted app pool login and missing-auth zero-row check | **unverified** | No run link/date |
| Tenant isolation across public tenant tables | **unverified** | No run link/date |
| Audit log UPDATE/DELETE denial | **unverified** | No run link/date |
| Rep response and self-approval checks | **unverified** | No run link/date |
| User-facing service-role scan | **unverified** | No run link/date |
| Restore to fresh target and post-restore suite | **unverified** | No run link/date |

## Initial setup and deployment

1. Create the three Supabase projects and configure Auth email confirmation, magic-link redirect URLs, and a short-lived one-time link policy. Add the app callback URL `/auth/callback` to each environment’s allowed redirect list.
2. Copy `.env.example` to `.env.local`. Generate separate random secrets for `APP_DATABASE_URL`, `CONNECTOR_ENCRYPTION_KEY`, and development impersonation. Set `APP_BASE_URL` to the exact origin.
3. Apply the checked-in migration with `pnpm exec supabase link --project-ref <ref>` and `pnpm exec supabase db push`, or run the migration SQL from the dashboard. Run `pnpm check:schema` and `pnpm test:db` against a local Supabase instance before deploying.
4. Create the restricted application login shown above. Run `pnpm check:db-role`; it asserts the actual `APP_DATABASE_URL` session login and effective role are neither superuser nor `BYPASSRLS`, that the login can assume `margindesk_app`, and that a request without a verified user context sees zero tenant rows.
5. Configure Resend and Upstash in staging and production. Production auth, invite, import, and export routes fail closed when distributed rate limiting is not configured. Confirm the sender domain before inviting customers.
6. Set `CONNECTOR_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Keep a separately secured copy outside Supabase; key loss makes stored connector credentials unreadable. For key rotation, decrypt and re-encrypt each secret in a controlled migration, then increment `CONNECTOR_ENCRYPTION_KEY_VERSION`.
7. Deploy to Vercel with the matching environment variables and verify `/api/health`, sign-in, invite acceptance, owner/manager/analyst/rep permissions, and RLS tenant isolation in staging before production traffic.

## Backups and restore

Use the Supabase project’s Database → Backups page to inspect the configured backup coverage. Supabase’s available daily retention and PITR options depend on the selected project plan and add-ons; confirm the production project has the retention window required by the customer contract. PITR replaces daily backups when enabled, so choose and document one supported restore strategy. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

### Phase 1 restore-drill status

**Unverified as of 2026-10-25.** No restore workflow run link/date is available. The local `pnpm test:db` attempt stopped before SQL execution with `ECONNREFUSED` for `127.0.0.1:54322`; Docker and `psql` are unavailable in this workspace. The manual workflow now performs a logical dump/restore drill, but it has not run. This workflow is not evidence that Supabase managed daily backup or PITR restoration was tested.

| Drill field | Recorded result |
|---|---|
| Source/target project | Not configured |
| Backup type and recovery point | Not selected |
| Database size | Not measured |
| Start/end UTC and duration | **unverified** / N/A |
| Restore result and sentinel check | **unverified** |
| App login and database RLS/audit checks | **unverified** |
| App quote, CSV, and owner export checks | **unverified** |

### Run the automated logical restore drill

Use **Actions → MarginDesk Restore Drill → Run workflow**. The default `local` mode needs no Supabase project, database, or GitHub secrets: the workflow starts a local Supabase source stack, applies migrations, seeds a sentinel, dumps custom roles/schema/data, discards the source stack, starts a fresh Supabase target, restores the dump, verifies the sentinel, generates a random restricted app login, and runs `pnpm check:db-role` plus `pnpm test:db`. The job summary records dump, restore, test, and total elapsed time. A failed step leaves the drill unverified and must be fixed before recording a passing result.

To use a hosted test project, set these GitHub Actions repository secrets (the names are also listed in `.env.example`):

- `RESTORE_TEST_SOURCE_DATABASE_URL`: direct/admin database URL for a disposable source project with the MarginDesk migration already applied.
- `RESTORE_TEST_TARGET_DATABASE_URL`: direct/admin database URL for a separate, fresh disposable Supabase project. The workflow refuses to restore if `public.tenant` already exists.

Select `hosted` when manually dispatching the workflow. It seeds the source project, dumps its custom roles/schema/data, restores into the fresh target, creates a new restricted app login, then runs the app-role and pgTAP checks against that restored target. Use projects created only for this drill; never use production. Recreate the target project before a later hosted run because the workflow intentionally does not drop hosted projects. Protect and rotate these secrets after use.

The database dump/restore workflow verifies application schema/data portability and post-restore security checks. It does not simulate a Supabase platform-managed daily backup or PITR operation. Keep the separate quarterly managed-backup drill below for that recovery path.

### Run and record the managed staging restore drill

Perform at launch and quarterly. Use a disposable staging project or restore into a separate test project; never restore over production for a drill. Supabase’s current guidance says the project may be inaccessible during restore and custom database-role passwords are not included in daily backup files. Storage API objects are outside the database backup. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups) and [restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

1. Record project ref, database size, backup type, selected recovery timestamp, start time (UTC), and operator before starting. Prefer restoring to a new test project when that option is available; otherwise use a disposable staging project.
2. In the test project, create a uniquely named test tenant and a marker row before the selected backup point. Record its exact ID. After the backup point, create a second marker row so the drill can verify the recovery boundary.
3. Use **Database → Backups** in the Supabase Dashboard to restore the selected daily backup or configured PITR point. Keep the source project unchanged. Record the time restore starts and when Supabase reports completion.
4. Reset/recreate `margindesk_app_login` and reapply the application secrets. Do not copy a production login password into the test project.
5. Set `SEED_DATABASE_URL` to the restored project’s direct database connection. Create a restricted app login, set `APP_DATABASE_URL` to that login’s connection string, then run `pnpm check:schema`, `pnpm check:db-role`, `pnpm test:db`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
6. Verify the pre-backup marker exists and the post-backup marker does not. Sign into the app using a test account; verify two-tenant isolation, one server-recalculated quote, CSV export, and a full owner export. Record pass/fail for each and the end time.
7. Calculate elapsed restore time (end minus start), recovery-point age/data loss, and whether the app recovered. Record the results below or in the incident log. Delete the disposable project after preserving the drill record.

| Field | Fill in after the drill |
|---|---|
| Date, operator, source/target project refs | |
| Backup type and selected recovery point (UTC) | |
| Database size | |
| Restore start/end (UTC), elapsed duration | |
| Pre-backup marker found / post-backup marker absent | |
| `check:db-role`, `test:db`, login, tenant isolation | |
| Quote, CSV export, owner export | |
| Outcome, data-loss estimate, follow-up | |

The Phase 1 restore acceptance remains **open** until an operator completes and records the staging drill above.

## Data export, deletion, and retention

- Owners can download a JSON and CSV ZIP from Account → Data migration & export. Connector secret ciphertext and cryptographic metadata are intentionally omitted, so credentials must be reconnected after restore.
- Deletion first sets `tenant.deleted_at` after an exact workspace-name confirmation and records an audit event. The tenant becomes inaccessible immediately.
- Business rows are retained for 30 days so an owner can request recovery, then an operator runs `CONFIRM_TENANT_PURGE=YES pnpm exec tsx scripts/purge-deleted-tenants.ts` with the privileged URL. Cascading deletion removes business records; audit rows are retained as append-only evidence and have no tenant foreign key.
- Audit records contain identifiers and may include limited account or invitation metadata in before/after snapshots. They are retained independently of business data. Restrict audit exports to owners/managers and handle them as confidential records.

## Incident and secret handling

- Never log request bodies, invite tokens, credentials, magic-link codes, authorization headers, cookies, or SQL error text. The application’s error logger records error class and database code only.
- Revoke compromised connector credentials at their provider, rotate `CONNECTOR_ENCRYPTION_KEY` via a reviewed re-encryption process, rotate the restricted PostgreSQL login, invalidate Supabase sessions, and review the append-only audit log.
- `DEV_IMPERSONATION_ENABLED` must remain false outside local `NODE_ENV=development`. The impersonation cookie is signed, HttpOnly, SameSite strict, expires after 15 minutes, and writes start/end audit events with the real actor id.
- Health checks return dependency status only, with no connection strings or user data.

## Import and upload behavior

Prototype JSON import is owner-only, JSON-only, capped at 2 MB, parsed in memory, schema/row-limited, and requires a fresh dry run that expires after 30 minutes. The virus-scan function is a hook placeholder: the current importer stores no uploaded file, but a managed malware scanner must be wired in before any file persistence or general-purpose upload is enabled.

