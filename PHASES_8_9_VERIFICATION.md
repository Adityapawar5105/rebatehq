# Roadmap phases 8 and 9 (rest) and 10.1: verification

21 November 2026 (Asia/Kolkata). Built by Claude Code from the post-review roadmap, in order, on the user's instruction to complete each phase without skipping. **Local runs are not CI evidence**; the CI lines below are.

## What CI verified

| PR | What | CI `verify` | Commit |
|---|---|---|---|
| #13 | Phase 8 rest: 8.1, 8.3 to 8.7, 8.10, 8.12 to 8.18 | [CI #191](https://github.com/Adityapawar5105/rebatehq/actions/runs/44884770133) passed | `8baa2e8` |
| #14 | Phase 9 rest: 9.2 to 9.6 | [CI #192](https://github.com/Adityapawar5105/rebatehq/actions/runs/44886032440) on `000b297`, then [CI #195](https://github.com/Adityapawar5105/rebatehq/actions/runs/44886940643) on the commit merged with Phase 8 | `0fc0de8` |
| #15 | 10.1 `SHARING_DESIGN.md` (documentation only) | [CI #193](https://github.com/Adityapawar5105/rebatehq/actions/runs/44886079314) passed | `5c59a90` |

Each `verify` job ran:
- typecheck and the unit tests;
- the high/critical dependency audit and the migration-hash check;
- pgTAP against a clean local Supabase;
- the required authenticated Chromium privacy gate;
- the required Firefox lab gate.

## Local checks, before each push

- **Phase 8:** 320 TS and 78 JS unit tests passed, and the production build (webpack) succeeded. The Chromium lab gate passed with 71 named checks, including the new `phase8Ui` and the extended `quoteFlowUi`.
- **Phase 9:** 323 TS and 78 JS unit tests passed. The Chromium lab gate passed with 70 named checks; its branch did not yet contain Phase 8.
- After merging main into Phase 9: typecheck passed, and the affected test files (i18n, state, roles, quotes, tabs, guidance, recovery, resilience) passed.

## New checks added

- **Unit tests:**
  - tab key rule;
  - `SCANNED_PDF` survives the file-name prefix;
  - skipped-page counts;
  - `relayLocal` sync fields;
  - `fmt.bytes` in four locales;
  - the read/write command table;
  - the vault phase rule;
  - the warm-up states with a stub engine;
  - the query state machine;
  - the benchmark withdrawal marker.
- **Browser gate, `quoteFlowUi`:**
  - the answer pill in Price Check and on the quote;
  - ArrowRight between the quote tabs;
  - the line thermometer only after Price position is opened;
  - New quote asking before discarding a typed price.
- **Browser gate, `phase8Ui`:**
  - a scanned PDF is reported beside the drop zone, with no banner at the top;
  - Settings › Storage shows a size;
  - signed in (CI only), an account page uses the vault frame and fits a 375 px phone.

## Decisions and deviations recorded

- **D7:** only UI batch 3 had the user's explicit yes. Batches 4 and 5 and the chat's 8.13 to 8.19 were taken on the roadmap's recommendation, under the instruction to continue the plan.
- **8.3:** the roadmap asked for one no-behaviour-change commit per file, with the browser gate unchanged.
  - Pricing and Cleanup were done that way.
  - Quotes, Relay and Import Studio share commits with 8.4 to 8.7, 8.13 and 8.14.
  - The quote and relay tabs became role=tab, so both gates click them as tabs.

## Limits (not verified, or verified only locally)

- **8.4:** a relay conflict needs the server's head, so it shows only after the inbox has been opened once in the session.
- **8.12:** the account frame is checked only in the signed-in CI gate; no manual pass on a real phone.
- **9.6:** a benchmark share the server stored but the vault did not record is not reconciled. A later withdrawal deletes every server quarter anyway.
- **10.1 is a design only.** Building it waits for decision D1 and approval of the design (roadmap 10.2).
- **Next.js advisory:** a local `next build` once stopped with a message that the installed Next.js has a known advisory and asked to run `next upgrade --agent=security`. It was not run, and has been reported to the user. CI's high/critical dependency audit passed on every run above.

No schema, migration or blueprint change in phases 8 and 9.
