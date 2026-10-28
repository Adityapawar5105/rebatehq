# Phase 0 assumptions

- Phase 0 keeps the existing static browser app and localStorage model. Multi-tenant authentication, APIs, and hosted persistence are outside this phase.
- Customer-tier price is used for order and quote calculations when present; otherwise the product list price is used.
- An accessory field is a dollar add-on for the whole quote line. It is included in the discount and rebate bases. No separate accessory cost exists in the current model, so accessory COGS is not inferred.
- Order freight and payment-term costs use order-level per-unit values when present. Quotes and catalog margin use product-level per-unit freight and terms.
- Monthly snapshots aggregate calculated source orders by company, product, and customer. Trend compares the two latest stored months; fewer than two monthly snapshots displays “Not enough history.”
- Existing localStorage `priorMargin` values are legacy synthetic inputs and are removed. If no saved snapshots exist, snapshots are built from that browser’s existing orders, customers, and products using the shared engine.
- Seed monthly snapshots are generated from the synthetic order fixtures with the same engine used by the app and tests. They are not a claim of customer history.
- Calculations retain full precision; currency and percentages are rounded only for display.

# Phase 1 assumptions

- Supabase Auth supplies verified email magic links. Accounts may be created by email verification, but no account is added to an existing tenant without an invitation that matches the verified email.
- A user may create a new workspace only after verification. An owner creates invitations; roles are owner, manager, analyst, and rep.
- The app connects through a dedicated PostgreSQL login that can assume `margindesk_app`, which is `NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`. No user-facing route uses a service-role or bypass key. Browser roles have no direct grants on business tables.
- Every public business table, including the tenant root and child tables, carries `tenant_id`, has a tenant-scoped index, and uses forced row-level security. The append-only audit table has a nullable `tenant_id` and no tenant foreign key so auth events and retention records can survive business-data purge.
- Rep access is limited to assigned customers and own quotes. Rep API responses omit cost values, margin dollars, and cost components; quote guardrails return zone and headroom.
- Manager and owner approvals are recalculated against current product costs and policy version. The quote creator cannot decide their own approval. Red-zone quotes cannot be created, sent, or approved.
- The unchanged Phase 0 `margin-engine.js` is the single calculation engine for app/server paths. It is loaded server-side for quote calculations and rederived prototype history.
- Prototype imports accept a JSON export of the local browser model, capped at 2 MB, validated before a single-use dry-run/commit process. Existing imported quote math and snapshots are treated as untrusted and recomputed. Demo user identities are not migrated.
- The import transfers workspace rows (not a local browser role), creates an initial price-list version, and retains the destination tenant’s membership. Connector credentials are never imported or included in exports.
- Connector credentials are encrypted in the app with AES-256-GCM using a server-only 32-byte key. The key is stored outside the database and must be backed up separately; losing it requires reauthorization.
- Invite links expire after seven days and are single-use. Auth session refresh and expiry are managed by Supabase Auth; logout requests global session invalidation.
- Unsafe API requests are rejected when their supplied Origin is cross-origin. APIs use strict schema validation, limited upload body sizes, same-origin browser requests, and distributed rate limiting in production.
- Tenant deletion is soft-disabled immediately, retains business records for 30 days for recovery, then the privileged purge script removes tenant-linked business data. Append-only audit entries have no tenant FK and remain retained independently.
- Audit rows store request IP and user agent when provided by the hosting proxy. Audit before/after values are treated as confidential and owner/manager-only.
- The production website is Next.js App Router hosted on Vercel, with isolated Supabase and Upstash projects per development, staging, and production environment.
- Local Supabase migration/RLS tests run in CI through Docker. Local-target logical restore is verified by Restore Drill #10. Hosted-target restore and Supabase-managed backup/PITR recovery remain unverified.

# Chunk 2A assumptions

- Chunk 2A is limited to cost history, units of measure, currency and FX data, data-quality issues, safe temporal keys/backfills, and the tests and restore inventory required for those changes. No Chunk 2B work is started.
- `tenant.currency` is the display and default transaction currency. The current UI remains single-currency; transaction currency selection stays disabled. Currency codes are uppercase ISO-4217-style three-letter codes. Existing amounts without a currency inherit their tenant or parent transaction currency during backfill.
- Legacy `product.unit_cost` is treated as a `standard` cost in the tenant currency and becomes effective on the migration date. Historical transactions earlier than that date have no invented cost; the engine reports and records a cost-history gap instead of treating it as zero.
- Product cost changes create a new `standard` cost-history interval effective on the database date of the change. Same-day edits replace that date's standard cost entry. Other bases (`average` and `landed`) require explicit history rows before a tenant selects them as its default.
- `effective_to` is an exclusive date boundary. An open `effective_to` means the interval continues indefinitely. Both cost and price-list ranges are non-overlapping. Existing price-list rows retain their surrogate `id`; legacy open-ended rows are closed at the next later effective start when that start is unambiguous. Same-day duplicates or conflicting explicit intervals make the migration fail rather than silently pick a winner.
- A quantity that omits both source and target UOM is not assumed to be `EA`; conversion requires a known source and product/base unit. An absent conversion records a `uom_conversion_missing` issue and returns no quantity. Conversions round to four decimal places, matching stored quantity precision.
- FX lookup uses the latest direct rate on or before the transaction date, then the inverse rate if no direct rate exists. It does not triangulate currencies. Missing rates record an `fx_rate_missing` issue and invalidate that margin calculation.
- Money, costs, quantities, and FX rates are stored as PostgreSQL `numeric`; percentage fields retain the existing engine's 0–100 unit. The JavaScript engine continues accepting numeric values and rounds only converted quantities/currency amounts to four decimal places for the database's numeric scale.
- `btree_gist` is installed in the existing Supabase `extensions` schema and used only for exclusion constraints; the migration does not grant or revoke privileges on that Supabase-managed schema. If the supported stack cannot install it there, the migration must use an equivalent concurrency-safe constraint trigger and document the reason before merging.
- Price-list items already have a surrogate UUID primary key and effective-date columns in the locked Phase 1 schema. Chunk 2A preserves that key and adds the missing range backfill/overlap guarantee rather than trying to replace the key a second time.
- Existing Phase 1 catalog and transaction amounts used the tenant currency in the UI. Their currency fields are backfilled from the tenant or parent transaction before the cost history and UOM rows are created; new write paths pass the currency explicitly. The current UI does not offer transaction-currency selection, while the shared engine and stored transaction model handle dated FX conversion.
- The application sets `tenant.default_cost_basis` to `standard` by default. `average` or `landed` must be explicitly selected only after the tenant has populated non-overlapping history for that basis; missing dated cost or FX never falls back to zero or a different basis.
- The product cost-history trigger is `SECURITY DEFINER` with `search_path=public,pg_temp`, owned by the migration role, and executable only by its owner. It needs `auth.uid()` while recording the actor, but the app role intentionally has no `auth` schema USAGE; the trigger context is the only supported write path for automatic standard-cost history.
- The restore inventory derives every non-extension table in `public` from the source dump and compares every public function and ACL on source and restored databases. The expected minimum is now 29 tenant tables; the migration linter and repeatability/RLS fixtures fail if inventory coverage falls below that value.
- PGlite runs the actual locked Phase 1 migration, the locked Chunk 2A migration, and the complete current pgTAP SQL with local auth/role/pgTAP stubs. It exercises fresh and populated/restore-mode paths, but it is not a substitute for a real Supabase/Postgres CI run.

# Restore Drill #9 completion assumptions — 2026-10-28

- The #9 failure is historical. The corrected local-target procedure is verified by [MarginDesk CI #27](https://github.com/Adityapawar5105/margindesk/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`. Hosted-target restore, managed backup/PITR and deployed UI flows remain unverified.
- The schema dump is authoritative for intended grants. Historical migrations run only once in order on a fresh source, never again over its later schema or a restored schema.
- Restore-only cleanup runs after schema creation so it removes target-inherited platform grants as well as future defaults; it never constructs application grants.

# Current acceptance counts — 2026-10-28

- The current suite has **88 fresh** and **91 restore-mode** pgTAP checks, with planned = ran and two-run repeatability. The inventory minimum is **33 tenant tables** (24 Phase 1, five Chunk 2A and four Chunk 2B). These are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/margindesk/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/margindesk/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**; hosted-target restore remains unverified.
- Chunks 2A and 2B are locked with their original normalized hashes. Chunk 2C has not started.

# Chunk 2B assumptions — 2026-10-28

- Scope is pricing and rebate tiers only. The migration and local-target restore are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/margindesk/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/margindesk/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. The migration is locked; no Chunk 2C work.
- Each customer has at most one group. Contract rules target an individual customer and carry a contract reference. Prices resolve contract > customer > group > product tier > product list, using product-base quantity and half-open date/quantity intervals. Conflicting rules fail instead of selecting an arbitrary price. Catalog/tier fallback remains the existing catalog source.
- Pricing rules store their currency; the margin engine converts the resolved price separately from cost/freight currencies. The quote records why its price was selected.
- Legacy rebate terms migrate as retroactive tiers. Legacy rate/threshold/progress columns remain compatibility/reference fields; the audit calculates from rebate_tier and rebate_entry. Demo nextRate hints conflict with base terms (Acme has two rates at the same threshold), so they are not fabricated into approved tiers. NorthStar remains 29,500 at 2% = 590 versus 350 credits, difference 240; Acme 175,000 is 5,000 short of its 180,000 threshold.
- Rebate agreement dates include both endpoints. Tier lower bounds are inclusive and upper bounds exclusive; incremental rates apply only to spend within each band, retroactive rates to all net eligible spend at the attained band. No attained band means zero earned. Returns and credit memos reduce spend, rebate-credit entries reduce outstanding recovery. Net spend is floored at zero after netting.
- Each rebate entry is explicitly allocated to an agreement and uses that agreement currency. No guessed supplier-credit matching or FX is performed. SKU exclusions win over eligibility; null-SKU aggregate backfills are explicitly accepted historical snapshots. Only the latest legacy progress snapshot is migrated, with source references, to avoid summing cumulative snapshots.
- Four new tenant tables raise the minimum from 29 to 33. All use existing policy/audit helpers; no new public SQL functions or function grants are needed, so the single function ACL registry stays unchanged.

- Chunk 2B breaks apply per quote line after UOM normalization to product base units. New plans are 88 fresh / 91 restore-mode checks and the minimum is 33 tenant tables; these are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/margindesk/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/margindesk/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. Locked Chunk 2A evidence remains 70/73 with 29 tables.

- Approval/send re-resolve pricing for the quote date. If an approved line price has changed, the request fails with a revision-required response rather than silently repricing the header while retaining old line values and creation rationale.

- A targeted backfill repairs only the known NorthStar demo importer mix-up: is_demo, exact program/period/terms/spend, old modeled=350/recorded=0, and both documented remittance rows must match. The new ledger source_ref identifies that repair. No other program's supplier credits are automatically allocated.
