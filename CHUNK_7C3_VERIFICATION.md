# Chunk 7C-3 verification — part a: currencies and Firefox

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed. Part b and 7D have not started. Blueprint unchanged.

## Done when

| Requirement | Implementation / evidence |
| --- | --- |
| Workspace currency | Settings → Workspace currency; encrypted `vault_meta.currency`; Owner/Admin command enforced in the worker |
| Per-batch FX | Source currency and a manually entered decimal rate, workspace currency and header-file FX saved in `import_batches`; shown in import review, history and source-linked margin math |
| Exact amounts | Decimal source values → HUGEINT rational arithmetic → BIGINT cents, half away from zero; no floating-point money or rate fetch |
| Existing vaults | Append-only local migration v13 defaults to USD/1 and rewrites no amounts; 42 tables remain; committed v1 snapshot compatibility retained |
| Currency changes | Blocked while any business source, product, customer, quote, rule, guardrail, price, receipt, ROI or relay data remains; same-currency save allowed; use an empty/new vault and re-import |
| Follow-on flows | Fix Later and returns use the original batch rate; item-derived cost and header freight are already in workspace cents and are not converted twice |
| Formatting and exports | Local UI uses `fmt.currency`; PDF uses the workspace currency; quote shares carry its ISO code; generic price and change-log exports add `currency`; named ERP layouts keep their existing columns |
| Golden cases | Existing margin cases (including SO-8102) and five-finding Playground manifest retained without edits |
| Firefox | Full unauthenticated lab gate required in CI; bounded, retried install and 25-minute gate timeout; job limit raised from 45 to 60 minutes as requested |
| Privacy / permissions | Existing authenticated Chromium privacy gate and relay gate retained; currency command requires `roles`; decision 16 payload classification unchanged |
| Frozen database | No Supabase migration, lock, public table inventory or pgTAP plan change (152 fresh / 155 restore) |

## Local command record

The resume inventory matched `ce44c51` plus **36 modified and three new files**, byte-for-byte after line-ending normalization against `test-results/wip-7c3a/`. That ignored backup remains intact. `.claude/`, environment files, generated assets and test outputs are not staged.

| Command | Result |
| --- | --- |
| `git status --short`, `git diff --stat`, `git rev-parse --short HEAD` | Matched restart inventory; HEAD `ce44c51` |
| Normalized backup comparison (Node `fs` + `git diff --no-ext-diff`) | Tracked patch and all three new files matched |
| `git diff --check` | Passed; Git reported existing TSX line-ending warnings |
| `git diff --name-only -- supabase/migrations migrations.lock` | Empty; frozen files unchanged |
| `node node_modules/@playwright/test/cli.js install --force firefox` | Passed; Firefox 157.0 now launches (the original package had a SideBySide/mozglue error) |
| `node scripts/test-control-vault.mjs` with `VAULT_TEST_PORT=3106` | Passed: production build; Chrome and Edge each 44 vault + 11 local relay checks |
| `node scripts/test-control-vault.mjs --browser=firefox --vault-only` with `VAULT_TEST_PORT=3106` | Passed: production build and 44 Firefox vault/privacy checks |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed (clean final typecheck) |
| `node --test --test-concurrency=1 tests/*.test.js` | Passed: 78/78, no skips |
| `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts` | Passed: 178/178, no skips |
| `node scripts/check-migrations-lock.mjs` | Passed: 11 locked, zero pending |
| `node scripts/check-schema.mjs`, `node scripts/check-service-role.mjs` | Passed: 24 live public tenant tables; 219 user-facing files scanned |
| `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/currency.test.ts tests/quotes.test.ts` | Passed: 15 targeted FX/quote/security checks |
| `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/i18n.test.ts tests/vault.test.ts` | Passed: 17 final locale/schema/security/CI checks |
| `node --check scripts/test-vault-browser.mjs`, `node --check scripts/test-control-vault.mjs` | Passed |

Earlier development passes caught a schema-fixture column mismatch, a test SQL alias typo and an FX-settings/confirmation early-return bug. These were corrected, with regression assertions; they are not security findings. The resumed diff review removed a temporary synthetic-value assertion diagnostic. It also finished rate editing so metadata changes do not disable/blur the field per keystroke; the browser gate types a multi-character rate. Exact price-cell assertions now require the workspace currency symbol as well as the amount.

## SQL executed locally

`tests/currency.test.ts` executes the new v13 DDL on fresh and v12-populated DuckDB-Wasm, workspace setting reads/updates and the populated-data block, source FX/history queries, exact FX expressions, validation, commit, correction/recheck, returns and removal. It tests source precision, signed ties, extreme rates, mixed header/item rates and unchanged USD amounts. Browser `currency` exercises the actual `read_csv` Studio pipeline, committed batch metadata, source-linked show-math query, quotes and encrypted save/unlock. Existing export tests execute generic and named ERP exports; the new receipt test rejects a changed currency. No Postgres SQL is added.

## Firefox instrumentation and limits

The Playwright Firefox Windows package initially failed before opening a page: Windows SideBySide reported a missing `mozglue` assembly. One forced reinstall repaired that package: `firefox.exe --version` now returns Mozilla Firefox 157.0. No binary patch, test weakening or replacement browser was used.

Firefox has no Chromium DevTools crash or origin-quota API. The same recovery assertions remain active: a test-only browser interception injects OPFS `QuotaExceededError` (including after reload), and worker termination prevents a lock/pagehide save before closing the tab. Chromium retains actual renderer-crash and origin-quota emulation. Firefox uses an event-loop-delay sampler for the 200 ms responsiveness bound because its Long Tasks API is absent. These are controlled fault tests, not physical crash/disk-full proof. The full worker/import/mapping/quotes/pricing, encrypted OPFS, reload, wrong-passphrase, privacy, localization and layout checks are not skipped.

## Unverified

- Headed manual browser behavior, including the native permission dialog.
- Hosted Supabase sign-in, hosted restore, real ERP write-back/round trips, native-language review, physical crash/full-disk/quota recovery and real multi-user deployment.
- New large-vault performance measurements and performance on other hardware; no capacity increase is claimed.
- Zero- and three-decimal ISO currencies are intentionally rejected by this cent-based engine; no live FX or historical FX lookup is implemented.

Browser evidence is measured headlessly on this Windows machine (Ryzen 5 5600H, 7,887,220,736 bytes RAM). Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 44 lab checks and 11 local-PGlite relay checks; Firefox 157.0 passed the full 44-check lab gate. The actual non-USD PDF and currency-bound relay approval are covered. Real authenticated local-Supabase evidence is verified in CI #108; this is not hosted-deployment evidence. The source files used in every test are synthetic.

CI runs Firefox against a loopback-only lab server directly with Node on port 3001, separate from authenticated port 3000. It owns the server PID and cannot accidentally reuse a server without lab mode. Firefox uses Gecko's official storage-prompt test preferences to choose Allow; the actual persist() and persisted() APIs must return true. Playwright grantPermissions alone left permission=prompt and persist() unresolved in an isolated native API probe. With dom.storageManager.prompt.testing=true and its .allow preference true, that same probe completed and persisted() returned true. No application API is mocked. See [Gecko StorageManager](https://searchfox.org/firefox-main/source/dom/quota/StorageManager.cpp) and [Mozilla's test-prompt discussion](https://bugzilla.mozilla.org/show_bug.cgi?id=1837282). Native manual permission UI remains unverified.

The native clipboard probe found Firefox's ClipboardEvent constructor returned empty clipboard text, while the same DataTransfer held 120.01. A bubbling paste Event with that DataTransfer property delivered 120.01 in both Chrome and Firefox. The shared harness now uses that event and still exercises the real handler/parser, preview, approval, export and landed checks; it never touches the system clipboard. Earlier full-gate failures at this setup and the persistent-storage prompt were fixed without dropping assertions.

Measured headlessly on this machine: 100k import plus save was 6,207 ms (Chrome), 6,175 ms (Edge), 7,390 ms (Firefox). No >50 ms main-thread task/delay was recorded in those final runs (the gate retains its 200 ms ceiling). These are observations, not performance or serverless guarantees. Firefox's timer sampler is distinct from Chromium's Long Tasks API.

## Files changed before CI

- .github/workflows/ci.yml
- ASSUMPTIONS.md
- README.md
- SECURITY_WHITEPAPER.md
- components/local/CostBasisView.tsx
- components/local/HomeView.tsx
- components/local/ImportStudio.tsx
- components/local/MarginView.tsx
- components/local/PricingOps.tsx
- components/local/PricingTools.tsx
- components/local/PricingView.tsx
- components/local/QuotesView.tsx
- components/local/RelayPanel.tsx
- components/local/VaultApp.tsx
- lib/i18n/core.ts
- lib/i18n/index.ts
- lib/i18n/locales/en.ts
- lib/i18n/locales/es.ts
- lib/i18n/locales/fr.ts
- lib/margin/credits.ts
- lib/margin/report.ts
- lib/margin/views.ts
- lib/pricing/market.ts
- lib/pricing/rules.ts
- lib/roles/access.ts
- lib/studio/fixlater.ts
- lib/studio/formats.ts
- lib/studio/load.ts
- lib/studio/studio.ts
- lib/vault/dispatch.ts
- lib/vault/protocol.ts
- lib/vault/schema.ts
- lib/vault/service.ts
- scripts/test-control-vault.mjs
- scripts/test-vault-browser.mjs
- tests/browser/vault-worker.ts
- tests/pricing.test.ts
- tests/quotes.test.ts
- tests/vault.test.ts
- CHUNK_7C3_VERIFICATION.md
- components/local/CurrencySettings.tsx
- lib/vault/currency.ts
- tests/currency.test.ts

## CI proof and close-out

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed.

Step 21 (Required authenticated local-vault privacy gate) and step 23 (Required Firefox local-vault lab gate) concluded success. Authenticated Chromium 156.0.8078.4 reported 46 checks; Firefox 157.0 reported 44, including browserSupport, currency, currencyUi, quotesUi and privacy. The relay log explicitly reports 11 checks on real authenticated local Supabase. Unit logs report 78/78 JS and 178/178 TS; the database plan prints 1..152 twice. CI passed on the first implementation push; no CI fix attempt was needed.

The committed-version Chrome/Edge repeat also passed 44 vault + 11 local-PGlite relay checks each after the portable paste change. The Windows Firefox gate passed all 44. CI install --frozen-lockfile, advisory gate, typecheck, tests, production builds, lock/schema/service-role gates, runtime app-role check, real database suite and both required browser gates passed. CI timing observations: 100k import/save 7,322 ms (Chromium) and 8,045 ms (Firefox), with no long task/delay over 50 ms recorded. These are shared-runner observations, not latency guarantees.

Implementation commit and push: git commit -F test-results/7c3-commit.txt and git push origin main succeeded (155188f). Close-out runs the same local typecheck, full JS/TS tests and lock check before its documentation-only commit and push. Blueprint unchanged; 7C-3b and 7D remain unstarted.

## Close-out files and final checks

Documentation only: AGENTS.md, ASSUMPTIONS.md, BLUEPRINT_EXECUTION_PLAN.md, CHUNK_7C3_VERIFICATION.md, CODEX_HANDOFF.md, README.md, SECURITY_CHECK.md, SECURITY_WHITEPAPER.md.

After these updates, the table’s exact local typecheck, full JS tests (78/78), full TS tests (178/178), migration lock (11/11), schema and source scan commands all passed again. git diff --check passed. The controller invokes node scripts/build-spike.mjs, node node_modules/next/dist/bin/next build and a loopback-only next start; all final Chrome/Edge/Firefox production builds passed and each server was stopped by its controller. Native storage/clipboard probes and the single forced Firefox reinstall are documented above. The shutdown backup remains in ignored test-results/wip-7c3a/. The pre-existing .claude/ folder is untouched.


## Part b — 7C-3b (8 November 2026)

Status: locally verified; CI unverified pending the implementation push. Precondition: part a CI #108 above. No blueprint, dependency, local schema, locked migration or migrations.lock changes.

### Scope

- Cost-gated Home health rules over exact adjacent 90-day windows, session-configurable strict margin-drop threshold, weighted discount plus distinct-order rule, last-checked and open-Home-only copy. Full-month agg_cm plus boundary lines avoid monthly-window drift.
- Cost-gated cash-leak hero uses the existing finder on the windowed input, including service-order rules. Deduplicated cents, overlap and formulas are visible; no new ROI ledger writes.
- Top-three same-category alternatives resolve the current customer price matrix and use complete customer/SKU cost, rebate and freight history. Stable SKU ties; no zero-cost guesses, no second book-discount subtraction.
- Relay synced/pending/conflict plus last successful sync timestamp, derived from the encrypted session. No relay protocol/server change.
- English, Spanish, French and fr-CA fallback; shared UI, workspace-currency formatters, cost gating and decision-16 regression retained.

### Commands and results

| Command | Result |
|---|---|
| git status --short; git diff --stat | Started clean except pre-existing untracked .claude/; old 7C-3a backup preserved |
| node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/monitor.test.ts | Initial reserved SQL alias errors fixed with explicit AS; all four passed in actual pinned DuckDB-Wasm |
| Same TS runner: tests/monitor.test.ts tests/pricing-tools.test.ts tests/quotes.test.ts tests/i18n.test.ts | 31/31 passed |
| node --test --test-concurrency=1 tests/*.test.js | Initial fixture-count guard expected old relay count 11; updated to 12 for added status check; final rerun 78/78 passed |
| node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts | 182/182 passed |
| node node_modules/typescript/bin/tsc --noEmit | Early type errors corrected; final rerun passed |
| node scripts/check-migrations-lock.mjs | Passed, 11 locked / 0 pending unchanged |
| node scripts/check-schema.mjs | Passed, 24 public tenant tables unchanged |
| node scripts/check-service-role.mjs | Passed, 223 source files; existing absent src/pages warnings |
| VAULT_TEST_PORT=3106; node scripts/test-control-vault.mjs | Production build passed; first new browser fixture failed because CURRENT_DATE needs disabled ICU. Fixture now uses explicit DATE; Chrome and Edge full rerun passed, 46 vault + 12 local relay checks each |

Every new production SQL query has executed in pinned DuckDB-Wasm 1.32.0, including both windows/thresholds, alternatives, the scoped full leak finder (with and without service-cost tier gating through the unit/browser suites), and default full-history golden tests. No new Postgres SQL. Local tests are not CI evidence.

### Unverified

CI and authenticated local-Supabase browser checks for part b remain unverified pending a green run. Hosted sign-in/restore, native permission dialogs, physical recovery, large-vault monitoring latency and customer ERP systems are not exercised by these local checks. No restore drill needed: no Supabase schema/inventory change.

### Final local evidence

On Ryzen 5 5600H, approximately 8 GB RAM, Windows: Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 46 vault checks and 12 relay checks (PGlite transport, authentication unverified locally). Both assert CA$20.00 hero, CA$60.00 margin / CA$120.00 alternative price, exact rate display, show-math dialogs, ranking, role denial, encrypted reload, read-only monitoring, pseudo-locale and 375px. Chrome screenshot inspected at test-results/7c3b-chrome-home-cad.png. New context selectors use the concrete currency select and structural pseudo-locale unlock controls.

Measured 100k import/save: 6,157 ms Chrome / 6,132 ms Edge; no main-thread task above 50 ms recorded. These are local observations, not new monitoring latency guarantees.

After final source refinements, all 78 JS and 182 TS tests passed again; typecheck, lock/schema/source scans passed. The final node scripts/test-control-vault.mjs --relay-only --browser=chrome rebuild invokes node scripts/build-spike.mjs and node node_modules/next/dist/bin/next build with disposable keys and a loopback-only server, then repeats all 12 relay checks. Each controller stops its own server. No pnpm on PATH; direct Node commands are the package-script equivalents, with no dependency/lockfile change.

Additional commands: git diff --check passed; git diff --numstat -- supabase/migrations migrations.lock BLUEPRINT.md was empty. Read-only rg/Get-Content/Get-ChildItem and process inspection diagnosed fixtures and gate progress. No customer or secret files were read or committed.

### Part b files changed

- UI: components/local/HomeMonitor.tsx (new), HomeView.tsx, PricingTools.tsx, RelayPanel.tsx.
- Worker math: lib/margin/monitor.ts (new), leaks.ts; lib/pricing/alternatives.ts (new), market.ts.
- Relay: lib/relay/sync-status.ts (new), session.ts (encrypted metadata / view only).
- Worker boundary: lib/vault/service.ts, protocol.ts, dispatch.ts, licence.ts; lib/roles/access.ts.
- Catalogs: lib/i18n/locales/en.ts, es.ts, fr.ts (fr-CA inherits).
- Tests/gates: tests/monitor.test.ts (new), pricing-tools.test.ts, relay-session.test.ts, relay-privacy.test.js, browser/vault-worker.ts; scripts/test-vault-browser.mjs, test-relay-browser.mjs.
- Documentation: ASSUMPTIONS.md, CHUNK_7C3_VERIFICATION.md, AGENTS.md, BLUEPRINT_EXECUTION_PLAN.md; further CI close-out docs listed after a passing run.

Blueprint unchanged; 11 locked migrations and migrations.lock unchanged; 7D and later work unstarted.
