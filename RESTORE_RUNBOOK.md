# MarginDesk logical restore runbook

## Verification status and scope

The automated **local-mode** logical restore passed end to end in [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/margindesk/actions/runs/40291362616/job/121466953508) on 2026-10-26, commit `aabfb20` (3m 47s). The [MarginDesk CI #24](https://github.com/Adityapawar5105/margindesk/actions/runs/40290388651/job/121463801598) run on the same commit passed the clean migration reset, runtime-role checks, and 53-check fresh database suite. Hosted-Supabase restore mode and Supabase-managed backup/PITR recovery have **not** been exercised.

That evidence covers the locked Phase 1 schema only. The pending Chunk 2A migration currently has **unverified** restore behavior; its expected plans are 70 fresh and 73 restore-mode checks, and the range constraints require `btree_gist` in `extensions` on the target before schema restore.

This runbook restores the application-owned logical database contents to a **disposable, fresh Supabase target**. It does not restore storage objects or prove platform-managed backup recovery. Never use a production project as the target.

## Hosted-mode prerequisites

1. Create two disposable Supabase projects: a source containing the MarginDesk data to test and a separate, empty target. Confirm that the target is new or can be safely discarded and recreated. The workflow rejects a target that already has `public.tenant`.
2. Configure both projects with their Supabase platform schemas and roles. Use direct database connection URLs suitable for schema dumps and migrations; do not use the application pool URL.
3. Apply **all MarginDesk migrations to the source before dumping**, in filename order. This includes `202610250001_revoke_platform_public_privileges.sql` and `202610250002_revoke_platform_function_privileges.sql`. Run `pnpm check:migrations-lock` and `pnpm check:schema` against the checked-out code before starting.
4. Add these GitHub Actions repository secrets, using the direct/admin URLs for the disposable projects:

   - `RESTORE_TEST_SOURCE_DATABASE_URL`
   - `RESTORE_TEST_TARGET_DATABASE_URL`

5. Do not put database URLs or passwords in the workflow prompt, logs, or a committed file. The workflow uses a random, masked test app-login password.

## Ordered restore procedure

1. Open **Actions → MarginDesk Restore Drill → Run workflow** and choose `hosted`. Keep the target disposable and do not use customer production data.
2. The workflow verifies the target is fresh and prepares a sentinel in the source. It snapshots source role attributes, ACLs, functions, and tenant row counts for strict comparison later.
3. The workflow creates separate dumps for the application-owned `public` schema and its data; Supabase-managed schemas are excluded. The role dump is filtered through explicit allowlists; only MarginDesk-owned role statements are retained. Every skipped platform statement is logged with its reason, and any statement outside the allowlists fails the job.
4. Before restoring the schema dump, install and verify `btree_gist` in the target's existing `extensions` schema. This extension supplies the exclusion-constraint operator classes but is outside the public-only dump. Then restore the owned roles and migrated `public` schema using `psql` with `ON_ERROR_STOP=1`. First apply **all MarginDesk migrations to the source**, including both ACL cleanup migrations and the pending cost/UOM/currency migration after CI verifies it. Its schema dump then carries the complete migrated schema to the target. Before the data-only restore begins, both locked ACL cleanup migrations are also applied to the target. Do not replay the foundation DDL migration on top of the restored schema dump; that dump already represents the full applied migration set.
5. Before restoring data, apply these ACL cleanup migrations to the target, in this order:

   1. `202610250001_revoke_platform_public_privileges.sql`
   2. `202610250002_revoke_platform_function_privileges.sql`

   This reapplies the table and function privilege cleanups to the restored schema before data loading. The remaining migration effects are already present in the schema dump. The workflow captures migration output and fails on ineffective GRANT/REVOKE warnings.
6. Prepare synthetic `auth.users` rows for only the user UUIDs referenced by the application data. The workflow does not copy source emails, password hashes, credentials, or other auth data.
7. Restore only the `public` application data with `ON_ERROR_STOP=1`. Restore errors stop the job; the restore does not suppress SQL failures.
8. Run the verification sequence. The workflow checks role attributes and memberships; source-versus-target table, schema, and function grants; function owners and pinned search paths; per-table and per-tenant row counts; required auth IDs; and the sentinel. It then creates the restricted app login, verifies runtime role and no-context RLS behavior, and runs the full database suite twice in restore mode.

For a manual check against a prepared disposable target, the relevant project commands are:

```sh
pnpm check:migrations-lock
pnpm check:schema
pnpm check:restore-target
pnpm check:restore-sentinel
pnpm setup:test-db-role
pnpm check:db-role
RESTORE_TEST_MODE=true RESTORE_BASELINE_PATH=/path/to/source-equivalence.json pnpm test:db:repeat
```

The last command requires `TEST_DATABASE_URL`, `APP_DATABASE_URL`, and the source snapshot path produced by the workflow. The locked Phase 1 run reported 56 planned and 56 passing checks. With the pending Chunk 2A migration, the expected plan is 73; that count remains **unverified in CI** until a complete restore run passes. Each repeatability run must preserve every application table count.

## Expected job summary

The summary should report a successful job, target mode, dump/restore/test/total timings, and the included/excluded schema scope. The comparison and sentinel steps must pass. The restored database suite must complete twice with the current planned checks equal to the number run, including restore-only checks for sentinel content hash, source tenant counts, and isolation from the restored sentinel tenant. The locked Phase 1 count was 56; pending Chunk 2A expects 73. A nonzero SQL command, unexpected skipped role statement, ACL difference, missing table, row-count difference, or test failure must fail the workflow.

## Known limits

- Local logical restore is verified by Restore Drill #8 for the locked Phase 1 schema. Chunk 2A restore remains **unverified** until the new schema, range extension, 73-check suite, and comparisons pass together. Hosted-Supabase mode remains **unverified** until this runbook succeeds against disposable hosted projects.
- Neither CI run exercised Supabase-managed daily backup or PITR recovery. Keep that separate staging recovery drill open.
- The workflow does not validate application UI actions such as creating a quote or exporting CSV/owner data against a deployed web app.
- Restore only `public` application data and owned roles. Supabase platform schemas and storage objects are provisioned by Supabase and are outside this dump/restore procedure.
