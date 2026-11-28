// Chunk 8C-1: the audit and compliance pack, built in the vault worker. A ZIP holding the hash-chained audit log, its
// verification result, approvals, exports and role changes as language-neutral CSV (codes and IDs only, formula-safe),
// a machine-readable verification.json, and a cover PDF in the user's language. Row notes, cost and prices are never
// read; audit details are the code-and-ID payloads the vault records.
import JSZip from "jszip";
import Papa from "papaparse";
import type { Engine } from "../vault/engine";
import { verifyAudit, GENESIS } from "../vault/audit";
import { Pdf, type Color } from "../margin/pdf";
import { dateTime, integer, translate, type Locale, type MessageKey, type Params } from "../i18n/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? "" : String(v);
const csv = (fields: string[], data: unknown[][]) => Papa.unparse({ fields, data: data.map(r => r.map(S)) }, { newline: "\n", escapeFormulae: true }) + "\n";
export const PACK_FORMAT = "rebatehq-audit-pack/1";
export const HASH_RULE = "SHA-256 (hex) of the JSON array [sequence, id, occurred_at, action, details, previous_hash]; previous_hash of entry 1 is 64 zeros; each entry's previous_hash is the hash of the entry before it.";

export async function auditPack(e: Engine, locale: Locale, at = new Date().toISOString()) {
  const check = await verifyAudit(e), meta = (await rows(e, "SELECT schema_version::VARCHAR AS v, audit_count::VARCHAR AS n, audit_tip AS tip FROM vault_meta WHERE id=1"))[0];
  const log: unknown[][] = [];
  for (let after = BigInt(0); ;) {
    const batch = await rows(e, `SELECT sequence::VARCHAR AS sequence,id,occurred_at,action,details,previous_hash,hash FROM audit_log WHERE audit_log.sequence>${after} ORDER BY audit_log.sequence LIMIT 5000`);
    if (!batch.length) break;
    for (const r of batch) { after = BigInt(String(r.sequence)); log.push([r.sequence, r.id, r.occurred_at, r.action, r.details, r.previous_hash, r.hash]); }
  }
  const approvals = [
    ...(await rows(e, `SELECT 'price_change' AS kind, v.id, v.snapshot_id AS reference, coalesce(r.approved_by, v.created_by) AS decided_by, v.created_at AS decided_at, 'approved' AS decision,
 v.diff_summary FROM price_versions v LEFT JOIN rule_runs r ON r.id=v.snapshot_id ORDER BY v.created_at, v.id`)).map(r => {
      // DuckDB-Wasm has no JSON extension (and the vault never downloads one): the summary is parsed here.
      let n = ""; try { n = S((JSON.parse(S(r.diff_summary)) as { rows?: unknown }).rows); } catch { n = ""; } return { ...r, rows: n } as Record<string, unknown>;
    }),
    ...(await rows(e, `SELECT 'quote_exception' AS kind, id, number AS reference, decided_by, decided_at, status AS decision, NULL AS rows FROM quotes WHERE decided_at IS NOT NULL ORDER BY decided_at, id`)),
  ].map(r => [r.kind, r.id, r.reference, r.decided_by, r.decided_at, r.decision, r.rows]);
  const exportEvents = log.filter(r => /export|pdf/.test(String(r[3])) || String(r[3]) === "pricing.exported");
  const receipts = (await rows(e, "SELECT id, run_id, profile, created_at, content_hash FROM price_export_receipts ORDER BY created_at, id")).map(r => [r.id, r.run_id, r.profile, r.created_at, r.content_hash]);
  const roleEvents = log.filter(r => String(r[3]).startsWith("roles.") || String(r[3]) === "pricing.owner_set");
  const current = (await rows(e, "SELECT user_id, role, assigned_by, assigned_at FROM role_assignments ORDER BY user_id")).map(r => [r.user_id, r.role, r.assigned_by, r.assigned_at]);
  const first = log.length ? S(log[0][2]) : null, last = log.length ? S(log[log.length - 1][2]) : null;
  const verification = { format: PACK_FORMAT, generated_at: at, schema_version: Number(meta.v), entries: check.entries, expected_entries: S(meta.n), chain_valid: check.valid, tip_hash: S(meta.tip), genesis_hash: GENESIS,
    first_entry_at: first, last_entry_at: last, hash_rule: HASH_RULE, counts: { approvals: approvals.length, export_events: exportEvents.length, export_receipts: receipts.length, role_events: roleEvents.length, current_roles: current.length },
    files: ["cover.pdf", "audit-log.csv", "approvals.csv", "exports.csv", "export-receipts.csv", "role-changes.csv", "current-roles.csv", "verification.json"] };
  const zip = new JSZip(), auditFields = ["sequence", "id", "occurred_at", "action", "details", "previous_hash", "hash"];
  zip.file("audit-log.csv", csv(auditFields, log));
  zip.file("approvals.csv", csv(["kind", "id", "reference", "decided_by", "decided_at", "decision", "rows"], approvals));
  zip.file("exports.csv", csv(auditFields, exportEvents));
  zip.file("export-receipts.csv", csv(["id", "run_id", "profile", "created_at", "content_hash"], receipts));
  zip.file("role-changes.csv", csv(auditFields, roleEvents));
  zip.file("current-roles.csv", csv(["user_id", "role", "assigned_by", "assigned_at"], current));
  zip.file("verification.json", JSON.stringify(verification, null, 2) + "\n");
  zip.file("cover.pdf", cover(verification, locale));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { name: `rebatehq-audit-pack-${at.slice(0, 10)}.zip`, bytes, verification };
}

const INK: Color = [.1, .1, .12], MUTED: Color = [.36, .38, .41];
function cover(v: { generated_at: string; schema_version: number; entries: string; chain_valid: boolean; tip_hash: string; first_entry_at: string | null; last_entry_at: string | null; counts: Record<string, number> }, locale: Locale) {
  const pdf = new Pdf(), L = 48, R = 564, tr = (k: MessageKey, p?: Params) => translate(locale, k, p); let y = 0;
  const page = () => { pdf.page(); y = 738; };
  const lines = (text: string, size = 10, bold = false) => { let line = ""; const flush = () => { if (y < 60) page(); pdf.text(L, y, line, size, bold, bold ? INK : MUTED); y -= size + 7; line = ""; };
    for (const word of text.split(/\s+/)) { if (Pdf.widthOf(line + (line ? " " : "") + word, size) > R - L && line) flush(); if (Pdf.widthOf(word, size) > R - L) { for (const ch of word) { if (Pdf.widthOf(line + ch, size) > R - L) flush(); line += ch; } } else line += (line ? " " : "") + word; } if (line) flush(); };
  page(); lines(tr("auditpack.title"), 22, true); lines(tr("auditpack.generated", { at: dateTime(locale, v.generated_at, true) + " UTC" }), 9);
  y -= 8; lines(tr(v.chain_valid ? "auditpack.valid" : "auditpack.invalid", { entries: integer(locale, v.entries) }), 13, true);
  lines(tr("auditpack.period", { from: v.first_entry_at ? dateTime(locale, v.first_entry_at, true) : "-", to: v.last_entry_at ? dateTime(locale, v.last_entry_at, true) : "-" }));
  lines(tr("auditpack.schema", { version: integer(locale, v.schema_version) })); lines(tr("auditpack.tip"), 10); lines(v.tip_hash, 9);
  y -= 8; lines(tr("auditpack.contents"), 13, true);
  for (const [key, n] of [["auditpack.approvals", v.counts.approvals], ["auditpack.exportEvents", v.counts.export_events], ["auditpack.receipts", v.counts.export_receipts], ["auditpack.roleEvents", v.counts.role_events], ["auditpack.currentRoles", v.counts.current_roles]] as const)
    lines(tr(key, { count: integer(locale, n) }));
  y -= 8; lines(tr("auditpack.howTo"), 13, true); lines(tr("auditpack.howToBody")); lines(tr("auditpack.limits")); lines(tr("auditpack.neutral"), 9);
  return pdf.bytes(tr("auditpack.title"));
}
