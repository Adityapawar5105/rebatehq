import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFile = path.join(root, "supabase", "tests", "phase1_rls.sql");

async function runPgtap(connectionString: string) {
  const client = new Client({
    connectionString,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(connectionString) ? false : { rejectUnauthorized: true },
  });
  try {
    await client.connect();
    const sql = await readFile(testFile, "utf8");
    const result = await client.query(sql);
    const batches = Array.isArray(result) ? result : [result];
    const rows = batches.flatMap(batch => batch.rows as Array<Record<string, unknown>>);
    const lines = rows.flatMap(row => Object.values(row).map(String));
    const tap = lines.filter(line => /^(?:ok|not ok)\s+\d+\b|^1\.\.\d+\b|^# (?:Looks like|Failed)/.test(line));
    const output = tap.join("\n");
    const plan = output.match(/^1\.\.(\d+)$/m);
    const passed = [...output.matchAll(/^ok\s+\d+\b/gm)].length;
    const failed = [...output.matchAll(/^not ok\s+\d+\b/gm)].length;
    if (!plan || Number(plan[1]) !== 14 || passed !== 14 || failed !== 0) {
      throw new Error(`pgTAP did not report all 14 checks passing.\n${output || "No TAP output was returned."}`);
    }
    process.stdout.write(`${output}\n`);
  } finally {
    await client.end();
  }
}

async function runLocalSupabase() {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm exec supabase test db"]
      : ["exec", "supabase", "test", "db"];
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`supabase test db exited with code ${code ?? "unknown"}`)));
  });
}

async function main() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (connectionString) await runPgtap(connectionString);
  else await runLocalSupabase();
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Database integration test failed."}\n`);
  process.exitCode = 1;
});
