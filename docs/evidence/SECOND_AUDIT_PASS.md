# Second audit pass (roadmap Phase 16)

22 November 2026 (Asia/Kolkata). Done by Claude Code on the user's go-ahead ("Yes, start Phase 16").

The first audit (17 November) read about 40% of the source and listed what it had not read. This pass read those areas closely:
- the leak-finder rules;
- item cleanup and undo;
- vendor review and the simulator;
- the PDF and report builders;
- the file converters;
- the relay crypto;
- the screens' loading, empty and error states;
- the language catalogs;
- the operator scripts and the restore workflow.

Each confirmed defect was fixed in this branch with a test that fails without the fix. This is a code review. It is **not** the independent security review that `SECURITY_REVIEW.md` R02 and decision D16 still require before card payments.

## Findings and fixes

| # | Area | Severity | Finding | Fix |
|---|---|---|---|---|
| A2-1 | Item cleanup | Medium | Merging duplicate items lost the duplicates' barcodes (vault v22). The barcode was neither copied to the kept item nor journalled, so a counter scanner stopped finding the item, and undo could not restore it | The barcode fills an empty barcode on the kept item like the other fields, and is journalled and restored by undo. Test in `tests/cleanup.test.ts` |
| A2-2 | Import removal | Low | Removing an item file reset the fields it supplied but left its barcodes, so an item kept a barcode from a file that no longer exists | The reset clears the barcode where the column exists. Test in `tests/cleanup.test.ts` |
| A2-3 | Simulator | Medium | The simulator replayed `sales_lines` directly, so its "actual" rebate and margin left out customer rebate programme accruals. The Margin screens and the leak finder include them through `rebate_sales`, so with an active programme the simulator disagreed with Margin for the same months | It reads the same input as Margin. Test in `tests/simulator.test.ts` (fails without the fix: 200 instead of 218) |
| A2-4 | File converters | Low | The workbook expansion limits trusted the sizes in the zip's central directory. A crafted workbook from an outside source could declare small sizes there and expand further when read, freezing the importing tab | When an entry's local header carries sizes (no data descriptor), they must agree with the central directory. Test in `tests/studio.test.ts` |
| A2-5 | Cost index screen | Low | Filtering the SKU grid of a cost index trigger had no error handling (an unhandled rejection and nothing shown), and a late answer for one trigger could overwrite the list after another was chosen | The error is shown, and an answer for another trigger is dropped |
| A2-6 | Operations docs | Medium (process) | `OPERATIONS.md` (rewritten in 13.5) and `README.md` said `scripts/purge-deleted-tenants.ts` removes disabled workspaces after 30 days and keeps audit rows. The script stops at its first line ("suspended pending the retirement proposal decision"), and that decision was taken on 5 November | The docs now say it is suspended. **Not switched back on:** deleting customer workspaces in production first needs a pgTAP test proving the cascade keeps audit rows, plus a passing Restore Drill. That is the owner's call |

## Read and found sound

- **Relay crypto** (`lib/relay/crypto.ts`, `protocol.ts`, `state.ts`):
  - Each member's epoch key is wrapped with a fresh ephemeral P-256 key exchange, HKDF (salted with the epoch ID) and AES-GCM, bound to a header that is also authenticated. Each event uses its own derived key.
  - ECDSA signatures are forced to low-S, so an altered signature never verifies. Epochs and events are chained by hash and sequence. The first epoch needs the administrator's fingerprint; later ones need a signer who was an administrator in the previous epoch.
  - Approval decisions keep their order and come only from named administrators, never the requester. The author's preset can only add an approver; the workspace minimum always applies.
  - Schemas bound every length.
- **File converters:**
  - Workbooks: refused when encrypted, when they hold a path that leaves the workbook, or DOCTYPE or ENTITY declarations; flagged when they hold macros, external links or embedded objects; capped on expansion ratio, size, rows, columns and cell length.
  - pdf.js 6.4.299 runs with eval, font faces and XFA off, and a 500-page limit.
  - Amount and date cleaning returns anything ambiguous unchanged, so the import rejects it with a location instead of guessing.
- **PDF writer** (`lib/margin/pdf.ts`):
  - Every text goes through one escape (parentheses, backslashes; control characters and characters outside WinAnsi become "?"), the title included.
  - Numbers are fixed-point, and JPEG logos are hex-encoded and size-checked.
- **Leak-finder rules:**
  - A line cannot be counted twice between the peer-rate floor pattern and a configured guardrail floor (each applies only where the other cannot).
  - Credits and lines without cost are excluded where they must be, and the overlap between findings is deduplicated in the total.
  - The Playground manifest is still reproduced exactly in CI.
- **Item cleanup:** apart from A2-1, merge and undo journal every changed cell and restore only cells that still hold the fix's value. `sales_lines` has exactly the columns the merge copies.
- **Language catalogs:** every key exists in English, Spanish, French and Canadian French. Only one multi-word Spanish or French value equals the English one: the feature name "Quote Desk".
- **Screen states:** worker calls from the screens either go through the shared operation wrapper, have a catch, or are grid fetchers that `DataGrid` handles; apart from A2-5.
- **Operator scripts:** `issue-licence.ts` refuses a non-administrator connection and a downgrade that would leave extra seats or locations; its change is audited by the `workspace_licence` trigger. The restore workflow has passed Restore Drills #14 to #22; it was not changed here.

## Still not covered

- The independent security review (R02, D16), before card payments.
- A browser run of each finding on staging. The local Chromium gate and CI cover the changed paths with synthetic data.
- Native-speaker review of Spanish and French (roadmap 15.5).
