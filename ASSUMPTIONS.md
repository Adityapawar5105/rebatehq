# Chunk 4B assumptions — 4B CI-verified (CI #44, c382f7d)

## Current chunk 6B — 5 November 2026

- Security review only; no Phase 7/8 work. Blueprint unchanged. All 10 locked
  migrations and migrations.lock remain unchanged; no new SQL or schema migration.
- Review assumes an updated supported browser and trusted OS, deployment and
  app code. It does not promise protection from extensions, an unlocked-device
  attacker, a keyholder rewriting a whole vault, or a malicious release.
- Runtime engine pins are embedded at build time. Self-hosted WASM and child
  workers are verified before use; the first-party app bundle/pins still trust
  the origin. Only `/spike/` worker responses add `blob:` to connect-src so the
  verified in-memory WASM can load. Page connect-src stays self-only.
- Existing passing evidence: CI #73 / Restore #18, 113 fresh / 116 restored
  checks, 20 server tenant tables. New integrity/logging/audit-gate changes are
  CI-verified in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e`, 5 November 2026: 194 unit tests, 113 fresh checks twice,
  36 named authenticated local-stack privacy checks.
- One moderate UUID advisory is retained for review (ExcelJS calls the unaffected
  v4 path). No high/critical advisory in the 5 Nov audit. The CI high/critical
  audit gate fails closed; it cannot prove absence of unknown vulnerabilities.
- Local roles are worker-enforced UI capabilities, not cryptographic separation
  between holders of the same full vault/passphrase. Revocation is read-only
  authority with offline grace, not a wipe or loss of decryption access.
- No hosted Supabase project, prospect ERP export, independent security review,
  production key-rotation drill or physical recovery test is assumed to exist.
  Future relay is not built. See SECURITY_REVIEW.md for owners/dates and
  EXTERNAL_SECURITY_REVIEW.md for the independent review acceptance checklist.
- Security whitepaper is intentionally limited to linked passing tests. Local
  Chrome/Edge harnesses are headless automation, not headed/manual checks.


Latest scope: **5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) (local target). The 5B section at the end supersedes the older open-item descriptions where implemented; local measurements in it remain local evidence.

**Chunk 4B — CI-verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`.** The GitHub job API confirms step 18, "Required authenticated local-vault privacy gate", completed successfully (not skipped). Its log records `pnpm test:vault:privacy --browser=chromium`, `auth: true`, `status: passed`: **one authenticated harness with 14 named checks**, not a Playwright test-runner count. The separate unit suite passed **67 JavaScript + 56 TypeScript = 123 tests**.

Privacy acceptance covers the **local vault flow only**. Legacy server business-data routes still exist; no app-wide "data never leaves your device" claim is made. **Unverified:** deployed Supabase sign-in, headed manual checks, physical crash/quota/multi-tab recovery, the historical storage-estimate discrepancy, and CI validation of the locally measured **~7.6 s / ~15–16 s first-change latency** (open item for 4C-1). Those timings remain local observations; Scale retains its 1M-line cap. 4C-1 has not started.

- Close-out status: **4B CI-verified (CI #44, c382f7d)**. The authenticated local-vault privacy gate passed in CI #44.
  The deferred first-change rebuild is measured separately in `VAULT_RESULTS.md`;
  any UI blocking or total latency above 10 seconds is an open item for 4C-1,
  not a redesign in this chunk. 4C-1 has not started.
  The resumed first change measured 7.586/7.611 seconds at 1M and
  14.781/16.332 seconds at 2M (Chrome/Edge); no UI long task >=50 ms was
  observed. The 2M latency is an explicit open item; Scale was capped at 1M until 14 Nov 2026 (now 2M; see below).

- Only 4B is implemented. No 4C-1 converter/mapping work, licence enforcement,
  server business-data retirement or new Supabase schema is included. All seven
  locked migrations, their hashes and `migrations.lock` stay unchanged.
- `/home` requires the existing verified Supabase identity and membership. Only
  identity/workspace metadata is passed to the client. New business data stays
  in a dedicated worker. The seven old business/audit pages are labelled Legacy
  under `/legacy/`; their APIs remain until the reviewed retirement in 5B.
  The local-shell privacy gate is not an app-wide server-path retirement claim.
- One pinned single-thread EH instance runs per unlocked vault. Its sync-file
  bridge is replaced in that child worker by private RAM blocks; it has no real
  OPFS directory. The `opfs://` spelling is an internal DuckDB adapter path,
  not a plaintext on-disk file. Only the outer worker can write OPFS, and it
  writes authenticated ciphertext plus non-business generation pointers.
- Unlock attaches the decrypted snapshot read-only from RAM in that instance.
  Existing indexes are immediately usable. On the first change, a lazy copy in
  fixed FK dependency order makes the working tables writable, in the SAME
  instance. This shifts the rebuild cost to the first mutation; it is not free.
  Direct reopening for writes hit the pinned build's write-mode error; eager
  copying missed startup targets. Both experiments are retained in the record.
- AES-256-GCM uses authenticated 1 MiB chunks, PBKDF2-SHA256 at 600,000
  iterations, a per-vault random salt and random per-snapshot IV prefix. Keys
  are non-extractable and held only in the worker. JavaScript cannot promise
  forensic erasure of strings, heap copies, OS swap or a compromised device.
- Immutable ciphertext is closed before an atomic `head.json` swap. The old
  pointer and retained generations survive a failed save. The UI reports
  success only after publication. Failed saves block further imports and offer
  Retry Save. Close/pagehide is best effort; only the last unsaved mutation may
  be lost. Auto-lock releases memory even if that pending save fails. Physical
  power loss and browser eviction are unverified; persistent storage is not backup.
- Local schema v1 is frozen with a committed encrypted synthetic fixture; v2
  migrates forward. These DuckDB tables are not new Supabase tenant tables.
  Mutation APIs append a hash chain with a tip/count inside the encrypted vault.
  It detects tampering, truncation and reorder; it cannot prevent a device
  owner rehashing a whole vault or rolling back to an older valid snapshot.
- CSV ingest intentionally accepts the documented ten-column sales shape only.
  IDs/quantities are positive whole numbers and line totals are exact cents.
  Mapping, UoM/dated-cost resolution, file deduplication and other formats remain
  later chunks. No master price/current cost is guessed from invoice totals.
- Local profiles enforce Starter 20k products/200k lines, Professional 100k/1M,
  Scale 200k/2M. Profile selection is a guardrail, not authoritative billing or
  licensing. Scale was held at a provisional 1M until 14 Nov 2026, when the user
  asked for the blueprint's 2M (blueprint section 22, item 30); 2M timing targets
  remain unverified.
- `persist()` requires a window user action; all heavy work, storage enumeration
  and queries remain in the worker. Both headless browsers denied persistence
  normally and the UI showed that. See `STORAGE_FINDINGS.md`: the new path's
  estimate is close to file sizes; the historical 4A discrepancy remains unresolved.
- Local Chrome/Edge results, exact timing methodology and command outcomes are
  in `CHUNK_4B_VERIFICATION.md`. CI acceptance and the authenticated local-vault gate
  are verified by CI #44; deployed app, headed grants, physical crash/quota/multi-tab
  recovery and external review remain **unverified**. This workstation has no
  real local Supabase credentials/Docker/psql.
  The public synthetic `/lab/vault` harness is default-off and requires
  `VAULT_LAB_ENABLED=true`; it never substitutes for authenticated `/home`.
- CI derives real Auth/mail URLs and a public key from its local Supabase stack.
  The required gate uses real SDK PKCE, a captured local email and the existing
  callback, then verifies the session and creates only a disposable workspace.
  It does not fake cookies/JWTs or relax the production email rate limiter.
  The production email request endpoint itself is not exercised by this gate.
- Phase 1 audit actor-setting trust, failed-login input bounds and rate limiting
  remain open for 5B, alongside authoritative licences, legacy API retirement
  and the complete application privacy review. This chunk does not close them.

# Chunk 4A spike assumptions — CI-verified scope, 3 November 2026

- Chunk 4A is **CI-verified in [MarginDesk CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478)**,
  commit `395154d21efb45fb03397f5545c3ffd6a6f3ded4`, 3 November 2026.
  The run passed 113 tests (including six spike tests and the margin golden
  cases), frozen installation/migration gates, typecheck and the production
  build with self-hosted assets. It did not execute the Chrome/Edge harness;
  performance and browser privacy results remain local evidence, not CI proof.

- Blueprint v2.2 and its execution plan govern. Only the spike is implemented:
  no 4B vault lifecycle, app-shell migration, control-plane retirement, licence
  changes or production privacy claim. Locked migrations and `migrations.lock`
  remain byte-for-byte unchanged.
- `/lab/spike` processes data only in browser workers. The new page wrapper has
  only dynamic-render configuration for the existing CSP nonce; it reads no
  data and sends no props. Existing server changes are header configuration
  only (COEP and lab-scoped Wasm/worker CSP); API/auth/business handlers stay
  unchanged.
- Pin DuckDB-Wasm **1.32.0**, not the npm `latest` tag: the official OPFS note
  identifies a persistence bug in latest 1.33.1-dev57.0. Assets are copied from
  that pinned dependency and served by this app; no runtime CDN/extensions.
- On this Chrome build the COI bundle starts but stalls on a small OPFS write.
  The threaded scratch import also failed the exact 130-row reconciliation.
  All spike work now uses single-thread EH, including isolated memory DBs;
  non-isolated mode also uses one thread. Neither failure was worked around by
  weakening its assertion.
- Plaintext OPFS persistence is tested **only with generated synthetic data**.
  User-selected files import into a separate memory-only DB. The faster native
  scanner can read browser File handles directly, without copying customer
  files to plaintext OPFS. Snapshot restore to a plaintext file is likewise a
  synthetic-only spike probe, not the chosen production working-vault design.
- Native encrypted OPFS writes fail in the offline build's read-only crypto
  module; httpfs is not installed and no extension is downloaded. The chosen
  approach is encrypted snapshots (AES-256-GCM, authenticated 1 MiB chunks,
  PBKDF2-SHA256 600,000 iterations, random salt/IV). Production unlocked working
  data/staging must be in memory. This corrects blueprint sections 5/20, logged
  in section 22; 4B must implement the actual vault.
- This spike uses a documented ten-column invoice shape, exact cent amounts,
  200k SKU/2M-line caps and 256 MiB CSV cap. The XLSX/conversion demonstration is
  bounded to 8 MiB/10k rows and one sheet. It is not the 4C mapping/converter
  feature. Formula cells/cached results, macros, ZIP bombs and XML entities are
  rejected or surfaced, never evaluated.
- The development environment has installed Chrome/Edge and nominal 8 GB RAM.
  Record OS/browser/CPU/usable RAM and exact methodology in `SPIKE_RESULTS.md`;
  local numbers do not prove CI, other laptops or deployment performance.
- There are no local Supabase credentials, Docker or psql. A real magic-link
  session is unverified unless separately exercised; auth UI/asset checks cannot
  be described as a verified Supabase login. No email is sent by a mock check.
- Full-size local headless Chrome 156.0.8078.76 and Edge 156.0.4314.58 runs on
  this Ryzen 5 5600H / nominal 8 GB Windows laptop pass the functional harness.
  Native 2M-row imports took 3,625.5 / 3,857.8 ms; encrypted startup took
  3,385.1 / 3,412.7 ms and **misses** the three-second target. Methodology,
  sampled memory peaks, exact evidence and proposed pilot caps are in
  `SPIKE_RESULTS.md`. These are local observations, not CI evidence.
- Browser storage estimates report about 4.14 GB while enumerated named OPFS
  files total about 68.18 MB. This discrepancy is unresolved; do not advertise
  either number as a total disk-footprint guarantee. Headless persistence was
  not granted. Manual headed Chrome/Edge, quota/crash/multi-tab recovery and
  the production memory-only encrypted vault remain unverified.
- CI #42 does not verify headed manual checks, real Supabase sign-in, the
  production encrypted vault, crash/quota/multi-tab recovery or resolution of
  the storage-estimate discrepancy. These stay **unverified**. The local
  encrypted-startup miss is unchanged; 4B has not started.

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
- The app connects through a dedicated PostgreSQL login that can assume `rebatehq_app`, which is `NOLOGIN`, `NOINHERIT`, and `NOBYPASSRLS`. No user-facing route uses a service-role or bypass key. Browser roles have no direct grants on business tables.
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

- The #9 failure is historical. The corrected local-target procedure is verified by [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`. Hosted-target restore, managed backup/PITR and deployed UI flows remain unverified.
- The schema dump is authoritative for intended grants. Historical migrations run only once in order on a fresh source, never again over its later schema or a restored schema.
- Restore-only cleanup runs after schema creation so it removes target-inherited platform grants as well as future defaults; it never constructs application grants.

# Current Phase 2 acceptance — 2026-10-28

- Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Phase 3 had not started at that Phase 2 milestone; current Chunk 3A verification is recorded below.
- Chunks 2A, 2B and 2C are locked with their original normalized hashes. Phase 3 had not started at that Phase 2 milestone; current Chunk 3A verification is recorded below.


# Chunk 2B assumptions — 2026-10-28

- Scope is pricing and rebate tiers only. The migration and local-target restore are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. The migration is locked; this paragraph records the Chunk 2B milestone.
- Each customer has at most one group. Contract rules target an individual customer and carry a contract reference. Prices resolve contract > customer > group > product tier > product list, using product-base quantity and half-open date/quantity intervals. Conflicting rules fail instead of selecting an arbitrary price. Catalog/tier fallback remains the existing catalog source.
- Pricing rules store their currency; the margin engine converts the resolved price separately from cost/freight currencies. The quote records why its price was selected.
- Legacy rebate terms migrate as retroactive tiers. Legacy rate/threshold/progress columns remain compatibility/reference fields; the audit calculates from rebate_tier and rebate_entry. Demo nextRate hints conflict with base terms (Acme has two rates at the same threshold), so they are not fabricated into approved tiers. NorthStar remains 29,500 at 2% = 590 versus 350 credits, difference 240; Acme 175,000 is 5,000 short of its 180,000 threshold.
- Rebate agreement dates include both endpoints. Tier lower bounds are inclusive and upper bounds exclusive; incremental rates apply only to spend within each band, retroactive rates to all net eligible spend at the attained band. No attained band means zero earned. Returns and credit memos reduce spend, rebate-credit entries reduce outstanding recovery. Net spend is floored at zero after netting.
- Each rebate entry is explicitly allocated to an agreement and uses that agreement currency. No guessed supplier-credit matching or FX is performed. SKU exclusions win over eligibility; null-SKU aggregate backfills are explicitly accepted historical snapshots. Only the latest legacy progress snapshot is migrated, with source references, to avoid summing cumulative snapshots.
- Four new tenant tables raise the minimum from 29 to 33. All use existing policy/audit helpers; no new public SQL functions or function grants are needed, so the single function ACL registry stays unchanged.

- Chunk 2B breaks apply per quote line after UOM normalization to product base units. New plans are 88 fresh / 91 restore-mode checks and the minimum is 33 tenant tables; these are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. Locked Chunk 2A evidence remains 70/73 with 29 tables.

- Approval/send re-resolve pricing for the quote date. If an approved line price has changed, the request fails with a revision-required response rather than silently repricing the header while retaining old line values and creation rationale.

- A targeted backfill repairs only the known NorthStar demo importer mix-up: is_demo, exact program/period/terms/spend, old modeled=350/recorded=0, and both documented remittance rows must match. The new ledger source_ref identifies that repair. No other program's supplier credits are automatically allocated.

# Chunk 2C assumptions and Phase 3 handoff — 2026-10-28

- Chunk 2C is persistence/security only. Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Phase 3 had not started at that Phase 2 milestone; current Chunk 3A verification is recorded below. The historical 2B baseline was 88/91 and 33 tables.
- import_job already exists; preserve its dry_run/committed/failed statuses and stored rows. Add nonnegative accepted/rejected counts, a nonempty bounded import type, and object-shaped summary. Invalid legacy rows cause an explicit constraint failure; do not discard or silently rewrite them.
- The five new tables are column_mapping_template, connector_sync_run, quote_share_link, approval_rule and plan_feature. Owner/manager can read them; owner/manager can write mapping/sync/share metadata; only owners can mutate approval rules and plan features. Reps and analysts have no access to the five new tables. Existing import_job and margin_snapshot role rules are preserved.
- Mapping templates hold column mappings, not upload contents or credentials. Sync rows are run metadata, not a connector implementation. Sync failed_count is a subset of processed_count; terminal status requires a finish timestamp and a valid start/finish order.
- Share rows store a SHA-256-shaped hex digest (never the raw bearer token), a tenant-bound quote FK, creator, expiry and revocation timestamps. An exact column allowlist rejects cost/margin or arbitrary payload fields. No anonymous role can read this table and no redemption endpoint exists. Future sharing must generate high-entropy tokens server-side, enforce expiry/revocation and expose a separately whitelisted customer quote view.
- approval_rule percentages use 0..100, matching margin-engine.js. Rules are inert configuration until a later workflow implements them. plan_feature is tenant-local configuration, NOT an authoritative paid entitlement; owners must not be able to mint billing privileges through it.
- No new SQL functions or sequences are needed. All five new tables use the existing audited write trigger and tenant-role helpers. All restore inventories, counts, table ACLs and existing function ACLs continue to compare strictly; historical migrations are never replayed onto a restored schema.

Open items carried to Phase 3 (recorded only; not implemented here):

1. **Phase 1 audit actor trust:** lib/db.ts sets app.real_actor_id from realActorId/actorId/userId inside withDatabase; lib/context.ts and the development impersonation helpers supply the request actor. Both audit_row_change and audit_log_append trust this caller-settable GUC. Replace that trust with a reviewed SECURITY DEFINER append boundary or a verified server-signed actor assertion before production use. Do not claim that SQL callers cannot spoof it today.
2. **Phase 1 record_failed_login input limits:** the function fixes action/NULL tenant/NULL actor and hashes the email; user_agent is truncated to 1,000 characters and IP is cast to inet, but the DB function has no explicit maximum email/IP/input byte length before processing. Add and test bounded inputs in a NEW migration; preserve the current fixed-event and EXECUTE allowlists.
3. **Phase 1 failed-login rate limiting:** the HTTP login path currently limits 8 attempts per 10 minutes; production requires Upstash and fails closed if unavailable. The database function has no independent rate limit, so direct app-role calls can bypass HTTP throttling. Review trusted proxy/IP handling and a DB-side or restricted write-path control; distributed production behavior remains unverified here.
4. Define import retention/PII rules, mapping validation, connector retry/idempotency and credential boundaries, safe quote token issuance/redemption with cost-free projections, approval execution/versioning, and billing-controlled entitlement ownership before activating these tables. No such endpoints or workers are added in 2C.
5. Hosted-target logical restore, platform backup/PITR, production configuration and deployed browser workflows remain unverified. Chunk 2C and Phase 2 acceptance passed in CI #31 and local Restore Drill #12 as cited above; the Phase 1 open items listed here remain open. This records the Phase 2 milestone; current Chunk 3A verification is recorded below.

# Chunk 3A assumptions — 2026-10-29

- Chunk 3A is a **file review and column-mapping flow**, not a committed catalog import. A review creates an existing `import_job` dry run and, when relevant, existing `data_quality_issue` rows; it does not change products, costs, prices, or quantities. Full source bytes and rows stay in memory for the request and are never stored; UOM issue details can retain the affected source/target unit codes with row and column. The response shows the first 50 rows and every issue. Chunk 3A's automated checks are **verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`**.
- CI #33 passed messy XLSX and BOM/semicolon/comma-decimal parsing, sheet/header mapping suggestions, upload size/type/row/column/cell and streamed-body limits, macro/XML-entity/path/external-link/ZIP-bomb rejection, inert malicious cell text, formula-safe CSV exports, malformed-file fuzzing, and restricted tenant template/UOM tests with repeatability. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**; the API permission test inspects source guards and is not an authenticated HTTP test. See [the verification record](./CHUNK_3A_VERIFICATION.md).
- Only owners and managers can use the supplier-file review and template endpoints. This matches the existing `column_mapping_template` RLS policy. Analysts and reps cannot access them. The authenticated server context supplies `tenant_id` and the actor; the client cannot choose a tenant.
- Accepted source formats are UTF-8 CSV or TSV and data-only XLSX, at most 2 MiB compressed/uploaded, 12 MiB expanded, 2,000 rows, 64 columns, 50,000 cells and 2,000 characters per cell. The ZIP/XML parser also bounds entries, parts, expansion ratio and nesting. UTF-16, XLS, XLSM, macros, embedded objects, external workbook relationships, entity declarations and unsupported ZIP features are rejected rather than guessed or evaluated. A malware scanner is not connected; persisted uploads remain disabled.
- CSV delimiter detection supports comma, semicolon and tab; a UTF-8 BOM is reported. All cell values remain source strings. XLSX formulas are never evaluated and their cached results are ignored; formula-looking text is flagged. Numeric-looking text, comma decimals, ambiguous/serial dates, duplicated SKUs, merged cells, hidden columns/rows, and missing conversions surface as row/column issues. Users must explicitly correct or approve values in a later import step; this chunk does not normalize them.
- The existing `convert_quantity` function probes whether an approved conversion exists for a known catalog SKU. It never rewrites a source quantity. A missing conversion creates an import-row `data_quality_issue` with job, row, column and units; the existing conversion function can also record its product-level issue. Unknown SKUs are reported and never assigned a guessed product/base unit.
- Mapping suggestions are derived from header similarity and require confirmation. Templates are scoped by authenticated tenant, exact supplier name and file type, and are applied only when the complete header fingerprint matches. Templates store field indexes and the fingerprint, not file contents, headers or supplier prices. A changed header order requires explicit remapping.
- The wizard uses React text rendering and the existing CSV export utility, which neutralizes spreadsheet-formula prefixes. No raw cell values are logged. The UI keeps the four-item navigation and uses the Price Lists page for this three-step task.
- Chunk 3A adds **no migration, SQL function, tenant table or pgTAP check**. All six earlier migrations and `migrations.lock` remain unchanged and locked. CI #33 passed the existing **156 fresh** checks twice across **38 tenant tables**. No Restore Drill was run for 3A because the schema and restore inventory did not change; the **159 restore-mode** checks remain proven by Phase 2 Restore Drill #12. The new runtime SQL also ran in CI's PGlite tests; this does not prove the authenticated Next.js flow or deployed Supabase app.
- Later work still needs a reviewed correction/approval and committed import path, supplier-file comparison, a managed malware scanner before any file persistence, file retention/PII policy and deployed accessibility/security testing. Chunk 3B was deferred at that milestone; its current status is recorded below. The Phase 1 audit-actor trust, failed-login input limits and independent rate-limiting items above remain open.

# Chunk 3B assumptions — 2026-10-29

- Chunk 3B adds catalog import dry run, commit, history, undo and an Excel-compatible CSV round trip. It reuses `import_job.summary` for versioned export baselines, plans and before/after journals. There is **no new migration, table, SQL function, policy or grant**; all six locked migrations, hashes, `migrations.lock`, the function ACL registry, **38-table** minimum and **156 fresh / 159 restore-mode** pgTAP plans remain unchanged. Chunk 3B's automated checks are **verified in [MarginDesk CI #35](https://github.com/Adityapawar5105/rebatehq/actions/runs/40844679109), 2026-10-29, commit `87d7d90`**. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.
- CI #35 passed the lifecycle/conflict/audit/exact-undo tests on fresh and populated PGlite fixtures, dated pricing precedence, explicit decimal/unit approvals, stale/key controls, and execution coverage for every new runtime SQL query. It also passed all 91 JavaScript/TypeScript tests and the existing 156 fresh pgTAP checks twice. No Restore Drill was run because no migration or restore inventory changed; Restore Drill #12 remains the 159-check restore-mode evidence. Authenticated Next.js behavior, the deployed Supabase app, hosted restore and browser UI beyond the local harness remain **unverified**.
- The initial review and final dry run write staging metadata and any UOM data-quality issues, but do not change the catalog. Only an explicit commit writes business rows. Owner/manager access matches Chunk 3A; analysts and reps have no lifecycle API access. The existing database role policies still apply, including analysts' existing access to import metadata/costs. No user-facing path uses an administrative or service-role connection.
- CI #35 exercised the original **200-data-row import**, **1,999-product export** and **8 MiB journal** limits. The current limits are superseded by the capacity follow-up below, **verified in CI #37 on `32aff35`** as cited there. Source bytes are not stored; normalized business values and original before records ARE retained in `import_job.summary` and its audit snapshots. Journals follow existing tenant deletion/retention behavior; there is no new automatic journal expiration/purge feature. Cell contents are never written to application logs.
- Text numbers require an explicit decimal-separator approval; grouping separators, negative/exponential values and more than four input decimal places are rejected. Existing formulas/macros remain rejected. Structural warnings require acknowledgement and every rejected row is excluded; committing other valid rows requires a separate explicit acknowledgement. No omitted row is deleted.
- New products require a SKU, description, registered base-unit code, cost and price, with category `Imported`. Existing product ID, SKU and base unit are protected; an approved source-unit conversion can change supplied amounts into the existing base unit but cannot change that unit. Missing units/conversions record row/column `data_quality_issue` entries through the existing Phase 2 helpers. Quantity is reviewed only and never writes inventory or invoices.
- Imported cost amounts use **standard** cost basis and tenant currency. A file date, or the explicitly displayed default effective date, controls cost/price history. Description and supplier edits apply immediately. Same-start entries are updated; an interval is split at the chosen date, preserving later scheduled intervals and exclusive end dates. Gaps are not filled with invented zero costs. The product's legacy unit_cost/list_price values remain fallback/reference fields for existing products; the catalog display reads current dated standard cost and imported list price. Quotes use the shared margin engine's existing cost basis and pricing precedence.
- Price rows use one active tenant-currency price list named `RebateHQ file imports`. This name is reserved for this flow. The shared resolver reads its dated rows below contract, customer, group and tier prices. Multiple active lists with that name are rejected. Currency conversion/configuration UI and other price lists are outside this chunk.
- The lifeline CSV includes stable `md_row_id` (product UUID) and `md_version` (export job plus graph hash). The server retains the baseline and validates both, the SKU, and tenant membership; missing/altered metadata is rejected for existing rows when metadata columns are present. New rows have empty metadata. Ordinary supplier files without metadata match by SKU and show current app values in the explicit dry run; they cannot reconstruct an export baseline that has been removed.
- Any product/cost/price change since export produces a three-way conflict: baseline, app and file. “Keep mine” retains the app row; “keep theirs” uses the reviewed file row; “review” blocks commit. A 30-minute dry run is stored server-side; commit accepts only its ID, rechecks row revisions and unit factors, and fails on stale data. Transactions, tenant advisory locks, and parent/child row locks protect commit/undo. Real multi-connection contention is **unverified** locally.
- Undo restores affected product metadata and exact original cost/price rows and IDs, and deletes newly created products/list headers only when safe. It compares all current business values with the recorded committed result and refuses later edits, shared-list use or FK dependencies. It does not erase audit events, import history or data-quality metadata. History records the commit actor/time, file name, written/rejected/unchanged counts and undo time. A second commit or undo is rejected.
- Logical restore changes physical row revisions: use a fresh export/dry run after restore. Undo compares business values rather than physical revisions, but end-to-end undo of a pre-backup journal after real Supabase restore remains **unverified**. Hosted restore, managed backup/PITR, authenticated Next.js/deployed Supabase behavior, formal WCAG AA testing and browser behavior beyond the local fixed-actor harness remain **unverified**.
- Phase 1 audit actor trust, failed-login input bounds and independent DB rate limiting remain open as recorded above. Managed malware scanning before file persistence, retention policy approval, and supplier-file comparison remain later work. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.

# Import capacity follow-up — 2026-10-29

- This Chunk 3B capacity change is **verified in [MarginDesk CI #37 on `32aff35`](https://github.com/Adityapawar5105/rebatehq/commit/32aff35cd2842723206272a4147769779aa5a0d3/checks), 2026-10-29; CI job duration: 10m 24s**. Its fresh/populated PGlite tests prove the configurable 10,000-row maximum, batched commit/undo with exact restoration, and later-batch rollback. No Restore Drill was run because no migration or restore inventory changed. All six locked migrations/hashes and the ACL registry remain unchanged; the minimum is **38 tenant tables**, with **156 fresh / 159 restore-mode** pgTAP checks. Chunk 3C had not started at that milestone; its current status is recorded in CHUNK_3C_VERIFICATION.md.
- One build-wide setting, **`MAX_IMPORT_DATA_ROWS` in `lib/import-config.ts`**, defaults to **10,000 data rows**. Edit that constant, rebuild and rerun the boundary tests to configure a different maximum. Header and blank rows do not count as data rows; unchanged/rejected rows do. An independent bounded physical-row/header allowance still protects parsing. Review, XLSX/CSV/TSV parsing, commit and lifeline export use the same maximum. This is not a tenant setting. Lowering it rejects larger pending commits. Undo has no row-count cap; journal and safety limits still apply.
- Database work is batched at 250 rows with `jsonb_to_recordset` and explicit typed column lists. All batches, preflight validation, the one final committed/undone job update and existing row audit triggers share the caller's transaction and restricted app role. No intermediate commit, per-batch job, privilege widening or trigger bypass is introduced. A failed later batch rolls back earlier writes and their audit events. Audit and staging/history rows intentionally remain after a successful undo; business data and exact row counts are restored.
- At the default, safety bounds are 10,240,000 upload bytes, 10,025 raw rows, 64 columns, 641,600 cells, 2,000 characters per cell, 120,000 diagnostic issues, 81,920,000 expanded ZIP/journal bytes and 40,960,000 bytes per ZIP part. Row-related bounds derive from the maximum; column/cell-text/ZIP-entry/ratio/XML and macro protections remain independent. A file may need splitting before the row maximum if it exceeds another bound or has unusually large histories.
- Source previews retain 50 rows; change and issue pages contain 100. All issue locations/messages are stored in the existing tenant-scoped review job and downloadable in bounded pages. They contain fixed diagnostic text, not full source rows; unit issue details can still contain source/target unit codes. Full file bytes are not retained or logged. Conflict choices persist page by page in the same catalog job rather than being sent as a large header.
- New export baselines store compact normalized values and a graph hash. Undo journals retain exact prior records and committed business hashes instead of duplicate full after-graphs. Old graph-based exports/journals remain readable. Existing stale-edit, protected-key, unit-factor and later-dependency guards remain.
- Import routes declare a 300-second maximum and set a transaction-local 60-second per-statement timeout for import work; the rest of the pool retains its existing 8-second default. This does not prove a hosting provider's request, transaction or memory capacity. CI #37's 10m 24s is the full job duration. Real-Postgres commit/undo timings were **not captured in CI #37**; that workflow's `IMPORT_CAPACITY_TIMING` output comes from PGlite. CI #39 now supplies the real-Postgres benchmark recorded below. Local timings and the executed SQL inventory are in [IMPORT_CAPACITY_VERIFICATION.md](./IMPORT_CAPACITY_VERIFICATION.md). Serverless time limits, hosted throughput, real independent-session contention, authenticated Next.js behavior, the deployed Supabase app, browser UI beyond the fixed-actor harness, hosted restore and pre-backup-journal undo after real restore remain **unverified**.

# Chunk 3C and Phase 3 acceptance — 2026-10-30

- Chunk 3C and Phase 3 are **verified in [MarginDesk CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) and [MarginDesk Restore Drill #13](https://github.com/Adityapawar5105/rebatehq/actions/runs/40938982321), 2026-10-30 (Asia/Calcutta), commit `2f8b06d`**. The real Supabase/Postgres suites passed **162 fresh / 165 restore-mode checks**, planned = ran, twice with unchanged row counts. Prior 3A/3B/capacity/close-out runs remain their historical evidence. Phase 4 has not started.
- Migration `20261029175710_chunk3c_invoice_actual_cost.sql` is **locked** at its unchanged normalized SHA-256 `c5d8c6da2caf5018ace042ed8ff79e988781c096af51a9b3776ef68c1930a353`; the six earlier locked migrations, hashes and evidence remain unchanged. It adds nullable `invoice_line.actual_cost_amount numeric(18,4)` and `actual_cost_source text`, with paired non-negative/non-NaN amount and nonempty source constraints, plus a cost-component lookup index. No actuals are inferred/backfilled. Existing invoice-line tenant indexing, forced RLS, exact grants and audit trigger apply. No new table or public SQL function means the minimum stays **38** and the function ACL manifest is unchanged.
- Readiness covers all stored invoices in the current tenant, not just this month, and is shown only to cost-reading owner/manager/analyst roles. Each invoice must have at least one line, and every line must pass a category before that invoice counts for it. Empty invoices fail all categories; no invoices yields “not available”.
- Formula: `100 × (freight-ready invoices + actual-cost-ready invoices + rebate-ready invoices + unit-ready invoices) / (4 × invoice count)`, rounded once to one decimal. This is equal-weight completeness, not dollar-weighted margin math; `margin-engine.js` remains the margin source of truth. Fully ready invoices are counted separately.
- Actual cost is a sourced **line-total** in the invoice line's currency, not standard/average/landed catalog estimates. Freight/rebate evidence uses existing invoice-line `cost_component` allocations with a source reference and matching currency, types `freight` and `off_invoice_rebate`. Explicit sourced zeros count; default invoice-line zeros do not. Rebates here are invoice allocations, not unallocated incentive estimates or recovered supplier credits. References are recorded evidence, not cryptographic proof.
- Unit readiness checks registered source/base units with identity, direct or reverse approved tenant/product conversion definitions. It tests availability without conversion math or writing issues on a dashboard GET. Imports/quotes still use `convert_quantity`; missing imported conversions create existing `data_quality_issue` rows and reject that row.
- The actual demo scores **25%**: all invoices have units, but none have sourced actual cost/freight/rebate allocations. The four-invoice fixture is **43.8%**, becoming **50%** after its missing conversion is added. The sourced restore fixture is **100%**. Catalog imports do not load invoice actuals; the dashboard gives steps to obtain/reconcile invoice-line allocations and load them via an approved invoice-data process. An invoice-actuals import UI is deferred.
- Sheets schedules reuse `column_mapping_template` with `import_type='sheets_ingestion_v1'`; supplier mappings retain their existing type. `connector_sync_run` holds attempts/status/counts and `import_job` holds reviews/catalog dry runs. Tenant context and active owner/manager membership are checked server-side. The operator worker uses the restricted `APP_DATABASE_URL`, never an admin/service-role path.
- `MD_SHEETS_INGESTION`, `MD_EMAIL_DROP_STUB`, `MD_SFTP_DROP_STUB` default false. Email/SFTP flags show tenant-specific `.invalid` email addresses/preview paths only: no receiver, upload endpoint or server exists.
- Sheets supports public/link-readable document or published-CSV links only, not OAuth/private Sheets. Initial host is exactly `docs.google.com`; redirect hosts must match `doc-…-sheets.googleusercontent.com` with `/export/`. Every hop is HTTPS, host/path checked and DNS-resolved; every answer must be public. Approved addresses are pinned in fresh TLS-verified connections, preventing DNS rebinding. Private/internal/link-local/reserved/mapped addresses are rejected. No cookies, credentials or caller headers are forwarded.
- Fetches are bounded to 15 seconds total including DNS/redirects, 5 seconds idle, three redirects and `UPLOAD_LIMITS.bytes`. Compressed HTTP bodies are rejected; declared and streamed caps both apply. Fetched CSV passes existing content/row/column/cell/macro/formula guards, exact mapping fingerprint and plain-English issue reporting. Raw bytes are discarded after staging and never logged; normalized journals, diagnostic locations and unit codes remain tenant-scoped confidential data.
- Schedules support 1/6/24/168-hour intervals, UTC next-due time and a ten-minute claim lease. Limits are ten schedules per tenant and five due reviews per CLI invocation. Deploy an external trusted runner calling `pnpm ingest:due` at least hourly per tenant with an active owner/manager actor. The app can save/pause/resume/run reviews but does not deploy a recurring scheduler. Network I/O holds no DB transaction. A later worker retires expired running claims; crashes can defer retry until the next due time. Independent-worker contention/crash recovery beyond the local harness remains unverified.
- Numeric-format/unit approvals are explicit schedule settings. Changed headers stop staging instead of guessing mappings. Fetch success means a review was staged, never a catalog commit. Per-file warnings need acknowledgement. User commit uses the existing 30-minute plan, guarded batching/audit/undo and rejected-row consent; expired reviews require refetch.
- Saved mappings now also retain per-column header hashes, never raw header/cell contents. Header changes name the exact row and changed column letters. Older fingerprint-only templates still work in manual review but require an explicit re-save before scheduling; no column locations are guessed.
- Restore comparison includes all column names/types/nullability/defaults and hashes for invoice actuals, mappings/schedules and sync runs without logging their cells/URLs. The source seed includes a sourced invoice and a disabled schedule with its mapping parent and sync metadata. **Verified in local-target Restore Drill #13**: strict comparisons, dump grants plus restore-only platform cleanup, sentinel/runtime/no-context checks and the repeated 165-check suite. No historical migration is replayed onto a restored schema. Hosted-target restore remains **unverified**.

## Open items carried to Phase 4 — recorded only

1. **Timing baseline verified; deployed timing still open:** [CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) ran `pnpm benchmark:import` at 10,000 rows: `commitImport` **11,605 ms**, `undoImport` **3,442 ms**, PostgreSQL **17.11**, non-superuser/non-bypass **`margindesk_app`**. Audit/exact-restoration and no-residue checks passed. Parsing, setup, network and durable COMMIT/WAL flush are excluded; **this is not a serverless latency guarantee**. Deployed/serverless time limits, existing-history workloads and independent sessions remain unverified.
2. **Phase 1 audit actor trust:** `lib/db.ts` still sets caller-controllable `app.real_actor_id`, trusted by the append policy/trigger. A reviewed SECURITY DEFINER boundary or signed actor assertion remains open; no spoof-proof claim is made.
3. **Phase 1 failed-login bounds/rate limiting:** `record_failed_login` input limits and independent DB throttling remain open. Existing HTTP rate limiting is not a DB-side guarantee; distributed production behavior/trusted proxy handling remain unverified.
4. Production invoice actuals ingestion/evidence validation, retention/PII approval, malware scanning before persistence, OAuth/private Sheets, deployed recurring-worker identity rotation/retries/monitoring, and live mail/SFTP receivers are deferred.
5. Authenticated Next.js behavior, the deployed Supabase app, hosted restore/PITR, serverless time limits, recurring schedule execution (requires an operator-configured runner), live email and SFTP ingestion, and browser UI beyond the local harness remain **unverified**. Pre-backup journal undo after real restore and formal accessibility/assistive-technology checks also remain unverified. Local tests/smokes do not count as green Actions evidence.

# Chunk 4C-1 assumptions — 2026-11-03

- Scope is blueprint section 6A Phase 1 formats: multi-file and folder import, role tagging, an in-browser converter, preview fixes, combine, source tracking, batch report, converter recipes, clean-CSV/ZIP downloads, tier caps, and background warm-up after unlock. The ERP mapper, resilient parser symbol stripping, Fix Later UI, health score and Playground are chunk 4C-2. Everything stays in the vault worker; there is no new server route, migration or Supabase change.
- Columns align only when a header's normalized name (case, spaces and punctuation ignored) equals a canonical field (`ROLE_FIELDS` in `lib/studio/formats.ts`). Other header names need the 4C-2 mapper. Unmatched columns are listed as "not used" and never guessed.
- Values are validated exactly in DuckDB SQL per file: amounts are non-negative with up to two decimals and no symbols or grouping, stored as whole cents; quantities have up to four decimals; dates are real calendar dates in the chosen format (1900-2100); IDs are 1-64 characters. Rejected rows are never loaded or rewritten. Each is stored as an open `import_issues` row with its original row and column, and the batch needs an explicit acknowledgement before loading the valid rows.
- Sales `line_id` is unique across the vault: a line already loaded from another file is rejected, so monthly exports can be combined without double counting. Products and customers created from sales lines are "derived" (NULL source). An item master or customer list updates them and takes ownership; a second file cannot overwrite rows owned by another file.
- Removing a file deletes exactly its rows, resets attributes it set on derived rows, and deletes products/customers that only it needed. DuckDB cannot delete a parent row in the transaction that deleted its children, so removal runs in two in-memory transactions followed by one encrypted save. A crash between them saves nothing. Replace runs the delete and the new import in one transaction.
- Spreadsheets, JSON and XML are parsed whole in the worker and capped at 300,000 rows (64 MiB); text exports stream up to 256 MiB. Formulas are never evaluated and their cached results are not read (the cell is left blank and an issue recorded). Macros, external links and embedded objects are ignored with a notice. Workbooks with DOCTYPE/ENTITY declarations, unsafe paths, encryption or zip-bomb ratios are rejected.
- The downloaded clean CSV normalizes only known columns (dot decimals, two-decimal amounts, ISO dates) and neutralizes formula-like cells with the existing `csvSafeCell`. It has no BOM, matching earlier exports.
- Ambiguous slash dates (both parts at most 12) default to MM/DD/YYYY for the US market, with a visible notice to confirm.
- Rebate agreement files are converted but not loaded; the Phase 1 data model has no rebate tables (blueprint v2.2, section 22 entry 10).
- Background warm-up starts after unlock on a second DuckDB connection. Imports, recipe saves and removals wait for it. If it fails, the first change copies synchronously as in 4B.
- `verifyAudit` previously ordered by a VARCHAR alias and failed once a vault had ten or more entries; it now orders by the BIGINT column. Vaults saved by 4B with fewer than ten entries were unaffected.

# Chunk 4C-2 assumptions — 2026-11-04

- Mapping suggestions come from canonical names (score 1.0), ERP-profile names (0.95), common synonyms (0.9), unit price/cost x quantity (0.85-0.9) and partial header matches (0.6). The ERP profiles are built from public documentation and are unverified. Any non-exact source needs the user's explicit "I checked this mapping"; a saved recipe stores the confirmed mapping and applies it as confirmed.
- Generated line IDs are a deterministic 53-bit hash of invoice number plus line number (or order within the invoice), so re-importing the same file is detected. Exact duplicate rows in files with generated IDs are compared on every other field.
- Line amount from unit price x quantity is exact (BigInt), rounded half away from zero to the cent. Values are cleaned to canonical form (dot decimals, ISO dates) before the same exact SQL validation; anything ambiguous is left as typed and rejected with a location.
- Blank discount, freight and rebate load as 0. A blank or unmapped cost loads as unknown (NULL) and lowers the health score; it is never guessed as zero. Negative quantities and amounts (returns, credits, adjustments) are rejected to Fix Later until the 4D margin engine defines credits.
- Fix Later keeps each rejected row's cleaned values. A correction applies to one group (file + issue) or listed rows. Re-check validates only that group; duplicates load only through an explicit "Load anyway". Rows rejected for broken layout can only be dismissed. Every correction, dismissal and load is audited and saved.
- The health score is the equal-weight mean of the components that apply: cost coverage, unique product IDs (case and space insensitive), price consistency (unit price within 5x of the product median, products with 5+ lines), import completeness and customer tiers. Unit-price statistics use DOUBLE for statistics only; stored money stays in whole cents.
- The Playground loads through the normal import path only into a vault with no other files, uses names starting "Playground - ", and can be removed. Its manifest's dollar values are exact sums over the generated rows.
- Real-export test files (UCI Online Retail, CC BY 4.0) stay in git-ignored `test-results/real/`; CI uses a synthetic look-alike.

# Chunk 4D assumptions — 2026-11-04

- **Margin engine v2** (`lib/margin/engine.ts`, `decimal.ts`) is a decimal port of `margin-engine.js`: prices, costs, percentages and FX rates are exact decimals (scaled BigInt). Each waterfall component is rounded once, half away from zero, to whole cents; pocket and margin are integer subtractions, so the components always reconcile. Margin rates are basis points (0.01%). FX still rounds to four decimals as v1 did; inverse rates now divide exactly instead of multiplying by a float 1/rate. The float engine stays for the legacy server paths and its golden tests are unchanged.
- **Pass-through (v2)** keeps the margin rate by setting the new pocket to new cost x old pocket / old cost and rounding the price to the cent. v1 returned an unrounded float price. On the golden case the v2 price is v1's price rounded to the cent and the rates are equal in basis points.
- **SQL mirror** (`lib/margin/sql.ts`): the same arithmetic in DuckDB on HUGEINT scaled integers with an explicit round-half-away-from-zero (`//` truncates in DuckDB). It covers inputs with at most six decimals. Price, cost and FX *selection* (rules, history, rates) stays JS-only, because the vault stores invoiced line totals.
- **Unknown cost** is never zero. A line with NULL cost contributes to list, discounts and pocket, but its pocket is shown as "Pocket with unknown cost (left out of margin)". Margin and margin rate use only lines with a known cost. The margin leak rules skip those lines and the report counts them.
- **Returns and credits**: negative-quantity sales rows still go to Fix Later at import ("Negative quantity"). The group now has "Load as returns and credits". Each row is validated by the import's exact SQL on its absolute values. Every amount must be zero or negative (otherwise it is coded `credit:sign` and stays in Fix Later). The row loads as a signed `credit` line under its original source file and row. Credits are a separate "Returns and credits" step in the waterfall, between sales pocket and net pocket, and are never leaks. Credit memos with a positive quantity and a negative amount (`list_amount:negative`) are still not loaded. Return freight is not modelled: a credit's freight must be zero or negative.
- **Vault schema v5**: `sales_lines` is rebuilt (DuckDB cannot drop CHECK constraints) with `line_kind` and sign rules per kind. The new tables are `agg_cpm` (customer x product x month x kind), `agg_cm` (customer x month x kind), `agg_p` (product x kind) and `recon_issues`, and `roi_ledger` gains three columns. Aggregates are BIGINT: DuckDB-Wasm scanned HUGEINT columns about 40x slower (232 ms vs 6 ms for 200k rows, measured), and a sum past BIGINT fails the rebuild loudly. Views read the smallest table that can answer: customer-only questions use `agg_cm`, product-only questions without a month range use `agg_p`, everything else uses `agg_cpm`. All aggregates are rebuilt from the lines after every change (import, removal, Fix Later load, credits, Playground) in one transaction with reconciliation. Opening a v1-v4 vault upgrades it and builds them.
- **Reconciliation**: per customer x month, in total, and for each rollup, the aggregates must equal the imported lines (count, list, discounts, rebates, freight, known cost, known-cost lines and their pocket) to the cent. Each invoice must belong to one customer and one month. Differences are stored in `recon_issues` and shown in Data Hub under Reconciliation. Nothing is adjusted: the user rebuilds the totals from the lines, fixes the file, or accepts the difference (audited). The sales files carry no separate invoice-total column, so "imported totals" means the imported line amounts.
- **Leak finder rules** (`lib/margin/leaks.ts`, thresholds in `RULES`). A tier's peer rate is its modal discount rate on lines of $100 or more. It needs 2+ customers, 20+ lines, and the mode on 30%+ of those lines. Until 4E guardrails exist, it is also the tier floor. A line is over-discounted at 1+ point above that rate.
  - If 90% or more of a customer's lines are over-discounted (5+ lines), the whole customer is one finding. It is "billed at a better tier" if its modal rate equals another tier's peer rate, otherwise a "discount outlier".
  - Otherwise, a customer x category with 90%+ over-discounted lines (3+) is "below tier floor". Scattered lines 5+ points over are a per-customer discount outlier.
  - Leak per discount line = discount - list x the customer's own tier peer rate, rounded to the cent.
  - Unrecovered freight = the freight on lines where freight is more than 10% of list (no "freight billed" column exists, so this share is the proxy).
  - Margin rules use known-cost lines only. Each loss-making line sits in exactly one finding, with leak = cost - pocket: first "vendor cost rise not passed on" (a vendor cost increase effective on or before the sale), then "price below cost" (list - discount < cost), then "other lines sold at a loss".
  - A line can appear in several findings of different kinds. The headline counts the overlap once: per line, everything except the largest leak is subtracted.
- **Playground L2 revised**: at 25%, C-0042's override equalled tier T11's schedule rate exactly. No data-only rule could tell it apart from L5's tier mismatch. It is now 32%, deeper than any tier (T01 = 30%). L2 is now 598 lines / $1,233,201.76 and L4 is 159 lines / $108,243.79, because C-0042 also buys thin SKUs. L1, L3 and L5 are unchanged. The manifest was regenerated from the generator (blueprint section 22 entry 12).
- **ROI tracker v1**: one `roi_ledger` row per finding (id from the finding id); a re-run updates the amount. Findings on Playground data are marked `sample`, never counted, and deleted when the Playground is removed. "Recovered" remains Phase 2.
- **Leak Report PDF**: a small PDF 1.4 writer in the worker, using standard Helvetica and uncompressed ASCII streams, with no dependency. Non-ASCII text is replaced with "?". The page receives a Blob and downloads it via an object URL; nothing is uploaded, and each export is audited.
- **Memory**: the 512 MB DuckDB guardrail is kept. The leak finder's line views are never materialised; a hit is five numbers (finding hash, source number, line, leak, basis). Reconciliation finds split invoices with min/max per invoice, not COUNT(DISTINCT). Show-the-math scans lines (about 400 ms at 2M, measured) and the leak finder takes about 8 s at 2M (measured). Neither is a section 5 target.
- The real UCI export (local only) has no cost or tier columns, so no margin or discount leak can be found in it. Its Leak Report states that.
## Chunk 4E assumptions — 4 Nov 2026; CI-verified

Verified in [MarginDesk CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), 4 November 2026, commit `7fe3db82951e82d5ba8a049158a7ef0a17a69597`. The authenticated local-vault gate ran 25 named checks (including pricing UI); 163 unit tests passed. Performance measurements and headed/real-ERP limits below remain unverified in CI.

- Only 4E; no 5A. Supabase migrations/lock and local V1–V5 SQL stay frozen; new local schema v6 holds owner, rule revisions, saved price diffs and guardrail scope.
- Guardrails are absolute unit prices in integer cents per named tier/category. Red blocks approval; yellow requires the one named Pricing Owner. Initial owner names themselves; reassignment requires that owner. The worker uses the authenticated scope user ID, never a caller-provided approver. Device-owner tampering is outside this local role boundary; authoritative role/licence work is 5A/5B.
- Cost triggers compare a supplier's latest two dated costs per SKU (same-day tie: row ID). A strict greater-than threshold is used. Effective current base price is the most recent zero-quantity-break product/tier matrix row, falling back to product list. Customer-specific contracts and quantity-break rows are preserved. A simulation copies at most 250,000 SKU/tier pairs; no invoice history is copied. Missing prices are excluded; missing cost stays unknown.
- Preview margin impact holds historical sale quantity, volume, cost, discounts and freight fixed; it is an estimate of unit price delta times quantity, not recovered revenue. Invoice history is never repriced. Imported data, guardrails, owner changes, rule revisions and approvals invalidate stale previews. Other runs may be kept for history but need simulation again.
- All five ERP export layouts plus generic are UNVERIFIED until tested on real ERP imports. Outputs have text prices, formula-safe cells and an audited change log.
- Folder handles and schedule timestamps are stored locally in IndexedDB; business data remains encrypted snapshots only. Folder auto-backup runs after approval and checks the schedule every minute while the vault is unlocked. It cannot run with a closed/locked browser. A 7-day reminder is the default. File downloads cannot be confirmed as saved, so they do not suppress folder-backup reminders.
- Restore is into an empty local vault for the same identity/workspace and needs the original passphrase. Existing data is never replaced. Tests inject an OPFS directory handle instead of a real picker; the real Chrome/Edge picker and disk permissions remain unverified unless exercised headed.

## Chunk 5A assumptions - 4 Nov 2026; local evidence only until CI

Only 5A; no 5B. Supabase migrations and `migrations.lock` are untouched. New local vault schema v7 (V1-V6 SQL frozen) adds `role_assignments`, `access_settings`, `cleanup_fixes`, `cleanup_changes` and `setup_progress`; no seed rows, because copy-on-write copies whole tables into a fresh schema.

- **Roles are a worker policy, not a cryptographic boundary.** A vault has one passphrase, so a person who holds it and the device can always open the whole vault with developer tools. What 5A guarantees is narrower and tested: every command goes through one door (`lib/vault/dispatch.ts`) that checks the role's capabilities (`lib/roles/access.ts`) before any query runs, and the status totals query leaves cost and margin out of the SELECT for a role without cost access. A Sales Rep view therefore never receives a cost value from the worker. Per-person cryptographic separation needs the Phase 2 collaboration relay and per-user keys. The privacy copy must not say otherwise.
- Seven roles (blueprint section 3). Capabilities: view, guards (price floors), cost, data, pricing, approve, export, reconcile, audit, roles, backup. A person's capabilities are their role's, plus everything a Pricing Owner may do when they are the named Pricing Owner. Owner / CFO has everything except approve; approval needs the named Pricing Owner (single-level, as in 4E). Sales Rep has view and guards only; the owner can switch cost on for reps, which adds the cost capability and nothing else.
- Roles are stored per sign-in ID in the vault. A vault with no role rows (made before 5A) belongs to whoever unlocks it, who becomes its Owner the first time roles are read. After that, a person with no row is a Sales Rep (least privilege). Nobody can change their own role, the last Owner and the named Pricing Owner cannot be demoted or removed, and only an Owner or the named Pricing Owner grants Owner or Pricing Owner.
- "Preview as" lets an Owner see another role's view. It intersects capabilities, so it can only remove access, and it resets on lock. Any role may call it (it can only narrow), which lets an Owner leave a preview.
- **Pricing Owner required at setup.** The worker refuses `create` without an owner name; the creator becomes Owner and the named Pricing Owner in the same encrypted snapshot. A vault made earlier without one shows a required card on Home; guardrails, rules, simulations and approval refuse until one is named (approval already needed it).
- **Duplicate SKUs.** Look-alike product IDs are grouped by ID with everything except letters and digits removed. A group whose members differ only in case or surrounding spaces is "certain"; one that also differs in punctuation (AB-100 / AB100) is "possible" and is shown with a warning. The kept product is the one with the most invoice lines, then one that came from an item master, then the smallest ID. A merge re-points invoice lines, vendor costs and price rows, fills empty description, category, cost and list price on the kept product from the duplicates, and deletes the duplicate product rows. Invoice amounts never change (totals are asserted equal before and after). A merge moves at most 250,000 lines. DuckDB refuses to delete a product row in the transaction that re-pointed its lines, so the delete is a second transaction; if it fails the data is already valid and applying the merge again finishes it.
- **Undo.** Every fix journals each cell it changed (before and after). Undo restores only cells that still hold the value the fix wrote; cells edited since are left alone and counted as skipped. Undo of a merge re-creates the duplicate product rows that are missing and moves the recorded lines back. A fix can be undone once.
- **Units of measure** port the Chunk 2A rules into `lib/cleanup/uom.ts`: a unit is never guessed (blank or unknown has no conversion and is never treated as EA), conversions are registered pairs usable in reverse, and quantities round to four decimals half away from zero. Spelling variants (Each, EACH, ea.) unify to one code; units with different meanings (PC and EA, CS and BX) stay different. The vault's sales lines carry no unit column, so conversions are a tested engine function that no import path calls yet; 5A applies only the spelling fix, and an unknown or blank unit needs the user's explicit choice.
- **Missing categories** are grouped by the leading letters and digits of the product ID. A category is suggested only when at least three categorised products share the prefix and at least two thirds of them agree; otherwise the user types one. This is a heuristic, shown with its evidence count, and every fix is undoable.
- **Cost basis** (blueprint: last, average or replacement). Per product: last = the most recent dated vendor cost (tie: latest row ID); average = the mean of that product's dated vendor costs, equal weight per cost row (there are no purchase quantities); replacement = the item master's current cost, else the last vendor cost. Each sold unit is costed at that one unit cost, rounded half away from zero once per customer x product x month row. A product with no cost under a basis is left out of that basis' margin and its lines are counted, never costed at zero. The invoice cost column is the waterfall's cost; the browser gate checks the group totals add up to the waterfall. **The waterfall, leak finder and reports keep using invoice cost** (it reconciles to the ERP); the chosen basis is stored per group in `cost_basis_settings` and drives the comparison view. Applying a chosen basis to the waterfall is not built.
- **Setup checklist.** Seven steps stored in `setup_progress` and kept once reached. import = a real (non-Playground) sales history file; map = a real item master, customer list or vendor cost file, or a saved recipe; fix = an import exists and either no rejected rows are open or Fix Later or cleanup was used; report = a non-sample leak finding or non-sample Leak Report; rule = a saved rule; export = an audited ERP price export; team = two or more roles assigned, or marked by hand (teamwork happens outside the vault). The day shown counts from the vault's first audit entry. Playground data never counts.
- **ROI tracker v1** is on Home for roles with cost access. It is the running total of leak dollars *found* (sample findings kept apart); "recovered" arrives in Phase 2. It is a finding total, not recovered money.
- Not measured: cleanup scan, cost basis and Home timings at 1M lines are in `CHUNK_5A_VERIFICATION.md` if recorded there, otherwise unmeasured. Multi-user behaviour (two real sign-ins on one vault) needs the relay and is not tested; roles are tested through the dispatcher, and the browser gate drives a role preview.- **Merge all certain duplicates** merges only groups whose IDs differ by case or surrounding spaces (never punctuation-only groups) and skips, rather than fails on, a group over the 250,000-line limit. Each group is its own journaled fix; the margin totals are rebuilt and saved once, and the UI offers one undo for the whole batch (newest first, one rebuild). The batch button itself is covered by the worker-level Chrome suite and the real-file run, not by a UI click test.

# Chunk 5B assumptions — CI-verified (CI #65, Restore Drill #16)

- Scope is control-plane slimming, authoritative pilot licences and the carried security items. No 6A and no destructive table retirement. RETIREMENT_PROPOSAL.md needed separate user approval; it was approved with revisions on 5 Nov 2026 (tables drop in chunks 6R and 8R, not in 5B).
- LEGACY_BUSINESS_ENABLED defaults off and is server-only. Class C/X APIs stop before reading a request or accessing data; pages 404. Historical business audit JSON is never returned by the control audit endpoint.
- Licence assertions are Ed25519-signed server-side, bound to workspace/user/device, with a one-hour normal life and up to 24 hours of offline grace, never beyond the licence end date. Online refresh is attempted every five minutes. Expiry, an explicit revocation/unseated result, invalid signature, or no valid cached assertion makes the vault read-only; no data is deleted. Revocation while truly offline can only take effect by the fixed grace deadline.
- Starter: one seat and one location/ERP profile; Professional: five seats and multiple locations/profiles; Scale: 15 seats, multiple locations/profiles, 200k SKUs and 2M lines (provisional 1M until 14 Nov 2026). Professional remains 100k/1M, Starter 20k/200k. No artificial numerical location cap is added to the two multi-location tiers. plan_feature is never authoritative.
- Untracked .claude/ belongs to the existing workspace and is left alone.

- 5B adds four public tenant tables (42 total) and 26 pgTAP checks (188/191). New tables have operation-specific grants: licence read only; seats SELECT/INSERT/DELETE; locations CRUD; devices SELECT/INSERT/UPDATE. No TRUNCATE, no platform grantees. Devices remain revocation tombstones unless an owner explicitly removes their seat (cascading its devices).
- Reviewed global security-metadata exception: `rebatehq_private.actor_key` has nullable tenant_id constrained to NULL, forced RLS, owner-only ACLs and an audit trigger that records only key-operation metadata. It stores no business data. The app role has no schema USAGE or key access. This table and the private rate sequence are included in dumps and strict restore comparisons; secrets are never printed. The private schema is not exposed through Supabase's Data API.
- Server audit identity is HMAC-SHA256 signed by the trusted server after Auth verification, bound to subject, real actor, backend PID, transaction ID, expiry (five minutes), and nonce. Both the audit trigger and append boundary verify it. `app.real_actor_id` is no longer trusted in production code. Administrative seeds/restores can write with a NULL actor or their verified operator context; that is not a user-facing privilege.
- Failed-login byte limits: email 320, IP 45, user agent 1000. Fixed NULL-tenant/NULL-actor event only. DB throttling: 8 committed events per matching email hash/IP in ten minutes, plus a serialized global 1000 attempts per ten-minute bucket enforced by a private sequence. Sequence attempts survive rollback; per-key row-based limits do not. Clock/window and distributed HTTP/proxy hardening remain operational limits. Rolling back tests advances the security counter deliberately but never leaves tenant rows.
- Licence grace uses the device wall clock; this is not tamper-proof offline DRM. Online HTTP denials/invalid signatures clear authority; transport failure may use a signed cache within its deadline. No valid assertion means read-only. Existing over-cap vaults may be read/backed up but new loads are rejected. Local capacity selection is restricted to the licensed tier or lower; the worker clamps it too.
- Fresh and populated local SQL runs use Supabase auth stubs and pgTAP assertion stubs in PGlite. They are local only, not evidence of deployed Supabase/Auth behavior. The authenticated CI privacy gate, new migration and restore procedure have since passed in CI #65 and the user-run Restore Drill #16 (`38911ee`, local target). No real Supabase credentials, Docker or psql are available locally. Future manual Restore Drills are still triggered by the user, not dispatched by the agent.

- Offline grace covers an already loaded shell and the worker/cache protocol. Offline cold navigation to the authenticated server-rendered /home page is not provided; the later offline-PWA chunk remains deferred. No claim of offline cold-start support is made.

After an operator upgrades the workspace licence, an Owner/Admin can choose **Use licensed capacity** in local Settings. It updates only the encrypted vault’s capacity metadata, with a local audit entry; it neither sends rows to the server nor recreates the vault. Lower profiles stay available at setup.

## Chunk 7A — collaboration relay (5 November 2026, unverified)

- User explicitly chose to proceed without pilots/prospect input; the customer-track
  gate is not met. Shared quote/price-change/rebate references support later 7B/7D,
  without building either feature now. No hosted Supabase project exists.
- RELAY_DESIGN.md was written before implementation. Sharing is workspace-wide,
  with separate device encryption/signing keys, verified fingerprints, random
  epoch keys and rotation after membership/device changes. The vault passphrase
  is never the sharing key and no server recovery escrow exists.
- Relay is operator-disabled by default (RELAY_ENABLED); CI/local harnesses enable
  it explicitly. Independent cryptographic/operational review is still open before
  production enablement. Do not treat local tests as CI or hosted evidence.
- One new Supabase migration only. CLI created 20261105092750, earlier than the
  already-locked 6R filename (12:00); its empty, unapplied file was renamed to
  20261105130000_chunk7a_ciphertext_relay.sql to preserve migration order.
  Only pending lock fields are appended; applied entries/hashes stay unchanged.
- Four new tables raise the server inventory from 20 to 24. A composite unique
  control-plane key on licence_device enables a tenant-safe foreign key. No
  legacy quote/approval/share-link table is reused. The browser vault moves to v9.
- Presets use integer minor units: standard needs one approval through 500000
  (5000.00), two above; conservative always needs two. Distinct non-requester
  approvers must be owner/manager control-plane members designated as Pricing
  Owner then manager. Future 7B validates the actual quote revision; a reference
  alone does not prove the sender's amount. Phase 1 export approval is unchanged.
- Initial ciphertext quota is 16 KiB/message, 16 MiB/10000 events per workspace,
  with 60 devices and 256 epochs. No automatic pruning. Comments/requests are
  append-only; signed invalid operations are rejected visibly without poisoning
  the whole cryptographic stream. No automatic re-signing after a CAS conflict;
  sync and explicitly discard/recreate the pending operation.
- A server can withhold an unseen tail or isolate clients on valid forks until
  heads are compared. Known-head rollback, observed gaps/replays and alterations
  fail closed. No global transparency or instant offline revocation is claimed.
- Local Admin/IT cannot open collaboration business views. Other business roles
  gain a distinct collaborate capability; server approver/admin authority still
  comes from fresh membership, not a local role preview. Online sharing only;
  encrypted local backups retain the keys/history already possessed.
- Restore Drill must be triggered by the user after CI is green. Until that run
  passes, the new migration stays pending and 7A is not marked complete.


7A verification inventory is **152 fresh / 155 restore-mode pgTAP checks**, with
planned == ran and 24 public tenant tables. Local vault v9 has 31 tables. Local
headless Chrome 156.0.8078.80 and Edge 156.0.4314.58 passed the 11-check relay
round trip on 5 Nov 2026 using production UI/worker plus a PGlite test transport;
this is not real-auth/hosted evidence. The authenticated real-local-Supabase CI
gate remains unverified until its actual run is linked. Ten applied migrations
and their lock entries stay unchanged. The new migration stays pending until
CI and the user's restore run pass. Concurrent blueprint v2.3/7U planning edits
were observed during this work; they do not authorize implementing 7U or another
chunk. This chunk makes no blueprint changes and does not commit those edits.

## Chunk 7U — UX foundations (5 November 2026, CI-verified in CI #86)

- **Languages:** English (en-US formats), Spanish (`es`, formal *usted*, es-US formats), French (fr-FR formats) and Canadian French (fr-CA, overrides only where wording differs). Machine-assisted translations; native-speaker review is required before a language ships to a pilot (blueprint section 13).
- **No currency column yet:** money shows as an exact decimal amount with locale separators. Screens that already showed `$` (Margin, Leak Report) keep a currency symbol with USD assumed, as before 7U. Real currency handling belongs to the later FX work.
- **Display preferences** (language and theme) are UI settings, kept in `localStorage` and first-party cookies (`rebatehq_locale`, `rebatehq_theme`). They hold no business data.
- **Client screens render English for the first paint** (server rendering and hydration), then apply the stored language. Server-rendered account pages use the cookie or Accept-Language.
- **Worker-created text** carries its message key invisibly (Unicode tag characters), so stored text such as Fix Later reasons, cleanup summaries, leak titles and rule explanations translates at render time. Vaults saved before 7U hold plain English for these fields; it is shown as stored.
- **Kept language-neutral on purpose:** ERP exports and their change log, audit-log details, mapper header synonyms, Playground sample data and the invitation e-mail body.
- **Not translated:** the legacy server pages behind the default-off flag (`app/legacy/**`, `app/dashboard`). They are retired in 8R.
- **The pseudo-locale is a test tool.** It is offered in the lab harness and reachable through stored preference.

## Chunk 7B — Quote Desk, Price Check, credit signal (6 November 2026, local checks only)

- **Credit signal thresholds** (`CREDIT_RULES` in `lib/quotes/credit.ts`):
  - **Red:** 10% or more of the open balance is over 90 days, utilisation is above 100% of the credit limit, there is a balance with a zero limit, or DSO is above 75 days.
  - **Amber:** 10% or more is over 60 days, utilisation is 80% or more, or DSO is above 45 days.
  - **Unknown:** no AR aging profile. No limit on file is not a risk by itself.
  - These are a documented starting point, not a credit policy; pilots should confirm them.
- **One AR aging profile per customer.** The newest imported report replaces the previous file (Replace…), and balances are not summed across files. AR balances are workspace currency, and a negative (credit) balance is rejected to Fix Later instead of being guessed.
- **AR aging file kind is kept in `source_kinds`.** `source_files.role` keeps its v1 CHECK list because DuckDB cannot rebuild a table that other tables reference. An AR file is stored as `customer_list`, and every reader of the kind uses `coalesce(source_kinds.kind, role)`.
- **Quote Desk and Price Check need Professional or Scale** (blueprint section 14 tier table). Starter vaults show an upgrade note, and the worker refuses the commands.
- **Who approves a below-floor exception on one vault:** Sales Manager, Pricing Owner and Owner / CFO (new `quoteApprove` capability).
  - Blueprint section 3 says the Sales Manager "approves discounted quotes".
  - `quoteApprove` is separate from `approve`, which stays with the named Pricing Owner for price changes.
  - A Pricing Manager does not approve quotes.
  - Two-level approvals use the 7A relay presets.
- **What counts as an exception:** only a line below its floor needs a reason and an approval. Below target is a soft warning. A line with no guardrail for its tier and category is a warning, not an exception.
- **Line prices are snapshots.** A quote line keeps the book price, guardrail, zone and unit cost from when it was last priced. "Update prices" re-prices every line. Quote numbers are `Q-YYYY-0001` per vault and year, so the relay link matches the author as well as the number.
- **Rep quote scope:** a role without cost and without `quoteApprove` sees only the quotes it created.
- **Relay amount currency is USD,** as in 7U (no currency column yet). Only the quote number, title and price total go to the relay.
- **Price Check credit:** shown only when a customer is entered; without a customer the signal is "unknown".
- **Relay decisions on a quote** (security-review follow-up): an approval from the 7A relay counts only if every approver holds `quoteApprove` in the rep's vault and isn't the quote's author. The shared number and price total must still match the quote. Editing a quote or deciding it locally clears its relay link. An approver counts only with an explicit role in the rep's vault (Settings → Roles) or as the named Pricing Owner. An unknown person, or a vault with no roles yet, grants nothing, and the "whoever opens it is Owner" fallback for pre-5A vaults never applies to relay approvers.


## Chunk 7C-1 — pricing operations (7 November 2026; CI-verified)

- Scope is items 1–5 only. No competitor log, editable grid, sliders, extra leak
  types or landed check (7C-2) is started. The Playground manifest is unchanged.
- All new reads/writes and text generation run in the existing vault worker.
  No server route, Supabase SQL, migration or migrations.lock changes. Local v11
  adds price_changesets and price_changeset_rows (37 local tables); v1–v10
  definitions stay immutable and old encrypted snapshots migrate forward.
- Bridge method: group by product/customer/current customer branch, for the
  chosen month and the preceding calendar month. On costed lines, including
  signed credits, let q be net quantity in integer ten-thousandths, p net pocket
  cents (list minus discount, rebate and freight), and c invoice cost cents.
  Unknown-cost lines are excluded and counted; no zero cost is assumed.
  For cells with q0>0 and q1>0: price=RHA((p1*q0-q1*p0)/q0);
  cost=RHA((q1*c0-c1*q0)/q0). Otherwise those two effects are zero.
  With Q=sum(q), volume=RHA((Q1-Q0)*(p0-c0)/Q0), or zero if Q0<=0.
  Mix=(p1-c1)-(p0-c0)-price-cost-volume. RHA is half away from zero
  per cell. Totals and all drills sum those same rounded cells, so the identity
  holds exactly; residual cents go to mix. Empty, new/lost and nonpositive-net
  quantity cells need no guessed unit rate. This sequential attribution is not
  causal inference. Units and current branch mappings are used as imported.
- Planner uses positive sale quantities across all imported history, not an
  annual revenue forecast; credits are excluded from its quantity baseline. The
  observed quantities are repriced under today’s resolver: sales that still select
  unchanged quantity breaks or a separate customer contract contribute zero uplift.
  It changes base quantity prices only (qty_break=0), for a customer, tier or
  category. Customer contracts retain their end date and tier specificity;
  quantity-break schedules and other scopes are unchanged. Zero-change pairs
  are omitted. A scope over 250,000 pairs fails rather than truncates.
- Reversal drafts restore the selected version's before amounts on its changed
  pairs, dated today. They are not whole-database/time-travel restores. Existing
  4E versions retained amounts but not historical contract definitions. Later
  conflicting prices or expired contract dates block reversal. Current guardrails,
  data revision, date, named Pricing Owner approval, versioning and export all
  still apply. Only the approval path changes the local price book, as in 4E.
- Customer-specific exports use the generic layout with customer_id. Other ERP
  layouts are refused for these drafts rather than discard customer scope.
  All ERP layouts still require validation against a real customer's ERP.
- Exceptions use the shared Quote Desk matrix lookup, with date validity and
  quantity breaks, but require a customer-specific row for contract comparisons.
  They compare exact invoiced-price/unit ratios (list minus on-invoice discount)
  against current floor and dated contract, consistent with the existing floor
  leak and Quote Desk. Freight and off-invoice rebates affect the margin bridge,
  but cannot create a false invoiced-price exception;
  gap is the higher line threshold minus pocket, counted once. Credit lines are
  excluded. Current floors are not historical floor snapshots.
- Expiry lists price_matrix end dates today through 30/60/90 days inclusive.
  End dates remain exclusive for pricing, so an end date today is already inactive.
  It never renews or changes a contract.
- Increase letters are local UTF-8 text in the selected language, without cost,
  prices or margins; a draft notice, not an automatic customer communication.
- All 7C-1 features require Professional/Scale and existing cost/pricing capabilities.
  Sales Rep has none of the new commands; decision-16 classification stays exact.
  Translation quality, deployed behavior and hosted sign-in remain unverified.

- Matrix ties use customer specificity, tier specificity, product specificity,
  highest eligible quantity break, latest start date, then ascending stable row ID.
  The planner and quote book use the same lookup. Bridge volume is rebased when
  the dimension filter changes; each filtered result reconciles independently.

- Bulk price resolution shares the scalar policy and stable tie-breaks, using
  equality joins, grouped lookup inputs and RAM-only staging. The production
  512 MiB limit is unchanged. A local 100k-line/20k-price regression covers both
  a narrow scope and 20,002-pair tier approval/reversal. This is correctness and
  memory-regression evidence, not a 1M/2M performance claim. Versions currently
  show the latest 100 approved entries; older records are not deleted.

Verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`: 239 unit tests, 41 named authenticated
local-vault checks and 11 authenticated relay checks. Local Chrome/Edge each
passed 39 vault + 11 local-transport relay checks. Hosted behavior, native-language
review and 1M/2M feature performance stay unverified. An absent month means no
imported rows, not proof of zero business activity; file coverage must be reviewed.

## Chunk 7C-2 assumptions (8 November 2026; verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`)

- Scope is items 6–10 only. No 7D or later work. Blueprint unchanged. Local vault
  v12 adds five tables (42 total): competitor_prices, price_grid_drafts,
  price_export_receipts, price_landed_checks and sales_service_flags. No Supabase
  object, inventory, locked migration or hash changes. The encrypted v1 fixture
  remains frozen and upgrades forward through v12.
- Competitor observations are manual, in workspace currency, for a product,
  competitor, price, observation date and plain-text source. Sources are never
  fetched. The comparison uses today's existing resolver at quantity one and
  optional customer context. Observations do not automatically change prices.
  Entries survive product cleanup as historical evidence; an absent product
  cannot be silently retargeted. The current screen shows the latest 100 entries.
- Starter's Basic grid edits product list prices only, at most 50 changes per
  draft. Professional/Scale also edit existing matrix rows (customer, tier,
  category and quantity breaks), up to 500 changes per draft. Pages have 50 rows.
  Only prices are editable; Excel paste is one column anchored at the focused
  visible row. Decimal points, two places maximum, no grouping, signs, formulas,
  empty cells or extra columns. Invalid paste is rejected as a whole.
- A grid draft preserves complete scope and before values as bounded JSON with
  integer-cent/decimal strings. It reuses rule_runs, rule_revisions and
  price_versions, current guardrails, date/revision conflicts, named Pricing
  Owner approval and hash-chained audit. It never writes live prices on edit.
  Matrix changes are dated today (or retain a future start); historical rows are
  closed, not repriced retroactively. End dates and quantity breaks are retained.
  Reversal is another guarded draft; conflicting/expired rows block it.
- Grid impact reprices positive historical sale quantities whose current resolver
  selects the edited row, including quantity breaks and overrides. It is an
  estimate, not a revenue forecast; future-dated prices may have zero currently
  resolved units. Generic/category rows use the strictest applicable guardrail;
  category rows have unknown unit cost, not a guessed aggregate margin. Grid
  exports use the generic layout with all scope columns and price_kind; other ERP
  layouts are refused. A real ERP compatibility review is still required.
- Slider conditions come from the selected SAVED rule. Worker calls are debounced
  200 ms with stale-response protection. Approximation aggregates unrounded
  uplift over the cached bounded rule base; exact release rounds unit prices and
  line impacts with the existing half-away-from-zero rule. Neither writes a run.
  Save the rate and explicitly simulate before approval. Cache keys include rule,
  data version, pricing revision and UTC day. No new 1M/2M performance claim.
- Cost-to-serve groups sale lines by source file, invoice, customer and date;
  absent invoice numbers remain individual lines. A length-prefixed key avoids
  ambiguous concatenation without a DuckDB extension. An invoice must have known
  costs on every line, freight > 0, margin before freight >= 0 and margin after
  freight < 0. "Small" is net invoiced sales <= SMALL_ORDER_CENTS (25,000 cents,
  250.00 workspace currency). This is a review heuristic, not freight rating.
  Free delivery requires explicit local confirmation on the Cost to serve tab;
  it is never inferred from a freight charge. Returns/credits are excluded.
- Invoice loss is allocated only over its negative-margin source lines by
  cumulative integer division weighted by each line's loss. Allocation sums to
  the invoice loss and never exceeds a line's loss. The existing per-line MAX
  overlap rule counts that loss once in the deduplicated total. Freight is not
  deducted again. The original five planted Playground findings stay unchanged;
  derived cost-to-serve findings may overlap them. ROI v1 records identified
  findings, not guaranteed recovery; Phase 2 ROI reconciliation is separate.
- Every successful price export now writes an immutable receipt in the same
  audited transaction as export status, including exact scope, cents, profile,
  time and local SHA-256. Landed checks default to the latest receipt, allow an
  earlier receipt, and never compare against a moving current price book.
  Existing exports made before v12 need re-exporting to create a receipt.
- Landed input is one-sheet XLSX or UTF-8 CSV/TSV, <=32 MiB and <=300,000 rows.
  Keep the original scope columns, decimal prices and ISO dates. No formulas,
  macros or ambiguous/missing columns are accepted. Duplicate scopes, missing
  scope and different prices are distinct findings with file row references.
  Only receipt rows are assessed; unrelated ERP rows cannot count as applied.
  Checks and receipts persist encrypted, and history lists the latest 50.
- Every new command has a capability and read-only/mutation classification;
  Sales Reps cannot call any of them. Pro features enforce the signed licence,
  including advanced drafts after downgrade; Basic grid remains in Starter.
  Worker SQL/payloads never go to a business-data API, console or analytics.
  New strings have en/es/fr message keys, fr-CA inherits; native review remains
  unverified. Headed/manual UX, deployed auth and real ERP results are unverified.

Additional 7C-2 review controls: grid copies preserve raw matrix category and
raw tier (including blank versus NULL); reversal checks the applied scope as
well as its amount. Zero-list-price sale lines remain in loss/evidence queries,
so free goods carrying freight cannot inflate allocations onto another line.
Their discount rate is unknown when its denominator is zero. The slider's input
uses basisPointsDecimal, without the display formatter's percent suffix.

Matrix rows already starting today or later are updated in place at approval,
so their stable IDs and resolver tie-break order survive. Earlier rows are closed
and a new current-dated period is inserted. Draft creation does neither. Leak
cache identity includes the licensed cost-to-serve gate as well as data version;
a cached Pro result cannot appear after downgrade to Starter.

7C-2 verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786)
on `05ff468`, 8 November 2026 (Asia/Kolkata): 249 unit tests, 43 authenticated
local-vault checks and 11 real-authenticated local-Supabase relay checks. Local
v12 has 42 tables. Only the exercised local flows are proven; hosted/ERP/native
language/manual recovery and 1M/2M feature-performance limits above remain open.

## Concurrent blueprint v2.4 update (scope boundary)

While CI #104 was finishing, a separate commit, `51001c0`, promoted BLUEPRINT.md
and AGENTS.md to v2.4 (section 22 item 24). It was authored outside this 7C-2
implementation and is preserved. The original 7C-2 code was already committed
as 05ff468 before that update. "Blueprint unchanged" in the 7C records means
no blueprint edits by this chunk, not a claim that no parallel commit exists.

The acceptance scope completed here is the original v2.3 items 6–10. Newly added
v2.4 work is not claimed complete: competitor top-3 margin alternatives,
workspace/import FX conversion, Firefox verification/support, customer health
alerts, relay sync-status UX and the new Home framing require separately scoped
work; supplier claim exports remain in 7D and carrying-cost/Safari work is later.
Do not start any of those from this close-out. Current evidence covers Chrome
and Edge and single-workspace-currency observations only. The execution plan
needs a user-scoped reconciliation with v2.4 before adding that work.


## Chunk 7C-3a — currency and Firefox (8 November 2026)

- Local schema v13, still 42 tables. This chunk is CI-verified in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026; see CHUNK_7C3_VERIFICATION.md. No Supabase migration or lock change; 24 public tenant tables and the 152/155 pgTAP plan stay unchanged.
- The encrypted vault owns the workspace ISO currency. USD is the additive default for existing vaults and old batch records; no stored amount is converted during upgrade. Supported currencies have two minor-unit decimals (including USD, CAD, AUD, GBP, EUR); zero/three-decimal currencies require another scale design and are rejected.
- A rate means workspace units per one source unit. Each file/batch has an explicit source currency and manually entered rate (positive, below 1,000,000, at most 12 decimals). Same-currency imports require exactly 1. No browser or server exchange-rate fetch. Recipes do not reuse a prior batch's rate/currency.
- Conversion uses exact decimal/integer arithmetic and rounds half away from zero to workspace cents. Existing same-currency canonicalization remains identical. Explicit foreign-currency amount columns retain up to six source decimals until FX rounding. Existing unit×quantity and percentage canonicalization occurs before FX; header freight and item-derived costs use their own already-converted workspace values and are never converted again.
- Rejected-row corrections remain in source currency, with the saved batch FX applied on recheck/returns. History/show-math retain source currency, rate and workspace currency; header-file rates are retained alongside the owning sales batch. Rates are canonical decimal strings, not JS numbers. Audit events link the source batch without logging amounts or rates to a server.
- Block workspace currency changes while business data exists, including quotes/rules/receipts/relay state, rather than relabel stored cents. A new empty vault and re-import is the supported currency-change path. No automatic revaluation. Amounts entered later (guardrails, quotes, competitor prices) are in workspace currency. Received encrypted references retain and display their sender's explicit currency; they are not silently converted.
- ERP exports remain workspace-denominated; only the generic layout/change log carries an added currency column. Named ERP layouts are unchanged and remain unverified against customer systems. Generic landed checks reject a changed currency.
- Chrome and Edge remain primary desktop targets; Firefox support is verified by its full required 44-check Linux CI lab gate in CI #108. Safari is not supported. One forced Windows Firefox reinstall repaired its SideBySide/mozglue launch failure. Native startup alone is not an application test; browser-gate results are recorded separately.
- CI job limit is raised from 45 to 60 minutes at the user's request for Firefox headroom. Both installs stay bounded/retried and both browser steps keep their 25-minute limits. No phase or chunk beyond 7C-3a is authorized by this change. Blueprint unchanged.

- Source currency is a per-file/batch choice. Each file must contain one source currency; split mixed-currency files before importing. Currency is not inferred from incidental text/code columns, and no per-line exchange-rate lookup is performed.

**7C-3a is CI-verified** in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026: 256 unit tests (78 JS + 178 TS), **46 authenticated Chromium vault checks**, **44 Firefox lab checks**, and **11 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed, with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was required or run because no Supabase migration/inventory changed.
Headed permission UI, hosted sign-in/restore, physical crash/quota/multi-tab recovery, historical storage-estimate discrepancies, real ERP round trips and new large-vault performance remain unverified by this run. Next prompt: 7C-3b, only on explicit instruction.


## 7C-3b — monitoring and relay presentation (8 November 2026)

**7C-3b is CI-verified** in [CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`, 8 November 2026: 260 unit tests (78 JS + 182 TS), **48 authenticated Chromium vault checks**, **46 Firefox lab checks**, and **12 real-authenticated local-Supabase relay checks**. Both required browser steps ran and passed with nonzero check counts. The fresh 152-check pgTAP suite ran twice with unchanged tenant row counts. Local vault **v13 / 42 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill was needed or run: no Supabase migration or inventory changed. Local vault v13 / 42 tables, no schema or Supabase changes.

- Home checks run on mounting the unlocked Home screen and on explicit Check now. No timer, background runner, notifications or inactivity-timer renewal. Last checked is the successful worker completion time.
- Windows are UTC calendar dates: today plus the preceding 89 days, compared with the preceding 90. Start inclusive/end exclusive, not anchored to the newest imported invoice. Exact partial months read lines; complete months read agg_cm. Sales only; credits are not orders.
- Default margin-drop threshold is 500 basis points (5 percentage points), strictly greater, configurable 0–100 points in the current Home session. Incomplete cost or nonpositive pocket suppresses the margin rule, never substitutes zero cost. Frequency uses distinct file + invoice + customer + date; missing invoice IDs count each line separately with a visible warning. Discount is sales-list-weighted. At most 50 alerted customers are returned, sorted by ID, with the full count.
- Hero = existing finder’s deduplicated total on the same 90-day input. Its rules, thresholds and per-line maximum overlap treatment are unchanged; service-order rules use the same scoped input. It does not write the lifetime ROI ledger. Full-history evidence invalidates/rebuilds its own cache after monitoring.
- Alternatives exclude the observed SKU and blank categories, require the selected customer’s fully costed sales history and an available current one-unit resolved selling price. All historical sales through today are used (complete agg_cpm months plus exact current-month lines); future rows and credits excluded. Estimate = resolved selling price minus rounded historical freight/unit, rebate/unit and cost/unit, with no second subtraction of book discounts. Rank margin dollars/unit descending then SKU ascending, top three. Units may differ; suitability must be reviewed. No history means no estimate, not a zero cost.
- New homeMonitor command and existing competitorList are cost-gated in worker dispatch; neither is rep-reachable. No new rep command; the exhaustive decision-16 payload scan remains in force. New amounts and displayed symbols follow the encrypted workspace currency.
- Relay status is local presentation over verified session heads, durable pending outbox/key state and rejected entries. The optional encrypted lastSyncedAt is set only on successful inbox verification. Conflict means a stale pending event, a divergent same-sequence head or rejected signed content; pending includes an unsynced head or no successful sync. No HTTP/event protocol or server change. No promise of continuous background sync.
- Real hosted authentication/restore, headed/manual permission checks, physical crash/quota/multi-tab recovery, real ERP round trips, native-language review and new large-vault monitoring performance remain unverified. 7D and later work remain unstarted. Blueprint unchanged.

The 7C-3b proof covers the authenticated local vault flow only. It does not prove deployed/hosted behavior, native permission UI, physical recovery, language suitability for pilots or large-vault monitoring performance. Next prompt: 7D, only on explicit instruction.


## 7D-1 — customer rebates (8 November 2026; CI-verified)

- Scope: customer programs, tiers, accruals, agreement loading and waterfall reconciliation only. No supplier_claims, purchases, supplier imports/claims/exports, retirement migration or 7D-2. Local schema v14 adds exactly rebate_programs, rebate_tiers and rebate_accruals (45 tables). All 11 Supabase migrations and migrations.lock stay unchanged.
- Period endpoints inclusive; tier lower bounds inclusive, upper bounds exclusive. Incremental/retroactive tier math ports the legacy golden cases. Rates allow three decimal places in percent; all production amounts are integer workspace cents with one final half-away rounding.
- Eligible base is signed invoice list minus on-invoice discount, including imported return/credit lines, inside the program period and SKU eligibility/exclusions. Net spend is floored at zero, excluded SKUs win. Only imported records are counted, not proof of complete ERP history.
- Imported sales_lines remain unchanged. The rebate_sales view supplies recognized rebates to financial queries and aggregates. Every program explicitly chooses additional (existing recorded rebates plus the new liability) or replace (the invoice rebate field already represents this same program). Missing treatment/mode is rejected for correction, never guessed. A replace program does not represent unrelated allowances or payments; confirm the source field before selecting it. Reconciliation shows imported + contractual adjustment = recognized. No double subtraction.
- One program per customer per overlapping period; ambiguous/overlapping agreements and incomplete tier groups are rejected together rather than partially loaded. Each file uses unique program references. Tier rows carry source file/row. Manual terms and file-derived terms have distinct edit paths; file terms are replaced through Import Studio.
- Accruals allocate the program-level rounded liability over signed eligible line bases by stable cumulative integer rounding. This preserves returns and sums exactly to the engine. Recognition is an estimate, not an automatic accounting posting, legal entitlement or payment. Existing quote snapshots do not forecast future tier attainment.
- Professional/Scale entitlements checked in the worker. Rep access is a separate progress-only projection with no cost or margin, tested under decision 16. Accountants manage programs through the rebate screen; their existing general-import permissions are not expanded. Reminders are visible while the app is open; no background email service.
- Existing programs continue to affect financial reads after downgrade; editing/loading rebate agreements requires Professional/Scale. Currency is fixed by the vault; importing thresholds uses the batch FX once and rates remain dimensionless.
- Local checks do not prove CI, hosted behavior, physical recovery or large-vault performance. Blueprint unchanged.
- Tier cap is 100 per program. Agreement import cohorts must have consistent metadata; a dismissed bad band cannot be omitted to activate the remaining tiers. Legacy six-column terms need explicit mode and treatment corrections in Fix Later. Item merges touching an agreement inclusion/exclusion are blocked until the terms are reviewed.
- Local role tests classify and scan the nonempty rebateProgress payload; private accrual evidence/manual writes remain gated. The final CI and browser results are recorded in CHUNK_7D_VERIFICATION.md, part 1. 7D-2 remains unstarted.

- Final pre-push local checks: 78 JS + 191 TS tests, typecheck, production build, migration freeze/schema/service-role gates passed. Chrome 156.0.8078.80 and Edge 157.0.4341.42 each passed 48 vault/privacy and 12 local PGlite relay checks. Firefox 157.0 also passed 48 checks; CI evidence is recorded below. No real Supabase credentials/Docker are present locally.
- Concurrent user commit edb77c3 introduced v2.5 selection aggregates/row notes/universal grid filter-sort. Preserved unchanged. This explicit v2.4-scoped 7D-1 prompt does not implement or verify those additions; a separate catch-up scope is needed. Blueprint not edited by this chunk.
- Agreement term confirmation is independent of rejected-row acknowledgement and enforced at worker commit. Wholly invalid batches retain the existing review-only behavior: correct/re-upload or combine with valid rows before persisting rejected cohorts.

**7D-1 verified in [CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026:** 269 unit tests (78 JS + 191 TS), **50 authenticated Chromium vault checks**, **48 Firefox lab checks**, **12 real-authenticated local-Supabase relay checks**, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Both required browser gates ran and passed with nonzero counts. Local vault **v14 / 45 tables**; 24 public tenant tables, 11 locked migrations, zero pending. No restore drill needed or run: no Supabase schema/inventory change.

This proves the tested authenticated local-vault flow, not deployed/hosted authentication or restore, headed native permissions, physical recovery, native-language/customer/ERP acceptance, or new large-vault rebate performance. 7D-2 remains unstarted. The concurrent v2.5 selection/notes/grid-standard additions remain unimplemented by this v2.4-scoped task. No blueprint edit by this chunk.


## 7V-3a — grid standard: sort, filter, selection totals (8 November 2026)

- Scope: blueprint v2.5 items 26-27, the column sort and filter standard and the selection aggregate status bar, built once in `components/ui/DataGrid.tsx` with `lib/grid`. Row notes are 7V-3b. No vault schema change (v14, 45 tables), no Supabase migration, no dependency change.
- A data grid is a table that lists records. Forms, raw file previews, legends and show-the-math breakdowns of one number are not grids; `CHUNK_7V3_VERIFICATION.md` lists every table and its kind.
- Sort order: money, integers, decimals and percents compare exactly as decimals (never floating point or text order); dates chronologically; text with the UI language's collation, case- and accent-insensitive. Blanks always sort last. Equal values keep the grid's own default order, so sorting is stable.
- Worker grids sort text with DuckDB's `NOACCENT.NOCASE` collation and, for rows the worker holds in memory, an English collator: the worker does not know the UI language. Browser grids use the UI language.
- A filter keeps rows whose raw value is one of the chosen values; "(Blanks)" is a missing value. Filters on several columns combine with AND. A column's value list honours the other columns' filters, shows at most 500 values and has a search box for the rest.
- Paged grids sort, filter, count, list values and total in the worker over the whole result, then page. The margin drill-down still shows the top 100 groups of the current order; its sort and filters apply to every group before the top 100 are taken. Fix Later's rejected-row view sorts and filters only the first 50 rows of a group, which the screen already says it shows.
- Selection totals are computed by DuckDB: a browser grid sends only the selected rows' numbers for columns the person already sees (at most 5,000 rows, numbers only, never text or formulas); a worker grid's "select all matching" totals the filtered result in the worker. SUM, MIN, MAX and COUNT are exact. AVG is the exact sum divided by the count, rounded half away from zero: money to whole cents, integers to 2 decimal places, decimals and percents to 4.
- Footer rows (the cost basis "All groups" row) are not sorted or filtered and keep their totals of every row.
- Decision 16: a grid never adds a column. Worker grids accept only their own code-defined columns; the rep-reachable rebate progress grid has no cost or margin column. `gridTotals` is read-only, needs only `view` and returns only sums, counts, minimum and maximum of numbers the caller sent.
- From 7V-3a on, the grid standard is a "Done when" item for every new data grid.


## 7V-3b — freeform row notes (8 November 2026)

- Scope: blueprint v2.5 item 26's row notes, with the customer list and item master grids they need (the app had neither). Local vault schema v15 adds `notes` to `customers` and `products` (still 45 tables); existing rows get no note. No Supabase migration, no dependency change.
- A note is plain text: line breaks kept, leading and trailing spaces trimmed, control characters refused, at most 1,000 characters counted as Unicode code points (an emoji is one). An empty note is no note. The limit is enforced in the worker as well as the page. Notes are rendered as text, never HTML or formulas.
- Who sees notes: roles with the `data` capability (Owner, Pricing Owner, Pricing Manager), in the Data Hub grids and in command-palette results. A Sales Rep never receives a note: the grids and note commands need `data`, and the palette searches and returns notes only for `data` roles (decision 16 test). Sales Managers and Accountants do not see notes in this version.
- Local only: notes are in the encrypted vault and its encrypted backups; they are never in a relay event, a server request, an ERP export or a change log. Saving a note is audited with the row kind and ID, never the text.
- Imports update customer and product columns by name, so re-importing a file never changes a note. Removing a source file deletes customers and products that only that file used; their notes go with them, and the removal confirmation says how many notes will be deleted before you confirm.
- Merging duplicate SKUs keeps the kept product's note and appends the duplicates' notes (largest duplicate first, one per line). If the combined note would pass 1,000 characters the merge is refused until the notes are shortened ("merge all" skips that group). Undo restores every note, including the deleted duplicates' notes.
- The item master grid shows current cost only to a role with the `cost` capability.

## 7D-2 — supplier claims and purchase receipts (9 November 2026; CI-verified)

- Scope: v16 / 47 local base tables, adding only supplier_claims and purchases. Customer rebates/financial recognition remain unchanged. No Supabase migration, server/API change, dependency change, retirement or 7E work. Locked migrations/lock stay unchanged. Preserve the pre-existing next-env.d.ts change and .claude/.
- Supplier amounts/spend/rates can reveal purchase costs: all supplier reads require cost; mutations/exports require rebateManage. Reps retain the existing customer-progress projection and cannot receive supplier costs, claims, progress or exports. Accountants manage claims without gaining general import permission. Purchases ingestion retains the data capability and also requires Professional/Scale.
- Purchases use positive source magnitudes plus an explicit entry_kind (receipt, return, credit_memo). Returns/credits are stored signed and reduce eligible spend. No inferred entry kind, currency, unit conversion or entitlement. Receipt reference + supplier + source line identify duplicates across files; source file/row is retained. All inserts list columns so product/customer notes survive.
- Each claim case owns its approved terms (supplier, program, type, inclusive period, SKU filters, incremental/retroactive tiers). The shared customer tier arithmetic is reused. Overlapping cases for the same supplier/program/type are rejected to avoid double claims. No additional supplier-program table.
- Rebate claims default to calculated earned amounts, with an explicit smaller requested amount allowed; overclaims are refused. Ship-and-debit amounts are explicitly assessed by the operator with an authorization/reference, not inferred from PO receipts (which alone do not prove resale entitlement). Neither type is automatically posted to the margin waterfall or sent to a supplier.
- Workflow: draft -> prepared (local export only) -> submitted (operator confirmation) -> approved/rejected -> paid (operator confirmation). Draft/prepared/rejected can be cancelled; only prepared/rejected can be explicitly redrafted. Submitted/approved/paid terms and claimed amounts stay frozen.
- Export has one claim summary plus tier and receipt evidence records, so claim amount is not repeated on every receipt. CSV/XLSX use exact decimal text and formula-safe strings; no customer/product notes exported. Export is local, audited with codes/IDs only, and capped at MAX_CLAIM_EXPORT_ROWS=100000 evidence rows before materializing. Split periods/filter SKUs for larger evidence sets. No supplier-specific acceptance guarantee.
- First export stores a summary and evidence hash. Re-export must match the same source evidence; source replacement/removal never silently changes an already prepared/submitted amount. A changed source requires explicit redraft where allowed, otherwise retain the earlier exported file and resolve the submitted case with the supplier outside this tracker. Source removal is not blocked.
- Shared worker grids sort/filter/total the full result before paging. Supplier progress is live from imported purchases, including signed returns, not proof of complete ERP history or a legal claim. Reminders are app-open only. Hosted/manual/physical recovery, native-language/ERP/supplier acceptance and large-vault performance stay unverified without corresponding evidence. Blueprint unchanged.

- Purchase line_id must also be unique within each source file (storage key source_id + line_id); duplicates become Fix Later issues. Purchase rows count with sales rows toward the existing licensed line cap. Item merges touching purchase evidence are blocked rather than retargeting receipt facts; source removal and note-removal previews protect products still referenced by other purchases.

- A prepared claim export is downloaded by a separate explicit link after worker preparation; no asynchronous automatic download or one-second Blob URL expiry. The link is session-local, revoked on replacement/close, and cleared by edits/status changes. Prepared means a local file and frozen evidence were recorded, not that a supplier received it.

7D-2 verified in [CI #123](https://github.com/Adityapawar5105/rebatehq/actions/runs/42606577225) on `2b1481d`, 9 November 2026: 296 unit tests (78 JS + 218 TS), 54 authenticated Chromium vault checks, 52 required Firefox lab checks, 12 real-authenticated local-Supabase relay checks, and the fresh 152-check pgTAP suite twice with unchanged tenant row counts. Local v16 / 47 tables; no control-plane migration or restore drill. See CHUNK_7D_VERIFICATION.md part 2. The local-only claims/import/export boundary is covered; hosted/manual/physical recovery, native-language/ERP/supplier acceptance and large-vault supplier performance remain unverified. 7E unstarted; blueprint unchanged.


## 7E-1 — vendor price review and purchase price variance (9 November 2026)

- Scope: blueprint Phase 2 "Vendor price review" and "Purchase price variance" (Professional and Scale, checked in the worker). New "Vendors" section for roles with the `cost` capability; Sales Reps never see it. No vault schema change (v16, 47 tables), no Supabase migration, no dependency change. The simulator is 7E-2.
- A supplier cost sheet is loaded through Import Studio as a vendor cost file, with its preview, mapping, Fix Later and removal. Loading it only adds cost history: no live price changes until a saved rule is simulated, approved by the Pricing Owner and exported. The review is of a loaded sheet, so it can be reopened and compared later.
- Each sheet line compares with the same vendor's latest cost for that SKU dated strictly before it, from any other file; if there is none, with the item master's current cost. Change % is the change over that basis in basis points, rounded half away from zero.
- Lines to check (the 3B conflict ideas): a SKU not in the item master; a different cost from another file for the same vendor, SKU and date; a later cost for the same vendor and SKU already on file. "First cost" means there is nothing to compare with. Duplicate rows inside one sheet are already rejected by Import Studio.
- Margin effect = −(change × units sold) over the chosen window (90, 180 or 365 days back from the latest invoice date), rounded half away from zero to the cent. It is an estimate on past volume at past prices, not a forecast.
- Affected quotes: draft, submitted and pending quote lines whose SKU's cost in the sheet differs from the cost stored on the line. The new cost of a SKU is its latest line in the sheet (highest cost if several vendors share that date). Margin before and after is at the quoted unit price and quantity.
- Rules: a saved rule triggers on a line when the vendor and the product category match and the new cost exceeds the vendor's previous cost by more than the rule's threshold: the same test the rule simulation uses.
- Purchase price variance uses the Purchases import (7D-2). Unit costs come from receipts only; returns and credit memos change net quantity and spend. Average unit cost = receipt spend / receipt quantity. Variance = net spend − net quantity × the item master's current cost, rounded half away from zero; positive means paid above standard. A SKU without an item master cost has no variance. An optional receipt-date range applies to every figure.

## 7E-2 — historical scenario simulator (9 November 2026)

- Scope: blueprint M9 "Simulator" (Scale tier only, section 8 tier table), as a third tab of the Vendors section. The Scale licence is checked in the worker for all three commands (`simOptions`, `simRun`, `simRows`); they need the `pricing` capability (Owner, Pricing Owner, Pricing Manager, all of whom also hold `cost`). Sales Reps, Sales Managers and Accountants never see it. No vault schema change (v16, 47 tables), no Supabase migration, no dependency change.
- A scenario is a period of whole months (at most 36) and 1 to 20 changes. Each change is a price or cost change of a signed percent with at most two decimals, from −90% to +100%, applied to all lines, a category, a customer ID (price only) or a SKU. When several changes of the same kind match a line, the most specific wins: SKU, then customer, then category, then all lines. Changes do not compound.
- Each imported sales and credit line in the period is replayed as it was sold. A price change scales list, discount and rebate by (100% + change), so discount and rebate keep their share of list; freight is unchanged; a cost change scales cost. Each scaled component is rounded half away from zero to the cent once, and pocket and margin come from the vault's line waterfall (lineFromCents): pocket = list − discount − rebate − freight; margin = pocket − cost. A line with no cost keeps an unknown margin: its pocket counts, its margin does not, and margin % is over the pocket of costed lines, as on the Margin page.
- Quantities do not react to the change (no price elasticity is modelled). The result is a replay of history, not a forecast.
- Guardrails: the blueprint's v1 hard cap of 2,000,000 lines per run is checked before any work. The run goes month by month in the worker, reports progress and can be cancelled between or during months; a cancelled or failed run leaves nothing behind. Results live in a temporary table of the open vault only (engine design rule 6): no vault row, audit row, export, relay or server request is written. A run is discarded when the data changes or the vault is locked.

## 7F-1 — review cadence, ROI v2 and compliance (9 November 2026; CI unverified)

- Scope: items 1-4 only. Reports/PDFs and local ROI/compliance; no folder re-import, converter, mobile, server/API, Supabase, dependency, locked-migration or blueprint change. Preserve .claude/. A v17 local migration adds roi_recoveries, scorecard_consent and report_checks (50 local tables).
- Recovery is operator-attested actual recovery, not modelled/exported uplift or a cash posting. A record needs a real non-sample ROI finding, an exported rule run, a unique evidence reference, exact positive cents, a period and explicit confirmation. Voiding reverses only that record. Historical recovered_cents are retained and reported separately when unlinked; found estimates are the current stored per-finding estimates, not a lifetime unique-cash total. Run counts include all on-device runs and are not proof of realized recovery. No causal ROI or savings guarantee.
- Monthly pack: selected calendar month's imported lines/leaks, bridge vs previous month and exceptions. Expiry, customer rebate reconciliation, supplier claim statuses and ROI are current as of the check; no invented historical snapshot. Weekly digest: last seven UTC days, plus the existing rolling 90-vs-90-day customer health checks. Top rows are bounded and explicitly labelled with total counts. Neither PDF reads product/customer notes.
- Checks are explicitly refreshed while the app is open; there is no scheduler, mail delivery or background service. Last successful check is saved locally. Cancel/failure preserves the previous stamp and never publishes a partial report. Heavy queries and PDF generation stay in the worker; report caches are engine/version-bound and invalidated by data changes/lock.
- Review Pack and digest: Professional/Scale, cost capability. ROI v2: all tiers with cost; recording/voiding also requires reconcile. Compliance: Professional/Scale and quote capability. Reports navigation is added for reps but contains only their compliance projection.
- Scorecard source: current non-draft Quote Desk lines in quotes created within the selected dates, across all authors (the team). It is line compliance, not imported invoices, booked revenue or a historical submission ledger. Floor/target denominators exclude missing guidance; no cost/margin input is read. One protected point for meeting the stored floor plus one for meeting the stored target; possible points equal the known guidance checks. Points are not money or realized margin. Team aggregate by default; individual means only the current person's aggregate and requires their explicit self opt-in, which they can revoke. No other person's view, name, ranking or leaderboard.
- Hosted/manual/native-language/ERP acceptance, physical recovery and large-vault report timings stay unverified without evidence. No next chunk is started.

## 7F-2 — folder re-import and Phase 2 converters (10 November 2026)

- Scope: blueprint section 9 converter table, Phase 2 rows (fixed-width reports, Parquet, text-based PDF tables), and folder re-import of saved converter recipes. Import Studio is in every tier, so neither is tier-gated; both need the `data` capability. No vault schema change (v17, 50 tables), no Supabase migration.
- **Fixed-width** (`.prn`, and `.txt` files without a usable delimiter): a position is a column gap when at most 10% of the table's typical lines cover it. Typical lines are those with at least 60% of the usual number of pieces (text separated by two or more blanks), so titles, totals and page footers do not hide gaps. Each run of gap positions gives one boundary at its middle. Cells are the raw text between boundaries, trimmed; a value that overflows its column is cut at the boundary, which the user can move. Tabs count as one blank and are not expanded. Lines longer than 64,000 characters are cut and the row rejected. `.csv` and `.tsv` are always delimited; the user can switch any text file between delimited and fixed width.
- **PDF tables**: only the PDF's text layer is read, with pdf.js 6.4.299 (legacy build), bundled into the vault worker as its own chunk and loaded the first time a PDF is added. Eval, font loading, XFA, range/stream fetching and every URL (fonts, CMaps, wasm) are off. Text runs on a page become lines when their baselines are within half the text height. Columns come from the same gap detector in points (gap at least 4 points), and a run goes to the column holding its centre; runs in one column join with a space. A PDF with no text (a scan) is refused with a message: there is no OCR. Password-protected PDFs, PDFs over 500 pages or 300,000 lines are refused. Text in CID fonts without built-in maps may extract imperfectly because no CMaps are fetched; the preview shows what was read.
- **Parquet**: read by the vault worker's DuckDB (blueprint: "DuckDB native"). DuckDB-Wasm 1.32 (DuckDB v1.4.3) has no built-in Parquet, so DuckDB's own signed `wasm_eh` Parquet extension is vendored (`vendor/duckdb-extensions/`, SHA-256 checked at build), served from this origin and pinned; the worker verifies the pin before DuckDB loads it, and DuckDB verifies its signature. DuckDB never contacts its extension servers. Every value is cast to text, NULL becomes blank; at most 300,000 rows, 256 columns and 4,000,000 cells. Nested values arrive as DuckDB's text form.
- **Row pipeline (all formats)**: a row identical to the header row(s) further down the file is skipped (print reports and PDFs repeat headers on every page). A row with two or three filled cells (at most half the columns) whose text contains "Page n" or "Printed" is a page footer and skipped, in tables of four or more columns.
- **Recipes** keep the layout and boundaries; a fixed-width or PDF recipe re-applies its boundaries to the next file before matching its headers. Recipes saved before 7F-2 are delimited.
- **Folder re-import**: the user picks a folder once (File System Access, Chrome and Edge); only the folder handle is stored, in this browser's IndexedDB under the vault scope, never a file or path. Each re-import asks the browser for read permission in the click, reads the folder's top-level files of supported types (at most 64), and the worker adds those that a saved recipe recognises and that are not already imported unchanged (same size and first/last 64 KiB SHA-256 as an earlier import). The others are listed with the reason. The batch is then reviewed and confirmed as usual; nothing loads automatically. Firefox has no folder picker, so the panel says so there.

## 8A — explainable deal guidance and cross-sell, with the v2.6 pre-8A fixes (10 November 2026)

- Scope: blueprint Phase 3, chunk 8A, opened by the two pre-8A fixes of blueprint v2.6 (section 22 item 28). Quote Desk is Professional and Scale (checked in the worker); both new commands need the `quote` capability and the caller must be allowed to open the quote (the same rule as `quoteGet`). No vault schema change (v17, 50 tables), no Supabase migration, no dependency change.
- **Gap 4 (scanned PDFs):** 7F-2 already refused a PDF with no text at all. The message now names the alternatives (save a print-layout report as text and use the fixed-width converter, or export a CSV or spreadsheet from the ERP). A PDF where only some pages have no text keeps its readable pages and the preview lists the pages left out; nothing is dropped silently. Still no OCR.
- **Gap 2 (relay onboarding):** the card shows on Home for Professional and Scale roles with `collaborate`, only when the server has the relay switched on (`RELAY_ENABLED`, passed to the page) and this device has no relay identity in the local vault. Both are known without a network request. "Set up this device" opens the sharing panel on its keys tab; "Not now" is remembered per workspace and user in this browser's local storage (a preference, not business data).
- **Deal guidance, per quote line:** the suggestion is anchored on, in order: this customer's recent prices (median net unit price, (list − discount) / quantity rounded half away from zero, of their 5 newest sale lines in the 365 days before the latest invoice date); else similar customers (other customers in the same tier: median of their 200 newest lines in that window, needing at least 3 lines from at least 2 customers); else the guardrail target; else the line's book price; else no suggestion. If a vendor's latest cost for the item is above its previous cost and dated within the last 90 days, a suggestion below the target is raised to the target. The result is then kept at or above the floor and at or below the start price. Medians of an even count average the two middle prices, half away from zero.
- **What a Sales Rep sees (decision 16):** suggested prices, the customer's and similar customers' selling prices (medians), counts, dates, guardrail prices and a yes/no "supplier cost rose" flag. Never a cost or margin value: the cost-rise check returns only the flag, and the stored line cost is never read. The decision 16 payload scan covers both commands with data behind every signal.
- **Cross-sell:** baskets are invoices (or, without an invoice number, one customer's purchases on one day) of sale lines in the 365 days before the latest invoice date. For an item X on the quote and another item Y: together = baskets with both; confidence = together / baskets with X; lift = confidence / (baskets with Y / all baskets), in exact integer arithmetic rounded half away from zero (confidence to 0.01%, lift to 0.01). A pair is shown when together is at least 3 and lift at least 1.20; items already on the quote, or bought by this customer in the window, are left out; at most 10 suggestions, by lift, then confidence, then item. Each Y is shown once, with the X that gives it the highest lift.
- Guidance and cross-sell are recomputed whenever a quote's lines change; they are advice only and never change a price by themselves ("Use" and "Add" are the user's actions).

## 8B-1 — Margin Drain agents and cost index triggers (10 November 2026)

- Scope: blueprint Phase 3, chunk 8B, part 1 (Margin Drain agents, which close blueprint v2.6 gap 1, and cost index triggers). The dead-stock optimiser is part 2. Both features are Professional and Scale, checked in the worker; they need the `cost` capability to read, and `pricing` to change agent settings or save and delete triggers. A Sales Rep never sees them (decision 16), so no rep command is added. Local vault v18 adds `cost_index_points`, `cost_index_triggers`, `agent_settings`, `agent_runs` and `agent_inbox` (55 tables) and lets `source_kinds` hold `cost_index`. No Supabase migration, no dependency change.
- **"Background" means while the app is open.** The vault worker checks once a minute whether a run is due (enabled, and the saved interval of 15 minutes to 24 hours has passed since the last run) and runs it; the first check after unlocking runs at once when one is overdue (recorded as "when the app opened"). Nothing runs while RebateHQ is closed or locked; there is no server, push or e-mail. The card says this plainly and shows the last check time. Agent runs write to the vault and are saved, but they do not count as user activity, so they never keep an idle vault from locking.
- **Rules**, each as of today's date on the device: leaks of at least the threshold (default $100.00) from the 4D leak finder; book prices in force today below their tier and category floor (4E guardrails), with the gap as the amount; book prices whose end date is within 30, 60 or 90 days (default 30); a vendor's newest cost for an item, dated in the last 90 days, above its previous cost by at least the threshold (default 3%), with the rise per unit as the amount; the 7C-3b customer health alerts at the saved margin-drop threshold (default 5 points; reused, not re-derived); and cost index triggers that fired. Each rule returns at most 500 findings.
- **Inbox:** a finding has a stable key (rule plus what it is about, and the date or period where a new value means a new finding). A new key arrives as "new"; one seen again keeps its status; a dismissed one stays dismissed; an open ("new" or "read") one that no longer applies becomes "resolved", and comes back as "new" if it applies again. At most 2,000 resolved findings are kept (oldest dropped). Findings are worker-grid rows on the grid standard; no notes, cost-to-rep, relay or server traffic.
- **Cost index series** are files the user uploads in Import Studio (role "Cost index": index name, period date, value > 0), one value per index and date; nothing is fetched from the web (no public index feed in this part; blueprint "uploads first"). Exchange rates for the import-currency buffer are typed by the user per trigger (the existing no-live-FX decision).
- **Trigger arithmetic**, exact integers, half away from zero: index change = (latest − base) × 10,000 / base in basis points, where base is the newest point on or before the base date and latest the newest on or before today (fewer than both means "not enough data"); FX change = (rate now − base rate) × 10,000 / base rate; cost change = index change × share of the index in the cost / 10,000 + max(0, FX change − buffer). A trigger fires when the index rose by at least its threshold or the FX rate rose beyond its buffer. Expected cost per SKU in scope (a category or one product) = current item-master cost × (10,000 + cost change) / 10,000. At most 100 triggers. Triggers suggest; any price change goes through the existing segment planner, changeset, approval and export.

## 8B-2 — dead-stock clearance optimiser (10 November 2026)

- Scope: blueprint Phase 3 dead-stock optimiser with the v2.4 carrying-cost inputs and substitute SKUs. Professional and Scale, checked in the worker; reading needs `cost`, changing the settings or drafting prices needs `pricing` (and a named Pricing Owner, as for every draft). A Sales Rep never reaches it (decision 16). Local vault v19 adds `inventory_levels` and `dead_stock_settings` (57 tables), lets `source_kinds` hold `inventory`, and lets `price_changesets` hold `clearance` drafts (both rebuilt with their rows kept). No Supabase migration, no dependency change.
- **Stock on hand** comes only from a file imported in Import Studio (role "Stock on hand": item, optional location, quantity on hand of zero or more); there is no ERP connector. A stock file is a snapshot: importing an item and location again replaces its earlier quantity instead of being flagged as already imported. Stock for items not in the item master is counted and named on screen, and left out of the figures.
- **Dead stock** = an item with stock on hand (summed over locations) and no sale line in the last N days (N saved, 90 to 730, default 90), or never sold. Credit lines are not sales. Today's date is the device's date.
- **Replacement cost** follows the 5A cost basis: the item master's current cost, else the newest vendor cost. Without either, capital and the clearance price are unknown and the item is flagged.
- **Carrying costs are the user's numbers**, saved in the vault: cost of capital (% a year, default 10.00%), storage cost per unit per month (default $0.00) and a markdown horizon (1 to 36 months, default 12). The defaults are starting points to replace, not benchmarks. Capital tied up = on hand × replacement cost; carrying cost per month = capital × rate / 12 + on hand × storage; all exact integers rounded half away from zero.
- **Clearance price** = list price minus what holding one unit over the horizon would cost (unit cost × rate × months / 12 + storage × months), never below replacement cost ("floored at replacement cost"). An item whose list price is already at or below replacement cost keeps its price. This is one explainable rule, not a demand forecast or price-elasticity model.
- **Substitutes**: up to three items in the same category and unit of measure that sold in the same idle window, by units sold, then item. They are items the dead stock could be offered in place of; no compatibility data exists, so this is a suggestion to check.
- **Drafts** reuse the segment planner's changeset: one row per item and per customer tier it ever sold to (its list-price row when it never sold). The new price is the clearance price, kept at or above that tier's guardrail floor and never above the current price; unchanged rows are left out. Live prices change only when the Pricing Owner approves the draft in Pricing, and they leave the device only through the normal ERP export. The Margin Drain inbox does not add a dead-stock rule in this part; the Dead stock tab is the flag.

## 8C-1 — win/loss log, audit and compliance pack, templates (11 November 2026)

- Scope: blueprint Phase 3 chunk 8C items 1, 3 and 4. The offline desktop PWA (item 2) is part 2. The Safari desktop verification spike is **not** in 8C: the v2.4 note in the 8C prompt put it here, but blueprint v2.6 (section 22 item 28, gap 5) later moved it to 8D, and v2.6 governs. Local vault v20 adds `quote_outcomes` (58 tables). No Supabase migration, no dependency change (JSZip and papaparse were already dependencies).
- **Win/loss outcomes:**
  - **What is recorded:** won, lost or no decision; a main reason from a fixed list (price, competitor offer, availability, lead time, product or specification, relationship, service, credit or payment terms, timing or budget, other); an optional competitor (up to 100 characters) and an optional note (up to 1,000).
  - **When and by whom:** on a quote that has left draft, by the quote's author or a role that may approve quotes or see cost. Recording again replaces the outcome. Each recording is audited with codes only (the quote ID, outcome and reason, never the note).
  - **Where it stays:** the competitor and note stay in the local vault. They are never exported, relayed or put in the audit pack.
- **Win/loss report:**
  - Outcomes are grouped by reason, customer or rep and filtered by the UTC date they were recorded (default: the last 365 days).
  - Value = quoted unit price × quantity per line, rounded half away from zero, summed per quote.
  - Win rate = won ÷ (won + lost); quotes with no decision are counted but left out of the rate, and "unknown" is shown when nothing was decided.
  - Margin (won and lost) uses the cost stored on each quote line when the quote was priced; uncosted lines add no margin. Margin is sent only to roles with `cost`.
  - Professional/Scale (Quote Desk tier).
- **Who sees what (decision 16):** a Sales Rep's report covers only their own quotes and never carries margin. Both new commands are in the decision 16 payload scan with a real outcome and stored cost behind it.
- **Audit and compliance pack** (every tier; the `audit` capability):
  - **Format:** a ZIP built in the vault worker.
  - **Log and its check:** the full hash-chained audit log, re-verified at export; `verification.json` with the hash rule, entry count, expected count and latest hash.
  - **Activity files:**
    - approvals: price-change approvals from price versions, and quote exception decisions;
    - export events from the audit log;
    - export receipts with their content hash;
    - role and Pricing Owner changes;
    - current role assignments as user IDs and role codes (no display names).
  - **Cover:** a PDF page in the user's language.
  - **Content rules:** the CSVs use codes and IDs only, with formula escaping. Prices, costs and notes are not read. Audit details are the code-and-ID payloads the vault already records.
  - **When the chain does not verify:** the pack is still produced and says so, with the entry where the check stopped.
  - **Reproducing the check:** a third party can re-run the check from `audit-log.csv` alone. The unit test does exactly that with Node's own SHA-256.
- **Templates** (Professional/Scale; PDF, user's language):
  - **Vendor negotiation sheet** (cost roles), for one vendor:
    - each item's newest cost from that vendor, the previous cost and the change;
    - the lowest newest cost from any other vendor;
    - receipts net of returns and credits from the Purchases import, in the last 365 days;
    - the value of matching cheaper vendors on those quantities;
    - fixed talking points and blank "agreed" lines.
    It shows the top 200 items by spend.
  - **Rebate agreement** (rebate managers), drawn from a customer rebate program:
    - customer, term, retroactive or incremental wording, tiers and rates, eligible and excluded items;
    - a settlement paragraph, a blank supplier line, payment terms and signature blocks.
    It is marked as a draft to review before signing. RebateHQ holds no supplier company name, so that line is left blank.
- **File exports are audited:** each file download (`audit.pack_exported`, `template.negotiation_sheet`, `template.rebate_agreement`) writes an audit entry with codes and IDs. These downloads therefore need a valid licence, like the other report exports.
- **No JSON functions in vault SQL:** the DuckDB-Wasm vault has no JSON extension, and the vault never downloads extensions. JSON stored in the vault is parsed in JavaScript, not with DuckDB JSON functions. (This was found by the browser gate: Node's DuckDB has JSON built in, so unit tests could not catch it.)

## 8C-2 — offline mode for the desktop app (11 November 2026)

- Scope: blueprint Phase 3 chunk 8C item 2, the installable desktop app with offline use. Every tier. No vault schema change (v20, 58 tables), no Supabase migration, no dependency change. Chrome and Edge are the verified browsers; Firefox registers the same worker but offline use there is not verified by a gate.
- **What is stored offline:** a service worker (`public/sw.js`) keeps one named cache (`rebatehq-shell-v1`) holding only:
  - the signed-in page's HTML (`/home`; `/lab/vault` in the lab), stored on each successful online visit;
  - the build's content-hashed files under `/_next/static/`;
  - the engine files under `/spike/` (the vault worker still checks their pinned SHA-256 and the browser checks their SRI on every load, cached or not);
  - the manifest and the icon.

  The page HTML carries the signed-in identity metadata the server already puts in it (user, workspace, e-mail). It carries no pricing, costs, invoices, rules or notes: those live only in the encrypted vault in OPFS and never in HTTP responses. The gate's cache scan checks this on every stored response.
- **What is never stored or intercepted:** `/api/` (so the licence call reaches the network, or fails and the existing offline grace applies), any request that isn't a GET, any URL with a query string, other pages (sign-in, account, legacy), other origins, and redirects. No background sync, periodic sync or push is registered, so the Margin Drain "checks only run while the app is open" rule stays true.
- **Update strategy:** the page and the fixed-name engine files are network-first: an update is used whenever the network answers, and the stored copy is only the offline fallback. Content-hashed build files are cache-first. The worker activates at once and removes older caches.
- **Signing out** deletes the offline copy and unregisters the worker before the sign-out request is sent. A `/home` visit that is redirected (the session ended elsewhere) also drops the stored page. Settings › Offline use shows whether this browser is ready to open offline, with a "Remove offline copy" button.
- **Licence offline:** no change. The signed licence cached in this browser is used offline until `offlineUntil` (lib/licence-policy.ts). Settings shows that date while offline, and the app becomes read-only after it.
- **Installable:** `app/manifest.ts` (`/manifest.webmanifest`, start `/home`, standalone) with an SVG icon. The browser's install prompt itself is not tested.
- **Development builds** do not register the worker; it is registered only in production builds.
- **Test method:**
  - The browser gate blocks service workers in every check except the offline one, because Playwright's request routing (used for the gate's test-code and quota seams) cannot see requests a service worker answers.
  - The offline check cuts the network for real: it reaches the app through a local TCP relay and closes it. Playwright's offline switch does not cover requests the service worker makes, so on its own it would not prove anything.

## 8D — opt-in anonymous benchmarks and the Safari pre-check (11 November 2026)

- **Design:** BENCHMARKS_DESIGN.md, approved by the user on 11 November 2026 with one change before build. Peer figures are published as 5-point ranges, not 1-point bands. A simulation showed 1-point noisy histograms with k = 10 and ε = 1 put 1 published median in 10 off by 12 points or more; with 5-point ranges that falls to 6 or more.
- **Decisions:** Professional and Scale only; give to get (only contributors see a quarter); no Mac, so the Safari spike is a WebKit pre-check only (SAFARI_SPIKE.md).
- **On the device:**
  - **Family map:** the Owner maps categories to 12 standard families, and the map stays in the vault.
  - **What is computed:** for the last complete calendar quarter (UTC), the worker computes each mapped family's rates from sale lines (credits excluded) with the 4D waterfall. Pocket = list − discount − rebate − freight.
    - pocket margin = (pocket − cost) ÷ pocket, over costed lines;
    - discount and rebate are divided by list;
    - freight is divided by pocket.
  - **Bands:** each rate is rounded down to a whole point and clipped to −20…80.
  - **Family minimums:** a family is shared only with at least 200 lines and 20 customers, and no customer above 25% of its pocket revenue.
  - **Size band:** from the quarter's total pocket revenue in the workspace currency; S1 is under $1M, S2 up to $5M, S3 up to $20M, S4 above.
  - **The payload:** checked by one shared function (`lib/bench/payload.ts`) on the device and the server. It holds only `v`, `quarter`, `sizeBand` and up to 48 rows of family code, metric code and integer band.
- **Who does what:**
  - Cost roles see the bands and any figures the Owner fetched (kept in the vault, so they read them offline).
  - Only the local Owner role maps families and records shares, figures and withdrawal.
  - The server checks that the caller is the workspace Owner, active and seated, with an active Professional or Scale licence. Opting out and withdrawing need no licence.
  - A Sales Rep reaches no benchmark command (decision 16; every command needs `cost`).
- **Network:** nothing is sent when a screen opens. "Check sharing status", "Turn on", "Share", "Get figures", "Turn off" and "Delete my shared bands" are each one explicit Owner request. There is no background, scheduled or service-worker sending. Each share writes a local audit entry with the quarter and a count; the bands themselves stay in `bench_shares`.
- **On the server:**
  - **Pseudonym:** HMAC-SHA256(`BENCH_PSEUDONYM_KEY`, tenant ‖ quarter), so a different pseudonym every quarter. The key is only in the server environment.
  - **Storage:** contributions sit in the private schema without a tenant. Submissions are limited to 5 per workspace, quarter and day; a resubmission replaces the earlier rows.
  - **What can be shared:** only a completed, unreleased quarter.
  - **Withdrawal:** deletes the rows for every quarter from 2024-Q1 to now and records the opt-out. Released figures stay.
- **Release (operator, `scripts/bench-release.mjs`):** once per quarter, at least 45 days after it ends.
  - **Cells:** a size band × family × metric cell needs 10 contributing workspaces.
  - **Noise:** a histogram over the 21 five-point ranges (−20…−16 up to 75…79, then 80), with Laplace(1/ε) noise on each range, ε = 1, clamped at 0.
  - **Percentiles:** the ranges where the noisy cumulative count reaches 25%, 50% and 75%.
  - **Suppression:** a cell is suppressed when its noisy total is under 10.
  - **Freezing:** each quarter is released once and then frozen.
- **WebKit pre-check:** recorded, not passed or failed; see SAFARI_SPIKE.md. Safari desktop remains unclaimed.

## 8R — wave-2 legacy table retirement (13 November 2026)

- **Precondition.** The Supabase connector listed no projects for the user's organisation, so no hosted database holds rows in the dropped tables. If a hosted project appears before the migration is applied there, its business rows need an approved retention decision first.
- **`fx_rate`.** It is dropped because the vault has kept per-workspace exchange rates since 7C-3a (CI #108). Nothing on the server read `fx_rate` after 5B. This meets the condition in RETIREMENT_PROPOSAL.md and blueprint item 15 ("once a local FX table exists").
- **Self-approval.** The pgTAP check "a user cannot decide their own quote approval" tested the server `approval` table, so it goes with that table. The rule itself stays tested in three places:
  - local Quote Desk (`tests/quotes.test.ts`, "nobody approves their own quote");
  - the relay (`tests/relay-state.test.ts`, no self-approval);
  - `lib/quote-approval.ts` (`tests/security-foundation.test.ts`).
- **Replacement checks use the closest remaining policy.**
  - `invite` is owner-only for every operation, so it carries the owner's positive UPDATE and DELETE, the anon probes and the manager denial.
  - `membership`'s SELECT policy (`user_id=auth.uid()` or owner) carries the `auth.uid()` evaluation and the rep's visible-but-not-deletable row.
- **Restore sentinel.** It is the licence location `62000000-…-0001` named RESTORE-SENTINEL (same ID as the old agreement). It hashes the ID, name, ERP profile and UTC creation time. The quote and agreement hashes are replaced by hashes of the four licence tables.
- **History.**
  - `schema.sql` is a historical snapshot and is not edited.
  - `tests/chunk6r-retirement.test.ts` still tests 6R over the migrations before it.
  - Audit-log rows that name the dropped tables stay, and the hash chain is never rewritten.

## Netlify deployment — 14 November 2026

- The user explicitly selected the real-sign-in application, not the synthetic Scale lab. Netlify builds keep lab, legacy, impersonation, relay and benchmark flags off. The connected `rebatehq-staging` project remains staging; no customer production-launch claim follows from this deployment task.
- Browser vaults are origin-scoped and are not uploaded with the application. Local environment files, private issuer/admin credentials and customer files are excluded from the build source package. The public licence verification key must match the runtime issuer key and be set before worker bundling.
- Netlify's Next.js adapter is required; this app cannot be published as a static folder while preserving auth/callbacks/licences. The local Next.js build passes. Windows adapter packaging failed first on directory symlinks, then on a Windows drive path in middleware bundling; use the Linux builder rather than changing auth or CSP. Hosted behavior remains unverified until deployed and exercised.
- The user authorized Netlify, signed into Upstash and reset the staging database password. A free Upstash Redis database now supplies distributed sign-in rate limiting. The dedicated `rebatehq_netlify_login` is NOINHERIT, NOSUPERUSER and NOBYPASSRLS, with only SET membership in `rebatehq_app`. A real TLS-verified pooler connection returned zero tenants without authenticated context and verified the signed actor helper. The matching actor signing key was installed because the key table was empty. No migration or locked hash changed.
- App runtime secrets are in Netlify, separate from the local administrator credential. Supabase's site URL and exact callback point to `https://rebatehq-aditya.netlify.app`. The public database CA is bundled without disabling TLS verification; its deployed path, email delivery, callback exchange and vault behavior still need hosted verification. See NETLIFY_DEPLOYMENT.md.
