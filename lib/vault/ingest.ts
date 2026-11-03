import * as duckdb from "@duckdb/duckdb-wasm";
import type { Engine } from "./engine";
import { CAPS, MAX_CSV_BYTES, VaultError, type Tier, type ImportEstimate } from "./protocol";
import { CSV_FIELDS, sqlText } from "../spike/exact";
import { nativeInsertSql } from "../spike/imports";
import { appendAudit } from "./audit";
export type Progress = (stage: string, done: string, total: string) => void;
export function estimateImport(file: Pick<File, "name" | "size">, tier: Tier): ImportEstimate {
  if (!/\.csv$/i.test(file.name) || file.name.length > 200 || file.size < 1 || file.size > MAX_CSV_BYTES) throw new VaultError("FILE", "Choose a non-empty .csv file below 256 MiB with a name under 200 characters.");
  return { bytes: String(file.size), estimatedMemoryBytes: String(file.size * 6), maxLines: String(CAPS[tier].lines), maxProducts: String(CAPS[tier].products), warning: "Estimated additional memory is six times the file size, not a guarantee. Close other tabs. Filter the date range if this is too large. No rows are changed until validation passes." };
}
export const STAGE_SQL = `CREATE TEMP TABLE import_stage(line_id BIGINT,product_id INTEGER,customer_id INTEGER,sale_date DATE,quantity INTEGER,list_cents BIGINT,discount_cents BIGINT,freight_cents BIGINT,rebate_cents BIGINT,cost_cents BIGINT,source_file VARCHAR)`;
export async function ingest(engine: Engine, file: File, tier: Tier, signal: AbortSignal, progress: Progress) {
  estimateImport(file, tier);
  const header = (await file.slice(0, 65536).text()).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  if (header !== CSV_FIELDS.join(",")) throw new VaultError("HEADER", "Row 1: use line_id, product_id, customer_id, sale_date, quantity, list_amount, discount_amount, freight_amount, rebate_amount, cost_amount in that order. Column mapping arrives in the next chunk.");
  const path = `ingest-${crypto.randomUUID()}.csv`, source = crypto.randomUUID(), now = new Date().toISOString();
  await engine.db.registerFileHandle(path, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  let transaction = false;
  try {
    signal.throwIfAborted(); progress("Reading CSV in the worker", "0", String(file.size));
    await engine.conn.query(`BEGIN; ${STAGE_SQL}`); transaction = true;
    // send yields execution tasks so cancelSent can interrupt a native scan.
    const result = await engine.conn.send(nativeInsertSql("import_stage", path, file.name));
    for await (const _batch of result) { signal.throwIfAborted(); }
    signal.throwIfAborted(); progress("Checking rows and plan limits", String(file.size), String(file.size));
    const stats = (await engine.conn.query(`SELECT count(*)::VARCHAR AS rows,count(DISTINCT line_id)::VARCHAR AS unique_rows FROM import_stage`)).toArray()[0];
    if (stats.rows === "0") throw new VaultError("EMPTY", "The file has no data rows.");
    if (stats.rows !== stats.unique_rows) {
      const duplicate = (await engine.conn.query(`WITH numbered AS (SELECT line_id,row_number() OVER()+1 AS source_row FROM import_stage), repeated AS (SELECT source_row,row_number() OVER(PARTITION BY line_id ORDER BY source_row) AS occurrence FROM numbered) SELECT min(source_row)::VARCHAR AS row FROM repeated WHERE occurrence>1`)).toArray()[0];
      throw new VaultError("DUPLICATE", `Row ${duplicate.row}, column A: line_id is repeated. No rows were imported.`);
    }
    const combined = (await engine.conn.query(`SELECT (SELECT count(*) FROM sales_lines)+(SELECT count(*) FROM import_stage) AS lines,
(SELECT count(DISTINCT product_id) FROM (SELECT product_id FROM products UNION ALL SELECT product_id::VARCHAR FROM import_stage)) AS products`)).toArray()[0];
    if (BigInt(combined.lines) > BigInt(CAPS[tier].lines) || BigInt(combined.products) > BigInt(CAPS[tier].products)) throw new VaultError("CAP", `This import exceeds your ${tier} limit of ${CAPS[tier].lines.toLocaleString()} invoice lines or ${CAPS[tier].products.toLocaleString()} products. Filter the file first.`);
    signal.throwIfAborted();
    // Existing products are preserved. Rows from this file supply missing IDs;
    // no current cost or master price is guessed from invoice line amounts.
    await engine.conn.query(`INSERT INTO products(product_id) SELECT DISTINCT product_id::VARCHAR FROM import_stage WHERE product_id::VARCHAR NOT IN (SELECT product_id FROM products);
INSERT INTO customers(customer_id) SELECT DISTINCT customer_id::VARCHAR FROM import_stage WHERE customer_id::VARCHAR NOT IN (SELECT customer_id FROM customers);
INSERT INTO source_files VALUES (${sqlText(source)},${sqlText(file.name)},'sales_history',${file.size},${sqlText(now)});
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at) VALUES (${sqlText(crypto.randomUUID())},${sqlText(source)},${stats.rows},0,${sqlText(now)});
INSERT INTO sales_lines SELECT ${sqlText(source)},line_id,product_id::VARCHAR,customer_id::VARCHAR,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,row_number() OVER()+1 FROM import_stage ORDER BY customer_id,sale_date,line_id;
DROP TABLE import_stage`);
    await appendAudit(engine, "import.committed", { source_id: source, rows: String(stats.rows), file_name: file.name });
    signal.throwIfAborted(); await engine.conn.query("COMMIT"); transaction = false;
  } catch (error) {
    if (transaction) await engine.conn.query("ROLLBACK");
    if (signal.aborted) throw new VaultError("CANCELLED", "Import cancelled. No rows were committed.");
    if (error instanceof VaultError) throw error;
    // Engine exceptions can embed cell contents. Only a location and our own
    // fixed error text may cross the worker boundary.
    const location = /Row (\d+), column ([A-J]):/.exec(error instanceof Error ? error.message : "");
    throw new VaultError("DATA", location ? `Row ${location[1]}, column ${location[2]}: invalid value. Use ISO dates, positive whole IDs/quantities and non-negative amounts with up to two decimals.` : "The CSV could not be read. Check its encoding, quotes, dates and numeric columns. No rows were imported.");
  } finally { await engine.db.dropFile(path); }
}
