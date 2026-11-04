// Guided 7-day setup checklist. Steps are detected from the vault itself (imports, rules,
// audit entries) and kept in setup_progress, so a step stays done once reached, even if the
// data that proved it is removed later. Playground (sample) data never counts. Only the
// "invite the team" step can also be marked by hand, because teamwork happens outside the vault.
import type { Engine } from "../vault/engine";
import { sqlText as Q } from "../spike/exact";
import { SETUP_STEPS } from "../vault/schema";
import { PLAYGROUND_PREFIX } from "../studio/playground";
export type Step = typeof SETUP_STEPS[number];
export type StepView = { step: Step; label: string; day: number; hint: string; where: string; done: boolean; doneAt: string | null; how: "auto" | "manual" | null; manual: boolean };
export type Checklist = { steps: StepView[]; done: number; total: number; startedAt: string | null; day: number; complete: boolean; hasOwner: boolean };
export const STEP_INFO: Record<Step, { label: string; day: number; hint: string; where: string; manual?: boolean }> = {
  import: { label: "Import your ERP sales history", day: 1, hint: "Drop a real sales export in Data Hub. The Playground sample does not count.", where: "#data-hub" },
  map: { label: "Map your item master or customers", day: 1, hint: "Import an item master, customer list or vendor cost file (or save a mapping recipe) so products, tiers and costs are known.", where: "#data-hub" },
  fix: { label: "Fix what the import flagged", day: 2, hint: "Work through Fix Later and the item master cleanup, or clear every rejected row.", where: "#data-hub" },
  report: { label: "Run your first report", day: 3, hint: "Open Margin and download the Margin Leak Report from your real data.", where: "#margin" },
  rule: { label: "Create your first pricing rule", day: 4, hint: "Save a cost-rise rule in Pricing.", where: "#pricing" },
  export: { label: "Export your first price file", day: 5, hint: "Approve a simulation as Pricing Owner, then export the ERP price file.", where: "#pricing" },
  team: { label: "Invite the team", day: 7, hint: "Assign a role to each colleague in Settings, or mark this done once your team has access.", where: "#settings", manual: true },
};
const REAL = `name NOT LIKE ${Q(PLAYGROUND_PREFIX + "%")}`;
/** Which steps the vault's own data proves right now. */
export async function detect(e: Engine): Promise<Record<Step, boolean>> {
  const r = (await e.conn.query(`SELECT
 EXISTS(SELECT 1 FROM source_files WHERE role = 'sales_history' AND ${REAL}) AS imported,
 EXISTS(SELECT 1 FROM source_files WHERE role IN ('item_master','customer_list','vendor_cost') AND ${REAL}) OR EXISTS(SELECT 1 FROM converter_recipes) AS mapped,
 (SELECT count(*) FROM rejected_rows WHERE status = 'open') AS open_rows,
 EXISTS(SELECT 1 FROM audit_log WHERE action LIKE 'fixlater.%' OR action LIKE 'cleanup.applied%') AS fixed,
 EXISTS(SELECT 1 FROM roi_ledger WHERE NOT coalesce(sample, false)) OR EXISTS(SELECT 1 FROM audit_log WHERE action = 'report.leak_pdf' AND details LIKE '%"sample":"false"%') AS reported,
 EXISTS(SELECT 1 FROM rules) AS ruled,
 EXISTS(SELECT 1 FROM audit_log WHERE action = 'pricing.exported') AS exported,
 (SELECT count(*) FROM role_assignments) AS people`)).toArray()[0];
  const imported = !!r.imported;
  return { import: imported, map: imported && !!r.mapped, fix: imported && (Number(r.open_rows) === 0 || !!r.fixed), report: !!r.reported, rule: !!r.ruled, export: !!r.exported, team: Number(r.people) >= 2 };
}
export async function read(e: Engine, now = new Date()): Promise<{ view: Checklist; newly: Step[] }> {
  const saved = new Map((await e.conn.query("SELECT step, done_at, how FROM setup_progress")).toArray().map(r => [String(r.step), { at: String(r.done_at), how: String(r.how) as "auto" | "manual" }]));
  const found = await detect(e), at = now.toISOString(), newly = SETUP_STEPS.filter(s => found[s] && !saved.has(s));
  const start = (await e.conn.query("SELECT min(occurred_at) AS t FROM audit_log")).toArray()[0].t, startedAt = start === null ? null : String(start);
  const steps = SETUP_STEPS.map<StepView>(step => {
    const s = saved.get(step) ?? (found[step] ? { at, how: "auto" as const } : null), info = STEP_INFO[step];
    return { step, label: info.label, day: info.day, hint: info.hint, where: info.where, done: !!s, doneAt: s ? s.at : null, how: s ? s.how : null, manual: !!info.manual };
  });
  const day = startedAt ? Math.max(1, Math.floor((now.getTime() - Date.parse(startedAt)) / 86_400_000) + 1) : 1;
  const hasOwner = Number((await e.conn.query("SELECT count(*) AS n FROM pricing_settings")).toArray()[0].n) > 0;
  return { view: { steps, done: steps.filter(s => s.done).length, total: steps.length, startedAt, day, complete: steps.every(s => s.done), hasOwner }, newly };
}
/** SQL that stores newly reached steps (and a manual mark). */
export function saveSql(steps: Step[], how: "auto" | "manual", at: string) {
  return steps.length ? `INSERT INTO setup_progress VALUES ${steps.map(s => `(${Q(s)},${Q(at)},${Q(how)})`).join(",")} ON CONFLICT DO NOTHING;` : "";
}
