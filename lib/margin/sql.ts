// DuckDB SQL mirror of the margin engine v2 (lib/margin/engine.ts). Integer arithmetic
// on HUGEINT only, rounded half away from zero exactly like `rha()` in decimal.ts.
// Tests (tests/margin-v2.test.ts and the browser `margin` suite) prove JS and SQL agree.

/** n / d rounded half away from zero, for d > 0 (DuckDB `//` truncates toward zero). */
export const rhaSql = (n: string, d: string) => `(CASE WHEN (${n}) >= 0 THEN ((${n}) + (${d}) // 2) // (${d}) ELSE -((-(${n}) + (${d}) // 2) // (${d})) END)`;
/** n / d rounded half away from zero for any non-zero d; NULL when d is 0. */
export const divRoundSql = (n: string, d: string) => `(CASE WHEN (${d}) = 0 THEN NULL WHEN (${d}) > 0 THEN ${rhaSql(n, d)} ELSE ${rhaSql(`-(${n})`, `-(${d})`)} END)`;
/** A decimal column (at most 6 decimals) as an integer scaled by 10^6. */
export const micros = (col: string) => `CAST(CAST(coalesce(${col}, '0') AS DECIMAL(38,6)) * 1000000 AS HUGEINT)`;
const E10 = "CAST(10000000000 AS HUGEINT)", E8 = "CAST(100000000 AS HUGEINT)";
/**
 * Per-unit waterfall (same rounding as lineFromUnits): a SELECT list over a relation with
 * VARCHAR columns unit_price, qty, accessory, discount_pct, rebate_pct, freight_unit, terms_unit, cost_unit.
 */
export function unitsLineSql(relation: string) {
  const list = `(${rhaSql(`${micros("unit_price")} * ${micros("qty")}`, E10)} + ${rhaSql(micros("accessory"), "10000")})`;
  return `WITH b AS (SELECT *, ${list} AS list FROM ${relation}),
c AS (SELECT *, ${rhaSql(`list * ${micros("discount_pct")}`, E8)} AS discount, ${rhaSql(`list * ${micros("rebate_pct")}`, E8)} AS rebate,
 ${rhaSql(`${micros("freight_unit")} * ${micros("qty")}`, E10)} AS freight, ${rhaSql(`${micros("terms_unit")} * ${micros("qty")}`, E10)} AS terms,
 ${rhaSql(`${micros("cost_unit")} * ${micros("qty")}`, E10)} AS cogs FROM b)
SELECT *, list - discount - rebate - freight - terms AS pocket, list - discount - rebate - freight - terms - cogs AS margin,
 ${divRoundSql("(list - discount - rebate - freight - terms - cogs) * 10000", "(list - discount - rebate - freight - terms)")} AS rate_bp FROM c`;
}
// The vault's line waterfall (whole cents, lineFromCents). Unknown cost gives NULL margin.
export const POCKET = "(list_cents - discount_cents - rebate_cents - freight_cents)";
export const MARGIN = `(CASE WHEN cost_cents IS NULL THEN NULL ELSE ${POCKET} - cost_cents END)`;
export const rateBpSql = (margin: string, pocket: string) => divRoundSql(`CAST(${margin} AS HUGEINT) * 10000`, `CAST(${pocket} AS HUGEINT)`);
/** Discount in basis points of list, as the leak finder compares it (list > 0). */
export const discountBpSql = (discount = "discount_cents", list = "list_cents") => rhaSql(`CAST(${discount} AS HUGEINT) * 10000`, list);
/** list x bp / 10000 rounded: the expected discount at a schedule rate. */
export const atRateSql = (list: string, bp: string) => rhaSql(`CAST(${list} AS HUGEINT) * (${bp})`, "10000");
