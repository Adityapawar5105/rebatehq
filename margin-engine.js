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

  function effectiveCost(product, history, date, basis = 'standard') {
    if (!Array.isArray(history)) return { valid: true, cost: number(product?.cost), currency: product?.currency };
    const day = String(date || '').slice(0, 10);
    const rows = history.filter(row =>
      String(row.product_id ?? row.productId ?? row.product_id) === String(product?.id) &&
      String(row.basis) === String(basis) &&
      String(row.effective_from).slice(0, 10) <= day &&
      (row.effective_to == null || day < String(row.effective_to).slice(0, 10))
    );
    if (rows.length !== 1) return {
      valid: false,
      issue: { code: rows.length ? 'cost_history_overlap' : 'cost_history_gap', productId: product?.id, date: day, basis }
    };
    return { valid: true, cost: number(rows[0].cost), currency: rows[0].currency || product?.currency };
  }

  function currencyRate(fxRates, fromCurrency, toCurrency, date) {
    const from = String(fromCurrency || '').toUpperCase();
    const to = String(toCurrency || '').toUpperCase();
    if (!from || !to || from === to) return { valid: true, rate: 1 };
    const day = String(date || '').slice(0, 10);
    const rows = Array.isArray(fxRates) ? fxRates : [];
    const latest = candidates => candidates
      .filter(row => String(row.rate_date ?? row.date).slice(0, 10) <= day)
      .sort((a, b) => String(b.rate_date ?? b.date).localeCompare(String(a.rate_date ?? a.date)))[0];
    const direct = latest(rows.filter(row => String(row.from_currency ?? row.fromCurrency).toUpperCase() === from && String(row.to_currency ?? row.toCurrency).toUpperCase() === to));
    if (direct) return { valid: true, rate: number(direct.rate) };
    const inverse = latest(rows.filter(row => String(row.from_currency ?? row.fromCurrency).toUpperCase() === to && String(row.to_currency ?? row.toCurrency).toUpperCase() === from));
    if (inverse && number(inverse.rate) > 0) return { valid: true, rate: 1 / number(inverse.rate) };
    return { valid: false, issue: { code: 'fx_rate_missing', fromCurrency: from, toCurrency: to, date: day } };
  }

  function convertMoney(value, fromCurrency, toCurrency, fxRates, date) {
    const resolved = currencyRate(fxRates, fromCurrency, toCurrency, date);
    return resolved.valid
      ? { valid: true, value: Number((number(value) * resolved.rate).toFixed(4)) }
      : resolved;
  }

  function resolvePrice(product, customer, { quantity = 0, date, rules = [] } = {}) {
    const kinds = ['contract', 'customer', 'group'];
    const day = String(date || '').slice(0, 10);
    if (rules.length && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return { valid: false, issue: { code: 'pricing_date_missing' } };
    for (const kind of kinds) {
      const matches = rules.filter(row => row.product_id === product?.id && row.rule_kind === kind &&
        (kind === 'group' ? row.group_id === customer?.group_id && row.group_id != null : row.customer_id === customer?.id) &&
        String(row.effective_from).slice(0,10) <= day && (row.effective_to == null || day < String(row.effective_to).slice(0,10)) &&
        number(row.min_quantity) <= quantity && (row.max_quantity == null || quantity < number(row.max_quantity)));
      if (matches.length > 1) return { valid: false, issue: { code: 'pricing_overlap', productId: product?.id, kind } };
      if (matches.length) {
        const rule = matches[0];
        return { valid: true, price: number(rule.price), currency: rule.currency || product?.currency,
          explanation: { rule: kind, ruleId: rule.id, source: rule.source, contract: rule.contract_ref || null,
            from: rule.effective_from, to: rule.effective_to, minQuantity: rule.min_quantity, maxQuantity: rule.max_quantity } };
      }
    }
    const tier = product?.tiers?.[customer?.tier];
    return { valid: true, price: number(tier ?? product?.listPrice), currency: product?.currency,
      explanation: { rule: tier != null ? 'tier' : 'list', source: tier != null ? `Catalog tier: ${customer.tier}` : 'Product catalog', from: null, to: null } };
  }
  function priceFor(product, customer) { return resolvePrice(product, customer).price; }

  function calculateLine({
    product, customer, qty = 0, discountPct = 0, rebatePct = 0,
    accessory = 0, unitPrice, freightPerUnit, termsPerUnit, costOverride,
    transactionDate, transactionCurrency, costBasis = 'standard', costHistory, fxRates, pricingRules = []
  }) {
    const invalid = (issues = []) => ({ valid: false, issues, list: 0, baseList: 0, discount: 0, rebate: 0, freight: 0, terms: 0, pocket: 0, cogs: 0, margin: 0, rate: 0 });
    if (!product || !customer) return invalid();
    const quantity = Math.max(0, number(qty));
    const date = transactionDate || '';
    const currency = String(transactionCurrency || product.currency || '').toUpperCase();
    const productCurrency = String(product.currency || currency).toUpperCase();
    const priceResolution = unitPrice === undefined ? resolvePrice(product, customer, { quantity, date, rules: pricingRules }) : { valid: true, price: number(unitPrice), currency: productCurrency, explanation: { rule: 'explicit', source: 'Recorded price' } };
    if (!priceResolution.valid) return invalid([priceResolution.issue]);
    let selectedUnitPrice = priceResolution.price;
    const priceCurrency = String(priceResolution.currency || productCurrency).toUpperCase();
    let freightUnit = number(freightPerUnit ?? product.freight);
    let termsUnit = number(termsPerUnit ?? product.termsCost);
    let selectedCost = number(costOverride ?? product.cost);
    const issues = [];
    if (unitPrice === undefined && transactionCurrency && priceCurrency !== currency) {
      const converted = convertMoney(selectedUnitPrice, priceCurrency, currency, fxRates, date);
      if (!converted.valid) issues.push(converted.issue); else selectedUnitPrice = converted.value;
    }
    if (transactionCurrency && productCurrency !== currency) {
      for (const [field, value] of [['freight', freightUnit], ['terms', termsUnit]] ) {
        const converted = convertMoney(value, productCurrency, currency, fxRates, date);
        if (!converted.valid) issues.push(converted.issue);
        else if (field === 'freight') freightUnit = converted.value;
        else termsUnit = converted.value;
      }
    }
    let costCurrency = productCurrency;
    if (costOverride === undefined && Array.isArray(costHistory)) {
      const resolved = effectiveCost(product, costHistory, date, costBasis);
      if (!resolved.valid) issues.push(resolved.issue);
      else { selectedCost = resolved.cost; costCurrency = String(resolved.currency || productCurrency).toUpperCase(); }
    }
    if (transactionCurrency && costCurrency !== currency) {
      const converted = convertMoney(selectedCost, costCurrency, currency, fxRates, date);
      if (!converted.valid) issues.push(converted.issue); else selectedCost = converted.value;
    }
    if (issues.length) return invalid(issues);
    const baseList = selectedUnitPrice * quantity; const list = baseList + number(accessory);
    const discount = list * number(discountPct) / 100;
    const rebate = list * number(rebatePct) / 100;
    const freight = freightUnit * quantity;
    const terms = termsUnit * quantity;
    const pocket = list - discount - rebate - freight - terms;
    const cogs = selectedCost * quantity;
    const margin = pocket - cogs;
    return {
      valid: true, productId: product.id, product, qty: quantity, baseList,
      unitPrice: selectedUnitPrice, pricingExplanation: priceResolution.explanation, accessory: number(accessory),
      list, discount, rebate, freight, terms, pocket, cogs, margin,
      rate: marginRate(margin, pocket), marginWithoutFreight: margin + freight
    };
  }

  function calculateOrder(order, customer, product) {
    const line = calculateLine({
      product, customer, qty: order?.qty, discountPct: order?.discountPct,
      rebatePct: order?.offInvoiceRebatePct, freightPerUnit: order?.freightPerUnit,
      termsPerUnit: order?.termsPerUnit,
      transactionDate: order?.transactionDate || order?.date,
      transactionCurrency: order?.currency,
      costBasis: order?.costBasis,
      costHistory: order?.costHistory,
      fxRates: order?.fxRates, pricingRules: order?.pricingRules
    });
    return line.valid ? { ...line, order, c: customer, p: product } : null;
  }

  function findProduct(products, id) {
    if (products instanceof Map) return products.get(id);
    if (Array.isArray(products)) return products.find(product => product.id === id);
    return products?.[id];
  }

  function calculateQuote(lines, customer, products, options = {}) {
    const lineResults = (lines || []).map(line => calculateLine({
      product: findProduct(products, line.productId), customer,
      qty: line.qty, discountPct: line.discountPct, rebatePct: line.rebatePct,
      accessory: line.accessory,
      transactionDate: line.transactionDate || options.transactionDate,
      transactionCurrency: line.currency || options.transactionCurrency,
      costBasis: line.costBasis || options.costBasis,
      costHistory: options.costHistory,
      fxRates: options.fxRates, pricingRules: options.pricingRules
    }));
    const valid = lineResults.every(line => line.valid);
    const totals = Object.fromEntries(FIELDS.map(field => [field, lineResults.reduce((sum, line) => sum + number(line[field]), 0)]));
    return { ...totals, valid, issues: lineResults.flatMap(line => line.issues || []), lines: lineResults, rate: marginRate(totals.margin, totals.pocket) };
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

  function buildMonthlySnapshots(orders, customers, products, companyId = 'company', options = {}) {
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
      const result = calculateOrder({ ...options, ...order }, customer, product);
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

  return { resolvePrice, priceFor, effectiveCost, currencyRate, convertMoney, calculateLine, calculateOrder, calculateQuote, aggregate, calculateProductMargin, classify, calculatePassThrough, buildMonthlySnapshots, trendFor };
});
