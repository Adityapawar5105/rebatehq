// All mutations run inside withDatabase's transaction and existing forced RLS.
import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import {HttpError} from "./authz";
import {csvDocument} from "./csv";
import {columnName} from "./upload-parser";
import type {ParsedUpload} from "./upload-types";
import type {ImportDiff,ImportValue,ImportPlan,ImportHistory} from "./import-lifecycle-types";
type DB=Pick<PoolClient,"query">;
type RecordRow=Record<string,any>;
type Graph={product:RecordRow;costs:RecordRow[];prices:RecordRow[]};
type StoredRow={diff:ImportDiff;before:Graph|null;expected:string;input:ImportValue;conversion?:{from:string;to:string;factor:string;date:string}};
type Journal={version:1;currency:string;plan:ImportPlan;rows:StoredRow[];listId:string|null;createdList:boolean;after?:Record<string,Graph>;committedAt?:string;committedBy?:string;undoneAt?:string;undoneBy?:string};
const IMPORT="catalog_import_v1",EXPORT="catalog_export_v1",LIST="MarginDesk file imports";
const maxRows=200,maxJournalBytes=8*1024*1024;
export const ImportOptions=z.object({
 numericFormat:z.enum(["dot","comma"]).default("dot"),approveTextNumbers:z.boolean().default(false),
 approveUnits:z.boolean().default(false),acknowledgeWarnings:z.boolean().default(false),
 effectiveDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 decisions:z.record(z.string().regex(/^\d+$/),z.enum(["app","file","review"])).default({})
}).strict();
type Options=z.infer<typeof ImportOptions>;
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
function json(value:unknown){const s=JSON.stringify(value);if(Buffer.byteLength(s)>maxJournalBytes)fail(422,"This import has too much history to review safely. Split the file into smaller files.");return s;}
function stable(value:any):string {if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";return JSON.stringify(value);}
const hash=(value:unknown)=>createHash("sha256").update(stable(value)).digest("hex");
// Logical restore changes physical tuple revisions. Undo compares all business
// values/IDs while export and commit also compare the physical edit revision.
function businessHash(graph:Graph){
 const clean=(row:RecordRow)=>{const {_revision,...value}=row;return value;};
 return hash({product:clean(graph.product),costs:graph.costs.map(clean),prices:graph.prices.map(clean)});
}
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(new Date(s+"T00:00:00Z").getTime())&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
export function decimal(s:string,format:"dot"|"comma"="dot"):string {
 const normalized=format==="comma"?s.replace(",","."):s;
 if(!/^\d{1,14}(?:\.\d{1,4})?$/.test(normalized))fail(422,"Use a non-negative number with at most 14 whole digits and four decimal places; grouping separators are not accepted.");
 const [a,b=""]=normalized.split(".");return BigInt(a).toString()+"."+b.padEnd(4,"0");
}
function unitsOf(s:string){const [a,b]=decimal(s).split(".");return BigInt(a)*BigInt(10000)+BigInt(b);}
export function perBaseUnit(value:string,factor:string):string{
 const f=unitsOf(factor);if(f<=BigInt(0))fail(422,"The unit conversion is too small for stored precision. Use the catalog base unit.");
 const n=unitsOf(value)*BigInt(10000);const rounded=(n+f/BigInt(2))/f;
 return decimal((rounded/BigInt(10000)).toString()+"."+(rounded%BigInt(10000)).toString().padStart(4,"0"));
}
async function lock(db:DB,tenantId:string){
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",[tenantId]);
 const t=(await db.query("SELECT currency::text,current_date::text AS today FROM public.tenant WHERE tenant_id=$1",[tenantId])).rows[0];
 if(!t)fail(404,"Workspace was not found.");return t as {currency:string;today:string};
}
async function listId(db:DB,tenantId:string):Promise<string|null>{
 const rows=(await db.query("SELECT pl.id,pl.currency=t.currency AS currency_matches FROM public.price_list pl JOIN public.tenant t ON t.tenant_id=pl.tenant_id WHERE pl.tenant_id=$1 AND pl.name=$2 AND pl.active=true ORDER BY pl.id FOR UPDATE OF pl",[tenantId,LIST])).rows;
 if(rows.some(r=>!r.currency_matches))fail(409,"The import list currency differs from the workspace. Review the list before importing.");
 if(rows.length>1)fail(409,"More than one file-import price list exists. Resolve the duplicate lists before importing.");return rows[0]?.id||null;
}
async function graphs(db:DB,tenantId:string,ids:string[]):Promise<Map<string,Graph>>{
 if(!ids.length)return new Map();
 // Parent locks block new FK children; child locks protect existing dated rows.
 await db.query("SELECT id FROM public.product WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[tenantId,ids]);
 await db.query("SELECT id FROM public.cost_history WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[tenantId,ids]);
 await db.query("SELECT id FROM public.price_list_item WHERE tenant_id=$1 AND product_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[tenantId,ids]);
 const result=await db.query<{graph:Graph}>(`
 SELECT jsonb_build_object('product',to_jsonb(p)||jsonb_build_object('unit_cost',p.unit_cost::text,
  'freight_cost',p.freight_cost::text,'payment_terms_cost',p.payment_terms_cost::text,'list_price',p.list_price::text,'_revision',p.xmin::text),
  'costs',COALESCE((SELECT jsonb_agg(to_jsonb(h)||jsonb_build_object('cost',h.cost::text,'_revision',h.xmin::text) ORDER BY h.id)
   FROM public.cost_history h WHERE h.tenant_id=p.tenant_id AND h.product_id=p.id),'[]'::jsonb),
  'prices',COALESCE((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('unit_price',i.unit_price::text,'_revision',i.xmin::text) ORDER BY i.id)
   FROM public.price_list_item i WHERE i.tenant_id=p.tenant_id AND i.product_id=p.id),'[]'::jsonb)) AS graph
 FROM public.product p WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.id FOR UPDATE OF p`,[tenantId,[...new Set(ids)]]);
 return new Map(result.rows.map(r=>[r.graph.product.id,r.graph]));
}
function view(g:Graph,date:string,list:string|null):ImportValue{
 const p=g.product,cost=g.costs.find(c=>c.basis==="standard"&&c.effective_from<=date&&(!c.effective_to||c.effective_to>date));
 const price=g.prices.find(i=>i.price_list_id===list&&i.effective_from<=date&&(!i.effective_to||i.effective_to>date));
 return {sku:p.sku,description:p.name,unit:p.uom||"",supplier:p.supplier||"",cost:cost?.cost??null,price:price?.unit_price??p.list_price,date};
}
export async function exportLifeline(db:DB,tenantId:string,userId:string,supplier?:string){
 const tenant=await lock(db,tenantId),list=await listId(db,tenantId);
 const ids=(await db.query("SELECT id FROM public.product WHERE tenant_id=$1 AND active=true AND ($2::text IS NULL OR supplier=$2) ORDER BY sku LIMIT 2000",[tenantId,supplier||null])).rows.map(r=>r.id);
 if(ids.length>=2000)fail(422,"Export up to 1,999 products at a time. Filter by supplier.");
 const states=await graphs(db,tenantId,ids),id=randomUUID();
 const summary={version:1,exportedOn:tenant.today,listId:list,rows:Object.fromEntries([...states].map(([key,g])=>[key,{stamp:hash(g),graph:g}]))};
 await db.query("INSERT INTO public.import_job(id,tenant_id,import_type,status,source_name,accepted_rows,summary,created_by) VALUES($1,$2,$3,'dry_run','catalog-lifeline.csv',$4,$5::jsonb,$6)",[id,tenantId,EXPORT,ids.length,json(summary),userId]);
 const rows=ids.map(key=>{const g=states.get(key)!,v=view(g,tenant.today,list);return [key,id+":"+hash(g),v.sku,v.description,v.unit,v.cost??"",v.price,v.supplier,v.date];});
 return csvDocument(["md_row_id","md_version","SKU","Description","Unit","Cost","Price","Supplier","Date"],rows);
}
function metadata(parsed:ParsedUpload){
 const names=["md_row_id","md_version"],indexes=names.map(n=>parsed.headers.indexOf(n));
 if(parsed.headers.some(h=>/^md[_ ]?(row[_ ]?id|version)$/i.test(h)&&!names.includes(h)))fail(422,"Restore the exact protected headers md_row_id and md_version.");
 for(const n of names)if(parsed.headers.filter(h=>h===n).length>1)fail(422,"The protected row ID or version column is duplicated.");
 if(indexes.some(i=>i>=0)&&indexes.some(i=>i<0))fail(422,"Keep both md_row_id and md_version columns from the export.");
 return indexes;
}
export async function previewImport(db:DB,tenantId:string,userId:string,filename:string,parsed:ParsedUpload,rawOptions:Options):Promise<ImportPlan>{
 const options=ImportOptions.parse(rawOptions);if(!validDate(options.effectiveDate))fail(422,"Choose a valid effective date.");
 if(parsed.rows.length>maxRows)fail(422,"Review and commit at most 200 data rows at a time. Split this file.");
 if(parsed.mapping.sku===undefined)fail(422,"Map the SKU column before making an import plan.");
 const tenant=await lock(db,tenantId),list=await listId(db,tenantId),id=randomUUID();
 const [idCol,versionCol]=metadata(parsed),exports=new Map<string,any>();
 const candidates=parsed.rows.map(r=>idCol<0?"":r.cells[idCol]?.value||"").filter(v=>z.uuid().safeParse(v).success);
 const skus=parsed.rows.map(r=>r.cells[parsed.mapping.sku!]?.value||"");
 const products=(await db.query("SELECT id,sku FROM public.product WHERE tenant_id=$1 AND (sku=ANY($2::text[]) OR id=ANY($3::uuid[])) ORDER BY sku",[tenantId,skus,candidates])).rows;
 const bySku=new Map(products.map(p=>[p.sku,p.id])),states=await graphs(db,tenantId,products.map(p=>p.id));
 const registeredUnits=new Set((await db.query("SELECT code FROM public.uom WHERE tenant_id=$1",[tenantId])).rows.map(r=>r.code));
 const keyColumns=new Set([idCol,versionCol].filter(i=>i>=0));
 for(const index of Object.values(parsed.mapping))if(keyColumns.has(index!))fail(422,"Protected metadata columns cannot be mapped to business fields.");
 const names=new Map<string,number>();for(const r of parsed.rows){const sku=r.cells[parsed.mapping.sku!]?.value||"";names.set(sku,(names.get(sku)||0)+1);}
 const warnings=parsed.issues.filter(i=>["merged_cell","hidden_column","hidden_row","hidden_sheet","bom","header_suggestion","missing_header","duplicate_header","row_width","bom_text","unsafe_text"].includes(i.code)).map(i=>`${i.sheet}, row ${i.row}, column ${i.column}: ${i.message}`);
 const stored:StoredRow[]=[];
 // Only staging metadata is written before commit. UOM issue rows refer here.
 await db.query("INSERT INTO public.import_job(id,tenant_id,import_type,status,source_name,source_hash,created_by) VALUES($1,$2,$3,'dry_run',$4,$5,$6)",[id,tenantId,IMPORT,filename.replace(/[\x00-\x1f\x7f]/g,"").slice(0,255),parsed.sourceHash,userId]);
 for(const r of parsed.rows){
  const get=(field:keyof typeof parsed.mapping)=>parsed.mapping[field]===undefined?undefined:r.cells[parsed.mapping[field]!] ;
  const sku=get("sku")?.value||"",rid=idCol>=0?r.cells[idCol]?.value||"":"",stamp=versionCol>=0?r.cells[versionCol]?.value||"":"";
  let productId=bySku.get(sku)||randomUUID(),before=states.get(productId)||null,baseline:Graph|null=null;
  const messages:string[]=[];let rejected=false;let conversion:StoredRow["conversion"];
  const reject=(message:string)=>{rejected=true;messages.push(message.includes("column")?message:message.replace(`Row ${r.row}:`,`Row ${r.row}, column ${columnName(parsed.mapping.sku!)}:`));};
  if(!sku||sku!==sku.trim()||sku.length>100)reject(`Row ${r.row}, column ${columnName(parsed.mapping.sku!)}: use a nonempty SKU without surrounding spaces (100 characters maximum).`);
  if((names.get(sku)||0)>1)reject(`Row ${r.row}: duplicate SKU; every duplicate row is rejected.`);
  if(idCol>=0&&(rid||stamp)){
   const m=/^([0-9a-f-]{36}):([0-9a-f]{64})$/.exec(stamp);
   if(!z.uuid().safeParse(rid).success||!m||!z.uuid().safeParse(m[1]).success)reject(`Row ${r.row}: the protected ID or version stamp is missing or was edited.`);
   else{
    const key=m[1]+":"+rid;
    if(!exports.has(key))exports.set(key,(await db.query("SELECT summary->'rows'->$3::text AS baseline FROM public.import_job WHERE tenant_id=$1 AND id=$2 AND import_type=$4",[tenantId,m[1],rid,EXPORT])).rows[0]?.baseline||null);
    const base=exports.get(key);
    if(!base||base.stamp!==m[2])reject(`Row ${r.row}: the protected row ID/version does not match an export from this workspace.`);
    else{baseline=base.graph;productId=rid;before=states.get(rid)||null;if(baseline!.product.sku!==sku)reject(`Row ${r.row}: SKU is protected. Keep the exported SKU; create a separate new row for a new product.`);if(!before)reject(`Row ${r.row}: this exported product was deleted. Restore or review it in the app first.`);}
   }
  }else if(idCol>=0&&before)reject(`Row ${r.row}: an existing product needs its exported md_row_id and md_version.`);
  const date=get("date")?.value||options.effectiveDate;
  if(!validDate(date))reject(`Row ${r.row}, column ${parsed.mapping.date===undefined?"A":columnName(parsed.mapping.date)}: use YYYY-MM-DD.`);
  const previous=before?view(before,date,list):null;
  if(before?.costs.some(c=>c.basis==="standard"&&c.effective_from<=date&&(!c.effective_to||c.effective_to>date)&&c.currency!==tenant.currency))reject(`Row ${r.row}: the dated cost uses a different currency. Review currency history before importing.`);
  let input:ImportValue={sku,description:get("description")?.value??previous?.description??"",unit:get("unit")?.value||"",supplier:get("supplier")?.value??previous?.supplier??"",cost:previous?.cost??null,price:previous?.price??"0.0000",date};
  for(const field of ["cost","price"] as const){
   const c=get(field);if(c&&c.value!==""){
    try{if(c.kind!=="number"&&!options.approveTextNumbers)throw new Error("This is a text number. Explicitly approve its decimal format.");
     if(c.kind==="formula"||c.kind==="error"||c.kind==="date")throw new Error("Replace this cell with a numeric value.");
     input[field]=decimal(c.value,c.kind==="number"?"dot":options.numericFormat);
    }catch(e){reject(`Row ${r.row}, column ${columnName(parsed.mapping[field]!)}: ${e instanceof Error?e.message:"Use a valid number."}`);}
   }else if(!before)reject(`Row ${r.row}, column ${parsed.mapping[field]===undefined?"A":columnName(parsed.mapping[field])}: new products require a cost and a price.`);
   else if(c)messages.push(`Row ${r.row}, column ${columnName(parsed.mapping[field]!)}: blank ${field} retains the current value; no zero was assumed.`);
  }
  if(!get("unit")?.value)reject(`Row ${r.row}, column ${parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit)}: map and supply a unit; no source unit was assumed.`);
  if(!input.description||input.description.length>200)reject(`Row ${r.row}, column ${parsed.mapping.description===undefined?"A":columnName(parsed.mapping.description)}: provide a description of 200 characters or fewer.`);
  if(input.supplier.length>200)reject(`Row ${r.row}, column ${parsed.mapping.supplier===undefined?"A":columnName(parsed.mapping.supplier)}: supplier must be 200 characters or fewer.`);
  if(!input.unit||input.unit.length>16)reject(`Row ${r.row}, column ${parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit)}: provide a registered unit of 16 characters or fewer.`);
  if(before&&!before.product.active)reject(`Row ${r.row}: this product is inactive.`);
  if(before&&!previous?.unit)reject(`Row ${r.row}, column ${parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit)}: this catalog product has no base unit; resolve it before importing.`);
  if(parsed.issues.some(i=>i.row===r.row&&["formula","formula_text","invalid_number","negative_number","bad_date","sku_whitespace"].includes(i.code)))reject(`Row ${r.row}: resolve the formula, numeric, date or SKU issue in the source file.`);
  if(get("quantity")?.value)messages.push(`Row ${r.row}: quantity is reviewed only; this catalog import does not write inventory or invoices.`);
  if(validDate(date)){
   const target=before?(previous?.unit||""):input.unit;
   const found=(await db.query("SELECT public.convert_quantity($1::uuid,$2::uuid,1::numeric,$3::text,$4::text,$5::date)::text AS factor",[tenantId,before?productId:null,input.unit,target,date])).rows[0].factor as string|null;
   const factor=!input.unit||(before&&!previous?.unit)||(!before&&!registeredUnits.has(input.unit))?null:found;
   if(factor===null){
    await db.query("SELECT public.record_data_quality_issue($1::uuid,'uom_conversion_missing','import_job',$2::text,$3::date,$4::jsonb)",[tenantId,id+":"+r.row,date,JSON.stringify({job_id:id,row:r.row,column:parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit),from:input.unit,to:target})]);
    reject(`Row ${r.row}, column ${parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit)}: missing registered base unit or approved unit conversion; a data-quality issue was recorded. New base units must match the registered code exactly.`);
   }else if(input.unit!==target){
    conversion={from:input.unit,to:target,factor,date};
    if(!options.approveUnits)reject(`Row ${r.row}: ${input.unit} differs from base unit ${target}. Explicitly approve the displayed conversion.`);
    try{input={...input,cost:input.cost===null||!get("cost")?.value?input.cost:perBaseUnit(input.cost,factor),price:get("price")?.value?perBaseUnit(input.price,factor):input.price,unit:target};messages.push(`Row ${r.row}, column ${parsed.mapping.unit===undefined?"A":columnName(parsed.mapping.unit)}: 1 source ${get("unit")?.value} = ${factor} ${target}; supplied cost and price divided by this quantity and rounded to four decimals. Unmapped amounts and the base unit are retained.`);}catch(e){reject(`Row ${r.row}: ${(e as Error).message}`);}
   }
  }
  let conflict:ImportDiff["conflict"];
  if(baseline&&before&&hash(baseline)!==hash(before)){
   const choice=options.decisions[String(r.row)]||"review";conflict={baseline:view(baseline,date,list),app:previous!,file:input,choice};
  }
  const after=conflict?.choice==="app"?previous:input;
  const state:ImportDiff["state"]=rejected?"rejected":!before?"new":stable(previous)===stable(after)?"unchanged":"changed";
  if(!rejected&&after&&state!=="unchanged")for(const field of ["cost","price"] as const){
   if(after[field]===previous?.[field])continue;
   const entries=field==="cost"?before?.costs.filter(c=>c.basis==="standard"):before?.prices.filter(p=>p.price_list_id===list);
   const current=entries?.find(e=>e.effective_from<=date&&(!e.effective_to||e.effective_to>date));
   const end=current?.effective_to??entries?.filter(e=>e.effective_from>date).map(e=>e.effective_from).sort()[0]??null;
   messages.push(`Row ${r.row}, column ${parsed.mapping[field]===undefined?"A":columnName(parsed.mapping[field])}: ${field} applies from ${date}${end?` until ${end} (exclusive)`:" onward"}. Earlier history and scheduled later values are retained.`);
  }
  stored.push({diff:{row:r.row,productId,state,before:previous,after:rejected?null:after,messages,conflict},before,expected:before?hash(before):"missing",input:after!,conversion});
 }
 const counts={new:0,changed:0,unchanged:0,rejected:0};for(const r of stored)counts[r.diff.state]++;
 const conflicts=stored.filter(r=>r.diff.conflict?.choice==="review"&&r.diff.state!=="rejected").length;
 const plan:ImportPlan={id,filename,currency:tenant.currency,rows:stored.map(r=>r.diff),counts,conflicts,canCommit:conflicts===0&&(warnings.length===0||options.acknowledgeWarnings)&&(counts.new+counts.changed>0),expiresAt:new Date(Date.now()+30*60_000).toISOString(),warnings};
 if(warnings.length&&!options.acknowledgeWarnings)warnings.push("Confirm that you reviewed the structural/text warnings before creating a commit-ready plan.");
 const journal:Journal={version:1,currency:tenant.currency,plan,rows:stored,listId:list,createdList:false};
 await db.query("UPDATE public.import_job SET summary=$3::jsonb,rejected_rows=$4 WHERE tenant_id=$1 AND id=$2",[tenantId,id,json(journal),counts.rejected]);
 return plan;
}
async function loadJob(db:DB,tenantId:string,id:string){
 const job=(await db.query("SELECT id,status,summary FROM public.import_job WHERE tenant_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE",[tenantId,id,IMPORT])).rows[0];
 if(!job)fail(404,"Import was not found in this workspace.");if(job.summary?.version!==1)fail(409,"This import needs a new dry run.");return job as {id:string;status:string;summary:Journal};
}
// Split one interval at the reviewed date; preserve already scheduled future rows.
async function writeDated(db:DB,tenantId:string,productId:string,list:string|null,value:ImportValue,userId:string,jobId:string,writeCost:boolean,writePrice:boolean){
 if(writeCost&&value.cost!==null){
  const same=(await db.query("SELECT id,effective_from::text,effective_to::text,cost::text FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2 AND basis='standard' AND effective_from<=$3::date AND (effective_to IS NULL OR effective_to>$3::date) FOR UPDATE",[tenantId,productId,value.date])).rows[0];
  if(same&&same.effective_from===value.date)await db.query("UPDATE public.cost_history SET cost=$3::numeric,source=$4,created_by=$5 WHERE tenant_id=$1 AND id=$2",[tenantId,same.id,value.cost,"import:"+jobId,userId]);
  else{
   if(same)await db.query("UPDATE public.cost_history SET effective_to=$3::date WHERE tenant_id=$1 AND id=$2",[tenantId,same.id,value.date]);
   const end=same?.effective_to??(await db.query("SELECT min(effective_from)::text AS value FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2 AND basis='standard' AND effective_from>$3::date",[tenantId,productId,value.date])).rows[0].value;
   await db.query("INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,effective_to,source,created_by,currency) SELECT $1,$2,$3::numeric,'standard',$4::date,$5::date,$6,$7,currency FROM public.tenant WHERE tenant_id=$1",[tenantId,productId,value.cost,value.date,end,"import:"+jobId,userId]);
  }
 }
 if(!writePrice)return;
 const same=(await db.query("SELECT id,effective_from::text,effective_to::text FROM public.price_list_item WHERE tenant_id=$1 AND product_id=$2 AND price_list_id=$3 AND effective_from<=$4::date AND (effective_to IS NULL OR effective_to>$4::date) FOR UPDATE",[tenantId,productId,list,value.date])).rows[0];
 if(same?.effective_from===value.date)await db.query("UPDATE public.price_list_item SET unit_price=$3::numeric WHERE tenant_id=$1 AND id=$2",[tenantId,same.id,value.price]);
 else{
  if(same)await db.query("UPDATE public.price_list_item SET effective_to=$3::date WHERE tenant_id=$1 AND id=$2",[tenantId,same.id,value.date]);
  const end=same?.effective_to??(await db.query("SELECT min(effective_from)::text AS value FROM public.price_list_item WHERE tenant_id=$1 AND product_id=$2 AND price_list_id=$3 AND effective_from>$4::date",[tenantId,productId,list,value.date])).rows[0].value;
  await db.query("INSERT INTO public.price_list_item(tenant_id,price_list_id,product_id,unit_price,effective_from,effective_to,currency) SELECT $1,$2,$3,$4::numeric,$5::date,$6::date,currency FROM public.price_list WHERE tenant_id=$1 AND id=$2",[tenantId,list,productId,value.price,value.date,end]);
 }
}
export async function commitImport(db:DB,tenantId:string,userId:string,id:string,acknowledgeRejected=false){
 const tenant=await lock(db,tenantId),job=await loadJob(db,tenantId,id),j=job.summary;
 if(job.status!=="dry_run"||j.undoneAt)fail(409,"This import has already been committed or undone.");
 if(tenant.currency!==j.currency)fail(409,"The workspace currency changed. Run a fresh preview.");
 if(!j.plan.canCommit||Date.parse(j.plan.expiresAt)<Date.now())fail(409,"Resolve conflicts or create a fresh dry run before committing.");
 if(j.plan.counts.rejected&&!acknowledgeRejected)fail(422,"Confirm that only valid rows will be committed; rejected rows will be skipped.");
 const writes=j.rows.filter(r=>["new","changed"].includes(r.diff.state)),current=await graphs(db,tenantId,j.rows.filter(r=>r.before).map(r=>r.diff.productId));
 // Lock unit definitions (FK parents) and conversions before the factor check.
 const units=new Set((await db.query("SELECT id,code FROM public.uom WHERE tenant_id=$1 ORDER BY id FOR UPDATE",[tenantId])).rows.map(r=>r.code));
 await db.query("SELECT id FROM public.uom_conversion WHERE tenant_id=$1 ORDER BY id FOR UPDATE",[tenantId]);
 for(const r of j.rows.filter(r=>r.diff.state!=="rejected")){
  if((current.has(r.diff.productId)?hash(current.get(r.diff.productId)):"missing")!==r.expected)fail(409,`Row ${r.diff.row} changed in the app after this dry run. Review a new diff.`);
  if(!r.before&&(await db.query("SELECT id FROM public.product WHERE tenant_id=$1 AND sku=$2",[tenantId,r.input.sku])).rows.length)fail(409,`Row ${r.diff.row}: this SKU was created after the dry run.`);
  if(!r.before&&!units.has(r.input.unit))fail(409,`Row ${r.diff.row}: the registered base unit changed. Run a fresh preview.`);
  if(r.conversion){const c=r.conversion;const factor=(await db.query("SELECT public.convert_quantity($1::uuid,$2::uuid,1::numeric,$3::text,$4::text,$5::date)::text AS factor",[tenantId,r.diff.productId,c.from,c.to,c.date])).rows[0].factor;if(factor!==c.factor)fail(409,`Row ${r.diff.row}: the unit conversion changed. Run a fresh preview.`);}
 }
 const currentList=await listId(db,tenantId);if(currentList!==j.listId)fail(409,"The import price list changed. Run a fresh preview.");
 if(!j.listId&&writes.some(r=>!r.before||r.input.price!==r.diff.before?.price)){j.listId=randomUUID();j.createdList=true;await db.query("INSERT INTO public.price_list(id,tenant_id,name,currency) VALUES($1,$2,$3,$4)",[j.listId,tenantId,LIST,tenant.currency]);}
 for(const r of writes){
  const v=r.input;
  if(!r.before){
   await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,supplier,uom,unit_cost,list_price) VALUES($1,$2,$3,$4,'Imported',$5,$6,$7::numeric,$8::numeric)",[r.diff.productId,tenantId,v.sku,v.description,v.supplier||null,v.unit,v.cost,v.price]);
   // Replace this new product's trigger-created cost with its reviewed date.
   await db.query("DELETE FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2",[tenantId,r.diff.productId]);
  }else await db.query("UPDATE public.product SET name=$3,supplier=$4 WHERE tenant_id=$1 AND id=$2",[tenantId,r.diff.productId,v.description,v.supplier||null]);
  await writeDated(db,tenantId,r.diff.productId,j.listId,v,userId,id,!r.before||v.cost!==r.diff.before?.cost,!r.before||v.price!==r.diff.before?.price);
 }
 j.after=Object.fromEntries(await graphs(db,tenantId,writes.map(r=>r.diff.productId)));j.committedAt=new Date().toISOString();j.committedBy=userId;
 await db.query("UPDATE public.import_job SET status='committed',accepted_rows=$3,summary=$4::jsonb WHERE tenant_id=$1 AND id=$2",[tenantId,id,writes.length,json(j)]);
 return {id,accepted:writes.length,rejected:j.plan.counts.rejected};
}
export async function undoImport(db:DB,tenantId:string,userId:string,id:string){
 const tenant=await lock(db,tenantId),job=await loadJob(db,tenantId,id),j=job.summary;
 if(job.status!=="committed"||!j.after||j.undoneAt)fail(409,"Only a committed import that has not been undone can be undone.");
 if(tenant.currency!==j.currency)fail(409,"The workspace currency changed. Review it before undoing.");
 const after=j.after!;
 const writes=j.rows.filter(r=>["new","changed"].includes(r.diff.state)),current=await graphs(db,tenantId,writes.map(r=>r.diff.productId));
 for(const r of writes)if(!current.has(r.diff.productId)||businessHash(current.get(r.diff.productId)!)!==businessHash(after[r.diff.productId]))fail(409,`Row ${r.diff.row} changed after the import. Undo was blocked to preserve that edit.`);
 if(j.listId&&(await listId(db,tenantId))!==j.listId)fail(409,"The import price list changed. Review it before undoing.");
 if(j.createdList){
  const extra=(await db.query("SELECT count(*)::int AS n FROM public.price_list_item WHERE tenant_id=$1 AND price_list_id=$2 AND NOT(product_id=ANY($3::uuid[]))",[tenantId,j.listId,writes.map(r=>r.diff.productId)])).rows[0].n;
  const versions=(await db.query("SELECT count(*)::int AS n FROM public.price_list_version WHERE tenant_id=$1 AND price_list_id=$2",[tenantId,j.listId])).rows[0].n;
  if(extra||versions)fail(409,"This import's price list is now used by later work. Undo that work first.");
 }
 for(const r of writes){
  await db.query("DELETE FROM public.price_list_item WHERE tenant_id=$1 AND product_id=$2",[tenantId,r.diff.productId]);
  await db.query("DELETE FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2",[tenantId,r.diff.productId]);
  if(!r.before)await db.query("DELETE FROM public.product WHERE tenant_id=$1 AND id=$2",[tenantId,r.diff.productId]);
  else{
   const p=r.before.product;await db.query("UPDATE public.product SET name=$3,supplier=$4 WHERE tenant_id=$1 AND id=$2",[tenantId,p.id,p.name,p.supplier]);
   for(const c of r.before.costs)await db.query("INSERT INTO public.cost_history(id,tenant_id,product_id,cost,basis,effective_from,effective_to,source,created_by,created_at,currency) VALUES($1,$2,$3,$4::numeric,$5,$6::date,$7::date,$8,$9,$10::timestamptz,$11)",[c.id,tenantId,p.id,c.cost,c.basis,c.effective_from,c.effective_to,c.source,c.created_by,c.created_at,c.currency]);
   for(const v of r.before.prices)await db.query("INSERT INTO public.price_list_item(id,tenant_id,price_list_id,product_id,unit_price,effective_from,effective_to,version_id,currency) VALUES($1,$2,$3,$4,$5::numeric,$6::date,$7::date,$8,$9)",[v.id,tenantId,v.price_list_id,p.id,v.unit_price,v.effective_from,v.effective_to,v.version_id,v.currency]);
  }
 }
 if(j.createdList)await db.query("DELETE FROM public.price_list WHERE tenant_id=$1 AND id=$2",[tenantId,j.listId]);
 j.undoneAt=new Date().toISOString();j.undoneBy=userId;
 await db.query("UPDATE public.import_job SET summary=$3::jsonb WHERE tenant_id=$1 AND id=$2",[tenantId,id,json(j)]);
 return {id,undone:true};
}
export async function importHistory(db:DB,tenantId:string):Promise<ImportHistory[]>{
 const rows=(await db.query(`SELECT j.id,j.source_name,j.status,COALESCE(j.summary->>'committedAt',j.created_at::text) AS happened_at,j.accepted_rows,j.rejected_rows,j.summary->>'undoneAt' AS undone_at,j.summary#>>'{plan,counts,unchanged}' AS unchanged_rows,
  COALESCE(m.email,'Former workspace member') AS who
  FROM public.import_job j LEFT JOIN public.membership m ON m.tenant_id=j.tenant_id AND m.user_id::text=COALESCE(j.summary->>'committedBy',j.created_by::text)
  WHERE j.tenant_id=$1 AND j.import_type=$2 ORDER BY j.created_at DESC,j.id LIMIT 50`,[tenantId,IMPORT])).rows;
 return rows.map(r=>({id:r.id,filename:r.source_name||"Supplier file",status:r.undone_at?"undone":r.status,who:r.who,when:r.happened_at,accepted:r.accepted_rows,rejected:r.rejected_rows,unchanged:Number(r.unchanged_rows||0),undoneAt:r.undone_at,canUndo:r.status==="committed"&&!r.undone_at}));
}
