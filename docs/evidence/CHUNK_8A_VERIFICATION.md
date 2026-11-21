# Chunk 8A verification

Blueprint Phase 3, chunk 8A (BLUEPRINT_EXECUTION_PLAN.md section 9), opened by the two pre-8A fixes of blueprint v2.6 (section 22 item 28).

**8A is CI-verified** in [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f`, 10 November 2026 (Asia/Kolkata): 327 unit tests (78 JS + 249 TS), **62 authenticated Chromium vault checks** (including `guidanceUi`), **60 Firefox lab checks** (including `guidanceUi`), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v17 / 50 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Built by Claude Code. Local vault schema unchanged. No Supabase migration, no locked-hash change, no dependency change. Blueprint unchanged by this chunk (v2.6, commit `160e2bf`, governs).

## What was built

- **Pre-8A fix, gap 4:** `lib/studio/pdf.ts` reports pages with no text; `pdfGrid` adds a notice listing them; the no-text refusal names the fixed-width converter and a CSV export.
- **Pre-8A fix, gap 2:** a relay set-up card in `components/local/RelayPanel.tsx`, shown only when the page says the relay is enabled (`app/home/page.tsx` passes `RELAY_ENABLED`) and the new local command `relayLocal` (`collaborate`, read-only, no network) finds no identity for this device; dismissal remembered per workspace and user.
- **Deal guidance:** `lib/quotes/guidance.ts` and the command `quoteGuidance` (`quote`, read-only, Quote Desk tier, own or permitted quotes only): a suggested unit price and reasons per line.
- **Cross-sell:** `lib/quotes/crosssell.ts` and the command `quoteCrossSell`: basket co-occurrence, confidence and lift.
- **Quote Desk:** a "Suggested" column with the price, its basis, a "Why" list and "Use"; a "Customers who buy these also buy" grid (grid standard) with "Add".
- Message keys `guidance.*`, `cross.*`, `relay.onboard.*`, `pdf.pagesSkipped` in en, es and fr; fr-CA uses "soumission" where the wording names a quote. Theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 8A.

## Tests

`tests/guidance.test.ts` (6 tests): medians; guidance order (history, similar customers, target, book, none) with hand-worked prices, the 5-line and 365-day windows, the 90-day cost-rise rule (flag only, no amount in the result), floor and start clamps; quote guidance from stored line snapshots without the stored cost; cross-sell baskets, confidence 75.00% and lift 1.50 worked out by hand, the 3-basket and 1.20 lift thresholds, exclusions of quote items and items the customer buys, invoice-less baskets; tier, capability and own-quote gates; `relayLocal` local-only (no fetch). `tests/quotes.test.ts`: both commands added to the decision 16 scan with real history, a cost rise and a cross-sell row; `relayLocal` reviewed. `tests/converters.test.ts`: a partly scanned three-page PDF keeps its two text pages and names page 2; a fully scanned PDF's message names the alternatives.

The browser gate adds `guidanceUi` (fresh vault, under the request and console marker sensors): imported items, customers and invoices; a guardrail; a quote whose line suggests 97.00 from the customer's history with the reasons shown; "Use" sets the price; a cross-sell row (60.00%, lift 1.40) added to the quote; no overflow at 375 px; the Sales Rep preview sees the suggestion and no margin; the relay card dismissed and remembered where the relay is enabled (CI's authenticated gate), or absent with no request where it is not (lab).

## Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 249 of 249 passed (7 new: 6 in `tests/guidance.test.ts`, 1 in `tests/converters.test.ts`) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 60 checks (Chrome 157.0.8103.40), including `guidanceUi` |
| Same, `--browser=msedge` | passed, 60 checks (Edge 157.0.4341.42) |
| Relay and Firefox gates | not run locally; CI runs both |

## Unverified

- The relay card with a real relay: the lab gate has no relay (the card stays hidden with no request). CI's authenticated gate runs with the relay enabled, so `guidanceUi` takes the card's dismiss path there, but the CI log lists check names only, so which branch ran is not shown in the evidence. The relay gate itself (12 checks) does not open the card.
- Guidance quality on real pilot history (the windows and thresholds are starting points to tune with pilots); large-vault timings of guidance and cross-sell.
- Native-language review of the new sentences; headed screen-reader use of the "Why" lists.

## CI proof

**8A is CI-verified** in [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f`, 10 November 2026 (Asia/Kolkata): 327 unit tests (78 JS + 249 TS), **62 authenticated Chromium vault checks** (including `guidanceUi`), **60 Firefox lab checks** (including `guidanceUi`), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v17 / 50 tables (unchanged); 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed, including both required browser gates; their result lists include `guidanceUi`. Next chunk: 8B, only on explicit instruction.
