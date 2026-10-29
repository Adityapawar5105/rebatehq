import {randomUUID,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {Pool} from "pg";
import type {PoolClient} from "pg";
type DB=Pick<PoolClient,"query">;
export async function seedRestoreData(db:DB){
 const tenant="61000000-0000-4000-8000-000000000001",product="62000000-0000-4000-8000-000000000001";
 if((await db.query("SELECT 1 FROM public.tenant WHERE tenant_id=$1",[tenant])).rows.length)throw new Error("Restore sentinel UUID collision in public.tenant; use a clean disposable source.");
 await db.query("INSERT INTO public.tenant(tenant_id,name,currency,is_demo) VALUES($1,'Restore drill sentinel','USD',true)",[tenant]);
 await db.query("INSERT INTO public.product(tenant_id,id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'RESTORE-SENTINEL','Restore drill sentinel product','Test','EA',1,2)",[tenant,product]);
 const customer=randomUUID(),invoice=randomUUID(),line=randomUUID(),schedule=randomUUID(),run=randomUUID();
 await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,'RESTORE-CUSTOMER','Restore invoice customer')",[customer,tenant]);
 await db.query("INSERT INTO public.invoice(id,tenant_id,customer_id,invoice_date,currency,source_ref) VALUES($1,$2,$3,'2026-10-29','USD','restore-invoice')",[invoice,tenant,customer]);
 await db.query("INSERT INTO public.invoice_line(id,tenant_id,invoice_id,product_id,quantity,net_sales,currency,uom_code,actual_cost_amount,actual_cost_source) VALUES($1,$2,$3,$4,1,2,'USD','EA',1,'restore-vendor-bill')",[line,tenant,invoice,product]);
 await db.query("INSERT INTO public.cost_component(tenant_id,invoice_line_id,component_type,amount,currency,source_ref) VALUES($1,$2,'freight',0,'USD','restore-freight'),($1,$2,'off_invoice_rebate',0,'USD','restore-rebate')",[tenant,line]);
 await db.query("INSERT INTO public.connector_sync_run(id,tenant_id,provider,direction,status,started_at,finished_at) VALUES($1,$2,'google_sheets','inbound','succeeded',now(),now())",[run,tenant]);
 const template=randomUUID(),fields={sku:0,unit:1,cost:2,price:3},fingerprint=createHash("sha256").update(JSON.stringify(["SKU","Unit","Cost","Price"])).digest("hex");
 const headerHashes=["SKU","Unit","Cost","Price"].map(header=>createHash("sha256").update(JSON.stringify([header])).digest("hex"));
 await db.query("INSERT INTO public.column_mapping_template(id,tenant_id,name,import_type,column_mapping) VALUES($1,$2,'restore-csv-mapping','supplier_file_mapping_v1',$3::jsonb)",[template,tenant,JSON.stringify({supplier:"Restore fixture",fileType:"csv",fields,headersFingerprint:fingerprint,headerHashes,schemaVersion:1})]);
 const value={version:1,name:"Restored disabled Sheets schedule",url:"https://docs.google.com/spreadsheets/d/restore_fixture_only/export?format=csv&gid=0",
  templateId:template,fields,fingerprint,headerHashes,
  headerRow:1,intervalHours:24,numericFormat:"dot",approveTextNumbers:false,approveUnits:false,enabled:false,
  nextRunAt:new Date().toISOString(),inFlightUntil:null,lastRunId:run,lastPlanId:null,lastReviewId:null,lastError:null};
 // This disabled configuration is restore evidence, not a live Google document.
 await db.query("INSERT INTO public.column_mapping_template(id,tenant_id,name,import_type,column_mapping) VALUES($1,$2,$3,'sheets_ingestion_v1',$4::jsonb)",[schedule,tenant,"sheets:"+schedule,JSON.stringify(value)]);
 return {tenant,product,invoice,line,schedule,run};
}
async function main(){
 if(!process.env.SEED_DATABASE_URL)throw new Error("SEED_DATABASE_URL is required for the disposable restore drill.");
 const pool=new Pool({connectionString:process.env.SEED_DATABASE_URL,ssl:/(localhost|127\.0\.0\.1)/i.test(process.env.SEED_DATABASE_URL)?false:{rejectUnauthorized:true}});
 const db=await pool.connect();
 try{await db.query("BEGIN");await seedRestoreData(db);await db.query("COMMIT");process.stdout.write("Seeded restore sentinel, sourced invoice actuals and disabled ingestion metadata.\n");}
 catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write("Could not seed disposable restore fixtures. Check source setup and sentinel UUID collisions.\n");process.exitCode=1;});
