# Chunk 8D verification

Blueprint Phase 3, chunk 8D: opt-in anonymous benchmarks (design in BENCHMARKS_DESIGN.md, approved 11 November 2026) and the Safari desktop spike, which blueprint v2.6 gap 5 places here. Built by Claude Code. Blueprint v2.6 governs and is unchanged by this chunk.

**8D is not yet CI-verified, and its migration is pending.** The local checks below are not CI proof. The migration `20261111120000_chunk8d_benchmarks.sql` is recorded under `pendingMigrations` in `migrations.lock`. It is locked only after green CI and a **user-run** Restore Drill.

## What was built

- **Migration** (`supabase/migrations/20261111120000_chunk8d_benchmarks.sql`):
  - `public.bench_consent`: an Owner-only, audited tenant table.
  - Four reviewed private tables in `rebatehq_private` (`bench_submission`, `bench_contribution`, `bench_release`, `bench_release_log`). They have no tenant, zero privileges and no row audit.
  - Functions `bench_owner`, `bench_quarter_end`, `bench_submit`, `bench_withdraw` and `bench_figures` (app role), and `bench_publish` (operator only).
- **API:** `/api/bench` (`lib/bench/store.ts`) is default-off. It handles consent, share, figures and withdraw, and computes the HMAC pseudonym with a server-only key. Its route and the `bench_consent` table are registered in `config/http-boundary.mjs`.
- **Shared payload check:** `lib/bench/payload.ts`, the single definition used by the device, the screen and the server.
- **Local vault v21** (`lib/vault/schema.ts`, 61 tables): `bench_family_map`, `bench_shares` and `bench_figures`. The worker (`lib/bench/local.ts`) computes bands, family minimums, the size band and the exact payload.
- **Reports › Anonymous benchmarks** (`components/local/BenchmarksView.tsx`):
  - **For cost roles:** this quarter's bands, and figures the Owner fetched.
  - **For the Owner:** the family map, the exact payload, the consent text and "Turn on", plus Share, Get figures, Turn off and a two-step "Delete my shared bands".
- **Operator release:** `scripts/bench-release.mjs`.
- **WebKit pre-check:** `scripts/webkit-precheck.mjs`, with results in SAFARI_SPIKE.md.
- **Messages:** 81 keys (`bench.*`) in en, es and fr.

## Tests

**`tests/bench.test.ts` (7 tests)** has hand-worked bands. 240 Wire lines over 24 customers (list $100.00, discount $10.00, rebate $2.00, freight $3.00, cost $60.00) give:
- pocket margin 29, discount 10, rebate 2, freight 3;
- size band S1;
- the largest customer at 4.16%.

It also covers:
- Pipe left out for too few lines, and the 25% concentration rule;
- a property test of the payload check (2,000 random objects; only the exact shape passes);
- bands, size bands and quarters;
- shares, figures and withdrawal in the vault;
- keyed pseudonyms, and an invalid payload never reaching SQL;
- service gates: cost roles read, the Owner writes, Starter and Sales Rep are refused.

**`tests/bench-database.test.ts`** applies every migration in PGlite and runs the real store calls under the restricted role:
- the Owner opts in and shares; a manager or rep cannot;
- stored rows carry no tenant;
- eleven more workspaces share, and the operator release publishes the 2 cells (ordered 5-point edges);
- an outsider is refused figures (give to get);
- withdrawal deletes the rows while the figures stay;
- Starter cannot opt in;
- only consent is audited.

**pgTAP (`supabase/tests/chunk8d_bench.sql`, 17 checks)**, included in the suite, which now plans 169 fresh and 172 restore checks:
- consent RLS (positive, cross-tenant, rep, Starter);
- the exact payload refusals;
- an unknown family as a constraint error, an incomplete quarter, the daily limit;
- rep and Starter refused;
- no app privilege on the private tables;
- give to get;
- release with k = 10 and suppression, frozen release;
- withdrawal;
- consent audit only.

**Updated tests:** the schema lint, the function ACL registry, the 5B tenant-table count (25), the restore inventory test, the boundary registry and the schema pins (v21 / 61).

**Browser gate `benchUi`** runs in a fresh vault under the request and console marker sensors:
- the category names carry the fixture marker;
- 245 lines in the last complete quarter are imported and categories mapped;
- the reviewed payload is exactly the expected bands;
- **no request to `/api/bench` before the Owner's first click**;
- check, turn on and share, with the share body asserted exactly;
- get figures: a lab stand-in server returns one cell, while the real API in CI returns "No figures released yet";
- withdraw;
- requests are exactly state, consent, share, figures and withdraw, and none carries a marker;
- no overflow at 375 px;
- a Sales Rep sees no benchmarks.

The request sensor allows `/api/bench` only inside that Owner-click phase.

## Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node scripts/check-schema.mjs` | passed: 25 live tenant tables, reviewed private tables |
| `node scripts/check-migrations-lock.mjs` | 11 applied, 1 pending (8D), hashes match |
| `node --test tests/*.test.js` | 78 of 78 passed, including the full pgTAP suite in PGlite (169 checks) |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 279 of 279 passed (8 new: 7 in `tests/bench.test.ts`, 1 in `tests/bench-database.test.ts`) |
| `scripts/test-vault-browser.mjs --bench-ui-only --browser=chrome` (lab) | passed |
| `scripts/test-vault-browser.mjs --browser=chrome` on a production build (lab mode) | passed, 65 checks (Chrome 157.0.8103.40), including `benchUi` |
| Same, `--browser=msedge` | passed, 65 checks (Edge 157.0.4341.42) |
| Relay and Firefox gates, pgTAP on real Postgres | not run locally; CI runs them |
| `scripts/webkit-precheck.mjs` (WebKit 27.2, Windows) | recorded, inconclusive; see SAFARI_SPIKE.md |

## CI notes

**[CI #145](https://github.com/Adityapawar5105/rebatehq/actions/runs/43045581322) on `baae101`:**
- **Passed:** typecheck, unit tests, build, applying all migrations (including 8D) to a clean local Supabase, and the full pgTAP suite on real Postgres.
- **Failed twice:** both attempts then timed out in "Install Playwright Chromium". The Azure Ubuntu package mirror stalled on font packages during `playwright install --with-deps`, before any browser test ran.
- **Fix:** both browser steps now use `scripts/ci-install-browser.sh`. It makes one bounded attempt with system packages; if that fails, it stops a stalled apt download (never dpkg mid-install), downloads only the browser from Playwright's CDN, and proves it launches.

## Unverified

- **CI on real Postgres and Supabase:** the pgTAP suite against real Postgres, and `benchUi` against the real API in the authenticated CI gate. These run in CI.
- **Restore Drill:** this has to be run by you; until it passes, the migration stays pending.
- **Production:** releases with real contributors, real key management, and whether k = 10 is reached in practice.
- **Safari desktop:** not run on Safari; the WebKit pre-check could not start the app over local http. Safari stays unclaimed.
- **Language review:** native-language review of the consent text and other new sentences.
