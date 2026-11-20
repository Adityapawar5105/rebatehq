# First-run activation verification

Built by Claude Code, 20 November 2026, after the 16–17 November product review. A first-time owner goes from an empty vault to a 90-day cash-leak figure in one click, and Home only lists work the role can open. No blueprint change, no vault schema change and no Supabase migration.

**It passed CI** in [CI #175](https://github.com/Adityapawar5105/rebatehq/actions/runs/44793874491) on `c1a2744` (PR #7, merged as `0f9932b`), 20 November 2026 (Asia/Kolkata):
- 379 unit tests (78 JS + 301 TS);
- the 139-check pgTAP plan, twice on real Postgres;
- **69 authenticated Chromium vault checks** and **66 Firefox lab checks**, both including the new `activationUi`;
- **12 real-authenticated local-Supabase relay checks**;
- the high/critical dependency audit.

Local vault v21 / 61 tables (unchanged); 14 locked migrations, 0 pending; no restore drill needed.

## What was built

**Vault status.** `VaultStatus.sample` is `empty` (no imported file), `only` (only the Playground's sample files), `mixed` or `none`, counted from file names in `source_files` (`SAMPLE_COUNTS_SQL`, `sampleState` in `lib/studio/playground.ts`). It carries no business data.

**Home.**
- An empty vault shows a start card to `data` roles: "Try the Playground" loads it on Home, so the cash-leak card fills in; "Import a file" opens Data Hub.
- Order: work tabs, then the cash leak and customer health, then the other numbers, then ROI. A tile that repeats a work-list row is dropped when the row is shown.
- Both Home figures say "Checked when you open the app. Last checked {time}." The cash-leak card shows a "Sample data" badge while the Playground is loaded, and its help text is plain.
- Work-list rows are listed only when the role can open the screen they link to, and land on the exact heading (`fix-heading`, `recon-heading`, `basis-heading`) through the shared `scrollToHeading` helper.

**Every section.** A sample-data banner while Playground files are loaded, with "Import my own file" and "Remove sample data" for `data` roles.

**Import Studio.**
- Plainer drop-zone copy; "No file handy? Try the Playground" while the vault is empty; the Playground in the Data Hub jump bar while it is shown.
- "{n} of {m} required columns matched" above the column mapping, listing what is left.
- After an import, a notice with "See your 90-day cash leak" and "Open Margin" (cost roles) or "Review rows to fix".

## Tests

- `tests/activation.test.ts`: the four sample states, and the counting query against a real schema.
- `tests/home-palette.test.ts`: Home may call `playgroundLoad` only from the start card, shown to `data` roles.
- Browser gate `activationUi` (Chromium and Firefox): a fresh vault shows the start card and no banner; one click gives a non-zero 90-day cash leak on Home; the banner shows on Margin; removing the sample empties the vault; the mapping says all required columns matched; after an import the notice leads to Home.

## Not verified

- Native-speaker review of the new Spanish and French strings.
- The Playground's sample sales run from November 2024 to October 2026, so its 90-day figure falls to zero from late January 2027. Moving the sample dates relative to today needs the Playground manifest fixture regenerated; it is a recorded follow-up.
