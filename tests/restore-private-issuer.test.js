const assert = require('node:assert/strict');
const test = require('node:test');

// Restore Drill #15: the 5B migration's REVOKE materialises an explicit owner ACL
// ({postgres=rwU}) on rebatehq_private.login_budget. pg_dump omits an ACL equal to
// the owner default, so the restored sequence has relacl NULL. The comparison must
// expand NULL with the SEQUENCE default ('s'), not 'S' (foreign server: USAGE only).
const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE rebatehq_app;
CREATE SCHEMA rebatehq_private;
CREATE TABLE rebatehq_private.actor_key(id text PRIMARY KEY, tenant_id uuid CHECK(tenant_id IS NULL), secret bytea NOT NULL);
ALTER TABLE rebatehq_private.actor_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebatehq_private.actor_key FORCE ROW LEVEL SECURITY;
CREATE SEQUENCE rebatehq_private.login_budget AS bigint START 1;
INSERT INTO rebatehq_private.actor_key(id,secret) VALUES('actor-v1',decode(repeat('ab',32),'hex'));`;

test('private issuer snapshot treats a NULL sequence ACL as the sequence owner default (Drill #15)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { privateIssuerSql } = await import('../scripts/verify-restore-equivalence.mjs');
  const source = new PGlite(); const restored = new PGlite();
  try {
    await source.exec(setup + `
      REVOKE ALL ON rebatehq_private.actor_key FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;
      REVOKE ALL ON SEQUENCE rebatehq_private.login_budget FROM PUBLIC,anon,authenticated,service_role,rebatehq_app;`);
    await restored.exec(setup);
    const acl = await restored.query(`SELECT relacl IS NULL AS null_acl FROM pg_class WHERE oid='rebatehq_private.login_budget'::regclass`);
    assert.equal(acl.rows[0].null_acl, true, 'fixture must reproduce the dump-omitted (NULL) sequence ACL');
    const sourceRows = (await source.query(privateIssuerSql)).rows;
    const restoredRows = (await restored.query(privateIssuerSql)).rows;
    const sequence = sourceRows.find(r => r.relname === 'login_budget');
    assert.deepEqual(sequence.acl.map(a => a.privilege).sort(), ['SELECT', 'UPDATE', 'USAGE']);
    assert.deepEqual(restoredRows, sourceRows);
    // A real ACL difference must still fail the comparison.
    await restored.exec('GRANT USAGE ON SEQUENCE rebatehq_private.login_budget TO service_role;');
    assert.notDeepEqual((await restored.query(privateIssuerSql)).rows, sourceRows);
  } finally { await source.close(); await restored.close(); }
});
