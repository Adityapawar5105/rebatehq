import test from 'node:test';
import assert from 'node:assert/strict';
import {duckdbConnection,rows as read} from './helpers/duckdb-node';
import {schemaSql,tablesFor,SCHEMA_VERSION} from '../lib/vault/schema';
import {bridge} from '../lib/margin/bridge';
import * as ops from '../lib/pricing/ops';
import {preview,approveSql,exportPrices,guardSql} from '../lib/pricing/rules';
import {pricePoint} from '../lib/quotes/quotes';
import {REBUILD_SQL} from '../lib/margin/aggregate';
import type {Engine} from '../lib/vault/engine';
import {VaultService} from '../lib/vault/service';
import {dispatch} from '../lib/vault/dispatch';
import {VaultError,type Request} from '../lib/vault/protocol';
async function fixture(){
 const c=await duckdbConnection();for(const t of [...tablesFor(SCHEMA_VERSION)].reverse())c.query(`DROP TABLE IF EXISTS ${t}`);c.query(schemaSql(SCHEMA_VERSION));
 c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip',0);
 INSERT INTO pricing_settings VALUES(1,'owner','Pricing Owner',7);
 INSERT INTO products(product_id,category,current_cost,list_price) VALUES('A','Parts',600,1000),('B','Parts',1000,2000);
 INSERT INTO customers(customer_id,name,tier,branch) VALUES('C','Customer','T','West'),('D','Other','T','East');
 INSERT INTO source_files VALUES('src','private-source.csv','sales_history',1,'2026-01-01');
 INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id)
 VALUES('src',1,'A','C','2026-01-01',10,10000,0,0,0,6000,2,'I1'),('src',2,'B','C','2026-01-01',10,20000,0,0,0,10000,3,'I2'),('src',3,'A','C','2026-02-01',20,24000,0,0,0,14000,4,'I3'),('src',4,'B','C','2026-02-01',10,21000,0,0,0,11000,5,'I4');
 ${REBUILD_SQL}`);
 const e={conn:{query:async(sql:string)=>c.query(sql)}} as unknown as Engine;return {c,e};
}
test('7C-1 bridge golden: price + volume + mix + cost equals the exact pocket-margin change, with reconciling product/customer/branch drill',async()=>{
 const {c,e}=await fixture();try{
  for(const dim of ['product','customer','branch'] as const){const v=await bridge(e,{month:'2026-02',dim});assert.deepEqual(v.totals,{before:'14000',after:'20000',delta:'6000',price:'5000',volume:'7000',mix:'-3000',cost:'-3000',unknown:'0'});
   for(const key of ['before','after','delta','price','volume','mix','cost'] as const)assert.equal(v.rows.reduce((a,r)=>a+BigInt(r[key]),BigInt(0)).toString(),v.totals[key]);
  }
  assert.equal((await bridge(e,{month:'2026-02',dim:'product',value:'A'})).totals.delta,'6000');
  const empty=await bridge(e,{month:'2026-01'});assert.equal(empty.totals.before,'0');assert.equal(empty.totals.mix,empty.totals.delta);
  await assert.rejects(bridge(e,{month:'not-a-month'}));await assert.rejects(bridge(e,{dim:'sql' as any}));
  c.query("UPDATE customers SET branch='' WHERE customer_id='C'");const unknown=await bridge(e,{month:'2026-02',dim:'branch',value:''});assert.equal(unknown.count,'1');assert.equal(unknown.totals.delta,'6000');
 }finally{c.close();}
});
test('7C-1 bridge includes signed credits, excludes unknown cost, handles zero net units and fractional-quantity rounding',async()=>{
 const {c,e}=await fixture();try{
  c.query("UPDATE sales_lines SET quantity=0.0003 WHERE line_id=1;UPDATE sales_lines SET quantity=0.0007 WHERE line_id=3;UPDATE sales_lines SET cost_cents=NULL WHERE line_id=4;");
  c.query("INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id,line_kind) VALUES('src',5,'B','C','2026-01-01',-10,-20000,0,0,0,-10000,6,'CR1','credit')");
  const v=await bridge(e,{month:'2026-02'});assert.equal(v.totals.unknown,'1');assert.equal(v.totals.before,'4000');assert.equal(v.totals.after,'10000');
  assert.equal(BigInt(v.totals.price)+BigInt(v.totals.volume)+BigInt(v.totals.mix)+BigInt(v.totals.cost),BigInt(v.totals.delta));
 }finally{c.close();}
});
test('7C-1 planner, historical versions and reversal reuse owner approval, current guardrails, conflict checks and ERP export',async()=>{
 const {c,e}=await fixture();try{
  const run=await ops.planDraft(e,{segment:'tier',value:'T',increase:'10'},'manager');let p=await preview(e,run);assert.equal(p.count,'2');assert.equal(p.impact,'7000');assert.equal(read(c,'SELECT count(*) n FROM price_matrix')[0].n,'0');
  await assert.rejects(approveSql(e,run,'manager',await ops.approvalMatrixSql(e,run)),/Pricing Owner/);await assert.rejects(exportPrices(e,run,'generic','csv'),/approve/);
  c.query(await approveSql(e,run,'owner',await ops.approvalMatrixSql(e,run)));assert.equal((await pricePoint(e,'A','C','1')).bookCents,'1100');
  const next=await ops.planDraft(e,{segment:'category',value:'Parts',increase:'10'},'manager');c.query(await approveSql(e,next,'owner',await ops.approvalMatrixSql(e,next)));assert.equal((await pricePoint(e,'A','C','1')).bookCents,'1210');
  const versions=await ops.opsState(e),v=versions.versions.find(v=>v.run===next)!;const rollback=await ops.rollbackDraft(e,v.id,'manager');assert.equal((await pricePoint(e,'A','C','1')).bookCents,'1210');
  c.query(await approveSql(e,rollback,'owner',await ops.approvalMatrixSql(e,rollback)));assert.equal((await pricePoint(e,'A','C','1')).bookCents,'1100');assert.equal(read(c,'SELECT count(*) n FROM price_versions')[0].n,'3');
  assert.ok((await exportPrices(e,rollback,'generic','csv')).blob.size>0);
  await assert.rejects(ops.rollbackDraft(e,v.id,'manager'),/changed/);
  const stale=await ops.planDraft(e,{segment:'tier',value:'T',increase:'5'},'manager');c.query(guardSql({tier:'T',category:'Parts',start:'2000',target:'1700',floor:'1500'}));await assert.rejects(approveSql(e,stale,'owner',await ops.approvalMatrixSql(e,stale)),/Conflict/);
  const blocked=await ops.planDraft(e,{segment:'tier',value:'T',increase:'5'},'manager');assert.notEqual((await preview(e,blocked)).red,'0');await assert.rejects(approveSql(e,blocked,'owner',await ops.approvalMatrixSql(e,blocked)),/Red/);
 }finally{c.close();}
});
test('7C-1 customer plans preserve scope and contract end, leave quantity breaks alone, and produce localized cost-free letters',async()=>{
 const {c,e}=await fixture();try{
  c.query("INSERT INTO price_matrix(id,product_id,customer_id,qty_break,price,valid_from,valid_to) VALUES('contract','A','C',0,900,'2025-01-01','2028-01-01'),('break','A','C',10,800,'2025-01-01','2028-01-01')");
  const run=await ops.planDraft(e,{segment:'customer',value:'C',increase:'5'},'manager');assert.equal(await ops.exportCustomer(e,run),'C');
  assert.equal((await preview(e,run)).rows.find(r=>r.product==='A')!.quantity,'0.0000','unchanged quantity-break sales contribute no estimated uplift');
  const tierRun=await ops.planDraft(e,{segment:'tier',value:'T',increase:'5'},'manager');assert.equal((await preview(e,tierRun)).rows.find(r=>r.product==='A')!.quantity,'0.0000','a tier increase does not claim uplift on customer contracts');
  const text=await (await ops.increaseLetter(e,run,'fr')).blob.text();assert.match(text,/hausse de 5/);assert.ok(!text.includes('600')&&!text.includes('1000'));assert.ok(!(await (await ops.increaseLetter(e,run,'es')).blob.text()).includes('Subject:'));
  c.query(await approveSql(e,run,'owner',await ops.approvalMatrixSql(e,run)));assert.equal((await pricePoint(e,'A','C','1')).bookCents,'945');assert.equal((await pricePoint(e,'A','D','1')).bookCents,'1000');assert.equal((await pricePoint(e,'A','C','10')).bookCents,'800');
  assert.equal(read(c,"SELECT valid_to::VARCHAR ends FROM price_matrix WHERE price=945")[0].ends,'2028-01-01');
  await assert.rejects(exportPrices(e,run,'netsuite','csv',await ops.exportCustomer(e,run)),/customer_id/);
  assert.match(await (await exportPrices(e,run,'generic','csv',await ops.exportCustomer(e,run))).blob.text(),/customer_id/);
  const version=(await ops.opsState(e)).versions.find(v=>v.run===run)!;
  const reversed=await ops.rollbackDraft(e,version.id,'manager');assert.equal((await preview(e,reversed)).rows.find(r=>r.product==='A')!.before,'945','reversal resolves the base price, not a quantity-break price');
  c.query(await approveSql(e,reversed,'owner',await ops.approvalMatrixSql(e,reversed)));assert.equal((await pricePoint(e,'A','C','1')).bookCents,'900');assert.equal((await pricePoint(e,'A','C','10')).bookCents,'800');
  await assert.rejects(ops.planDraft(e,{segment:'tier',value:'T',increase:'=1+2'},'manager'));await assert.rejects(ops.planDraft(e,{segment:'customer',value:'unknown',increase:'5'},'manager'));
 }finally{c.close();}
});
test('7C-1 exceptions honor invoice dates and breaks, avoid double counting floor/contract gaps, and expiry includes exact 30/60/90-day edges',async()=>{
 const {c,e}=await fixture();try{
  c.query(guardSql({tier:'T',category:'Parts',floor:'1100',target:'1200',start:'1300'}));c.query("INSERT INTO price_matrix(id,product_id,customer_id,qty_break,price,valid_from,valid_to) VALUES('old','A','C',0,1300,'2026-01-01','2026-02-01'),('new','A','C',0,900,'2026-02-01','2027-01-01'),('qb','A','C',20,1250,'2026-02-01','2027-01-01')");
  const report=await ops.exceptions(e,{product:'A'});assert.equal(report.total.count,'2');assert.equal(report.total.gap,'4000');assert.equal(report.rows.find(r=>r.line_id==='1')!.contract_id,'old');assert.equal(report.rows.find(r=>r.line_id==='3')!.contract_id,'qb');assert.equal(report.rows[0].source_file,'private-source.csv');
  assert.equal(report.rows.find(r=>r.line_id==='1')!.unit_price,'1000');
  c.query("UPDATE sales_lines SET freight_cents=12000,rebate_cents=2000 WHERE product_id='B'");
  assert.equal((await ops.exceptions(e,{product:'B'})).total.count,'0','freight and off-invoice rebates cannot invent an invoice-price exception');
  c.query("DELETE FROM price_matrix;INSERT INTO price_matrix(id,product_id,price,valid_from,valid_to) SELECT 'd'||d,'A',100,'2026-01-01',DATE '2026-11-01'+d::INTEGER FROM (VALUES (0),(30),(31),(60),(61),(90),(91))x(d)");
  for(const [days,n] of [[30,2],[60,4],[90,6]])assert.equal((await ops.expiry(e,days,'2026-11-01')).count,String(n));await assert.rejects(ops.expiry(e,45));await assert.rejects(ops.expiry(e,30,'not-a-date'));
 }finally{c.close();}
});

test('7C-1 worker boundary refuses Starter access (including saved ops drafts) and every new command is forbidden to a Sales Rep',async()=>{
 const {c,e}=await fixture();try{
  c.query("INSERT INTO role_assignments VALUES('owner','Owner','owner','owner','2026-01-01'),('rep','Rep','sales_rep','owner','2026-01-01')");
  const calls=[['marginBridge',{}],['priceOpsState',{}],['priceExceptions',{}],['priceExpiry',{days:30}],['pricePlan',{input:{segment:'category',value:'Parts',increase:'5'}}],['priceRollback',{version:'not-a-version'}],['priceLetter',{id:'ops-saved',locale:'en'}]] as const;
  const make=(userId:string,tier:'starter'|'professional')=>{
   const s=new VaultService(()=>undefined);s.engine=e;Object.assign(s,{identity:{userId,tenantId:'unit'}});
   const now=Math.floor(Date.now()/1000);s.licence.claims={v:1,sub:userId,workspace:'unit',device:'test',tier,state:'active',issued:now,expires:now+3600,offlineUntil:now+86400,reason:''};return s;
  };
  const call=(s:VaultService,action:string,data:unknown)=>dispatch(s,{id:'boundary',action,data} as Request,{signal:()=>new AbortController().signal,progress:()=>undefined});
  for(const [action,data] of calls){
   await assert.rejects(call(make('owner','starter'),action,data),(e:unknown)=>e instanceof VaultError&&e.code==='LICENCE',action+' Starter gate');
   await assert.rejects(call(make('rep','professional'),action,data),(e:unknown)=>e instanceof VaultError&&e.code==='FORBIDDEN',action+' rep gate');
  }
  for(const action of ['rulePreview','ruleApprove','priceExport'])await assert.rejects(call(make('owner','starter'),action,{id:'ops-saved',profile:'generic',format:'csv'}),(e:unknown)=>e instanceof VaultError&&e.code==='LICENCE',action+' downgrade gate');
  const owner=make('owner','professional');Object.assign(owner,{writable:async()=>e,save:async()=>undefined,touch:()=>undefined});
  const planned=await call(owner,'pricePlan',{input:{segment:'category',value:'Parts',increase:'5'}}) as {id:string};
  assert.equal(read(c,"SELECT action FROM audit_log ORDER BY sequence DESC LIMIT 1")[0].action,'pricing.plan_drafted');
  assert.equal(JSON.parse(String(read(c,"SELECT details FROM audit_log ORDER BY sequence DESC LIMIT 1")[0].details)).run_id,planned.id);
 }finally{c.close();}
});

test('7C-1 populated book: category and 20k-pair tier plans fit the production 512 MiB budget without expanding unrelated prices',async()=>{
 const {c,e}=await fixture();try{
  c.query("SET memory_limit='512MB';SET temp_directory='';INSERT INTO products(product_id,category,current_cost,list_price) SELECT 'P'||i,'Other',600,1000 FROM range(20000)t(i);INSERT INTO customers(customer_id,tier) SELECT 'C'||i,'T' FROM range(2000)t(i);INSERT INTO price_matrix(id,product_id,price,valid_from) SELECT 'M'||i,'P'||i,1000,'2025-01-01' FROM range(20000)t(i);INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row) SELECT 'src',i+10,'P'||(i%20000),'C'||(i%2000),'2026-02-01',1,1000,0,0,0,600,i+10 FROM range(100000)t(i)");
  const narrow=await ops.planDraft(e,{segment:'category',value:'Parts',increase:'5'},'manager');assert.equal((await preview(e,narrow)).count,'2');
  const wide=await ops.planDraft(e,{segment:'tier',value:'T',increase:'5'},'manager');const p=await preview(e,wide);assert.equal(p.count,'20002');assert.equal(p.impact,'5003500');
  c.query(await approveSql(e,wide,'owner',await ops.approvalMatrixSql(e,wide)));
  const version=(await ops.opsState(e)).versions[0];const reversed=await ops.rollbackDraft(e,version.id,'manager');assert.equal((await preview(e,reversed)).impact,'-5003500');
 }finally{c.query("SET memory_limit='512MB'");c.close();}
});
