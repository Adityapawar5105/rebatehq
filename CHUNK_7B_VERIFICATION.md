# Chunk 7B verification — Quote Desk, Price Check and the customer credit signal

6 November 2026. **7B is CI-verified** in [RebateHQ CI #89](https://github.com/Adityapawar5105/rebatehq/actions/runs/42101094326)
on `f344009`:
- The authenticated local-vault privacy gate passed, including the new `quotesUi` check.
- The relay gate passed 11 checks on real authenticated local Supabase.

A follow-up commit adds the security-review fixes below and the CI time limits (CI #87 hung for 6 hours in
`apt`; see the CI note at the end). Its CI run is linked once it passes. 7B adds no Supabase migration (the 11 applied migrations and
`migrations.lock` are unchanged). The local vault schema moves from v9 to **v10**.

## What was built

### First step: the 5A rep cost toggle is removed (decision 16, blueprint section 22 item 21)
- The Owner setting "Let Sales Reps see cost and margin" is gone from Settings → Roles, together with the
  `accessSet` worker command. Settings now says reps never see cost or margin and that a person who needs
  margins gets the Sales Manager role.
- `capsFor(role, namedOwner)` no longer takes the switch. A vault that still stores the switch "on"
  (`access_settings`) is read by nothing, so no vault schema change was needed for the removal.
- **Decision 16 test** (`tests/quotes.test.ts`):
  - Every command a Sales Rep can reach is listed and either **scanned** (its real payload, from the real
    dispatcher, is checked for any key containing "cost" or "margin" and for the fixture's cost value) or
    **reviewed** (written reason it cannot carry cost).
  - A new rep-reachable command fails the test until it is classified.
  - It runs with the old switch stored "on". A negative control shows the same quote opened by a Sales
    Manager does carry margin, so the scan is not vacuous.
  - The browser gate repeats the check in the real worker: a Sales Rep preview sees neither `ZED-1`'s cost
    nor the quote's cost total.

### Quote Desk (new Quotes section; Professional and Scale)
- **New quote:** choose a customer, then add SKUs. Each line is priced from the price book and checked
  against its guardrail, and keeps a snapshot of book price, start/target/floor, zone and (for cost roles)
  unit cost. A rep can type their own unit price; blank means the book price.
- **Price resolution** (`lib/quotes/quotes.ts` `pricePoint`):
  - The most specific valid price list row wins: the customer's own price, then the tier, then a category-wide
    row. A product row beats a category row.
  - Quantity breaks apply at or above their quantity.
  - Rows outside their valid dates are ignored, and the item list price is the fallback.
- **Margin thermometer:** each line shows where its price sits between floor, target and start (red below
  floor, amber below target, green at or above target). These are prices only.
  - The quote shows its total and its price against target.
  - Only roles with the cost capability also see margin % and margin amount, which the worker sends only to
    them.
  - A rep sees the zone, never margin.
- **Soft warnings:** below target, below floor, no guardrail for the tier and category, and "slow payer with a
  discount" (credit signal amber or red with a discounted line).
- **Request exception:** a quote with a line below its floor needs a written reason and goes to "Waiting for
  approval". Below target is a warning only. Approved and rejected quotes are kept; a rejected quote can be
  edited and resubmitted.
- **Approvals:**
  - On one vault, a below-floor exception is decided by someone with the new `quoteApprove` capability:
    Sales Manager ("approves discounted quotes", blueprint section 3), Pricing Owner or Owner / CFO.
  - Nobody approves their own quote (ported from the legacy server's `assertNotQuoteCreator`).
  - A Pricing Manager does not approve quotes, and `quoteApprove` does not grant price-change approval.
  - Across devices, the rep sends the exception to the encrypted 7A team inbox ("Send to the encrypted team
    inbox"). Only the quote number, title and price total go to the relay, never cost.
  - Approvers are chosen in the existing 7A inbox, which applies its one- or two-level presets.
  - "Check for a decision" reads the signed 7A decision and settles the local quote (`decided_by` =
    `relay:<object id>`).
  - **Security-review fixes (after CI #89):**
    - Editing a quote, or deciding it locally, clears its relay link, so an approval shared for old lines
      can't settle a changed quote.
    - A relay decision is applied only when the shared subject still matches the quote (author, number
      and price total).
    - A relay approval counts only if every approver holds `quoteApprove` in this vault and isn't the
      quote's author. Approvers need an explicit role row or must be the named Pricing Owner; there is no fallback. A relay rejection is always applied.
- **History** and **Approval inbox** tabs. A role without cost or `quoteApprove` sees only its own quotes.
- **Audit:** `quote.created`, `quote.lines`, `quote.submitted`, `quote.decided` and `quote.linked` entries
  carry IDs, counts and codes only. No prices and no reasons are stored in the audit log.
- **Mobile-friendly:** forms collapse to one column under 600 px, tables scroll inside their card, and the
  tabs wrap. The browser gate checks the quote card fits a 375 px screen.
- Money stays integer cents. Line totals use the engine's exact round-half-away SQL (`rhaSql`), and
  quantities are DECIMAL(18,4).

### Price Check
- SKU, optional customer and quantity, then **Enter** (USB barcode scanners send Enter).
- Shows book price and its source, start/target/floor, the zone, the thermometer and the customer's credit
  signal. Never cost.

### Customer credit signal and the AR aging import role
- **New Import Studio file type, AR aging (customer credit).**
  - Fields: customer ID, as-of date, current, 1–30, 31–60, 61–90 and over-90 balances, credit limit and DSO.
  - Common aged-receivables headers map without a recipe.
  - Negative or non-numeric balances go to Fix Later.
  - One profile per customer: a newer report replaces the old file. Removing the file removes its profiles.
  - Unknown customers are added to the customer list.
- **Signal rules** (`lib/quotes/credit.ts`; thresholds in ASSUMPTIONS.md):
  - **Red:** 10% or more of the balance is over 90 days, the balance is over the credit limit, there is a
    balance with a zero limit, or DSO is above 75.
  - **Amber:** 10% or more is over 60 days, the balance is 80% or more of the limit, or DSO is above 45.
  - **Unknown:** no AR aging was imported for the customer.
  - The screen shows the reasons, not the balances.

### Vault schema v10
- New tables: `quotes`, `quote_lines`, `credit_profiles`, `source_kinds`.
- `source_files.role` keeps its v1 CHECK list, because DuckDB cannot rebuild a table other tables reference.
  An AR aging file is therefore stored as `customer_list`, with its real kind in `source_kinds`. Import
  history, Fix Later and the setup checklist read the real kind.
- The forward-only upgrade from v9 is the four `CREATE TABLE` statements.

### Roles
| Capability | Owner / CFO | Pricing Owner | Pricing Manager | Sales Manager | Sales Rep | Accountant | Admin / IT |
|---|---|---|---|---|---|---|---|
| `quote` (Quote Desk, Price Check) | yes | yes | yes | yes | yes | no | no |
| `quoteApprove` (decide exceptions) | yes | yes | no | yes | no | no | no |
| cost and margin inside a quote | yes | yes | yes | yes | **never** | — | — |

## Done when (execution plan 7B)
| Criterion | Status |
|---|---|
| Rep cost toggle removed; a stored "on" value is ignored | Done (unit and browser gate) |
| Decision 16 test: no Sales Rep payload contains cost or margin % | Done (unit: every rep command classified, 12 scanned; browser gate: rep preview of Quote Desk) |
| Margin thermometer, start/target/floor guidance | Done (UI; browser gate checks the meter and zones) |
| "Request exception" soft warnings | Done (unit and browser gate) |
| Approvals via 7A | Built; unit-tested against a stubbed relay. **The real relay round trip for a quote is not verified** (see below) |
| Mobile-friendly | Done (375 px check in the browser gate) |
| Price Check with green/amber/red | Done (unit and browser gate, Enter submits) |
| Customer credit signal from a new AR aging import role | Done (unit: mapping, validation, commit, removal, thresholds) |
| Reps never see cost or margin % | Done (worker-enforced; unit and browser gate) |
| Port reusable logic from the legacy server quote code | The no-self-approval rule is ported. The legacy pricing code read the dropped server tables and was not reused |

## Local checks (6 November 2026; local evidence, not CI)
- `tsc --noEmit`: clean.
- TypeScript unit tests: 151 of 151 pass, including 7 new tests in `tests/quotes.test.ts`.
- JavaScript unit tests: 78 of 78 pass.
- `node scripts/check-migrations-lock.mjs`: 11 applied migrations, 0 pending, matching `migrations.lock`.
- `node scripts/build-spike.mjs` plus `next build` (production, `VAULT_LAB_ENABLED=true`): succeeded.
- The vault browser gate (`scripts/test-vault-browser.mjs`, unauthenticated lab mode) passed in headless
  Chrome 156.0.8078.80 and Edge 156.0.4314.58, with the new `quotesUi` check.
  - The pseudo-locale walk now includes Quotes.
  - The phase 5A worker check covers Quote Desk in a rep preview and confirms the pending quote survives a
    lock and unlock.
- The 7A relay gate was not rerun locally. 7B does not change the relay code.

## Not verified
- **CI for the follow-up commit** (security fixes and CI time limits) is pending.
- **Real relay round trip for a quote exception.** The 7A relay gate shares references through the inbox UI,
  not from Quote Desk. Quote sharing is unit-tested against a stubbed relay, which checks what is sent, the
  author match and the decision mapping. An end-to-end check needs vault data in each relay test vault.
- **Authenticated mode** (`--auth`, real local Supabase sign-in) runs in CI only.
- **Credit thresholds** are a documented starting point, not a credit policy. Pilots should confirm them.
- **Translations** of the new Spanish and French text are machine-assisted, like 7U. Native-speaker review is
  still required.
- **Currency:** the relay amount is labelled USD (the vault has no currency column yet, as in 7U).
- **Competitor log** (listed beside Quote Desk in the tier table) is not part of the 7B plan entry and was not
  built.

## CI note: CI #87 hung for 6 hours (not a code failure)
[CI #87](https://github.com/Adityapawar5105/rebatehq/actions/runs/42083868801) ran on `c6ebb09`, a docs-only commit
recording 7U. GitHub cancelled it at the 6-hour job limit.
- **What hung:** the step log stops inside `pnpm exec playwright install --with-deps chromium`, while `apt` read
  the Ubuntu package indexes. The `azure.archive.ubuntu.com` mirror stopped answering, and apt has no request
  timeout by default.
- **No test ran:** the same code passed in CI #86, and CI #88 and #89 passed afterwards.
- **Fix** (`.github/workflows/ci.yml`, `restore-drill.yml`):
  - The CI job has a 45-minute limit (a normal run is about 11 minutes); the Restore Drill job has 90.
  - The browser install is its own step, limited to 20 minutes. Apt requests time out after 30 s with 3
    retries, and each install attempt is capped at 6 minutes, with 3 attempts.
  - The privacy gate step has a 25-minute limit.
  - `tests/vault.test.ts` fails if these limits are removed.
