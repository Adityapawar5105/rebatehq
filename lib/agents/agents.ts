// Chunk 8B-1 (blueprint sections 6 and 9; v2.6 gap 1): Margin Drain agents. Local checks that the vault worker runs on
// a saved schedule while RebateHQ is open (and as soon as it opens when a check is overdue). There is no server-side
// service: nothing runs while the app is closed. Each run collects findings from six rules and reconciles them with the
// inbox: new findings arrive as "new", findings seen again keep their status (a resolved one that comes back is new
// again), dismissed ones stay dismissed, and open findings that no longer apply are marked "resolved".
// Rules: leaks above a threshold (4D leak finder), book prices below the floor, contracts expiring, supplier cost rises,
// customer health alerts (7C-3b, reused, not duplicated) and cost index triggers.
import type { Engine } from "../vault/engine";
import { VaultError } from "../vault/protocol";
import { sqlText as Q, validDate } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import type { LeakResult } from "../margin/leaks";
import { customerHealth } from "../margin/monitor";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";
import { triggers } from "./costindex";
import { msg } from "../i18n/core";

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const S = (v: unknown) => v === null || v === undefined ? "" : String(v);
const bad = (): never => { throw new VaultError("AGENTS", msg("agents.invalid")); };
export const RULES = ["leak", "below_floor", "contract_expiry", "cost_rise", "customer_health", "index_trigger"] as const;
export type Rule = typeof RULES[number];
export type AgentSettings = { enabled: boolean; intervalMinutes: number; leakThresholdCents: string; healthThresholdBp: number; expiryDays: 30 | 60 | 90; costRiseBp: number; updatedAt: string | null };
export const DEFAULTS: AgentSettings = { enabled: true, intervalMinutes: 60, leakThresholdCents: "10000", healthThresholdBp: 500, expiryDays: 30, costRiseBp: 300, updatedAt: null };
/** Cost rises count when the newest cost is dated within this many days. */
export const COST_RISE_DAYS = 90, MAX_INBOX = 2000;
export type Finding = { key: string; rule: Rule; subject: string; detail: Record<string, string>; amountCents: string | null };

export async function settings(e: Engine): Promise<AgentSettings> {
  const r = (await rows(e, "SELECT * FROM agent_settings WHERE id = 1"))[0];
  return r ? { enabled: r.enabled === true, intervalMinutes: Number(r.interval_minutes), leakThresholdCents: String(r.leak_threshold_cents), healthThresholdBp: Number(r.health_threshold_bp), expiryDays: Number(r.expiry_days) as 30 | 60 | 90, costRiseBp: Number(r.cost_rise_bp), updatedAt: String(r.updated_at) } : DEFAULTS;
}
export function settingsSql(input: unknown, at: string) {
  const v = input as Partial<AgentSettings> | null;
  if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") bad();
  const int = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? x as number : bad();
  const interval = int(v!.intervalMinutes, 15, 1440), health = int(v!.healthThresholdBp, 1, 10000), rise = int(v!.costRiseBp, 1, 100000);
  const expiry = [30, 60, 90].includes(v!.expiryDays as number) ? v!.expiryDays : bad();
  const leak = typeof v!.leakThresholdCents === "string" && /^(0|[1-9]\d{0,12})$/.test(v!.leakThresholdCents) ? v!.leakThresholdCents : bad();
  return `INSERT INTO agent_settings VALUES(1,${v!.enabled},${interval},${leak},${health},${expiry},${rise},${Q(at)}) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,
 leak_threshold_cents=excluded.leak_threshold_cents,health_threshold_bp=excluded.health_threshold_bp,expiry_days=excluded.expiry_days,cost_rise_bp=excluded.cost_rise_bp,updated_at=excluded.updated_at;`;
}

/** Every finding of every rule, as of `today`. `leaks` comes from the service's cached leak finder. */
export async function collect(e: Engine, s: AgentSettings, leaks: () => Promise<LeakResult>, today: string, signal?: AbortSignal, progress?: (part: number) => void): Promise<Finding[]> {
  validDate(today);
  const out: Finding[] = [], step = (n: number) => { signal?.throwIfAborted(); progress?.(n); };
  step(0);
  for (const f of (await leaks()).findings) if (BigInt(f.cents) >= BigInt(s.leakThresholdCents))
    out.push({ key: `leak|${f.id}`, rule: "leak", subject: f.label, detail: { title: f.title, lines: f.lines, type: f.type }, amountCents: f.cents });
  step(1);
  // Book prices in force today below their tier/category floor (guardrails, 4E).
  for (const r of await rows(e, `SELECT m.id, coalesce(m.product_id, '') AS p, coalesce(m.category, pr.category, '') AS cat, coalesce(m.tier, c.tier, '') AS tier, coalesce(m.customer_id, '') AS cust,
 m.price::VARCHAR AS price, g.floor::VARCHAR AS floor, (g.floor - m.price)::VARCHAR AS gap
FROM price_matrix m LEFT JOIN products pr ON pr.product_id = m.product_id LEFT JOIN customers c ON c.customer_id = m.customer_id
JOIN price_guardrails g ON g.tier = coalesce(m.tier, c.tier) AND g.category = coalesce(m.category, pr.category)
WHERE m.valid_from <= DATE ${Q(today)} AND (m.valid_to IS NULL OR m.valid_to >= DATE ${Q(today)}) AND m.price < g.floor ORDER BY m.id LIMIT 500`))
    out.push({ key: `below_floor|${r.id}`, rule: "below_floor", subject: S(r.p) || S(r.cat), detail: { product: S(r.p), category: S(r.cat), tier: S(r.tier), customer: S(r.cust), price: S(r.price), floor: S(r.floor) }, amountCents: S(r.gap) });
  step(2);
  for (const r of await rows(e, `SELECT id, coalesce(product_id, '') AS p, coalesce(category, '') AS cat, coalesce(customer_id, '') AS cust, coalesce(tier, '') AS tier, price::VARCHAR AS price, valid_to::VARCHAR AS valid_to
FROM price_matrix WHERE valid_to >= DATE ${Q(today)} AND valid_to <= DATE ${Q(today)} + INTERVAL ${s.expiryDays} DAY ORDER BY valid_to, id LIMIT 500`))
    out.push({ key: `contract_expiry|${r.id}|${r.valid_to}`, rule: "contract_expiry", subject: S(r.cust) || S(r.tier) || S(r.p), detail: { product: S(r.p), category: S(r.cat), customer: S(r.cust), tier: S(r.tier), price: S(r.price), validTo: S(r.valid_to) }, amountCents: null });
  step(3);
  // A vendor's newest cost for an item, dated in the last 90 days, above its previous cost by at least the threshold.
  for (const r of await rows(e, `WITH v AS (SELECT vendor, product_id, cost, effective_date, lag(cost) OVER (PARTITION BY vendor, product_id ORDER BY effective_date, id) AS prev,
 row_number() OVER (PARTITION BY vendor, product_id ORDER BY effective_date DESC, id DESC) AS n FROM vendor_costs WHERE effective_date <= DATE ${Q(today)})
SELECT vendor, product_id, cost::VARCHAR AS cost, prev::VARCHAR AS prev, effective_date::VARCHAR AS d, ${rhaSql("CAST(cost - prev AS HUGEINT) * 10000", "prev")}::VARCHAR AS bp
FROM v WHERE n = 1 AND prev > 0 AND cost > prev AND effective_date > DATE ${Q(today)} - INTERVAL ${COST_RISE_DAYS} DAY AND CAST(cost - prev AS HUGEINT) * 10000 >= CAST(prev AS HUGEINT) * ${s.costRiseBp}
ORDER BY vendor, product_id LIMIT 500`))
    out.push({ key: `cost_rise|${r.vendor}|${r.product_id}|${r.d}`, rule: "cost_rise", subject: S(r.product_id), detail: { vendor: S(r.vendor), product: S(r.product_id), previous: S(r.prev), latest: S(r.cost), date: S(r.d), riseBp: S(r.bp) }, amountCents: String(BigInt(S(r.cost)) - BigInt(S(r.prev))) });
  step(4);
  const health = await customerHealth(e, String(s.healthThresholdBp), today);
  for (const a of health.alerts) out.push({ key: `customer_health|${a.customer}|${a.marginDrop ? "m" : ""}${a.frequencyDrop ? "f" : ""}`, rule: "customer_health", subject: a.customer,
    detail: { name: a.name, marginDrop: String(a.marginDrop), frequencyDrop: String(a.frequencyDrop), beforeRate: a.before.rate ?? "", afterRate: a.after.rate ?? "", beforeOrders: a.before.orders, afterOrders: a.after.orders }, amountCents: null });
  step(5);
  for (const t of await triggers(e, today)) if (t.status === "triggered")
    out.push({ key: `index_trigger|${t.id}|${t.latestPeriod ?? ""}|${t.fx?.now ?? ""}`, rule: "index_trigger", subject: t.name,
      detail: { trigger: t.id, index: t.index, scope: t.scope, value: t.value, indexChangeBp: t.indexChangeBp ?? "", fxChangeBp: t.fxChangeBp ?? "", costChangeBp: t.costChangeBp ?? "0", skus: t.skus }, amountCents: null });
  step(6);
  return out;
}

/** SQL reconciling a run's findings with the inbox, and the run's counts. */
export async function reconcileSql(e: Engine, findings: Finding[], reason: "schedule" | "open" | "manual", startedAt: string, at: string) {
  if (!["schedule", "open", "manual"].includes(reason)) bad();
  const existing = new Map((await rows(e, "SELECT key, status FROM agent_inbox")).map(r => [String(r.key), String(r.status)]));
  const keys = new Set(findings.map(f => f.key)), fresh = findings.filter(f => !existing.has(f.key)).length;
  const resolved = [...existing].filter(([k, s]) => (s === "new" || s === "read") && !keys.has(k)).length;
  const values = findings.map(f => `(${Q(f.key)},${Q(f.rule)},${Q(f.subject)},${Q(JSON.stringify(f.detail))},${f.amountCents === null ? "NULL" : f.amountCents})`);
  const sql = `CREATE OR REPLACE TEMP TABLE md_agent_now(key VARCHAR, rule VARCHAR, subject VARCHAR, detail VARCHAR, amount BIGINT);
${values.length ? `INSERT INTO md_agent_now VALUES ${values.join(",")};` : ""}
UPDATE agent_inbox SET subject = n.subject, detail = n.detail, amount_cents = n.amount, last_seen = ${Q(at)}, status = CASE WHEN agent_inbox.status = 'resolved' THEN 'new' ELSE agent_inbox.status END
 FROM md_agent_now n WHERE agent_inbox.key = n.key;
INSERT INTO agent_inbox SELECT key, rule, subject, detail, amount, ${Q(at)}, ${Q(at)}, 'new' FROM md_agent_now WHERE key NOT IN (SELECT key FROM agent_inbox);
UPDATE agent_inbox SET status = 'resolved' WHERE status IN ('new', 'read') AND key NOT IN (SELECT key FROM md_agent_now);
DELETE FROM agent_inbox WHERE status = 'resolved' AND key IN (SELECT key FROM agent_inbox WHERE status = 'resolved' ORDER BY last_seen DESC, key OFFSET ${MAX_INBOX});
INSERT INTO agent_runs VALUES(${Q(crypto.randomUUID())},${Q(startedAt)},${Q(at)},${Q(reason)},${findings.length},${fresh},${resolved});
DROP TABLE md_agent_now;`;
  return { sql, stats: { findings: String(findings.length), fresh: String(fresh), resolved: String(resolved) } };
}

export async function lastRun(e: Engine) {
  const r = (await rows(e, "SELECT * FROM agent_runs ORDER BY finished_at DESC, id DESC LIMIT 1"))[0];
  return r ? { startedAt: String(r.started_at), finishedAt: String(r.finished_at), reason: String(r.reason), findings: String(r.findings), fresh: String(r.new_findings), resolved: String(r.resolved) } : null;
}
/** Is a scheduled check due at `now` (milliseconds)? */
export function due(s: AgentSettings, last: Awaited<ReturnType<typeof lastRun>>, now: number) { return s.enabled && (!last || now - Date.parse(last.finishedAt) >= s.intervalMinutes * 60_000); }
export async function counts(e: Engine) {
  const r = (await rows(e, "SELECT count(*) FILTER (WHERE status = 'new')::VARCHAR AS n, count(*) FILTER (WHERE status = 'read')::VARCHAR AS r, count(*) FILTER (WHERE status = 'dismissed')::VARCHAR AS d, count(*) FILTER (WHERE status = 'resolved')::VARCHAR AS x FROM agent_inbox"))[0];
  return { new: String(r.n), read: String(r.r), dismissed: String(r.d), resolved: String(r.x) };
}
export const INBOX_GRID: GridSpec = { rule: "text", subject: "text", amount: "money", first_seen: "date", last_seen: "date", status: "text" };
export async function inbox(e: Engine, offset = 0, grid?: unknown) {
  const base = `SELECT key, rule, subject, detail, amount_cents::VARCHAR AS amount, first_seen, last_seen, status FROM agent_inbox`;
  const page = await gridPage(e, base, INBOX_GRID, gridQuery(INBOX_GRID, grid), { fallback: "CASE g.status WHEN 'new' THEN 0 WHEN 'read' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, g.last_seen DESC, g.key", limit: 50, offset });
  return { offset, rows: page.rows.map(r => ({ key: String(r.key), rule: String(r.rule) as Rule, subject: String(r.subject), detail: JSON.parse(String(r.detail)) as Record<string, string>, amount: r.amount === null ? null : String(r.amount), first_seen: String(r.first_seen), last_seen: String(r.last_seen), status: String(r.status) })), grid: page.grid as GridMeta };
}
export function markSql(key: unknown, status: unknown) {
  if (typeof key !== "string" || !key || key.length > 600 || !["new", "read", "dismissed"].includes(status as string)) bad();
  return `UPDATE agent_inbox SET status = ${Q(status as string)} WHERE key = ${Q(key as string)} AND status <> 'resolved';`;
}
