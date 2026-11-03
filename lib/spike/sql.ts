import {MAX_LINES,MAX_PRODUCTS,SpikeError} from "./exact";
export const SALES_COLUMNS="line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_file";
export function generatorSql(start:number,end:number,products:number,total:number){
 if(![start,end,products,total].every(Number.isSafeInteger)||start<0||end>total||end<=start||total>MAX_LINES||products<1||products>MAX_PRODUCTS)throw new SpikeError("Generator size is outside the spike limits.");
 return `INSERT INTO sales_lines
 WITH base AS (SELECT i+1 AS line_id, (i%${products})+1 AS product_id, (i*13%2000)+1 AS customer_id,
  (DATE '2024-01-01'+INTERVAL (least(23,(i*24)//${total})) MONTH)::DATE AS sale_date,
  (i%5)+1 AS quantity, i FROM range(${start},${end}) t(i)),
 amounts AS (SELECT b.*,p.list_cents*b.quantity AS l,p.cost_cents*b.quantity AS c FROM base b JOIN products p USING(product_id))
 SELECT line_id,product_id,customer_id,sale_date,quantity,l,(l*(i%21))//100,100+(i%599),
  CASE WHEN i%7=0 THEN (l*2)//100 ELSE 0 END,c,'synthetic' FROM amounts ORDER BY customer_id,sale_date,line_id`;
}
export const productSql=(products:number)=>`INSERT INTO products SELECT i+1,'SKU-'||lpad((i+1)::VARCHAR,6,'0'),10000+(i%997)*29,6000+(i%991)*23 FROM range(${products}) t(i)`;
export function waterfallSql(product=0,customer=0,source:"synthetic"|"all"="all"){
 if(!Number.isInteger(product)||product<0||product>MAX_PRODUCTS||!Number.isInteger(customer)||customer<0||customer>2_000_000_000)throw new SpikeError("Choose valid product/customer IDs.");
 return `SELECT count(*)::VARCHAR AS lines,sum(list_cents)::VARCHAR AS list,sum(discount_cents)::VARCHAR AS discounts,
 sum(freight_cents)::VARCHAR AS freight,sum(rebate_cents)::VARCHAR AS rebates,
 sum(list_cents-discount_cents-freight_cents-rebate_cents)::VARCHAR AS pocket,
 sum(cost_cents)::VARCHAR AS cost,sum(list_cents-discount_cents-freight_cents-rebate_cents-cost_cents)::VARCHAR AS margin
 FROM sales_lines WHERE (${product}=0 OR product_id=${product}) AND (${customer}=0 OR customer_id=${customer}) ${source==="synthetic"?"AND source_file='synthetic'":""}`;
}
export const simulationSql=(targetOnly=false)=>`CREATE OR REPLACE TEMP TABLE simulation AS
 SELECT *,((list_cents*1045+500)//1000)::BIGINT AS raised_list_cents FROM sales_lines
 ${targetOnly?"WHERE product_id<=100000 AND sale_date<DATE '2025-01-01'":""}`;
export const summarySimulationSql=`SELECT count(*)::VARCHAR AS lines,sum(raised_list_cents-list_cents)::VARCHAR AS increase,
 sum(raised_list_cents-discount_cents-freight_cents-rebate_cents-cost_cents)::VARCHAR AS margin FROM simulation`;
