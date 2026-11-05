# Vault results — 4B CI-verified (CI #44, c382f7d)

## Chunk 4E pricing — 4 Nov 2026 (local only)

Ryzen 5 5600H / about 8 GB / Windows 11 / Chrome 156.0.8078.80; reopened vault
after warm-up. 1M lines, 100k SKUs/affected SKU-tier pairs, 12 months, 512 MB
DuckDB limit and spill disabled. SQL simulation: **273 ms**; through saved
preview, audit and encrypted snapshot: **3,448 ms**; 50-row preview: **18 ms**.
SQL meets the 2 s target locally; full user wait exceeds it. No temporary
invoice copy. Synthetic results are not a guarantee for arbitrary SKU/tier
distributions. Scale stays at 1M lines. Implementation acceptance is verified in [MarginDesk CI #55](https://github.com/Adityapawar5105/rebatehq/actions/runs/41814159704), 4 November 2026, commit `7fe3db82951e82d5ba8a049158a7ef0a17a69597`; the authenticated gate ran 25 named checks. These pricing timings remain local measurements. See CHUNK_4E_VERIFICATION.md.

**Chunk 4B — CI-verified in [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`.** The GitHub job API confirms step 18, "Required authenticated local-vault privacy gate", completed successfully (not skipped). Its log records `pnpm test:vault:privacy --browser=chromium`, `auth: true`, `status: passed`: **one authenticated harness with 14 named checks**, not a Playwright test-runner count. The separate unit suite passed **67 JavaScript + 56 TypeScript = 123 tests**.

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

## CI #45 privacy-gate failure and lease fix — 3 Nov 2026

CI #45 (run 41665052784, docs-only commit `ea12b02`) failed in the required
authenticated privacy gate: after the deliberate `Page.crash` killed-tab step,
the new tab's unlock never reached the unlocked state within 45 s
(`scripts/test-vault-browser.mjs:102`). The same code passed in CI #44.

**Not reproduced locally:** 10 of 10 runs passed before the fix (installed
Chrome and Playwright Chromium headless shell, CPU throttle up to 6x). The root
cause is therefore **unproven**. The likely cause is that the vault requested its
cross-tab Web Lock with `ifAvailable`, so it failed at once with "open in another
tab" if the browser had not yet released the crashed tab's lease.

Changes:
- `lib/vault/service.ts`: the lease now waits up to `LEASE_WAIT_MS` (10 s) for the
  lock before reporting `OTHER_TAB`. A genuinely open second tab is still blocked.
- `tests/browser/vault-worker.ts`: the second-writer test uses a 500 ms wait; a new
  test checks that a waiting writer takes over once the lease is released.
- `scripts/test-vault-browser.mjs`: failure diagnostics (screenshot, scrubbed
  alert/status/button text, Web Locks state) and optional `VAULT_TEST_CPU_THROTTLE`.
- `.github/workflows/ci.yml`: uploads the screenshot and result JSON (not the
  synthetic CSV fixtures) as an artifact when the privacy gate fails.

After the fix: 6 of 6 local harness runs passed (Chromium x3 with throttle 0/4/6,
Chrome x2, Edge x1), plus 123 tests, typecheck, build, migration lock and
service-role scan. **MarginDesk CI #46 passed on `f1971c5`** (9m 41s), including
the required authenticated privacy gate. One green run does not prove an
intermittent failure is gone; if the gate fails again, the uploaded diagnostics
should identify the cause. CI #46's legacy server benchmark (commitImport
12,480 ms / undoImport 3,834 ms) is back near CI #39's values, which supports
reading CI #44's 24,410 ms as runner variance. Blueprint unchanged.

## Chunk 4C-1 background warm-up — 3 Nov 2026

The 4B open item (first change after unlock: 7.6 s at 1M lines, about 15 s at 2M) is addressed by starting the copy-on-write in the background right after unlock. Measured with `pnpm benchmark:vault` (`--full`) on the same machine:

| | Chrome 156.0.8078.80 | Edge 156.0.4314.58 |
|---|---:|---:|
| Unlock to ready, 1M / 2M lines | 2,729 / 3,314 ms | 2,779 / 3,317 ms |
| Background warm-up, 1M / 2M | 7,352 / 14,067 ms | 6,889 / 13,425 ms |
| Read while warm-up runs, 1M / 2M | 144 / 124 ms | 98 / 110 ms |
| First change after warm-up, 1M / 2M (committed + encrypted save) | **767** / 1,595 ms | **708** / 1,504 ms |
| Max UI long task during first change | 0 ms | 0 ms |

The target (first change after warm-up under 2 s at 1M lines) is met locally in both browsers. An import started during warm-up waits for it (up to about 7 s at 1M lines) while the UI stays responsive. The 2M startup still misses 3 s, so the Scale cap stays at 1M lines. 4C-1 is CI-verified in [CI #48](https://github.com/Adityapawar5105/rebatehq/actions/runs/41690570143) (`ea4e5b6`); these timings are local. Details: [CHUNK_4C1_VERIFICATION.md](./CHUNK_4C1_VERIFICATION.md).

## Chunk 4D margin views — 4 Nov 2026

Local measurements only (Ryzen 5 5600H, about 8 GB, Windows 11). Run with `node scripts/test-vault-browser.mjs --browser=chrome --full`, and with `--margin-bench` for the margin-only 2M run. The synthetic 2M set is a worst case for pre-aggregation: every line is its own customer x product x month, so `agg_cpm` has 2M rows.

| 2M lines, after warm-up (median of 7) | Chrome 156.0.8078.80 | Target (section 5) |
|---|---:|---:|
| Waterfall, whole vault / one branch | 3.3 / 6.7 ms | < 300 ms |
| Drill by product (100k products) | 156 ms | < 300 ms |
| Drill by customer / branch | 14.5 / 12.6 ms | < 300 ms |
| Drill by category within a branch (reads `agg_cpm`) | 246 ms | < 300 ms |
| Whale curve | 34.5 ms | — |
| Show-the-math with source rows (scans lines) | 410 ms | — |
| Leak finder (all rules) | 8.3 s | — |
| Rebuild pre-aggregates + reconcile after a change | 4.0 s | — |
| Waterfall while the post-unlock warm-up runs | 13.6 ms | — |

Regression check against 4C-1 on the same machine:

| Measurement | Now | Before (4C-1) |
|---|---:|---:|
| Unlock to ready, 1M / 2M | 2,752 / 3,255 ms | 2,729 / 3,314 ms |
| Background warm-up, 1M / 2M | 8,089 / 15,649 ms | 7,352 / 14,067 ms |
| First change after warm-up, 1M / 2M | 726 / 1,518 ms | 767 / 1,595 ms |

The warm-up is longer because the snapshot now carries the pre-aggregates. The 1M CSV through the full studio path took 10.7 s to convert, stage and validate, and 9.2 s to commit and save. The commit-and-save figure now includes the pre-aggregate rebuild. Neither 1M figure meets the 10 s parse-and-load target.

Two engineering findings:
- DuckDB-Wasm scans HUGEINT columns far slower than BIGINT. Eight sums over 200k pre-aggregate rows took 232 ms as HUGEINT and 6 ms as BIGINT, so the aggregates are BIGINT.
- The 512 MB DuckDB memory guardrail held only after three changes: the leak finder keeps its line views unmaterialised, it stores compact hits, and reconciliation drops COUNT(DISTINCT) per invoice.

## Chunk 6A — real-file timings (5 Nov 2026, local only)

Same machine, production build, headless Chrome 156 (Edge within 7% on these files). Full record in [PILOT_FILES.md](./PILOT_FILES.md).

| File | Convert + check | Commit + save | Leak finder | Leak Report PDF |
|---|---:|---:|---:|---:|
| UCI Online Retail CSV, 541,909 rows | 6,628 ms | 6,271 ms | 309 ms | 1,518 ms |
| UCI Online Retail II, 2 CSVs, 1,067,371 rows read, 12-month range | 9,196 ms | 5,980 ms | 290 ms | 1,340 ms |
| AdventureWorks, 3 headerless files, 62,162 rows | 1,189 ms | 834 ms | 531 ms | 347 ms |

**Capacity finding.** The real two-sheet Online Retail II batch (1,067,371 rows of wide text) exhausted the 512 MB DuckDB budget while staging. A batch now stops at the tier's line cap before staging, with the cap message. Scale stays at its provisional 1M lines.

| 6A follow-up file | Convert + check | Commit + save | Leak finder |
|---|---:|---:|---:|
| UCI Online Retail II XLSX, one sheet streamed (525,461 / 541,910 rows) | 11,214 / 10,329 ms | 6,644 / 6,138 ms | 338 / 322 ms |
| Northwind lines + order headers + lists (3,153 rows) | 357 ms | 357 ms | — |

## Chunk 6A — 8 GB benchmark rerun (5 Nov 2026, local only)

`benchmark:vault` (`--full`) in headless Chrome 156.0.8078.80 / Edge 156.0.4314.58 on the same laptop. Full checklist in [SPIKE_RESULTS.md](./SPIKE_RESULTS.md).

| Measurement | Chrome | Edge | Compared with |
|---|---:|---:|---|
| Navigation to unlocked, 1M / 2M lines (target < 3 s) | 2,774 / 3,280 ms | 2,788 / 3,324 ms | 4D: 2,752 / 3,255 ms |
| 1M-line CSV through Import Studio: convert + check / commit + save | 10,639 / 9,309 ms | 11,189 / 9,724 ms | 4D: 10.7 / 9.2 s |
| Background warm-up, 1M / 2M | 7,996 / 15,975 ms | 7,977 / 15,806 ms | 4D: 8,089 / 15,649 ms |
| First change after warm-up, 1M / 2M (target < 2 s at 1M) | 784 / 1,601 ms | 818 / 1,632 ms | 4D: 726 / 1,518 ms |
| 2M leak finder | 11.9 s | 11.4 s | 4D: 8.3 s; pre-6A build: 11.5 s |
| 100k CSV import in the gate | 2,909 ms | 2,958 ms | 6A: 2,894 / 2,974 ms |

The 1M Import Studio benchmark first ran out of memory in both browsers. Its duplicate check now counts 64-bit key hashes before running the exact window on repeating keys only; after that fix it passed with the figures above. Reads during warm-up vary from 16 ms to several seconds depending on when they land (the pre-6A build behaves the same); no target applies.
