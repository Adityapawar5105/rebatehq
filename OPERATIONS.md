# RebateHQ operations (Phase 1)

## Chunk 5B — CI-verified and Restore Drill passed (4 November 2026)

**5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee` (CI #63/#64 also passed) and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905), local target. Migration `20261104160022_chunk5b_control_plane.sql` is now locked with its hash unchanged; the eight earlier locked migrations are unchanged. Suite: **188 fresh / 191 restore-mode checks**, **42 public tenant tables**, plus an owner-only private issuer table and a nontransactional login-budget sequence. See [CHUNK_5B_VERIFICATION.md](./CHUNK_5B_VERIFICATION.md). No 6A work or table retirement is authorized.

## Chunk 4B local vault — CI-verified

Verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`; the authenticated local-vault gate ran 14 named checks.
See `CHUNK_4B_VERIFICATION.md` for scope and unverified deployment/recovery limits.

Use the existing configured Supabase identity to open `/home`. A vault is
scoped by browser origin, profile, user and workspace. Keep the passphrase safe;
there is no server recovery. Lock after use. A completed import is encrypted
and published before success is shown; closing a tab cannot guarantee an
asynchronous final save. If a save fails, keep the tab open and Retry Save.
The previous encrypted generation remains safe; auto-lock can discard only
the pending unsaved change. An OS/browser storage wipe can remove all local
copies: persistent-storage permission is not a backup or a tested power-loss guarantee.

Run `pnpm test:vault --browser=chrome` or `--browser=msedge` against a production
server. For **synthetic local tests only**, set `VAULT_LAB_ENABLED=true` before
starting `pnpm start --hostname 127.0.0.1 --port 3100`; that opt-in lab is not
authentication evidence. Leave the flag unset in deployment. Do not invent
Supabase URLs, keys or sessions to make a local run appear signed in.
`pnpm benchmark:vault --browser=chrome` / `--browser=msedge` additionally measure
1M/2M existing vaults after whole-browser restart on a fresh test profile.

The required CI privacy gate starts after the real local Supabase stack and
restricted login are available. It exports real Auth/mail configuration,
rebuilds the app with the public local key, starts production Next.js, obtains
a genuine local PKCE magic link and runs `pnpm test:vault:privacy --browser=chromium`.
Failures fail the job; it does not use mocked auth, a production limiter bypass
or stored business data. Local-stack Auth and the local-vault privacy gate are
**verified in CI #44**; deployed sign-in and physical crash/quota/multi-tab
recovery remain **unverified**. No new Postgres migration or restore inventory was required.
See [CHUNK_4B_VERIFICATION.md](./CHUNK_4B_VERIFICATION.md) and
[STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md) for evidence and limitations.

**Current Chunk 3C and Phase 3 status: verified in [MarginDesk CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) and [MarginDesk Restore Drill #13](https://github.com/Adityapawar5105/rebatehq/actions/runs/40938982321), 2026-10-30 (Asia/Calcutta), commit `2f8b06d`.** Both runs passed, including **162 fresh / 165 restore-mode checks**, planned = ran with repeatability, across **38 tenant tables**. Seven migrations are locked. Only the local restore target was exercised. Phase 4 has not started.

**Earlier Chunk 3B status: verified in [MarginDesk CI #35](https://github.com/Adityapawar5105/rebatehq/actions/runs/40844679109), 2026-10-29, commit `87d7d90`**, for automated lifecycle/security/SQL checks. That milestone used **200 data rows per file**; the current configurable maximum is **10,000**. No migration or restore inventory changed in 3B; its 156/159 plans and six locked migrations are historical. See the import lifecycle runbook below and [the verification record](./CHUNK_3B_VERIFICATION.md).

**Earlier Chunk 3A status: verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`**, for automated parser/security/template checks. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, and browser UI beyond the local harness remain **unverified**. Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md.

Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Phase 3 had not started at that Phase 2 milestone; current Chunk 3A verification is recorded below.

## Chunk 2B — verified (2026-10-28)

`20261028162156_chunk2b_pricing_rebate_tiers.sql` is **locked** with its original normalized hash in migrations.lock, **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. All four earlier migrations and their hashes remain locked and unchanged. This paragraph records the earlier Chunk 2B milestone.

Chunk 2B adds customer_group/customer_price and rebate_tier/rebate_entry, raising the minimum tenant-table inventory from 29 to **33**. Pricing uses one shared resolver in margin-engine.js: contract > customer > group > tier > list, with half-open effective-date and quantity ranges, overlap rejection, explicit source/rule rationale and currency conversion. Quotes persist the rationale. The rebate audit and next-tier reminders use rebate-engine.js and the new tables; legacy single-rate/progress columns remain compatibility/reference data and are not used for audit calculations. Existing terms and the latest cumulative progress snapshot are backfilled with source references; arbitrary supplier-credit matching is not performed. Prototype import now correctly treats its credits field as credits received.

New tables use explicit operation/role policies, tenant indexes, forced RLS, existing write-audit triggers and exact app-only CRUD grants. There are **no new public SQL functions**, so config/function-acl-allowlist.sql needs no new entries; all existing registry/default-ACL gates still run. Every new table enters generic tenant isolation tests plus separate exact-ACL, own INSERT/UPDATE/DELETE with audit, and anon/authenticated CRUD-permission tests. Non-overlap tests cover prices and rebate tiers. Plans are now **88 fresh / 91 restore mode**; the restore-only three checks are retained. The restore inventory and equivalence checks discover all 33 tables and all public functions; no historical migration replay or comparison exclusions were added.

Local PGlite tests execute the migration on fresh and populated Phase 1/2A schemas, test the seeded NorthStar 29,500 × 2% = 590 less 350 credits = 240 and Acme 5,000-to-threshold fixtures, reject overlapping rules and invalid rates, and execute the full 88/91 SQL suites twice with unchanged per-table counts. PGlite uses local auth/role/pgTAP stubs. Runtime SQL for quotes, imports, monthly waterfall and rebate audit is also executed there. Real Supabase migration application, runtime-role behavior, source/target restore comparisons and the local-target restore drill for Chunk 2B are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. Both 88 fresh / 91 restore-mode plans passed with planned = ran and repeatability across 33 tenant tables. CI #27 / Restore Drill #10 remain historical Chunk 2A evidence. See [the Chunk 2B verification record](./CHUNK_2B_VERIFICATION.md). Hosted restore, managed backup/PITR and deployed UI flows remain unverified.

Rollback: export the new pricing rules, tiers, entries and quote rationale first; remove the new tables in reverse FK order and the added customer/agreement/quote-line columns and constraints. Reverting discards edited terms and ledger entries unless they are exported. The retained legacy agreement/progress values are historical compatibility data, not a lossless reconstruction of subsequent tier edits.


## Environments

Keep three separate Supabase projects, Vercel deployments, and Upstash databases for development, staging, and production. Never copy live customer data into development. Set the environment variables in `.env.example` separately for each deployment. Preview deployments must use staging services. Only the public Supabase URL and publishable key may use the `NEXT_PUBLIC_` prefix.

`APP_DATABASE_URL` must connect as a dedicated login that is a member of `rebatehq_app`; it must not be the `postgres`, `service_role`, or `BYPASSRLS` credential. Create it after applying the migration:

```sql
CREATE ROLE rebatehq_app_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'use-a-generated-secret';
GRANT rebatehq_app TO rebatehq_app_login;
```

Use the Supabase transaction pooler for the web runtime. The `pg` adapter begins a transaction, runs `SET LOCAL ROLE rebatehq_app`, sets the verified Supabase user claims, and keeps all tenant work in that transaction. Rotate the login password and update `APP_DATABASE_URL` when personnel or environments change.

**Existing databases (rename migration).** Migration `20261104120000_rename_app_role_to_rebatehq.sql` renames `margindesk_app` to `rebatehq_app` and the stored `MarginDesk file imports` price list to `RebateHQ file imports`. Policies, grants and memberships follow the role, so an existing login (including one still named `margindesk_app_login`) keeps working. Apply the migration and deploy the matching app build together: a build that runs `SET LOCAL ROLE rebatehq_app` fails before the rename, and an older build that runs `SET LOCAL ROLE margindesk_app` fails after it. Run `pnpm check:db-role` afterwards. The migration is locked in `migrations.lock` after [CI #58](https://github.com/Adityapawar5105/rebatehq/actions/runs/41830575440) and [Restore Drill #14](https://github.com/Adityapawar5105/rebatehq/actions/runs/41844375007) passed on `251efef` (4 Nov 2026). It has not been applied to any hosted database.

`SEED_DATABASE_URL` is a privileged direct database URL used only by operator scripts and migrations. It must not be configured in Vercel runtime functions. Use the Supabase project SQL editor or a controlled migration runner for production schema changes. The seed and retention scripts require this variable explicitly.

## Phase 1 CI evidence status

**Phase 1 is complete as of 2026-10-26.** [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) passed on commit `aabfb20`; [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) passed end to end in local mode on the same commit. CI #24 covered the fresh database and 53 pgTAP checks; Restore Drill #8 covered the restore and 56 restore-mode checks. Hosted-Supabase restore and platform-managed backup/PITR recovery were not exercised.

| Check | Status | CI evidence |
|---|---|---|
| Supabase local stack starts and all migrations apply | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26** | Clean migration reset passed |
| Restricted app pool login and missing-auth zero-row check | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Runtime role check passed |
| Fresh-database RLS, tenant-isolation, role, audit, and privilege suite | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | All 53 fresh-mode pgTAP checks passed with planned = ran |
| Restore-mode suite against existing restored tenant data, including sentinel hash, source tenant counts, and cross-tenant isolation | **verified in CI run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | All 56 restore-mode pgTAP checks passed with planned = ran |
| Tenant isolation across public tenant tables, including own-row positive controls and RLS-specific write denials | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Positive controls and cross-tenant denial checks passed in fresh and restored modes |
| Audit log UPDATE/DELETE/TRUNCATE denial and elevated-role immutability triggers | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | pgTAP checks passed |
| Rep response and self-approval checks | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Unit and database checks passed |
| User-facing service-role scan | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26** | pnpm test source scan passed |
| Applied-migration hash lock and expanded future-migration gates | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26** | Hash lock, duplicate-object lint, RLS/tenant checks, privilege warning gate, and migration fixtures passed |
| Table ACL cleanup migration and default table/sequence/function privilege cleanup | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Migration applied; explicit table grants/default ACL checks and strict source/target ACL comparison passed |
| Public function ACL cleanup and SECURITY DEFINER grantee allowlist | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Exact function grantee allowlists, restricted browser roles, and source/target function ACL comparison passed |
| Repeatability: database suite twice with unchanged per-table row counts | **verified in CI run [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598), 2026-10-26; restore run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Fresh and restore suites each ran twice; no tenant-table count changed |
| Restore to fresh target and post-restore suite | **verified in CI run [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26** | Local-mode restore, comparisons, sentinel, runtime check, and repeatability passed |
| Hosted-Supabase restore mode | **unverified** | Restore Drill #8 used local stacks; hosted mode was skipped |
| Supabase-managed backup/PITR recovery | **unverified** | The logical dump/restore workflow does not exercise managed backups or PITR |

## Chunk 2A migration status

Chunk 2A is **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Migration `202610280001_chunk2a_cost_units_currency.sql` is now locked with its existing normalized SHA-256; its SQL content and all older locked migration entries are unchanged.

The migration creates `cost_history`, `uom`, `uom_conversion`, `fx_rate`, and `data_quality_issue`; adds currency/UOM fields and date/price constraints; backfills product costs, canonical UOMs, and legacy transaction currencies; and enforces non-overlapping cost and price-list intervals with `btree_gist`. Rollback guidance is in the migration header: preserve/export cost history first, remove new triggers/functions/tables in reverse dependency order, drop added columns/constraints, and restore the prior product-cost behavior. This rollback discards recorded history if it is not exported, so it requires an explicit data-preservation plan.

CI evidence: [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) passed the fresh migration reset, unit/security/PGlite seeded-backfill tests, runtime-role check and repeated 70-check database suite. [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732) passed the local target restore, range extension setup, four ACL checkpoints, strict source/target comparisons and repeated 73-check restored suite. Both runs are on `d4c907c`, 2026-10-28. Hosted-target restore, managed backup/PITR and deployed UI actions remain **unverified**.

The RLS fixture/repeatability inventory requires at least 29 tenant tables. All public functions and ACLs participate in the strict restore comparison. The 70 fresh and 73 restore-mode plans and unchanged-count repeatability are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Phase 1 historical evidence remains recorded separately.

### Migration hash normalization

On 2026-10-25, the baseline hash was regenerated from the current migration content after normalizing CRLF and lone CR line endings to LF and stripping a UTF-8 BOM. The earlier mismatch was caused by the Windows working copy using CRLF while CI hashes LF bytes. Per the user's GitHub Desktop verification, the migration SQL content is unchanged from CI run #14; the SQL file was not edited. `migrations.lock` records the normalization method and reason, and `scripts/check-migrations-lock.mjs` hashes normalized UTF-8 content so Windows and Linux produce the same SHA-256. `.gitattributes` also forces LF for SQL and the other CI/hash-relevant source files. The updated lock hash is `8faa57997119f29b3921b0e15b4b9e964edbc7fa2ecd8b52fbe32392be38c3bb`.

### CI database-step sweep

The restricted test login uses a random masked password; runtime checks use `APP_DATABASE_URL` and database tests use `TEST_DATABASE_URL`. [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) passed clean migration application, runtime-role verification, the migration/hash and service-role gates, and all 53 fresh pgTAP checks twice. [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) passed the local logical restore, strict ACL/function/table-count comparisons, restricted runtime role, sentinel, and all 56 restore-mode pgTAP checks twice with stable row counts. Both runs were on 2026-10-26. The auth.uid() diagnostic confirmed Supabase's PUBLIC EXECUTE path; table and SECURITY DEFINER ACL cleanup policies passed. Login attempts are limited to 8 per 10 minutes by the Upstash route limiter; the SQL function has no independent rate limiter. The audit actor GUC risk remains open in `SECURITY_CHECK.md`.

## Initial setup and deployment

1. Create the three Supabase projects and configure Auth email confirmation, magic-link redirect URLs, and a short-lived one-time link policy. Add the app callback URL `/auth/callback` to each environment’s allowed redirect list.
2. Copy `.env.example` to `.env.local`. Generate separate random secrets for `APP_DATABASE_URL`, `CONNECTOR_ENCRYPTION_KEY`, and development impersonation. Set `APP_BASE_URL` to the exact origin.
3. Apply the checked-in migration with `pnpm exec supabase link --project-ref <ref>` and `pnpm exec supabase db push`, or run the migration SQL from the dashboard. Run `pnpm check:schema` and `pnpm test:db` against a local Supabase instance before deploying.
4. Create the restricted application login shown above. Run `pnpm check:db-role`; it asserts the actual `APP_DATABASE_URL` session login and effective role are neither superuser nor `BYPASSRLS`, that the login can assume `rebatehq_app`, and that a request without a verified user context sees zero tenant rows.
5. Configure Resend and Upstash in staging and production. Production auth, invite, import, and export routes fail closed when distributed rate limiting is not configured. Confirm the sender domain before inviting customers.
6. Set `CONNECTOR_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Keep a separately secured copy outside Supabase; key loss makes stored connector credentials unreadable. For key rotation, decrypt and re-encrypt each secret in a controlled migration, then increment `CONNECTOR_ENCRYPTION_KEY_VERSION`.
7. Deploy to Vercel with the matching environment variables and verify `/api/health`, sign-in, invite acceptance, owner/manager/analyst/rep permissions, and RLS tenant isolation in staging before production traffic.

## Backups and restore

Use the Supabase project’s Database → Backups page to inspect the configured backup coverage. Supabase’s available daily retention and PITR options depend on the selected project plan and add-ons; confirm the production project has the retention window required by the customer contract. PITR replaces daily backups when enabled, so choose and document one supported restore strategy. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

### Phase 1 restore-drill status

**Verified in [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508), 2026-10-26 (local mode; 3m 47s).** Runs #1–#7 exposed and resolved role-dump filtering, managed-schema dump scope, broad table/function ACLs, and the approval/quote fixture dependency issue. Run #8 completed end to end: source and fresh target stacks started, roles and application schema/data were restored with strict error handling, only synthetic auth-user IDs were prepared, and source/target role attributes, table/function/schema ACLs, and application row counts matched. Sentinel and runtime-role/no-context checks passed. The 56-check restore-mode RLS/audit suite passed twice with planned equal to ran and no row-count residue. The ACL migrations are now locked as applied in `migrations.lock` with their existing normalized SHA-256 hashes; their clean migration application and source/target behavior were exercised in [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) and [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508).

The migration audit shows MarginDesk creates its tables and functions in `public`, creates no application schema, and creates no triggers on `auth` tables. Its only non-public operation is `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions`; the fresh Supabase stack supplies that schema/extension. The restore dump explicitly includes only `public` and excludes Supabase-managed schemas. Inventory reports schema/table scope, source row counts, auth foreign keys, and redacted dump context. Only referenced auth user IDs are recreated as synthetic `auth.users` stand-ins; no source email, password hash, or auth secrets are copied. Restore commands retain `ON_ERROR_STOP`. The successful [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) compared all application tables, role attributes/memberships, schema/table/function ACLs, function search paths, row counts, and auth references. It verified the sentinel, restricted login, runtime no-context RLS, and the 56-check restore-mode suite. CI #24 separately passed the 53-check fresh suite; both repeatability runs executed suites twice and confirmed unchanged row counts. Local mode is verified; hosted mode and Supabase-managed backup/PITR recovery remain **unverified**.

**Chunk 2A restore note (verified):** The locked migration installs `btree_gist` in `extensions`; the restore workflow installs and verifies it before restoring the public schema dump. This extension setup, the platform-only ACL cleanup, strict comparisons and 73-check restore suite are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Hosted mode remains **unverified**.

| Drill field | Recorded result |
|---|---|
| Source/target project | Local Supabase source → fresh local Supabase target (Restore Drill #8) |
| Backup type and recovery point | Logical schema/data dump; source snapshot captured by workflow |
| Database size | Not measured by workflow |
| Start/end UTC and duration | 2026-10-26 08:18:38–08:22:25 UTC; 3m 47s, verified in Restore Drill #8 |
| Restore result and sentinel check | Verified in Restore Drill #8 |
| App login and database RLS/audit checks | Verified in Restore Drill #8; 56 checks passed twice |
| App quote, CSV, and owner export checks | **unverified** — not exercised by these CI workflows |

### Run the automated logical restore drill

See [`RESTORE_RUNBOOK.md`](./RESTORE_RUNBOOK.md) for the complete ordered procedure, verification commands, and known limits. Use **Actions → MarginDesk Restore Drill → Run workflow**. All application migrations must be applied to the source database before creating the dump. The default `local` mode needs no Supabase project, database, or GitHub secrets: the workflow starts a local Supabase source stack, runs `supabase db reset` to apply every migration, then seeds a sentinel. Hosted mode requires every application migration already applied in order to the disposable source; the workflow does not replay historical migrations on that source. It dumps the owned `margindesk_app` role plus only the `public` schema/data and reports the explicit included/excluded schema list. The target receives the complete schema dump and its intended GRANT statements, then scripts/restore-platform-acl-cleanup.sql removes only platform ACL additions and defaults before data restore. This restore-only script grants nothing and contains no function allowlist. Never replay any historical migration over a restored schema; the dump already represents the full applied migration set. The workflow inventories tables and source counts, prints a redacted excerpt around data dump line 448, and prepares synthetic `auth.users` rows for only the referenced IDs before restoring application data into a fresh target. It compares role attributes, memberships, application table and function ACLs, function security/search-path metadata, public schema ACL, every application table’s total and per-tenant counts, and required auth IDs. It then verifies the sentinel, creates a random restricted app login, checks runtime role/no-context behavior, and runs the current 70-check fresh suite or 73-check restore-mode suite twice with `pnpm test:db:repeat`; the repeatability step requires unchanged tenant row counts before and after each invocation. Restore mode loads the source equivalence snapshot into pgTAP, verifies the sentinel content hash and all per-tenant counts before test fixtures, and checks the synthetic Tenant A context against the real restored sentinel tenant for every application table. The job summary records the schema scope, source/restored counts, auth dependency counts, and dump, restore, test, and total timings. Every restore command stops on SQL error. The local-mode workflow passed for the locked Phase 1 schema in Restore Drill #8; the Chunk 2A local-target restore is verified by [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28. Hosted mode and Supabase-managed backup/PITR recovery also remain unverified.

Local code checks on 2026-10-26 passed (`pnpm test`: 45 JavaScript and 9 TypeScript tests; `pnpm typecheck`; `pnpm build`). On 2026-10-28, the Chunk 2A working tree passed `pnpm test` (54 JavaScript and 10 TypeScript tests), `pnpm typecheck`, and `pnpm build`. PGlite executed the migration (then pending) against empty and seeded Phase 1 schemas, the complete pgTAP SQL in fresh and restore mode with local auth/role/pgTAP stubs, and the new quote/import/waterfall/API-query integration path. Docker and `psql` are unavailable locally, and real Supabase/Postgres execution of Chunk 2A, the local restored-database workflow and repeatability are now verified by [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`. The locked Phase 1 PostgreSQL checks were verified in [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) and [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508). Hosted-mode restore and platform-managed backup/PITR recovery remain **unverified**.

To use a hosted test project, set these GitHub Actions repository secrets (the names are also listed in `.env.example`):

- `RESTORE_TEST_SOURCE_DATABASE_URL`: direct/admin database URL for a disposable source project with all RebateHQ migrations already applied.
- `RESTORE_TEST_TARGET_DATABASE_URL`: direct/admin database URL for a separate, fresh disposable Supabase project. The workflow refuses to restore if `public.tenant` already exists.

Select `hosted` when manually dispatching the workflow. It seeds the source project, dumps its custom roles/schema/data, restores into the fresh target, creates a new restricted app login, then runs the app-role and pgTAP checks against that restored target. Use projects created only for this drill; never use production. Recreate the target project before a later hosted run because the workflow intentionally does not drop hosted projects. Protect and rotate these secrets after use.

The database dump/restore workflow verifies application schema/data portability and post-restore security checks. It does not simulate a Supabase platform-managed daily backup or PITR operation. Keep the separate quarterly managed-backup drill below for that recovery path.

### Run and record the managed staging restore drill

Perform at launch and quarterly. Use a disposable staging project or restore into a separate test project; never restore over production for a drill. Supabase’s current guidance says the project may be inaccessible during restore and custom database-role passwords are not included in daily backup files. Storage API objects are outside the database backup. See [Supabase database backups](https://supabase.com/docs/guides/platform/backups) and [restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

1. Record project ref, database size, backup type, selected recovery timestamp, start time (UTC), and operator before starting. Prefer restoring to a new test project when that option is available; otherwise use a disposable staging project.
2. In the test project, create a uniquely named test tenant and a marker row before the selected backup point. Record its exact ID. After the backup point, create a second marker row so the drill can verify the recovery boundary.
3. Use **Database → Backups** in the Supabase Dashboard to restore the selected daily backup or configured PITR point. Keep the source project unchanged. Record the time restore starts and when Supabase reports completion.
4. Reset/recreate `rebatehq_app_login` and reapply the application secrets. Do not copy a production login password into the test project.
5. Set `SEED_DATABASE_URL` to the restored project’s direct database connection. Create a restricted app login, set `APP_DATABASE_URL` to that login’s connection string, then run `pnpm check:schema`, `pnpm check:db-role`, `pnpm test:db`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
6. Verify the pre-backup marker exists and the post-backup marker does not. Sign into the app using a test account; verify two-tenant isolation, one server-recalculated quote, CSV export, and a full owner export. Record pass/fail for each and the end time.
7. Calculate elapsed restore time (end minus start), recovery-point age/data loss, and whether the app recovered. Record the results below or in the incident log. Delete the disposable project after preserving the drill record.

| Field | Fill in after the drill |
|---|---|
| Date, operator, source/target project refs | |
| Backup type and selected recovery point (UTC) | |
| Database size | |
| Restore start/end (UTC), elapsed duration | |
| Pre-backup marker found / post-backup marker absent | |
| `check:db-role`, `test:db`, login, tenant isolation | |
| Quote, CSV export, owner export | |
| Outcome, data-loss estimate, follow-up | |

The automated Phase 1 logical restore acceptance is verified in Restore Drill #8. The separate staging drill for Supabase-managed backup/PITR remains open; it was not exercised by either run.

## Data export, deletion, and retention

- Owners can download a JSON and CSV ZIP from Account → Data migration & export. Connector secret ciphertext and cryptographic metadata are intentionally omitted, so credentials must be reconnected after restore.
- Deletion first sets `tenant.deleted_at` after an exact workspace-name confirmation and records an audit event. The tenant becomes inaccessible immediately.
- Business rows are retained for 30 days so an owner can request recovery, then an operator runs `CONFIRM_TENANT_PURGE=YES pnpm exec tsx scripts/purge-deleted-tenants.ts` with the privileged URL. Cascading deletion removes business records; audit rows are retained as append-only evidence and have no tenant foreign key.
- Audit records contain identifiers and may include limited account or invitation metadata in before/after snapshots. They are retained independently of business data. Restrict audit exports to owners/managers and handle them as confidential records.

## Incident and secret handling

- Never log request bodies, invite tokens, credentials, magic-link codes, authorization headers, cookies, or SQL error text. The application’s error logger records error class and database code only.
- Revoke compromised connector credentials at their provider, rotate `CONNECTOR_ENCRYPTION_KEY` via a reviewed re-encryption process, rotate the restricted PostgreSQL login, invalidate Supabase sessions, and review the append-only audit log.
- `DEV_IMPERSONATION_ENABLED` must remain false outside local `NODE_ENV=development`. The impersonation cookie is signed, HttpOnly, SameSite strict, expires after 15 minutes, and writes start/end audit events with the real actor id.
- Health checks return dependency status only, with no connection strings or user data.

## Import and upload behavior

Prototype JSON import is owner-only, JSON-only, capped at 2 MB, parsed in memory, schema/row-limited, and requires a fresh dry run that expires after 30 minutes. The virus-scan function is a hook placeholder: the current importer stores no uploaded file, but a managed malware scanner must be wired in before any file persistence or general-purpose upload is enabled.


## Restore Drill #9 correction — 2026-10-28

User-reported Drill #9 passed data restore and role/table/schema ACL, inventory, count, auth-ID and sentinel-hash comparisons, but lost margindesk_app EXECUTE on convert_quantity and record_data_quality_issue. The old workflow replayed locked migration 202610250002 after schema restore; its six-function list revoked grants introduced by a later migration. Sentinel/login, runtime-role and restored pgTAP steps were skipped. No #9 run URL was supplied, so this report is recorded as user-provided evidence, not a new passing-run verification.

The procedure now uses only the dump's grants plus restore-platform-acl-cleanup.sql. Both local and hosted paths omit historical migration replay. The cleanup removes only platform grantees from application-owned public objects and owner defaults, preserves application grants, excludes extension and platform-owned objects, and is idempotent. CI retains ON_ERROR_STOP, the ignored-privilege warning gate, every strict comparator section, sentinel, runtime checks, and two 73-check restore suite runs with unchanged counts. Four ACL checkpoints log the two affected helpers' owners and full grantor/grantee/privilege rows and fail if any rebatehq_app function grant changes. An early PGlite preflight reproduces the historical failure without replaying migrations against the actual target.

Function ACL checks use the single config/function-acl-allowlist.sql registry for every public function. Unknown/missing signatures, extra/missing grantees, wrong ownership and non-owner grant options fail. Existing checks were strengthened, preserving 70 fresh / 73 restore-mode plans. Future function migrations must update that registry.

The corrected workflow, local-target Supabase restore, runtime-role checks and restored-database repeatability are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. Hosted-target restore and managed backup/PITR remain **unverified**.

Local completion checks on 2026-10-28: pnpm test passed 59 JavaScript and 10 TypeScript tests; pnpm typecheck, pnpm build, pnpm check:migrations-lock and git diff --check passed. PGlite executed the complete restore-only cleanup twice (table/column/sequence/function/default-ACL paths), source-derived function definition/GRANT restore simulation, actual historical cleanup regression, all checkpoint catalog SQL, the registry SQL/views and its unknown-function/extra-grantee/missing-grant controls, and the full 70/73-check database suite with auth/role/pgTAP stubs. Docker and psql are unavailable; actual Supabase dump/restore, the direct pg driver connection paths and workflow-level runtime/repeatability checks were not executed locally. These local results do not mark any new CI-dependent item verified.

Local completion evidence — 2026-10-28: pnpm test passed 65 JavaScript and 10 TypeScript tests; pnpm typecheck and pnpm build passed. At implementation completion the lock check confirmed four applied migrations and one pending migration. Chunk 2B is now locked with the same hash; the earlier four hashes/evidence are unchanged. The complete new migration, including populated backfills and the narrowly identified legacy NorthStar demo credit repair, ran in PGlite. The modified 88/91 pgTAP SQL ran twice in each mode with identical table counts; new runtime quote/import/waterfall/rebate-audit statements and constraint rejection tests also executed. Auth/role/pgTAP platform behavior is locally stubbed; Docker and psql are unavailable. Actual Supabase CI, local-target logical restore and driver-based repeatability for Chunk 2B are now **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. Hosted-target restore remains **unverified**.

## Chunk 2C and Phase 2 — verified (2026-10-28)

Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Phase 3 had not started at that Phase 2 milestone; current Chunk 3A verification is recorded below. The inventory grew from 33 to 38 because import_job and margin_snapshot already existed and five new tables were added.

Migration `20261028173257_chunk2c_foundation_tables.sql` is locked in migrations.lock with normalized SHA-256 `03fccfa0a75954c206e2b091c474409162304d770e5803c3a7e2527bfcaa6dc3`. All five earlier locked migrations, hashes and evidence entries remain unchanged. There are no new SQL functions: the existing audit/policy helpers and the single function ACL registry remain in use. There is no UI, connector, worker, sharing endpoint, or Phase 3 implementation.

The seven table-specific controls for each of import_job, column_mapping_template, connector_sync_run, quote_share_link, approval_rule, plan_feature and margin_snapshot cover tenant indexing/forced RLS/audit, exact owner/app CRUD ACLs, own-row CRUD with three audit events, cross-tenant isolation and precise RLS 42501 write failures, separate anon/authenticated permission-denied controls, and rep denial on their own tenant. Additional checks cover metadata-only share columns, 16 constraint failures, no-auth context, and owner-only governance writes. PostgreSQL correctly hides foreign rows from UPDATE/DELETE (zero rows); foreign INSERT and reassignment of a visible row must raise a row-level-security violation, never a table-ACL denial.

Local SQL execution and CI acceptance are recorded in [CHUNK_2C_VERIFICATION.md](./CHUNK_2C_VERIFICATION.md). CI #31 passed fresh migration application, the ignored-privilege warning gate, runtime-role/no-context checks and the 156-check repeated suite. Restore Drill #12 passed all ACL checkpoints, strict role/table/function/schema ACL and count comparisons, sentinel/runtime checks and the 159-check repeated suite on a local target. Hosted-target restore, managed backup/PITR and deployed UI flows stay **unverified**. The Phase 1 open items in ASSUMPTIONS.md remain open; Phase 2 verification does not resolve them.

## Chunk 3A supplier-file review operations — 2026-10-29

Owners and managers can use **Price Lists → Review a supplier file** for a bounded, in-memory XLSX/CSV/TSV dry run. The wizard reports source issues and can save a tenant-scoped mapping template. It writes an `import_job` dry-run row and applicable `data_quality_issue` rows; it does **not** store the upload or change products, costs, prices, or quantities. There is no committed import or automated correction. If a review fails, inspect the generic request error and the job/issue metadata for that tenant; do not log or copy supplier cell contents. The managed malware scanner remains unconfigured, so persisted uploads remain disabled.

Chunk 3A is **verified in [MarginDesk CI #33](https://github.com/Adityapawar5105/rebatehq/actions/runs/40751595777), 2026-10-29, commit `7b27ba4`**. The run passed upload size/type/row/column/cell and streaming limits, macro/ZIP/XML/path/external-link rejection, inert malicious text and formula-safe exports, malformed-file fuzzing, messy-file parsing, and tenant-scoped mapping/UOM tests. The new SQL ran in PGlite on fresh and populated schemas with repeated runs and unchanged counts. The existing **156 fresh** pgTAP checks also passed twice across **38 tenant tables**. No Restore Drill was run for 3A because no migration or restore inventory changed; the **159 restore-mode** baseline remains verified by Restore Drill #12. Authenticated Next.js behavior, the deployed Supabase app, hosted-target restore, browser UI beyond the local harness, and managed backup/PITR remain **unverified**. See [CHUNK_3A_VERIFICATION.md](./CHUNK_3A_VERIFICATION.md) for test names and limits. Chunk 3B had not started at that milestone; its current status is recorded in CHUNK_3B_VERIFICATION.md.

## Chunk 3B import lifecycle — verified in CI (2026-10-29)

1. As owner/manager, open Price Lists. For a round trip choose **Export for Excel**, optionally filtering by exact supplier. The export/import maximum defaults to 10,000 data rows via `MAX_IMPORT_DATA_ROWS` in `lib/import-config.ts` (**verified in CI #37 on `32aff35`**, as cited below). Keep `md_row_id`, `md_version` and SKU; existing base units are protected. New products use blank metadata and a registered unit.
2. Upload within that maximum, map columns, and review every source issue. Issues are paged and all are downloadable. Explicitly approve the chosen text-number separator, any unit conversions and structural warnings. Grouping separators/formulas and excess decimal places remain rejected. Source bytes stay in memory; normalized plans and before records are persisted.
3. Select **Preview changes**. Review new, changed, unchanged and rejected rows in 100-row pages. For an export conflict, retain the app row, use the file row, or leave it in review. Refresh or change pages to save a choice. Every plan expires after 30 minutes; app or unit-factor changes require a new preview.
4. Commit the valid rows. If any are rejected, explicitly acknowledge that they will be skipped. Costs use standard history and prices use the reserved tenant list `RebateHQ file imports`, in tenant currency. Dates affect cost/price intervals; description/supplier changes apply immediately. Quantities do not write inventory.
5. History shows the last 50 plans/imports, actor/time, filename, written/unchanged/rejected counts and undo state. Undo requires confirmation. It restores affected business rows and removes new products/list headers only if no later edit or reference would be lost. A conflict/FK failure rolls the entire transaction back. Audit events, jobs and data-quality records are retained.

Do not bypass a stale-plan or unsafe-undo error. Review current rows and create a fresh dry run, or undo dependent work first. Duplicate commit/undo calls return conflict without applying twice. Requests log only the existing safe error class/code; never log cell values or journal payloads. The derived journal cap is 81,920,000 bytes at the default maximum; jobs follow existing tenant purge/retention behavior and have no new automatic cleanup. Keep normalized values, prior records and diagnostic metadata restricted as confidential business data.

Chunk 3B's original automated acceptance is **verified in [MarginDesk CI #35](https://github.com/Adityapawar5105/rebatehq/actions/runs/40844679109), 2026-10-29, commit `87d7d90`**. The run passed all 91 JavaScript/TypeScript tests, including conflict/exact-undo/audit, explicit decimal/unit handling, dated pricing precedence, every-new-query PGlite coverage, and repeated fresh/populated fixture counts. The existing 156 fresh pgTAP checks also passed twice on local Supabase. No Restore Drill was run because no migration or restore inventory changed; Restore Drill #12 remains the 159-check restore-mode baseline. CI #35 exercised the old 200-row implementation and does not prove the new capacity follow-up.

The browser harness used local HTTP and a fixed actor, not actual Next.js/Supabase Auth, and did not run in CI. Authenticated Next.js behavior, the deployed Supabase app, hosted restore, browser UI beyond the local harness, real concurrent sessions, pre-backup-journal undo after real restore and managed backup/PITR remain **unverified**. The prior Phase 1 open items remain open.

### Import capacity operations — verified in CI (2026-10-29)

The configurable 10,000-row maximum, batched commit/undo with exact restoration, and later-batch rollback are **verified in [MarginDesk CI #37 on `32aff35`](https://github.com/Adityapawar5105/rebatehq/commit/32aff35cd2842723206272a4147769779aa5a0d3/checks), 2026-10-29; CI job duration: 10m 24s**. This is acceptance of the PGlite capacity tests, not a deployed import benchmark.

Change `MAX_IMPORT_DATA_ROWS` in `lib/import-config.ts`, rebuild and run `pnpm test` before deploying a different limit. The default is 10,000; the byte/cell/issue/ZIP/journal bounds derive from it. A lower maximum blocks oversized pending commits. Undo has no row-count cap; journal and safety limits still apply. Oversized histories can require smaller files.

Commit and undo run 250-row SQL batches inside one outer transaction, with one catalog job and active row audit triggers. They never commit an intermediate batch. CI #37's PGlite failure injection after the first batch proves earlier business/audit/job writes roll back. Successful undo restores exact original business content and counts; job/audit history remains. The request holds database locks for its duration; real session contention and deployed throughput are **unverified**. Import routes declare 300 seconds and set a 60-second per-statement transaction-local timeout; provision the hosting request/transaction limits accordingly.

CI #37 passed boundary tests at 200, 10,000 and 10,001 rows, twice on fresh and populated PGlite schemas. The latter includes existing costs, prices, jobs, other-tenant data and conflicts on different pages. Real-Postgres timings were **not captured in CI #37**; its `IMPORT_CAPACITY_TIMING` output belongs to PGlite, and 10m 24s is the full job duration. CI #39 now supplies the real-Postgres benchmark below. Timing methodology, SQL execution coverage and remaining limits are in [IMPORT_CAPACITY_VERIFICATION.md](./IMPORT_CAPACITY_VERIFICATION.md). No Restore Drill was run for the capacity-only milestone; the later local-target Restore Drill #13 passed.

## Chunk 3C and Phase 3 operations — verified (2026-10-30)

Apply all migrations, including now-locked `20261029175710_chunk3c_invoice_actual_cost.sql`, to new databases. Its SQL and normalized hash are unchanged; six earlier locked migrations are untouched. Historical actuals remain unknown; never substitute standard costs. Readiness is equal-weight invoice completeness, requiring every line and sourced amounts in matching currency; its formula/steps/missing counts are visible. The real demo is 25%. CI #39 and local-target Restore Drill #13 verified 162/165 checks across 38 tables, planned = ran with two-run repeatability.

Set server-only `MD_SHEETS_INGESTION=true` to enable Sheets staging. Keep `MD_EMAIL_DROP_STUB`/`MD_SFTP_DROP_STUB` false unless interface previews are useful; they cannot receive mail/files. Use public/link-readable CSV links without credentials; use manual files for private/confidential Sheets until approved OAuth support exists. Save a CSV mapping first, then configure **Price Lists → Scheduled file reviews**. Explicit number/unit approvals must match the agreed format. Header changes and unsafe/oversized responses stop processing.

Configure an external scheduler to run `pnpm ingest:due` at least hourly with `APP_DATABASE_URL`, `TENANT_ID`, `ACTOR_ID` and the Sheets flag. The actor must remain an active tenant owner/manager. The runner uses the non-bypass app role and handles up to five due schedules per invocation, separately per tenant. Never pass a seed/admin URL or browser-selected identity. No recurring service is automatically deployed. Supported intervals are 1/6/24/168 hours; stored dates are UTC.

Network I/O holds no DB connection/locks. Attempts claim a ten-minute lease, advance next due time, record `connector_sync_run`, and stage reviews/dry runs. Failures retain prior plans and never commit catalog rows. Expired running claims are marked failed by a later eligible worker; a crash may delay retry until the next interval. Use Pause/Resume/manual fetch after resolving issues. “Succeeded” means staged, not committed. Review every issue/warning and commit within 30 minutes; existing history/undo applies. Distributed worker behavior remains unverified.

Restore seeds include sourced invoice actuals, a disabled Sheets schedule, its mapping parent and sync metadata. Seeding fails loudly on sentinel UUID collisions: use a clean disposable source, never suppress the error. **Verified in local-target Restore Drill #13:** strict column metadata and evidence/ingestion hashes, all existing ACL/count/sentinel/runtime checks and the repeated 165-check suite. Restore only application-owned data with ON_ERROR_STOP; use dump grants plus restore-only platform cleanup and never replay historical migrations onto a restored schema.

The **Time a 10,000-row audited commit and undo on real Postgres** step passed in [CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833): `commitImport` **11,605 ms**, `undoImport` **3,442 ms**, PostgreSQL **17.11**, restricted **`margindesk_app`**. `pnpm benchmark:import` verifies role/audits/exact restoration, rolls back its fixture and compares every table count. Parsing, setup, network and durable COMMIT/WAL flush are excluded; **this is not a serverless latency guarantee**.

**Unverified:** authenticated Next.js behavior, the deployed Supabase app, hosted-target restore, serverless time limits, recurring schedule execution (requires an operator-configured runner), live email and SFTP ingestion, and browser UI beyond the local harness. Distributed worker contention/crash recovery, formal accessibility and the Phase 1 security open items also remain open. See [CHUNK_3C_VERIFICATION.md](./CHUNK_3C_VERIFICATION.md).

## 5B restore additions — unverified until the next manual drill

The explicit dump allowlist is public,rebatehq_private; Supabase-managed schemas stay excluded. The source installs the private audit signer from the operator/CI environment BEFORE dump, and seeds synthetic licence, seat, location and device metadata alongside the retained sentinel. Preserve the source signer key via the dump; never install a different key on the restored target to make tests pass. Keep encrypted, access-controlled operator backups; dumps contain issuer security material and must never be published as artifacts. Rotation requires coordinated server environment + DB key updates; browser licence verification keys must be rebuilt with the issuer key. Hosted target restoration and a production rotation rehearsal remain unverified.

Restore owned roles, then schema with the dump's grants, then run the idempotent restore-only platform ACL cleanup (now covers the private schema as well). Restore synthetic auth references and application data with ON_ERROR_STOP and existing strict trigger handling. Never replay historical migrations on the restored schema. Compare all public table/function ACLs and counts, both schema ACLs, and the private table/sequence owner, RLS, ACL, key fingerprint and counter state. Do not widen target grants. Then create the restricted login, run the signed-context runtime/no-user check and the full 188-fresh / 191-restore suite twice, with identical tenant row counts. The sequence may advance during tests by design; tenant rows may not change.

5B CI (#65, `38911ee`) and the user-run RebateHQ Restore Drill #16 (local target) both passed on 4 November 2026, and the 5B migration is now locked. Drill #15 had failed only on a verifier bug (a NULL sequence ACL expanded with the foreign-server default `acldefault('S')` instead of `'s'`), fixed in `38911ee`. Future migrations follow the same rule: pending until CI and a user-run drill pass; PGlite or browser-only tests never count. The table-retirement plan was approved on 5 Nov 2026 (RETIREMENT_PROPOSAL.md): tables drop only inside chunks 6R and 8R, each through a new migration, CI and a user-run drill. No DROP or purge is authorized outside them.


## 7A relay restore additions — unverified until user-run drill passes

The new pending migration adds four ciphertext-relay tables; the public minimum
is now **24**. Source seeding includes a real cryptographic device registration,
epoch, wrapped key and event for the restore-sentinel tenant. Private synthetic
seed keys exist only in test-runner memory and are neither dumped nor logged.
The browser's actual private keys remain in its encrypted local vault/backup;
restoring server data cannot reconstruct them or recover lost passphrases.

Automatic inventory/strict equivalence compares all four tables' owners, exact
ACLs, columns, total/per-tenant counts and hashes over every column (ciphertext,
signatures, key wraps and routing metadata). Complete public function comparisons
and four-stage ACL checkpoints include the new helpers. A missing table/function
or changed byte must fail. Restore-only isolation additionally proves each new
table contains real restored sentinel rows that a different tenant cannot see.

Never replay old migrations over a restored schema or add app grants to make a
comparison match. Continue to use dump grants plus the restore-only platform ACL
cleanup. Keep ON_ERROR_STOP and warning gates. Run the full **155-check** restored
suite twice with no row-count residue (fresh CI suite: **152** checks). The new
migration stays pending until CI and the user's manually triggered local-target
Restore Drill both pass. Hosted target, independent protocol review, physical
crash recovery and operational key-loss recovery remain unverified.

## Chunk 8D benchmarks — operations (pending CI and Restore Drill)

- **Turning it on:** set `BENCHMARKS_ENABLED=true` and `BENCH_PSEUDONYM_KEY` (32 random bytes in hex) in the server environment, from the secret manager.
  - Never store the key in the database or in git.
  - Rotating the key unlinks every earlier contribution from its workspace. Withdrawal then cannot find old rows, so rotate only with a documented reason.
  - CI generates a per-run key with `scripts/control-plane-keys.mjs --ci-env`.
- **Releasing a quarter:** once per quarter, 45 days or more after it ends, run:

  ```
  SEED_DATABASE_URL=… node scripts/bench-release.mjs 2026-Q3
  ```

  This uses the migration administrator's connection. The database refuses an early, repeated or under-k release, and the app role cannot run it. The script prints counts only.
- **Restore:** the pseudonymous `rebatehq_private` benchmark tables are included in the dump and in the restore inventory like `actor_key`. Restoring them without the matching `BENCH_PSEUDONYM_KEY` keeps the released figures but unlinks withdrawals.
