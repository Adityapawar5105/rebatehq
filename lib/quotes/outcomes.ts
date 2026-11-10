// Chunk 8C-1: win/loss codes, shared by the worker (lib/quotes/winloss.ts) and Quote Desk. Codes are stored and
// exported as-is (language-neutral); the screen shows them through message keys.
export const OUTCOMES = ["won", "lost", "no_decision"] as const;
export const REASONS = ["price", "competitor", "availability", "lead_time", "specification", "relationship", "service", "credit_terms", "timing", "other"] as const;
export type Outcome = typeof OUTCOMES[number];
export type Reason = typeof REASONS[number];
export type ReportBy = "reason" | "customer" | "rep";
