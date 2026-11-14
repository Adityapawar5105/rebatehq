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

The existing connected project is named `rebatehq-staging`. It has the 13 applied migrations, including 8R. Treat it as staging; a real customer launch needs separately managed production services per OPERATIONS.md.

## Deploy and verify

1. Sign into Netlify CLI and create/link the intended site. CLI 27.19.0 was selected for this task; do not add the CLI to application dependencies. An authenticated Netlify account is required for this app's server/edge functions.
2. Configure the environment above in the selected site. Add the exact HTTPS `/auth/callback` URL to Supabase Auth's redirect allowlist, and set its site URL appropriately. Preserve other approved redirects.
3. Confirm all 13 locked migrations match (`node scripts/check-migrations-lock.mjs`). Check the existing restricted DB login and installed actor signing key; apply only missing setup, never replay old migrations onto a live schema.
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
