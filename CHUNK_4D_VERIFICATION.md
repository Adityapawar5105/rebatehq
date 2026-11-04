# Chunk 4D — Pocket-margin engine and Margin Intelligence

**4 Nov 2026. CI: pending (recorded below once GitHub Actions has run).** Built on 4C-2 (CI #51, `a9ca8f7`). All measurements are local. Real-file results: [REAL_FILE_RESULTS.md](./REAL_FILE_RESULTS.md). Assumptions: `ASSUMPTIONS.md`, "Chunk 4D assumptions". Blueprint change: section 22 entry 12.

## What was built

| Task | Where | Result |
|---|---|---|
| 1. Margin engine v2 (decimal) | `lib/margin/decimal.ts`, `engine.ts`; SQL mirror `sql.ts` | Scaled-BigInt decimals, with each component rounded once (half away from zero) to whole cents. Pocket and margin are integer subtractions; rates are basis points. Every v1 golden case is identical to the cent, e.g. SO-8102: list 9,772.00, pocket 6,150.48, margin -513.52. Every seed order matches v1 on every component, and FX, cost history, quote and pass-through cases are covered. JS equals DuckDB SQL on golden, tie and 3,000 random lines in Node, and on 120,000 Playground lines in the browser. v1 (`margin-engine.js`) is unchanged and still serves the legacy server paths. |
| 2. Reconciliation | `lib/margin/aggregate.ts`; Data Hub → Reconciliation | Checks per customer x month, in total and for each rollup: pre-aggregates vs imported lines on 8 components. Every invoice must belong to one customer and one month. Differences go to `recon_issues`; the user can rebuild totals from the lines, fix the file, or accept a difference (audited). Lines are never adjusted. |
| 3. Show-me-the-math | `views.ts` `math()`, `leaks.ts` `leakRows()`; panel in `MarginView.tsx` | Opens from every waterfall step, drill cell, margin rate, line count, whale total and leak amount. Shows the formula, the inputs (recomputed by the JS engine), whether the source lines add up, and the source rows (file, row, invoice, product, customer, amounts), 25 at a time. |
| 4. Pre-aggregates and drill-down | schema v5 `agg_cpm` + rollups `agg_cm`, `agg_p` | Rebuilt after every change, in the same transaction as reconciliation. Waterfall from list to pocket margin, with "Returns and credits" and "Pocket with unknown cost" as their own steps. Drill by product, category, customer, branch, tier, region or month, with stacked filters. |
| Whale curve | `views.ts` `whale()` | Cumulative margin by customer rank, with the lowest-margin customers. Professional and Scale only; Starter shows a lock message. |
| 5. Leak finder | `lib/margin/leaks.ts` (rules in `RULES`) | Rule types: below tier floor, discount outlier, billed at a better tier, unrecovered freight, vendor cost rise not passed on, price below cost, other loss-making lines. Each finding has dollars and evidence rows. **All five Playground leaks are reproduced exactly**, by type, scope, lines and cents, and every evidence row is recomputed by the JS engine. |
| 6. Leak Report PDF and ROI v1 | `pdf.ts`, `report.ts`, `roi.ts`; Margin and Reports | PDF built in the worker and downloaded from a Blob; it is never uploaded, and each export is audited. `roi_ledger` holds one row per finding. Playground findings are flagged `sample`, never counted, and removed with the Playground. Home shows the ROI tracker. |
| 7. Credits and unknown cost | `lib/margin/credits.ts`; Fix Later "Load as returns and credits" | Negative-quantity rows load as signed `credit` lines after exact validation; a positive amount on a return is kept as `credit:sign`. Unknown cost stays NULL: its pocket is shown, but it is left out of margin and the margin leak rules. |
| 8. Timings | `marginBenchmark` in `tests/browser/vault-worker.ts` | 2M lines: waterfall 3.3 ms, product drill 156 ms, category-in-branch drill 246 ms. All waterfall and drill timings are under the 300 ms target (see below). |
| Schema v5 | `lib/vault/schema.ts` | `sales_lines` rebuilt with `line_kind` and sign checks; new tables `agg_cpm`, `agg_cm`, `agg_p`, `recon_issues`; `roi_ledger` gains `finding`, `sample`, `updated_at`. The committed v1 fixture upgrades to v5, builds its pre-aggregate and gives the expected waterfall (margin 3.75). Supabase migrations and `migrations.lock` are unchanged. |

## Decisions and fixes worth knowing

- **Playground L2 changed (blueprint section 22 entry 12).** C-0042's 25% override was exactly tier T11's schedule rate, so it was indistinguishable from L5's tier mismatch. The first browser run classified it as "billed at T11" with exactly the right lines and cents. It is now 32%, beyond every tier. The manifest was regenerated: L2 is 598 lines / $1,233,201.76 and L4 is 159 lines / $108,243.79; L1, L3 and L5 are unchanged.
- **HUGEINT is slow in DuckDB-Wasm**: summing HUGEINT aggregate columns took about 40x longer than BIGINT, and the first 2M waterfall did not finish within the test deadline. The aggregates are now BIGINT.
- **Memory guardrail (512 MB)** caused OOMs in three places at 2M lines, each fixed without raising the limit:
  - the leak finder's materialised temp tables (now views, plus five-number hits);
  - reconciliation's COUNT(DISTINCT) per invoice (now min/max);
  - a test seed that rebuilt aggregates inside its insert transaction.
- **The status totals' margin** summed only known-cost lines but sat beside a pocket that included unknown-cost lines. The new Margin view separates the two explicitly.

## Local verification

Ryzen 5 5600H, about 8 GB RAM, Windows 11; Chrome 156.0.8078.80, Edge 156.0.4314.58, Playwright Chromium 156.0.8078.4.

| Check | Result |
|---|---|
| Unit tests: 67 JS + 93 TS, including `tests/margin-v2.test.ts` (golden cases, v1 parity, JS == DuckDB SQL in Node) and the updated schema/privacy-source checks | Pass |
| Browser suite `margin` (real DuckDB-Wasm): waterfall == JS engine line by line; per-invoice and customer x month parity; Playground reconciles (30,116 invoices, 7,251 customer-months); drills add up; show-the-math agrees for 13 metrics; **5/5 manifest leaks exact**; ROI sample handling; PDF contains every leak's dollars; whale curve; stale aggregate and invoice split are flagged and never adjusted; credits waterfall exact; Starter whale gate | Pass |
| Full lab harness (`/lab/vault`). It now loads a return as a credit through the UI, checks that reconciliation flags the fixture's multi-customer invoices, opens show-the-math, downloads the Leak Report PDF and reads the ROI tracker. The private marker sits in the files; no marker in any request or console | Pass: Chrome, Edge, Chromium |
| `--full` benchmark (Chrome): 1M startup under 3 s; first change after warm-up under 2 s at 1M and 2M | Pass (2,752 ms; 726 / 1,518 ms) |
| Typecheck, migration lock, schema check, service-role scan, production build | Pass |
| Real UCI export: 10,624 returns loaded as credits; reconciled to the cent; 0 findings (no cost or tier data); Leak Report PDF produced | Done locally; data not committed |

| Measurement (local) | Result |
|---|---:|
| Playground leak finder · Leak Report PDF | 0.9 s · 0.5 s (28.5 KB) |
| Playground (120k): waterfall · product / customer / branch drill | 1.3 · 14.9 / 7.7 / 6.2 ms (Chrome) |
| 2M: waterfall · whole / branch | 3.3 / 6.7 ms |
| 2M: drill product · customer · branch · category in branch | 156 · 14.5 · 12.6 · 246 ms |
| 2M: whale · show-the-math · leak finder · rebuild + reconcile | 34.5 ms · 410 ms · 8.3 s · 4.0 s |

## Still unverified

- The authenticated privacy gate (`--auth`) runs only in CI.
- A Leak Report with real dollar findings needs a real export with cost and tiered customers. The UCI file has neither, so its report has no findings.
- The leak rules' thresholds are untested on any prospect's data.
- Leak finder speed at 2M (8 s) has no target and is not optimised.
- No headed or manual pass, and no 8 GB-laptop Edge run of the 2M margin benchmark.
- The 1M studio parse-and-load remains above 10 s (10.7 s to validate).
- Not done: `ARCHITECTURE_TRANSITION.md` planned moving the root prototype files (`seed.js`, `app.js`, ...) into `legacy/` once 4D ported the golden cases. The v1 engine and `seed.js` still serve the legacy server routes and the golden tests, so they stay at the root until those routes are retired (5B).
