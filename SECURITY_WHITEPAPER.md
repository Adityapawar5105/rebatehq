# RebateHQ: security in plain language

5 November 2026 · Engineering evidence, not a certification or independent audit.

**Your working files stay in the local vault flow.** Imports, margin analysis,
pricing changes and reports run in a browser worker. The authenticated privacy
test checks unique private values against request URLs, headers, bodies and
console output. It passed on a real **local** Supabase sign-in, not a hosted
deployment. [Test](https://github.com/Adityapawar5105/rebatehq/blob/8a34e06/scripts/test-vault-browser.mjs)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715).

**Saved vaults and vault backups are encrypted.** The tested format uses
AES-256-GCM authenticated chunks and a key derived on the device with
PBKDF2-SHA256 at 600,000 iterations. Working data is held in memory. Tests reject
a wrong passphrase, modified chunks, changed scope and damaged files. Encryption
cannot rescue a weak passphrase; keep a long, unique phrase and a separate backup.
There is no recovery escrow.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/8a34e06/tests/vault.test.ts)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715).

**Recovery keeps an earlier encrypted save.** Tests cover interrupted writes,
retained generations, a killed tab, simulated quota pressure and encrypted backup
restore. The audit chain detects modified, missing or reordered entries relative
to its saved tip. It does not prove that a keyholder has never rewritten a whole
vault or replayed an older valid backup. Physical crash and full-disk recovery
remain manual checks.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/8a34e06/tests/browser/vault-worker.ts)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715).

**The cloud handles identity and access metadata.** Database tests check tenant
isolation, a restricted application role, exact grants and an append-only server
audit log: 113 checks on a fresh database and 116 in local restore mode. These
are separate from the local vault's hash chain.
[Database suite](https://github.com/Adityapawar5105/rebatehq/tree/8a34e06/supabase/tests)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715)
· [Restore #18](https://github.com/Adityapawar5105/rebatehq/actions/runs/41979671868).

**Licences do not give us a decryption key.** Tests cover signed licence scope,
forgery, expiry and revoked-device read-only recovery. Refresh is every five
minutes while running; offline permission can last up to 24 hours. Revocation
is not remote wipe and cannot erase data already opened or exported.
[Tests](https://github.com/Adityapawar5105/rebatehq/blob/8a34e06/tests/licence.test.ts)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715).

**Important boundaries.** Ordinary reports/ERP exports are plaintext files you
choose to create. Identity, licences and authentication records reach the control
plane. Legacy rebate/audit readers and historical server tables still exist
behind a default-off flag; retired business APIs return 410. We make no app-wide
“nothing ever leaves your device” claim. A compromised computer, extension or
application origin can read an unlocked vault. The future sharing relay is not
implemented or verified. Hosted sign-in, independent review and real crash/picker
checks remain unverified.
[Boundary tests](https://github.com/Adityapawar5105/rebatehq/blob/8a34e06/tests/http-boundary.test.js)
· [CI #73](https://github.com/Adityapawar5105/rebatehq/actions/runs/41977200715).

Detailed findings, owners and review dates: [security review](./SECURITY_REVIEW.md).
