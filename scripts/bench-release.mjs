// 8D operator task: release one quarter's benchmark figures (BENCHMARKS_DESIGN.md section 3). Run once per quarter, 45
// days or more after it ends, with the migration administrator's connection (SEED_DATABASE_URL). The database refuses an
// early, repeated or under-k release; the app role cannot run it. Prints counts only, never a band.
//   node scripts/bench-release.mjs 2026-Q3
import pg from "pg";
const quarter = process.argv[2] ?? "";
if (!/^20[2-9][0-9]-Q[1-4]$/.test(quarter)) { console.error("Usage: node scripts/bench-release.mjs YYYY-Qn"); process.exit(2); }
if (!process.env.SEED_DATABASE_URL) { console.error("Administrative SEED_DATABASE_URL is required."); process.exit(2); }
const url = process.env.SEED_DATABASE_URL, local = /(localhost|127\.0\.0\.1)/i.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: true } });
await client.connect();
try {
  const cells = (await client.query("SELECT public.bench_publish($1::text, 1, 10) AS n", [quarter])).rows[0].n;
  const shared = (await client.query("SELECT count(*)::int AS n FROM rebatehq_private.bench_submission WHERE quarter=$1", [quarter])).rows[0].n;
  console.log(`Released ${quarter}: ${cells} cell(s) published from ${shared} contributing workspace(s); smaller cells suppressed.`);
} catch (e) {
  console.error(`Release refused: ${e?.message ?? "unknown error"}`); process.exitCode = 1;
} finally { await client.end(); }
