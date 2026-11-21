import * as duckdb from "@duckdb/duckdb-wasm";
import { schemaSql, tablesFor, upgradeSql } from "./schema";
import { verifiedAssetUrl } from "./asset-integrity";
/**
 * Roadmap 9.4: the copy-on-write warm-up as one value instead of four flags.
 * - "snapshot": unlocked on the read-only snapshot; no copy started yet.
 * - "copying": the background copy is running on a second connection.
 * - "copied": the copy succeeded; the first change only switches connections.
 * - "failed": the background copy rolled back; the first change copies on the main connection.
 * - "writable": the main connection is on the writable copy (a new vault starts here).
 * `warming` is only the handle of the running or settled copy, so the first change can wait for it.
 */
export type Warm = "snapshot" | "copying" | "copied" | "failed" | "writable";
export type Engine = { db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection; worker: Worker; warm: Warm; warming: Promise<boolean> | null };
/** True when the first change needs no copy (already writable, or the background copy is ready). */
export const readyToWrite = (engine: Pick<Engine, "warm">) => engine.warm === "writable" || engine.warm === "copied";
export const MEMORY_PATH = "opfs://vault-ram.duckdb";
export async function openMemory(bytes?: Uint8Array): Promise<Engine> {
  const workerUrl = await verifiedAssetUrl("vault-ram-worker.js");
  let wasmUrl: string;
  try { wasmUrl = await verifiedAssetUrl("duckdb-eh.wasm"); }
  catch (error) { URL.revokeObjectURL(workerUrl); throw error; }
  let worker: Worker;
  try { worker = new Worker(workerUrl); }
  catch (error) { URL.revokeObjectURL(workerUrl); URL.revokeObjectURL(wasmUrl); throw error; }
  // The child wrapper's configured sync filesystem is RAM-only, not real OPFS.
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(wasmUrl);
    await db.open({ path: MEMORY_PATH, accessMode: duckdb.DuckDBAccessMode.READ_WRITE, maximumThreads: 1, opfs: { fileHandling: "manual" }, query: { castBigIntToDouble: false, castDecimalToDouble: false } });
    const conn = await db.connect();
    await conn.query("SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET memory_limit='512MB'; SET temp_directory=''");
    if (bytes) {
      await db.registerFileBuffer("vault-input.duckdb", bytes);
      await conn.query("ATTACH 'vault-input.duckdb' AS incoming (READ_ONLY)");
      const version = Number((await conn.query("SELECT schema_version FROM incoming.vault_meta WHERE id=1")).toArray()[0]?.schema_version);
      upgradeSql(version); // Reject future/invalid versions before creating tables.
      const inventory = (await conn.query("SELECT table_name FROM information_schema.tables WHERE table_catalog='incoming' AND table_schema='main' AND table_type='BASE TABLE' ORDER BY table_name")).toArray().map(row => String(row.table_name));
      if (JSON.stringify(inventory) !== JSON.stringify([...tablesFor(version)].sort())) throw new Error("Unsupported vault table inventory");
      await conn.query("USE incoming");
    }
    return { db, conn, worker, warm: bytes ? "snapshot" : "writable", warming: null };
  } catch (error) { try { await db.terminate(); } finally { worker.terminate(); } throw error; }
  finally { URL.revokeObjectURL(workerUrl); URL.revokeObjectURL(wasmUrl); }
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
    for (const table of tablesFor(version)) await conn.query(`INSERT INTO ${table} SELECT * FROM incoming.${table}`);
    await conn.query("COMMIT");
  } catch (error) { await conn.query("ROLLBACK").catch(() => undefined); throw error; }
}
async function switchToWritable(engine: Engine) {
  await engine.conn.query('USE "vault-ram"; DETACH incoming'); await engine.db.dropFile("vault-input.duckdb"); engine.warm = "writable";
}
/**
 * Start the copy on a second connection right after unlock. The main connection
 * keeps reading the snapshot meanwhile; makeWritable() finishes the switch.
 */
export function startWarmup(engine: Engine) {
  if (engine.warm === "writable" || engine.warming) return engine.warming;
  engine.warm = "copying";
  engine.warming = (async () => {
    let conn: duckdb.AsyncDuckDBConnection | null = null, copied = false;
    try { conn = await engine.db.connect(); await copyToWritable(engine, conn); copied = true; return true; }
    catch { return false; } // the first change then copies on the main connection
    finally { await conn?.close().catch(() => undefined); if (engine.warm === "copying") engine.warm = copied ? "copied" : "failed"; }
  })();
  return engine.warming;
}
export async function makeWritable(engine: Engine) {
  if (engine.warm === "writable") return;
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
