# Chunk 7D — verification

## Part 1 — customer rebates (done locally in Chrome/Edge; Firefox and CI pending)

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
| Firefox local gate | Pending |
| `git diff --check` | Passed |

SQL execution coverage: v13→v14 migration including AR sidecar preservation; manual create/edit/delete, tier validation and overlap checks; staged rates/FX/date/required field validation; whole-program validation; agreement commit/rejection retention; Fix Later correction, recheck and dismissal; accrual rebuild/window allocation; raw-versus-recognized reconciliation; waterfall/math/drill and invoice differences; source removal and rollback; source-linked evidence; currency blockers and role projection. Browser tests additionally exercise actual converter staging/read_csv, encrypted snapshot open/copy-on-write/reload and source replacement. Final execution status is recorded after those gates finish.

### Remaining unverified

CI and authenticated local-Supabase privacy/relay gates remain unverified until their new run passes. Hosted/deployed auth/restore, headed/native permission UI, physical crash/quota/multi-tab recovery, native-language review, real customer contract/ERP acceptance and large-vault rebate/import latency are unverified. No new performance claim. No restore drill is needed because the server schema/inventory did not change.

## Part 2 — unstarted

Supplier claims, Purchases (PO receipts), supplier progress and claim exports are deliberately unimplemented. Start only in a separate user-authorized 7D-2 session. Legacy server rebate tables remain for retirement wave 2 (8R); none dropped here.

### Final local notes

The final Chrome/Edge production harness exited 0. It builds the self-hosted workers with disposable keys, runs production Next.js build/start, and stops its own loopback server. No fake Supabase configuration. Visual QA reviewed the Chrome phone screenshots in light and contrast themes; screenshots are git-ignored. The final complete unit rerun passed 78 JS + 191 TS, zero failures/skips. Typecheck passed. Existing MODULE_TYPELESS_PACKAGE_JSON and absent optional src/pages scan warnings were not changed.

Rebate agreement commits require an explicit terms acknowledgement in the report UI and independently in the worker, even with zero rejected rows. An attempted unacknowledged commit is tested as denied, then the same plan succeeds with confirmation. Existing Fix Later rules remain: a wholly invalid batch cannot commit; correct/re-upload it or include it with valid batch rows before retaining rejections. The mixed-format browser fixture proves old six-column terms are retained as rejected without activating partial programs.

Concurrent user commit edb77c3 advanced AGENTS/BLUEPRINT to v2.5 during this task; preserved unchanged. This attached prompt explicitly authorizes 7D-1 under v2.4. Selection aggregates, row notes and universal column filter/sort are **not implemented or verified by 7D-1** and require a separately scoped follow-up. No blueprint edit made by this chunk.
