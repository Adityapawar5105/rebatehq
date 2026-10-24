/* Shared, deterministic MarginDesk margin calculations. Safe to load in a browser or Node. */
(function attachMarginEngine(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarginEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMarginEngine() {
  'use strict';

  const FIELDS = ['list', 'baseList', 'discount', 'rebate', 'freight', 'terms', 'pocket', 'cogs', 'margin'];
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const marginRate = (margin, pocket) => pocket ? margin / pocket * 100 : 0;

  function priceFor(product, customer) {
    return number(product?.tiers?.[customer?.tier] ?? product?.listPrice ?? 0);
  }

  function calculateLine({
    product, customer, qty = 0, discountPct = 0, rebatePct = 0,
    accessory = 0, unitPrice, freightPerUnit, termsPerUnit, costOverride
  }) {
    if (!product || !customer) return { valid: false, list: 0, baseList: 0, discount: 0, rebate: 0, freight: 0, terms: 0, pocket: 0, cogs: 0, margin: 0, rate: 0 };
    const quantity = Math.max(0, number(qty));
    const selectedUnitPrice = unitPrice === undefined ? priceFor(product, customer) : number(unitPrice);
    const baseList = selectedUnitPrice * quantity; const list = baseList + number(accessory);
    const discount = list * number(discountPct) / 100;
    const rebate = list * number(rebatePct) / 100;
    const freight = number(freightPerUnit ?? product.freight) * quantity;
    const terms = number(termsPerUnit ?? product.termsCost) * quantity;
    const pocket = list - discount - rebate - freight - terms;
    const cogs = number(costOverride ?? product.cost) * quantity;
    const margin = pocket - cogs;
    return {
      valid: true, productId: product.id, product, qty: quantity, baseList,
      unitPrice: selectedUnitPrice, accessory: number(accessory),
      list, discount, rebate, freight, terms, pocket, cogs, margin,
      rate: marginRate(margin, pocket), marginWithoutFreight: margin + freight
    };
  }

  function calculateOrder(order, customer, product) {
    const line = calculateLine({
      product, customer, qty: order?.qty, discountPct: order?.discountPct,
      rebatePct: order?.offInvoiceRebatePct, freightPerUnit: order?.freightPerUnit,
      termsPerUnit: order?.termsPerUnit
    });
    return line.valid ? { ...line, order, c: customer, p: product } : null;
  }

  function findProduct(products, id) {
    if (products instanceof Map) return products.get(id);
    if (Array.isArray(products)) return products.find(product => product.id === id);
    return products?.[id];
  }

  function calculateQuote(lines, customer, products) {
    const lineResults = (lines || []).map(line => calculateLine({
      product: findProduct(products, line.productId), customer,
      qty: line.qty, discountPct: line.discountPct, rebatePct: line.rebatePct,
      accessory: line.accessory
    }));
    const valid = lineResults.every(line => line.valid);
    const totals = Object.fromEntries(FIELDS.map(field => [field, lineResults.reduce((sum, line) => sum + number(line[field]), 0)]));
    return { ...totals, valid, lines: lineResults, rate: marginRate(totals.margin, totals.pocket) };
  }

  function aggregate(results) {
    const totals = Object.fromEntries(FIELDS.map(field => [field, (results || []).reduce((sum, row) => sum + number(row[field]), 0)]));
    return { ...totals, rate: marginRate(totals.margin, totals.pocket), count: (results || []).length };
  }

  function calculateProductMargin(product) {
    return calculateLine({ product, customer: { tier: 'Standard' }, qty: 1, unitPrice: product?.listPrice });
  }

  function classify(rate, policy) {
    if (rate >= number(policy?.target)) return 'green';
    if (rate < number(policy?.walkAway)) return 'red';
    return 'yellow';
  }

  function calculatePassThrough(product, oldPrice, costChangePct, oldCost = product?.cost) {
    const before = calculateLine({ product, customer: { tier: 'Standard' }, qty: 1, unitPrice: oldPrice, costOverride: oldCost });
    const newCost = number(oldCost) * (1 + number(costChangePct) / 100);
    const denominator = 1 - before.rate / 100;
    const newPrice = denominator > 0 ? (newCost / denominator) + number(product?.freight) + number(product?.termsCost) : newCost + number(product?.freight) + number(product?.termsCost);
    const after = calculateLine({ product, customer: { tier: 'Standard' }, qty: 1, unitPrice: newPrice, costOverride: newCost });
    return { oldCost: number(oldCost), newCost, oldPrice: number(oldPrice), newPrice, before, after };
  }

  function buildMonthlySnapshots(orders, customers, products, companyId = 'company') {
    const customerById = new Map((customers || []).map(customer => [customer.id, customer]));
    const productById = new Map((products || []).map(product => [product.id, product]));
    const groups = new Map();
    const add = (entityType, entityId, month, result) => {
      if (!month || !result) return;
      const key = `${entityType}:${entityId}:${month}`;
      if (!groups.has(key)) groups.set(key, { entityType, entityId, month, rows: [] });
      groups.get(key).rows.push(result);
    };
    for (const order of orders || []) {
      const customer = customerById.get(order.customerId);
      const product = productById.get(order.productId);
      const result = calculateOrder(order, customer, product);
      const month = order.month || String(order.date || '').slice(0, 7);
      if (!result || !month) continue;
      add('company', companyId, month, result);
      add('product', product.id, month, result);
      add('customer', customer.id, month, result);
    }
    return [...groups.values()].map(group => {
      const totals = aggregate(group.rows);
      return {
        id: `${group.entityType}:${group.entityId}:${group.month}`,
        entityType: group.entityType, entityId: group.entityId, month: group.month,
        orderCount: totals.count, pocket: totals.pocket, margin: totals.margin,
        marginRate: totals.rate, storedAt: new Date().toISOString()
      };
    }).sort((a, b) => a.month.localeCompare(b.month) || a.entityType.localeCompare(b.entityType) || a.entityId.localeCompare(b.entityId));
  }

  function trendFor(snapshots, entityType, entityId) {
    const history = (snapshots || [])
      .filter(row => row.entityType === entityType && row.entityId === entityId)
      .sort((a, b) => a.month.localeCompare(b.month));
    if (history.length < 2) return { status: 'insufficient', label: 'Not enough history' };
    const previous = history[history.length - 2];
    const current = history[history.length - 1];
    const delta = number(current.marginRate) - number(previous.marginRate);
    return { status: 'ready', direction: delta >= 0 ? 'up' : 'down', delta, previous, current };
  }

  return { priceFor, calculateLine, calculateOrder, calculateQuote, aggregate, calculateProductMargin, classify, calculatePassThrough, buildMonthlySnapshots, trendFor };
});