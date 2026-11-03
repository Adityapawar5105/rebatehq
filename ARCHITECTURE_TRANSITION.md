# Architecture transition map (chunk 4.0)

*2 Nov 2026. Baseline: commit `c943956` (repo Phases 0–3 verified in CI #39 and Restore Drill #13). Governs nothing on its own: `BLUEPRINT.md` v2.2 section 4 sets the target. This file answers blueprint open question 3.*

Repo Phases 0–3 were built before the blueprint. They put customer pricing data in multi-tenant Supabase/Postgres. Blueprint v2.2 keeps that data in the browser (DuckDB-Wasm in a Web Worker, encrypted OPFS). The server keeps only identity, licences/seats, public index data, app updates and a ciphertext-only relay.

## Classes

| Class | Meaning | When it changes |
|---|---|---|
| **A — Control plane, keep** | Identity, workspaces, membership, invites, sessions, rate limiting, auth audit, ops tooling | Stays; extended with licences in 5B |
| **B — Port to the browser** | Pure or mostly pure logic worth reusing in the worker; node/pg dependencies must be replaced | Ported in the chunk named |
| **C — Retire after the local equivalent exists** | Server routes, pages and tables that read or write customer business data | Disabled behind a default-off flag in 5B; tables retired only by a later reviewed migration with user approval |
| **D — Legacy prototype** | The original static localStorage app | Kept in place for now (see "Legacy files") |
| **X — Dropped** | Conflicts with local-first; not ported | Disabled in 5B (blueprint v2.2 §6 "Deferred or dropped") |

Nothing is deleted, and no migration or `migrations.lock` entry changes, in chunk 4.0.

---

## API routes (`app/api`)

| Route | Class | Notes / local replacement |
|---|---|---|
| `auth/login`, `auth/logout`, `app/auth/callback` | A | Supabase magic link; keep. Failed-login fixes carried to 5B |
| `health` | A | Keep |
| `tenants`, `tenant/switch` | A | Workspaces; keep |
| `tenant/delete` | A | Keep for workspace deletion; scope shrinks to control-plane rows after 5B |
| `invites`, `users`, `users/[userId]` | A | Seats feed licence limits in 5B |
| `dev/impersonate`, `dev/impersonate/stop` | A (dev only) | Must stay disabled in production |
| `audit` | A + C | Auth/workspace events stay server-side; business-change audit moves to the local hash-chained `audit_log` (4B) |
| `tenant/export` | C | Exports server business data; replaced by local encrypted export/backup (4E) |
| `products`, `customers`, `search` | C | Local vault queries (4B/4C); global search runs in the worker |
| `policy` (margin_policy) | C | Local `price_guardrails` (4E) |
| `import-preview`, `imports/preview`, `imports`, `mapping-templates` | C | Import Studio + converter recipes in the browser (4C) |
| `prototype-import` | C | One-time migration path from the static prototype; no longer needed |
| `quotes`, `quotes/[quoteId]/decision`, `quotes/[quoteId]/send` | C | Quote Desk in Phase 2 (7B), approvals via the relay (7A) |
| `ingestion` | X | Server-side Sheets/email/SFTP ingestion; dropped in v2.2 |
| `connectors` | X | Stored connector credentials; CRM connectors deferred to pilots |

## Pages (`app`)

| Page | Class | Notes |
|---|---|---|
| `login`, `setup`, `invite/[token]`, `page.tsx` (redirect) | A | Keep; setup gains "name the Pricing Owner" (5A) |
| `account/users`, `account/workspace` | A | Workspace connector form (ConnectorSecretForm) is X |
| `account/dev` | A (dev only) | |
| `account/audit` | A + C | Auth events only after 5B |
| `account/data` | C | Prototype import, server export → local backup/restore (4E) |
| `account/policy` | C | → Pricing › Guardrails (4E) |
| `dashboard` | C | → Home / Margin, local queries (4D) |
| `prices` | C | → Data Hub › Import Studio (4C) |
| `quoting` | C | → Quotes (7B) |
| `rebates` | C | → Rebates & Contracts (7D) |

## Library modules (`lib`)

| Module | Class | Port target / node-only dependencies to replace |
|---|---|---|
| `supabase/server.ts`, `session.ts`, `context.ts`, `authz.ts`, `permissions.ts`, `impersonation.ts`, `rate-limit.ts`, `request.ts`, `secure-logger.ts`, `db.ts`, `audit.ts` | A | Keep. `permissions.ts` role model also informs local role views (5A) |
| `validators.ts` | A + B | zod schemas; auth/workspace ones stay, business ones port |
| `csv.ts` | B → 4C | Formula-injection neutralising for exports; no dependencies |
| `upload-types.ts`, `import-config.ts` | B → 4C | Limits rescaled to blueprint §5 tier caps |
| `upload-archive.ts` | B → 4C | XLSX ZIP/XML safety (zip-bomb, entities, external links). Replace `node:zlib` with `DecompressionStream`/fflate; `HttpError` → worker error type. May be superseded by SheetJS for parsing, but the safety checks carry over |
| `upload-parser.ts` | B → 4C | Delimiter/BOM/decimal detection, header detection, mapping suggestions, issue model. Replace `node:crypto` (→ WebCrypto), `node:path`, `HttpError` |
| `import-lifecycle.ts`, `import-batches.ts`, `import-lifecycle-types.ts` | B → 4E | Diff, three-way conflict, exact undo ideas → change preview and versions. `pg`/`node:crypto` replaced by DuckDB SQL + WebCrypto |
| `import-review.ts` | B → 4C | Review/issue staging → Fix Later queue |
| `readiness.ts` | B → 4C | Visible equal-weight formula → data health score; SQL ported to DuckDB |
| `margin-engine.ts` + root `margin-engine.js` | B → 4D | Single margin engine; port to decimal arithmetic, keep all golden cases |
| `margin.ts`, `analytics.ts` | B → 4D | Snapshot/dashboard aggregation logic → DuckDB pre-aggregates; `pg` replaced |
| `catalog-values.ts` | B → 4C/4D | Current dated cost/price lookup → local SQL |
| `rebates.ts` + root `rebate-engine.js` | B → 7D | Tier maths (retroactive/incremental) for the customer rebate engine |
| `quote-approval.ts`, `rep-response.ts` | B → 7B | Rep-safe projection (no cost fields) also used for rep views in 5A |
| `prototype-import.ts` | C | No longer needed after local vault exists |
| `ingestion.ts`, `sheets-fetch.ts` | X | Dropped (server fetches business data) |
| `secrets.ts` | X | Connector credential encryption; dropped with connectors |
| `file-scan.ts` | X | Malware-scan hook for server-stored uploads; local files never reach the server |

## Components (`components`)

- **A:** AppFrame (navigation is rebuilt to the blueprint §9 screen map in 4B), LoginForm, CreateTenantForm, TenantSwitcher, InviteForm, UsersPanel, DeleteTenantForm, AuditViewer, DevImpersonationForm.
- **C:** DataReadiness, ImportActions, ImportHistory, ImportWizard, ImportWorkspace, SourceIssues, MarginPolicyForm, PrototypeImportForm, QuoteForm, QuotesPanel, TenantExportButton, GlobalSearch. Their UX patterns (three-step review, paged issues, conflict choices) are reused in the local UI.
- **X:** ConnectorSecretForm, IngestionPanel.

## Scripts (`scripts`)

- **A (keep):** check-migrations-lock, update-migrations-lock, check-schema, check-service-role, check-app-db-role, setup-test-app-role, test-db, test-db-repeatability, all restore-drill scripts, tenant-row-counts, purge-deleted-tenants, load-db-test-sql.
- **C:** seed-demo (server demo tenant; replaced by the local Playground in 4C-2), import-prototype, benchmark-import (server import timing; replaced by browser timings in 4A/4B), build-upload-fixture (fixtures stay useful for 4C tests).
- **X:** run-scheduled-ingestion.

## Database tables (38, all in locked migrations)

| Table(s) | Class | Local counterpart (blueprint §10) |
|---|---|---|
| tenant, membership, invite | A | — (workspace, seats) |
| audit_log | A + C | Server: auth/workspace events. Business events → local hash-chained `audit_log` |
| plan_feature | A (superseded) | Replaced by authoritative licence/tier tables in 5B (new migration) |
| customer, customer_group | C | `customers` |
| product, uom, uom_conversion | C | `products` (uom), item-master cleanup (5A) |
| cost_history, cost_component | C | `vendor_costs`, `cost_basis_settings` |
| price_list, price_list_version, price_list_item, customer_price | C | `price_matrix`, `price_versions` |
| margin_policy | C | `price_guardrails` |
| approval_rule | C | Local approval thresholds; two-level approvals via relay (7A) |
| invoice, invoice_line, sales_order | C | `sales_lines` |
| margin_snapshot, alert | C | Local pre-aggregates; Alerts & Agents (8B) |
| fx_rate | C | Local FX table; a public FX feed may later come from the control plane as index data |
| data_quality_issue, import_job | C | `import_issues`, `import_batches`, `source_files` |
| column_mapping_template | C | `converter_recipes` |
| quote, quote_line, approval, quote_share_link | C | `quotes`, `quote_lines` (7B); sharing via ciphertext relay (7A) |
| rebate_agreement, rebate_progress, rebate_tier, rebate_entry, supplier_credit | C | `rebate_programs`, `rebate_accruals`, `supplier_claims` (7D) |
| connector_secret, connector_sync_run | X | — |

Retiring any table needs a NEW migration, a restore-inventory update and the user's explicit approval (MIGRATION_RULES.md). Until then the tables stay, protected by the existing RLS and tests.

## Legacy files

`app.js`, `index.html`, `seed.js`, `schema.sql`, `seed_data.json`, `demo_*.csv`, `demo_script.md` stay at the repository root for now because live code depends on them:

- `tests/margin-engine.test.js` loads `seed.js` (golden cases such as SO-8102 come from it).
- `scripts/check-service-role.mjs` scans `index.html`, `app.js` and `seed.js` by root path.
- `seed_data.json` feeds `tests/chunk2a-*.test.*`, `tests/pricing-rebates.test.js`, `tests/chunk3c-restore.test.ts`, `tests/security-foundation.test.ts` and `scripts/seed-demo.ts`.
- `README.md` documents `schema.sql` as a mirror of the Phase 1 migration.

Plan: when 4C-2 creates the Playground generator and 4D moves the golden cases to the decimal engine, move these files into `legacy/` and update those paths in the same change.

## Progress notes

- **Chunk 4C-1 (3 Nov 2026):** the browser Import Studio lives in `lib/studio/`. It was written fresh for the worker (streaming tokenizer, SheetJS, exact DuckDB validation) instead of porting `lib/upload-parser.ts`/`upload-archive.ts` line by line. The server modules keep the same safety rules: no formula evaluation, macro/ZIP/XML-entity protections, formula-safe CSV via the shared `lib/csv.ts`. The server import routes stay class C until 5B retires them.

## Known discrepancies recorded (not fixed here)

- Blueprint v2.1 §2/§17 said "Phase 4 pocket-margin engine in progress"; it had not started. Corrected in blueprint v2.2.
- `margin-engine.js` uses JavaScript floats; blueprint rule 5 requires integer/decimal money. Fixed in 4D.
- `next.config.ts` sets COOP but not COEP; multi-threaded DuckDB needs both. Addressed in 4A.
- Phase 1 security items still open (audit actor GUC trust, `record_failed_login` input bounds, DB-side failed-login rate limit). They stay relevant because auth remains server-side; scheduled for 5B.
