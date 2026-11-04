# Chunk 4C-2 — ERP mapper, resilient parser, Fix Later, health score, Playground

**4 Nov 2026. Local evidence; CI evidence pending.** Built on 4C-1 (CI #48, `ea4e5b6`). Real-file results: [REAL_FILE_RESULTS.md](./REAL_FILE_RESULTS.md).

## What was built

| Task | Where | Result |
|---|---|---|
| ERP mapper | `lib/studio/mapper.ts`, mapping editor in `ImportStudio.tsx` | Canonical names, generic synonyms and five ERP profiles (NetSuite, Epicor P21, Infor SX.e/CSD, Business Central, QuickBooks Enterprise), each **unverified** until tested on a real export. Fuzzy partial matches score 0.6. Every field shows its source, confidence and reason, and can be changed. Alternatives: unit × quantity, "not in file: 0", "not in file: unknown" (cost), and line IDs generated from invoice number plus line number or order. Anything inferred must be confirmed ("I checked this mapping") before import. Recipes save the confirmed mapping. |
| Role detection | `detectRole` (mapper) | Scores required-field coverage plus how much of the file the role explains. A single matching column can no longer win. |
| Resilient parser | `lib/studio/clean.ts` | Currency symbols/codes, thousands separators, parentheses and trailing-minus negatives, placeholders (TBD, CALL, N/A, -, #N/A) treated as empty, time of day, two-digit years, month-name dates, Excel `.0` IDs, leading apostrophes. Ambiguous values are left unchanged, so the import rejects them. The batch report counts each cleanup. |
| Fix Later | `lib/studio/fixlater.ts`, panel in `ImportStudio.tsx` | Rejected rows are kept (`rejected_rows`, canonical values) and grouped by file and problem. Set a value for a whole group, view rows, dismiss, or re-check **one group** with the import's exact validation. Duplicates need an explicit "Load anyway". Plan caps apply. Every action is audited and saved. |
| Health score | `lib/studio/health.ts` | Equal-weight mean of cost coverage, unique product IDs, price consistency (5× median rule), import completeness and customer tiers, with a visible formula and next steps. |
| Playground | `lib/studio/playground.ts` | Deterministic fictional distributor: 5,000 SKUs, 50 tiers, 400 customers, 120,000 lines over 24 months, five planted leaks. The committed manifest (`tests/fixtures/playground-manifest.json`) gives exact cents. Loads only into a vault without real files; removable. |
| Schema v4 | `lib/vault/schema.ts` | `sales_lines.cost_cents` may be unknown (indexes rebuilt around DuckDB's DROP NOT NULL limit). Adds `sales_lines.invoice_id`, `import_issues.code` and the `rejected_rows` table. The v1 fixture upgrades to v4. |

Sales `discount_amount`, `freight_amount` and `rebate_amount` are now optional (blank = 0). `cost_amount` is optional, and a blank cost stays unknown (NULL), never 0.

## Bugs found and fixed

The real UCI export exposed four:
- a sales file misread as a customer list;
- a generic export labelled P21;
- re-check loading duplicates;
- `01-Dec-2010` not parsed.

CI #50 (`f1397bf`, a work-in-progress push) found a fifth: the "I checked this mapping" checkbox snapped back until the worker answered, so on a slow runner the tick did not stick. The checkbox now updates at once and is corrected by the worker's reply. The harness waits for the confirmation to be saved.

## Local verification

Ryzen 5 5600H, about 8 GB, Windows 11; Chrome 156, Edge 156, Playwright Chromium 156.

| Check | Result |
|---|---|
| 149 unit tests (67 JS + 82 TS), including `tests/mapper.test.ts` (real-export mapping, ERP profiles, cleaning, exact unit × quantity, line-ID determinism, Playground manifest) | Pass |
| Browser suites `mapper`, `playground`, `studio`, `warmup`, `integrity`, `v1` (real DuckDB) | Pass |
| Full harness (`/lab/vault`), now driving mapping confirmation, a Fix Later bulk fix and re-check through the UI with the private marker in StockCode | Pass: Chrome, Edge, Chromium, Chromium 4× and 6× throttle |
| Typecheck, migration lock (locked migrations unchanged), schema, service-role scan, build | Pass |

| Measurement | Result |
|---|---:|
| Playground load (Chromium, all five files through the import path) | 3.4 s (target < 10 s) |
| 100k-row CSV, review + confirm through the UI | 2.9 s (Chrome; was 2.3 s in 4C-1, now including mapping and cleaning) |
| Real 541,909-row CSV: convert/validate · load + save · group re-check of 135,080 rows | 6.4 s · 5.3 s · 4.5 s |

## Still unverified

CI for this chunk; the five ERP profiles on real exports from those ERPs; spreadsheets above the 300,000-row cap (real exports exceed it); returns/credits (rejected until 4D); headed manual checks; deployed Supabase sign-in.
