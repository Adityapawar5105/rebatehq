import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { duckdbConnection, rows } from './helpers/duckdb-node';
import { TABLES, SCHEMA_VERSION, schemaSql, upgradeSql } from '../lib/vault/schema';
import type { Engine } from '../lib/vault/engine';
import { batchFx, currencyChangeSql, workspaceCurrency, convertCents, convertCentsSql, convertAmountSql, sourceFx } from '../lib/vault/currency';
import { createStage, validate, commitSql, resetStage, type StagedFile, joinHeaders, spreadFreight, fillItemCost } from '../lib/studio/load';
import { ROLE_FIELDS, type Role, type Settings } from '../lib/studio/formats';
import { fixSetSql, recheck } from '../lib/studio/fixlater';
import { loadCredits } from '../lib/margin/credits';
import { listSources, removeSource, Studio } from '../lib/studio/studio';
import { sqlText as Q } from '../lib/spike/exact';
import { GENESIS } from '../lib/vault/audit';
import { fmt, setWorkspaceCurrency } from '../lib/i18n';
import { currency } from '../lib/i18n/core';
import { receiptTable, diffPrices, type Receipt } from '../lib/pricing/market';

const settings: Settings = {sheet:null,headerRow:0,headerDepth:1,delimiter:',',encoding:'utf-8',decimal:'dot',dateFormat:'YYYY-MM-DD'};
async function fresh(version = SCHEMA_VERSION) {
  const c = await duckdbConnection();
  for(const table of [...TABLES].reverse()) c.query(`DROP TABLE IF EXISTS ${table}`);
  c.query(schemaSql(version));
  c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,audit_count) VALUES(1,${version},'professional','unit',${Q(GENESIS)},0)`);
  const e = {conn:{query:async(sql:string)=>c.query(sql)}} as unknown as Engine;
  return {c,e};
}
async function staged(e:Engine,role:Role,records:Record<string,string>[],rate='1.25',ord=0) {
  await createStage(e,role);
  const fields=ROLE_FIELDS[role];
  await e.conn.query(`INSERT INTO st_${role} VALUES ${records.map((r,i)=>`(${ord},${i+2},${fields.map(f=>r[f.name]===undefined?'NULL':Q(r[f.name])).join(',')})`).join(',')}`);
  const f:StagedFile={ord,role,name:role+'.csv',bytes:1,fingerprint:'unit',alignment:[],settings:{...settings,sourceCurrency:'EUR',fxRate:rate},keyed:false,headers:[],colOffset:0};
  await validate(e,role as Exclude<Role,'rebate_agreement'>,[f],null);
  return f;
}
const sale=(over:Record<string,string>={})=>({line_id:'1',invoice_id:'I',product_id:'P',customer_id:'C',sale_date:'2026-01-01',quantity:'1',list_amount:'10.00',discount_amount:'1.00',rebate_amount:'0.50',freight_amount:'0.25',cost_amount:'4.00',...over});
async function commit(e:Engine,role:Role,source='src') {
  await e.conn.query(`INSERT INTO source_files VALUES(${Q(source)},'fixture.csv',${Q(role)},1,'2026-01-01');
INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at,source_currency,workspace_currency,fx_rate) VALUES(${Q(crypto.randomUUID())},${Q(source)},0,0,'2026-01-01','EUR','CAD','1.25');
CREATE TEMP TABLE studio_files AS SELECT 0 file_ord,${Q(source)} source_id,'fixture.csv' AS name;
CREATE TEMP TABLE studio_messages(file_ord INTEGER,code VARCHAR,column_name VARCHAR,message VARCHAR);
INSERT INTO studio_messages SELECT 0,err,'','fixture issue' FROM ty_${role} WHERE err IS NOT NULL;
${commitSql(new Set([role]))}`);
}
test('7C-3a exact FX: decimal rates, positive and negative half ties, large cents, and SQL agree',async()=>{
  const {c}=await fresh();try{
    for(const rate of ['0.5','1','1.25','0.000000000001','999999.123456789012'])for(const amount of [BigInt(1),BigInt(-1),BigInt(10),BigInt(-10),BigInt('9007199254740993')]) {
      // Huge results are allowed here as HUGEINT; persisted amounts are checked BIGINT.
      if(convertCents(amount,rate)>BigInt('9223372036854775807'))continue;
      assert.equal(rows(c,`SELECT ${convertCentsSql(String(amount),rate)}::VARCHAR n`)[0].n,String(convertCents(amount,rate)));
    }
    assert.equal(convertCents(BigInt(1),'0.5'),BigInt(1));assert.equal(convertCents(BigInt(-1),'0.5'),BigInt(-1));
    assert.equal(rows(c,`SELECT ${convertAmountSql("'1.005'",'2')}::VARCHAR n`)[0].n,'201','No premature source-cent rounding');
    assert.equal(rows(c,`SELECT ${convertAmountSql("'-0.005'",'1')}::VARCHAR n`)[0].n,'-1');
    for(const bad of ['0','-1','NaN','1e3','1.1234567890123','1000000',''])assert.throws(()=>batchFx('EUR','CAD',bad));
    for(const bad of ['ZZZ','JPY','KWD','usd'])assert.throws(()=>batchFx(bad,'CAD','1'));
    assert.throws(()=>batchFx('CAD','CAD','1.1'));assert.equal(batchFx('CAD','CAD','1.000').fxRate,'1');
  }finally{c.close();}
});
test('7C-3a v12 upgrade preserves every stored amount, defaults existing batches to USD/1, and seals populated currency',async()=>{
  const {c,e}=await fresh(12);try{
    c.query("INSERT INTO products(product_id,current_cost,list_price) VALUES('P',123,987);INSERT INTO source_files VALUES('s','old.csv','item_master',1,'2026-01-01');INSERT INTO import_batches(id,source_id,rows_loaded,rows_rejected,imported_at) VALUES('b','s',1,0,'2026-01-01')");
    const before=rows(c,'SELECT * FROM products');c.query(upgradeSql(12));
    assert.deepEqual(rows(c,'SELECT * EXCLUDE (notes) FROM products'),before);assert.equal(rows(c,'SELECT notes FROM products')[0].notes,null);assert.equal(await workspaceCurrency(e),'USD');assert.deepEqual(await sourceFx(e,'s'),batchFx('USD','USD','1'));
    assert.equal(await currencyChangeSql(e,'USD'),'');await assert.rejects(currencyChangeSql(e,'CAD'),/cannot change/);
  }finally{c.close();}
});
test('7C-3a source decimals convert once; rejected corrections and returns retain original batch FX; removal restores counts',async()=>{
  const {c,e}=await fresh();try{
    c.query(await currencyChangeSql(e,'CAD'));assert.equal(await workspaceCurrency(e),'CAD');
    await staged(e,'sales_history',[sale({list_amount:'1.005',cost_amount:'0.005'}),sale({line_id:'2',sale_date:'bad'}),sale({line_id:'3',quantity:'-1',list_amount:'-2.00',discount_amount:'0',rebate_amount:'0',freight_amount:'0',cost_amount:'-1.00'})]);
    assert.equal(rows(c,'SELECT list_cents::VARCHAR n FROM ty_sales_history WHERE src_row=2')[0].n,'126');
    await commit(e,'sales_history');await resetStage(e);
    const correction=await fixSetSql(e,'src','sale_date:invalid','sale_date','2026-01-01',null);c.query(correction.sql);
    assert.equal((await recheck(e,'src','sale_date:invalid','professional')).loaded,'1');
    assert.equal(rows(c,'SELECT list_cents::VARCHAR n FROM sales_lines WHERE line_id=2')[0].n,'1250');
    assert.equal((await loadCredits(e,'src','professional')).loaded,'1');assert.equal(rows(c,'SELECT list_cents::VARCHAR n FROM sales_lines WHERE line_id=3')[0].n,'-250');
    const history=await listSources(e);assert.equal(history[0].sourceCurrency,'EUR');assert.equal(history[0].workspaceCurrency,'CAD');assert.equal(history[0].fxRate,'1.25');
    await removeSource(e,'src');assert.equal(rows(c,'SELECT count(*)::VARCHAR n FROM sales_lines')[0].n,'0');
    assert.equal(rows(c,'SELECT count(*)::VARCHAR n FROM import_batches')[0].n,'0');
  }finally{await resetStage(e);c.close();}
});
test('7C-3a mixed header and item currencies: header freight and item-derived cost are not converted twice',async()=>{
  const {c,e}=await fresh();try{
    const h=await staged(e,'order_header',[{invoice_id:'I',customer_id:'C',sale_date:'2026-01-01',freight_amount:'2.00'}],'2',0);
    const item=await staged(e,'item_master',[{product_id:'P',current_cost:'3.00'}],'0.5',1);
    await createStage(e,'sales_history');const fields=ROLE_FIELDS.sales_history,r=sale();
    c.query(`INSERT INTO st_sales_history VALUES(2,2,${fields.map(f=>Q(r[f.name as keyof typeof r]??'')).join(',')})`);
    const line={...h,ord:2,role:'sales_history' as const,settings:{...settings,fxRate:'1.25'},fromHeader:['freight_amount'],itemCost:true};
    await joinHeaders(e,[h,item,line]);await validate(e,'sales_history',[line],null);await spreadFreight(e,[h,item,line]);await fillItemCost(e,[h,item,line],true);
    assert.deepEqual(rows(c,'SELECT freight_cents::VARCHAR f,cost_cents::VARCHAR c,list_cents::VARCHAR l FROM ty_sales_history'),[{f:'400',c:'150',l:'1250'}]);
  }finally{await resetStage(e);c.close();}
});
test('7C-3a generic price round trip retains currency and rejects a changed denomination',()=>{
  const receipt:Receipt={currency:'CAD',headers:['product_id','tier','price','effective_from','currency'],rows:[{product:'P',tier:'T',price:'125',from:'2026-01-01',to:'',customer:'',category:'',quantity:'0.0000',kind:'matrix'}]};
  const table=receiptTable(receipt);assert.equal(table[1][4],'CAD');assert.equal(diffPrices(receipt,table[0],[{cells:table[1],row:2}])[0].status,'applied');
  table[1][4]='USD';assert.throws(()=>diffPrices(receipt,table[0],[{cells:table[1],row:2}]));
});
test('7C-3a every UI amount uses the workspace formatter; large and negative amounts retain exact cents',()=>{
  try{setWorkspaceCurrency('EUR');for(const type of ['margin','waterfall','leak','quote','preview','report']){
    assert.equal(fmt.currency('9007199254740993'),currency('en','9007199254740993','EUR'),type);
    assert.equal(fmt.currency('-1'),currency('en','-1','EUR'),type);
  }
  for(const file of readdirSync('components/local').filter(f=>f.endsWith('.tsx')))assert.ok(!readFileSync('components/local/'+file,'utf8').includes('fmt.money('),file);
  assert.ok(readFileSync('lib/vault/service.ts','utf8').includes('currency: await workspaceCurrency(this.requireEngine())'));
  }finally{setWorkspaceCurrency('USD');}
});
test('7C-3a mapping recipes never reuse a previous batch currency or FX rate',async()=>{
  const studio=new Studio();await studio.add([new File(['product_id,current_cost,list_price\nP,1,2\n'],'items.csv')],[],null,'CAD');
  const id=studio.state([]).files[0].id;await studio.update(id,{sourceCurrency:'EUR',fxRate:'1.25',confirmed:true});
  assert.equal(studio.state([]).files[0].settings.fxRate,'1.25');
  const recipe=studio.recipeFor(id,'Supplier');assert.equal(recipe.settings.fxRate,undefined);assert.equal(recipe.settings.sourceCurrency,undefined);
});
