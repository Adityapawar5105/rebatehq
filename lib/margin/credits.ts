// Returns and credits (chunk 4D decision). At import, sales rows with a negative quantity
// still wait in Fix Later ("quantity:negative"). The user loads that group as credits:
// each row is checked with the import's exact SQL on its absolute values, must have every
// amount zero or negative (same sign as the quantity), and loads as a signed `credit`
// line under its original source file and row. Credits net against sales in the
// waterfall ("Returns and credits") and are never leaks. Unknown cost stays NULL.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { appendAudit } from "../vault/audit";
import { ROLE_FIELDS, StudioError } from "../studio/formats";
import { CODES, capUsage, createStage, issueMessage, resetStage, validate, type StagedFile } from "../studio/load";
import { CAPS, type Tier } from "../vault/protocol";
import { msg, tierRef } from "../i18n/core";
export const CREDIT_CODE = "quantity:negative";
const CANONICAL = { sheet: null, headerRow: 0, headerDepth: 1 as const, delimiter: "," as const, encoding: "utf-8" as const, decimal: "dot" as const, dateFormat: "YYYY-MM-DD" as const };
const SIGNED = new Set(["quantity", "list_amount", "discount_amount", "freight_amount", "rebate_amount", "cost_amount"]);
export async function loadCredits(engine: Engine, sourceId: string, tier: Tier) {
  const s = sqlText(sourceId), src = (await engine.conn.query(`SELECT name, role FROM source_files WHERE id=${s}`)).toArray()[0];
  if (!src) throw new StudioError(msg("credits.thatFileIsNo"));
  if (src.role !== "sales_history") throw new StudioError(msg("credits.onlySalesHistoryRows"));
  const fields = ROLE_FIELDS.sales_history, name = String(src.name);
  const file: StagedFile = { ord: 0, role: "sales_history", name, bytes: 0, fingerprint: "", alignment: fields.map((f, index) => ({ field: f.name, index })), settings: CANONICAL, keyed: true, headers: fields.map(f => f.name), colOffset: 0 };
  await resetStage(engine); await createStage(engine, "sales_history");
  const abs = fields.map((f, i) => SIGNED.has(f.name) ? `CASE WHEN v${i} LIKE '-%' THEN substr(v${i}, 2) ELSE v${i} END` : `v${i}`).join(", ");
  await engine.conn.query(`INSERT INTO st_sales_history SELECT 0, source_row, ${abs} FROM rejected_rows WHERE source_id=${s} AND status='open' AND code=${sqlText(CREDIT_CODE)}`);
  // A credit's amounts must be zero or negative: a positive amount with a negative quantity is a sign error.
  const amounts = fields.map((f, i) => ({ f, i })).filter(x => SIGNED.has(x.f.name) && x.f.name !== "quantity");
  await engine.conn.query(`CREATE OR REPLACE TEMP TABLE credit_sign AS SELECT source_row FROM rejected_rows WHERE source_id=${s} AND status='open' AND code=${sqlText(CREDIT_CODE)}
 AND (${amounts.map(x => `(v${x.i} IS NOT NULL AND v${x.i} NOT LIKE '-%' AND coalesce(try_cast(v${x.i} AS DECIMAL(18,2)), 1) <> 0)`).join(" OR ")})`);
  await validate(engine, "sales_history", [file], null);
  await engine.conn.query(`UPDATE ty_sales_history SET err='credit:sign' WHERE err IS NULL AND src_row IN (SELECT source_row FROM credit_sign)`);
  const counts = (await engine.conn.query(`SELECT count(*) FILTER (WHERE err IS NULL)::VARCHAR AS ok, count(*) FILTER (WHERE err IS NOT NULL)::VARCHAR AS bad FROM ty_sales_history`)).toArray()[0];
  const ok = String(counts.ok), bad = String(counts.bad);
  if (ok === "0") { await resetStage(engine); return { loaded: "0", stillRejected: bad }; }
  const usage = await capUsage(engine, new Set(["sales_history"]), null), cap = CAPS[tier];
  if (usage.lines > BigInt(cap.lines) || usage.products > BigInt(cap.products)) { await resetStage(engine); throw new StudioError(msg("credits.loadingTheseCreditsWould", { tier: tierRef(tier), lines: cap.lines, products: cap.products })); }
  const codes = [...CODES("sales_history"), "credit:sign"];
  const messages = codes.map(code => `(0,${sqlText(code)},${sqlText(code.includes(":") ? code.split(":")[0] : "")},${sqlText(code === "credit:sign" ? CREDIT_SIGN_MESSAGE : issueMessage(code, CANONICAL))})`).join(",");
  const valid = "(SELECT * FROM ty_sales_history WHERE err IS NULL)";
  await engine.conn.query("BEGIN");
  try {
    await engine.conn.query(`DELETE FROM import_issues WHERE source_id=${s} AND status='open' AND row_number IN (SELECT src_row FROM ty_sales_history);
INSERT INTO products(product_id) SELECT DISTINCT product_id FROM ${valid} WHERE product_id NOT IN (SELECT product_id FROM products);
INSERT INTO customers(customer_id) SELECT DISTINCT customer_id FROM ${valid} WHERE customer_id NOT IN (SELECT customer_id FROM customers);
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind)
 SELECT ${s},line_id,product_id,customer_id,sale_date,-quantity,-list_cents,-coalesce(discount_cents,0),-coalesce(freight_cents,0),-coalesce(rebate_cents,0),-cost_cents,src_row,invoice_id,'credit' FROM ${valid} ORDER BY customer_id,sale_date,line_id;
INSERT INTO import_issues(id,source_id,row_number,column_name,message,status,code) SELECT gen_random_uuid()::VARCHAR, ${s}, t.src_row, m.column_name, m.message, 'open', t.err FROM ty_sales_history t JOIN (VALUES ${messages}) m(file_ord, code, column_name, message) ON m.code=t.err WHERE t.err IS NOT NULL;
UPDATE rejected_rows SET status='loaded' WHERE source_id=${s} AND status='open' AND code=${sqlText(CREDIT_CODE)} AND source_row IN (SELECT src_row FROM ty_sales_history WHERE err IS NULL);
UPDATE rejected_rows SET code=t.err FROM ty_sales_history t WHERE rejected_rows.source_id=${s} AND rejected_rows.source_row=t.src_row AND rejected_rows.status='open' AND rejected_rows.code=${sqlText(CREDIT_CODE)} AND t.err IS NOT NULL AND t.err <> 'quantity:negative';
UPDATE import_batches SET rows_loaded=rows_loaded+${ok}, rows_rejected=greatest(0, rows_rejected-${ok}) WHERE source_id=${s}`);
    await appendAudit(engine, "fixlater.credits_loaded", { source_id: sourceId, file_name: name, rows_loaded: ok, still_rejected: bad });
    await engine.conn.query("COMMIT");
  } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await resetStage(engine).catch(() => undefined); await engine.conn.query("DROP TABLE IF EXISTS temp.credit_sign").catch(() => undefined); }
  return { loaded: ok, stillRejected: bad };
}
export const CREDIT_SIGN_MESSAGE = msg("credits.aReturnWithA");
