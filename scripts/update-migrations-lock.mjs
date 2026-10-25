import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashMigrationContent } from "./check-migrations-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "supabase", "migrations");
const lockPath = path.join(root, "migrations.lock");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort();
const appliedThrough = lock.appliedThrough;
const appliedOrder = migrationNames.filter(name => name.localeCompare(appliedThrough) <= 0);
if (!appliedOrder.includes(appliedThrough)) {
  throw new Error(`Applied-through migration is missing from ${migrationDir}: ${appliedThrough}`);
}

for (const name of appliedOrder) {
  lock.appliedMigrations[name] = hashMigrationContent(readFileSync(path.join(migrationDir, name)));
}
lock.appliedOrder = appliedOrder;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
console.log(`Updated normalized SHA-256 hashes for ${appliedOrder.length} applied migration(s).`);
