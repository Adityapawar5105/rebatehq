# Chunk 7C verification — part 1

7 November 2026. Scope: **7C-1, items 1–5 only**. Part 2 is not started.
Status: **7C-1 CI-verified** in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`. Chrome and Edge local harnesses pass. No Supabase
migration or restore-inventory change; all 11 applied migrations and
`migrations.lock` remain unchanged. No Restore Drill is required for this local
data-plane change. Blueprint unchanged.

## What changed

- Worker-only exact-cent month-over-month margin bridge, with product/customer/
  branch drill and unknown-cost counts. The method and rounding are documented
  in `ASSUMPTIONS.md`; the four effects reconcile exactly, including credits,
  new/lost cells and zero net quantities. This is sequential attribution, not a
  causal forecast or a unit-normalization engine.
- Price-version reversal and segment increase drafts reuse `rule_runs`,
  `rule_changes`, `price_versions`, the current guardrails, revision/date checks,
  named Pricing Owner approval and audited export. Nothing changes on draft.
- Local schema v11 adds `price_changesets` and `price_changeset_rows` (37 tables).
  The committed encrypted v1 fixture and immutable v1–v10 schema definitions stay.
- Customer drafts retain contract end dates and tier specificity; quantity-break
  schedules remain unchanged. Customer-specific ERP exports require the generic
  layout with `customer_id`; unsupported layouts fail instead of dropping scope.
- Shared deterministic matrix lookup for Quote Desk, planner and dated contract
  comparisons. Exceptions include source file/row and count the higher gap once.
- Contract expiry for 30/60/90 days, with exclusive-end-date copy and no renewals.
- Localized, cost-free draft increase letters as UTF-8 text downloads.
- New screens use 7V components and theme tokens, message keys in en/es/fr
  (fr-CA inherits), read-only/mutation protocol classifications, and worker-side
  tier/capability gates. Reps cannot call any new command.

## Done when

| Criterion | Evidence/status |
|---|---|
| Exact bridge and reconciling drills | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (DuckDB-Wasm golden tests) |
| Reversal through current guardrails, owner approval and export | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (unit and browser flows); Chrome/Edge also pass |
| Customer/tier/category impact and contract preservation | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (unit tests) |
| Dated/quantity-break exceptions, no duplicate gaps, source rows | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (unit tests) |
| 30/60/90-day expiry edges | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (unit tests) |
| Translated cost-free letter | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (French/Spanish unit tests, browser download); Chrome/Edge also pass |
| Old schemas/fixture, margin goldens and rep hiding preserved | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) (239 unit tests and browser flows) |
| Privacy gate and pseudo walk include all new views | Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986); Chrome/Edge also pass |
| Part 1 committed, pushed and green before part 2 | `aecfa32`, [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) green; 7C-2 not started |

## Command ledger

Commands run in the repository root. Inspection used `git status --short`,
`git diff --stat`, `Get-Content`, `rg` and `Get-Command`; only the existing
untracked `.claude/` was present initially and it is untouched. `Get-Content`
for the nonexistent `lib/quotes/pricing.ts` was corrected to the owning
`lib/quotes/quotes.ts`. The first scripted edit via `python` could not start the
WindowsApps alias and made no changes; subsequent scripted edits used Node.

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | Passed after fixing the shared lookup's inferred row type |
| `node --test tests/*.test.js`; final `node --test --test-concurrency=1 tests/*.test.js` | 78 passed. A concurrent run with the TS suite/build exhausted process memory; the serialized rerun passed without assertion changes |
| `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts` | 161 passed (adds seven 7C-1 tests) |
| `node scripts/check-migrations-lock.mjs` | Passed: 11 applied, 0 pending |
| Targeted `tsx --test tests/pricing-ops.test.ts tests/quotes.test.ts tests/i18n.test.ts` | SQL/parser and unused-key findings fixed; populated-book and transaction regressions pass |
| `node scripts/test-control-vault.mjs --browser=chrome` | Production build passes. Earlier attempts found a stale localhost listener, missing table accessible names, a select locator, and a real 512 MiB bulk lookup failure. Fixed; Chrome and Edge passed: 39 named checks and 11 local relay checks each |

SQL was executed against **the actual pinned DuckDB-Wasm engine**, the owner of
these local tables, rather than Postgres's different SQL dialect. New v11 DDL,
bridge CTEs, all three segment paths, draft/reversal statements, guardrail and
conflict checks, approval updates/inserts, export queries, dated/break exception
queries and expiry paths were exercised. Bulk pricing uses the same policy and tie-breaks as scalar Quote Desk lookup, with equality joins and staged inputs instead of a decorrelated LATERAL expansion. A 100k-line/20k-price regression exercises narrow and 20,002-pair drafts, approval and reversal under the unchanged 512 MiB limit. Supabase SQL and pgTAP logic are unchanged.
Local test logs stay under git-ignored `test-results/` and are not CI evidence.

Additional commands/diagnostics:

- `node scripts/check-schema.mjs`: passed (24 live tenant tables, duplicate/RLS gates).
- `node scripts/check-service-role.mjs`: passed (212 files; src/pages absent warnings are expected).
- `node scripts/build-spike.mjs` and `node node_modules/next/dist/bin/next build`: run by each production browser launcher; latest build passed.
- `tsx --test --test-concurrency=1 tests/pricing-ops.test.ts tests/quotes.test.ts`: 15 passed; targeted ops/i18n also passed. The browser worker regression exercises genuine encrypted save/reopen and audit, in addition to Node transactions.
- `node test-results/7c-debug-next.mjs`: confirmed the same build served valid assets on 127.0.0.1:3102 while localhost:3100 returned old asset URLs. The diagnostic is ignored and not shipped.
- Removed only the resolved, ignored repository `.next` cache with PowerShell; this did not fix the stale listener, so the launcher was corrected to its bound IPv4 address. Read-only CIM process inspection was unavailable.
- Temporary synthetic-only worker diagnostics identified the DuckDB memory error and were removed. No production error details were exposed and no assertions were weakened.
- `git diff --check`: passed; CRLF warnings for existing TSX/CSS attributes only. `git diff --name-only -- supabase/migrations migrations.lock pnpm-lock.yaml`: empty.

## Unverified

- Hosted sign-in/deployment remains unverified. Authenticated local-Supabase
  behavior is verified by [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986); the local Chrome/Edge harnesses use synthetic
  identity and do not independently prove authentication.
- Hosted sign-in/deployment, real customer contracts/ERP layouts and pilot results.
- Native-speaker review, manual screen-reader testing and physical crash/quota/
  multi-tab behavior. Existing recovery evidence retains its original scope.
- Bridge and planner performance at 1M/2M lines; no new timing target is claimed.
- Full historical book restoration: a reversal restores that version's changed
  amounts, with current approval and today's date, not a whole-vault snapshot.
- 7C-2 (competitor log, editable grid, sliders, new leaks and landed check) is not
  implemented and must start in a new session after a green part-1 CI run.

## Local browser evidence

Headless Chrome 156.0.8078.80 on this machine (Ryzen 5 5600H, 7.89 GB reported RAM,
Windows 11 build 26200): 39 named vault checks pass, including pricingOps (real
worker transaction/audit/encrypted reload), pricingOpsUi (10 flags), the existing
margin/Playground goldens, privacy, pseudo walk and light/dark desktop/phone layout.
The relay harness passes 11 checks using its local PGlite transport; authenticated
Supabase remains CI-only evidence. This is not a headed manual review.

The six ignored local Chrome screenshots are 7c-chrome-{bridge,planner,versions,exceptions,
expiry,versions-dark-mobile}.png in test-results/. Planner and dark mobile versions
were visually inspected, along with the Edge exception and expiry screens; no
layout issue was found. Edge 156.0.4314.58 also passed all 39 named checks and its
11-check local relay harness on the same machine.

## Files changed

- Logic: lib/margin/bridge.ts; lib/pricing/{book,ops,rules}.ts; lib/quotes/quotes.ts.
- Worker boundary/schema: lib/vault/{schema,service,dispatch,protocol,licence}.ts;
  lib/roles/access.ts.
- UI/translations: components/local/{PricingOps,PricingView,MarginView,VaultApp}.tsx;
  components/ui/{ui.tsx,ui.module.css}; lib/i18n/locales/{en,es,fr}.ts.
- Tests/launcher: tests/pricing-ops.test.ts, tests/vault.test.ts,
  tests/browser/vault-worker.ts, scripts/test-{vault-browser,control-vault}.mjs.
- Docs: this record, ASSUMPTIONS.md, README.md, AGENTS.md, CODEX_HANDOFF.md,
  BLUEPRINT_EXECUTION_PLAN.md. Blueprint unchanged.

## CI evidence and close-out

Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986), code commit `aecfa3214132d017ec595696cb5919b1733e2edb`,
7 November 2026 in Asia/Kolkata (6 November UTC). The job is green. The required
**authenticated local-vault privacy gate ran, was not skipped, and passed 41 named
checks** (Chromium 156.0.8078.4, auth=true), including pricingOps, pricingOpsUi,
privacy, uiLayout and i18nUi. Its separate real-authenticated local-Supabase relay
harness passed 11 checks. The new UI check has 10 flags covering bridge identity,
branch drill, planner, letter, owner approval, reversal draft/export, exception
source rows, expiry and unchanged invoice counts.

The same run passed frozen-lockfile installation, dependency audit, typecheck,
78 JS + 161 TS tests, production build, all 11 applied hashes, runtime role/no-context
checks, and the 152-check fresh pgTAP suite twice with no residue. No restore
workflow was run; Supabase objects and inventory did not change. This does not
prove hosted behavior, native translation quality or real ERP compatibility.

Git commands: `git add -- <the 31 listed files>`, `git diff --cached --check`,
`git diff --cached --stat`, and the protected-path staged diff passed.
`git commit -F test-results/7c-commit.txt` created `aecfa32`.
`git push origin main` initially hit sandbox DNS restrictions; the approved
outside-sandbox retry succeeded. `git status --short` then showed only the
pre-existing, untouched, untracked .claude/ directory. GitHub job/step/log tools
confirmed the result; live job logs were unavailable until completion. No CI fix
attempt was needed.

This close-out changes documentation only. Its commit/push and follow-up CI result
will be reported in the final reply. Blueprint unchanged; stop before 7C-2.
