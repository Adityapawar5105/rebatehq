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

- **The relay read lock is kept.** The review proposed reading without it. The lock gives each page a consistent head and event list, so the per-person rate limits are the mitigation instead.
- **No lower per-device event quota for non-publishers.** It needs a change to the relay insert trigger, so a migration. The checkpoint's text budget (`trimBase`) bounds what each device keeps instead.
- **The activity feed** (`service.ts`, `activityFeed`) reads only the kept tail, so very old activity drops off it after a checkpoint.
- **The invited-colleague note** shows only when `RELAY_ENABLED` is on, and the lab gates do not exercise it.
- **`RELAY_LIMITS.events` and `RELAY_LIMITS.epochs`** in `lib/relay/protocol.ts` still say 10,000 and 256. Nothing enforces them any more.
- **A relay pack refused for capacity** is retried after an hour, and its reason is shown on a manual sync. The relay path of this check is not covered by a test; the hand-off file path is.

- **Bounds:** the checkpoint is tested with small thresholds. A real 10,000-event log was not replayed (the server's per-device rate limit makes that a 3-hour test).
- **Gate coverage:** a gate pass with `RELAY_ENABLED` off is not in CI. The WebSocket scan may not see the worker's doorbell socket.
- **Limits:** database connections are not capped globally; relay chunk retention and the tenant purge still wait for a decision.
- **Still open:** R23 to R26.
- **Language:** native-language review of the new Spanish and French strings has not been done.

## Results

Run locally on 26 November 2026, not CI evidence:
- Migration lock check before the lock: 17 applied and 1 pending, matching `migrations.lock`.
- JS 80 of 80 and TypeScript 414 of 414 on the final code (with the approval and budget tests). `tsc --noEmit` is clean.
- Chrome vault gate in lab mode, on a production build: passed, including the required-sections floor.
- Lab relay gate: 18 checks passed. The Owner typed the manager's and the rep's device codes, read from their own devices; the codes were never shown on the Owner's screen.
- pgTAP, including the new deleted-workspace check and plans 156 and 159: CI only. There is no local Supabase here.

## CI and the Restore Drill

- **[CI #279](https://github.com/Adityapawar5105/rebatehq/actions/runs/45844379547)** passed on `56f4fac` (PR #48), 26 November 2026. All four jobs passed:
  - unit tests, audit and build;
  - database tests with the new deleted-workspace pgTAP check (156 checks);
  - the authenticated Chromium privacy and relay gates, against real Supabase, with the device-code step and the rate limits;
  - the Firefox lab gate;
  - `verify`.
- PR #48 merged as `aed1b13`, and [CI #280](https://github.com/Adityapawar5105/rebatehq/actions/runs/45847465985) passed on `main` there.
- **The user-run [Restore Drill #28](https://github.com/Adityapawar5105/rebatehq/actions/runs/45854536136)** passed on `aed1b13`:
  - `1..159`, with the suite run twice and tenant row counts unchanged;
  - the licence, relay and benchmark hashes and the restore sentinel matched;
  - 15 tenant tables.
- **The migration is locked** in `migrations.lock`: 18 applied, 0 pending.
- **Staging** `rebatehq-staging` got this migration on 27 Nov 2026, with `supabase db push` after a dry run listing only it. It now lists all 18 migrations under their repository versions. Read-only checks confirmed:
  - both rules contain the deleted-workspace check;
  - each is a security definer with `search_path=public, pg_temp`;
  - execute is granted to `authenticated` only;
  - the security advisor reported no new finding.

## The rest of R2 (27 Nov 2026)

Built by Claude Code on branch `claude/review-r2-rest`.

**Lower event quota.** Migration `20261129120000_review_r2_relay_quotas.sql` replaces the relay insert trigger with two changes; the rest of the S2 body is unchanged (checked with a diff).
- A device whose person is not an Owner, Pricing Owner or the named Pricing Owner in the latest signed grid may send 20 events a minute and 2,000 a day. Publishers keep 60 a minute. A workspace without a signed grid keeps 60 for everyone.
- Keys of revoked devices no longer count toward the 1,000 device-key limit (R25). A lifetime bound of 10,000 keys still caps the table.
- `app/api/relay/route.ts` answers a quota refusal with 429 `LIMIT` instead of the rotation message.
- pgTAP: four new checks in `supabase/tests/sharing_s4.sql` (the 20th and 21st rep event in a minute, the 2,000th and 2,001st in a day, a publisher's 26th in a minute, a new key beside 1,000 revoked keys). Plans: 160 fresh, 163 restore.
- `tests/relay-quota.test.ts` runs the real trigger in PGlite through the session code: a rep's 21st event in a minute is refused, the Owner's 25 are accepted.
- PL/pgSQL note: a `CASE ... THEN` inside an `IF` condition ends the condition at its `THEN`, so the limit is computed into a variable first.

**R24, session cookies.** `lib/supabase/cookies.ts`: HttpOnly, Secure in production, 30 days, used by both server clients; a removal keeps `maxAge` 0 (`tests/auth-cookies.test.ts`).

**R26, failed uploads.** `putChunk` tries each chunk three times; `EXISTS` (Storage's duplicate answer) counts as uploaded; access and size refusals are not retried. A failed publish is retried by the background tick (1, 2, 4 ... minutes, up to an hour). The pack page returns server receive times and the server clock when asked (`times=1`; old clients do not ask and get the old shape), and the not-ready window uses them (`tests/relay-upload-retry.test.ts`: a receiver whose clock is an hour ahead still sees a just-received version as not ready; the old code called it lost). The background republish in `lib/vault/service.ts` has no automated test yet, so R26 is recorded as mitigated.

**R25, device limit warning.** The sharing panel shows a status line from 50 of the 60 devices, in en, es and fr (fr-CA uses fr).

**R27, relay-off pass.** CI restarts the same build with `RELAY_ENABLED=false` after the relay gate and runs `pnpm test:vault:privacy --browser=chromium --relay-off-only`. It first probes `/api/relay` signed out and requires 404 (a relay-on server answers 401), so it cannot pass against the wrong server; CI also waits for the relay-on server to release the port. It then fails on any `/api/relay`, Storage or Realtime request, any WebSocket, or the sharing set-up card on Home, over an import, the sharing pages and a 65-second wait.

**R23** is accepted and documented in `SECURITY_REVIEW.md`: moving the pack name into the sealed body would hide nothing a rep device does not already know.

**Local checks:** typecheck clean; the full JS and TS unit suites, including the full pgTAP SQL run in PGlite with assertion stubs (160 planned, 160 ran). Not CI evidence: the authenticated gates, the relay-off pass and real-Postgres pgTAP run in CI.

**Not done:** the independent security review (B5) is the owner's to commission. The migration waits for CI and the owner's Restore Drill, then a lock PR; it is not on staging.
