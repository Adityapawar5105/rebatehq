# Pilot files — chunk 6A

**5 November 2026. Local runs, not CI evidence.** No prospect has sent an ERP export yet, so 6A used the best available stand-ins:

- **Real public exports.** UCI Online Retail and Online Retail II (a UK giftware wholesaler), Microsoft AdventureWorks reseller sales, and Northwind.
- **Synthetic ERP-shaped files.** These follow the published export layouts of four ERPs, with planted leaks whose answers are known. They are not real ERP files: **the five ERP profiles stay unverified until a prospect's real export is tested.**

All files stay in git-ignored `test-results/real/` and are never committed. This record holds counts, settings and aggregate totals only, no row values.

**Method.** A git-ignored runner (`test-results/real/6a/run-6a.mjs`) drives the real vault worker in headless Chrome, and again in Edge, on a production build. It does only what a user does in the app:
1. Add the files and keep auto-detection's choices.
2. Make the in-app choices recorded below: role, header row, column mapping, date range and confirm.
3. Commit, then fix blank customers with CASH-SALE (the user's choice) and load returns as credits.
4. Run the waterfall, reconciliation, leak finder and Leak Report PDF, then verify the audit chain.

**Machine:** Ryzen 5 5600H, about 8 GB, Windows 11; vault on the Scale tier. **No code was edited between a file's runs.** Chrome and Edge gave identical totals and leaks on every file run in both (BC, SAP, AdventureWorks, UCI I and the UCI II range). Edge's timings were within 7% on the large files; on the small synthetic files they differed by up to 74 ms.

## Files

| File | Source / ERP shape | Format | Rows | Auto-detected | User actions | Result |
|---|---|---|---:|---|---|---|
| online-retail.csv | UCI Online Retail (real) | CSV, MM/DD/YY dates with time | 541,909 | Sales history 0.68, generic; min confidence 0.80 | Confirm; blank customer → CASH-SALE; load credits | **Leak Report.** 536,712 lines, reconciled (25,898 invoices); no cost in file, so 0 margin leaks (as in 4D) |
| online_retail_II.xlsx | UCI Online Retail II (real) | XLSX, 2 sheets of 525k and 541k rows | 1,067,371 | — | — | **Refused**: "more than 300,000 rows… save it as CSV" (blueprint cap). Fixed in the follow-up below |
| …II, both sheets saved as CSV | same | 2 CSVs | 1,067,371 | Sales history 0.68 each | — | **Refused before staging**: "more than 1,000,000 sales rows, the scale limit… choose a date range" (was an engine out-of-memory before 6A) |
| …II, both CSVs, June 2010–May 2011 | same | 2 CSVs | 517,428 in range | as above | Date range per file; CASH-SALE; credits | **Leak Report.** 489,224 lines, reconciled (25,900 invoices); overlap warning; 15,814 Dec-2010 rows repeated across sheets held as duplicates |
| FactResellerSales + DimProduct + DimReseller | Microsoft AdventureWorks DW (real sample) | Pipe-delimited, **no header row**, 4-decimal money, SQL `.9999` decimals, embedded photo hex | 60,855 / 606 / 701 | No header row detected (columns A…) | Role per file; map columns by letter | **Leak Report.** All 62,162 rows loaded, 0 rejected; reconciled (3,796 invoices); margin −1.96%; 325 findings, $4,409,398.16 |
| order_details + products + customers | Northwind (classic sample) | CSV, header/line split | 2,155 / 77 / 91 | Sales: customer and date missing | — | **Sales lines blocked** (customer/date live in orders.csv); products and customers load. Fixed in the follow-up below |
| bc-posted-sales-invoice-lines.xlsx + bc-customers.xlsx | Synthetic, Business Central "Open in Excel" | XLSX; freight G/L lines, comment lines | 7,140 / 40 | Sales 0.79, **Business Central**; customers 0.90 | Confirm | **Leak Report.** 428 G/L/comment lines skipped; reconciled; every planted leak found exactly |
| netsuite-sales-saved-search.csv + customers | Synthetic, NetSuite saved search | CSV with BOM, hierarchical names, credit memos | 6,712 / 40 | Sales 0.82, **NetSuite**; customer from Name | Confirm | **Leak Report.** Net amounts only, so discount leaks are invisible by design; 8 identical lines without line numbers held in Fix Later |
| quickbooks-sales-by-item-detail.csv + item + customer lists | Synthetic, QuickBooks Desktop report | CSV report: item as section heading, totals, footer | 6,712 / 60 / 40 | Sales 0.60, **QuickBooks**; item from section headings | Confirm | **Leak Report.** 65 heading rows copied down; margin 23.67% in cost-basis view (cost only in item list); 0 leaks (see parking lot) |
| sap-b1-verkaufszeilen.csv + kunden | Synthetic, SAP Business One (German locale) | `;`, comma decimals, DD.MM.YYYY, Windows-1252, German headers | 6,712 / 40 | Delimiter, decimals, dates and encoding detected; **role not detected** | Choose role; map 10 + 3 columns (discount as "% of list") | **Leak Report.** All five leak types found, including the planted freight leak to the cent |

## Ground-truth check (synthetic files)

The generator (`test-results/real/6a/gen/generate.mjs`) writes one dataset of 6,712 lines in all four ERP shapes, plus the true totals.

| Check | Truth | Business Central | SAP B1 | NetSuite | QuickBooks |
|---|---:|---:|---:|---:|---:|
| Sales lines + credits | 6,646 + 66 | 6,646 + 66 | 6,646 + 66 | 6,638 + 66 (8 held) | 6,638 + 66 (8 held) |
| List (gross) | $22,173,305.73 | **exact** | **exact** | n/a (net only) | n/a (net only) |
| Credits | −$24,186.54 | **exact** | −$24,186.46 | **exact** | **exact** |
| C-0007 over-discount pattern | 179 lines | **179** | **179** | not visible | not visible |
| C-0011 billed at a better tier | 191 lines | **191** | **191** | not visible | not visible |
| Freight not billed back | 198 lines, $166,849.41 | n/a (BC bills freight on G/L lines) | **198, exact** | n/a | n/a |
| Lines priced below cost | 116 | **116** | **116** | **116** | 0 (no line cost) |

SAP's pocket differs from the truth by 90 cents across 6,646 lines, and its credits by 8 cents. SAP gives the discount as a percent, so RebateHQ computes each discount exactly, rounded half away from zero; the generator used floating-point rounding.

**AdventureWorks** was also recomputed independently from the raw file with integer arithmetic. List $80,978,103.62, pocket $78,439,348.76, margin −$1,540,781.25 and 21,829 below-cost lines all match RebateHQ **exactly**.

## Failures found and fixed (each has a synthetic regression test in `tests/pilot-shapes.test.ts`)

| # | Failure (file) | Fix |
|---|---|---|
| 1 | Headerless export read its first data row as headers (AdventureWorks) | Header detection rejects number-heavy rows; "No header row" is detected and selectable; columns are named A, B, C… |
| 2 | Vault refused source row 1 (headerless file) | Vault schema **v8** rebuilds `sales_lines` with `source_row >= 1`; v7 rows, sign rules and indexes kept (unit test) |
| 3 | Item names as report section headings (QuickBooks) | Section headings in leading unnamed columns are copied down, heading and total rows are skipped, and the item is suggested from the deepest heading |
| 4 | Customer list key "No." unmapped, and "Customer Price Group" taken as the customer (Business Central) | A list's key column is recognised; price-group names map to tier |
| 5 | Customer only in "Name"; NetSuite/QuickBooks not detected | The customer name is used as the key (needs confirmation); NetSuite and QuickBooks marker columns |
| 6 | G/L freight and comment lines loaded as product sales (Business Central) | New optional `line_type` field (BC "Type" auto-mapped); non-item lines are skipped and counted |
| 7 | Discount stored as a percent or a 0–1 share (SAP, Northwind) | Sources "% of list" and "share of list", computed exactly to the cent; 0–1 columns are suggested as shares |
| 8 | 4-decimal money rejected (AdventureWorks) | Amount columns round to the cent, half away from zero, with a note; unit prices keep full precision |
| 9 | `.9999` without a leading zero rejected (AdventureWorks) | Accepted for the file's decimal symbol |
| 10 | A product photo over 4,000 characters rejected the row (AdventureWorks) | Rejected only when the long cell is in a mapped column; the clean-CSV download stays strict |
| 11 | Identical lines with distinct line numbers held as duplicates (Business Central, SAP) | The exact-copy rule applies only when line IDs come from line order |
| 12 | A batch over the line cap ran the engine out of memory (UCI II) | Conversion stops at the tier's line cap with the cap message |
| 13 | No way to import part of a large export (blueprint engine rule 9) | Per-file date range for sales files (inclusive), with a count of skipped rows |

## Follow-up: the four parked gaps, built 5 Nov 2026

The first 6A pass parked four gaps. At the user's request they were built (blueprint section 22, item 17) and the affected files were run again with the same runner, with **no in-app choices other than confirming the mapping** (and CASH-SALE and credits for the UCI files, as before). Each run was repeated in installed Chrome and Edge: identical totals and leaks.

| File | Gap | Auto-detected now | Result |
|---|---|---|---|
| order_details + **orders** + products + customers (Northwind) | Header/line join | orders.csv as **Order headers**; the lines take customer, date and freight "from the order header file" | **Leak Report.** All 2,155 lines load. Freight from 830 orders is spread over their lines. List $1,354,458.59, discounts $88,665.83, freight $64,942.69 and pocket $1,200,850.07 match an independent integer recomputation from the raw files **exactly**. No cost in the files, so only the freight leak is found (26 lines, $2,771.66) |
| quickbooks-sales-by-item-detail + item list + customers | Item-list cost | Cost source "quantity × the item list's current cost" (confirmed) | **Leak Report.** 6,638 lines costed from the item list. **116 below-cost lines found**, the planted number (0 before). The 66 credits loaded later from Fix Later have no cost and stay out of margin |
| sap-b1-verkaufszeilen + kunden (German) | Localized headers | Sales history and customer list; all 10 + 3 columns mapped, discount as "% of list" | **Leak Report**, identical to the hand-mapped 6A run: 179 / 191 / 198 lines, freight $166,849.41, 116 below cost |
| online_retail_II.xlsx, sheet "Year 2009-2010" | Sheets over 300,000 rows | Streamed (525,461 rows); preview from the first 400 | **Leak Report.** 518,709 lines after CASH-SALE and credits, reconciled (28,813 invoices). Same loaded, rejected, list and credit totals as the sheet's CSV copy, to the cent |
| online_retail_II.xlsx, sheet "Year 2010-2011" | same | Streamed (541,910 rows) | **Leak Report.** 536,713 lines, reconciled (25,898 invoices); identical to the CSV copy |

Streamed-sheet timings per sheet (Chrome / Edge): add 1.5–1.8 s / 1.6 s, convert + check 10.3–11.2 s / 10.1–10.5 s, commit + save 6.1–6.6 s / 6.0–6.2 s, leak finder 0.3 s in both.

| # | Gap (file) | Fix | Regression test (`tests/pilot-joins.test.ts`) |
|---|---|---|---|
| 14 | Lines file without customer, date or freight (Northwind) | "Order headers" file type, joined by invoice number; freight spread by list amount with exact cents; lines without a header wait in Fix Later | Detection and mapping; the join, missing headers and the cent-exact spread in DuckDB |
| 15 | Cost only in the item list (QuickBooks) | Cost source "quantity × the item list's current cost", suggested only when the batch has an item list with a cost, always confirmed; items without a cost stay unknown | DuckDB fill, batch list wins over vault, rounding |
| 16 | Workbook sheet over 300,000 rows refused (UCI II) | XLSX/XLSM sheets over the cap are previewed from the first rows and streamed in full at import | Same cells as the grid reader (shared and inline strings, dates, formulas, errors, gaps); a 300,100-row sheet converts every row |
| 17 | German headers needed hand mapping (SAP) | German, French, Spanish and Dutch synonyms, with and without accents | SAP, French, Spanish and Dutch headers |

## Timings (Chrome, this machine; Edge within 7% on large files)

| File | Detect | Convert + check | Commit + save | Leak finder | Leak Report PDF |
|---|---:|---:|---:|---:|---:|
| UCI Online Retail, 541,909 rows | 29 ms | 6,628 ms | 6,271 ms | 309 ms | 1,518 ms |
| UCI II date range, 2 files, 1,067,371 rows read | 33 ms | 9,196 ms | 5,980 ms | 290 ms | 1,340 ms |
| AdventureWorks, 3 files, 62,162 rows | 46 ms | 1,189 ms | 834 ms | 531 ms | 347 ms |
| Synthetic ERP files, about 6,800 rows | 26–273 ms | 253–336 ms | 334–379 ms | 146–358 ms | 148–239 ms |

Fix-Later recheck of 133,359 rows took 5.6 s, and loading 10,624 credits took 3.1 s (UCI Online Retail). These are local measurements on synthetic or public files, not a guarantee for other machines or files.
