# Import capacity follow-up — 2026-10-29

This record describes the CI #37 capacity milestone. Chunk 3C now adds a real-Postgres timing step, still unverified until a green run; see [CHUNK_3C_VERIFICATION.md](./CHUNK_3C_VERIFICATION.md). No real-Postgres timing values are retroactively attributed to CI #37.

**Verified in [MarginDesk CI #37 on `32aff35`](https://github.com/Adityapawar5105/margindesk/commit/32aff35cd2842723206272a4147769779aa5a0d3/checks), 2026-10-29; CI job duration: 10m 24s.** The configurable **10,000-row** `MAX_IMPORT_DATA_ROWS`, batched commit/undo with exact restoration, and later-batch rollback passed the fresh/populated PGlite tests. This supersedes the former 200-row capacity evidence from [CI #35](https://github.com/Adityapawar5105/margindesk/actions/runs/40844679109), commit `87d7d90`. No Restore Drill was run because no migration or restore inventory changed. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

## CI #37 evidence and limits

The user confirmed CI #37 was green on commit `32aff35` and supplied the **10m 24s** job duration. The citation links to that commit's checks page: the exact run URL was not supplied, the connector only lists pull-request runs, and Windows browser URL-policy support prevented direct log inspection. The job log was not independently downloaded for this documentation update.

The checked-in workflow runs `pnpm test`, typecheck, build and migration-lock/schema/service-role gates, then starts local Supabase, applies migrations, verifies the restricted runtime pool/no-context behavior and runs the existing repeated **156-check fresh pgTAP suite**. `pnpm test` includes **67 JavaScript + 27 TypeScript tests**, with the capacity/batch/rollback coverage described below. All six migrations remain locked, the inventory remains **38 tenant tables**, and the **159 restore-mode** checks retain their earlier Restore Drill #12 evidence.

**Real-Postgres commit and undo timings were not captured by the workflow.** `tests/import-capacity.test.ts` creates PGlite and emits `IMPORT_CAPACITY_TIMING` there; the separate real-Postgres pgTAP/repeatability scripts do not benchmark `commitImport` or `undoImport`. The 10m 24s job duration is not import latency. Local PGlite timings below remain local measurements; no CI or real-Postgres timing values are inferred from them.

## Implementation

`MAX_IMPORT_DATA_ROWS` in `lib/import-config.ts` is the single build-wide maximum, default **10,000 data rows per file**. Parser, commit, lifeline export and UI use it. Header/blank rows are excluded from the data count; unchanged/rejected records count. Byte, physical-row/header, cell, issue, ZIP-part and journal limits derive from it, with independent column, cell-text, XML and compression-ratio guards. README and ASSUMPTIONS document the setting and rebuild requirement.

Commit and undo process **250-row batches** using typed `jsonb_to_recordset` statements. All batches remain inside `withDatabase`'s one transaction with the same restricted role, row locks, tenant advisory lock, existing audit triggers and **one catalog import job**. The separate existing file-review/export metadata jobs are not per-batch jobs. Preflight checks validate all rows before writes; the final job state is written once, with no intermediate commits.

Export baselines store normalized values and hashes. Journals retain exact original rows and committed business hashes, avoiding duplicate full after-graphs. Older graph-based exports/journals are still read. Diffs/issues are paged at 100 rows; issue downloads fetch up to 1,000 at a time. Conflict choices save in the same job across pages. No SQL function, table, role, policy, grant, migration, migration hash or dependency changes. Table minimum remains **38**, pgTAP plans **156 fresh / 159 restore mode**.

## Boundary and atomicity tests — verified in CI #37

`tests/import-capacity.test.ts` applies **all six locked migrations** in PGlite, with `pgcrypto`, `btree_gist`, minimal `auth.users`/`auth.uid()` and platform roles. Lifecycle assertions run as `margindesk_app`, asserting NOSUPERUSER/NOBYPASSRLS. No lifecycle SQL, policies, grants, conversion helpers or audit triggers are stubbed.

For **200, 10,000 and 10,001 rows**, the test runs twice for each database state:

- Fresh catalog: new product/cost/price rows under a suite-created tenant.
- Populated catalog: existing product/cost/price rows, a prior import job, registered units and other-tenant data. Accepted-size tests populate the full input size. Overflow tests retain 200 existing rows.
- Accepted files parse and preview every row, retain text-number issues beyond the former 8,000-issue ceiling, expose the last issue/change page, commit through one job and undo to exact prior business contents, IDs, dates, timestamps and row counts.
- Populated files use actual lifeline exports and app edits to the first/last rows; conflicts on separate pages resolve in the same job before commit.
- The 10,001-row parser and direct lifecycle guard both reject without adding jobs, issues or other rows.
- At 10,000 rows, a native SQL error (`22012`) is injected in the **second batch** of commit and of undo, after a real first batch. Rolling back the savepoint restores all 38 table counts and exact business hashes, including audit/job counts; no batch was committed independently.
- Each enclosing fixture transaction rolls back. All 38 table counts match baseline after both repetitions.

`tests/upload-parser.test.ts` additionally builds native-number XLSX workbooks at 200, 10,000 and 10,001 data rows, proving header exclusion and the same accept/reject boundary. Existing malformed-file, size/content/macro/ZIP/XML, malicious-text, formula-safe export and margin-engine golden tests remain active. Existing lifecycle tests still cover unchanged/rejected rows, explicit decimal/unit approvals, key/stale guards and same-day/split/gap history semantics.

## Local 10,000-row timing

Windows, PGlite/WASM, 2026-10-29; milliseconds measured around actual module calls using `performance.now()`. Final `pnpm test` output:

| Target data | Run | Parse | Change preview | Commit | Undo |
|---|---:|---:|---:|---:|---:|
| Fresh catalog | 1 | 72 ms | 872 ms | 47,305 ms | 6,927 ms |
| Fresh catalog | 2 | 51 ms | 729 ms | 48,353 ms | 6,829 ms |
| Populated catalog | 1 | 93 ms | 4,421 ms | 47,723 ms | 45,361 ms |
| Populated catalog | 2 | 168 ms | 4,922 ms | 51,033 ms | 32,511 ms |

Commit includes preflight, all business batches, audits and final job update; undo includes guards, restoration batches, audits and final job update. Timings exclude upload/network, fixture setup, the separate source review, export, conflict-choice requests and intentional failure-injection calls. Other local tests/browser checks ran during this suite. These are **local measurements, not a hosted throughput guarantee**. An earlier standalone capacity run also passed; its 10,000-row commits took 45.7–48.0 seconds. Import routes declare 300 seconds and individual import statements allow 60 seconds transaction-locally; deployed hosting/database limits remain unverified.

## SQL executed locally

Every new or changed runtime SQL statement executed in PGlite. The lifecycle AST execution inventory now includes `lib/import-batches.ts` and fails on any unexecuted literal query in the lifecycle/batch modules. `tests/import-review.test.ts` and the capacity test execute the changed review statements. Executed paths include:

1. Transaction-local timeout; tenant advisory/date/currency checks; batched product/cost/price locks and graph reads; unit/conversion locks.
2. Bounded lifeline selection, compact export job insert and bulk export-baseline reads.
3. Batched `convert_quantity` probes and `record_data_quality_issue` calls, including missing conversions and review diagnostics.
4. Dry-run job creation/update; paged stored issue and plan queries; locked job lookup; conflict-choice journal updates.
5. Batched new-product insert and trigger-created cost cleanup; metadata updates; dated cost/price close/update/insert with explicit numeric/date types.
6. Undo dependency/list guards; batched cost/price/product deletion and original product/history restoration, including original IDs/timestamps/currencies; final committed/undone journal writes and history reads.
7. Explicit fixtures, generated UUIDs, dependency-ordered seeding, native second-batch SQL failure/savepoint rollback, all-table counts and exact business-content hashes.

No changed SQL remained unexecuted locally, and the same execution inventory passed in CI #37. The existing pgTAP SQL also runs in the older PGlite harness, which stubs platform auth/roles/pgTAP assertions; the separate Supabase/Postgres workflow step runs the real security suite. The import capacity lifecycle itself is exercised in PGlite, not through authenticated Next.js or a deployed Supabase app.

## Local commands and browser check

Original implementation results:

| Check | Local result |
|---|---|
| `pnpm test` | Passed: **67 JavaScript + 27 TypeScript tests**, including both capacity states, upload boundaries, margin goldens and SQL execution inventory. TypeScript tests took about 405 seconds. |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Passed: production Next.js build. |
| `pnpm check:migrations-lock` | Passed: six locked/applied, zero pending; hashes unchanged. |

For this CI #37 acceptance documentation update on 2026-10-29, all four commands were rerun and passed. `pnpm test` passed **67 JavaScript + 27 TypeScript tests (94 total)**; the TypeScript suite took 425.3 seconds. Typecheck, production build and the migration-lock check passed. Only documentation changed; application/test code, all migration SQL and `migrations.lock` are unchanged. The earlier local timing table above is preserved as its original measurement, not replaced with inferred CI/Postgres timings.

A temporary local HTTP/PGlite browser harness mounted the actual wizard/actions/history components. At 200 rows it passed full issue download, issue/change paging, conflicts saved on both pages, one catalog job, commit/undo counts, inert malicious markup, one primary action, 44px buttons and a 390px layout without horizontal overflow. Desktop/mobile screenshots were inspected. The harness used a fixed test actor; it did not exercise actual Next.js authentication or deployed Supabase.

**Unverified:** authenticated Next.js behavior; the deployed Supabase app; serverless time limits; browser UI beyond the local harness, including 10,000-row rendering/network behavior; hosted throughput, memory and independent-session contention; hosted-target restore; undo of a pre-backup journal after a real restore; formal accessibility testing. CI #37 verifies the automated capacity/batching/rollback tests, not these deployed behaviors. No new restore run was performed because migrations and restore inventory are unchanged.
