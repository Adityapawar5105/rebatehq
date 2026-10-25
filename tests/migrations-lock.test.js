const assert = require("node:assert/strict");
const test = require("node:test");

test("migration lock accepts matching applied migration hashes and later migrations", async () => {
  const { hashMigrationContent, validateMigrationLock } = await import("../scripts/check-migrations-lock.mjs");
  const base = "-- frozen phase 1 migration\n";
  const lock = {
    version: 1,
    appliedThrough: "202610240001_phase1_foundation.sql",
    appliedOrder: ["202610240001_phase1_foundation.sql"],
    appliedMigrations: {
      "202610240001_phase1_foundation.sql": hashMigrationContent(base),
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
  const { hashMigrationContent, validateMigrationLock } = await import("../scripts/check-migrations-lock.mjs");
  const name = "202610240001_phase1_foundation.sql";
  const lock = { version: 1, appliedThrough: name, appliedOrder: [name], appliedMigrations: { [name]: hashMigrationContent("baseline") } };
  assert.match(validateMigrationLock(lock, [name], () => Buffer.from("edited"))[0], /Applied migration changed/);
  assert.match(validateMigrationLock(lock, [name, "202610230001_old.sql"], () => Buffer.from("baseline")).join("\n"), /not locked: 202610230001_old.sql/);
});

test("migration hashes normalize LF, CRLF, lone CR, and UTF-8 BOM; SQL changes alter the hash", async () => {
  const { hashMigrationContent } = await import("../scripts/check-migrations-lock.mjs");
  const lf = "CREATE TABLE example (id int);\n-- baseline\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const loneCr = lf.replace(/\n/g, "\r");
  const bomCrLf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlf, "utf8")]);
  const expected = hashMigrationContent(lf);
  assert.equal(hashMigrationContent(crlf), expected);
  assert.equal(hashMigrationContent(loneCr), expected);
  assert.equal(hashMigrationContent(bomCrLf), expected);
  assert.notEqual(hashMigrationContent(lf.replace("id int", "id bigint")), expected);
});

test("migration lock rejects reordered or deleted applied migrations", async () => {
  const { hashMigrationContent, validateMigrationLock } = await import("../scripts/check-migrations-lock.mjs");
  const first = "202610240001_phase1_foundation.sql";
  const second = "202610250001_next_applied.sql";
  const contents = new Map([[first, "select 1;\n"], [second, "select 2;\n"]]);
  const lock = {
    version: 1,
    appliedThrough: second,
    appliedOrder: [first, second],
    appliedMigrations: {
      [first]: hashMigrationContent(contents.get(first)),
      [second]: hashMigrationContent(contents.get(second)),
    },
  };
  const read = name => Buffer.from(contents.get(name) ?? "");
  assert.match(validateMigrationLock(lock, [second, first], read).join("\n"), /Applied migration order changed/);
  assert.match(validateMigrationLock(lock, [first], read).join("\n"), /Locked migration is missing: 202610250001_next_applied.sql/);
});
