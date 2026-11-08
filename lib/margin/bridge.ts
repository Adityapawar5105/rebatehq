import {salesInput} from '../rebate/input';
import type {Engine} from '../vault/engine';
import {VaultError} from '../vault/protocol';
import {sqlText as Q} from '../spike/exact';
import {POCKET,rhaSql} from './sql';
import {msg} from '../i18n/core';
import {gridPage,gridQuery} from '../grid/sql';
import type {GridMeta,GridSpec} from '../grid/core';
export const BRIDGE_GRID:GridSpec={key:'text',before:'money',after:'money',delta:'money',price:'money',volume:'money',mix:'money',cost:'money',unknown:'int'};
export type BridgeDim='product'|'customer'|'branch';
export type BridgeInput={month?:string;dim?:BridgeDim;value?:string;offset?:number;grid?:unknown};
export type BridgeAmounts={before:string;after:string;delta:string;price:string;volume:string;mix:string;cost:string;unknown:string};
export type BridgeView={month:string;previous:string;months:string[];totals:BridgeAmounts;count:string;offset:number;rows:(BridgeAmounts&{key:string})[];grid?:GridMeta};
const fields=['before','after','delta','price','volume','mix','cost','unknown'] as const;
export async function bridge(e:Engine,input:BridgeInput={}):Promise<BridgeView>{
 const months=(await e.conn.query("SELECT DISTINCT strftime(sale_date,'%Y-%m') AS m FROM sales_lines ORDER BY m DESC LIMIT 60")).toArray().map(r=>String(r.m));
 const month=input.month??months[0]??new Date().toISOString().slice(0,7),dim=input.dim??'product';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!['product','customer','branch'].includes(dim)||typeof input.value!=='undefined'&&(typeof input.value!=='string'||input.value.length>200))throw new VaultError('FILTER',msg('ops.invalidSelection'));
 const previous=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1)).toISOString().slice(0,7),offset=Math.max(0,Math.min(10000000,Math.floor(input.offset??0)));
 const key=dim==='product'?'product_id':dim==='customer'?'customer_id':'branch',filter=input.value===undefined?'':` AND ${dim==='product'?'s.product_id':dim==='customer'?'s.customer_id':'c.branch'}=${Q(input.value)}`;
 // Quantity is an integer at scale 10^4. Each costed product/customer/branch
 // cell is rounded once; mix is its exact residual. Credits and zero/new/lost
 // quantity cells therefore cannot break the reconciliation identity.
 const cte=`WITH b AS (SELECT s.product_id,s.customer_id,c.branch,
 coalesce(sum(CAST(quantity*10000 AS HUGEINT)) FILTER(WHERE cost_cents IS NOT NULL AND strftime(sale_date,'%Y-%m')=${Q(previous)}),0) q0,
 coalesce(sum(CAST(quantity*10000 AS HUGEINT)) FILTER(WHERE cost_cents IS NOT NULL AND strftime(sale_date,'%Y-%m')=${Q(month)}),0) q1,
 coalesce(sum(${POCKET}) FILTER(WHERE cost_cents IS NOT NULL AND strftime(sale_date,'%Y-%m')=${Q(previous)}),0)::HUGEINT p0,
 coalesce(sum(${POCKET}) FILTER(WHERE cost_cents IS NOT NULL AND strftime(sale_date,'%Y-%m')=${Q(month)}),0)::HUGEINT p1,
 coalesce(sum(cost_cents) FILTER(WHERE strftime(sale_date,'%Y-%m')=${Q(previous)}),0)::HUGEINT c0,
 coalesce(sum(cost_cents) FILTER(WHERE strftime(sale_date,'%Y-%m')=${Q(month)}),0)::HUGEINT c1,
 count(*) FILTER(WHERE cost_cents IS NULL)::HUGEINT "unknown"
 FROM ${await salesInput(e)} s JOIN customers c USING(customer_id) WHERE strftime(sale_date,'%Y-%m') IN (${Q(previous)},${Q(month)})${filter} GROUP BY s.product_id,s.customer_id,c.branch),
 q AS(SELECT coalesce(sum(q0),0)::HUGEINT t0,coalesce(sum(q1),0)::HUGEINT t1 FROM b),
 effects AS(SELECT b.*,p0-c0 AS before,p1-c1 AS after,(p1-c1)-(p0-c0) AS delta,
 CASE WHEN q0>0 AND q1>0 THEN ${rhaSql('p1*q0-q1*p0','q0')} ELSE 0 END price,
 CASE WHEN q0>0 AND q1>0 THEN ${rhaSql('q1*c0-c1*q0','q0')} ELSE 0 END AS "cost",
 CASE WHEN t0>0 THEN ${rhaSql('(t1-t0)*(p0-c0)','t0')} ELSE 0 END volume FROM b CROSS JOIN q),
 final AS(SELECT *,delta-price-"cost"-volume AS mix FROM effects)`;
 const totalsRow=(await e.conn.query(`${cte} SELECT ${fields.map(f=>`coalesce(sum("${f}"),0)::VARCHAR AS "${f}"`).join(',')} FROM final`)).toArray()[0] as unknown as BridgeAmounts;
 const totals={...totalsRow};
 const page=await gridPage(e,`${cte} SELECT ${key} AS key,${fields.map(f=>`sum("${f}")::VARCHAR AS "${f}"`).join(',')},abs(sum(delta)) AS order_n FROM final GROUP BY ${key}`,BRIDGE_GRID,gridQuery(BRIDGE_GRID,input.grid),{fallback:'g.order_n DESC,g.key',limit:50,offset});
 const rows=page.rows.map(({order_n:_,...r})=>r) as unknown as BridgeView['rows'];
 return {month,previous,months,totals,count:page.grid.matched,offset,rows,grid:page.grid};
}
