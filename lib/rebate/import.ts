import type {Engine} from '../vault/engine';
import {rows} from '../pricing/rules';
import {sqlText as Q} from '../spike/exact';
import {accrueCents} from './engine';
import {skuList} from './store';
/** Validate complete programs, not independent bands. A broken band must never
 * leave a partial agreement active. Recheck reloads the whole rejected cohort. */
export async function validateRebateGroups(e:Engine,t:string,replaces:string|null){
 await e.conn.query(`UPDATE ${t} SET err='calculation_mode:invalid' WHERE err IS NULL AND (calculation_mode IS NULL OR calculation_mode NOT IN ('retroactive','incremental'));
 UPDATE ${t} SET err='rebate_treatment:invalid' WHERE err IS NULL AND (rebate_treatment IS NULL OR rebate_treatment NOT IN ('additional','replace'));
 UPDATE ${t} SET err='party_type:invalid' WHERE err IS NULL AND party_type IS NOT NULL AND party_type<>'customer';
 UPDATE ${t} SET err='threshold_amount:required' WHERE err IS NULL AND threshold_cents IS NULL;
 UPDATE ${t} SET err='period_end:range' WHERE err IS NULL AND period_end<period_start;`);
 const data=await rows(e,`SELECT * REPLACE(rate_percent::VARCHAR AS rate_percent,threshold_cents::VARCHAR AS threshold_cents,to_cents::VARCHAR AS to_cents,period_start::VARCHAR AS period_start,period_end::VARCHAR AS period_end) FROM ${t} ORDER BY file_ord,src_row`),groups=new Map<string,typeof data>();
 for(const r of data){const key=r.program_id??'\0'+r.file_ord+':'+r.src_row;const g=groups.get(key)??[];g.push(r);groups.set(key,g);}
 const existing=await rows(e,`SELECT reference,customer_id,period_start::VARCHAR lo,period_end::VARCHAR hi FROM rebate_programs ${replaces?`WHERE source_id IS DISTINCT FROM ${Q(replaces)}`:''}`);
 const valid:{key:string;customer:string;from:string;to:string}[]=[];
 for(const [key,g] of groups){
  let error:string|null=g.some(r=>r.err)?'program_id:incomplete':null;
  const first=g[0];
  if(!error){try{
   const metadata=(r:typeof first)=>JSON.stringify([r.file_ord,r.party,r.period_start,r.period_end,r.calculation_mode,r.rebate_treatment,skuList(r.eligible_skus??'').sort(),skuList(r.excluded_skus??'').sort()]);
   if(g.some(r=>metadata(r)!==metadata(first)))error='program_id:metadata';
   else if(g.length>100)error='program_id:tiers';else accrueCents(BigInt(0),first.calculation_mode,g.map(r=>({from:r.threshold_cents,to:r.to_cents,rate:r.rate_percent})));
  }catch{error='program_id:tiers';}}
  if(!error&&existing.some(r=>r.reference===key||(r.customer_id===first.party&&r.lo<=first.period_end&&first.period_start<=r.hi)))error='program_id:overlap';
  if(!error)for(const r of g)await e.conn.query(`UPDATE ${t} SET eligible_skus=${Q(skuList(first.eligible_skus??'').sort().join('|'))},excluded_skus=${Q(skuList(first.excluded_skus??'').sort().join('|'))} WHERE file_ord=${r.file_ord} AND src_row=${r.src_row}`);
  if(!error)valid.push({key,customer:first.party,from:first.period_start,to:first.period_end});
  if(error)for(const r of g)if(!r.err)await e.conn.query(`UPDATE ${t} SET err=${Q(error)} WHERE file_ord=${r.file_ord} AND src_row=${r.src_row}`);
 }
 for(const a of valid)if(valid.some(b=>a.key!==b.key&&a.customer===b.customer&&a.from<=b.to&&b.from<=a.to))await e.conn.query(`UPDATE ${t} SET err='program_id:overlap' WHERE program_id=${Q(a.key)} AND err IS NULL`);
}
/** Called by Import Studio inside its audited transaction. */
export function rebateCommitSql(valid:string){return `
 INSERT INTO customers(customer_id) SELECT DISTINCT party FROM ${valid} WHERE party NOT IN(SELECT customer_id FROM customers);
 INSERT INTO rebate_programs(id,reference,name,customer_id,mode,booking_mode,period_start,period_end,eligible_skus,excluded_skus,enabled,source_id,source_row,created_by,created_at)
 SELECT gen_random_uuid()::VARCHAR,program_id,program_id,party,calculation_mode,rebate_treatment,period_start,period_end,coalesce(eligible_skus,''),coalesce(excluded_skus,''),true,source_id,min(src_row),'import',${Q(new Date().toISOString())}
 FROM ${valid} GROUP BY program_id,party,calculation_mode,rebate_treatment,period_start,period_end,eligible_skus,excluded_skus,source_id;
 INSERT INTO rebate_tiers SELECT p.id,t.threshold_cents,t.to_cents,CAST(t.rate_percent*1000 AS INTEGER),t.src_row FROM ${valid} t JOIN rebate_programs p ON p.reference=t.program_id;
 `;}
