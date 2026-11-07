# Chunk 7C-2 verification

8 November 2026. Items 6–10 only; 7D and later not started. **CI unverified**
until the new commit's run is green. Blueprint unchanged. No server code,
Supabase migration, migrations.lock, function allowlist or restore inventory
changed. Local schema v12: 42 tables (37 before this chunk).

| Done when | Evidence / status |
|---|---|
| Competitor observations beside own price | Worker and UI flows; manual source notes, no fetch |
| Grid paste → draft → guardrails → owner → version/export | Exact cents, protected scope, stale/red/role tests, Starter restriction |
| Slider approximate/exact | Read-only cached worker base; exact matches normal simulation |
| Small/free delivery losses | Known-cost invoice controls, explicit confirmation, exact allocation and overlap tests |
| Landed comparison | Immutable export receipt, full scopes, changed/missing/duplicate/applied cases, CSV and XLSX |
| Privacy, audit and encrypted reload | New pricingTools and pricingToolsUi checks added to the existing gate; CI pending |
| Margin golden / Playground | Existing golden tests retained; five planted findings not changed |
| Frozen database | 11 applied migrations, zero pending; lock/schema gates unchanged |

Details and provisional limits are in ASSUMPTIONS.md. New SQL belongs to the
browser's pinned DuckDB-Wasm 1.32.0, not Postgres. Unit and production-browser
results below are local evidence only until a cited passing CI run.

## SQL coverage

The tests execute v12 DDL, grid read/filter/page/selection, bounded historical
resolution, guard lookup, draft/revision/run insertion, preview, list update,
matrix close/insert and same-day/future price update, rollback, competitor insertion/current price,
receipt/hash insertion, landed history, read-only slider base/approximation/exact
query, invoice grouping, free-delivery confirmation, cost-to-serve cumulative
allocation, both finding insertions and their source-row evidence. Transactions,
audit insertion and encrypted reload execute in the real browser worker. DuckDB
extension auto-install/load stays disabled in production. No new Postgres SQL.

## Commands and results

The ledger below records commands and intermediate corrections. Local logs are
ignored and contain synthetic fixtures only. Passing CI will be cited separately.

## Unverified

- New authenticated CI gate until the run passes; local lab identities are not
  real Supabase authentication.
- Deployed/hosted authentication and ERP compatibility; no restore workflow is
  required because the Supabase schema/inventory is unchanged.
- Native Spanish/French translation review, headed manual accessibility/UX,
  physical crash/quota/multi-tab recovery, 1M/2M performance of these features.
- No customer-source sites are fetched, and no freight rating or causal forecast
  is provided. No work from 7D or later.

## Local check ledger (8 November 2026)

- `git status --short`, `git diff --stat`: baseline clean except the pre-existing
  untracked .claude/ directory; it remains untouched.
- `node node_modules/typescript/bin/tsc --noEmit`: passed after implementation and
  corrections; also run by the production build.
- `node scripts/check-migrations-lock.mjs`: passed, 11 applied / zero pending.
- `node scripts/check-schema.mjs`: passed, 24 live public tenant tables.
- `node scripts/check-service-role.mjs`: passed, 217 source files; warnings for
  absent src/ and pages/ are expected, and the nonzero-file gate remains.
- `node --test --test-concurrency=1 tests/*.test.js`: passed, 78 tests.
- `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts`:
  171 tests in the expanded suite (161 before this chunk); final rerun recorded
  below after completion. Targeted runs of pricing-tools (10), prior pricing ops,
  margin-v2, i18n and vault tests were also used while correcting defects.
- `VAULT_TEST_PORT=3106 node scripts/test-control-vault.mjs` (PowerShell sets the
  environment separately): builds self-hosted workers and Next production assets,
  starts 127.0.0.1:3106, runs Chrome then Edge vault/relay harnesses, and stops its
  server. Current final results are recorded below after completion. This is the
  repository's documented direct-script equivalent on a machine without pnpm on
  PATH; no dependencies were added or lockfile changed.
- `git diff --check`: passed; only autocrlf informational warnings. Protected-path
  diff for supabase/migrations and migrations.lock is empty.

Intermediate local failures were corrected, not waived: DuckDB reserved aliases;
the browser-only absence of the JSON extension (replaced by built-in key logic);
an occupied 3100 listener (isolated port plus preflight); saved-rule/duplicate-SKU
selector ambiguity; a percent display suffix sent as slider input; and a
concatenated accessible label found by the pseudo-locale walk. Scope, downgrade,
future dates, formula-safe identifiers, disguised workbook types and zero-price
freight lines have explicit regression coverage. No assertion was removed.

## Local browser results

Measured on Windows 10.0.26200, Ryzen 5 5600H, 7,887,220,736 bytes RAM:
Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 41 named vault checks
and the 11-check local PGlite relay transport harness. Both include pricingTools
(10 flags: competitor, paste, draft, approval, scoped XLSX, landed, service loss,
rep denial, audit and encrypted reload) and pricingToolsUi (8 flags: Excel paste,
owner approval, scoped export, landed comparison, exact slider, competitor screen,
cost-to-serve screen and unchanged invoice counts). The pseudo-locale walk includes
all new tabs. These are headless local checks, not authenticated Supabase evidence.

Grid, landed and competitor screenshots in ignored test-results/ were visually
inspected; wide tables retain the shared keyboard-focusable horizontal scroll
region for long synthetic identifiers. This is not a headed manual review.
A final isolated 3107 production probe runs the two worker flows in both browsers
after the last scope/cache fixes; its result is recorded with the final checks.
Blueprint unchanged. No 7D or later work.

## Final local result

All final checks passed: 78 JS + 171 TS = **249 unit tests**; typecheck;
self-hosted worker build and Next production build; 11 applied migration hashes;
schema and service-role scans. The final 3107 probe passed both 7C worker flows
in Chrome and Edge on the final code. Full local gates passed 41 vault + 11 local
relay checks per browser. Authenticated Supabase verification is still CI-only.

The final suite also exposed an old fixture flake: UUID
`dab91e7b-dd3a-4321-8549-df1adb6e033d` happened to contain the short cost sentinel
4321. Only the decision-16 fixture UUID generator is now deterministic and valid.
The payload scanner and command classification are unchanged, and a negative
control proves it still rejects the sentinel inside an ID. The 8 Quote Desk tests
and the full 171-test suite passed after the fix. No production quote code changed.

Additional commands: `node test-results/7c2-final-probe.mjs` (ignored local launcher,
production build and two targeted browser flows, passed); targeted
`tests/quotes.test.ts` (8 passed). `git diff --check` passed, and the protected-path
diff (app/, Supabase migrations, migrations.lock, package/lockfile, workflows and
BLUEPRINT.md) is empty. Git staging/commit/push and CI evidence follow separately.

## Files changed (33)

- Pricing/margin logic: lib/pricing/{grid,market,whatif,rules}.ts;
  lib/margin/{decimal,leaks,service-cost}.ts.
- Worker boundary/local schema: lib/vault/{dispatch,licence,protocol,schema,service}.ts;
  lib/roles/access.ts.
- UI/catalogs: components/local/{PricingTools,PricingView,MarginView}.tsx;
  lib/i18n/locales/{en,es,fr}.ts (fr-CA inherits).
- Tests/launchers: tests/{pricing-tools,quotes,vault}.test.ts;
  tests/browser/vault-worker.ts; scripts/test-{control-vault,vault-browser}.mjs.
- Docs: AGENTS.md, ASSUMPTIONS.md, BLUEPRINT_EXECUTION_PLAN.md,
  CHUNK_7C_VERIFICATION.md, this record, CODEX_HANDOFF.md, README.md,
  SECURITY_CHECK.md. Blueprint unchanged.

Staged diff/check and the protected-path staged diff passed. No .env files,
.claude/, generated assets, test-results/ or customer files are staged.
