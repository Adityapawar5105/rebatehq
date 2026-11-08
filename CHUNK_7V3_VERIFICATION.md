# Chunk 7V-3 — verification

Blueprint v2.5, section 22 items 26-27. Part a is the grid standard; part b (row notes) has not started.

## Part a — grid standard: sort, filter, selection totals

**7V-3a is CI-verified** in [CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`, 8 November 2026: 278 unit tests (78 JS + 200 TS), **51 authenticated Chromium vault checks** (including `gridsUi`), **49 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v14 / 45 tables, 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Local vault schema unchanged (v14, 45 tables). No Supabase migration, no locked-hash change, no dependency change. Blueprint unchanged by this part.

### What was built

- `lib/grid/core.ts`: the shared rules. Exact decimal comparison (no floating point), typed sort (money, integers, decimals and percents numerically; dates chronologically; text by the UI language, case- and accent-insensitive), blanks last in both directions, ties kept in the grid's own order, multi-value filters with "(Blanks)", distinct values (capped at 500, with search), exact SUM / AVG / MIN / MAX / COUNT, and validation of every grid query against the grid's own column list.
- `lib/grid/sql.ts`: the worker side. A paged command keeps its own SQL as a base query; `gridPage` filters, sorts, pages, counts, lists distinct values and totals over the whole result in DuckDB. Column names come only from the command's code-defined spec; values are quoted. `memoryPage` does the same for rows the worker already holds (price-grid drafts, landed checks, rebate progress) and still totals in DuckDB. `valuesTotals` totals the rows a person selected in a browser-held grid (new read-only command `gridTotals`, capability `view`, at most 5,000 rows and 24 columns, numbers only).
- `components/ui/DataGrid.tsx`: one table for every data grid. Sort button and filter button on each column header (keyboard operable, `aria-sort`, Escape closes the filter and returns focus), "N of M rows" and "Clear filters", a selection column (checkbox, shift-click range, select all, or select all matching the filters on a worker grid), and a polite status bar with the totals of every numeric column the person can see, in the workspace currency and UI language. The filter panel is fixed to the viewport so a scrolling table cannot clip it.
- Eleven paged commands now accept a grid query and return grid counts: `marginDrill`, `marginMath`, `leakRows`, `marginBridge`, `priceExceptions`, `priceExpiry`, `priceGrid`, `priceLandedState`, `serviceOrders`, `rulePreview` (SQL and price-grid drafts), `rebateProgress`, `rebateRows`. `serviceOrders` now returns `{ rows, offset, grid }` like the others.
- Message keys `grid.*` in en, es and fr (fr-CA inherits; `quotes.linesLabel` has its own fr-CA wording). Colours only from theme tokens. Four new icons (sort, sort up, sort down, filter).

### Inventory of tables in the local app

Every table under `components/local`, checked 8 November 2026.

| Screen | Table | Kind | Rows from | Standard |
| --- | --- | --- | --- | --- |
| Data Hub · Cleanup | Duplicate SKUs | data grid | browser | yes |
| Data Hub · Cleanup | Unit spellings | data grid | browser | yes |
| Data Hub · Cleanup | Missing categories | data grid | browser | yes |
| Data Hub · Cost basis | Margin by cost basis (with "All groups" footer) | data grid | browser | yes |
| Data Hub · Import | Files in this batch | data grid | browser | yes |
| Data Hub · Import | Batch report | data grid | browser | yes |
| Data Hub · Import | Imported files | data grid | browser | yes |
| Data Hub · Fix Later | Rejected-row groups | data grid | browser | yes |
| Data Hub · Fix Later | Rejected rows of one group | data grid | browser (first 50 rows of the group) | yes, within the 50 shown; the screen says it shows the first rows |
| Data Hub · Reconciliation | Open differences | data grid | browser | yes |
| Data Hub · Import | Column mapping | not a grid: a form of mapping controls | — | — |
| Data Hub · Import | First rows of a file | not a grid: the raw file preview, where row order shows which row is the header | — | — |
| Data Hub · Data health | Score components | not a grid: a show-the-math breakdown of one score | — | — |
| Margin · Waterfall | Waterfall | not a grid: the chart and its accessible table, in a fixed step order | — | — |
| Margin · Waterfall | Drill-down | data grid | worker (top 100 by the chosen order; sort and filter over every group) | yes |
| Margin · Waterfall | Whale curve: lowest customers | data grid | browser | yes |
| Margin · Waterfall | Leak findings | data grid | browser | yes |
| Margin · Show the math | Source rows (a number or a leak) | data grid | worker, 25 per page | yes |
| Margin · Bridge | Bridge by product, customer or branch | data grid | worker, 50 per page | yes |
| Margin · Competitors | Alternatives | data grid | browser | yes |
| Margin · Competitors | Competitor observations | data grid | browser | yes |
| Margin · Cost to serve | Service orders | data grid | worker, 50 per page | yes |
| Pricing · Rules | Change preview | data grid | worker, 50 per page | yes |
| Pricing · Price grid | Editable price grid | data grid | worker, 50 per page | yes |
| Pricing · Landed check | Landed rows | data grid | worker, 50 per page | yes |
| Pricing · Versions | Price versions | data grid | browser | yes |
| Pricing · Exceptions | Price exceptions | data grid | worker, 50 per page | yes |
| Pricing · Expiry | Contract expiry | data grid | worker, 50 per page | yes |
| Quotes | Quote lines | data grid | browser | yes |
| Quotes | Quote inbox and history | data grid | browser | yes |
| Rebates | Rebate progress | data grid | worker, 50 per page | yes |
| Rebates · Show the math | Accrual source rows | data grid | worker, 50 per page | yes |
| Rebates | Tier editor | not a grid: a form | — | — |
| Rebates · Show the math | Program tiers | not a grid: the terms being explained | — | — |
| Home | Cash leak show-the-math | not a grid: a breakdown of one number | — | — |
| Home | Customer health show-the-math | not a grid: before/after of one customer | — | — |
| Settings · Roles | What each role can do | not a grid: a legend | — | — |
| Settings · Roles | People and roles | data grid | browser | yes |

29 data grids meet the standard; 9 tables are not grids. Legacy `/legacy` pages and the server account pages are out of scope. There is no customer list or item master grid yet: 7V-3b creates them for row notes and they will use this grid.

### Decision 16

- The grid shows only the columns a role already sees. A worker grid can sort, filter or total only its own spec columns, so a query cannot add a column. The one rep-reachable worker grid, `rebateProgress`, has no cost, margin or pocket column (unit test).
- `gridTotals` totals numbers the caller already holds; it is classified in `tests/quotes.test.ts` as reviewed, and it is read-only.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 200 of 200 passed (191 before, 9 new in `tests/grid.test.ts`) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (`next start`, lab mode) | passed, 49 checks (Chrome 156.0.8078.80), including `gridsUi` and the CAD rebate totals |
| Same, `--browser=msedge` | passed, 49 checks (Edge 157.0.4341.42) |
| Relay gate and Firefox gate | not run locally for this part; CI runs both |

`tests/grid.test.ts` covers exact comparison beyond 2^53, typed sort with blanks last and stable ties, filters with blanks, distinct values honouring the other filters, average rounding, query validation (unknown columns, bad directions, oversized lists), a 1,204-row DuckDB grid (numeric order over the whole result, paging, a quoted injection attempt treated as data, distinct values with counts and the 500 cap, totals equal to an independent sum), totals in DuckDB equal to the exact BigInt rules, rejection of non-numbers and formulas, the contract-expiry command end to end, and the rep-reachable grid's columns.

The browser gate adds `gridsUi`: drill-down sort ascending and descending over the 100,000-line history, a one-value filter with "1 of N rows", totals of all matching rows, a shift-click range whose total equals the selected cells, a browser grid's numeric sort and totals, and the price grid's worker sort. `rebatesUi` now also checks that the totals of every matching rebate row are the earned amount in CAD.

Fixes found by the local gates before the first push: the filter panel opened under the left sidebar on the first column (now rendered on the page body, aligned to its column), and a shift-click range read its start after the anchor had moved (now read first). One Chrome run measured a 357 ms main-thread pause during the 100,000-row import; the next two runs measured 0 ms in both browsers, so it was machine load, not the grids.

### Unverified

- Headed screen-reader use of the header buttons and filter panel; only automated keyboard and role checks ran.
- Large-vault timings of filter and distinct-value queries; no capacity claim is made.
- Native-language review of the new es, fr and fr-CA labels.

### CI proof

**7V-3a is CI-verified** in [CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`, 8 November 2026: 278 unit tests (78 JS + 200 TS), **51 authenticated Chromium vault checks** (including `gridsUi`), **49 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice. Local vault v14 / 45 tables, 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every step of the job passed, including "Required authenticated local-vault privacy gate" and "Required Firefox local-vault lab gate"; their result lists include `gridsUi` and `rebatesUi`. Part b (row notes) has not started.
