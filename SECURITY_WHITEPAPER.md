# RebateHQ: security in plain language

5 November 2026 · Engineering evidence, not a certification or independent audit.

**Your working files stay in the local vault flow.** Imports, margin analysis,
pricing changes and reports run in a browser worker. The authenticated privacy
test checks unique private values against request URLs, headers, bodies and
console output. It passed on a real **local** Supabase sign-in, not a hosted
deployment. [Test](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/scripts/test-vault-browser.mjs)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

**Saved vaults and vault backups are encrypted.** The tested format uses
AES-256-GCM authenticated chunks and a key derived on the device with
PBKDF2-SHA256 at 600,000 iterations. Working data is held in memory. Tests reject
a wrong passphrase, modified chunks, changed scope and damaged files. Encryption
cannot rescue a weak passphrase; keep a long, unique phrase and a separate backup.
There is no recovery escrow.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/tests/vault.test.ts)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

**Recovery keeps an earlier encrypted save.** Tests cover interrupted writes,
retained generations, a killed tab, simulated quota pressure and encrypted backup
restore. The audit chain detects modified, missing or reordered entries relative
to its saved tip. It does not prove that a keyholder has never rewritten a whole
vault or replayed an older valid backup. Physical crash and full-disk recovery
remain manual checks.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/tests/browser/vault-worker.ts)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

**The cloud handles identity and access metadata.** Database tests check tenant
isolation, a restricted application role, exact grants and an append-only server
audit log: 155 checks on a fresh database and 158 in local restore mode (26 Nov 2026; 113 and 116 when this page was first written). These
are separate from the local vault's hash chain.
[Database suite](https://github.com/Adityapawar5105/rebatehq/tree/ade310e/supabase/tests)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464)
· [Restore #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868).

**Licences do not give us a decryption key.** Tests cover signed licence scope,
forgery, expiry and revoked-device read-only recovery. Refresh is every five
minutes while running; offline permission can last up to 24 hours. Revocation
is not remote wipe and cannot erase data already opened or exported.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/tests/licence.test.ts)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

**Engine assets are checked before use.** The vault verifies embedded hashes
before running its self-hosted DuckDB child worker and WASM. Browser tests reject modified
assets; unit tests also check that authentication logs discard arbitrary and
nested fields. This still trusts the app deployment and its embedded hashes.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/tests/security-review.test.ts)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

**Important boundaries.** Ordinary reports/ERP exports are plaintext files you
choose to create. Identity, licences and authentication records reach the control
plane. The historical server business tables were dropped (chunks 6R and 8R) and
the legacy switch is retired; retired business APIs return 410. We make no app-wide
“nothing ever leaves your device” claim. A compromised computer, extension or
application origin can read an unlocked vault. Team sharing is off unless `RELAY_ENABLED` is set. When it is on, encrypted copies of the shared data
(prices, items, customers, guardrails and, for roles with cost, costs) are stored as AES-GCM chunks in a private
Supabase Storage bucket, a Realtime channel per pack carries only a version number, and the vault worker holds the
person's own session token to reach both. The relay and sharing migrations passed CI and Restore Drills; the
independent review of sharing is still owed, so no sharing privacy claim is made here. Hosted sign-in, independent review and real crash/picker
checks remain unverified.
[Boundary tests](https://github.com/Adityapawar5105/rebatehq/blob/ade310e/tests/http-boundary.test.js)
· [CI #75](https://github.com/Adityapawar5105/rebatehq/actions/runs/41989796464).

Detailed findings, owners and review dates: [security review](./SECURITY_REVIEW.md).


## Browser and currency scope — 7C-3a

Chrome and Edge remain primary desktop targets. Firefox is supported: its required 44-check lab/privacy gate passed in [CI #108](https://github.com/Adityapawar5105/rebatehq/actions/runs/42444422694) on `155188f`, 8 November 2026. The authenticated Chromium vault gate passed 46 checks and the authenticated local-Supabase relay gate passed 11. Safari is not supported. The Firefox fault checks use worker termination and test-only OPFS quota errors because CDP is Chromium-only; they do not prove physical crash or disk-full recovery. A Windows SideBySide/mozglue launch issue was fixed by one browser-package reinstall; application verification is recorded separately in the chunk record.

Workspace currency and per-batch manually supplied FX live only in the encrypted local vault and worker. Rates are not fetched or uploaded. Exact conversion produces integer cents; existing vaults default to USD without rewriting numbers. Currency changes with business data are blocked to prevent relabelling. See [part a verification](docs/evidence/CHUNK_7C3_VERIFICATION.md) for evidence and unverified limits.

These results cover the local vault/relay flows, not hosted sign-in or an unqualified app-wide privacy claim. Headed browser and native prompt checks, physical recovery and real ERP round trips remain unverified.
