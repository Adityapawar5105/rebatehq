# Sidebar and shell redesign: verification

23 November 2026. Blueprint section 22, item 36. Built by Claude Code from the user's keep/maybe/drop choices on a published proposal (interactive mockups plus a Figma file of the sidebar options).

## What the user chose

| ID | Item | Choice | Built |
|----|------|--------|-------|
| N1 | Sub-pages nested under the nine sections | Keep | Yes |
| D1 | Data Hub split into four pages | Keep | Yes |
| D2 | Settings split into grouped pages | Keep | Yes |
| A1 | One sidebar; account pages under Settings | Keep | Yes |
| V1 | Breadcrumb page header replaces the tab row | Keep | Yes |
| V2 | Vault summary as a status chip in the top bar | Keep | Yes |
| V3 | Sentence-case labels | Keep | Yes |
| V4 | Stat tiles state the period and the change | Keep | Period only (see below) |
| V6 | Quieter sidebar: 34 px rows, 30 px sub-pages | Keep | Yes |
| V7 | Notices stacked as one group | Keep | Yes |
| V8 | Fewer font weights, calmer headings | Keep | Yes (400, 500, 600) |
| V9 | Short, quiet motion | Keep | Yes |
| N2, N3, R1, V5 | Group labels, rail plus column, Reports cards as pages, compact rows | Maybe | No |

**V4 limit.** No figure on Home has a stored earlier period to compare with, and adding one needs a new worker read. Only the period is shown: Net pocket names the invoice lines it covers, and the 90-day cash leak already names its window. No worker command was added.

## How it is built

- `components/local/subtabs.ts` is the single registry for the sidebar and the command palette. It adds Data Hub and Settings pages, sidebar test ids, `sectionOfHash`, `pageOfHash`, `pageOfAnchor` and `markSubPage`.
- `components/local/SideNav.tsx` draws the tree. It is used by `VaultApp` and by `AccountShell`.
- Each view still reads its own hash. The views no longer draw tab rows.
- Quotes rewrites the hash when it moves itself (an opened quote), so the sidebar and breadcrumb follow.
- `lib/account-nav.ts` lists the account pages from the server role; `app/home/page.tsx` passes the list to the vault.
- No schema, migration, worker or dependency change.

## Checks run locally (not CI)

- `tsc --noEmit`: clean.
- `node --test tests/*.test.js`: 78 pass. `tsx --test tests/*.test.ts`: 350 pass (`tests/ui-tabs.test.ts` now checks that Quotes draws no tab list of its own and reads its page from the hash).
- `tests/subtabs.test.ts` adds three tests:
  - every hash the app and the browser gate use resolves to its section and page;
  - the sidebar follows role and tier, and a one-page section has no sub-list;
  - every heading sits on a page that exists.
- Chrome browser gate (`scripts/test-vault-browser.mjs --browser=chrome`, lab mode, production `next build --webpack`, Chrome 157): **passed, 72 checks**.
  - The gate opens Data Hub and Settings pages through the sidebar (`openSub`).
  - Quotes pages are opened by their sidebar links.
  - The arrow-key tab check moved to Home's two work tabs.
  - The overflow sweep covers the five new pages at 1366 px and 375 px.
- The flyout hover bridge (CSS only) was added after that gate run.

## CI

- [CI #218](https://github.com/Adityapawar5105/rebatehq/actions/runs/45222849197) on `c1fb076` (PR #24) failed in the authenticated Chromium privacy gate, which the local lab run does not reach.
  - Unit tests, audit, build and the Firefox lab gate passed.
  - Cause: `phase8Ui` waited for a navigation landmark named "Account" on `/account/licence`. The one-sidebar change (A1) removed that second landmark, and the account links now sit under Settings in "Main navigation".
  - Fix: the step now finds the Settings pages in the main navigation. It still checks that "Licence, seats and devices" is the current link.

## Still to verify

- CI on the pull request (Chromium and Firefox gates, relay, pgTAP).
- Hosted staging is not checked.
- Native-language review of the new Spanish and French labels is not done.
