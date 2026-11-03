# Encrypted v1 compatibility fixture

Synthetic data only. Never replace this fixture to make a migration test pass.

- File: v1.enc; schema version: 1; one invoice row and two valid audit entries.
- Passphrase: synthetic-local-vault-passphrase (public test data, not a credential).
- Scope: synthetic-v1-fixture-user / synthetic-v1-fixture-workspace.
- SHA-256: 4ef3fd0ae32310ec712f0763671c52d01f6e0ed47ad8442e2f04c24e4068b492.
- Created in Chrome with the pinned DuckDB-Wasm 1.32.0 EH engine on 3 Nov 2026.
- Current tests decrypt, check v1, open it through the production worker service,
  migrate forward to v2, preserve its row, verify the audit chain, save and reopen.

The explicit --make-fixture browser option exists for provenance/reproduction;
do not use it during normal checks or when adding a future migration.
