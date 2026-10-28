# MarginDesk logical restore runbook

## Verification status and scope

The automated **local-mode** logical restore passed end to end in [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/margindesk/actions/runs/40291362616/job/121466953508) on 2026-10-26, commit `aabfb20` (3m 47s). The [MarginDesk CI #24](https://github.com/Adityapawar5105/margindesk/actions/runs/40290388651/job/121463801598) run on the same commit passed the clean migration reset, runtime-role checks, and 53-check fresh database suite. Hosted-Supabase restore mode and Supabase-managed backup/PITR recovery have **not** been exercised.

Current Chunk 2A and restore-platform-ACL-cleanup acceptance is **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/margindesk/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. The migration is locked; `btree_gist` setup, all four function ACL checkpoints, full ACL/count comparisons, sentinel/runtime checks and repeated database suites passed. Current plans are 70 fresh / 73 restore mode with at least 29 tenant tables. Hosted-target restore and managed backup/PITR remain **unverified**.

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

1. Open **Actions → MarginDesk Restore Drill → Run workflow** and choose `local` or `hosted`. The workflow prints its exact named step order and runs a PGlite preflight reproducing the old grant loss and checking the replacement.
2. In local mode, start the source stack and apply all migrations once in order with a clean reset. In hosted mode, supply an already migrated disposable source. Never replay historical migrations over either source's later schema.
3. Seed the source sentinel, dump owned roles and only the migrated `public` schema/data, inventory tables and auth dependencies, filter the roles through explicit allowlists, and capture the source equivalence baseline and function ACL checkpoint. Every skipped role statement is logged; an unrecognized statement fails the job.
4. In local mode, stop/discard the source and start a fresh target. In hosted mode, require a fresh disposable target without `public.tenant`.
5. Install and verify `btree_gist` in the target's existing `extensions` schema, then restore owned roles and the complete `public` schema dump including its GRANT statements with `ON_ERROR_STOP=1`. Capture the after-schema function ACL checkpoint. Do not apply migration files to this restored schema.
6. Run `scripts/restore-platform-acl-cleanup.sql` with `ON_ERROR_STOP=1`. This idempotent restore-only script removes only PUBLIC/anon/authenticated/service_role table, column, sequence, function and default privileges for application owners. It contains no function allowlist and grants nothing. Running it after schema restore also removes ACLs inherited from target defaults during object creation. All intended application grants come from the dump. The warning gate fails on ineffective privilege statements. Capture the after-cleanup checkpoint and require all application function grants to be unchanged.
7. Prepare synthetic `auth.users` rows for only the referenced UUIDs, without source emails, password hashes or secrets. Restore only application data with `ON_ERROR_STOP=1`, then capture the after-data ACL checkpoint.
8. Compare source/target role attributes and memberships; full table/schema/function ACLs and metadata; inventory, per-table/per-tenant counts; auth IDs; and sentinel hash. Keep every section strict. Verify the sentinel, create the restricted app login, verify runtime-role/no-context RLS, and run the complete restore-mode database suite twice (73 planned = 73 run each time) with unchanged row counts.

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

The last command requires `TEST_DATABASE_URL`, `APP_DATABASE_URL`, and the source snapshot path. The current 70 fresh / 73 restore-mode plans, planned = ran and unchanged counts after two runs are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/margindesk/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`** (local target). The earlier Phase 1 restore plan had 56 checks.

## Restore Drill #9 finding and current status

On 2026-10-28, the user reported that Drill #9 restored data and passed role, table/schema ACL, inventory, row-count, auth-reference and sentinel-hash comparisons. The complete function comparison failed because the old target cleanup replay removed EXECUTE from the two later Chunk 2A helpers. Subsequent sentinel/login, runtime-role and 73-check suite steps were skipped; they were not verified by that run. No run URL was supplied for #9.

The corrected procedure is **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/margindesk/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`** for local targets. The preflight regression proves the old cleanup loses later function grants; the actual Supabase dump/restore then passed every ACL checkpoint, strict comparison and post-restore verification. Hosted-target execution remains **unverified**.

## Expected job summary

The log and summary must show the exact named workflow order and full owner/grantor/grantee/privilege ACLs for both helpers at source, after schema restore, after cleanup, and after data restore. Every adjacent checkpoint must preserve all application function grants. The summary should report a successful job, target mode, dump/restore/test/total timings, and the included/excluded schema scope. The comparison and sentinel steps must pass. The restored database suite must complete twice with the current planned checks equal to the number run, including restore-only checks for sentinel content hash, source tenant counts, and isolation from the restored sentinel tenant. The locked Phase 1 count was 56; locked Chunk 2A uses 73. A nonzero SQL command, unexpected skipped role statement, ACL difference, missing table, row-count difference, or test failure must fail the workflow.

## Known limits

- Phase 1 local restore was verified by #8. Chunk 2A and the corrected cleanup procedure are verified by [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/margindesk/actions/runs/40711768732), 2026-10-28, commit `d4c907c`, including the extension, ACLs and 73-check suite. Hosted-Supabase mode remains **unverified** until this runbook succeeds against disposable hosted projects.
- Neither CI run exercised Supabase-managed daily backup or PITR recovery. Keep that separate staging recovery drill open.
- The workflow does not validate application UI actions such as creating a quote or exporting CSV/owner data against a deployed web app.
- Restore only `public` application data and owned roles. Supabase platform schemas and storage objects are provisioned by Supabase and are outside this dump/restore procedure.
