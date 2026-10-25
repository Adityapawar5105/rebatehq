import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "supabase", "migrations");
const lockPath = path.join(root, "migrations.lock");

export function validateMigrationLock(lock, migrationNames, readMigration) {
  const errors = [];
  if (lock.version !== 1 || !lock.appliedMigrations || typeof lock.appliedMigrations !== "object") {
    return ["migrations.lock has an unsupported format or no appliedMigrations map."];
  }
  const currentNames = new Set(migrationNames);
  const lockedNames = Object.keys(lock.appliedMigrations).sort();
  if (!lockedNames.length || !lockedNames.includes(lock.appliedThrough)) {
    errors.push("migrations.lock must list its appliedThrough migration.");
  }

  for (const name of lockedNames) {
    if (path.basename(name) !== name || !name.endsWith(".sql")) {
      errors.push(`Invalid migration filename in migrations.lock: ${name}`);
      continue;
    }
    if (!currentNames.has(name)) {
      errors.push(`Locked migration is missing: ${name}`);
      continue;
    }
    const expected = lock.appliedMigrations[name];
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) {
      errors.push(`Invalid SHA-256 entry for ${name} in migrations.lock.`);
      continue;
    }
    const actual = createHash("sha256").update(readMigration(name)).digest("hex");
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      errors.push(`Applied migration changed: ${name} (expected ${expected.toLowerCase()}, found ${actual}). Add a new migration instead of editing it.`);
    }
  }

  const through = lock.appliedThrough;
  for (const name of migrationNames) {
    if (name.localeCompare(through) <= 0 && !Object.hasOwn(lock.appliedMigrations, name)) {
      errors.push(`Migration at or before appliedThrough is not locked: ${name}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort();
  const errors = validateMigrationLock(lock, migrationNames, name => readFileSync(path.join(migrationDir, name)));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Migration freeze passed: ${Object.keys(lock.appliedMigrations).length} applied migration(s) match migrations.lock through ${lock.appliedThrough}.`);
}
