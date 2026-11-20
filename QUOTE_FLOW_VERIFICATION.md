# Quote flow fix verification

Built by Claude Code, 20 November 2026, after the 16–17 November product review. It fixes the quote flow so a below-floor quote can no longer get stuck, and a price typed into a quote line is the price that gets submitted. No blueprint change, no vault schema change and no Supabase migration.

**It passed CI** in [CI #172](https://github.com/Adityapawar5105/rebatehq/actions/runs/44783777109) on `39ef75c` (PR #5), 20 November 2026 (Asia/Kolkata):
- 377 unit tests (78 JS + 299 TS), including the decision 16 scan with the new `quoteWithdraw` payload;
- the 139-check pgTAP plan, twice on real Postgres;
- **68 authenticated Chromium vault checks** and **65 Firefox lab checks**, both including the new `quoteFlowUi`;
- **12 real-authenticated local-Supabase relay checks**;
- the high/critical dependency audit.

Every job step passed. Local vault v21 / 61 tables (unchanged); 14 locked migrations, 0 pending; no restore drill needed (no Supabase change).

## The problem

A quote with a line below its floor went to `pending`, and then:
- the author could not edit it (lines are locked while pending) or withdraw it;
- nobody else could approve it unless sharing (the relay) was on, because each seat has its own vault;
- on the live site sharing is off, so "Share for approval" failed;
- Home did not list it anywhere.

Separately, a quantity or price typed into a quote line was saved only by "Update prices". Pressing Submit straight after typing sent the old lines.

## What was built

**Worker (`lib/quotes/quotes.ts`, `lib/vault/service.ts`).**
- `TRANSITIONS` lists every allowed status move, and `assertMove` is the one guard used by lines, submit, decide and withdraw. It copies the supplier-claims pattern (`lib/rebate/supplier.ts`).
- New command `quoteWithdraw` (capability `quote`, author only): `pending` back to `draft`, clearing the exception reason, any decision and the relay link. A decision on the old lines can never apply to the changed quote. Audited as `quote.withdrawn` with the quote ID only.
- `QuoteView.allowedNext` lists the moves this caller can make (`edit`, `submit`, `withdraw`, `decide`). It carries no price or cost.
- Win/loss: `won` is accepted only on a `submitted` or `approved` quote (`winloss.wonNeedsDecision`).

**Screens.**
- Quotes: Submit saves typed quantities and prices first, and "Unsaved line changes" shows while they differ from the saved lines. If a typed price puts a line below its floor, the reason box appears and nothing is sent until a reason is given.
- Buttons follow `allowedNext`. A pending quote has "Withdraw to edit". When the server has sharing off or the role cannot collaborate, a note says no one else can open the quote, instead of a share button that fails.
- Price Check (SKU and customer), New quote (customer) and Add line (SKU) use the `Lookup` type-ahead. Test IDs are unchanged.
- Home lists the author's own pending quote under "Action required" as "Awaiting approval" (number and customer only).
- Command palette: a Sales Rep (quotes, no cost) who picks a SKU or customer lands on Price Check with that field filled (`#quotes-check-product-<id>`, `#quotes-check-customer-<id>`).
- New strings in en, es, fr and fr-CA.

**Housekeeping.** The brand-name scan skips `.claude/`, and `.gitignore` ignores it: local agent worktrees under `.claude/worktrees` made the JS suite fail.

## Tests

- `tests/quotes.test.ts`: walks the whole moves table and `allowedNext`; withdraws a below-floor quote end to end (only the author, relay link cleared, nothing left to approve, edit and resubmit, a submitted quote is not withdrawn, Starter refused, one `quote.withdrawn` audit entry); `quoteWithdraw` added to the decision 16 scanned list.
- `tests/winloss.test.ts`: a pending exception cannot be marked won but can be lost.
- Browser gate `quoteFlowUi` (Chromium and Firefox): open the pending exception from history; exactly one of the share button or the sharing-off note is shown; withdraw it; type a new price without "Update prices"; Submit; the quote is `submitted`, the total equals the typed price, and the line is no longer editable.

## Not verified

- The screens were not exercised in a local browser before CI; CI's two browser gates are the evidence.
- Native-speaker review of the new Spanish and French strings (as for every string since 7U).
- A quote shared through the relay and then withdrawn leaves its ciphertext object on the relay; the local quote simply no longer links to it. A later decision on that object is ignored because `quoteRelaySync` acts only on a linked, pending quote.
