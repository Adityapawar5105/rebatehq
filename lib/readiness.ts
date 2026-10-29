import type {PoolClient} from "pg";
type DB=Pick<PoolClient,"query">;
export type Readiness={invoices:number;complete:number;score:number|null;checks:Array<{key:string;label:string;ready:number;percent:number|null;steps:string[]} >};
// Availability only, not conversion arithmetic: quotes/imports still call the
// single convert_quantity function. This report never creates issues on a GET.
export const READINESS_SQL=`
 WITH line_evidence AS (
 SELECT l.invoice_id,
  l.actual_cost_amount IS NOT NULL AND l.actual_cost_source IS NOT NULL AS cost,
  EXISTS(SELECT 1 FROM public.cost_component c WHERE c.tenant_id=l.tenant_id
   AND c.invoice_line_id=l.id AND c.component_type='freight'
   AND c.currency=l.currency AND length(btrim(c.source_ref))>0) AS freight,
  EXISTS(SELECT 1 FROM public.cost_component c WHERE c.tenant_id=l.tenant_id
   AND c.invoice_line_id=l.id AND c.component_type='off_invoice_rebate'
   AND c.currency=l.currency AND length(btrim(c.source_ref))>0) AS rebate,
  EXISTS(SELECT 1 FROM public.uom a JOIN public.uom b ON b.tenant_id=a.tenant_id
   WHERE a.tenant_id=l.tenant_id AND a.code=l.uom_code AND b.code=p.uom
   AND (a.id=b.id OR EXISTS(SELECT 1 FROM public.uom_conversion u
    WHERE u.tenant_id=l.tenant_id AND (u.product_id=l.product_id OR u.product_id IS NULL)
    AND ((u.from_uom_id=a.id AND u.to_uom_id=b.id) OR (u.from_uom_id=b.id AND u.to_uom_id=a.id))))) AS units
 FROM public.invoice_line l JOIN public.product p ON p.tenant_id=l.tenant_id AND p.id=l.product_id
 WHERE l.tenant_id=$1
 ), invoice_evidence AS (
 SELECT i.id,count(l.invoice_id)>0 AND COALESCE(bool_and(l.cost),false) AS cost,
  count(l.invoice_id)>0 AND COALESCE(bool_and(l.freight),false) AS freight,
  count(l.invoice_id)>0 AND COALESCE(bool_and(l.rebate),false) AS rebate,
  count(l.invoice_id)>0 AND COALESCE(bool_and(l.units),false) AS units
 FROM public.invoice i LEFT JOIN line_evidence l ON l.invoice_id=i.id
 WHERE i.tenant_id=$1 GROUP BY i.id
 )
 SELECT count(*)::integer AS invoices,
  count(*) FILTER(WHERE cost)::integer AS cost,
  count(*) FILTER(WHERE freight)::integer AS freight,
  count(*) FILTER(WHERE rebate)::integer AS rebate,
  count(*) FILTER(WHERE units)::integer AS units,
  count(*) FILTER(WHERE cost AND freight AND rebate AND units)::integer AS complete
 FROM invoice_evidence`;
const definitions=[
 {key:"freight",label:"Actual freight",steps:["Export freight allocations by invoice and line, including currency and a source reference.","Load the allocations through your approved invoice-data process. Record an explicit sourced zero when no freight applies."]},
 {key:"cost",label:"Actual cost",steps:["Obtain actual cost by invoice line from purchasing or accounting, in that line's currency.","Record the amount and its source reference together. Standard catalog costs do not count as actual invoice costs."]},
 {key:"rebate",label:"Recorded rebates",steps:["Reconcile each invoice line's off-invoice rebate to the supplier/customer evidence.","Load a sourced rebate allocation, including an explicit zero if none applies. A default zero is not evidence of review."]},
 {key:"units",label:"Unit conversions",steps:["Provide each invoice line's unit and register the product's base unit.","Add an approved product-specific or workspace conversion when they differ. Matching registered units need no extra conversion."]}
];
export async function dataReadiness(db:DB,tenantId:string):Promise<Readiness>{
 const row=(await db.query(READINESS_SQL,[tenantId])).rows[0];
 const invoices=Number(row.invoices);
 const percent=(n:number)=>invoices?Math.round(n/invoices*1000)/10:null;
 const checks=definitions.map(d=>({...d,ready:Number(row[d.key]),percent:percent(Number(row[d.key]))}));
 return {invoices,complete:Number(row.complete),score:invoices?Math.round(checks.reduce((s,c)=>s+c.ready,0)/(4*invoices)*1000)/10:null,checks};
}
