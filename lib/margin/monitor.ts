import {salesInput} from '../rebate/input';
import type {Engine} from '../vault/engine';
import {sqlText as Q,validDate} from '../spike/exact';
import {rows} from '../pricing/rules';
import {invoiceKey} from './service-cost';
import {POCKET,rateBpSql} from './sql';
import {VaultError} from '../vault/protocol';
import {msg} from '../i18n/core';

/** UTC calendar days: today is included, tomorrow excluded. No invoice-date anchoring. */
export function monitoringWindow(today=new Date().toISOString().slice(0,10)){
 validDate(today);const day=(offset:number)=>new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
 return {priorFrom:day(-179),from:day(-89),to:day(1)};
}
export type HealthPeriod={pocket:string;cost:string;list:string;discount:string;lines:string;costed:string;orders:string;rate:string|null;discountBp:string|null};
export type CustomerAlert={customer:string;name:string;marginDrop:boolean;frequencyDrop:boolean;before:HealthPeriod;after:HealthPeriod};
export type CustomerHealth={window:ReturnType<typeof monitoringWindow>;thresholdBp:string;alerts:CustomerAlert[];count:string;missingInvoiceIds:string};
/** Complete months use agg_cm. Only partial boundary months read the invoice lines.
 * Sales only; credits are not orders. Rates use known-cost pocket; incomplete cost
 * coverage suppresses the margin rule. Order identity matches the service-cost finder. */
export async function customerHealth(e:Engine,thresholdBp='500',today?:string):Promise<CustomerHealth>{
 if(typeof thresholdBp!=='string'||!/^\d{1,5}$/.test(thresholdBp)||BigInt(thresholdBp)>BigInt(10000))throw new VaultError('INPUT',msg('monitor.badThreshold'));
 const window=monitoringWindow(today),w=`SELECT 'before' period,DATE ${Q(window.priorFrom)} lo,DATE ${Q(window.from)} hi UNION ALL SELECT 'after',DATE ${Q(window.from)},DATE ${Q(window.to)}`;
 const input=await salesInput(e);
 const raw=await rows(e,`WITH windows AS(${w}), pieces AS(
 SELECT a.customer_id,w.period,a.lines,a.costed_lines,a.costed_pocket_cents pocket,a.cost_cents AS cost,a.list_cents AS list,a.discount_cents discount
 FROM agg_cm a JOIN windows w ON a.month>=w.lo AND a.month+INTERVAL '1 month'<=w.hi WHERE a.line_kind='sale'
 UNION ALL SELECT s.customer_id,w.period,count(*),count(s.cost_cents),coalesce(sum(${POCKET}) FILTER(WHERE s.cost_cents IS NOT NULL),0),coalesce(sum(s.cost_cents),0),sum(s.list_cents),sum(s.discount_cents)
 FROM ${input} s JOIN windows w ON s.sale_date>=w.lo AND s.sale_date<w.hi
 WHERE s.line_kind='sale' AND NOT(date_trunc('month',s.sale_date)>=w.lo AND date_trunc('month',s.sale_date)+INTERVAL '1 month'<=w.hi) GROUP BY s.customer_id,w.period),
 totals AS(SELECT customer_id,period,sum(lines) lines,sum(costed_lines) costed,sum(pocket) pocket,sum(cost) AS cost,sum(list) AS list,sum(discount) AS discount FROM pieces GROUP BY customer_id,period),
 orders AS(SELECT s.customer_id,w.period,count(DISTINCT ${invoiceKey()}) orders FROM sales_lines s JOIN windows w ON s.sale_date>=w.lo AND s.sale_date<w.hi WHERE s.line_kind='sale' GROUP BY s.customer_id,w.period),
 paired AS(SELECT c.customer_id,c.name,b.pocket bp,b.cost bc,b.list bl,b.discount bd,b.lines bn,b.costed bk,coalesce(bo.orders,0) bo,
 coalesce(a.pocket,0) ap,coalesce(a.cost,0) ac,coalesce(a.list,0) al,coalesce(a.discount,0) ad,coalesce(a.lines,0) an,coalesce(a.costed,0) ak,coalesce(ao.orders,0) ao
 FROM totals b JOIN customers c USING(customer_id) LEFT JOIN totals a ON a.customer_id=b.customer_id AND a.period='after'
 LEFT JOIN orders bo ON bo.customer_id=b.customer_id AND bo.period='before' LEFT JOIN orders ao ON ao.customer_id=b.customer_id AND ao.period='after' WHERE b.period='before'),
 rules AS(SELECT *,
 (bn=bk AND an=ak AND bn>0 AND an>0 AND bp>0 AND ap>0 AND ((bp-bc)*ap-(ap-ac)*bp)*10000>CAST(${thresholdBp} AS HUGEINT)*bp*ap) margin_drop,
 (ao<bo AND bl>0 AND al>0 AND ad*bl>bd*al) frequency_drop FROM paired)
 SELECT *,count(*) OVER()::VARCHAR AS alert_count,CASE WHEN bn=bk THEN ${rateBpSql('bp-bc','bp')}::VARCHAR END before_rate,CASE WHEN an=ak THEN ${rateBpSql('ap-ac','ap')}::VARCHAR END after_rate,
 ${rateBpSql('bd','bl')}::VARCHAR before_discount,${rateBpSql('ad','al')}::VARCHAR after_discount
 FROM rules WHERE margin_drop OR frequency_drop ORDER BY customer_id LIMIT 50`);
 const data=raw.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v==null?null:String(v)])));
 const alerts=data.slice(0,50).map(r=>{
  const period=(p:'b'|'a'):HealthPeriod=>({pocket:String(r[p+'p']),cost:String(r[p+'c']),list:String(r[p+'l']),discount:String(r[p+'d']),lines:String(r[p+'n']),costed:String(r[p+'k']),orders:String(r[p+'o']),rate:r[p==='b'?'before_rate':'after_rate'],discountBp:r[p==='b'?'before_discount':'after_discount']});
  return {customer:String(r.customer_id),name:String(r.name),marginDrop:r.margin_drop==='true',frequencyDrop:r.frequency_drop==='true',before:period('b'),after:period('a')};
 });
 const missing=(await rows(e,`SELECT count(*)::VARCHAR n FROM sales_lines WHERE line_kind='sale' AND invoice_id IS NULL AND sale_date>=DATE ${Q(window.priorFrom)} AND sale_date<DATE ${Q(window.to)}`))[0].n;
 return {window,thresholdBp,alerts,count:String(data[0]?.alert_count??'0'),missingInvoiceIds:missing};
}
