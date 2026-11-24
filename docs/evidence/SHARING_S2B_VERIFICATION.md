# Team sharing S2b (the worker signs and reads the sharing grid): verification

25 November 2026. Blueprint section 22, item 38; `SHARING_DESIGN.md` sections 3.3 and 4. Built by Claude Code on S2a (PR #27).

**No new migration.** S2a's migration stays **pending** until the user runs the Restore Drill.

## What changes

### Owners sign a grid

"Start workspace sharing" and "Rotate workspace key" now sign a **format 2** epoch.
- **Roles.** The grid comes from this vault's Team and roles. Anyone without a role here is a Sales Rep, the same least-privilege default as `accessFor`.
- **Named Pricing Owner.** It is the vault's named Pricing Owner, if they are on the roster.
- **Ticks.** The ticks are the "Recommended" preset until the Settings › Sharing grid (S3).
- **Rotation by a Pricing Owner.** A Pricing Owner who is not a grid Owner rotates with the previous grid unchanged, because only an Owner changes it.

### Each device keeps only its packs

The session unwraps and stores, in the encrypted vault, the keys for this device's packs only. The relay panel lists them: "This device holds keys for: …".

### A receiving vault takes its roles from the grid

On a device whose person is not a grid Owner:
- the signed role table becomes the vault's Team and roles;
- the grid's named Pricing Owner becomes the vault's Pricing Owner (none if the grid names none);
- the change is audited as `roles.mirrored_from_grid`;
- an unchanged grid writes nothing.

Before this, a rep who created their own vault was its Owner and named Pricing Owner, so they had cost. After joining, they are a Sales Rep there and lose cost (decision 16). An Owner's vault is the grid's source and is never overwritten.

### Recovery kit prompt

An Owner with only one device holding the Owner's keys sees "Keep a recovery kit": approve a second Owner device or keep an encrypted backup, since there is no server recovery.

### A card that loses access hides

When a role loses access (a joined rep), the Home monitor hides instead of showing "Could not check the local data". The relay gate caught this.

## Tests

**`tests/relay-sharing-session.test.ts` (PGlite relay, real keys):**
- **Sessions.**
  - The Owner signs; the Sales Manager and the rep join.
  - The Owner holds 12 packs, the Sales Manager 9 and the rep 6, with **no cost pack key on the rep device or in its stored vault**.
  - 7A shares and comments still work on a format 2 epoch.
  - The Sales Manager (a server manager, not a grid publisher) cannot rotate.
  - A second Owner rotation keeps every device's packs.
  - No plaintext reaches the relay tables.
- **Role mirror.**
  - A rep's own vault (where they were Owner and named Pricing Owner) becomes Sales Rep, with **no cost capability**; the change is audited.
  - An unchanged grid writes nothing.
  - No named Pricing Owner means none is named.
  - An Owner's vault is never overwritten.
  - The grid builder makes unassigned people Sales Reps.
  - A Pricing Owner keeps the previous grid.

**`scripts/test-relay-browser.mjs` (three Chrome devices): new check `packKeysByRole` (13 checks).**
- The Owner device lists the cost pack.
- The rep device lists book prices and no cost pack.
- The database holds **no cost pack wrap for the rep device**.
- The Owner sees the recovery kit prompt.
- The privacy scan now also requires `relay_pack_wrap` rows.

## Results

| Check | Where | Result |
|---|---|---|
| Unit tests | local | 78 JS and 369 TS passed |
| `next build --webpack` | local | passed |
| Relay browser gate, Chrome, PGlite transport | local | 13 checks passed |
| Chromium privacy and relay gates (real Supabase), Firefox lab gate, `verify` | CI | recorded in the PR |

## Not covered yet

- **The Settings › Sharing grid (S3).** This adds presets, per-person extras, "Preview as…" and the change summary. Until then the grid is the Recommended preset.
- **Publishing data packs (S3).** No pack versions are written yet. The privacy scan requires `relay_pack_version` rows from S3.
- **Shrinking stored epochs.** Old epochs' pack wraps are kept in the encrypted vault. For a 15-person team that is about 45 KB per epoch.
