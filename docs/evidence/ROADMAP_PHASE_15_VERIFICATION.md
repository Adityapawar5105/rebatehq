# Roadmap Phase 15 pull-forward (15.1, 15.3, 15.6, 15.7): verification

22 November 2026 (Asia/Kolkata). Built by Claude Code after the user confirmed "Yes, build them". Payments (Phase 12) and the mobile app (15.5) are out by the user's instruction. Blueprint section 22, item 35. **Local runs are not CI evidence**; the CI line is.

## What CI verified

| PR | What | CI `verify` | Commit |
|---|---|---|---|
| PR_NUMBER | 15.1, 15.3, 15.6, 15.7; local vault v23 | CI_RUN | CI_SHA |

## What was built

| # | What | Where |
|---|---|---|
| 15.1 | Scheduled pickup from the remembered import folder, only while the app is open and unlocked and only with read permission already granted in the session. New recipe matches go to Import Studio; with "import automatically" on, a batch with nothing to decide is imported and audited, and anything else waits for review. A batch in progress is never touched; the check is not activity for the auto-lock | `lib/vault/folder.ts`, `VaultService.folderPickupDue`, the worker's one-minute tick, `FolderReimport.tsx` |
| 15.3 | Payments against submitted or approved supplier claims (part payments, days past due, paid when covered, void instead of delete, short payment shown); Paid and Still owed in the claims grid; "Export for finance" with customer accruals by programme and month and supplier claims owed | `lib/rebate/finance.ts`, `RebateFinance.tsx` |
| 15.6 | Custom ERP export layout: column editor with fields or fixed values, order, separator, decimal mark, date format and header row; the file reshapes the generic export receipt's approved rows | `lib/pricing/layouts.ts`, `lib/pricing/layout-spec.ts`, `ExportLayouts.tsx` |
| 15.7 | Saved simulator runs (totals and a data stamp, at most 50), two to four compared side by side, with runs on changed data marked | `lib/vendor/sim-runs.ts`, `SimRuns.tsx` |

Local vault **v23** adds `claim_payments`, `export_layouts` and `sim_runs` (65 tables). No Supabase migration. The new commands are classified in `ACTIONS`:
- **15.1:** `folderPickup` and `folderPickupSet` need `data`.
- **15.3:** payments need `rebateManage`; balances and the finance export need `cost`.
- **15.6:** layouts need `export`.
- **15.7:** saved runs need `pricing`.

Every change is audited.

## Local checks before the push

- Typecheck passed; 344 TS and 78 JS unit tests passed, including the new `folder-pickup`, `rebate-finance`, `export-layouts` and `sim-runs` tests and the v23 schema pins.
- Each worker flow in real DuckDB-Wasm in headless Chrome:
  - **`converters`:** pickup re-adds nothing already imported, leaves a new file for review, never touches a waiting batch, and imports a clean batch.
  - **`suppliers`:** part and full payment, paid status, grid columns, finance export, rep denial, and payments surviving an encrypted reload.
  - **`pricing`:** a custom layout export holds the same rows as the generic export, in the layout's format.
- The local Chromium lab gate passed with 72 named checks, including `convertersUi` (with the pickup settings), `suppliersUi`, `simUi` (with two saved runs compared) and `phase8Ui`.

## Limits

- **Folder pickup** runs only in Chrome and Edge (Firefox has no folder permission API) and only while a tab is open. The person allows the folder once per session, unless the browser offers to remember the permission. Not built: an SFTP drop, which needs a server.
- **Payments** are recorded by hand from remittances. Nothing is read from a bank or posted to an accounting system.
- **Custom layouts:** the landed check compares against the generic layout, not the custom one. No ERP has been tested with a custom file.
- **Saved runs** keep only totals. The per-product breakdown is available for the current run only.
- **Still not built:**
  - 15.2 (an ERP connector) and 15.8 (portal, elasticity models, SAML) need a design first;
  - 15.4 (Google or Microsoft sign-in) needs the operator's OAuth client credentials.
