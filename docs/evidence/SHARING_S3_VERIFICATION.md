# Team sharing S3b (packs published and received through Supabase Storage): verification

25 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` sections 5 and 7. Built by Claude Code after the user chose Supabase Storage with direct downloads. Migration `20261126120000_sharing_s3_storage.sql` is **pending** until CI and the user's Restore Drill pass; then a lock PR follows.

## What it does

**Publishing.** The publisher is an Owner or Pricing Owner under the signed grid, with the pack key on this device.
- It publishes every built pack its device holds:
  - after each key rotation;
  - when **Publish now** is pressed (Settings › Team and roles › Who receives what).
- Each pack becomes:
  - a signed pack version on the relay (S2). Its manifest is encrypted under the pack key and lists the chunks, sizes and SHA-256 hashes;
  - encrypted chunks in the private `relay-packs` bucket, at `<tenant>/<pack>/<version id>/<n>`.
- Rows are gzipped and cut into chunks of at most 512 KiB, with at most 128 chunks per version.
- A pack holds at most 256 MiB uncompressed. Opening stops as soon as decompressed output passes that, so a hostile signed manifest cannot act as a gzip bomb in a receiving tab (found by the push security review).
- Each chunk is sealed with AES-GCM under a key derived (HKDF) from the pack key, the version id and the chunk number. The AAD binds the version, pack and chunk number (`lib/sharing/publish.ts`).

**Receiving.** A seat that is not a publisher receives after each sync or join. For each pack its device holds (cost packs only for roles with `cost`), it:
- verifies the signed chain;
- takes the newest snapshot it can read;
- fetches and checks every chunk against the manifest;
- applies the rows to the governed tables, tagged `shared:<pack>` as in S1, through the same `applyShared` path as the hand-off file.

If a pack fails its checks (a missing chunk after a restore or a half-finished publish, or changed bytes), it is skipped without touching the vault, and the others still apply. The person is then told to ask for a fresh publish (`share.receiveFailed`).

**Transport.** The worker asks `GET /api/relay?mode=token` for the person's own short-lived Supabase session token, never a service key, and calls Storage directly:
- uploads use `POST /storage/v1/object/relay-packs/…` without upsert;
- downloads use `GET /storage/v1/object/authenticated/relay-packs/…`.

The worker script's `connect-src` now allows the Supabase origin.

## The server side (pending migration)

**Bucket.** `relay-packs`:
- private;
- `file_size_limit` 524400 bytes (one sealed chunk);
- `application/octet-stream` only.

**Policies.** Two policies on `storage.objects`, both `TO authenticated`: `relay_packs_read` (SELECT) and `relay_packs_write` (INSERT). There is no UPDATE or DELETE policy, so a chunk can never be replaced or removed by a user.

**`rebatehq_storage.relay_storage_allowed(name, write)`.** A SECURITY DEFINER function with a fixed `search_path`.
- **Path shape.** It requires `uuid/pack/uuid/0..127`.
- **Who.** An active member with a seat and a Professional or Scale licence.
- **Write.** Only the user who signed that pack version, from an active device, in the latest epoch, within an hour of signing.
- **Read.** The version exists, and the user's active device holds a wrap for that pack in the latest epoch. A device without the cost pack therefore cannot fetch a cost chunk (decision 16).

**Why its own schema.** The function's schema `rebatehq_storage` holds nothing else. Only `authenticated` has USAGE and EXECUTE.
- The function ACL registry forbids granting any public function to `authenticated`, because the Data API would expose it as an RPC; S3 now hands that token to the worker.
- `rebatehq_private` is closed to `authenticated` by the 5B checks.
- So the rule sits in a schema the Data API does not expose. pgTAP S3 check 1 proves it is the only object there, with the expected ACLs.

**Restore.**
- The dump allowlist adds `rebatehq_storage`.
- Equivalence compares its schema ACL and its function ACL.
- Dumps exclude the Supabase `storage` schema, so the drill re-applies the bucket and policies with `scripts/restore-storage-objects.sql` before pgTAP. A unit test keeps that file identical to the migration.
- Chunks themselves are not restored. A publisher presses **Publish now** after a restore.

**CI.** CI's local Supabase now starts `storage-api` (in CI and the Restore Drill).

## Tests and checks run locally (not CI evidence)

**Migration and schema checks:**
- `node scripts/check-migrations-lock.mjs`: 15 applied, 1 pending, hashes match.
- `node scripts/check-schema.mjs`: passed.

**Unit tests:**
- `node --test tests/*.test.js`: **80 pass**. New: `tests/restore-storage-objects.test.js`. The restore scope expectations are updated, and the PGlite harnesses load `tests/helpers/storage-stub.sql`.
- `tsx --test tests/*.test.ts`: **374 pass**. New tests:
  - `tests/sharing-publish.test.ts`: seal and open, tamper.
  - `tests/relay-storage.test.ts`: the Storage rule run as `authenticated`; sessions publishing and receiving through a chunk store that enforces it. A rep gets book prices and is refused a cost chunk; nobody but the signer adds a chunk; nothing replaces one; a changed byte fails; a rotation re-publishes.

**pgTAP.** The plan is **152** fresh and **155** restore, with three S3 checks in `supabase/tests/sharing_s3.sql`. Here these ran only in PGlite with assertion stubs; CI runs them on real Postgres.

**Build.** `node scripts/build-spike.mjs` and `next build --webpack` succeeded.

**Relay browser gate.** `scripts/test-relay-browser.mjs --browser=chrome` ran in lab mode against the local PGlite transport with a Storage stand-in that applies the same rule: **15 checks passed**.
- The new check is `packsPublishedAndReceived`.
- Starting sharing published every pack.
- The Sales Manager fetched cost chunks; the rep fetched book prices and never requested a cost chunk.
- Storage chunk requests were the only external requests.
- The lab run needs `NEXT_PUBLIC_SUPABASE_URL` set at build time (a placeholder such as `http://127.0.0.1:54321` is enough), so the worker's `connect-src` allows the Storage origin.

## Not done in S3b (still to come)

- **Not yet built:**
  - read-only governed screens and the "Shared by" banner on receiving seats;
  - "what changed since your version";
  - roll back;
  - the 7-day staleness warning.
- **Deltas and compaction.** Every publish is a full snapshot, and old chunks are not removed. No per-workspace Storage cap is enforced beyond 64 MiB per version and the bucket's object size.
- **Realtime (S4).** Receiving happens on sync and join; there is no live signal yet.
- **Unverified until CI:** real Supabase Storage (the authenticated CI relay gate) and the Restore Drill with the re-apply step.
