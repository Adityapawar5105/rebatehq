// Chunk 8C-1 (blueprint Phase 3): the win/loss log on quotes. An outcome (won, lost, no decision) with a reason code,
// an optional competitor and a note is recorded on a quote that has left draft. Reports group recorded outcomes by
// reason, customer or rep. Decision 16: a caller without "cost" never receives margin, and a Sales Rep sees only their
// own quotes (the same rule as the quote list). Values are quoted prices × quantities, exact integer cents.
import type { Engine } from "../vault/engine";
import { sqlText as Q, validDate } from "../spike/exact";
import { rhaSql } from "../margin/sql";
import { bpPercentSql } from "../margin/views";
import { rha, basisPointsDecimal } from "../margin/decimal";
import { gridPage, gridQuery } from "../grid/sql";
import type { GridMeta, GridSpec } from "../grid/core";
import { VaultError } from "../vault/protocol";
import { msg } from "../i18n/core";
import { OUTCOMES, REASONS, type Outcome, type Reason, type ReportBy } from "./outcomes";
import { addDays, businessToday } from "../vault/today";
export { OUTCOMES, REASONS, type Outcome, type Reason, type ReportBy };

const rows = async (e: Engine, sql: string) => (await e.conn.query(sql)).toArray().map(r => ({ ...r }) as Record<string, unknown>);
const bad = (): never => { throw new VaultError("WINLOSS", msg("winloss.invalid")); };
export type OutcomeInput = { outcome: Outcome; reason: Reason; competitor?: string | null; note?: string | null };
export type OutcomeView = { outcome: Outcome; reason: Reason; competitor: string | null; note: string | null; recordedBy: string; recordedAt: string };
const text = (v: unknown, max: number) => v === null || v === undefined || v === "" ? null : typeof v === "string" && v.trim().length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) ? v.trim() || null : bad();

export async function outcomeSql(e: Engine, id: string, input: unknown, userId: string, at: string) {
  const v = input as Partial<OutcomeInput> | null;
  if (!v || typeof v !== "object" || !OUTCOMES.includes(v.outcome as Outcome) || !REASONS.includes(v.reason as Reason)) bad();
  const competitor = text(v!.competitor, 100), note = text(v!.note, 1000);
  const q = (await rows(e, `SELECT status FROM quotes WHERE id=${Q(id)}`))[0];
  if (!q) throw new VaultError("QUOTE", msg("quote.notFound"));
  if (q.status === "draft") throw new VaultError("WINLOSS", msg("winloss.draft"));
  // Phase 1 (audit B-13): a quote is won only once it was sent, or its exception was approved.
  if (v!.outcome === "won" && q.status !== "submitted" && q.status !== "approved") throw new VaultError("WINLOSS", msg("winloss.wonNeedsDecision"));
  const n = (x: string | null) => x === null ? "NULL" : Q(x);
  return `INSERT INTO quote_outcomes VALUES(${Q(id)},${Q(v!.outcome!)},${Q(v!.reason!)},${n(competitor)},${n(note)},${Q(userId)},${Q(at)})
 ON CONFLICT(quote_id) DO UPDATE SET outcome=excluded.outcome,reason=excluded.reason,competitor=excluded.competitor,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;`;
}
export async function outcomeOf(e: Engine, id: string): Promise<OutcomeView | null> {
  const r = (await rows(e, `SELECT * FROM quote_outcomes WHERE quote_id=${Q(id)}`))[0];
  return r ? { outcome: String(r.outcome) as Outcome, reason: String(r.reason) as Reason, competitor: r.competitor === null ? null : String(r.competitor), note: r.note === null ? null : String(r.note), recordedBy: String(r.recorded_by), recordedAt: String(r.recorded_at) } : null;
}

export type ReportInput = { by?: ReportBy; from?: string; to?: string; offset?: number; grid?: unknown };
const COMMON: GridSpec = { key: "text", label: "text", quotes: "int", won: "int", lost: "int", open: "int", win_rate: "percent", won_value: "money", lost_value: "money" };
export const WINLOSS_GRID: GridSpec = { ...COMMON, won_margin: "money", lost_margin: "money" };
export const WINLOSS_GRID_REP: GridSpec = COMMON;

/** Outcomes recorded between `from` and `to` (inclusive, UTC dates), grouped. `mineOnly` limits to the caller's quotes. */
export async function report(e: Engine, input: ReportInput, who: { userId: string; mineOnly: boolean; withCost: boolean }) {
  const to = input.to ?? businessToday(), from = input.from ?? addDays(input.to ?? businessToday(), -364), by = input.by ?? "reason";
  try { validDate(from); validDate(to); } catch { bad(); }
  if (from > to || !["reason", "customer", "rep"].includes(by)) bad();
  const line = (amount: string) => `CAST(${rhaSql(`CAST(${amount} AS HUGEINT)*CAST(l.quantity*10000 AS HUGEINT)`, "10000")} AS BIGINT)`;
  const scope = `substr(o.recorded_at,1,10) BETWEEN ${Q(from)} AND ${Q(to)}${who.mineOnly ? ` AND q.created_by=${Q(who.userId)}` : ""}`;
  const qt = `SELECT q.id, q.customer_id, q.created_by, o.outcome, o.reason, coalesce(sum(${line("l.unit_price_cents")}),0) AS total,
 coalesce(sum(CASE WHEN l.cost_cents IS NULL THEN 0 ELSE ${line("l.unit_price_cents - l.cost_cents")} END),0) AS margin
 FROM quotes q JOIN quote_outcomes o ON o.quote_id=q.id LEFT JOIN quote_lines l ON l.quote_id=q.id WHERE ${scope} GROUP BY ALL`;
  const key = by === "reason" ? "t.reason" : by === "customer" ? "t.customer_id" : "t.created_by";
  const label = by === "reason" ? "t.reason" : by === "customer" ? "coalesce(max(c.name),'')" : "coalesce(max(r.display_name),'')";
  const won = "count(*) FILTER(WHERE t.outcome='won')", lost = "count(*) FILTER(WHERE t.outcome='lost')";
  const agg = `count(*)::VARCHAR AS quotes, ${won}::VARCHAR AS won, ${lost}::VARCHAR AS lost, count(*) FILTER(WHERE t.outcome='no_decision')::VARCHAR AS open,
 ${rhaSql(`CAST(${won} AS HUGEINT)*10000`, `nullif(${won}+${lost},0)`)} AS win_bp,
 coalesce(sum(t.total) FILTER(WHERE t.outcome='won'),0)::VARCHAR AS won_value, coalesce(sum(t.total) FILTER(WHERE t.outcome='lost'),0)::VARCHAR AS lost_value
 ${who.withCost ? ", coalesce(sum(t.margin) FILTER(WHERE t.outcome='won'),0)::VARCHAR AS won_margin, coalesce(sum(t.margin) FILTER(WHERE t.outcome='lost'),0)::VARCHAR AS lost_margin" : ""}`;
  const body = `SELECT ${key} AS key, ${label} AS label, ${agg} FROM (${qt}) t LEFT JOIN customers c ON c.customer_id=t.customer_id LEFT JOIN role_assignments r ON r.user_id=t.created_by GROUP BY ${key}`;
  const base = `SELECT * EXCLUDE(win_bp), ${bpPercentSql("CAST(win_bp AS BIGINT)")} AS win_rate FROM (${body}) b`;
  const spec = who.withCost ? WINLOSS_GRID : WINLOSS_GRID_REP;
  const page = await gridPage(e, base, spec, gridQuery(spec, input.grid), { fallback: "g.key", limit: 50, offset: input.offset ?? 0 });
  const t = (await rows(e, `SELECT ${agg} FROM (${qt}) t`))[0];
  const rate = BigInt(String(t.won)) + BigInt(String(t.lost)) === BigInt(0) ? null : basisPointsDecimal(rha(BigInt(String(t.won)) * BigInt(10000), BigInt(String(t.won)) + BigInt(String(t.lost))));
  const total: Record<string, string | null> = { quotes: String(t.quotes), won: String(t.won), lost: String(t.lost), open: String(t.open), winRate: rate, wonValue: String(t.won_value), lostValue: String(t.lost_value) };
  if (who.withCost) Object.assign(total, { wonMargin: String(t.won_margin), lostMargin: String(t.lost_margin) });
  return { by, from, to, mineOnly: who.mineOnly, offset: input.offset ?? 0, rows: page.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x === null ? null : String(x)]))), grid: page.grid as GridMeta, total };
}
