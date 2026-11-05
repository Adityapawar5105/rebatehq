# Chunk 6A verification — pilot hardening with real files

5 November 2026. **The first 6A pass is CI-verified** in [RebateHQ CI #68](https://github.com/Adityapawar5105/rebatehq/actions/runs/41905416129) on `50263a5` (unit suite, build and the authenticated privacy gate). **The follow-up below (the four parked gaps, the near-quota check and the 8 GB benchmarks) is local evidence until CI passes on its commit.** No control-plane (Supabase) migration was added, so no Restore Drill is needed. The local vault schema moved to v8.

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
| Every real file imports to a Leak Report without manual code edits | **Met.** The first pass had two exceptions (Northwind order lines; the Online Retail II workbook). The follow-up closes both: Northwind loads with its order header file, and each workbook sheet streams to a Leak Report |
| Each failure has a regression fixture | **Met.** 13 failures in `tests/pilot-shapes.test.ts` (11 tests), plus 4 follow-up gaps in `tests/pilot-joins.test.ts` (6 tests), plus the updated mapper and vault tests |
| Capacity table updated with measured numbers | **Partly.** Real-file timings are in PILOT_FILES.md and VAULT_RESULTS.md. The manual 8 GB laptop checklist (task 4) is **yours to run** in Chrome and Edge; `SPIKE_RESULTS.md` still shows it as pending |

## Edge cases (task 3)

| Edge case | Evidence |
|---|---|
| Line cap (Scale is 1M, provisional) | A 1,067,371-row batch now stops before staging with the cap message; before 6A it ran the 512 MB engine out of memory. The existing `capRollback` browser check still passes (an over-cap total is refused at review). **Keep Scale at 1M**: the real two-sheet file shows staging much past 1M rows does not fit in 512 MB |
| Date-range import | New per-file range for sales files. On Online Retail II, 12 months across both sheets loaded 489,224 lines, with 549,943 out-of-range rows skipped and counted and the Dec-2010 overlap warned about and held back |
| Browser storage near quota | **Simulated (follow-up).** New gate check `nearQuota`: the origin quota is cut to current usage + 64 KiB, so the next encrypted save fails. The import shows "could not be saved" and the unsaved-change banner; a reload opens the previous snapshot unchanged. After space is freed, Retry Save makes the same change durable. Passes in Chrome and Edge. A real full disk was not tested |
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

## Follow-up: parked gaps, near quota (5 Nov 2026, local evidence)

Built at the user's request (blueprint section 22, item 17); details in [PILOT_FILES.md](./PILOT_FILES.md).

| Gap | Now | Evidence |
|---|---|---|
| Header/line joins | "Order headers" file type joined by invoice number; freight spread exactly | Northwind: all 2,155 lines; list, discounts, freight and pocket match an independent recomputation to the cent |
| Item-list cost | Confirmed cost source "quantity × the item list's current cost" | QuickBooks shape: 116 planted below-cost lines found (0 before) |
| Sheets over 300,000 rows | XLSX/XLSM sheets stream | Both Online Retail II sheets equal their CSV copies to the cent |
| Localized headers | German, French, Spanish, Dutch synonyms | SAP B1 file maps with no hand mapping; results equal the hand-mapped run |

| Command (follow-up) | Result |
|---|---|
| `tsc --noEmit` | Passed |
| `node --test tests/*.test.js` | 75 passed |
| `tsx --test tests/*.test.ts` | 145 passed (139 + 6 in `pilot-joins.test.ts`) |
| Browser gate, production build, disposable keys | Chrome 156.0.8078.80 and Edge 156.0.4314.58: **32 named checks** each (31 + `nearQuota`); 100k CSV import 2,939 ms / 2,892 ms |
| Pilot runner, 5 follow-up scenarios plus 2 CSV cross-checks | Installed Chrome and Edge: identical totals and leaks |

## Unverified / not done

- **CI:** the unit suite, build and authenticated privacy gate on the 6A commit.
- **Real prospect exports** for NetSuite, Prophet 21, Infor CSD, Business Central and QuickBooks.
- **The manual 8 GB checklist** (task 4).
- **CI on the follow-up commit.**
- **A real full disk** (the quota was simulated per origin).
- **Parked:** credits on item-list cost files keep an unknown cost; freight of orders whose lines all failed is not reloaded from Fix Later. See [PARKING_LOT.md](./PARKING_LOT.md).
- **Not started:** 6R table retirement and 6B.

**Blueprint:** section 22, item 16 records the changes to sections 2 and 6A, and engine rule 9 is now implemented. Item 17 records the follow-up (section 6A conversion rules).
