# Chunk 6B verification — security review and whitepaper

5 November 2026. Baseline `adb6265`; **6B CI-verified** in [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464) on `ade310e`, 5 November 2026.
The GitHub run API says completed/success. Its job log confirms the required
authenticated privacy step ran and passed: `auth:true`, `status:passed`,
**36 named checks**, including both tampered-asset probes. Unit suite: **76 JS +
118 TS = 194 tests**, no failures/skips. Real Postgres: **113 checks twice**,
planned equals ran and repeatability leaves row counts unchanged. The high/critical
dependency audit gate passed (one tracked moderate advisory).
No later chunk started. No SQL, migration, migration hash, dependency version or
money calculation changed. Blueprint unchanged.

## Work

- STRIDE for data plane, vault, backups, control plane and future relay;
  fixed/remaining findings with owners and dates in SECURITY_REVIEW.md.
- One-page SECURITY_WHITEPAPER.md: each substantive claim links a baseline test
  and passing CI #73 / Restore #18, without extrapolating to hosted deployment.
  The #73 API/log was checked: required privacy step ran successfully, `auth:true`,
  34 named checks; 76 JS + 116 TS tests; 113 pgTAP checks twice.
- EXTERNAL_SECURITY_REVIEW.md answers blueprint question 4: independent reviewer
  required before broad paid deployment; no completed external review claimed.
- Embedded engine byte/digest pins, Fetch SRI + explicit verification before
  Blob worker/WASM creation; all Blob URLs revoked after engine initialization.
  No mutable fetched-manifest trust and no CDN. Owning app bundles still trust
  the origin/build pipeline. Asset-only tampering is the tested threat.
- Production worker-only `connect-src blob:` for verified WASM; no external host
  or JS unsafe-eval added. Test worker receives the actual production CSP.
- Browser gate rejects modified RAM wrapper and modified WASM; unit tests reject
  same-length tamper/truncation/missing pin. Security logger allows only known
  auth events, hashes email, discards arbitrary/nested fields and raw IP.
- CI `pnpm audit --audit-level high` rejects high/critical and network failures.
  One moderate advisory retained with rationale and owner/date, not suppressed.

## Local command ledger

Windows 11 / Ryzen 5 5600H / ~8 GB; Node 24.22.1. Read-only inspection commands
are grouped by purpose; no credentials or customer data were printed.

| Command / invocation | Result |
|---|---|
| `git status --short`; `git diff --stat`; `git log` / locked-file diff checks | Initial tracked tree clean at adb6265; `.claude/` and CODEX_PROMPT_6B.md pre-existing/untracked, untouched |
| `Get-Content` for supplied prompt, AGENTS, blueprint/plan/transition, migration rules, security record, owning source/tests/workflows; `rg` / `rg --files`; `Get-Command pnpm,node,git` | Sources inspected; tools available on PATH. Optional reads of nonexistent vault roles/access and auth-privacy files failed; owning code found in lib/roles and browser harness instead |
| GitHub jobs + job logs for CI #73 | Passed baseline confirmed, including required authenticated gate (34 checks) |
| Official Supabase changelog / OWASP PBKDF2 / MDN SRI / UUID advisory and fix reads | Reviewed; references linked in review |
| `pnpm audit --json` | Exit 1: one moderate UUID advisory; zero high/critical; no dependency edits |
| `pnpm exec tsx --test tests/security-review.test.ts` | 2 passed |
| `pnpm typecheck`; `pnpm prepare:spike` | Passed after initial implementation |
| `pnpm test` (first attempt) | 76 JS passed; TS failure only in source-string assertion expecting the old direct asset loader. Updated assertion to verify the shared verified self-hosted loader |
| `node scripts/test-control-vault.mjs` (first attempt) | Production build passed; Chrome UI create timed out. Earlier worker tests lacked production CSP. Reproduced CSP blocking a verified WASM blob; fixed worker-response policy only and parity of test worker CSP |
| `VAULT_LAB_ENABLED=true node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100`; one-shot Playwright Blob fetch diagnostic | Confirmed connect-src self blocks Blob fetch. Temporary server stopped; no fake Supabase credentials |
| `node scripts/test-control-vault.mjs` (second attempt) | Chrome 34 checks passed; Edge reload failed after an overlapping standalone build replaced served .next assets. Harness rerun serially after build; no product/assertion relaxation |
| `node scripts/test-control-vault.mjs` (serial final) | Passed: Chrome 156.0.8078.80 and Edge 156.0.4314.58, 34 named checks each including both asset-tamper probes, production CSP and privacy; headless local lab only |
| Production Next server on 3101 + `node scripts/test-spike-browser.mjs --browser=chrome` | Passed: synthetic generation, restart, both import methods, simulation, encryption, conversion, cancel, local-only boundary and fallback |
| `node --test tests/brand-name.test.js`; targeted security-review tests repeated after docs | 2 + 2 passed |
| `pnpm test` (final) | Passed: 76 JS + 118 TS = 194 tests; no skips |
| `pnpm typecheck`; `pnpm build`; `pnpm check:migrations-lock` (final) | Passed; 10 applied / 0 pending hashes unchanged |
| `pnpm audit --audit-level high` | Exit 0; one moderate, no high/critical |
| `git diff --check`; locked SQL/lock diff | Passed; no locked SQL or lock changes |

Local 100k-row import observations: 3,438 ms Chrome / 4,062 ms Edge, no observed main-thread long task (headless, machine above; not a startup or latency guarantee).

Generated local logs/results are git-ignored under test-results. No new SQL was
written. Existing migration + complete database SQL runs under PGlite with the
existing auth/pgTAP stubs in pnpm test; that does not replace real CI Postgres.

## Remaining unverified

Deployed/hosted Supabase sign-in and restore, hosted headers,
rate limiter/proxy/log-retention/key-rotation configuration, headed/manual checks,
physical crash/quota/picker/multi-tab recovery, historical storage-estimate
discrepancy, cryptographic independent review (including the 64-bit nonce prefix),
prospect ERP files/profiles and future relay. Full risk register has owner/date.
No Restore Drill is required for this chunk because no schema, ACL or restore
inventory changes. Prior local Restore #18 is not hosted restore evidence.

## Files changed (20)

- Runtime/build/CI: `.github/workflows/ci.yml`, `proxy.ts`,
  `lib/secure-logger.ts`, `lib/spike/db.ts`, `lib/vault/engine.ts`,
  `lib/vault/asset-integrity.ts`, `scripts/build-spike.mjs`,
  `scripts/test-vault-browser.mjs`.
- Tests: `tests/browser/vault-worker.ts`, `tests/security-review.test.ts`,
  `tests/spike.test.ts`, `tests/vault.test.ts`.
- Documents: `ASSUMPTIONS.md`, `BLUEPRINT_EXECUTION_PLAN.md`, `README.md`,
  `SECURITY_CHECK.md`, `SECURITY_REVIEW.md`, `SECURITY_WHITEPAPER.md`,
  `EXTERNAL_SECURITY_REVIEW.md`, `CHUNK_6B_VERIFICATION.md`.

`git add` used the explicit list above; `git commit -F test-results/6b-commit.txt`
and `git push origin main` passed (code commit ade310e). The pre-existing
`.claude/` and `CODEX_PROMPT_6B.md` remain untouched/untracked. GitHub jobs,
logs and run metadata were read to confirm CI #75's result and counts. No Restore
Drill was triggered. This follow-up changes evidence documents only; the tested
runtime/test/workflow content is still exactly ade310e.

Documentation closeout validation: `node --test tests/brand-name.test.js`
passed 2 tests; `pnpm check:migrations-lock` passed (10 applied / 0 pending);
`git diff --check` passed; `git diff adb6265 --name-only -- supabase/migrations migrations.lock`
was empty. No locked migration or hash changed.

A final probe-strengthening follow-up appends an executable-neutral JS comment or
a valid WASM custom section to the original engine asset. Node parses the JS and
WebAssembly.validate confirms the modified WASM is valid, so a parser error cannot
make the negative probe pass. CI #75 used malformed tamper bytes; runtime integrity
code is unchanged. The final follow-up reruns the full browser/privacy gate.
