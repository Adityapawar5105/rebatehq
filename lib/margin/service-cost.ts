import type {Engine} from '../vault/engine';
import {MARGIN} from './sql';
import {rows} from '../pricing/rules';
import {fail} from '../pricing/grid';
import {sqlText as Q} from '../spike/exact';
export const SMALL_ORDER_CENTS='25000';
/** File + invoice + customer + date; missing invoice IDs remain separate lines. */
export const invoiceKey=(alias='s')=>`length(${alias}.source_id)::VARCHAR||':'||${alias}.source_id||'|'||CASE WHEN ${alias}.invoice_id IS NULL THEN 'N'||${alias}.line_id::VARCHAR ELSE 'V'||length(${alias}.invoice_id)::VARCHAR||':'||${alias}.invoice_id END||'|'||length(${alias}.customer_id)::VARCHAR||':'||${alias}.customer_id||'|'||${alias}.sale_date::VARCHAR`;
export const SERVICE_ORDERS=`SELECT ${invoiceKey()} invoice_key,any_value(s.source_id) source_id,any_value(s.invoice_id) invoice_id,any_value(s.customer_id) customer_id,any_value(s.sale_date)::VARCHAR sale_date,count(*) lines,count(s.cost_cents) costed,sum(s.list_cents-s.discount_cents) net,sum(s.freight_cents) freight,sum(${MARGIN}) margin FROM sales_lines s WHERE s.line_kind='sale' GROUP BY 1`;
export async function serviceOrders(e:Engine,offset=0){
 offset=Math.max(0,Math.floor(offset));return rows(e,`SELECT o.invoice_key,o.source_id,o.invoice_id,o.customer_id,o.sale_date,o.net::VARCHAR net,o.freight::VARCHAR freight,o.margin::VARCHAR margin,coalesce(f.free_delivery,false) free_delivery FROM (${SERVICE_ORDERS})o LEFT JOIN sales_service_flags f USING(invoice_key) WHERE o.freight>0 AND o.costed=o.lines AND o.margin<0 AND o.margin+o.freight>=0 ORDER BY o.margin,o.invoice_key LIMIT 50 OFFSET ${offset}`);
}
export async function serviceFlagSql(e:Engine,key:string,free:boolean,actor:string){
 if(typeof key!=='string'||key.length>1200||typeof free!=='boolean')fail();
 if(!(await rows(e,`SELECT invoice_key FROM (${SERVICE_ORDERS})o WHERE invoice_key=${Q(key)}`)).length)fail();
 return `DELETE FROM sales_service_flags WHERE invoice_key=${Q(key)};INSERT INTO sales_service_flags VALUES(${Q(key)},${free},${Q(actor)},${Q(new Date().toISOString())});`;
}
export const SERVICE_LEAK_SQL=`DROP TABLE IF EXISTS temp.lf_service_alloc;
CREATE TEMP TABLE lf_service_alloc AS WITH orders AS(${SERVICE_ORDERS}),qualifying AS(SELECT o.*,coalesce(f.free_delivery,false) free_delivery FROM orders o LEFT JOIN sales_service_flags f USING(invoice_key) WHERE o.costed=o.lines AND o.margin<0 AND o.freight>0 AND o.margin+o.freight>=0),
weights AS(SELECT l.sid,l.line_id,o.invoice_key,-o.margin AS loss,-l.margin AS weight,o.net<=${SMALL_ORDER_CENTS} AS small,o.free_delivery FROM lf_lines l JOIN qualifying o ON o.invoice_key=${invoiceKey('l')} WHERE l.margin<0),
cumulative AS(SELECT *,sum(weight) OVER(PARTITION BY invoice_key) total,sum(weight) OVER(PARTITION BY invoice_key ORDER BY sid,line_id ROWS UNBOUNDED PRECEDING) cumulative FROM weights)
SELECT *,CAST((CAST(loss AS HUGEINT)*cumulative)//total-(CAST(loss AS HUGEINT)*(cumulative-weight))//total AS BIGINT) allocation FROM cumulative;
INSERT INTO lf_keys VALUES(hash('small_order_loss|all'),'small_order_loss|all','small_order_loss'),(hash('free_delivery_loss|all'),'free_delivery_loss|all','free_delivery_loss');
INSERT INTO lf_hits SELECT hash('small_order_loss|all'),sid,line_id,allocation,NULL FROM lf_service_alloc WHERE small AND allocation>0;
INSERT INTO lf_hits SELECT hash('free_delivery_loss|all'),sid,line_id,allocation,NULL FROM lf_service_alloc WHERE free_delivery AND allocation>0;`;
