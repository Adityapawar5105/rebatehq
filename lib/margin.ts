import type { PoolClient } from "pg";
import MarginEngineModule from "../margin-engine.js";
const MarginEngine = MarginEngineModule as any;

export type QuoteLineInput = { productId: string; qty: number; uom?: string; discountPct: number; rebatePct: number; accessory: number };
export type DbProduct = { id:string;sku:string;name:string;category:string;supplier:string|null;uom:string|null;currency?:string;unit_cost:string|number;freight_cost:string|number;payment_terms_cost:string|number;list_price:string|number;tier_prices:Record<string,number>;list_history?:unknown[] };
export function engineProduct(row:DbProduct) {
  return { id:row.id, sku:row.sku, name:row.name, category:row.category, supplier:row.supplier, uom:row.uom, currency:row.currency, cost:Number(row.unit_cost), freight:Number(row.freight_cost), termsCost:Number(row.payment_terms_cost), listPrice:Number(row.list_price), tiers:row.tier_prices||{},listHistory:row.list_history||[] };
}
export async function calculateServerQuote(db:PoolClient,tenantId:string,customerId:string,lines:QuoteLineInput[],transactionDate=new Date().toISOString().slice(0,10),transactionCurrency?:string) {
  const tenantResult=await db.query<{currency:string;default_cost_basis:string}>("SELECT currency,default_cost_basis FROM tenant WHERE tenant_id=$1",[tenantId]);
  const tenant=tenantResult.rows[0];if(!tenant)throw Object.assign(new Error("Workspace was not found."),{status:404});
  const currency=(transactionCurrency||tenant.currency).trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw Object.assign(new Error("The quote currency is invalid."),{status:422});
  const customerResult=await db.query("SELECT id,name,account_no,tier,group_id,assigned_rep_id FROM customer WHERE tenant_id=$1 AND id=$2",[tenantId,customerId]);
  const customer=customerResult.rows[0];if(!customer)throw Object.assign(new Error("Customer was not found or is not assigned to you."),{status:404});
  const ids=[...new Set(lines.map(line=>line.productId))];
  const productResult=await db.query<DbProduct>(`SELECT p.id,p.sku,p.name,p.category,p.supplier,p.uom,p.unit_cost,p.freight_cost,p.payment_terms_cost,p.list_price,p.tier_prices,$3::char(3) AS currency,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'unit_price',i.unit_price::text,'currency',i.currency,
    'effective_from',i.effective_from::text,'effective_to',i.effective_to::text) ORDER BY i.effective_from)
    FROM public.price_list_item i JOIN public.price_list pl ON pl.tenant_id=i.tenant_id AND pl.id=i.price_list_id
    WHERE i.tenant_id=p.tenant_id AND i.product_id=p.id AND pl.name='MarginDesk file imports' AND pl.active=true),'[]'::jsonb) AS list_history
   FROM public.product p WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.active=true`,[tenantId,ids,tenant.currency]);
  if(productResult.rows.length!==ids.length)throw Object.assign(new Error("One or more products are unavailable in this workspace."),{status:422});
  const products=productResult.rows.map(engineProduct);
  const productById=new Map(products.map(product=>[product.id,product]));
  const normalizedLines:QuoteLineInput[]=[];
  for(const line of lines){
    const product=productById.get(line.productId)!;
    const converted=await db.query<{quantity:string|null}>("SELECT public.convert_quantity($1,$2,$3::numeric,$4::text,$5::text,$6::date) AS quantity",[tenantId,line.productId,line.qty,line.uom||null,product.uom,transactionDate]);
    const quantity=converted.rows[0]?.quantity;
    if(quantity===null||quantity===undefined)throw Object.assign(new Error(`No known unit conversion from ${line.uom||"(missing)"} to ${product.uom||"(missing)"} for ${product.sku}. A data-quality issue was recorded.`),{status:422});
    normalizedLines.push({...line,qty:Number(quantity),uom:product.uom||undefined});
  }
  const pricingRules=(await db.query("SELECT id,customer_id,group_id,product_id,rule_kind,contract_ref,price,currency,min_quantity,max_quantity,effective_from::text AS effective_from,effective_to::text AS effective_to,source FROM customer_price WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) AND (customer_id=$3 OR group_id=$4)",[tenantId,ids,customerId,customer.group_id])).rows;
  const costHistory=(await db.query("SELECT product_id,cost,basis,effective_from::text AS effective_from,effective_to::text AS effective_to,currency FROM cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) AND basis=$3",[tenantId,ids,tenant.default_cost_basis])).rows;
  const fxRates=(await db.query("SELECT rate_date::text AS rate_date,from_currency,to_currency,rate FROM fx_rate WHERE tenant_id=$1 AND rate_date<=$2",[tenantId,transactionDate])).rows;
  const math=MarginEngine.calculateQuote(normalizedLines.map(line=>({productId:line.productId,qty:line.qty,discountPct:line.discountPct,rebatePct:line.rebatePct,accessory:line.accessory})),customer,products,{transactionDate,transactionCurrency:currency,costBasis:tenant.default_cost_basis,costHistory,fxRates,pricingRules});
  if(!math.valid){
    if ((math.issues||[]).some((issue:any)=>issue.code.startsWith("pricing_"))) throw Object.assign(new Error("Approved pricing rules conflict or require a transaction date. Correct the pricing rules and retry."),{status:422});
    for(const issue of math.issues||[]){if(issue.code==="cost_history_gap"||issue.code==="fx_rate_missing")await db.query("SELECT public.record_data_quality_issue($1,$2,$3,$4,$5,$6::jsonb)",[tenantId,issue.code,"product",String(issue.productId||ids[0]||customerId),transactionDate,JSON.stringify(issue)]);}
    throw Object.assign(new Error("Quote data is incomplete for its transaction date or currency. A data-quality issue was recorded; complete the cost or FX history and retry."),{status:422});
  }
  const categories=[...new Set(products.map(product=>product.category))];
  const policies=await db.query(`SELECT scope_type,scope_key,target_margin_pct,floor_margin_pct,walkaway_margin_pct,version
    FROM margin_policy WHERE tenant_id=$1 AND (scope_type='global' OR (scope_type='customer_tier' AND scope_key=$2) OR (scope_type='category' AND scope_key=ANY($3::text[])))`,[tenantId,customer.tier||"",categories]);
  const global=policies.rows.find(row=>row.scope_type==="global")||{target_margin_pct:30,floor_margin_pct:22,walkaway_margin_pct:18,version:1};
  const matched=policies.rows.filter(row=>row.scope_type==="global"||(row.scope_type==="customer_tier"&&row.scope_key===customer.tier)||(row.scope_type==="category"&&categories.includes(row.scope_key)));
  if(!matched.some(row=>row.scope_type==="global"))matched.push(global);
  const policy={target:Math.max(...matched.map(row=>Number(row.target_margin_pct))),floor:Math.max(...matched.map(row=>Number(row.floor_margin_pct))),walkAway:Math.max(...matched.map(row=>Number(row.walkaway_margin_pct)))};
  const policyVersion=Math.max(1,...matched.map(row=>Number(row.version)||1));
  const zone=MarginEngine.classify(math.rate,policy);
  const headroom=Number((math.rate-policy.walkAway).toFixed(3));
  return {customer,products,math,policy,policyVersion,zone,headroom,currency,transactionDate,normalizedLines};
}
export { MarginEngine };

// A changed pricing rule requires a quote revision; approval/send must not
// change header totals while leaving the stored line price and rationale behind.
export function assertQuotedPricesCurrent(lines:any[],math:any) {
  if(lines.length!==math.lines.length || lines.some((line,index)=>Number(line.quotedUnitPrice).toFixed(4)!==Number(math.lines[index].unitPrice).toFixed(4))) {
    throw Object.assign(new Error("An approved price changed. Create a revised quote before approval or sending."),{status:409});
  }
}
