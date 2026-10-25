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
  const lockedNames = lock.appliedOrder;
  if (!Array.isArray(lockedNames) || lockedNames.some(name => typeof name !== "string")) {
    return ["migrations.lock must include appliedOrder as an ordered array of applied migration filenames."];
  }
  const lockedNameSet = new Set(lockedNames);
  if (lockedNameSet.size !== lockedNames.length || lockedNameSet.size !== Object.keys(lock.appliedMigrations).length || Object.keys(lock.appliedMigrations).some(name => !lockedNameSet.has(name))) {
    errors.push("migrations.lock appliedOrder must contain each appliedMigrations entry exactly once.");
  }
  if (!lockedNames.length || !lockedNames.includes(lock.appliedThrough)) {
    errors.push("migrations.lock must list its appliedThrough migration.");
  }
  const actualAppliedOrder = migrationNames.filter(name => name.localeCompare(lock.appliedThrough) <= 0);
  if (JSON.stringify(actualAppliedOrder) !== JSON.stringify(lockedNames)) {
    errors.push(`Applied migration order changed (expected ${lockedNames.join(", ")}, found ${actualAppliedOrder.join(", ")}).`);
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
    const actual = hashMigrationContent(readMigration(name));
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

  // Pending migrations are hash-pinned without claiming they were applied or
  // verified in CI. Once a passing run applies them, advance appliedThrough.
  if (lock.pendingOrder !== undefined || lock.pendingMigrations !== undefined) {
    const pendingOrder = lock.pendingOrder;
    const pendingMigrations = lock.pendingMigrations;
    if (!Array.isArray(pendingOrder) || !pendingMigrations || typeof pendingMigrations !== "object") {
      errors.push("migrations.lock pendingOrder and pendingMigrations must both be present for pending entries.");
    } else {
      const pendingSet = new Set(pendingOrder);
      if (pendingSet.size !== pendingOrder.length || pendingSet.size !== Object.keys(pendingMigrations).length || Object.keys(pendingMigrations).some(name => !pendingSet.has(name))) {
        errors.push("migrations.lock pendingOrder must contain each pendingMigrations entry exactly once.");
      }
      const currentPendingOrder = migrationNames.filter(name => name.localeCompare(through) > 0);
      if (JSON.stringify(currentPendingOrder) !== JSON.stringify(pendingOrder)) {
        errors.push(`Pending migration order changed (expected ${pendingOrder.join(", ")}, found ${currentPendingOrder.join(", ")}).`);
      }
      for (const name of pendingOrder) {
        if (path.basename(name) !== name || !name.endsWith(".sql")) {
          errors.push(`Invalid pending migration filename in migrations.lock: ${name}`);
          continue;
        }
        if (!currentNames.has(name)) {
          errors.push(`Pending migration is missing: ${name}`);
          continue;
        }
        const expected = pendingMigrations[name];
        if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) {
          errors.push(`Invalid SHA-256 entry for pending migration ${name} in migrations.lock.`);
          continue;
        }
        const actual = hashMigrationContent(readMigration(name));
        if (actual.toLowerCase() !== expected.toLowerCase()) {
          errors.push(`Pending migration changed: ${name} (expected ${expected.toLowerCase()}, found ${actual}). Refresh the pending hash or add a corrective migration.`);
        }
      }
    }
  }
  return errors;
}

export function normalizeMigrationContent(content) {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function hashMigrationContent(content) {
  return createHash("sha256").update(normalizeMigrationContent(content), "utf8").digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort();
  const errors = validateMigrationLock(lock, migrationNames, name => readFileSync(path.join(migrationDir, name)));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Migration freeze passed: ${Object.keys(lock.appliedMigrations).length} applied migration(s) and ${Object.keys(lock.pendingMigrations ?? {}).length} pending migration(s) match migrations.lock through ${lock.appliedThrough}. Pending hashes do not claim CI application.`);
}
