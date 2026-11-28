# Vercel deployment

Written 27 November 2026, for moving the app from Netlify to Vercel. The owner decided:
- run the pre-launch testing on the free **Hobby** plan, at app.rebatehq.app, while there are no customers;
- buy **Pro before the first pilot customer uses it**. Vercel's terms allow Hobby only for "personal or non-commercial use", and a pilot company is commercial use.

Netlify (`NETLIFY_DEPLOYMENT.md`) stays as the fallback until Vercel is proven.

## What the code already handles

- **Next.js 16 and `proxy.ts`** run natively on Vercel: the nonce CSP, the CSRF origin check and the Supabase session refresh.
- **The Supabase certificate:** the restricted database login verifies it from `sslrootcert=/var/task/certs/supabase-root-ca.crt`.
  - `next.config.ts` ships `certs/supabase-root-ca.crt` with every server route (`outputFileTracingIncludes`).
  - Vercel functions run from `/var/task`, as Netlify's do. **Confirm on the first deploy** that `/api/licence` can reach the database.
- **Security headers** come from `next.config.ts` on any host: the engine files under `/spike/*` get `Cross-Origin-Resource-Policy: same-origin`, and COEP, COOP, HSTS and `nosniff` apply everywhere.
- **Visitor address for rate limits** (`lib/db.ts` `clientIp`):
  - On Vercel (`VERCEL=1`), only `x-real-ip` and `x-vercel-forwarded-for` are trusted; a caller-sent Netlify header is ignored.
  - Elsewhere the Netlify order is unchanged.
- **Node** is pinned to the 24.x major in `package.json` `engines`. CI and Netlify pin 24.22.1.
- **Static files:** the three DuckDB engine files are 34–39 MB each. Vercel lists no per-file static limit. Its 100 MB source cap applies to command-line uploads; Git deploys build on Vercel.

## Owner steps (accounts and secrets)

1. **Create a Vercel account** by signing in with GitHub (Hobby). The repository must stay under the personal account: Hobby cannot connect to a GitHub organisation's repositories.
2. **Import `Adityapawar5105/rebatehq`.** Keep the defaults:
   - framework: Next.js;
   - build command: `pnpm run build` (its `prebuild` builds the vault worker);
   - root directory: the repository root.
3. **Add environment variables** (Project › Settings › Environment Variables) for Production and Preview. The values are the ones in the git-ignored `.env.staging.local`; never commit them.
   - **Build time** (baked into the app; redeploy after changing): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_LICENCE_VERIFY_KEY`.
   - **Server:**
     - `APP_BASE_URL`: `https://app.rebatehq.app` for Production, the vercel.app address for Preview;
     - `APP_DATABASE_URL`: the restricted `rebatehq_netlify_login` (the staging login; only membership `rebatehq_app`, SET only) through the us-east-1 transaction pooler `aws-1-us-east-1.pooler.supabase.com:6543`, with `sslmode=verify-full` and the `sslrootcert` path above;
     - `ACTOR_SIGNING_SECRET`, `LICENCE_SIGNING_KEY`;
     - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: required, because sign-in, invite and workspace routes refuse to run without them in production;
     - `RESEND_API_KEY`, `EMAIL_FROM`: for invitations, once a sender exists.
   - **Switches:**
     - `RELAY_ENABLED=true` only while testing team sharing on staging data (decision D6);
     - `BENCHMARKS_ENABLED=false`;
     - `LEGACY_BUSINESS_ENABLED=false`;
     - `VAULT_LAB_ENABLED=false`;
     - `DEV_IMPERSONATION_ENABLED=false`.
   - Do not set `SEED_DATABASE_URL` or `SUPABASE_DB_PASSWORD` on Vercel; they are for operator scripts only.
4. **Supabase `rebatehq-staging` › Authentication › URL Configuration:**
   - keep the Site URL `https://app.rebatehq.app`;
   - add the project's Vercel address as a redirect, for example `https://rebatehq.vercel.app/auth/callback**`, so sign-in works there before the domain moves.

## Set up on 27 November 2026

- **Account:** Vercel Hobby (`adityapawar5105-4648`). Vercel's GitHub app is installed on `Adityapawar5105/rebatehq` only.
- **Project:** `rebatehq`, imported with the Next.js defaults, at `https://rebatehq.vercel.app`. Production deploys from `main`.
- **Variables:** 15, all **Production only**.
  - Config (readable): `APP_BASE_URL=https://rebatehq.vercel.app`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_LICENCE_VERIFY_KEY`, `PG_POOL_MAX`, `RELAY_ENABLED=true`, and `BENCHMARKS_ENABLED`, `LEGACY_BUSINESS_ENABLED`, `VAULT_LAB_ENABLED`, `DEV_IMPERSONATION_ENABLED` all `false`.
  - Secret: `ACTOR_SIGNING_SECRET`, `LICENCE_SIGNING_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_DATABASE_URL`.
  - Preview has none, so preview deployments of pull-request branches are not usable.
- **Where the secret values came from:**
  - Netlify's API returns secret variables masked, so they cannot be copied from Netlify.
  - The signing keys and the Upstash token came from `.env.staging.local`. Before import, checks confirmed the licence private key matches `NEXT_PUBLIC_LICENCE_VERIFY_KEY`, and both public keys match Netlify's.
  - `APP_DATABASE_URL` was rebuilt from `APP_DB_LOGIN_PASSWORD`. A local connection with the CA check on reached `rebatehq_netlify_login` through `aws-1` (the `aws-0` pooler refuses it).
  - The owner imported the values; no value was shown or committed.
- **Supabase:** `https://rebatehq.vercel.app/auth/callback**` added to the redirect list (4 URLs). The Site URL stays `https://app.rebatehq.app`.

## app.rebatehq.app moved to Vercel (28 November 2026)

- **Vercel:** `app.rebatehq.app` added to the project (Production); Vercel issued its certificate.
- **Cloudflare DNS:** the `app` CNAME changed from `rebatehq.netlify.app` to `f31ad4a210a5e679.vercel-dns-017.com`, DNS only. Checked through 1.1.1.1; app.rebatehq.app answers with `Server: Vercel`.
- **`APP_BASE_URL`** is now `https://app.rebatehq.app` (Production). Editing a variable in the Vercel dashboard asks for a two-factor code, so it was deleted and added again as Config.
- **Rollback:** point the `app` CNAME back to `rebatehq.netlify.app` and set `APP_BASE_URL` back to `https://rebatehq.vercel.app`. Netlify and its domain entry are kept for a week.
- **Vaults are tied to the address they were made on.** A vault made on rebatehq.vercel.app stays there; carry it to app.rebatehq.app with an encrypted backup.

**A Supabase integration was installed on 27 Nov 2026 (outside the deployment work).** It added 16 Production variables: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_SECRET_KEY`, `POSTGRES_PASSWORD` and the other `POSTGRES_*` and `SUPABASE_*` names. The app reads none of them (`scripts/check-service-role.mjs`), but admin keys must never sit in the app runtime, so all 16 were deleted on 28 Nov 2026. Deleting them does not revoke them. If the integration was linked to `rebatehq-staging`, rotate that project's service-role key, JWT secret and database password, and uninstall the integration in Vercel.

The project now has exactly the 15 variables listed above.

## Test on the vercel.app address first

Run before moving the domain, against staging data:
- `curl -sI` the home page and `/spike/duckdb-coi.wasm`. Expect the nonce CSP, COEP, COOP, HSTS and CORP, and no `x-powered-by`.
- Sign in by email link, create a workspace, create a vault, and see the licence line say it is licensed (this checks the database certificate path).
- With `RELAY_ENABLED=true`, on two browsers or two laptops:
  - start sharing;
  - join with the Owner's device code;
  - publish a price change;
  - see it arrive (Storage chunks, and the Realtime doorbell over `wss://`).
- Read Vercel's function logs for errors. Check that a rate-limited request still answers 429, which shows the Upstash keys are set.

## Move app.rebatehq.app (still on Hobby, pre-launch)

1. In Vercel › Project › Domains, add `app.rebatehq.app`. Vercel shows the DNS record it expects.
2. In Cloudflare DNS, change the `app` CNAME from `rebatehq.netlify.app` to the target Vercel shows (usually `cname.vercel-dns.com`). Keep it **DNS only** (grey cloud), as today. Lower the record's TTL beforehand.
3. Wait for Vercel to issue the certificate, then repeat the checks above on app.rebatehq.app.
4. **Vaults keep working,** because the address does not change. Vaults made on `rebatehq.netlify.app` stay on that address; take an encrypted backup and restore it on app.rebatehq.app.
5. **Rollback:** point the CNAME back to `rebatehq.netlify.app`. Keep the Netlify site and its domain entry until a week has passed without problems.

## Before the first pilot customer

- Upgrade the Vercel account to **Pro**. Then confirm in Settings that the project, domain and environment variables are unchanged; Vercel's docs do not say this in so many words.
- Turn on deployment protection for previews if wanted. Move Production to a separate Supabase project (`OPERATIONS.md`).

## Not verified yet

- Which region Hobby functions run in. Supabase staging is in us-east-1; Vercel's default is Washington, D.C.
- Vercel's live client-address headers.
- The `/var/task` certificate path on Vercel.
- None of this has been deployed. CI keeps testing `next start`, which is what Vercel's Node runtime serves.
