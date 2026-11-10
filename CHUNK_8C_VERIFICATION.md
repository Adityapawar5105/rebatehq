# Chunk 8C verification

Blueprint Phase 3, chunk 8C (BLUEPRINT_EXECUTION_PLAN.md section 9): win/loss log, desktop offline mode, audit and compliance pack, templates. Built by Claude Code in two parts. Blueprint v2.6 governs and is unchanged by this chunk.

**Scope note:** the 8C prompt also listed a Safari desktop verification spike (a v2.4 addition). Blueprint v2.6, section 22 item 28 (gap 5), later placed that spike in **8D**, and v2.6 governs. So it is not part of 8C, and Safari desktop is still not claimed or advertised.

## Part 1: win/loss log, audit and compliance pack, templates

**8C-1 is not yet CI-verified.** The local checks below are not CI proof.

### What was built

- **Local vault v20** (`lib/vault/schema.ts`): 58 tables; new `quote_outcomes`. Upgrades keep every earlier row. No Supabase migration, no locked-hash change, no dependency change.
- **Win/loss log** (`lib/quotes/winloss.ts`, `lib/quotes/outcomes.ts`):
  - an outcome on any quote that has left draft: won, lost or no decision, a reason code, an optional competitor and a note;
  - a report by reason, customer or rep with quotes, won, lost and no-decision counts, win rate, won and lost value, and won and lost margin for cost roles;
  - the report is a worker grid on the grid standard.
- **Quote Desk** (`components/local/WinLoss.tsx`): an Outcome panel on a sent quote, and a "Win/loss" tab with the report.
- **Audit and compliance pack** (`lib/reports/auditpack.ts`): a ZIP containing `audit-log.csv`, `approvals.csv`, `exports.csv`, `export-receipts.csv`, `role-changes.csv`, `current-roles.csv`, `verification.json` and `cover.pdf` in the user's language. The download button sits next to "Verify audit chain" in Reports.
- **Templates** (`lib/reports/templates.ts`, `components/local/Templates.tsx`):
  - a vendor negotiation sheet PDF, from a card at the top of Vendors › Vendor price review;
  - a rebate agreement PDF, from an "Agreement (PDF)" button on each customer rebate program.
- **Commands:**

  | Command | Capability | Tier |
  | --- | --- | --- |
  | `quoteOutcome`, `winLoss` | `quote` | Professional/Scale |
  | `auditPack` | `audit` | every tier |
  | `templateVendors`, `negotiationSheet` | `cost` | Professional/Scale |
  | `rebateAgreement` | `rebateManage` | Professional/Scale |

  Decision 16: `quoteOutcome` and `winLoss` are reachable by a Sales Rep and are in the payload scan.
- **Messages:** 121 keys (`winloss.*`, `auditpack.*`, `templates.*`) in en, es and fr. fr-CA overrides use "soumission" where a quote is named. Theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 8C-1.

### Tests

`tests/winloss.test.ts` (6 tests), with hand-worked values:

- **Schema and outcomes:** the v20 table and its code checks. An outcome is refused on a draft quote, with a bad code, or with text that is too long or has control characters. Recording again replaces the outcome.
- **Report (four quotes):**
  - By reason, price is 1 won and 1 lost (50.00%), $200.00 won value, $45.00 lost value and $80.00 won margin.
  - The competitor loss is $90.00 lost value with $30.00 lost margin.
  - A no-decision quote is 1.5 × $33.33 = $50.00.
  - Totals: 1 won, 2 lost, 1 open, win rate 33.33%.
  - Grouping by customer and by rep works (with names), as do the date filter and the grid sort.
  - A Sales Rep's report has only their two quotes and contains no "margin" anywhere.
- **Audit pack:**
  - The exported `audit-log.csv` chain is re-checked with Node's own SHA-256, independent of the app.
  - `verification.json` matches.
  - Approvals list the price version and the quote exception decision.
  - The pack contains no row note and no price.
  - The cover page is checked in English and French.
  - After an audit row is altered, the pack reports the chain as not verified, stopping at entry 2, and the cover says so.
- **Templates:**
  - The negotiation sheet totals $550.00 of spend over the last 12 months (an older receipt is excluded), shows +10% for a cost rise, a $52.00 cheaper quote and $30.00 to gain.
  - The rebate agreement has the parties, a retroactive wording, tiers of $0.00 to $10,000.00 at 2% and $10,000.00 with no limit at 3.5%, all items eligible, P9 excluded, and signature blocks.
  - The Spanish title is checked.
  - Unknown vendors and programs are refused.
- **Service gates:**
  - A rep records outcomes on their own quotes only; a Sales Manager may record on anyone's.
  - A rep's report is limited to their own quotes and has no margin.
  - Starter tier is refused for the report.
  - A rep can't download the pack or the templates, and a Sales Manager can't download the agreement.
  - An Accountant on Starter can download the audit pack.

`tests/quotes.test.ts` adds `quoteOutcome` and `winLoss` to the decision 16 scan with real data. Schema pins move to v20 / 58 tables.

The browser gate adds `winLossUi`, in a fresh vault under the request and console marker sensors:
- import an item at a $120.00 list price and $70.00 cost, a customer, a sale and two vendors' costs;
- a quote is submitted and recorded as lost to a competitor, with a note;
- the Win/loss tab shows a lost value of $120.00 and a lost margin of $50.00;
- the audit pack downloads, its `verification.json` reports a valid chain with 8 files, and the note is not in it;
- the negotiation sheet for Vendor A downloads and shows Vendor B's $65.00;
- no overflow at 375 px;
- the Sales Rep preview sees the lost value but no margin, and no audit-pack button.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 268 of 268 passed (6 new in `tests/winloss.test.ts`) |
| `scripts/test-vault-browser.mjs --winloss-ui-only --browser=chrome` on a production build (lab mode) | passed |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 63 checks (Chrome 157.0.8103.40), including `winLossUi` |
| Same, `--browser=msedge` | passed, 63 checks (Edge 157.0.4341.42) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| Relay and Firefox gates | not run locally; CI runs both |

### Found and fixed by the browser gate

The first run of `winLossUi` failed on the audit-pack download with a generic error. The approvals query used DuckDB's `json_extract_string`. Node's DuckDB has JSON built in, but DuckDB-Wasm has no JSON extension, and the vault never downloads extensions. The summary is now parsed in JavaScript, and `ASSUMPTIONS.md` records the rule.

### Unverified

- The rebate agreement download in a browser (it is covered by unit tests; the browser gate does not create a rebate program).
- Legal adequacy of the rebate agreement wording: it is a draft to review before signing.
- Third-party audit tooling reading the pack. The format is documented in `verification.json` and was re-checked in the unit test with Node's SHA-256 only.
- Native-language review of the new text.
