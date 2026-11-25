# Team sharing S2a (pack keys, the signed grid and the sharing migration): verification

24 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` sections 3.3, 4 and 7. Built by Claude Code.

**S2a is the protocol, crypto, server store and migration.** S2b follows. It adds:
- the worker session that signs and reads format 2 epochs;
- the role table mirrored into the vault;
- invites and rotation in the screens;
- the recovery kit prompt;
- a three-device relay gate.

Nothing here is reachable from the app yet: the vault never signs a format 2 epoch until S2b. The relay stays behind `RELAY_ENABLED`.

**Migration status.** `20261125120000_sharing_s2_packs.sql` is **pending** in `migrations.lock`. Per `MIGRATION_RULES.md`, it is locked only after green CI **and a user-run Restore Drill**.

## What is built

### Pack catalogue

`lib/sharing/catalog.ts` lists all 12 packs of the design and marks which carry cost:
- `cost`, `cost_floors`, `supplier`, `rules`, `competitors` and `results` carry cost.

It also holds:
- the "Recommended" ticks;
- `packsFor`: Owner, Pricing Owner and the named Pricing Owner get every pack, and a role without the `cost` capability never gets a cost pack.

The server, the relay protocol and the vault all import this one list.

### Epoch format 2

A format 2 epoch (`lib/relay/protocol.ts`, `lib/relay/crypto.ts`) adds two things to the 7A epoch:
- **The signed grid**: one role table (user, vault role, extra packs), the named Pricing Owner, and the ticks per role.
- **One wrapped key per pack** for each device whose person is entitled to it. The wrapping is ECDH P-256, HKDF-SHA-256 and AES-256-GCM, with a context that binds workspace, epoch, pack, sender and recipient.

Every verifier refuses:
- **cost for a role without cost**: a grid that ticks a cost pack for such a role, or gives such a person a cost pack as an extra. The grid is refused, not trimmed;
- **wrong wraps**: wraps that differ from what the grid implies, by one too many or one too few;
- **a non-publisher signer**: a signer who is not a publisher under the previous grid (or under its own grid, for the first one);
- **an unauthorised grid**:
  - a grid change by anyone but an Owner;
  - a first grid signed by anyone but its Owner;
- **roles that don't match the server** (security review):
  - a grid Owner who is not a server owner;
  - a publisher who is not a server owner or manager;
- **a downgrade** from format 2 back to format 1.

### Pack versions

A pack version is a signed hash chain per pack, and its manifest is encrypted under that pack's key.
- Only a grid publisher whose device holds the pack can append one.
- A delta must name an earlier base version.

### Server

**`lib/relay/store.ts` and `app/api/relay/route.ts`:**
- format 2 epochs round-trip with their grid and pack wraps, in canonical order;
- `POST {action:'pack'}`;
- `GET ?mode=packs&pack=&after=`;
- epoch posts up to 1 MiB;
- cursor bounds raised.

**The migration:**
- `relay_epoch.format` and `relay_epoch.grid`;
- the `relay_pack_wrap` and `relay_pack_version` tables;
- the `relay_pack_reader()` helper;
- larger table limits (epochs up to 100,000; sequences below 10^9);
- quotas still in the trigger:
  - events 1,000,000 and 1 GiB;
  - pack versions 200,000 and 256 MiB (the byte cap is a security-review fix);
  - rate limits.

**The trigger additionally checks:**
- no step back from format 2;
- grid roles against membership;
- pack wraps only from the epoch signer, on format 2;
- pack versions only from a grid publisher holding the pack, in chain order.

**Who sees what:**
- **Pack versions:** row-level security returns a pack's rows only to a person whose active device holds that pack in the latest epoch. A device without a cost pack never receives its rows, its head or a signal.
- **Pack wraps:** every member reads them, because the signed epoch covers them.
- **Audit:** both new tables are audited as metadata only.

**Not in this migration:** Storage and Realtime policies ship with S3 and S4, the releases that use them. Each will need its own Restore Drill.

## Tests

**`tests/relay-sharing.test.ts` (7 tests, real WebCrypto keys, PGlite for the database):**
- **Catalogue:** the lock is derived from the capability, and no recommended tick is locked.
- **Unwrapping:** each device unwraps only its packs. A rep device holds six packs, none with cost, and no cost wrap exists for it at all.
- **Verifier refusals:**
  - cost ticked for reps, or given as an extra;
  - an extra wrap, or a missing one;
  - a Sales Manager signer;
  - a grid edit by the Pricing Owner (allowed by the Owner);
  - a downgrade;
  - a member missing from the role table.
- **Pack versions:**
  - a publisher-only chain;
  - a replay is refused;
  - the wrong pack key opens nothing;
  - a Sales Manager reads cost but cannot publish.
- **PGlite round trip (with the migration):**
  - format 2 round-trips;
  - **a rep's page and raw `SELECT` for the cost pack return nothing**, while the Sales Manager reads and verifies it;
  - a Sales Manager's direct `INSERT` is refused by the trigger;
  - a downgrade is refused;
  - audit is metadata only.
- **Roles against membership:**
  - a server rep as grid Owner or named Pricing Owner is refused;
  - a first grid by the Pricing Owner is refused;
  - the same grid with true roles verifies.
- **Database grid check:** the database refuses a grid that does not match membership.

**`supabase/tests/sharing_s2.sql` (10 pgTAP checks).** The plan goes from 139 to 149 fresh, and from 142 to 152 in restore mode. The checks:
- forced RLS and the triggers;
- exact ACLs;
- a positive format 2 epoch with wraps under the restricted role;
- a publisher appends cost and book versions;
- **a rep selects no cost row** but reads book and every wrap;
- a rep holding book cannot publish;
- another tenant and a missing context see nothing;
- metadata-only audit;
- a grid that does not match membership, and a downgrade, are refused;
- constraint probes.

**Restore Drill coverage:**
- `scripts/seed-restore-relay.ts` now seeds a format 2 epoch, 12 pack wraps and a pack version.
- `scripts/verify-restore-equivalence.mjs` compares six relay tables, up from four.
- The privacy scan lists all six tables. It requires rows in the pack tables where the flow writes them (the restore seed and PGlite); the browser relay gate requires them from S2b.

**Updated tests:**
- `relay-harness-sql`, `chunk3c-restore` (15 tenant tables), `relay-privacy` (the 1 MiB post limit) and `rls-test-structure` (the plan counts).

## Results

| Check | Where | Result |
|---|---|---|
| `tsc --noEmit`, schema lint, migration lock (1 pending) | local | passed |
| Unit tests | local | 78 JS and 367 TS passed (including the PGlite runs of the full pgTAP SQL, fresh and populated) |
| pgTAP 149/152, relay gate, browser gates | CI | recorded in the PR |
| CI | [CI #229](https://github.com/Adityapawar5105/rebatehq/actions/runs/45457625300) on `05dd35e` | passed (pgTAP 149, both browser gates, `verify`) |
| Restore Drill | user-run [#23](https://github.com/Adityapawar5105/rebatehq/actions/runs/45539740448) and [#24](https://github.com/Adityapawar5105/rebatehq/actions/runs/45539767088), local target, on `075ded4` | passed: 152 restore-mode checks; relay content hashes equal (pack wraps 12 → 12, pack versions 1 → 1). **The migration is locked** (25 Nov 2026) |

## Bugs the tests found

- **The publisher check let anyone through (found by the PGlite test).** The trigger compared `grid->>'namedOwner'` with the sender. With no named Pricing Owner, that comparison is NULL, and `NOT (NULL OR false)` let a Sales Manager append a pack version directly. It now uses `COALESCE`.

## Known limits

- **S1 hand-off files are not signed (security review).** Anyone in the workspace with a file and its code can import it. Pack versions are signed by a grid publisher, and S3 replaces the file with the relay.
- **Event compaction is not built.** The lifetime limits are raised instead.
