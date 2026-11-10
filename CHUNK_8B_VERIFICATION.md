# Chunk 8B verification

Blueprint Phase 3, chunk 8B (BLUEPRINT_EXECUTION_PLAN.md section 9): Margin Drain agents (blueprint v2.6 gap 1), cost index triggers and the dead-stock clearance optimiser. Built by Claude Code in two parts. Blueprint v2.6 governs and is unchanged by this chunk.

## Part 1: Margin Drain agents and cost index triggers

**8B-1 is CI-verified** in [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) on `509a0f8`, 10 November 2026 (Asia/Kolkata): 334 unit tests (78 JS + 256 TS), **63 authenticated Chromium vault checks** (including `agentsUi`), **61 Firefox lab checks** (including `agentsUi`), **12 real-authenticated local-Supabase relay checks**, the high/critical dependency audit, and the fresh 152-check pgTAP suite twice. Local vault v18 / 55 tables; 11 locked migrations, zero pending; no restore drill needed (no Supabase change). Every job step passed.

### What was built

- **Local vault v18** (`lib/vault/schema.ts`): 55 tables. New `cost_index_points`, `cost_index_triggers`, `agent_settings`, `agent_runs` and `agent_inbox`; `source_kinds` now accepts `cost_index`. Upgrades from v17 keep every earlier row. No Supabase migration, no locked-hash change, no dependency change.
- **Cost index import role** (`lib/studio/formats.ts`, `load.ts`, `studio.ts`): index name, period date and value, detected from file names such as "copper-index.csv" or "PPI"; loaded, re-imported and removed with source tracking like every other role.
- **Cost index triggers** (`lib/agents/costindex.ts`): exact index change, the import-currency buffer with user-typed rates, cost change and expected cost per SKU in a category or for one product. A new Vendors tab, "Cost index" (`components/local/CostIndexView.tsx`), shows the series, the triggers and the SKUs a trigger covers (worker grid), with a link to the segment planner.
- **Margin Drain agents** (`lib/agents/agents.ts`): six rules (leaks above a threshold, book prices below the floor, contracts expiring, supplier cost rises, the 7C-3b customer health alerts, and fired index triggers), an inbox reconciled on every run, a run log and saved settings. The vault worker checks once a minute while the app is open and runs a check when one is due, and at opening when one is overdue. Agent runs are audited and saved but never reset the idle-lock timer.
- **Home card** (`components/local/AgentsInbox.tsx`): says checks run only while RebateHQ is open, the last check time and how it ran, new, seen and resolved counts, "Check now", settings for pricing roles, and the inbox as a worker grid on the grid standard (mark seen, dismiss, reopen).
- **Commands:** `agentState`, `agentRows`, `agentRun`, `agentMark`, `indexState`, `indexSkus` (`cost`); `agentSettingsSave`, `indexTriggerSave`, `indexTriggerDelete` (`pricing`). All are Professional/Scale in the worker. No Sales Rep projection: a rep reaches none of them (decision 16).
- 108 message keys (`agents.*`, `index.*`, `filetype.costIndex`) in en, es and fr; theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 8B-1.

### Tests

`tests/agents.test.ts` (7 tests), with hand-worked values:
- the v18 upgrade and its tables;
- the import role (fields, detection, load and removal SQL);
- trigger math: copper 100 → 106.5 is +6.50%; a 50% share gives +3.25%. EUR 1.08 → 1.134 is +5.00%; with a 3.00% buffer that adds +2.00%, so the cost change is +5.25%. A $60.00 SKU is then expected at $63.15 and a $3.33 SKU at $3.50;
- each rule on fixtures (floor gaps of $5.00 and $10.00, an expiring contract, a +4.00% supplier cost rise of $2.00);
- the inbox lifecycle (new, seen again, read, dismissed, resolved and back again), the run log and the schedule;
- settings validation;
- service gates (tier, cost role, writable licence) and a scheduled run that never touches the idle timer.

Schema pins in `tests/vault.test.ts`, `notes`, `rebate-local`, `reports`, `supplier-claims` and `tests/browser/vault-worker.ts` move to v18 / 55 tables.

The browser gate adds `agentsUi`, in a fresh vault under the request and console marker sensors:
- imported items, a customer, a sales line with a $30.00 freight leak, and a copper index file;
- on Home, the agents card says checks run only while the app is open;
- the leak threshold is lowered to $1.00 and "Check now" lists the leak at $30.00;
- in Vendors › Cost index, the series has 3 points. A 5% / 50% trigger on Wire fires at +3.25%, and the $60.00 wire SKU is expected at $61.95; the valve is not covered;
- the next check adds the trigger to the inbox (2 new); marking the leak seen leaves 1 new;
- no overflow at 375 px;
- the Sales Rep preview has no agents card and no Vendors.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 256 of 256 passed (7 new in `tests/agents.test.ts`) |
| `scripts/test-vault-browser.mjs --agents-ui-only --browser=chrome` on a production build (lab mode) | passed |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 61 checks (Chrome 157.0.8103.40), including `agentsUi` |
| Same, `--browser=msedge` | passed, 61 checks (Edge 157.0.4341.42) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| Relay and Firefox gates | not run locally; CI runs both |

### Unverified

- Long-running schedules in a real browser session (hours open, sleep and wake); the browser gate runs checks by hand and at opening only.
- Rule thresholds and the 500-per-rule cap on real pilot data; large-vault timings of a full agent run.
- A public index feed from the control plane (the blueprint allows "user-uploaded or public data first"; this part ships uploads only).
- Native-language review of the new sentences.

## Part 2: dead-stock clearance optimiser

**8B-2 is not yet CI-verified.** The local checks below are not CI proof.

### What was built

- **Local vault v19** (`lib/vault/schema.ts`): 57 tables. New `inventory_levels` and `dead_stock_settings`; `source_kinds` accepts `inventory` and `price_changesets` accepts `clearance` drafts, both rebuilt with their rows kept. No Supabase migration, no locked-hash change, no dependency change.
- **Stock on hand import role** (`lib/studio/formats.ts`, `load.ts`, `studio.ts`): item, optional location, quantity on hand (zero or more), detected from file names such as "stock-on-hand.csv". It is loaded, removed and source-tracked like other roles. A newer file replaces the same item and location.
- **Optimiser** (`lib/inventory/deadstock.ts`):
  - dead stock (idle N days, or never sold);
  - replacement cost (item master, else newest vendor cost);
  - capital tied up, and carrying cost per month from the user's cost of capital and storage cost;
  - a clearance price floored at replacement cost;
  - up to three substitute SKUs;
  - totals.
  All of it runs in the worker with exact integers, as a worker grid on the grid standard.
- **Clearance drafts** (`clearanceDraft` in `lib/pricing/ops.ts`): the segment planner's changeset with one row per item and tier, kept at or above the guardrail floor. Pricing Owner approval and ERP export are unchanged.
- **Vendors › Dead stock** (`components/local/DeadStockView.tsx`):
  - carrying-cost settings for pricing roles;
  - tiles for items, capital tied up and carrying cost per month;
  - notices for stock rows with unknown items and for items without a cost;
  - the grid, with an Include column and "Draft clearance prices";
  - a link to the run in Pricing.
- **Commands:** `deadState` and `deadRows` need `cost`. `deadSettingsSave` and `deadDraft` need `pricing`, and a draft also needs a named owner. All are Professional/Scale. No Sales Rep projection.
- 47 message keys (`dead.*`, `filetype.inventory`, `ops.clearanceDescription`) in en, es and fr. Theme tokens only.

Rules for every figure are in `ASSUMPTIONS.md`, section 8B-2.

### Tests

`tests/deadstock.test.ts` (6 tests), with hand-worked values:
- **Upgrade:** the v19 upgrade keeps earlier source kinds and drafts, and refuses negative stock and fewer than 90 idle days.
- **Import role:** fields, detection, load and removal SQL.
- **Figures (12% cost of capital, $0.05 storage, 6 months):**
  - A valve with 10 on hand (4 + 6 across two locations) at $60.00, list $100.00, idle 132 days: capital $600.00, carrying $6.50 a month, clearance $96.10, substitutes ranked by units sold.
  - A seal (2.5 on hand at $3.33, list $3.45, never sold): capital $8.33, carrying $0.21, clearance floored at $3.33.
  - A hose costed from its newest vendor cost of $4.50: already below cost, so its price is kept.
  - An item with no cost is flagged.
  - Totals: $612.83 tied up and $6.81 a month.
  - Stock for an unknown item is counted. A 180-day window drops the valve. The grid filter and sort work.
- **Settings:** validation.
- **Drafts:**
  - Only priced items are picked.
  - The valve's tier T1 row is raised from $96.10 to the $97.00 guardrail floor, and the seal's list row goes to $3.33.
  - The changeset is a `clearance` preview, and approval writes both prices.
- **Service:**
  - Saving the settings returns the totals.
  - A draft is audited.
  - Nothing to draft is refused.
  - A Sales Manager reads but cannot draft.
  - A Sales Rep is refused, and so is the Starter tier.

Schema pins in `tests/vault.test.ts`, `notes`, `rebate-local`, `reports`, `supplier-claims`, `agents` and `tests/browser/vault-worker.ts` move to v19 / 57 tables.

The browser gate adds `deadStockUi`. It runs in a fresh vault under the request and console marker sensors, with dates relative to today:
- import items, a customer, sales, and a stock file with two locations;
- set carrying costs of 12%, $0.05 and 6 months;
- capital is $600.00, carrying is $6.50 a month, and the clearance price is $96.10 with a $3.90 markdown;
- the selling valve is the substitute and is not listed as dead;
- no overflow at 375 px;
- the draft (1 price) is opened from the Pricing run history and approved by the Pricing Owner, and Export Studio opens;
- the Sales Rep preview has no Vendors.

### Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node --test tests/*.test.js` | 78 of 78 passed |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 262 of 262 passed (6 new in `tests/deadstock.test.ts`) |
| `scripts/test-vault-browser.mjs --dead-ui-only --browser=chrome` on a production build (lab mode) | passed |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 62 checks (Chrome 157.0.8103.40), including `agentsUi` and `deadStockUi` |
| Same, `--browser=msedge` | passed, 62 checks (Edge 157.0.4341.42) |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 0 pending, unchanged |
| Relay and Firefox gates | not run locally; CI runs both |

### Unverified

- Real stock files from pilot ERPs (location codes, units of measure, negative or blank quantities, which go to Fix Later) and large-catalogue timings of the dead-stock query.
- Whether the one-rule clearance price clears stock in practice; there is no demand or elasticity model.
- Substitute quality: same category and unit is a proxy, not a compatibility check.
- Native-language review of the new sentences.
