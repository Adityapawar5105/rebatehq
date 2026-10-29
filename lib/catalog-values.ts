import type {PoolClient} from "pg";
// This is a display projection. The shared margin engine still resolves quotes.
export async function currentImportPrices(db:Pick<PoolClient,"query">,tenantId:string,ids:string[]){
 const rows=(await db.query(`SELECT i.product_id,i.unit_price::text AS value FROM public.price_list_item i
  JOIN public.price_list p ON p.tenant_id=i.tenant_id AND p.id=i.price_list_id
  WHERE i.tenant_id=$1 AND i.product_id=ANY($2::uuid[]) AND p.name='MarginDesk file imports' AND p.active=true
  AND i.effective_from<=current_date AND (i.effective_to IS NULL OR i.effective_to>current_date)`,[tenantId,ids])).rows;
 const result=new Map<string,string>();for(const row of rows){if(result.has(row.product_id))throw new Error("Conflicting file-import lists");result.set(row.product_id,row.value);}return result;
}
export async function currentStandardCosts(db:Pick<PoolClient,"query">,tenantId:string,ids:string[]){
 const rows=(await db.query(`SELECT product_id,cost::text AS value FROM public.cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])
  AND basis='standard' AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>current_date)`,[tenantId,ids])).rows;
 return new Map<string,string>(rows.map(r=>[r.product_id,r.value]));
}
