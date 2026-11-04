# RebateHQ project direction

## Governing blueprint

Read `BLUEPRINT.md` before planning or implementing RebateHQ work. It is the
user-approved **RebateHQ Blueprint v2.2**: v2.1 (Final) was adopted by the user on
2 November 2026, and v2.2 corrections were made on 2 November 2026 with the
user's standing permission and are listed in its section 22. It supersedes earlier
product plans where they conflict. Later explicit user instructions still take
precedence. Any later blueprint edit must add an entry to that changes section and
be reported to the user.

`BLUEPRINT_EXECUTION_PLAN.md` sequences the work into repo chunks (4.0, 4A-4E,
5A-5B, 6A-6B, 7A-7F, 8A-8D) with a standard preamble and "Done when" criteria.
`ARCHITECTURE_TRANSITION.md` classifies every existing route, module and table
as control plane, logic to port to the browser, server path to retire, or legacy.

Key decisions:

- Target wholesale distributors with 50–300 employees.
- Use a hybrid local-first architecture: pricing, costs, invoices, rules,
  simulations and margin data stay on the user's device. The target engine is
  DuckDB-Wasm in a Web Worker, with encrypted OPFS persistence.
- Keep the cloud control plane limited to identity, licences/seats, public index
  data, app updates and a ciphertext-only collaboration relay. Supabase is not
  the target store for customer pricing data.
- Support Chrome and Edge, persistent-storage requests, folder auto-backups and
  an encrypted export fallback. Use decimal/integer money, streaming imports,
  versioned vault migrations and the blueprint's capacity/memory guardrails.
- Launch with local multi-file conversion/import and ERP-ready file exports.
  CRM connectors are deferred until pilots request them. Preview corrections and
  preserve issue/source tracking; never evaluate workbook formulas or macros.
- Require a named Pricing Owner and cap approvals at two levels (single-level
  Pricing Owner approval in Phase 1).
- No "data never leaves your device" claim until the CI privacy gate passes.
- Follow the exact tier limits, feature placement, roadmap and evidence rules in
  the full blueprint. Capacity/performance numbers and marketing promises are
  targets, not verified product capabilities.

## Product name

The product was renamed from MarginDesk to **RebateHQ** on 4 Nov 2026 (blueprint
section 22, items 13-14) because margindesk.ai already trades under that name.
The old name intentionally remains only in applied migrations (which still create
`margindesk_app`; migration `20261104120000_rename_app_role_to_rebatehq.sql`
renames it to `rebatehq_app` and passed CI #57, but stays pending in
`migrations.lock` until a Restore Drill passes), `schema.sql`, and past CI/restore
evidence lines. The GitHub repo is now `rebatehq`. Browser storage keys were renamed
with a carry-forward from the legacy keys; vaults saved before the rename stay in
the legacy OPFS folder `margindesk-vaults` (Chromium cannot rename OPFS directories)
and are opened in place. Do not edit applied migrations. `tests/brand-name.test.js`
fails if the old name appears outside those legacy bridges and past-evidence
records; add a file to its `LEGACY_FILES` only for a deliberate bridge.

## Existing implementation and task scope

The completed repository Phases 0–3 are the earlier backend foundation. The
blueprint's product-roadmap phases are a separate sequence; do not rename past
verification evidence or assume planned features already exist. Current code
still has server-side business-data paths, so do not describe it as having
achieved the blueprint's local-only privacy boundary before that is implemented
and tested.

Keep all applied migrations and their locked hashes unchanged. Follow
`MIGRATION_RULES.md`, preserve validated margin-engine golden cases and security
gates, and distinguish local checks from passing CI/restore evidence.

Do only the chunk the user's current prompt names; never start the next chunk on
your own. Chunks 4.0, 4A, 4B and 4C-1 are done and CI-verified (4C-1: CI #48,
`ea4e5b6`). 4C-2 (ERP mapper, resilient parser, Fix Later, health score,
Playground) is done and CI-verified (CI #51, `a9ca8f7`). 4D (decimal
pocket-margin engine, reconciliation, show-the-math, leak finder, Leak Report,
ROI v1, credits; vault schema v5) is done and CI-verified (CI #53, `6d21cf0`);
its leak finder reproduces `tests/fixtures/playground-manifest.json` exactly.
4E (guardrails, versioned rules, preview, owner approval, ERP export, encrypted backup/restore; vault v6) is done and CI-verified in [CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), commit `7fe3db8` (163 unit tests, 25 named authenticated privacy checks). Local timings and real ERP/picker limits are in `CHUNK_4E_VERIFICATION.md`. The next chunk is 5A; do not start it without an explicit user prompt. Real-export files stay
in git-ignored `test-results/real/` and are never committed.
