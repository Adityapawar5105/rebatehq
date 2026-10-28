# Chunk 3A verification record — 2026-10-29

## Scope and acceptance

This chunk adds server-side data-only XLSX and UTF-8 CSV/TSV review, a Price Lists mapping wizard, supplier/file-type mapping templates, and a generated messy-workbook regression fixture. It reuses `import_job`, `column_mapping_template`, `data_quality_issue`, `product`, and `convert_quantity`. It adds **no migration, table, SQL function, or function ACL entry**. All six locked migration SQL files and `migrations.lock` are unchanged. The last CI-proven baseline remains 38 tenant tables and 156 fresh / 159 restore-mode pgTAP checks. Chunk 3B is untouched.

**Status: implemented and locally tested; unverified in GitHub Actions.** Prior Phase 2 evidence remains [CI #31](https://github.com/Adityapawar5105/margindesk/actions/runs/40739445610) and [Restore Drill #12](https://github.com/Adityapawar5105/margindesk/actions/runs/40740709133) on commit `ed2aa6d`; neither run contained Chunk 3A.

## What the review does

- Accepts only `.xlsx`, `.csv`, `.tsv` and checks contents as well as extension. A request is authenticated and rate-limited before reading bytes; the 2 MiB limit applies to the streamed body even without `Content-Length`. CSV/TSV must be UTF-8 text. XLSX is read as bounded ZIP and XML data, without formula evaluation. Archive paths, size declarations, decompression output, CRCs, XML nesting, entities, macros/embedded content and external relationships are checked. Compressed and expanded limits are separate.
- Offers visible sheet/header choices, suggests mappings for SKU, description, unit, cost, price, supplier, date and quantity, and keeps all raw values unchanged. Formula cells ignore cached results. Merges, hidden rows/columns, BOM, text numbers, comma decimals, invalid dates, duplicate SKUs, risky text and missing UOM conversions are reported by original sheet, row and column. Over 8,000 issues fails explicitly instead of truncating the report.
- Creates a tenant-scoped dry-run `import_job`, with counts and source hash but no uploaded file or cell contents in that job. The existing UOM conversion function checks catalog compatibility; a missing conversion records a row-specific `data_quality_issue` whose details include the affected unit codes, row and column. Products and prices remain unchanged. The response previews the first 50 rows and includes every issue.
- Saves mapping indexes and a header fingerprint to the existing `column_mapping_template` per authenticated tenant, supplier and file type. Loading requires a matching fingerprint; a changed header order is rejected rather than silently mapped. Only owners and managers can use these endpoints, matching the existing table policy. React renders cell text as text, and the existing CSV writer neutralizes `=`, `+`, `-` and `@` prefixes in exports.

The generated [`messy-supplier.xlsx`](./tests/fixtures/messy-supplier.xlsx) contains a merged range, a hidden supplier column, a text `12,50` cost, an ambiguous date, duplicate SKU, EA/BOX mismatch, real and text formulas, a BOM inside a cell, and malicious markup text. The parser test asserts **11 exact issues** with sheet, row and column and verifies the cached formula result is absent. The paired semicolon CSV fixture covers a file-leading BOM and comma decimal. Malformed-file fuzzing, malicious ZIP/XML mutations, oversized and disguised uploads, macro files, inert React text, formula-safe CSV output and streaming size enforcement are tested.

## Local SQL execution

`tests/import-review.test.ts` executes **all six locked migrations** in PGlite with minimal Supabase setup: `auth.users`, `auth.uid()`, platform roles, `pgcrypto`, `btree_gist`, and the `auth`/`extensions` schemas. It then executes each new application SQL statement, as the restricted `margindesk_app` role where appropriate:

1. Insert tenant, membership, product, prior job/template rows and an approved UOM conversion as generated-UUID fixtures inside a transaction.
2. Insert `import_job` dry-run metadata; run the batch product/UOM lookup with `convert_quantity`; call `record_data_quality_issue` for a missing BOX conversion; update job counts/summary.
3. Insert and update a `column_mapping_template` with its unique tenant/name/version key; select it for same and different suppliers, formats and tenants.
4. Attempt a cross-tenant template insert, asserting PostgreSQL `42501` and a row-level-security error; check that cross-tenant reads return no template. Check the active role is neither superuser nor BYPASSRLS.
5. Repeat with an approved conversion: the warning remains but the missing-conversion issue disappears, while uploaded quantity remains unchanged.
6. Run the test twice on a fresh schema and twice with existing rows, then roll back each run and compare row counts for **all 38 tenant tables**. No fixture or review residue remains.

All SQL **newly written for Chunk 3A** ran in that PGlite test. No new migration or pgTAP SQL was written. The test does **not** exercise a live Supabase Auth service, real connection pool, hosted RLS, a logical restore, or the actual Next.js route over HTTP; those Chunk 3A paths remain **unverified** until a green GitHub Actions and deployed integration run.

## Local UI and command checks

A temporary local browser harness mounted the actual wizard and parser with test API responses. It exercised file selection, eight mapping controls, supplier template save/reload, review results, inert malicious text, safe CSV download, sheet change, empty/error states, 44px buttons, and a 390px layout without page overflow. It was a UI check, not an authenticated Next.js or database deployment test. The temporary harness is not part of the repository.

Final local command results for this working tree:

| Check | Result |
|---|---|
| `pnpm test` | **Passed**: 66 JavaScript and 20 TypeScript tests, including Phase 0 golden cases, schema/security gates and Chunk 3A parser/PGlite tests. Service-role scan checked 94 user-facing files. |
| `pnpm typecheck` | **Passed** (`tsc --noEmit`). |
| `pnpm build` | **Passed** (Next.js production build; both new API routes included). |
| `pnpm check:migrations-lock` | **Passed**: six applied locked migrations, zero pending; normalized hashes unchanged. |

The final rerun exposed a pre-existing Chunk 2A test assumption: JavaScript UTC date and PostgreSQL `current_date` can differ in a non-UTC local timezone. Its two tests now take their comparison/quote date from the database and scope issue-count assertions to the tested product. No production margin code or locked migration changed. The complete suite passed after that test-only correction.

## Limits and open items

There is no committed business import or automatic correction in 3A. Unknown SKUs are reported and not matched by guess. Excel serial dates and comma decimal text remain unconverted. The file is not stored, and the scanner adapter remains unconfigured; persistent upload is disabled. Accessible keyboard and contrast decisions received a local visual review, but formal WCAG AA audit and deployed mobile/assistive-technology testing remain **unverified**. Hosted-target restore and managed backup/PITR are still unverified from prior phases. Phase 1 audit actor trust and failed-login input/rate-limit issues remain open in `ASSUMPTIONS.md`.
