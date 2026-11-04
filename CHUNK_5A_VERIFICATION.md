# Chunk 5A: item master cleanup, cost basis, setup checklist, ROI v1 and roles

**Local evidence only. Not yet CI-verified.** Baseline: CI #58 and Restore Drill #14 on `251efef`
(rename migration locked in `c8b78eb`). Only 5A was built; 5B has not started. No Supabase
migration was added or changed, and `migrations.lock` is unchanged. Nothing below is a CI or
restore result, and the authenticated privacy gate (`--auth`) runs only in CI.

## What was built

- **Vault schema v7** (local DuckDB; V1 to V6 SQL frozen): `role_assignments`, `access_settings`,
  `cleanup_fixes`, `cleanup_changes`, `setup_progress`. The committed encrypted v1 fixture upgrades
  through v7 with its row intact.
- **Item master cleanup assistant** (`lib/cleanup/item-master.ts`, `lib/cleanup/uom.ts`): duplicate
  SKUs (certain vs possible), unit-of-measure spelling, missing categories. Each fix is one click,
  audited (`cleanup.applied`), journaled cell by cell and undoable once (`cleanup.undone`). Chunk 2A's
  UoM rules are ported: units are never guessed, blank is never EA, conversions are registered
  pairs usable in reverse, quantities round to four decimals half away from zero.
- **Cost basis selector** (`lib/cost/basis.ts`): invoice, last, average and replacement cost margins
  side by side per product group, exact in HUGEINT, with the choice stored per group.
- **Guided 7-day checklist** (`lib/setup/checklist.ts`): import, map, fix, first report, first rule,
  first export, invite the team. Detected from the vault, stored in `setup_progress`, never
  completed by Playground data.
- **ROI tracker v1** on Home for roles with cost access (leak dollars found; sample findings apart).
- **Roles** (`lib/roles/*`, `lib/vault/dispatch.ts`): named Pricing Owner required at vault creation;
  seven roles; every worker command passes one capability check before any query runs; the status
  totals query omits cost and margin for roles without cost access; owner switch for reps; role preview.
  Home, navigation, Data Hub, Pricing and Settings change with the role.

## Commands run and results (4 November 2026, Windows 11, AMD Ryzen 5 5600H, 7.9 GB RAM)

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node scripts/check-migrations-lock.mjs` | passed: 8 applied, 0 pending |
| `node scripts/check-schema.mjs` | passed: 38 tenant-scoped tables |
| `node scripts/check-service-role.mjs` | passed: 192 user-facing files |
| `node --test tests/*.test.js` | 72 passed, 0 failed (includes the brand-name guard) |
| `tsx --test tests/*.test.ts` | 119 passed, 0 failed (JS 72 + TS 119 = 191 unit tests) |
| `node node_modules/next/dist/bin/next build` | passed |
| `node scripts/test-vault-browser.mjs --browser=chrome` (production build, Chrome 156) | **passed, 28 checks**, including `phase5a`, `roleViewsUi` and the network/console privacy sensors |

New unit tests: `tests/cleanup.test.ts` (7), `tests/cost-basis.test.ts` (2), `tests/roles.test.ts` (7),
`tests/setup-checklist.test.ts` (3). `tests/vault.test.ts` now asserts the v7 inventory.

## What the tests prove

- **Every cleanup fix and its undo** run in real DuckDB: a merge re-points lines, vendor costs and
  price rows, fills the kept product's empty fields, leaves invoice totals unchanged, and undo restores
  every cell (snapshot equality). Undo skips cells edited since and counts them. A merge whose delete
  step failed can be finished and still undone. Unit fixes never guess; category suggestions need
  three agreeing products.
- **Cost basis margins match hand-calculated fixtures** (last, average, replacement, invoice; credits;
  half-away rounding on a 1.5 average; unknown cost counted, never zero). In Chrome the invoice column
  adds up to the waterfall margin.
- **Reps never see cost at the query layer.** `tests/roles.test.ts` runs the real dispatcher with the
  real `VaultService.guard` for all seven roles and every command: a command a role may not run is
  refused before any service method executes. The Chrome suite drives a Sales Rep preview: 17 commands
  refused, status totals carry `cost: null`, Home and Pricing contain no cost-derived data, and a
  unique cost value (`8123457` cents) appears nowhere in the rep's responses. A test fails if a new
  command is added without a capability decision.
- **Checklist**: each step detected from real data, Playground never counts, steps stay done after the
  data is removed, the team step can be marked by hand, and progress survives lock and unlock.
- **ROI and Home**: sample findings are kept apart from the real total; the tracker is on Home.
- **Pricing Owner required**: the dispatcher refuses `create` without a name (unit and Chrome), and the
  create button is disabled until one is typed.

## Measured locally: 1M-line synthetic vault (Chrome 156, headless, same machine)

100,000 products plus 1,000 look-alike duplicates, 1,000,000 lines, 200,000 vendor costs, 512 MB DuckDB limit.

| Operation | ms |
|---|---|
| Cleanup scan (duplicates, units, categories) | 354 |
| Cost basis, all groups, four bases | 558 |
| Home data (waterfall, ROI, checklist, counts) | 883 |
| Status | 8 |
| Merge one duplicate group, including aggregate rebuild and encrypted save | 1,827 |
| Undo that merge, including rebuild and save | 1,863 |
| Respell one unit (500 products), including save | 1,059 |

These are "measured on this machine in headless Chrome", not capability claims.

## Not verified

- **CI.** Nothing here has run on GitHub Actions. The authenticated `--auth` privacy gate, pgTAP and
  the restore drill (unaffected: no control-plane migration changed) are pending a push.
- **Roles are a worker policy, not cryptography.** Whoever holds the passphrase on the device can open
  the whole vault with developer tools. Per-user separation needs the Phase 2 relay and per-user keys.
  Two real sign-ins on one vault were not tested; roles are tested through the dispatcher and a preview.
- **Cost basis does not drive the waterfall**, leak finder or reports; they stay on invoice cost, which
  reconciles to the ERP. Average cost is an equal-weight mean of dated cost rows (no purchase quantities).
- **Unit conversions** are a tested function that no import path calls: sales lines carry no unit.
- **Heuristics on real files.** Duplicate, unit and category suggestions were checked on synthetic data
  only. No real ERP export was available; run the assistant on a pilot file in 6A before relying on it.
- Edge, the real folder picker and the mobile layout of the new panels beyond the existing no-overflow
  check were not exercised.
