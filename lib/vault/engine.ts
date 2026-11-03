import * as duckdb from "@duckdb/duckdb-wasm";
import { schemaSql, TABLES, upgradeSql } from "./schema";
// `warming` is the background copy-on-write started after unlock (true = copied);
// `warmDone` turns true when it settles (`warmReady` when it succeeded), before the
// main connection switches over.
export type Engine = { db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection; worker: Worker; writable: boolean; warming: Promise<boolean> | null; warmDone: boolean; warmReady: boolean };
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
    return { db, conn, worker, writable: !bytes, warming: null, warmDone: false, warmReady: false };
  } catch (error) { try { await db.terminate(); } finally { worker.terminate(); } throw error; }
}
// Copy the authenticated read-only snapshot into the writable RAM catalog on
// `conn`. Lazy copy-on-write within the SAME instance: unlock stays fast, and FK
// validation is paid once. Never reopen the pinned build's read-only handle for
// writes. No untrusted schema SQL is executed.
async function copyToWritable(engine: Engine, conn: duckdb.AsyncDuckDBConnection) {
  const version = Number((await conn.query("SELECT schema_version FROM incoming.vault_meta WHERE id=1")).toArray()[0].schema_version);
  await conn.query('USE "vault-ram"; BEGIN');
  try {
    await conn.query(schemaSql(version));
    for (const table of TABLES) await conn.query(`INSERT INTO ${table} SELECT * FROM incoming.${table}`);
    await conn.query("COMMIT");
  } catch (error) { await conn.query("ROLLBACK").catch(() => undefined); throw error; }
}
async function switchToWritable(engine: Engine) {
  await engine.conn.query('USE "vault-ram"; DETACH incoming'); await engine.db.dropFile("vault-input.duckdb"); engine.writable = true;
}
/**
 * Start the copy on a second connection right after unlock. The main connection
 * keeps reading the snapshot meanwhile; makeWritable() finishes the switch.
 */
export function startWarmup(engine: Engine) {
  if (engine.writable || engine.warming) return engine.warming;
  engine.warming = (async () => {
    let conn: duckdb.AsyncDuckDBConnection | null = null;
    try { conn = await engine.db.connect(); await copyToWritable(engine, conn); engine.warmReady = true; return true; }
    catch { return false; } // the first change then copies on the main connection
    finally { await conn?.close().catch(() => undefined); engine.warmDone = true; }
  })();
  return engine.warming;
}
export async function makeWritable(engine: Engine) {
  if (engine.writable) return;
  if (engine.warming) {
    const copied = await engine.warming; engine.warming = null;
    if (copied) { await switchToWritable(engine); return; }
    // A failed background copy rolled back; retry once on the main connection.
  }
  await copyToWritable(engine, engine.conn).catch(async error => { await engine.conn.query("USE incoming"); throw error; });
  await switchToWritable(engine);
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
