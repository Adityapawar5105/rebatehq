/* Shared rebate arithmetic. Amounts use four-decimal integers, rates use 0–100 percent. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RebateEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function decimal(value, places = 4) {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
    if (!match || (match[2] || '').length > places) throw new Error('Invalid rebate amount or precision');
    return BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] || '').padEnd(places, '0'));
  }
  const amount = value => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 10000n}.${String((value < 0n ? -value : value) % 10000n).padStart(4,'0')}`;
  function calculate(agreement, tiers, entries) {
    if (!['incremental','retroactive'].includes(agreement.calculation_mode)) throw new Error('Unknown rebate mode');
    const bands = tiers.map(t => ({ ...t, from: decimal(t.from_amount), to: t.to_amount == null ? null : decimal(t.to_amount), pct: decimal(t.rate,3) })).sort((a,b)=>a.from < b.from ? -1 : 1);
    if (!bands.length) throw new Error('Rebate tiers are missing');
    bands.forEach((t,i) => { if (t.pct>100000n || (t.to!=null && t.to<=t.from) || (i && (bands[i-1].to==null || bands[i-1].to>t.from))) throw new Error('Invalid or overlapping rebate tiers'); });
    let spend=0n, credits=0n;
    const rows=entries.map(row=>{
      if (row.currency !== agreement.currency) throw new Error(`Rebate currency mismatch: ${row.source_ref}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on)) throw new Error('Invalid rebate entry date');
      let reason=null;
      if (row.occurred_on < agreement.period_start || row.occurred_on > agreement.period_end) reason='outside period';
      if (row.entry_type !== 'rebate_credit' && row.sku && ((agreement.excluded_skus || []).includes(row.sku) || ((agreement.eligible_skus || []).length && !agreement.eligible_skus.includes(row.sku)))) reason='excluded SKU';
      const value=decimal(row.amount);
      if (!['sale','return','credit_memo','rebate_credit'].includes(row.entry_type)) throw new Error('Unknown rebate entry type');
      if (!reason) { if(row.entry_type==='rebate_credit') credits+=value; else spend+=row.entry_type==='sale' ? value : -value; }
      return { ...row, included: !reason, reason };
    });
    if(spend<0n) spend=0n;
    let numerator=0n;
    if (agreement.calculation_mode==='retroactive') {
      const tier=bands.find(t=>spend>=t.from && (t.to==null || spend<t.to));
      if(tier) numerator=spend*tier.pct;
    } else {
      for(const t of bands) { const end=t.to==null || spend<t.to ? spend : t.to; if(end>t.from) numerator+=(end-t.from)*t.pct; }
    }
    // Round once at agreement level to four decimals, half up.
    const earned=(numerator+50000n)/100000n;
    const next=bands.find(t=>t.from>spend);
    return { eligibleSpend:amount(spend), earned:amount(earned), credits:amount(credits), difference:amount(earned-credits),
      remaining:next ? amount(next.from-spend) : null, nextRate:next ? next.rate : null, rows };
  }
  return { calculate };
});
