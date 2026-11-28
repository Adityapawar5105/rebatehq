# Production control plane

Set up on 28 November 2026 by Claude Code (review R3), at the owner's "Yes, set it up". This records what exists and what was checked. None of it is CI evidence: these are direct checks of the hosted database from the operator's machine.

## What exists

- **Supabase project `rebatehq-production`** (ref `aabbpshdxwzexnqaoagi`, us-east-1, the region of the Vercel functions in iad1), Free plan. Nothing in it is shared with `rebatehq-staging`.
- **Web address:** `https://app.rebatehq.app` (the owner's choice, decision D3). The address still serves staging until the app is switched (below).
- **Operator file:** the git-ignored `.env.production.local` in the main checkout. It holds production's own actor signing secret, benchmark pseudonym key, licence signing and verify key pair, the runtime login's password and the database password, which the owner set in the dashboard (Database › Settings › Reset database password). Never deploy `SUPABASE_DB_PASSWORD` or an admin URL to the app.

## What was done

- **Migrations:** all 20 pushed with `supabase db push` (a dry run first, listing exactly the 20) and recorded under their file versions; the latest is `20261130120000`.
- **Runtime login `rebatehq_runtime_login`:** LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, with one membership, `rebatehq_app` (INHERIT FALSE, SET TRUE, no ADMIN). Supabase's `postgres` can create this role but not alter it afterwards, so a password change means dropping and recreating it.
- **Actor key:** `actor-v1` installed in `rebatehq_private.actor_key`; it matches `ACTOR_SIGNING_SECRET` in the operator file.
- **Auth URLs:** site URL `https://app.rebatehq.app`; one redirect, `https://app.rebatehq.app/auth/callback**`. Unlike staging, no Vercel preview or Netlify addresses are allowed.

## Checks (28 November 2026)

- The runtime login connected through the **transaction pooler `aws-2-us-east-1.pooler.supabase.com:6543`** (not staging's `aws-1`; the other hosts answer "tenant not found") with the server certificate checked against `certs/supabase-root-ca.crt`. After `SET LOCAL ROLE rebatehq_app` it saw 0 workspaces.
- 15 tenant tables, all empty. The purge function `rebatehq_private.purge_deleted_tenant` is SECURITY INVOKER and no app or API role may execute it.
- **The full pgTAP suite passed on the hosted database: 164 of 164, run twice.** Users, workspaces, audit rows and the extension list were identical before and after (the suite is one transaction that rolls back). As on staging, `postgres` got SET on `rebatehq_app` for the runs only; the grant was revoked, leaving Supabase's original membership (ADMIN, no SET).
- Security advisor: the same notes as staging and nothing new: five INFO for the `rebatehq_private` tables without policies (they deny every app and platform role by design) and one WARN for `prevent_audit_mutation()` without a fixed `search_path`.

## Not done yet

- **The app still serves staging.** Switching `app.rebatehq.app` to this project means a production Vercel project (or the same one with production values) with `APP_DATABASE_URL` for `rebatehq_runtime_login` through `aws-2`, the new `ACTOR_SIGNING_SECRET`, licence keys and publishable key, its own Upstash limiter, and staging moved to `staging.rebatehq.app` with its own Supabase URLs. Vaults created on `app.rebatehq.app` against staging (test data) will not work against production. This waits for the owner.
- **Email:** Supabase's built-in sender is rate-limited and not for customers. Resend (owner's account, a sending subdomain) comes next; invitations stay off until then.
- **Backups and pausing:** the Free plan has no managed backups or point-in-time recovery and pauses a project after a week without activity. Move to Pro before the first pilot customer.
- **Hosted Restore Drill:** it needs a disposable hosted source and a fresh hosted target. The Free plan allows two projects, both now in use (staging and production), and production must not be used as either. It stays unrun.
- **First licence:** issue with `scripts/issue-licence.ts` against the production admin URL once a real workspace exists.
