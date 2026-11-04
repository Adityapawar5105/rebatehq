// Margin engine v2 (decimal): every v1 golden case to the cent, and JS == DuckDB SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as V2 from "../lib/margin/engine";
import { centsText, dec, rha, divRound, text } from "../lib/margin/decimal";
import { unitsLineSql, POCKET, MARGIN, rateBpSql } from "../lib/margin/sql";
import { duckdbConnection, rows } from "./helpers/duckdb-node";
const require = createRequire(import.meta.url);
const V1 = require("../margin-engine.js");
(globalThis as any).window = globalThis; (globalThis as any).MarginEngine = V1;
require("../seed.js");
const seed = (globalThis as any).SEED_DATA;
const customer = (id: string) => seed.customers.find((r: any) => r.id === id);
const product = (id: string) => seed.products.find((r: any) => r.id === id);
const FIELDS = ["list", "baseList", "discount", "rebate", "freight", "terms", "pocket", "cogs", "margin"] as const;
/** v1 float rounded to whole cents (half away from zero). */
const v1Cents = (x: number) => BigInt(Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7));

test("SO-8102 golden case: identical to the cent, still a loss", () => {
  const order = seed.orders.find((r: any) => r.id === "SO-8102");
  const r = V2.calculateOrder(order, customer(order.customerId), product(order.productId))!;
  assert.deepEqual(FIELDS.filter(f => f !== "baseList").map(f => centsText(r[f])), ["9772.00", "1368.08", "195.44", "1904.00", "154.00", "6150.48", "6664.00", "-513.52"]);
  assert.ok(r.margin < BigInt(0));
  assert.equal(r.rateBp, BigInt(-835)); // -513.52 / 6150.48 = -8.349% -> -8.35%
});
test("every seed order matches v1 to the cent on every component", () => {
  for (const order of seed.orders) {
    const a = V1.calculateOrder(order, customer(order.customerId), product(order.productId)), b = V2.calculateOrder(order, customer(order.customerId), product(order.productId))!;
    for (const f of FIELDS) assert.equal(b[f], v1Cents(a[f]), `${order.id} ${f}`);
    assert.equal(b.rateBp, v1Cents(a.rate), `${order.id} rate`);
  }
});
test("quote golden case: rebate and accessory per line and in totals", () => {
  const q = V2.calculateQuote([{ productId: "p-v100", qty: 5, discountPct: 8, rebatePct: 1, accessory: 40 }], customer("c-acme"), seed.products);
  const l = q.lines[0];
  assert.deepEqual(["baseList", "accessory", "list", "discount", "rebate", "freight", "terms", "pocket", "cogs", "margin"].map(f => centsText((l as any)[f])),
    ["595.00", "40.00", "635.00", "50.80", "6.35", "21.00", "5.50", "551.35", "370.00", "181.35"]);
  assert.equal(q.pocket, l.pocket); assert.equal(q.margin, l.margin); assert.equal(q.rateBp, l.rateBp);
  const v1 = V1.calculateQuote([{ productId: "p-v100", qty: 5, discountPct: 8, rebatePct: 1, accessory: 40 }], customer("c-acme"), seed.products);
  assert.equal(q.rateBp, v1Cents(v1.rate));
});
test("pass-through keeps the margin rate; the price is invoiceable to the cent", () => {
  const p = product("p-v100"), v1 = V1.calculatePassThrough(p, p.listPrice, 6), v2 = V2.calculatePassThrough(p, p.listPrice, 6);
  assert.equal(text(v2.newCost), "78.4400");
  assert.equal(v2.newPrice.v, v1Cents(v1.newPrice)); // v1 133.2419... -> 133.24
  assert.equal(v2.before.rateBp, v2.after.rateBp); // 38.69% both
  assert.equal(v2.before.rateBp, v1Cents(v1.before.rate));
});
test("monthly snapshots drive trends; insufficient history is explicit", () => {
  const snaps = V2.buildMonthlySnapshots(seed.orders, seed.customers, seed.products, seed.company.id);
  const t = V2.trendFor(snaps, "company", seed.company.id);
  assert.equal(t.status, "ready"); if (t.status !== "ready") return;
  assert.equal(t.previous.month, "2026-09"); assert.equal(t.current.month, "2026-10");
  assert.equal(V2.trendFor(snaps, "product", "p-a110").status, "insufficient");
  const v1 = V1.buildMonthlySnapshots(seed.orders, seed.customers, seed.products, seed.company.id);
  for (const s of snaps) { const o = v1.find((x: any) => x.id === s.id); assert.equal(s.pocket, v1Cents(o.pocket)); assert.equal(s.margin, v1Cents(o.margin)); }
});
test("margin zones use the configured policy (rates in basis points)", () => {
  const policy = { target: 30, walkAway: 18 };
  assert.equal(V2.classify(BigInt(3000), policy), "green"); assert.equal(V2.classify(BigInt(2400), policy), "yellow"); assert.equal(V2.classify(BigInt(1790), policy), "red");
});
test("effective-dated cost, gaps and overlaps", () => {
  const p = { id: "p1", listPrice: 100, cost: 40, currency: "USD" }, c = { tier: "standard" };
  const history = [{ product_id: "p1", cost: "40", basis: "standard", effective_from: "2026-01-01", effective_to: "2026-07-01", currency: "USD" }, { product_id: "p1", cost: "55", basis: "standard", effective_from: "2026-07-01", effective_to: null, currency: "USD" }];
  assert.equal(centsText(V2.calculateLine({ product: p, customer: c, qty: 2, transactionDate: "2026-06-30", transactionCurrency: "USD", costHistory: history }).cogs), "80.00");
  assert.equal(centsText(V2.calculateLine({ product: p, customer: c, qty: 2, transactionDate: "2026-07-01", transactionCurrency: "USD", costHistory: history }).cogs), "110.00");
  assert.equal(V2.calculateLine({ product: p, customer: c, qty: 1, transactionDate: "2026-05-01", transactionCurrency: "USD", costHistory: [] }).issues[0].code, "cost_history_gap");
  const overlap = V2.calculateLine({ product: p, customer: c, qty: 1, transactionDate: "2026-05-01", transactionCurrency: "USD", costHistory: [{ product_id: "p1", cost: 10, basis: "standard", effective_from: "2026-01-01", effective_to: null }, { product_id: "p1", cost: 20, basis: "standard", effective_from: "2026-04-01", effective_to: null }] });
  assert.equal(overlap.valid, false); assert.equal(overlap.issues[0].code, "cost_history_overlap");
});
test("FX: latest direct or exact inverse, four decimals, missing rates reported", () => {
  const rates = [{ from_currency: "USD", to_currency: "EUR", rate: "0.92345", rate_date: "2026-01-01" }, { from_currency: "USD", to_currency: "EUR", rate: "0.90000", rate_date: "2026-04-01" }];
  const d = V2.convertMoney(10, "USD", "EUR", rates, "2026-05-01"), i = V2.convertMoney(9, "EUR", "USD", rates, "2026-02-01");
  assert.ok(d.valid && i.valid); if (!d.valid || !i.valid) return;
  assert.equal(text(d.value), "9.0000"); assert.equal(text(i.value), "9.7461");
  assert.equal(V2.convertMoney(10, "USD", "INR", rates, "2026-05-01").valid, false);
  const p = { id: "fx", listPrice: 10, cost: 4, freight: 1, termsCost: 0.5, currency: "USD" };
  const r = V2.calculateLine({ product: p, customer: { tier: "standard" }, qty: 2, transactionDate: "2026-05-01", transactionCurrency: "EUR",
    costHistory: [{ product_id: "fx", cost: 4, basis: "standard", effective_from: "2026-01-01", effective_to: null, currency: "USD" }], fxRates: [{ rate_date: "2026-04-01", from_currency: "USD", to_currency: "EUR", rate: "0.9" }] });
  assert.deepEqual(["list", "freight", "terms", "cogs", "margin"].map(f => centsText((r as any)[f])), ["18.00", "1.80", "0.90", "7.20", "8.10"]);
  const missing = V2.calculateLine({ product: p, customer: { tier: "standard" }, qty: 1, transactionDate: "2026-05-01", transactionCurrency: "GBP", costHistory: [{ product_id: "fx", cost: 4, basis: "standard", effective_from: "2026-01-01", effective_to: null, currency: "USD" }], fxRates: [] });
  assert.ok(!missing.valid && missing.issues.some(x => x.code === "fx_rate_missing"));
});
test("decimal rounding is half away from zero, also for negatives", () => {
  assert.equal(rha(BigInt(5), BigInt(10)), BigInt(1)); assert.equal(rha(BigInt(-5), BigInt(10)), BigInt(-1)); assert.equal(rha(BigInt(4), BigInt(10)), BigInt(0));
  assert.equal(divRound(BigInt(5), BigInt(-10)), BigInt(-1)); assert.equal(text(dec("0.1")), "0.1"); assert.equal(text(dec(-0.25)), "-0.25");
  assert.equal(V2.lineFromCents({ list: BigInt(1000), discount: BigInt(100), rebate: BigInt(0), freight: BigInt(50), cost: null }).margin, null, "unknown cost is never zero");
});

// ---- JS engine == DuckDB SQL mirror -------------------------------------------------
function prng(seedValue: number) { let a = seedValue >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const decimalText = (r: () => number, max: number, places: number, signed = false) => {
  const scale = 10 ** places, n = Math.floor(r() * max * scale); const s = (n / scale).toFixed(places);
  return signed && r() < 0.2 ? "-" + s : s;
};
type UnitRow = { unit_price: string; qty: string; accessory: string; discount_pct: string; rebate_pct: string; freight_unit: string; terms_unit: string; cost_unit: string };
function unitRows(): UnitRow[] {
  const golden: UnitRow[] = seed.orders.map((o: any) => { const p = product(o.productId), c = customer(o.customerId);
    return { unit_price: String(p.tiers[c.tier] ?? p.listPrice), qty: String(o.qty), accessory: "0", discount_pct: String(o.discountPct), rebate_pct: String(o.offInvoiceRebatePct), freight_unit: String(o.freightPerUnit), terms_unit: String(o.termsPerUnit), cost_unit: String(p.cost) }; });
  const r = prng(4242), random: UnitRow[] = Array.from({ length: 3000 }, () => ({ unit_price: decimalText(r, 5000, 4), qty: decimalText(r, 500, r() < 0.5 ? 0 : 4, true), accessory: decimalText(r, 100, 2),
    discount_pct: decimalText(r, 40, r() < 0.5 ? 1 : 3), rebate_pct: decimalText(r, 5, 2), freight_unit: decimalText(r, 50, 4), terms_unit: decimalText(r, 5, 4), cost_unit: decimalText(r, 4000, 4) }));
  // Exact half-cent ties in every component.
  const ties: UnitRow[] = [{ unit_price: "0.005", qty: "1", accessory: "0", discount_pct: "50", rebate_pct: "0", freight_unit: "0.125", terms_unit: "0.0050", cost_unit: "0.0050" },
    { unit_price: "0.0050", qty: "-1", accessory: "0", discount_pct: "10", rebate_pct: "0.5", freight_unit: "0.125", terms_unit: "0", cost_unit: "0.0050" }];
  return [...golden, ...ties, ...random];
}
test("the SQL mirror agrees with the JS engine on golden, tie and 3,000 random lines", async () => {
  const conn = await duckdbConnection(), input = unitRows();
  const values = input.map((x, i) => `(${i},${["unit_price", "qty", "accessory", "discount_pct", "rebate_pct", "freight_unit", "terms_unit", "cost_unit"].map(k => `'${(x as any)[k]}'`).join(",")})`).join(",");
  const sql = `SELECT i, ${["list", "discount", "rebate", "freight", "terms", "cogs", "pocket", "margin", "rate_bp"].map(c => `${c}::VARCHAR AS ${c}`).join(",")} FROM (${unitsLineSql(`(VALUES ${values}) v(i, unit_price, qty, accessory, discount_pct, rebate_pct, freight_unit, terms_unit, cost_unit)`)}) ORDER BY i`;
  const out = rows(conn, sql);
  assert.equal(out.length, input.length);
  for (const [i, x] of input.entries()) {
    const js = V2.lineFromUnits({ unitPrice: x.unit_price, qty: x.qty, accessory: x.accessory, discountPct: x.discount_pct, rebatePct: x.rebate_pct, freightPerUnit: x.freight_unit, termsPerUnit: x.terms_unit, costPerUnit: x.cost_unit });
    const sqlRow = out[i];
    for (const k of ["list", "discount", "rebate", "freight", "terms", "pocket", "margin"] as const) assert.equal(sqlRow[k], String((js as any)[k]), `row ${i} ${k}`);
    assert.equal(sqlRow.cogs, String(js.cogs), `row ${i} cogs`);
    assert.equal(sqlRow.rate_bp, js.rateBp === null ? null : String(js.rateBp), `row ${i} rate`);
  }
  // Golden SO-8102 through SQL too.
  const so = seed.orders.findIndex((o: any) => o.id === "SO-8102");
  assert.equal(out[so].margin, "-51352"); conn.close();
});
test("vault line waterfall: SQL POCKET/MARGIN equal lineFromCents, unknown cost stays NULL, credits net", async () => {
  const conn = await duckdbConnection(), r = prng(99);
  const lines = Array.from({ length: 2000 }, () => { const credit = r() < 0.15, s = credit ? -1 : 1, list = Math.floor(r() * 1e7);
    return { list: s * list, discount: s * Math.floor(r() * list * 0.4), rebate: s * Math.floor(r() * list * 0.03), freight: s * Math.floor(r() * 3000), cost: r() < 0.2 ? null : s * Math.floor(r() * list) }; });
  const values = lines.map((l, i) => `(${i},${l.list},${l.discount},${l.rebate},${l.freight},${l.cost === null ? "NULL" : l.cost})`).join(",");
  const out = rows(conn, `SELECT i, ${POCKET}::VARCHAR AS pocket, ${MARGIN}::VARCHAR AS margin, ${rateBpSql(MARGIN, POCKET)}::VARCHAR AS rate FROM (VALUES ${values}) v(i, list_cents, discount_cents, rebate_cents, freight_cents, cost_cents) ORDER BY i`);
  for (const [i, l] of lines.entries()) {
    const js = V2.lineFromCents({ list: BigInt(l.list), discount: BigInt(l.discount), rebate: BigInt(l.rebate), freight: BigInt(l.freight), cost: l.cost === null ? null : BigInt(l.cost) });
    assert.equal(out[i].pocket, String(js.pocket)); assert.equal(out[i].margin, js.margin === null ? null : String(js.margin)); assert.equal(out[i].rate, js.rateBp === null ? null : String(js.rateBp), `rate ${i}`);
  }
  const sums = rows(conn, `SELECT sum(${POCKET})::VARCHAR AS pocket, sum(${MARGIN})::VARCHAR AS margin FROM (VALUES ${values}) v(i, list_cents, discount_cents, rebate_cents, freight_cents, cost_cents)`)[0];
  const jsPocket = lines.reduce((s, l) => s + BigInt(l.list - l.discount - l.rebate - l.freight), BigInt(0));
  const jsMargin = lines.reduce((s, l) => l.cost === null ? s : s + BigInt(l.list - l.discount - l.rebate - l.freight - l.cost), BigInt(0));
  assert.equal(sums.pocket, String(jsPocket)); assert.equal(sums.margin, String(jsMargin)); conn.close();
});
