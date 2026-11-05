# Chunk 7U verification — UX foundations (themes, languages, command palette, glossary, accessibility)

5 November 2026. **7U is CI-verified** in [CI #86](https://github.com/Adityapawar5105/rebatehq/actions/runs/42061581577) on `b2d273a`. 7U is defined in blueprint v2.3 (decision 14, section 6 "Experience layer") and the execution plan. No migration, no local vault schema change, no blueprint change.

## What was built

### Message-key i18n
- **Catalogs:** `lib/i18n/locales/en.ts` is the source.
  - 1,631 keys covering every product screen, the account and sign-in pages, worker errors, import and Fix Later issues, leak findings, show-the-math formulas, the 7-day checklist, the health score, the Leak Report, and the control-plane API errors those pages show.
  - Spanish (`es.ts`, Latin American, formal *usted*) and French (`fr.ts`) translate every key.
  - Canadian French (`fr-CA.ts`) overrides only 21 messages (*courriel*, *soumission*, *téléverser*) and falls back to `fr`.
  - `tsc` enforces complete catalogs through the `Catalog` type.
- **Plurals and placeholders:** plural messages are `{ one, other }`, chosen by `Intl.PluralRules`. Placeholders are `{name}`, and numbers passed as parameters are formatted by `Intl`.
- **Worker text** (`lib/i18n/core.ts` `msg()` / `say()`):
  - Text created in the vault worker reads as English and carries its message key and parameters invisibly, as Unicode tag characters between two U+2063 marks.
  - The UI renders it in the chosen language with `say()`.
  - Exports, logs and unit tests see plain English, and `plainText()` strips the reference.
  - Nested references (a role inside a sentence) and joined references both translate.
- **Language-neutral by design:**
  - ERP price exports and the change log (headers and values unchanged).
  - Audit-log entries (codes and IDs only).
  - Mapper header synonyms and Playground data.
  - The invitation e-mail body: the recipient's language is unknown.
- **Language choice:**
  - Header picker on every screen, plus Settings → Language and appearance.
  - Kept in `localStorage` and a first-party cookie, so server-rendered account pages match. Initial default: the browser language when shipped, else English.
  - `<html lang>` follows the choice.
  - Server pages use `serverT()` (cookie, then Accept-Language).
  - Client screens render English during hydration, then apply the stored choice.
- **Intl formatting:**
  - **Counts:** grouped. The raw value stays in `data-value` for tests.
  - **Money:** exact cents with locale separators, using Intl's exact decimal-string formatting, no floats.
  - **Currency symbols:** only where the UI showed `$` before (Margin, Leak Report). USD is assumed there because the vault has no currency column yet.
  - **Percentages, dates, date-times, month names and lists:** formatted per language.
- **Leak Report PDF:**
  - Built in the worker in the user's language.
  - The PDF writer now encodes WinAnsi characters (é, ñ, ç, œ, «, €) as octal escapes instead of replacing them with `?`.
- **Pseudo-locale** (test only):
  - Accents every letter, pads by about 35% and brackets each message as `⟦…⟧`.
  - Offered in the lab harness picker, and selectable through stored preference.

### Theme tokens
- `app/theme.css` defines about 45 tokens for light, dark (also used for system dark) and high contrast.
- Both stylesheets (`vault.module.css`, `globals.css`) now use only tokens, as do inline chart and SVG colours.
- The theme picker offers system, light, dark and high contrast. The choice is kept in a cookie, so the server renders the right theme without a flash.
- `prefers-reduced-motion` and `forced-colors` are respected.

### Command palette
- Ctrl/Cmd+K, or the header button, opens a native `<dialog>` (focus is trapped; Escape closes).
- **Contents:**
  - screens your role can open;
  - commands: glossary, save, lock, each language, each theme;
  - SKU and customer hits from a new role-checked worker command, `search`.
- **`search` command:**
  - Needs the `view` capability and is allowed while read-only.
  - Reads IDs and names only, never cost or price.
  - Escapes `%` and `_`; at most 80 characters; 8 hits per kind.
- **Picking a hit:** opens Margin filtered to it if your role sees cost; otherwise it shows the SKU or customer name inline.
- **No free text:** typing only filters the list.

### Finance glossary
- 27 fixed terms with plain-language definitions in every language (`lib/ui/glossary.ts`, `components/local/Glossary.tsx`).
- A glossary card on Home, visible to every role.
- `<Term>` explain buttons (`aria-expanded`, Escape to close) beside:
  - the waterfall, margin rate and drill-down columns;
  - the whale curve, leaks and ROI;
  - the Home totals.

### Accessibility pass
- Visible-label names for the pricing inputs (label in name, WCAG 2.5.3).
- `scope="col"` on every table header, and screen-reader names for action columns.
- `translate="no"` on user data.
- Focus-visible outlines from the `--focus` token; the palette and glossary are keyboard-operable.
- Language of parts set on the language names.
- No colour-only signals: guardrail colours keep their text labels.
- Every theme passes contrast (below).

## Tests added
- **`tests/i18n.test.ts`** (9 tests):
  - **Hard-coded strings:** a TypeScript-AST scanner over the whole product UI (out of scope on purpose: the legacy pages behind the default-off flag, `app/dashboard` and the engine spike) finds no hard-coded user-facing string. It checks JSX text, visible attributes, strings inside JSX expressions, state-setter arguments and thrown errors. A probe file proves it catches each of those shapes.
  - **Catalog completeness:** every key is present in es, fr and fr-CA, with the same placeholders and plural shape.
  - **Real translations:** at most 2% of prose messages are unchanged English.
  - **No unused keys,** and every glossary term has a name and a definition.
  - **Pseudo-locale:** brackets every message and keeps its placeholders.
  - **Message references:** round-trip, including nested, joined and non-ASCII parameters.
  - **Plural rules:** French 0 and 1 are singular.
  - **Intl output:** exact for large cents, French separators, fr-CA currency, dates in each language.
- **`tests/theme.test.ts`** (4 tests):
  - Every theme has the same tokens, and system dark equals dark.
  - **WCAG contrast:** text pairs at least 4.5:1 (7:1 in high contrast); controls and focus at least 3:1.
  - No colour literal anywhere outside `app/theme.css` in product CSS or TSX.
- **Browser gate** (`scripts/test-vault-browser.mjs`), new 7U block on the real production build:
  - **Pseudo-locale sweep:** sets the pseudo-locale, reloads, unlocks, then visits Home, Data Hub, Margin, Pricing, Reports and Settings. On each screen it collects every visible text node and attribute not marked `translate="no"`; any word outside a `⟦…⟧` bracket fails. Intl-formatted dates are allowed, because pseudo uses en-US formats.
  - **Language switch:** the picker changes to French and the navigation and headings follow. The downloaded Leak Report PDF is French (with encoded accents) and contains no English title. Spanish, Canadian French and English switch the same screen.
  - **Themes:** dark and high contrast change the rendered colours, and system clears the attribute.
  - **Command palette:** opens with Ctrl+K, filters screens, and finds the test's SKU from the vault.
- **Existing tests adjusted** (no weakened assertions):
  - Counts are read from `data-value`.
  - Tier names are capitalised ("Licensed: Scale").
  - Pricing inputs are found by their visible labels.
  - Mapper problems and cleanup notes are compared as `plainText()`.
  - The reconciliation level shows its display name.
  - `tests/http-boundary.test.js`: language catalogs are skipped by its SQL-word scan (prose such as "update the app") but must stay data-only, with no value imports.

## Local validation (5 Nov 2026, Windows 11, Ryzen 5 5600H)

| Check | Result |
|---|---|
| `tsc --noEmit` | Passed |
| `node --test tests/*.test.js` | 78 passed |
| `tsx --test tests/*.test.ts` | 144 passed (adds 13: 9 i18n, 4 theme) |
| `check-migrations-lock` / `check-schema` / `check-service-role` | Passed: 11 applied, 0 pending; 24 live tables; 201 files |
| `scripts/test-vault-browser.mjs --browser=chrome` (production build, lab route, local licence keys) | **Passed**, including `i18nUi` (pseudo sweep of six screens, fr/es/fr-CA/en, French PDF, four themes, palette) and the existing privacy checks |
| `scripts/test-relay-browser.mjs --browser=chrome` | Passed 11 checks (local PGlite transport; auth unverified) |

## CI evidence

[CI #86](https://github.com/Adityapawar5105/rebatehq/actions/runs/42061581577) on `b2d273a` passed:
- 78 JS and 144 TS tests;
- pgTAP `1..152` twice;
- the authenticated local-vault privacy gate (`"auth": true`, real local Supabase Auth), including the new `i18nUi` check (pseudo-locale sweep, French/Spanish/Canadian French, French Leak Report PDF, four themes, command palette);
- the relay gate: "11 checks passed (chromium, real authenticated local Supabase)".

## Not verified yet
- **Edge:** CI runs Chromium only, and Edge was not run locally this time.
- **Native-speaker review** of Spanish, French and Canadian French: the translations are machine-assisted. Blueprint section 13 requires review before a language ships to a pilot.
- **Screen-reader testing** was not done (NVDA, JAWS, VoiceOver). Contrast was computed from tokens, not measured on screen.
- **Edge** was not run locally for the browser gate this time.
- **Legacy pages** (`app/legacy/**`, behind the default-off flag, retired in 8R) were not translated.

## Decision recorded after 7U
Blueprint decision 16 says nothing shown to a sales rep may reveal cost or margin %. Chunk 5A's toggle "Let Sales Reps see cost and margin (off by default)" contradicts it. On 6 Nov 2026 the user agreed to remove it at the start of 7B (blueprint section 22, item 21); 7U leaves it unchanged.
