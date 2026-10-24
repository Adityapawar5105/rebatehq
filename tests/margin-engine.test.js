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