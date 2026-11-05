// Customer credit signal (chunk 7B): green / amber / red from the imported AR aging report.
// Pure: no DuckDB. Thresholds are a documented starting point (ASSUMPTIONS.md), not a credit policy.
import { msg } from "../i18n/core";

export type CreditProfile = { asOf: string | null; current: bigint; d1_30: bigint; d31_60: bigint; d61_90: bigint; d90plus: bigint; limit: bigint | null; dso: string | null };
export type CreditLevel = "green" | "amber" | "red" | "unknown";
/** Reasons are message references; balances themselves are not returned to the screen. */
export type CreditSignal = { level: CreditLevel; reasons: string[]; asOf: string | null };

export const CREDIT_RULES = {
  /** Share of the open balance more than 90 days past due that turns the signal red. */
  over90RedBp: 1000,
  /** Share of the open balance more than 60 days past due that turns it amber. */
  over60AmberBp: 1000,
  /** Credit utilisation (open balance / credit limit). */
  utilisationAmberBp: 8000, utilisationRedBp: 10000,
  /** Days sales outstanding. */
  dsoAmber: 45, dsoRed: 75,
} as const;

const Z = BigInt(0), TEN_K = BigInt(10000);
/** Basis points of part / whole, rounded down (a ratio for a threshold, never stored). */
const share = (part: bigint, whole: bigint) => whole === Z ? Z : part * TEN_K / whole;
const pct = (bp: bigint) => (Number(bp) / 100).toFixed(0);

export function creditSignal(p: CreditProfile | null): CreditSignal {
  if (!p) return { level: "unknown", reasons: [msg("credit.noAging")], asOf: null };
  const total = p.current + p.d1_30 + p.d31_60 + p.d61_90 + p.d90plus;
  const over90 = share(p.d90plus, total), over60 = share(p.d61_90 + p.d90plus, total);
  const util = p.limit !== null && p.limit > Z ? share(total, p.limit) : null;
  const dso = p.dso === null ? null : Number(p.dso);
  const red: string[] = [], amber: string[] = [];
  if (over90 >= BigInt(CREDIT_RULES.over90RedBp)) red.push(msg("credit.over90", { share: pct(over90) }));
  else if (over60 >= BigInt(CREDIT_RULES.over60AmberBp)) amber.push(msg("credit.over60", { share: pct(over60) }));
  if (util !== null && util > BigInt(CREDIT_RULES.utilisationRedBp)) red.push(msg("credit.overLimit", { share: pct(util) }));
  else if (util !== null && util >= BigInt(CREDIT_RULES.utilisationAmberBp)) amber.push(msg("credit.nearLimit", { share: pct(util) }));
  if (p.limit === Z && total > Z) red.push(msg("credit.noLimit"));
  if (dso !== null && dso > CREDIT_RULES.dsoRed) red.push(msg("credit.dsoHigh", { days: Math.round(dso) }));
  else if (dso !== null && dso > CREDIT_RULES.dsoAmber) amber.push(msg("credit.dsoRaised", { days: Math.round(dso) }));
  if (red.length) return { level: "red", reasons: [...red, ...amber], asOf: p.asOf };
  if (amber.length) return { level: "amber", reasons: amber, asOf: p.asOf };
  return { level: "green", reasons: [msg("credit.ok")], asOf: p.asOf };
}
