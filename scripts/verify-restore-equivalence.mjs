import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

export function compareApplicationTableAcls(sourceTables, restoredTables) {
  const sourceByName = new Map(sourceTables.map(table => [table.object_name, table]));
  const restoredByName = new Map(restoredTables.map(table => [table.object_name, table]));
  const grouped = new Map();
  const add = (grantee, side, entry) => {
    if (!grouped.has(grantee)) grouped.set(grantee, { sourceOnly: [], restoredOnly: [] });
    grouped.get(grantee)[side].push(entry);
  };
  const tableNames = [...new Set([...sourceByName.keys(), ...restoredByName.keys()])].sort();
  for (const tableName of tableNames) {
    const source = sourceByName.get(tableName);
    const restored = restoredByName.get(tableName);
    if (!source) {
      add("<table>", "restoredOnly", { table: tableName, owner: restored.owner_name, missingOnSource: true });
      continue;
    }
    if (!restored) {
      add("<table>", "sourceOnly", { table: tableName, owner: source.owner_name, missingOnRestored: true });
      continue;
    }
    if (source.owner_name !== restored.owner_name) {
      add("<owner>", "sourceOnly", { table: tableName, owner: source.owner_name });
      add("<owner>", "restoredOnly", { table: tableName, owner: restored.owner_name });
    }
    const keyEntries = table => (table.acl ?? []).map(acl => ({
      grantee: acl.grantee,
      grantor: acl.grantor,
      privilege: acl.privilege,
      grantable: Boolean(acl.grantable),
    }));
    const sourceEntries = keyEntries(source);
    const restoredEntries = keyEntries(restored);
    const entryKey = entry => JSON.stringify(entry);
    const sourceCounts = new Map();
    const restoredCounts = new Map();
    for (const entry of sourceEntries) sourceCounts.set(entryKey(entry), (sourceCounts.get(entryKey(entry)) ?? 0) + 1);
    for (const entry of restoredEntries) restoredCounts.set(entryKey(entry), (restoredCounts.get(entryKey(entry)) ?? 0) + 1);
    const keys = new Set([...sourceCounts.keys(), ...restoredCounts.keys()]);
    for (const key of keys) {
      const sourceCount = sourceCounts.get(key) ?? 0;
      const restoredCount = restoredCounts.get(key) ?? 0;
      const entry = { table: tableName, ...JSON.parse(key) };
      for (let index = restoredCount; index < sourceCount; index += 1) add(entry.grantee, "sourceOnly", entry);
      for (let index = sourceCount; index < restoredCount; index += 1) add(entry.grantee, "restoredOnly", entry);
    }
  }
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function assertApplicationTableAclsEqual(sourceTables, restoredTables) {
  const differences = compareApplicationTableAcls(sourceTables, restoredTables);
  const hasDifferences = Object.values(differences).some(group => group.sourceOnly.length || group.restoredOnly.length);
  if (hasDifferences) throw new Error(`Application table ACL mismatch grouped by grantee:\n${JSON.stringify(differences, null, 2)}`);
  return true;
}

export function printApplicationTableAclDiagnostics(label, tables, write = line => process.stdout.write(`${line}\n`)) {
  write(`${label} application table owners and complete ACLs (${tables.length} tables):`);
  for (const table of [...tables].sort((a, b) => a.object_name.localeCompare(b.object_name))) {
    write(`public.${table.object_name} owner=${table.owner_name}; ACL=${JSON.stringify(table.acl)}`);
  }
}

export function formatApplicationTableAclDiff(sourceTables, restoredTables) {
  const differences = compareApplicationTableAcls(sourceTables, restoredTables);
  return Object.keys(differences).length ? JSON.stringify(differences, null, 2) : "(no table ACL or owner differences)";
}

export function compareFunctionAclSections(sourceFunctions, restoredFunctions) {
  const sourceByName = new Map(sourceFunctions.map(fn => [fn.object_name, fn]));
  const restoredByName = new Map(restoredFunctions.map(fn => [fn.object_name, fn]));
  const differences = {};
  const add = (functionName, grantee, side, entry) => {
    differences[functionName] ??= {};
    differences[functionName][grantee] ??= { sourceOnly: [], restoredOnly: [] };
    differences[functionName][grantee][side].push(entry);
  };
  const functionNames = [...new Set([...sourceByName.keys(), ...restoredByName.keys()])].sort();
  const metadataFields = ["schema_name", "proname", "argument_types", "owner_name", "security_type", "search_path_setting"];
  for (const functionName of functionNames) {
    const source = sourceByName.get(functionName);
    const restored = restoredByName.get(functionName);
    if (!source) {
      add(functionName, "<function>", "restoredOnly", { function: functionName, restored: true, metadata: Object.fromEntries(metadataFields.map(field => [field, restored[field]])) });
      continue;
    }
    if (!restored) {
      add(functionName, "<function>", "sourceOnly", { function: functionName, source: true, metadata: Object.fromEntries(metadataFields.map(field => [field, source[field]])) });
      continue;
    }
    for (const field of metadataFields) {
      if (source[field] !== restored[field]) {
        add(functionName, "<metadata>", "sourceOnly", { field, value: source[field] ?? null });
        add(functionName, "<metadata>", "restoredOnly", { field, value: restored[field] ?? null });
      }
    }
    const normalize = fn => (fn.acl ?? []).map(acl => ({
      grantee: acl.grantee,
      grantor: acl.grantor,
      privilege: acl.privilege,
      grantable: Boolean(acl.grantable),
    }));
    const countEntries = entries => {
      const counts = new Map();
      for (const entry of entries) {
        const key = JSON.stringify(entry);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    const sourceCounts = countEntries(normalize(source));
    const restoredCounts = countEntries(normalize(restored));
    for (const key of new Set([...sourceCounts.keys(), ...restoredCounts.keys()])) {
      const entry = JSON.parse(key);
      const sourceCount = sourceCounts.get(key) ?? 0;
      const restoredCount = restoredCounts.get(key) ?? 0;
      for (let index = restoredCount; index < sourceCount; index += 1) add(functionName, entry.grantee, "sourceOnly", entry);
      for (let index = sourceCount; index < restoredCount; index += 1) add(functionName, entry.grantee, "restoredOnly", entry);
    }
  }
  return Object.fromEntries(Object.entries(differences).sort(([left], [right]) => left.localeCompare(right)).map(([fn, grantees]) => [
    fn,
    Object.fromEntries(Object.entries(grantees).sort(([left], [right]) => left.localeCompare(right))),
  ]));
}

export function assertFunctionAclSectionsEqual(sourceFunctions, restoredFunctions, label = "public function ACL") {
  const differences = compareFunctionAclSections(sourceFunctions, restoredFunctions);
  if (Object.keys(differences).length) {
    throw new Error(`${label} mismatch grouped by function and grantee:\n${JSON.stringify(differences, null, 2)}`);
  }
  return true;
}

export function printFunctionDiagnostics(label, functions, write = line => process.stdout.write(`${line}\n`)) {
  write(`${label} complete public function inventory and ACLs (${functions.length} functions):`);
  for (const fn of [...functions].sort((a, b) => a.object_name.localeCompare(b.object_name))) {
    const functionName = fn.object_name.includes(".") ? fn.object_name : `${fn.schema_name ?? "public"}.${fn.object_name}`;
    write(`${functionName} args=${JSON.stringify(fn.argument_types)} owner=${fn.owner_name} security=${fn.security_type} search_path=${JSON.stringify(fn.search_path_setting)} ACL=${JSON.stringify(fn.acl)}`);
  }
}

export function formatFunctionAclDiff(sourceFunctions, restoredFunctions) {
  const differences = compareFunctionAclSections(sourceFunctions, restoredFunctions);
  return Object.keys(differences).length ? JSON.stringify(differences, null, 2) : "(no public function ACL or metadata differences)";
}

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

const publicFunctionAclSql = `
  SELECT p.oid::regprocedure::text AS object_name,n.nspname::text AS schema_name,p.proname::text AS proname,
    pg_get_function_identity_arguments(p.oid)::text AS argument_types,owner.rolname AS owner_name,
    CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_type,
    (SELECT regexp_replace(config.setting,'^search_path=','') FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) AS config(setting)
     WHERE config.setting LIKE 'search_path=%' LIMIT 1) AS search_path_setting,
    COALESCE(jsonb_agg(jsonb_build_object(
      'grantor',grantor.rolname,'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable
    ) ORDER BY acl.grantee,acl.privilege_type,grantor.rolname),'[]'::jsonb) AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_roles owner ON owner.oid=p.proowner
  LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl ON true
  LEFT JOIN pg_roles grantor ON grantor.oid=acl.grantor
  LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
  WHERE n.nspname='public'
  GROUP BY p.oid,n.nspname,p.proname,p.prosecdef,p.proconfig,owner.rolname
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

const defaultPrivilegesSql = `
  SELECT owner_role.rolname AS owner_name,
         CASE WHEN d.defaclnamespace=0 THEN '<all schemas>' ELSE schema_name.nspname END AS schema_name,
         CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' WHEN 'f' THEN 'FUNCTIONS' ELSE d.defaclobjtype::text END AS object_type,
         COALESCE(jsonb_agg(jsonb_build_object(
           'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
           'grantor',grantor_role.rolname,'privilege',acl.privilege_type,'grantable',acl.is_grantable
         ) ORDER BY acl.grantee,acl.privilege_type,grantor_role.rolname) FILTER (WHERE acl.grantee IS NOT NULL),'[]'::jsonb) AS acl
  FROM pg_default_acl d
  JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole
  LEFT JOIN pg_namespace schema_name ON schema_name.oid=d.defaclnamespace
  LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
  LEFT JOIN pg_roles grantor_role ON grantor_role.oid=acl.grantor
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid=acl.grantee
  WHERE d.defaclnamespace IN (0,'public'::regnamespace)
  GROUP BY owner_role.rolname,d.defaclnamespace,schema_name.nspname,d.defaclobjtype
  ORDER BY owner_role.rolname,schema_name.nspname,object_type
`;

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function assertApplicationTablesExist(pool, applicationTableNames) {
  const result = await pool.query(`
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])
    ORDER BY c.relname
  `, [applicationTableNames]);
  const actual = result.rows.map(row => row.relname);
  assert.deepEqual(actual, [...applicationTableNames].sort(), "An expected application table is missing from the restored database.");
}

async function snapshot(pool, applicationTableNames, authUserIds) {
  await assertApplicationTablesExist(pool, applicationTableNames);
  const role = (await pool.query(roleStateSql)).rows[0];
  assert.ok(role, "margindesk_app must exist in both source and restored databases.");
  const applicationTables = (await pool.query(applicationTableAclSql, [applicationTableNames])).rows;
  const functions = (await pool.query(publicFunctionAclSql)).rows;
  const securityDefiners = functions.filter(fn => fn.security_type === "DEFINER");
  const schemas = (await pool.query(schemaAclSql)).rows;
  const defaultPrivileges = (await pool.query(defaultPrivilegesSql)).rows;
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
  const authUserCount = authUserIds.length
    ? Number((await pool.query("SELECT count(*)::int AS count FROM auth.users WHERE id=ANY($1::uuid[])", [authUserIds])).rows[0].count)
    : 0;
  assert.equal(authUserCount, authUserIds.length, "A referenced auth.users ID is missing from the source or restored target.");
  return { role, applicationTableNames: [...applicationTableNames].sort(), applicationTables, securityDefiners, functions, schemas, defaultPrivileges, applicationRows, tenantRowCounts, authUserCount };
}

function comparableAcl(items) {
  return items.map(({ object_name, owner_name, acl }) => ({ object_name, owner_name, acl }));
}

function reportSection(label, check, failures) {
  try {
    check();
    process.stdout.write(`PASS ${label}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL ${label}\n${message}\n`);
    failures.push(`${label}: ${message}`);
  }
}

async function main() {
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
  try {
  if (mode === "--snapshot") {
    const sourceState = await snapshot(db, applicationTableNames, inventory.authUserIds);
    assert.ok(sourceState.applicationTables.length > 0, "Source must contain application tables; refusing a vacuous ACL/row-count snapshot.");
    assert.ok(sourceState.securityDefiners.length > 0, "Source must contain public SECURITY DEFINER functions; refusing a vacuous function-ACL snapshot.");
    assert.ok(sourceState.functions.length > 0, "Source must contain public functions; refusing a vacuous complete function ACL snapshot.");
    writeFileSync(snapshotPath, `${JSON.stringify(sourceState, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Captured restricted role state, public table/function/schema ACLs, and source counts for ${sourceState.applicationTableNames.length} application tables.\n`);
    process.stdout.write(`Application tables: ${JSON.stringify(sourceState.applicationTableNames)}\n`);
    process.stdout.write(`Source application row counts: ${JSON.stringify(sourceState.applicationRows)}\n`);
    process.stdout.write(`Referenced auth.users IDs present in source: ${sourceState.authUserCount}.\n`);
    process.stdout.write(`Captured ACL and security metadata for ${sourceState.functions.length} public functions.\n`);
    printApplicationTableAclDiagnostics("Source", sourceState.applicationTables);
    process.stdout.write(`Source ALTER DEFAULT PRIVILEGES entries for public and global defaults: ${JSON.stringify(sourceState.defaultPrivileges, null, 2)}\n`);
  } else {
    const sourceState = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const targetState = await snapshot(db, applicationTableNames, inventory.authUserIds);
    printApplicationTableAclDiagnostics("Source", sourceState.applicationTables);
    printApplicationTableAclDiagnostics("Restored", targetState.applicationTables);
    process.stdout.write(`Source ALTER DEFAULT PRIVILEGES entries for public and global defaults: ${JSON.stringify(sourceState.defaultPrivileges, null, 2)}\n`);
    process.stdout.write(`Restored ALTER DEFAULT PRIVILEGES entries for public and global defaults: ${JSON.stringify(targetState.defaultPrivileges, null, 2)}\n`);
    const tableAclDiffGroups = compareApplicationTableAcls(sourceState.applicationTables, targetState.applicationTables);
    const differingGrantees = Object.entries(tableAclDiffGroups)
      .filter(([, group]) => group.sourceOnly.length || group.restoredOnly.length)
      .map(([grantee]) => grantee);
    process.stdout.write(`Application table ACL grantees differing: ${differingGrantees.length ? differingGrantees.join(", ") : "none"}\n`);
    const tableAclDiff = Object.keys(tableAclDiffGroups).length ? JSON.stringify(tableAclDiffGroups, null, 2) : "(no table ACL or owner differences)";
    process.stdout.write(`Complete application table ACL diff grouped by grantee:\n${tableAclDiff}\n`);
    const functionDiff = compareFunctionAclSections(sourceState.functions, targetState.functions);
    const securityDefinerDiff = compareFunctionAclSections(sourceState.securityDefiners, targetState.securityDefiners);
    if (Object.keys(functionDiff).length || Object.keys(securityDefinerDiff).length) {
      printFunctionDiagnostics("Source", sourceState.functions);
      printFunctionDiagnostics("Restored", targetState.functions);
      const functionGranteeSummary = Object.entries(functionDiff)
        .map(([functionName, grantees]) => `${functionName}: ${Object.keys(grantees).join(", ")}`)
        .join("; ");
      process.stdout.write(`Public function ACL differences by function and grantee: ${functionGranteeSummary || "none in complete function inventory"}\n`);
      process.stdout.write(`Complete public function ACL diff grouped by function and grantee:\n${formatFunctionAclDiff(sourceState.functions, targetState.functions)}\n`);
    }

    const failures = [];
    reportSection("margindesk_app role attributes and memberships", () => {
      assert.deepEqual(targetState.role, sourceState.role, "Role attributes/settings/memberships differ.");
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
    }, failures);
    reportSection("application table ACLs", () => assertApplicationTableAclsEqual(sourceState.applicationTables, targetState.applicationTables), failures);
    reportSection("complete public function ACLs and metadata", () => {
      if (Object.keys(functionDiff).length) {
        throw new Error(`Public function ACL/metadata mismatch grouped by function and grantee:\n${JSON.stringify(functionDiff, null, 2)}`);
      }
    }, failures);
    reportSection("public SECURITY DEFINER ACLs and metadata", () => {
      if (Object.keys(securityDefinerDiff).length) {
        throw new Error(`SECURITY DEFINER ACL/metadata mismatch grouped by function and grantee:\n${JSON.stringify(securityDefinerDiff, null, 2)}`);
      }
    }, failures);
    reportSection("public schema ACL", () => assert.deepEqual(comparableAcl(sourceState.schemas), comparableAcl(targetState.schemas), "Public schema ACL differs."), failures);
    reportSection("application table inventory", () => assert.deepEqual(sourceState.applicationTableNames, targetState.applicationTableNames, "Application table inventory differs."), failures);
    reportSection("application row counts", () => assert.deepEqual(sourceState.applicationRows, targetState.applicationRows, "Application row counts differ."), failures);
    reportSection("per-tenant row counts", () => assert.deepEqual(sourceState.tenantRowCounts, targetState.tenantRowCounts, "Per-tenant row counts differ."), failures);
    reportSection("referenced auth.users IDs", () => assert.equal(targetState.authUserCount, sourceState.authUserCount, "Referenced auth.users IDs differ."), failures);
    if (failures.length) throw new Error(`Restore equivalence failed in ${failures.length} section(s):\n${failures.map(item => `- ${item}`).join("\n")}`);

    process.stdout.write(`Restored margindesk_app attributes and memberships match: ${JSON.stringify(targetState.role)}\n`);
    process.stdout.write(`Compared table ACLs for ${sourceState.applicationTables.length} application-owned tables.\n`);
    process.stdout.write(`Compared ACLs for ${sourceState.securityDefiners.length} public SECURITY DEFINER functions.\n`);
    process.stdout.write(`Compared ACLs and execution metadata for ${sourceState.functions.length} public functions.\n`);
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
        `- Matched ACLs for ${sourceState.applicationTables.length} application tables, all ${sourceState.functions.length} public functions (${sourceState.securityDefiners.length} SECURITY DEFINER), and the public schema.`,
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
}

if (process.argv[1] && process.argv[1].endsWith("verify-restore-equivalence.mjs")) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : "Restore equivalence check failed."}\n`);
    process.exitCode = 1;
  });
}
