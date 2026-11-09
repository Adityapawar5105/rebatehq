# Chunk 7E — verification

Blueprint Phase 2 (section 6) and the execution plan's 7E bullet (section 9). Part 1 is vendor price review and purchase price variance; part 2 (the Scale-only historical simulator) has not started.

## Part 1 — vendor price review and purchase price variance

**7E-1 is CI-verified** in [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`, 9 November 2026: 301 unit tests (78 JS + 223 TS), **55 authenticated Chromium vault checks** (including `vendorsUi`), **53 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Built by Claude Code. Local vault schema unchanged. No Supabase migration, no locked-hash change, no dependency change. Blueprint unchanged.

### What was built

- `lib/vendor/review.ts` (worker): supplier cost sheets, the review of one sheet, its affected open quotes, purchase price variance by SKU and its purchase lines. All four lists are worker grids (`lib/grid/sql.ts` `gridPage`), so sort, filter and totals run over every row.
- Commands, all read-only, needing the `cost` capability and the Professional or Scale tier (worker check): `vendorSheets`, `vendorReview` (sheet, 90/180/365-day window), `vendorReviewQuotes`, `vendorPpv` (optional receipt-date range), `vendorPpvLines`.
- New **Vendors** section (`components/local/VendorsView.tsx`), shown only with `cost`: a **Price review** tab (sheet picker, window, tiles for lines, increases, lines to check, margin effect, affected quotes and rule lines; review grid; affected open quotes grid) and a **Purchase variance** tab (receipt-date range; tiles; variance grid; purchase lines of one SKU). Every list meets the grid standard; amounts are in the workspace currency.
- Message keys `vendor.*` in en, es and fr; fr-CA uses "soumission" for quote labels. Theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 7E-1.

### Tests

`tests/vendor.test.ts` (5 tests) runs on a DuckDB fixture whose answers are worked out by hand: sheet listing; previous cost, change (+10.00%), every status (increase, unchanged, not in item master, first cost, a later cost on file, a different cost on the same date), volume window, margin effect (−200), open quotes, the rule trigger, totals equal to the sum of rows, filtering and sorting, refusal of other file kinds, bad windows and unknown columns; affected quotes (only the pending one; margin 4,000 before and 3,500 after); purchase variance (receipts, suppliers, net quantity 13, spend 7,000, unit 500 to 600, average 533, standard 600, variance −800; no standard means no variance; date range; per-line variance); capabilities, read-only status and the section being hidden from Sales Reps.

The browser gate adds `vendorsUi` (fresh vault in CAD, under the request and console marker sensors): two batches through Import Studio, then the newest sheet is reviewed first, the exact change (CA$5.00, 10.00%), the margin effect (−CA$20.00), the unknown SKU flagged, purchase variance (+CA$100.00) with grid totals in CAD, the purchase lines, no overflow at 375 px, and the Vendors section hidden in the Sales Rep preview. The pseudo-locale and layout walk now includes `#vendors` and `#vendors-ppv`.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 223 of 223 passed (5 new) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 53 checks (Chrome 156.0.8078.80), including `vendorsUi` |
| Same, `--browser=msedge` | passed, 53 checks (Edge 157.0.4341.42) |
| Relay and Firefox gates | not run locally; CI runs both |

### Unverified

- Real supplier sheets and purchase files from a pilot; the fixtures are synthetic.
- Large-vault timings of the review and variance queries; no capacity claim is made.
- Headed screen-reader use; native-language review of the new labels.

### CI proof (part 1)

**7E-1 is CI-verified** in [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`, 9 November 2026: 301 unit tests (78 JS + 223 TS), **55 authenticated Chromium vault checks** (including `vendorsUi`), **53 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed, including both required browser gates; their result lists include `vendorsUi`. Part 2 (the Scale-only historical simulator) has not started.
