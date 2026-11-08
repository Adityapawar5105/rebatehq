import type {Engine} from '../vault/engine';
import {sqlText as Q,minorUnits,validDate} from '../spike/exact';
import {rows} from '../pricing/rules';
import {rhaSql} from '../margin/sql';
import {text} from '../margin/decimal';
import {workspaceCurrency} from '../vault/currency';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';
import {accrueCents,rateInteger,type Agreement} from './engine';
import {hasRebates,salesInput} from './input';
export type ProgramInput={id?:string;reference:string;customer:string;mode:Agreement['calculation_mode'];treatment:'additional'|'replace';from:string;to:string;eligible:string;excluded:string;enabled:boolean;tiers:{from:string;to:string;rate:string}[]};
export type Program={id:string;reference:string;name:string;customer:string;mode:Agreement['calculation_mode'];treatment:'additional'|'replace';from:string;to:string;eligible:string[];excluded:string[];enabled:boolean;source:string|null;sourceRow:string|null;checkedAt:string|null;tiers:{from:string;to:string|null;rate:string}[]};
export function bad():never{throw new VaultError('REBATE',msg('rebate.invalidProgram'));}
export function skuList(v:string){if(typeof v!=='string'||v.length>500)bad();const a=v?v.split('|').map(x=>x.trim()):[];if(a.some(x=>!x||x.length>64||/[\x00-\x1f]/.test(x))||a.length>50||new Set(a).size!==a.length)bad();return a;}
export function checked(p:Program):Program{
 try{validDate(p.from);validDate(p.to);if(p.from>p.to||!p.reference.trim()||p.reference.length>100||!p.customer||p.customer.length>64||/[\x00-\x1f]/.test(p.reference+p.customer)||!['additional','replace'].includes(p.treatment)||typeof p.enabled!=='boolean'||!p.tiers.length||p.tiers.length>100)bad();
  accrueCents(BigInt(0),p.mode,p.tiers);return p;
 }catch{return bad();}
}
export async function programs(e:Engine):Promise<Program[]>{
 if(!await hasRebates(e))return [];
 const tiers=await rows(e,'SELECT program_id,from_cents::VARCHAR lo,to_cents::VARCHAR hi,rate_milli::VARCHAR rate FROM rebate_tiers ORDER BY program_id,from_cents');
 return (await rows(e,'SELECT id,reference,name,customer_id,mode,booking_mode,period_start::VARCHAR lo,period_end::VARCHAR hi,eligible_skus,excluded_skus,enabled,source_id,source_row::VARCHAR source_row,last_calculated_at FROM rebate_programs ORDER BY period_end DESC,reference')).map(r=>checked({id:r.id,reference:r.reference,name:r.name,customer:r.customer_id,mode:r.mode,treatment:r.booking_mode,from:r.lo,to:r.hi,eligible:skuList(r.eligible_skus),excluded:skuList(r.excluded_skus),enabled:r.enabled,source:r.source_id,sourceRow:r.source_row,checkedAt:r.last_calculated_at,tiers:tiers.filter(t=>t.program_id===r.id).map(t=>({from:t.lo,to:t.hi,rate:text({v:BigInt(t.rate),s:3})}))}));
}
export const eligibleWhere=(p:Program,alias='s')=>`${alias}.customer_id=${Q(p.customer)} AND ${alias}.sale_date BETWEEN DATE ${Q(p.from)} AND DATE ${Q(p.to)} ${p.eligible.length?`AND ${alias}.product_id IN (${p.eligible.map(Q).join(',')})`:''} ${p.excluded.length?`AND ${alias}.product_id NOT IN (${p.excluded.map(Q).join(',')})`:''}`;
export async function assertNoOverlap(e:Engine){
 const r=await rows(e,'SELECT a.id FROM rebate_programs a JOIN rebate_programs b ON a.id<b.id AND a.customer_id=b.customer_id AND a.period_start<=b.period_end AND b.period_start<=a.period_end LIMIT 1');if(r.length)throw new VaultError('REBATE',msg('rebate.overlap'));
}
export async function saveSql(e:Engine,input:ProgramInput,actor:string){
 let p:Program;try{p=checked({id:input.id??crypto.randomUUID(),reference:input.reference.trim(),name:input.reference.trim(),customer:input.customer.trim(),mode:input.mode,treatment:input.treatment,from:input.from,to:input.to,eligible:skuList(input.eligible),excluded:skuList(input.excluded),enabled:input.enabled,source:null,sourceRow:null,checkedAt:null,tiers:input.tiers.map(t=>({from:String(minorUnits(t.from)),to:t.to?String(minorUnits(t.to)):null,rate:t.rate}))});}catch{bad();}
 const all=await programs(e),old=all.find(x=>x.id===p.id);if(input.id&&!old)bad();if(old?.source)throw new VaultError('REBATE',msg('rebate.fileOwned'));
 if(all.some(x=>x.id!==p.id&&(x.reference===p.reference||(x.customer===p.customer&&x.from<=p.to&&p.from<=x.to))))throw new VaultError('REBATE',msg('rebate.overlap'));
 const now=new Date().toISOString(),vals=[Q(p.id),Q(p.reference),Q(p.name),Q(p.customer),Q(p.mode),Q(p.treatment),'DATE '+Q(p.from),'DATE '+Q(p.to),Q(p.eligible.join('|')),Q(p.excluded.join('|')),String(p.enabled),'NULL','NULL',Q(actor),Q(now),'NULL'];
 return {id:p.id,sql:`DELETE FROM rebate_tiers WHERE program_id=${Q(p.id)};DELETE FROM rebate_programs WHERE id=${Q(p.id)};
 INSERT INTO customers(customer_id) SELECT ${Q(p.customer)} WHERE NOT EXISTS(SELECT 1 FROM customers WHERE customer_id=${Q(p.customer)});
 INSERT INTO rebate_programs VALUES(${vals.join(',')});INSERT INTO rebate_tiers VALUES ${p.tiers.map(t=>`(${Q(p.id)},${t.from},${t.to??'NULL'},${rateInteger(t.rate)},NULL)`).join(',')};`};
}
/** Caller owns the transaction and audit. Never change the raw ERP rows. */
export async function rebuildAccruals(e:Engine){
 if(!await hasRebates(e))return;await assertNoOverlap(e);const list=await programs(e);
 await e.conn.query('DELETE FROM rebate_accruals');
 for(const p of list.filter(p=>p.enabled)){
  const where=eligibleWhere(p),base='(CAST(s.list_cents AS HUGEINT)-s.discount_cents)',sum=(await rows(e,`SELECT coalesce(sum(${base}),0)::VARCHAR spend FROM sales_lines s WHERE ${where}`))[0].spend;
  const result=accrueCents(BigInt(sum),p.mode,p.tiers),earned=BigInt(result.earned),net=BigInt(result.spend);
  const allocation=net>BigInt(0)?`${rhaSql(`${earned}*cumulative`,String(net))}-${rhaSql(`${earned}*(cumulative-base)`,String(net))}`:'0';
  await e.conn.query(`INSERT INTO rebate_accruals WITH b AS(SELECT source_id,line_id,${base} AS base,s.rebate_cents booked FROM sales_lines s WHERE ${where}),c AS(SELECT *,sum(base) OVER(ORDER BY source_id,line_id ROWS UNBOUNDED PRECEDING) cumulative FROM b)
  SELECT ${Q(p.id)},source_id,line_id,CAST(base AS BIGINT),booked,CAST(${allocation} AS BIGINT) FROM c`);
 }
 await e.conn.query(`UPDATE rebate_programs SET last_calculated_at=${Q(new Date().toISOString())}`);
}
export type Progress={id:string;reference:string;customer:string;from:string;to:string;mode:string;enabled:boolean;spend:string;earned:string;remaining:string|null;nextRate:string|null;checkedAt:string|null;reminder:boolean};
export async function progress(e:Engine,offset=0){
 const list=await programs(e),out:Progress[]=[];const today=new Date().toISOString().slice(0,10),soon=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10);
 for(const p of list){const r=(await rows(e,`SELECT coalesce(sum(base_cents),0)::VARCHAR spend FROM rebate_accruals WHERE program_id=${Q(p.id)}`))[0];const value=accrueCents(BigInt(r.spend),p.mode,p.tiers);
  out.push({id:p.id,reference:p.reference,customer:p.customer,from:p.from,to:p.to,mode:p.mode,enabled:p.enabled,...value,checkedAt:p.checkedAt,reminder:p.enabled&&value.remaining!==null&&BigInt(value.remaining)>BigInt(0)&&p.to>=today&&p.to<=soon});}
 offset=Number.isInteger(offset)?Math.max(0,offset):0;return {currency:await workspaceCurrency(e),rows:out.slice(offset,offset+50),total:String(out.length),offset};
}
export async function reconciliation(e:Engine){
 if(!await hasRebates(e))return {booked:'0',expected:'0',recognized:'0',adjustment:'0',programs:'0',valid:true};
 const list=await programs(e);let expected=BigInt(0),valid=true;
 for(const p of list.filter(x=>x.enabled)){
  const raw=(await rows(e,`SELECT coalesce(sum(CAST(s.list_cents AS HUGEINT)-s.discount_cents),0)::VARCHAR spend,count(*)::VARCHAR n,coalesce(sum(s.rebate_cents),0)::VARCHAR booked FROM sales_lines s WHERE ${eligibleWhere(p)}`))[0];
  const ledger=(await rows(e,`SELECT coalesce(sum(base_cents),0)::VARCHAR spend,coalesce(sum(accrued_cents),0)::VARCHAR earned,coalesce(sum(booked_cents),0)::VARCHAR booked,count(*)::VARCHAR n FROM rebate_accruals WHERE program_id=${Q(p.id)}`))[0];
  const earned=accrueCents(BigInt(raw.spend),p.mode,p.tiers).earned;expected+=BigInt(earned);valid&&=raw.spend===ledger.spend&&raw.n===ledger.n&&raw.booked===ledger.booked&&earned===ledger.earned;
 }
 const r=(await rows(e,`SELECT (SELECT coalesce(sum(rebate_cents),0)::VARCHAR FROM sales_lines) booked,(SELECT coalesce(sum(rebate_cents),0)::VARCHAR FROM ${await salesInput(e)}) recognized,
 (SELECT coalesce(sum(CASE WHEN p.booking_mode='replace' THEN a.accrued_cents-a.booked_cents ELSE a.accrued_cents END),0)::VARCHAR FROM rebate_accruals a JOIN rebate_programs p ON p.id=a.program_id AND p.enabled) adjustment`))[0];
 valid&&=BigInt(r.booked)+BigInt(r.adjustment)===BigInt(r.recognized);return {booked:r.booked,expected:String(expected),recognized:r.recognized,adjustment:r.adjustment,programs:String(list.filter(p=>p.enabled).length),valid};
}
export async function state(e:Engine){return {programs:await programs(e),progress:await progress(e),reconciliation:await reconciliation(e)};}
export async function evidence(e:Engine,id:string,offset=0){
 const p=(await programs(e)).find(p=>p.id===id);if(!p)bad();offset=Number.isInteger(offset)?Math.max(0,offset):0;
 const count=(await rows(e,`SELECT count(*)::VARCHAR n FROM rebate_accruals WHERE program_id=${Q(id)}`))[0].n;
 const data=await rows(e,`SELECT f.name AS "source",s.source_row::VARCHAR AS "row",s.line_id::VARCHAR AS "line",s.product_id AS product,s.sale_date::VARCHAR AS "date",s.line_kind AS kind,a.base_cents::VARCHAR base,a.booked_cents::VARCHAR booked,a.accrued_cents::VARCHAR accrued,v.rebate_cents::VARCHAR recognized
 FROM rebate_accruals a JOIN sales_lines s ON s.source_id=a.source_id AND s.line_id=a.line_id JOIN rebate_sales v ON v.source_id=s.source_id AND v.line_id=s.line_id JOIN source_files f ON f.id=s.source_id WHERE a.program_id=${Q(id)} ORDER BY a.source_id,a.line_id LIMIT 50 OFFSET ${offset}`);
 return {id,offset,count,rows:data as {source:string;row:string;line:string;product:string;date:string;kind:string;base:string;booked:string;accrued:string;recognized:string}[]};
}
export async function removeSql(e:Engine,id:string){const p=(await programs(e)).find(p=>p.id===id);if(!p)bad();if(p.source)throw new VaultError('REBATE',msg('rebate.fileOwned'));return `DELETE FROM rebate_accruals WHERE program_id=${Q(id)};DELETE FROM rebate_tiers WHERE program_id=${Q(id)};DELETE FROM rebate_programs WHERE id=${Q(id)};`;}
