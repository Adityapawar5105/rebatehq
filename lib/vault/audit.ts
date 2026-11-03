import { digest } from "./crypto";
import type { Engine } from "./engine";
import { sqlText } from "../spike/exact";
export const GENESIS = "0".repeat(64);
export type AuditEntry = { sequence: string; id: string; occurred_at: string; action: string; details: string; previous_hash: string; hash: string };
export function auditPayload(row: Omit<AuditEntry, "hash">) {
  return JSON.stringify([row.sequence, row.id, row.occurred_at, row.action, row.details, row.previous_hash]);
}
export async function appendAudit(engine: Engine, action: string, details: Record<string, string>) {
  const meta = (await engine.conn.query("SELECT audit_count::VARCHAR AS count,audit_tip FROM vault_meta WHERE id=1")).toArray()[0];
  const entry = { sequence: (BigInt(meta.count) + BigInt(1)).toString(), id: crypto.randomUUID(), occurred_at: new Date().toISOString(), action, details: JSON.stringify(details), previous_hash: String(meta.audit_tip) };
  const hash = await digest(auditPayload(entry));
  await engine.conn.query(`INSERT INTO audit_log VALUES (${entry.sequence},${sqlText(entry.id)},${sqlText(entry.occurred_at)},${sqlText(action)},${sqlText(entry.details)},${sqlText(entry.previous_hash)},${sqlText(hash)});
UPDATE vault_meta SET audit_count=${entry.sequence},audit_tip=${sqlText(hash)} WHERE id=1`);
}
export async function verifyEntries(entries: AsyncIterable<AuditEntry>, expectedCount: string, expectedTip: string) {
  let count = BigInt(0), previous = GENESIS;
  for await (const row of entries) {
    count++;
    if (row.sequence !== count.toString() || row.previous_hash !== previous || row.hash !== await digest(auditPayload(row))) return { valid: false, entries: count.toString() };
    previous = row.hash;
  }
  return { valid: count.toString() === expectedCount && previous === expectedTip, entries: count.toString() };
}
export async function verifyAudit(engine: Engine) {
  const meta = (await engine.conn.query("SELECT audit_count::VARCHAR AS count,audit_tip FROM vault_meta WHERE id=1")).toArray()[0];
  async function* rows() {
    for (let after = BigInt(0);;) {
      const batch = (await engine.conn.query(`SELECT sequence::VARCHAR AS sequence,id,occurred_at,action,details,previous_hash,hash FROM audit_log WHERE sequence>${after} ORDER BY sequence LIMIT 1000`)).toArray();
      if (!batch.length) break;
      for (const row of batch) { after = BigInt(row.sequence); yield { ...row } as AuditEntry; }
    }
  }
  return verifyEntries(rows(), String(meta.count), String(meta.audit_tip));
}
