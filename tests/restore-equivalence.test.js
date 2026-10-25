const assert = require("node:assert/strict");
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
