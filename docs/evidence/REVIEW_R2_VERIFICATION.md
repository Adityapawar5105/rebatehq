# Review R2: making team sharing safe to turn on — verification

Built by Claude Code on 26 November 2026, phase R2 of the 26 November full project review. The register entries are R18 to R27 in `SECURITY_REVIEW.md`.

## What changed

**The relay log no longer has a ceiling (R18).**
- **Before:** the client refused to load relay state past 10,000 events or 256 epochs, and nothing trimmed it. Relay rows cannot be deleted, so a busy workspace, or one member posting 60 events a minute, stopped sharing for everyone for good.
- **The checkpoint:** verified entries beyond a kept tail (`RELAY_TAIL`: 2,000 trigger a fold that keeps the newest 1,000) are folded into a local checkpoint (`FoldBase` in `lib/relay/state.ts`): shared objects with their comments and approvals, threads with their replies and tasks, and the rejections. The folded entries are then dropped. `fold`, `foldThreads` and `ensureOperation` start from the checkpoint; `relayObjects` and `relayThreads` read a saved state.
- **Epoch base checks:** an epoch whose base lies inside the checkpoint was checked before it was folded. A new epoch whose base is older than the checkpoint is refused.
- **Key epochs are all kept.** A pack version can be signed under an old epoch, and thread holders read its signed pack wraps. Only an administrator can rotate, so the bound is raised from 256 to 4,096.
- **A long catch-up** keeps what it verified and continues at the next sync, instead of failing with "exceeded its history".

**Devices join after a Pricing Owner rotation (R22).** A joiner walks the chain from the newest Owner-signed epoch that matches the typed code, checking each later epoch against the one before it, so only an Owner can have changed the grid. The code shown to joiners is that Owner's.

**New devices are confirmed by code at rotation (R19).** A device whose exact keys the last signed epoch carries, and this device, are confirmed automatically. A new or changed device's code is not shown to the administrator, who types it from that device.

**Quiet syncs stop saving (flaw 3.4).** A sync that applied nothing saves at most every 15 minutes (`QUIET_SAVE_MS`), not every minute. Each save is an audited, whole-vault write.

**Shared items count against capacity (flaw 3.9).** A shared items pack that would pass the vault's product cap is refused, and the whole write rolls back. On relay receipt, that pack counts as failed and the other packs still apply.

**Deleted workspaces (R20).** Migration `20261128120000_review_r2_deleted_workspaces.sql` adds a check that the workspace is not deleted to `relay_storage_allowed` and `relay_channel_allowed`. It comes with a pgTAP check: plan 156 fresh and 159 in restore mode. **The migration is pending** until CI and a user-run Restore Drill pass, and is then locked.

**Rate limits (R21).**
- `/api/relay`: 240 reads and 120 writes a minute per person.
- `/api/licence`: 60 checks per 10 minutes per person.
- Without Upstash, these fall back to a per-instance counter; sign-in, invites and workspaces still fail closed without it.
- The relay read lock is kept, because it gives each page a consistent head and event list.

**Privacy gates.** Both gates scan every WebSocket frame the page reports and record the count (R27).

**Sharing screens in plain words.**
- "Device code" replaces "fingerprint", and "publish new keys" replaces "rotate".
- There are no epochs, verification heads or packs in what people read.
- Account pages in the sidebar say they open outside the vault, which locks it.
- An invited colleague (not the workspace Owner, with sharing on) is told their team's data arrives through sharing, and their own name is offered as the vault's Pricing Owner.

## Checks run locally (not CI evidence)

- **New tests:**
  - `tests/relay-checkpoint.test.ts`:
    - a compacted log shows exactly what the full log shows;
    - objects and threads from before the checkpoint stay usable;
    - rotations after compaction verify, and every epoch is kept;
    - quiet syncs do not save.
  - `tests/relay-join.test.ts`: a device joins after a Pricing Owner rotation, and a wrong code is refused.
  - `tests/sharing-capacity.test.ts`: an items pack over the cap is refused and writes nothing.
- **Every relay test passes.**
- **Results:** see "Results" below.

## Not done or not verified

- **Bounds:** the checkpoint is tested with small thresholds. A real 10,000-event log was not replayed (the server's per-device rate limit makes that a 3-hour test).
- **Gate coverage:** a gate pass with `RELAY_ENABLED` off is not in CI. The WebSocket scan may not see the worker's doorbell socket.
- **Limits:** database connections are not capped globally; relay chunk retention and the tenant purge still wait for a decision.
- **Still open:** R23 to R26.
- **Language:** native-language review of the new Spanish and French strings has not been done.

## Results

Run locally on 26 November 2026, not CI evidence:
- Migration lock check: 17 applied and 1 pending, matching `migrations.lock`.
- JS 80 of 80. TypeScript 412 of 412 (411 plus `tests/i18n.test.ts`, rerun after two keys the new screens no longer use were removed). `tsc --noEmit` is clean.
- Chrome vault gate in lab mode, on a production build: passed, including the required-sections floor.
- Lab relay gate: 18 checks passed. The Owner typed the manager's and the rep's device codes, read from their own devices; the codes were never shown on the Owner's screen.
- pgTAP, including the new deleted-workspace check and plans 156 and 159: CI only. There is no local Supabase here.
