# Real export test — UCI "Online Retail" (chunk 4C-2)

**4 Nov 2026. Local measurements, not CI.** This is the first real (not synthetic) export run through MarginDesk.

## The file

[UCI Machine Learning Repository, dataset 352 "Online Retail"](https://archive.ics.uci.edu/dataset/352/online+retail), CC BY 4.0. It holds the real invoice lines of a UK online wholesaler of giftware (many of its customers are wholesalers) from 1 Dec 2010 to 9 Dec 2011, with customers anonymised to numeric IDs.

- `Online Retail.xlsx`: 23.7 MB, one sheet, 541,909 data rows, 8 columns: `InvoiceNo, StockCode, Description, Quantity, InvoiceDate, UnitPrice, CustomerID, Country`.
- Variants made the way a user would: an Excel-style "Save as CSV" (44 MB, dates written as `12/1/10 8:26`) and a 100,000-row XLSX slice.
- The files live only in git-ignored `test-results/real/`. **No real data is committed**; CI uses a synthetic look-alike (`retailLike` in `tests/helpers/studio-fixtures.ts`).

It is **not** one of our ERP profiles and not a prospect's file. NetSuite, P21, Infor, Business Central and QuickBooks profiles remain unverified on real exports.

## Before 4C-2 (the 4C-1 build)

| File | Result |
|---|---|
| Full XLSX (541,909 rows) | Refused by the 300,000-row spreadsheet cap, with "save it as CSV" |
| 100k XLSX | Read in 1.45 s, but **detected as "Customer list"** (only `CustomerID` matched); a confirm would have loaded 1,664 customers and rejected 98,336 rows |
| CSV | Converted and checked in 2.1 s, but **detected as "Customer list"**: 4,372 customers, 537,537 rows rejected as duplicates |

The 4C-1 role detector trusted a single matching column. That is the most important finding from this test, and 4C-2 fixes it.

## After 4C-2 (full CSV, Chromium, Ryzen 5 5600H / 8 GB)

**Detection:** Sales history (score 0.68 vs 0.54 for the next role), generic ERP profile, date format MM/DD/YYYY. The suggested mapping, which the user must confirm:
- `line_id`: generated from `InvoiceNo` plus line order, deterministic so a re-import is detected
- `invoice_id` ← `InvoiceNo`; `product_id` ← `StockCode`; `customer_id` ← `CustomerID`; `sale_date` ← `InvoiceDate`; `quantity` ← `Quantity`
- `list_amount` ← `UnitPrice` × `Quantity`, exact to the cent
- discount, freight and rebate: not in the file, 0 (confirmed by the user)
- cost: not in the file, **left unknown, never 0**

| Step | Result | Time |
|---|---|---:|
| Convert + clean + stage + validate 541,909 rows | 392,729 ready, 149,180 rejected | 6.4 s |
| Cleaning applied | time dropped and two-digit year expanded on all 541,909 dates | — |
| Load into vault + encrypted save | 392,729 lines, 3,665 products, 4,339 customers | 5.3 s |
| Rejected → Fix Later | 135,080 blank `CustomerID` · 8,905 negative quantity (cancellations/returns) · 5,195 exact duplicate rows | — |
| Bulk fix: blank customers → `CASH-SALE` (user's choice) | 135,080 rows corrected | 0.55 s |
| Re-check that group only | **133,359 loaded**; 1,721 still rejected (1,719 also negative, 2 negative prices); the 5,195 duplicates are untouched | 4.5 s |
| Vault after | 526,088 lines; audit chain valid | — |

**Data health: 54% after import, 58% after the fix.** Components after the fix:

| Check | Score | Finding |
|---|---:|---|
| Lines with a known cost | 0% | The export has no cost column. No margin can be trusted until cost comes from an item master or vendor sheet |
| Unique product IDs | 94% | 224 of 3,941 product IDs differ only by case or spaces (e.g. `85123A` / `85123a`) |
| Consistent prices | 99% | 3,611 of 525,084 comparable lines priced above 5× or below 1/5 of the product's median |
| Import completeness | 97% | 15,821 rows still in Fix Later (10,624 negative quantities, 5,195 duplicates, 2 negative prices) |
| Customers with a tier | 0% | No customer list was imported |

## Bugs this file found (all fixed in 4C-2)

1. **Wrong role:** a sales export was read as a customer list. The fix scores the whole mapping and how much of the file it explains.
2. **Wrong ERP label:** a generic export was labelled "Epicor P21". Only ERP-specific header names count now.
3. **Duplicates loaded by mistake:** "Re-check" loaded *every* open row of the file, including 5,195 duplicates, which double-counts sales. It now re-checks only the group the user fixed, and duplicates need an explicit "Load anyway".
4. Dates like `01-Dec-2010` were not recognised (regex bug).

## Open items this test exposed

- **Returns and credits** (10,624 lines here) are not loaded. The margin engine (4D) must decide how credits enter the waterfall.
- **Real spreadsheets exceed the 300,000-row cap.** Users must save as CSV today. A streaming XLSX reader belongs in pilot hardening (6A).
- **Cost is often absent** from sales exports. Cost basis (5A) and item-master/vendor-cost joins are essential before margins mean anything.
- Prospect ERP exports are still needed to verify the five ERP profiles.

## Chunk 4D on the same export (4 Nov 2026, local, Chromium)

Full CSV, then a bulk fix of blank customers to `CASH-SALE`, then the negative-quantity group loaded as credits. Run with a git-ignored runner in `test-results/real/`.

| Step | Result | Time |
|---|---|---:|
| Import (as in 4C-2) + fix + re-check | 526,088 sales lines | 6.3 + 6.1 + 5.5 s |
| Load as returns and credits | **10,624 credit lines loaded, 0 sign errors**; 5,195 duplicates and 2 negative prices remain in Fix Later | 2.8 s |
| Waterfall | 536,712 lines. Sales list = sales pocket = $10,641,929.78 (the file has no discounts, rebates or freight). Returns and credits: -$896,812.49. Net pocket: $9,745,117.29 | 5 ms |
| Margin | **Not computable**: 0 lines have a known cost, so all net pocket is shown as "unknown cost" and margin is $0.00 on 0 costed lines (never cost 0) | — |
| Reconciliation | Reconciled to the cent: 25,898 invoices, 13,688 customer-months, no invoice split across customers or months | 0.1 s |
| Leak finder | **0 findings**: no customer tiers (no discount rules apply) and no costs (no margin rules apply). It reports 524,905 uncosted / untiered lines not checked | 0.3 s |
| Leak Report PDF | Produced on the device (6,165 bytes), stating the above; saved only under git-ignored `test-results/real/` | 1.4 s |

A real Leak Report with dollar findings needs an export with cost and a customer list with tiers. Pilot files (6A) remain the open item.