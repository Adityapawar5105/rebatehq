import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {duckdbConnection,rows} from './helpers/duckdb-node';
import {schemaSql,TABLES,SCHEMA_VERSION,upgradeSql,tablesFor,V14_SQL} from '../lib/vault/schema';
import {calculate,accrueCents,type Agreement,type Entry} from '../lib/rebate/engine';
import * as rebates from '../lib/rebate/store';
import type {Engine} from '../lib/vault/engine';
const legacy=createRequire(import.meta.url)('../rebate-engine.js');
const a:Agreement={calculation_mode:'retroactive',currency:'CAD',period_start:'2026-01-01',period_end:'2026-12-31'};
const entry=(amount:string,type:Entry['entry_type']='sale',day='2026-01-01',sku:string|null=null):Entry=>({amount,entry_type:type,occurred_on:day,currency:'CAD',sku});
const bands=[{from_amount:'1000',to_amount:'2000',rate:'2'},{from_amount:'2000',to_amount:null,rate:'3'}];
test('7D-1 legacy golden tiers, returns, exclusions, credits and period boundaries port exactly; cent rounding is once',()=>{
 for(const mode of ['incremental','retroactive'] as const)for(const spend of ['999.9999','1000','2000','2500']){
  const x={...a,calculation_mode:mode},e=[entry(spend)],v=calculate(x,bands,e),old=legacy.calculate(x,bands,e);for(const k of ['eligibleSpend','earned','credits','difference','remaining'])assert.equal(v[k as keyof typeof v],old[k],k);
 }
 const x={...a,eligible_skus:['A','B'],excluded_skus:['B']},e=[entry('2000'),entry('200','return'),entry('100','credit_memo'),entry('500','sale','2026-12-31','A'),entry('999','sale','2027-01-01'),entry('999','sale','2025-12-31'),entry('999','sale','2026-03-01','B'),entry('10','rebate_credit')];
 const r=calculate(x,bands,e);assert.equal(r.eligibleSpend,'2200.0000');assert.equal(r.earned,'66.0000');assert.equal(r.difference,'56.0000');assert.equal(r.rows.filter(x=>!x.included).length,3);
 assert.equal(calculate(a,[{from_amount:'0',rate:'1.005'}],[entry('1.0000')]).earned,'0.0101');
 assert.equal(accrueCents(BigInt(100),'retroactive',[{from:'0',to:null,rate:'1.499'}]).earned,'1','Do not round four places then cents');
 assert.throws(()=>calculate(a,[bands[0],{from_amount:'1500',rate:'3'}],[]),/overlapping/);
 const seed=createRequire(import.meta.url)('../seed_data.json');for(const p of seed.rebates.slice(0,2)){const v=calculate({...a,period_start:p.periodStart,period_end:p.periodEnd},[{from_amount:String(p.threshold),rate:String(p.rate)}],[entry(String(p.eligibleSpend),'sale',p.periodStart),entry(String(p.credits),'rebate_credit',p.periodStart)]);if(p.id==='RA-301'){assert.equal(v.earned,'590.0000');assert.equal(v.difference,'240.0000');}else assert.equal(v.remaining,'5000.0000');}
});
async function fixture(){const c=await duckdbConnection();c.query('DROP VIEW IF EXISTS rebate_sales');for(const t of [...TABLES].reverse())c.query('DROP TABLE IF EXISTS '+t);c.query(schemaSql(SCHEMA_VERSION));
 c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,currency) VALUES(1,14,'professional','test','tip','CAD');INSERT INTO products(product_id) VALUES('A');INSERT INTO customers(customer_id) VALUES('C');INSERT INTO source_files VALUES('sales','synthetic.csv','sales_history',1,'2026-01-01');
 INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('sales',1,'A','C','2026-03-31',1,2950000,0,0,35000,1000000,2,'I');`);
 return {c,e:{conn:{query:async(s:string)=>c.query(s)}} as unknown as Engine};}
test('7D-1 schema v13 upgrades with AR sidecar intact; three new tables and a nonmutating financial view',async()=>{
 const {c}=await fixture();try{c.query('DROP VIEW rebate_sales');for(const t of ['rebate_accruals','rebate_tiers','rebate_programs'])c.query('DROP TABLE '+t);c.query("INSERT INTO source_kinds VALUES('old-ar','ar_aging')");c.query(V14_SQL);assert.equal(rows(c,'SELECT kind FROM source_kinds')[0].kind,'ar_aging');assert.ok(upgradeSql(13).startsWith(V14_SQL));assert.equal(tablesFor(13).length,42);assert.equal(TABLES.length,50);assert.equal(rows(c,'SELECT rebate_cents::VARCHAR r FROM rebate_sales')[0].r,'35000');}finally{c.close();}
});
test('7D-1 CAD customer accruals reconcile booked 350 + adjustment 240 = liability 590; additional and returns allocate exactly',async()=>{
 const {c,e}=await fixture();try{
  const p=await rebates.saveSql(e,{reference:'NorthStar customer fixture',customer:'C',mode:'retroactive',treatment:'replace',from:'2026-01-01',to:'2026-03-31',eligible:'',excluded:'',enabled:true,tiers:[{from:'0',to:'',rate:'2'}]},'actor');c.query(p.sql);await rebates.rebuildAccruals(e);
  assert.deepEqual(await rebates.reconciliation(e),{booked:'35000',expected:'59000',recognized:'59000',adjustment:'24000',programs:'1',valid:true});assert.equal(rows(c,'SELECT rebate_cents::VARCHAR r FROM sales_lines')[0].r,'35000');
  c.query("UPDATE rebate_programs SET booking_mode='additional'");await rebates.rebuildAccruals(e);assert.equal((await rebates.reconciliation(e)).recognized,'94000');
  c.query("INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind) VALUES('sales',2,'A','C','2026-03-31',-1,-50000,0,0,0,-10000,3,'R','credit')");await rebates.rebuildAccruals(e);assert.equal((await rebates.progress(e)).rows[0].earned,'58000');assert.equal(rows(c,"SELECT accrued_cents::VARCHAR r FROM rebate_accruals WHERE line_id=2")[0].r,'-1000');
  c.query('UPDATE rebate_accruals SET accrued_cents=accrued_cents+1 WHERE line_id=1');assert.equal((await rebates.reconciliation(e)).valid,false);
 }finally{c.close();}
});
import {createStage,resetStage,validate,commitSql,removeChildrenSql,CODES,issueMessage} from '../lib/studio/load';
import {ROLE_FIELDS,type Settings} from '../lib/studio/formats';
import {sqlText as Q} from '../lib/spike/exact';
import {recheck,fixSetSql,dismissSql,fixGroups} from '../lib/studio/fixlater';
import {rebuildAggregates,findDifferences} from '../lib/margin/aggregate';
import {waterfall,math,drill} from '../lib/margin/views';
const settings:Settings={sheet:null,headerRow:0,headerDepth:1,delimiter:',',encoding:'utf-8',decimal:'dot',dateFormat:'YYYY-MM-DD'};
const file={ord:0,role:'rebate_agreement' as const,name:'synthetic-agreement.csv',bytes:1,fingerprint:'',alignment:ROLE_FIELDS.rebate_agreement.map((f,index)=>({field:f.name,index})),settings,keyed:true,headers:ROLE_FIELDS.rebate_agreement.map(f=>f.name),colOffset:0};
const agreement=(ref='N',from='0',to:string|null=null,extra:Record<string,string|null>={})=>({program_id:ref,party:'C',rate_percent:'2',threshold_amount:from,period_start:'2026-01-01',period_end:'2026-03-31',calculation_mode:'retroactive',to_amount:to,eligible_skus:null,excluded_skus:null,party_type:'customer',rebate_treatment:'replace',...extra});
async function stage(e:Engine,rs:ReturnType<typeof agreement>[],replaces:string|null=null,rate='1'){
 await resetStage(e);await createStage(e,'rebate_agreement');await e.conn.query(`INSERT INTO st_rebate_agreement VALUES ${rs.map((r,i)=>`(0,${i+2},${ROLE_FIELDS.rebate_agreement.map(f=>r[f.name as keyof typeof r]===null?'NULL':Q(r[f.name as keyof typeof r]!)).join(',')})`).join(',')}`);
 await validate(e,'rebate_agreement',[{...file,settings:{...settings,sourceCurrency:rate==='1'?'CAD':'USD',fxRate:rate}}],replaces);
}
async function commit(e:Engine,source='agreement'){
 await e.conn.query(`INSERT INTO source_files VALUES(${Q(source)},'synthetic-agreement.csv','customer_list',1,'2026-03-31');INSERT INTO source_kinds VALUES(${Q(source)},'rebate_agreement');
 CREATE TEMP TABLE studio_files AS SELECT 0 AS file_ord,${Q(source)} AS source_id,'synthetic-agreement.csv' AS name;
 CREATE TEMP TABLE studio_messages AS SELECT * FROM (VALUES ${CODES('rebate_agreement').map(code=>`(0,${Q(code)},${Q(code.split(':')[0])},${Q(issueMessage(code,settings))})`).join(',')}) v(file_ord,code,column_name,message);`);
 await e.conn.query(commitSql(new Set(['rebate_agreement'])));await rebates.rebuildAccruals(e);await resetStage(e);
}
test('7D-1 agreement loader validates full bands, explicit treatment, customer-only terms and FX without rounding rates',async()=>{
 const {c,e}=await fixture();try{
  await stage(e,[agreement('N','0','20000'),agreement('N','20000',null,{rate_percent:'3'})],null,'0.75');
  assert.deepEqual(rows(c,'SELECT err,threshold_cents::VARCHAR n,rate_percent::VARCHAR r FROM ty_rebate_agreement ORDER BY src_row'),[{err:null,n:'0',r:'2.000'},{err:null,n:'1500000',r:'3.000'}]);await commit(e);
  const p=(await rebates.programs(e))[0];assert.equal(p.tiers[1].from,'1500000');assert.equal(p.tiers[1].rate,'3.000');assert.equal(p.source,'agreement');assert.equal((await rebates.progress(e)).rows[0].earned,'88500');
  await assert.rejects(rebates.saveSql(e,{id:p.id,reference:'N',customer:'C',mode:'retroactive',treatment:'replace',from:p.from,to:p.to,eligible:'',excluded:'',enabled:true,tiers:[{from:'0',to:'',rate:'2'}]},'a'),/Terms belong/);await assert.rejects(rebates.removeSql(e,p.id),/Terms belong/);
  for(const extra of ([{calculation_mode:null},{rebate_treatment:null},{party_type:'supplier'},{rate_percent:'100.001'},{period_end:'2025-01-01'}] as Record<string,string|null>[])){
   await stage(e,[agreement('BAD','0','10000',extra),agreement('BAD','10000')]);const bad=rows(c,'SELECT err FROM ty_rebate_agreement');assert.ok(bad.every(r=>r.err),'A broken band must reject every band');
  }
  await stage(e,[agreement('OVERLAP')]);assert.equal(rows(c,'SELECT err FROM ty_rebate_agreement')[0].err,'program_id:overlap');
  await stage(e,[agreement('N')],'agreement');assert.equal(rows(c,'SELECT err FROM ty_rebate_agreement')[0].err,null,'Replacing its source ignores only its own program');
  await stage(e,[agreement('GAP','0','10000',{party:'OTHER'}),agreement('GAP','20000',null,{party:'OTHER'})]);assert.ok(rows(c,'SELECT err FROM ty_rebate_agreement').every(r=>!r.err),'Intentional tier gaps are permitted and earn zero in a gap');
 }finally{await resetStage(e);c.close();}
});
test('7D-1 Fix Later repairs the whole rejected cohort; dismissed bands cannot silently activate a partial agreement',async()=>{
 const {c,e}=await fixture();try{
  await stage(e,[agreement('FIX','0','20000',{calculation_mode:null}),agreement('FIX','20000')]);await commit(e,'fix');assert.equal((await rebates.programs(e)).length,0);
  await e.conn.query("INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at,source_currency,workspace_currency,fx_rate) VALUES('b','fix',0,2,'2026-03-31','CAD','CAD','1')");
  const g=await fixGroups(e);assert.ok(g.some(x=>x.code==='calculation_mode:invalid'));await e.conn.query((await fixSetSql(e,'fix','calculation_mode:invalid','calculation_mode','retroactive',null)).sql);
  const out=await recheck(e,'fix','calculation_mode:invalid','professional');assert.equal(out.loaded,'2');assert.equal((await rebates.programs(e)).length,1);assert.equal((await rebates.progress(e)).rows[0].earned,'59000');
  await stage(e,[agreement('PART','0','20000',{party:'D',calculation_mode:null}),agreement('PART','20000',null,{party:'D'})]);await commit(e,'part');
  await e.conn.query("INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at) VALUES('b2','part',0,2,'2026-03-31')");await e.conn.query(dismissSql('part','calculation_mode:invalid',null));
  assert.equal((await recheck(e,'part','program_id:incomplete','professional')).loaded,'0');assert.equal((await rebates.programs(e)).length,1);
 }finally{await resetStage(e);c.close();}
});
test('7D-1 recognized rebates feed waterfall, math, drill and reconciliation; removal/rollback preserves imported facts',async()=>{
 const {c,e}=await fixture();try{
  await stage(e,[agreement()]);await commit(e);await rebuildAggregates(e);
  const w=await waterfall(e);assert.equal(w.sales.rebate,'59000');assert.equal(w.rebateReconciliation?.valid,true);assert.equal(w.netPocket,'2891000');
  const m=await math(e,'rebate');assert.equal(m.value,'59000');assert.equal(m.rows[0].contribution,'59000');assert.equal(m.check.agrees,true);assert.equal(m.rowsAgree,true);assert.equal((await drill(e,'product')).rows[0].rebate,'59000');assert.equal((await findDifferences(e)).found.length,0);
  c.query('BEGIN');c.query(removeChildrenSql('agreement',true));await rebates.rebuildAccruals(e);assert.equal(rows(c,'SELECT rebate_cents::VARCHAR r FROM rebate_sales')[0].r,'35000');c.query('ROLLBACK');assert.equal((await rebates.programs(e)).length,1);
  c.query(removeChildrenSql('sales',true));await rebates.rebuildAccruals(e);assert.equal((await rebates.progress(e)).rows[0].earned,'0');
  c.query(removeChildrenSql('agreement',true));await rebates.rebuildAccruals(e);assert.equal((await rebates.programs(e)).length,0);assert.equal(rows(c,'SELECT count(*)::VARCHAR n FROM rebate_tiers')[0].n,'0');assert.equal(rows(c,'SELECT count(*)::VARCHAR n FROM rebate_accruals')[0].n,'0');
 }finally{c.close();}
});
test('7D-1 eligibility, period edges, tie-cent allocation, negative net spend, paused and manual removal',async()=>{
 const {c,e}=await fixture();try{
  const input={reference:'exact',customer:'C',mode:'retroactive' as const,treatment:'replace' as const,from:'2026-03-31',to:'2026-03-31',eligible:'A|B',excluded:'B',enabled:true,tiers:[{from:'0',to:'',rate:'50'}]};
  c.query("UPDATE sales_lines SET list_cents=1,rebate_cents=0; INSERT INTO products(product_id) VALUES('B'); INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) VALUES('sales',2,'A','C','2026-03-31',1,1,0,0,0,0,3),('sales',3,'B','C','2026-03-31',1,99999,0,0,0,0,4),('sales',4,'A','C','2026-04-01',1,99999,0,0,0,0,5)");
  const p=await rebates.saveSql(e,input,'actor');c.query(p.sql);await rebates.rebuildAccruals(e);assert.deepEqual(rows(c,'SELECT line_id::VARCHAR l,accrued_cents::VARCHAR n FROM rebate_accruals ORDER BY line_id'),[{l:'1',n:'1'},{l:'2',n:'0'}]);assert.equal((await rebates.evidence(e,p.id)).count,'2');
  c.query("UPDATE sales_lines SET list_cents=-10,quantity=-1,cost_cents=-cost_cents,line_kind='credit' WHERE line_id=1");await rebates.rebuildAccruals(e);assert.equal((await rebates.progress(e)).rows[0].earned,'0');
  c.query("UPDATE rebate_programs SET enabled=false");await rebates.rebuildAccruals(e);assert.equal((await rebates.reconciliation(e)).recognized,'0');c.query(await rebates.removeSql(e,p.id));assert.equal((await rebates.programs(e)).length,0);
 }finally{c.close();}
});
import {plan as cleanupPlan} from '../lib/cleanup/item-master';
test('7D-1 app-open reminder uses the next threshold and UTC period end; SKU merges cannot change agreement eligibility',async()=>{
 const {c,e}=await fixture();try{
  const today=new Date().toISOString().slice(0,10),input={reference:'REMINDER',customer:'C',mode:'retroactive' as const,treatment:'additional' as const,from:today,to:today,eligible:'A',excluded:'',enabled:true,tiers:[{from:'5000',to:'',rate:'4'}]};const p=await rebates.saveSql(e,input,'actor');c.query(p.sql);await rebates.rebuildAccruals(e);
  let progress=(await rebates.progress(e)).rows[0];assert.equal(progress.remaining,'500000');assert.equal(progress.nextRate,'4.000');assert.equal(progress.reminder,true);
  c.query("UPDATE rebate_programs SET enabled=false");await rebates.rebuildAccruals(e);progress=(await rebates.progress(e)).rows[0];assert.equal(progress.reminder,false);
  c.query("INSERT INTO products(product_id) VALUES('a')");await assert.rejects(cleanupPlan(e,'merge_duplicates','A',null,'actor','2026-11-08'),/agreement inclusion/);
 }finally{c.close();}
});
