import type {Engine} from '../vault/engine';
import {gridPage,gridQuery,memoryPage} from '../grid/sql';
import type {ClientColumn,GridSpec} from '../grid/core';
import {PREVIEW_GRID} from './rules';
import {VaultError,type Tier} from '../vault/protocol';
import {sqlText as Q,minorUnits} from '../spike/exact';
import {dec,rescale,rha} from '../margin/decimal';
import {lineFromCents} from '../margin/engine';
import {msg} from '../i18n/core';
import {rows,type Preview,type PriceRow} from './rules';
import {resolvedBook} from './book';
export const BASIC_GRID_LIMIT=50,FULL_GRID_LIMIT=500;
export type GridRow={key:string;product:string|null;category:string;rawCategory:string|null;rawTier:string|null;customer:string|null;tier:string;quantityBreak:string;from:string|null;to:string|null;price:string;cost:string|null};
export type GridEdit={key:string;price:string};
type Change=GridRow & {after:string;quantity:string;impact:string;guard:string;appliedKey:string};
export const fail=(key:'pc2.invalid'|'pc2.conflict'|'pc2.pasteError'|'pc2.empty'|'pc2.scopeExport'='pc2.invalid'):never=>{throw new VaultError('PRICING',msg(key));};
const day=()=>new Date().toISOString().slice(0,10);
const nullable=(v:string|null)=>v===null?'NULL':Q(v);
export function moneyCell(value:string){if(typeof value!=='string')return fail('pc2.pasteError');try{return String(minorUnits(value));}catch{return fail('pc2.pasteError');}}
/** Excel paste is one column of decimal prices, anchored to the visible row. No keys or formulas are executable. */
export function pastedPrices(text:string,keys:string[],start:number):GridEdit[]{
 if(typeof text!=='string'||text.length>100000||!Array.isArray(keys)||keys.length>50||keys.some(k=>typeof k!=='string'||k.length>300)||!Number.isInteger(start)||start<0)return fail('pc2.pasteError');
 const cells=text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n');
 if(cells.length>FULL_GRID_LIMIT||start+cells.length>keys.length)return fail('pc2.pasteError');
 return cells.map((value,i)=>{if(!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value))throw new VaultError('PRICING',msg('pc2.pasteAt',{row:start+i+1,column:value.includes('\t')?2:1}));moneyCell(value);return {key:keys[start+i],price:value};});
}
/** Grid columns (7V-3a) of the editable price grid. */
export const PRICE_GRID:GridSpec={product_label:'text',customer_id:'text',tier:'text',qty_break:'decimal',price:'money'};
export async function gridRows(e:Engine,advanced:boolean,offset=0,search='',grid?:unknown){
 if(!Number.isInteger(offset)||offset<0||typeof search!=='string'||search.length>160)fail();
 const filter=search?`WHERE contains(lower(coalesce(product_id,'')||' '||category||' '||coalesce(customer_id,'')),lower(${Q(search)}))`:'';
 const sql=`SELECT 'l:'||product_id AS key,product_id,category,NULL::VARCHAR AS customer_id,'' AS tier,'0.0000' AS qty_break,NULL::VARCHAR AS valid_from,NULL::VARCHAR AS valid_to,list_price::VARCHAR AS price,current_cost::VARCHAR AS cost,NULL::VARCHAR AS raw_category,NULL::VARCHAR AS raw_tier FROM products WHERE list_price IS NOT NULL
 ${advanced?`UNION ALL SELECT 'm:'||m.id,m.product_id,CASE WHEN m.product_id IS NULL THEN coalesce(m.category,'') ELSE coalesce(p.category,'') END,m.customer_id,coalesce(m.tier,''),m.qty_break::VARCHAR,m.valid_from::VARCHAR,m.valid_to::VARCHAR,m.price::VARCHAR,p.current_cost::VARCHAR,m.category,m.tier FROM price_matrix m LEFT JOIN products p ON p.product_id=m.product_id WHERE m.valid_to IS NULL OR m.valid_to>DATE ${Q(day())}`:''}`;
 const q=gridQuery(PRICE_GRID,grid);
 const page=await gridPage(e,`SELECT *,coalesce(product_id,category) AS product_label FROM (${sql}) t ${filter}`,PRICE_GRID,q,{fallback:'g.key',limit:50,offset});
 return {revision:String((await rows(e,'SELECT pricing_revision::VARCHAR n FROM vault_meta WHERE id=1'))[0].n),count:page.grid.matched,offset,advanced,rows:page.rows.map(toRow),grid:page.grid};
}
function toRow(r:Record<string,any>):GridRow{return {key:r.key,product:r.product_id,category:r.category,rawCategory:r.raw_category??null,rawTier:r.raw_tier??null,customer:r.customer_id,tier:r.tier,quantityBreak:r.qty_break,from:r.valid_from,to:r.valid_to,price:r.price,cost:r.cost};}
async function selected(e:Engine,keys:string[]){
 const out:GridRow[]=[];
 // Bounded reads by primary key; not an unbounded matrix/customer lateral join.
 for(const key of keys){
  const r=key.startsWith('l:')?await rows(e,`SELECT 'l:'||product_id AS key,product_id,category,NULL AS customer_id,'' AS tier,'0.0000' AS qty_break,NULL AS valid_from,NULL AS valid_to,list_price::VARCHAR AS price,current_cost::VARCHAR AS cost,NULL::VARCHAR AS raw_category,NULL::VARCHAR AS raw_tier FROM products WHERE product_id=${Q(key.slice(2))} AND list_price IS NOT NULL`):key.startsWith('m:')?await rows(e,`SELECT 'm:'||m.id AS key,m.product_id,CASE WHEN m.product_id IS NULL THEN coalesce(m.category,'') ELSE coalesce(p.category,'') END category,m.customer_id,coalesce(m.tier,'') tier,m.qty_break::VARCHAR qty_break,m.valid_from::VARCHAR valid_from,m.valid_to::VARCHAR valid_to,m.price::VARCHAR price,p.current_cost::VARCHAR AS cost,m.category AS raw_category,m.tier AS raw_tier FROM price_matrix m LEFT JOIN products p ON p.product_id=m.product_id WHERE m.id=${Q(key.slice(2))} AND (m.valid_to IS NULL OR m.valid_to>DATE ${Q(day())})`):[];
  if(r.length!==1)fail('pc2.conflict');out.push(toRow(r[0]));
 }
 return out;
}
async function changes(e:Engine,input:GridRow[],edits:GridEdit[]):Promise<Change[]>{
 const targets=input.map(r=>r.product?`l.product_id=${Q(r.product)}`:`p.category=${Q(r.category)}`).join(' OR ');
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_grid_hist;CREATE TEMP TABLE md_grid_hist AS SELECT row_number() OVER()::VARCHAR lookup_id,x.*,DATE ${Q(day())} AS as_of FROM(SELECT l.product_id,p.category,l.customer_id,c.tier,l.quantity,sum(l.quantity)::DECIMAL(18,4) qty FROM sales_lines l JOIN products p USING(product_id) JOIN customers c USING(customer_id) WHERE l.line_kind='sale' AND (${targets}) GROUP BY l.product_id,p.category,l.customer_id,c.tier,l.quantity LIMIT 250001)x`);
 if(BigInt(String((await rows(e,'SELECT count(*)::VARCHAR n FROM md_grid_hist'))[0].n))>BigInt(250000))fail();
 const hist=await rows(e,`SELECT CASE WHEN matrix_id IS NULL THEN 'l:'||product_id ELSE 'm:'||matrix_id END AS key,sum(qty)::VARCHAR qty FROM (${resolvedBook('SELECT * FROM md_grid_hist')}) b GROUP BY 1`);
 const quantities=new Map(hist.map(r=>[r.key,r.qty]));
 const out:Change[]=[];
 for(let i=0;i<input.length;i++){
  const r=input[i],after=moneyCell(edits[i].price);if(after===r.price)continue;
  const guards=await rows(e,`SELECT max(g.floor)::VARCHAR AS floor,max(g.target)::VARCHAR AS target FROM price_guardrails g WHERE g.category=${Q(r.category)} ${r.customer?`AND g.tier=(SELECT tier FROM customers WHERE customer_id=${Q(r.customer)})`:r.tier?`AND g.tier=${Q(r.tier)}`:''}`);
  const g=guards[0],qty=String(quantities.get(r.key)??'0.0000');
  out.push({...r,after,quantity:qty,impact:String(rha((BigInt(after)-BigInt(r.price))*rescale(dec(qty),4).v,BigInt(10000))),guard:g.floor===null?'unset':BigInt(after)<BigInt(g.floor)?'red':BigInt(after)<BigInt(g.target)?'yellow':'green',appliedKey:r.key.startsWith('m:')&&r.from!<day()?'m:'+crypto.randomUUID():r.key});
 }
 return out;
}
async function store(e:Engine,actor:string,data:Change[],advanced:boolean){
 if(!data.length)fail('pc2.empty');const id='grid-'+crypto.randomUUID(),at=new Date().toISOString(),name=msg('pc2.gridDraft');
 await e.conn.query(`INSERT INTO rules VALUES(${Q(id)},${Q(name)},'{}','grid',${Q(at)});INSERT INTO rule_revisions VALUES(${Q(id)},1,'{}',${Q(name)},${Q(at)});
 INSERT INTO rule_runs(id,rule_id,run_date,affected_rows,status,rule_version,base_revision) SELECT ${Q(id)},${Q(id)},${Q(at)},${data.length},'preview',1,pricing_revision FROM vault_meta WHERE id=1;
 INSERT INTO price_grid_drafts VALUES(${Q(id)},${Q(advanced||data.length>BASIC_GRID_LIMIT?'professional':'starter')},${Q(JSON.stringify(data))});`);
 return id;
}
export async function gridDraft(e:Engine,edits:GridEdit[],revision:string,actor:string,tier:Tier){
 if(!Array.isArray(edits)||!edits.length||edits.length>(tier==='starter'?BASIC_GRID_LIMIT:FULL_GRID_LIMIT)||new Set(edits.map(x=>x.key)).size!==edits.length||edits.some(x=>typeof x.key!=='string'||x.key.length>300||typeof x.price!=='string'))fail();
 if(tier==='starter'&&edits.some(x=>!x.key.startsWith('l:')))fail();
 const current=String((await rows(e,'SELECT pricing_revision::VARCHAR n FROM vault_meta WHERE id=1'))[0].n);if(revision!==current)fail('pc2.conflict');
 return store(e,actor,await changes(e,await selected(e,edits.map(x=>x.key)),edits),tier!=='starter'&&edits.some(x=>x.key.startsWith('m:')));
}
export async function gridData(e:Engine,id:string,tier:Tier){const r=(await rows(e,`SELECT * FROM price_grid_drafts WHERE run_id=${Q(id)}`))[0];if(!r)fail();if(tier==='starter'&&r.required_tier!=='starter')throw new VaultError('LICENCE',msg('ops.needPro'));return JSON.parse(r.rows_json) as Change[];}
export async function gridPreview(e:Engine,id:string,tier:Tier,offset=0,grid?:unknown):Promise<Preview>{
 const all=await gridData(e,id,tier),run=(await rows(e,`SELECT status FROM rule_runs WHERE id=${Q(id)}`))[0];offset=Math.max(0,Math.floor(offset));
 const q=gridQuery(PREVIEW_GRID,grid),cents=(v:string|null)=>v===null?null:String(v);
 const unit=(v:string,c:string|null)=>c===null?null:String(BigInt(v)-BigInt(c));
 const cols:ClientColumn<Change>[]=[{id:'product',type:'text',value:r=>r.product??r.category},{id:'tier',type:'text',value:r=>r.tier},{id:'before',type:'money',value:r=>cents(r.price)},{id:'after',type:'money',value:r=>cents(r.after)},{id:'cost',type:'money',value:r=>cents(r.cost)},{id:'quantity',type:'decimal',value:r=>r.quantity},{id:'impact',type:'money',value:r=>cents(r.impact)},{id:'guard',type:'text',value:r=>r.guard},{id:'before_margin',type:'money',value:r=>unit(r.price,r.cost)},{id:'after_margin',type:'money',value:r=>unit(r.after,r.cost)}];
 const paged=await memoryPage(e,all,cols,PREVIEW_GRID,q,{limit:50,offset});
 const margin=(v:string,c:string|null)=>{const m=lineFromCents({list:BigInt(v),cost:c===null?null:BigInt(c),discount:BigInt(0),freight:BigInt(0),rebate:BigInt(0)}).margin;return m===null?null:String(m);};
 return {id,count:String(all.length),impact:String(all.reduce((s,r)=>s+BigInt(r.impact),BigInt(0))),red:String(all.filter(r=>r.guard==='red').length),offset,explanation:msg('pc2.gridDraft'),status:run.status,ms:0,grid:paged.grid,rows:paged.rows.map(r=>({product:r.product??r.category,tier:r.tier,rowKey:r.key,scope:{customer:r.customer,tier:r.tier,quantity:r.quantityBreak,from:r.from,to:r.to,kind:r.key.startsWith('l:')?'list':'matrix'},before:r.price,after:r.after,cost:r.cost,quantity:r.quantity,impact:r.impact,guard:r.guard,beforeMargin:margin(r.price,r.cost),afterMargin:margin(r.after,r.cost)} as PriceRow))};
}
export async function gridApproval(e:Engine,id:string,tier:Tier){
 const data=await gridData(e,id,tier),current=await selected(e,data.map(r=>r.key)),sql:string[]=[];
 for(let i=0;i<data.length;i++){
  const r=data[i];if(JSON.stringify(current[i])!==JSON.stringify((({after,quantity,impact,guard,appliedKey,...before}:Change)=>before)(r)))fail('pc2.conflict');
  if(r.key.startsWith('l:'))sql.push(`UPDATE products SET list_price=${r.after} WHERE product_id=${Q(r.product!)};`);
  else if(r.from!>=day()){sql.push(`UPDATE price_matrix SET price=${r.after} WHERE id=${Q(r.key.slice(2))};`);}
  else{const from=day();sql.push(`UPDATE price_matrix SET valid_to=DATE ${Q(day())} WHERE id=${Q(r.key.slice(2))};`);
   sql.push(`INSERT INTO price_matrix(id,product_id,category,customer_id,tier,qty_break,price,valid_from,valid_to) VALUES(${Q(r.appliedKey.slice(2))},${nullable(r.product)},${nullable(r.rawCategory)},${nullable(r.customer)},${nullable(r.rawTier)},${Q(r.quantityBreak)}::DECIMAL(18,4),${r.after},DATE ${Q(from)},${r.to?'DATE '+Q(r.to):'NULL'});`);}
 }
 return sql.join('\n');
}
export async function gridRollback(e:Engine,version:string,actor:string,tier:Tier){
 const v=(await rows(e,`SELECT v.snapshot_id,r.run_date FROM price_versions v JOIN rule_runs r ON r.id=v.snapshot_id WHERE v.id=${Q(version)}`))[0];if(!v)return null;
 if(!String(v.snapshot_id).startsWith('grid-'))return null;
 const original=await gridData(e,v.snapshot_id,tier),current=await selected(e,original.map(r=>r.appliedKey));
 const scope=(r:GridRow)=>JSON.stringify([r.product,r.rawCategory,r.customer,r.rawTier,r.quantityBreak,r.from,r.to]);
 if(current.some((r,i)=>{const old=original[i],from=old.key.startsWith('l:')?null:old.from!>String(v.run_date).slice(0,10)?old.from:String(v.run_date).slice(0,10);return r.price!==old.after||scope(r)!==scope({...old,from});}))fail('pc2.conflict');
 return store(e,actor,await changes(e,current,original.map(r=>({key:r.appliedKey,price:String(BigInt(r.price)/BigInt(100))+'.'+String(BigInt(r.price)%BigInt(100)).padStart(2,'0')}))),original.some(r=>r.key.startsWith('m:')));
}
