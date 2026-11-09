# Chunk 7F verification

## Part 1 — review cadence, recovery evidence and rep compliance

**7F-1 is CI-verified** in [CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`, 10 November 2026 (Asia/Kolkata): 314 unit tests (78 JS + 236 TS), **59 authenticated Chromium vault checks** (including `reports`, `reportsUi` and `roiUi`), **57 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault **v17 / 50 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Built by Codex; finished and verified by Claude Code. This record covers 7F-1 only. Part 2 (folder re-import and converters) has not started. Blueprint unchanged.

### Implementation and boundaries

- Monthly Pricing Review Pack and weekly digest PDFs reuse the existing worker PDF writer. Review Packs include an agenda, period-scoped leak findings, previous-month margin bridge, price exceptions, current 90-day contract expiry, customer rebate reconciliation, supplier claim status and ROI. Weekly digests include the existing rolling customer-health alerts. Checked time, workspace currency, reporting period, current-balance scope and bounded top-row counts are explicit. Overlapping leak estimates must not be added together. Neither report reads row notes.
- Checks run only on explicit refresh while the app is open. The last completed check survives encrypted reload. Cancel/failure preserves the prior stamp and never publishes a partial report. Reports are engine/version-bound; data changes or lock invalidate the prepared report. PDF preparation produces a retained download link, revoked on replacement/unmount.
- ROI v2 separates current identified real leaks, synthetic sample estimates, operator-attested recovery, linked recovery and historical unlinked amounts. An export or projected uplift is never actual recovery. A positive exact-cent recovery requires a real finding, an exported rule run, unique evidence reference, period and confirmation. Void reverses exactly once. Prior recovery is preserved when the current finding estimate falls. Run counts cover all local runs and do not prove realized savings or causation.
- Compliance uses current non-draft Quote Desk lines grouped by quote creation month, not invoice sales or a historical submission ledger. Denominators exclude missing guidance. One point for meeting the stored floor plus one for meeting the stored target; points are not money or margin. Team aggregate is the default. Only the signed-in person's aggregate can be opted into; no other person's identity, view, ranking or leaderboard is returned. Invalid quote dates are disclosed. Periods are capped at 1,096 days.
- Review PDFs require Professional/Scale plus cost. ROI reads require cost; recording/voiding additionally requires reconcile. Compliance requires Professional/Scale plus quote. Reports navigation is available to Sales Reps only for the compliance projection. New rep commands are exhaustively classified and scanned by decision-16 tests.
- Local vault schema v17 adds `roi_recoveries`, `scorecard_consent` and `report_checks` (50 local tables). Migration from v16 preserves prior money and notes. No dependency, server, API, Supabase schema or locked migration/hash changes. All business SQL, PDF work and grid operations stay in the browser worker. New writes enter the existing encrypted atomic snapshot and hash-chained audit path; audit details use IDs/codes, not evidence text or notes.

### Tests and SQL execution

`tests/reports.test.ts` executes the v17 DDL and all new query/write branches in pinned DuckDB: upgrade preservation; exact recovery/void and amounts beyond JS safe-integer precision; falling estimates; legacy unlinked recovery; validation; sample/preview/unconfirmed rejection; whole-result grids (60 records, 50-row pages); quote compliance, guidance gaps, date boundaries, invalid dates, team/self consent and forged identity; monthly and weekly reports; cancellation/stamps; all localized PDF variants; capability/tier denial, stale caches and audited actions. Existing margin golden cases and the exhaustive rep scan remain required.

Browser additions run under the existing request/header/body and console marker sensors: a worker report/recovery/scorecard lifecycle (`reports`), actual recovery entry and void in USD (`roiUi`), and a separate CAD review/digest/scorecard UI (`reportsUi`). The latter covers en/es/fr PDF downloads, retained links, grid totals, self opt-in/out, rep-private tabs, phone widths/themes, pseudo-locale and encrypted reload. They are part of the default authenticated Chromium and required Firefox gates, not only an optional focused runner.

New SQL is DuckDB-only. No new Postgres SQL was written. The existing PGlite and real-Postgres CI regression suites are retained.

### Finishing work (Claude Code)

Codex stopped on its usage limit before any browser gate had passed. Claude Code reviewed the code and finished the part:
- **Recovery tracker crash fixed:** switching the ROI tabs briefly drew the previous tab's rows with the new columns, and formatting a missing amount threw. The grid now renders only rows of its own kind.
- **Scorecard opt-in:** the checkbox was controlled by the saved value, so it flipped back until the worker answered. It now shows the choice at once and reverts only on failure.
- **Cancel label:** the shared progress bar said "Cancel import" during a report check; it now says "Cancel check" (en, es, fr).
- **Browser checks:** `reportsUi` now leaves the Sales Rep preview through the preview banner (reps have no Settings section). `recoveryUi` now runs after the main gate's other steps, unlocks the idle main vault if needed, imports its own real finding (one line whose freight exceeds 10% of list, with a vault-unique line ID), opens Margin so the leak finder records it, then records 125.25 against an exported rule run and voids it back to zero.

### Commands and results

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 236 of 236 passed (8 new in `tests/reports.test.ts`) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 57 checks (Chrome 156.0.8078.80), including `reports`, `reportsUi` and `roiUi` |
| Same, `--browser=msedge` | passed, 57 checks (Edge 157.0.4341.42) |
| Relay and Firefox gates | not run locally; CI runs both |

Local results are not CI proof. Test logs, synthetic PDFs, rendered pages and browser screenshots stay under ignored `test-results/7f1/` (and existing browser artifact paths).

### Unverified

Hosted/deployed sign-in and relay/restore, real customer/ERP/accounting acceptance, cash-posting or causal ROI claims, native-language review, headed accessibility/native permission checks, physical crash/quota/multi-tab recovery, historical storage-estimate discrepancy and new large-vault report/compliance latency are unverified. No server or background delivery exists for the weekly digest. Full 7F/Phase 2 completion awaits separately authorized 7F-2.

### CI proof (part 1)

**7F-1 is CI-verified** in [CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`, 10 November 2026 (Asia/Kolkata): 314 unit tests (78 JS + 236 TS), **59 authenticated Chromium vault checks** (including `reports`, `reportsUi` and `roiUi`), **57 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault **v17 / 50 tables**; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed, including both required browser gates; their result lists include `reports`, `reportsUi` and `roiUi`. Part 2 (folder re-import and converters) has not started.

## Part 2 — folder re-import and Phase 2 converters

Not started. Requires a new explicit user task after part 1 is green in CI.

## Part 2 — folder re-import and Phase 2 converters (local verification)

**Status: built by Claude Code, 10 November 2026; CI result: pending.** Local vault schema unchanged (v17, 50 tables). No Supabase migration or locked-hash change. Blueprint unchanged.

### What was built

- `lib/studio/layout.ts`: column boundaries from aligned gaps for fixed-width text (characters) and PDF text (points), typical-line filtering, slicing, placement and validated manual input.
- Fixed-width reports: `FixedTokenizer` (streaming, CR/LF/CRLF across chunks, over-long lines rejected), layout detection, `.prn` kind; Import Studio shows a "Columns" choice, the boundaries with "Use these columns" and "Detect again", and a ruler over the raw lines.
- PDF tables: `lib/studio/pdf.ts` with pdf.js 6.4.299 (legacy build) run inside the vault worker and loaded on demand as a separate chunk; pdf.js's worker module is evaluated so that it cannot take over the vault worker's message port. Scanned, password-protected and damaged PDFs are refused with a reason; no OCR.
- Parquet: `lib/studio/parquet.ts` and `lib/vault/parquet-engine.ts`; DuckDB's signed Parquet extension vendored and pinned (`vendor/duckdb-extensions/README.md`, `scripts/build-spike.mjs`).
- Row pipeline: repeated header rows and split page footers are skipped for every format.
- Folder re-import: `components/local/FolderReimport.tsx`, `lib/vault/folder.ts`, worker commands `folderGet`, `folderSet` (read-only) and `studioFolder`, all needing `data`.
- Dependency: `pdfjs-dist` 6.4.299, pinned exactly (pnpm 10 lockfile; high/critical audit clean, the one moderate finding is the existing `uuid` via `exceljs`).
- Message keys `layout.*`, `pdf.*`, `parquet.*`, `folder.*` in en, es and fr.

Rules for every behaviour are in `ASSUMPTIONS.md`, section 7F-2.

### Tests

`tests/converters.test.ts` (6 tests): layout detection on a print report (boundaries worked out by hand), slicing, PDF placement and boundary validation; the fixed-width tokenizer across chunk edges and over-long lines; the full row pipeline of a print report (title, repeated header, total and footers skipped), manual boundaries, "Detect again", layout switching and a recipe matching next month's report; a two-page PDF price list read by pdf.js (repeated header and footers skipped, manual breaks, recipe) and refusals of scanned, damaged and empty PDFs; Parquet grids, limits and reader failures (no engine text leaks); stored recipes with malformed layouts ignored; folder re-import through the worker dispatcher (recipe match added; imported, unsupported, unmatched and unreadable files listed; Sales Rep refused; nothing loads until confirmed).

The browser gate adds the worker check `converters` (DuckDB writes a real Parquet file after loading the pinned extension; a print report, a PDF price list and the Parquet customers import exactly; the folder handle round-trips through IndexedDB; folder re-import loads next month's report; malformed and scanned files are refused) and the UI check `convertersUi` (fixed-width ruler, a wrong boundary corrected and detected again, recipe, PDF and Parquet in one batch, phone width, folder re-import through the picker seam and a second re-import that adds nothing).

### Local checks, part 2 (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 242 of 242 passed (6 new in `tests/converters.test.ts`) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `pnpm audit --audit-level high` (pnpm 10) | passed; 1 moderate (existing `uuid` via `exceljs`) |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 59 checks (Chrome 156.0.8078.80), including `converters` and `convertersUi` |
| Same, `--browser=msedge` | passed, 59 checks (Edge 157.0.4341.42) |
| Relay and Firefox gates | not run locally; CI runs both |

### Unverified, part 2

- The native folder picker and the browser's permission prompt: automation uses an OPFS folder in place of the picker (the File System Access calls after it are real). Folder re-import in Firefox is not offered (no picker there).
- Real ERP print reports, real supplier PDFs and real Parquet exports from a pilot; all fixtures are synthetic.
- PDFs with CID fonts that need external CMaps, rotated text, and multi-line cells; large-file timings for the three converters.
- Native-language review of the new labels; headed screen-reader use of the column ruler.
