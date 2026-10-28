'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MarginEngine = require('../margin-engine.js');

global.window = global;
global.MarginEngine = MarginEngine;
require('../seed.js');
const seed = global.SEED_DATA;
const customer = id => seed.customers.find(row => row.id === id);
const product = id => seed.products.find(row => row.id === id);
const closeTo = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('SO-8102 is a loss after discount, rebate, freight, terms, and COGS', () => {
  const order = seed.orders.find(row => row.id === 'SO-8102');
  const result = MarginEngine.calculateOrder(order, customer(order.customerId), product(order.productId));
  assert.equal(result.order.id, 'SO-8102');
  closeTo(result.list, 9772);
  closeTo(result.discount, 1368.08);
  closeTo(result.rebate, 195.44);
  closeTo(result.freight, 1904);
  closeTo(result.terms, 154);
  closeTo(result.pocket, 6150.48);
  closeTo(result.cogs, 6664);
  closeTo(result.margin, -513.52);
  assert.ok(result.margin < 0);
});

test('quote calculation includes rebate and accessory in each line and shared totals', () => {
  const quote = MarginEngine.calculateQuote([
    { productId: 'p-v100', qty: 5, discountPct: 8, rebatePct: 1, accessory: 40 }
  ], customer('c-acme'), seed.products);
  const line = quote.lines[0];
  closeTo(line.baseList, 595);
  closeTo(line.accessory, 40);
  closeTo(line.list, 635);
  closeTo(line.discount, 50.8);
  closeTo(line.rebate, 6.35);
  closeTo(line.freight, 21);
  closeTo(line.terms, 5.5);
  closeTo(line.pocket, 551.35);
  closeTo(line.cogs, 370);
  closeTo(line.margin, 181.35);
  closeTo(quote.pocket, line.pocket);
  closeTo(quote.margin, line.margin);
  closeTo(quote.rate, line.rate);
});

test('pass-through preserves the engine-calculated margin rate', () => {
  const p = product('p-v100');
  const change = MarginEngine.calculatePassThrough(p, p.listPrice, 6);
  closeTo(change.before.rate, change.after.rate, 1e-8);
  closeTo(change.newCost, 78.44);
});

test('monthly snapshots drive trends and insufficient history is explicit', () => {
  const snapshots = MarginEngine.buildMonthlySnapshots(seed.orders, seed.customers, seed.products, seed.company.id);
  const companyTrend = MarginEngine.trendFor(snapshots, 'company', seed.company.id);
  assert.equal(companyTrend.status, 'ready');
  assert.equal(companyTrend.previous.month, '2026-09');
  assert.equal(companyTrend.current.month, '2026-10');
  const oneMonthTrend = MarginEngine.trendFor(snapshots, 'product', 'p-a110');
  assert.equal(oneMonthTrend.status, 'insufficient');
  assert.equal(oneMonthTrend.label, 'Not enough history');
});

test('margin zones use the configured policy', () => {
  const policy = { target: 30, walkAway: 18 };
  assert.equal(MarginEngine.classify(30, policy), 'green');
  assert.equal(MarginEngine.classify(24, policy), 'yellow');
  assert.equal(MarginEngine.classify(17.9, policy), 'red');
});

test('effective-dated cost uses the cost active on the transaction date', () => {
  const p = { id: 'p1', listPrice: 100, cost: 40, currency: 'USD' };
  const customerRow = { tier: 'standard' };
  const costHistory = [
    { product_id: 'p1', cost: '40', basis: 'standard', effective_from: '2026-01-01', effective_to: '2026-07-01', currency: 'USD' },
    { product_id: 'p1', cost: '55', basis: 'standard', effective_from: '2026-07-01', effective_to: null, currency: 'USD' }
  ];
  const before = MarginEngine.calculateLine({ product: p, customer: customerRow, qty: 2, transactionDate: '2026-06-30', transactionCurrency: 'USD', costHistory });
  const after = MarginEngine.calculateLine({ product: p, customer: customerRow, qty: 2, transactionDate: '2026-07-01', transactionCurrency: 'USD', costHistory });
  assert.equal(before.valid, true);
  assert.equal(after.valid, true);
  closeTo(before.cogs, 80);
  closeTo(after.cogs, 110);
});

test('a cost history gap or overlap invalidates the result with a data quality issue', () => {
  const p = { id: 'p1', listPrice: 100, cost: 40, currency: 'USD' };
  const customerRow = { tier: 'standard' };
  const gap = MarginEngine.calculateLine({ product: p, customer: customerRow, qty: 1, transactionDate: '2026-05-01', transactionCurrency: 'USD', costHistory: [] });
  assert.equal(gap.valid, false);
  assert.equal(gap.issues[0].code, 'cost_history_gap');
  const overlap = MarginEngine.calculateLine({ product: p, customer: customerRow, qty: 1, transactionDate: '2026-05-01', transactionCurrency: 'USD', costHistory: [
    { product_id: 'p1', cost: 10, basis: 'standard', effective_from: '2026-01-01', effective_to: null, currency: 'USD' },
    { product_id: 'p1', cost: 20, basis: 'standard', effective_from: '2026-04-01', effective_to: null, currency: 'USD' }
  ] });
  assert.equal(overlap.valid, false);
  assert.equal(overlap.issues[0].code, 'cost_history_overlap');
});

test('FX uses latest direct rate or inverse, rounds to four places, and reports missing rates', () => {
  const rates = [
    { from_currency: 'USD', to_currency: 'EUR', rate: '0.92345', rate_date: '2026-01-01' },
    { from_currency: 'USD', to_currency: 'EUR', rate: '0.90000', rate_date: '2026-04-01' }
  ];
  const direct = MarginEngine.convertMoney(10, 'USD', 'EUR', rates, '2026-05-01');
  assert.equal(direct.valid, true);
  closeTo(direct.value, 9);
  const inverse = MarginEngine.convertMoney(9, 'EUR', 'USD', rates, '2026-02-01');
  assert.equal(inverse.valid, true);
  closeTo(inverse.value, 9.7461);
  const missing = MarginEngine.convertMoney(10, 'USD', 'INR', rates, '2026-05-01');
  assert.equal(missing.valid, false);
  assert.equal(missing.issue.code, 'fx_rate_missing');
});

test('margin calculations convert catalog price, freight, terms, and dated cost into transaction currency', () => {
  const p = { id: 'fx-product', listPrice: 10, cost: 4, freight: 1, termsCost: 0.5, currency: 'USD' };
  const result = MarginEngine.calculateLine({
    product: p,
    customer: { tier: 'standard' },
    qty: 2,
    transactionDate: '2026-05-01',
    transactionCurrency: 'EUR',
    costHistory: [{ product_id: 'fx-product', cost: 4, basis: 'standard', effective_from: '2026-01-01', effective_to: null, currency: 'USD' }],
    fxRates: [{ rate_date: '2026-04-01', from_currency: 'USD', to_currency: 'EUR', rate: '0.9' }],
  });
  assert.equal(result.valid, true);
  closeTo(result.list, 18);
  closeTo(result.freight, 1.8);
  closeTo(result.terms, 0.9);
  closeTo(result.cogs, 7.2);
  closeTo(result.margin, 8.1);

  const missing = MarginEngine.calculateLine({
    product: p,
    customer: { tier: 'standard' },
    qty: 1,
    transactionDate: '2026-05-01',
    transactionCurrency: 'GBP',
    costHistory: [{ product_id: 'fx-product', cost: 4, basis: 'standard', effective_from: '2026-01-01', effective_to: null, currency: 'USD' }],
    fxRates: [],
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.issues.some(issue => issue.code === 'fx_rate_missing'));
});
