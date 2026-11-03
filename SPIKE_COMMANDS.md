# Chunk 4A local command and outcome register

3 November 2026. Commands below ran from the repository root unless noted.
Repeated diagnostic reads and iterative executions are grouped by invocation;
their failures remain recorded. None is GitHub Actions evidence.

## Inventory and inspection

| Command / invocation | Result |
|---|---|
| `git status --short`; `git diff --stat` | Inventoried the partially completed spike before continuation; no migrations changed. |
| `Get-Content AGENTS.md`, `BLUEPRINT.md`, `BLUEPRINT_EXECUTION_PLAN.md`, `ARCHITECTURE_TRANSITION.md` | Read governing instructions and spike boundaries. |
| `rg` / `rg --files`, `Get-Content`, `Get-ChildItem` over app, worker, tests, config and dependency files | Inspected implementation, API signatures and generated assets. One final documentation-tail read found the previous interrupted patch had not created SPIKE_COMMANDS.md; corrected it. |
| `git diff -- <files>` and `git diff --check` | Reviewed changes and whitespace; final outcomes below. Git warns that Windows CRLF config files normalize to LF under the existing attributes. |
| PowerShell CPU / OS / memory / browser-version queries | Ryzen 5 5600H, 7,887,220,736 usable bytes, Windows build 10.0.26200; installed Chrome/Edge versions recorded in SPIKE_RESULTS.md. |
| Node scripts reading package metadata, hashes, browser JSON and OPFS inventory | Confirmed pinned assets, measurements and the unresolved storage-estimate discrepancy. Only synthetic inputs used. |

## Dependencies, build and browser iterations

| Command / invocation | Result |
|---|---|
| `pnpm add --save-exact @duckdb/duckdb-wasm@1.32.0 apache-arrow@17.0.0 exceljs@4.4.0 papaparse@5.7.0` | Added pinned browser dependencies and lock entries. |
| `pnpm add -D --save-exact esbuild@0.28.2 @types/papaparse@5.5.2 @playwright/test@1.64.1` | Added pinned bundler, types and local harness. |
| `pnpm prepare:spike` (also via prebuild/predev) | Copies pinned Wasm/worker assets and bundles the outer worker locally; no CDN. |
| `pnpm build` during implementation | Initial Arrow-vector type error fixed with an explicit Arrow Table; later production builds passed. Final check below. |
| `pnpm start --hostname 127.0.0.1 --port 3100` | Production localhost server used for measurements, with no synthetic Supabase env. Stopped before final full checks. |
| `pnpm test:spike --browser=chrome` and iterative `node scripts/test-spike-browser.mjs --browser=chrome` runs | Caught static nonce failure, forbidden extension fetch, threaded row loss and an imprecise cancel check; fixed code/test structure and retained exact assertions. |
| `pnpm benchmark:spike --browser=chrome` / `node scripts/test-spike-browser.mjs --full --browser=chrome` | First 2M comparison exceeded the 512 MB engine limit while retaining both tables. Serial checksum comparison fixed it. Accepted final full run passes; evidence committed. |
| `pnpm benchmark:spike --browser=msedge` / `node scripts/test-spike-browser.mjs --full --browser=msedge` | Accepted final full run passes; evidence committed. Browser success is functional, not a claim all performance targets passed. |
| `pnpm exec tsx --test tests/spike.test.ts` | Six targeted tests pass: exact money, located parsing/export, XLSX security, snapshot round trip, tamper/KDF failures and static privacy/assets boundary. |
| Frozen installation using pnpm 10.34.9 | Passed after reconciling the local node_modules layout; a trial packageManager field was removed. No CI pnpm version was changed. |
| `pnpm install --frozen-lockfile` using host pnpm 11.25.0 | Passed, lockfile up to date. Final full-check invocation below. |

The earlier interrupted session's proposed server start with synthetic Supabase
environment values was blocked and was not run again. Real magic-link sign-in
remains unverified. Browser and Node probes ran every added DuckDB SQL path:
schema, generation, both imports/validation, transactions/cancel, waterfall,
drills, simulations, memory, native-encryption failure, export/checkpoint and
snapshot reopen. No Postgres SQL or migrations were added.

## Final checks and commit

| Command | Final local result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS; lockfile up to date, no resolution changes. |
| `pnpm test` | PASS: 67 JavaScript + 46 TypeScript tests (113 total), no skipped/failed tests; includes SO-8102 negative-margin golden case. TS stage 481,715.9 ms. Schema/service-role/frozen-migration gates pass. |
| `pnpm typecheck` | PASS (`tsc --noEmit`). |
| `pnpm build` | PASS; self-hosted asset prebuild succeeds; `/lab/spike` is dynamically rendered for the existing nonce. |
| `pnpm check:migrations-lock` | PASS: seven locked migrations, zero pending. |
| `git diff --exit-code 7387f11 -- migrations.lock supabase/migrations` | PASS, no output: locked files unchanged. |
| `git diff --check` | PASS, no whitespace errors. |

All added DuckDB SQL executed in the full browser runs. The existing PGlite
tests also passed; a Supabase/real-Postgres suite was not run locally. The local
browser harness is not installed into GitHub Actions by this spike.

Final review uses `git status --short`, `git diff --stat`, a Node comparison of
the committed evidence/asset manifest and `git diff --cached --check`, then
`git add` of the files below and
`git commit -m "Build chunk 4A local-first spike and record browser measurements"`.
The final response records commit outcome/hash; no push is requested.

## Changed files

- App/config: `.gitignore`, `next.config.ts`, `proxy.ts`, `package.json`,
  `pnpm-lock.yaml`, `app/lab/spike/page.tsx`, `app/lab/spike/SpikeClient.tsx`,
  `app/lab/spike/spike.module.css`.
- Worker: `lib/spike/crypto.ts`, `converter.ts`, `db.ts`, `exact.ts`,
  `fixtures.ts`, `imports.ts`, `sql.ts`, `worker.ts`.
- Build/tests: `scripts/build-spike.mjs`, `scripts/test-spike-browser.mjs`,
  `tests/spike.test.ts`.
- Records: `README.md`, `ASSUMPTIONS.md`, `BLUEPRINT.md`, `SPIKE_RESULTS.md`,
  `SPIKE_COMMANDS.md` and three JSON files in `spike-evidence/`.

Generated assets and raw test output stay ignored. No migration, migration hash,
API handler, existing auth/business handler or margin-engine file changed.
