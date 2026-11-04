// Unit-of-measure rules, ported from the Chunk 2A server rules (ASSUMPTIONS.md, "Phase 2"):
// - a unit is never guessed: a missing or unknown unit has no conversion (null), and a
//   missing unit is never treated as "EA";
// - a conversion is a registered pair, usable forwards or in reverse;
// - quantities are rounded to four decimals, half away from zero, like stored quantities.
// Spelling variants of the same unit (EACH, Each., ea) are normalised to one code; units
// with different meanings (PC and EA, CS and BX) stay different codes.
import { dec, rescale, rha, text, type Dec } from "../margin/decimal";
const ALIASES: Record<string, string[]> = {
  EA: ["EA", "EACH", "EAC", "E"], PC: ["PC", "PCS", "PIECE", "PIECES"], CS: ["CS", "CASE", "CASES", "CSE"], BX: ["BX", "BOX", "BOXES"],
  PK: ["PK", "PACK", "PACKS", "PKG", "PACKAGE"], DZ: ["DZ", "DOZ", "DOZEN"], FT: ["FT", "FOOT", "FEET"], LB: ["LB", "LBS", "POUND", "POUNDS"],
  KG: ["KG", "KGS", "KILO", "KILOGRAM", "KILOGRAMS"], M: ["M", "MTR", "METER", "METERS", "METRE", "METRES"], RL: ["RL", "ROLL", "ROLLS"],
  BG: ["BG", "BAG", "BAGS"], GAL: ["GAL", "GALLON", "GALLONS"], SET: ["SET", "SETS"], PR: ["PR", "PAIR", "PAIRS"],
};
const LOOKUP = new Map(Object.entries(ALIASES).flatMap(([code, names]) => names.map(n => [n, code] as const)));
export const CANONICAL_UNITS = Object.keys(ALIASES);
const token = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[\s.]+/g, "");
/** The canonical code for a spelling, or null when the unit is empty or unknown (never guessed). */
export function canonicalUnit(value: string | null | undefined): string | null { const t = token(value); return t ? LOOKUP.get(t) ?? null : null; }
export type Conversion = { from: string; to: string; factor: string };
const SCALE_Q = 4, SCALE_F = 6;
/** qty in `from` units, converted to `to` units, or null when no known conversion exists. */
export function convertQuantity(quantity: string, from: string | null | undefined, to: string | null | undefined, conversions: Conversion[] = []): string | null {
  const a = canonicalUnit(from), b = canonicalUnit(to);
  if (!a || !b) return null;
  const q = rescale(dec(quantity), SCALE_Q);
  if (a === b) return text(q);
  const direct = conversions.find(c => canonicalUnit(c.from) === a && canonicalUnit(c.to) === b), reverse = conversions.find(c => canonicalUnit(c.from) === b && canonicalUnit(c.to) === a);
  const found = direct ?? reverse;
  if (!found) return null;
  const f: Dec = rescale(dec(found.factor), SCALE_F);
  if (f.v <= BigInt(0)) return null;
  const unit = BigInt(10) ** BigInt(SCALE_F);
  return text({ v: direct ? rha(q.v * f.v, unit) : rha(q.v * unit, f.v), s: SCALE_Q });
}
