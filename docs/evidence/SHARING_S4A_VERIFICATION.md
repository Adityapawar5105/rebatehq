# Team sharing S4a (live updates: the Realtime doorbell and the minute poll): verification

25 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` sections 5 and 7. Built by Claude Code. Migration `20261127120000_sharing_s4_doorbell.sql` is **pending** until CI and the user's Restore Drill pass; then a lock PR follows. Small deltas are S4b.

## What it does

**The minute poll guarantees delivery.**
- **When it runs:** on a device that has joined sharing, the vault worker's 60-second tick syncs while the app is open, unlocked and licensed to write (`relayBackground`). A publisher syncs its inbox; a receiving seat also applies newer packs.
- **How it runs:**
  - in the worker's one queue, so it never races a rotate or a publish;
  - in quiet mode, so it never counts as the person being active and never shows an error;
  - when it applied something, it tells the page (`relay` event), and the page refreshes its status and the "Shared by" banner.

**The Realtime doorbell makes delivery sooner.**
- **Channels:** the worker joins one private channel per pack its device holds, `pack:<tenant>:<pack>`, with the person's own session token, cached until shortly before it expires.
- **Rings:** a new pack version rings its channel with the version number only. Rings within 1.5 s become one sync.
- **Polling while joined:** while a channel is joined, the poll slows to every 10 minutes.
- **Rejoining:** a new epoch rejoins, because the server checks the key at join.
- **Locking** stops the doorbell.
- **Traffic:** the only traffic is one WebSocket (`lib/relay/doorbell.ts`, `RealtimeClient` from `@supabase/supabase-js`, so no new dependency), with no long-poll fallback.

**Not ready yet is not a failure.**
- **Why it happens:** the version row is written before its chunks, so a ring can arrive first.
- **Recent versions:** a chunk missing within 15 minutes of signing is "not ready". It is skipped quietly, the pack head is left where it was, and the next ring or poll receives it.
- **Older versions:** a gap older than 15 minutes is still reported as a failure.

**Server (pending migration):**
- **Doorbell trigger.** `public.relay_pack_doorbell()` is an AFTER INSERT trigger on `relay_pack_version`.
  - It runs as SECURITY DEFINER, because the app role cannot use the Supabase-managed `realtime` schema.
  - It sends `{"v": version}` on the pack's private channel.
  - It swallows every error, so a doorbell can never block a relay write. Supabase's own `realtime.send` only warns, too.
- **Join rule.** `rebatehq_storage.relay_channel_allowed(topic)` sits beside the Storage rule, in the schema the Data API does not expose, for `authenticated` only. It lets an active, seated member on Professional or Scale join a pack channel only when their active device holds that pack's wrap in the latest epoch. A rep device can never join a cost channel, so it is not even told that cost changed (decision 16).
- **Policy.** One SELECT policy on `realtime.messages`, `relay_pack_doorbell_read`. It is created only where Realtime has created the table, so without it joins fail closed and the poll delivers. There is no INSERT policy, so no client can broadcast.
- **Restore.** `scripts/restore-storage-objects.sql` re-applies the policy, since dumps exclude `realtime`.
- **pgTAP** plans **155** fresh and **158** restore checks: three in `supabase/tests/sharing_s4.sql` (receive-only, content-free payload, and the join rule as `authenticated`). S3 check 1 now expects both rules in `rebatehq_storage`.
- **CSP.** The worker's `connect-src` adds the Supabase origin as `ws:` or `wss:`, by the same scheme as the URL.

**Checked on hosted staging before writing** (read-only queries):
- `realtime.send(jsonb,text,text,boolean)` is SECURITY INVOKER and turns its errors into warnings.
- `realtime.messages` is partitioned, owned by `supabase_realtime_admin`, and has row-level security on with no policies.
- `authenticated` has INSERT, SELECT and UPDATE grants but no policy, so it can do nothing.
- `rebatehq_app` has no usage on `realtime`.

## Checks run locally (not CI evidence)

**Unit tests:**
- `tests/relay-storage.test.ts`, new test: a version whose chunks are still uploading is not ready, then received once they land; a gap older than 15 minutes is a failure.
- `tests/relay-background.test.ts` (2 tests):
  - only an unlocked, writable, joined, non-Starter device syncs;
  - the first poll runs, a second within the minute waits, and a ring runs at once;
  - background work is quiet, a failing network is swallowed, and locking stops it;
  - the worker, page, CSP and doorbell are wired as described.
- `tests/restore-storage-objects.test.js`: the re-apply script matches all three policies and runs twice.
- The full pgTAP SQL, with the S4 checks, executes in PGlite with Realtime stand-ins (`tests/helpers/storage-stub.sql`).

**Relay browser gate** (lab mode, Chrome): **17 checks passed**. The new check, `liveUpdate`: the Owner presses Publish now, and the rep's "Shared by" banner shows the new book version with nobody pressing Sync. It took 45 s through the lab poll, since the lab has no Realtime server. In CI's authenticated gate against real Supabase, the check requires the doorbell to deliver within 45 s.

**Suites:** JS 80 and TypeScript 386 tests pass, and the lab vault gate passed in Chrome. The worker bundle grew from 1,385,014 to 1,446,550 bytes (the Realtime client).

## Not done yet
- **S4b:** small deltas.
- **The workspace events channel** (approvals, comments) is left for S5. Until then those arrive on the poll.
- **Unverified until CI and the drill:**
  - Realtime against real Supabase (local CI stack);
  - the policy being created there;
  - the re-apply step in the Restore Drill;
  - a rolled-back dry run on hosted staging before the lock.
