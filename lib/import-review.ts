import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { HttpError } from "./authz";
import { columnName,validateMapping } from "./upload-parser";
import { IMPORT_FIELDS,UPLOAD_LIMITS,type ParsedUpload,type ColumnMapping,type UploadPreview } from "./upload-types";
type DB=Pick<PoolClient,"query">;
export const TemplateKey=z.object({supplier:z.string().trim().min(1).max(120),fileType:z.enum(["xlsx","csv","tsv"])}).strict();
export const TemplateInput=TemplateKey.extend({fields:z.record(z.string(),z.number().int()),headers:z.array(z.string().max(2000)).min(1).max(64)}).strict();
export function headersFingerprint(headers:string[]):string{return createHash("sha256").update(JSON.stringify(headers)).digest("hex");}
export async function saveMappingTemplate(db:DB,tenantId:string,userId:string,input:z.infer<typeof TemplateInput>){
 const parsed=TemplateInput.safeParse(input);if(!parsed.success)throw new HttpError(400,"Choose a supplier, file type and valid column mapping.");
 const {supplier,fileType,headers}=parsed.data;const fields=validateMapping(parsed.data.fields,headers.length);
 if(!Object.keys(fields).length)throw new HttpError(422,"Map at least one column before saving a template.");
 const name="supplier-file:"+createHash("sha256").update(JSON.stringify([supplier,fileType])).digest("hex");
 const mapping={supplier,fileType,fields,headersFingerprint:headersFingerprint(headers),schemaVersion:1};
 const result=await db.query<{id:string}>(`INSERT INTO public.column_mapping_template(tenant_id,name,import_type,version,column_mapping,created_by)
 VALUES($1,$2,'supplier_file_mapping_v1',1,$3::jsonb,$4)
 ON CONFLICT(tenant_id,name,version) DO UPDATE SET column_mapping=EXCLUDED.column_mapping
 RETURNING id`,[tenantId,name,JSON.stringify(mapping),userId]);return result.rows[0];
}
export async function loadMappingTemplate(db:DB,tenantId:string,input:z.infer<typeof TemplateKey>){
 const key=TemplateKey.safeParse(input);if(!key.success)throw new HttpError(400,"Choose a supplier and file type.");
 const result=await db.query<{id:string;column_mapping:{fields:ColumnMapping;headersFingerprint:string}}>(`SELECT id,column_mapping FROM public.column_mapping_template
 WHERE tenant_id=$1 AND import_type='supplier_file_mapping_v1' AND version=1
 AND column_mapping->>'supplier'=$2 AND column_mapping->>'fileType'=$3 ORDER BY created_at DESC LIMIT 1`,[tenantId,key.data.supplier,key.data.fileType]);
 const row=result.rows[0];return row?{id:row.id,fields:row.column_mapping.fields,headersFingerprint:row.column_mapping.headersFingerprint}:null;
}
export async function createImportReview(db:DB,tenantId:string,userId:string,parsed:ParsedUpload):Promise<UploadPreview>{
 const job=await db.query<{id:string}>(`INSERT INTO public.import_job(tenant_id,import_type,status,source_name,source_hash,created_by)
 VALUES($1,'supplier_file_review','dry_run',$2,$3,$4) RETURNING id`,[tenantId,`supplier.${parsed.fileType}`,parsed.sourceHash,userId]);
 const jobId=job.rows[0].id;const issues=[...parsed.issues];
 const add=(code:string,row:number,column:string,message:string)=>{if(issues.length>=UPLOAD_LIMITS.issues)throw new HttpError(422,"This file has too many issues. Split it into smaller files.");issues.push({code,row,column,message,sheet:parsed.sheetName});};
 const skuColumn=parsed.mapping.sku,unitColumn=parsed.mapping.unit;
 if(unitColumn===undefined)add("unit_mapping",parsed.headerRow,"A","No unit column is mapped. Unit compatibility has not been checked.");
 if(skuColumn!==undefined&&unitColumn!==undefined&&parsed.rows.length){
  const checks=await db.query<{row_no:number;product_id:string|null;target_unit:string;source_unit:string;factor:string|null}>(`
   SELECT i.row_no,p.id AS product_id,COALESCE(p.uom,i.unit_code) AS target_unit,i.unit_code AS source_unit,
    public.convert_quantity($1::uuid,p.id,1::numeric,i.unit_code,COALESCE(p.uom,i.unit_code),current_date)::text AS factor
   FROM unnest($2::integer[],$3::text[],$4::text[]) i(row_no,sku,unit_code)
   LEFT JOIN public.product p ON p.tenant_id=$1::uuid AND p.sku=i.sku AND p.active=true`,
   [tenantId,parsed.rows.map(r=>r.row),parsed.rows.map(r=>r.cells[skuColumn]?.value||""),parsed.rows.map(r=>r.cells[unitColumn]?.value||"")]);
  const missing:Array<{row:number;column:string;from:string;to:string}>=[];
  for(const check of checks.rows){
   const column=columnName(unitColumn);
   if(!check.product_id)add("unknown_sku",check.row_no,columnName(skuColumn),"This SKU is not in the current workspace catalog. No product match or base unit was guessed.");
   if(check.source_unit!==check.target_unit)add("unit_mismatch",check.row_no,column,"This unit differs from the catalog base unit. No quantity or price was converted.");
   if(check.factor===null){add("missing_conversion",check.row_no,column,"No approved unit conversion is available. A data-quality issue was recorded; add a conversion or correct the source.");missing.push({row:check.row_no,column,from:check.source_unit,to:check.target_unit});}
  }
  if(missing.length)await db.query(`SELECT public.record_data_quality_issue($1::uuid,'uom_conversion_missing','import_job',
   $2::text||':'||x.row::text||':'||x.column,current_date,
   jsonb_build_object('job_id',$2::text,'row',x.row,'column',x.column,'from',x.from,'to',x.to))
   FROM jsonb_to_recordset($3::jsonb) AS x(row integer,"column" text,"from" text,"to" text)`,[tenantId,jobId,JSON.stringify(missing)]);
 }
 const dataRows=new Set(parsed.rows.map(r=>r.row));const rejected=new Set(issues.filter(i=>dataRows.has(i.row)).map(i=>i.row)).size;
 await db.query(`UPDATE public.import_job SET accepted_rows=0,rejected_rows=$3,summary=$4::jsonb
 WHERE tenant_id=$1 AND id=$2 AND status='dry_run'`,[tenantId,jobId,rejected,JSON.stringify({parserVersion:1,rowCount:parsed.rows.length,issueCount:issues.length,sheetId:parsed.sheetId,headerRow:parsed.headerRow})]);
 return {...parsed,issues,rows:parsed.rows.slice(0,50),totalRows:parsed.rows.length,jobId,headersFingerprint:headersFingerprint(parsed.headers),limits:"Preview only: no products, costs, prices or quantities were imported. Showing the first 50 rows and every issue. Files are not stored."};
}
