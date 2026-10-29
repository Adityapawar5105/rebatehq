# Chunk 3C verification

**Status: implemented, unverified in GitHub Actions.** No new passing CI or restore run is claimed. Earlier 3A/3B/capacity/close-out runs remain historical baselines. Phase 4 has not started. Implementation began 2026-10-29.

## What changed

| Area | Files and behavior |
|---|---|
| Invoice evidence | Pending `20261029175710_chunk3c_invoice_actual_cost.sql`: nullable numeric line-total actual cost plus source, paired/non-negative/non-NaN constraints, and an invoice-component lookup index. No fabricated backfill. |
| Readiness | `lib/readiness.ts`, `components/DataReadiness.tsx`, dashboard/loading/error: cost-role-only completeness counts, visible formula, missing counts and specific improvement steps. No margin-engine changes. |
| Safe Sheets fetch | `lib/sheets-fetch.ts`: narrow HTTPS host/path allowlists, every-address DNS checks, pinned fresh TLS connections, redirect/deadline/streamed-size controls and CSV content validation. No credentials/cookies forwarded. |
| Scheduled staging | `lib/ingestion.ts`, `/api/ingestion`, `scripts/run-scheduled-ingestion.ts`: existing mapping/sync/import tables, due claims/leases, safe failure records, edit/pause/resume/manual run and an operator CLI. Editing preserves a paused schedule. Fetch success stages a review; it never commits catalog data. |
| Review UI | `ImportWorkspace`, `IngestionPanel`, existing `ImportActions`/`SourceIssues`, Price Lists/CSS: one active ingestion flow, stored-plan review, per-file warning acknowledgement and existing explicit commit/history/undo. |
| Flags/stubs | `.env.example`: all three server flags default false. Email uses tenant-specific `.invalid` addresses and SFTP uses preview paths. No receiving servers or upload endpoints exist. |
| Restore and CI | Column metadata plus evidence/mapping/sync content-hash comparison, stronger source seed, 162/165 plans, and a new real-Postgres 10,000-row benchmark step with job-summary timings. |

No new table or public SQL function was needed. Existing `import_job`, `column_mapping_template`, `connector_sync_run`, UOM and data-quality helpers are reused. The table minimum stays **38**, function ACL manifest is unchanged, and all six locked migration SQL files and hashes remain unchanged. Only the new migration is pending, with normalized SHA-256:

`c5d8c6da2caf5018ace042ed8ff79e988781c096af51a9b3776ef68c1930a353`

## Readiness definition and golden results

For each invoice category, every line must pass and the invoice must contain a line. Cost requires the new actual amount/source pair. Freight and rebate require sourced, same-currency invoice-line allocations in existing `cost_component`. Default zeros/standard costs never count; sourced zeros do. Unit coverage checks registered identity/direct/reverse conversion availability using existing definitions; conversions themselves remain in `convert_quantity`.

`score = 100 × (freight-ready invoices + actual-cost-ready invoices + rebate-ready invoices + unit-ready invoices) / (4 × total invoices)`

Display rounds once to one decimal. No invoices yields “not available”, not 0% or 100%. This is invoice completeness, not dollar-weighted margin math.

- The actual checked-in `seed_data.json` import: **25%**, with all invoice units covered and no actual-cost/freight/rebate evidence; fully ready count zero.
- Four-invoice fixture: freight 2/4, cost 2/4, rebate 1/4, units 2/4 → **43.8%**; one invoice fully ready. Adding the missing BOX conversion yields **50%**.
- Sourced restore invoice: **100%**, including sourced zero freight/rebate.
- Existing invoices upgraded by the new migration keep actual cost/source NULL; no standard cost is silently promoted to actual.

The dashboard shows the exact sentence: “First insights in minutes from files; a live connector typically takes weeks.” It explicitly says catalog files do not load invoice actuals yet.

## Local security and lifecycle evidence

`tests/sheets-fetch.test.ts` passes rejection controls for HTTP/arbitrary hosts, credentials, numeric/encoded IP URLs, loopback/private/link-local/reserved/IPv4-mapped IPv6 addresses, mixed DNS answers, unsafe redirect hosts/protocols and DNS changes after redirects. Positive redirects re-resolve and pin approved addresses. Transport tests prove TLS hostname/family selection, no credential headers, declared/chunked byte caps, compressed-body rejection, MIME/status guards and the total DNS deadline.

`tests/ingestion.test.ts` runs twice on fresh and populated, restore-like schemas as the actual `margindesk_app` role, asserting NOSUPERUSER/NOBYPASSRLS. It covers due/no-longer-due reviews, save/update/pause/resume, claims/live leases/stale retirement, changed-header failure, sanitized errors, pause during fetch, no partial staging, row-level foreign-tenant denials, missing-UOM issues, one audited sync run per attempt, stored-plan warning acknowledgement and existing exact commit/undo. Every enclosing fixture transaction rolls back and all 38 table counts match baseline.

Fresh cases stage a new product; populated cases update an existing product/cost history. Per-column hashes identify the exact changed header letters without storing raw headers. Older fingerprint-only templates are rejected for scheduling with an explicit re-save instruction; manual template loading remains compatible.

The six added pgTAP checks prove actual-cost field types; missing-source and negative-amount rejection; own-row reads/writes with one audit per row; cross-tenant invisibility/reassignment RLS `42501`; and rep read/write denial. They run outside the app role only for assertions, preserving the existing restricted-role capture structure. New plans are **162 fresh / 165 restore mode**, planned = ran. The full PGlite SQL harness ran twice fresh and twice with restored-style source data, with unchanged counts. Its platform auth/roles/pgTAP functions are minimal local stubs; real Supabase acceptance remains unverified.

## Every new SQL statement executed locally

All new/changed SQL executed in PGlite; none remained unexecuted:

1. The entire new migration on fresh and already-populated invoice schemas, including nullable defaults and constraint rejection.
2. The readiness CTE/aggregate query, with real demo, empty tenant, foreign tenant, sourced zero, missing line and missing/added conversion cases.
3. Membership checks, schedule advisory locks, scoped mapping lookup/save/update/limits, pause/resume and due-claim reads/writes.
4. Running/succeeded/failed/stale sync-run writes, UTC date lookup and tenant-scoped review/plan linkage in `import_job`.
5. Existing parser/UOM/data-quality/review/preview/commit/undo calls used by the scheduled path, including warning acknowledgement updates.
6. The complete 162/165 pgTAP SQL, through the local assertion harness in fresh and restored-style modes.
7. Restore seed queries in dependency order, including its actual mapping parent; BEGIN/COMMIT/ROLLBACK and collision refusal. Column inventory and evidence-hash SQL execute against the seeded schema; missing/type-changed columns and changed actual amounts fail comparisons.
8. The real-Postgres benchmark helper's complete SQL, executed locally at 251 rows twice: explicit fixtures, app-role assertion/context, preview/commit/undo, audit/restoration assertions, rollback and counts for every table. Dynamic count queries ran for all 38 tables.

AST execution inventories fail if any literal runtime query in ingestion, the benchmark or restore seed was not observed. Existing import lifecycle/batch SQL inventories still pass. No grant was widened or security assertion removed.

## Browser and public-network smokes

A temporary local HTTP/PGlite harness mounted the actual readiness/workspace/ingestion/actions/history components. It passed formula rendering, schedule save/fetch, per-file warnings, explicit commit/undo, pause/resume, inert malicious markup, one visible primary action, 44px buttons and no page overflow at 390px. Desktop/mobile screenshots were visually inspected. Select accessible names and focusable scroll regions were corrected. A final browser smoke also proved schedule edit form population, retention of the saved ID, disabled older mapping options and the paused state at mobile width. This uses a fixed synthetic actor (and a mocked API for the edit-only smoke) and substitutes the external CSV fetch; it does not prove actual Next.js/Supabase Auth or deployed behavior.

A separate read-only smoke used the sample spreadsheet linked in [Google's official Node quickstart](https://developers.google.com/workspace/sheets/api/quickstart/nodejs). The production fetcher followed a **307** to an allowed `doc-…-sheets.googleusercontent.com` export host, received **200**, and parsed **1,408 bytes / 30 data rows**. Only status/counts were printed; no cells or redirect tokens were logged. This is local smoke evidence, not a CI or private-Sheets/OAuth test. Google documents publication/sharing limits in its [publishing guide](https://support.google.com/docs/answer/183965?hl=en); private/confidential files should use manual upload here. Transport behavior was checked against [Node HTTPS](https://nodejs.org/api/https.html) and [DNS](https://nodejs.org/api/dns.html) documentation.

## Commands and acceptance limits

- `pnpm test`: **passed twice, 67 JavaScript + 40 TypeScript tests (107 total)**; includes margin goldens, existing upload/import regressions, all new tests and schema/lock/service-role gates. The latest TypeScript phase took about 385.7 seconds.
- Targeted ingestion/review tests were rerun after the final populated-data, header-column and paused-edit changes: six tests passed.
- `pnpm typecheck`: passed after the final UI and schedule-edit changes.
- `pnpm build`: passed, including `/api/ingestion` and the dashboard loading/error paths.
- `pnpm check:migrations-lock`: passed, six locked/applied and one pending; all prior hashes unchanged.
- Docker and psql are unavailable locally. No real-Postgres timing or new actual Supabase/restore result is claimed.

CI now runs `pnpm benchmark:import` with the existing disposable database connection/setup. It performs 10,000-row `commitImport`/`undoImport` work as the restricted app role, prints `REAL_POSTGRES_IMPORT_TIMING`, and writes a summary. Role/audit/exact restoration and all-table no-residue checks are mandatory. Fixture rollback excludes durable outer COMMIT/WAL flush; parsing/setup/network are outside the timing. It is not a deployed/serverless latency guarantee.

**Unverified until green Actions runs:** this chunk's migration and real 162/165-check acceptance; new end-to-end restore including content hashes; new real-Postgres 10,000-row timings. **Still unverified/deferred:** authenticated Next.js/deployed Supabase, private Sheets/OAuth, deployed recurring scheduling/worker contention/crash recovery, hosted-target restore/PITR, pre-backup journal undo after real restore, serverless limits and formal accessibility. Phase 1 audit-actor trust and failed-login bounds/rate limiting remain open in ASSUMPTIONS. No Phase 4 feature was started.
