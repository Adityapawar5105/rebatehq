# Team sharing S5b: threads and tasks on screen — verification

Built by Claude Code on 26 November 2026 on top of S5a (`docs/evidence/SHARING_S5A_VERIFICATION.md`). There is no worker protocol, server or schema change.

## What it adds

**Discuss** (`components/local/Threads.tsx`):
- **Where it appears:** a button on each row of the Data Hub customer and item grids, on an open quote, on each leak finding (Margin) and on each supplier claim.
- **What it opens:** a dialog with the threads about that object. From there you can:
  - start one, optionally as a task with an assignee and a due date;
  - reply;
  - resolve or reopen;
  - edit the task or mark it done.
- **Who it lists:** only people who receive that object's pack, for mentions and assignees.
- **Before it opens anything:** if this device has not joined sharing, or does not hold the pack, the dialog says so.
- **Counts:** the grids show a count of open threads per row, from one worker read per grid.
- **When it shows:** with sharing on, the `collaborate` capability and Professional or Scale.

**Threads and tasks** (a new tab in the shared inbox on Home):
- **For you:** mentions, replies in threads you wrote in, and tasks assigned to you, with an unread count and "Mark all as read".
- **Open tasks:** sorted by due date.
- **Activity:** who shared, approved, commented, published or worked on a thread, and when.
- All three lists use the shared grid (sort, filter, totals).
- **Unread badge:** the card shows the unread count beside "Open shared inbox".
- **Email notices:** a line says they are off until an email sender exists.

All strings are message keys in English, Spanish and French. Canadian French falls back to French.

## A relay bug found and fixed on the way (PR #41)

The S5b gate pushed the lab workspace past nine relay events, and the Sales Manager's next sync failed with "could not be verified".

- **Cause:** `relayHead` and `packHead` in `lib/relay/store.ts` selected `sequence::text AS sequence` and then ordered by `sequence`, which Postgres resolves to the text alias. So "9" sorted after "10".
- **Who it would hit:** every workspace past nine events. A pack's tenth version would also have broken publishing; with S4b deltas, ten publishes come quickly.
- **Fix:** the aliases are renamed. `tests/relay-head-order.test.ts` covers twelve events and eleven versions of one pack; it fails without the fix and passes with it.
- **CI:** it passed [CI #264](https://github.com/Adityapawar5105/rebatehq/actions/runs/45689910186) on `1ecafdf` and merged as PR #41.

## Checks run locally (not CI evidence)

- **Relay browser gate** (lab mode, Chrome): **18 checks passed**. The new check, `threadsUi`:
  1. The Owner loads the Playground and opens Discuss on an item.
  2. The Owner mentions the rep and assigns them a task.
  3. The rep syncs and finds "Mentioned you" and "Assigned you a task" under Threads and tasks.
  4. The rep opens the thread, replies, marks the task done and marks all as read; the count reaches "0 unread".
  5. The Owner sees "Replied" with the rep's text.

  The gate's marker is scanned in every request and server row, so none of the thread text reached the server in plain form. `tests/relay-privacy.test.js` now pins 18 checks.
- **Suites:** full runs on the final code: TypeScript 400 of 400 and JS 80 of 80. `tsc --noEmit` is clean.
- **Vault browser gate** (lab mode, Chrome): **73 checks passed**, with the Discuss columns present in Data Hub. This ran before the review fixes below; those touch only the Discuss dialog, the fold and the quote target.
- **Relay browser gate re-run** after the review fixes: 18 checks passed.
- **Lab build note:** build and start with `NEXT_PUBLIC_SUPABASE_URL` set (see the S4b evidence). The lab shows Discuss without `RELAY_ENABLED`, because the lab has no server flag.

## Review fixes (before the PR)

- **A device that joined later:** it never holds the `open` event of an older thread. Later events on that thread are now skipped instead of rejected, because a rejection showed the sync status as a conflict. A test covers a log that starts after the open.
- **Note:** 7A's `fold` treats comments on references from before a device joined the same old way. It is left unchanged here.
- **Discuss renders its dialog only while it is open,** with a unique heading id, so a fifty-row grid holds no hidden dialogs. Clicks and keys inside the dialog do not reach the grid row.
- **Quote threads are keyed by the quote's id,** because quote numbers are per vault. The label carries the number only: a quote thread is sealed under book prices, and the customer's name belongs to the customers pack.
- **The worker's relay event now refreshes the open thread views.** New threads arrive on the 60-second poll, or on the doorbell when a pack also changed; thread events do not ring the doorbell themselves. With the doorbell joined, the safety poll is about 10 minutes, so a new thread can take that long to appear without a Sync.
- **Canadian French** uses "Soumission" and "courriel"; France French uses "e-mail", as elsewhere.

## Not verified

- Native-language review of the new Spanish and French strings.
- Threads on contract prices, guardrails, cost and vendor reviews: the targets exist in the protocol, but no screen has a Discuss button for them yet.
- A real email sender, and "who's viewing" (not built).

## CI

[CI #267](https://github.com/Adityapawar5105/rebatehq/actions/runs/45693771972) passed on `d53d3e2` (PR #42), 26 November 2026. All four jobs passed:
- unit tests, audit and build;
- database tests and the Chromium privacy and relay gates, against real Supabase with `--auth`, including `threadsUi`;
- the Firefox lab gate;
- `verify`.

PR #42 was merged into `main`.
