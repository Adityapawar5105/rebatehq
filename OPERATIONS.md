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

**As of 2026-10-25: Phase 1 CI passed in [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24.** The restore drill remains unverified and must only be marked verified after its workflow passes.

| Check | Status | CI evidence |
|---|---|---|
| Supabase local stack starts and all migrations apply | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Clean migration reset passed |
| Restricted app pool login and missing-auth zero-row check | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Runtime role check passed |
| Tenant isolation across public tenant tables, including own-row positive controls and RLS-specific write denials | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | All 45 pgTAP checks passed |
| Audit log UPDATE/DELETE/TRUNCATE denial and elevated-role immutability triggers | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | pgTAP checks passed |
| Rep response and self-approval checks | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | Unit and database checks passed |
| User-facing service-role scan | **verified in CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) · 2026-10-24** | pnpm test source scan passed |
| Applied-migration hash lock and expanded future-migration gates | **unverified** | Added after CI #14; awaiting a run that exercises these new checks |
| Restore to fresh target and post-restore suite | **unverified** | Restore workflow has not passed |

### Migration hash normalization

On 2026-10-25, the baseline hash was regenerated from the current migration content after normalizing CRLF and lone CR line endings to LF and stripping a UTF-8 BOM. The earlier mismatch was caused by the Windows working copy using CRLF while CI hashes LF bytes. Per the user's GitHub Desktop verification, the migration SQL content is unchanged from CI run #14; the SQL file was not edited. `migrations.lock` records the normalization method and reason, and `scripts/check-migrations-lock.mjs` hashes normalized UTF-8 content so Windows and Linux produce the same SHA-256. `.gitattributes` also forces LF for SQL and the other CI/hash-relevant source files. The updated lock hash is `8faa57997119f29b3921b0e15b4b9e964edbc7fa2ecd8b52fbe32392be38c3bb`.

### CI database-step sweep

The CI scripts were reviewed on 2026-10-25. The restricted test login is created with a randomly generated, masked password; runtime checks use `APP_DATABASE_URL` and database tests use `TEST_DATABASE_URL`. CI run [MarginDesk CI #14](https://github.com/Adityapawar5105/margindesk/actions/runs/40137557258) on 2026-10-24 passed clean migration application, runtime role verification, and all 45 pgTAP checks with planned equal to ran. It confirmed `auth.uid()` is owned by `supabase_auth_admin` and the effective app EXECUTE path uses Supabase's PUBLIC grant. The SECURITY DEFINER ACL allowlist passed. CI captures migration output with `client_min_messages=warning` and fails on ineffective privilege warnings; the baseline hash lock and expanded future-migration gates were added after run #14 and remain **unverified** until CI exercises them. The restore drill remains unverified. Login attempts are limited to 8 per 10 minutes by the Upstash route limiter; the SQL function has no independent rate limiter. The audit actor GUC risk remains open in `SECURITY_CHECK.md`.

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

**Unverified as of 2026-10-25.** Restore Drill runs #1 and #2 failed before restore completed: #1 exposed a parameter-setting privilege error; #2 identified `GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";` in the role dump and led to the exact-statement role filter. Run #3 then failed while restoring `storage.buckets_vectors`, showing that the dump included Supabase-managed schemas. The migration audit shows MarginDesk creates its tables and functions in `public`, creates no application schema, and creates no triggers on `auth` tables. Its only non-public operation is `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions`; `extensions` and `pgcrypto` are supplied by the fresh Supabase stack. The revised dump therefore has the explicit allowlist `public`; it excludes `auth`, `storage`, `extensions`, `realtime`, `vault`, `graphql`, `graphql_public`, `pgsodium`, `supabase_functions`, `supabase_migrations`, `net`, `cron`, `pgmq`, and every other schema outside `public`. The inventory step prints grouped schema/data table lists, source row counts, source auth foreign keys, and a redacted excerpt around data dump line 448; COPY payload rows are never printed. It writes auth user IDs to a runner-private inventory file only. Before public data is restored, the workflow creates synthetic `auth.users` stand-ins only for IDs referenced by public foreign keys. It copies no source email, password hash, or other auth field. Restore commands retain `ON_ERROR_STOP`; the role/schema stage and data stage are separate so these stand-ins can be inserted between them. The comparison checks every table in the application dump, app table and public SECURITY DEFINER function ACLs, the public schema ACL, per-table and per-tenant row counts, role attributes/memberships, and referenced auth IDs. Sentinel, restricted login, runtime role/no-context, and full pgTAP checks remain required. These changes have not passed a workflow run yet, so the restore remains **unverified**. Local mode validates a logical restore between local Supabase stacks, not Supabase-managed backups or PITR. Hosted mode is limited to explicitly disposable test projects.

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

Use **Actions → MarginDesk Restore Drill → Run workflow**. The default `local` mode needs no Supabase project, database, or GitHub secrets: the workflow starts a local Supabase source stack, applies migrations, seeds a sentinel, dumps the owned `margindesk_app` role plus only the `public` schema/data, and reports the explicit included/excluded schema list. It inventories tables and source counts, prints a redacted excerpt around data dump line 448, and prepares synthetic `auth.users` rows for only the referenced IDs before restoring application data into a fresh Supabase stack. It compares role attributes, memberships, app-owned table/function/schema ACLs, every application table’s total and per-tenant counts, and required auth IDs. It then verifies the sentinel, creates a random restricted app login, checks runtime role/no-context behavior, and runs the complete `pnpm test:db` suite. The job summary records the schema scope, source/restored counts, auth dependency counts, and dump, restore, test, and total timings. Every restore command stops on SQL error. A failed step leaves the drill unverified and must be fixed before recording a passing result. Local mode validates the logical restore procedure only; it does not validate Supabase-managed backup/PITR recovery or production hosted infrastructure. Hosted mode must use disposable Supabase test projects only.

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

