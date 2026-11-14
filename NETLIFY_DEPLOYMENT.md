# Netlify deployment

Requested 14 November 2026: deploy the full Next.js app with real Supabase sign-in, not the synthetic Scale lab. Deployment and hosted sign-in remain **unverified** until a live run proves them. No migration, migration hash or application data needs to change to host the app.

## Build and privacy boundary

`netlify.toml` uses `pnpm run build` (including `prebuild`, which self-hosts the workers and embeds the public licence verification key) and `.next`. Netlify supplies the Next.js/OpenNext adapter. Do not upload `.next` through a static-file drop: callbacks, nonce CSP, server-side sessions and licence issuance require the adapter's functions.

Set the public verification key **before** building. A worker built with a different key rejects the licence and leaves the vault read-only. Keep the existing nonce CSP, COOP and COEP; the extra `/spike/*` headers cover the self-hosted workers and WASM. Never upload `.env*`, `.claude/`, local browser profiles, `test-results/`, real ERP files, vault snapshots or a database dump as public assets. Deployment does not copy the localhost vault; storage and encryption are tied to the new browser origin. Move an existing vault only through the app's encrypted backup/restore flow, with the correct signed-in workspace.

## Required environment (names only)

Configure these through Netlify's environment settings or secure CLI import. Keep private values scoped to server functions; public variables also need build scope:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_LICENCE_VERIFY_KEY`
- `APP_BASE_URL` (the exact HTTPS site origin)
- `APP_DATABASE_URL` (dedicated NOSUPERUSER/NOBYPASSRLS login, allowed to SET ROLE rebatehq_app; never the migration/admin URL)
- `ACTOR_SIGNING_SECRET` (must match the key installed in the database)
- `LICENCE_SIGNING_KEY` (private issuer key matching the public verification key)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (the production login route fails closed without distributed rate limiting)

Keep runtime `VAULT_LAB_ENABLED`, `LEGACY_BUSINESS_ENABLED`, `DEV_IMPERSONATION_ENABLED`, `RELAY_ENABLED` and `BENCHMARKS_ENABLED` false. The build configuration also defaults them to false. Relay/benchmarks can be enabled in a separate reviewed configuration change. Never deploy `SEED_DATABASE_URL`, `APP_DB_LOGIN_PASSWORD`, a service-role key, a Supabase admin password or CI fixture credentials to the app runtime. Invitations additionally need `RESEND_API_KEY` and a verified `EMAIL_FROM`. Public/customer launch needs the operator's Supabase SMTP and rate-limit review; do not assume default SMTP accepts arbitrary customer addresses.

The existing connected project is named `rebatehq-staging`. It has the 14 applied migrations, including 8R and the operator subscriptions migration. Treat it as staging; a real customer launch needs separately managed production services per OPERATIONS.md.

## Deploy and verify

1. Sign into Netlify CLI and create/link the intended site. CLI 27.19.0 was selected for this task; do not add the CLI to application dependencies. An authenticated Netlify account is required for this app's server/edge functions.
2. Configure the environment above in the selected site. Add the exact HTTPS `/auth/callback` URL to Supabase Auth's redirect allowlist, and set its site URL appropriately. Preserve other approved redirects.
3. Confirm all 14 locked migrations match (`node scripts/check-migrations-lock.mjs`). Check the existing restricted DB login and installed actor signing key; apply only missing setup, never replay old migrations onto a live schema.
4. Use Netlify's Linux builder with the selected GitHub repository connected and the site's build/runtime environment configured. `netlify deploy --remote --prod` requires that Git connection; it does not upload disconnected source. The local Next.js build passes, but adapter 5.16.6 encountered Windows symlink and drive-path errors while bundling middleware. Do not remove middleware or relax CSP to bypass them. Where local packaging is supported, use `netlify build --context production` followed by `netlify deploy --prod --no-build`. A first preview can omit `--prod`. `netlify build --offline` is not hosted deployment evidence.
5. Verify `/api/health` is 200, `/` leads to `/login` when signed out, nonce scripts hydrate, COOP/COEP and worker/WASM MIME headers are correct, and `/lab/vault` is 404. Check the licence endpoint rejects unauthenticated requests.
6. Complete a real magic-link login, create/select a workspace and assign its licence/seat using the existing pilot tooling. Confirm `/home`, workspace isolation, issuer verification, encrypted vault creation/unlock and local import privacy. Recheck sign-out and an invalid callback. Do not mark these verified from a successful build alone.

Netlify account authorization, complete runtime configuration, hosted magic-link delivery, callback exchange and the browser's worker/OPFS flow are release prerequisites. Keep them unverified until actually exercised; no static mock sign-in or lab licence is a substitute.

## Local preparation evidence — 14 November 2026

- A clean build folder was created alongside the app (`rebatehq-netlify-build-20261114`), with tracked source and the new Netlify config. No `.env*`, local vaults, `.claude/` or real input files were copied. A fresh frozen-lockfile dependency install was used after Turbopack correctly refused a dependency junction outside that folder.
- Netlify CLI 27.19.0 and npm 11.6.2 are ephemeral tooling, not application dependencies. `netlify build --offline --context production` selected Next.js adapter 5.16.6, compiled Next.js 16.4.3, passed its TypeScript phase and generated all routes. Adapter packaging failed with Windows `EPERM` on a required symlink. A staging-only workaround materialized generated standalone dependency links; public hoisting then resolved `styled-jsx`, and function bundling passed. Edge middleware bundling still failed because its CommonJS compiler misinterpreted a Windows drive path. This is **not a successful Netlify build or deployment**. No workaround changed application auth/CSP or production source. Use the Linux builder.
- `node node_modules/typescript/bin/tsc --noEmit` passed. `node --test --test-concurrency=1 tests/*.test.js` passed 78/78. `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts` passed 283/283 (361 unit tests total, zero failures/skips). `node scripts/check-migrations-lock.mjs` passed (13 locked / zero pending), `node scripts/check-schema.mjs` passed (13 live tenant tables), and `node scripts/check-service-role.mjs` passed (278 files; expected warnings for absent optional src/pages directories).
- The connected staging project's 13 applied migration entries match the repository. No migration SQL or lock hash changed. The user reset the database password and saved it in the git-ignored local environment; no administrator credential was uploaded to Netlify.
- Database TLS verification initially failed with `SELF_SIGNED_CERT_IN_CHAIN`. The public Supabase Root 2021 CA was fetched over HTTPS from the official URL in `certs/README.md`, SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. With this CA and `rejectUnauthorized: true`, the corrected administrator connection succeeded. The deployment setup created `rebatehq_netlify_login` with LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE and NOREPLICATION. Its only membership is `rebatehq_app` with INHERIT FALSE / SET TRUE. A real transaction-pooler connection, using that login and SET LOCAL ROLE, returned zero tenant rows without context. The private actor-key table was empty; the matching actor signing key was installed and `verified_request_actor()` was exercised. The licence issuer/public key pair matches. These are direct hosted-database checks from this machine, not CI or hosted-function evidence.
- Netlify authorization is complete. Project `rebatehq-aditya` (`fad51375-b7e6-4511-bce7-2d0220ac2c82`) is created at `https://rebatehq-aditya.netlify.app`; application deployment is still pending. Runtime secrets and public build variables are configured; no admin DB URL or service-role key is present. `APP_DATABASE_URL` uses the US East transaction pooler, the restricted login, `sslmode=verify-full` and the included CA file. Confirm `/var/task/certs/supabase-root-ca.crt` actually resolves in the deployed function before marking hosted DB access verified.
- Free Upstash Redis database `rebatehq-staging-rate-limit` (AWS us-east-1, TLS) is configured for the sign-in limiter. The REST token is stored as a Netlify secret; no paid tier or payment method was activated. Supabase Auth's site URL is the exact Netlify origin, and the redirect list contains its exact `/auth/callback` URL. Email delivery, callback exchange, production licence/seat assignment, hosted-function DB access and worker privacy on Netlify remain **unverified** until exercised.

References: [Netlify Next.js adapter](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [CLI deployment](https://cli.netlify.com/commands/deploy/), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Staging verification — 14 November 2026 (Claude Code)

The production deploy of `b0bd94b` (Netlify deploy `6af843f434aef2ddc58c3bb6`, built by Netlify's Linux builder from the connected GitHub repo) is live at `https://rebatehq-aditya.netlify.app`. These checks were run against the live site and the hosted database; they are not CI evidence.

**Site access.** Netlify team login protected every deploy, including production, so no pilot user could reach the sign-in page. At the user's choice it now protects only non-production deploys (`sso_login_context=non_production`): production is public and RebateHQ's own sign-in decides access, while preview and branch deploys still require Netlify team login.

**Live site** (anonymous requests):
- `/api/health` returns 200 from the hosted function.
- Every page carries a per-request nonce CSP: the nonce changes on each request, 16 inline scripts carry it, `frame-ancestors 'none'` is set, `'unsafe-inline'` is not allowed for scripts, and HSTS is on.
- COOP `same-origin` and COEP `require-corp` are on every page and API response. `/spike/vault-worker.js` is served as `application/javascript` and `/spike/duckdb-eh.wasm` as `application/wasm`, both with CORP `same-origin`.
- Signed-out `/` and `/home` send the visitor to `/login`. Because the app has a root `loading.tsx`, Next.js streams this redirect (`NEXT_REDIRECT;replace;/login;307` plus a meta refresh) with HTTP status 200 rather than sending a 307 header.
- `/lab/vault` and `/legacy/rebates` render the not-found page; the lab vault and legacy page content are never sent. For the same streaming reason the status is 200, not 404. An unknown path returns a real 404.
- `/api/quotes` returns the fixed 410; `/api/relay` and `/api/bench` return 404 (both are off); `/api/licence` refuses an unauthenticated request (400); an invalid `/auth/callback` code redirects away without a session.

**Hosted database** (`rebatehq-staging`):
- All 13 locked migrations are recorded under their file versions. A catalog fingerprint of the hosted schema matches a database built locally from the same files: columns, constraints, indexes, policies, triggers, function bodies, function owners and privileges, and table privileges. The only differences are the local engine's extra NOT NULL catalog rows, CRLF line endings in the local copy of the first migration, and Supabase's own default USAGE grants on `public` to its platform roles.
- `rebatehq_netlify_login` is LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE and NOREPLICATION, with one membership: `rebatehq_app`, INHERIT FALSE, SET TRUE.
- The installed actor signing key equals `ACTOR_SIGNING_SECRET` in the operator's environment file. The admin connection verified the server certificate against `certs/supabase-root-ca.crt`.
- **The full pgTAP suite passed on the hosted database: 136 of 136 checks, run twice.** Tenant table row counts, `auth.users` and the extension list were identical before and after. As in CI, the `postgres` login needed SET membership in `rebatehq_app` to run the suite; that one grant was added (granted by `postgres`) for the runs and then revoked, leaving Supabase's original membership unchanged.
- Supabase security advisors: five INFO notes for RLS-enabled tables without policies, all in `rebatehq_private` (`actor_key` and the four benchmark tables), which deny every app and platform role by design; and one WARN that `prevent_audit_mutation()` has no fixed `search_path`. That trigger function only raises an error and reads no table. Fixing it needs a new migration, so it is recorded here rather than changed.

**Sign-in fix.** The first real sign-in failed with a 500 before any request reached Supabase. The rate limiter runs before input validation, and the Netlify `UPSTASH_REDIS_REST_TOKEN` was not a working token for `rebatehq-staging-rate-limit`. The user supplied the REST token (not the read-only one) through the git-ignored operator file. It was checked against Upstash for PING, SET with expiry and EVAL (the rate limiter needs all three), stored as a Netlify secret for every context through the API without being printed, and the site was rebuilt (deploy `6af849c41105814a0f24319a`, same commit). An invalid email then reached validation (400), and no email was sent by that probe.

**Hosted end-to-end run, 14 November 2026** (the user, in a real browser on the production URL):
- The magic-link email arrived and the callback created a session; the account's email is confirmed in `auth.users`.
- The setup page created workspace `RAMBO` through `/api/tenants`, which runs as `rebatehq_netlify_login` under `rebatehq_app`. This proves the hosted function's TLS-verified database connection with the bundled CA. The `tenant.insert` and `membership.insert` audit rows carry the user as actor, so the server's `ACTOR_SIGNING_SECRET` matches the key installed in the database.
- `scripts/issue-licence.ts` (operator, admin connection) issued a **Scale pilot licence valid until 14 February 2027** with the owner's seat; `workspace_licence.insert` and `licence_seat.insert` are audited. No payment was processed.
- After a reload, `/home` loaded and the user created an encrypted vault. The browser verified the signed licence with the public key built into this deploy, and the owner's first device registered as `active` (`licence_device.insert`, actor = the user). The server still has only its 13 control-plane tables; no business data reached it.

**Still unverified on staging:** invitations (Resend is not configured, so invite email delivery is off), a second user and device, sign-out and an expired or reused magic link on this origin, the relay and benchmarks (both deliberately off), and a hosted Restore Drill.

**14 November 2026 (later).** The Netlify site is now named `rebatehq`, so production is at **https://rebatehq.netlify.app**; the old `rebatehq-aditya.netlify.app` address returns 404. Supabase Auth's site URL and redirect list must use the new origin (`https://rebatehq.netlify.app` and `https://rebatehq.netlify.app/auth/callback`), or magic-link sign-in returns to the dead address. Netlify also refuses every build that a Git push starts ("Build blocked: Unrecognized Git contributor"): `9ce1df3` on main and every PR #1 preview, including `127a731`, which has no co-author line and is authored by the owner's own linked GitHub account (`Adityapawar5105`). The only successful builds of `b0bd94b` were started manually or through the API. Production therefore still served `b0bd94b`. **Resolved by 15 November 2026:** the PR #1 previews of `ceea3af`, `4ad0960` and `624ce1f` built from Git, and merging PR #1 built and published the merge commit `d33da28` to production automatically.

## Sign-in for testers on other devices (14 November 2026)

**What went wrong.** Testers got "We couldn't send a sign-in link", and a link that did arrive bounced back to `/login`:
- Supabase's built-in mailer allows only a few emails per hour for the whole project (`429 over_email_send_rate_limit` in the auth log).
- Netlify `APP_BASE_URL` still named `rebatehq-aditya.netlify.app`, and Supabase allowed only `https://rebatehq.netlify.app`. So every link fell back to the Site URL root, which sent the visitor to `/login` and dropped the code.
- Supabase's default link is PKCE: it only works in the browser that asked for it, not on another laptop or a phone's mail app.
- On Netlify, `request.url` in a route handler names the deploy host (`main--rebatehq.netlify.app`), not the address the visitor opened. The callback built absolute redirects from it, so it saved the session cookies on `rebatehq.netlify.app` and then sent the browser to `main--rebatehq.netlify.app/home`, which had no session and showed the login page again. Found on the live site on 15 November 2026 after PR #1 was deployed.

**Fixed.**
- Netlify `APP_BASE_URL` = `https://rebatehq.netlify.app`.
- Supabase redirect URLs include `https://rebatehq.netlify.app/auth/callback**`.
- The app finishes a sign-in from `/`, `/login` or `/auth/callback`, accepts server-verified `token_hash` links, and tells the user why a link failed.
- Auth redirects (callback, logout, dev impersonation stop) use a relative `Location` (`lib/see-other.ts`), so the browser stays on the address it opened.
- **Pending, after custom SMTP:** Supabase lets the **Magic link** and **Confirm signup** templates be edited only once custom SMTP is set up. Then change both to link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`, which works on any device. Until then the default PKCE link works only in the browser that asked for it; opened elsewhere, the login page says so.

Template body used for both (subject "Your RebateHQ sign-in link" / "Confirm your RebateHQ email"):

```html
<h2>Sign in to RebateHQ</h2>
<p>Use this link to sign in. It works once, expires in an hour, and works on any device or browser.</p>
<p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in to RebateHQ</a></p>
<p>If you did not ask to sign in, you can ignore this email.</p>
```

**Email sender (owner action).** Use custom SMTP so testers are not limited to a few emails per hour. With Gmail:
1. Turn on 2-Step Verification for the Google account, then create an app password at https://myaccount.google.com/apppasswords.
2. In Supabase → Authentication → Emails → SMTP Settings, enable custom SMTP: host `smtp.gmail.com`, port `587`, username = the Gmail address, password = the app password, sender email = the same Gmail address, sender name `RebateHQ`.
3. In Supabase → Authentication → Rate Limits, raise "emails sent per hour" (for example 100).

Gmail allows about 500 messages a day. The app password is a secret: it goes only into the Supabase dashboard, never into this repo or chat.
