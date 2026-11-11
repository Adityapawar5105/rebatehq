# Safari desktop verification spike (8D, blueprint v2.6 gap 5)

**Status (11 November 2026): not run on Safari.** No Mac was available, so the user chose a WebKit pre-check only. Safari desktop is **not** supported, claimed or advertised (decision 5, section 13).

## WebKit pre-check on Windows (not Safari)

`scripts/webkit-precheck.mjs` ran Playwright's WebKit 27.2 build on Windows against a production build in lab mode at `http://127.0.0.1:3100`. Results are in `test-results/webkit-precheck.json` (git-ignored).

| Check | Result |
| --- | --- |
| Cross-origin isolation | yes |
| OPFS directory API | yes |
| `navigator.storage.persist` | available |
| SharedArrayBuffer (DuckDB-Wasm threads) | yes on the first run; no once the gate rewrote response headers, so not settled |
| Create vault, import, persist after reload, offline service worker | **not reached** |

**Why the app did not start.** WebKit upgraded every `/_next/static` subresource on `127.0.0.1` to `https://` ("SSL connect error"). It did so even after the pre-check removed `upgrade-insecure-requests` and `Strict-Transport-Security` from the responses. Chromium does not upgrade loopback addresses. Production runs on https, where this cannot happen.

**What it tells us.** The pre-check confirms the APIs exist in this WebKit build. It cannot say whether the vault works.

## The real spike (needs a Mac with Safari, over https)

1. Deploy a staging build over https, or run it locally behind a trusted TLS proxy.
2. In Safari, open the app, create a vault, import a 100k-line CSV, lock, quit Safari, reopen, and unlock. Record whether the data is still there (OPFS persistence) and the import time.
3. In the console, record `crossOriginIsolated` and `typeof SharedArrayBuffer`. Record whether DuckDB-Wasm loads its threaded (COI) bundle or falls back.
4. Request persistent storage and record the answer. Leave Safari idle for 7 days and check whether the vault survives eviction.
5. Load the app once online, then go offline (Wi-Fi off) and reload: does it open from the offline copy (8C-2)?
6. Record Safari version, macOS version, and each result here.

Claim Safari desktop support only if steps 2–5 pass, and record that as a blueprint section 22 entry.
