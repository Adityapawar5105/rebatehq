# Team data sharing: design (roadmap 10.1)

21 November 2026. **Design only: nothing here is built.** It answers audit O-1 ("a team cannot share one vault") and I-1 ("three unrelated role systems"). It is written before any code, as `RELAY_DESIGN.md` was written before chunk 7A.

What happens next is the product owner's decision:
- Decision D1 picks option A, B or C (section 3).
- Approving this document is roadmap step 10.2. It then becomes a blueprint section 22 entry.
- No step below starts until then.

## 1. The problem

Each seat has its own private vault today.
- The vault folder and the encryption header both carry the person's own sign-in ID (`lib/vault/storage.ts`, `lib/vault/crypto.ts`).
- A colleague cannot open it, even with the passphrase and a backup file.

So the following never reach anyone else:
- price rules;
- guardrails;
- approved price versions;
- the item master;
- customer tiers;
- notes and cleanup.

The relay (7A) carries only small summaries: a reference, a title, an amount, comments and approvals.

On top of that, there are three role systems with no mapping between them:

| Where | Roles |
|---|---|
| Server membership | owner, manager, analyst, rep |
| Relay | the same four |
| Vault | Owner, Pricing Owner, Pricing Analyst, Sales Manager, Sales Rep, Accountant, Viewer |

An approval through the relay needs the right role in both systems.

## 2. What must stay true

1. **The server holds ciphertext only.** No price, cost, SKU, customer or invoice value reaches the server or its logs in readable form. The relay privacy scanner and the relay gate are extended to prove this for every new object type.
2. **Decision 16.**
   - A Sales Rep's device never receives cost, margin or anything cost can be derived from.
   - "Never receives" is meant literally: the rep's key cannot decrypt a copy that has cost in it.
   - Hiding cost in the rep's screen is not enough.
3. **One writer for governed data.** Guardrails, rules and approved prices change only through the existing Pricing Owner approval. Sharing distributes the result; it does not create a second way to change prices.
4. **No escrow.** The relay has no server master key, no passphrase recovery and no silent trust reset. Sharing does not add one either.
5. **Invoices stay where they were imported.** Sales lines, purchase lines and AR aging are not shared in any option. Each seat that needs margin analysis imports its own files, or works from the publisher's summaries.

## 3. The options (decision D1)

| | What | Effort | Server change | Fits the 2–15 seat pricing? |
|---|---|---|---|---|
| **C** | Sell single-user (one seat per workspace) until A ships | Copy and pricing page only | None | No: only the Starter seat count is honest |
| **B** | "Export for a colleague": an encrypted hand-off file, imported by another seat | Small to medium | None | Partly: manual, and stale as soon as prices change |
| **A** | The Pricing Owner publishes an encrypted shared snapshot through the relay; other seats pull it | Large (the largest item in the roadmap) | Yes: a ciphertext blob store and a migration | Yes |

**Recommendation (unchanged from the roadmap):**
- C for the first pilots.
- B as a stop-gap only if a pilot with two or more seats signs before A is ready.
- A as the real answer.

Decision D2 (pricing and seat counts) waits on this choice.

## 4. Option A: shared snapshot through the relay

### 4.1 What is shared

| Data | Full copy (cost roles) | Rep copy |
|---|---|---|
| Item master: SKU, description, category, unit, notes | Yes | Yes, but not the cost columns |
| Item cost (current cost, cost basis choices) | Yes | **No** |
| Customer list: ID, name, tier, notes | Yes | Yes |
| Guardrails: start and target per tier and category | Yes | Yes |
| Guardrail floor | Yes | Yes. A floor is a price the rep already sees in Price Check. It must not be a cost plus a known margin that a rep could reverse; the projection drops a floor flagged "derived from cost" |
| Approved price versions (the book price per SKU and tier) | Yes | Yes (prices only) |
| Rules, previews, run history | Yes | No |
| Contracts and rebate agreements | Yes | Customer contract prices only, no supplier terms |
| Competitor observations | Yes | No (they can reveal target margin) |
| Sales lines, purchases, AR aging, leak findings | **Not shared** | **Not shared** |

The rep copy is produced by a projection in the publisher's worker. Before encryption, it passes the same decision 16 scanner the Sales Rep commands use: no field named or typed as cost or margin, and no value equal to one. A failed scan stops the publish.

### 4.2 Keys: two audiences

The relay has one workspace key per epoch, and its design says that key "is not a way to hide costs from another keyholder". Sharing therefore adds **audience keys**, inside the existing epoch chain:

- Each epoch carries two fresh 256-bit keys:
  - `K_full` is wrapped only for devices whose mapped role has cost.
  - `K_rep` is wrapped for every approved device.
- Both use the existing ECDH, HKDF-SHA-256 and AES-256-GCM wrapping. The signed epoch record lists which devices received which key.
- A rep device never holds `K_full`, so it cannot decrypt the full copy even if it downloads the blob.
- Changing a person's role, in either direction, needs a key rotation. Rotation already happens when the roster changes.

### 4.3 One role mapping (fixes I-1)

One table decides each person's audience and what the relay lets them do. It is signed into the epoch record, so the server cannot change it.

| Vault role | Relay role | Audience | Relay rights |
|---|---|---|---|
| Owner | owner | full | publish, approve, rotate keys |
| Pricing Owner | manager | full | publish, approve |
| Pricing Analyst | analyst | full | comment, request approval |
| Sales Manager | manager | rep | approve quote exceptions |
| Sales Rep | rep | rep | request approval, comment |
| Accountant | analyst | full, read-only | comment. Needs decision D5 on Reconciliation access first |
| Viewer | rep | rep | read |

Server membership roles stay as they are, for sign-in, seats and licences. The vault role comes from this signed table instead of being set separately on each device.

### 4.4 Publishing

1. The Pricing Owner presses **Publish shared data**, after an approval or at any time.
2. The worker builds both copies:
   - The data is deterministic, sorted JSON, compressed, then split into chunks of at most 1 MB.
   - The worker hashes each chunk and signs a manifest. The manifest holds the version, the time, the audience and the chunk hashes.
3. Each copy is encrypted under its audience key and uploaded as opaque blobs, with a relay event of the new kind `snapshot` that points to them.
4. Versions only go up. A new version replaces the previous one for consumers; the server keeps the last two of each audience, for a consumer that is mid-download.

### 4.5 Receiving

1. On Sync, or on unlock if sharing is set up, the device fetches the latest `snapshot` event for its audience.
2. The device checks three things:
   - The signer is a full-audience publisher in the pinned epoch chain.
   - The chunk hashes match the manifest.
   - The version is newer than the one it holds.
3. It decrypts in the worker and loads the data into local read-only tables (`shared_products`, `shared_customers`, `shared_guards`, `shared_prices` and so on, in one vault schema bump).
4. Price Check, Quote Desk and guidance read the shared tables first, and fall back to the device's own imports.
5. On a consumer seat, governed data (guardrails, rules, prices) cannot be edited; the screens say "Shared by {name}, version {n}, {date}". A consumer's own notes stay local.

### 4.6 What the server learns

The server learns blob sizes, counts, timing, the publisher's device ID and the audience label. It learns no content. The roughly 10 MB a 100,000-SKU item master produces after compression shows the order of size; it says nothing about prices. This is recorded in `SECURITY_REVIEW.md` as accepted metadata.

### 4.7 Server and schema changes

- **Migration:** a `relay_blobs` table holding the workspace, ID, audience label, size, SHA-256 and ciphertext bytes, under row-level security by workspace and approved device. It also needs per-workspace size caps by tier, and removal of superseded versions.
  - This follows `MIGRATION_RULES.md`: CI, then the user's restore drill, then lock.
- **API:** routes to upload and download blobs, behind the existing device-approval checks. They are added to the privacy gate's allow-list, and the relay privacy scanner checks every stored byte for the gate's markers.
- **Vault schema:** one bump for the shared tables and the stored manifest.

### 4.8 Verification (the definition of done for A)

- **Unit tests:**
  - the projection drops every cost-derived field, and the decision 16 scanner rejects a rep copy that contains one;
  - audience wrapping gives a rep device no `K_full`;
  - manifest and signature checks;
  - version ordering.
- **Relay gate:** three real devices (owner, pricing owner, rep).
  - The rep receives prices but cannot decrypt the full copy, even by fetching its blob.
  - A role change rotates keys.
  - The relay database scan finds no marker in any blob or log.
- **Chromium and Firefox gates:** a consumer seat shows the shared version and cannot edit guardrails.
- **pgTAP** for `relay_blobs`, including row-level security across workspaces and devices.

### 4.9 Work breakdown (each a separate PR)

1. Role mapping table in the epoch record, and audience keys (no new data shared yet).
2. Projection and scanner for the rep copy, with unit tests.
3. `relay_blobs` migration, routes and privacy scanner (restore drill before lock).
4. Publish and receive in the worker, plus the shared tables (vault schema bump).
5. Screens: Publish, the "Shared by" banners and read-only governed screens on consumer seats.
6. Turning it on for paid tiers (decision D6).

## 5. Option B: hand-off file (stop-gap)

- The Pricing Owner chooses **Export for a colleague**: either a full copy or a rep copy, using the projection in 4.1.
- The worker encrypts the file with a random one-time code of 6 words (PBKDF2 or Argon2 as for backups, AES-256-GCM). It shows the code once. The person passes the code separately, by phone or in person, never in the same email.
- The colleague chooses **Import from a colleague**, enters the code and the file loads into the same `shared_*` tables as in A. So B's tables carry forward to A unchanged.
- There is no server change and no migration; the vault schema bump is the same one A needs.
- **Limits:**
  - The copy is stale as soon as prices change, and the screens say so with its date.
  - Anyone holding the file and the code can read it.
  - A rep copy contains no cost, so a leaked rep file exposes prices only.

## 6. Questions for the product owner

1. D1: A, B (stop-gap) or C for the first pilots?
2. Is the floor shared with reps, and how? (A floor that is cost plus a fixed margin reveals cost.)
3. D5: should the Accountant get the full copy read-only, or is Reconciliation moved instead?
4. Size caps per tier for shared data, and how many versions the server keeps.
5. Should a consumer seat be able to propose a guardrail change through the relay (a request the Pricing Owner approves), or only comment?

## 7. Not decided here

- Sharing invoices or sales lines between seats.
- Real-time co-editing.
- Any server-side connector.

Each of these would need its own design, and the first two cross decision 11.
