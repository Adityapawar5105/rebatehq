# Team sharing S1 (the encrypted hand-off file): verification

24 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md`, release S1. Built by Claude Code. There is no server change and no Supabase migration. Local vault **v24 / 67 tables**.

## What it does

### Export for a colleague

Settings › Team and roles › Share with a colleague. Only Professional and Scale, and only for a person with the new `share` capability (Owner, Pricing Owner, or the named Pricing Owner).

1. **Choose who the file is for.** Pick the person's role, and optionally type their name.
2. **Choose the packs.** The packs are:
   - items (no cost);
   - customers and tiers;
   - book prices;
   - customer contract prices;
   - guardrails;
   - item cost and cost basis;
   - floors based on cost.

   There are two presets: "Full copy" and "Sales copy (no cost)". A pack with cost is disabled for a role without the `cost` capability (Sales Rep, Admin / IT), with the hint "make them a Sales Manager" (D18).
3. **Download.** The file is `rebatehq-share-<date>.rhqshare`. A one-time code is shown once: six groups of four characters, 120 random bits. It is never stored. The export is written to the audit log with the pack IDs and the role only, never values.

### Import from a colleague

Any role, Professional and Scale.

1. **Check the file.** The person chooses the file and types the code. "Check file" shows who made it, when, the role it was made for, and the row count of each pack.
2. **Refusals.** The worker refuses:
   - a wrong code;
   - a changed byte;
   - a file from another workspace;
   - a vault backup;
   - a different currency;
   - a cost pack for a role without cost;
   - a file older than the copy already held.
3. **Import.** Import applies every pack in one audited transaction:
   - a received row replaces this device's own row with the same key;
   - rows of an earlier shared copy that the new copy no longer has are removed (prices, guardrails, vendor costs);
   - items and customers are never deleted, because sales lines may still point at them;
   - rows are tagged `shared:<pack>`;
   - local row notes are kept;
   - the price changes are recorded (at most 2,000 per pack).
4. **After import.** Shared data appears in the same tables every screen already reads, so Price Check and Quote Desk use it at once. A notice shows "Shared by {name} on {date}", each pack, a "this copy is N days old" warning after 7 days, and what changed.

### Floors based on cost

- **The flag.** A new tick box on the guardrail form, "This floor is cost plus a margin", sets `price_guardrails.floor_from_cost`.
- **What a sales copy gets.** The guardrails pack carries the **target** in place of such a floor, so a receiving rep treats anything under target as needing approval (fail closed).
- **What a cost role gets.** The real floor travels only in the `cost_floors` pack.

## Where it is built

| File | What |
|---|---|
| `lib/sharing/packs.ts` | Pack definitions as a column allow-list, the held-back list with reasons, the cost lock (`packAllowed`, from `capsFor`), the runtime scan, and apply in SQL |
| `lib/sharing/handoff.ts` | The code, and the file format. Magic `RHQSHARE`, which is different from `MDVAULT1`, so a hand-off file is never a backup. PBKDF2 at 600,000 iterations, AES-256-GCM in 1 MiB chunks, and the header (with the workspace) authenticated on every chunk. Gzip through `CompressionStream` |
| `lib/vault/service.ts` | Five commands: `shareState`, `shareCounts`, `shareExport`, `shareImportPreview`, `shareImport` |
| `lib/roles/access.ts` | The new `share` capability, and the commands with their read/write mode |
| `lib/vault/schema.ts` | v24: `floor_from_cost`; `shared_books`; `shared_changes`. The guardrail index is rebuilt as `guardrail_tier_category_v24`, because a migration runs in one transaction and DuckDB cannot re-create a dropped index name inside it |
| `components/local/ShareHandoff.tsx` | The card |
| `components/local/PricingView.tsx` | The floor tick box |
| `lib/i18n/locales/en.ts`, `es.ts`, `fr.ts` | 66 new messages. fr-CA needs no override |

## Tests

**`tests/sharing.test.ts` (8 tests):**
- **Allow-list.** Every column of `products`, `customers`, `price_matrix`, `price_guardrails`, `vendor_costs` and `cost_basis_settings` is either carried or held back with a reason. No pack without cost carries a cost column, and the guardrails pack never reads a floor based on cost.
- **Cost lock.** It is checked for every role and every pack. Prerequisites travel together; only Owner, Pricing Owner and the named Pricing Owner may export.
- **Scan.** It refuses a planted `current_cost` column, an extra column and a badly typed value. A floor based on cost is replaced by the target.
- **File.**
  - There is no clear text in the file.
  - The code is case-insensitive and ignores dashes.
  - A wrong code, another workspace and a changed byte are refused.
  - `readHeader`, the vault and backup reader, refuses the file.
- **End to end through the real dispatcher.**
  - A rep cannot export.
  - Cost is refused for a Sales Rep and an Admin; Starter is refused.
  - The sales copy passes the decision-16 key and value scan, with no note in it.
  - In a rep's vault: a wrong code and the wrong workspace are refused, and the full copy is refused with `FORBIDDEN`.
  - The import replaces the same-key row, keeps other rows and the local note, and leaves cost NULL.
  - Changes are recorded and the import is audited.
  - A re-import changes nothing, and an older file is refused.
  - In a Sales Manager's vault, the full copy brings cost, the floor based on cost (flagged), vendor costs and the cost basis.
- **Upgrade.** v23 to v24 keeps guardrails, and the unique index still holds.
- **New vault.** It migrates v1 to v24 in **one transaction**, as the worker does.
- **Apply.** Applying is idempotent and removes rows that a new shared copy no longer has.

**Updated tests:**
- the schema version and table count (`notes`, `rebate-local`, `reports`, `supplier-claims`, `vault`, `bench`);
- `tests/quotes.test.ts`, which classifies the three new commands a Sales Rep can reach for decision 16.

**Browser gate `shareUi`** in `scripts/test-vault-browser.mjs`, run in the main flow and by `--share-ui-only`. In a fresh vault:
- Sales Rep is chosen, and the cost pack is disabled and unticked;
- the download starts with `RHQSHARE`;
- the code has the right shape;
- a wrong code is refused and opens no preview;
- the right code (typed in lower case) opens the preview;
- the import shows the received notice.

## Results

| Check | Where | Result |
|---|---|---|
| `tsc --noEmit` | local | passed |
| JavaScript unit tests | local | 78 passed |
| TypeScript unit tests | local | 358 passed, 0 failed |
| `next build --webpack` (lab enabled) | local | passed |
| `shareUi`, Chrome, production server, `--share-ui-only` | local | passed |
| `shareUi`, Firefox, production server, `--share-ui-only` | local | passed |
| CI (unit, build, Chromium privacy and relay gates, Firefox lab gate, `verify`) | GitHub Actions | recorded below once run |

**A bug the browser run found.** The first local browser run failed at "Create encrypted vault". The v24 step had dropped and re-created the guardrail index under the same name, which DuckDB refuses inside the one transaction a migration runs in. The unit tests had applied the schema statement by statement and missed it. The index now has a new name, and a test runs the whole migration in one transaction.

## Not covered

- **The role table.** The receiving vault's role is still its own until S2, so in S1 the cost lock rests on the exporting side (`SHARING_DESIGN.md` section 9).
- **The hosted site.** Nothing ran on the hosted site; Netlify credits are exhausted until 14 Dec 2026.
- **Large books.** Speed with 100k or 200k SKUs was not measured.
- **Language review.** The Spanish and French text is machine-assisted and needs native-speaker review, as for every catalog.
