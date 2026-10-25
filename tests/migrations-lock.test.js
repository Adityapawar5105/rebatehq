const assert = require("node:assert/strict");
const test = require("node:test");

test("migration lock accepts matching applied migration hashes and later migrations", async () => {
  const { createHash } = require("node:crypto");
  const { validateMigrationLock } = await import("../scripts/check-migrations-lock.mjs");
  const base = "-- frozen phase 1 migration\n";
  const lock = {
    version: 1,
    appliedThrough: "202610240001_phase1_foundation.sql",
    appliedMigrations: {
      "202610240001_phase1_foundation.sql": createHash("sha256").update(base).digest("hex"),
    },
  };
  const contents = new Map([
    ["202610240001_phase1_foundation.sql", base],
    ["202610250001_new_feature.sql", "-- future migration\n"],
  ]);
  assert.deepEqual(
    validateMigrationLock(lock, [...contents.keys()], name => Buffer.from(contents.get(name))),
    [],
  );
});

test("migration lock rejects edited or untracked historical migrations", async () => {
  const { createHash } = require("node:crypto");
  const { validateMigrationLock } = await import("../scripts/check-migrations-lock.mjs");
  const name = "202610240001_phase1_foundation.sql";
  const lock = { version: 1, appliedThrough: name, appliedMigrations: { [name]: createHash("sha256").update("baseline").digest("hex") } };
  assert.match(validateMigrationLock(lock, [name], () => Buffer.from("edited"))[0], /Applied migration changed/);
  assert.match(validateMigrationLock(lock, [name, "202610230001_old.sql"], () => Buffer.from("baseline")).join("\n"), /not locked: 202610230001_old.sql/);
});
