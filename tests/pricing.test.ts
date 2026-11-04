import test from 'node:test';
import assert from 'node:assert/strict';
import { duckdbConnection,rows as q } from './helpers/duckdb-node';
import { schemaSql,upgradeSql,tablesFor } from '../lib/vault/schema';
import { raised,rate,guardStatus,guardSql,ruleSql,simulate,preview,approveSql,exportPrices,EXPORT_LAYOUTS } from '../lib/pricing/rules';
import { rhaSql } from '../lib/margin/sql';
import type { Engine } from '../lib/vault/engine';
import * as XLSX from 'xlsx';
import { writeBackup } from '../lib/vault/backup';
test('folder copy is ciphertext-only, atomic and keeps the previous backup on a failed publication',async()=>{
 const files=new Map<string,Blob>();let fail=false;
 const directory={async getFileHandle(name:string,options?:{create:boolean}){if(!files.has(name)&&!options?.create)throw new DOMException('not found','NotFoundError');return {async getFile(){return files.get(name)!;},async createWritable(){const chunks:Uint8Array[]=[];return new WritableStream<Uint8Array>({write(b){chunks.push(b.slice());},close(){if(fail&&name==='rebatehq-backup.enc')throw new Error('denied');files.set(name,new Blob(chunks as Uint8Array<ArrayBuffer>[]));}});}};}};
 const first=new Blob(['MDVAULT1-synthetic-ciphertext']);await writeBackup(first,directory as unknown as FileSystemDirectoryHandle);fail=true;
 await assert.rejects(writeBackup(new Blob(['MDVAULT1-new']),directory as unknown as FileSystemDirectoryHandle),/Backup could not/);
 assert.equal(await files.get('rebatehq-backup.enc')!.text(),await first.text());assert.equal(await files.get('rebatehq-backup.previous.enc')!.text(),await first.text());
});
test('price-rule rounding is exact JS == DuckDB SQL including ties',async()=>{const c=await duckdbConnection();try{for(const price of [1,10,100,9999,1234567])for(const percent of ['0','4.5','5','100']){const b=rate(percent);assert.equal(q(c,`SELECT ${rhaSql(`CAST(${price} AS HUGEINT)*(10000+${b})`,'10000')}::VARCHAR AS n`)[0].n,String(raised(BigInt(price),b)));}assert.throws(()=>rate('1e3'));assert.throws(()=>rate('101'));assert.throws(()=>rate('-1'));assert.equal(guardStatus(BigInt(9),BigInt(20),BigInt(10)),'red');assert.equal(guardStatus(BigInt(10),BigInt(20),BigInt(10)),'yellow');assert.equal(guardStatus(BigInt(20),BigInt(20),BigInt(10)),'green');}finally{c.close();}});
test('v6 price copy, version conflicts, owner, red guard, approval and safe ERP exports execute in DuckDB',async()=>{
const c=await duckdbConnection();c.query(schemaSql(6));const e={conn:c} as unknown as Engine;
try{
c.query(`INSERT INTO vault_meta VALUES(1,6,'starter','unit','tip',0,0);INSERT INTO pricing_settings VALUES(1,'owner','Pricing Owner',7);
INSERT INTO products(product_id,category,current_cost,list_price) VALUES('=unsafe','Valves',6000,10000),('NO-COST','Valves',NULL,20000);
INSERT INTO vendor_costs(id,vendor,product_id,cost,effective_date,source_file) VALUES('a','Supplier','=unsafe',6000,'2025-01-01','one'),('b','Supplier','=unsafe',6600,'2025-02-01','two'),('c','Supplier','NO-COST',100,'2025-01-01','one'),('d','Supplier','NO-COST',120,'2025-02-01','two');`);
const input={name:'Cost rule',category:'Valves',vendor:'Supplier',threshold:'5',increase:'4.5'};
const r=await ruleSql(e,input);c.query(r.sql);const sim=await simulate(e,r.id);c.query(sim.sql);
let p=await preview(e,sim.id);assert.equal(p.count,'2');assert.equal(p.rows[0].after,'10450');assert.equal(p.rows[1].afterMargin,null);assert.equal(q(c,'SELECT count(*) AS n FROM price_matrix')[0].n,'0');
await assert.rejects(approveSql(e,sim.id,'rep'),/Pricing Owner/);

c.query("INSERT INTO customers(customer_id,tier) VALUES('C','T01'); INSERT INTO agg_cpm VALUES('C','=unsafe','2025-01-01','sale',1,2,20000,0,0,0,1,20000,12000)");
const revision=await ruleSql(e,{...input,id:r.id,increase:'4.5'});c.query(revision.sql);await assert.rejects(approveSql(e,sim.id,'owner'),/Conflict/);
c.query(guardSql({tier:'T01',category:'Valves',floor:'10500',target:'11000',start:'12000'}));
const red=await simulate(e,r.id);c.query(red.sql);assert.equal((await preview(e,red.id)).red,'1');await assert.rejects(approveSql(e,red.id,'owner'),/Red/);
c.query(guardSql({tier:'T01',category:'Valves',floor:'9500',target:'10500',start:'12000'}));
const yellow=await simulate(e,r.id);c.query(yellow.sql);p=await preview(e,yellow.id);assert.equal(p.rows[0].guard,'yellow');assert.equal(p.rows[0].impact,'900');
await assert.rejects(exportPrices(e,yellow.id,'generic','csv'),/approve/);
c.query(await approveSql(e,yellow.id,'owner'));assert.equal(q(c,"SELECT count(*) AS n FROM price_versions")[0].n,'1');
await assert.rejects(approveSql(e,yellow.id,'owner'),/unapproved/);
for(const profile of Object.keys(EXPORT_LAYOUTS) as Array<keyof typeof EXPORT_LAYOUTS>){for(const format of ['csv','xlsx'] as const){const file=await exportPrices(e,yellow.id,profile,format);assert.match(file.warning,/unverified/);assert.match(await file.log.text(),/104.50/);if(format==='csv')assert.match(await file.blob.text(),/'=unsafe/);else{const wb=XLSX.read(await file.blob.arrayBuffer());const cells=Object.values(wb.Sheets.Prices).filter(x=>typeof x==='object') as any[];assert.ok(cells.every(c=>!c.f));assert.ok(cells.some(c=>c.v==="'=unsafe"));}}}
assert.throws(()=>guardSql({tier:'T01',category:'Valves',start:'1',target:'2',floor:'0'}),/Floor/);
assert.equal(tablesFor(6).length,25);assert.ok(upgradeSql(5).includes('rule_changes'));
}finally{c.close();}
});
