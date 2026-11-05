# RebateHQ

**Chunk 4E complete — verified in [MarginDesk CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), 4 November 2026, commit `7fe3db82951e82d5ba8a049158a7ef0a17a69597`.** Guardrails, versioned rules, worker simulation, Pricing Owner approval, ERP exports and encrypted backup/restore are available in the local shell. CI passed 163 unit tests and the authenticated 25-check vault/privacy harness. All three local browser harnesses passed. See [CHUNK_4E_VERIFICATION.md](./CHUNK_4E_VERIFICATION.md) and [PHASE_4_VERIFICATION.md](./PHASE_4_VERIFICATION.md). ERP layouts and the real folder picker remain unverified; legacy server routes still exist. **5A is built (4 Nov 2026): item master cleanup with undo, cost basis comparison, 7-day checklist, ROI on Home, seven roles with worker-enforced cost hiding. **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. See [CHUNK_5A_VERIFICATION.md](./CHUNK_5A_VERIFICATION.md); all measurements remain local only.** **5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` with [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) (local target), 4 November 2026: signed licences and tier caps, device revocation, legacy server business-data routes off by default, signed actor context and failed-login limits; see [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md). The revised table-retirement plan was approved on 5 Nov 2026 (wave 1 = chunk 6R after 6A, wave 2 = chunk 8R; see [RETIREMENT_PROPOSAL.md](./RETIREMENT_PROPOSAL.md)); no table has been dropped yet. **6A is CI-verified** in [CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5`: real public exports (UCI Online Retail I and II, AdventureWorks, Northwind) and synthetic Business Central, NetSuite, QuickBooks and SAP B1 layouts run to a Leak Report. 13 import failures were fixed with regression tests; date-range import added; vault schema v8. A follow-up built the four parked gaps (order-header joins, item-list cost, streamed XLSX sheets over 300,000 rows, German/French/Spanish/Dutch headers) and a near-quota browser check ([CI #69](https://github.com/Adityapawar5105/rebatehq/actions/runs/41960988113)); the 8 GB checklist was rerun and a 1M-line import memory fix passed [CI #70](https://github.com/Adityapawar5105/rebatehq/actions/runs/41965284570). See [PILOT_FILES.md](./PILOT_FILES.md) and [CHUNK_6A_VERIFICATION.md](./CHUNK_6A_VERIFICATION.md).

**Chunk 4B — CI-verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`.** The GitHub job API confirms step 18, "Required authenticated local-vault privacy gate", completed successfully (not skipped). Its log records `pnpm test:vault:privacy --browser=chromium`, `auth: true`, `status: passed`: **one authenticated harness with 14 named checks**, not a Playwright test-runner count. The separate unit suite passed **67 JavaScript + 56 TypeScript = 123 tests**.

Privacy acceptance covers the **local vault flow only**. Legacy server business-data routes still exist; no app-wide "data never leaves your device" claim is made. **Unverified:** deployed Supabase sign-in, headed manual checks, physical crash/quota/multi-tab recovery, the historical storage-estimate discrepancy, and CI validation of the locally measured **~7.6 s / ~15–16 s first-change latency** (open item for 4C-1). Those timings remain local observations; Scale retains its 1M-line cap. 4C-1 has not started.

**4B CI-verified (CI #44, c382f7d).**
The signed-in `/home` shell now uses a single worker-hosted encrypted local
vault, audited native CSV ingestion, atomic snapshot generations and inactivity
locking. Phase 1 navigation is Home, Data Hub, Margin, Pricing, Reports and
Settings. Old server-backed screens are labelled **Legacy** under `/legacy/`.
See [CHUNK_4B_VERIFICATION.md](./CHUNK_4B_VERIFICATION.md) for measurements,
commands and limits, [VAULT_RESULTS.md](./VAULT_RESULTS.md) for startup and
first-change timings, and [STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md) for the quota
investigation. The real authenticated local-vault privacy gate passed in CI #44; no app-wide privacy or deployment claim is made. **4C-1 has not started.**

**Chunk 4A — CI-verified in [MarginDesk CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478), 3 November 2026, commit `395154d`.** `/lab/spike` runs a
self-hosted DuckDB-Wasm worker with synthetic OPFS persistence and memory-only
user-file imports. Full-size Chrome/Edge measurements and the pending manual
checklist are in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md). CI passed 113 tests,
typecheck, the frozen migration lock and the production/self-hosted asset build.
The 4A browser harness and its measurements remain local evidence; that spike's
encrypted startup misses the three-second target. Those CI runs did not verify
headed manual checks, real Supabase sign-in, the production encrypted vault,
crash/quota/multi-tab recovery or the storage-estimate discrepancy. Current 4B
local evidence and remaining limits are recorded above. Reproduce the 4A spike with
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start --hostname 127.0.0.1 --port 3100`,
then `pnpm benchmark:spike --browser=chrome` or `--browser=msedge` in another terminal.

**Chunk 3C and Phase 3 — verified in [MarginDesk CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) and [MarginDesk Restore Drill #13](https://github.com/Adityapawar5105/rebatehq/actions/runs/40938982321), 2026-10-30 (Asia/Calcutta), commit `2f8b06d`.** Acceptance covers **162 fresh / 165 restore-mode pgTAP checks**, planned = ran with repeatability, across **38 tenant tables**. The dashboard shows invoice data readiness with a visible equal-weight formula and improvement steps; the demo scores **25%** because standard costs and default zeros are not actual evidence. Sheets schedules stage read-only CSV reviews through existing tables; commits remain explicit. Email-in/SFTP interfaces are inert previews. Phase 4 has not started. See [CHUNK_3C_VERIFICATION.md](./CHUNK_3C_VERIFICATION.md).

Migration `20261029175710_chunk3c_invoice_actual_cost.sql` is now **locked** with its unchanged normalized hash; all six earlier locked migrations and hashes are unchanged. Apply all migrations to new databases. Restore Drill #13 passed the strict column metadata, evidence/ingestion hashes, ACL/count/sentinel/runtime comparisons and repeated restored-database suite on a **local target**.

**Still unverified:** authenticated Next.js behavior, the deployed Supabase app, hosted-target restore, serverless time limits, recurring execution of schedules (requires an operator-configured runner), live email and SFTP ingestion, and browser UI beyond the local harness.

**Import capacity follow-up — verified in [MarginDesk CI #37 on `32aff35`](https://github.com/Adityapawar5105/rebatehq/commit/32aff35cd2842723206272a4147769779aa5a0d3/checks), 2026-10-29; CI job duration: 10m 24s.** The default maximum is **10,000 data rows per file**, configured by `MAX_IMPORT_DATA_ROWS` in [lib/import-config.ts](./lib/import-config.ts). CI passed the fresh/populated PGlite boundary tests, batched commit/undo with exact restoration, and later-batch rollback inside one transaction and one audited catalog import job. No Restore Drill was run because no migration or restore inventory changed. Evidence and timing limits are in [IMPORT_CAPACITY_VERIFICATION.md](./IMPORT_CAPACITY_VERIFICATION.md). Authenticated Next.js behavior, the deployed Supabase app, hosted restore, serverless time limits and browser UI beyond the local harness remain **unverified**. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

**Chunk 3B baseline — verified in [MarginDesk CI #35](https://github.com/Adityapawar5105/rebatehq/actions/runs/40844679109), 2026-10-29, commit `87d7d90`:** Supplier files can produce a before/after import plan, resolve app/file conflicts, commit valid rows, and undo safely from history. **Export for Excel** adds protected row IDs and versions; re-upload detects edits since export. Dated costs and list prices feed the shared margin/price engine. That run exercised the former **200-data-row** limit, not the new capacity follow-up. CI passed the lifecycle, conflict, exact-undo, decimal/unit, dated pricing and SQL execution tests. Source bytes are not stored; normalized plans and before/after journals are retained in existing import jobs and audits. No Restore Drill was run because no migration or restore inventory changed. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. See [Chunk 3B verification](./CHUNK_3B_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

**Chunk 3A — verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`:** Price Lists has a three-step supplier-file review for data-only XLSX, CSV and TSV. It detects the sheet and header, suggests mappings, reports issues with original row and column, and saves supplier/file-type templates per tenant. This is a dry run: it stores review metadata and relevant data-quality issues, but does not import product, cost or price rows or retain the source file. CI passed the upload size/type/row/column/cell limits, streaming limits, macro and ZIP/XML rejection, malicious-text and formula-safe export tests, malformed-file fuzzing, messy-file parsing, and tenant-scoped template tests. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. No Restore Drill was run for 3A because no migration or restore inventory changed. See [Chunk 3A verification](./CHUNK_3A_VERIFICATION.md) and [assumptions](./ASSUMPTIONS.md). Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md.

Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Chunk 3A builds on that baseline; Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md. See [the Phase 2 verification record](./CHUNK_2C_VERIFICATION.md) and [current assumptions](./ASSUMPTIONS.md).

**Chunk 2B status — verified:** pricing precedence and tiered rebate audit are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. The migration is locked with its unchanged normalized hash. Both suites passed with **88 fresh / 91 restore-mode pgTAP checks** and **33 tenant tables**. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by those runs remain **unverified**. See [the verification record](./CHUNK_2B_VERIFICATION.md). This records the earlier Chunk 2B milestone.


RebateHQ is being moved from a browser-local prototype to a multi-tenant app for mid-market distributors. Phase 1 adds the production foundation: Supabase Auth magic links, tenant and role enforcement, PostgreSQL RLS, audit logging, and a safe prototype import/export path. It does not add new pricing, rebate, or ERP features.

## Roadmap (Blueprint v2.2)

[BLUEPRINT.md](./BLUEPRINT.md) v2.2 now governs the product: customer pricing data moves to the browser (DuckDB-Wasm in a Web Worker, encrypted OPFS), and this server becomes the control plane (identity, workspaces, licences, ciphertext relay). The verified records above describe the earlier server-side phases and stay as historical evidence. **The current code still stores business data server-side; no local-only privacy claim is made until the CI privacy gate passes.** [ARCHITECTURE_TRANSITION.md](./ARCHITECTURE_TRANSITION.md) classifies every route, module and table; [BLUEPRINT_EXECUTION_PLAN.md](./BLUEPRINT_EXECUTION_PLAN.md) holds the chunk prompts.

| Repo phase | Blueprint phase | Chunks | Status |
|---|---|---|---|
| 0–3 | Foundations | 0, 1, 2A–2C, 3A–3C | Verified (CI #39, Restore Drill #13) |
| 4 | Phase 1 core | 4.0, 4A, 4B, 4C-1/4C-2, 4D, 4E | Implemented; 4E CI-verified in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), `7fe3db8`; performance remains local evidence |
| 5 | Phase 1b + control plane | 5A cleanup, cost basis, checklist, roles · 5B licences, retire server business-data paths, carried security fixes | **5A CI-verified** in [RebateHQ CI #59](https://github.com/Adityapawar5105/rebatehq/actions/runs/41854329390) on `632b24f`, [CI #60](https://github.com/Adityapawar5105/rebatehq/actions/runs/41855953059) on `7ec683e` (real-export evidence), and [CI #61](https://github.com/Adityapawar5105/rebatehq/actions/runs/41858525178) on `2fbb283` (merge-all and batch undo), 4 November 2026. See [CHUNK_5A_VERIFICATION.md](./CHUNK_5A_VERIFICATION.md). **5B CI-verified** in [CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905); see [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md) |
| 6 | Pilot hardening + security | 6A real files · 6R legacy table retirement (wave 1) · 6B security review and whitepaper → sellable v1 | 6A CI-verified (CI #68, #69, #70); see [CHUNK_6A_VERIFICATION.md](./CHUNK_6A_VERIFICATION.md). 6R CI-verified (CI #73, Restore Drill #18; 22 server tables dropped, 20 remain); see [CHUNK_6R_VERIFICATION.md](./CHUNK_6R_VERIFICATION.md). 6B not started |
| 7 | Phase 2 | 7A–7F | Not started |
| 8 | Phase 3 | 8A–8D | Not started |

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

To import, explicitly approve any numeric format/unit conversions and source warnings, then select **Preview changes**. Review new/changed/unchanged/rejected rows and choose current app or file values for conflicts. Changes and source issues are paged; every issue is available in the issue download. Conflict choices save when refreshing or changing pages. **Excel lifeline and import history** offers a CSV with `md_row_id` and `md_version` and an **Undo import** action. Keep metadata, SKU and base units intact; use blank metadata for new rows. Undo refuses later edits or dependencies and retains audit/history records. Amounts use tenant currency and standard cost basis.

### Configure import capacity

Edit **only `MAX_IMPORT_DATA_ROWS`** in `lib/import-config.ts` to change the build-wide maximum, then rebuild and rerun the capacity tests. Its default is **10,000**, including unchanged/rejected data rows, excluding the header and blank rows. The same maximum applies to XLSX/CSV/TSV review, import plans, commit and lifeline export. It is not a per-tenant setting. Lowering it blocks oversized pending commits. Undo has no row-count cap; journal and safety limits still apply.

`IMPORT_BATCH_SIZE` is 250 and review pages contain 100 rows. Batches share the request's single database transaction and catalog `import_job`: there are no intermediate commits or per-batch jobs. Every business write still invokes the existing audit triggers. Any later-batch error rolls back earlier batches, the final job update and their audit writes. Successful undo restores original business rows, IDs and counts; audit/history metadata stays.

Upload byte, raw-row, cell, diagnostic, ZIP-part and journal bounds derive from the same maximum; separate 64-column, 2,000-character cell, archive-ratio and XML protections remain. At the default, uploads are capped at 10,240,000 bytes, raw rows at 10,025 (header/preamble allowance), cells at 641,600, issues at 120,000 and journals at 81,920,000 bytes. Complex histories or oversized files may still need splitting. The routes allow 300 seconds and individual import SQL statements 60 seconds, transaction-local; hosting/pool limits must also permit the workload.

The **real-Postgres 10,000-row benchmark is verified in [CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833), commit `2f8b06d`**: `commitImport` **11,605 ms**, `undoImport` **3,442 ms**, PostgreSQL **17.11**, restricted role **`margindesk_app`**. It excludes parsing, setup, network and durable COMMIT/WAL flush, and **is not a serverless latency guarantee**. Local PGlite timings in the capacity record are separate measurements. CI #37's 10m 24s was the whole job duration; that earlier run did not capture these real-Postgres timings. Deployed throughput and the unverified behaviors listed above remain unverified. See [the detailed capacity record](./IMPORT_CAPACITY_VERIFICATION.md).

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

Phase 1 is proven. [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) passed on commit `aabfb20`, including migration, runtime role, unit/security, typecheck, build, and 53 fresh-mode pgTAP checks. [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) passed end to end in local Supabase mode, including source/target comparisons and 56 restore-mode checks. Both test suites passed repeatability checks. Hosted-Supabase restore mode and managed backup/PITR remain **unverified**.

### Chunk 2A verification status — 2026-10-28

Chunk 2A and the restore-platform-ACL-cleanup procedure are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Migration `202610280001_chunk2a_cost_units_currency.sql` is locked in `migrations.lock` with its existing normalized hash. The historical Chunk 2A plans were 70 fresh and 73 restore-mode checks across at least 29 tenant tables. The local-target restore passed strict ACL/count comparisons, four function ACL checkpoints, sentinel/runtime checks and repeatability. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these jobs remain **unverified**. See [`SECURITY_CHECK.md`](./SECURITY_CHECK.md) and [`OPERATIONS.md`](./OPERATIONS.md).

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

The checked-in GitHub Actions workflow performs these steps on pull requests, pushes to `main`/`master`, or manual `workflow_dispatch`. It needs no database or Supabase secrets. Push the branch to GitHub, then open **Actions → RebateHQ CI → Run workflow**. The database URLs are derived from the local CLI status output, and the restricted app-login password is generated randomly for the disposable local stack and written only to the job environment.

Run **Actions → MarginDesk Restore Drill → Run workflow** to exercise a logical dump and restore. Dumps are restricted to the application-owned `public` schema; Supabase-managed schemas are excluded. The drill inventories source tables and counts, creates synthetic `auth.users` stand-ins for only referenced IDs, and then compares app-owned ACLs and row counts after restore. `local` mode needs no secrets. `hosted` mode requires the two disposable database URL secrets documented by name in `.env.example`; source must already have the MarginDesk migration applied and target must be a fresh empty Supabase project. Never point the workflow at production. The corrected local-target workflow is verified in [Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`; hosted-target mode remains **unverified**.

## Phase 1 security model

- Supabase Auth owns verified email sessions. No user can join an existing tenant without an owner-issued, single-use, seven-day invitation.
- A dedicated PostgreSQL login is a member of `rebatehq_app`, which is `NOLOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`. Each server request verifies the Supabase user, opens a short transaction, sets `LOCAL ROLE rebatehq_app`, sets the JWT claims and `app.real_actor_id`, and lets tenant-scoped RLS filter records. The pool rejects a session login that is superuser, `BYPASSRLS`, or not a member of `rebatehq_app`.
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

- The four main pages remain Dashboard, Price Lists, Quoting, and Rebates. File review, catalog commit/undo, invoice readiness and staged Sheets reviews are implemented. Invoice-actuals import UI, supplier price comparison, full quote configuration, rebate claims, private-Sheets OAuth and ERP/CRM sync remain later work.
- There is no managed Supabase project or production credentials in this workspace. Live email delivery, hosted auth, deployment, and a managed-database restore drill remain operator setup items.
- Local Supabase/pgTAP checks require Docker. The real database suites are verified in CI #39 and local-target Restore Drill #13; this close-out's local commands use the PGlite harness, not a new local Supabase run.
- The virus-scan adapter is a placeholder. Files are processed in memory and not stored; connect a managed scanner before enabling persisted uploads.
- Owner export omits connector credential ciphertext; connectors must be reauthorized after restore.
- The current audit log is append-only and retained independently after tenant purge. Do not treat audit retention as a substitute for a legal retention policy.

## Chunk 3C ingestion and timing — verified in CI #39 / local Restore Drill #13

First insights in minutes from files; a live connector typically takes weeks.

The three server-only flags in `.env.example` default false: `MD_SHEETS_INGESTION`, `MD_EMAIL_DROP_STUB` and `MD_SFTP_DROP_STUB`. Enable Sheets explicitly, review a CSV in the existing wizard and save its supplier mapping, then choose **Price Lists → Scheduled file reviews**. Re-save older templates to add per-column header hashes; raw headers are not stored. Save a Google Sheets link, mapping, header row, interval and explicit number/unit approvals. Changed headers stop the fetch and identify the row/columns. **Fetch review now** stages issues and a dry run; inspect them and explicitly commit valid rows. Existing history/undo still applies.

Only public/link-readable Google Sheets CSV exports are supported; there is no OAuth or private-Sheets access. Initial host is exactly `docs.google.com`; export redirects use only `doc-…-sheets.googleusercontent.com` and `/export/`. Every hop is HTTPS and DNS/IP checked, with pinned TLS connections, a 15-second total deadline, 5-second idle timeout, three-redirect maximum and existing upload/parser limits. Use manual files for confidential/private sheets rather than publishing them. Preview email addresses use `.invalid` and cannot receive mail; no mail/SFTP servers or upload endpoints exist.

Configure a trusted external runner at least hourly with `APP_DATABASE_URL`, `MD_SHEETS_INGESTION=true`, `TENANT_ID` and an active owner/manager `ACTOR_ID`, then run `pnpm ingest:due`. It processes up to five due schedules per invocation with the non-bypass app pool; it never uses `SEED_DATABASE_URL`. Schedule metadata is UTC. Invoke separately per tenant and keep the operator identity/database URL server-side. The repo supplies the due runner, not a deployed recurring service.

`pnpm benchmark:import` passed in CI #39 with the timings above. It verifies audits/exact restoration, rolls back its fixture and checks every tenant-table count. The Sheets security/staging tests and expanded local restore passed in the same acceptance milestone; this completes Phase 3's automated scope. **Authenticated Next.js behavior, the deployed Supabase app, hosted restore, serverless time limits, recurring schedule execution without an operator-configured runner, live email/SFTP ingestion and browser UI beyond the local harness remain unverified.**

## Chunk 5B — CI-verified and Restore Drill passed (4 November 2026)

**5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` (CI #63/#64 also passed) and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905), local target. Migration `20261104160022_chunk5b_control_plane.sql` is now locked with its hash unchanged; the eight earlier locked migrations are unchanged. Suite: **188 fresh / 191 restore-mode checks**, **42 public tenant tables**, plus an owner-only private issuer table and a nontransactional login-budget sequence. See [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md). No 6A work or table retirement is authorized.

Licences are manually issued for pilots with `pnpm exec tsx scripts/issue-licence.ts <workspace-uuid> <starter|professional|scale> <ISO-expiry>`, using an operator's administrative `SEED_DATABASE_URL`. There is no billing integration. The first active owner is seated; other seats and devices are managed at /account/licence. Starter permits 1 seat and 1 location/ERP profile, Professional 5 seats and multiple locations, Scale 15 seats and multiple locations. Local SKU/line limits are in `lib/licence-policy.ts`: 20k/200k, 100k/1M, 200k/1M respectively. Scale's 1M limit remains provisional.

Configure `ACTOR_SIGNING_SECRET` (32 random bytes in hex), `LICENCE_SIGNING_KEY` (Ed25519 PKCS8 base64), and matching `NEXT_PUBLIC_LICENCE_VERIFY_KEY` (SPKI base64) in the operator's secret manager. Only the public verification key is bundled for the browser/worker. Install the audit key with `node scripts/control-plane-keys.mjs --install` using the admin URL. Never commit keys or dump contents. CI generates independent ephemeral keys, masks private values before export and needs no real secrets. A separate fixture signing key is used only by the intercepted synthetic test worker; the app's signing private key never enters that bundle.

Assertions last one hour online, refresh every five minutes, and allow up to 24 hours of offline grace, clipped to the licence end date. Invalid, absent, expired, revoked or unseated authority makes the vault read-only; viewing, unlocking, verification and encrypted backup remain available. New devices need owner approval after the workspace's first owner device. Revocation cannot be learned while offline; the fixed deadline still applies. Licences are application policy, not DRM against a device owner modifying the browser or its clock.

Keep `LEGACY_BUSINESS_ENABLED` unset/false. The retired class C/X handlers return 410 before request/auth/database access, pages 404, and legacy links are absent. Enabling the emergency legacy flag invalidates the local-only boundary. Historical business tables are retained and protected; [RETIREMENT_PROPOSAL.md](./RETIREMENT_PROPOSAL.md) awaits your approval. The old purge job is suspended and scheduled server ingestion fails closed while the flag is off.

After an operator upgrades the workspace licence, an Owner/Admin can choose **Use licensed capacity** in local Settings. It updates only the encrypted vault’s capacity metadata, with a local audit entry; it neither sends rows to the server nor recreates the vault. Lower profiles stay available at setup.
