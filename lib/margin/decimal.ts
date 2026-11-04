// Exact decimal arithmetic for money: a value is an integer `v` scaled by 10^s.
// No floats are used for money. Rounding is half away from zero, the same rule
// as `rha()` in the DuckDB SQL mirror (lib/margin/sql.ts).
export type Dec = { v: bigint; s: number };
const TEN = BigInt(10), ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);
const pow = (n: number) => TEN ** BigInt(n);
export class DecimalError extends Error {}

/** Parse "12.34", "-0.5", 7, or a Dec. Exponent notation from JS numbers is expanded exactly via toFixed. */
export function dec(value: Dec | string | number | bigint | null | undefined): Dec {
  if (value === null || value === undefined || value === "") return { v: ZERO, s: 0 };
  if (typeof value === "object") return value;
  if (typeof value === "bigint") return { v: value, s: 0 };
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "0") : value.trim();
  if (/e/i.test(text)) text = Number(text).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new DecimalError("Not a decimal number.");
  const frac = m[3] ?? "", v = BigInt((m[2] || "0") + frac);
  return { v: m[1] === "-" ? -v : v, s: frac.length };
}
/** Integer division of n by positive d, rounded half away from zero. */
export function rha(n: bigint, d: bigint): bigint {
  if (d <= ZERO) throw new DecimalError("Divisor must be positive.");
  return n >= ZERO ? (n + d / TWO) / d : -((-n + d / TWO) / d);
}
/** Divide by any non-zero integer, rounded half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === ZERO) throw new DecimalError("Division by zero.");
  return d < ZERO ? rha(-n, -d) : rha(n, d);
}
export function rescale(a: Dec, s: number): Dec {
  if (s >= a.s) return { v: a.v * pow(s - a.s), s };
  return { v: rha(a.v, pow(a.s - s)), s };
}
const align = (a: Dec, b: Dec) => { const s = Math.max(a.s, b.s); return [rescale(a, s).v, rescale(b, s).v, s] as const; };
export const add = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { v: x + y, s }; };
export const sub = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { v: x - y, s }; };
export const mul = (a: Dec, b: Dec): Dec => ({ v: a.v * b.v, s: a.s + b.s });
export const neg = (a: Dec): Dec => ({ v: -a.v, s: a.s });
/** a / b rounded half away from zero to `scale` decimals. */
export function div(a: Dec, b: Dec, scale: number): Dec {
  if (b.v === ZERO) throw new DecimalError("Division by zero.");
  // a.v/10^a.s / (b.v/10^b.s) * 10^scale = a.v * 10^(b.s + scale - a.s) / b.v
  const shift = b.s + scale - a.s;
  const n = shift >= 0 ? a.v * pow(shift) : a.v, d = shift >= 0 ? b.v : b.v * pow(-shift);
  return { v: divRound(n, d), s: scale };
}
export const cmp = (a: Dec, b: Dec) => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
export const isZero = (a: Dec) => a.v === ZERO;
/** Round to whole cents (scale 2) and return the integer number of cents. */
export const cents = (a: Dec): bigint => rescale(a, 2).v;
export const fromCents = (c: bigint): Dec => ({ v: c, s: 2 });
/** Exact text, e.g. 9772.00 for cents, trimmed to `s` decimals. */
export function text(a: Dec): string {
  const negative = a.v < ZERO, abs = negative ? -a.v : a.v, p = pow(a.s);
  const whole = (abs / p).toString(), frac = a.s ? "." + (abs % p).toString().padStart(a.s, "0") : "";
  return (negative && abs !== ZERO ? "-" : "") + whole + frac;
}
export const centsText = (c: bigint) => text(fromCents(c));
/** Margin rate in basis points (1 bp = 0.01%), rounded half away from zero; null when pocket is zero. */
export function rateBp(margin: bigint, pocket: bigint): bigint | null {
  return pocket === ZERO ? null : divRound(margin * BigInt(10000), pocket);
}
export const bpText = (bp: bigint | null) => bp === null ? "n/a" : text({ v: bp, s: 2 }) + "%";
export const ONE_DEC: Dec = { v: ONE, s: 0 };
