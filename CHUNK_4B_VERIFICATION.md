# Chunk 4B — local vault and app shell

**4B done locally; awaiting CI.**

**3 November 2026. Local implementation and execution evidence; CI acceptance
and the authenticated privacy gate remain unverified. No 4C-1 work started.**
Base commit: `03e22d4`. No Supabase migration, locked hash, `migrations.lock`,
function ACL allowlist or Postgres restore inventory changed. The 17 new local
DuckDB tables do not belong in the server's 38-table tenant inventory.

## What changed

- `/home` renders the existing authenticated identity/workspace metadata only.
  The client shell has Home, Data Hub, Margin, Pricing, Reports and Settings.
  Seven old business/mixed-audit pages live under labelled `/legacy/` routes;
  old URLs redirect, and existing sign-in redirects land at `/home`.
- Fixed typed worker commands provide create/unlock/lock, ingest, status,
  verification and storage metadata. The UI cannot submit SQL. Stored money is
  BIGINT cents or DECIMAL; values crossing to the UI are strings.
- One self-hosted DuckDB-Wasm 1.32.0 EH instance runs in a child worker. Its
  sync filesystem adapter is backed entirely by private RAM blocks. The
  `opfs://` spelling inside that adapter does not address real OPFS. The outer
  worker alone persists encrypted snapshots and generation-pointer metadata.
- An authenticated snapshot is attached read-only from RAM at unlock, retaining
  its indexes. On the first mutation, a lazy, transactional copy in explicit FK
  order makes the working tables writable within the **same instance**. This
  first-change copy costs time; it was not hidden in the import/startup figures.
  The resumed benchmark records rebuild plus the first audited/encrypted change
  in `VAULT_RESULTS.md`: 7.586/7.611 seconds at 1M and 14.781/16.332 seconds
  at 2M, Chrome/Edge. No UI long task >=50 ms was observed. The >10-second
  delay at 2M is carried as an open item for 4C-1, without a redesign here.
- Snapshots use AES-256-GCM, authenticated 1 MiB chunks, PBKDF2-SHA256 at 600k,
  a per-vault salt and a random per-generation IV prefix. Scope, sequence and
  framing are authenticated. A new immutable ciphertext file is closed before
  atomically replacing the current pointer. The old pointer and previous
  generations stay recoverable. Normal retention is bounded to three ciphertext
  generations; an interrupted save may leave an orphan until a successful cleanup.
- Import success is shown only after audit, SQL commit, checkpoint, encryption
  and snapshot publication. A failed save leaves the last durable snapshot
  intact and blocks further imports until Retry Save. Pagehide saving is best
  effort; auto-lock releases keys/memory even if the last pending save fails.
- Local v1 is frozen with a committed encrypted synthetic fixture; v2 adds the
  import content-hash column and sales lookup indexes. Unlock rejects unknown
  schema versions/inventories. Migrations run forward, and their writes are audited.
- The local audit chain verifies sequence, previous hash, payload hash and its
  encrypted tip/count. It detects tampering, omission and reorder, not a device
  owner rewriting the entire vault or replaying an older valid snapshot.

The direct RAM-file write-mode probe failed in the pinned build; a related
[upstream report](https://github.com/duckdb/duckdb-wasm/issues/2004) exists.
The reported dummy-table workaround did not fix this probe. Eager table copying
worked but measured 9.28s / 15.88s at 1M/2M in Chrome, so it was replaced with
lazy copy-on-write. No pinned Wasm binary was patched and no assertion weakened.

## Local evidence by requirement

All rows below are **unverified in GitHub Actions for 4B** until a passing run
is cited. “Local pass” is narrower than a deployed-product claim.

| Requirement | Local result / scope |
|---|---|
| Create, unlock, lock; clean wrong passphrase | Pass in Chrome and Edge; passphrase stays in worker memory after submission |
| Immutable snapshots / retained recovery | Unit-injected write and pointer failures preserve the old generation; browser recovers a deliberately corrupted current ciphertext |
| Reload and killed tab | Pass; the completed 100k import survives a renderer crash and re-unlock |
| Forward-only schema + committed v1 snapshot | Pass; v1 row and audit history survive upgrade, save and second unlock; fixture SHA is pinned |
| Hash chain / tampering | Pass, including altered/reordered/truncated entries and modified in-memory history |
| Auto-lock + single writer | Pass with a shortened test timer; second writer blocked; failed pending save still releases the key and engine |
| CSV progress, cancel, cap rollback | Pass; cap and cancel leave 100k rows intact; invalid/duplicate cells identify row and column |
| First mutation after unlock | Pass; exact count becomes 100001, is saved, and survives another reload |
| Memory-only plaintext | Unit RAM filesystem test and browser inspection of every named OPFS file pass; only encrypted payloads/pointers written |
| Local marker privacy checks | Pass for URL, complete headers/body and console; external/API/non-GET requests after vault readiness fail the test |
| Authenticated privacy gate | **Unverified:** no real local Supabase/Docker/psql here. Required CI step added, never skipped or mocked |
| Persistent storage / Chrome and Edge | Permission requested from the window; both headless browsers report not granted; UI displays it |
| Quota estimate investigation | New path is close to named file sizes; controlled sync-handle probe accounts correctly; old 4A discrepancy remains unresolved |
| Main-thread responsiveness | 100k file selection/import measured; no observed long task of 50 ms or more in either final run |
| Mobile / CSP | 390px layout without page overflow; nonce CSP has no JS unsafe-eval; COEP require-corp retained |

## Startup and ingest measurements

**Measured on this machine/browser**, not CI, a production latency guarantee or
a remote sign-in benchmark: Ryzen 5 5600H, nominal 8 GB RAM (7,887,220,736 usable
bytes), Windows 11 x64 build 10.0.26200. Chrome 156.0.8078.80 and Edge
156.0.4314.58, automated headless. Production Next.js on localhost:3100.
No other test suite ran during the accepted final browser measurements.

| Measurement | Chrome | Edge |
|---|---:|---:|
| 100k CSV selection → audited encrypted save, including UI round trip | 1,387 ms | 1,360 ms |
| Maximum observed main-thread long task during that import | none >=50 ms | none >=50 ms |
| Navigation → unlocked/ready, existing 1M vault | **2,837 ms — PASS <3s** | **2,660 ms — PASS <3s** |
| Navigation → unlocked/ready, existing 2M vault | **3,163 ms — FAIL <3s** | **3,180 ms — FAIL <3s** |
| Synthetic 1M generation, audit and encrypted save | 8,735 ms | 8,422 ms |
| Synthetic 2M generation, audit and encrypted save | 16,396 ms | 16,060 ms |

Startup closes the **whole browser**, reopens the same persistent test profile,
navigates to the app component, enters the synthetic passphrase immediately,
and stops after the unlocked line count is rendered. Browser startup before
navigation and human typing are excluded; normal profile/asset caches remain.
The local lab uses the identical vault component but bypasses identity only for
the synthetic harness; real Supabase/network/production-auth latency is
**not measured**. First unlock validates the entire encrypted payload and audit
chain. 2M is a pre-existing synthetic fixture, not a permitted new 2M import.

The console's functional PASS is not a 2M performance pass. The full benchmark
asserts the 1M target; the 2M miss is recorded, with the cap recommendation in
`SPIKE_RESULTS.md`. Startup numbers before the whole-browser restart change
(about 2.6s at 2M) were page reloads and are not substituted for these results.

Evidence: [Chrome](./vault-evidence/chrome-2026-11-03.json),
[Edge](./vault-evidence/msedge-2026-11-03.json),
[worker/asset hashes](./vault-evidence/assets-2026-11-03.json).
Only synthetic counts, timings and checks are retained; invoice totals and
cell contents are removed. [STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md) records
the controlled storage probe and its unresolved limits.
Final strengthened marker-sensor smoke runs also pass in
[Chrome](./vault-evidence/chrome-privacy-2026-11-03.json) and
[Edge](./vault-evidence/msedge-privacy-2026-11-03.json), checking decimal,
integer-cent and formatted-money variants plus serialized console arguments.

The resumed full runs also pass with the final hardening and first-change
instrumentation: [Chrome](./vault-evidence/chrome-resume-2026-11-03.json),
[Edge](./vault-evidence/msedge-resume-2026-11-03.json),
[current asset hashes](./vault-evidence/assets-resume-2026-11-03.json).
Their startup samples are 2.665/2.668 s at 1M and 3.204/3.209 s at 2M.
`VAULT_RESULTS.md` retains the requested earlier 2.65/2.68 and 3.16/3.18 s
baseline alongside these later trials. The provisional Scale cap stays 1M.

## Required authenticated CI gate

The existing verify job now exports **real local-stack** Auth/mail URLs and
its public key, rebuilds Next.js, starts the production server and runs
`pnpm test:vault:privacy --browser=chromium`. Playwright uses real SDK PKCE,
reads the local Mailpit/Inbucket email and follows the existing app callback.
The real Supabase user is checked with `getUser()`. A restricted app-role
transaction creates only a disposable workspace through the existing function.
No service credential, fake token, setSession shortcut, auth bypass endpoint or
production rate-limit exception is used. The SDK sends the test email directly;
the production email-request endpoint/distributed limiter is not exercised.

The privacy gate imports a unique filename/numeric marker, traverses the local
sections, rejects malformed/private cells, cancels an import, reloads and kills
a tab. Complete request headers are inspected with `allHeaders()` and all body
bytes available to Playwright are checked. Unexpected API/external/non-GET
traffic also fails, even if multipart contents are unavailable. Any failure
fails the verify job. Deployment branch-protection settings are not changed.

## Commands and SQL execution

| Command / check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass; no dependency or lockfile resolution change |
| `pnpm exec tsx --test tests/vault-auth-setup.test.ts tests/vault.test.ts` | 10 pass: crypto, interrupted publication, audit, RAM FS, frozen fixture, schema/caps, static boundary, mail parser, real SQL fixture setup and worker termination after connection-close failure |
| `pnpm test:vault --browser=chrome` / `--browser=msedge` | Final stronger marker-sensor smoke runs pass; no >=50 ms import task |
| `pnpm test:vault --browser=chrome --full` | Pass locally; 1M target pass, 2M performance miss recorded |
| `pnpm test:vault --browser=msedge --full` | Pass locally; same scope |
| `pnpm test:vault:privacy --browser=chrome` | **Blocked/unverified:** explicit preflight fails because no real local Auth/mail/app DB configuration exists; no synthetic config used |
| `pnpm typecheck` and iterative `pnpm build` | Pass; production route/CSP configuration compiles |
| `pnpm prepare:spike` | Pass; self-hosts pinned EH and the RAM/outer vault workers |
| `pnpm start --hostname 127.0.0.1 --port 3100` | Production local harness server; VAULT_LAB_ENABLED=true only; stopped before final checks |
| `git diff --check`; locked migration comparison with `03e22d4` | Pass; locked SQL and lock unchanged |
| Final `pnpm test` | Pass: 67 JavaScript + 56 TypeScript tests (123 total), no failures or skips; includes margin golden cases and worker-cleanup regression |
| Final `pnpm typecheck` | Pass |
| Final `pnpm build` | Pass, including pinned self-hosted worker assets |
| Final `pnpm check:migrations-lock` | Pass: seven locked migrations, zero pending; all frozen hashes unchanged |

Every production DuckDB SQL statement ran in the browser harness: local DDL and
v1→v2 migration, inventory checks, fixed-order copy, rollback/retry, all ingest
validation (including located duplicates), inserts/commit/cancel, status/rollup,
audit verification, checkpoint and reopen. The copy rollback path uses a
test-only injected failure and then proves the original snapshot is unchanged.
The CI fixture's exact transaction/role/context/create-workspace SQL also ran
twice in PGlite against all seven locked migrations with local auth stubs.
That is not a real Supabase sign-in. No new Postgres migration SQL was written.
The resumed first-change update, audit transaction and post-save verification
queries also executed in Chrome and Edge's DuckDB-Wasm workers.

Earlier failed experiments remain accounted for: invalid empty registered DB,
buffer/Parquet writer traps, direct-open write-mode errors, eager-copy startup
miss, missing test-worker COEP header, and the unavailable worker persist API.
The first 453 ms import long task came from Playwright injecting a large base64
buffer; native path-based file selection measured no >=50 ms task with the
same 200 ms assertion retained. One case-sensitive UI assertion was corrected
to await the actual Margin field. Temporary public probe bundles were removed.

## Changed files (grouped)

- Local data plane: all 11 files in `lib/vault/` (protocol/client, crypto,
  engine/RAM filesystem, schema, audit, ingest, storage, service and worker).
- Shell: `components/local/VaultApp.tsx`, `vault.module.css`, `app/home/page.tsx`,
  default-off `app/lab/vault/page.tsx`, and seven `app/legacy/` pages with seven
  redirects at their old locations. Identity landing changes are limited to
  `app/page.tsx`, `app/login/page.tsx`, `app/setup/page.tsx` and the auth callback.
  `AppFrame`, `GlobalSearch` and `DataReadiness` retain legacy navigation links.
- Build/CI: `proxy.ts`, `scripts/build-spike.mjs`, `package.json`,
  `.github/workflows/ci.yml`, `.env.example`, `.gitattributes` (binary fixture).
  No dependency or pnpm-lock change.
- Tests: `scripts/test-vault-browser.mjs`, `scripts/vault-test-auth.mjs`,
  `tests/browser/vault-worker.ts`, `tests/vault.test.ts`,
  `tests/vault-auth-setup.test.ts`, encrypted `tests/fixtures/vault/v1.enc`
  and its README; eight sanitized JSON evidence/asset files in `vault-evidence/`.
- Records: this file, `STORAGE_FINDINGS.md`, `ASSUMPTIONS.md`, `README.md`,
  `SECURITY_CHECK.md`, `OPERATIONS.md`, `VAULT_RESULTS.md`, the Progress line in
  `BLUEPRINT_EXECUTION_PLAN.md` and the 4B follow-up in `SPIKE_RESULTS.md`.
  The governing blueprint is unchanged; the cap recommendation stays in spike results.

## Still unverified

GitHub Actions acceptance for 4B; real authenticated Next.js behavior; production
email-form/rate-limit behavior; deployed Supabase app; headed manual use and
persistence grants; physical power loss, eviction and genuine near-quota
recovery; other machines and real ERP files; OS/heap forensic erasure; the
historical 4A quota-estimate cause; authoritative licences and retirement of
legacy APIs. No app-wide privacy or production-readiness claim is made.
