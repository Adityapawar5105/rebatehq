# Chunk 3A verification record — 2026-10-29

## Scope and acceptance

This chunk adds server-side data-only XLSX and UTF-8 CSV/TSV review, a Price Lists mapping wizard, supplier/file-type mapping templates, and a generated messy-workbook regression fixture. It reuses `import_job`, `column_mapping_template`, `data_quality_issue`, `product`, and `convert_quantity`. It adds **no migration, table, SQL function, or function ACL entry**. All six locked migration SQL files and `migrations.lock` are unchanged. The last CI-proven baseline remains 38 tenant tables and 156 fresh / 159 restore-mode pgTAP checks. Chunk 3B is untouched.

**Status: verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`**, for the automated tests listed below. The run completed successfully at 2026-10-28 19:12:48 UTC (2026-10-29 00:42:48 Asia/Calcutta). It passed typecheck, all 66 JavaScript and 20 TypeScript tests, build, the migration-lock/schema/service-role gates, clean migration application, runtime pool/no-context checks, and the existing 156 fresh pgTAP checks twice with repeatability.

No Restore Drill was run for Chunk 3A because it added no migration and changed no restore inventory. The 159 restore-mode checks remain verified by Phase 2 [Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133) on `ed2aa6d`. CI #33 does not prove authenticated Next.js behavior, the deployed Supabase app, hosted restore, or browser UI beyond the local harness; these remain **unverified**. Chunk 3B has not started.

## Tests confirmed in CI #33

The [verify job log](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777/job/123039436217) records these eight parser/upload tests as passing:

1. Messy XLSX fixture keeps every value and identifies every known problem by row and column: 11 exact issues; formula cache values are not used.
2. Sheet and header are explicit choices, and header similarity suggests all eight mappings.
3. UTF-8 BOM, semicolon CSV, comma decimals, TSV and multiline quoted cells retain source locations.
4. Size, content, extension, column, row and cell limits fail closed without delimiter fallback, including oversized and disguised uploads and `.xlsm` rejection.
5. Macros, XML entities, unsafe paths, external links and both honest/lying ZIP bombs are blocked; excessive XML nesting is rejected.
6. Malicious cell text is inert React text and all CSV exports neutralize formula prefixes (`=`, `+`, `-`, `@`, including whitespace/BOM prefixes).
7. Streamed upload size enforcement does not trust `Content-Length`.
8. Deterministic malformed-file fuzzing never returns out-of-limit data or leaks parser errors, including malformed OOXML and truncated archives.

Two additional Chunk 3A tests passed: file reviews and per-supplier templates execute as restricted tenant users twice on fresh and populated PGlite schemas without residue; and only owner/manager permission is granted, with API source guards deriving tenant context server-side. The latter inspects source guards and is not an authenticated HTTP test. The React-text assertion uses server rendering, not a deployed browser.

## What the review does

- Accepts only `.xlsx`, `.csv`, `.tsv` and checks contents as well as extension. A request is authenticated and rate-limited before reading bytes; the 2 MiB limit applies to the streamed body even without `Content-Length`. CSV/TSV must be UTF-8 text. XLSX is read as bounded ZIP and XML data, without formula evaluation. Archive paths, size declarations, decompression output, CRCs, XML nesting, entities, macros/embedded content and external relationships are checked. Compressed and expanded limits are separate.
- Offers visible sheet/header choices, suggests mappings for SKU, description, unit, cost, price, supplier, date and quantity, and keeps all raw values unchanged. Formula cells ignore cached results. Merges, hidden rows/columns, BOM, text numbers, comma decimals, invalid dates, duplicate SKUs, risky text and missing UOM conversions are reported by original sheet, row and column. Over 8,000 issues fails explicitly instead of truncating the report.
- Creates a tenant-scoped dry-run `import_job`, with counts and source hash but no uploaded file or cell contents in that job. The existing UOM conversion function checks catalog compatibility; a missing conversion records a row-specific `data_quality_issue` whose details include the affected unit codes, row and column. Products and prices remain unchanged. The response previews the first 50 rows and includes every issue.
- Saves mapping indexes and a header fingerprint to the existing `column_mapping_template` per authenticated tenant, supplier and file type. Loading requires a matching fingerprint; a changed header order is rejected rather than silently mapped. Only owners and managers can use these endpoints, matching the existing table policy. React renders cell text as text, and the existing CSV writer neutralizes `=`, `+`, `-` and `@` prefixes in exports.

The generated [`messy-supplier.xlsx`](../../tests/fixtures/messy-supplier.xlsx) contains a merged range, a hidden supplier column, a text `12,50` cost, an ambiguous date, duplicate SKU, EA/BOX mismatch, real and text formulas, a BOM inside a cell, and malicious markup text. The parser test asserts **11 exact issues** with sheet, row and column and verifies the cached formula result is absent. The paired semicolon CSV fixture covers a file-leading BOM and comma decimal. Malformed-file fuzzing, malicious ZIP/XML mutations, oversized and disguised uploads, macro files, inert React text, formula-safe CSV output and streaming size enforcement are tested.

## Local SQL execution

`tests/import-review.test.ts` executes **all six locked migrations** in PGlite with minimal Supabase setup: `auth.users`, `auth.uid()`, platform roles, `pgcrypto`, `btree_gist`, and the `auth`/`extensions` schemas. It then executes each new application SQL statement, as the restricted `margindesk_app` role where appropriate:

1. Insert tenant, membership, product, prior job/template rows and an approved UOM conversion as generated-UUID fixtures inside a transaction.
2. Insert `import_job` dry-run metadata; run the batch product/UOM lookup with `convert_quantity`; call `record_data_quality_issue` for a missing BOX conversion; update job counts/summary.
3. Insert and update a `column_mapping_template` with its unique tenant/name/version key; select it for same and different suppliers, formats and tenants.
4. Attempt a cross-tenant template insert, asserting PostgreSQL `42501` and a row-level-security error; check that cross-tenant reads return no template. Check the active role is neither superuser nor BYPASSRLS.
5. Repeat with an approved conversion: the warning remains but the missing-conversion issue disappears, while uploaded quantity remains unchanged.
6. Run the test twice on a fresh schema and twice with existing rows, then roll back each run and compare row counts for **all 38 tenant tables**. No fixture or review residue remains.

All SQL **newly written for Chunk 3A** ran in that PGlite test, both locally and in CI #33. No new migration or pgTAP SQL was written. The PGlite test does **not** exercise a live Supabase Auth service, a real request connection pool, hosted RLS, a logical restore, or the actual Next.js route over HTTP. CI #33 separately passed the existing local-Supabase runtime-role/no-context and fresh database suite; the new review/template HTTP path and deployed Supabase app remain **unverified**.

## Local UI and command checks

A temporary local browser harness mounted the actual wizard and parser with test API responses. It exercised file selection, eight mapping controls, supplier template save/reload, review results, inert malicious text, safe CSV download, sheet change, empty/error states, 44px buttons, and a 390px layout without page overflow. It was a local UI check and did not run in CI #33. Authenticated Next.js behavior, the deployed Supabase app and browser UI beyond that harness remain **unverified**. The temporary harness is not part of the repository.

Final local command results for this working tree:

| Check | Result |
|---|---|
| `pnpm test` | **Passed**: 66 JavaScript and 20 TypeScript tests, including Phase 0 golden cases, schema/security gates and Chunk 3A parser/PGlite tests. Service-role scan checked 94 user-facing files. |
| `pnpm typecheck` | **Passed** (`tsc --noEmit`). |
| `pnpm build` | **Passed** (Next.js production build; both new API routes included). |
| `pnpm check:migrations-lock` | **Passed**: six applied locked migrations, zero pending; normalized hashes unchanged. |

These four commands were rerun successfully for the CI-acceptance documentation update on 2026-10-29, with the same 66 JavaScript / 20 TypeScript results. Only the five acceptance documents changed; no migration, lockfile, application code or test logic changed in this update.

The final rerun exposed a pre-existing Chunk 2A test assumption: JavaScript UTC date and PostgreSQL `current_date` can differ in a non-UTC local timezone. Its two tests now take their comparison/quote date from the database and scope issue-count assertions to the tested product. No production margin code or locked migration changed. The complete suite passed after that test-only correction.

## Limits and open items

There is no committed business import or automatic correction in 3A. Unknown SKUs are reported and not matched by guess. Excel serial dates and comma decimal text remain unconverted. The file is not stored, and the scanner adapter remains unconfigured; persistent upload is disabled. Accessible keyboard and contrast decisions received a local visual review, but formal WCAG AA audit and deployed mobile/assistive-technology testing remain **unverified**. Hosted-target restore and managed backup/PITR are still unverified from prior phases. Phase 1 audit actor trust and failed-login input/rate-limit issues remain open in `ASSUMPTIONS.md`.
