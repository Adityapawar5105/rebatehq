# Chunk 5B verification — CI-verified and Restore Drill passed

4 November 2026. Blueprint unchanged. No 6A or table retirement.

**5B CI-verified** in [RebateHQ CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) on `38911ee`, and [RebateHQ Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) passed on the same commit (local target), 4 November 2026. [CI #63](https://github.com/Adityapawar5105/rebatehq/actions/runs/41874224017) on `8867b96` and [CI #64](https://github.com/Adityapawar5105/rebatehq/actions/runs/41876409721) on `1dd9451` also passed. `20261104160022_chunk5b_control_plane.sql` is now **locked** in migrations.lock with its hash unchanged (`5eb84212…c34d`).

| Gate | Result in CI #65 / Drill #16 |
|---|---|
| Unit tests | 75 JavaScript + 128 TypeScript passed, 0 failed |
| Real Postgres pgTAP | 188 checks (`1..188`), run twice by the repeatability command |
| Authenticated privacy gate | `auth: true`, `status: passed`, 33 named checks, including `retiredHandlers`, `retiredRoutesOff`, `signedLicence`, `licenceUpgradePrompt`, `revokedReadOnlyRecovery`, `cipherOnly` and `privacy` |
| Restore Drill #16 (local) | Passed: role/ACL/row-count comparison, private issuer key fingerprint, counter and ACL, sentinel, runtime role/no-context RLS, and the restored-database pgTAP suite twice. Dump 6 s, restore 42 s, total 195 s (GitHub runner; not a production guarantee) |

**Restore Drill #15 failed** ([run](https://github.com/Adityapawar5105/rebatehq/actions/runs/41881255828)) in “Private issuer material differs”. The restored data was correct. The verifier filled a NULL sequence ACL with `acldefault('S')`, the foreign-server default (USAGE only), instead of the sequence default `'s'` (SELECT, UPDATE, USAGE). pg_dump omits an ACL equal to the owner default, so the restored `rebatehq_private.login_budget` has a NULL ACL while the source kept the explicit one created by the migration's REVOKE. `38911ee` fixed the verifier and the same typo in the restore-only cleanup (harmless there), and added `tests/restore-private-issuer.test.js`, which reproduces the NULL-ACL case and still fails on a real ACL difference. No migration or check was weakened.

## Scope and commits

- `b4c3ec8` — Record 5A CI verification; pushed. CI #59/#60/#61 evidence is linked in CHUNK_5A_VERIFICATION.md. The documentation close-out itself also passed [CI #62](https://github.com/Adityapawar5105/rebatehq/actions/runs/41862659637).
- `826e36c` — Default-off retirement gate and retirement proposal.
- `8867b96` — signed licences, audit verification and control-plane security; [CI #63](https://github.com/Adityapawar5105/rebatehq/actions/runs/41874224017) passed.
- `1dd9451` — local capacity upgrade action and its tests; new migration/hash unchanged; [CI #64](https://github.com/Adityapawar5105/rebatehq/actions/runs/41876409721) passed.
- `38911ee` — restore verifier ACL-default fix after Drill #15; [CI #65](https://github.com/Adityapawar5105/rebatehq/actions/runs/41883249192) and [Restore Drill #16](https://github.com/Adityapawar5105/rebatehq/actions/runs/41886437905) passed.

The only new migration is `20261104160022_chunk5b_control_plane.sql`, now **locked** in migrations.lock (it was pending until CI #65 and Drill #16 passed). The eight previously locked SQL files and their hashes are unchanged. The suite keeps the original 162 checks and adds 26: **188 fresh / 191 restore-mode**, with **42 public tenant tables**. The owner-only private issuer key table and private sequence are covered separately, not disguised as tenant business tables.

## What changed

The status column below is the original local record. CI #65 and Restore Drill #16 have since covered real Postgres, the authenticated HTTP probes and the restore (see the gate table above); hosted-target restore and deployed configuration remain unverified.

| Task | Implementation | Evidence/status (local record) |
|---|---|---|
| Licences | Four tenant tables, exact RLS/ACL/audit, seat/invite/location caps, device approval/revocation; operator-only pilot issuer | Local PGlite passes; real Postgres CI and restore **unverified** |
| Vault authority | Ed25519 assertions verified in browser and worker with a pinned public key; one-hour online life, up to 24h offline grace, five-minute refresh, read-only on denial/expiry | Unit and synthetic browser harness local only; authenticated CI **unverified** |
| Caps | One policy definition; Starter 20k/200k, Professional 100k/1M, Scale 200k/1M; licensed tier or lower; import/Fix Later/Playground share the effective tier | Every tier boundary in local tests; over-limit UI upgrade prompt in Chrome/Edge |
| Server retirement | Exact API registry, every class C/X handler returns 410 before reading request/auth/DB; pages 404; links hidden; audit API fixed metadata projection | Route unit tests local pass; authenticated HTTP probes pending CI |
| Actor trust | HMAC request identity binds verified subject/actor, backend PID, transaction, expiry and nonce; both append boundary and triggers verify it | Raw JWT/actor spoof and cross-transaction replay fail locally; CI **unverified** |
| Failed login | 320/45/1000 byte limits; fixed null-tenant/null-actor event; 8 committed events per email/IP/10min and global sequence-backed 1000/10min | Direct-call and rollback checks pass locally; CI **unverified** |
| Restore | Public + private schema allowlist; dump grants + restore-only cleanup; no historical migration replay; strict public ACL/count and private-key fingerprint/counter comparison | Cleanup idempotence and SQL local pass; new manual Restore Drill **unverified** |

The 38 retained foundation tables keep their explicit fixture graph. The four new tables have operation-specific controls in `supabase/tests/chunk5b_control.sql`; they are not incorrectly required to allow all CRUD operations. A future untested public table still makes the fixture-inventory gate fail. The restore-only sentinel isolation loop includes all 42 tables, with existing licence rows included in the populated PGlite run.

The database tests use a rollback-only `pg_temp.use_identity` signer to simulate the already-verified web request. This helper is never installed by a migration, and is never used to sign the deliberately forged actor in the negative tests. No production app grant is widened for pgTAP.

## Local validation commands and results

PowerShell on AMD Ryzen 5 5600H, Windows 11 build 26200, about 7.35 GiB usable RAM, Node 24.22.1. These are **local only**, not CI evidence.

| Command | Result |
|---|---|
| `git status --short`, `git diff --stat`, source/doc inspection with `Get-Content` and `rg` | Inventoried partial work; pre-existing `.claude/` left untouched |
| Supabase CLI `--help` / `migration new chunk5b_control_plane` via the installed CLI | New migration created; no locked migration edited |
| `node --test tests/*.test.js` | 74 passed after fixes |
| `node .../tsx/dist/cli.mjs --test tests/*.test.ts` | First run 122/124; benchmark fixture lacked the new signer. Fixed setup; no security test weakened |
| `pnpm test` | 74 JS + 125 TS passed; subsequently added API/operator tests also passed individually |
| `node .../tsx/dist/cli.mjs --test tests/control-plane.test.ts tests/licence.test.ts` | Passed; complete SQL, tier limits, signature binding/replay and private cleanup |
| `node .../tsx/dist/cli.mjs --test tests/ingestion.test.ts tests/vault-auth-setup.test.ts tests/chunk3c-restore.test.ts` | 9 passed after benchmark fixture fix |
| `node --test tests/chunk2a-pgtap.test.js tests/schema-migration-lint.test.js tests/restore-role-filter.test.js` | 19 passed; fresh and populated/restored SQL, planned == ran |
| `node .../tsx/dist/cli.mjs --test tests/licence.test.ts tests/licence-api.test.ts tests/licence-operator.test.ts` | 5 passed; all admin endpoint and issuer/key-installer SQL branches executed |
| `pnpm install --frozen-lockfile` | Passed; lock unchanged. Existing Windows arrow2csv bin-link warning; unused by this app |
| `pnpm typecheck` | Passed. An intermediate BigInt-literal target error was fixed using BigInt constructors |
| `pnpm build` | Passed after making /account/licence dynamic; no fake Supabase environment was supplied |
| `pnpm check:migrations-lock` | Passed: eight locked, one pending |
| `pnpm check:schema` | Passed: 42 public tenant tables |
| `node scripts/check-service-role.mjs` | Passed, nonzero scan; expected warnings for absent optional src/pages directories |
| `node scripts/restore-dump-scope.mjs` | Passed: public,rebatehq_private only; managed schemas excluded |
| `node scripts/test-control-vault.mjs` | Builds with disposable signing keys, starts local lab without synthetic Supabase values, runs Chrome then Edge; both passed 31 named checks after the capacity upgrade follow-up |
| `git diff --check` | Passed |

The local runner executes `node scripts/build-spike.mjs`, `node node_modules/next/dist/bin/next build`, `next start --hostname 127.0.0.1 --port 3100`, and `node scripts/test-vault-browser.mjs --browser=chrome` / `--browser=msedge`. It shuts down its server afterwards. Test-only worker assertions use a different keypair from the app issuer. The harness scans served assets to ensure the real issuer/HMAC secret was not bundled.

Intermediate browser failures were fixed: missing public-key substitution in the worker bundle, and an ambiguous alert selector. Neither was a privacy/isolation finding. Operator and metadata API SQL, all migration SQL, the complete pgTAP SQL, and restore-private cleanup/inventory queries were executed locally in PGlite. Supabase Auth and pgTAP extension functions are stubbed in that harness; actual privileges/platform roles, HTTP Auth and real pgTAP remain CI-only checks. Docker and psql are unavailable locally.

## Browser observations — local only

| Browser | Named checks | 100k CSV import | Observed main-thread long task |
|---|---:|---:|---:|
| Chrome 156.0.8078.80 | 31 passed | 4,097 ms (repeat; initial 2,859 ms) | 0 ms |
| Edge 156.0.4314.58 | 31 passed | 2,866 ms (repeat; initial 2,991 ms) | 0 ms |

Measured on this machine with the synthetic lab. Not a serverless, production, or general hardware guarantee. The authenticated CI gate adds actual sign-in, every retired HTTP handler, authoritative licence enrolment and revoked-device read-only backup recovery. It must not be skipped or run zero tests.

## Verification status and rollback

- **CI verified:** migration warning gate, restricted runtime pool, real Postgres pgTAP/repeatability and the authenticated privacy gate passed in CI #65 (and #63/#64). The privacy boundary statement is in SECURITY_CHECK.md.
- **Restore verified:** the user ran **RebateHQ Restore Drill #16** (local target) on `38911ee`, and it passed; the migration was then locked.
- Hosted-target restore, deployed sign-in/key configuration, real device crash/quota/multi-tab recovery, physical headed checks, offline cold navigation/PWA, production key rotation and wall-clock tampering remain unverified/outside this chunk.
- Offline grace supports an already loaded shell. It cannot learn a new revocation while disconnected, and is not DRM against the device owner. No data is deleted on licence denial.
- Migration rollback: prefer a new forward correction. Keep legacy routes off and preserve encrypted local vaults. Reverting the server to code that does not sign requests would fail closed after this migration. A full rollback requires the pre-migration disposable/operational database backup and matching application/key configuration; do not drop these tables or edit any locked migration as an improvised rollback.
- RETIREMENT_PROPOSAL.md requires a separate user decision. No DROP/purge or 6A work was implemented. **Blueprint unchanged.**

## Changed-file inventory

- `.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/restore-drill.yml`
- `ARCHITECTURE_TRANSITION.md`
- `ASSUMPTIONS.md`
- `BLUEPRINT_EXECUTION_PLAN.md`
- `CHUNK_5B_VERIFICATION.md`
- `MIGRATION_RULES.md`
- `OPERATIONS.md`
- `README.md`
- `RESTORE_RUNBOOK.md`
- `SECURITY_CHECK.md`
- `app/account/licence/page.tsx`
- `app/api/licence/devices/route.ts`
- `app/api/licence/locations/route.ts`
- `app/api/licence/route.ts`
- `app/api/licence/seats/route.ts`
- `components/LicencePanel.tsx`
- `components/local/VaultApp.tsx`
- `config/function-acl-allowlist.sql`
- `lib/audit.ts`
- `lib/authz.ts`
- `lib/db.ts`
- `lib/licence-admin-api.ts`
- `lib/licence-cache.ts`
- `lib/licence-policy.ts`
- `lib/licence-server.ts`
- `lib/licence-verify.ts`
- `lib/request-identity.ts`
- `lib/roles/access.ts`
- `lib/studio/fixlater.ts`
- `lib/studio/studio.ts`
- `lib/vault/client.ts`
- `lib/vault/dispatch.ts`
- `lib/vault/ingest.ts`
- `lib/vault/licence.ts`
- `lib/vault/protocol.ts`
- `lib/vault/service.ts`
- `migrations.lock`
- `scripts/benchmark-import.ts`
- `scripts/build-spike.mjs`
- `scripts/check-schema.mjs`
- `scripts/control-plane-keys.mjs`
- `scripts/inspect-restore-dump.mjs`
- `scripts/issue-licence.ts`
- `scripts/load-db-test-sql.mjs`
- `scripts/purge-deleted-tenants.ts`
- `scripts/restore-dump-scope.mjs`
- `scripts/restore-platform-acl-cleanup.sql`
- `scripts/run-scheduled-ingestion.ts`
- `scripts/seed-restore-drill.ts`
- `scripts/test-control-vault.mjs`
- `scripts/test-db-repeatability.ts`
- `scripts/test-db.ts`
- `scripts/test-vault-browser.mjs`
- `scripts/vault-test-auth.mjs`
- `scripts/verify-restore-equivalence.mjs`
- `supabase/migrations/20261104160022_chunk5b_control_plane.sql`
- `supabase/tests/chunk5b_control.sql`
- `supabase/tests/phase1_rls.sql`
- `tests/browser/vault-worker.ts`
- `tests/chunk2a-pgtap.test.js`
- `tests/chunk2a-runtime.test.ts`
- `tests/chunk3c-restore.test.ts`
- `tests/control-plane.test.ts`
- `tests/helpers/database.ts`
- `tests/helpers/signed-context.ts`
- `tests/http-boundary.test.js`
- `tests/import-capacity.test.ts`
- `tests/import-lifecycle.test.ts`
- `tests/import-review.test.ts`
- `tests/ingestion.test.ts`
- `tests/licence-api.test.ts`
- `tests/licence-operator.test.ts`
- `tests/licence.test.ts`
- `tests/readiness.test.ts`
- `tests/restore-equivalence.test.js`
- `tests/restore-role-filter.test.js`
- `tests/rls-test-structure.test.js`
- `tests/roles.test.ts`
- `tests/vault-auth-setup.test.ts`

Follow-up validation: the “Use licensed capacity” action updates only vault_meta.tier via an audited worker command, so a paid upgrade works on an existing lower-profile vault. Its SQL executed in PGlite, role/protocol tests passed (11 checks), and both browser harnesses passed 31 named checks including the real UI action. A direct app-role caller also fails when the global login budget is exhausted and cannot reset the sequence; that isolated PGlite test passed. The full suite initially passed 199 tests; three subsequently added tests passed targeted runs (expected 202 total in the next full run).
