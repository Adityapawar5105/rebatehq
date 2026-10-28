# Chunk 2C verification record — 2026-10-28

Status: **unverified in GitHub Actions**. Implementation and local checks pass; acceptance still requires a new green MarginDesk CI run and complete Restore Drill run. Earlier CI #29 / Restore Drill #11 on 13cea5a prove Chunk 2B only. No Phase 3 work is included.

## Scope and migration

`20261028173257_chunk2c_foundation_tables.sql` is **pending**, normalized SHA-256 `03fccfa0a75954c206e2b091c474409162304d770e5803c3a7e2527bfcaa6dc3`. All five locked migration files, hashes and evidence entries remain unchanged.

- Existing import_job: nonnegative accepted/rejected counts, bounded nonempty import type and object summary; existing statuses, rows, grants, RLS and audit are preserved.
- New column_mapping_template, connector_sync_run, quote_share_link, approval_rule and plan_feature: tenant FK/index, ENABLE + FORCE RLS, operation/role-specific policies, only explicit app CRUD grants and audited writes.
- quote_share_link stores only id, tenant_id, quote_id, token_hash, expires_at, revoked_at, created_by and created_at. A composite FK prevents foreign-tenant quote links. No raw token, cost/margin columns, arbitrary payload or public redemption endpoint.
- margin_snapshot keeps its existing isolation and accounting semantics, with additional table-specific own CRUD/audit, cross-tenant, browser ACL, rep and missing-context checks. Negative historical margin values are preserved.
- No SQL functions are added. The existing single function ACL registry and restricted default privileges are checked by the full suite. No grants are added to a restored database to hide a difference.

Current inventory: **38 tenant tables** (33 existing plus five new). Plans: **156 fresh / 159 restore-mode**, planned = ran. The 88 prior fresh checks are retained; 68 additional checks cover seven checks per scope table (49), the exact share-column allowlist (1), 16 constraint/FK rejections, missing-auth context (1) and owner-only governance writes (1). Three existing restore-only checks remain mandatory.

## Local execution

| Command / harness | Result |
|---|---|
| pnpm test | Passed: 66 JavaScript + 10 TypeScript tests, including all Phase 0 margin/pricing/rebate goldens; service-role scanner checked 87 user-facing files |
| pnpm typecheck | Passed |
| pnpm build | Passed, production Next.js build |
| pnpm check:migrations-lock | Passed: five locked migrations, one pending migration |
| pnpm check:schema | Passed: 38 tables, forced RLS/audit coverage and duplicate-object/privilege lint |

Every changed/added executable SQL statement ran at least once locally:

1. **New migration, fresh schema:** tests/chunk2a-pgtap.test.js applies every migration in order in PGlite. This executes all three import_job ALTER TABLE statements, five CREATE TABLE definitions, indexes, 20 policies, all table REVOKE/GRANT statements, audit trigger attachment and the ENABLE/FORCE RLS loop. There are no new functions or extension dependencies.
2. **New migration, populated prior schema:** tests/chunk2c-schema.test.js applies the five locked migrations, inserts a tenant, jobs in all three supported statuses and a negative-margin snapshot, then applies the new migration. Exact stored import/snapshot JSON remains unchanged. Its catalog/row queries and invalid-count write also execute. Invalid legacy data fails CHECK constraints; no data is silently removed.
3. **Entire modified pgTAP SQL:** tests/chunk2a-pgtap.test.js executes every DO block, generated-key fixture INSERT, all-table loop and additional assertion, twice in fresh mode and twice with an existing restored-style sentinel, customer, quote and multiple rows in each of the seven scope tables. Transactions roll back, planned equals ran and all per-table counts stay identical. Rejection tests exercise real PGlite CHECK/FK/RLS/ACL errors; assertion functions run as the admin after RESET ROLE.
4. **Fixture regression:** tests/fixture-builder.test.js runs the explicit 38-table graph and positive inserts twice against multiple pre-existing rows per table. It retains the reproduction of the old arbitrary-clone FK failure and proves unchanged before/after counts. Its reduced schema is a fixture compatibility harness, not production security evidence.
5. **Repeatability/restore scripts:** only minimum-count guards changed (33 to 38); their SQL statements are unchanged. The strict comparator and default/function ACL behavior remain covered by existing unit/PGlite tests.

PGlite uses real Postgres catalog, RLS, grants and constraints, with a minimal local auth schema/auth.uid() and roles instead of Supabase Auth. pgTAP assertion functions are local stubs that throw on failed assertions or plan/count mismatches; the pgTAP extension installation itself is omitted in that harness. All new SQL ran; actual Supabase platform setup, real pgTAP extension execution, pg driver role checks and dump/restore have **not** been run locally because Docker and psql are unavailable.

## Required CI acceptance — unverified

- Fresh real Supabase migration application, ignored-privilege warning gate, runtime role/no-context probe and 156-check suite twice with unchanged counts.
- Local-target logical dump/restore, dump grants plus restore-only platform cleanup, every strict source/target ACL/metadata/count comparison, sentinel hash and 159-check suite twice. Dynamic restore inventory now rejects fewer than 38 tables.
- Hosted-target restore and managed backup/PITR remain unverified; no UI, connectors, workers or public quote-sharing endpoint is built or claimed tested.

See ASSUMPTIONS.md for the Phase 3 handoff, including the Phase 1 caller-settable audit actor GUC, record_failed_login input bounds and independent DB rate-limiting gaps. These are documented open items, not fixes made in this chunk.
