# RebateHQ operations

Rewritten on 21 November 2026 (roadmap 13.5) for the system as it runs now; numbers refreshed on 26 November 2026 (review R1). The earlier chronological log, chunk by chunk from Phase 1, is kept unchanged in [docs/evidence/OPERATIONS_HISTORY.md](docs/evidence/OPERATIONS_HISTORY.md).

## What runs where

| Part | Where | Holds |
|---|---|---|
| The app (Next.js) | Netlify, built from `main`; a move to Vercel is prepared (27 Nov 2026, [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)) | No business data. Server routes cover sign-in, workspaces and invites, licences and devices, the ciphertext relay (including `/api/relay?mode=token`, which hands the signed-in person's own session token to the vault worker), opt-in benchmarks and the operator subscriptions view |
| Control plane (Supabase Postgres and Auth) | `rebatehq-staging` today; production is a separate project (not set up yet) | Identity, workspaces and memberships, licences, seats and devices, the relay's encrypted events, wrapped pack keys and signed pack versions, pseudonymous benchmark rows, the audit trail. 18 locked migrations; 15 control-plane tables |
| Team sharing storage (Supabase Storage and Realtime) | The private `relay-packs` bucket, and one Realtime channel per pack | With sharing on, encrypted copies of the shared prices, items, customers, guardrails and (for roles with cost) costs, as AES-GCM chunks. The server cannot read them. A channel carries only a pack version number. The worker calls both directly with the person's own session token |
| Each user's vault | That user's browser (DuckDB-Wasm in a Web Worker, encrypted snapshots in OPFS) | All prices, costs, invoices, rules, quotes and reports. The server never receives them in readable form (shared packs arrive only as ciphertext, above); **we cannot restore a vault for a customer**: only their own encrypted backup can |

The retired server business routes answer with a fixed 410 (decision D12). The legacy business pages and their switch were removed in roadmap 13.3.

## Environments

| | Address | Notes |
|---|---|---|
| Local | `http://localhost:3000` | `pnpm dev` (or `next dev --webpack` in a git worktree); `.env.local` from `.env.example`. `VAULT_LAB_ENABLED=true` opens `/lab/vault` without sign-in, for the browser gate only |
| Staging | https://rebatehq.netlify.app | Production deploy of `main`; PR previews behind the Netlify team login. Supabase `rebatehq-staging`. See [NETLIFY_DEPLOYMENT.md](NETLIFY_DEPLOYMENT.md). Pre-launch testing is moving to Vercel Hobby at app.rebatehq.app, with Vercel Pro bought before the first pilot customer ([VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md)) |
| Production | not yet | Needs the final web address first (decision D3): a vault is tied to the address it was created on. Then a separate Supabase project, Netlify site, Resend (or SMTP) sender and Upstash limiter; nothing is shared with staging |

## Configuration

Server settings live in the hosting provider's environment, never in git. `.env.example` lists every name; the ones that matter in a deployment:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_BASE_URL`.
- `APP_DATABASE_URL`: the restricted `rebatehq_app_login` (NOSUPERUSER, NOBYPASSRLS), never the postgres or service-role credentials. `SEED_DATABASE_URL` is for operator scripts only.
- `ACTOR_SIGNING_SECRET`, `LICENCE_SIGNING_KEY` (server only) and `NEXT_PUBLIC_LICENCE_VERIFY_KEY` (public): generate with `node scripts/control-plane-keys.mjs --install` (writes `.env.local`) or `--ci-env`; keep the private parts in the secret manager.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: required in production; sign-in, invite and workspace routes refuse to run without them. The limiter keys on the platform's client address (`lib/db.ts` `clientIp`; audit B-9). On Netlify: `x-nf-client-connection-ip`, then `x-real-ip`, then the last `x-forwarded-for` hop. On Vercel (`VERCEL=1`): `x-real-ip`, then `x-vercel-forwarded-for`, and never the Netlify header. Neither platform's live headers are verified yet.
- `PG_POOL_MAX` (optional, default 4): database connections per server instance.
- `RESEND_API_KEY` and `EMAIL_FROM` for invites; Supabase Auth sends sign-in links through its own SMTP setting (roadmap 0.6: a dedicated sender is still to be configured).
- Feature switches, off by default: `RELAY_ENABLED` (ciphertext sharing), `BENCHMARKS_ENABLED` with `BENCH_PSEUDONYM_KEY`, `VAULT_LAB_ENABLED` (never in a deployment), `DEV_IMPERSONATION_ENABLED` (development only).

## Releasing a change

1. Every change goes through a pull request. The `verify` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) must pass before merging: typecheck, unit tests, the high/critical dependency audit, migration hashes, pgTAP on a clean local Supabase, the authenticated Chromium privacy gate with the relay gate, and the Firefox lab gate. Netlify's own checks are not enough.
2. Merging to `main` deploys to staging. The same `verify` job runs on `main`; a red run there is investigated before the next merge.
3. A Supabase migration follows [MIGRATION_RULES.md](MIGRATION_RULES.md): CI passes, then the user-run Restore Drill passes, then the migration is locked in `migrations.lock`. Applied migrations are never edited.
4. A local vault schema change is a new versioned step in `lib/vault/schema.ts` (forward-only; the committed v1 fixture must still open). The vault is v25 (69 tables).

## Backups and restore

- **Control plane:** the manual [Restore Drill workflow](.github/workflows/restore-drill.yml) dumps a seeded database and restores it into a fresh one; [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md) has the steps and what each drill compares (licence, relay and benchmark hashes, tenant table count). Run it after every migration and before locking it. Supabase's own backups depend on the project's plan: confirm daily backups (and point-in-time recovery if wanted) before production.
- **Customer data:** each vault keeps its encrypted snapshots on the device, can save encrypted backups to a chosen folder (Chrome and Edge) and can always download an encrypted backup file. Tell customers to keep one off the device. A backup opens only with that person's passphrase and sign-in.

## Support situations

| Situation | What to do |
|---|---|
| Forgotten passphrase | There is no recovery. On the lock screen, "Forgot your passphrase?" → "Start again on this device" deletes this device's vault; then "Restore encrypted backup" with a backup made under the old passphrase |
| New computer or browser | Sign in there; the Owner approves the device under Settings › Licence, seats and devices (a "devices waiting" badge shows on Settings). Then restore a backup |
| Lost or stolen device | The Owner revokes it under Settings › Licence, seats and devices. If sharing is set up, an administrator rotates the workspace key so the device cannot read new items |
| Licence offline or read-only | A server error keeps the saved licence inside its offline allowance; only a refusal or bad signature makes the vault read-only. Check the licence and device rows (operator view below) |
| Customer leaves | The Owner uses Settings › Workspace › Disable workspace. The workspace's control-plane rows stay until removed: `scripts/purge-deleted-tenants.ts` is **suspended** (it stops at its first line). Before it is switched back on, a pgTAP test must prove that deleting a tenant cascades to its control-plane rows and keeps the audit rows, and the Restore Drill must pass with it (Phase 16 audit, 22 Nov 2026). Vault data on their devices is theirs to delete |

## Incidents and secrets

- A leaked `LICENCE_SIGNING_KEY` or `ACTOR_SIGNING_SECRET`: generate a new pair, deploy the new public verify key with the app, re-issue licences (devices re-check on their next online start). Record the rotation in `SECURITY_REVIEW.md`.
- A leaked `BENCH_PSEUDONYM_KEY`: rotate only with a documented reason; it unlinks earlier contributions from their workspaces (see Benchmarks).
- A leaked database password: rotate `rebatehq_app_login` in Supabase and update `APP_DATABASE_URL`; the app role cannot bypass row-level security, so its reach is one workspace per request.
- Report a suspected data exposure using `SECURITY_WHITEPAPER.md` and the risk register in `SECURITY_REVIEW.md`.

## Benchmarks (opt-in, chunk 8D)

- **Turning it on:** set `BENCHMARKS_ENABLED=true` and `BENCH_PSEUDONYM_KEY` (32 random bytes in hex) in the server environment, from the secret manager.
  - Never store the key in the database or in git.
  - Rotating the key unlinks every earlier contribution from its workspace. Withdrawal then cannot find old rows, so rotate only with a documented reason.
  - CI generates a per-run key with `scripts/control-plane-keys.mjs --ci-env`.
- **Releasing a quarter:** once per quarter, 45 days or more after it ends, run:

  ```
  SEED_DATABASE_URL=… node scripts/bench-release.mjs 2026-Q3
  ```

  This uses the migration administrator's connection. The database refuses an early, repeated or under-k release, and the app role cannot run it. The script prints counts only.
- **Restore:** the pseudonymous `rebatehq_private` benchmark tables are included in the dump and in the restore inventory like `actor_key`. Restoring them without the matching `BENCH_PSEUDONYM_KEY` keeps the released figures but unlinks withdrawals.

## Operator: subscriptions (14 November 2026; migration locked 15 November 2026)

Every customer workspace has one licence: a tier (`starter`, `professional`, `scale`), a plan type (`pilot` or `paid`), a status and an expiry. These are control-plane fields only; no pricing data is on the server.

**Look a customer up by email.** In the Supabase dashboard open Table Editor, choose schema `rebatehq_private` and view `subscriptions`, then filter `email`. Each row is one sign-in email and one workspace it belongs to, with `tier`, `plan_type` (pilot or paid), `licence_status`, `valid_until`, `licence_current`, seats used/allowed and the line cap. `tier = none` means the workspace has no licence yet; an empty `workspace` means the person has signed in but not created or joined a workspace. The same lookup in the SQL editor:

```sql
SELECT email, workspace, workspace_role, tier, plan_type, licence_status, valid_until, seats_used, seats_allowed
FROM rebatehq_private.subscriptions WHERE email ILIKE '%customer@example.com%';
-- Everyone on a pilot:
SELECT email, workspace, tier, valid_until FROM rebatehq_private.subscriptions WHERE plan_type = 'pilot' AND workspace_role = 'owner';
```

**Change a plan.** In the SQL editor, with the workspace owner's email:

```sql
SELECT * FROM rebatehq_private.set_subscription('owner@example.com', 'professional');                       -- change tier, keep pilot/paid and expiry
SELECT * FROM rebatehq_private.set_subscription('owner@example.com', 'scale', 'paid', '2027-11-14');         -- tier, paid, new expiry
SELECT * FROM rebatehq_private.set_subscription('owner@example.com', 'starter', 'pilot');                     -- back to a Starter pilot
```

It creates the licence if the workspace has none (pilot, 90 days, unless you pass a type and expiry), reactivates a revoked one, gives the owner the first seat, and refuses a downgrade that would leave more seats or locations than the new tier allows. If one email owns several workspaces, edit the right row of `public.workspace_licence` in Table Editor instead (columns `tier`, `plan_type`, `status`, `valid_until`). Every change is written to the audit log by the existing licence trigger. The app picks it up within about five minutes (the next licence refresh); a larger vault capacity is applied from Settings → Storage. Nothing here processes a payment.
