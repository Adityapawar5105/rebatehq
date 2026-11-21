# Migration rules

Applied migrations are immutable. The passing Phase 1 baseline is recorded in [`migrations.lock`](./migrations.lock) from [MarginDesk CI #14](https://github.com/Adityapawar5105/rebatehq/actions/runs/40137557258) on 2026-10-24. Add schema changes in a new, timestamped SQL migration. Never edit a locked migration. When a new migration has passed CI and is applied, add its SHA-256 to `migrations.lock` and advance `appliedThrough` in a follow-up change.

Every new application table must:

- include `tenant_id uuid` (nullable only when its data model requires it);
- enable and force row-level security, with policies scoped to the intended roles and tenant;
- be included in the explicit table list used for RLS and audit triggers;
- receive the `audit_row_change` trigger unless it is the append-only `audit_log` table itself;
- have a valid tenant fixture in `supabase/tests/phase1_rls.sql`. The pgTAP harness enumerates every application table in `public`, fails if a fixture is missing, and runs own-tenant positive controls and cross-tenant isolation checks against that set.

Every new function must be created with a pinned `search_path` if it is `SECURITY DEFINER`, followed by an explicit `REVOKE ALL ON FUNCTION ... FROM PUBLIC`. Add only the required role grants with an explicit grantee list; never grant EXECUTE to `PUBLIC`. In the same change, update the single checked-in registry [`config/function-acl-allowlist.sql`](./config/function-acl-allowlist.sql) with its schema-qualified signature (argument types, not argument names) and exact EXECUTE grantees. `$owner` resolves to the catalog owner; it does not hardcode the CI login. The registry covers every public function, including SECURITY INVOKER and trigger functions. The existing pgTAP checks consume this registry and reject unknown or missing functions, unexpected owners, extra or missing grantees, and non-owner EXECUTE grant options. Do not add a second function allowlist to a restore script or test. Keep function default EXECUTE privileges restricted.

Never replay historical migrations over a restored schema. The schema dump already contains the complete migrated definition and intended grants; an old migration's grant list cannot account for functions added later. Use only the restore procedure's platform-grant cleanup, which revokes platform access and preserves the dump's application grants. Source and restored function ACLs must remain exactly equal.

Never GRANT or REVOKE privileges on Supabase-managed `auth`, `storage`, or `extensions` objects. Use a narrowly scoped function in an application-owned schema when the product needs a privileged operation.

Every pull request runs these gates:

- `pnpm check:migrations-lock` checks the SHA-256 of each applied migration;
- `pnpm check:schema` checks duplicate objects, tenant columns, RLS, audit coverage, and the owner/manager-only audit read policy;
- `pnpm test` checks service-role usage and migration/test structure;
- CI applies all migrations with warning capture and fails on ineffective GRANT/REVOKE warnings;
- `pnpm test:db` runs the full pgTAP tenant-isolation, role, audit, and append-only suite against every application table.

Keep every database assertion non-vacuous: provide valid positive fixtures and assert expected RLS failures are policy violations rather than missing table privileges. Do not delete or relax checks to obtain a passing run.

## 5B global security metadata exception

The explicitly reviewed owner-only table rebatehq_private.actor_key has a nullable tenant_id constrained to NULL (global issuer material), forced RLS, zero app/platform privileges, and redacted operation-only audit coverage. No new private/global table is accepted by the schema lint without a new review. The private login_budget sequence has no app privileges and deliberately survives rollback. Include both in restore scope/inventory and compare key fingerprints (never values), counter state, owner, RLS and full ACLs. The public tenant-table minimum is now 42. Neither object stores customer business data. Public functions still require the single exact function ACL registry. Legitimate CREATE OR REPLACE across different NEW migrations is allowed; duplicate definitions within a migration and non-replacement duplicates still fail.


## Current inventory after 7A (pending evidence)

> **21 Nov 2026 (roadmap 13.6):** historical heading. The 7A migration has been locked since 5 November 2026 (CI #82, Restore Drill #19), and later migrations up to 8R and the operator subscriptions view are locked too: 14 applied, 0 pending. The "must not be locked until" paragraph below describes the state before that evidence.

The public tenant-table minimum is **24**, superseding the historical 42/20
counts above. The four append-only relay tables have explicit dependency-ordered
fixtures in `supabase/tests/chunk7a_relay.sql`, included by the shared SQL loader;
152 fresh / 155 restore-mode checks are required, with planned == ran. They have
positive SELECT/INSERT controls, real cross-tenant RLS denials, exact ACLs,
platform-role denials, no-context isolation and metadata-only audit checks.
No app UPDATE/DELETE/TRUNCATE is permitted on them. Every new helper remains in
the one function ACL registry. The pending migration must not be locked until
both green CI and a **user-run** Restore Drill pass. Only pending lock entries
may change in this chunk; all ten applied SQL hashes remain frozen.

## 8D benchmark exception and inventory (locked 11 November 2026)

`20261111120000_chunk8d_benchmarks.sql` is **locked**. It passed [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) on `63ba49c` and the user-run [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569) on `e7cb5fc`; 12 migrations are applied and 0 are pending.

**Tenant inventory.** The public tenant-table minimum is now **25**: `bench_consent` joins the 24. It is tested in `supabase/tests/chunk8d_bench.sql`, loaded by the shared SQL loader, which has its own fixtures and is excluded from the generic fixture graph like the licence and relay tables. Fresh runs plan **169** checks; restore runs plan **172**.

**Reviewed private exception.** The schema lint accepts exactly four new private tables, as listed in `scripts/check-schema.mjs` (`BENCH_PRIVATE`). Each must have:
- `tenant_id uuid CHECK(tenant_id IS NULL)`;
- RLS enabled and forced;
- `REVOKE ALL … FROM PUBLIC,anon,authenticated,service_role,rebatehq_app`;
- no grant and no trigger.

A row audit is deliberately absent: it would link a pseudonymous contribution to its sender.

**Functions.** The new functions are in the one function ACL registry. `bench_publish` is owner-only (no app grant).

## 8R inventory (locked 13 November 2026)

`20261113120000_chunk8r_retire_wave2.sql` is **locked**. It passed [CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489) on `436459c` and the user-run [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552) on `7683d7b`; 13 migrations are applied and 0 are pending.

**Tenant inventory.** The public tenant-table minimum is now **13**, superseding the 25 above. The 5B check counts exactly 13 and asserts that `quote` and `fx_rate` are gone. The restore tooling and the repeatability check use the same minimum:
- `verify-restore-equivalence.mjs`;
- `inspect-restore-dump.mjs`;
- `test-db-repeatability.ts`;
- `tests/helpers/database.ts`.

**pgTAP.** Fresh runs plan **136** checks; restore runs plan **139**. The 33 removed checks tested only the dropped tables:
- ACLs, positive controls and constraint checks for `fx_rate`, `rebate_tier`, `rebate_entry`, `quote_share_link` and `approval_rule`;
- the server self-approval check on `approval`.

Two checks were rewritten for tables that remain:
- the no-context check now covers every readable public tenant table;
- the manager-governance check now covers `invite`.

**Fixture graph.** The generic graph keeps four tables: `tenant`, `membership`, `invite` and `audit_log`. The licence, relay and benchmark-consent tables keep their own fixtures in the 5B, 7A and 8D include files.

## Operator subscriptions (locked, 15 November 2026)

`20261114120000_operator_subscriptions.sql` adds `workspace_licence.plan_type` (`pilot`/`paid`, default `pilot`), the read-only view `rebatehq_private.subscriptions` and the SECURITY INVOKER function `rebatehq_private.set_subscription(text,text,text,timestamptz)`. No table is added, so the tenant-table minimum stays **13**. The view and function are revoked from `PUBLIC, anon, authenticated, service_role, rebatehq_app`, and the private schema's USAGE was already revoked from those roles; the public function ACL registry does not cover the private schema. pgTAP now plans **139** fresh and **142** restore checks (three new checks in `chunk5b_control.sql`: the pilot default, the closed ACLs, and a real `set_subscription` call that is then undone). The restore licence hash includes `plan_type`. A rolled-back dry run on `rebatehq-staging` succeeded on 14 November 2026. After [CI #158](https://github.com/Adityapawar5105/rebatehq/actions) passed on PR #1, the migration was applied to `rebatehq-staging` the same day, recorded as version `20261114120000` (14 migrations there); the view and function were checked closed to every API role. It is now **locked**: [CI #160](https://github.com/Adityapawar5105/rebatehq/actions/runs/43623569198) and [Restore Drill #22](https://github.com/Adityapawar5105/rebatehq/actions/runs/43623613500) (local target, started at the user's request) passed on `ceea3af`, and [CI #161](https://github.com/Adityapawar5105/rebatehq/actions/runs/43623806190) passed on `4ad0960`; 14 migrations are applied and 0 are pending.
