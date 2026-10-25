import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const mode = process.argv[2];
const snapshotPath = process.argv[3];
if (!new Set(["--snapshot", "--compare"]).has(mode) || !snapshotPath) {
  throw new Error("Usage: node scripts/verify-restore-equivalence.mjs --snapshot <file> | --compare <file>");
}
const databaseUrl = mode === "--snapshot" ? process.env.RESTORE_TEST_SOURCE_DATABASE_URL : process.env.RESTORE_TEST_TARGET_DATABASE_URL;
if (!databaseUrl) throw new Error(`${mode === "--snapshot" ? "RESTORE_TEST_SOURCE_DATABASE_URL" : "RESTORE_TEST_TARGET_DATABASE_URL"} is required.`);

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

const tenantTableAclSql = `
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
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND a.attnum>0 AND NOT a.attisdropped)
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
  WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema' AND p.prosecdef
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
  WHERE left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
  GROUP BY n.oid,n.nspname,owner.rolname
  ORDER BY n.nspname
`;

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function snapshot(pool) {
  const role = (await pool.query(roleStateSql)).rows[0];
  assert.ok(role, "margindesk_app must exist in both source and restored databases.");
  const tenantTables = (await pool.query(tenantTableAclSql)).rows;
  const securityDefiners = (await pool.query(securityDefinerAclSql)).rows;
  const schemas = (await pool.query(schemaAclSql)).rows;
  const rowCounts = {};
  for (const { object_name: table } of tenantTables) {
    const query = `SELECT tenant_id::text AS tenant_id,count(*)::text AS row_count FROM public.${quoteIdentifier(table)} GROUP BY tenant_id::text ORDER BY tenant_id::text NULLS FIRST`;
    rowCounts[table] = (await pool.query(query)).rows;
  }
  return { role, tenantTables, securityDefiners, schemas, rowCounts };
}

function comparableAcl(items) {
  return items.map(({ object_name, owner_name, acl }) => ({ object_name, owner_name, acl }));
}

try {
  if (mode === "--snapshot") {
    const sourceState = await snapshot(db);
    assert.ok(sourceState.tenantTables.length > 0, "Source must contain tenant tables; refusing a vacuous grant/row-count snapshot.");
    writeFileSync(snapshotPath, `${JSON.stringify(sourceState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Captured source attributes, ACLs and tenant row counts for ${sourceState.tenantTables.length} tenant tables.\n`);
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

  for (const key of ["tenantTables", "securityDefiners", "schemas"]) {
    assert.deepEqual(
      comparableAcl(sourceState[key]),
      comparableAcl(targetState[key]),
      `${key} ACL/owner inventory differs between source and restored databases`,
    );
  }
  assert.ok(sourceState.tenantTables.length > 0, "Source must contain tenant tables; refusing a vacuous grant/row-count comparison.");
  assert.ok(sourceState.securityDefiners.length > 0, "Source must contain SECURITY DEFINER functions; refusing a vacuous function-ACL comparison.");
  assert.ok(sourceState.schemas.length > 0, "Source must contain application/platform schemas; refusing a vacuous schema-ACL comparison.");
  assert.deepEqual(sourceState.rowCounts, targetState.rowCounts, "Per-tenant row counts differ between source and restored tables.");

  process.stdout.write(`Restored margindesk_app attributes and memberships match the required restricted role state: ${JSON.stringify(targetState.role)}\n`);
  process.stdout.write(`Compared table ACLs for ${sourceState.tenantTables.length} tenant tables.\n`);
  process.stdout.write(`Compared ACLs for ${sourceState.securityDefiners.length} non-system SECURITY DEFINER functions.\n`);
  process.stdout.write(`Compared schema ACLs for ${sourceState.schemas.length} non-system schemas.\n`);
  process.stdout.write(`Tenant row counts match (source vs restored): ${JSON.stringify(Object.fromEntries(Object.keys(sourceState.rowCounts).map(table => [table, { source: sourceState.rowCounts[table], restored: targetState.rowCounts[table] }]))) }\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const fs = await import("node:fs");
    const rows = Object.entries(sourceState.rowCounts).flatMap(([table, counts]) => counts.map((row, index) => {
      const targetRow = targetState.rowCounts[table][index];
      return `| ${table} | ${row.tenant_id ?? "NULL"} | ${row.row_count} | ${targetRow?.row_count ?? "MISSING"} |`;
    }));
    fs.appendFileSync(summary, [
      "### Restore source/target equivalence",
      "",
      "- Restricted `margindesk_app` attributes verified; no role memberships found.",
      `- Matched table ACLs: ${sourceState.tenantTables.length} tenant tables.`,
      `- Matched function ACLs: ${sourceState.securityDefiners.length} SECURITY DEFINER functions.`,
      `- Matched schema ACLs: ${sourceState.schemas.length} non-system schemas.`,
      "- Per-tenant row counts:",
      "",
      "| Table | tenant_id | source rows | restored rows |",
      "|---|---|---:|---:|",
      ...rows,
      "",
    ].join("\n"), "utf8");
  }
  }
} finally {
  await db.end();
}
