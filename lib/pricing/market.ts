import {businessDate} from '../vault/today';
import { workspaceCurrency } from '../vault/currency';
import {alternatives} from './alternatives';
import JSZip from 'jszip';
import {VaultError} from '../vault/protocol';
import type {Engine} from '../vault/engine';
import {sqlText as Q,validDate} from '../spike/exact';
import {rows,EXPORT_LAYOUTS,label,type Preview} from './rules';
import {gridData,moneyCell,fail} from './grid';
import type {ErpProfile} from '../studio/mapper';
import type {Tier} from '../vault/protocol';
import {pricePoint} from '../quotes/quotes';
import {centsText} from '../margin/decimal';
import {csvSafeCell} from '../csv';
import {msg} from '../i18n/core';
import {gridPage,gridQuery,memoryPage} from '../grid/sql';
import type {ClientColumn,GridMeta,GridSpec} from '../grid/core';
export const LANDED_GRID:GridSpec={product:'text',expected:'money',actual:'money',row:'text',status:'text'};
import {CsvTokenizer,decodeChunks,detectDelimiter} from '../studio/text';
import {checkZip,sheetNames,sheetGrid} from '../studio/sheets';
import * as XLSX from 'xlsx';
export type CompetitorInput={product:string;competitor:string;price:string;date:string;source:string};
export async function competitorSql(e:Engine,input:CompetitorInput,actor:string){
 const product=label(input.product),competitor=label(input.competitor),source=label(input.source);let date:string;try{date=validDate(input.date);}catch{return fail();}
 if(!(await rows(e,`SELECT product_id FROM products WHERE product_id=${Q(product)}`)).length)fail();
 return `INSERT INTO competitor_prices VALUES(${Q(crypto.randomUUID())},${Q(product)},${Q(competitor)},${moneyCell(input.price)},DATE ${Q(date)},${Q(source)},${Q(actor)},${Q(new Date().toISOString())});`;
}
export async function competitors(e:Engine,product:string,customer:string|null=null){
 const exists=product&&(await rows(e,`SELECT product_id FROM products WHERE product_id=${Q(label(product))}`)).length>0;
 const own=exists?await pricePoint(e,product,customer,'1',undefined,true):null; // competitor prices are a cost-role read
 return {own,alternatives:exists&&customer?await alternatives(e,product,customer):[],rows:await rows(e,`SELECT id,product_id,competitor,price::VARCHAR price,observed_on::VARCHAR date,source FROM competitor_prices ${product?`WHERE product_id=${Q(product)}`:''} ORDER BY observed_on DESC,created_at DESC,id LIMIT 100`)};
}
export type ExportRow={product:string;category:string;customer:string;tier:string;quantity:string;from:string;to:string;kind:string;price:string};
export type Receipt={headers:string[];rows:ExportRow[];currency?:string};
const safeScope=(r:ExportRow):ExportRow=>({...r,product:csvSafeCell(r.product),category:csvSafeCell(r.category),customer:csvSafeCell(r.customer),tier:csvSafeCell(r.tier)});
export const scopeKey=(r:ExportRow)=>JSON.stringify([r.kind,r.product,r.category,r.customer,r.tier,r.quantity,r.from,r.to]);
export async function exportReceipt(e:Engine,id:string,profile:ErpProfile,tier:Tier):Promise<Receipt>{
 const currency=await workspaceCurrency(e);
 const run=(await rows(e,`SELECT run_date FROM rule_runs WHERE id=${Q(id)}`))[0];if(!run)fail();
 if(id.startsWith('grid-'))return {currency,headers:['product_id','tier','price','effective_from','customer_id','valid_to','category','qty_break','price_kind','currency'],rows:(await gridData(e,id,tier)).map(r=>({product:r.product??'',category:r.rawCategory??'',customer:r.customer??'',tier:r.tier,quantity:r.quantityBreak,from:r.from&&r.from>businessDate(String(run.run_date))?r.from:businessDate(String(run.run_date)),to:r.to??'',kind:r.key.startsWith('l:')?'list':'matrix',price:r.after})).map(safeScope)};
 const scoped=id.startsWith('ops-');
 const data=await rows(e,`SELECT r.product_id,${scoped?"coalesce(d.matrix_tier,'')":'r.tier'} tier,r.after_cents::VARCHAR price,${scoped?'d.customer_id,d.valid_to::VARCHAR valid_to':'NULL customer_id,NULL valid_to'} FROM rule_changes r ${scoped?'JOIN price_changeset_rows d ON d.run_id=r.run_id AND d.product_id=r.product_id AND d.tier=r.tier':''} WHERE r.run_id=${Q(id)} ORDER BY r.product_id,r.tier`);
 return {currency,headers:[...EXPORT_LAYOUTS[profile],...(profile==='generic'&&scoped?['customer_id','valid_to']:[]),...(profile==='generic'?['currency']:[])],rows:data.map(r=>({product:r.product_id,category:'',customer:r.customer_id??'',tier:r.tier,quantity:'0.0000',from:businessDate(String(run.run_date)),to:r.valid_to??'',kind:'matrix',price:r.price})).map(safeScope)};
}
export function receiptTable(receipt:Receipt){return [receipt.headers,...receipt.rows.map(r=>[r.product,r.tier,centsText(BigInt(r.price)),r.from,...(receipt.headers.includes('customer_id')?[r.customer,r.to]:[]),...(receipt.headers.includes('category')?[r.category,r.quantity,r.kind]:[]),...(receipt.headers.includes('currency')?[receipt.currency??'USD']:[])])];}
export function csvBlob(table:string[][]){return new Blob(['\ufeff'+table.map(r=>r.map(v=>'"'+csvSafeCell(v).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});}
export async function gridExport(e:Engine,id:string,profile:ErpProfile,format:'csv'|'xlsx',tier:Tier,preview:Preview){
 if(profile!=='generic')fail('pc2.scopeExport');if(!['approved','exported'].includes(preview.status))fail();if(!['csv','xlsx'].includes(format))fail();
 const receipt=await exportReceipt(e,id,profile,tier),table=receiptTable(receipt);let blob:Blob;
 if(format==='xlsx'){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(table),'Prices');blob=new Blob([XLSX.write(book,{type:'array',bookType:'xlsx'})]);}else blob=csvBlob(table);
 return {name:`rebatehq-grid-prices.${format}`,blob,logName:'rebatehq-grid-change-log.csv',log:csvBlob([[...receipt.headers,'before','guardrail'],...(await gridData(e,id,tier)).map((r,i)=>[...table[i+1],centsText(BigInt(r.price)),r.guard])]),warning:msg('pc2.scopeNotice')};
}
export async function receiptSql(run:string,profile:ErpProfile,file:Blob,receipt:Receipt){
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return `INSERT INTO price_export_receipts VALUES(${Q(crypto.randomUUID())},${Q(run)},${Q(profile)},${Q(new Date().toISOString())},${Q(hash)},${Q(JSON.stringify(receipt))});`;
}
export type LandedRow={product:string;scope:string;details:ExportRow;expected:string;actual:string|null;status:'applied'|'different'|'missing'|'duplicate';row:string};
export function diffPrices(receipt:Receipt,headers:string[],data:{cells:string[];row:number}[]){
 if(new Set(headers).size!==headers.length||receipt.headers.some(h=>!headers.includes(h)))fail('pc2.scopeExport');
 const get=(cells:string[],h:string)=>cells[headers.indexOf(h)]??'';
 const found=new Map<string,{price:string;row:string}[]>();
 for(const {cells,row} of data){
  try{
  if(cells.length!==headers.length)fail('pc2.pasteError');
  if(receipt.headers.includes('currency') && get(cells,'currency') !== (receipt.currency??'USD'))fail('pc2.pasteError');
  const values=receipt.headers.slice(0,4).map(h=>get(cells,h));
  let date:string,to:string;try{date=validDate(values[3]);to=get(cells,'valid_to');if(to)validDate(to);}catch{return fail('pc2.pasteError');}
  const qty=get(cells,'qty_break')||'0';if(!/^(0|[1-9]\d{0,10})(\.\d{1,4})?$/.test(qty))fail('pc2.pasteError');
  const kind=get(cells,'price_kind')||'matrix';if(!['list','matrix'].includes(kind))fail('pc2.pasteError');
  const normalized:ExportRow={product:values[0],tier:values[1],price:moneyCell(values[2]),from:date,to,customer:get(cells,'customer_id'),category:get(cells,'category'),quantity:rescaleQuantity(qty),kind};
  const key=scopeKey(normalized);found.set(key,[...(found.get(key)??[]),{price:normalized.price,row:String(row)}]);
  }catch{throw new VaultError("PRICING",msg("pc2.fileAt",{row}));}
 }
 return receipt.rows.map(r=>{const values=found.get(scopeKey(r))??[];return {product:r.product||r.category,scope:scopeKey(r),details:r,expected:r.price,actual:values.length===1?values[0].price:null,status:values.length>1?'duplicate':!values.length?'missing':values[0].price===r.price?'applied':'different',row:values.map(v=>v.row).join(', ')} as LandedRow;});
}
function rescaleQuantity(v:string){const [a,b='']=v.split('.');return a+'.'+b.padEnd(4,'0');}
/** Separate bounded parser; never touches Import Studio staging or any live prices. */
export async function landedFile(file:File,receipt:Receipt,signal?:AbortSignal){
 if(!file||file.size<1||file.size>32*1024*1024||!/[.](csv|tsv|xlsx)$/i.test(file.name))fail();
 const data:{cells:string[];row:number}[]=[];let headers:string[]|null=null;
 const accept=(cells:string[],row:number,oversized=false)=>{if(oversized||data.length>=300000)fail('pc2.pasteError');if(!cells.some(x=>x!==''))return;if(headers===null){headers=cells.map(x=>x.replace(/^\ufeff/,''));return;}data.push({cells,row});};
 if(/\.xlsx$/i.test(file.name)){
  const bytes=new Uint8Array(await file.arrayBuffer()),notices=await checkZip(bytes,'xlsx');if(notices.length)fail();const archive=await JSZip.loadAsync(bytes);if(!archive.file('xl/workbook.xml')||!archive.file('[Content_Types].xml'))fail();const names=sheetNames(bytes);if(names.length!==1)fail();const g=sheetGrid(bytes,names[0]);if(g.notices.length||g.issues.length)fail();g.rows.forEach((r,i)=>accept(r,g.rowNumbers[i]));
 }else{
  const head=new Uint8Array(await file.slice(0,65536).arrayBuffer());if(head.includes(0)||head[0]===0x50&&head[1]===0x4b)fail();let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(head,{stream:true});}catch{return fail();}
  if(/^\s*</.test(text)||/[^\t\r\n\x20-\uFFFF]/.test(text))fail();
  const tokenizer=new CsvTokenizer(/\.tsv$/i.test(file.name)?'\t':detectDelimiter(text),accept);
  for await(const chunk of decodeChunks(file,'utf-8',signal))tokenizer.push(chunk.text);tokenizer.end();
 }
 if(!headers||!data.length)fail('pc2.empty');return diffPrices(receipt,headers as unknown as string[],data);
}
export async function landedState(e:Engine,id?:string,offset=0,grid?:unknown){
 const receipts=await rows(e,'SELECT id,run_id,created_at,profile FROM price_export_receipts ORDER BY created_at DESC,id DESC LIMIT 50');
 const checks=await rows(e,'SELECT id,receipt_id,file_name,created_at FROM price_landed_checks ORDER BY created_at DESC,id DESC LIMIT 50');
 const check=id?(await rows(e,`SELECT results_json FROM price_landed_checks WHERE id=${Q(id)}`))[0]:null;
 const all:LandedRow[]=check?JSON.parse(check.results_json):[];offset=Math.max(0,Math.floor(offset));
 const cols:ClientColumn<LandedRow>[]=[{id:'product',type:'text',value:r=>r.product},{id:'expected',type:'money',value:r=>r.expected},{id:'actual',type:'money',value:r=>r.actual},{id:'row',type:'text',value:r=>r.row},{id:'status',type:'text',value:r=>r.status}];
 const page=await memoryPage(e,all,cols,LANDED_GRID,gridQuery(LANDED_GRID,grid),{limit:50,offset});
 return {receipts,checks,count:page.grid.matched,applied:String(all.filter(r=>r.status==='applied').length),offset,rows:page.rows,grid:page.grid};
}
