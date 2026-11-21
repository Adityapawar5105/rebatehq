# Chunk 7E — verification

Blueprint Phase 2 (section 6) and the execution plan's 7E bullet (section 9). Part 1 is vendor price review and purchase price variance; part 2 is the Scale-only historical scenario simulator. Both parts are CI-verified; 7E is complete.

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

**7E-1 is CI-verified** in [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`, 9 November 2026: 301 unit tests (78 JS + 223 TS), **55 authenticated Chromium vault checks** (including `vendorsUi`), **53 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed, including both required browser gates; their result lists include `vendorsUi`. Part 2 followed in CI #128.

## Part 2 — historical scenario simulator (Scale only)

**7E-2 is CI-verified** in [CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8`, 9 November 2026: 306 unit tests (78 JS + 228 TS), **56 authenticated Chromium vault checks** (including `simUi`), **54 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Built by Claude Code. Local vault schema unchanged. No Supabase migration, no locked-hash change, no dependency change. Blueprint unchanged.

### What was built

- `lib/vendor/simulate.ts` (worker): scenario validation, the month-by-month replay into a temporary table, totals and a worker-grid breakdown. Each imported sales and credit line in the period is replayed through the vault's line waterfall with the scenario's price and cost changes; nothing in the vault changes.
- Commands, all read-only, needing the `pricing` capability and the **Scale licence (worker check)**: `simOptions` (data span, categories, the last run while still valid), `simRun` (progress per month and cancel through the shared progress bar), `simRows` (breakdown by category, SKU, customer, customer tier or month).
- A third Vendors tab, **Scenario simulator** (`#vendors-sim`), shown only to roles with `pricing`; a Professional workspace sees a Scale notice instead. Period of whole months, up to 20 price or cost changes by all lines, category, customer (price only) or SKU; results as tiles (lines, actual margin, scenario margin, margin change), an actual-versus-scenario grid and the breakdown grid. Both grids meet the grid standard; amounts are in the workspace currency.
- Guardrails: at most 36 months and 2,000,000 lines per run (checked before any work); a cancelled or failed run leaves nothing behind; a run is discarded when the data changes or the vault locks.
- Message keys `sim.*` in en, es and fr (no quote wording, so no fr-CA override). Theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 7E-2.

### Tests

`tests/simulator.test.ts` (5 tests):
- input validation (months, percent text, scopes, duplicates, the 36-month and 20-change limits, SQL text as data);
- a hand-checked fixture: half-away-from-zero rounding (115.5 → 116, −555.5 → −556), a credit line, an unknown cost, precedence (SKU over customer over category over all), totals (margin 91 → 164, +73), the breakdown by category, month, tier, customer and SKU with grid sort, filter and totals, and the vault unchanged with the run in a temporary table only;
- cancel between months (no partial run left) and the 2M-line guardrail refusing before any work;
- **the playground** (120,000 generated lines; 2025 replayed with seven changes): the simulator's actual and scenario totals equal an independent replay of every line through the engine (`lineFromCents` with `rha`), a zero change equals what happened, and the breakdown totals equal the run totals by month, category and tier;
- the gates: Starter and Professional refused (`LICENCE`) for all three commands, Sales Rep and Accountant refused (`FORBIDDEN`), a run invalidated by a data change, every `pricing` role also holding `cost`, and no audit row written.

The browser gate adds `simUi` (fresh CAD vault, under the request and console marker sensors): two months imported through Import Studio, a +10% price scenario with the exact margin change (+CA$49.00), actual and scenario margins, the month breakdown with grid totals in CAD, the run kept across a tab switch, no overflow at 375 px, and the simulator hidden from an Accountant preview. The pseudo-locale and layout walk now includes `#vendors-sim`.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 228 of 228 passed (5 new) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 54 checks (Chrome 156.0.8078.80), including `simUi` |
| Same, `--browser=msedge` | passed, 54 checks (Edge 157.0.4341.42) |
| `--sim-ui-only` in Chrome and Edge after restoring the run's changes on return | passed |
| Relay and Firefox gates | not run locally; CI runs both |

### Unverified

- Timing of a real 2M-line, 36-month replay on an 8 GB laptop; the playground year (about 60,000 lines) is the largest replay run. No capacity claim is made.
- Cancelling a long replay in the browser by hand; cancel is proved in the unit test and uses the same worker cancel as imports.
- Pilot review of the method (no volume response, discount and rebate moving with list).
- Headed screen-reader use; native-language review of the new labels.

### CI proof (part 2)

**7E-2 is CI-verified** in [CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8`, 9 November 2026: 306 unit tests (78 JS + 228 TS), **56 authenticated Chromium vault checks** (including `simUi`), **54 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v16 / 47 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed, including both required browser gates; their result lists include `simUi` and `vendorsUi`. 7E is complete. Next chunk: 7F, only on explicit instruction.
