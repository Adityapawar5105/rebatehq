# Near-miss rebate tiers — verification

Built by Claude Code on 26 November 2026 (blueprint section 22, item 39). The owner asked for the important features from a competitive analysis to be added. The triage stays outside this public repository. No new command, schema change, migration or server change.

## What it adds

`lib/rebate/nearmiss.ts` is exact and works in integer cents and whole days. For each programme it computes:
- **Extra rebate at next tier:** the accrual at the next threshold less the accrual now. For a retroactive programme, that includes the higher rate on all spend so far.
- **Days left:** inclusive days to the period end, counting today.
- **Per day:** the amount still needed each day, rounded up to the cent.
- **Outlook:**
  - **on pace:** the spend so far, carried straight-line over the days after today, reaches the threshold;
  - **within reach:** less than 25% of the threshold is left;
  - **far:** otherwise;
  - **top tier reached;**
  - **not started:** before the period starts;
  - **closed:** after the period, a paused customer programme, or a supplier claim that is no longer a draft;
  - **not tiered:** ship-and-debit.

**Where it shows:**
- **Customer rebate progress** (`rebateProgress`) and **supplier rebate progress** (`supplierProgress`) gain the `extra`, `daysLeft` and `outlook` grid columns. Each sorts and filters in the worker.
- Each also returns `near`: the count and the extra rebate of the on-pace and within-reach rows.
- **The line above each grid** (`components/local/NearMiss.tsx`) shows that count and value. **Show them** filters to on pace and within reach and sorts by extra rebate; **Show all** clears the filter.
- **The monthly and weekly report PDFs** list the ten nearest programmes, customer and supplier, by extra rebate (`nearTiers` in `lib/reports/pack.ts`).
- **Strings:** English, Spanish and French. Canadian French falls back to French, which uses "ristourne" as elsewhere.

## Decision 16

The new values come only from eligible spend and the tiers. `rebateProgress` is reachable by a Sales Rep and stays in the payload scan in `tests/quotes.test.ts`, which passed with the new fields. Supplier progress still needs `cost`.

## Checks run locally (not CI evidence)

- **Unit tests:** `tests/rebate-nearmiss.test.ts` (4 tests) covers:
  - the extra rebate, retroactive and incremental;
  - pace, within reach and far;
  - the per-day amount on the last day and rounded up;
  - ended, not started and top tier;
  - the summary.

  `tests/rebate-local.test.ts` adds the outlook of an active and a paused programme, and a worker filter on `outlook`.

  `tests/supplier-claims.test.ts` adds:
  - an on-pace draft claim worth $310 more;
  - a closed period;
  - a frozen claim;
  - a ship-and-debit claim;
  - the report ranking.

  `tests/reports.test.ts` checks the new PDF section in en, es and fr.
- **Full suites:** JS 80 of 80 and TypeScript 405 of 405. `tsc --noEmit` is clean.
- **Vault browser gate** (lab mode, Chrome, production build): **73 checks passed**. `rebatesUi` now asserts that a programme whose period ended on 31 March reads "closed" and that no near-miss line shows for it.
- **Local `node_modules`** still holds Next.js 16.4.3. The lockfile pins 16.4.6 (PR #44), so CI is the check on the real version.

## Not verified

- **A browser check of the "Show them" line with a programme that is near its tier.** The unit tests cover the calculation, the worker filter and the ranking.
- **Native-language review** of the new Spanish and French strings.
- **The straight-line pace** is an estimate. Seasonal buying is not modelled, and the screen help says these are estimates.
