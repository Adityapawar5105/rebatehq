# Chunk 6A verification — pilot hardening with real files (local evidence, pending CI)

5 November 2026. **Local evidence only, until RebateHQ CI passes on the 6A commit.** No control-plane (Supabase) migration was added, so no Restore Drill is needed. The local vault schema moved to v8.

## What was tested

See [PILOT_FILES.md](./PILOT_FILES.md) for the per-file record. In short:

- **Real public exports.** UCI Online Retail (541,909 rows) and Online Retail II (1,067,371 rows across two sheets), Microsoft AdventureWorks reseller sales with its product and reseller lists (62,162 rows, no header row), and Northwind.
- **Synthetic ERP-shaped files with planted leaks.** These follow the export layouts of Business Central, NetSuite, QuickBooks and SAP Business One (German locale). They are not real ERP exports; **the five ERP profiles stay unverified.**
- **Results.** Every file except the Northwind lines reaches a Leak Report without code edits between runs, using only in-app choices. The Northwind lines need a header/line join, which is parked.
- **Ground truth.** Business Central and SAP match the generator's truth exactly: list, credits, cost, and every planted leak with its exact line count. AdventureWorks matches an independent integer recomputation from the raw file to the cent.
- **Browsers.** Chrome and Edge give identical totals and leaks.

## Done-when criteria

| Criterion | Status |
|---|---|
| Every real file imports to a Leak Report without manual code edits | **Met, with two documented exceptions.** Northwind order lines need a header/line join (parked). The Online Retail II workbook is refused by the blueprint's 300,000-row sheet cap and loads by date range after "save as CSV" |
| Each failure has a regression fixture | **Met.** 13 failures, each reproduced with synthetic values in `tests/pilot-shapes.test.ts` (11 tests), plus the updated mapper and vault tests |
| Capacity table updated with measured numbers | **Partly.** Real-file timings are in PILOT_FILES.md and VAULT_RESULTS.md. The manual 8 GB laptop checklist (task 4) is **yours to run** in Chrome and Edge; `SPIKE_RESULTS.md` still shows it as pending |

## Edge cases (task 3)

| Edge case | Evidence |
|---|---|
| Line cap (Scale is 1M, provisional) | A 1,067,371-row batch now stops before staging with the cap message; before 6A it ran the 512 MB engine out of memory. The existing `capRollback` browser check still passes (an over-cap total is refused at review). **Keep Scale at 1M**: the real two-sheet file shows staging much past 1M rows does not fit in 512 MB |
| Date-range import | New per-file range for sales files. On Online Retail II, 12 months across both sheets loaded 489,224 lines, with 549,943 out-of-range rows skipped and counted and the Dec-2010 overlap warned about and held back |
| Browser storage near quota | Not simulated. The `storage` check records usage and quota (about 10.8 GB quota on this machine). **Unverified** |
| Interrupted import | `cancelRollback` passes in Chrome and Edge (no partial rows) |
| Two tabs open | The second-writer block (`integrity`) and `killedTabRecovery` pass |
| Restore of an older vault version | The committed encrypted v1 vault upgrades to v8 with its row intact (`v1` check). A unit test upgrades a v7 vault to v8 and keeps every line, sign rule and index |

## Local validation

Machine: Ryzen 5 5600H, about 8 GB, Windows 11, Node 24.22.1.

| Command | Result |
|---|---|
| `tsc --noEmit` | Passed |
| `node --test tests/*.test.js` | 75 passed |
| `tsx --test tests/*.test.ts` | 139 passed (128 before 6A, plus 11 in `pilot-shapes.test.ts`) |
| `node scripts/check-migrations-lock.mjs` | Passed: 9 applied, 0 pending (no new Supabase migration) |
| `node scripts/test-control-vault.mjs` (production build, disposable keys) | Chrome 156.0.8078.80 and Edge 156.0.4314.58: **31 named checks passed** in each; 100k CSV import 2,894 ms / 2,974 ms |
| Pilot runner, all 10 scenarios (git-ignored) | As in PILOT_FILES.md; Edge repeated on 5 scenarios with identical results |

The first local gate run caught a 6A regression. A canonical `discount_amount` column holding $0.50 was suggested as a 50% share. Fractions are now suggested only for loosely named columns, never for an exact `discount_amount` column or a header that says amount, and a test covers it. The gate then passed.

## Unverified / not done

- **CI:** the unit suite, build and authenticated privacy gate on the 6A commit.
- **Real prospect exports** for NetSuite, Prophet 21, Infor CSD, Business Central and QuickBooks.
- **The manual 8 GB checklist** (task 4).
- **Storage near quota:** not simulated.
- **Parked items:** header/line joins, item-master cost in the leak finder, streaming reads of spreadsheets over 300,000 rows, and localized headers. See [PARKING_LOT.md](./PARKING_LOT.md).
- **Not started:** 6R table retirement and 6B.

**Blueprint:** section 22, item 16 records the changes to sections 2 and 6A, and engine rule 9 is now implemented.
