# Roadmap phases 4, 5, 7, 8a and 9a verification

Built by Claude Code, 20–21 November 2026, following the roadmap made from the 16–17 November product review. No blueprint change, no vault schema change and no Supabase migration in any of them. Local vault v21 / 61 tables; 14 locked migrations, 0 pending; no restore drill needed.

## Phase 4: dates in local time (PR #9)

**Passed CI** in [CI #180](https://github.com/Adityapawar5105/rebatehq/actions/runs/44813741319) on `6c45c9b`: 390 unit tests (78 JS + 312 TS), the 139-check pgTAP plan twice, **70 authenticated Chromium vault checks**, **67 Firefox lab checks** and 12 relay checks.

- **Decision D4 is the device's own time zone.**
  - `lib/vault/today.ts` holds `businessToday`, `addDays`, `yearStart`, `yearEnd` and `businessDate`.
  - Every business "today" in `lib/` and the screens' form defaults use these helpers.
- **A price run's `run_date` (a UTC timestamp) is read as the local business date** for:
  - the ERP export's effective date;
  - the same-day approval check.
- **Tests.** `tests/today.test.ts` fixes the clock and time zone. Two older tests that built "today" from UTC were corrected: they failed locally after midnight in UTC+5:30.

## Phases 5, 7, 8a and 9a (PR #10)

**Passed CI** in [CI #185](https://github.com/Adityapawar5105/rebatehq/actions/runs/44825994318) on `bdf14b8`: 397 unit tests (78 JS + 319 TS), the 139-check pgTAP plan twice, **72 authenticated Chromium vault checks** and **69 Firefox lab checks** (both including the new `passphraseUi` and `gridTrustUi`), and 12 relay checks.

**Phase 5, recovery and onboarding (audit B-3, B-5):**
- "Forgot your passphrase?" uses `vaultReset`:
  - only while the vault is locked, and only under the vault lease;
  - no licence needed;
  - the workspace name must be typed.
- "Change passphrase" uses `passphraseChange`. The current passphrase is checked, the vault is saved under a new key, and older snapshots are removed by `dropOlder`.
- The device list shows member email (Owner only), date added, status and "this device".
- The Owner sees a "devices waiting" badge. Decision D10: badge only.
- "Disable workspace" moved to Account › Workspace.
- `SECURITY_REVIEW.md` adds R16 and R17. Both privacy gates now allow exactly one more request: `GET /api/licence/devices`, with no query and no body.

**Phase 7, grid and Leak Report trust:**
- The table never shifts when a row is ticked.
- Each numeric column shows its sum on one line. The other totals sit under "More totals", which is rendered only while open.
- Sorting keeps the selection.
- The drill-down sorts by column headers only, and failed loads offer Retry.
- The Leaks card shows:
  - the live scope, "Report covers n of m findings";
  - how the headline is built;
  - how many lines were checked.
- Reports gets "Choose findings".

**Phase 8a, consistency:**
- Each notice shows one warning icon.
- The palette scrolls to the active row and groups its results.
- Sub-tab ids are unique.
- Tables show a row count and separate empty from filtered-empty.
- Home: the left arrow works, and undated rows sit under "Open items".

**Phase 9a, state:**
- Progress steps carry a kind, so the Cancel button no longer reads English text (audit B-12).
- Import refuses a plan made before another change to the vault (audit 1.3).

### Fixed during CI

- **CI #182.** The browser gate counted a grid's `tbody` rows to know new data had loaded. The hidden "More totals" table added rows and satisfied that check early. The table is now rendered only while open.
- **CI #183 and #184.** The vault and relay privacy gates rejected the Owner's device-badge read. Both now allow it under the conditions above. Request scanning is unchanged.

## Not done, and why

- **Audit B-9 (rate-limit header).** Needs a safe way to see which client-IP header Netlify sets. Testing it on staging would send real sign-in emails.
- **Phase 8, remaining items:**
  - moving five screens to the shared components (8.3);
  - the relay, scanned-PDF and quote-rep visuals (8.4–8.7);
  - shorter Spanish and French labels (8.10);
  - the account header (8.12);
  - 8.13–8.18.
- **Phase 9, remaining items:** the internal refactors 9.2–9.6.
- **Not checked:** native-speaker review of the new strings, and the Playground sample dates (which give a zero 90-day figure from late January 2027).
