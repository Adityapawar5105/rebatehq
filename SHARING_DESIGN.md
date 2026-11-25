# Team data sharing: design (roadmap 10.1, revised for 10.2)

- **21 November 2026:** first version, a design only.
- **24 November 2026:** revised after the product owner's decisions of 22 November:
  - D1 is option A, as section 3 describes it, built on Supabase;
  - this design is approved (roadmap 10.2);
  - D18 keeps the cost lock.

  Blueprint section 22, item 38 records them. This revision replaces the first version's sections 4 to 6. What changed, and why, is in section 11.

**Status:** nothing here is built yet, apart from the comments and approvals relay (chunk 7A, `RELAY_DESIGN.md`), which exists and is off by default. Each release in section 9 is its own pull request, with tests and an evidence file in `docs/evidence/`.

## 1. The problem

Each seat has its own private vault.
- The vault folder and its encryption header carry the person's own sign-in ID (`lib/vault/storage.ts`, `lib/vault/crypto.ts`).
- A colleague cannot open another person's vault, even with its passphrase and a backup file.

So nothing a Pricing Owner approves reaches anyone else:
- prices;
- guardrails;
- the item master;
- customer tiers;
- rules.

The relay carries only small summaries: a reference, a title, an amount, comments and approvals.

There are also three role systems with no mapping between them (audit I-1):

| Where | Roles |
|---|---|
| Server membership | owner, manager, analyst, rep |
| Relay epoch records | the same four |
| Vault (`ROLE_IDS`) | owner, pricing_owner, pricing_manager, sales_manager, sales_rep, accountant, admin |

## 2. What must stay true

1. **The server holds ciphertext only.**
   - No price, cost, SKU, customer or invoice value reaches the server, its storage or its logs in readable form.
   - The relay privacy scanner and the relay gate are extended to every new object, blob and channel message.
2. **Decision 16.**
   - A role without the `cost` capability never receives cost, margin, or anything cost can be worked out from.
   - "Never receives" is literal: that device never holds a key that opens a cost pack.
   - Hiding a column on screen is not enough.
   - This holds for full copies, live updates and live signals alike.
3. **One writer for governed data.**
   - Guardrails, rules and approved prices change only through the existing Pricing Owner approval.
   - Sharing distributes the approved result. It is not a second way to change a price.
4. **No escrow.**
   - There is no server master key, no passphrase recovery and no silent trust reset.
   - A lost Owner is covered by a second approved device or an encrypted backup (the recovery kit, S2).
5. **Raw invoices stay where they were imported.**
   - Sales lines, purchases and AR aging are never shared.
   - Sharing published results to cost roles (decision D17, option 2) is a later pack.

## 3. Packs and the sharing grid

Shared data is cut into **packs**. Each pack is encrypted once, under its own key. The Owner decides with tick boxes which roles, or which people, receive each pack.

### 3.1 Packs

The **Cost** column marks a pack that contains cost or can reveal it.

| Pack id | Contents (vault tables) | Cost |
|---|---|---|
| `items` | `products` without `current_cost`: SKU, description, category, unit, list price, barcode (row notes stay on the device that wrote them) | no |
| `customers` | `customers`: ID, name, tier, branch, region, payment terms (notes stay local) | no |
| `book` | `price_matrix` rows with no customer (book prices by product, category, tier and quantity break) | no |
| `contracts` | `price_matrix` rows for one customer (contract prices) | no |
| `guards` | `price_guardrails`: start, target and floor per tier and category, **except** floors flagged "based on cost" | no |
| `cost` | `products.current_cost`, `vendor_costs`, `cost_basis_settings` | **yes** |
| `cost_floors` | guardrail floors flagged "based on cost" | **yes** |
| `supplier` | supplier terms, rebate agreements and tiers, supplier claims | **yes** |
| `rules` | rules, revisions, previews and run history | **yes** |
| `competitors` | competitor observations (they can reveal target margin) | **yes** |
| `documents` | shared PDFs: quotes, price lists, review packs (S6) | no |
| `results` | published leak and margin results (S6, if D17 is option 2) | **yes** |

**Rules for packs:**
- **Columns are allow-listed.**
  - A pack's projection names every column it carries.
  - A unit test classifies every column of every source table as carried, held back or cost.
  - A new column fails that test until someone classifies it.
- **Runtime scan.**
  - Before encryption, and again before a received pack is applied, every pack passes a scan in the worker: its columns are exactly its allow-list, a pack without cost has no column named like cost or margin, and every value has its declared type.
  - Value-level checks (a planted cost value must not appear anywhere in a copy without cost) run in the unit tests (`tests/sharing.test.ts`). A runtime value check would be unreliable, because a real price can equal some other item's cost by chance.
  - A failed scan stops the publish.
- **New guardrail flag.**
  - Guardrails gain `floor_from_cost` (vault v24).
  - A floor that is cost plus a fixed margin reveals cost, so a flagged floor travels only in `cost_floors`.
  - The Pricing screen lets the publisher set the flag.

### 3.2 Starting ticks (the "Recommended" preset)

| Pack | owner | pricing_owner | pricing_manager | sales_manager | sales_rep | accountant | admin |
|---|---|---|---|---|---|---|---|
| items | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| customers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| book | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| contracts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| guards | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| cost | ✓ | ✓ | ✓ | ✓ read-only | 🔒 | ✓ | 🔒 |
| cost_floors | ✓ | ✓ | ✓ | ✓ | 🔒 | – | 🔒 |
| supplier | ✓ | ✓ | ✓ | – | 🔒 | ✓ | 🔒 |
| rules | ✓ | ✓ | ✓ | – | 🔒 | – | 🔒 |
| competitors | ✓ | ✓ | ✓ | – | 🔒 | – | 🔒 |

✓ ticked; – unticked but allowed; 🔒 locked.

**Locks and tick rules:**
- **The cost lock (decision D18).**
  - 🔒 follows `lib/roles/access.ts`: a role without the `cost` capability can never be ticked for a cost pack. Today those roles are `sales_rep` and `admin`.
  - The lock is computed from the capability table, never kept as a second list.
  - Clicking a locked box offers "make this person a Sales Manager". That is audited, and it rotates keys so the person receives the cost key.
  - Blueprint item 21 stands.
- **Sales Manager.** Receives cost read-only. This corrects the first version's §4.3, which put the Sales Manager in the rep audience; blueprint items 21–22 already give them read-only margins.
- **Accountant (decision D5).** The default follows the recommended option: cost and supplier terms read-only, and Reconciliation as today. The Owner can change the ticks.
- **Publishers.** The owner and pricing_owner columns cannot be unticked, because they publish.
- **Per-person extras.** One person can receive an extra pack without changing their role, subject to the same lock.

### 3.3 The signed grid and pack keys

- **One key per pack per epoch.**
  - Every key epoch carries a fresh 256-bit key for each pack in use.
  - Each pack key is wrapped only for the devices whose person, by role or by extra, is ticked for that pack.
  - Wrapping is the relay's existing ECDH P-256 → HKDF-SHA-256 → AES-256-GCM.
  - The wrapping context binds workspace, epoch, pack, sender and recipient.
- **The grid is signed.**
  - The grid and the role table (section 4) are canonical data inside the epoch record, signed by an Owner device.
  - Every device checks the grid against its pinned epoch chain before it uses a key.
  - The server stores the grid but cannot change it.
- **Changing ticks.**
  - Ticking a box, unticking a box, changing a role or removing a person starts a new epoch.
  - A pack someone lost gets a new key that they never receive.
  - Their app deletes that pack's data on its next sync.
  - Copies, screenshots and exports already made cannot be called back, and the screens say so.
- **The audit trail.** Every grid change is recorded in the audit trail and the audit pack: who, what, when, from and to.

## 4. One role table (fixes I-1)

The signed epoch record carries one row per person:
- the user ID;
- the vault role (`ROLE_IDS`);
- whether they are the named Pricing Owner;
- their per-person extra packs.

The vault takes each person's role from this table instead of setting it separately on each device. Server membership roles stay as they are, for sign-in, seats, licences and the relay's coarse admin check.

| Vault role | Relay role (server) | May publish | Relay rights |
|---|---|---|---|
| owner | owner | yes | approve, rotate keys, edit the grid |
| pricing_owner | manager | yes | approve, rotate keys |
| pricing_manager | analyst | no | comment, request approval |
| sales_manager | manager | no | decide quote exceptions |
| sales_rep | rep | no | comment, request approval |
| accountant | analyst | no | comment |
| admin | analyst | no | comment |

**Rules:**
- **Publishing.** Only a device whose signed role is owner or pricing_owner (or the named Pricing Owner) can publish packs. Receivers check this; the server's coarse check is defence in depth only.
- **Role changes.** A role change made in Settings › Team and roles becomes a new epoch when an Owner device next rotates keys. Until then, the old role and keys apply, and the screen says that a rotation is due.

## 5. How a publish travels

1. **Approve.** The Pricing Owner approves a change, or presses **Publish**. A setting can publish automatically after each approval.
2. **Build.** The worker builds each pack in use:
   - deterministic, sorted rows;
   - compressed with the browser's `CompressionStream`;
   - split into chunks of at most 1 MiB;
   - each chunk encrypted under the pack key with a fresh IV;
   - each chunk hashed.
3. **Sign.** A manifest is signed with the publisher's ECDSA key. It holds the pack, version, kind (`snapshot` or `delta`), base version, chunk hashes, row counts and time.
4. **Upload.** Chunks are uploaded through a same-origin route to a private Supabase Storage bucket, at `<tenant>/<pack>/<version>/<n>`. The route checks the session, licence, device and size caps.
5. **Record.** A relay event of a new kind, `pack`, records the signed manifest, encrypted under the pack key. The new `relay_blobs` table keeps metadata only: tenant, pack, version, chunk index, size and hash. No bytes go into Postgres.
6. **Signal.** A database trigger sends a content-free Realtime broadcast, "event n", on the private channel for that pack.
7. **Receive.** Devices holding that pack key hear the signal, or find the change on their 60-second poll.
8. **Check and load.** The receiving device then:
   - fetches the event;
   - fetches the chunks through short-lived signed download links, directly from Storage;
   - checks the signer, the hashes and that the version only goes forward;
   - decrypts in the worker;
   - loads the pack.

**Snapshots and deltas:**
- A delta carries only the rows that changed, plus removals.
- A **delta that touches only cost packs sends non-cost devices nothing**, not even the signal, because the signal is per pack.
- The publisher sends a fresh snapshot about weekly, or when deltas since the last snapshot pass a size threshold. Earlier deltas and blobs are then removed (compaction).
- A new seat downloads one snapshot per pack.

**As built in S3b (25 Nov 2026).** Steps 2 to 5 and 8 differ from the plan above:
- **Chunks.** They are gzipped and at most 512 KiB.
- **Uploads go directly to Storage.** There is no upload route: the worker uses the person's own session token, and Storage checks the same rule as downloads.
- **No `relay_blobs` table.** The chunk list and hashes are in the signed, encrypted manifest of the pack version, and a Storage object exists only for an allowed upload.
- **No signed download links.** Downloads go directly to the authenticated Storage endpoint.
- **Not built yet.** Deltas, compaction and the Realtime signal (step 6) are still to come: every publish is a snapshot, and seats receive on sync.

See `docs/evidence/SHARING_S3_VERIFICATION.md`.

## 6. Receiving and reading

**Vault v24** adds:
- `shared_books`: one row per publisher and pack, with the version, manifest hash, publisher, published and received times, how it arrived (`file` or `relay`) and its row count;
- `shared_changes`: the price changes the last copy of each pack made (at most 2,000 per pack), used for "what changed";
- `price_guardrails.floor_from_cost`.

The same tables serve the hand-off file (S1) and the relay (S3), so S1 carries forward unchanged.

**Applying a pack:**
- Applying a pack **writes the governed tables themselves** (`products`, `customers`, `price_matrix`, `price_guardrails`, and so on), with `source_id = 'shared:<pack>'`.
- So every existing screen and worker command (Price Check, Quote Desk, guidance, the price list) reads shared data with no second read path.
- Shared rows replace the device's own rows for the same key: the publisher is authoritative for governed data.
- Columns a pack does not carry are left as they are, or NULL on a new row. A Sales Rep's products therefore have no cost value at all: not zero, but NULL.

**On a receiving seat:**
- governed screens are read-only, under a banner reading "Shared by {name}, version {n}, {date}";
- the device's own notes stay local and are kept through re-applies;
- a "this copy is N days old" warning appears after 7 days without an update.

**What changed since your version:** a list of changed prices, each with its approver, and the old and new values, worked out from the previous and new manifests.

**Roll back:** re-publishing an earlier version makes it a new, higher version, so versions only ever go up.

**As built in S3c (25 Nov 2026):**
- **Read-only.** The worker refuses each classified write on a receiving seat (`lib/sharing/governed.ts`). Edit buttons stay visible, and the refusal names the publisher.
- **Staleness.** For relay copies it is measured from the last sync.
- **Roll back.** It is the existing audited price roll back followed by **Publish now**: re-sending old chunks would be undone by the next publish, which reads the publisher's tables.

See `docs/evidence/SHARING_S3C_VERIFICATION.md`.

## 7. Server changes: three migrations

**Revised 24 Nov 2026 (S2a).** The first version of this section planned one migration. Storage and Realtime policies run as `authenticated`, without the app's request context, and nothing exercises them until S3 and S4; once locked, they could not be fixed. So the server changes ship in three migrations, each with the release that exercises it, and each follows `MIGRATION_RULES.md` (CI, then a user-run Restore Drill, then the lock):

1. **S2: `20261125120000_sharing_s2_packs.sql`.**
   - The grid on `relay_epoch`.
   - `relay_pack_wrap` and `relay_pack_version`; a pack version holds only a signed manifest, encrypted under the pack key.
   - Pack versions readable only by holders of the pack.
   - Grid roles checked against membership.
   - Larger limits and quotas, including a byte cap.
2. **S3: `20261126120000_sharing_s3_storage.sql`.** The Storage bucket and its two policies (read, insert), whose rule is `rebatehq_storage.relay_storage_allowed`. `relay_blobs` was dropped: the signed manifest already carries the chunk metadata.
3. **S4:** the Realtime policies.

Together they change the following.

**Relay tables:**
- `relay_epoch` gains a signed `grid` (canonical JSON, at most 64 KiB) and a format version. Version 1 epochs stay valid.
- A new `relay_pack_wrap` table (tenant, epoch, pack, recipient device, ephemeral key, IV, wrapped key) records which devices hold which packs. That fact is metadata the server may see; the keys stay wrapped.
- `relay_event.object_kind` also allows `pack`, `thread` and `task`.

**Caps and compaction:**
- Per-message ciphertext stays at most 16 KiB. Bulk data goes to Storage instead.
- The event cap becomes rolling. Events older than the latest snapshot of every pack can be compacted (deleted by a function that keeps the hash-chain head and a signed checkpoint).
- The epoch cap rises.
- Workspace storage caps for blobs, by tier, are checked in the upload route and in the database.

**`relay_blobs`:**
- metadata only;
- row-level security by tenant and an active approved device holding a wrap for that pack;
- the audit trigger;
- pgTAP fixtures.

**Storage (S3 migration):**
- a private bucket, `relay-packs`;
- policies on `storage.objects` that call a new SECURITY DEFINER helper, which checks the tenant folder, an active membership with a Professional or Scale licence, an active device and a wrap for the pack (for writes, that the user signed that pack version within the hour);
- the helper lives alone in schema `rebatehq_storage`, which the Data API does not expose, because no public function may be granted to `authenticated`;
- restores re-apply the bucket and policies with `scripts/restore-storage-objects.sql`, since dumps exclude `storage`;
- no GRANT or REVOKE on the managed `storage` schema;
- CI's local Supabase starts `storage-api`.

**Realtime (S4 migration):**
- `realtime.messages` policies allow a private channel `pack:<tenant>:<pack>` to be joined only by a device holding that pack's wrap in the latest epoch;
- public channel access stays off.

**Access tokens:**
- The browser reaches Supabase today only through server routes.
- For Realtime and for downloads, a same-origin route hands the worker the person's own short-lived session access token, never a service key.
- The worker opens one WebSocket. The content-security policy's `connect-src` already allows the Supabase origin; S4 confirms `wss:` in Chrome, Edge and Firefox.
- The privacy gates' allow-lists add the WebSocket and the Storage download host, and prove that they carry only event numbers and ciphertext.

## 8. Collaboration features (S5)

- **Comment threads on any object**: a price line, SKU, customer, quote, leak finding or claim. They can be resolved and reopened, and are encrypted under the key of the pack that object belongs to, so a rep never sees threads on cost objects.
- **@mentions and an inbox** with badges. The relay already has both; they become live.
- **Tasks**: an assignee, a due date and a status, attached to any object.
- **Activity feed**: who published, approved or commented, and when.
- **Email notices with no content**:
  - "You have N new items in RebateHQ" only, with no prices and no comment text;
  - they need an email sender on the domain, which the product owner sets up;
  - until then they stay off.
- **Who's viewing**: off by default, because it tells the server who is online.

## 9. Releases

| Release | What | Server change | Depends on |
|---|---|---|---|
| **S1** | Encrypted hand-off file: export a pack selection for a colleague, protected by a one-time code of six groups of four characters (120 random bits) shown once; import it into the governed tables (section 6); vault **v24**; the `floor_from_cost` flag | none | nothing |
| **S2** | The role table and pack keys in the protocol (epoch format 2), the signed grid, invite and approve a device and its keys, rotation on role change or removal, the recovery kit prompt, **plus the one migration** | the migration | Restore Drill before lock |
| **S3** | Publish and receive packs through Storage; Settings › Sharing grid with presets ("Recommended", "Open team", "Strict", reset), Preview as… and a change summary; read-only governed screens; what changed; roll back | none (uses S2's migration) | S2 locked |
| **S4** | Live: Realtime doorbell, small deltas, the sync status dot, the 60-second polling fallback, privacy gates for the WebSocket and downloads | none | S3 |
| **S5** | Threads, tasks, inbox, activity feed, content-free email notices (off until a sender exists), who's viewing (off) | none | S4; an email sender for notices |
| **S6** | Chosen by pilot demand: shared PDFs, saved views, published results (D17), branch scoping, guest access, co-editing drafts | per item | D17 for published results |

**The cost lock in S1.** Until S2, each person is the Owner of their own vault, so a receiving vault's role says little. In S1 the lock therefore rests on the exporting side: a file made for a role without cost contains no cost pack. Import also refuses a cost pack when the local role lacks cost, and refuses a file whose packs do not fit the role it was made for.

**Tiers (decision D6):** Professional and Scale, the recommended option; the relay already allows only these tiers on the server (`relay_allowed`). Starter is single-user. The hand-off file follows the same rule.

## 10. Verification (definition of done)

- **Unit tests:**
  - every source column is classified;
  - every pack without cost passes the decision 16 scanner, and a planted cost column fails the publish;
  - pack-key wrapping gives a device keys only for its ticked packs;
  - a locked box cannot be ticked for a role without `cost`;
  - manifest, signature, hash and version ordering are checked;
  - a delta that touches only cost reaches no rep;
  - the hand-off file rejects a wrong code, a changed byte, another workspace and a full copy offered to a non-cost role.
- **Relay gate (three real devices: owner, pricing owner, rep):**
  - the rep receives prices and cannot decrypt a cost pack, even after fetching its blob;
  - a role change rotates keys;
  - the database, storage and Realtime scans find no marker.
- **Chromium and Firefox gates:**
  - a receiving seat shows the shared version and cannot edit guardrails;
  - the hand-off file round-trips.
- **pgTAP:** `relay_blobs`, `relay_pack_wrap`, the Storage and Realtime helpers, row-level security across tenants and devices, and compaction.

## 11. What changed from the first version, and why

| First version | Now | Why |
|---|---|---|
| Two audiences (`K_full`, `K_rep`) | One key per pack, plus a signed grid | The Owner asked for per-data tick boxes; full and rep copies become presets |
| Sales Manager in the rep audience (§4.3) | Sales Manager gets cost read-only | Blueprint items 21–22 |
| Ciphertext bytes in a `relay_blobs` table | Bytes in Supabase Storage; `relay_blobs` holds metadata | Keeps the database small; storage is included in the plan |
| Consumers read `shared_*` tables first | Packs write the governed tables, tagged `shared:<pack>` | One read path; every existing screen works for a rep at once |
| The vault schema bump in A | v24 in S1 | S1 imports into it, and S3 reuses it |
| The migration with publishing | The migration in S2 | The Restore Drill can run while S3 is built |
| No live updates | Realtime doorbell plus a 60-second polling fallback; decision 16 per pack | Owner decision D1 |
| Floors shared as typed | `floor_from_cost` flag; flagged floors travel only in a cost pack | A cost-derived floor reveals cost |

## 12. Not decided here

- **Sharing raw invoices.** Decision D17; option 3 is not planned.
- **Server-side connectors.** These cross decision 11.
- **The "data never leaves your device" claim (D11).** It is not used. Once sharing is on, encrypted data does leave the device.
