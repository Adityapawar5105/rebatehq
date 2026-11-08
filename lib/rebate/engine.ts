// Browser-safe port of rebate-engine.js. Four-place integers preserve the legacy
// golden cases; production accruals round the unrounded numerator ONCE to cents.
import {rha,text} from '../margin/decimal';
export type Agreement={calculation_mode:'retroactive'|'incremental';currency:string;period_start:string;period_end:string;eligible_skus?:string[];excluded_skus?:string[]};
export type Band={from_amount:string;to_amount?:string|null;rate:string};
export type Entry={amount:string;entry_type:'sale'|'return'|'credit_memo'|'rebate_credit';currency:string;occurred_on:string;sku?:string|null;source_ref?:string};
function integer(value:string,places:number){const m=/^(\d+)(?:\.(\d+))?$/.exec(value);if(!m||(m[2]?.length??0)>places)throw Error('Invalid rebate precision');return BigInt(m[1])*BigInt(10)**BigInt(places)+BigInt((m[2]??'').padEnd(places,'0'));}
export const rateInteger=(v:string)=>{const n=integer(v,3);if(n>BigInt(100000))throw Error('Invalid rebate rate');return n;};
const amount=(v:bigint)=>text({v,s:4});
export function tierNumerator(spend:bigint,mode:Agreement['calculation_mode'],bands:{from:bigint;to:bigint|null;pct:bigint}[]){
 if(!['retroactive','incremental'].includes(mode)||!bands.length)throw Error('Invalid rebate program');
 bands.forEach((b,i)=>{if(b.from<BigInt(0)||b.pct<BigInt(0)||b.pct>BigInt(100000)||(b.to!==null&&b.to<=b.from)||(i&&(bands[i-1].to===null||bands[i-1].to!>b.from)))throw Error('Invalid or overlapping rebate tiers');});
 if(mode==='retroactive'){const b=bands.find(b=>spend>=b.from&&(b.to===null||spend<b.to));return b?spend*b.pct:BigInt(0);}
 return bands.reduce((sum,b)=>{const end=b.to===null||spend<b.to?spend:b.to;return sum+(end>b.from?(end-b.from)*b.pct:BigInt(0));},BigInt(0));
}
export function accrueCents(spend:bigint,mode:Agreement['calculation_mode'],tiers:{from:string;to:string|null;rate:string}[]){
 const net=spend<BigInt(0)?BigInt(0):spend,bands=tiers.map(b=>({from:BigInt(b.from),to:b.to===null?null:BigInt(b.to),pct:rateInteger(b.rate)})).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
 const next=bands.find(b=>b.from>net),numerator=tierNumerator(net,mode,bands);
 return {spend:String(net),earned:String(rha(numerator,BigInt(100000))),remaining:next?String(next.from-net):null,nextRate:next?text({v:next.pct,s:3}):null};
}
/** Same observable arithmetic/eligibility as the legacy API, without Node/pg. */
export function calculate(agreement:Agreement,tiers:Band[],entries:Entry[]){
 const bands=tiers.map(b=>({from:integer(b.from_amount,4),to:b.to_amount==null?null:integer(b.to_amount,4),pct:rateInteger(b.rate)})).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
 let spend=BigInt(0),credits=BigInt(0);
 const rows=entries.map(row=>{if(row.currency!==agreement.currency)throw Error('Rebate currency mismatch');let reason:string|null=null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.occurred_on))throw Error('Invalid rebate date');
  if(row.occurred_on<agreement.period_start||row.occurred_on>agreement.period_end)reason='outside period';
  if(row.entry_type!=='rebate_credit'&&row.sku&&((agreement.excluded_skus??[]).includes(row.sku)||((agreement.eligible_skus??[]).length&&!(agreement.eligible_skus??[]).includes(row.sku))))reason='excluded SKU';
  const value=integer(row.amount,4);if(!['sale','return','credit_memo','rebate_credit'].includes(row.entry_type))throw Error('Invalid rebate entry');
  if(!reason){if(row.entry_type==='rebate_credit')credits+=value;else spend+=row.entry_type==='sale'?value:-value;}
  return {...row,included:reason===null,reason};
 });if(spend<BigInt(0))spend=BigInt(0);
 const numerator=tierNumerator(spend,agreement.calculation_mode,bands),earned=rha(numerator,BigInt(100000)),next=bands.find(b=>b.from>spend);
 return {eligibleSpend:amount(spend),earned:amount(earned),credits:amount(credits),difference:amount(earned-credits),remaining:next?amount(next.from-spend):null,nextRate:next?text({v:next.pct,s:3}):null,rows};
}
