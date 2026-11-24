# Team sharing S3a (the signed grid as the source, and the Settings › Sharing grid): verification

25 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` section 3. Built by Claude Code. There is no server change and no migration; the S2 migration stays **pending** until the user's Restore Drill.

## A flaw in S2b, fixed here (found in an advisor review)

**The flaw.** In S2b, an Owner's rotation rebuilt the grid from that vault's own Team and roles. An Owner rotating from a **second device** (as the recovery prompt recommends), or a second Owner, would sign everyone else as a Sales Rep. The signature was valid, so every verifier would have accepted it. Extras and ticks also reset at every rotation.

**The fix:**
- **The last signed grid is the base.** Every rotation signs the last signed grid, plus this device's **draft**: the edits an Owner made here, never sent before they are signed.
- **Roster changes.** People new to the roster join as Sales Reps until an Owner says otherwise; people who left the roster drop out. Local Team and roles seed only the very first grid.
- **Team and roles edits become the draft.** A change made by a grid Owner in Team and roles becomes a draft edit. Anyone else's local edit is overwritten by the next signed grid.
- **Every vault follows the signed grid.** With no draft pending, every vault, an Owner's included, mirrors the signed role table. A second Owner device stays in step.
- **After signing.** A successful rotation clears the draft.

## The Sharing grid

Settings › Team and roles › **Who receives what**, for people with the Team and roles capability.

**The table.**
- Each row is a data pack and each column a role.
- 🔒 marks cost for Sales Rep and Admin / IT; it is never a tick box.
- Owner and Pricing Owner columns are always ticked, because they publish.
- The five packs not built yet are shown but cannot be changed.

**Around the table:**
- **Presets:** Recommended, Open team, Strict (prices only), and back to the signed grid.
- **Per-person extras:** an extra pack for one person, never a locked one.
- **Preview as:** the packs one person would receive.
- **What changes when this is signed:** who gains and who loses which packs, compared with the signed grid.
- **Save draft and Discard draft.** The draft is signed at the next rotation (Home › Shared inbox › Device keys).

**Worker checks** (`shareGrid`, `shareGridSave`, `shareGridDiscard`):
- only an Owner under the signed grid can save;
- a grid that ticks cost for a role without cost is refused;
- so is a grid with no Owner;
- so is a grid that changes who is on the team, because the roster decides that.

## Tests

**`tests/relay-sharing-session.test.ts`** gains one test and changes one rule.
- **The second Owner device:** a fresh vault that knows only its own Owner role builds exactly the signed grid, with every role and extra kept.
  - A newcomer joins as a Sales Rep, and a leaver drops out.
  - An Owner's role change becomes a draft that the builder signs, and the mirror waits while it is pending.
  - The grid screen refuses cost ticked for Sales Reps, and a changed team; a valid draft saves and discards.
  - Without a draft, the Owner's vault mirrors.
  - Someone who is not a grid Owner cannot save.
- **The changed rule:** the S2b role-mirror test now expects an Owner vault to follow the signed grid when no draft is pending.

**Relay browser gate:** new check `sharingGridUi` (14 checks). On the Owner device it checks:
- the Sales Rep cost lock;
- an unticked pack showing in "will stop receiving";
- save, then discard, the draft.

## Results

| Check | Where | Result |
|---|---|---|
| Unit tests | local | 78 JS and 370 TS passed |
| `next build --webpack`, after `build-spike.mjs` | local | passed |
| Relay browser gate, Chrome, PGlite transport | local | 14 checks passed |
| CI and `verify` | CI | recorded in the PR |

**Local tooling note.** A first local gate run used a stale vault worker bundle, because `build-spike.mjs` was not rerun. The new command was then missing, and the grid card did not render. Rebuilding the worker fixed it. CI always rebuilds.
