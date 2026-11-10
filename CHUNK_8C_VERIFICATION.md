# Chunk 8C verification

Blueprint Phase 3, chunk 8C (BLUEPRINT_EXECUTION_PLAN.md section 9): win/loss log, desktop offline mode, audit and compliance pack, templates. Built by Claude Code in two parts. Blueprint v2.6 governs and is unchanged by this chunk.

**Scope note:** the 8C prompt also listed a Safari desktop verification spike (a v2.4 addition). Blueprint v2.6, section 22 item 28 (gap 5), later placed that spike in **8D**, and v2.6 governs. So it is not part of 8C, and Safari desktop is still not claimed or advertised.

## Part 1: win/loss log, audit and compliance pack, templates

**8C-1 is CI-verified** in [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) on `efe4291`, 11 November 2026 (Asia/Kolkata): 346 unit tests (78 JS + 268 TS), **65 authenticated Chromium vault checks** (including `winLossUi`), **63 Firefox lab checks** (including `winLossUi`), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v20 / 58 tables; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed.

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

## Part 2: offline mode for the desktop app

**8C-2 is not yet CI-verified.** The local checks below are not CI proof.

### What was built

- **Service worker** (`public/sw.js`): one cache holding only the app shell. The page and the fixed-name engine files are network-first with an offline fallback; content-hashed build files are cache-first. It never intercepts `/api/`, a non-GET request, a query string, other pages, other origins or redirects, and it registers no background or periodic sync.
- **Registration and Settings** (`components/local/OfflineMode.tsx`):
  - the worker is registered in production builds only;
  - Settings › Offline use shows Ready, Preparing, Off or Unsupported, with the number of stored files;
  - while offline, it shows how long the licence stays valid;
  - a "Remove offline copy" button.
- **Sign-out** deletes the offline copy and unregisters the worker before signing out.
- **Installable app:** `app/manifest.ts` and `public/icon.svg`.
- **Messages:** 9 keys (`offline.*`) in en, es and fr.

Rules are in `ASSUMPTIONS.md`, section 8C-2.

### Tests

`tests/offline.test.ts` (3 tests) runs `public/sw.js` in a VM with fake caches and network:
- it stores exactly the shell paths and serves them offline;
- it does not invent an asset that was never fetched;
- cache-first and network-first behave as described;
- `/api/`, POST, query strings, other pages and other origins go straight to the network and are never stored;
- a redirected visit drops the stored page;
- the page can clear the copy;
- old caches are removed on activation;
- the source has no background sync, other storage or imported code.

The browser gate adds `offlineUi` in Chrome and Edge (not Firefox), in a fresh profile under the request and console marker sensors:
1. Online, through a local TCP relay to the app server: create a vault and import marked data; the service worker takes control; reload once and unlock, so the page and engine are stored; Settings shows Ready.
2. Close the relay so the server is unreachable (a probe fetch is asserted to fail) and set the browser offline. Reload: the app opens from the stored copy, the vault unlocks, and both lines are there. The licence grace note shows.
3. Cache scan: every stored response is one of the shell paths, none carries the import marker, none is `/api/`. There were 21 entries locally.
4. No overflow at 375 px.
5. "Remove offline copy" empties the cache.

All other gate checks now run with service workers blocked, because Playwright routes cannot see requests a service worker answers.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 271 of 271 passed (3 new in `tests/offline.test.ts`) |
| `scripts/test-vault-browser.mjs --offline-ui-only --browser=chrome` on a production build (lab mode) | passed |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 64 checks (Chrome 157.0.8103.40), including `offlineUi` and `winLossUi` |
| Same, `--browser=msedge` | passed, 64 checks (Edge 157.0.4341.42) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| Relay and Firefox gates | not run locally; CI runs both (`offlineUi` is skipped on Firefox by design) |

### Found and fixed while building

- **Playwright's offline switch does not cover service-worker requests.** The first version of the check called `setOffline(true)`, and a probe still reached the server. That version proved nothing. The check now closes a TCP relay so every connection fails, and asserts that a probe fetch fails.
- **Fixed-name engine files.** They were cache-first at first, which would have kept an old vault worker after an update. They are now network-first.

### Unverified

- The browser's install prompt and the installed (standalone) window.
- Offline use in Firefox; real-world network loss (Wi-Fi off, captive portals) rather than a closed relay.
- An offline copy across an app update in the field: covered in the unit test, not in a browser.
- The privacy claim "data never leaves your device" (blueprint v2.6 gap 3, decision 11) is a decision for the product owner, not a test result. This chunk adds evidence (the offline gate and the cache scan); it does not change any marketing text.
