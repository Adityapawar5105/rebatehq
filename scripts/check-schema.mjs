import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(migrationDir).filter(file => file.endsWith(".sql")).sort();
if (!files.length) throw new Error("No SQL migrations found.");
const sql = files.map(file => fs.readFileSync(path.join(migrationDir, file), "utf8")).join("\n");
const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)];
if (!tables.length) throw new Error("No public tables found in migrations.");
const errors = [];
const tableNames = new Set(tables.map(([, name]) => name.toLowerCase()));
for (const [, name, body] of tables) {
  if (!/\btenant_id\s+uuid\b/i.test(body)) errors.push(`${name} lacks tenant_id`);
}
if (!/ENABLE ROW LEVEL SECURITY/i.test(sql) || !/FORCE ROW LEVEL SECURITY/i.test(sql)) errors.push("RLS must be enabled and forced");
if (!/CREATE POLICY[\s\S]*FOR SELECT/i.test(sql) || !/CREATE POLICY[\s\S]*FOR INSERT/i.test(sql) || !/CREATE POLICY[\s\S]*FOR UPDATE/i.test(sql) || !/CREATE POLICY[\s\S]*FOR DELETE/i.test(sql)) errors.push("SELECT/INSERT/UPDATE/DELETE policies must be defined");
const rlsLists = [...sql.matchAll(/FOREACH\s+t\s+IN\s+ARRAY\s+ARRAY\[([^\]]+)\]/gi)].map(match => new Set([...match[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map(([, name]) => name.toLowerCase())));
if (!rlsLists.length) errors.push("No explicit public-table RLS loops were found");
for (const [, name] of tables) {
  if (rlsLists.some(list => !list.has(name.toLowerCase()))) errors.push(`${name} is missing from an RLS/index table list`);
}
if (tableNames.size !== tables.length) errors.push("Duplicate CREATE TABLE names were found across migrations");
if (!/audit_log_immutable/i.test(sql) || !/REVOKE\s+UPDATE,DELETE,TRUNCATE\s+ON\s+audit_log/i.test(sql)) errors.push("Audit log must be append-only");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`Schema check passed: ${tables.length} tenant-scoped tables; forced RLS and append-only audit are present.`);
