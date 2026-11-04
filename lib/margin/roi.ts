// ROI tracker v1: roi_ledger keeps every leak finding with the dollars identified.
// One row per finding (id derived from the finding id); a re-run updates its amount.
// Playground findings are flagged `sample` and never count toward the real total;
// they are deleted with the Playground. "Recovered" arrives in Phase 2 (ROI v2).
import type { Engine } from "../vault/engine";
import { sqlText } from "../spike/exact";
import type { Finding } from "./leaks";
export type RoiSummary = { findings: string; identifiedCents: string; sampleFindings: string; sampleCents: string; since: string | null; updated: string | null };
export async function roiId(finding: string, sample: boolean) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode((sample ? "sample\u0001" : "") + finding)));
  return "roi-" + [...bytes.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/** SQL to upsert the findings that are new or changed; empty string when nothing changed. */
export async function ledgerSql(engine: Engine, findings: Finding[], sample: boolean, at: string) {
  const existing = new Map((await engine.conn.query("SELECT id, identified_cents::VARCHAR AS c FROM roi_ledger")).toArray().map(r => [String(r.id), String(r.c)]));
  const rows: string[] = [];
  for (const f of findings) {
    const id = await roiId(f.id, sample);
    if (existing.get(id) === f.cents) continue;
    rows.push(`(${sqlText(id)},${sqlText(f.id)},'identified',${f.cents},0,${sqlText(at)},${sqlText(f.title)},${sample},${sqlText(at)})`);
  }
  if (!rows.length) return { sql: "", changed: 0 };
  return { sql: `INSERT INTO roi_ledger(id,leak_id,action_taken,identified_cents,recovered_cents,recorded_at,finding,sample,updated_at) VALUES ${rows.join(",")}
ON CONFLICT (id) DO UPDATE SET identified_cents=excluded.identified_cents, finding=excluded.finding, updated_at=excluded.updated_at;`, changed: rows.length };
}
export async function roiSummary(engine: Engine): Promise<RoiSummary> {
  const r = (await engine.conn.query(`SELECT count(*) FILTER (WHERE NOT coalesce(sample,false))::VARCHAR AS n, coalesce(sum(identified_cents) FILTER (WHERE NOT coalesce(sample,false)),0)::VARCHAR AS c,
 count(*) FILTER (WHERE sample)::VARCHAR AS sn, coalesce(sum(identified_cents) FILTER (WHERE sample),0)::VARCHAR AS sc, min(recorded_at) FILTER (WHERE NOT coalesce(sample,false)) AS since, max(updated_at) AS updated FROM roi_ledger`)).toArray()[0];
  return { findings: String(r.n), identifiedCents: String(r.c), sampleFindings: String(r.sn), sampleCents: String(r.sc), since: r.since === null ? null : String(r.since), updated: r.updated === null ? null : String(r.updated) };
}
export const REMOVE_SAMPLE_SQL = "DELETE FROM roi_ledger WHERE sample;";
