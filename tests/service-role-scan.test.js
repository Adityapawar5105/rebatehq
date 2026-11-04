const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebatehq-service-role-scan-"));
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("service-role scan fails when a client-facing fixture references the service-role key", async () => {
  await withFixture(root => {
    fs.mkdirSync(path.join(root, "app"));
    fs.writeFileSync(path.join(root, "app", "client.tsx"), "const key = process.env.SUPABASE_SERVICE_ROLE_KEY;\n");

    return import("../scripts/check-service-role.mjs").then(({ checkUserFacingSources }) => {
      assert.throws(
        () => checkUserFacingSources(root, () => {}),
        /Forbidden service-role credential reference.*app[\\/]client\.tsx/s,
      );
    });
  });
});

test("service-role scan rejects an empty scan instead of passing", async () => {
  await withFixture(root => {
    return import("../scripts/check-service-role.mjs").then(({ checkUserFacingSources }) => {
      assert.throws(
        () => checkUserFacingSources(root, () => {}),
        /found zero user-facing files/,
      );
    });
  });
});
