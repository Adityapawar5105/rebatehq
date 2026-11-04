import { fitsLicenceCapacity } from "../licence-policy";
// Fix Later queue: rejected rows kept at import (canonical values in rejected_rows
// v0..v11), corrected singly or in bulk, then re-checked with the same exact SQL and
// loaded under their original source file and row. Nothing is guessed or auto-fixed.
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import { appendAudit } from "../vault/audit";
import { ROLE_FIELDS, LOADABLE, StudioError, type Role } from "./formats";
import { cleanDate, cleanId, cleanNumber } from "./clean";
import { CODES, capUsage, commitSql, createStage, issueMessage, resetStage, validate, type StagedFile } from "./load";
import { CAPS, type Tier } from "../vault/protocol";
/** credits: the group can load as returns/credits (negative-quantity sales rows, chunk 4D). */
export type FixGroup = { sourceId: string; sourceName: string; role: Role; code: string; field: string | null; message: string; count: string; fixable: boolean; credits: boolean };
export type FixRow = { sourceRow: string; code: string; values: { field: string; value: string }[] };
const CANONICAL = { sheet: null, headerRow: 0, headerDepth: 1 as const, delimiter: "," as const, encoding: "utf-8" as const, decimal: "dot" as const, dateFormat: "YYYY-MM-DD" as const };
const slot = (role: Role, field: string) => { const i = ROLE_FIELDS[role].findIndex(f => f.name === field); if (i < 0) throw new StudioError("Unknown field for this file type."); return `v${i}`; };
const fieldOf = (code: string) => code.includes(":") ? code.split(":")[0] : null;
export async function fixGroups(engine: Engine): Promise<FixGroup[]> {
  const rows = (await engine.conn.query(`SELECT r.source_id, s.name, r.role, r.code, count(*)::VARCHAR AS n FROM rejected_rows r JOIN source_files s ON s.id=r.source_id
WHERE r.status='open' GROUP BY r.source_id, s.name, r.role, r.code ORDER BY count(*) DESC, s.name LIMIT 500`)).toArray();
  return rows.map(r => {
    const role = String(r.role) as Role, code = String(r.code);
    return { sourceId: String(r.source_id), sourceName: String(r.name), role, code, field: code === "credit:sign" ? null : fieldOf(code), count: String(r.n), credits: role === "sales_history" && code === "quantity:negative",
      message: code === "structure" ? "The row's layout was broken (extra values or an oversized cell). It can only be dismissed; fix the file and import it again." : issueMessage(code, CANONICAL),
      fixable: code !== "structure" && LOADABLE.includes(role) };
  });
}
export async function fixRows(engine: Engine, sourceId: string, code: string, offset = 0, limit = 50): Promise<FixRow[]> {
  const role = await roleOf(engine, sourceId), fields = ROLE_FIELDS[role];
  const rows = (await engine.conn.query(`SELECT source_row::VARCHAR AS r, code, ${fields.map((_, i) => `v${i}`).join(",")} FROM rejected_rows WHERE source_id=${sqlText(sourceId)} AND code=${sqlText(code)} AND status='open' ORDER BY source_row LIMIT ${Math.min(200, Math.max(1, limit))} OFFSET ${Math.max(0, Math.floor(offset))}`)).toArray();
  return rows.map(r => ({ sourceRow: String(r.r), code: String(r.code), values: fields.map((f, i) => ({ field: f.name, value: r[`v${i}`] === null ? "" : String(r[`v${i}`]) })) }));
}
async function roleOf(engine: Engine, sourceId: string) {
  const role = (await engine.conn.query(`SELECT role FROM source_files WHERE id=${sqlText(sourceId)}`)).toArray()[0]?.role;
  if (!role) throw new StudioError("That file is no longer in the vault.");
  return String(role) as Role;
}
/** Canonical form of a correction typed by the user (dot decimals, ISO dates). */
export function correction(role: Role, field: string, value: string) {
  const type = ROLE_FIELDS[role].find(f => f.name === field)?.type;
  if (!type) throw new StudioError("Unknown field for this file type.");
  const v = value.trim();
  if (v.length > 500) throw new StudioError("Keep corrections under 500 characters.");
  return type === "date" ? cleanDate(v, "YYYY-MM-DD").value : type === "amount" || type.startsWith("quantity") ? cleanNumber(v, "dot").value : type === "id" || type === "line_id" ? cleanId(v).value : v;
}
/** Set one field on all open rows of a group (or the listed rows). Returns the SQL to run in a transaction. */
export async function fixSetSql(engine: Engine, sourceId: string, code: string, field: string, value: string, rows: number[] | null) {
  const role = await roleOf(engine, sourceId), v = correction(role, field, value);
  const only = rows ? ` AND source_row IN (${rows.filter(Number.isInteger).slice(0, 500).join(",") || "NULL"})` : "";
  return { sql: `UPDATE rejected_rows SET ${slot(role, field)}=${v === "" ? "NULL" : sqlText(v)} WHERE source_id=${sqlText(sourceId)} AND code=${sqlText(code)} AND status='open'${only}`, role };
}
export function dismissSql(sourceId: string, code: string, rows: number[] | null) {
  const only = rows ? ` AND source_row IN (${rows.filter(Number.isInteger).slice(0, 500).join(",") || "NULL"})` : "";
  const pick = `SELECT source_row FROM rejected_rows WHERE source_id=${sqlText(sourceId)} AND code=${sqlText(code)} AND status='open'${only}`;
  return `UPDATE import_issues SET status='resolved' WHERE source_id=${sqlText(sourceId)} AND status='open' AND row_number IN (${pick});
UPDATE rejected_rows SET status='dismissed' WHERE source_id=${sqlText(sourceId)} AND code=${sqlText(code)} AND status='open'${only};`;
}
/**
 * Re-check ONE group (source + issue code) with the import's exact validation. Only the
 * group the user worked on is touched: re-checking a duplicate group is an explicit
 * "load anyway", never a side effect of fixing another group. Valid rows load under the
 * original source/row; the rest stay open with fresh codes. The caller saves afterwards.
 */
export async function recheck(engine: Engine, sourceId: string, code: string, tier: Tier) {
  const role = await roleOf(engine, sourceId);
  if (!LOADABLE.includes(role)) throw new StudioError("Rows of this file type cannot be loaded yet.");
  if (code === "structure") throw new StudioError("Rows with a broken layout can only be dismissed.");
  const fields = ROLE_FIELDS[role], s = sqlText(sourceId), name = String((await engine.conn.query(`SELECT name FROM source_files WHERE id=${s}`)).toArray()[0].name);
  const file: StagedFile = { ord: 0, role, name, bytes: 0, fingerprint: "", alignment: fields.map((f, index) => ({ field: f.name, index })), settings: CANONICAL, keyed: true, headers: fields.map(f => f.name), colOffset: 0 };
  await resetStage(engine); await createStage(engine, role);
  await engine.conn.query(`INSERT INTO st_${role} SELECT 0, source_row, ${fields.map((_, i) => `v${i}`).join(",")} FROM rejected_rows WHERE source_id=${s} AND status='open' AND code=${sqlText(code)}`);
  await validate(engine, role as Exclude<Role, "rebate_agreement">, [file], null);
  const counts = (await engine.conn.query(`SELECT count(*) FILTER (WHERE err IS NULL)::VARCHAR AS ok, count(*) FILTER (WHERE err IS NOT NULL)::VARCHAR AS bad FROM ty_${role}`)).toArray()[0];
  const ok = String(counts.ok), bad = String(counts.bad);
  if (ok === "0") { await resetStage(engine); return { loaded: "0", stillRejected: bad }; }
  const usage = await capUsage(engine, new Set([role]), null), cap = CAPS[tier];
  if (!fitsLicenceCapacity(tier,usage.products,usage.lines)) { await resetStage(engine); throw new StudioError(`Loading these rows would exceed your ${tier} limit of ${cap.lines.toLocaleString("en-US")} invoice lines or ${cap.products.toLocaleString("en-US")} products. Upgrade your workspace licence or filter the file.`); }
  const messages = CODES(role).map(code => `(0,${sqlText(code)},${sqlText(code.includes(":") ? code.split(":")[0] : "")},${sqlText(issueMessage(code, CANONICAL))})`).join(",");
  await engine.conn.query("BEGIN");
  try {
    await engine.conn.query(`DELETE FROM import_issues WHERE source_id=${s} AND status='open' AND row_number IN (SELECT src_row FROM ty_${role});
CREATE TEMP TABLE studio_files AS SELECT * FROM (VALUES (0, ${s}, ${sqlText(name)})) v(file_ord, source_id, name);
CREATE TEMP TABLE studio_messages AS SELECT * FROM (VALUES ${messages}) v(file_ord, code, column_name, message)`);
    await engine.conn.query(commitSql(new Set([role])));
    await engine.conn.query(`UPDATE rejected_rows SET status='loaded' WHERE source_id=${s} AND status='open' AND source_row IN (SELECT src_row FROM ty_${role} WHERE err IS NULL);
UPDATE rejected_rows SET code=t.err FROM ty_${role} t WHERE rejected_rows.source_id=${s} AND rejected_rows.source_row=t.src_row AND rejected_rows.status='open' AND t.err IS NOT NULL;
UPDATE import_batches SET rows_loaded=rows_loaded+${ok}, rows_rejected=greatest(0, rows_rejected-${ok}) WHERE source_id=${s}`);
    await appendAudit(engine, "fixlater.loaded", { source_id: sourceId, file_name: name, code, rows_loaded: ok, still_rejected: bad });
    await engine.conn.query("COMMIT");
  } catch (error) { await engine.conn.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { await resetStage(engine).catch(() => undefined); }
  return { loaded: ok, stillRejected: bad };
}
