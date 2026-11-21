# Roadmap phases 11, 13 and 14: verification

21 November 2026 (Asia/Kolkata). Built by Claude Code from the post-review roadmap, in order. **Local runs are not CI evidence**; the CI lines are.

## What CI verified

| PR | What | CI `verify` | Commit |
|---|---|---|---|
| #16 | CI fixes for the red runs on `main` (#194, #196, #197): Node pinned to 24.22.1, the Supabase start retried once, the killed-tab close bounded | [CI #198](https://github.com/Adityapawar5105/rebatehq/actions/runs/44906135199) passed; `main` after the merge passed [CI #200](https://github.com/Adityapawar5105/rebatehq/actions/runs/44931126427) | `adc05d0` |
| #17 | Phase 11: Quote Desk completion (vault v22) | [CI #199](https://github.com/Adityapawar5105/rebatehq/actions/runs/44906180815) **failed** (see below); after the fix, [CI #201](https://github.com/Adityapawar5105/rebatehq/actions/runs/44931475576) passed | `5fc157d` |
| #18 | Phase 13: clean-up, OPERATIONS.md, parallel CI, client-address rate limit | [CI #202](https://github.com/Adityapawar5105/rebatehq/actions/runs/44931718412) passed: the first run of the three parallel jobs (`unit`, `chromium`, `firefox`) and the `verify` job that needs all three | `11a26c9` |
| 13.10 | Actions on Node 24 | ACTIONS_RUN | `d7404aa` |
| Phase 14 | Performance 14.1 to 14.5, the 14.6 study and its benchmark | PHASE14_RUN | PHASE14_SHA |

### Why CI #199 failed, and the fix

The Chromium gate stopped at `phase8Ui` with "The account page overflows a 375px phone screen". The device table on Account › Licence, seats and devices (person and device ID, date, status, two buttons) is wider than 375px. CI #191 passed the same check on Phase 8, most likely because it measured while the list still showed its loading text; the logs do not show which. The table now sits in the shared `DataTable` scroll box, and the check waits for the loaded list, waits two frames after resizing and, on failure, names the elements that are too wide.

## Phase 11 (Quote Desk completion)

Copy and revise a quote, a validity date with an expired flag, a customer PDF with the workspace's branding (logo, address, terms), a price list (CSV or Excel) and a mailing list from the resolved price book, and barcode lookup in Price Check and quote lines. Local vault **v22** (62 tables): `quotes.revision_of`, `products.barcode`, `quote_branding`. Blueprint section 22, item 34. New browser check `quoteDeskUi`; unit tests in `tests/quote-desk.test.ts`.

## Phase 13 (clean-up and operations)

13.1, 13.3 and 13.4 removed the static prototype, the legacy business pages and their switch, and the spike lab (decisions D15, D12, D13). The retired API routes keep their fixed 410. 13.5 rewrote `OPERATIONS.md`; the old log is unchanged in `docs/evidence/OPERATIONS_HISTORY.md`. 13.6 added dated notes on stale statements, 13.7 moved the 31 chunk evidence files here and 13.8 added formatter settings (D14). 13.9 split CI into parallel jobs. 13.11 together with roadmap 3.7 (audit B-9): the rate limiter keys on `x-nf-client-connection-ip`, then `x-real-ip`, then the last `x-forwarded-for` hop, each checked to be an IP address.

**Not observed live:** which of those headers Netlify sets for a sign-in request. If Netlify's own header were missing and the last `x-forwarded-for` hop were a shared proxy, users behind it would share one limiter bucket. Check the limiter keys on staging after the next deploy, without sending real sign-in emails.

13.10 is its own PR. Each action moves to the first major version that runs on Node 24 (read from each `action.yml`): checkout v5, setup-node v5, upload-artifact v6 and pnpm/action-setup v5. The newest majors (v7, v6) are not needed. `restore-drill.yml` gets the same bump, but PR CI does not run it: that workflow is manual and run by you.

## Phase 14 (performance)

| # | Change |
|---|---|
| 14.1 (B-7) | Leak results are kept per date window for the current data version and engine. Home no longer reruns the finder on every visit or clears Margin's result. The finder's temporary tables hold only its last window, so the evidence rows and report totals ask for the full-history tables, and a run that fails part-way leaves no window named |
| 14.2 (B-14) | An import, a file removal and the Playground load rebuild the rebate accruals once, inside their transaction (where an overlapping agreement rolls the import back), and the follow-up step skips the second rebuild |
| 14.3 (X-5) | A page builds its context from one lookup of the person and their memberships |
| 14.4 (N-2) | The offline copy prunes old build files. `sw.js` does not change per release, so `activate` cannot do it. A build is named by a hash of the `/_next/static/` paths its page references. Each stored file carries the build that last used it, and storing a new build's page deletes files used by neither that build nor the previous one |
| 14.5 (L-1) | A Reconciliation visit writes and saves only when the open differences changed |

### Local checks before the push

335 TS and 78 JS unit tests passed, and typecheck passed. The local Chromium lab gate passed with 72 named checks, including `monitor`, `margin`, `rebates`, `offlineUi` and `phase8Ui`. A new unit test makes the engine stop during Home's finder run; it fails without the 14.1 guard.

### Local measurements (1 million lines, not CI evidence)

One run each, back to back on the same build, in headless Chrome on a 12-thread, 7 GB Windows laptop. "Before" is the pre-Phase-14 `lib/` and `sw.js` (branch `claude/phase13-actions`), with the same benchmark action, `phase14Benchmark` in `tests/browser/vault-worker.ts`. Synthetic data: two years of lines ending today, 100,000 products, 2,000 customers, five rebate programmes.

| Step | Before | After |
|---|---|---|
| Home, first visit | 1,472 ms | 1,453 ms |
| Home, second visit, unchanged data | 1,399 ms | **244 ms** |
| Margin leak finder after Home | 8,340 ms | 8,487 ms |
| Home after Margin | 1,477 ms | **272 ms** |
| Margin again | 7,225 ms | **8 ms** |
| Reconciliation, 1st / 2nd / 3rd visit with one open difference | 1,754 / 1,734 / 1,982 ms | 1,794 / **713** / **698** ms |
| An import's follow-up step (pre-aggregate, reconcile) | 2,285 ms | 2,207 ms |
| One accrual rebuild, five single-customer programmes | 73 ms | 73 ms (now once per import, not twice) |

The 14.2 saving grows with programmes and their eligible lines; with five single-customer programmes it is small. 14.3 saves one database round trip per page load and was not timed. 14.4 is covered by a unit test across three releases. On the running app, the shell page gave the same build name on seven requests, including French, Spanish, Canadian French and the dark theme. The signed-in `/home` page was not checked, because that needs a sign-in.

To reproduce: build as for the gate (`scripts/build-spike.mjs`, then `next build --webpack`) and start the app with `VAULT_LAB_ENABLED=true`. Bundle `tests/browser/vault-worker.ts` the way `scripts/test-vault-browser.mjs` does, open `/lab/vault`, and post `{ action: "phase14Benchmark", rows: 1000000 }` to the test worker.

### 14.6 study: can long jobs let clicks through?

No code change: the roadmap asks for a measured design first.

- **Today:** `lib/vault/worker.ts` runs every request, read or write, on one promise queue, and scheduled agents and backups join the same queue. A click waits for the whole job in front of it. In the run above, a full leak finder run took 7,188 ms in 42 statements.
- **Measured:** a cheap read sent straight to the engine 200 ms into that run answered in 541 ms (551 ms on the old code). The finder's longest single statement took 1,398 ms. With a separate lane for reads, a click would wait at most about the longest running statement, not the whole job.
- **What a design must solve:**
  - Writes must stay in one order. A read must never run on the engine connection while a write transaction is open there: it would join that transaction, and its failure could abort it.
  - The finder's temporary tables live on the one connection, so a read lane must not touch `lf_*` tables while a run is in flight.
  - DuckDB-Wasm runs one statement at a time, so a read lane removes the queueing behind whole jobs, but not the wait for the current statement.
- **Options, cheapest first:**
  1. Let read-only commands (marked in `ACTIONS`, Phase 9) skip ahead of read-only long jobs (Home, Margin leaks, report checks) but never past a write.
  2. Split the finder's few longest statements so no single one blocks for more than a few hundred milliseconds.
  3. Give reads a second DuckDB connection, which brings its own snapshot and temporary-table questions.
- **Recommendation:** measure option 1 behind a flag at 1M and 2M lines before building it.
