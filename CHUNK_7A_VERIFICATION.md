# Chunk 7A verification — ciphertext-only collaboration relay

5 November 2026. **Local evidence; pending RebateHQ CI and a user-run Restore Drill.** The new migration `20261105130000_chunk7a_ciphertext_relay.sql` stays *pending* in `migrations.lock` until both pass, then it is locked in a follow-up change. Design: [RELAY_DESIGN.md](./RELAY_DESIGN.md).

Built by Codex from `CODEX_PROMPT_7A.md`. Codex hit its usage limit before committing. Claude Code then checked the uncommitted work, reran the checks below and committed it. The concurrent blueprint v2.3 draft (BLUEPRINT.md, BLUEPRINT_EXECUTION_PLAN.md, AGENTS.md) is a separate change and is **not** part of this commit.

## What was built

- **Migration (new; no locked migration edited):** adds a composite unique key on `licence_device` for a tenant-safe foreign key, and four tenant-scoped tables with forced RLS, audit coverage and exact ACLs.
  - `relay_device_key`: public agreement and signing keys plus a possession proof, bound to a 5B licence device.
  - `relay_epoch`: signed membership epochs.
  - `relay_key_wrap`: the workspace key wrapped per recipient device.
  - `relay_event`: signed, hash-chained events.
- **Content is ciphertext only.** Every content column is `bytea` ciphertext, a signature, a hash or a public key.
- **Metadata the server can see:** tenant, sender, recipient and mention user IDs, object kind (`quote`, `price_change` or `rebate`), sizes and timestamps. RELAY_DESIGN.md lists this inventory honestly.
- **Two gate functions:** `relay_allowed` and `relay_directory`. They require a signed actor, an active seat and a Professional or Scale licence (blueprint section 14). They are registered in `config/function-acl-allowlist.sql`.
- **Worker client:**
  - Device keys, verified fingerprints, the wrapped workspace key, and rotation when a member is removed.
  - Signed events with replay and order checks.
  - Sharing, approvals and comments:
    - Approvals have one or two levels with preset thresholds, evaluated on the device.
    - Users cannot approve their own requests, and the second level cannot run first.
    - Comments carry @mentions and feed an inbox.
  - An outbox that survives a lost acknowledgement without sending twice.
  - Behind `RELAY_ENABLED` (default off). The local vault moves to schema v9.
- **Restore tooling:**
  - The seed adds encrypted relay rows.
  - The equivalence check compares content hashes of all four relay tables.
  - The table minimum is 24.
  - The drill's ACL checkpoint now also covers `relay_allowed` and `relay_directory`.
  - `restore-drill.yml` is unchanged.
- **pgTAP:** 152 fresh / 155 restore-mode checks (was 113 / 116), including `supabase/tests/chunk7a_relay.sql`.
- **CI:** adds `node scripts/test-relay-browser.mjs --auth --browser=chromium`. It runs the relay round trip against real local Supabase Auth and HTTP.

## Local validation (5 Nov 2026, Windows 11, Ryzen 5 5600H, ~8 GB)

| Command | Result |
|---|---|
| `tsc --noEmit` | Passed |
| `node --test tests/*.test.js` | 78 passed. This includes the full pgTAP SQL in PGlite with stubs (152 fresh and 155 restore checks, twice each, no row residue) |
| `tsx --test tests/*.test.ts` | 127 passed. This includes relay crypto, state, session, database and harness tests |
| `check-migrations-lock` | Passed: 10 applied, 1 pending (7A) |
| `check-schema` | Passed: 24 live tables (22 retired) |
| `check-service-role` | Passed (187 files) |
| `scripts/test-relay-browser.mjs` (Codex run) | Chrome 156.0.8078.80 and Edge 156.0.4314.58 each passed **11 checks**: three device keys, verified fingerprint join, no self-approval, ordered levels, two-level approval, one-level boundary, comment/mention inbox, reload with encrypted keys, every relay column scanned for plaintext, scanner negative controls, and request/header/body/console scan. **Transport was local PGlite, not authenticated Supabase.** |

## CI findings and fixes

- **CI #79** (`ff2d5c6`) failed in the authenticated gate before any relay traffic: `test-relay-browser.mjs` passed the `postgresql://` seed URL to the web-only `localUrl` check. Fixed in `6b05b0d` with a separate `localDatabaseUrl` check (loopback host, Postgres scheme) and a regression test.
- **CI #80** (`6b05b0d`) passed 78 JS and 128 TS tests and pgTAP `1..152` twice. The relay gate then failed at "Set up this sharing device": the browser's first relay POST got a plain-text 403 from the proxy's CSRF origin check. That check compared `Origin` with `request.nextUrl.origin`, which is `0.0.0.0` when the app is started with `--hostname 0.0.0.0` (as in CI and containers). This was a real product bug for any `0.0.0.0`-bound deployment, sign-out included, not only for the relay. The local harness never hit it because Playwright answered `/api/relay` itself.
  - **Fix:** `proxy.ts` now compares the origin's host with `X-Forwarded-Host`, else `Host`, as Next.js does for Server Actions. Cross-site, wrong-port, malformed and non-http origins are still refused.
  - **Tests:** `tests/proxy-origin.test.ts`.
  - **Production build check:** a same-origin POST to a `0.0.0.0`-bound server now reaches the route, and a cross-site POST still gets 403.
  - Recorded as SECURITY_REVIEW.md R15.

## Not verified yet

- **CI:** the real-Postgres pgTAP suite, the authenticated relay browser gate and the authenticated privacy gate.
- **The user-run Restore Drill** with the encrypted relay seed.
- **The customer-track gate** ("ask pilots before 7A") was not met; no pilot exists. The user chose to proceed (ASSUMPTIONS.md).
- **No hosted deployment;** `RELAY_ENABLED` is off by default.
