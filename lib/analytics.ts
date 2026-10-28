import type { PoolClient } from "pg";
import { MarginEngine } from "@/lib/margin";
import { engineProduct, type DbProduct } from "@/lib/margin";

type SourceRow={order_id:string;source_id:string;customer_id:string;customer_name:string;tier:string|null;group_id:string|null;product_id:string;sku:string;product_name:string;category:string;supplier:string|null;uom:string|null;unit_cost:string|number;freight_cost:string|number;payment_terms_cost:string|number;list_price:string|number;tier_prices:Record<string,number>;quantity:string|number;discount_pct:string|number;off_invoice_rebate_pct:string|number;freight_per_unit:string|number;payment_terms_per_unit:string|number;month_key:string;transaction_date:string;currency:string};
export async function getMonthlyWaterfall(db:PoolClient,tenantId:string,month:string){
 const config=(await db.query<{currency:string;default_cost_basis:string}>("SELECT currency,default_cost_basis FROM tenant WHERE tenant_id=$1",[tenantId])).rows[0];
 if(!config)throw new Error("Workspace currency and cost basis are unavailable.");
 const rows=(await db.query<SourceRow>(`SELECT o.id AS order_id,o.source_id,o.customer_id,c.name AS customer_name,c.tier,c.group_id,p.id AS product_id,p.sku,p.name AS product_name,p.category,p.supplier,p.uom,p.unit_cost,p.freight_cost,p.payment_terms_cost,p.list_price,p.tier_prices,o.quantity,o.discount_pct,o.off_invoice_rebate_pct,o.freight_per_unit,o.payment_terms_per_unit,o.month_key,o.transaction_date::text AS transaction_date,o.currency
 FROM sales_order o JOIN customer c ON c.tenant_id=o.tenant_id AND c.id=o.customer_id JOIN product p ON p.tenant_id=o.tenant_id AND p.id=o.product_id
 WHERE o.tenant_id=$1 AND o.month_key=$2 ORDER BY o.source_id`,[tenantId,month])).rows;
 const ids=[...new Set(rows.map(row=>row.product_id))];
 const costHistory=ids.length?(await db.query("SELECT product_id,cost,basis,effective_from::text AS effective_from,effective_to::text AS effective_to,currency FROM cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) AND basis=$3",[tenantId,ids,config.default_cost_basis])).rows:[];
 const fxRates=(await db.query("SELECT rate_date::text AS rate_date,from_currency,to_currency,rate FROM fx_rate WHERE tenant_id=$1 AND rate_date<=((to_date($2||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date)",[tenantId,month])).rows;
 const pricingRules=(await db.query("SELECT id,customer_id,group_id,product_id,rule_kind,contract_ref,price,currency,min_quantity,max_quantity,effective_from::text AS effective_from,effective_to::text AS effective_to,source FROM customer_price WHERE tenant_id=$1",[tenantId])).rows;
 const calculated:any[]=[];const dataQualityIssues:any[]=[];
 for(const row of rows){
   const customer={id:row.customer_id,tier:row.tier,group_id:row.group_id};
   // Catalog prices and costs are denominated in the tenant currency; the
   // transaction may use another currency, which the shared engine converts
   // with the effective-dated FX rates below.
   const product=engineProduct({id:row.product_id,sku:row.sku,name:row.product_name,category:row.category,supplier:row.supplier,uom:row.uom,currency:config.currency,unit_cost:row.unit_cost,freight_cost:row.freight_cost,payment_terms_cost:row.payment_terms_cost,list_price:row.list_price,tier_prices:row.tier_prices||{}} as DbProduct);
   const order={id:row.source_id,customerId:row.customer_id,productId:row.product_id,qty:Number(row.quantity),discountPct:Number(row.discount_pct),offInvoiceRebatePct:Number(row.off_invoice_rebate_pct),freightPerUnit:Number(row.freight_per_unit),termsPerUnit:Number(row.payment_terms_per_unit),month:row.month_key,transactionDate:String(row.transaction_date).slice(0,10),currency:row.currency,costBasis:config.default_cost_basis,costHistory,fxRates};
   const result=MarginEngine.calculateLine({
     product,customer,qty:order.qty,discountPct:order.discountPct,
     rebatePct:order.offInvoiceRebatePct,freightPerUnit:order.freightPerUnit,
     termsPerUnit:order.termsPerUnit,transactionDate:order.transactionDate,
     transactionCurrency:order.currency,costBasis:order.costBasis,costHistory,fxRates,pricingRules,
   });
   if(result.valid){calculated.push({...result,order,c:customer,p:product});continue;}
   for(const mathIssue of result.issues){
     if(mathIssue.code!=="cost_history_gap"&&mathIssue.code!=="fx_rate_missing"){
       throw new Error(`Order ${row.source_id} has invalid margin input ${mathIssue.code}; correct the history before reporting this period.`);
     }
     const issue={...mathIssue,productId:product.id,date:order.transactionDate,basis:config.default_cost_basis,sourceId:row.source_id};
     await db.query("SELECT public.record_data_quality_issue($1,$2,'product',$3,$4::date,$5::jsonb)",[tenantId,issue.code,product.id,order.transactionDate,JSON.stringify(issue)]);
     dataQualityIssues.push(issue);
   }
 }
 const totals=MarginEngine.aggregate(calculated);const details=calculated.map((value:any)=>({id:value.order.id,customer:value.c.name,sku:value.p.sku,quantity:value.qty,pocket:value.pocket,cogs:value.cogs,margin:value.margin,rate:value.rate})).sort((a:any,b:any)=>a.margin-b.margin);
 return{month,total:totals,details,dataQualityIssues,steps:[{label:"Gross invoice price",value:totals.list},{label:"Discounts",value:-totals.discount},{label:"Off-invoice rebates",value:-totals.rebate},{label:"Freight",value:-totals.freight},{label:"Payment terms",value:-totals.terms},{label:"Pocket price",value:totals.pocket},{label:"Cost of goods",value:-totals.cogs},{label:"Pocket margin",value:totals.margin}]};
}
