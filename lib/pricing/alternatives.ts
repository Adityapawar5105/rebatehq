import {salesInput} from '../rebate/input';
import type {Engine} from '../vault/engine';
import {rows} from './rules';
import {resolvedBook} from './book';
import {sqlText as Q,validDate} from '../spike/exact';
import {rhaSql} from '../margin/sql';
import {businessToday} from '../vault/today';
export type Alternative={product:string;description:string;unit:string;price:string;freight:string;rebate:string;cost:string;pocket:string;margin:string;lines:string};
/** A one-unit estimate, not a quote: current resolved selling price less the
 * customer's historical per-unit freight, off-invoice rebate and known cost.
 * No extra discount: the resolved selling price already includes book discounts.
 * Incomplete cost, zero quantity or missing prices are excluded, never guessed. */
export async function alternatives(e:Engine,product:string,customer:string,today=businessToday()):Promise<Alternative[]>{
 validDate(today);
 const inputs=`SELECT p.product_id lookup_id,p.product_id,p.category,c.customer_id,c.tier,1::DECIMAL(18,4) quantity,DATE ${Q(today)} as_of,p.description,p.uom,p.list_price
 FROM products p JOIN customers c ON c.customer_id=${Q(customer)}
 WHERE p.product_id<>${Q(product)} AND p.category<>'' AND p.category=(SELECT category FROM products WHERE product_id=${Q(product)})`;
 const result=await rows(e,`WITH book AS(${resolvedBook(inputs)}),pieces AS(
 SELECT product_id,quantity,lines,costed_lines,cost_cents,freight_cents,rebate_cents FROM agg_cpm WHERE customer_id=${Q(customer)} AND line_kind='sale' AND month<date_trunc('month',DATE ${Q(today)})
 UNION ALL SELECT product_id,sum(quantity),count(*),count(cost_cents),sum(cost_cents),sum(freight_cents),sum(rebate_cents) FROM ${await salesInput(e)} WHERE customer_id=${Q(customer)} AND line_kind='sale' AND sale_date>=date_trunc('month',DATE ${Q(today)}) AND sale_date<=DATE ${Q(today)} GROUP BY product_id),hist AS(
 SELECT product_id,sum(quantity) qty,sum(lines) lines,sum(costed_lines) costed,sum(cost_cents) AS cost,sum(freight_cents) AS freight,sum(rebate_cents) AS rebate FROM pieces GROUP BY product_id),
 units AS(SELECT b.product_id product,b.description,b.uom unit,coalesce(b.book_price,b.list_price) price,h.lines,
 ${rhaSql('CAST(h.freight AS HUGEINT)*10000','CAST(h.qty*10000 AS HUGEINT)')} freight,
 ${rhaSql('CAST(h.rebate AS HUGEINT)*10000','CAST(h.qty*10000 AS HUGEINT)')} rebate,
 ${rhaSql('CAST(h.cost AS HUGEINT)*10000','CAST(h.qty*10000 AS HUGEINT)')} AS cost
 FROM book b JOIN hist h USING(product_id) WHERE h.qty>0 AND h.lines=h.costed AND coalesce(b.book_price,b.list_price) IS NOT NULL),
 scored AS(SELECT *,price-freight-rebate pocket,price-freight-rebate-cost margin FROM units)
 SELECT product,description,unit,price::VARCHAR price,freight::VARCHAR freight,rebate::VARCHAR rebate,cost::VARCHAR AS cost,pocket::VARCHAR pocket,margin::VARCHAR margin,lines::VARCHAR lines
 FROM scored ORDER BY margin DESC,product ASC LIMIT 3`);
 return result as Alternative[];
}
