import type { PoolClient } from "pg";
import MarginEngine from "../margin-engine.js";

export type QuoteLineInput = { productId: string; qty: number; discountPct: number; rebatePct: number; accessory: number };
export type DbProduct = { id:string;sku:string;name:string;category:string;supplier:string|null;uom:string|null;unit_cost:string|number;freight_cost:string|number;payment_terms_cost:string|number;list_price:string|number;tier_prices:Record<string,number> };
export function engineProduct(row:DbProduct) {
  return { id:row.id, sku:row.sku, name:row.name, category:row.category, supplier:row.supplier, uom:row.uom, cost:Number(row.unit_cost), freight:Number(row.freight_cost), termsCost:Number(row.payment_terms_cost), listPrice:Number(row.list_price), tiers:row.tier_prices||{} };
}
export async function calculateServerQuote(db:PoolClient,tenantId:string,customerId:string,lines:QuoteLineInput[]) {
  const customerResult=await db.query("SELECT id,name,account_no,tier,assigned_rep_id FROM customer WHERE tenant_id=$1 AND id=$2",[tenantId,customerId]);
  const customer=customerResult.rows[0];if(!customer)throw Object.assign(new Error("Customer was not found or is not assigned to you."),{status:404});
  const ids=[...new Set(lines.map(line=>line.productId))];
  const productResult=await db.query<DbProduct>("SELECT id,sku,name,category,supplier,uom,unit_cost,freight_cost,payment_terms_cost,list_price,tier_prices FROM product WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND active=true",[tenantId,ids]);
  if(productResult.rows.length!==ids.length)throw Object.assign(new Error("One or more products are unavailable in this workspace."),{status:422});
  const products=productResult.rows.map(engineProduct);
  const math=MarginEngine.calculateQuote(lines.map(line=>({productId:line.productId,qty:line.qty,discountPct:line.discountPct,rebatePct:line.rebatePct,accessory:line.accessory})),customer,products);
  if(!math.valid)throw Object.assign(new Error("Quote contains an invalid product or line."),{status:422});
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
  return {customer,products,math,policy,policyVersion,zone,headroom};
}
export { MarginEngine };
