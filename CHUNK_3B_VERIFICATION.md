# Chunk 3B verification — 2026-10-29

**Status: implemented and locally tested; unverified in GitHub Actions.** CI #33 proves the earlier Chunk 3A commit `7b27ba4`; it does not exercise these changes. Chunk 3C has not started.

## Changes

| Area | Files and behavior |
|---|---|
| Import lifecycle | `lib/import-lifecycle.ts`, `lib/import-lifecycle-types.ts`: server-stored dry run, explicit commit, export baseline/conflicts, history and guarded undo using existing `import_job` records. |
| HTTP boundary | `app/api/imports/route.ts`, `app/api/imports/preview/route.ts`: authenticated owner/manager guards, server-derived tenant, bounded bodies/options, strict actions, rate limits and no-store responses. |
| UI | `components/ImportActions.tsx`, `components/ImportHistory.tsx`, `components/ImportWizard.tsx`, `app/prices/page.tsx`, `app/globals.css`: before/after classifications, explicit numeric/unit/warning approvals, three-way conflicts, commit, Excel export, history and undo confirmation. |
| Dated catalog values | `lib/catalog-values.ts`, `app/api/products/route.ts`, `lib/margin.ts`, `margin-engine.js`: imported prices feed the same quote resolver below existing pricing precedence; display reads dated prices and standard costs, without silently showing a zero for a cost gap. |
| Regression tests | `tests/import-lifecycle.test.ts`, `tests/import-pricing.test.js`, `tests/import-review.test.ts`: lifecycle, tenant/role boundaries, exact undo, SQL execution coverage, date/precedence cases and source guards. |

No migration or lockfile changed. All six migrations remain locked. There are no new tables/functions/grants, so the table minimum stays **38**, function ACL registry is unchanged, and pgTAP plans remain **156 fresh / 159 restore mode**. The restore inventory already includes import jobs and their JSON journals.

## Commit and conflict guarantees

Dry run stores only staging/journal records and relevant UOM issues. It lists new, changed, unchanged and rejected rows; the commit request cannot replace its server-side values. Text/locale and unit conversion require explicit approval, unresolved conflicts block commit, and skipping rejected rows needs explicit acknowledgement. Native decimal strings and integer arithmetic preserve four-place money precision. A unit conversion changes only supplied amounts; unmapped costs/prices remain untouched.

Lifeline exports contain product UUIDs plus a baseline stamp. The server validates the baseline per tenant and displays baseline/app/file values after concurrent edits. Existing row IDs, SKUs and base units are protected. “Keep app” is unchanged; “use file” applies the reviewed row; “review” blocks commit. A stale plan, changed unit factor, expired plan or later-created SKU fails before business writes. A unique/FK/interval race rolls the entire transaction back.

Undo compares all committed business values and relevant related rows before restoring exact prior product metadata, cost/price IDs, dates, sources, currencies and counts. It refuses later changes, new quote/invoice references, or later use of a newly created price list. Audits and import/issue history remain retained. The existing row audit triggers cover every mutation; journal state changes are also audited.

## SQL executed locally

`tests/import-lifecycle.test.ts` boots PGlite with **all six actual locked migrations**, `pgcrypto`, `btree_gist`, and minimal Supabase `auth.users`, `auth.uid()` and platform-role setup. It switches to the actual restricted `margindesk_app` role and asserts NOSUPERUSER/NOBYPASSRLS. No production grants are widened and no pgTAP assertions are stubbed in the new lifecycle test.

Every new runtime SQL statement was executed. A TypeScript AST inventory extracts literal `db.query` statements from `lib/import-lifecycle.ts`, `lib/catalog-values.ts`, and the new quote product/list-history query, and fails if any is absent from the PGlite execution trace. This includes:

1. Tenant advisory lock/date/currency lookup; price-list lookup/lock; product, cost, price and UOM/conversion row locks; graph/physical-revision snapshots; supplier-filtered export selection and one-row baseline lookup.
2. Import/export job insert, dry-run journal/count update, locked job lookup, committed state/actor/time update, undo state update, and history projection including actor and counts.
3. Existing `convert_quantity` and `record_data_quality_issue` calls, including missing/unknown units, approved BOX conversions and changed-factor rejection.
4. Dated cost/price interval selection, same-day updates, interval closure, next-scheduled-date lookup, inserts with tenant currency, new product/list insertion, and the new-product trigger's temporary cost-row replacement.
5. Undo dependency/list-version checks, price/cost/product/list deletes, and exact original cost/price row restoration with explicit column lists.
6. Current catalog price/cost display queries and the quote product query that supplies imported list history to the shared engine.

The main lifecycle test runs **twice on fresh data and twice with pre-existing import/export rows**. It proves conflicts, all four row states, explicit rejected-row approval, duplicate commit/undo rejection, tenant isolation, audited writes, effective-cost/price usage by quotes, unsafe undo rejection, and exact business row restoration. Each transaction rolls back and compares counts for **all 38 tenant tables**, including journal/audit tables, against the baseline. A second test runs twice and covers same-day changes, interval splitting/gaps with scheduled future values, numeric/unit approvals, partial-column conversions, missing units, modified/missing keys, expired/stale plans and late SKU creation.

The existing full pgTAP SQL also runs under the older PGlite auth/role/pgTAP harness as part of `pnpm test`. A real Supabase/Postgres execution of these new application paths, contention between separate database sessions and a full restore of a committed undo journal were **not** run locally and remain **unverified**.

## Local browser check

A temporary browser harness mounted the actual wizard/actions/history components and used the actual parser and lifecycle modules through local HTTP handlers over PGlite. It used a fixed test actor, not Supabase Auth or the actual Next.js routes. It passed Excel CSV export, mapped re-upload with app/file edits, three-way conflict display, keep-file selection, refreshed preview, explicit commit, history and undo with exact restored catalog counts. It also checked one primary action, 44px buttons and a 390px layout without page overflow. Desktop/mobile screenshots were visually reviewed. The temporary harness/screenshots were removed.

This does **not** verify authenticated Next.js behavior, production Supabase or deployed browser behavior. Formal WCAG/assistive-technology testing remains **unverified**.

## Final local gates

| Command | Result |
|---|---|
| `pnpm test` | **Passed:** 67 JavaScript + 24 TypeScript tests (91 total), including the Phase 0 golden cases, upload-security cases, fresh/populated repeatability, audit/undo checks and every-new-query PGlite coverage. Service-role scan checked 101 user-facing files. |
| `pnpm typecheck` | **Passed:** `tsc --noEmit`. |
| `pnpm build` | **Passed:** production Next.js build, including `/api/imports` and `/api/imports/preview`. |
| `pnpm check:migrations-lock` | **Passed:** six locked applied migrations, zero pending; all hashes unchanged. |

The manager-role regression caught an unnecessary tenant-row locking read: PostgreSQL applied the tenant's owner-only update policy and hid the row from managers. The final code uses a normal tenant read and rechecks workspace currency; product/history/price/UOM locks remain. No policy or privilege was widened. Every final runtime SQL statement passed the execution inventory. Real contention across independent sessions remains unverified.

Limits: 200 total data rows per import, 1,999 per export and an 8 MiB journal. Raw files are not retained, but normalized business values and before/after snapshots are persisted in jobs/audits. Standard-cost/tenant-currency catalog imports only; quantities do not write inventory. No CSV deletion semantics, connector, or Chunk 3C feature is added. See `ASSUMPTIONS.md` for retention and Phase 1 open items.
