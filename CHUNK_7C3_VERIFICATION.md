# Chunk 7C-3 verification — part a: currencies and Firefox

8 November 2026. Implementation and local checks are **unverified in CI** until a passing run is linked here. Part b and 7D have not started. Blueprint unchanged.

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

- Passing CI for this chunk, including nonzero required Firefox and authenticated Chromium gates, until linked.
- Headed manual browser behavior, including the native permission dialog.
- Hosted Supabase sign-in, hosted restore, real ERP write-back/round trips, native-language review, physical crash/full-disk/quota recovery and real multi-user deployment.
- New large-vault performance measurements and performance on other hardware; no capacity increase is claimed.
- Zero- and three-decimal ISO currencies are intentionally rejected by this cent-based engine; no live FX or historical FX lookup is implemented.

Browser evidence is measured headlessly on this Windows machine (Ryzen 5 5600H, 7,887,220,736 bytes RAM). Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 44 lab checks and 11 local-PGlite relay checks; Firefox 157.0 passed the full 44-check lab gate. The actual non-USD PDF and currency-bound relay approval are covered. Real authenticated local-Supabase evidence awaits CI. The source files used in every test are synthetic.

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
