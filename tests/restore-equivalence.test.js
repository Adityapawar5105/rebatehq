const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("restore table ACL comparison accepts identical owners and grants", async () => {
  const { assertApplicationTableAclsEqual } = await import("../scripts/verify-restore-equivalence.mjs");
  const source = [{
    object_name: "tenant",
    owner_name: "postgres",
    acl: [
      { grantee: "margindesk_app", grantor: "postgres", privilege: "SELECT", grantable: false },
      { grantee: "postgres", grantor: "postgres", privilege: "DELETE", grantable: true },
    ],
  }];
  assert.equal(assertApplicationTableAclsEqual(source, structuredClone(source)), true);
});

test("restore table ACL comparison fails on an extra target grant and groups it by grantee", async () => {
  const { assertApplicationTableAclsEqual, compareApplicationTableAcls } = await import("../scripts/verify-restore-equivalence.mjs");
  const source = [{ object_name: "tenant", owner_name: "postgres", acl: [
    { grantee: "margindesk_app", grantor: "postgres", privilege: "SELECT", grantable: false },
  ] }];
  const restored = [{ object_name: "tenant", owner_name: "postgres", acl: [
    ...source[0].acl,
    { grantee: "service_role", grantor: "postgres", privilege: "SELECT", grantable: false },
  ] }];
  const diff = compareApplicationTableAcls(source, restored);
  assert.deepEqual(diff.service_role, {
    sourceOnly: [],
    restoredOnly: [{ table: "tenant", grantee: "service_role", grantor: "postgres", privilege: "SELECT", grantable: false }],
  });
  assert.throws(() => assertApplicationTableAclsEqual(source, restored), /service_role/);
});

test("restore table ACL comparison fails when a target grant is missing", async () => {
  const { assertApplicationTableAclsEqual, compareApplicationTableAcls } = await import("../scripts/verify-restore-equivalence.mjs");
  const source = [{ object_name: "tenant", owner_name: "postgres", acl: [
    { grantee: "margindesk_app", grantor: "postgres", privilege: "SELECT", grantable: false },
    { grantee: "margindesk_app", grantor: "postgres", privilege: "UPDATE", grantable: false },
  ] }];
  const restored = [{ object_name: "tenant", owner_name: "postgres", acl: [source[0].acl[0]] }];
  const diff = compareApplicationTableAcls(source, restored);
  assert.deepEqual(diff.margindesk_app, {
    sourceOnly: [{ table: "tenant", grantee: "margindesk_app", grantor: "postgres", privilege: "UPDATE", grantable: false }],
    restoredOnly: [],
  });
  assert.throws(() => assertApplicationTableAclsEqual(source, restored), /margindesk_app/);
});

const functionFixture = acl => ({
  object_name: "public.is_tenant_member(uuid)",
  schema_name: "public",
  proname: "is_tenant_member",
  argument_types: "p_tenant_id uuid",
  owner_name: "postgres",
  security_type: "DEFINER",
  search_path_setting: "public, extensions, pg_temp",
  acl,
});

test("restore function ACL comparison accepts identical function metadata and grants", async () => {
  const { assertFunctionAclSectionsEqual } = await import("../scripts/verify-restore-equivalence.mjs");
  const functions = [functionFixture([
    { grantee: "postgres", grantor: "postgres", privilege: "EXECUTE", grantable: true },
    { grantee: "margindesk_app", grantor: "postgres", privilege: "EXECUTE", grantable: false },
  ])];
  assert.equal(assertFunctionAclSectionsEqual(functions, structuredClone(functions)), true);
});

test("function failure diagnostics include signature, argument types, owner, security, search_path, and full ACL", async () => {
  const { printFunctionDiagnostics } = await import("../scripts/verify-restore-equivalence.mjs");
  const lines = [];
  printFunctionDiagnostics("Source", [functionFixture([
    { grantee: "postgres", grantor: "postgres", privilege: "EXECUTE", grantable: true },
    { grantee: "anon", grantor: "postgres", privilege: "EXECUTE", grantable: false },
  ])], line => lines.push(line));
  const text = lines.join("\n");
  for (const expected of ["public.is_tenant_member(uuid)", "p_tenant_id uuid", "owner=postgres", "security=DEFINER", "search_path=", '"grantee":"anon"', '"grantor":"postgres"']) {
    assert.ok(text.includes(expected), `Diagnostic output must include ${expected}.`);
  }
});

test("restore function ACL comparison fails on an extra grant grouped by function and grantee", async () => {
  const { assertFunctionAclSectionsEqual, compareFunctionAclSections } = await import("../scripts/verify-restore-equivalence.mjs");
  const source = [functionFixture([
    { grantee: "postgres", grantor: "postgres", privilege: "EXECUTE", grantable: true },
    { grantee: "margindesk_app", grantor: "postgres", privilege: "EXECUTE", grantable: false },
  ])];
  const restored = [functionFixture([
    ...source[0].acl,
    { grantee: "anon", grantor: "postgres", privilege: "EXECUTE", grantable: false },
  ])];
  const diff = compareFunctionAclSections(source, restored);
  assert.deepEqual(diff["public.is_tenant_member(uuid)"].anon, {
    sourceOnly: [],
    restoredOnly: [{ grantee: "anon", grantor: "postgres", privilege: "EXECUTE", grantable: false }],
  });
  assert.throws(() => assertFunctionAclSectionsEqual(source, restored), /is_tenant_member.*anon/s);
});

test("restore function ACL comparison fails when a target function is missing", async () => {
  const { assertFunctionAclSectionsEqual, compareFunctionAclSections } = await import("../scripts/verify-restore-equivalence.mjs");
  const source = [functionFixture([{ grantee: "postgres", grantor: "postgres", privilege: "EXECUTE", grantable: true }])];
  const diff = compareFunctionAclSections(source, []);
  assert.equal(diff["public.is_tenant_member(uuid)"]["<function>"].sourceOnly[0].function, "public.is_tenant_member(uuid)");
  assert.throws(() => assertFunctionAclSectionsEqual(source, []), /missing|is_tenant_member/i);
});

test("restore inventory requires all 29 tenant tables and compares every discovered public function", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify-restore-equivalence.mjs"), "utf8");
  assert.match(script, /inventory\.schemaTables\.length >= 29/);
  assert.match(script, /Object\.keys\(tenantRowCounts\)\.length >= 29/);
  assert.match(script, /WHERE n\.nspname='public'/, "The function inventory is discovered from pg catalogs rather than a fixed function list.");
});
