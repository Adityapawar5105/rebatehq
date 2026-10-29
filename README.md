# MarginDesk

**Chunk 3B — local implementation, CI unverified (2026-10-29):** Supplier files can now produce a before/after import plan, resolve app/file conflicts, commit valid rows, and undo safely from history. **Export for Excel** adds protected row IDs and versions; re-upload detects edits since export. Dated costs and list prices feed the shared margin/price engine. Import files are limited to 200 data rows and still pass the Chunk 3A upload boundary. Source bytes are not stored; normalized plans and before/after journals are retained in existing import jobs and audits. See [Chunk 3B verification](./CHUNK_3B_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Authenticated/deployed behavior and a green CI run for 3B remain **unverified**. Chunk 3C has not started.

**Chunk 3A — verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/margindesk/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`:** Price Lists has a three-step supplier-file review for data-only XLSX, CSV and TSV. It detects the sheet and header, suggests mappings, reports issues with original row and column, and saves supplier/file-type templates per tenant. This is a dry run: it stores review metadata and relevant data-quality issues, but does not import product, cost or price rows or retain the source file. CI passed the upload size/type/row/column/cell limits, streaming limits, macro and ZIP/XML rejection, malicious-text and formula-safe export tests, malformed-file fuzzing, messy-file parsing, and tenant-scoped template tests. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. No Restore Drill was run for 3A because no migration or restore inventory changed. See [Chunk 3A verification](./CHUNK_3A_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Chunk 3B had not started at that milestone; its current local status is recorded in CHUNK_3B_VERIFICATION.md.

Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/margindesk/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/margindesk/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. Current acceptance is **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Chunk 3A builds on that baseline; Chunk 3B had not started at that milestone; its current local status is recorded in CHUNK_3B_VERIFICATION.md. See [the Phase 2 verification record](./CHUNK_2C_VERIFICATION.md) and [current assumptions](./ASSUMPTIONS.md).

**Chunk 2B status — verified:** pricing precedence and tiered rebate audit are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/margindesk/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/margindesk/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. The migration is locked with its unchanged normalized hash. Both suites passed with **88 fresh / 91 restore-mode pgTAP checks** and **33 tenant tables**. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by those runs remain **unverified**. See [the verification record](./CHUNK_2B_VERIFICATION.md). This records the earlier Chunk 2B milestone.


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

To review a supplier file, sign in as an owner or manager, open **Price Lists → Review a supplier file**, choose an XLSX/CSV/TSV file, confirm the suggested sheet, header and eight field mappings, and select **Review mapped file**. The result lists every detected issue and previews up to 50 source rows. A supplier/file-type template can be saved and reloaded for the same headers. Downloaded issue and preview CSVs neutralize formula-like cells. The file is processed in memory and is not retained; no business rows are imported.

To import, explicitly approve any numeric format/unit conversions and source warnings, then select **Preview changes**. Review new/changed/unchanged/rejected rows and choose current app or file values for conflicts. Refresh the preview after changing a conflict choice, then commit the valid rows. **Excel lifeline and import history** offers a CSV with `md_row_id` and `md_version` and an **Undo import** action. Keep metadata, SKU and base units intact; use blank metadata for new rows. Undo refuses later edits or dependencies and retains audit/history records. Amounts use tenant currency and standard cost basis; each import file may contain at most 200 total data rows.

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

### Phase 1 verification status — 2026-10-26

Phase 1 is proven. [MarginDesk CI #24](https://github.com/Adityapawar5105/margindesk/actions/runs/40290388651/job/121463801598) passed on commit `aabfb20`, including migration, runtime role, unit/security, typecheck, build, and 53 fresh-mode pgTAP checks. [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/margindesk/actions/runs/40291362616/job/121466953508) passed end to end in local Supabase mode, including source/target comparisons and 56 restore-mode checks. Both test suites passed repeatability checks. Hosted-Supabase restore mode and managed backup/PITR remain **unverified**.

### Chunk 2A verification status — 2026-10-28

Chunk 2A and the restore-platform-ACL-cleanup procedure are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/margindesk/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Migration `202610280001_chunk2a_cost_units_currency.sql` is locked in `migrations.lock` with its existing normalized hash. The historical Chunk 2A plans were 70 fresh and 73 restore-mode checks across at least 29 tenant tables. The local-target restore passed strict ACL/count comparisons, four function ACL checkpoints, sentinel/runtime checks and repeatability. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these jobs remain **unverified**. See [`SECURITY_CHECK.md`](./SECURITY_CHECK.md) and [`OPERATIONS.md`](./OPERATIONS.md).

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

Run **Actions → MarginDesk Restore Drill → Run workflow** to exercise a logical dump and restore. Dumps are restricted to the application-owned `public` schema; Supabase-managed schemas are excluded. The drill inventories source tables and counts, creates synthetic `auth.users` stand-ins for only referenced IDs, and then compares app-owned ACLs and row counts after restore. `local` mode needs no secrets. `hosted` mode requires the two disposable database URL secrets documented by name in `.env.example`; source must already have the MarginDesk migration applied and target must be a fresh empty Supabase project. Never point the workflow at production. The corrected local-target workflow is verified in [Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`; hosted-target mode remains **unverified**.

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

- The four main pages remain Dashboard, Price Lists, Quoting, and Rebates. Chunk 3A reviews supplier files and mappings; committed supplier-file import/publishing, supplier price comparison, full quote configuration, rebate claims, and ERP/CRM sync are still later work.
- There is no managed Supabase project or production credentials in this workspace. Live email delivery, hosted auth, deployment, and a managed-database restore drill remain operator setup items.
- Local database/pgTAP checks require Docker. The checks and CI workflow are included; the local test result is explicitly **unverified** until the workflow or local Supabase run completes successfully.
- The virus-scan adapter is a placeholder. Files are processed in memory and not stored; connect a managed scanner before enabling persisted uploads.
- Owner export omits connector credential ciphertext; connectors must be reauthorized after restore.
- The current audit log is append-only and retained independently after tenant purge. Do not treat audit retention as a substitute for a legal retention policy.
