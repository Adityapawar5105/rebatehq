# Chunk 6R verification — legacy table retirement, wave 1

5 November 2026. **Local evidence; pending RebateHQ CI and a user-run Restore Drill.** The new migration stays *pending* in `migrations.lock` until both pass; then it is locked in a follow-up change. Plan: [RETIREMENT_PROPOSAL.md](./RETIREMENT_PROPOSAL.md) (approved 5 Nov 2026; blueprint section 22, items 15 and 18).

## Precondition

The user's Supabase account (organization "Adi") has **no projects** (checked 5 Nov 2026 through the Supabase connector). No hosted database holds business rows, so nothing needed a transfer or retention process. The tables existed only in disposable local and CI databases.

## What changed

**Migration** `20261105120000_chunk6r_retire_wave1.sql` (new; no locked migration edited):
- Drops **22 tables**: the 21 listed in the plan, plus `plan_feature`. Nothing reads `plan_feature` (5B's licence tables replaced it), so the plan allowed it to go.
- Drops the three functions that only served them: `convert_quantity`, `record_data_quality_issue` and `sync_product_standard_cost_history`.
- First drops the **three foreign keys** from wave-2 tables to wave-1 tables: `quote → customer`, `quote_line → product` and `quote_line → uom`. The quote rows keep their customer/product IDs as plain values until 8R. The migration stops if it does not find exactly those three keys.
- Uses no `CASCADE`, so any other unknown dependency would make it fail rather than silently drop something.
- Result: **20 public tables**. 8 are control plane (tenant, membership, invite, audit_log, and the four licence tables). 12 are wave 2: quote, quote_line, quote_share_link, approval, approval_rule, the four rebate tables, supplier_credit, alert and fx_rate.

**Server code removed:**
- The 15 retired API routes are now fixed `410 Gone` stubs with no database code. Their paths and methods are unchanged, so the HTTP boundary and the privacy gate still check every one.
- **The quote routes were retired too.** The plan kept quote tables until 8R, but these routes priced quotes from the dropped product, price-list and cost tables, so they could no longer work.
- The legacy dashboard, prices, quoting and policy pages always return "not found". The legacy data page keeps only "Disable workspace". The legacy rebates and audit pages are unchanged; they read only wave-2 or control tables and stay behind the default-off flag.
- **Deleted, 17 lib modules:** analytics, catalog-values, file-scan, import-batches, import-config, import-lifecycle and its types, import-review, ingestion, margin (server quote pricing), prototype-import, readiness, secrets, sheets-fetch, upload-archive, upload-parser and upload-types.
- **Deleted, 12 components; 4 scripts** (import-prototype, run-scheduled-ingestion, seed-demo, benchmark-import) and their package scripts. **Deleted, 8 test files** that tested only those modules.
- **Kept, pure logic:** `margin-engine.js` and its golden cases, `rebate-engine.js` and `lib/rebates.ts`, the rep-safe response guard and `quote-approval.ts`.
- **The CI step "Time a 10,000-row audited commit and undo on real Postgres" was removed.** It benchmarked the dropped server import.

**Tests and tooling reworked:**
- **pgTAP (`phase1_rls.sql`):**
  - 16 fixture tables instead of 38.
  - The plan count is now 113 fresh / 116 restore mode, from 188 / 191. Each removed check tested a dropped table or function.
  - **Representative checks were moved, not deleted:**
    - The rep auth.uid() policy probe now uses a quote the rep created, instead of a customer assigned to the rep.
    - The owner positive UPDATE and DELETE controls, the rep-cannot-delete control, the no-context probe and the anon ACL probes now use `alert` instead of customer/product.
  - `chunk5b_control.sql` now requires **exactly 20** public tenant tables, including the four licence tables (it previously required at least 42).
- **Restore tooling:**
  - The sentinel is a rebate agreement (`RESTORE-SENTINEL`). The restore seed adds a quote whose customer and product IDs point at no table.
  - The equivalence check now hashes quote, quote line and rebate agreement contents instead of invoice and ingestion evidence.
  - Table minimums are now 20 everywhere: dump inspection, repeatability, equivalence and the PGlite helpers.
  - The pgTAP restore setting is renamed `app.restore_sentinel_record_id`.
- **Schema lint:** `check-schema.mjs` subtracts tables dropped by later migrations and reports 20 live tables (22 retired).
- **Function ACL registry:** the three dropped functions were removed from it.
- **Retired-route test:** each retired handler must now be exactly `return retiredBusinessResponse();`. It is invoked with the legacy flag **on** and must still answer 410.

## Local validation

| Command | Result |
|---|---|
| `tsc --noEmit` | Passed |
| `node --test tests/*.test.js` | 75 passed (includes the full pgTAP SQL run in PGlite with stubs: 113 fresh and 116 restore-mode checks, twice each, no row residue) |
| `tsx --test tests/*.test.ts` | 116 tests: 114 passed in the full run; the 2 failures (licence API and workspace bootstrap tests still counted rows in dropped tables) were retargeted to quote, rebate and alert tables and pass on rerun |
| `check-migrations-lock` | Passed: 9 applied, 1 pending (the 6R migration) |
| `check-schema` | Passed: 20 live tables, 22 retired |
| `check-service-role` | Passed |
| New `tests/chunk6r-retirement.test.ts` | Seeds customer, product and a quote that references them, then applies 6R. Exactly the 20 expected tables remain, the quote rows keep their IDs, no foreign key points at a dropped table, the three functions are gone and every table still forces RLS. The migration refuses to run if an expected foreign key is missing |

## CI and Restore Drill

- [RebateHQ CI #72](https://github.com/Adityapawar5105/rebatehq/actions/runs/41974478845) passed on `2afefc5`. It ran 75 JS and 116 TS tests, the pgTAP suite twice on real PostgreSQL 17 (`1..113` each run, row counts unchanged), and the authenticated privacy gate.
- [Restore Drill #17](https://github.com/Adityapawar5105/rebatehq/actions/runs/41976359534) on `2afefc5` **failed** at its first function-ACL checkpoint, before any restore. `scripts/inspect-restore-function-acls.mjs` still required the two Chunk 2A functions (`convert_quantity`, `record_data_quality_issue`) that 6R dropped. CI never runs that workflow-only script.
- **Fix:** the checkpoint now prints `create_tenant_with_owner` and `record_failed_login`, two app-executable SECURITY DEFINER functions that remain. It still requires their `rebatehq_app` grant. Every application function's grants are still compared at each stage, as before.
- **Regression test:** `tests/restore-acl-checkpoints.test.js` checks that the focus functions are in the ACL registry and exist with their app grant after all migrations. A future drop now fails in CI.
- A sweep of every other script the drill calls found no other wave-1 assumption.

## Not verified yet

- **CI:** the real-Postgres pgTAP suite, the restricted-role checks and the authenticated privacy gate.
- **The user-run Restore Drill** with the new seed, sentinel and equivalence checks.
- The migration is pending, not locked, until both pass.
