# Chunk 7V verification — UI redesign

6 November 2026. 7V was added at the user's request (blueprint section 22, item 23). It changes the UI only:
no feature, worker, engine, vault schema, migration or privacy change. It has two parts.

## 7V-1 — design system, app shell, unlock screen and Home (built; approved by the user)

### What changed
- **Design scale** (`app/theme.css`, a new `:root` block that is the same in every theme):
  - a system UI font stack, type sizes, line heights and the spacing scale;
  - radius, three elevation levels and motion timing (motion is still switched off by
    `prefers-reduced-motion`);
  - sidebar, header and content widths.

  Colours are unchanged and still pass the contrast test in all four themes.
- **Shared components** (`components/ui/`):
  - Button and ButtonLink, Card, PageHeader, Grid and Split;
  - StatTile, Badge, Notice, Field, DataTable, EmptyState, Skeleton, Meter, SectionTabs and StepList;
  - Dialog and SrOnly;
  - an in-house SVG icon set (no icon font or CDN).

  The components hold no text of their own: every string comes in already translated. Styling is in
  `ui.module.css`, using tokens only.
- **App shell** (`components/local/VaultApp.tsx`, `shell.module.css`):
  - **Sidebar:** icons for each section; the active page is marked with a bar and tint. It collapses to
    icons, and the choice is remembered in this browser; it is a layout preference, not business data.
    The workspace and identity sit at the bottom.
  - **Top bar:** a search button that opens the command palette (Ctrl/Cmd+K), the language and theme
    pickers, and sign-out.
  - **Lab notice:** one slim line instead of the large banner.
  - **Page header:** each section has a title, a one-line description and the Lock vault action.
  - **Summary strip:** the four vault totals (invoice lines, products, customers, saved version) and the
    licence status, in place of four large boxes on every page.
  - **Phone width (780px and below):** the sidebar becomes a drawer opened from a menu button. It closes on
    navigation, on Escape and on the backdrop.
  - **Skip link:** now hidden until it gets focus. Before, it showed in the middle of the page.
  - **Brand mark:** "R" (the old "M" was left over from the MarginDesk name).
- **Unlock and create screen:** a centred card with an icon, the passphrase note, labelled fields, a full-width
  primary button and the licence line. The encrypted backup and restore card sits below it.
- **Home**, rebuilt on the components. It shows the same numbers, rules and permissions:
  - the role card;
  - key-number tiles for the role;
  - the 7-day setup checklist as a progress meter and step list with "Go" and "Mark done" actions;
  - the ROI tracker as a highlighted figure;
  - the workspace sharing card and the glossary.
- **Screens moving in 7V-2:** Data Hub, Margin, Pricing, Quotes, Reports and Settings keep their content.
  - They already pick up the new type scale, card radius, elevation and button style, because the old element
    rules now use zero-specificity `:where()` selectors.
  - They move fully to the components in 7V-2.

### Screenshots
`scripts/ui-screenshots.mjs` creates a lab vault with the Playground sample data. It captures every section in
light and dark, at 1366x768 and 375x812, and reports any horizontal overflow:
`node scripts/ui-screenshots.mjs --out=<folder> --url=<lab server>`.
- The script ran on the full set (32 images each, before and after). The full sets stay in the git-ignored
  `test-results/`.
- A representative subset is committed, side by side:

| Screen | Before | After |
|---|---|---|
| Create vault, desktop | [before](docs/ui/before/create-light-desktop.png) | [after](docs/ui/after/create-light-desktop.png) |
| Create vault, phone | [before](docs/ui/before/create-light-phone.png) | [after](docs/ui/after/create-light-phone.png) |
| Unlock, dark | [before](docs/ui/before/unlock-dark-desktop.png) | [after](docs/ui/after/unlock-dark-desktop.png) |
| Home, light desktop | [before](docs/ui/before/home-light-desktop.png) | [after](docs/ui/after/home-light-desktop.png) |
| Home, dark desktop | [before](docs/ui/before/home-dark-desktop.png) | [after](docs/ui/after/home-dark-desktop.png) |
| Home, light phone | [before](docs/ui/before/home-light-phone.png) | [after](docs/ui/after/home-light-phone.png) |
| Home, dark phone | [before](docs/ui/before/home-dark-phone.png) | [after](docs/ui/after/home-dark-phone.png) |
| Margin (moves to the components in 7V-2) | [before](docs/ui/before/margin-light-desktop.png) | [after](docs/ui/after/margin-light-desktop.png) |
| Quotes (moves to the components in 7V-2) | [before](docs/ui/before/quotes-light-desktop.png) | [after](docs/ui/after/quotes-light-desktop.png) |

Neither set showed horizontal overflow on any section, at either width or in either theme.

### Checks (6 November 2026, Windows, local evidence; CI result linked below once it runs)
- `node node_modules/typescript/bin/tsc --noEmit`: clean.
- TypeScript unit tests: 154 of 154 pass, including `tests/i18n.test.ts` (no hard-coded strings; the new keys are
  in en, es and fr) and `tests/theme.test.ts` (contrast in all four themes; no colour literals or colour words).
- JavaScript unit tests: 78 of 78 pass.
- `node scripts/check-migrations-lock.mjs`: 11 applied, 0 pending, unchanged.
- `node scripts/build-spike.mjs` and `next build`: succeeded.
- Vault browser gate (`scripts/test-vault-browser.mjs`, lab mode): passed in headless Chrome 156.0.8078.80 and Edge
  156.0.4314.58. It has a new `uiLayout` check:
  - no horizontal overflow on any section at 1366px and 375px, in light and dark;
  - the phone menu opens the drawer, navigates and closes it.

  Every earlier check still passes: the pseudo-locale walk, `quotesUi` and the 390px mobile check.
- Relay gate (`scripts/test-relay-browser.mjs --browser=chrome`, local PGlite transport): 11 checks passed.

### Not verified
- **CI:** [CI #95](https://github.com/Adityapawar5105/rebatehq/actions/runs/42264359487) passed on `108d427` in 9m 42s:
  - the authenticated privacy gate on `/home`, including the new `uiLayout` check;
  - the real-Supabase relay gate (11 checks).
- The look itself: **the user's review of the screenshots is the gate for 7V-2.**
- The signed-in `/home` page uses the same VaultApp shell, but it could not be opened here because this machine
  has no Supabase. CI's authenticated gate exercises it. The login, setup and account pages are unchanged in 7V-1;
  they move in 7V-2.
- Screen readers were not tested by hand. The landmarks, labels, focus order and skip link were checked by the
  gates' role- and label-based selectors only.

## 7V-2 — every other screen (CI-verified: CI #96)

**User approval of 7V-1 (6 November 2026):** "Approve, start 7V-2".

### What changed
- **Margin**
  - **Key numbers:** a tile row for list sales, net pocket, pocket margin with its rate, and leaks found.
  - **Waterfall:** each step's bar now floats from where the previous step ended, as a waterfall chart. Discounts,
    rebates, freight and cost are red; the margin is green; unknown-cost pocket is dashed. The amount column
    keeps every "show the math" button and test id, so the chart and its accessible table are one element.
  - **Drill-down:** right-aligned figures, and the table scrolls inside its card with a sticky header.
  - **Whale curve:** an SVG chart with grid lines, a filled area and a marker at the peak. The lowest-margin
    customers stay in a table below.
  - **Leaks:** type badges, an empty state, and the Leak Report download beside the heading.
  - **Show the math:** a highlighted card with the value large, and the engine check as a notice.
- **Data Hub**
  - An "On this page" jump bar (Import Studio, Fix Later, Reconciliation, Data health, Imported files, Item
    master cleanup, Cost basis). Its buttons are named "Jump to …", so they never clash with the names the
    gates use.
  - The drop zone has an upload icon.
- **Pricing:** guardrail and rule fields sit in a responsive row instead of one long column. Saved guardrails
  are a striped list.
- **Quotes:** the view switcher is a segmented control. The buttons and their names are unchanged.
- **Reports and Settings:** Reports cards now use the shared Card and Button. Settings has the same jump bar
  (Language and appearance, backup, Team and roles, Storage and security).
- **Shared look on every remaining screen:** tables, status pills, warnings and errors (errors now use the "bad"
  tone instead of the warning tone), link buttons, totals, details and button rows. These legacy classes are
  restyled to the component tokens, so Import Studio, Fix Later, cleanup, cost basis, backup, roles, the relay
  inbox and the palette match without their markup changing.
- **Sign-in, setup, invite and account pages** (`app/globals.css`): the same font, type scale, radius, elevation,
  fields, buttons and top bar. These pages need Supabase, so they were not opened here; CI's authenticated gate
  signs in through them.

### Approach, and what is left for later chunks
Margin, Home, the shell and the unlock screen are rebuilt on `components/ui`. The longest screens keep their
markup and pick up the restyled classes instead. The gates exercise their file inputs, labels and button names
in depth, so a full rewrite of Import Studio and Fix Later would mostly add risk. Each later chunk (7C onward)
builds its new screens on `components/ui` and can move an older card when it touches it.

### Screenshots
| Screen | Before | After |
|---|---|---|
| Margin, light | [before](docs/ui/before/margin-light-desktop.png) | [after](docs/ui/after/margin-light-desktop.png) |
| Margin, dark | — | [after](docs/ui/after/margin-dark-desktop.png) |
| Data Hub | [before](docs/ui/before/data-hub-light-desktop.png) | [after](docs/ui/after/data-hub-light-desktop.png) |
| Pricing | [before](docs/ui/before/pricing-light-desktop.png) | [after](docs/ui/after/pricing-light-desktop.png) |
| Quotes | [before](docs/ui/before/quotes-light-desktop.png) | [after](docs/ui/after/quotes-light-desktop.png) |
| Settings, dark | [before](docs/ui/before/settings-dark-desktop.png) | [after](docs/ui/after/settings-dark-desktop.png) |
| Margin, phone | [before](docs/ui/before/margin-light-phone.png) | [after](docs/ui/after/margin-light-phone.png) |

### Checks
**CI-verified:** [CI #96](https://github.com/Adityapawar5105/rebatehq/actions/runs/42269867429) passed on `9063e73` in 13m 54s:
- the authenticated privacy gate, including `uiLayout`;
- the real-Supabase relay gate (11 checks).

Local evidence (6 November 2026, Windows):
- `tsc --noEmit`: clean.
- TypeScript unit tests: 154 of 154 pass (i18n and theme tests included).
- JavaScript unit tests: 78 of 78 pass.
- Migration lock: 11 applied, 0 pending, unchanged.
- `next build`: succeeded.
- Vault browser gate: passed in headless Chrome 156.0.8078.80 and Edge 156.0.4314.58, including `uiLayout`, the
  pseudo-locale walk over every section, `quotesUi` and the mobile check.
- Relay gate (local PGlite transport): 11 checks passed.
- `scripts/ui-screenshots.mjs` on the production build: every section in light and dark at 1366 and 375 wide, with
  no horizontal overflow.

### Not verified (7V-2)
- The sign-in, setup, invite and account pages were not opened locally (they need Supabase).
- Screen readers were not tested by hand.

