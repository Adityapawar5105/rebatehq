import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const mode = process.argv[2];
const snapshotPath = process.argv[3];
const inventoryPath = process.argv[4];
if (!new Set(["--snapshot", "--compare"]).has(mode) || !snapshotPath || !inventoryPath) {
  throw new Error("Usage: node scripts/verify-restore-equivalence.mjs --snapshot <source.json> <inventory.json> | --compare <source.json> <inventory.json>");
}
const databaseUrl = mode === "--snapshot" ? process.env.RESTORE_TEST_SOURCE_DATABASE_URL : process.env.RESTORE_TEST_TARGET_DATABASE_URL;
if (!databaseUrl) throw new Error(`${mode === "--snapshot" ? "RESTORE_TEST_SOURCE_DATABASE_URL" : "RESTORE_TEST_TARGET_DATABASE_URL"} is required.`);
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
assert.deepEqual(inventory.applicationSchemas, ["public"], "Restore equivalence only accepts the reviewed public application schema allowlist.");
assert.ok(Array.isArray(inventory.schemaTables) && inventory.schemaTables.length > 0, "Dump inventory must contain application tables.");
const applicationTableNames = inventory.schemaTables.map(item => {
  assert.equal(item.schema, "public", `Unexpected non-application table ${item.schema}.${item.table}.`);
  return item.table;
});
assert.equal(new Set(applicationTableNames).size, applicationTableNames.length, "Application table inventory contains duplicate table names.");
assert.ok(Array.isArray(inventory.authUserIds), "Dump inventory must include auth.users dependencies.");

const db = new Pool({ connectionString: databaseUrl, ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true } });

const roleStateSql = `
  SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit,r.rolconfig,
         COALESCE(jsonb_agg(jsonb_build_object('role',parent.rolname,'grantor',grantor.rolname,'admin',m.admin_option)
           ORDER BY parent.rolname) FILTER (WHERE m.roleid IS NOT NULL),'[]'::jsonb) AS memberships
  FROM pg_roles r
  LEFT JOIN pg_auth_members m ON m.member=r.oid
  LEFT JOIN pg_roles parent ON parent.oid=m.roleid
  LEFT JOIN pg_roles grantor ON grantor.oid=m.grantor
  WHERE r.rolname='margindesk_app'
  GROUP BY r.oid,r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolinherit,r.rolconfig
`;

const applicationTableAclSql = `
  SELECT c.relname AS object_name,owner.rolname AS owner_name,
    COALESCE(jsonb_agg(jsonb_build_object(
      'grantor',grantor.rolname,'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable
    ) ORDER BY acl.grantee,acl.privilege_type,grantor.rolname),'[]'::jsonb) AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_roles owner ON owner.oid=c.relowner
  LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl ON true
  LEFT JOIN pg_roles grantor ON grantor.oid=acl.grantor
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])
  GROUP BY c.oid,c.relname,owner.rolname
  ORDER BY c.relname
`;

const securityDefinerAclSql = `
  SELECT p.oid::regprocedure::text AS object_name,owner.rolname AS owner_name,
    COALESCE(jsonb_agg(jsonb_build_object(
      'grantor',grantor.rolname,'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable
    ) ORDER BY acl.grantee,acl.privilege_type,grantor.rolname),'[]'::jsonb) AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_roles owner ON owner.oid=p.proowner
  LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl ON true
  LEFT JOIN pg_roles grantor ON grantor.oid=acl.grantor
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE n.nspname='public' AND p.prosecdef
  GROUP BY p.oid,owner.rolname
  ORDER BY p.oid::regprocedure::text
`;

const schemaAclSql = `
  SELECT n.nspname AS object_name,owner.rolname AS owner_name,
    COALESCE(jsonb_agg(jsonb_build_object(
      'grantor',grantor.rolname,'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable
    ) ORDER BY acl.grantee,acl.privilege_type,grantor.rolname),'[]'::jsonb) AS acl
  FROM pg_namespace n JOIN pg_roles owner ON owner.oid=n.nspowner
  LEFT JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl ON true
  LEFT JOIN pg_roles grantor ON grantor.oid=acl.grantor
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE n.nspname='public'
  GROUP BY n.oid,n.nspname,owner.rolname
`;

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function assertApplicationTablesExist(pool) {
  const result = await pool.query(`
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])
    ORDER BY c.relname
  `, [applicationTableNames]);
  const actual = result.rows.map(row => row.relname);
  assert.deepEqual(actual, [...applicationTableNames].sort(), "An expected application table is missing from the restored database.");
}

async function snapshot(pool) {
  await assertApplicationTablesExist(pool);
  const role = (await pool.query(roleStateSql)).rows[0];
  assert.ok(role, "margindesk_app must exist in both source and restored databases.");
  const applicationTables = (await pool.query(applicationTableAclSql, [applicationTableNames])).rows;
  const securityDefiners = (await pool.query(securityDefinerAclSql)).rows;
  const schemas = (await pool.query(schemaAclSql)).rows;
  assert.equal(applicationTables.length, applicationTableNames.length, "Application table ACL inventory is incomplete.");
  assert.equal(schemas.length, 1, "The application-owned schema ACL inventory must contain public exactly once.");

  const applicationRows = {};
  const tenantRowCounts = {};
  for (const table of applicationTableNames) {
    const relation = `public.${quoteIdentifier(table)}`;
    applicationRows[table] = (await pool.query(`SELECT count(*)::text AS row_count FROM ${relation}`)).rows[0].row_count;
    const hasTenantId = (await pool.query(`
      SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=$1::regclass AND attname='tenant_id' AND attnum>0 AND NOT attisdropped) AS present
    `, [`public.${quoteIdentifier(table)}`])).rows[0].present;
    if (hasTenantId) {
      tenantRowCounts[table] = (await pool.query(`SELECT tenant_id::text AS tenant_id,count(*)::text AS row_count FROM ${relation} GROUP BY tenant_id::text ORDER BY tenant_id::text NULLS FIRST`)).rows;
    }
  }
  const authUserCount = inventory.authUserIds.length
    ? Number((await pool.query("SELECT count(*)::int AS count FROM auth.users WHERE id=ANY($1::uuid[])", [inventory.authUserIds])).rows[0].count)
    : 0;
  assert.equal(authUserCount, inventory.authUserIds.length, "A referenced auth.users ID is missing from the source or restored target.");
  return { role, applicationTableNames: [...applicationTableNames].sort(), applicationTables, securityDefiners, schemas, applicationRows, tenantRowCounts, authUserCount };
}

function comparableAcl(items) {
  return items.map(({ object_name, owner_name, acl }) => ({ object_name, owner_name, acl }));
}

try {
  if (mode === "--snapshot") {
    const sourceState = await snapshot(db);
    assert.ok(sourceState.applicationTables.length > 0, "Source must contain application tables; refusing a vacuous ACL/row-count snapshot.");
    assert.ok(sourceState.securityDefiners.length > 0, "Source must contain public SECURITY DEFINER functions; refusing a vacuous function-ACL snapshot.");
    writeFileSync(snapshotPath, `${JSON.stringify(sourceState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Captured restricted role state, public table/function/schema ACLs, and source counts for ${sourceState.applicationTableNames.length} application tables.\n`);
    process.stdout.write(`Application tables: ${JSON.stringify(sourceState.applicationTableNames)}\n`);
    process.stdout.write(`Source application row counts: ${JSON.stringify(sourceState.applicationRows)}\n`);
    process.stdout.write(`Referenced auth.users IDs present in source: ${sourceState.authUserCount}.\n`);
  } else {
    const sourceState = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const targetState = await snapshot(db);
    assert.deepEqual(targetState.role, sourceState.role, "margindesk_app role attributes, settings, or memberships differ after restore.");
    for (const [label, state] of [["source", sourceState.role], ["restored", targetState.role]]) {
      assert.equal(state.rolcanlogin, false, `${label} margindesk_app must be NOLOGIN`);
      assert.equal(state.rolsuper, false, `${label} margindesk_app must be NOSUPERUSER`);
      assert.equal(state.rolbypassrls, false, `${label} margindesk_app must be NOBYPASSRLS`);
      assert.equal(state.rolcreatedb, false, `${label} margindesk_app must be NOCREATEDB`);
      assert.equal(state.rolcreaterole, false, `${label} margindesk_app must be NOCREATEROLE`);
      assert.equal(state.rolreplication, false, `${label} margindesk_app must be NOREPLICATION`);
      assert.equal(state.rolinherit, false, `${label} margindesk_app must be NOINHERIT`);
      assert.deepEqual(state.memberships, [], `${label} margindesk_app must have no role memberships`);
    }
    for (const key of ["applicationTableNames", "applicationTables", "securityDefiners", "schemas", "applicationRows", "tenantRowCounts", "authUserCount"]) {
      assert.deepEqual(
        key.endsWith("Tables") || key === "securityDefiners" || key === "schemas" ? comparableAcl(sourceState[key]) : sourceState[key],
        key.endsWith("Tables") || key === "securityDefiners" || key === "schemas" ? comparableAcl(targetState[key]) : targetState[key],
        `${key} differs between source and restored application schemas.`,
      );
    }

    process.stdout.write(`Restored margindesk_app attributes and memberships match: ${JSON.stringify(targetState.role)}\n`);
    process.stdout.write(`Compared table ACLs for ${sourceState.applicationTables.length} application-owned tables.\n`);
    process.stdout.write(`Compared ACLs for ${sourceState.securityDefiners.length} public SECURITY DEFINER functions.\n`);
    process.stdout.write(`Compared the public schema ACL.\n`);
    process.stdout.write(`Application table row counts match: ${JSON.stringify(Object.fromEntries(Object.keys(sourceState.applicationRows).map(table => [table, { source: sourceState.applicationRows[table], restored: targetState.applicationRows[table] }]))) }\n`);
    process.stdout.write(`Per-tenant row counts match for ${Object.keys(sourceState.tenantRowCounts).length} tenant tables.\n`);
    process.stdout.write(`Referenced auth.users stand-ins present in restored target: ${targetState.authUserCount}.\n`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const rows = Object.keys(sourceState.applicationRows).map(table => `| ${table} | ${sourceState.applicationRows[table]} | ${targetState.applicationRows[table]} |`);
      appendFileSync(summary, [
        "### Restore source/target application equivalence",
        "",
        "- Restricted `margindesk_app` attributes and empty membership state matched.",
        `- Matched ACLs for ${sourceState.applicationTables.length} application tables, ${sourceState.securityDefiners.length} public SECURITY DEFINER functions, and the public schema.`,
        `- Verified ${targetState.authUserCount} synthetic or existing target auth.users IDs required by application foreign keys. No source credential fields were copied.`,
        "- Application table row counts:",
        "",
        "| Table | Source rows | Restored rows |",
        "|---|---:|---:|",
        ...rows,
        "",
      ].join("\n"), "utf8");
    }
  }
} finally {
  await db.end();
}
