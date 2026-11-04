// Margin engine v2 (chunk 4D): the decimal port of the root margin-engine.js.
// Money is exact: unit prices, costs and FX are decimals (Dec), every waterfall
// component is rounded half away from zero to whole cents ONCE, and pocket and
// margin are derived by integer subtraction, so components always reconcile.
// lib/margin/sql.ts mirrors the line arithmetic in DuckDB SQL; tests prove they agree.
// The float engine (margin-engine.js) stays only for the legacy server paths.
import { add, cents, cmp, dec, div, divRound, mul, rateBp, rescale, sub, text, type Dec } from "./decimal";

type Num = Dec | string | number | null | undefined;
export type Issue = { code: string; [key: string]: unknown };
export type Line = {
  valid: boolean; issues: Issue[]; productId?: string; qty: Dec; unitPrice?: Dec;
  /** Whole cents. pocket = list - discount - rebate - freight - terms; margin = pocket - cogs. */
  baseList: bigint; accessory: bigint; list: bigint; discount: bigint; rebate: bigint; freight: bigint; terms: bigint; pocket: bigint; cogs: bigint; margin: bigint;
  /** Margin rate in basis points of pocket; null when pocket is zero. */
  rateBp: bigint | null; marginWithoutFreight: bigint; pricingExplanation?: unknown;
};
const Z = BigInt(0);
const day = (d: unknown) => String(d || "").slice(0, 10);
const pct = (amount: bigint, percent: Num) => cents(mul({ v: amount, s: 2 }, div(dec(percent), dec(100), 8)));
// Percent is given with at most 6 decimals in practice; div by 100 at 8 decimals is exact for those.

export function effectiveCost(product: any, history: any[] | undefined, date: string, basis = "standard") {
  if (!Array.isArray(history)) return { valid: true as const, cost: dec(product?.cost), currency: product?.currency };
  const d = day(date);
  const rows = history.filter(row => String(row.product_id ?? row.productId) === String(product?.id) && String(row.basis) === String(basis)
    && day(row.effective_from) <= d && (row.effective_to == null || d < day(row.effective_to)));
  if (rows.length !== 1) return { valid: false as const, issue: { code: rows.length ? "cost_history_overlap" : "cost_history_gap", productId: product?.id, date: d, basis } };
  return { valid: true as const, cost: dec(rows[0].cost), currency: rows[0].currency || product?.currency };
}
/** Latest direct rate on or before the date, else the inverse of the latest reverse rate. */
export function currencyRate(fxRates: any[] | undefined, fromCurrency: string, toCurrency: string, date: string) {
  const from = String(fromCurrency || "").toUpperCase(), to = String(toCurrency || "").toUpperCase();
  if (!from || !to || from === to) return { valid: true as const, rate: dec(1), inverse: false };
  const d = day(date), rows = Array.isArray(fxRates) ? fxRates : [];
  const latest = (c: any[]) => c.filter(r => day(r.rate_date ?? r.date) <= d).sort((a, b) => day(b.rate_date ?? b.date).localeCompare(day(a.rate_date ?? a.date)))[0];
  const pick = (a: string, b: string) => latest(rows.filter(r => String(r.from_currency ?? r.fromCurrency).toUpperCase() === a && String(r.to_currency ?? r.toCurrency).toUpperCase() === b));
  const direct = pick(from, to);
  if (direct) return { valid: true as const, rate: dec(direct.rate), inverse: false };
  const inverse = pick(to, from);
  if (inverse && dec(inverse.rate).v > Z) return { valid: true as const, rate: dec(inverse.rate), inverse: true };
  return { valid: false as const, issue: { code: "fx_rate_missing", fromCurrency: from, toCurrency: to, date: d } };
}
/** Convert and round to four decimals, as the v1 engine did (inverse rates divide exactly instead of using 1/rate). */
export function convertMoney(value: Num, fromCurrency: string, toCurrency: string, fxRates: any[] | undefined, date: string) {
  const r = currencyRate(fxRates, fromCurrency, toCurrency, date);
  if (!r.valid) return r;
  const v = dec(value);
  return { valid: true as const, value: r.inverse ? div(v, r.rate, 4) : rescale(mul(v, r.rate), 4) };
}
export function resolvePrice(product: any, customer: any, { quantity = dec(0), date, rules = [] }: { quantity?: Dec; date?: string; rules?: any[] } = {}) {
  const d = day(date);
  if (rules.length && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { valid: false as const, issue: { code: "pricing_date_missing" } };
  for (const kind of ["contract", "customer", "group"]) {
    const matches = rules.filter(row => row.product_id === product?.id && row.rule_kind === kind
      && (kind === "group" ? row.group_id === customer?.group_id && row.group_id != null : row.customer_id === customer?.id)
      && day(row.effective_from) <= d && (row.effective_to == null || d < day(row.effective_to))
      && cmp(dec(row.min_quantity ?? 0), quantity) <= 0 && (row.max_quantity == null || cmp(quantity, dec(row.max_quantity)) < 0));
    if (matches.length > 1) return { valid: false as const, issue: { code: "pricing_overlap", productId: product?.id, kind } };
    if (matches.length) {
      const rule = matches[0];
      return { valid: true as const, price: dec(rule.price), currency: rule.currency || product?.currency,
        explanation: { rule: kind, ruleId: rule.id, source: rule.source, contract: rule.contract_ref || null, from: rule.effective_from, to: rule.effective_to, minQuantity: rule.min_quantity, maxQuantity: rule.max_quantity } };
    }
  }
  const tier = product?.tiers?.[customer?.tier];
  if (tier == null && product?.listHistory?.length) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { valid: false as const, issue: { code: "pricing_date_missing" } };
    const matches = product.listHistory.filter((row: any) => day(row.effective_from) <= d && (row.effective_to == null || d < day(row.effective_to)));
    if (matches.length > 1) return { valid: false as const, issue: { code: "pricing_overlap", productId: product?.id, kind: "list" } };
    if (matches.length) {
      const row = matches[0];
      return { valid: true as const, price: dec(row.unit_price), currency: row.currency || product?.currency, explanation: { rule: "list", ruleId: row.id, source: "Approved file import", from: row.effective_from, to: row.effective_to } };
    }
  }
  return { valid: true as const, price: dec(tier ?? product?.listPrice), currency: product?.currency,
    explanation: { rule: tier != null ? "tier" : "list", source: tier != null ? `Catalog tier: ${customer.tier}` : "Product catalog", from: null, to: null } };
}
export const priceFor = (product: any, customer: any) => { const r = resolvePrice(product, customer); return r.valid ? r.price : null; };

const invalid = (issues: Issue[] = []): Line => ({ valid: false, issues, qty: dec(0), baseList: Z, accessory: Z, list: Z, discount: Z, rebate: Z, freight: Z, terms: Z, pocket: Z, cogs: Z, margin: Z, rateBp: null, marginWithoutFreight: Z });
/**
 * Whole-cent waterfall from per-unit decimals. Each component is rounded once:
 * list = round(unit x qty) + accessory; discount/rebate = round(list x pct / 100);
 * freight/terms/cogs = round(per-unit x qty).
 */
export function lineFromUnits(u: { unitPrice: Num; qty: Num; accessory?: Num; discountPct?: Num; rebatePct?: Num; freightPerUnit?: Num; termsPerUnit?: Num; costPerUnit: Num }) {
  const qty = dec(u.qty), baseList = cents(mul(dec(u.unitPrice), qty)), accessory = cents(dec(u.accessory)), list = baseList + accessory;
  const discount = pct(list, u.discountPct), rebate = pct(list, u.rebatePct);
  const freight = cents(mul(dec(u.freightPerUnit), qty)), terms = cents(mul(dec(u.termsPerUnit), qty)), cogs = cents(mul(dec(u.costPerUnit), qty));
  const pocket = list - discount - rebate - freight - terms, margin = pocket - cogs;
  return { qty, baseList, accessory, list, discount, rebate, freight, terms, pocket, cogs, margin, rateBp: rateBp(margin, pocket), marginWithoutFreight: margin + freight };
}
/** The vault's waterfall for one imported line (whole cents). Unknown cost stays unknown: margin is null, never cost 0. */
export function lineFromCents(l: { list: bigint; discount: bigint; rebate: bigint; freight: bigint; terms?: bigint; cost: bigint | null }) {
  const pocket = l.list - l.discount - l.rebate - l.freight - (l.terms ?? Z);
  const margin = l.cost === null ? null : pocket - l.cost;
  return { pocket, margin, rateBp: margin === null ? null : rateBp(margin, pocket) };
}
export function calculateLine(input: any): Line {
  const { product, customer, qty = 0, discountPct = 0, rebatePct = 0, accessory = 0, unitPrice, freightPerUnit, termsPerUnit, costOverride,
    transactionDate, transactionCurrency, costBasis = "standard", costHistory, fxRates, pricingRules = [] } = input || {};
  if (!product || !customer) return invalid();
  let quantity = dec(qty); if (quantity.v < Z) quantity = dec(0);
  const date = transactionDate || "", currency = String(transactionCurrency || product.currency || "").toUpperCase();
  const productCurrency = String(product.currency || currency).toUpperCase();
  const resolution = unitPrice === undefined ? resolvePrice(product, customer, { quantity, date, rules: pricingRules })
    : { valid: true as const, price: dec(unitPrice), currency: productCurrency, explanation: { rule: "explicit", source: "Recorded price" } };
  if (!resolution.valid) return invalid([resolution.issue]);
  let price = resolution.price, freightUnit = dec(freightPerUnit ?? product.freight), termsUnit = dec(termsPerUnit ?? product.termsCost), cost = dec(costOverride ?? product.cost);
  const priceCurrency = String(resolution.currency || productCurrency).toUpperCase(), issues: Issue[] = [];
  if (unitPrice === undefined && transactionCurrency && priceCurrency !== currency) {
    const c = convertMoney(price, priceCurrency, currency, fxRates, date); if (!c.valid) issues.push(c.issue); else price = c.value;
  }
  if (transactionCurrency && productCurrency !== currency) {
    const f = convertMoney(freightUnit, productCurrency, currency, fxRates, date); if (!f.valid) issues.push(f.issue); else freightUnit = f.value;
    const t = convertMoney(termsUnit, productCurrency, currency, fxRates, date); if (!t.valid) issues.push(t.issue); else termsUnit = t.value;
  }
  let costCurrency = productCurrency;
  if (costOverride === undefined && Array.isArray(costHistory)) {
    const r = effectiveCost(product, costHistory, date, costBasis);
    if (!r.valid) issues.push(r.issue); else { cost = r.cost; costCurrency = String(r.currency || productCurrency).toUpperCase(); }
  }
  if (transactionCurrency && costCurrency !== currency) { const c = convertMoney(cost, costCurrency, currency, fxRates, date); if (!c.valid) issues.push(c.issue); else cost = c.value; }
  if (issues.length) return invalid(issues);
  const w = lineFromUnits({ unitPrice: price, qty: quantity, accessory, discountPct, rebatePct, freightPerUnit: freightUnit, termsPerUnit: termsUnit, costPerUnit: cost });
  return { valid: true, issues: [], productId: product.id, unitPrice: price, pricingExplanation: resolution.explanation, ...w };
}
export function calculateOrder(order: any, customer: any, product: any) {
  const line = calculateLine({ product, customer, qty: order?.qty, discountPct: order?.discountPct, rebatePct: order?.offInvoiceRebatePct,
    freightPerUnit: order?.freightPerUnit, termsPerUnit: order?.termsPerUnit, transactionDate: order?.transactionDate || order?.date,
    transactionCurrency: order?.currency, costBasis: order?.costBasis, costHistory: order?.costHistory, fxRates: order?.fxRates, pricingRules: order?.pricingRules });
  return line.valid ? { ...line, order, c: customer, p: product } : null;
}
const FIELDS = ["list", "baseList", "discount", "rebate", "freight", "terms", "pocket", "cogs", "margin"] as const;
export type Totals = Record<typeof FIELDS[number], bigint> & { rateBp: bigint | null; count: number };
export function aggregate(rows: Array<Partial<Record<typeof FIELDS[number], bigint>>> = []): Totals {
  const t = Object.fromEntries(FIELDS.map(f => [f, rows.reduce((s, r) => s + (r[f] ?? Z), Z)])) as Record<typeof FIELDS[number], bigint>;
  return { ...t, rateBp: rateBp(t.margin, t.pocket), count: rows.length };
}
const findProduct = (products: any, id: string) => products instanceof Map ? products.get(id) : Array.isArray(products) ? products.find((p: any) => p.id === id) : products?.[id];
export function calculateQuote(lines: any[], customer: any, products: any, options: any = {}) {
  const results = (lines || []).map(line => calculateLine({ product: findProduct(products, line.productId), customer, qty: line.qty, discountPct: line.discountPct, rebatePct: line.rebatePct,
    accessory: line.accessory, transactionDate: line.transactionDate || options.transactionDate, transactionCurrency: line.currency || options.transactionCurrency,
    costBasis: line.costBasis || options.costBasis, costHistory: options.costHistory, fxRates: options.fxRates, pricingRules: options.pricingRules }));
  const totals = aggregate(results);
  return { ...totals, valid: results.every(l => l.valid), issues: results.flatMap(l => l.issues), lines: results };
}
export const calculateProductMargin = (product: any) => calculateLine({ product, customer: { tier: "Standard" }, qty: 1, unitPrice: product?.listPrice });
/** Zone from a rate in basis points and a policy in percent (target, walkAway). */
export function classify(rate: bigint | null, policy: any) {
  if (rate === null) return "red";
  const bp = (p: Num) => cents(dec(p)); // percent with 2 decimals = basis points
  if (rate >= bp(policy?.target)) return "green";
  if (rate < bp(policy?.walkAway)) return "red";
  return "yellow";
}
/**
 * Keep the margin rate when cost changes. With r = margin / pocket held constant, the new
 * pocket is newCost x pocket / cogs; the invoiceable price is that pocket rounded to the
 * cent plus per-unit freight and terms. v1 returned an unrounded float price.
 */
export function calculatePassThrough(product: any, oldPrice: Num, costChangePct: Num, oldCost: Num = product?.cost) {
  const before = calculateLine({ product, customer: { tier: "Standard" }, qty: 1, unitPrice: oldPrice, costOverride: oldCost });
  const newCost = rescale(add(dec(oldCost), mul(dec(oldCost), div(dec(costChangePct), dec(100), 8))), 4);
  const extras = add(dec(product?.freight), dec(product?.termsCost));
  const pocket = before.cogs > Z ? { v: divRound(newCost.v * before.pocket, before.cogs), s: newCost.s } : newCost;
  const newPrice = rescale(add(rescale(pocket, 2), extras), 2);
  const after = calculateLine({ product, customer: { tier: "Standard" }, qty: 1, unitPrice: newPrice, costOverride: newCost });
  return { oldCost: dec(oldCost), newCost, oldPrice: dec(oldPrice), newPrice, before, after };
}
export function buildMonthlySnapshots(orders: any[], customers: any[], products: any[], companyId = "company", options: any = {}) {
  const customerById = new Map((customers || []).map(c => [c.id, c])), productById = new Map((products || []).map(p => [p.id, p]));
  const groups = new Map<string, { entityType: string; entityId: string; month: string; rows: Line[] }>();
  const push = (entityType: string, entityId: string, month: string, r: Line) => {
    const key = `${entityType}:${entityId}:${month}`;
    if (!groups.has(key)) groups.set(key, { entityType, entityId, month, rows: [] });
    groups.get(key)!.rows.push(r);
  };
  for (const order of orders || []) {
    const customer = customerById.get(order.customerId), product = productById.get(order.productId);
    const result = calculateOrder({ ...options, ...order }, customer, product), month = order.month || String(order.date || "").slice(0, 7);
    if (!result || !month) continue;
    push("company", companyId, month, result); push("product", product.id, month, result); push("customer", customer.id, month, result);
  }
  return [...groups.values()].map(g => { const t = aggregate(g.rows);
    return { id: `${g.entityType}:${g.entityId}:${g.month}`, entityType: g.entityType, entityId: g.entityId, month: g.month, orderCount: t.count, pocket: t.pocket, margin: t.margin, rateBp: t.rateBp };
  }).sort((a, b) => a.month.localeCompare(b.month) || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));
}
export function trendFor(snapshots: ReturnType<typeof buildMonthlySnapshots>, entityType: string, entityId: string) {
  const history = (snapshots || []).filter(r => r.entityType === entityType && r.entityId === entityId).sort((a, b) => a.month.localeCompare(b.month));
  if (history.length < 2) return { status: "insufficient" as const, label: "Not enough history" };
  const previous = history[history.length - 2], current = history[history.length - 1];
  const delta = (current.rateBp ?? Z) - (previous.rateBp ?? Z);
  return { status: "ready" as const, direction: delta >= Z ? "up" as const : "down" as const, deltaBp: delta, previous, current };
}
export { text as decText, sub as decSub };
