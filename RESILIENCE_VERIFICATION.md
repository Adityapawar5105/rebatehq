# Licence and vault resilience verification

Built by Claude Code, 20 November 2026, after the 16–17 November product review. It covers audit items B-2, B-6, B-8, B-10, B-11 and X-4. No blueprint change, no vault schema change and no Supabase migration.

**It passed CI** in [CI #178](https://github.com/Adityapawar5105/rebatehq/actions/runs/44801085014) on `ec651af` (PR #8), 21 November 2026 (Asia/Kolkata):
- 387 unit tests (78 JS + 309 TS);
- the 139-check pgTAP plan, twice on real Postgres;
- **70 authenticated Chromium vault checks** and **67 Firefox lab checks**, both including the new `licenceOutageUi`;
- **12 real-authenticated local-Supabase relay checks**;
- the high/critical dependency audit.

Local vault v21 / 61 tables (unchanged); 14 locked migrations, 0 pending; no restore drill needed.

## What was built

- **Licence outages (B-2).** `failedReply` in `lib/licence-cache.ts`:
  - a 5xx, 429 or 408 reply, a timeout, or a non-JSON body keeps the saved licence inside its offline allowance;
  - only a refusal (any other 4xx) or an invalid signature clears it.
- **Read-only commands (B-6).** `leaks`, `reconcile` and the role seeding write only while the licence is writable. `benchWithdrawn` is no longer listed as read-only.
- **Unlock (B-11).** If the engine fails after the passphrase decrypted the vault, the error is `ENGINE` with its own message, not "wrong passphrase".
- **Client (X-4).**
  - `VaultClientError` keeps the worker's error code.
  - A worker that dies, or never answers within 45 seconds, shows a Reload card.
- **Auto-lock (B-8).**
  - Wheel and scroll count as activity.
  - The worker posts `locking` one minute before the idle lock, and the page offers "Stay unlocked".
  - The idle lock never cancels a running request: it waits for the request to finish, then warns and locks a minute later unless the person comes back (`graceLock`).
- **Invite cookie (B-10).** Deleted on the `/auth/callback` path it was set on.

## Not done

- **B-9, the sign-in rate-limit key.** Netlify's documentation does not say which client-IP header is set by Netlify and cannot be supplied by the caller. A live test would send real sign-in emails from staging. The code is unchanged until a safe check is possible (for example a header-echo route on a preview deploy).

## Tests

- `tests/resilience.test.ts`:
  - each licence reply class, with a stubbed `fetch` and `localStorage`;
  - the read-only guards and the engine-failure message;
  - the warning and grace-lock timers;
  - the worker's in-flight rule;
  - the cookie path and the client error code.
- Browser gate `licenceOutageUi` (Chromium and Firefox): with `/api/licence` returning 503, a reload and unlock leave the vault writable, with "offline grace" shown.
