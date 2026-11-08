import test from 'node:test';
import assert from 'node:assert/strict';
import {duckdbConnection} from './helpers/duckdb-node';
import {schemaSql,TABLES,SCHEMA_VERSION} from '../lib/vault/schema';
import {customerHealth,monitoringWindow} from '../lib/margin/monitor';
import {alternatives} from '../lib/pricing/alternatives';
import {findLeaks} from '../lib/margin/leaks';
import {REBUILD_SQL} from '../lib/margin/aggregate';
import {syncStatus} from '../lib/relay/sync-status';
import {VaultService} from '../lib/vault/service';
import type {Engine} from '../lib/vault/engine';
async function fixture(){
 const c=await duckdbConnection();for(const t of [...TABLES].reverse())c.query('DROP TABLE IF EXISTS '+t);c.query(schemaSql(SCHEMA_VERSION));
 c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,currency) VALUES(1,${SCHEMA_VERSION},'professional','unit','tip','CAD');
 INSERT INTO source_files VALUES('src','synthetic.csv','sales_history',1,'2026-01-01');
 INSERT INTO products(product_id,category,list_price) VALUES('P','Parts',10000),('Q','Parts',2000),('R','Parts',2000),('S','Parts',2100),('T','Parts',5000),('U','Other',999999);
 INSERT INTO customers(customer_id,name,tier) VALUES('A','Customer A','T'),('B','Customer B','T'),('C','Customer C','T'),('D','Customer D','T');`);
 let id=0;function line(customer:string,date:string,cost:number|null=5000,discount=0,product='P',invoice?:string){id++;c.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('src',${id},'${product}','${customer}','${date}',1,10000,${discount},0,0,${cost===null?'NULL':cost},${id+1},'${invoice??'I'+id}')`);}
 return {c,e:{conn:{query:async(s:string)=>c.query(s)}} as unknown as Engine,line};
}
test('7C-3b exact rolling windows, full-month rollups plus boundaries, strict threshold, frequency AND discount and incomplete costs',async()=>{
 const {c,e,line}=await fixture();try{
  const w=monitoringWindow('2026-11-08');assert.deepEqual(w,{priorFrom:'2026-05-13',from:'2026-08-11',to:'2026-11-09'});
  for(const d of [w.priorFrom,'2026-07-01','2026-08-10'])line('A',d);line('A',w.from,5501);line('A','2026-05-12',1);line('A',w.to,1);
  line('B',w.priorFrom);line('B',w.from,5500);
  line('C',w.priorFrom,5000,0,'P','ONE');line('C',w.priorFrom,5000,0,'P','ONE');line('C','2026-06-01',5000);line('C',w.from,4500,1000);
  line('D',w.priorFrom);line('D',w.from,null);c.query(REBUILD_SQL);
  const h=await customerHealth(e,'500','2026-11-08');assert.deepEqual(h.alerts.map(a=>a.customer),['A','C']);
  const a=h.alerts[0];assert.equal(a.marginDrop,true);assert.equal(a.frequencyDrop,false);assert.equal(a.before.lines,'3');assert.equal(a.after.lines,'1');assert.equal(a.before.pocket,'30000');assert.equal(a.after.rate,'4499');
  const f=h.alerts[1];assert.equal(f.frequencyDrop,true);assert.equal(f.before.orders,'2');assert.equal(f.after.orders,'1');assert.equal(f.before.discountBp,'0');assert.equal(f.after.discountBp,'1000');
  assert.equal((await customerHealth(e,'499','2026-11-08')).alerts.some(x=>x.customer==='B'),true);
  assert.equal((await customerHealth(e,'501','2026-11-08')).alerts.some(x=>x.customer==='A'),false);
  c.query("UPDATE sales_lines SET invoice_id=NULL WHERE customer_id='C'");const missing=await customerHealth(e,'500','2026-11-08');assert.equal(missing.missingInvoiceIds,'4');assert.equal(missing.alerts.find(x=>x.customer==='C')?.before.orders,'3');
  await assert.rejects(customerHealth(e,'-1'));await assert.rejects(customerHealth(e,'10001'));await assert.rejects(customerHealth(e,'500 OR true'));
  c.query("UPDATE sales_lines SET discount_cents=0 WHERE customer_id='C'");c.query(REBUILD_SQL);assert.equal((await customerHealth(e,'500','2026-11-08')).alerts.some(a=>a.customer==='C'),false);
 }finally{c.close();}
});
test('7C-3b alternatives resolve current customer matrix, rank exact per-unit pocket margin and stable SKU ties; omit missing history/cost',async()=>{
 const {c,e,line}=await fixture();try{
  for(const p of ['Q','R','S','U'])line('A','2026-10-01',1000,0,p);
  line('A','2026-10-01',null,0,'T');line('B','2026-10-01',1,0,'T');
  c.query(`INSERT INTO price_matrix(id,product_id,customer_id,qty_break,price,valid_from) VALUES('contract','Q','A',0,2200,'2026-01-01');${REBUILD_SQL}`);
  let a=await alternatives(e,'P','A','2026-11-08');assert.deepEqual(a.map(x=>[x.product,x.price,x.margin]),[['Q','2200','1200'],['S','2100','1100'],['R','2000','1000']]);
  c.query("UPDATE price_matrix SET price=2000 WHERE id='contract';UPDATE products SET list_price=2000 WHERE product_id='S'");
  a=await alternatives(e,'P','A','2026-11-08');assert.deepEqual(a.map(x=>x.product),['Q','R','S']);
  line('A','2026-11-09',99999999,0,'Q');c.query(REBUILD_SQL);assert.equal((await alternatives(e,'P','A','2026-11-08'))[0].cost,'1000','Future current-month costs must not contaminate history');
  c.query("UPDATE sales_lines SET quantity=3,freight_cents=1,rebate_cents=1,cost_cents=1000 WHERE product_id='Q'");c.query(REBUILD_SQL);
  a=await alternatives(e,'P','A','2026-11-08');assert.equal(a[0].cost,'333');assert.equal(a[0].freight,'0');assert.equal(a[0].rebate,'0');assert.equal(a[0].margin,'1667');
  assert.deepEqual(await alternatives(e,'P','missing','2026-11-08'),[]);
 }finally{c.close();}
});
test('7C-3b cash-leak hero is the unchanged finder scoped to exact 90-day input, in CAD; full finder cache is invalidated',async()=>{
 const {c,e,line}=await fixture();try{
  const w=monitoringWindow();line('A',w.from,11000);line('B',w.priorFrom,50000);line('B',w.to,90000);c.query(REBUILD_SQL);
  const expected=await findLeaks(e,true,w);assert.equal(expected.checked.saleLines,'1');assert.equal(expected.dedupedCents,'1000');
  c.query('BEGIN');c.query(`CREATE TEMP TABLE saved_sales AS SELECT * FROM sales_lines;DELETE FROM sales_lines WHERE sale_date<DATE '${w.from}' OR sale_date>=DATE '${w.to}';${REBUILD_SQL}`);
  const standalone=await findLeaks(e,true);assert.deepEqual(standalone.findings,expected.findings);assert.equal(standalone.dedupedCents,expected.dedupedCents);c.query('ROLLBACK');
  const s=new VaultService(()=>undefined);Object.assign(s,{engine:e,licence:{tier:'professional'},leakCache:{version:1}});
  const v=await s.homeMonitor();assert.equal(v.currency,'CAD');assert.equal(v.leaks.dedupedCents,expected.dedupedCents);assert.equal((s as any).leakCache,null);
  assert.equal((await findLeaks(e,true)).checked.saleLines,'3');
 }finally{c.close();}
});
test('7C-3b relay sync presentation covers synced, pending, stale head, conflicting outbox, rejected content and no successful sync',()=>{
 const base={head:{sequence:'5',hash:'a'},remote:{sequence:'5',hash:'a'},pending:null,pendingEpoch:false,rejected:0,lastSyncedAt:'2026-11-08T00:00:00Z'};
 assert.equal(syncStatus(base).status,'synced');assert.equal(syncStatus({...base,lastSyncedAt:undefined}).lastSyncedAt,null);assert.equal(syncStatus({...base,lastSyncedAt:undefined}).status,'pending');
 assert.equal(syncStatus({...base,pending:{sequence:'6',previousHash:'a'}}).status,'pending');assert.equal(syncStatus({...base,pendingEpoch:true}).status,'pending');
 assert.equal(syncStatus({...base,remote:{sequence:'6',hash:'b'}}).status,'pending');
 assert.equal(syncStatus({...base,remote:{sequence:'5',hash:'fork'}}).status,'conflict');
 assert.equal(syncStatus({...base,pending:{sequence:'5',previousHash:'old'}}).status,'conflict');assert.equal(syncStatus({...base,pending:{sequence:'6',previousHash:'old'}}).status,'conflict');assert.equal(syncStatus({...base,rejected:1}).status,'conflict');
});
