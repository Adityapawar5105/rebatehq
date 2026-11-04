// DuckDB-Wasm (the same pinned 1.32.0 build the vault uses) in Node, blocking API,
// so unit tests can prove that the SQL mirror agrees with the JS engine.
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
type Conn = { query(sql: string): { toArray(): Array<Record<string, unknown>> }; close(): void };
let shared: Promise<{ connect(): Conn }> | null = null;
export async function duckdbConnection(): Promise<Conn> {
  if (!shared) shared = (async () => {
    const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
    const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
    const bundles = { mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") }, eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") } };
    const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
    await db.instantiate();
    return db;
  })();
  return (await shared).connect();
}
/** Rows as plain objects with every value as a string (BigInt/HUGEINT safe); null stays null. */
export function rows(conn: Conn, sql: string): Array<Record<string, string | null>> {
  return conn.query(sql).toArray().map(r => Object.fromEntries(Object.entries({ ...r }).map(([k, v]) => [k, v === null || v === undefined ? null : String(v)])));
}
