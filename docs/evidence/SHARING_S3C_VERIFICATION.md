# Team sharing S3c (read-only receiving seats, the "Shared by" banner, staleness and roll back): verification

25 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` section 6. Built by Claude Code. No schema change, no migration, no new request.

## What it does

**Read-only shared data on a receiving seat.**
- **Who is a receiving seat:** a device that joined sharing, is not a publisher under the signed grid (not the Owner, a Pricing Owner, or the named Pricing Owner) and holds packs received through the relay.
- **The rule:** on such a seat, the worker refuses any write to a table those packs carry. `sharedGuard`, called from `dispatch` for every command, raises a `SHARE` error that names the publisher and the pack. The publisher is authoritative, so a local edit would otherwise vanish at the next publish.
- **The classification** (`lib/sharing/governed.ts`). A test fails if a new write command is added without a decision.
  - **Governed:** `guardSet`, `ruleApprove`, `costBasisSet`, the four item-cleanup commands, `playgroundLoad`, `shareImport`, and imports.
  - **Imports** are decided by the staged files' kinds: item master (items and cost), customer list, vendor cost, price list (book and contract prices). Sales history, purchases and AR aging only add missing IDs, so they stay allowed.
  - **Not governed:** everything else, each with a reason. Examples: own notes, quotes, drafts that still need approval, and removing a file (it resets only rows it supplied; shared rows are tagged `shared:<pack>`).
- **What stays editable:** copies that arrived by hand-off file (S1) can still be replaced by the local owner, and a publisher's own vault is never read-only.

**The "Shared by" banner** (`components/local/SharedBanner.tsx`).
- **Where:** on a receiving seat, Pricing, Data Hub and Rebates & Contracts show it, for the relay packs each section holds.
- **What it says:** "Shared by {name}", each pack with its version, when it was received, that the data is read-only here, and that own notes stay on the device. It links to **What changed** on Settings › Team and roles.
- **What changed:** that list comes from `shared_changes`, which `applyShared` writes for relay copies as for files. It shows only what is recorded: the key and the old and new value. It does not name an approver.

**Staleness** (`lib/sharing/stale.ts`).
- **Relay copy:** stale only when this device has not synced for 7 days. A publisher with nothing new to send does not make it old.
- **Hand-off file:** still ages from its publish date (S1).
- `shareState` now returns `receiving` and `lastSyncedAt`.

**Roll back.** No new mechanism; it uses the existing audited path.
- The publisher rolls a price version back in Pricing (`priceRollback`, a draft that needs approval), and the Pricing Owner approves it.
- **Publish now**, or the next key rotation, then publishes it as a new, higher pack version, so versions only go up. Receiving seats apply it and list what changed.
- Re-sending old chunks was ruled out: the next publish reads the publisher's own tables, so it would undo itself.

## Checks run locally (not CI evidence)

**Unit tests.** `tests/sharing-governed.test.ts` (3 tests):
- every write command is classified once, with known packs and file kinds;
- `dispatch` runs the guard;
- a Pricing Manager on a receiving seat:
  - cannot change shared guardrails, run item cleanup, load the Playground, or import an item master;
  - can import sales history and purchases, replace customers that arrived by file, and edit quotes and notes;
- publishers are never refused, and the message names the publisher;
- `shareState` reports `receiving` and the last sync;
- staleness arithmetic.

**Relay browser gate.** `scripts/test-relay-browser.mjs --browser=chrome` in lab mode: **16 checks passed**. The new check `sharedSeatsReadOnlyUi` confirms that the Sales Manager's and the rep's Pricing show "Shared by" after receiving, and the publishing Owner's does not.

**Suites.** The full JS (80) and TypeScript (382) suites pass. The `roles.test.ts` fake service gained `sharedGuard`.

## Not done (still to come)
- **Edit buttons:** they are not disabled ahead of time; the worker refuses the write and the screen shows the message.
- **Deltas, compaction and Realtime (S4).**
