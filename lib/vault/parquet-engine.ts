// Chunk 7F-2: Parquet through DuckDB (blueprint section 9). DuckDB-Wasm 1.32 (DuckDB v1.4.3) does not include the
// Parquet extension, and RebateHQ never lets DuckDB fetch from its servers. scripts/build-spike.mjs copies DuckDB's own
// signed wasm_eh extension from vendor/ to /spike/extensions/ and pins its SHA-256 here at build time. Before the first
// Parquet file, the worker fetches it from this origin and checks the pin, then points DuckDB's extension repository at
// the same origin and loads it (DuckDB also verifies the extension's signature).
import type { Engine } from "./engine";
import { assetPin, verifyAsset } from "./asset-integrity";
import { sqlText } from "../spike/exact";
import type { ParquetReader } from "../studio/parquet";
import { StudioError } from "../studio/formats";
import { msg } from "../i18n/core";

export const DUCKDB_VERSION = "v1.4.3", PARQUET_EXTENSION = `extensions/${DUCKDB_VERSION}/wasm_eh/parquet.duckdb_extension.wasm`;
const loaded = new WeakSet<Engine>();
/** Exported for the browser worker test, which writes a real Parquet fixture with DuckDB itself. */
export async function ensureParquet(e: Engine) {
  if (loaded.has(e)) return;
  const pin = assetPin(PARQUET_EXTENSION), repo = new URL("/spike/extensions", self.location.origin).href;
  if (!pin) throw new StudioError(msg("parquet.unavailable"));
  const response = await fetch(`${repo}/${DUCKDB_VERSION}/wasm_eh/parquet.duckdb_extension.wasm`, { integrity: pin.integrity, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new StudioError(msg("parquet.unavailable"));
  await verifyAsset(await response.arrayBuffer(), pin);
  await e.conn.query(`SET custom_extension_repository = ${sqlText(repo)}`);
  await e.conn.query("LOAD parquet");
  loaded.add(e);
}
/** Reads a Parquet file with the vault worker's DuckDB: column names, row count and, within the limit, text rows. */
export function parquetReader(e: Engine): ParquetReader {
  return async (bytes, limit) => {
    await ensureParquet(e);
    const name = `studio-${crypto.randomUUID()}.parquet`, source = `read_parquet(${sqlText(name)})`;
    await e.db.registerFileBuffer(name, bytes.slice());
    try {
      const columns = (await e.conn.query(`DESCRIBE SELECT * FROM ${source}`)).toArray().map(r => String(r.column_name));
      const total = Number((await e.conn.query(`SELECT count(*)::VARCHAR AS n FROM ${source}`)).toArray()[0].n);
      if (total > limit) return { columns, rows: [], total };
      const rows = (await e.conn.query(`SELECT COLUMNS(*)::VARCHAR FROM ${source}`)).toArray().map(r => columns.map(c => r[c] === null || r[c] === undefined ? null : String(r[c])));
      return { columns, rows, total };
    } finally { await e.db.dropFile(name).catch(() => undefined); }
  };
}
