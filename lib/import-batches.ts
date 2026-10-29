import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {StoredRow} from "./import-lifecycle";
import {importBatches} from "./import-config";
type DB=Pick<PoolClient,"query">;
export const importInput=(row:StoredRow)=>row.input??row.diff.after!;
type DatedChange={id:string;product_id:string;amount:string;date:string;end:string|null;existing_id:string|null;close_id:string|null};
function datedChanges(rows:StoredRow[],field:"cost"|"price",listId:string|null):DatedChange[]{
 const changes:DatedChange[]=[];
 for(const row of rows){
  const v=importInput(row),amount=v[field];
  if(amount===null||(row.before&&amount===row.diff.before?.[field]))continue;
  const old=field==="cost"?row.before?.costs.filter(c=>c.basis==="standard"):row.before?.prices.filter(p=>p.price_list_id===listId);
  const current=old?.find(c=>c.effective_from<=v.date&&(!c.effective_to||c.effective_to>v.date));
  changes.push({id:randomUUID(),product_id:row.diff.productId,amount,date:v.date,
   end:current?.effective_to??old?.filter(c=>c.effective_from>v.date).map(c=>c.effective_from).sort()[0]??null,
   existing_id:current?.effective_from===v.date?current.id:null,
   close_id:current&&current.effective_from!==v.date?current.id:null});
 }
 return changes;
}
// No transaction boundary or job writes here: all batches belong to one caller transaction/job.
export async function applyImportBatch(db:DB,tenantId:string,userId:string,jobId:string,listId:string|null,rows:StoredRow[],currency:string){
 const values=rows.map(r=>({id:r.diff.productId,is_new:!r.before,...importInput(r)}));
 const fresh=values.filter(r=>r.is_new);
 if(fresh.length){
  await db.query(`INSERT INTO public.product(id,tenant_id,sku,name,category,supplier,uom,unit_cost,list_price)
   SELECT x.id,$1,x.sku,x.description,'Imported',NULLIF(x.supplier,''),x.unit,x.cost,x.price
   FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,sku text,description text,supplier text,unit text,cost numeric(18,4),price numeric(18,4))`,[tenantId,JSON.stringify(fresh)]);
  await db.query("DELETE FROM public.cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])",[tenantId,fresh.map(r=>r.id)]);
 }
 const existing=values.filter(r=>!r.is_new);
 if(existing.length)await db.query(`UPDATE public.product p SET name=x.description,supplier=NULLIF(x.supplier,'')
  FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,description text,supplier text)
  WHERE p.tenant_id=$1 AND p.id=x.id AND (p.name IS DISTINCT FROM x.description OR p.supplier IS DISTINCT FROM NULLIF(x.supplier,''))`,[tenantId,JSON.stringify(existing)]);
 const costs=datedChanges(rows,"cost",listId);
 if(costs.length){
  const data=JSON.stringify(costs);
  await db.query(`UPDATE public.cost_history h SET effective_to=x.date
   FROM jsonb_to_recordset($2::jsonb) AS x(close_id uuid,date date)
   WHERE h.tenant_id=$1 AND h.id=x.close_id`,[tenantId,data]);
  await db.query(`UPDATE public.cost_history h SET cost=x.amount,source=$3,created_by=$4
   FROM jsonb_to_recordset($2::jsonb) AS x(existing_id uuid,amount numeric(18,4))
   WHERE h.tenant_id=$1 AND h.id=x.existing_id`,[tenantId,data,"import:"+jobId,userId]);
  await db.query(`INSERT INTO public.cost_history(id,tenant_id,product_id,cost,basis,effective_from,effective_to,source,created_by,currency)
   SELECT x.id,$1,x.product_id,x.amount,'standard',x.date,x."end",$3,$4,$5
   FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,product_id uuid,amount numeric(18,4),date date,"end" date,existing_id uuid)
   WHERE x.existing_id IS NULL`,[tenantId,data,"import:"+jobId,userId,currency]);
 }
 const prices=datedChanges(rows,"price",listId);
 if(prices.length){
  const data=JSON.stringify(prices);
  await db.query(`UPDATE public.price_list_item i SET effective_to=x.date
   FROM jsonb_to_recordset($2::jsonb) AS x(close_id uuid,date date)
   WHERE i.tenant_id=$1 AND i.id=x.close_id`,[tenantId,data]);
  await db.query(`UPDATE public.price_list_item i SET unit_price=x.amount
   FROM jsonb_to_recordset($2::jsonb) AS x(existing_id uuid,amount numeric(18,4))
   WHERE i.tenant_id=$1 AND i.id=x.existing_id`,[tenantId,data]);
  await db.query(`INSERT INTO public.price_list_item(id,tenant_id,price_list_id,product_id,unit_price,effective_from,effective_to,currency)
   SELECT x.id,$1,$3,x.product_id,x.amount,x.date,x."end",$4
   FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,product_id uuid,amount numeric(18,4),date date,"end" date,existing_id uuid)
   WHERE x.existing_id IS NULL`,[tenantId,data,listId,currency]);
 }
}
export async function undoImportBatch(db:DB,tenantId:string,rows:StoredRow[]){
 const ids=rows.map(r=>r.diff.productId);
 await db.query("DELETE FROM public.price_list_item WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])",[tenantId,ids]);
 await db.query("DELETE FROM public.cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[])",[tenantId,ids]);
 const fresh=rows.filter(r=>!r.before);
 if(fresh.length)await db.query("DELETE FROM public.product WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenantId,fresh.map(r=>r.diff.productId)]);
 const existing=rows.flatMap(r=>r.before?[r.before.product]:[]);
 if(existing.length)await db.query(`UPDATE public.product p SET name=x.name,supplier=x.supplier
  FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,name text,supplier text)
  WHERE p.tenant_id=$1 AND p.id=x.id AND (p.name IS DISTINCT FROM x.name OR p.supplier IS DISTINCT FROM x.supplier)`,[tenantId,JSON.stringify(existing)]);
 for(const batch of importBatches(rows.flatMap(r=>r.before?.costs||[])))await db.query(`INSERT INTO public.cost_history(id,tenant_id,product_id,cost,basis,effective_from,effective_to,source,created_by,created_at,currency)
  SELECT x.id,$1,x.product_id,x.cost,x.basis,x.effective_from,x.effective_to,x.source,x.created_by,x.created_at,x.currency
  FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,product_id uuid,cost numeric(18,4),basis text,effective_from date,effective_to date,source text,created_by uuid,created_at timestamptz,currency text)`,[tenantId,JSON.stringify(batch)]);
 for(const batch of importBatches(rows.flatMap(r=>r.before?.prices||[])))await db.query(`INSERT INTO public.price_list_item(id,tenant_id,price_list_id,product_id,unit_price,effective_from,effective_to,version_id,currency)
  SELECT x.id,$1,x.price_list_id,x.product_id,x.unit_price,x.effective_from,x.effective_to,x.version_id,x.currency
  FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,price_list_id uuid,product_id uuid,unit_price numeric(18,4),effective_from date,effective_to date,version_id uuid,currency text)`,[tenantId,JSON.stringify(batch)]);
}
