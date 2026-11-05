# Chunk 4A — local-first spike results

**Chunk 4A — CI-verified in [MarginDesk CI #42](https://github.com/Adityapawar5105/rebatehq/actions/runs/41613748478), 3 November 2026, commit `395154d21efb45fb03397f5545c3ffd6a6f3ded4`.**
Base: `7387f11`. Only chunk 4A was built; 4B has not started.

The passing run exercised frozen-lockfile installation, the seven-migration
lock, typecheck, all **113 tests** (67 JS + 46 TS), and the production build,
including the self-hosted worker/assets prebuild. Its six spike tests cover
exact money, located parsing and safe CSV export, XLSX/formula/macro/XML
security, encrypted snapshot round trip, wrong-key/tamper/KDF rejection, and
the static worker/privacy boundary. The existing real-Postgres suite also ran.
The workflow did **not** run the Chrome/Edge browser harness or benchmark;
all browser measurements below remain **measured locally**, not CI timings.

## Machine and method

- AMD Ryzen 5 5600H with Radeon Graphics, 6 cores / 12 logical CPUs.
- Nominal 8 GB RAM; OS reports **7,887,220,736 bytes usable physical RAM**.
- Windows 11 Home Single Language, x64, build **10.0.26200**.
- Installed Google Chrome **156.0.8078.76** and Microsoft Edge **156.0.4314.58**,
  automated headless with persistent, separate test profiles.
- Production Next.js server on localhost:3100, not the development server.
  DuckDB-Wasm **1.32.0**, embedded DuckDB **1.4.3**, EH, one thread,
  DuckDB memory limit **512 MB**. Wasm and all worker code are self-hosted.
- These are measured on this machine/browser, not promises for other laptops,
  remote hosting, customer files or CI. Ordinary background applications remain.
  A small targeted unit run overlapped part of the Chrome snapshot sequence;
  the figures are observations, not isolated laboratory benchmarks.
- Generator seed/formulas are fixed in `lib/spike/sql.ts`: 200,000 SKUs,
  2,000,000 invoice lines across 24 calendar months, written in 50k-row chunks.
  Stored amounts are BIGINT cents; SQL uses exact integer/decimal arithmetic.
  UI/worker money values are strings, never floating-point reconciled amounts.

Evidence: [Chrome](./spike-evidence/chrome-2026-11-03.json),
[Edge](./spike-evidence/msedge-2026-11-03.json),
[asset hashes](./spike-evidence/assets-2026-11-03.json).
Evidence omits invoice totals/amounts and row contents; all input was synthetic.

Final local checks pass: frozen-lockfile installation, **113 tests** (67 JS +
46 TS, including existing margin golden cases), typecheck, production build,
and the seven-migration lock check. No locked SQL or hash changed. Commands and
failed intermediate experiments are recorded in [SPIKE_COMMANDS.md](./SPIKE_COMMANDS.md).

## Every blueprint section 5 performance target

All durations below are milliseconds. Waterfalls/drills show **median of seven**
worker queries; ranges are retained in the JSON. Query times include DuckDB and
Arrow result conversion in the worker, excluding UI paint/message transit.
Simulation times measure temporary-table creation; aggregation/checks follow it.

| Action / target | Chrome measured | Edge measured | Assessment |
|---|---:|---:|---|
| Parse/load 1M CSV rows: **<10,000**, stretch <5,000 | **1,823.0** native; 8,770.1 Papa | **1,988.5** native; 10,216.4 Papa | Chosen native method passes, including stretch |
| Waterfall over 2M lines: **<300**, stretch <150 | **25.1** (24.8–30.4) | **25.3** (24.7–29.3) | Pass |
| Product drill on 2M: **<300**, stretch <150 | **8.9** | **10.5** | Pass |
| Customer drill on 2M: **<300**, stretch <150 | **8.2** | **7.9** | Pass |
| +4.5% simulation, 100k SKUs / first 12 months: **<2,000**, stretch <1,000 | **87.5** | **77.1** | Pass; filtered scope is 500k actual invoice rows, not 1.2M dense observations |
| App start with existing vault: **<3,000** | **3,385.1 encrypted navigation-to-open** | **3,412.7 encrypted navigation-to-open** | **FAIL** |

The encrypted startup timer is browser `performance.now()` from document
navigation through worker startup and an immediate scripted snapshot unlock.
It excludes human typing but includes the prototype's initial plaintext
synthetic-DB open, decrypt/open, verification, and returning to that DB. This
double engine-open path is conservative and is **not** an implemented memory-only
production vault. Do not substitute the faster plaintext worker-open numbers
below for encrypted startup. Optimising the real vault belongs to 4B.

## Capacity and additional measurements

| Operation | Chrome | Edge |
|---|---:|---:|
| Generate 200k SKUs + 2M lines, commit/checkpoint | 3,470.1 ms | 3,124.0 ms |
| 2M CSV rows → PapaParse → exact Arrow append | 17,879.4 ms | 20,971.6 ms |
| 2M CSV rows → DuckDB `read_csv` | **3,625.5 ms** | **3,857.8 ms** |
| +4.5% simulation across all 2M lines | 327.5 ms | 326.6 ms |
| Plaintext synthetic OPFS worker reopen after whole-browser close | 824.1 ms | 810.8 ms |
| Encrypted snapshot save, full 2M-line DB | 516.7 ms | 500.2 ms |
| Encrypted snapshot decrypt/open/verify, full 2M | 1,431.7 ms | 1,464.6 ms |
| Combine 12 CSVs + one XLSX, 130 rows / 13 sources | 345.1 ms | 322.0 ms |
| Three conversions: XLSX, TSV, BOM semicolon/comma-decimal | 35.6 ms | 36.7 ms |
| Sampled peak browser working-set sum | 1,236,189,184 bytes | 1,191,452,672 bytes |
| Sampled peak browser private committed memory | 977,346,560 bytes | 958,599,168 bytes |

Memory was sampled every 500 ms using the browser process IDs from CDP and
Windows process counters. Working-set sums may double-count shared pages, and
sampling can miss brief peaks; this is not an exact Wasm-heap high-water mark.
Peak DuckDB tracked allocation recorded at the 2M import comparison was
273,602,560 bytes. No memory target was specified in section 5.

The generated CSV is 61,354,113 bytes at 1M rows / 123,819,235 bytes at 2M.
Fixture export takes about 1.18/1.24 seconds at 1M and 2.12/2.13 seconds at 2M
(Chrome/Edge), **excluded from import timing**. Both import paths read the same
already-staged synthetic OPFS file. Native timing includes header validation,
file registration, typed decimal validation and insertion, not a prior copy of
an arbitrary incoming file. Real file/encoding/conversion overhead is unproven.

## Decisions and functional proof

**Chosen import method: DuckDB `read_csv`.** Keep PapaParse/Arrow as the measured
alternative and streaming TSV path. The Wasm API provides Arrow append rather
than the native C Appender object. Explicit non-null Arrow vectors avoid its
generic builder's `new Function` code generation; production CSP does not enable
JavaScript `unsafe-eval`. Both methods must reconcile row count, IDs and exact
money checksums. Their tables are compared serially, dropping the first before
the second to fit the engine limit.

**Chosen encryption: encrypted snapshots.** The native encrypted OPFS write
probe fails with a read-only crypto-module error. The required httpfs extension
is not installed in the pinned offline bundle. No extension is installed or
loaded. An earlier explicit `LOAD httpfs` attempted an external download; the
network test caught it and it was removed. Final runs pass with no external
requests or API calls.

Snapshot envelope: AES-256-GCM, authenticated 1 MiB chunks, independent IV
counters under a random per-snapshot prefix, random 16-byte salt, non-extractable
key derived by PBKDF2-SHA256 at **600,000 iterations**. Header and chunk position
are authenticated. Plain DB size: 34,091,008 bytes; ciphertext: 34,091,673 bytes.
Wrong passphrases, tampering, truncation, reordered data and unsupported KDF
settings are rejected. The full dataset's counts and exact monetary aggregates
match after snapshot open and whole-browser restart.

**Privacy boundary:** generated synthetic data alone uses the plaintext OPFS
working DB. User-selected files go into a separate **memory-only** database;
native scans read browser File handles directly. The snapshot restore to a
plaintext OPFS file is likewise a synthetic feasibility experiment. A production
encrypted vault, crash recovery and auto-lock are not implemented here.
Persisting only encrypted backups would not protect a plaintext working file
after a crash. See blueprint rule 11, its risks table and section 22 entry 9.

Other passing checks:

- Whole browser closes and reopens the same profile: 200k/2M/24-month counts and
  exact waterfall match. A non-isolated response uses one-thread EH and matches.
- +4.5% simulations use a temporary copy and leave the base table unchanged.
- All 13 source files survive combination (10 rows each), with `source_file`.
- XLSX → UTF-8 CSV; TSV and BOM semicolon/comma-decimal inputs produce identical
  exact output. Formula/cached-result cells are ignored with located issues;
  macros/unsafe ZIP paths, XML entities and external workbook links are blocked.
- Cancellation is triggered by actual streaming progress, must report a
  cancellation, and leaves base counts/totals unchanged. Cancellation during a
  native SQL statement waits until that statement finishes before rollback.
- Successful and rejected marker-file imports appear in no request URL/header/
  body or console message. This is a **local spike check**, not the signed-in
  application privacy gate planned for 4B.
- Production Next.js assets load under nonce CSP and `COEP: require-corp`.
  System fonts resolve; there is no external font dependency. Mobile 390px
  layout has no page overflow. Real Supabase magic-link sign-in is **unverified**:
  no credentials locally; no synthetic Supabase env was used in this continuation.

## Failed experiments and limits retained

- COI/threaded OPFS started but stalled on small writes. Threaded scratch-file
  imports also lost rows (90 rather than 130); the exact assertion caught it.
  EH is now used for **all** work, even when cross-origin isolated.
- Static client-page prerender lacked the per-request CSP nonce. The new
  render-only page wrapper forces dynamic nonce rendering; no data/props/server
  business logic is added. Existing server edits are header configuration only.
- The first 2M comparison exceeded 512 MB while retaining both tables. Serial
  comparison fixed it without raising the limit or weakening the checksum.
- `navigator.storage.estimate()` reported approximately **4.14 GB** usage while
  enumerated named OPFS files totalled about **68.18 MB** (DB, snapshot, manifest,
  WAL). The discrepancy is unresolved; neither number is a total disk-footprint
  guarantee. Headless `persisted()` was false. Quota/persistence remain
  browser-controlled; a persistence grant is not a backup.
- Spike input shape is ten fixed columns, two-decimal line totals, 2M rows and
  256 MiB CSV. XLSX/conversion demos are 8 MiB/10k rows/one sheet. This is not the
  full Import Studio, mapper, real ERP validation or production vault.

## 8 GB laptop checklist

Run `pnpm install --frozen-lockfile`, `pnpm build`, then in a separate terminal
`pnpm start --hostname 127.0.0.1 --port 3100`. Open `/lab/spike`. For automated
reproduction use `pnpm benchmark:spike --browser=chrome` and `--browser=msedge`.
Record CPU, RAM, OS, browser version, power mode and other open applications.

**Rerun on 5 November 2026 (chunk 6A, task 4), same laptop.** Ryzen 5 5600H, 7,887,220,736 bytes usable RAM, Windows 11 Home 10.0.26200, power plan "HP Recommended", on mains, ordinary background applications open. Chrome 156.0.8078.80 and Edge 156.0.4314.58, **headless**, driven by `benchmark:spike`, `benchmark:vault` and the browser gate on a production build. A person watching a headed window was not part of this run. Raw results: `test-results/spike-*-full.json` and `test-results/vault-*.json` (git-ignored).

| Checklist item | Chrome | Edge |
|---|---|---|
| UI, assets and system fonts load under nonce CSP and COEP; persistent storage requested | Pass (headless); `persisted()` false; quota 14.9 GB (spike profile) | Pass (headless); same |
| Generate 200k SKUs / 2M lines / 24 months; peak browser memory | 2,530 ms; working set 1.26 GB, private 1.06 GB | 2,614 ms; 1.20 GB / 0.98 GB |
| 1M and 2M CSV imports (native); no business-data request (network and console sensors) | 1,508 / 2,916 ms; no egress | 1,496 / 2,980 ms; no egress |
| Waterfall, product and customer drill on 2M (median of 7); integer-cent identity | 21.3 / 7.0 / 6.2 ms; exact | 22.4 / 7.4 / 9.5 ms; exact |
| +4.5% simulation, target scope (500k lines) and all 2M; base unchanged | 69 / 262 ms; unchanged | 71 / 271 ms; unchanged |
| Close the browser completely, reopen: exact counts and totals | Pass | Pass |
| Combine 12 monthly CSVs + 1 XLSX: 130 rows, 13 sources | Pass, 248 ms | Pass, 283 ms |
| Three conversions to UTF-8 CSV, exact | Pass, 33 ms | Pass, 35 ms |
| Cancel a streaming import: no partial rows | Pass (spike and production vault) | Pass |
| Encrypted 2M snapshot save / open; wrong passphrase rejected; navigation to open | 374 / 1,131 ms; rejected; 2,820 ms | 379 / 1,242 ms; rejected; 2,849 ms |
| **Production vault:** navigation to unlocked, 1M / 2M lines, after a whole-browser restart (target < 3 s) | **2,774 ms pass / 3,280 ms miss** | **2,788 ms pass / 3,324 ms miss** |
| Production vault: 1M-line CSV through Import Studio (convert + check / commit + encrypted save) | 10,639 / 9,309 ms | 11,189 / 9,724 ms |
| Production vault: first change after background warm-up, 1M / 2M (target < 2 s at 1M) | 784 / 1,601 ms | 818 / 1,632 ms |
| Production vault: 2M waterfall / product drill / customer drill / leak finder | 3.2 / 155 / 12.7 ms / 11.9 s | 3.6 / 154 / 13.4 ms / 11.4 s |
| Near quota (simulated per origin), killed tab, second tab, backup restore | Pass: `nearQuota`, `killedTabRecovery`, `integrity`, encrypted backup | Pass |
| Real configured Supabase magic-link sign-in, including callback | **Not run**: no hosted Supabase project exists | **Not run** |

**Found and fixed during the rerun.** The 1M-line Import Studio benchmark ran out of the 512 MB DuckDB budget in both browsers. The cause was the duplicate check, a window over every staged row (with md5 strings) on top of about 300 MiB of staged and typed rows. A 64-bit hash count now finds the keys that repeat, and the exact check runs on those rows only (unit test in `tests/pilot-joins.test.ts`). The 1M import then passed. The last recorded full run (4D) did not hit the limit; which later change pushed the old query over it was not bisected.

**Measured, no blueprint target.** Reading the vault while warm-up runs took 16 ms to 4.4 s at 1M (up to 8.9 s at 2M). The wait depends on whether the read lands behind a long warm-up statement, and the pre-6A build shows the same range. The 2M leak finder takes about 11.5 s; it was 8.3 s in 4D and is the same before and after 6A, so it slowed between 4D and 5B. Both are recorded in `PARKING_LOT.md`.

**Tier caps: no change proposed.** Every target the blueprint sets is met at 1M lines, and 2M startup still misses 3 s. Keep Starter 20k / 200k, Professional 100k / 1M and Scale 200k / **1M** (provisional). The 1M import peaks close to the 512 MB budget, so raising Scale above 1M would need a lower-memory staging path first.
## Recommendation

**Functional feasibility: PASS locally in both browsers. All performance-target
sign-off: FAIL**, because full encrypted startup exceeds three seconds in both.
The native import path passes the 1M target (and its five-second stretch); the
discarded Papa path misses ten seconds in Edge. Do not advertise all targets met.

**Proposed pilot caps, not a blueprint change or measured guarantee:** retain
Starter 20k SKUs / 200k lines and Professional 100k / 1M; provisionally limit Scale
to 200k / **1M lines** until encrypted startup and the manual checklist are
accepted. Both 2M analytical runs fit this machine, so this is a conservative
shipping recommendation, not evidence of an analytical-capacity failure.
Lower caps may not solve the fixed cost of opening two engines; 4B should avoid
that prototype path. Do not sell the 2M promise before pilot validation.

**Unverified:** headed manual checks, real Supabase sign-in, the production
encrypted memory-only vault, crash/quota/multi-tab recovery, the unresolved
storage-estimate discrepancy and real ERP files. The full-size browser harness,
browser privacy checks and performance figures have local evidence only and
remain unverified in CI. CI #42 does not turn the encrypted-startup target miss
into a pass. No 4B code was started. Local command outcomes are recorded in
[SPIKE_COMMANDS.md](./SPIKE_COMMANDS.md).

## Chunk 4B follow-up — local measurements, CI acceptance verified

CI acceptance: [MarginDesk CI #44](https://github.com/Adityapawar5105/rebatehq/actions/runs/41660146540), 3 November 2026, commit `c382f7d`, authenticated local-vault flow only.
Performance measurements below remain local evidence, unverified in CI.

Close-out status: **4B CI-verified (CI #44, c382f7d)**. The requested startup
baseline (2.65/2.68 s at 1M, 3.16/3.18 s at 2M), resumed trials and separately
measured deferred first-change latency are retained in
[VAULT_RESULTS.md](./VAULT_RESULTS.md). At 2M, the first audited change and
encrypted save took 14.781/16.332 seconds in Chrome/Edge, with no observed UI
long task >=50 ms. Carry this >10-second delay to 4C-1; retain the 1M Scale cap.

3 November 2026, same Ryzen 5 5600H / nominal 8 GB Windows laptop. The production
vault now opens one EH instance, attaches its authenticated snapshot from RAM,
and defers FK/index rebuilding until the first mutation in that same instance.
There is no plaintext OPFS working file and no second engine.

| Whole-browser restart: navigation → unlocked/ready | Chrome 156.0.8078.80 | Edge 156.0.4314.58 |
|---|---:|---:|
| Existing 1M-line vault | **2,837 ms — PASS <3s** | **2,660 ms — PASS <3s** |
| Existing 2M-line vault | **3,163 ms — FAIL <3s** | **3,180 ms — FAIL <3s** |

The 100k native CSV import, audit and encrypted save took 1,387 / 1,360 ms
(Chrome/Edge), with no observed main-thread long task >=50 ms. Browser/profile
asset caches are normal; human typing and real Supabase/network identity latency
are excluded. The local harness is not authenticated-app evidence. The first
mutation pays a copy cost that is intentionally deferred from startup.

**Recommendation: retain the provisional Scale cap of 1M lines**, with 200k
products; Professional stays 100k/1M and Starter 20k/200k. The 2M startup target
still misses after whole-browser restart. These are local pilot guardrails,
not changes to the blueprint or shipping guarantees. The complete methodology,
earlier failed eager-copy measurements, local tests, pending authenticated CI
gate and remaining limits are in [CHUNK_4B_VERIFICATION.md](./CHUNK_4B_VERIFICATION.md).

The new ciphertext-only storage path estimates close to named file sizes, but
the historical 4A discrepancy remains **unresolved/unverified**. See
[STORAGE_FINDINGS.md](./STORAGE_FINDINGS.md). Headed manual checks, production
sign-in/deployment and physical crash/quota recovery remain unverified.
