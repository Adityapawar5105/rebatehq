# Vault results — 4B CI-verified (CI #44, c382f7d)

**Chunk 4B — CI-verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/margindesk/actions/runs/41660146540), 3 November 2026, commit `c382f7d`.** The GitHub job API confirms step 18, "Required authenticated local-vault privacy gate", completed successfully (not skipped). Its log records `pnpm test:vault:privacy --browser=chromium`, `auth: true`, `status: passed`: **one authenticated harness with 14 named checks**, not a Playwright test-runner count. The separate unit suite passed **67 JavaScript + 56 TypeScript = 123 tests**.

Privacy acceptance covers the **local vault flow only**. Legacy server business-data routes still exist; no app-wide "data never leaves your device" claim is made. **Unverified:** deployed Supabase sign-in, headed manual checks, physical crash/quota/multi-tab recovery, the historical storage-estimate discrepancy, and CI validation of the locally measured **~7.6 s / ~15–16 s first-change latency** (open item for 4C-1). Those timings remain local observations; Scale retains its 1M-line cap. 4C-1 has not started.

3 November 2026. The performance measurements below are local; CI acceptance above does not verify them.
Machine: Ryzen 5 5600H, nominal 8 GB RAM, Windows 11 x64 build 10.0.26200.
Chrome 156.0.8078.80 and Edge 156.0.4314.58 run headless against production
Next.js on localhost. Browser versions for the resumed run are retained in JSON.

## Previously recorded startup baseline

The close-out baseline requested for this record is retained, rather than
being replaced by a later trial:

| Navigation → unlocked/ready, after whole-browser restart | Chrome | Edge |
|---|---:|---:|
| 1M invoice lines | **2.65 s — pass** | **2.68 s — pass** |
| 2M invoice lines | **3.16 s — miss** | **3.18 s — miss** |

Subsequent pre-resume trials measured 2.837/2.660 s at 1M and 3.163/3.180 s at
2M. They are in the original `vault-evidence/*-2026-11-03.json` records and
`SPIKE_RESULTS.md`; trial variation is not a latency guarantee. Normal profile
asset caches remain; human typing and real Supabase/network authentication
latency are excluded. The lab uses the real vault component with a synthetic
identity, so this does not verify signed-in deployment latency.

**Retain the provisional Scale cap of 1M invoice lines** (200k products).
Professional stays 100k/1M; Starter stays 20k/200k. The 2M vault is an existing
synthetic benchmark fixture, not permission to import beyond the current cap.

## Deferred first change after unlock

The resumed harness measures both the production `makeWritable` rebuild and
the complete first audited change through encrypted snapshot publication. It
uses a test-only update to one existing synthetic product description, so it
does not bypass row caps or add a product-edit feature to the application.
Unlock is completed before the timer starts. The full change includes rebuild,
SQL update, audit append, commit and encrypted save; a second unlock then proves
durability outside that timed interval. Invoice/product/customer counts must
stay identical, and the audit count must increase by one with a valid chain.

The UI page observes long tasks during the worker operation. “None >=50 ms”
means no long task was observed, not zero UI CPU time. Any task >200 ms or a
complete change >10 seconds is carried as an **open item for 4C-1**. No engine
redesign is part of this close-out.

| Resumed first change, 3 November 2026 | Chrome | Edge |
|---|---:|---:|
| 1M: deferred table rebuild | 6,879 ms | 6,828 ms |
| 1M: complete audited change + encrypted save | **7,586 ms** | **7,611 ms** |
| 2M: deferred table rebuild | 13,331 ms | 14,733 ms |
| 2M: complete audited change + encrypted save | **14,781 ms — open item** | **16,332 ms — open item** |
| Maximum observed UI long task, either size | none >=50 ms | none >=50 ms |

**Open item for 4C-1:** the first change at 2M exceeds 10 seconds in both
browsers. No UI long task was observed, and row counts, audit
chain and encrypted reopen checks passed. No redesign was made. At the retained
1M cap, this sample stayed below 10 seconds; that is a measurement on this
machine, not a guarantee for another device or a larger mutation.

The resumed startup trials were **2.665/2.668 s at 1M** (pass) and
**3.204/3.209 s at 2M** (miss), Chrome/Edge respectively. The 100k CSV imports
took 1,373/1,386 ms with no observed main-thread long task >=50 ms. These
repeated results support the retained cap without replacing the earlier
2.65/2.68 and 3.16/3.18 s baseline above.

Sanitized evidence: [Chrome](./vault-evidence/chrome-resume-2026-11-03.json),
[Edge](./vault-evidence/msedge-resume-2026-11-03.json),
[asset hashes](./vault-evidence/assets-resume-2026-11-03.json). All new
first-change SQL (update, audit append, transaction and verification queries)
executed against real DuckDB-Wasm in both browsers. No Supabase migration SQL
was written or changed.

## Storage and privacy limits

The ciphertext-only path's estimate was within a few kilobytes of named file
sizes. A separate real sync-handle 8 MiB write/truncate/delete probe accounted
correctly in both browsers. That does not explain the historical 4A ~4.14 GB
estimate against ~68 MB of named files: its cause remains **unresolved and
unverified**. Details: [STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md).

The **authenticated local-vault privacy gate passed in CI #44** as recorded above.
On this workstation there is no local Docker/Auth/mail configuration,
and synthetic Supabase values or sessions are not used. Local Chrome/Edge
vault/privacy checks exercise the default-off synthetic harness, with unique
filename/money markers, complete request headers/body and console arguments.
Headed manual checks, deployed authentication, physical power loss, quota/eviction
recovery and production behavior remain unverified. A killed renderer, retained
generation recovery and blocking a second writer were tested locally; this is
not a complete crash/quota/multi-tab recovery certification.

## Historical local resumption command results (before CI #44)

| Command | Result |
|---|---|
| `git status --short`; `git diff --stat`; `git diff --cached --stat` | 4B work intact: 61 staged files plus four unstaged hardening diffs; cleanup fix and regression test confirmed |
| `pnpm install --frozen-lockfile` | Pass; lockfile unchanged |
| `pnpm typecheck` | Pass before the browser measurements and again after the full suite |
| `pnpm build` | Pass before the browser measurements and again after the full suite; pinned self-hosted assets rebuilt |
| `pnpm test:vault --browser=chrome --full` | Pass locally, including marker privacy checks, first-change durability and no observed UI long tasks; 2M performance misses recorded |
| `pnpm test:vault --browser=msedge --full` | Pass locally, same scope |
| `pnpm test:vault:privacy --browser=chrome` | Exit 1 at explicit preflight: no real local Supabase Auth/mail/app DB configuration; authenticated gate unverified |
| `pnpm test` | Pass: 67 JavaScript + 56 TypeScript tests (123 total), no failures/skips; includes cleanup regression and margin golden cases |
| `pnpm check:migrations-lock` | Pass: seven locked migrations, zero pending, unchanged |
| `git diff --check`; `git diff --cached --check` | Pass |
| `git diff --exit-code 03e22d4 -- migrations.lock supabase/migrations BLUEPRINT.md pnpm-lock.yaml` | Pass: frozen files and blueprint unchanged |
| `node` evidence sanitization/asset hashing script | Pass: resumed JSON excludes cell totals/private markers; asset hashes retained |
| `node` legacy-page comparison script | Pass: seven pages match the baseline; an initial inspection-only invocation had an invalid Node options argument and was corrected |

The resumed production harness ran with
`VAULT_LAB_ENABLED=true pnpm start --hostname 127.0.0.1 --port 3100`
(the flag was set in PowerShell's process environment). It was stopped before
the final suite/build. No synthetic Supabase configuration was set. Read-only
`Get-Content`, `rg`, process/status inspection and `git show` checks were also
used to inspect the preserved work and test progress; they changed no files.

The original command/SQL execution register and complete grouped file list are
in [CHUNK_4B_VERIFICATION.md](./CHUNK_4B_VERIFICATION.md). The governing
**blueprint is unchanged**, as are locked migrations and their hashes.
