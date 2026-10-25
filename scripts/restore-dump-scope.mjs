import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const APPLICATION_SCHEMAS = Object.freeze(["public"]);

export const EXCLUDED_SUPABASE_SCHEMAS = Object.freeze([
  "auth", "storage", "extensions", "realtime", "vault", "graphql", "graphql_public",
  "pgsodium", "supabase_functions", "supabase_migrations", "net", "cron", "pgmq",
]);

export function buildApplicationDumpArgs(schemas = APPLICATION_SCHEMAS) {
  if (!Array.isArray(schemas) || schemas.length !== APPLICATION_SCHEMAS.length || schemas[0] !== "public") {
    throw new Error(`Restore dumps may include only the application schema allowlist: ${APPLICATION_SCHEMAS.join(", ")}.`);
  }
  return ["--schema", schemas.join(",")];
}

export function assertMigrationsFitApplicationSchemas(migrationsDirectory = "supabase/migrations") {
  const migrationFiles = readdirSync(migrationsDirectory).filter(file => file.endsWith(".sql")).sort();
  if (migrationFiles.length === 0) throw new Error("No SQL migrations were found; refusing to construct a restore dump allowlist.");
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDirectory, file), "utf8");
    if (/\bCREATE\s+SCHEMA\b/i.test(sql)) {
      throw new Error(`${file} creates a schema; review and explicitly expand the restore schema allowlist before dumping.`);
    }
    const declarations = [...sql.matchAll(/\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*)(?:\.("(?:[^"]|"")*"|[a-zA-Z_][a-zA-Z0-9_$]*))?/gi)];
    for (const match of declarations) {
      const schema = match[2] ? match[1].replace(/^"|"$/g, "").replace(/""/g, '"') : "public";
      if (!APPLICATION_SCHEMAS.includes(schema)) {
        throw new Error(`${file} creates table ${schema}.${match[2] ?? match[1]}; review and explicitly expand the restore schema allowlist before dumping.`);
      }
    }
  }
  return migrationFiles.length;
}

if (process.argv[1] && process.argv[1].endsWith("restore-dump-scope.mjs")) {
  const migrationCount = assertMigrationsFitApplicationSchemas();
  const args = buildApplicationDumpArgs();
  process.stdout.write(args[1]);
  process.stderr.write(`Restore dump schema allowlist: ${args[1]} (checked ${migrationCount} SQL migration(s)).\n`);
  process.stderr.write(`Excluded Supabase-managed schemas: ${EXCLUDED_SUPABASE_SCHEMAS.join(", ")} (and every schema outside the allowlist).\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const fs = await import("node:fs");
    fs.appendFileSync(summary, [
      "### Restore dump schema scope",
      "",
      `- Included application schemas: ${APPLICATION_SCHEMAS.map(schema => `\`${schema}\``).join(", ")}`,
      `- SQL migrations checked for tables outside the allowlist or new schemas: ${migrationCount}.`,
      `- Excluded Supabase-managed schemas: ${EXCLUDED_SUPABASE_SCHEMAS.map(schema => `\`${schema}\``).join(", ")}`,
      "- All schemas outside the explicit application allowlist are excluded.",
      "",
    ].join("\n"), "utf8");
  }
}
