# RebateHQ

RebateHQ is pricing, margin and rebate software for wholesale distributors with 50 to 300 employees. It shows where margin leaks between list price and pocket price, with the invoice lines behind every number. It also runs price rules with owner approval, a Quote Desk that hides cost from sales reps, customer rebates and supplier claims, and reports.

## How it works

- **Business data stays in the browser.** Prices, costs, invoices, rules and results live in an encrypted vault on the user's device: DuckDB-Wasm in a Web Worker, saved to the browser's private file storage (OPFS) with AES-GCM. There is no passphrase recovery; encrypted backups are the way back.
- **A small server (the control plane).** A Next.js app on Netlify, with Supabase for:
  - sign-in by email link;
  - workspaces, members and invitations;
  - signed licences, seats and device approval;
  - an optional encrypted relay for team sharing;
  - opt-in anonymous benchmarks.
- **Team sharing (Professional and Scale, behind `RELAY_ENABLED`).** The Owner chooses which roles receive which kinds of data. Sales reps never receive cost.
  - The data travels encrypted per kind: Supabase Storage holds only ciphertext, and a Realtime "doorbell" tells devices a new version exists.
  - Comments, approvals, threads and tasks ride the same encrypted relay.
- **Plans:** Starter, Professional and Scale. They limit features and data volume (`lib/licence-policy.ts`).

Supported browsers: Chrome and Edge, and Firefox. Safari is not claimed.

## Main parts of the code

| Path | What it holds |
|---|---|
| `app/` | Pages and route handlers. `/home` is the app; `/api/*` is the control plane |
| `components/local/` | The vault app's screens; `components/ui/` holds shared building blocks |
| `lib/vault/` | The worker: vault service, command dispatch, schema (v25, 69 tables), storage and encryption |
| `lib/margin`, `lib/pricing`, `lib/quotes`, `lib/rebate`, `lib/studio`, `lib/reports` | Business logic that runs in the worker |
| `lib/relay`, `lib/sharing` | Encrypted relay, team sharing packs, threads |
| `lib/roles/access.ts` | Every worker command with the capability it needs (cost hiding is enforced here) |
| `supabase/migrations` | Control-plane migrations; applied ones are locked in `migrations.lock` |
| `scripts/` | Browser gates, restore drill tooling, worker build |
| `tests/` | Unit tests (`node --test`, `tsx --test`) |

## Run it locally

**Lab mode (no Supabase).**
1. Put `VAULT_LAB_ENABLED=true` and a key set from `scripts/control-plane-keys.mjs` in a git-ignored `.env.local`.
2. Run `pnpm dev`. The worker is rebuilt first (`prepare:spike`).
3. `/` opens the local vault with a synthetic user and a short-lived Scale lab licence.

**With Supabase.** Requirements: Node.js 24, pnpm 10 and Docker.

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm exec supabase start
pnpm dev
```

Fill in the Supabase URL, the publishable key and the restricted app login (see `.env.example`). Magic links arrive in the local Inbucket viewer.

## Checks

```powershell
pnpm test
```

```powershell
pnpm test:db
```

`pnpm test` runs the migration lock, schema and service-role checks plus every unit test. `pnpm test:db` runs the pgTAP suite against local Supabase.

The browser gates are `scripts/test-vault-browser.mjs` and `scripts/test-relay-browser.mjs`. They need a production build (`next build`, `next start`), because they assert the strict CSP. CI (`.github/workflows/ci.yml`) runs all of these, with the authenticated privacy and relay gates against real local Supabase, and `verify` passes only when every job passes.

## Rules for changes

- `AGENTS.md`: project direction and working rules.
- `BLUEPRINT.md`: the product blueprint; section 22 records every approved change.
- `MIGRATION_RULES.md`: a migration needs CI, then a user-run Restore Drill, then a lock.
- Evidence for each delivered chunk lives in `docs/evidence/`. The previous long README, with its CI history, is in `docs/history/README_UNTIL_2026-11-26.md`.

## Operations

`OPERATIONS.md` (what runs where, settings, keys), `NETLIFY_DEPLOYMENT.md` (staging) and `RESTORE_RUNBOOK.md` (restore drills).

Staging is https://rebatehq.netlify.app, and the permanent address is https://app.rebatehq.app. Staging is not production.
