# Team sharing S4b: small deltas — verification

Built by Claude Code on 25 November 2026 from `SHARING_DESIGN.md` section 5 ("Snapshots and deltas"). There is no Supabase migration: the relay already carried `kind` (`snapshot` or `delta`) and `baseVersion` on every pack version since S2. The local vault moves to **v25 / 69 tables**.

## What it does

**Publishing** (`publishAll` in `lib/vault/service.ts`, `lib/sharing/delta.ts`):
- **After a key rotation,** every pack goes out as a full snapshot, under the new keys.
- **Otherwise only packs that changed are sent.** A change to cost alone therefore reaches no device without cost: there is no new version, no chunk and no doorbell ring on the packs it holds.
- **A changed pack goes out as a delta:** whole rows added or changed, plus the keys removed; never field-level diffs. It goes as a snapshot instead in these cases:
  - there is no earlier publish from this device;
  - a week has passed since the last snapshot;
  - there have been 50 deltas since the last snapshot;
  - more than a quarter of the pack changed;
  - the server's head is not exactly the version and hash the delta was made against, because another publisher went in between (checked in `RelaySession.packPublish`).
- **When nothing changed at all,** Publish now sends a fresh full copy of every pack. This is how a seat whose copy failed recovers. The message says "Nothing had changed, so a fresh full copy … was sent."
- **The publisher's record** (`shared_published`, and its last published rows in `shared_pack_rows`) is written only after the version row and all of its chunks are on the server. A crash in between leaves the server ahead of the record, so the next publish finds the head moved and sends a snapshot.

**The delta format** (`checkDelta`):
- It is `{kind, base, result, parts:[{part, columns, rows, removed}]}`, with exact keys only.
- `result` is the SHA-256 of the full pack after applying the delta. It is order-independent, because it is computed over sorted JSON rows.
- The rows pass the same decision 16 scan as a full pack (`scanPack`), so a planted cost column is refused.
- Removed keys must have exactly the key's arity and only short text or null values.
- It is sealed, chunked and encrypted exactly like a snapshot. The manifest's row count is rows plus removals. `openDelta` and `openPack` each refuse the other kind.

**Receiving** (`RelaySession.packReceive`, `receivePack` and `receiveAll` in the service):
- **The walk.** The session walks the pack's chain from what this vault last applied, verifying every version as before. It returns the newest snapshot this device can open (if there is one after that point) and the contiguous chain of deltas after it. The walk stops at the first version it cannot open, or at the first delta whose base is not the version before it.
- **Rebuilding.** The vault rebuilds the full pack:
  - from that snapshot;
  - or, when the chain starts with a delta, from its own relay copy, but only when `shared_books` says this vault holds exactly that base from the relay.
- **The digest check.** Every delta's `result` digest must match the rebuilt rows, or nothing is applied.
- **Applying.** The rebuilt pack is applied with the same `applyPack` as a snapshot, so What changed, the read-only lock and the banner behave as before. The rows are stored in `shared_pack_rows` in the same transaction.
- **Recording.** The relay state records the new head only after that write commits (`packMarkApplied`).
- **Recovery** (`packReset`). A missing or mismatched base, or a digest that does not match, makes the walk start again once from the newest snapshot. This covers:
  - a vault upgraded from v24;
  - a file import in between;
  - a role change;
  - lost rows;
  - a crash after the vault's write but before the relay state was saved.
- **A seat that lost cost** (its role changed under the signed grid, so it no longer holds the key) deletes any cost rows it kept as a delta base.

**Vault v25** (`V25_SQL` in `lib/vault/schema.ts`):
- `shared_pack_rows(pack, part, row_key, row_json)`: what this vault last published or applied, one whole row per key. It holds cost rows only on a seat that may see cost.
- `shared_published(pack, version, hash, snapshot_version, snapshot_at, deltas_since ≥ 0)`: the publisher's own record.
- No read command, screen or export selects from `shared_pack_rows`, and a source-scan test enforces this.

**What deltas save:** bandwidth and Storage only. The receiving device still rebuilds and applies the whole pack locally. Teams with two publishers who alternate always get snapshots. Compaction (removing earlier deltas and their chunks once a snapshot supersedes them) is **not built**.

## Checks run locally (not CI evidence)

- `tests/sharing-delta.test.ts` (7 tests):
  - **diff and apply:**
    - changed, added and removed rows;
    - multi-part packs;
    - order-independent digest;
    - wrong base and wrong digest refused;
  - **format:**
    - extra keys, bad base, wrong arity, oversized key and a planted cost column refused;
    - seal and open round-trip;
    - a delta never opens as a full pack, nor the reverse;
  - **snapshot rules:** rotation, no earlier publish, 7 days, 50 deltas, more than 25%;
  - **the chain through real relay sessions in PGlite:**
    - a seat holding version 1 fetches only the delta;
    - a new device gets the snapshot plus the delta;
    - an unmarked receive returns the same steps;
    - a moved head forces a snapshot;
    - `packReset` restarts from the newest snapshot;
  - **end to end through two vaults:**
    - one price of eight changing publishes a one-row book delta and nothing else;
    - a cost-only change publishes only cost, and the rep's copy is unchanged;
    - nothing changed sends a fresh copy;
    - a crash replay is harmless;
    - a missing base and a file import in between both recover;
    - a seat that lost cost drops its cost rows;
  - **v25 upgrade:** exactly two new tables, and `deltas_since` cannot go negative;
  - **source scan:** only the delta code reads `shared_pack_rows`.
- `tests/relay-storage.test.ts` updated for the new receive shape. Schema pins were moved from v24 / 67 tables to v25 / 69 in `vault`, `sharing`, `bench`, `notes`, `reports`, `supplier-claims` and `rebate-local`.
- **Suites:** JS 80 and TypeScript 393 tests pass. `tsc --noEmit` is clean.
- **Relay browser gate** (lab mode, Chrome): **17 checks passed**. `liveUpdate` now makes a real change before Publish now:
  - the Owner saves one guardrail;
  - Publish now reports "Published 1 kind of data to the team.";
  - the Owner uploaded chunks only for `guards`, and the rep fetched chunks only for `guards`;
  - the rep's guardrails version went up through the lab poll (48 s), with the book version unchanged.
- **Lab build note:** the lab relay gate needs `NEXT_PUBLIC_SUPABASE_URL` (for example `http://127.0.0.1:54321`) set at build and start, as `docs/evidence/SHARING_S3_VERIFICATION.md` already notes. Without it, the worker's `connect-src` blocks the Storage stand-in, and Start sharing fails with "could not reach the server".

## CI

Pending: the PR's CI run is recorded here once it passes.

## Not verified

- Delta sizes and timings on a real large pack. The 25% rule and the weekly snapshot are design defaults, not measured optima.
- Compaction of superseded deltas and chunks (not built).
- Two publishers editing at once beyond the head check (each falls back to a snapshot; tested only in the session test).
