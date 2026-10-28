const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../margin-engine.js');
const R = require('../rebate-engine.js');
const product = {id:'p',currency:'USD',listPrice:100,cost:20,tiers:{Gold:95}};
const customer = {id:'c',group_id:'g',tier:'Gold'};
const rule = (kind,price) => ({id:kind,product_id:'p',customer_id:kind==='group'?null:'c',group_id:kind==='group'?'g':null,
  rule_kind:kind,price,currency:'USD',effective_from:'2026-01-01',effective_to:'2027-01-01',min_quantity:0,max_quantity:null,source:'Approved '+kind,contract_ref:kind==='contract'?'C-1':null});
test('price precedence contract > customer > group > tier > list, with source rationale',()=>{
  const rules=[rule('group',90),rule('customer',85),rule('contract',80)];
  for(const [count,expected,kind] of [[3,80,'contract'],[2,85,'customer'],[1,90,'group'],[0,95,'tier']]){
    const r=M.resolvePrice(product,customer,{quantity:5,date:'2026-06-01',rules:rules.slice(0,count)});
    assert.equal(r.price,expected); assert.equal(r.explanation.rule,kind);assert.ok(r.explanation.source);
  }
  assert.equal(M.resolvePrice(product,{id:'other'}).price,100);
  const calc=M.calculateQuote([{productId:'p',qty:2}],customer,[product],{transactionDate:'2026-06-01',pricingRules:rules});
  assert.equal(calc.lines[0].unitPrice,80);assert.equal(calc.lines[0].pricingExplanation.contract,'C-1');
});
test('pricing date and quantity edges, wrong customer/product and conflicting rules',()=>{
  const r={...rule('contract',80),min_quantity:10,max_quantity:20};
  const price=(date,quantity,rules=[r])=>M.resolvePrice(product,customer,{date,quantity,rules});
  assert.equal(price('2026-01-01',10).price,80);assert.equal(price('2026-12-31',19.9999).price,80);
  assert.equal(price('2027-01-01',10).price,95);assert.equal(price('2025-12-31',10).price,95);
  assert.equal(price('2026-01-01',20).price,95);assert.equal(price('2026-01-01',9.9999).price,95);
  assert.equal(price('2026-01-01',10,[{...r,customer_id:'other'}]).price,95);
  assert.equal(price('2026-01-01',10,[{...r,product_id:'other'}]).price,95);
  assert.equal(price('2026-01-01',10,[r,r]).issue.code,'pricing_overlap');
  assert.equal(price(undefined,10).issue.code,'pricing_date_missing');
});
test('resolved rule currency is converted separately from catalog cost',()=>{
  const r={...rule('contract',80),currency:'EUR'};
  const q=M.calculateQuote([{productId:'p',qty:1}],customer,[product],{transactionDate:'2026-01-01',transactionCurrency:'USD',pricingRules:[r],fxRates:[{rate_date:'2026-01-01',from_currency:'EUR',to_currency:'USD',rate:1.25}]});
  assert.equal(q.lines[0].unitPrice,100);assert.equal(q.cogs,20);
});
const agreement={calculation_mode:'retroactive',currency:'USD',period_start:'2026-01-01',period_end:'2026-12-31',excluded_skus:[],eligible_skus:[]};
const entry=(amount,entry_type='sale',occurred_on='2026-01-01',sku=null)=>({id:'e',source_ref:'test',currency:'USD',amount,entry_type,occurred_on,sku});
const bands=[{from_amount:1000,to_amount:2000,rate:2},{from_amount:2000,to_amount:null,rate:3}];
test('rebate thresholds and both incremental and retroactive tier modes',()=>{
  const earned=(amount,mode)=>Number(R.calculate({...agreement,calculation_mode:mode},bands,[entry(amount)]).earned);
  assert.equal(earned(999.9999,'retroactive'),0);assert.equal(earned(1000,'retroactive'),20);
  assert.equal(earned(1000,'incremental'),0);assert.equal(earned(2000,'retroactive'),60);
  assert.equal(earned(2500,'incremental'),35);assert.equal(earned(2500,'retroactive'),75);
  assert.equal(Number(R.calculate(agreement,bands,[entry(900)]).remaining),100);
});
test('rebates net returns/credit memos; exclusions and inclusive period boundaries; one final rounding',()=>{
  const a={...agreement,eligible_skus:['A','B'],excluded_skus:['B']};
  const entries=[entry(2000),entry(200,'return'),entry(100,'credit_memo'),entry(500,'sale','2026-12-31','A'),entry(999,'sale','2027-01-01'),entry(999,'sale','2025-12-31'),entry(999,'sale','2026-03-01','B'),entry(10,'rebate_credit')];
  const r=R.calculate(a,bands,entries);assert.equal(Number(r.eligibleSpend),2200);assert.equal(Number(r.earned),66);assert.equal(Number(r.difference),56);
  assert.equal(r.rows.filter(x=>!x.included).length,3);
  assert.equal(Number(R.calculate(a,bands,[entry(100,'return')]).eligibleSpend),0);
  assert.equal(R.calculate(agreement,[{from_amount:0,rate:'1.005'}],[entry('1.0000')]).earned,'0.0101');
  assert.throws(()=>R.calculate(a,[bands[0],{from_amount:1500,rate:3}],[]),/overlapping/);
});
test('documented NorthStar and Acme audit fixtures retain their terms',()=>{
  const seed=require('../seed_data.json');
  for(const x of seed.rebates.slice(0,2)){
    const r=R.calculate({...agreement,period_start:x.periodStart,period_end:x.periodEnd},[{from_amount:x.threshold,rate:x.rate}], [entry(x.eligibleSpend,'sale',x.periodStart),entry(x.credits,'rebate_credit',x.periodStart)]);
    if(x.id==='RA-301'){assert.equal(Number(r.earned),590);assert.equal(Number(r.credits),350);assert.equal(Number(r.difference),240);}
    else {assert.equal(Number(r.earned),0);assert.equal(Number(r.remaining),5000);}
  }
});
