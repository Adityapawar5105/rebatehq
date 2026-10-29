import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import {HttpError} from "./authz";
import {sheetsCsvUrl,fetchSheetsCsv} from "./sheets-fetch";
import {parseUpload,validateMapping,columnName} from "./upload-parser";
import {createImportReview,headersFingerprint} from "./import-review";
import {previewImport,ImportOptions} from "./import-lifecycle";
import {UPLOAD_LIMITS} from "./upload-types";
type DB=Pick<PoolClient,"query">;
export const SHEETS_SCHEDULE_TYPE="sheets_ingestion_v1";
export const ingestionFlags=()=>({sheets:process.env.MD_SHEETS_INGESTION==="true",emailStub:process.env.MD_EMAIL_DROP_STUB==="true",sftpStub:process.env.MD_SFTP_DROP_STUB==="true"});
export type IngestionFlags=ReturnType<typeof ingestionFlags>;
export const ScheduleInput=z.object({
 id:z.uuid().optional(),name:z.string().trim().min(1).max(120),url:z.string().max(2048),
 templateId:z.uuid(),headerRow:z.number().int().min(1).max(UPLOAD_LIMITS.rows).default(1),
 intervalHours:z.union([z.literal(1),z.literal(6),z.literal(24),z.literal(168)]).default(24),
 numericFormat:z.enum(["dot","comma"]).default("dot"),
 approveTextNumbers:z.boolean().default(false),approveUnits:z.boolean().default(false)
}).strict();
const Config=z.object({
 version:z.literal(1),name:z.string(),url:z.string().max(2048),templateId:z.uuid(),
 fields:z.record(z.string(),z.number().int()),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
 headerHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(64),
 headerRow:z.number().int().min(1).max(UPLOAD_LIMITS.rows),intervalHours:z.number().int().min(1).max(168),
 numericFormat:z.enum(["dot","comma"]),approveTextNumbers:z.boolean(),approveUnits:z.boolean(),
 enabled:z.boolean(),nextRunAt:z.iso.datetime(),inFlightUntil:z.iso.datetime().nullable(),
 lastRunId:z.uuid().nullable(),lastPlanId:z.uuid().nullable(),lastReviewId:z.uuid().nullable(),lastError:z.string().nullable()
}).strict();
type ScheduleConfig=z.infer<typeof Config>;
function enabled(flags:IngestionFlags){if(!flags.sheets)throw new HttpError(409,"Google Sheets ingestion is disabled by the operator.");}
async function actor(db:DB,tenant:string,user:string){
 const ok=(await db.query("SELECT 1 FROM public.membership WHERE tenant_id=$1 AND user_id=$2 AND user_id::text=current_setting('request.jwt.claim.sub',true) AND status='active' AND role IN ('owner','manager')",[tenant,user])).rows[0];
 if(!ok)throw new HttpError(403,"Only a workspace owner or manager can schedule file reviews.");
}
async function scheduleLock(db:DB,tenant:string){
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",["ingestion:"+tenant]);
}
function config(value:unknown){const result=Config.safeParse(value);if(!result.success)throw new HttpError(409,"This schedule needs to be saved again before it can run.");return result.data;}
export async function saveSchedule(db:DB,tenant:string,user:string,raw:z.infer<typeof ScheduleInput>,flags=ingestionFlags()){
 enabled(flags);await actor(db,tenant,user);await scheduleLock(db,tenant);
 const input=ScheduleInput.parse(raw),url=sheetsCsvUrl(input.url);
 const template=(await db.query("SELECT column_mapping FROM public.column_mapping_template WHERE tenant_id=$1 AND id=$2 AND import_type='supplier_file_mapping_v1' AND column_mapping->>'fileType'='csv'",[tenant,input.templateId])).rows[0]?.column_mapping;
 if(!template)throw new HttpError(422,"Save and choose a CSV column-mapping template from this workspace first.");
 const fields=validateMapping(template.fields,64);
 if(fields.sku===undefined||typeof template.headersFingerprint!=="string")throw new HttpError(422,"The mapping template needs a SKU column and a header fingerprint.");
 const headerHashes=Config.shape.headerHashes.safeParse(template.headerHashes);
 if(!headerHashes.success)throw new HttpError(422,"Review a CSV and re-save this older mapping template to enable exact header-column checks.");
 let previous:ScheduleConfig|null=null;
 if(input.id){const existing=(await db.query("SELECT column_mapping FROM public.column_mapping_template WHERE tenant_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE",[tenant,input.id,SHEETS_SCHEDULE_TYPE])).rows[0];
  if(!existing)throw new HttpError(404,"Schedule was not found in this workspace.");previous=config(existing.column_mapping);
  if(previous.inFlightUntil&&Date.parse(previous.inFlightUntil)>Date.now())throw new HttpError(409,"Wait for the active fetch to finish before changing this schedule.");
 }else if(Number((await db.query("SELECT count(*)::integer AS n FROM public.column_mapping_template WHERE tenant_id=$1 AND import_type=$2",[tenant,SHEETS_SCHEDULE_TYPE])).rows[0].n)>=10)throw new HttpError(422,"Use at most ten Sheets schedules per workspace.");
 const id=input.id||randomUUID();
 const value:ScheduleConfig={version:1,name:input.name,url,templateId:input.templateId,fields,fingerprint:template.headersFingerprint,headerHashes:headerHashes.data,
  headerRow:input.headerRow,intervalHours:input.intervalHours,numericFormat:input.numericFormat,
  approveTextNumbers:input.approveTextNumbers,approveUnits:input.approveUnits,enabled:previous?.enabled??true,nextRunAt:new Date().toISOString(),
  inFlightUntil:null,lastRunId:previous?.lastRunId||null,lastPlanId:previous?.lastPlanId||null,lastReviewId:previous?.lastReviewId||null,lastError:null};
 if(input.id)await db.query("UPDATE public.column_mapping_template SET column_mapping=$3::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,id,JSON.stringify(value)]);
 else await db.query("INSERT INTO public.column_mapping_template(id,tenant_id,name,import_type,column_mapping,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[id,tenant,"sheets:"+id,SHEETS_SCHEDULE_TYPE,JSON.stringify(value),user]);
 return {id};
}
export async function pauseSchedule(db:DB,tenant:string,user:string,id:string,active=false,flags=ingestionFlags()){
 if(active)enabled(flags);
 await actor(db,tenant,user);await scheduleLock(db,tenant);
 const result=await db.query("UPDATE public.column_mapping_template SET column_mapping=jsonb_set(jsonb_set(column_mapping,'{enabled}',$4::jsonb),'{nextRunAt}',$5::jsonb) WHERE tenant_id=$1 AND id=$2 AND import_type=$3 RETURNING id",[tenant,id,SHEETS_SCHEDULE_TYPE,JSON.stringify(active),JSON.stringify(new Date().toISOString())]);
 if(!result.rows.length)throw new HttpError(404,"Schedule was not found in this workspace.");return {id,paused:!active};
}
export async function ingestionState(db:DB,tenant:string,flags=ingestionFlags()){
 const schedules=(await db.query("SELECT id,column_mapping FROM public.column_mapping_template WHERE tenant_id=$1 AND import_type=$2 ORDER BY created_at,id LIMIT 10",[tenant,SHEETS_SCHEDULE_TYPE])).rows.map(r=>({id:r.id,...config(r.column_mapping)}));
 const templates=(await db.query("SELECT id,column_mapping->>'supplier' AS supplier,column_mapping ? 'headerHashes' AS column_checks FROM public.column_mapping_template WHERE tenant_id=$1 AND import_type='supplier_file_mapping_v1' AND column_mapping->>'fileType'='csv' ORDER BY created_at DESC LIMIT 100",[tenant])).rows;
 const runs=(await db.query("SELECT id,provider,status,processed_count::text,failed_count::text,started_at,finished_at FROM public.connector_sync_run WHERE tenant_id=$1 AND provider='google_sheets' ORDER BY created_at DESC,id LIMIT 20",[tenant])).rows;
 return {schedules,templates,runs,flags,stubs:stubInterfaces(tenant,flags)};
}
export function stubInterfaces(tenant:string,flags:IngestionFlags){
 if(!z.uuid().safeParse(tenant).success)throw new HttpError(400,"Choose a valid workspace.");
 return {email:flags.emailStub?{address:`invoices+${tenant}@drop.margindesk.invalid`,status:"Preview only: this address cannot receive email."}:null,
  sftp:flags.sftpStub?{path:`/preview-only/${tenant}/inbox`,status:"Preview only: no SFTP server or upload endpoint exists."}:null};
}
export type Transaction=<T>(fn:(db:DB)=>Promise<T>)=>Promise<T>;
type Claim={id:string;runId:string;value:ScheduleConfig};
export async function claimSchedule(db:DB,tenant:string,user:string,id:string|undefined,flags=ingestionFlags()):Promise<Claim|null>{
 enabled(flags);await actor(db,tenant,user);await scheduleLock(db,tenant);
 const candidates=(await db.query(`SELECT id,column_mapping FROM public.column_mapping_template
  WHERE tenant_id=$1 AND import_type=$2 AND ($3::uuid IS NULL OR id=$3)
  ORDER BY created_at,id FOR UPDATE`,[tenant,SHEETS_SCHEDULE_TYPE,id||null])).rows;
 const now=Date.now();
 for(const row of candidates){
  const value=config(row.column_mapping);
  if(!value.enabled)continue;
  if(value.inFlightUntil&&Date.parse(value.inFlightUntil)>now){if(id)throw new HttpError(409,"A fetch for this schedule is already running.");continue;}
  if(!id&&Date.parse(value.nextRunAt)>now)continue;
  if(value.lastRunId)await db.query("UPDATE public.connector_sync_run SET status='failed',finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='running'",[tenant,value.lastRunId]);
  // Revalidate persisted URLs too; they are not trusted merely because saved.
  value.url=sheetsCsvUrl(value.url);
  const runId=randomUUID();
  await db.query("INSERT INTO public.connector_sync_run(id,tenant_id,provider,direction,status,started_at,created_by) VALUES($1,$2,'google_sheets','inbound','running',now(),$3)",[runId,tenant,user]);
  value.lastRunId=runId;value.inFlightUntil=new Date(now+10*60_000).toISOString();
  value.nextRunAt=new Date(now+value.intervalHours*3600_000).toISOString();value.lastError=null;
  await db.query("UPDATE public.column_mapping_template SET column_mapping=$3::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,row.id,JSON.stringify(value)]);
  return {id:row.id,runId,value};
 }
 if(id)throw new HttpError(404,"Enabled schedule was not found in this workspace.");return null;
}
export async function runSchedule(transaction:Transaction,tenant:string,user:string,id?:string,flags=ingestionFlags(),fetcher=fetchSheetsCsv){
 const claim=await transaction(db=>claimSchedule(db,tenant,user,id,flags));if(!claim)return {ran:false as const};
 try{
  // Deliberately outside a database transaction: no locks/connections are held
  // while DNS/HTTPS runs, and no provider credentials are sent.
  const bytes=await fetcher(claim.value.url);
  const parsed=parseUpload("google-sheet.csv",bytes,{headerRow:claim.value.headerRow,mapping:claim.value.fields});
  if(headersFingerprint(parsed.headers)!==claim.value.fingerprint){
   const changed:string[]=[];
   for(let i=0;i<Math.max(parsed.headers.length,claim.value.headerHashes.length);i++){
    if(claim.value.headerHashes[i]!== (i<parsed.headers.length?headersFingerprint([parsed.headers[i]]):null))changed.push(columnName(i));
   }
   if(!changed.length)throw new HttpError(409,"The saved header checks are inconsistent. Re-save the CSV mapping template before fetching again.");
   throw new HttpError(422,`Row ${parsed.headerRow}, ${changed.length===1?"column":"columns"} ${changed.join(", ")}: sheet headers changed. Review the file and re-save its CSV mapping template.`);
  }
  return await transaction(async db=>{
   await actor(db,tenant,user);await scheduleLock(db,tenant);
   const current=(await db.query("SELECT column_mapping FROM public.column_mapping_template WHERE tenant_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE",[tenant,claim.id,SHEETS_SCHEDULE_TYPE])).rows[0];
   const value=current?config(current.column_mapping):null;
   if(!value?.enabled||value.lastRunId!==claim.runId)throw new HttpError(409,"The schedule changed during the fetch. No import was staged.");
   const review=await createImportReview(db,tenant,user,parsed);
   const date=(await db.query("SELECT current_date::text AS date")).rows[0].date;
   const plan=await previewImport(db,tenant,user,"Google Sheets CSV",parsed,ImportOptions.parse({effectiveDate:date,
    numericFormat:claim.value.numericFormat,approveTextNumbers:claim.value.approveTextNumbers,approveUnits:claim.value.approveUnits,acknowledgeWarnings:false}));
   await db.query("UPDATE public.import_job SET summary=jsonb_set(summary,'{ingestion}',$3::jsonb) WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenant,[review.jobId,plan.id],JSON.stringify({provider:"google_sheets",scheduleId:claim.id,runId:claim.runId,reviewId:review.jobId})]);
   await db.query("UPDATE public.connector_sync_run SET status='succeeded',processed_count=$3,failed_count=$4,finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='running'",[tenant,claim.runId,parsed.rows.length,plan.counts.rejected]);
   value.lastPlanId=plan.id;value.lastReviewId=review.jobId;value.inFlightUntil=null;value.lastError=null;
   await db.query("UPDATE public.column_mapping_template SET column_mapping=$3::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,claim.id,JSON.stringify(value)]);
   return {ran:true as const,runId:claim.runId,planId:plan.id,reviewId:review.jobId};
  });
 }catch(error){
  const message=error instanceof HttpError?error.message:"The scheduled review failed. Retry or review the source file.";
  await transaction(async db=>{
   await db.query("UPDATE public.connector_sync_run SET status='failed',finished_at=now() WHERE tenant_id=$1 AND id=$2 AND status='running'",[tenant,claim.runId]);
   const current=(await db.query("SELECT column_mapping FROM public.column_mapping_template WHERE tenant_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE",[tenant,claim.id,SHEETS_SCHEDULE_TYPE])).rows[0];
   if(current){const value=config(current.column_mapping);if(value.lastRunId===claim.runId){value.inFlightUntil=null;value.lastError=message;await db.query("UPDATE public.column_mapping_template SET column_mapping=$3::jsonb WHERE tenant_id=$1 AND id=$2",[tenant,claim.id,JSON.stringify(value)]);}}
  });
  throw new HttpError(error instanceof HttpError?error.status:500,message);
 }
}
