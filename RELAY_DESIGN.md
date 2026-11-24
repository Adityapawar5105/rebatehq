# Chunk 7A — ciphertext-only collaboration relay

5 November 2026. Design written before implementation. Governing blueprint v2.2;
7A only. No Quote Desk, ERP integration or rebate calculation UI is built here.
The relay carries an immutable shared summary/reference, comments and approval
decisions that 7B and 7D can use. Existing Phase 1 Pricing Owner approval before
ERP export stays unchanged.

## Trust and confidentiality

Business content is prepared, encrypted, signed, decrypted and validated in the
vault worker. The UI exchanges typed commands/views with that worker, never
SQL or private keys. The server stores opaque encrypted content and public
routing/identity metadata. Its authority is membership/licence/device access;
it cannot evaluate an amount or make a business approval.

The HTTPS application origin, deployed JavaScript, identity/control plane,
browser and OS remain trusted as in the 6B threat model. Signatures defend
against forged or altered relay records; they do not make a compromised app
deployment safe. A legitimate participant can intentionally disclose information.
No encrypted protocol can stop a malicious client putting plaintext in an opaque
field. The privacy gate proves the actual application flow, not that impossibility.

Items are **workspace-wide**, including all approved active relay devices.
Recipients/mentions route inbox attention, not cryptographic private messages.
The workspace key is not a way to hide costs from another keyholder. Shared
summaries have a restricted schema (reference, title, amount/currency, approval
policy); they do not automatically include invoices, costs or a complete vault.

## Keys and enrolment

- A device generates separate ECDH P-256 and ECDSA P-256/SHA-256 keypairs with
  WebCrypto in the worker. Its public keys have a SHA-256 fingerprint. A signed
  registration binds both keys to the workspace, authenticated user and existing
  approved licence-device UUID. Registrations are immutable; replacement keys
  require a new device identity and owner approval, not silent overwriting.
- Private JWK material exists only inside the local in-memory database and its
  existing encrypted snapshot/backup. Runtime keys are imported nonextractable;
  no private JWK or vault passphrase enters a network request. The local schema
  advances forward from v8; the committed v1 snapshot must still open.
- Each key epoch generates a fresh random 256-bit workspace data key. It is
  wrapped separately for every approved active device using ephemeral ECDH,
  HKDF-SHA-256 and AES-256-GCM with a fresh 96-bit IV. The wrapping context binds
  workspace, epoch, sender and recipient devices/users. Epoch records include
  the complete ordered device roster, roles and wrapped-key hashes, signed by
  an authorised administrator device. Ephemeral private keys are discarded.
- Trust bootstrap is explicit. The first administrator trusts its own generated
  key; before adding devices it confirms their fingerprints. A joining member
  must verify an administrator fingerprint through a separate trusted channel
  before accepting a workspace key. The server's key directory alone is not
  sufficient proof. Subsequent epochs must continue the pinned signed chain.
- A new device first registers its public keys. An existing authorised
  administrator verifies its fingerprint and rotates to a new epoch including
  it. New members receive future items; historical keys are not silently shared.
  An existing device retains keys for the history it already received.
- Removal/revocation invalidates the eligible-device roster. The server blocks
  further event appends under the stale epoch. An authorised remaining admin
  creates a new key and wraps it only for current active seated members/devices.
  Removed devices cannot decrypt the new epoch. Previously disclosed content
  and keys cannot be recalled or wiped.
- Lost device: revoke it through existing device controls; approve a replacement,
  register its fresh keys and ask a remaining trusted administrator to rotate.
  Encrypted local backup may recover keys/history but is not server recovery.
  If every trusted key/backup is lost, historical relay content is unrecoverable.
  There is no passphrase escrow, server master decryption key or silent trust reset.

## Signed format, ordering and failures

Versioned, canonical arrays/objects have an explicit field order; money and
sequence/epoch counters are decimal strings. Public keys use uncompressed P-256
points, signatures fixed-width ECDSA bytes, hashes SHA-256. The same canonical
encoding is used by the worker and the server's public-signature checks.

An event binds: protocol version, workspace/epoch, random message/object UUIDs,
global workspace sequence, previous event hash, sender user/device, object kind,
recipient/mention UUIDs, client timestamp, key-derivation context, IV and
ciphertext. AES-GCM authenticates the header; ECDSA signs header + ciphertext.
The event hash also includes the signature. A distinct message subkey is derived
with HKDF from the epoch key and message UUID, with a fresh 96-bit IV. Wrapped
keys use separate domain strings from message encryption and signing.

Server appends compare sequence/previous hash under a per-workspace transaction
lock. Conflicting concurrent sends retain a pending item; sync and explicitly
discard/recreate it rather than silently re-signing an approval against new history.
Epoch rotation uses the same lock. Message IDs are unique; an identical retry
returns the existing record and a different record with the same ID is rejected.
The worker keeps pinned epoch/event heads, known keys and an outbox inside the
encrypted vault. It persists pending sends before transport, verifies received
records before applying them, and advances the cursor only with an encrypted
save. A lost HTTP response cannot apply an approval or comment twice.

Wrong key, invalid signature/tag, changed metadata, an unknown sender, unexpected
epoch, skipped/reordered sequence, replayed message or fork from a known head
fails closed. No unverified item is shown as approved. An invalid record signature
blocks synchronization. If the record signature is valid but its payload is
undecryptable/semantically invalid, quarantine that operation with a visible
warning and advance only the authenticated hash chain; it can never approve
anything. This prevents an authorised bad sender from poisoning all later items.
Inbox reads are paged,
bounded and performed in the worker, with explicit error/retry state.

**Limit:** a relay can withhold a tail or show different valid histories to devices
that have never compared heads. No signature can prove that an unseen message
exists. Known-head rollback, observed gaps and divergent heads are detectable;
global completeness/fork transparency requires external comparison. The UI
exposes the current verification head for comparison. No unconditional claim of
non-repudiation, global ordering against a Byzantine server or immediate offline
revocation is made. Identity/control membership is checked fresh online.

## Approval and comment semantics

The encrypted share is immutable and has a random object UUID; a changed quote
or price change is a new revision/share, not an overwrite. Content includes its
reference, amount in integer minor units, currency and a preset. Presets have at
most two levels: a standard amount threshold selects one or two; a conservative
preset always requires two. The exact thresholds/formula are visible on device.

The request names distinct approvers from the verified administrator roster:
first the designated Pricing Owner, then a manager when the preset requires it.
The requester cannot approve their own request; level two cannot precede level
one. Decisions bind the immutable request/subject hashes and level. Every
recipient independently recomputes the threshold and state transition. Rejection
is final for that request. A quote reference alone does not prove the sender's
asserted amount; 7B will attach and validate the actual local quote revision.
Server routes notifications by UUID only and never evaluates the threshold.

Comments target a shared quote/price-change/rebate reference. Text and displayed
mention tokens are encrypted; notification user UUIDs are the only public mention
metadata. Render all content as text. The inbox is in-app; no live email, push
service or external messages are sent by this chunk.

## Server inventory and boundaries

One new migration creates four append-only tenant tables:

1. `relay_device_key`: approved device/user IDs, public key points and possession
   proof. Public cryptographic identity material, no private keys.
2. `relay_epoch`: signed epoch number/previous hash, signer, ordered device/role
   roster and public metadata. No workspace key in plaintext.
3. `relay_key_wrap`: recipient device, ephemeral public point, IV and encrypted
   32-byte workspace key, bound into the signed epoch manifest.
4. `relay_event`: signed/hash-linked ciphertext and routing metadata.

All have indexed non-null tenant IDs, composite tenant foreign keys, ENABLE +
FORCE RLS, exact ACLs, append-only app privileges and audit coverage. Privileged
validation helpers pin search_path; every new function has one exact registry
entry. New table writes require fresh active Professional/Scale licensing,
membership, seat and approved device; epoch publication also requires admin role.
No legacy quote/approval/share-link table is reused or altered.

The server sees tenant, authenticated user/device, public keys, epoch/sequence and
hashes, random message/object IDs, object kind, recipient/mention UUIDs, byte size
and timestamps. It can infer traffic patterns and membership; the relay is not
anonymous. It sees no subject/reference text, comment, decision, threshold,
amount, cost, price, invoice, rule or margin. Audit contains operation/IDs only;
it does not duplicate payloads, wrapped keys or business text.

One same-origin `/api/relay` boundary accepts strict versioned metadata and
binary/base64 fields, verifies signatures with public keys, and uses the existing
restricted DB transaction/signed actor context. No service key. Bounded request,
page, content and per-workspace/device quotas use fixed errors without content.
Initial caps: 16 KiB encrypted message, 10,000 events/16 MiB ciphertext per
workspace, 60 active devices, bounded epochs/registrations and append rate.
No automatic retention pruning or silent deletion. All relay/network work remains
in the worker; page CSP is not loosened to external hosts.

## Verification and release gates

Crypto tests cover valid exchange, wrong key, modified wrap/signature/content,
scope substitution, replay, ordering, self/premature approval and removal/rotation.
SQL tests use explicit fresh fixtures, positive controls, actual RLS denials,
exact ACLs, tier/device restrictions, audit and repeated fresh/populated runs.
The table minimum rises from 20 to 24; restore inventory, referenced auth IDs,
seed, content comparison and every script called by the drill must include them.

Authenticated CI uses real local Supabase sessions for multiple members and a
share → request → decide → comment/inbox round trip through the real API. Inspect
every request URL/header/body and every column of all four server tables for
unique private markers and plaintext amounts; also inspect audit rows created by
the round trip. A deliberately unencrypted negative probe must trip the scanner.
Chrome and Edge local runs are separate headless evidence, not hosted/manual proof.

Locked SQL and applied lock entries stay unchanged. Only the new pending lock
entry may be appended under MIGRATION_RULES.md; it stays pending until green CI
and a **user-run** Restore Drill both prove it. Do not dispatch that drill on the
user's behalf or lock the migration early. Independent review, hosted operation
and customer/pilot validation remain unverified. No later chunk starts here.

## Later change: team sharing (24 November 2026)

Team sharing (`SHARING_DESIGN.md`, blueprint section 22 item 38) changes this design in four places. They take effect with the sharing migration in release S2. Until then, everything above stays as built.

- **Epoch format 2.**
  - An epoch also carries the signed role table and sharing grid.
  - It carries one wrapped key per data pack, for the devices ticked for that pack.
  - Format 1 epochs stay valid and are read as before.
  - The sentence above that the workspace key "is not a way to hide costs from another keyholder" stays true of the workspace key. Cost is hidden by pack keys, which a role without the `cost` capability never receives.
- **Bulk data leaves the event table.**
  - Encrypted price-book chunks go to a private Supabase Storage bucket.
  - A `pack` event carries only the signed manifest.
  - The 16 KiB message cap stays.
- **Caps become rolling.**
  - Events older than the latest snapshot of every pack can be compacted, keeping the hash-chain head and a signed checkpoint.
  - The 10,000-event and 16 MiB limits stop being lifetime limits.
  - Storage is capped per workspace by tier.
- **A live signal.**
  - A content-free Realtime broadcast ("event n") goes out on a private channel per pack.
  - Polling the same-origin route every 60 seconds is the fallback.
