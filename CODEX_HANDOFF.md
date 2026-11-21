# RebateHQ — Codex handoff: prompts for every remaining chunk

Written 6 November 2026, after 7B (CI #89, #90, #91 green); updated 7 November 2026 after 7V (CI #95, #96 green). This file is the starting point for whoever builds
the next chunk. It holds what a new session needs without the earlier chat history.

**Current status (13 November 2026): 8R done ([CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489); [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552); migration locked).** Server: 13 control-plane tables; pgTAP 136/139; 14 locked migrations (the 14 Nov 2026 operator subscriptions migration locked after CI #160 and Restore Drill #22), 0 pending. Local v21 / 61 tables. Every chunk except 9A is done; 9A waits for the user's explicit prompt. See docs/evidence/CHUNK_8R_VERIFICATION.md.

## How to use this file
1. Work **one chunk per session**, in the order below. Paste **Block A (shared context)** first, then that
   chunk's prompt. Never start the next chunk in the same session.
2. When the chunk's CI run is green, run the **close-out prompt** (Block C). If CI fails, use the **CI failure
   prompt** (Block D). After 3 failed fix attempts on one chunk, stop and simplify instead of patching again.
3. A chunk that adds a Supabase migration also needs a **Restore Drill**, which the user triggers (Actions →
   RebateHQ Restore Drill, target local). The migration stays pending in `migrations.lock` until CI **and** the
   drill pass.
4. Update this file when a chunk finishes: mark it done and add any new pitfall to Block B.

| Order | Chunk | Supabase migration? | Status |
|---|---|---|---|
| 1 | 7V-1 UI redesign: design system, shell, Home | No | Done: approved by the user; [CI #95](https://github.com/Adityapawar5105/rebatehq/actions/runs/42264359487) green on `108d427` |
| 2 | 7V-2 UI redesign: every other screen | No | Done: [CI #96](https://github.com/Adityapawar5105/rebatehq/actions/runs/42269867429) green on `9063e73` |
| 3 | 7C Pricing ops (7C-1, 7C-2) | No | Done: [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986), [#102](https://github.com/Adityapawar5105/rebatehq/actions/runs/42397030001), [#104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) |
| 3a | 7C-3a v2.4: multi-currency, Firefox | No | Done: [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026; 256 unit / 46 authenticated vault / 44 Firefox / 11 authenticated relay checks |
| 3b | 7C-3b v2.4: health alerts, competitor alternatives, sync status, cash-leak hero | No | Done: [CI #111](https://github.com/Adityapawar5105/rebatehq/actions/runs/42449524974) on `fa93eab`, 8 November 2026; 260 unit / 48 authenticated vault / 46 Firefox / 12 authenticated relay checks |
| 4 | 7D-1 Customer rebates | No | Done: [CI #114](https://github.com/Adityapawar5105/rebatehq/actions/runs/42470690491) on `585ccf8`, 8 November 2026 |
| 4a | 7V-3 v2.5: grid filter/sort + selection totals (7V-3a), row notes (7V-3b) | No | Done: 7V-3a [CI #118](https://github.com/Adityapawar5105/rebatehq/actions/runs/42480527882) on `027a14d`; 7V-3b [CI #120](https://github.com/Adityapawar5105/rebatehq/actions/runs/42487588209) on `7ef16fc` |
| 4b | 7D-2 Supplier claims, Purchases import, rebate progress, claim generator | No | Done: [CI #123](https://github.com/Adityapawar5105/rebatehq/actions/runs/42606577225) on `2b1481d`, 9 November 2026 |
| 5 | 7E Vendor review and simulator (7E-1, 7E-2) | No | Done: 7E-1 [CI #126](https://github.com/Adityapawar5105/rebatehq/actions/runs/42616397012) on `2cee899`; 7E-2 [CI #128](https://github.com/Adityapawar5105/rebatehq/actions/runs/42640305379) on `b24f6c8` |
| 6 | 7F Reporting and reach (7F-1, 7F-2) | No | Done: 7F-1 [CI #130](https://github.com/Adityapawar5105/rebatehq/actions/runs/42674285171) on `1903986`; 7F-2 [CI #132](https://github.com/Adityapawar5105/rebatehq/actions/runs/42687463097) on `799c2f9` |
| 7 | 8A Deal guidance and cross-sell | No | Done: [CI #135](https://github.com/Adityapawar5105/rebatehq/actions/runs/42786807751) on `666608f` (with the v2.6 pre-8A fixes) |
| 8 | 8B Margin Drain agents, cost index, dead stock | Maybe (public index feed) | Done: 8B-1 [CI #137](https://github.com/Adityapawar5105/rebatehq/actions/runs/42847127386) on `509a0f8`; 8B-2 [CI #138](https://github.com/Adityapawar5105/rebatehq/actions/runs/42853411139) on `e23f5f7` (uploads only, no feed, no migration) |
| 9 | 8C Win/loss, desktop offline mode, audit pack, templates | No | Done: 8C-1 [CI #140](https://github.com/Adityapawar5105/rebatehq/actions/runs/42896532114) on `efe4291`; 8C-2 [CI #142](https://github.com/Adityapawar5105/rebatehq/actions/runs/43028662048) on `16622a9` (Safari spike moved to 8D per v2.6 gap 5) |
| 10 | 8D Opt-in anonymous benchmarks, Safari desktop spike | Yes (consent and aggregates) | Done: [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) on `63ba49c`, [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569); migration locked; Safari: WebKit pre-check only |
| 11 | 8R Legacy table retirement, wave 2 | Yes (drops 12 tables) | Done: [CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489) on `436459c`, [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552); migration locked |
| — | 9A Mobile field-rep PWA | — | **On hold until the user asks** |

---

## Block A — shared context (paste first in every session)

```
You are continuing RebateHQ, a local-first pricing and margin app for wholesale distributors (50-300 staff).
Repo: the folder that holds this file (its local folder name predates the RebateHQ rename), branch main, GitHub
Adityapawar5105/rebatehq (private).

Read before doing anything, in this order:
1. AGENTS.md — project direction and the status of every chunk (which are CI-verified, with run links).
2. BLUEPRINT.md (v2.6 governs; section 22 lists every change) and BLUEPRINT_EXECUTION_PLAN.md (chunk order and preamble).
3. ARCHITECTURE_TRANSITION.md, MIGRATION_RULES.md, ASSUMPTIONS.md, RETIREMENT_PROPOSAL.md (for 8R).
4. CODEX_HANDOFF.md Block B (pitfalls) — every item there caused a real failure before.
5. The latest verification records: docs/evidence/CHUNK_7V_VERIFICATION.md (UI components and layout rules), docs/evidence/CHUNK_7B_VERIFICATION.md,
   docs/evidence/CHUNK_7U_VERIFICATION.md, docs/evidence/CHUNK_7A_VERIFICATION.md.

Where things stand: chunks 4.0 through 7F, 7V and 8A-8D are CI-verified (local vault v21, 61 tables; 25 public tenant tables; 12 locked migrations); Phase 2 is complete except mobile (9A, on hold).

8D (opt-in anonymous benchmarks; BENCHMARKS_DESIGN.md) is in [CI #146](https://github.com/Adityapawar5105/rebatehq/actions/runs/43059749723) on `63ba49c` and [Restore Drill #20](https://github.com/Adityapawar5105/rebatehq/actions/runs/43070833569), 11 November 2026. Its code is in:
- lib/bench/payload.ts, local.ts, store.ts and client.ts;
- app/api/bench;
- components/local/BenchmarksView.tsx;
- migration 20261111120000_chunk8d_benchmarks.sql (locked);
- supabase/tests/chunk8d_bench.sql.

Things to know for the next chunk:
- Browser installs in CI go through scripts/ci-install-browser.sh.
- The browser gate blocks service workers except in its offlineUi check, and allows /api/bench only inside benchUi's Owner-click phase.
- DuckDB-Wasm has no JSON extension: parse vault JSON in JavaScript.
- Safari is unclaimed (SAFARI_SPIKE.md).

8R (wave-2 retirement) is done in [CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489) and [Restore Drill #21](https://github.com/Adityapawar5105/rebatehq/actions/runs/43467938552), 13 November 2026: the server keeps 13 control-plane tables, pgTAP plans 136/139, and the restore sentinel is a licence location. Next: only 9A, on the user's explicit prompt.
Blueprint v2.4 (section 22, items 24-25) added work that 7C-3 covered. Blueprint v2.5 (items 26-27) adds a grid standard and row
notes, built in 7V-3; from then on every new grid must meet that standard. New screens use the
shared components in components/ui (ui.tsx, Icon.tsx, ui.module.css) inside the shell in components/local/VaultApp.tsx. The local vault is DuckDB-Wasm in a Web
Worker with encrypted OPFS snapshots, schema v15 (45 tables; lib/vault/schema.ts). Supabase holds only identity,
licences/seats, public data and a ciphertext-only relay (11 applied migrations, all locked).

Hard rules (from the execution plan preamble; they override convenience):
- Customer prices, costs, invoices, rules, simulations and margins stay in the browser. Never send them to a
  server, API route, log, analytics or error message. The relay carries ciphertext only.
- Never edit an applied migration or its migrations.lock hash. New migrations only, per MIGRATION_RULES.md.
- Keep the margin-engine golden cases passing (tests/fixtures, e.g. SO-8102 negative margin, and the
  playground manifest the leak finder must reproduce exactly).
- Money is integer minor units (cents, BIGINT) or fixed decimals, never JS floats in stored or reconciled values.
  Use lib/margin/decimal.ts, lib/margin/sql.ts (rhaSql) and lib/spike/exact.ts (minorUnits, sqlText).
- Never evaluate workbook formulas or run macros.
- No hard-coded user-facing strings: every string is a message key in lib/i18n/locales (en, es, fr; fr-CA
  overrides). Colours only through app/theme.css tokens. Numbers, dates and money through fmt.* (Intl).
- Decision 16: nothing a Sales Rep can receive may contain cost or margin %. tests/quotes.test.ts classifies
  every rep-reachable worker command; a new one fails the test until it is classified (scanned or reviewed).
- Heavy work runs in the worker; the UI thread only draws. Stream imports.
- Do only the chunk named in this prompt. Record assumptions in ASSUMPTIONS.md. Local checks are not CI
  evidence; timings are "measured on <machine/browser>" or "target".
- If the chunk shows the blueprint is wrong, correct it, add an entry to BLUEPRINT.md section 22, and list the
  change in your final summary.

Toolchain on this Windows machine (no pnpm on PATH; run scripts directly):
- node:  C:\Users\adity\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
- git:   C:\Users\adity\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe (folder may change)
- Typecheck: node node_modules/typescript/bin/tsc --noEmit
- TS tests:  node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test tests/*.test.ts
- JS tests:  node --test tests/*.test.js
- Lock check: node scripts/check-migrations-lock.mjs
- Browser gate (real Chrome, needs a PRODUCTION server):
    1) set VAULT_LAB_ENABLED=true and the three keys from .env.local (ACTOR_SIGNING_SECRET, LICENCE_SIGNING_KEY,
       NEXT_PUBLIC_LICENCE_VERIFY_KEY) in the shell environment
    2) node scripts/build-spike.mjs   (embeds the licence verify key in public/spike/vault-ram-worker.js)
    3) node node_modules/next/dist/bin/next build
    4) node node_modules/next/dist/bin/next start --port 3100   (in the background)
    5) set VAULT_TEST_URL=http://127.0.0.1:3100, then node scripts/test-vault-browser.mjs --browser=chrome
       (also --browser=msedge). The relay gate is node scripts/test-relay-browser.mjs --browser=chrome.
- CI (.github/workflows/ci.yml) runs typecheck, unit tests, build, local Supabase, pgTAP twice, then the
  authenticated privacy gate (pnpm test:vault:privacy --browser=chromium) and the relay gate on real Supabase.
  Recent runs take 11–22 minutes; the job stops at 60, with bounded Chromium/Firefox installs and browser gates.
- To see the app by hand: .env.local (git-ignored) already turns on lab mode; run build-spike with those
  variables, then next dev, and open http://localhost:3000/ (it redirects to /lab/vault). There is no Supabase
  project or Docker on this machine, so sign-in pages cannot run locally.

Commits: small, descriptive messages; write the message to a file and use `git commit -F <file>` (PowerShell
breaks quoted messages). Never commit .env.local, next-env.d.ts changes made by next dev/build, test-results/,
.claude/ or real customer files (test-results/real/ is git-ignored and must stay so).

Finish every chunk with: files changed, every command run with its result, the CI run link once pushed, and
what remains unverified.
```

---

## Block B — pitfalls that already caused failures (read them all)

**Vault schema and DuckDB**
- Adding tables: bump `SCHEMA_VERSION`, append a `V<n>_SQL` to `STEPS`, add the tables to `TABLES` and
  `tablesFor()`, and update `tests/vault.test.ts` (table count, `upgradeSql(n-1)` content,
  `upgradeSql(n) === ""`, `upgradeSql(n+1)` throws, `schemaSql(n)`). Also update every test that builds
  `schemaSql(<old version>)`: `tests/setup-checklist.test.ts`, `tests/roles.test.ts`, `tests/quotes.test.ts`.
  The browser worker test asserts the version too (`tests/browser/vault-worker.ts`, search for `schemaVersion`).
- DuckDB cannot rebuild a table that other tables reference, and cannot drop a CHECK constraint. To add a value
  to a CHECK list, add a side table (see `source_kinds` for the AR aging role in 7B) instead of altering the old
  table.
- `tests/helpers/duckdb-node.ts` shares one DuckDB across connections in a process: drop tables at the start of
  each test. Its connection is synchronous, so wrap it as `{ query: async sql => c.query(sql) }` when the code
  under test calls `.catch` on a query.
- `vault_meta` columns are (id, schema_version, tier, scope, audit_tip, audit_count, ...). Don't insert audit
  rows by hand in tests: `appendAudit` numbers them from `audit_count`.
- Audit entries (`this.write(action, details, work)` in lib/vault/service.ts) carry codes and IDs only, never
  prices, costs, names or free text.

**Worker commands**
- A new command needs all of: its type in `lib/vault/protocol.ts` (Commands and Results), a case in
  `lib/vault/dispatch.ts`, an entry in `ACTION_CAP` (`lib/roles/access.ts`), a service method, and, if it only
  reads, `READ_ONLY_ACTIONS` in `lib/vault/licence.ts`. `tests/roles.test.ts` checks that dispatch and
  `ACTION_CAP` match exactly.
- If a Sales Rep can call it, classify it in `tests/quotes.test.ts` (`SCANNED` runs it and scans the payload;
  `REVIEWED` needs a written reason). Cost or margin go only to callers with the `cost` capability.
- Tier gates: Professional/Scale features check `this.licence.tier` in the service (see `quoteTier()`), and
  Scale-only features (the historical simulator) check for `scale`.

**Text, colours, layout**
- Worker text uses `msg(key, params)`; the UI renders it with `say()`. Plain text for tests and exports comes
  from `plainText()`. UI code uses `t(key)` and `fmt.*`. Add keys to en, es and fr together (the en catalog has a
  `patches` block; es and fr are flat objects). `tests/i18n.test.ts` scans every UI file for string literals and
  checks completeness, placeholders, plurals and unused keys.
- `tests/theme.test.ts` rejects colour literals and also colour words such as red, green or yellow in CSS
  (including attribute selectors). Use tone names (`data-tone="ok|warn|bad"`) for styling hooks.
- The pseudo-locale walk in the browser gate (`scripts/test-vault-browser.mjs`, `sectionLinks`) visits every
  section: add new sections there. Text grows about 35%, so layouts must not clip.

**Browser gate and CI**
- The gate needs a production build (`next start`); `next dev` fails its CSP check.
- `build-spike.mjs` bakes `NEXT_PUBLIC_LICENCE_VERIFY_KEY` into the worker. If the worker was built with
  different keys from the server's, the vault shows "Read-only · Reconnect to verify your licence". Rebuild it
  with the same environment.
- In lab mode with nobody signed in, `/api/licence` issues a one-hour Scale licence bound to the synthetic lab
  scope (lib/licence-server.ts `labAssertion`). The browser tests replace that response with their own.
- Keep `data-testid`s and accessible names that the gates use, or update the gates in the same change.
- CI has time limits (CI #87 hung for 6 hours in apt). Never remove `timeout-minutes` or the bounded
  Playwright install; `tests/vault.test.ts` checks them.
- CI installs dependencies with `pnpm install --frozen-lockfile`. Don't add an npm dependency unless you can
  update `pnpm-lock.yaml` with pnpm 10 in the same change. Prefer no new dependencies. Never load fonts,
  scripts or icons from a CDN: the CSP and the privacy gate forbid external requests.

**Price exports (from 7C-1)**
- Pricing-operation runs (ids starting with `ops-`) export the price-matrix scope they change: the matrix tier
  (blank for a customer contract), `customer_id` and `valid_to`, in the generic layout only, and the change log
  carries the same columns. Never write the guardrail tier into an export for a customer contract.
- If Codex stops mid-task (usage limit), the next session must first run `git status` and `git diff`, finish or
  revert the half-done change, and run the tests before starting anything new.

**UI (from 7V-1)**
- Build screens from `components/ui` (`ui.tsx`, `Icon.tsx`, `ui.module.css`) and the shell in
  `components/local/shell.module.css`. Old element rules in `vault.module.css` use `:where()` (zero specificity) so
  component classes win; don't raise their specificity again.
- Keep the summary strip's `data-testid="line-count"` and the `licence-status` line: the gates read them on every section.
- Header language and theme selects must stay visible at desktop width (the gates use `getByTestId('language').first()`).
- Nav links must stay `<a href="#section">` inside the `nav` element (the gates click `nav a[href="#reports"]`).
- `node scripts/ui-screenshots.mjs --out=test-results/x --url=<lab server>` captures every section for review;
  against `next dev` use `localhost`, not 127.0.0.1 (Next blocks dev resources for other origins).

**Security review findings to keep in mind**
- Any decision that arrives through the relay must be checked locally: the shared subject still matches the
  local object, and the approver holds the right capability through an explicit role row
  (`roles.assignedCaps`). Never use `accessFor` for someone other than the person signed in, because it treats
  everyone as Owner in a vault with no roles.
- Editing an object that was shared for approval must clear its relay link, so an old approval cannot settle
  changed data.
- Lab-only behaviour must check `VAULT_LAB_ENABLED === "true"` and stay bound to the synthetic lab scope.

---

### Pitfalls from 7C-3a

- FX settings and mapping confirmation can arrive in one command: apply both before returning. Do not disable/blur the rate field per keystroke; queue metadata edits before review.
- Monetary UI assertions must check currency as well as the amount; generic ERP exports/receipts carry the workspace code.
- Gecko discards constructor-supplied clipboard data on untrusted ClipboardEvent objects. The harness supplies DataTransfer on a bubbling paste Event and still runs the real parser. It never accesses the OS clipboard.
- Firefox has no CDP. Keep equivalent quota/worker-termination assertions; use Gecko storage-prompt test preferences for headless Allow and require native persisted()=true. Do not skip the gate or call these physical recovery evidence.
- The Firefox CI lab uses its own loopback Node server on port 3001. Never reuse the authenticated port-3000 server without lab mode.

### 7C-3b pitfalls

- Exact rolling dates cannot use whole boundary months: health uses agg_cm for complete months and raw lines for partial months. Order count is distinct file + invoice + customer + date, not line count. Missing IDs require visible fallback disclosure.
- The hero is the finder’s deduplicated total, not the sum of overlapping findings. Scope its service-order input too. Invalidate full-history evidence caches after a windowed run; never write the lifetime ROI ledger during a read-only Home check.
- Health rates are integer basis points. Convert with basisPointsDecimal before fmt.percent, whose input unit is percent. Currency assertions must include CA$ or the currency code, not digits alone.
- CURRENT_DATE needs the disabled ICU extension in this pinned Wasm build. Tests use an explicit UTC DATE literal. Execute new SQL in the pinned engine before pushing.
- Workspace currency is both a card name and a field: select the concrete currency-heading select in browser tests. Pseudo-locale unlock uses structural form selectors. The extra monitoring test profile is isolated and remains under the request/header/body/console sensors.

### 7D-1 pitfalls (8 November 2026)

- Raw sales_lines retain ERP rebates. Financial amounts must use salesInput/effectiveRebuildSql and the rebate_sales view; quantity-only imports/cleanup remain raw. Do not rebuild latest-schema aggregates with raw REBUILD_SQL.
- Terms declare additional versus replace; never infer it from booked amounts. Require acknowledgement in both UI and worker. One overlapping period per customer is deliberate until a separate allocation policy is specified.
- File-owned terms change only through source replacement/removal. Reject the whole program if any band is invalid; Fix Later must recheck the complete cohort, and a dismissed band cannot activate a partial program. Wholly invalid batches retain the existing review-only rule.
- All 12 rejected-row slots are used by the agreement role. A future larger role needs a schema change, not silently truncated metadata. Preserve AR sidecar kinds when expanding source_kinds.
- Preserve the rep-safe rebateProgress projection/classification and signed-tier guard. Never expose the private state/evidence commands to reps. Test currency amount AND symbol/code, and update historical browser section expectations when adding allowed navigation.

### Pitfalls from 7V-3a (grid standard)

- Every new data grid uses components/ui/DataGrid (sort and filter on every column, selection totals). This is a
  "Done when" item for every chunk from 7V-3b on. Forms, raw previews, legends and show-the-math breakdowns are not grids.
- A paged grid must sort and filter in the worker: keep the command's SQL as a base query without ORDER BY or LIMIT,
  add a GridSpec of its output columns and call gridPage (lib/grid/sql.ts); rows the worker holds in memory use
  memoryPage. Never interpolate a column name from the UI; never sort or filter only the loaded page.
- Grid column ids must equal the base query's output column names. Rate columns filter on an exact decimal without
  "%" (bpPercentSql), not on bpText output.
- Show the empty state only when no grid filter is active, or a filter that matches nothing hides its own Clear button.
- Header buttons change a column header's accessible name, so DataGrid sets aria-label to the column name; the
  selection checkbox is the first cell of every row (browser tests must use td:nth-child(2) for the first data column).

## Block C — close-out prompt (after a green CI run)

```
[Block A]
Chunk <ID> is proven in GitHub Actions: RebateHQ CI #<n> green on commit <sha> (<run URL>)<, and Restore Drill
#<m> green if a migration was added>. Do NOT start the next chunk.
1. If a migration was added, promote it from pending to locked in migrations.lock (record its hash only).
2. In README.md, ASSUMPTIONS.md, SECURITY_CHECK.md, AGENTS.md and CHUNK_<ID>_VERIFICATION.md, mark <ID> as
   verified with the run and commit. Keep "unverified" for everything the run did not exercise, and list it.
3. Update CODEX_HANDOFF.md: mark <ID> done and add any new pitfall to Block B.
4. Run typecheck, all unit tests and the migrations-lock check. Commit, push, and report the files changed.
```

## Block D — CI failure prompt

```
[Block A]
CI step "<step name>" fails on commit <sha> (<run URL>) with: <paste the error and about 30 lines of log>.
Read the full step log first (the job page, or the step's log URL). Decide whether the failure is in our code or
in the CI environment (a mirror, download or network fault: then fix the workflow's resilience, not the tests).
Fix only this failure. Don't weaken or remove any check. If this is the 3rd fix attempt for this chunk, stop and
propose a simpler design instead.
```

---

## 1. Prompt 7V-1 — UI redesign, part 1: design system, app shell, Home

```
[Block A]
Chunk 7V-1 (blueprint section 22, item 23; BLUEPRINT_EXECUTION_PLAN.md section 9). UI only: no new features, no
worker or engine changes, no vault schema change, no migration.

Why: the user judged the current UI not good. Look at it first: open /lab/vault in lab mode, create a vault, load
the Playground sample data, and take screenshots of every section in light and dark at 1366x768 and 375x812.
Today the screens are plain stacked cards with one generic font, flat full-width forms, no icons, no charts, long
scrolling pages, weak headings and a heavy "LOCAL TEST HARNESS" banner. Save these "before" screenshots under
docs/ui/before/.

Build:
1. Design tokens in app/theme.css, for all four themes (light, dark, high contrast, system):
   - type scale and line heights, using a system UI font stack (or a self-hosted font file under public/ with
     its licence; never a CDN);
   - spacing scale, radius, elevation (shadow) and motion tokens, honouring prefers-reduced-motion;
   - semantic colour roles for surfaces, borders, text, accent and status (ok, warn, bad, info) and chart series.
   Every theme must pass tests/theme.test.ts (AA contrast; AAA text in high contrast).
2. Shared components in components/ui/, typed and keyboard-accessible, with all strings passed in through t().
   At minimum:
   - Button (primary, secondary, ghost, danger; with loading state), IconButton, Field (label, hint, error,
     including select and textarea);
   - Card, PageHeader (title, description, actions), SectionTabs, StatTile (value, label, change, tone), Badge;
   - DataTable (sticky header, right-aligned numbers, empty state, horizontal scroll inside the card), Dialog,
     Toast or status area, EmptyState, Skeleton;
   - Icon: an in-house SVG set, aria-hidden by default.
3. New app shell (components/local/VaultApp.tsx):
   - compact header with the brand, workspace, search (Ctrl/Cmd+K) and a preferences menu for language and
     theme;
   - left sidebar with icons, active state and a collapsed mode; at 780px and below it becomes a top bar or
     drawer;
   - page header and content width rules, and a slim, dismissible lab notice in place of the large banner;
   - keep the skip link, focus order and every existing aria label.
4. Rebuild the unlock/create screen (a focused, centered card with passphrase strength guidance and capacity
   choice) and Home, on the new components:
   - Home: KPI stat tiles, the ROI tracker, setup checklist progress and "next best action" cards, and the
     relay inbox entry point.
   - Keep every number, rule and permission exactly as it is now. Only the presentation changes.
5. Keep data-testids and accessible names used by scripts/test-vault-browser.mjs and test-relay-browser.mjs, or
   update those gates in the same change.

Tests and checks:
- typecheck, all unit tests (i18n and theme tests included), and the browser gate in Chrome and Edge, including
  the pseudo-locale walk and the 375px checks.
- Add a gate check: no horizontal page overflow on any section at 1366 and 375 wide, in light and dark.
- Save "after" screenshots under docs/ui/after/ for the unlock screen and Home in light and dark, desktop and
  phone width, and put them side by side with "before" in docs/evidence/CHUNK_7V_VERIFICATION.md.

Stop after 7V-1. In the summary, ask the user to review the screenshots and approve the direction before 7V-2.
```

## 2. Prompt 7V-2 — UI redesign, part 2: every other screen

```
[Block A]
Chunk 7V-2. Precondition: the user approved the 7V-1 look (quote their approval in docs/evidence/CHUNK_7V_VERIFICATION.md). UI
only, as in 7V-1.

Move every remaining screen onto the components/ui components and the new shell, keeping behaviour, numbers,
permissions and test ids:
- Data Hub: a stepper (Import, Map, Fix Later, Item cleanup, Cost basis, Health score); the Import Studio
  drop zone and file list as a clear table with role badges and per-file status; the batch report as stat tiles.
- Margin: section tabs (Waterfall, Customers, Products, Leaks, Reconciliation). Add in-house SVG charts:
  - a waterfall bar chart, from list price to pocket margin;
  - a whale curve.
  Each chart has a visible table alternative, keyboard focus and series colours from tokens, and "show the
  math" and glossary popovers stay.
- Pricing: guardrails as an editable table; rule builder in a two-column form; change preview as a DataTable
  with zone badges; Export Studio as its own step.
- Quotes: Price Check as a compact lookup card; the quote editor as a line table with the thermometer, a sticky
  total and warning summary, and the approval inbox and history as DataTables. Reps still never see cost or
  margin.
- Reports, Settings (with a sub-navigation for Team, Pricing owner, Backup, Security, Language and theme,
  Storage and licence) and the account, login, setup and invite pages (app/account, app/login, app/setup, app/invite).
- Remove the old one-off CSS that becomes unused. Colours only through tokens.

Checks: all tests, the browser gate in Chrome and Edge (pseudo-locale walk, 375px, no overflow in any section,
light and dark), and the privacy gate in CI. Add after-screenshots of every section to
docs/evidence/CHUNK_7V_VERIFICATION.md. Report anything the user should review.
```

## 3. Prompt 7C — Pricing ops

```
[Block A]
Chunk 7C (BLUEPRINT_EXECUTION_PLAN.md section 9; blueprint sections 6 Phase 2 and 9). Build every screen on the
7V components. Professional and Scale only, unless the tier table in blueprint section 14 says otherwise (the
inline grid has a "Basic" Starter version).

Size: this chunk is large. Work in two parts, each committed, pushed and green in CI before the next:
7C-1 = items 1-5, 7C-2 = items 6-10. Stop after 7C-1 and report; the user starts 7C-2 in a new session with
Block A and this same prompt, saying "continue with 7C-2".

Scope:
1. "Why did margin change?" bridge: month-over-month price, volume, mix and cost effects, from sales_lines and
   the 4D pocket-margin engine. The effects must add up exactly to the change in pocket margin (integer cents;
   document the method and its tie-breaks in ASSUMPTIONS.md). Drill by product, customer and branch. Margin
   section, "Margin bridge" tab.
2. Price list versioning with rollback: build on price_versions and rule_runs from 4E. A rollback creates a new
   draft changeset that restores the earlier prices through guardrails, preview, Pricing Owner approval and
   export. It never edits live prices directly.
3. Price exceptions report: invoice lines sold below floor or below contract (customer price_matrix) price,
   with totals and drill-down.
4. Price increase planner by segment (tier, category or customer), with a revenue-impact preview and an
   increase-letter template. The letter is generated locally as PDF/text, in the user's language, with no cost.
5. Contract price expiry tracker: price_matrix rows with valid_to in the next 30, 60 or 90 days.
6. Competitor price log: manual entries (product, competitor, price, date, source) shown next to your price in
   the margin view. New local table competitor_prices.
7. Inline-edit price grid with Excel paste. Every edit writes to a draft changeset that passes guardrails,
   preview, approval and audit, never live prices. Validate pasted cells as money (never evaluate formulas).
8. What-if sliders in the rule builder: approximate impact while dragging (worker, debounced), exact result on
   release.
9. Cost-to-serve leaks: small orders and free-delivery orders that lose money after the freight already in the
   waterfall. Add them to the leak finder. The playground manifest must still reproduce, or update it
   deliberately and say why.
10. Price-change landed check: re-import the next ERP price export and diff it against the last exported price
    file; show which changes did not take effect.

Data: bump the vault schema (new tables such as competitor_prices and price_changesets); follow Block B.
Worker: new commands with ACTION_CAP and READ_ONLY_ACTIONS. Classify any rep-reachable one for decision 16 (reps
must not see the bridge, exceptions with cost, or margin).

Tests: unit tests for:
- the bridge (the effects sum exactly, with golden fixtures);
- rollback through approval;
- exceptions;
- the planner impact;
- paste validation;
- landed-check diffs;
- the new leak types.
Extend the browser gate with a 7C UI flow and add the new sections to the pseudo walk. Write
docs/evidence/CHUNK_7C_VERIFICATION.md with a "Done when" table and the unverified list.
```

## 3a. Prompt 7C-3a — v2.4: multi-currency and Firefox

```
[Block A]
Chunk 7C-3a (blueprint v2.4, section 22, items 24-25; BLUEPRINT_EXECUTION_PLAN.md section 9). Build UI on the 7V
components. No Supabase migration is expected.

Scope:
1. Multi-currency.
   - A workspace display currency (ISO 4217, e.g. USD, CAD, AUD, GBP, EUR) chosen in Settings and stored in the
     vault.
   - Each import batch records its source currency and a user-entered FX rate to the workspace currency. Amounts
     are converted exactly (decimal arithmetic, round half away from zero to the cent, the same rule as the
     engine), and the original currency and rate are kept per batch for audit and show-the-math.
   - Never fetch exchange rates from the browser. The rate is typed by the user.
   - Existing vaults: default currency USD, no conversion, identical numbers. Every margin golden case and the
     playground manifest must reproduce unchanged.
   - Changing the workspace currency after data exists must not silently relabel amounts: either block it with a
     clear message, or require re-import. Document the choice in ASSUMPTIONS.md.
   - Every amount in the app uses the workspace currency through fmt.currency: margins, waterfall, leaks, quotes,
     pricing previews, reports and PDFs. Replace the 7U/7B "USD assumed" spots, including the relay share
     currency in quoteShare.
   - ERP price exports stay in the workspace currency, with a currency column only where the generic layout can
     carry it.
2. Official Firefox support (decision 5).
   - The vault browser gate (scripts/test-vault-browser.mjs) passes with --browser=firefox: OPFS, the worker,
     COOP/COEP, encrypted save and reload, and the lab flows. Fix incompatibilities in code, not by skipping checks.
   - Add a CI step that installs Playwright Firefox the same bounded, retried way as Chromium and runs the
     unauthenticated lab gate in Firefox, with its own timeout-minutes. Keep the whole job under its limit; raise
     the job limit only if needed, and say so.
   - Update the browser-support wording in README.md and SECURITY_WHITEPAPER.md. Chrome and Edge remain the
     primary targets.

Data: bump the vault schema (workspace currency setting; per-batch currency and rate) per Block B.
Tests: exact conversion and rounding, golden cases unchanged at USD, a non-USD import round trip, the
currency-change rule, the formatting of every amount type, and the Firefox gate. Write
docs/evidence/CHUNK_7C3_VERIFICATION.md (part a), with a "Done when" table and the unverified list.
```

## 3b. Prompt 7C-3b — v2.4: health alerts, competitor alternatives, sync status, cash-leak hero

```
[Block A]
Chunk 7C-3b (blueprint v2.4, section 22, items 24-25). Precondition: 7C-3a is CI-verified. Build on the 7V
components. No Supabase migration.

Scope:
1. Customer health alerts (Home cards).
   - SQL threshold rules on agg_cm, run in the worker. Two rules:
     - pocket-margin rate dropped more than a configurable threshold (default 5 percentage points) over a rolling
       90-day window against the previous 90 days;
     - order frequency dropped while the average discount deepened.
   - Each card shows the customer, the change and a "show the math" link. The UI says the checks run only while
     the app is open, and shows "last checked".
   - Label them "Customer health alerts", never AI. Cost-derived figures go only to roles with the cost
     capability (decision 16); classify any rep-reachable command.
2. Competitor log alternatives: when a competitor price is logged on a SKU for a customer, show the top 3
   highest-pocket-margin SKUs in the same category for that customer (SQL on the price matrix and margin
   aggregates, no ML). Cost roles only.
3. Relay sync-status indicator (7A UX): a last-synced timestamp and a synced / pending / conflict status in the
   relay panel, derived from the existing relay session state. No relay protocol or server change.
4. "90-day cash leak" hero number on Home: the exact leak dollars over the last 90 days from the existing leak
   finder (4D), as a prominent figure with "show the math". No calculation change. Cost roles only.

Money: every amount above (the hero figure, alert changes, alternative prices) is stored and computed in the
workspace currency from 7C-3a (lib/vault/currency.ts) and shown with its currency code or symbol through the
existing formatters. Never hard-code "$" or USD. Browser assertions check the currency as well as the amount
(7C-3a pitfall).

Tests: alert thresholds and window boundaries on fixtures, alternatives ranking and tie-breaks, sync-status
states, the hero figure equal to the leak finder's 90-day total (also in a non-USD workspace), the decision 16
scan, and the browser gate (Home cards, competitor alternatives, relay status, pseudo walk, 375px) on Chrome and
Edge locally, with Firefox covered by its CI gate. Add part b to docs/evidence/CHUNK_7C3_VERIFICATION.md.
```

## 3c. Prompt 7V-3 — v2.5: grid filter/sort, selection totals, row notes

```
[Block A]
Chunk 7V-3 (blueprint v2.5, section 22, items 26-27; BLUEPRINT_EXECUTION_PLAN.md section 9). Precondition: 7D-1
is CI-verified. 7D-2 has not started and is not part of this chunk. No Supabase migration.

Size: two parts, each committed, pushed and green in CI before the next: 7V-3a = items 1-2 (grid standard),
7V-3b = item 3 (row notes). Stop after 7V-3a and report; the user starts 7V-3b in a new session with Block A and
this same prompt, saying "continue with 7V-3b". Record both parts in docs/evidence/CHUNK_7V3_VERIFICATION.md.

Starting point (checked 8 November 2026): components/ui DataTable is only a styled <table> wrapper, and screens
build their own tables (CleanupView, CostBasisView, ImportStudio, MarginView, PricingView, QuotesView, RolesView,
the rebate screens from 7D-1 and others). Some grids hold every row; others page rows from the worker.

Scope:
1. Column header sort and filter, built once into the shared components/ui table, then applied to every data grid.
   - First write an inventory in docs/evidence/CHUNK_7V3_VERIFICATION.md: every table in the local app (components/local and
     what it renders), each marked "data grid" (a list of records) or "not a grid" (a fixed show-the-math
     breakdown, key/value summary or legend) with the reason. Every data grid must meet the standard; legacy
     /legacy pages and server account pages are out of scope.
   - Sort: click a header for A-Z, Z-A, then off; keyboard operable; aria-sort set. Typed comparisons: money and
     decimals numerically and exactly (never via float or string order), dates chronologically, text with the
     UI locale's collation; ties broken by the row key so the order is stable.
   - Filter: a multi-value dropdown per column (checkbox list of distinct values, a search box, "(Blanks)",
     select all/none), keyboard accessible (Escape closes and returns focus), shows "N of M rows" and a
     "Clear filters" action. Values containing commas, quotes or leading = + - @ are plain text.
   - Paged grids sort and filter in the worker over the whole result, not just the loaded page: a whitelisted
     column map per grid (never interpolate a column name from the UI), quoted values, the existing paging. The
     distinct-value list is computed in the worker and capped (for example 500 values plus search) so a
     1,000,000-row sales grid never loads into the main thread.
   - A grid shows only the columns the role may see today; filter and sort must not add a cost or margin column
     or value for a role without the cost capability (decision 16). Classify any new rep-reachable command.
2. Selection aggregate status bar: selecting one or more rows (checkbox column, shift-click range, select all
   matching the filter) shows SUM, AVG, COUNT, MIN and MAX for each numeric column the user can see.
   - Computed by DuckDB in the worker, exactly: money in integer cents, decimals as exact decimals; document the
     AVG rounding rule in ASSUMPTIONS.md. Never formula evaluation. "Select all matching" aggregates the
     filtered set in the worker without loading it.
   - Shown in the workspace currency (7C-3a) and the UI locale; the status bar is a polite live region.
3. Freeform row notes (7V-3b): notes VARCHAR(1000) on customers and products, with a vault schema bump and a
   forward migration (Block B).
   - The app has no customer list or item master grid yet (checked after 7V-3a): add both to Data Hub as worker
     grids (gridPage over customers and products) that meet the grid standard, then edit notes inline there; at most 1,000 characters (count Unicode code
     points; enforce in the worker as well as the UI); stored as plain text and rendered as text, never HTML.
   - Local only: never in a relay event, never sent to the server, never in ERP exports. Included in the
     encrypted backup and restore round trip.
   - Hidden from Sales Reps: no rep projection or rep search result may contain a note. Add notes to the
     decision 16 payload scan, and to the relay privacy test.
   - Searchable in the command palette for roles that can see them.
   - Preserve notes through every path that rewrites customers or products: re-import, Fix Later commits,
     source-file removal (lib/studio/load.ts deletes rows no longer referenced; its preview must say how many
     notes would be lost), and the 5A item master merge with undo (keep the surviving row's note, append the
     merged rows' notes within the limit or ask the user to edit first; undo restores every note).

Done when: every data grid in the inventory meets the standard (the browser gate checks sort, filter, "N of M",
and the status bar on at least the item master, a paged sales grid, the price grid and a rebate grid);
aggregates equal fixtures computed independently; notes survive re-import, removal of an unrelated file, merge,
undo and backup/restore; the decision 16 and relay scans pass; 375px and pseudo-locale walks pass; Chrome and
Edge gates pass locally and CI's authenticated Chromium and Firefox gates pass. From now on, the grid standard
is a "Done when" item for every new grid: add that sentence to Block B.
```

## 4. Prompt 7D — Rebates

```
[Block A]
Chunk 7D. Professional and Scale. Build screens on the 7V components (a new "Rebates & Contracts" section;
blueprint section 9). Precondition: 7C-3a (multi-currency) is CI-verified; all rebate and claim amounts use the
workspace currency.

Size: this chunk is large. Work in two parts, each committed, pushed and green in CI before the next:
7D-1 = items 1 and 4 (customer rebate engine, agreement loading, waterfall reconciliation; the schema bump with
rebate_programs, rebate_tiers and rebate_accruals); 7D-2 = items 2, 3 and 5 (supplier claim tracker, Purchases
import role, rebate progress, supplier claim generator; a second schema bump with supplier_claims and purchases).
Stop after 7D-1 and report; the user starts 7D-2 in a new session with Block A and this same prompt, saying
"continue with 7D-2". Record both parts in docs/evidence/CHUNK_7D_VERIFICATION.md (part 1, part 2).
7D-1 is done (CI #114) and 7V-3 is done (CI #118, #120; local vault v15). 7D-2's new grids (supplier claims,
purchases, supplier progress) use the shared grid standard (components/ui/DataGrid, worker grids via
lib/grid/sql.ts gridPage), and its schema bump is v16 (upgradeSql(15)). Products now have a notes column: list
columns by name in any new INSERT INTO products or customers, and never include notes in an export.

Money and browsers (from 7C-3): show every amount through the existing formatters with the workspace currency;
never hard-code "$" or USD, and browser assertions check the currency as well as the amount. Run the Chrome and
Edge gates locally (Firefox also if it launches); CI's required Firefox gate must pass as well as the
authenticated Chromium gate.

Scope:
1. Customer rebate engine: programs with thresholds, rates and period; accruals; tier progress; reminders.
   - Port the tier math from the legacy code (rebate-engine.js, lib/rebates.ts, and their tests in
     tests/pricing-rebates.test.js) into the worker, in integer cents, keeping the legacy test cases as golden
     cases.
   - Load the rebate agreement files that Import Studio already tags (load them now, as the blueprint says),
     with the converter's preview and Fix Later rules.
2. Supplier rebate and ship-and-debit claim tracker: supplier, program, type, amount claimed, status, due date.
3. Rebate progress for customers and suppliers ("$12,400 to the next tier"):
   - customers from sales history;
   - suppliers from a new **Purchases (PO receipts)** import role, added to lib/studio (formats, mapper
     synonyms, load and commit SQL, removal with its source file). If a CHECK list blocks a new role, use the
     source_kinds side table as 7B did.
4. Accrual figures in the margin waterfall's rebate step must agree with the engine (reconcile, as 4D does).
5. Supplier claim generator (blueprint v2.4): a claim-ready CSV/XLSX export from the supplier tracker (supplier,
   program, period, qualifying purchases, rate, amount, currency, references), built locally, formula-safe cells,
   recorded in the audit log with codes and IDs only.

Data: new local tables (rebate_programs, rebate_tiers, rebate_accruals, supplier_claims, purchases); bump the
schema per Block B. Reps: only rebate progress that reveals no cost or margin, and classify their commands for
decision 16.

Tests:
- golden tier-math cases ported from the legacy tests;
- accrual reconciliation with the waterfall;
- Purchases import (mapping, validation, removal);
- claim status rules;
- the claim export (exact amounts, currency, formula-injection-safe cells);
- the browser gate flow and the pseudo walk.
Write docs/evidence/CHUNK_7D_VERIFICATION.md. Note for 8R: after 7D the legacy rebate tables are retired in wave 2; don't drop
them here.
```

## 5. Prompt 7E — Vendor review and simulator

```
[Block A]
Chunk 7E. Build screens on the 7V components ("Vendors" and "Simulator" sections; blueprint section 9).
Precondition: 7D-2 is CI-verified (CI #123; local vault v16, 47 tables). 7E-1 is done (CI #126): lib/vendor/review.ts,
components/local/VendorsView.tsx (Vendors section, tabs #vendors and #vendors-ppv); add the simulator as a third tab there.

Size: two parts, each committed, pushed and green in CI before the next: 7E-1 = items 1 and 2 (vendor price
review, purchase price variance), 7E-2 = item 3 (historical scenario simulator). Stop after 7E-1 and report; the
user starts 7E-2 in a new session with Block A and this same prompt, saying "continue with 7E-2". Record both
parts in docs/evidence/CHUNK_7E_VERIFICATION.md (part 1, part 2).

Standards from 7C-3, 7V-3 and 7D (Block B has the pitfalls):
- Every list of records is a components/ui/DataGrid that meets the grid standard; paged lists are worker grids
  (lib/grid/sql.ts gridPage with a GridSpec of output columns, or memoryPage for rows the worker holds).
- Money in integer cents through the existing formatters in the workspace currency; browser assertions check the
  currency as well as the amount. Any export is formula-safe (lib/csv csvSafeCell/csvRow) and never reads the
  notes column of customers or products.
- A schema bump goes to v17 (upgradeSql(16)); update every test that pins the version: tests/vault.test.ts
  (upgradeSql(16) contents, upgradeSql(17) empty, schemaSql equality), tests/browser/vault-worker.ts (three
  schemaVersion assertions) and any upgrade test that re-runs later steps. List columns by name in any new
  INSERT INTO products or customers.
- Run the Chrome and Edge gates locally on a production build; CI's authenticated Chromium and Firefox gates must
  pass. Filter panels and dialogs must stay usable on grids low on the page.

Scope:
1. Vendor price review: a new supplier cost sheet against current costs (vendor_costs and products). Show the
   per-SKU change, the affected margin, the affected open quotes (7B quotes and quote_lines) and the rules that
   would trigger. Reuse the ideas of the old 3B import preview and conflict handling (git history, chunk 3B),
   but run everything locally in the worker.
2. Purchase price variance: the same SKU bought at different prices or from different vendors (uses the 7D
   Purchases data, plus vendor_costs).
3. Historical scenario simulator, **Scale tier only**: replay a past period with changed prices or costs
   through the pocket-margin engine and compare against what happened. It runs in the worker with progress and
   cancel, and respects the memory and capacity guardrails.

Gate the simulator on the Scale licence in the worker, not only in the UI. Reps: none of these screens. Tests:
- the variance computations;
- the review's affected-quote detection;
- the simulator's exact totals against the engine on the playground data;
- the tier gate;
- the browser gate flow.
Write docs/evidence/CHUNK_7E_VERIFICATION.md.
```

## 6. Prompt 7F — Reporting and reach

```
[Block A]
Chunk 7F. The mobile PWA is not part of 7F (it is 9A, on hold).
Precondition: 7E is CI-verified (7E-2 in CI #128 on b24f6c8; local vault v16, 47 tables).
7F-1 is done (CI #130 on 1903986; local vault v17, 50 tables): lib/reports (pack, pdf, roi, scorecard) and
components/local/ReportsView.tsx. For 7F-2, a further schema bump goes to v18 (upgradeSql(17)) with the same version-pin updates.

Size: two parts, each committed, pushed and green in CI before the next: 7F-1 = items 1-4 (Review Pack, weekly
digest, ROI v2, rep compliance scorecard), 7F-2 = items 5-6 (folder re-import, Phase 2 converters). Stop after
7F-1 and report; the user starts 7F-2 in a new session with Block A and this same prompt, saying "continue with
7F-2". Record both parts in docs/evidence/CHUNK_7F_VERIFICATION.md (part 1, part 2).

Standards from 7C-3, 7V-3, 7D and 7E (Block B has the pitfalls):
- Every list of records is a components/ui/DataGrid that meets the grid standard; paged lists are worker grids
  (lib/grid/sql.ts gridPage with a GridSpec of output columns, or memoryPage for rows the worker holds).
- Money in integer cents through the existing formatters in the workspace currency; browser assertions check the
  currency as well as the amount. Every export and PDF is built in the worker, formula-safe for CSV/XLSX
  (lib/csv csvSafeCell/csvRow), and never reads the notes column of customers or products.
- Long work reports progress and can be cancelled through the shared worker progress bar (see simRun in
  lib/vault/service.ts and the stage label in components/local/VaultApp.tsx).
- A schema bump goes to v17 (upgradeSql(16)); update every test that pins the version: tests/vault.test.ts
  (upgradeSql(16) contents, upgradeSql(17) empty, schemaSql equality), tests/browser/vault-worker.ts (three
  schemaVersion assertions) and any upgrade test that re-runs later steps. List columns by name in any new
  INSERT INTO products or customers.
- A new dependency (pdf.js in 7F-2) is pinned, bundled locally, covered by the engine asset integrity pins where
  it loads as a worker or wasm asset, and passes the high/critical dependency audit gate.
- Run the Chrome and Edge gates locally on a production build; CI's authenticated Chromium and Firefox gates must
  pass. Filter panels and dialogs must stay usable on grids low on the page.


Scope:
1. Monthly Pricing Review Pack for the Pricing Owner: an agenda and report (PDF), built in the worker in the
   user's language with the existing PDF writer. It covers leaks, bridge, exceptions, expiring contracts,
   rebates and ROI.
2. Weekly digest PDF. State in the UI and the digest that checks only run while the app is open, and show "last
   checked" (blueprint risk table).
3. ROI v2: leaks found against dollars recovered, from rule_runs and roi_ledger.
4. Rep compliance scorecard: floor and target compliance and "margin protected" points, never margin % or cost.
   Team view by default, the individual view only by opt-in, and no leaderboard. Classify the commands for
   decision 16 and extend its test.
5. Folder re-import: re-run saved converter recipes against a remembered folder (File System Access in Chrome
   and Edge, permission asked again each session).
6. Phase 2 converters in Import Studio, all with a preview and manual correction:
   - fixed-width reports, with a column-boundary detector and manual adjustment;
   - Parquet, through DuckDB;
   - text-based PDF tables, through pdf.js running locally (bundled, not from a CDN).
   Never OCR. Never evaluate formulas.

Tests:
- PDF content in the user's language (en, es, fr);
- the ROI v2 numbers;
- the scorecard payload scan (no cost or margin);
- each converter on fixtures, including malformed ones;
- the folder re-import permission flow (as far as automation allows; say what is unverified).
Write docs/evidence/CHUNK_7F_VERIFICATION.md. This completes blueprint Phase 2 except mobile.
v2.4: the weekly digest includes the customer health alerts built in 7C-3b (same "runs while the app is open" note).
```

## 7. Prompt 8A — Explainable deal guidance and cross-sell

```
[Block A]
Chunk 8A (blueprint Phase 3).
Precondition: 7F is CI-verified (7F-2 in CI #132 on 799c2f9; local vault v17, 50 tables). Carry the standards of the 7E and
7F prompts: every list a components/ui/DataGrid on the grid standard (worker grids for paged lists), money in integer
cents in the workspace currency, formula-safe exports without notes, long work with progress and cancel, a schema bump
to v18 with the version-pin test updates, local Chrome and Edge gates on a production build, CI Chromium and Firefox.

Pre-8A fixes first (blueprint v2.6, section 22 item 28):
- Gap 2: a first-login onboarding card for Professional and Scale workspaces that explains the ciphertext-only relay
  in one sentence and leads to Settings to turn sharing on and register this device's key. The relay is enabled by
  the server (RELAY_ENABLED); show the card only where the relay is available and this device has no key yet, and let
  the user dismiss it (remembered per workspace in this browser). No schema change.
- Gap 4: 7F-2 already refuses a PDF with no text at all (message pdf.noText). Still to do: name the alternatives in
  that message (the fixed-width converter for a print-layout report, or a CSV export from the ERP), and when only some
  pages have no text, keep the readable pages and show a notice listing the skipped page numbers (no silent drop).

1. Explainable deal guidance in Quote Desk: a suggested price per line with the "why" (guardrails, the
   customer's history, similar customers, recent cost moves), as message-key text. Reps see the suggested price
   and the reasons, never cost or margin.
2. Cross-sell suggestions ("customers like X also buy Y"): simple basket analysis (co-occurrence and lift) over
   sales_lines in the worker, with minimum-support thresholds documented in ASSUMPTIONS.md.

Deterministic: no external model and no network. Tests: the guidance reasons, the basket metrics on fixtures, the
decision 16 scan for every rep-visible output, and the browser flow. Write docs/evidence/CHUNK_8A_VERIFICATION.md.
```

## 8. Prompt 8B — Margin Drain agents, cost index triggers, dead stock

```
[Block A]
Chunk 8B.
Precondition: 8A is CI-verified (CI #135 on 666608f; local vault v17, 50 tables). Blueprint v2.6 governs: 8B is the fix for gap 1
(section 22 item 28), so every alert surface keeps the "checks only run while the app is open" note until the agents
below provide a persistent check schedule. Carry the 7E/7F/8A standards (grid standard, integer cents in the workspace
currency, formula-safe exports without notes, progress and cancel, a schema bump to v18 with the version-pin test
updates, decision 16 classification and scan for any rep-reachable command, local Chrome and Edge gates, CI Chromium and
Firefox; no automatic network request from a vault screen, as the 8A relay card needed).

1. Margin Drain agents: local background checks that run while the app is open (worker, idle-scheduled):
   - leaks crossing a threshold;
   - prices below floor;
   - expiring contracts;
   - cost rises.
   Show a "last checked" time and an inbox. Never imply a server-side service.
2. Cost index triggers:
   - User-uploaded index files first.
   - Optionally, a public index feed from the control plane. Public data only, through a new
     Supabase table and route, which means a migration, pgTAP tests and a Restore Drill. If you add it, follow
     MIGRATION_RULES.md and keep the migration pending until CI and the drill pass.
   - Include the import-cost currency buffer rule. Rates are entered by the user or come from that feed, never
     fetched by the browser from a third party.
3. Dead-stock clearance optimiser: items idle 90+ days, with suggested clearance prices floored at replacement
   cost; the suggestions go through the normal changeset, approval and export.

Tests:
- the agent rules on fixtures;
- the trigger rule math (exact cents);
- the dead-stock floor;
- if a migration is added: pgTAP, the RLS tests and the privacy gate (the feed holds no customer data).
Write docs/evidence/CHUNK_8B_VERIFICATION.md. This is a precondition for 8R (the legacy alert table).
v2.4 additions: the dead-stock optimiser takes user-entered carrying costs (cost of capital %, storage cost per
unit per month), shows the capital tied up per SKU in cash terms, and suggests substitute SKUs. Margin Drain agents
build on the 7C-3b customer health alerts rather than duplicating them.
```

## 9. Prompt 8C — Win/loss, desktop offline mode, audit pack, templates

```
[Block A]
Chunk 8C. Desktop only: no phone or mobile work (that is 9A, on hold).
Precondition: 8B is CI-verified (8B-1 CI #137 on 509a0f8, 8B-2 CI #138 on e23f5f7; local vault v19, 57 tables). Carry the
7E-8B standards (grid standard, integer cents in the workspace currency, formula-safe exports without notes, progress
and cancel, decision 16 classification and scan for any rep-reachable command, a schema bump to v20 with the
version-pin test updates if tables change, local Chrome and Edge gates, CI Chromium and Firefox, no automatic network
request from a vault screen). The offline service worker must keep the Margin Drain "checks only run while the app is
open" behaviour honest: no background sync or periodic sync is added.

1. Win/loss log on quotes: reason codes and notes, and reports by reason, customer and rep (reps see their own,
   without cost).
2. Offline mode for the desktop app as an installable PWA (service worker, cached app shell, works offline with
   the local vault, licence offline grace per lib/licence-policy.ts). Keep the CSP and the engine asset integrity
   pins. The service worker must never cache business data or API responses that carry it.
3. Audit and compliance pack: export of the hash-chained audit log with verification results, approvals,
   exports and role changes (codes and IDs, language-neutral), plus a cover summary in the user's language.
4. Templates: vendor negotiation sheet and rebate agreement, generated locally (increase letters already exist
   from 7C).

Tests:
- offline reload in Chrome and Edge (the browser gate with the network off);
- a service-worker cache scan proving no business data is cached;
- audit pack verification;
- the template content.
Write docs/evidence/CHUNK_8C_VERIFICATION.md.
v2.4 addition: a Safari desktop verification spike (OPFS persistence, DuckDB-Wasm threading, COOP/COEP). Record
the results; do not claim or advertise Safari desktop support unless the spike passes.
```

## 10. Prompt 8D — Opt-in anonymous benchmarks

```
[Block A]
Chunk 8D. Only with an explicit consent design (blueprint section 6, Phase 3 and "Deferred").
Precondition: 8C is CI-verified (8C-1 CI #140 on efe4291, 8C-2 CI #142 on 16622a9; local vault v20, 58 tables). Carry the
7E-8C standards (grid standard, integer cents, formula-safe exports without notes, decision 16 classification and scan
for any rep-reachable command, local Chrome and Edge gates, CI Chromium and Firefox, no automatic network request from a
vault screen, the offline service worker never caching business data or /api/ responses).
Blueprint v2.6 (section 22 item 28, gap 5) also places the Safari desktop verification spike in 8D: OPFS persistence,
DuckDB-Wasm threading and COOP/COEP in Safari desktop. Record the results; do not claim or advertise Safari desktop
support unless the spike passes on real Safari.

Before writing code, write BENCHMARKS_DESIGN.md and stop for the user's approval. It covers:
- what aggregate is computed locally;
- the minimum group size (k-anonymity);
- the rounding and noise;
- how consent is given, shown and withdrawn;
- what the server stores;
- the threat model.

After approval:
- The browser computes coarse aggregates, such as margin % bands by category. Raw values never leave the
  device. The browser sends the aggregates only after the Owner opts in.
- The server stores aggregates with no tenant-identifying detail beyond what the design allows. This needs a
  new migration, RLS, pgTAP and a Restore Drill.
- The privacy gate is extended to prove that nothing is sent without consent and that only the approved
  aggregate shape is ever sent.

Write docs/evidence/CHUNK_8D_VERIFICATION.md.
```

## 11. Prompt 8R — Legacy table retirement, wave 2

```
[Block A]
Chunk 8R. Preconditions: 7A, 7B, 7D and 8B are CI-verified (all are; 8D is too: CI #146, Restore Drill #20, 12 locked
migrations, 25 public tenant tables). Follow RETIREMENT_PROPOSAL.md "Wave 2" and repeat
exactly how 6R worked (read docs/evidence/CHUNK_6R_VERIFICATION.md and migration 20261105120000_chunk6r_retire_wave1.sql).

The tables: quote, quote_line, quote_share_link, approval, approval_rule, rebate_agreement, rebate_progress,
rebate_tier, rebate_entry, supplier_credit, alert, and fx_rate (only once a local FX table exists or it is
confirmed unnecessary; record which).

Steps:
1. Precondition check: no code path reads or writes these tables (search app/, lib/, scripts/ and tests). Retire
   the legacy routes and pages that still use them (fixed 410 responses, as in wave 1).
2. One new migration that drops them (plus dependent policies, functions and grants), following
   MIGRATION_RULES.md. Don't touch any applied migration. Update schema.sql or the schema check as 6R did.
3. Update pgTAP and the inventory counts, run CI, then ask the user to run the Restore Drill (target local).
   Since 8D, the tenant minimum is 25 (bench_consent counts), pgTAP plans 169/172 and the 5B check counts exactly 25
   tables; adjust all three for the dropped tables. Keep bench_consent and the reviewed rebatehq_private benchmark
   tables untouched.
4. Keep the migration pending until CI and the drill both pass, then lock it in the close-out.

Write docs/evidence/CHUNK_8R_VERIFICATION.md. After 8R, every chunk except 9A is done. 9A waits for the user's explicit prompt.
```


## Chunk 7C-1 implementation handoff (7 November 2026; CI-verified)

Items 1–5 are CI-verified in [CI #100](https://github.com/Adityapawar5105/rebatehq/actions/runs/42284900986) on `aecfa32`;
see docs/evidence/CHUNK_7C_VERIFICATION.md. The local vault is
v11 (37 tables), including price_changesets and price_changeset_rows. Part 2 is
not started. No Supabase migration or migrations.lock change.

Additional Block B pitfalls found:
- Keep "use client" first when adding imports to a client component; tsc alone does
  not reject a misplaced directive, but the production Next build does.
- Shared DataTable labels must name the table as well as its scroll region.
- Use distinct subtab hashes (pricing-planner, margin-bridge, etc.); shell #pricing
  and #margin links must stay unique. Normalize subtab hashes in VaultApp.
- Planner/reversal metadata must preserve matrix_tier independently of the guardrail
  tier, or a NULL-tier customer contract can override its existing quantity breaks.
- The local test runner binds 127.0.0.1:3100; use that exact address. On this machine
  localhost reached a separate stale listener and returned missing build assets.
- On an 8 GB machine, do not run the JS suite, TS suite and production build together.
  Their embedded databases can exhaust memory. --test-concurrency=1 changes scheduling,
  not assertions; CI retains its existing commands.

- Bulk price lookups must use resolvedBook() equality joins and staged/grouped inputs.
  A scalar LATERAL lookup over the complete price book exhausted 512 MiB even
  for a small segment. Keep the 100k-line/20k-price regression and the memory
  limit; do not enable plaintext spill or raise the limit to mask a bad join.

## Chunk 7C-2 implementation handoff (8 November 2026)

CI-verified in [CI #104](https://github.com/Adityapawar5105/rebatehq/actions/runs/42406059786) on `05ff468`; docs/evidence/CHUNK_7C2_VERIFICATION.md records 249 unit tests, 43
authenticated vault checks and 11 real-authenticated local-Supabase relay checks. New worker commands are all denied to Sales Reps. Local v12 adds
five tables (42 total), no Supabase change. See ASSUMPTIONS.md for Basic/full
grid limits, saved-rule slider semantics, cost-to-serve grouping and explicit
free-delivery evidence, and strict landed file scope. Preserve every matrix key
(including an optional category stored on a product row) through grid approval
and reversal. Do not replay price exports as live updates: receipts are immutable
and landed checks are read-only comparisons. Never use the old rule_changes-only
preview/export path for grid- runs. No 7D or later work has begun.

The Node DuckDB build can have functions unavailable in the self-hosted browser
bundle: production disables auto-loading/installing extensions. Do not use
SQL to_json for invoice keys; the browser test caught this difference. The local
control-vault runner now supports VAULT_TEST_PORT and checks that the port is
free rather than reusing an unrelated server. It still supplies no Supabase
configuration. Use 3106 here if the user's older preview holds 3100.

### 7D-2 carry-forward pitfalls (9 November 2026)

- Purchases need a file-unique line ID plus supplier/receipt reference for cross-file duplicate detection. Repeated IDs become Fix Later issues; never generate or rewrite IDs silently.
- Physical source_files.role uses customer_list for CHECK compatibility; source_kinds must store purchases, and reads coalesce the kind. Source cleanup and note-removal previews must account for purchase references. SKU merges touching receipt evidence are blocked.
- Supplier progress is live; prepared/submitted claimed amounts and evidence hashes are frozen. Re-export rejects changed evidence; redraft only where the status allows. Ship-and-debit is manual authorized assessment, not inferred entitlement.
- Prepare exports asynchronously, then offer an explicit retained download link. Do not rely on a post-await automatic download or a one-second Blob URL timer. Clear links on edits/status changes; keep the delayed-download and inner-context diagnostics tests.
- New supplier commands are cost / rebateManage gated; no new rep-reachable projection. Future grids still follow 7V-3, and imports must keep notes via named columns. All 11 Supabase migrations and migrations.lock remain unchanged.
