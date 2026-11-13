# Legacy business-table retirement — approved plan

**Approved by the user on 5 November 2026, with revisions.** Approval schedules
the work; it does not drop anything by itself. Each wave runs only when its
chunk (6R, 8R in `BLUEPRINT_EXECUTION_PLAN.md`) is explicitly prompted. Locked
migrations are never edited: every drop is a NEW reviewed migration that goes
through CI and a user-run Restore Drill before it is locked.

## Facts this plan rests on (checked 5 November 2026)

- No hosted database holds business data. The user's Supabase account has no
  projects, and the workspace has no managed project or production credentials
  (README). The legacy tables exist only in disposable local and CI databases.
- The class C rule (`ARCHITECTURE_TRANSITION.md`, blueprint decision 10): a
  server table is retired only after its local equivalent exists in the vault.
- About 47 code and test files still use the legacy tables. The largest are
  `supabase/tests/phase1_rls.sql` (~287 references), the fixture-builder and
  chunk 2A tests, the import-lifecycle/ingestion modules, the CI real-Postgres
  10,000-row import benchmark, and the Restore Drill seed/inventory (which
  expects at least 42 tables).

## Kept (control plane)

tenant, membership, invite, audit_log, workspace_licence, licence_seat,
licence_location, licence_device, and the private `rebatehq_private.actor_key`
with its rotation/restore process. plan_feature is superseded by the licence
tables; wave 1 may drop it after confirming nothing reads it.

## Wave 1 — chunk 6R (after 6A, before 6B)

21 tables whose local equivalents already exist (4B–5A): customer,
customer_group, product, uom, uom_conversion, cost_history, cost_component,
price_list, price_list_version, price_list_item, customer_price, margin_policy,
invoice, invoice_line, sales_order, margin_snapshot, data_quality_issue,
import_job, column_mapping_template, connector_secret, connector_sync_run.

1. **Precondition:** re-check that no hosted project holds business rows. If one
   does, stop: agree retention/consent and a one-time local transfer with each
   data owner and verify reconciliation and encrypted backups first. Otherwise
   there is nothing to transfer.
2. Review FK dependencies, triggers and functions that touch these tables.
   Write one new migration that drops them and their functions/policies.
3. Remove the database-bound code that only served them: legacy class C/X
   routes and pages, `prototype-import`, ingestion and connector-secret modules,
   and the matching tests. **Keep pure logic** and its golden cases: the margin
   engine, `rebate-engine.js`, rebate tier maths and the rep-safe quote
   projection (ported later in 7B/7D).
4. Rework the pgTAP suite, fixture graph, restore seed/sentinel, restore
   inventory minimum and the CI import benchmark for the smaller schema. Update
   counts honestly; never weaken a remaining check.
5. Existing `audit_log` rows are disposable test data, so no audit retention
   process is needed. If a hosted project exists by then, its historical
   business snapshots need an approved retention process first.
6. Done when CI and a user-run Restore Drill pass and the migration is locked.

**Wave 1 status (5 Nov 2026): done.** Chunk 6R is CI-verified in [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715) and [Restore Drill #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868) on `8a34e06`; its migration is locked. 22 tables dropped (the 21 above plus `plan_feature`, which nothing read). The `quote`/`quote_line` foreign keys to customer, product and uom were dropped so the wave-2 rows could stay; the legacy quote API routes were retired with wave 1 because they priced quotes from the dropped tables. See [CHUNK_6R_VERIFICATION.md](./CHUNK_6R_VERIFICATION.md) and blueprint section 22, item 18.

## Wave 2 — chunk 8R (after 7A, 7B, 7D and 8B)

12 tables with no local equivalent yet: quote, quote_line, quote_share_link,
approval, approval_rule (7A/7B), rebate_agreement, rebate_progress,
rebate_tier, rebate_entry, supplier_credit (7D), alert (8B), and fx_rate (once a
local FX table exists or is confirmed unnecessary). Same precondition, review
and verification steps as wave 1.

**Wave 2 status (13 Nov 2026): built; pending CI and the user-run Restore Drill.** Chunk 8R drops all 12 tables in `20261113120000_chunk8r_retire_wave2.sql`, which stays under `pendingMigrations` until both pass. Every table now has a CI-verified local equivalent, so "no local equivalent yet" no longer holds. `fx_rate` goes because the vault has kept per-workspace exchange rates since 7C-3a. The server keeps 13 control-plane tables. See [CHUNK_8R_VERIFICATION.md](./CHUNK_8R_VERIFICATION.md) and blueprint section 22, item 29.

No 6A work is included in this document.
