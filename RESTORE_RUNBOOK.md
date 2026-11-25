# RebateHQ logical restore runbook

## Verification status and scope

**Current Chunk 3C and Phase 3 acceptance is verified in [MarginDesk CI #39](https://github.com/Adityapawar5105/rebatehq/actions/runs/40937330833) and [MarginDesk Restore Drill #13](https://github.com/Adityapawar5105/rebatehq/actions/runs/40938982321), 2026-10-30 (Asia/Calcutta), commit `2f8b06d`.** The local-target drill passed end to end with **165 restore-mode checks**, while CI passed **162 fresh checks**, planned = ran and two-run repeatability, across **38 tenant tables**. All seven migrations are locked. This verifies the dump-grants plus restore-only platform cleanup procedure, including the expanded column/evidence/ingestion inventory; it does not verify hosted-target mode. Phase 4 has not started.

The automated **local-mode** logical restore passed end to end in [MarginDesk Restore Drill #8](https://github.com/Adityapawar5105/rebatehq/actions/runs/40291362616/job/121466953508) on 2026-10-26, commit `aabfb20` (3m 47s). The [MarginDesk CI #24](https://github.com/Adityapawar5105/rebatehq/actions/runs/40290388651/job/121463801598) run on the same commit passed the clean migration reset, runtime-role checks, and 53-check fresh database suite. Hosted-Supabase restore mode and Supabase-managed backup/PITR recovery have **not** been exercised.

Current Chunk 2A and restore-platform-ACL-cleanup acceptance is **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`**. The migration is locked; `btree_gist` setup, all four function ACL checkpoints, full ACL/count comparisons, sentinel/runtime checks and repeated database suites passed. At that Chunk 2A commit, plans were 70 fresh / 73 restore mode with at least 29 tenant tables. Hosted-target restore and managed backup/PITR remain **unverified**.

This runbook restores the application-owned logical database contents to a **disposable, fresh Supabase target**. It does not restore storage objects or prove platform-managed backup recovery. Never use a production project as the target.

## Chunk 2B verification status — verified

The locked pricing/rebate migration and local-target restore are **verified in [MarginDesk CI #29](https://github.com/Adityapawar5105/rebatehq/actions/runs/40729384500) and [MarginDesk Restore Drill #11](https://github.com/Adityapawar5105/rebatehq/actions/runs/40730343531), 2026-10-28, commit `13cea5a`**. At that Chunk 2B milestone, the minimum was **33 tenant tables**, with **88 fresh / 91 restore-mode checks**, planned = ran and unchanged counts after two suite runs. The dump, all ACL checkpoints, strict ACL/metadata/per-tenant count comparisons, sentinel and runtime-role checks passed. Restore-only platform cleanup preserves dump grants; historical migrations are not replayed. Hosted-target restore and managed backup/PITR remain **unverified**. See [the verification record](docs/evidence/CHUNK_2B_VERIFICATION.md).

## Hosted-mode prerequisites

1. Create two disposable Supabase projects: a source containing the RebateHQ data to test and a separate, empty target. Confirm that the target is new or can be safely discarded and recreated. The workflow rejects a target that already has `public.tenant`.
2. Configure both projects with their Supabase platform schemas and roles. Use direct database connection URLs suitable for schema dumps and migrations; do not use the application pool URL.
3. Apply **all RebateHQ migrations to the source before dumping**, in filename order. This includes `202610250001_revoke_platform_public_privileges.sql` and `202610250002_revoke_platform_function_privileges.sql`. Run `pnpm check:migrations-lock` and `pnpm check:schema` against the checked-out code before starting.
4. Add these GitHub Actions repository secrets, using the direct/admin URLs for the disposable projects:

   - `RESTORE_TEST_SOURCE_DATABASE_URL`
   - `RESTORE_TEST_TARGET_DATABASE_URL`

5. Do not put database URLs or passwords in the workflow prompt, logs, or a committed file. The workflow uses a random, masked test app-login password.

## Ordered restore procedure

1. Open **Actions → RebateHQ Restore Drill → Run workflow** and choose `local` or `hosted`. The workflow prints its exact named step order and runs a PGlite preflight reproducing the old grant loss and checking the replacement.
2. In local mode, start the source stack and apply all migrations once in order with a clean reset. In hosted mode, supply an already migrated disposable source. Never replay historical migrations over either source's later schema.
3. Seed the source sentinel, dump owned roles and only the migrated `public` schema/data, inventory tables and auth dependencies, filter the roles through explicit allowlists, and capture the source equivalence baseline and function ACL checkpoint. Every skipped role statement is logged; an unrecognized statement fails the job.
4. In local mode, stop/discard the source and start a fresh target. In hosted mode, require a fresh disposable target without `public.tenant`.
5. Install and verify `btree_gist` in the target's existing `extensions` schema, then restore owned roles and the complete `public` schema dump including its GRANT statements with `ON_ERROR_STOP=1`. Capture the after-schema function ACL checkpoint. Do not apply migration files to this restored schema.
6. Run `scripts/restore-platform-acl-cleanup.sql` with `ON_ERROR_STOP=1`. This idempotent restore-only script removes only PUBLIC/anon/authenticated/service_role table, column, sequence, function and default privileges for application owners. It contains no function allowlist and grants nothing. Running it after schema restore also removes ACLs inherited from target defaults during object creation. All intended application grants come from the dump. The warning gate fails on ineffective privilege statements. Capture the after-cleanup checkpoint and require all application function grants to be unchanged.
7. Prepare synthetic `auth.users` rows for only the referenced UUIDs, without source emails, password hashes or secrets. Restore only application data with `ON_ERROR_STOP=1`, then capture the after-data ACL checkpoint.
7a. Team sharing S3: run `scripts/restore-storage-objects.sql` with `ON_ERROR_STOP=1` after the data restore. Dumps exclude the Supabase-managed `storage` schema, so this idempotent script recreates the private `relay-packs` bucket and its two policies, which call `rebatehq_storage.relay_storage_allowed` (restored from the dump with schema `rebatehq_storage`). A real restore needs the same step.
8. Compare source/target role attributes and memberships; full table/schema/function ACLs and metadata; inventory, per-table/per-tenant counts; auth IDs; and sentinel hash. Keep every section strict. Verify the sentinel, create the restricted app login, verify runtime-role/no-context RLS, and run the complete restore-mode database suite twice (91 planned = 91 run each time for locked Chunk 2B) with unchanged row counts.

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

The last command requires `TEST_DATABASE_URL`, `APP_DATABASE_URL`, and the source snapshot path. The locked Chunk 2A 70 fresh / 73 restore-mode plans, planned = ran and unchanged counts after two runs are **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`** (local target). The earlier Phase 1 restore plan had 56 checks.

## Restore Drill #9 finding and current status

On 2026-10-28, the user reported that Drill #9 restored data and passed role, table/schema ACL, inventory, row-count, auth-reference and sentinel-hash comparisons. The complete function comparison failed because the old target cleanup replay removed EXECUTE from the two later Chunk 2A helpers. Subsequent sentinel/login, runtime-role and 73-check suite steps were skipped; they were not verified by that run. No run URL was supplied for #9.

The corrected procedure is **verified in [MarginDesk CI #27](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711121913) and [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`** for local targets. The preflight regression proves the old cleanup loses later function grants; the actual Supabase dump/restore then passed every ACL checkpoint, strict comparison and post-restore verification. Hosted-target execution remains **unverified**.

## Expected job summary

The log and summary must show the exact named workflow order and full owner/grantor/grantee/privilege ACLs for both helpers at source, after schema restore, after cleanup, and after data restore. Every adjacent checkpoint must preserve all application function grants. The summary should report a successful job, target mode, dump/restore/test/total timings, and the included/excluded schema scope. The comparison and sentinel steps must pass. The restored database suite must complete twice with the current planned checks equal to the number run, including restore-only checks for sentinel content hash, source tenant counts, and isolation from the restored sentinel tenant. The locked Phase 1 count was 56; locked Chunk 2A used 73; locked Chunk 2B passed 91 in Restore Drill #11. A nonzero SQL command, unexpected skipped role statement, ACL difference, missing table, row-count difference, or test failure must fail the workflow.

## Known limits

- Phase 1 local restore was verified by #8. Chunk 2A and the corrected cleanup procedure are verified by [MarginDesk Restore Drill #10](https://github.com/Adityapawar5105/rebatehq/actions/runs/40711768732), 2026-10-28, commit `d4c907c`, including the extension, ACLs and 73-check suite. Hosted-Supabase mode remains **unverified** until this runbook succeeds against disposable hosted projects.
- Neither CI run exercised Supabase-managed daily backup or PITR recovery. Keep that separate staging recovery drill open.
- The workflow does not validate application UI actions such as creating a quote or exporting CSV/owner data against a deployed web app.
- Restore only `public` application data and owned roles. Supabase platform schemas and storage objects are provisioned by Supabase and are outside this dump/restore procedure.

## Chunk 2C and Phase 2 — verified

The Chunk 2C migration is **locked** with unchanged content/hash. Chunk 2C and Phase 2 are **verified in [MarginDesk CI #31](https://github.com/Adityapawar5105/rebatehq/actions/runs/40739445610) and [MarginDesk Restore Drill #12](https://github.com/Adityapawar5105/rebatehq/actions/runs/40740709133), 2026-10-28, commit `ed2aa6d`**. At that Phase 2 milestone, acceptance was **156 fresh / 159 restore-mode pgTAP checks**, planned = ran with two-run repeatability, across **38 tenant tables**. The Chunk 2C migration is locked with its unchanged normalized hash. Hosted-target restore, managed backup/PITR and deployed UI flows not exercised by these runs remain **unverified**. Phase 3 had not started at that milestone. Restore the dump's complete public schema and grants, followed only by restore-platform-acl-cleanup.sql, as above; never replay historical migrations. Dynamic inventory/ACL/count comparisons now require **38 tenant tables**, including column_mapping_template, connector_sync_run, quote_share_link, approval_rule and plan_feature; import_job and margin_snapshot remain included. Missing tables, unexpected grants and any per-tenant count mismatch still fail. No public functions are added; every existing function remains in the exact ACL registry and strict source/target comparison.

Restore Drill #12 passed **159 planned = 159 ran** twice with identical before/after counts; CI #31 passed **156** fresh checks with repeatability. Restored sentinel hash/count/isolation checks remain mandatory. Local PGlite testing exercises populated rows in all seven 2C-scope tables, but is not a logical dump/restore or a hosted Supabase run. Actual Chunk 2C local-target logical restore is verified by Restore Drill #12 as cited above. Hosted-target restore remains **unverified** because the hosted steps were skipped. Earlier #11 remains historical Chunk 2B evidence.

Rollback note: export the five new tables before removing them in reverse dependency order, then remove only the three new import_job CHECK constraints if necessary. This is a manual destructive rollback, not an automatic script. Preserve existing import jobs, quotes, margin snapshots and audit records; use a fresh full logical restore for disaster recovery.

## Chunk 3A note — 2026-10-29

Chunk 3A reuses the existing import-job, mapping-template and data-quality tables and adds no database objects. The restore procedure is unchanged: restore the dump's public schema and grants, apply only the restore-only platform ACL cleanup, and never replay historical migrations on the restored schema. The dynamic inventory minimum remains **38 tenant tables** with **156 fresh / 159 restore-mode** pgTAP checks. Review/template rows are covered by the existing public-table row-count and ACL comparisons. Chunk 3A's automated checks passed CI #33 on `7b27ba4`; no Restore Drill was run for it because no migration or inventory changed. Restore Drill #12 remains the local-target database baseline; hosted-target mode and managed backup/PITR remain **unverified**.

## Chunk 3B note — 2026-10-29

Import/export baselines, dry runs and undo journals reuse `import_job.summary`. No schema, function, ACL or inventory changed in Chunk 3B, so the same strict dump/restore and 38-table minimum apply; do not replay historical migrations. The existing row-count/ACL comparison includes all journal rows. That milestone's plans were 156 fresh / 159 restore mode; the later CI #39 / local-target Restore Drill #13 passed with Chunk 3B present and the current 162/165 plans.

After logical restore, create fresh lifeline exports and dry runs: their physical revision stamps may differ from pre-backup values. Undo compares recorded business values/IDs instead of physical revisions, but an end-to-end undo of a pre-backup journal on an actual Supabase restore remains **unverified**. Preserve the recorded journal and all audit events; never remove conflict checks to force an undo. Restore-only platform cleanup remains the only post-schema cleanup step.

## Chunk 3C inventory and Phase 3 acceptance — verified in local Restore Drill #13

The now-locked `20261029175710_chunk3c_invoice_actual_cost.sql` must be applied to the source before dumping it; its normalized hash and SQL are unchanged. Keep the verified procedure: restore the complete dumped schema/grants, use only restore-platform ACL cleanup, then restore data with ON_ERROR_STOP. Never replay historical migrations on that restored schema.

The source seeder now includes sourced invoice actual cost/freight/rebate evidence, a disabled Sheets schedule, its actual CSV-mapping parent and a terminal sync run. Fixed sentinel tenant/product IDs are preserved; all additional fixture IDs are generated in dependency order. An existing sentinel causes a clear collision failure; use a clean disposable source.

Source/target comparison now also requires identical application column names/types/nullability/defaults (including the two invoice actual-cost fields) and content hashes for invoice actuals, mappings/schedules and sync runs. Values/URLs are not printed. Existing table/function/schema ACL, membership, counts, auth dependencies and sentinel checks remain strict. The table minimum stays 38 because no tables/functions were added. The post-restore suite now plans **165 checks** (fresh: **162**) and must pass twice with unchanged counts.

The job summary for Restore Drill #13 reports PASS for the new column inventory and evidence/metadata hashes alongside all earlier strict comparison sections. Source/target role attributes/memberships, all table/function/schema ACLs, table inventory, row counts/per-tenant counts, auth dependencies, sentinel and runtime/no-context checks passed, followed by the 165-check suite twice with unchanged counts.

CI #39 also verified the separate real-Postgres 10,000-row benchmark: `commitImport` **11,605 ms**, `undoImport` **3,442 ms**, PostgreSQL **17.11**, **`margindesk_app`**. Parsing, setup, network and durable COMMIT/WAL flush are excluded; **this is not a serverless latency guarantee** and is not a restore duration.

**Unverified:** authenticated Next.js behavior, the deployed Supabase app, hosted-target restore, serverless time limits, recurring schedule execution (needs an operator-configured runner), live email and SFTP ingestion, and browser UI beyond the local harness. Managed backup/PITR and pre-backup journal undo after real restore also remain unverified. Evidence and local results are in [docs/evidence/CHUNK_3C_VERIFICATION.md](docs/evidence/CHUNK_3C_VERIFICATION.md).

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

## Team sharing S3 restore additions — verified in local Restore Drill #25

Verified 25 November 2026 in the user-run [Restore Drill #25](https://github.com/Adityapawar5105/rebatehq/actions/runs/45557077582) on `c36bda4` (local target): the three schemas were dumped, step 7a re-created the bucket and both policies on the fresh target, and the 155-check restore plan passed twice. A hosted-target restore of Storage objects remains unverified.

Migration `20261126120000_sharing_s3_storage.sql` adds schema `rebatehq_storage`, which holds one SECURITY DEFINER function,
`relay_storage_allowed(text,boolean)`. Only `authenticated` may use it, and the Data API does not expose the schema.
It also adds the private `relay-packs` bucket and two `storage.objects` policies (read, insert).

- The dump allowlist is now `public,rebatehq_private,rebatehq_storage` (`scripts/restore-dump-scope.mjs`). The equivalence check compares
  the three schema ACLs and the function ACLs of `public` and `rebatehq_storage`.
- The bucket row and policies live in `storage`, which is never dumped. The drill re-applies them with
  `scripts/restore-storage-objects.sql` (step 7a) before pgTAP, whose S3 checks run in restore mode too.
- Encrypted pack chunks (Storage objects) are not restored. After a restore, a publisher opens Settings › Team and roles and
  presses **Publish now**, or rotates keys, which publishes a fresh copy for every holder. Pack-version rows restored without their
  chunks fail the manifest check on download and are never applied.
