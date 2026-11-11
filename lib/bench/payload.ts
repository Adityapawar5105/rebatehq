// Chunk 8D (BENCHMARKS_DESIGN.md, approved 11 November 2026): the one payload a workspace may ever send for
// benchmarks, and its exact check. Shared by the vault worker (which builds it), the Benchmarks screen (which shows it
// before the Owner confirms) and the server route (which refuses anything else). No other data leaves the device.
export const FAMILIES = ["electrical", "plumbing", "hvac", "industrial_mro", "fasteners", "safety", "janitorial", "packaging", "building_materials", "foodservice", "medical", "other"] as const;
export const METRICS = ["pocket_margin", "discount_rate", "rebate_rate", "freight_rate"] as const;
export const SIZE_BANDS = ["S1", "S2", "S3", "S4"] as const;
export type Family = typeof FAMILIES[number];
export type Metric = typeof METRICS[number];
export type SizeBand = typeof SIZE_BANDS[number];
export type BenchRow = { family: Family; metric: Metric; band: number };
export type BenchPayload = { v: 1; quarter: string; sizeBand: SizeBand; rows: BenchRow[] };
export const CONSENT_VERSION = 1;
export const BAND_MIN = -20, BAND_MAX = 80, MAX_ROWS = FAMILIES.length * METRICS.length;
/** Family minimums (design section 2): lines, distinct customers, largest customer share in basis points. */
export const FAMILY_MIN = { lines: 200, customers: 20, topShareBp: 2500 } as const;
/** Quarterly pocket-revenue size bands, in cents: under $1M, $1M–5M, $5M–20M, over $20M. */
export const SIZE_LIMITS: [SizeBand, bigint][] = [["S1", BigInt(100_000_000)], ["S2", BigInt(500_000_000)], ["S3", BigInt(2_000_000_000)]];

const QUARTER = /^20[2-9][0-9]-Q[1-4]$/;
export const isQuarter = (q: unknown): q is string => typeof q === "string" && QUARTER.test(q);
/** The first and last day (ISO dates, inclusive) of a quarter. */
export function quarterDates(q: string): { from: string; to: string } {
  if (!isQuarter(q)) throw new Error("invalid quarter");
  const y = Number(q.slice(0, 4)), n = Number(q.slice(6)), from = new Date(Date.UTC(y, (n - 1) * 3, 1)), to = new Date(Date.UTC(y, n * 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
/** The last calendar quarter that has fully ended on `today` (UTC). */
export function lastCompleteQuarter(today = new Date()): string {
  const y = today.getUTCFullYear(), n = Math.floor(today.getUTCMonth() / 3) + 1;
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
}
/** Every quarter from 2024-Q1 to the current one: the pseudonyms a withdrawal must cover. */
export function quartersSince2024(today = new Date()): string[] {
  const out: string[] = [], y = today.getUTCFullYear(), n = Math.floor(today.getUTCMonth() / 3) + 1;
  for (let year = 2024; year <= y; year++) for (let q = 1; q <= 4; q++) if (year < y || q <= n) out.push(`${year}-Q${q}`);
  return out;
}
/** A rate (numerator/denominator, exact integers) as its whole-point band, rounded down and clipped to −20…80. */
export function bandOf(numerator: bigint, denominator: bigint): number {
  if (denominator <= BigInt(0)) throw new Error("no denominator");
  const scaled = numerator * BigInt(100), q = scaled / denominator, floor = scaled % denominator !== BigInt(0) && (scaled < BigInt(0)) !== (denominator < BigInt(0)) ? q - BigInt(1) : q;
  return Math.max(BAND_MIN, Math.min(BAND_MAX, Number(floor)));
}
export function sizeBandOf(revenueCents: bigint): SizeBand {
  for (const [band, limit] of SIZE_LIMITS) if (revenueCents < limit) return band;
  return "S4";
}

/** The exact check (design section 6): returns a fresh copy holding only the allowed keys, or throws. */
export function checkPayload(input: unknown): BenchPayload {
  const fail = (): never => { throw new Error("invalid benchmark payload"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const p = input as Record<string, unknown>;
  if (Object.keys(p).sort().join() !== "quarter,rows,sizeBand,v" || p.v !== 1 || !isQuarter(p.quarter) || !SIZE_BANDS.includes(p.sizeBand as SizeBand)
    || !Array.isArray(p.rows) || p.rows.length < 1 || p.rows.length > MAX_ROWS) fail();
  const seen = new Set<string>(), rows: BenchRow[] = [];
  for (const r of p.rows as unknown[]) {
    if (!r || typeof r !== "object" || Array.isArray(r)) fail();
    const x = r as Record<string, unknown>;
    if (Object.keys(x).sort().join() !== "band,family,metric" || !FAMILIES.includes(x.family as Family) || !METRICS.includes(x.metric as Metric)
      || typeof x.band !== "number" || !Number.isInteger(x.band) || x.band < BAND_MIN || x.band > BAND_MAX) fail();
    const key = `${x.family}|${x.metric}`; if (seen.has(key)) fail(); seen.add(key);
    rows.push({ family: x.family as Family, metric: x.metric as Metric, band: x.band as number });
  }
  return { v: 1, quarter: p.quarter as string, sizeBand: p.sizeBand as SizeBand, rows };
}
