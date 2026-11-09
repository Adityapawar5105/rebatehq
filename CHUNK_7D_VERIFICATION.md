# Chunk 7D — verification

## Part 1 — customer rebates (CI-verified)

**Verified in [CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026:** 269 unit tests (78 JS + 191 TS), **50 authenticated Chromium vault checks**, **48 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran and passed with nonzero counts. Local vault **v14 / 45 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill needed or run: no Supabase schema/inventory change.

Scope: customer programs, agreement imports, tier progress/reminders and accrual reconciliation. Local vault **v14 / 45 base tables**; three new tables: `rebate_programs`, `rebate_tiers`, `rebate_accruals`, plus the read-only `rebate_sales` financial input view. No server/API/control-plane changes, Supabase migration, dependency, lock-file change or restore inventory change. Blueprint unchanged.

### Behavior

- **Rebates & Contracts** uses the 7V shared shell, cards, fields, tables, notices and dialog. Message keys in en/es/fr (fr-CA inherits), theme tokens and workspace-currency formatters. Professional/Scale enforcement is in the worker, using the signed licence tier.
- One customer program per inclusive overlapping period, up to 100 non-overlapping tiers. Retroactive or incremental; thresholds are exact cents and rates exact thousandths of a percent. Signed returns/credits net against eligible sales. SKU exclusions take precedence. Liability rounds once, then allocations use stable cumulative cent rounding so their sum equals the engine.
- Terms declare `additional` or `replace`. Additional adds the program liability to imported invoice rebates. Replace is only for an invoice rebate field that represents the same program. Neither mode changes the imported `sales_lines`. Reconciliation displays imported + declared adjustment = recognized, including signed credits; filtered waterfall and source math use the same allocations.
- Agreement imports use converter preview, explicit mapping, acknowledgement, source metadata, Fix Later and source replacement/removal. Legacy six-column agreements without mode/treatment stay rejected rather than receiving guessed defaults. A broken tier rejects its complete program cohort; dismissing a band cannot activate a partial agreement. Source-file terms cannot be edited through manual forms.
- Threshold amounts use batch FX once; rates are dimensionless. There is no currency fetch. Existing accrued liabilities remain in financial reads after licence downgrade. Removing owned source data remains possible through the existing data-removal permission.
- Rep `rebateProgress` is explicitly classified and scanned under decision 16, using nonempty golden data; full state/evidence/writes are denied. Admin has no rebate business capability. Accountants manage manual programs but gain no general import permission. Reminders are app-open notices, not email or scheduled services.
- Existing quote snapshots do not predict future rebate attainment. These liabilities are estimates from imported records, not accounting postings, recovered cash, payments or a legal entitlement determination.
- Item merges involving any program's explicit eligible/excluded SKU are blocked until terms are reviewed. No silent eligibility retargeting.

### Local checks (not CI proof)

Machine: Windows, Ryzen 5 5600H, approximately 8 GB RAM. Node 24.22.1. Actual pinned DuckDB-Wasm 1.32.0 executes local SQL; PGlite is inappropriate for DuckDB-specific HUGEINT, REPLACE projections, `//` and catalog/copy semantics.

| Command / stage | Result |
| --- | --- |
| `git status --short`, `git diff --stat`, owning-source reads/searches | Partial tree inventoried; unrelated `.claude/` untouched |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=1 tests/rebate-local.test.ts` | Initial 3 tests passed; expanded run caught a reserved SQL alias and test-fixture mistakes; corrected 7-test run passed |
| Same runner, `tests/rebate-local.test.ts tests/quotes.test.ts` | Passed initial core/rep coverage |
| Same runner, `tests/roles.test.ts tests/quotes.test.ts` | 16 passed after adding the new capability expectations and dispatcher classification |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed after missing message keys/test type fixes |
| `node scripts/check-migrations-lock.mjs` | 11 locked / 0 pending passed |
| `node scripts/check-schema.mjs` | Passed; existing control-plane inventory/gates unchanged |
| `node scripts/check-service-role.mjs` | Passed, 228 user-facing files; existing missing optional src/pages warnings |
| `node --test --test-concurrency=1 tests/*.test.js` | 78 passed |
| TS runner, `tests/*.test.ts` | First complete run 186/189; three new-role expectation/dispatcher-format failures corrected, final 191/191 TS rerun passed (269 total with JS) |
| `VAULT_TEST_PORT=3106 node scripts/test-control-vault.mjs` | Production build passed; initial browser run caught obsolete “XML converted only” expectation. Updated to require missing terms in Fix Later. Final Chrome/Edge rerun passed |
| Chrome 156.0.8078.80 and Edge 157.0.4341.42 | Each passed 48 vault/privacy checks and 12 local PGlite relay checks; authenticated transport unverified locally |
| Firefox 157.0 local vault gate | 48 checks passed, exit 0 |
| `git diff --check` | Passed |

SQL execution coverage: v13→v14 migration including AR sidecar preservation; manual create/edit/delete, tier validation and overlap checks; staged rates/FX/date/required field validation; whole-program validation; agreement commit/rejection retention; Fix Later correction, recheck and dismissal; accrual rebuild/window allocation; raw-versus-recognized reconciliation; waterfall/math/drill and invoice differences; source removal and rollback; source-linked evidence; currency blockers and role projection. Browser tests additionally exercise actual converter staging/read_csv, encrypted snapshot open/copy-on-write/reload and source replacement. All listed local SQL executed successfully in the pinned DuckDB-Wasm unit/browser harness; no new SQL statement remains unexecuted locally.

### Remaining unverified

Hosted/deployed auth/restore, headed/native permission UI, physical crash/quota/multi-tab recovery, native-language review, real customer contract/ERP acceptance and large-vault rebate/import latency are unverified. No new performance claim. No restore drill is needed because the server schema/inventory did not change.

## Part 2 — unstarted

Supplier claims, Purchases (PO receipts), supplier progress and claim exports are deliberately unimplemented. Start only in a separate user-authorized 7D-2 session. Legacy server rebate tables remain for retirement wave 2 (8R); none dropped here.

### Final local notes

The final Chrome/Edge production harness and the separate Firefox vault harness exited 0. It builds the self-hosted workers with disposable keys, runs production Next.js build/start, and stops its own loopback server. No fake Supabase configuration. Visual QA reviewed the Chrome phone screenshots in light and contrast themes; screenshots are git-ignored. The final complete unit rerun passed 78 JS + 191 TS, zero failures/skips. Typecheck passed. Existing MODULE_TYPELESS_PACKAGE_JSON and absent optional src/pages scan warnings were not changed.

Rebate agreement commits require an explicit terms acknowledgement in the report UI and independently in the worker, even with zero rejected rows. An attempted unacknowledged commit is tested as denied, then the same plan succeeds with confirmation. Existing Fix Later rules remain: a wholly invalid batch cannot commit; correct/re-upload it or include it with valid batch rows before retaining rejections. The mixed-format browser fixture proves old six-column terms are retained as rejected without activating partial programs.

Concurrent user commit edb77c3 advanced AGENTS/BLUEPRINT to v2.5 during this task; preserved unchanged. This attached prompt explicitly authorizes 7D-1 under v2.4. Selection aggregates, row notes and universal column filter/sort are **not implemented or verified by 7D-1** and require a separately scoped follow-up. No blueprint edit made by this chunk.

### Files changed by part 1

- Screen/shell: components/local/RebatesView.tsx (new), VaultApp.tsx, MarginView.tsx, ImportStudio.tsx.
- Worker engine/store/import adapters: lib/rebate/{engine,input,store,import}.ts (new); lib/vault/{schema,protocol,dispatch,licence,service,currency}.ts; lib/roles/access.ts.
- Financial input: lib/margin/{aggregate,views,bridge,leaks,monitor,service-cost}.ts; lib/pricing/alternatives.ts; lib/cleanup/item-master.ts. Quantity-only pricing inputs remain raw; financial pocket inputs use recognized allocations.
- Import/source/Fix Later: lib/studio/{formats,mapper,load,studio,fixlater}.ts.
- Translations: lib/i18n/locales/{en,es,fr}.ts (fr-CA inherits).
- Tests: tests/rebate-local.test.ts (new), quotes.test.ts, roles.test.ts, vault.test.ts; tests/browser/vault-worker.ts; scripts/test-vault-browser.mjs.
- Evidence/assumptions: this record and ASSUMPTIONS.md, README.md, AGENTS.md, SECURITY_CHECK.md, BLUEPRINT_EXECUTION_PLAN.md and CODEX_HANDOFF.md.

### Command inventory

The pinned TS runner below is node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs. This machine has no pnpm on PATH, so the documented Node equivalents were used locally. CI runs the actual pnpm scripts and frozen-lockfile install.

- Read-only inventory/review: Get-Content and rg on the attachment, governing docs and owning source/tests; git status --short / -sb, git diff --stat / --numstat / --name-only / --check, git log, git show, git branch --show-current and git rev-parse. Missing-file exploratory searches were corrected; no user data or secrets printed.
- `node <TS-runner> --test --test-concurrency=1 tests/rebate-local.test.ts`, focused rebate+quote and role+quote runs: passed after correcting a reserved DuckDB alias and fixture/type errors; final full suite includes all eight rebate tests.
- `node --test --test-concurrency=1 tests/*.test.js`: final **78/78 passed**, zero skipped.
- `node <TS-runner> --test --test-concurrency=1 tests/*.test.ts`: final **191/191 passed**, zero skipped. Earlier full run caught three stale role/dispatcher expectations; fixed without removing checks.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node scripts/check-migrations-lock.mjs`: passed, 11 locked / 0 pending. `node scripts/check-schema.mjs`: passed, 24 live public tenant tables. `node scripts/check-service-role.mjs`: passed, 228 user-facing files.
- `VAULT_TEST_PORT=3106 node scripts/test-control-vault.mjs`: final exit 0; invokes `node scripts/build-spike.mjs`, `node node_modules/next/dist/bin/next build`, starts/stops its own loopback server, and runs the Chrome/Edge vault and relay scripts. Each browser passed 48 vault + 12 local PGlite relay checks. Initial runs exposed obsolete converted-only/rep-section expectations and the missing terms-confirmation UI/worker link; all corrected before push.
- Same controller with `--browser=firefox --vault-only`: exit 0, Firefox 157.0, 48 checks.
- `git diff --check`: passed. Explicit `git add …`, `git commit -F test-results/7d1-commit-message.txt`: implementation **585ccf8**; `git push origin main`: succeeded. The concurrent documentation parent edb77c3 is preserved. No locked migration/hash, server/API, dependency or real-file changes.
- GitHub connector: read run/jobs/steps/logs to confirm actual non-skipped gate execution; CI evidence is added only on success.

### CI evidence

[CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026: 269 unit tests (78 JS + 191 TS), **50 authenticated Chromium vault checks**, **48 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran and passed with nonzero counts. Local vault **v14 / 45 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill needed or run: no Supabase schema/inventory change.

Job 128700494264: step 21 (Required authenticated local-vault privacy gate) and step 23 (Required Firefox local-vault lab gate) completed with success, not skipped. Chromium 156.0.8078.4 ran 50 checks; Firefox 157.0 ran 48. Both result lists include rebates and rebatesUi, whose assertions cover exact CAD amounts and rep/source/persistence controls. The real authenticated relay gate ran 12 checks. PostgreSQL 17 ran plan 152 twice; repeatability found no residue. Install with --frozen-lockfile, advisory audit, typecheck, pnpm test/build, migration/warning gates and runtime role verification passed. The source scanner counted 220 files in CI and 228 locally. No restore drill or hosted verification was performed.

Post-CI documentation close-out reruns the unit suites, typecheck and lock check before commit/push. Implementation proof stays attached to 585ccf8; a documentation-only follow-up does not change the code or locked migrations.

Close-out checks after CI #114: 78/78 JS and 191/191 TS tests passed with zero failures/skips; typecheck and migrations-lock check passed. `git diff --check` passed. Documentation-only close-out: explicit staging of AGENTS.md, ASSUMPTIONS.md, BLUEPRINT_EXECUTION_PLAN.md, CHUNK_7D_VERIFICATION.md, CODEX_HANDOFF.md, README.md and SECURITY_CHECK.md, then `git commit -F test-results/7d1-closeout-message.txt` and `git push origin main`. No blueprint, source/test logic, locked migration or hash is changed by the close-out.

### Reconciliation wording follow-up

Final review found that Data Hub's legacy “matches imported lines” copy no longer described inputs after declared rebate adjustments. The green state now reports no **unaccepted** differences (so accepted exceptions do not falsely imply equality), the expected-value header has its own message key instead of reusing the import-success plural, and discrepancy wording identifies adjusted financial inputs. All three language catalogs were updated; fr-CA inherits French. No SQL, arithmetic, permission, comparison or test assertion changed.

Validation: full 78 JS + 191 TS rerun passed; the focused `node <TS-runner> --test tests/i18n.test.ts` run passed 9/9 on the final copy; typecheck, production worker/Next.js build and migration lock passed. `node scripts/check-schema.mjs`, `node scripts/check-service-role.mjs` and `git diff --check` are retained. No new SQL to execute. Local Chrome/Edge/Firefox evidence above covers the implementation; the final CI browser gates also run after this copy-only correction. Explicit commit/push uses `git commit -F test-results/7d1-copy-message.txt` and `git push origin main`.


## Part 2 — supplier claims and purchase receipts (7D-2, 9 November 2026)

Status: **unverified in CI** until a passing run is cited below. 7E remains unstarted. Blueprint v2.5 unchanged.

### Implemented boundary

- Local vault v16 / 47 base tables, adding only supplier_claims and purchases. v15 upgrade preserves product/customer notes and AR/customer-agreement source kinds. No Supabase migration, locked hash, dependency, server/API or retirement change. Wave-2 rebate retirement remains 8R.
- Purchases (PO receipts) detection, synonyms, optional unit-price multiplication, explicit mapping, positive source magnitudes with receipt/return/credit_memo, exact FX once, validation/Fix Later, duplicate detection, source replacement/removal and retained source file/row. A line ID is unique within a file. Purchases share the licensed line budget with sales. Units are retained; no inferred conversions.
- Supplier rebate cases hold approved inclusive dates, SKU filters and exact incremental/retroactive bands using the 7D-1 engine. Live attainment includes signed returns and credit memos. The CAD 29,500 eligible-spend fixture earns CAD 590; the next-tier fixture has CAD 12,400 remaining. Customer recognition and the waterfall are unchanged; supplier receivables are not silently added to margin.
- Ship-and-debit is explicitly operator-assessed with supplier authorization. PO receipts alone do not establish resale entitlement. No supplier submission, legal determination or cash posting is performed.
- Local export prepares and freezes the amount/evidence hash. Operator status actions record submission, supplier approval/rejection and payment. Invalid transitions, editing frozen terms, stale preview, overclaim and changed-evidence re-export are refused. Only prepared/rejected cases can be redrafted. Source changes update live progress without rewriting recorded claims.
- CSV/XLSX contain a single claim total, tier rows and source-linked receipt rows, exact decimal text, workspace currency, formula-neutralized cells and absolute receipt magnitudes with explicit kind. Evidence cap 100,000 is checked before materialization; no truncation. Product/customer notes never enter these exports.
- Claims, purchases and supplier progress use the shared 7V-3 DataGrid with full-result worker filtering, sort, distinct values and exact selection totals before 50-row paging. English/Spanish/French catalogs are complete; fr-CA inherits. New screens use the existing shell/theme components.
- Supplier reads require cost, writes/exports rebateManage, ingestion data plus Professional/Scale. Reps receive none of these commands; the exhaustive decision-16 classification remains enforced. Accountants manage claims without general data-import permission. Supplier mutations/imports/exports audit only codes and IDs; data and plaintext remain in the worker/device. Encrypted snapshot/audit integrity is checked in the browser flow.
- Source cleanup/note-removal previews retain products used by other purchases. Merges touching purchase evidence are refused, rather than retargeting receipt facts.

### Verification and commands

The local toolchain has no pnpm on PATH. Node equivalents use the installed pinned dependencies; CI runs pnpm and the frozen lockfile install. All changed product SQL is DuckDB-specific and is exercised on pinned DuckDB-Wasm 1.32.0, not claimed as Postgres SQL. Existing PGlite/control-plane tests remain in the full suite.

- Inventory/read/edit: git status --short, git diff --stat/--check/--name-only; Get-Content/rg on the user attachment, governing docs, skill and owning code/tests; apply_patch and Node edit scripts. No credentials or real customer files read into output.
- Focused supplier tests: initial test-fixture reserved alias, detectRole return-shape and decimal-scale expectations corrected; assertions retained. Final focused supplier + vault run: 17 passed, zero skipped. Supplier/quote/i18n focused run also exercised rep/tier gates; final full suite is the authoritative count below.
- Full JS/TS suites, typecheck, production build, lock/schema/service-role checks and Chrome/Edge/Firefox results: pending final recording below.
- Local Chrome/Edge controller uses disposable signing keys and a synthetic lab identity, starts/stops its own port 3106 server. No synthetic Supabase configuration. CI must independently prove real local-Supabase authenticated privacy and relay gates with nonzero counts.

### Unverified limits

Until a green run is cited, CI authentication/privacy and required Firefox coverage are unverified. Hosted auth/deployment/restore, headed manual acceptance, physical crash/quota/multi-tab recovery, real supplier/ERP layout acceptance, native-language review and large-vault supplier/export performance remain unverified. App-open progress/reminders are not recurring notifications. No new restore drill is required: control-plane schema and inventory are unchanged.

Local unit evidence (9 November 2026): node --test --test-concurrency=1 tests/*.test.js passed 78/78; node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts passed 218/218, zero skips. Earlier complete TS run found one obsolete schema-version assertion; updated to require the v16 upgrade and reject v17, retaining the check. The final suite executes the nine new supplier tests and all existing margin/legacy tier golden cases. Typecheck passed. check-migrations-lock passed 11 locked / 0 pending; check-schema passed 24 public tenant tables; check-service-role passed 237 local user-facing files. git diff --check passed. These are local results, not CI evidence.

Local browser evidence: VAULT_TEST_PORT=3106 node scripts/test-control-vault.mjs exited 0. Production worker build and Next build passed. Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 52 vault/UI checks (including suppliers and suppliersUi) and 12 local-PGlite relay checks. No privacy-marker failures. Supplier CSV/XLSX, CAD 29,500 / 590, full-grid CAD totals, frozen claim statuses, source changes, encrypted reload, rep denial, pseudo-locale and phone/theme checks passed. Screenshots/JSON remain ignored under test-results. The local sign-in is synthetic; real local-Supabase authentication is still CI-unverified. Firefox is queued for a separate controller run. Final wording-only section-description change was rechecked with the 9 i18n tests and typecheck; it will be included in the Firefox production build and CI.
