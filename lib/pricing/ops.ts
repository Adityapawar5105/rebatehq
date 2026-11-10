import type {Engine} from '../vault/engine';
import {VaultError} from '../vault/protocol';
import {gridPage,gridQuery} from '../grid/sql';
import type {GridSpec} from '../grid/core';
/** Grid columns (7V-3a) for the exceptions and expiry grids: output names and types only. */
export const EXCEPTION_GRID:GridSpec={source_file:'text',product_id:'text',customer_id:'text',quantity:'decimal',unit_price:'money',floor:'money',contract:'money',gap:'money'};
export const EXPIRY_GRID:GridSpec={product_id:'text',customer_id:'text',tier:'text',quantity_break:'decimal',valid_from:'date',valid_to:'date'};
import {sqlText as Q,validDate} from '../spike/exact';
import {rhaSql} from '../margin/sql';
import {dec,rescale,bpText} from '../margin/decimal';
import {resolvedBook} from './book';
import {msg,translate,isLocale,decimal,type Locale} from '../i18n/core';
export type Segment='tier'|'category'|'customer';
export type PlanInput={segment:Segment;value:string;increase:string};
export const OPS_LIMIT=250000;
const today=()=>new Date().toISOString().slice(0,10);
const rows=async(e:Engine,sql:string)=>(await e.conn.query(sql)).toArray().map(r=>({...r})) as Record<string,any>[];
async function scopeCap(e:Engine){if(BigInt(String((await rows(e,'SELECT count(*)::VARCHAR n FROM md_ops_base'))[0].n))>BigInt(OPS_LIMIT))throw new VaultError('PRICING',msg('ops.tooLarge'));}
const bad=():never=>{throw new VaultError('PRICING',msg('ops.invalidSelection'));};
const id=(s:string)=>typeof s==='string'&&s.length>0&&s.length<=200&&!/[\x00-\x1f]/.test(s)?s:bad();
export async function opsState(e:Engine){
 return {versions:await rows(e,"SELECT v.id,v.snapshot_id AS run,v.created_by AS actor,v.created_at,coalesce(o.kind,'rule') AS kind FROM price_versions v LEFT JOIN price_changesets o ON o.run_id=v.snapshot_id ORDER BY v.created_at DESC,v.id LIMIT 100"),
 segments:{tier:(await rows(e,"SELECT DISTINCT tier AS value FROM customers WHERE tier<>'' ORDER BY tier")).map(r=>String(r.value)),category:(await rows(e,"SELECT DISTINCT category AS value FROM products WHERE category<>'' ORDER BY category")).map(r=>String(r.value)),customer:(await rows(e,"SELECT customer_id AS value,name FROM customers ORDER BY customer_id")).map(r=>({id:String(r.value),name:String(r.name)}))}};
}
async function storeDraft(e:Engine,actor:string,kind:'planner'|'rollback'|'clearance',segment:Segment|'version'|'clearance',value:string,bp:string|null,version:string|null){
 const run='ops-'+crypto.randomUUID(),at=new Date().toISOString(),name=msg(kind==='planner'?'ops.planDescription':kind==='clearance'?'ops.clearanceDescription':'ops.rollbackDescription',{value}),count=String((await rows(e,'SELECT count(*)::VARCHAR AS n FROM md_ops_copy WHERE before_cents<>after_cents'))[0].n);
 if(BigInt(String((await rows(e,'SELECT count(*)::VARCHAR n FROM md_ops_copy'))[0].n))>BigInt(OPS_LIMIT))throw new VaultError('PRICING',msg('ops.tooLarge'));
 const definition=JSON.stringify({name,category:'',vendor:'',threshold:'0',increase:bp??'0'});
 await e.conn.query(`INSERT INTO rules VALUES(${Q(run)},${Q(name)},${Q(definition)},${Q(value)},${Q(at)});
 INSERT INTO rule_revisions VALUES(${Q(run)},1,${Q(definition)},${Q(name)},${Q(at)});
 INSERT INTO rule_runs(id,rule_id,run_date,affected_rows,status,rule_version,base_revision) SELECT ${Q(run)},${Q(run)},${Q(at)},${count},'preview',1,pricing_revision FROM vault_meta WHERE id=1;
 INSERT INTO price_changesets VALUES(${Q(run)},${Q(kind)},${version?Q(version):'NULL'},${Q(segment)},${Q(value)},${bp??'NULL'},${Q(actor)},${Q(at)});
 INSERT INTO rule_changes SELECT ${Q(run)},x.product_id,x.tier,x.before_cents,x.after_cents,x.current_cost,x.qty,
 CAST(${rhaSql('CAST(x.after_cents-x.before_cents AS HUGEINT)*CAST(x.qty*10000 AS HUGEINT)','10000')} AS BIGINT),
 CASE WHEN g.id IS NULL THEN 'unset' WHEN x.after_cents<g.floor THEN 'red' WHEN x.after_cents<g.target THEN 'yellow' ELSE 'green' END
 FROM md_ops_copy x LEFT JOIN price_guardrails g ON g.tier=x.tier AND g.category=x.category WHERE x.before_cents<>x.after_cents;
 INSERT INTO price_changeset_rows SELECT ${Q(run)},product_id,tier,customer_id,valid_to,matrix_tier FROM md_ops_copy WHERE before_cents<>after_cents;`);
 return run;
}
// Aggregate identical current-price lookup inputs before resolving observed quantities.
async function quantities(e:Engine,from:string,scope:string,customerScope:string){
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_history;DROP TABLE IF EXISTS temp.md_ops_units;
 CREATE TEMP TABLE md_ops_history AS SELECT row_number() OVER()::VARCHAR lookup_id,p.product_id,p.category,l.customer_id,coalesce(c.tier,'') AS tier,l.quantity,DATE ${Q(today())} AS as_of,
 ${scope} AS target_tier,${customerScope} AS customer_scope,sum(l.quantity)::DECIMAL(18,4) AS observed_qty FROM ${from} WHERE l.line_kind='sale'
 GROUP BY p.product_id,p.category,l.customer_id,c.tier,l.quantity,${scope},${customerScope};
 CREATE TEMP TABLE md_ops_units AS SELECT product_id,target_tier AS tier,coalesce(sum(observed_qty) FILTER(WHERE book_break=0 AND (customer_scope OR book_customer IS NULL)),0)::DECIMAL(18,4) qty
 FROM (${resolvedBook('SELECT * FROM md_ops_history')}) GROUP BY product_id,target_tier`);
}
export async function planDraft(e:Engine,input:PlanInput,actor:string){
 if(!['tier','category','customer'].includes(input.segment))bad();const value=id(input.value);
 if(!/^\d{1,3}(\.\d{1,2})?$/.test(input.increase))bad();const bp=rescale(dec(input.increase),2).v;if(bp<=BigInt(0)||bp>BigInt(10000))bad();
 let customer:string|null=null,tier:string|null=null;
 if(input.segment==='customer'){const found=await rows(e,`SELECT coalesce(tier,'') AS tier FROM customers WHERE customer_id=${Q(value)}`);if(!found.length)bad();customer=value;tier=String(found[0].tier);}
 if(input.segment==='tier')tier=value;
 const cust=customer?Q(customer):'NULL',tierExpr=tier!==null?Q(tier):"coalesce(h.tier,'')";
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_products;CREATE TEMP TABLE md_ops_products AS SELECT * FROM products ${input.segment==='category'?`WHERE category=${Q(value)}`:''}`);
 await quantities(e,`sales_lines l JOIN md_ops_products p USING(product_id) JOIN customers c ON c.customer_id=l.customer_id ${customer?`AND c.customer_id=${Q(customer)}`:tier!==null?`AND coalesce(c.tier,'')=${Q(tier)}`:''}`,"coalesce(c.tier,'')",customer?'true':'false');
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_base;DROP TABLE IF EXISTS temp.md_ops_copy;
 CREATE TEMP TABLE md_ops_base AS SELECT row_number() OVER()::VARCHAR lookup_id,p.*,${cust}::VARCHAR customer_id,${tierExpr} AS tier,0::DECIMAL(18,4) AS quantity,DATE ${Q(today())} AS as_of,coalesce(h.qty,0)::DECIMAL(18,4) AS qty FROM md_ops_products p LEFT JOIN md_ops_units h ON h.product_id=p.product_id LIMIT ${OPS_LIMIT+1}`);
 await scopeCap(e);
 await e.conn.query(`CREATE TEMP TABLE md_ops_copy AS WITH b AS(${resolvedBook('SELECT * FROM md_ops_base')}),base AS(SELECT product_id,category,current_cost,tier,customer_id,qty,coalesce(book_price,list_price) AS before_cents,book_valid_to AS valid_to,
 CASE WHEN customer_id IS NOT NULL THEN CASE WHEN book_customer IS NOT NULL THEN book_tier ELSE NULL END ELSE tier END AS matrix_tier FROM b)
 SELECT *,CAST(${rhaSql(`CAST(before_cents AS HUGEINT)*(10000+${bp})`,'10000')} AS BIGINT) AS after_cents FROM base WHERE before_cents IS NOT NULL`);
 return storeDraft(e,actor,'planner',input.segment,value,String(bp),null);
}
/** 8B-2: clearance prices for dead stock, picked in the worker (lib/inventory/deadstock). For each item and each tier it
 * sold to (or its list price row when it never sold), the new price is the clearance price, kept at or above the tier's
 * guardrail floor and never above the current price; unchanged rows are left out. Approval and export are the normal path. */
export async function clearanceDraft(e:Engine,picks:{product_id:string;suggested:string}[],actor:string){
 if(!Array.isArray(picks)||!picks.length||picks.length>OPS_LIMIT)throw new VaultError('DEADSTOCK',msg('dead.noneToDraft'));
 const values=picks.map(p=>{if(!/^(0|[1-9]\d{0,15})$/.test(p.suggested))bad();return `(${Q(id(p.product_id))},${p.suggested})`;}).join(',');
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_clearance;CREATE TEMP TABLE md_ops_clearance(product_id VARCHAR PRIMARY KEY,suggested BIGINT NOT NULL);INSERT INTO md_ops_clearance VALUES ${values};
 DROP TABLE IF EXISTS temp.md_ops_products;CREATE TEMP TABLE md_ops_products AS SELECT p.* FROM products p JOIN md_ops_clearance USING(product_id)`);
 await quantities(e,'sales_lines l JOIN md_ops_products p USING(product_id) JOIN customers c ON c.customer_id=l.customer_id',"coalesce(c.tier,'')",'false');
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_base;DROP TABLE IF EXISTS temp.md_ops_copy;
 CREATE TEMP TABLE md_ops_base AS SELECT row_number() OVER()::VARCHAR lookup_id,p.*,NULL::VARCHAR customer_id,coalesce(h.tier,'') AS tier,0::DECIMAL(18,4) AS quantity,DATE ${Q(today())} AS as_of,coalesce(h.qty,0)::DECIMAL(18,4) AS qty FROM md_ops_products p LEFT JOIN md_ops_units h ON h.product_id=p.product_id LIMIT ${OPS_LIMIT+1}`);
 await scopeCap(e);
 await e.conn.query(`CREATE TEMP TABLE md_ops_copy AS WITH b AS(${resolvedBook('SELECT * FROM md_ops_base')}),base AS(SELECT product_id,category,current_cost,tier,customer_id,qty,coalesce(book_price,list_price) AS before_cents,book_valid_to AS valid_to,tier AS matrix_tier FROM b)
 SELECT base.*,least(base.before_cents,greatest(k.suggested,coalesce(g.floor,0))) AS after_cents FROM base JOIN md_ops_clearance k USING(product_id) LEFT JOIN price_guardrails g ON g.tier=base.tier AND g.category=base.category WHERE base.before_cents IS NOT NULL`);
 if((await rows(e,'SELECT count(*)::VARCHAR n FROM md_ops_copy WHERE before_cents<>after_cents'))[0].n==='0')throw new VaultError('DEADSTOCK',msg('dead.noneToDraft'));
 return storeDraft(e,actor,'clearance','clearance',String(picks.length),null,null);
}
export async function rollbackDraft(e:Engine,version:string,actor:string){
 const v=(await rows(e,`SELECT snapshot_id FROM price_versions WHERE id=${Q(id(version))}`))[0];if(!v)bad();
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_reverse;CREATE TEMP TABLE md_ops_reverse AS SELECT x.product_id,x.tier,x.before_cents,x.after_cents,p.category,p.current_cost,p.list_price,d.customer_id,d.valid_to,CASE WHEN d.run_id IS NOT NULL THEN d.matrix_tier ELSE x.tier END AS matrix_tier
 FROM rule_changes x JOIN products p USING(product_id) LEFT JOIN price_changeset_rows d ON d.run_id=x.run_id AND d.product_id=x.product_id AND d.tier=x.tier WHERE x.run_id=${Q(v.snapshot_id)} LIMIT ${OPS_LIMIT+1}`);
 await quantities(e,`md_ops_reverse p JOIN sales_lines l USING(product_id) JOIN customers c ON c.customer_id=l.customer_id AND (p.customer_id IS NOT NULL AND c.customer_id=p.customer_id OR p.customer_id IS NULL AND coalesce(c.tier,'')=p.tier)`,'p.tier','p.customer_id IS NOT NULL');
 await e.conn.query(`DROP TABLE IF EXISTS temp.md_ops_base;DROP TABLE IF EXISTS temp.md_ops_copy;
 CREATE TEMP TABLE md_ops_base AS SELECT row_number() OVER()::VARCHAR lookup_id,p.*,0::DECIMAL(18,4) AS quantity,DATE ${Q(today())} AS as_of FROM md_ops_reverse p`);
 await scopeCap(e);
 await e.conn.query(`CREATE TEMP TABLE md_ops_copy AS SELECT b.product_id,b.category,b.current_cost,b.tier,coalesce(h.qty,0)::DECIMAL(18,4) qty,b.customer_id,b.valid_to,b.matrix_tier,
 coalesce(b.book_price,b.list_price) AS before_cents,b.before_cents AS after_cents,b.after_cents AS expected
 FROM (${resolvedBook('SELECT * FROM md_ops_base')}) b LEFT JOIN md_ops_units h ON h.product_id=b.product_id AND h.tier=b.tier`);
 if((await rows(e,`SELECT count(*)::VARCHAR n FROM md_ops_copy WHERE before_cents IS DISTINCT FROM expected OR valid_to<=DATE ${Q(today())}`))[0].n!=='0')throw new VaultError('CONFLICT',msg('ops.rollbackConflict'));
 return storeDraft(e,actor,'rollback','version',version,null,version);
}
/** Used only by the existing owner approval path, never by a draft/read command. */
export async function approvalMatrixSql(e:Engine,run:string){
 const meta=(await rows(e,`SELECT kind FROM price_changesets WHERE run_id=${Q(run)}`))[0];if(!meta)return undefined;
 const input=`SELECT row_number() OVER()::VARCHAR lookup_id,p.product_id,p.category,p.list_price,d.customer_id,x.tier,0::DECIMAL(18,4) quantity,DATE ${Q(today())} as_of,x.before_cents,d.valid_to
 FROM rule_changes x JOIN products p USING(product_id) JOIN price_changeset_rows d ON d.run_id=x.run_id AND d.product_id=x.product_id AND d.tier=x.tier WHERE x.run_id=${Q(run)}`;
 const changed=await rows(e,`SELECT product_id FROM (${resolvedBook(input)}) WHERE coalesce(book_price,list_price) IS DISTINCT FROM before_cents OR valid_to<=DATE ${Q(today())} LIMIT 1`);
 if(changed.length)throw new VaultError('CONFLICT',msg('ops.rollbackConflict'));
 const same=`m.product_id=d.product_id AND m.tier IS NOT DISTINCT FROM d.matrix_tier AND m.customer_id IS NOT DISTINCT FROM d.customer_id AND m.qty_break=0`;
 return `UPDATE price_matrix m SET valid_to=DATE ${Q(today())} FROM price_changeset_rows d WHERE d.run_id=${Q(run)} AND ${same} AND m.valid_from<DATE ${Q(today())} AND (m.valid_to IS NULL OR m.valid_to>DATE ${Q(today())});
 DELETE FROM price_matrix m USING price_changeset_rows d WHERE d.run_id=${Q(run)} AND ${same} AND m.valid_from=DATE ${Q(today())};
 INSERT INTO price_matrix(id,product_id,tier,customer_id,price,valid_from,valid_to) SELECT ${Q(run)}||':'||row_number() OVER(ORDER BY x.product_id,x.tier),x.product_id,d.matrix_tier,d.customer_id,x.after_cents,DATE ${Q(today())},d.valid_to FROM rule_changes x JOIN price_changeset_rows d ON d.run_id=x.run_id AND d.product_id=x.product_id AND d.tier=x.tier WHERE x.run_id=${Q(run)};`;
}
export async function exportCustomer(e:Engine,run:string){const r=await rows(e,`SELECT DISTINCT customer_id FROM price_changeset_rows WHERE run_id=${Q(run)} AND customer_id IS NOT NULL`);return r.length?String(r[0].customer_id):undefined;}
export async function increaseLetter(e:Engine,run:string,locale:Locale){
 if(!isLocale(locale))bad();const m=(await rows(e,`SELECT * FROM price_changesets WHERE run_id=${Q(id(run))} AND kind='planner'`))[0];if(!m)bad();
 const body=translate(locale,'ops.letterBody',{segment:m.segment_value,rate:decimal(locale,bpText(BigInt(String(m.increase_bp)))),date:new Intl.DateTimeFormat(locale==='pseudo'?'en-US':locale,{dateStyle:'long',timeZone:'UTC'}).format(new Date())});
 return {name:'rebatehq-price-increase.txt',blob:new Blob([body],{type:'text/plain;charset=utf-8'})};
}
export type ExceptionInput={customer?:string;product?:string;from?:string;to?:string;offset?:number;grid?:unknown};
export async function exceptions(e:Engine,input:ExceptionInput={}){
 try{if(input.from)validDate(input.from);if(input.to)validDate(input.to);if(input.from&&input.to&&input.from>=input.to)bad();}catch{bad();}
 const where=[input.from?`AND l.sale_date>=DATE ${Q(input.from)}`:'',input.to?`AND l.sale_date<DATE ${Q(input.to)}`:'',input.customer?`AND l.customer_id=${Q(id(input.customer))}`:'',input.product?`AND l.product_id=${Q(id(input.product))}`:''].join(' '),offset=Math.max(0,Math.min(10000000,Math.floor(input.offset??0)));
 const inputSql=`SELECT row_number() OVER()::VARCHAR lookup_id,l.*,p.category,c.tier,c.branch,f.name AS source_file,g.floor,l.sale_date AS as_of FROM sales_lines l JOIN products p USING(product_id) JOIN customers c USING(customer_id) JOIN source_files f ON f.id=l.source_id
 LEFT JOIN price_guardrails g ON g.tier=c.tier AND g.category=p.category WHERE l.line_kind='sale' ${where}`;
 const cte=`WITH b AS(SELECT *,book_price AS contract,matrix_id AS contract_id,(list_cents-discount_cents) AS selling,CAST(quantity*10000 AS HUGEINT) AS qty FROM (${resolvedBook(inputSql,true)})),x AS(SELECT *,floor IS NOT NULL AND CAST(selling AS HUGEINT)*10000<CAST(floor AS HUGEINT)*qty AS below_floor,contract IS NOT NULL AND CAST(selling AS HUGEINT)*10000<CAST(contract AS HUGEINT)*qty AS below_contract,
 greatest(coalesce(${rhaSql('CAST(floor AS HUGEINT)*qty','10000')}-selling,0),coalesce(${rhaSql('CAST(contract AS HUGEINT)*qty','10000')}-selling,0),0) AS gap FROM b),hit AS(SELECT * FROM x WHERE below_floor OR below_contract)`;
 const total=(await rows(e,`${cte} SELECT count(*)::VARCHAR count,coalesce(sum(gap),0)::VARCHAR gap,count(*) FILTER(WHERE below_floor)::VARCHAR floor_count,count(*) FILTER(WHERE below_contract)::VARCHAR contract_count FROM hit`))[0];
 const q=gridQuery(EXCEPTION_GRID,input.grid);
 const base=`${cte} SELECT source_id,source_file,source_row::VARCHAR source_row,line_id::VARCHAR line_id,invoice_id,product_id,customer_id,branch,sale_date::VARCHAR date,quantity::VARCHAR quantity,selling::VARCHAR selling,CAST(${rhaSql('CAST(selling AS HUGEINT)*10000','qty')} AS BIGINT)::VARCHAR unit_price,floor::VARCHAR floor,contract::VARCHAR contract,contract_id,below_floor,below_contract,gap::VARCHAR gap,gap AS gap_order FROM hit`;
 const page=await gridPage(e,base,EXCEPTION_GRID,q,{fallback:'g.gap_order DESC,g.source_id,g.line_id',limit:50,offset});
 return {total,rows:page.rows.map(({gap_order:_,...r})=>r) as Record<string,any>[],offset,grid:page.grid};
}
export async function expiry(e:Engine,days:number,asOf=today(),offset=0,grid?:unknown){
 if(![30,60,90].includes(days))bad();try{validDate(asOf);}catch{bad();}offset=Math.max(0,Math.min(10000000,Math.floor(offset)));
 const where=`valid_to>=DATE ${Q(asOf)} AND valid_to<=DATE ${Q(asOf)}+INTERVAL '${days} days'`;
 const q=gridQuery(EXPIRY_GRID,grid);
 const page=await gridPage(e,`SELECT id,product_id,category,customer_id,tier,qty_break::VARCHAR quantity_break,price::VARCHAR price,valid_from::VARCHAR valid_from,valid_to::VARCHAR valid_to FROM price_matrix WHERE ${where}`,EXPIRY_GRID,q,{fallback:'CAST(g.valid_to AS DATE),g.id',limit:50,offset});
 return {count:page.grid.total,rows:page.rows as Record<string,any>[],offset,days,asOf,grid:page.grid};
}
