# Chunk 7V verification — UI redesign

6 November 2026. 7V was added at the user's request (blueprint section 22, item 23). It changes the UI only:
no feature, worker, engine, vault schema, migration or privacy change. It has two parts.

## 7V-1 — design system, app shell, unlock screen and Home (built; awaiting the user's review)

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
- CI (the authenticated privacy gate and the real-Supabase relay gate) for this commit: pending.
- The look itself: **the user's review of the screenshots is the gate for 7V-2.**
- The signed-in `/home` page uses the same VaultApp shell, but it could not be opened here because this machine
  has no Supabase. CI's authenticated gate exercises it. The login, setup and account pages are unchanged in 7V-1;
  they move in 7V-2.
- Screen readers were not tested by hand. The landmarks, labels, focus order and skip link were checked by the
  gates' role- and label-based selectors only.

## 7V-2 — every other screen (not started; waits for the user's approval of 7V-1)
