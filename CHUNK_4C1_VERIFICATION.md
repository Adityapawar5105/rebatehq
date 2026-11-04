# Chunk 4C-1 — Import Studio: multi-file and converter

**3 Nov 2026. CI-verified in [MarginDesk CI #48](https://github.com/Adityapawar5105/rebatehq/actions/runs/41690570143) on commit `ea4e5b6` (12m 14s).** That run passed `pnpm test` (including the new studio and schema tests), the build, the database suites, and the required authenticated local-vault privacy gate against local Supabase (1m 40s, Chromium). The gate now covers the studio flow and the TSV/JSON/XML/XLSX marker batch. The measurements below are local, not CI. Built on 4B (CI #44, `c382f7d`) plus the vault-lease fix (CI #46, `f1971c5`). CI #48's legacy server benchmark (commitImport 16,882 ms / undoImport 4,826 ms) is runner variance on a path being retired.

## What was built

| Task | Where | Result |
|---|---|---|
| 0 Background warm-up | `lib/vault/engine.ts`, `service.ts`, `worker.ts`, UI status | After unlock, the writable copy runs on a second DuckDB connection while the main connection keeps reading the snapshot. The UI shows "Preparing for edits…". An import started meanwhile waits and then commits. A failed background copy falls back to the synchronous copy. |
| 1 Multi-file and folder | `components/local/ImportStudio.tsx` | File picker (multiple), folder picker, and drag-and-drop of files or whole folders (Chrome/Edge entries API). Up to 64 files per batch. |
| 2 Role tagging | `lib/studio/formats.ts` | Detected from aligned headers (85%) plus file name (15%) with a confidence score, with a manual override. Roles: Sales history, Item master, Customer list, Vendor cost sheet, Price list, Rebate agreement. |
| 3 Converter | `lib/studio/text.ts`, `sheets.ts`, `rows.ts` | **CSV/TSV/TXT:** streamed in 4 MiB chunks. Delimiter `, ; Tab \|`. Encodings UTF-8 (±BOM), UTF-16 LE/BE (±BOM) and Windows-1252. Decimal style. **XLSX/XLSM/XLS/XLSB/ODS:** SheetJS 0.20.3, from its official CDN rather than the outdated npm copy, behind a ZIP safety check covering zip bombs, unsafe paths, encryption and DOCTYPE/ENTITY. Sheet picker, header-row and multi-row-header detection. Merged cells are filled. Formulas are never evaluated and their cached results are not read. Macros are ignored with a notice. **JSON/XML:** largest record list, nested keys flattened, XML entities rejected. Blank, total/subtotal and page/footer rows are skipped. Rows with extra values are rejected with their location. |
| 4 Preview with fixes | `ImportStudio.tsx` FilePanel | Sheet, header row, header rows (1–3), delimiter, encoding, decimal symbol and date format, plus a preview of the first rows with the header row marked. |
| 5 Combine | `lib/studio/load.ts` | Columns align by canonical name in any order. Exact duplicate rows, repeated keys and rows already in the vault are rejected. Overlapping sales dates (within the batch and against the vault) give a warning, and so does a file that looks identical (size plus SHA-256 of its first and last 64 KiB). |
| 6 Source tracking | schema v3 | Every loaded row keeps `source_id` and `source_row` (the original sheet or file row). Remove and Replace delete or swap exactly that file's rows, and derived products/customers it alone needed are tidied up. |
| 7 Batch report | `Studio.plan` | Per file: rows read, loaded, rejected and skipped, issue count, first 100 issues with row/column, and sales date range. Rejections need an explicit acknowledgement, and every rejected row is stored as an open `import_issues` row. |
| 8 Recipes | `converter_recipes` | Saved per ERP/supplier with a header fingerprint. Applied automatically to a matching file, or offered with one click. |
| 9 Downloads | `Studio.download/zip` | Clean UTF-8 CSV: formula-neutralised, dot decimals, two-decimal amounts, ISO dates in known columns. Per file or as one ZIP. |
| 10 Tier caps | `capUsage` | Line and product caps are checked on the planned batch, with an upgrade message. The confirm button is disabled. |
| 11 Privacy gate | `scripts/test-vault-browser.mjs` | The marker sits in product_id inside TSV, JSON, XML and XLSX files, which are imported through the UI and downloaded as a ZIP. No marker appears in any request or console message. |

## Bugs found and fixed during the chunk

- **Audit verification broke at 10+ entries (from 4B).** `verifyAudit` ordered by the VARCHAR alias, so "10" sorted before "2". Because unlock verifies the chain, a real vault would have refused to unlock after its tenth logged action. Fixed by ordering on the BIGINT column (`lib/vault/audit.ts`). The studio suite now verifies a 26-entry chain.
- **Warm-up connection failure escaped** instead of falling back. Fixed and covered by the `warmup` suite.
- DuckDB cannot add columns with constraints (`ADD COLUMN ... NOT NULL`) and cannot delete a parent row in the transaction that deleted its children. The schema and the two-step removal are designed around both limits.

## Local verification (this machine)

AMD Ryzen 5 5600H, about 8 GB RAM, Windows 11 26200. Chrome 156.0.8078.80, Edge 156.0.4314.58, and Playwright Chromium 156. Production build on `127.0.0.1:3100` with `VAULT_LAB_ENABLED=true`.

| Check | Result |
|---|---|
| `tests/studio.test.ts` (18 Node tests: tokenizer at every chunk boundary, encodings, detection, every spreadsheet type, JSON/XML, safety rejections, clean output, fingerprints) | Pass |
| `tests/vault.test.ts` (schema v3, no network/logging in studio code) | Pass |
| Browser suite `studio`: 12 monthly CSVs + 1 XLSX combined (130 rows, source rows exact), duplicate file, validation/acknowledgement, remove, replace, XLS+ODS+XLSB+JSON+XML batch, item-master removal reset, Windows-1252 + UTF-16, XLSX = TSV = semicolon clean CSV, ZIP, recipe, 26-entry audit chain, encrypted reopen | Pass |
| Browser suites `warmup`, `integrity`, `v1` (upgrade to schema 3) | Pass |
| Full harness (`/lab/vault`): Chrome, Edge, Chromium; Chromium with 4× CPU throttle | Pass ×4 |
| `--full` benchmark: Chrome and Edge | Pass ×2 |

### Measurements

| Measurement | Chrome | Edge |
|---|---:|---:|
| 100k-row CSV, review + confirm through the UI | 2,309 ms (max UI long task 0 ms) | 2,318 ms (0 ms) |
| Same, Chromium at 4× CPU throttle | 4,728 ms (max UI long task 120 ms) | — |
| Unlock to ready, 1M-line vault | 2,729 ms | 2,779 ms |
| Unlock to ready, 2M-line vault | 3,314 ms (misses the 3 s target, as in 4B) | 3,317 ms |
| Background warm-up, 1M / 2M lines (vault readable meanwhile) | 7,352 / 14,067 ms | 6,889 / 13,425 ms |
| Read during warm-up, 1M / 2M | 144 / 124 ms | 98 / 110 ms |
| **First change after warm-up, 1M** (target < 2 s) | **767 ms** | **708 ms** |
| First change after warm-up, 2M | 1,595 ms | 1,504 ms |
| 1M-line CSV (64 MB) through the studio: convert + stage + validate | 6,331 ms (Chromium) | — |
| Same: load into vault tables + encrypted save | 8,137 ms (total 14.6 s) | — |

The blueprint's "parse and load 1M rows under 10 s" is met for parsing and validation (6.3 s). The full commit, with foreign-key inserts and the encrypted save, adds 8.1 s, so **end to end is 14.6 s**. That is recorded as an open item, not claimed as met. An import started during the 7 s (1M) warm-up waits for it, and the UI stays responsive.

## Still unverified

The `--full` warm-up and 1M-row benchmarks run locally only; CI runs the functional harness. Also unverified: headed manual checks, real ERP exports (4C-2), spreadsheets near the 300,000-row cap on an 8 GB laptop, physical crash, quota and multi-tab recovery during an import, and deployed Supabase sign-in.
