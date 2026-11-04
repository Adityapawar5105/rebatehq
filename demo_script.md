# 5-minute RebateHQ demo

Use the seeded workspace and narrate all sample numbers as synthetic. Demonstrate local review workflows, not a real recovery or a customer message.

## 0:00–0:30 — Upload a selling-price file

1. Open **Price Lists** and choose `demo_price_upload.csv`.
2. Point out live row validation, the before/after preview, and the commit action.
3. Commit the rows, then point out version history and Undo.

## 0:30–0:55 — Review a supplier-cost file

1. In **Supplier cost review**, choose **NorthStar Metals** and upload `demo_supplier_cost.csv`.
2. Show the 30% SV-100 cost increase, SV-200 unit mismatch, new SKU, and duplicate rows.
3. Approve the SV-100 row and export the review CSV. Explain that this file is an approval handoff; the app does not silently change catalog costs.

## 0:55–1:35 — Find the margin leak

1. Open **Dashboard** and click **Fix Now**.
2. Review `SO-8102`: Rapid HVAC Partners bought steel check valves; the 14% discount is marked unapproved and freight is high. Pocket margin is negative.
3. Click the waterfall Freight step to inspect order/account rows, then open the profitability matrix.

## 1:35–2:05 — Price for a cost increase

1. Use the right-side **Inflation pass-through** panel. Enter `Steel +6%`.
2. Review the impacted steel SKUs and tier prices, then publish the local adjustment.
3. Point out version history and Undo.

## 2:05–3:15 — Rep builds a quote

1. Resize the browser narrow or open on a phone. Switch to **Jordan Reyes · rep**.
2. In **Quoting**, search for `Acme Corp` or `SV-100`.
3. Set discount to 16%. Show the Yellow margin thermometer and **Request Manager Approval** action, then submit.

## 3:15–3:50 — Manager approves

1. Switch to **Morgan Lee · owner**. In Dashboard’s approval inbox, approve the pending quote.
2. Switch back to the rep role and show the updated status.
3. Optional: open the quote and show the SMS/email draft and signature canvas. Explain these prepare local drafts; no message is sent.

## 3:50–5:00 — Rebate nudge and audit

1. Open **Rebates**. Show Acme Corp is $5,000 from the next buying tier and prepare a reminder.
2. Select the NorthStar Metals agreement. Show the modeled $590 vs $350 supplier credits and the $240 possible difference with source rows.
3. Download the review CSV. State that the buyer validates agreement terms and exceptions before any supplier claim.

## Demo limits

All accounts, orders, contacts, and dollar values are synthetic. Role switching is not secure authorization. The app does not send messages, create hosted customer links, connect to ERP systems, or file claims.