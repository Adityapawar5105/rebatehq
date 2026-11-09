// Chunk 7F-2: Parquet files (blueprint section 9: "DuckDB native"). The vault worker's DuckDB reads the file with its
// own Parquet extension, served from this app's origin and integrity-checked (lib/vault/parquet-engine.ts); nothing is
// fetched from DuckDB's servers. Every value arrives as text, so the normal preview, mapping and cleaning apply.
import { StudioError } from "./formats";
import { MAX_SHEET_CELLS, MAX_SHEET_ROWS, type Grid } from "./sheets";
import { MAX_COLUMNS } from "./text";
import { msg } from "../i18n/core";

/** Column names and up to `limit` rows as text (NULL stays null), plus the file's full row count. */
export type ParquetTable = { columns: string[]; rows: (string | null)[][]; total: number };
export type ParquetReader = (bytes: Uint8Array, limit: number) => Promise<ParquetTable>;

/** A Parquet table as a keyed grid: the first row holds the column names. */
export function parquetGrid(table: ParquetTable): Grid {
  if (!table.columns.length) throw new StudioError(msg("parquet.empty"));
  if (table.columns.length > MAX_COLUMNS) throw new StudioError(msg("parquet.tooWide", { max: MAX_COLUMNS }));
  if (table.total > MAX_SHEET_ROWS) throw new StudioError(msg("parquet.tooManyRows", { max: MAX_SHEET_ROWS }));
  if (table.total * table.columns.length > MAX_SHEET_CELLS) throw new StudioError(msg("parquet.tooManyCells", { max: MAX_SHEET_CELLS }));
  const rows = [table.columns.map(c => c.trim() || "?"), ...table.rows.map(r => table.columns.map((_, i) => r[i] ?? ""))];
  return { rows, rowNumbers: rows.map((_, i) => i + 1), colOffset: 0, merged: false, keyed: true, issues: [], notices: [msg("parquet.read", { rows: table.total, columns: table.columns.length })] };
}
export async function readParquet(reader: ParquetReader | undefined, bytes: Uint8Array) {
  if (!reader) throw new StudioError(msg("parquet.unavailable"));
  let table: ParquetTable;
  try { table = await reader(bytes, MAX_SHEET_ROWS); }
  catch (error) { if (error instanceof StudioError) throw error; throw new StudioError(msg("parquet.unreadable")); }
  return parquetGrid(table);
}
