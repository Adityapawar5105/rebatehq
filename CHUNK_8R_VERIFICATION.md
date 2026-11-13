# Chunk 8R verification

Blueprint Phase 3, chunk 8R: wave 2 of the legacy table retirement (RETIREMENT_PROPOSAL.md, approved 5 November 2026; blueprint section 22, items 15 and 29). Built by Claude Code, 13 November 2026.

**8R passed CI** in [CI #150](https://github.com/Adityapawar5105/rebatehq/actions/runs/43453893489) on `436459c`, 13 November 2026 (Asia/Kolkata):
- 361 unit tests (78 JS + 283 TS);
- the 8R migration applied to a clean local Supabase, and the fresh **136-check pgTAP suite** twice on real Postgres;
- **67 authenticated Chromium vault checks** and **64 Firefox lab checks**;
- **12 real-authenticated local-Supabase relay checks**;
- the high/critical dependency audit.

Every job step passed.

**The migration stays pending** under `pendingMigrations` in `migrations.lock` until a **user-run** Restore Drill (target local) passes. 8R is complete only then.

## Precondition

The Supabase connector lists no projects for the user's organisation, so no hosted database holds rows in these tables. The legacy routes that wrote them have been off by default since 5B, and the quote routes have been fixed 410 responses since 6R.

## What was built

**Migration.** One `DROP TABLE` removes all 12 wave-2 tables:
- `quote`, `quote_line`, `quote_share_link`;
- `approval`, `approval_rule`;
- `rebate_agreement`, `rebate_progress`, `rebate_tier`, `rebate_entry`;
- `supplier_credit`, `alert`, `fx_rate`.

Every foreign key into them comes from another table in the list. There is no CASCADE and no IF EXISTS: if anything else still depended on them, the migration would fail instead of removing it. Their policies, indexes and audit triggers go with them. No function, type or view served only these tables, so none is dropped.

**Why `fx_rate` can go.** The vault has kept per-workspace exchange rates since 7C-3a (CI #108), and nothing on the server reads `fx_rate`.

**Server code.**
- `lib/rebates.ts`, the last helper that read the wave-2 tables, is removed.
- `/legacy/rebates` is a fixed not-found, like the 6R pages.

Pure logic is kept: `rebate-engine.js`, the margin engine, `lib/quote-approval.ts` and the rep-safe projection.

**What the server stores now.** 13 public tenant tables: tenant, membership, invite and audit_log; the four licence tables; the four relay tables; and bench_consent. It also keeps the reviewed `rebatehq_private` objects.

## Tests

**`tests/chunk8r-retirement.test.ts` (4 tests)**, in PGlite over the real migrations:
- One row is seeded in each wave-2 table before 8R. Afterwards exactly the 13 control-plane tables of `config/http-boundary.mjs` remain.
- No function is added or removed, and earlier audit rows stay.
- No foreign key points at a dropped table, and RLS stays forced everywhere.
- With an unexpected dependent table, the drop fails and nothing is removed.
- The migration drops exactly the wave-2 list, with no CASCADE and no IF EXISTS.
- No route, page or top-level server helper reads a wave-2 table, and `/legacy/rebates` is a fixed not-found.

**pgTAP.** The suite now plans **136** fresh and **139** restore checks (from 169 and 172).
- **Removed (33 checks):** the checks for the dropped tables only. These were the ACL, positive-control and constraint checks for `fx_rate`, `rebate_tier`, `rebate_entry`, `quote_share_link` and `approval_rule`, plus the server self-approval check.
- **Moved to tables that remain:** the owner's positive UPDATE and DELETE, the anon ACL probes and the manager denial now use `invite`. The `auth.uid()` policy evaluation, the rep DELETE denial and the no-context query now use `membership`.
- **Broadened:** the no-context check now covers every readable public tenant table (13), not just two.
- **Counts:** the 5B check counts exactly 13 tenant tables and asserts that `quote` and `fx_rate` are gone.

**Restore tooling.**
- The sentinel is now a licence location with the same fixed ID.
- The quote and agreement hashes are replaced by full-content hashes of the four licence tables.
- Every minimum is now 13: the equivalence check, the dump inspection and the repeatability check.

**Updated tests:** the PGlite run of the full suite (fresh and restore mode), the structure test, the fixture builder (four tables), the restore inventory, equivalence and role-filter tests, the licence API and workspace set-up tests.

## Local checks (not CI proof)

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node scripts/check-schema.mjs` | passed: 13 live tenant tables, 34 retired by later migrations |
| `node scripts/check-migrations-lock.mjs` | 12 applied, 1 pending (8R), hashes match |
| `node --test tests/*.test.js` | 78 of 78 passed, including the full pgTAP suite in PGlite (136 checks fresh, 139 restore mode, each run twice) |
| `node …/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts` | 283 of 283 passed (4 new in `tests/chunk8r-retirement.test.ts`) |
| pgTAP on real Postgres, browser and relay gates | not run locally; CI runs them |

## Unverified

- **Restore Drill:** the user has to run it. Until it passes, the migration stays pending.
- **Hosted databases:** none exist today. A hosted project created later needs this migration applied through the normal path.
