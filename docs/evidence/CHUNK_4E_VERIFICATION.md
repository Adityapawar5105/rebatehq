# Chunk 4E — guardrails, rules, export and encrypted backup

**4E CI-verified in [MarginDesk CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), 4 November 2026, commit `7fe3db82951e82d5ba8a049158a7ef0a17a69597`.**

The verify job completed successfully, including step 18, Required authenticated local-vault privacy gate (success, not skipped). Downloaded job logs show 67 JS + 96 TS tests (163 total) and one authenticated Chromium harness with 25 named checks, including pricing, pricingUi and privacy; status passed, auth true. Results were logged at 10:42:41 UTC. [Verify job/logs](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704/job/126520564314). Privacy acceptance covers the local vault flow only; legacy server business-data routes still exist.

Local measurements below remain local evidence. Baseline: CI #53,
`6d21cf0` (4D). Only 4E; 5A has not started.

## Implementation

- Local schema v6: indexed tier/category guardrails, named Pricing Owner,
  immutable rule revisions, pricing revision counter, saved SKU/tier diffs,
  run approval metadata. V1–V5 SQL, v1.enc, seven locked Supabase migrations
  and migrations.lock stay unchanged. The compatibility fixture upgrades to v6.
- Guardrails are absolute unit cents; statuses have symbols and text. Explicit
  floors replace the tier peer-rate floor where configured. Without them, all
  five Playground manifest findings stay exact. Floor evidence uses the decimal engine.
- Rules compare the supplier's latest two dated costs per SKU (row ID breaks
  same-day ties), with a strict percentage threshold. Rates are exact basis
  points from percentage strings; SQL uses the engine's half-away rounding.
  UTC date literals avoid ICU-dependent current_date; extensions stay disabled.
- Simulation copies affected prices, never invoice history, and is capped at
  250,000 SKU/tier pairs. Previews page 50 rows, showing old/new unit prices,
  margins, unknown cost, estimated impact and guardrail status. Historic invoices
  remain unchanged. Impact assumes unchanged quantities, cost and charges.
- Approval uses the authenticated worker scope user ID and checks the named
  Pricing Owner. Red blocks approval; yellow requires that owner. Data, guards,
  owner, rules, another approval or a changed UTC day require a new simulation.
  Approval records price_versions, changes matrix prices, appends audit history,
  rebuilds derived views and encrypts the result. Local roles do not protect
  against a device owner modifying software; authoritative controls remain 5A/5B.
- Generic, NetSuite, P21, Infor, Dynamics BC and QuickBooks CSV/XLSX exports
  include an audited change log. Cells are formula-safe; XLSX values are text.
  **Every layout is unverified until tested on a real ERP import.**
- Folder backup streams ciphertext only, atomically replacing a file and keeping
  its predecessor. Configured folders receive a copy after approval. A serialized
  minute timer checks the persisted hourly schedule while unlocked; closed or
  locked browsers cannot run it. Default reminder: seven days. Download fallback
  is audited, but cannot confirm a saved file. Handles/timestamps stay in local IDB.
- Restore requires the original passphrase and same identity/workspace in an
  empty vault. Existing data is never replaced. Scope, schema and audit are
  verified before publication; restore preserves the audit prefix and appends an
  event. Tests inject a directory handle; real picker/disk permissions remain unverified.

## Local evidence

DuckDB-Wasm Node tests pass for JS/SQL rounding and ties, version conflicts,
non-owner and red rejection, yellow approval, price versioning, unchanged live
prices during simulation, all ERP CSV/XLSX layouts, formula-safe cells and
failed backup publication retaining the previous file.

Chrome's worker recovery suite passed: Playground → all five leaks → rule →
simulation → stale conflict → configured floor → preview → approval → automatic
backup → CSV/XLSX → encrypted backup → all origin OPFS and backup-settings
storage removed → restore. Waterfall, leak totals and prices matched to the
cent; the audit prefix remained intact. Wrong passphrase and overwrite refusal
passed. Full harness includes additional damaged/wrong-scope and due-schedule checks.

The authenticated flow is extended through the Pricing and Backup UI with
private markers present: owner, guards, rule, simulate, yellow preview, approve,
ERP/change-log downloads, injected folder handle and encrypted file export.
This extended authenticated flow passed in CI #55. Real folder-picker/disk permissions remain unverified.

Full Chrome, Edge and Chromium each passed **25 named harness checks**,
including the pricing/backup UI and private-marker sensor. The complete unit
suite passed **163 tests (67 JS + 96 TS)**, with no failures/skips. Typecheck,
final production build, schema/service-role scan and migration freeze passed.
Sanitized local evidence: [pricing-4e-2026-11-04.json](../../vault-evidence/pricing-4e-2026-11-04.json).

## Measurements (local, not CI)

Ryzen 5 5600H, about 8 GB, Windows 11, Chrome 156.0.8078.80. Existing vault
reopened and warm-up completed; 1M lines, 100k SKUs and affected SKU/tier pairs,
12 months. DuckDB retained its 512 MB limit, no spill or temporary invoice copy.

| Operation | Measured | Section 5 target |
|---|---:|---|
| SQL temporary-price simulation | 273 ms | <2 s: local pass |
| Simulation + persisted diff + audit + encrypted save | 3,448 ms | >2 s if measured as full user wait |
| 50-row preview | 18 ms | no separate target |

Synthetic single-machine results; arbitrary SKU/tier distributions and real
ERP data remain unverified. Scale's pilot cap stays 1M lines.

## Commands and SQL

| Command | Latest local result |
|---|---|
| `node scripts/check-migrations-lock.mjs` | Pass: seven locked, zero pending |
| `node scripts/check-schema.mjs` | Pass: 38 server tenant tables, unchanged |
| `node scripts/check-service-role.mjs` | Pass: 181 files checked |
| `node --test tests/*.test.js` | Pass: 67 tests, no failures/skips |
| `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test tests/*.test.ts` | Pass: 96 tests, no failures/skips |
| `node node_modules/typescript/bin/tsc --noEmit` | Pass |
| `node scripts/build-spike.mjs` | Pass |
| `node node_modules/next/dist/bin/next build` | Pass, including final rerun |
| `node scripts/test-vault-browser.mjs --browser=chrome` | Full harness pass, including new pricing UI/private-marker checks |
| `node scripts/test-vault-browser.mjs --browser=msedge` | Full harness pass |
| `node scripts/test-vault-browser.mjs --browser=chromium` | Initial missing browser; full rerun passed after installation |
| `node node_modules/playwright/cli.js install chromium` | Missing pnpm-layout path; corrected below |
| `node node_modules/@playwright/test/cli.js install chromium` | Pass: installed matching v1248 Chromium/headless shell |
| `git diff --check` and baseline comparison | Pass; V1–V5 SQL, Supabase migrations/lock, v1.enc and blueprint unchanged |
| `git commit` / `git push origin main` | WIP `6e5b5ac`, then `7fe3db8`; pushed implementation; CI #55 passed, including its authenticated privacy gate |

Browser commands used `VAULT_TEST_URL=http://127.0.0.1:3101`. No browser
performance promise is inferred from unit-suite runtime or shared-runner load.

- Governing/4D records and source read; git status/log: clean at `3780789`.
- TypeScript: iterative pass; corrected one test-helper type shadow.
- Focused pricing tests: initially two pass, three with backup failure test.
- Focused pricing + vault tests: 11 pass; compatibility assertions require v6.
- Asset build and production Next build: pass.
- Start at 3100: existing listener; untouched. Own lab server: 3101,
  VAULT_LAB_ENABLED=true only; no synthetic Supabase settings.
- Chrome --pricing-only: initial ICU error fixed with UTC literals; then pass.
- Chrome --pricing-bench: pass; numbers above.
- First full Chrome run found the recovery suite deleting the shell's empty
  pre-opened directory handle. Harness reloads after this destructive test;
  no recovery assertion was removed.
- Every new pricing SQL statement ran in real DuckDB-Wasm (Node/browser):
  migration, temporary copy, saved diff, conflict/role/guard checks, approval,
  versioning and export queries. Restore/audit/schema SQL ran in the browser.
  No new Postgres SQL was written.

## Remaining unverified

Real ERP imports and prospect cost files; headed picker,
disk permissions, physical power loss/quota/eviction; deployed sign-in;
external review and legacy-route retirement; authoritative roles/licences;
long-running schedules across suspension/repermission. Blueprint unchanged.

## Files changed

- Pricing and guardrail arithmetic: `lib/pricing/rules.ts`, `lib/margin/leaks.ts`.
- Local persistence and command integration: `lib/vault/schema.ts`,
  `service.ts`, `protocol.ts`, `worker.ts`, new `backup.ts`.
- Local UI: `components/local/PricingView.tsx`, `BackupView.tsx`, `VaultApp.tsx`.
- Regression/privacy suites: `tests/pricing.test.ts`, `tests/vault.test.ts`,
  `tests/browser/vault-worker.ts`, `scripts/test-vault-browser.mjs`.
- Evidence/status: this file, `PHASE_4_VERIFICATION.md`, `VAULT_RESULTS.md`,
  `ASSUMPTIONS.md`, `vault-evidence/pricing-4e-2026-11-04.json`; final acceptance
  also updates `AGENTS.md`, `BLUEPRINT_EXECUTION_PLAN.md` and the README.

Read-only `rg`, `Get-Content`, git status/diff/log/show and GitHub run/job/log
queries were used for inspection. An oversized shell documentation-generator
command was rejected before execution; the files were written with apply_patch.
No approval or error suppression was needed. The lab server was stopped after
the final Chromium run; the pre-existing 3100 listener was left untouched.

Documentation close-out: CI #55 is the acceptance run for implementation 7fe3db8. This follow-up changes only records and sanitized evidence; it does not claim that local performance or headed picker behaviour was exercised in CI. All requested local checks and all three browser harnesses passed before close-out.
