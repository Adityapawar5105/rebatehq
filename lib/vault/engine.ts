import * as duckdb from "@duckdb/duckdb-wasm";
import { V1_SQL, V2_SQL, TABLES, upgradeSql } from "./schema";
export type Engine = { db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection; worker: Worker; writable: boolean };
export const MEMORY_PATH = "opfs://vault-ram.duckdb";
export async function openMemory(bytes?: Uint8Array): Promise<Engine> {
  const worker = new Worker(new URL("/spike/vault-ram-worker.js", self.location.origin));
  // The child wrapper's configured sync filesystem is RAM-only, not real OPFS.
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(new URL("/spike/duckdb-eh.wasm", self.location.origin).href);
    await db.open({ path: MEMORY_PATH, accessMode: duckdb.DuckDBAccessMode.READ_WRITE, maximumThreads: 1, opfs: { fileHandling: "manual" }, query: { castBigIntToDouble: false, castDecimalToDouble: false } });
    const conn = await db.connect();
    await conn.query("SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET memory_limit='512MB'; SET temp_directory=''");
    if (bytes) {
      await db.registerFileBuffer("vault-input.duckdb", bytes);
      await conn.query("ATTACH 'vault-input.duckdb' AS incoming (READ_ONLY)");
      const version = Number((await conn.query("SELECT schema_version FROM incoming.vault_meta WHERE id=1")).toArray()[0]?.schema_version);
      upgradeSql(version); // Reject future/invalid versions before creating tables.
      const inventory = (await conn.query("SELECT table_name FROM information_schema.tables WHERE table_catalog='incoming' AND table_schema='main' AND table_type='BASE TABLE' ORDER BY table_name")).toArray().map(row => String(row.table_name));
      if (JSON.stringify(inventory) !== JSON.stringify([...TABLES].sort())) throw new Error("Unsupported vault table inventory");
      await conn.query("USE incoming");
    }
    return { db, conn, worker, writable: !bytes };
  } catch (error) { try { await db.terminate(); } finally { worker.terminate(); } throw error; }
}
export async function makeWritable(engine: Engine) {
  if (engine.writable) return;
  const version = Number((await engine.conn.query("SELECT schema_version FROM incoming.vault_meta WHERE id=1")).toArray()[0].schema_version);
  await engine.conn.query('USE "vault-ram"; BEGIN');
  try {
    await engine.conn.query(V1_SQL + (version === 2 ? V2_SQL : ""));
    // Lazy copy-on-write within the SAME instance. Keep existing indexes in
    // the authenticated RAM snapshot for fast unlock; pay FK validation once,
    // on the first mutation. Never reopen the pinned build's read-only handle
    // for writes. No untrusted schema SQL is executed.
    for (const table of TABLES) await engine.conn.query(`INSERT INTO ${table} SELECT * FROM incoming.${table}`);
    await engine.conn.query("COMMIT; DETACH incoming"); await engine.db.dropFile("vault-input.duckdb"); engine.writable = true;
  } catch (error) { await engine.conn.query("ROLLBACK; USE incoming"); throw error; }
}
export async function snapshotBytes(engine: Engine) {
  await makeWritable(engine);
  await engine.conn.query("CHECKPOINT");
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => { engine.worker.removeEventListener("message", receive, true); reject(new Error("RAM snapshot timed out")); }, 10_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "vault-ram-exported") return;
      event.stopImmediatePropagation(); clearTimeout(timer); engine.worker.removeEventListener("message", receive, true);
      resolve(event.data.bytes);
    };
    engine.worker.addEventListener("message", receive, true); engine.worker.postMessage({ type: "vault-ram-export" });
  });
  return bytes;
}
export async function closeMemory(engine: Engine) {
  try { await engine.conn.close(); }
  finally { try { await engine.db.terminate(); } finally { engine.worker.terminate(); } }
}
