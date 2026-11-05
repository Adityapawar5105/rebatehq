# Independent reviewer checklist

5 November 2026. Owner: Aditya Pawar; arrange review by 19 November 2026.
Blueprint open question 4: **bring in an independent reviewer** before broad paid
deployment, especially for vault cryptography and the future relay. This checklist
is not a claim that such a review happened. Reviewer: unassigned; results pending.

Provide a disposable local stack, synthetic marker files and a pinned commit.
Never request customer files, production keys or passphrases for this exercise.
Record commit, browser/OS, test commands, exploit steps, severity, owner/date and
retest evidence. Do not accept a checklist tick as a penetration-test report.

- [ ] Map file→worker→RAM→ciphertext and browser→auth/licence boundaries; inspect every request, WebSocket, beacon, console argument and failure path for synthetic markers. Check no telemetry/extension download/external DuckDB network fetch.
- [ ] Attack parser type detection, ZIP expansion/count/size limits, XML entities, formulas/macros, hidden/merged cells, malformed encodings, CSV injection and SQL/HTML metacharacters. Confirm no formula evaluation or silent correction.
- [ ] Reproduce worker/WASM tamper rejection, redirects and pin failure. Inspect pinned dependencies, tarball provenance and WASM vulnerabilities beyond the npm audit feed. Confirm that pins are in app code, not a co-hosted mutable manifest trusted at runtime.
- [ ] Inspect production nonce CSP, COOP/COEP, auth redirects/cookies, CSRF, cache headers and trust in forwarded IP headers under the actual hosting proxy. Try stored/reflected/DOM XSS. Test real magic-link and hosted environment separately from CI local PKCE.
- [ ] Independently review AES-GCM nonce uniqueness (64-bit random snapshot prefix), salt/KDF bounds, chunk ordering/header/scope binding, truncation, iteration downgrade and passphrase brute-force cost. Propose a versioned nonce/subkey change if needed; retain old-fixture compatibility tests.
- [ ] Tamper with snapshot pointers, replace all files with an older valid generation and rebuild an entire audit chain as a keyholder. Document what is detectable without an external anchor; do not call the local log immutable or non-repudiable.
- [ ] Observe key/passphrase/plaintext lifetimes during wrong-password, cancelled unlock, lock/save failure, worker termination, browser suspension and a hung query. Confirm best-effort auto-lock; assess page-memory exposure and inability to guarantee secure erasure.
- [ ] Review known-schema-only import/upgrade and untrusted snapshot catalog objects. Verify unexpected views/macros/triggers cannot turn a restore into code execution or network access.
- [ ] Kill the physical browser/OS during each snapshot publication and backup step; test full disk/quota, revoked picker permissions, two tabs, profile eviction, old-version upgrades and recovery on another supported device. Preserve pre-test ciphertext copies.
- [ ] Review local role semantics versus possession of the complete vault. Try rep-cost exposure through every command, download and export; distinguish role preview from cryptographic multi-user separation.
- [ ] Forge/replay/cross-bind licence envelopes, invalidate cache, roll clocks, revoke devices/seats during offline grace and expiry, and retain encrypted recovery access. Document that revocation is not deletion or a key revocation system.
- [ ] Re-run all tenant positive/negative controls, exact table/function ACLs, role/no-context tests, audit update/delete/truncate denial and signed-actor transaction binding on real Postgres, fresh and restored. Inspect private issuer key ACLs, rotation/restore and RLS for every added object.
- [ ] Confirm all retired APIs remain unconditional 410 even with the legacy flag on; inventory the two flag-enabled legacy readers and historical data still in 12 wave-2 tables. Do not enable them in a new pilot by accident.
- [ ] Check email/IP/control metadata logging, third-party auth/rate-limit providers, retention, backups, host/CI artifact access and secret scanning. Verify server signing keys never appear in any served bundle or diagnostic.
- [ ] Review deployment write access, branch protection, dependency changes, incident response and customer recovery/support guidance. Check production rate-limit failure behavior and identity/licence key rotation without receiving real keys.
- [ ] **Future relay (before enablement):** key exchange/recipient confirmation, AEAD metadata/scope binding, sender authentication, duplicate/out-of-order/replay handling, revoked-member key rotation, malicious server/version downgrade, metadata leakage, ciphertext caps and quotas. Requires its own implementation review and CI evidence; none claimed now.

Use [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) as the starting threat model.
All independent, hosted and physical-device checks above remain **unverified**.
