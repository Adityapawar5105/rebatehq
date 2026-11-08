import {basisPointsDecimal} from '../lib/margin/decimal';
import test from 'node:test';
import assert from 'node:assert/strict';
import {duckdbConnection,rows} from './helpers/duckdb-node';
import {schemaSql,TABLES,SCHEMA_VERSION} from '../lib/vault/schema';
import type {Engine} from '../lib/vault/engine';
import * as grid from '../lib/pricing/grid';
import * as market from '../lib/pricing/market';
import {whatIf} from '../lib/pricing/whatif';
import {approveSql,preview,guardSql,ruleSql,simulate} from '../lib/pricing/rules';
import {REBUILD_SQL} from '../lib/margin/aggregate';
import {findLeaks,leakRows,hitRows} from '../lib/margin/leaks';
import {serviceOrders,serviceFlagSql} from '../lib/margin/service-cost';
import {VaultService} from '../lib/vault/service';
import {dispatch} from '../lib/vault/dispatch';
import {VaultError,type Request} from '../lib/vault/protocol';
import * as XLSX from 'xlsx';
async function fixture(){const c=await duckdbConnection();c.query('SET autoinstall_known_extensions=false;SET autoload_known_extensions=false');for(const t of [...TABLES].reverse())c.query('DROP TABLE IF EXISTS '+t);c.query(schemaSql(SCHEMA_VERSION));
 c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${SCHEMA_VERSION},'professional','test','tip',0);INSERT INTO pricing_settings VALUES(1,'owner','Owner',7);
 INSERT INTO products(product_id,category,current_cost,list_price) VALUES('A','Parts',600,1000),('B','Parts',500,2000);INSERT INTO customers(customer_id,tier) VALUES('C','T'),('D','T');
 INSERT INTO price_matrix(id,product_id,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES('base','A',NULL,'T',0,1100,'2020-01-01',NULL),('contract','A','C',NULL,10,900,'2020-01-01','2030-01-01');
 INSERT INTO source_files VALUES('src','private.csv','sales_history',1,'2026-01-01');INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('src',1,'A','C','2026-01-01',10,10000,0,0,0,6000,2,'I1'),('src',2,'B','D','2026-01-01',2,4000,0,0,0,1000,3,'I2');${REBUILD_SQL}`);
 return {c,e:{conn:{query:async(s:string)=>c.query(s)}} as unknown as Engine};}
async function approve(e:Engine,id:string){const p=await grid.gridPreview(e,id,'professional');await e.conn.query(await approveSql(e,id,'owner',await grid.gridApproval(e,id,'professional'),p));return p;}
test('7C-2 paste accepts exact cents and rejects formulas, signs, grouping, blank cells, multiple columns and overflow',()=>{
 assert.deepEqual(grid.pastedPrices('1.01\r\n0\r\n',['a','b'],0),[{key:'a',price:'1.01'},{key:'b',price:'0'}]);
 for(const text of ['=1+1','+1','-1','@SUM(A1)','1,000','1.001','1\t2','',' 1','1\n\n2'])assert.throws(()=>grid.pastedPrices(text,['a','b','c'],0),VaultError,text);
 assert.throws(()=>grid.pastedPrices('1\n2',['a'],0),VaultError);
});
test('7C-2 grid keeps complete scopes, estimates only currently resolved units, and changes live prices only after owner approval',async()=>{const {c,e}=await fixture();try{
 c.query(guardSql({tier:'T',category:'Parts',start:'1400',target:'1000',floor:'800'}));
 c.query("UPDATE price_matrix SET category='Tagged',tier='' WHERE id='contract'");const state=await grid.gridRows(e,true);assert.equal(state.count,'4');
 const id=await grid.gridDraft(e,[{key:'m:contract',price:'9.50'},{key:'l:B',price:'21.00'}],state.revision,'manager','professional');
 assert.equal(rows(c,"SELECT price::VARCHAR p FROM price_matrix WHERE id='contract'")[0].p,'900');
 const p=await grid.gridPreview(e,id,'professional');assert.equal(p.impact,'700');assert.equal(p.rows[0].quantity,'10.0000');assert.equal(p.rows[0].scope!.to,'2030-01-01');
 await assert.rejects(approveSql(e,id,'manager',await grid.gridApproval(e,id,'professional'),p));
 await approve(e,id);assert.equal(rows(c,"SELECT list_price::VARCHAR p FROM products WHERE product_id='B'")[0].p,'2100');
 const data=await grid.gridData(e,id,'professional');const changed=rows(c,`SELECT customer_id,tier,category,qty_break::VARCHAR q,price::VARCHAR p,valid_to::VARCHAR d FROM price_matrix WHERE id='${data[0].appliedKey.slice(2)}'`)[0];assert.deepEqual(changed,{customer_id:'C',tier:'',category:'Tagged',q:'10.0000',p:'950',d:'2030-01-01'});
 const file=await market.gridExport(e,id,'generic','csv','professional',await grid.gridPreview(e,id,'professional'));const rec=await market.exportReceipt(e,id,'generic','professional');assert.ok((await file.blob.text()).includes('price_kind'));assert.equal(rec.rows[0].quantity,'10.0000');await assert.rejects(market.gridExport(e,id,'p21','csv','professional',p));
 c.query(await market.receiptSql(id,'generic',file.blob,rec));const verified=await market.landedFile(new File([file.blob],'erp.csv'),rec);assert.ok(verified.every(r=>r.status==='applied'));
 const version=String(rows(c,'SELECT id FROM price_versions')[0].id);c.query(`UPDATE price_matrix SET customer_id='D' WHERE id='${data[0].appliedKey.slice(2)}'`);await assert.rejects(grid.gridRollback(e,version,'owner','professional'));c.query(`UPDATE price_matrix SET customer_id='C' WHERE id='${data[0].appliedKey.slice(2)}'`);const reverse=await grid.gridRollback(e,version,'owner','professional');assert.ok(reverse);await approve(e,reverse!);assert.equal(rows(c,"SELECT list_price::VARCHAR p FROM products WHERE product_id='B'")[0].p,'2000');
 }finally{c.close();}});
test('7C-2 Starter basic grid, red guard, revision conflicts and advanced-draft downgrade checks cannot bypass approval',async()=>{const {c,e}=await fixture();try{
 assert.equal((await grid.gridRows(e,false)).count,'2');await assert.rejects(grid.gridDraft(e,[{key:'m:base',price:'12'}],'0','owner','starter'));
 c.query(guardSql({tier:'T',category:'Parts',start:'1400',target:'1000',floor:'800'}));const state=await grid.gridRows(e,true);
 const red=await grid.gridDraft(e,[{key:'l:A',price:'1.00'}],state.revision,'owner','starter');await assert.rejects(approve(e,red));
 const advanced=await grid.gridDraft(e,[{key:'m:base',price:'12.00'}],state.revision,'owner','professional');await assert.rejects(grid.gridPreview(e,advanced,'starter'));
 c.query('UPDATE vault_meta SET pricing_revision=pricing_revision+1');await assert.rejects(approve(e,advanced));await assert.rejects(grid.gridDraft(e,[{key:'l:A',price:'12'}],state.revision,'owner','professional'));
 }finally{c.close();}});
test('7C-2 competitor observations use exact cents, safe literal source notes and current customer price',async()=>{const {c,e}=await fixture();try{
 c.query(await market.competitorSql(e,{product:'A',competitor:"O'Neil",price:'9.01',date:'2026-11-07',source:'https://example.test/<script>literal</script>'},'owner'));
 const view=await market.competitors(e,'A','C');assert.equal(view.rows[0].price,'901');assert.equal(view.own!.bookCents,'1100');assert.equal(view.rows[0].competitor,"O'Neil");
 await assert.rejects(market.competitorSql(e,{product:'missing',competitor:'X',price:'1',date:'bad',source:'note'},'owner'));
 }finally{c.close();}});
test('7C-2 landed diff preserves quantity, customer, tier, dates and kind; rejects ambiguous files and detects missing, duplicate and changed prices',async()=>{const {c,e}=await fixture();try{
 const id=await grid.gridDraft(e,[{key:'m:contract',price:'9.50'}],'0','owner','professional');await approve(e,id);const receipt=await market.exportReceipt(e,id,'generic','professional'),table=market.receiptTable(receipt),header=table[0],r=table[1];
 const diff=(rows:string[][])=>market.diffPrices(receipt,header,rows.map((cells,i)=>({cells,row:i+2})));
 assert.equal(diff([r])[0].status,'applied');assert.equal(diff([[...r.slice(0,2),'9.49',...r.slice(3)]])[0].status,'different');assert.equal(diff([])[0].status,'missing');assert.equal(diff([r,r])[0].status,'duplicate');
 assert.equal(diff([r.map((v,i)=>header[i]==='qty_break'?'11':v)])[0].status,'missing');assert.throws(()=>market.diffPrices(receipt,header.slice(0,4),[]));
 for(const file of [new File(['=BAD'],'bad.xlsm'),new File(['PKfake'],'bad.csv'),new File(['<xml/>'],'bad.csv'),new File(['product,price\nA,1'],'bad.csv')])await assert.rejects(market.landedFile(file,receipt));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(table),'Prices');const valid=new File([XLSX.write(wb,{type:'array',bookType:'xlsx'})],'erp.xlsx');assert.equal((await market.landedFile(valid,receipt))[0].status,'applied');
 await assert.rejects(market.landedFile(new File([XLSX.write(wb,{type:'array',bookType:'ods'})],'disguised.xlsx'),receipt));
 wb.Sheets.Prices.C2={t:'n',v:9.5,f:'1+8.5'};await assert.rejects(market.landedFile(new File([XLSX.write(wb,{type:'array',bookType:'xlsx'})],'formula.xlsx'),receipt));
 c.query(await market.receiptSql(id,'generic',market.csvBlob(table),receipt));const rid=String(rows(c,'SELECT id FROM price_export_receipts')[0].id);c.query(`INSERT INTO price_landed_checks VALUES('check','${rid}','erp.csv','2026-11-07','${JSON.stringify(diff([r])).replaceAll("'","''")}')`);assert.equal((await market.landedState(e,'check')).applied,'1');
 }finally{c.close();}});
test('7C-2 worker slider approximation and exact release share rule conditions and never write a draft or live prices',async()=>{const {c,e}=await fixture();try{
 c.query("INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('old','V','A',600,'2020-01-01','s'),('new','V','A',660,'2021-01-01','s')");const saved=await ruleSql(e,{name:'Rule',category:'Parts',vendor:'V',threshold:'5',increase:'4.5'});c.query(saved.sql);
 assert.equal(basisPointsDecimal(BigInt(475)),'4.75');assert.equal(basisPointsDecimal(BigInt(10000)),'100.00');assert.equal((await whatIf(e,saved.id,basisPointsDecimal(BigInt(475)),true,1)).exact,true);
 const approx=await whatIf(e,saved.id,'4.5',false,1),exact=await whatIf(e,saved.id,'4.5',true,1);assert.equal(approx.exact,false);assert.equal(exact.exact,true);assert.equal(exact.impact,'500');assert.equal(rows(c,'SELECT count(*) n FROM rule_runs')[0].n,'0');
 const sim=await simulate(e,saved.id);c.query(sim.sql);assert.equal((await preview(e,sim.id)).impact,exact.impact);
 }finally{c.close();}});
test('7C-2 cost-to-serve uses invoice losses after existing freight, explicit free-delivery evidence, known costs and exact nonduplicated allocation',async()=>{const {c,e}=await fixture();try{
 c.query(`DELETE FROM sales_lines;INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('src',1,'A','C','2026-01-01',1,1000,0,300,0,800,2,'small'),('src',2,'B','C','2026-01-01',1,1000,0,300,0,500,3,'small'),('src',3,'A','C','2026-01-01',1,1000,0,300,0,800,4,'loss'),('src',4,'A','C','2026-01-01',1,1000,0,300,0,NULL,5,'unknown'),('src',5,'A','C','2026-01-01',1,1000,0,100,0,1100,6,'preloss')`);
 c.query(`INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('src',6,'A','C','2026-01-01',1,1000,0,200,0,901,7,'multi'),('src',7,'A','C','2026-01-01',1,1000,0,200,0,900,8,'multi'),('src',8,'B','C','2026-01-01',1,1000,0,200,0,750,9,'multi')`);
 let list=await serviceOrders(e);assert.equal(list.length,2);let result=await findLeaks(e);assert.equal(result.findings.find(f=>f.type==='small_order_loss')!.cents,'251');assert.equal(result.findings.some(f=>f.type==='free_delivery_loss'),false);
 const dedup=result.dedupedCents;c.query(await serviceFlagSql(e,list.find(r=>r.invoice_id==='loss')!.invoice_key,true,'owner'));result=await findLeaks(e);assert.equal(result.findings.find(f=>f.type==='free_delivery_loss')!.cents,'100');assert.equal(result.dedupedCents,dedup,'same loss cannot inflate deduplicated total');
 const evidence=await leakRows(e,'free_delivery_loss|all');assert.equal(evidence.engineAgrees,true);assert.equal(evidence.sum,'100');const allocations=await hitRows(e,'small_order_loss|all');assert.equal(allocations.length,3);assert.deepEqual(allocations.map(r=>String(r.leak)).sort(),['100','75','76']);
 assert.equal((await findLeaks(e,false)).findings.some(f=>f.type==='small_order_loss'),false);
 const service=new VaultService(()=>undefined);service.engine=e;Object.assign(service,{identity:{userId:'owner',tenantId:'test'}});service.licence.claims={v:1,sub:'owner',workspace:'test',device:'test',tier:'professional',state:'active',issued:0,expires:0,offlineUntil:0,reason:''};assert.equal((await service.leakRows('small_order_loss|all')).count,'3');service.licence.claims={...service.licence.claims,tier:'starter'};assert.equal((await service.leakRows('small_order_loss|all')).count,'0','Pro cache cannot bypass a downgrade');
 c.query(`DELETE FROM sales_lines;INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES('src',1,'A','C','2026-01-01',1,0,0,100,0,0,2,'zero'),('src',2,'B','C','2026-01-01',1,1000,0,0,0,950,3,'zero')`);const zero=await findLeaks(e);assert.equal(zero.findings.find(f=>f.type==='small_order_loss')!.cents,'50');const zeroEvidence=await leakRows(e,'small_order_loss|all');assert.equal(zeroEvidence.engineAgrees,true);assert.equal(zeroEvidence.rows[0].list,'0');
 }finally{c.close();}});
test('7C-2 every new privileged command refuses Sales Rep and Pro features refuse Starter; grid commit, receipt, checks and confirmations are audited',async()=>{const {c,e}=await fixture();try{
 c.query("INSERT INTO role_assignments VALUES('owner','Owner','owner','owner','2026-01-01'),('rep','Rep','sales_rep','owner','2026-01-01')");
 const make=(userId:string,tier:'starter'|'professional')=>{const s=new VaultService(()=>undefined);s.engine=e;Object.assign(s,{identity:{userId,tenantId:'test'},writable:async()=>e,save:async()=>undefined,touch:()=>undefined});const now=Math.floor(Date.now()/1000);s.licence.claims={v:1,sub:userId,workspace:'test',device:'test',tier,state:'active',issued:now,expires:now+3600,offlineUntil:now+86400,reason:''};return s;};
 const call=(s:VaultService,action:string,data:unknown={})=>dispatch(s,{id:'x',action,data} as Request,{signal:()=>new AbortController().signal,progress:()=>undefined});
 const pro=['competitorList','competitorAdd','ruleWhatIf','priceLandedState','priceLandedCheck','serviceOrders','serviceFlag'],all=[...pro,'homeMonitor','priceGrid','priceGridPaste','priceGridDraft'];
 for(const a of all)await assert.rejects(call(make('rep','professional'),a),e=>e instanceof VaultError&&e.code==='FORBIDDEN',a);
 for(const a of pro)await assert.rejects(call(make('owner','starter'),a),e=>e instanceof VaultError&&e.code==='LICENCE',a);
 const owner=make('owner','professional');await call(owner,'competitorAdd',{input:{product:'A',competitor:'X',price:'1.01',date:'2026-11-07',source:'note'}});await call(owner,'priceGridDraft',{edits:[{key:'l:A',price:'12'}],revision:'0'});
 const actions=rows(c,'SELECT action FROM audit_log').map(r=>r.action);assert.ok(actions.includes('pricing.competitor_recorded'));assert.ok(actions.includes('pricing.grid_drafted'));assert.ok(!JSON.stringify(rows(c,'SELECT details FROM audit_log')).includes('1.01'));
 }finally{c.close();}});

test('7C-2 grid caps are enforced after downgrade; category/future scopes and formula-safe identifiers survive exports',async()=>{const {c,e}=await fixture();try{
 c.query("INSERT INTO products(product_id,category,current_cost,list_price) SELECT 'X'||i,'Other',1,100 FROM range(501)t(i);INSERT INTO products(product_id,category,current_cost,list_price) VALUES('=A','Other',1,100);INSERT INTO price_matrix(id,category,price,valid_from,valid_to) VALUES('future','Other',100,'2030-01-01','2031-01-01')");
 const many=Array.from({length:51},(_,i)=>({key:'l:X'+i,price:'1.01'}));await assert.rejects(grid.gridDraft(e,many,'0','owner','starter'));const big=await grid.gridDraft(e,many,'0','owner','professional');await assert.rejects(grid.gridPreview(e,big,'starter'));
 await assert.rejects(grid.gridDraft(e,Array.from({length:501},(_,i)=>({key:'l:X'+i,price:'1.01'})),'0','owner','professional'));
 const draft=await grid.gridDraft(e,[{key:'m:future',price:'1.02'},{key:'l:=A',price:'1.03'}],'0','owner','professional');await approve(e,draft);const receipt=await market.exportReceipt(e,draft,'generic','professional');assert.equal(receipt.rows[0].from,'2030-01-01');assert.equal(receipt.rows[0].category,'Other');assert.equal(receipt.rows[0].product,'');assert.equal(receipt.rows[1].product,"'=A");
 const file=await market.gridExport(e,draft,'generic','xlsx','professional',await grid.gridPreview(e,draft,'professional'));assert.ok((await market.landedFile(new File([file.blob],'erp.xlsx'),receipt)).every(r=>r.status==='applied'));
 const data=await grid.gridData(e,draft,'professional');c.query(`UPDATE price_matrix SET price=109 WHERE id='${data[0].appliedKey.slice(2)}'`);const version=String(rows(c,`SELECT id FROM price_versions WHERE snapshot_id='${draft}'`)[0].id);await assert.rejects(grid.gridRollback(e,version,'owner','professional'));
 }finally{c.close();}});

test('7C-2 same-day and future grid edits preserve stable row IDs and resolver tie breaks',async()=>{const {c,e}=await fixture();try{
 const date=new Date().toISOString().slice(0,10);c.query(`INSERT INTO price_matrix(id,product_id,tier,price,valid_from) VALUES('a','B','T',2100,'${date}'),('b','B','T',2200,'${date}')`);
 const id=await grid.gridDraft(e,[{key:'m:a',price:'23.00'}],'0','owner','professional');assert.equal((await grid.gridData(e,id,'professional'))[0].appliedKey,'m:a');await approve(e,id);assert.equal(rows(c,"SELECT price::VARCHAR p FROM price_matrix WHERE id='a'")[0].p,'2300');const point=await market.competitors(e,'B','D');assert.equal(point.own!.bookCents,'2300');
 }finally{c.close();}});
