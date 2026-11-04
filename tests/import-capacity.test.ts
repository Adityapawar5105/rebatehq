import { testIdentity, installTestIdentityKey } from './helpers/signed-context';
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {MAX_IMPORT_DATA_ROWS,IMPORT_BATCH_SIZE,IMPORT_PREVIEW_PAGE_SIZE,importBatches} from "../lib/import-config";
import {parseUpload} from "../lib/upload-parser";
import {previewImport,commitImport,undoImport,exportLifeline,importPlanPage,resolveImportChoices,ImportOptions} from "../lib/import-lifecycle";
import {createImportReview,importReviewIssues} from "../lib/import-review";
import {csvDocument} from "../lib/csv";
const parse=(text:string)=>parseUpload("capacity.csv",new TextEncoder().encode(text),{headerRow:1});
async function boot(){
 const {PGlite}=await import("@electric-sql/pglite"),{pgcrypto}=await import("@electric-sql/pglite/contrib/pgcrypto"),{btree_gist}=await import("@electric-sql/pglite/contrib/btree_gist");
 const db:any=new PGlite({extensions:{pgcrypto,btree_gist}});
 await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const n of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort())await db.exec(readFileSync("supabase/migrations/"+n,"utf8"));
 await installTestIdentityKey(db);
 return db;
}
async function allCounts(db:any){
 const tables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id') ORDER BY c.relname")).rows;
 assert.equal(tables.length,42);const result:Record<string,number>={};
 for(const t of tables)result[t.relname]=(await db.query(`SELECT count(*)::integer AS n FROM public.${t.relname}`)).rows[0].n;
 return result;
}
async function business(db:any,tenant:string){
 const result:Record<string,unknown>={};
 for(const table of ["product","cost_history","price_list","price_list_item","uom"]){
  result[table]=(await db.query(`SELECT count(*)::integer AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) AS content FROM public.${table} t WHERE tenant_id=$1`,[tenant])).rows[0];
 }return result;
}
async function failureInSecondBatch(db:any,tenant:string,user:string,id:string,action:"commit"|"undo"){
 const before=await allCounts(db),values=await business(db,tenant);let batches=0;
 await db.exec("SAVEPOINT batch_failure;");
 const broken:any={query:async(sql:string,args:any[])=>{
  const boundary=action==="commit"?/^(INSERT INTO public.product|UPDATE public.product p SET name=x.description)/:/^DELETE FROM public.price_list_item/;
  if(boundary.test(sql.trim())&&++batches===2)await db.query("SELECT 1/0");
  return db.query(sql,args);
 }};
 await assert.rejects(action==="commit"?commitImport(broken,tenant,user,id):undoImport(broken,tenant,user,id),(e:any)=>e.code==="22012");
 assert.equal(batches,2,"failure must occur after a real first batch");
 await db.exec("ROLLBACK TO SAVEPOINT batch_failure;");
 assert.deepEqual(await business(db,tenant),values,"later-batch failure rolls back all business writes");
 assert.deepEqual(await allCounts(db),before,"journal and audit rows also roll back; no intermediate batch commits");
}
for(const populated of [false,true])test(`import capacity boundaries and atomic batches on ${populated?"populated":"fresh"} data`,{timeout:600_000},async()=>{
 const db=await boot();
 try{
  const empty=await allCounts(db);
  for(const size of [200,MAX_IMPORT_DATA_ROWS,MAX_IMPORT_DATA_ROWS+1])for(let run=1;run<=2;run++){
   await db.exec("BEGIN;");
   const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),otherUser=randomUUID();
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)",[user,user+"@example.invalid",otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Capacity'),($2,'Other')",[tenant,other]);
   await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner'),($4,$5,$6,'owner')",[tenant,user,user+"@example.invalid",other,otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'EA','Each')",[tenant]);
   const date=(await db.query("SELECT current_date::text AS value")).rows[0].value;
   const fixtures=Array.from({length:size>MAX_IMPORT_DATA_ROWS?200:size},(_,i)=>({id:randomUUID(),sku:"P-"+String(i).padStart(5,"0")}));
   if(populated){
    for(const batch of importBatches(fixtures))await db.query(`INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price,supplier)
     SELECT x.id,$1,x.sku,'Original','Fixture','EA',10,20,'Acme' FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,sku text)`,[tenant,JSON.stringify(batch)]);
    const list=randomUUID();await db.query("INSERT INTO public.price_list(id,tenant_id,name,currency) VALUES($1,$2,'RebateHQ file imports','USD')",[list,tenant]);
    for(const batch of importBatches(fixtures))await db.query(`INSERT INTO public.price_list_item(tenant_id,price_list_id,product_id,unit_price,effective_from,currency)
     SELECT $1,$2,x.id,20,$3::date,'USD' FROM jsonb_to_recordset($4::jsonb) AS x(id uuid)`,[tenant,list,date,JSON.stringify(batch)]);
    await db.query("INSERT INTO public.product(tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,'UNRELATED','Other tenant','Fixture','EA',7,14)",[other]);
    await db.query("INSERT INTO public.import_job(tenant_id,import_type,status,source_name) VALUES($1,'earlier_upload','committed','prior.csv')",[tenant]);
   }
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);await testIdentity(db,user);
   await db.exec("SET LOCAL ROLE rebatehq_app;");
   const role=(await db.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
   assert.equal(role.name,"rebatehq_app");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
   const text=csvDocument(["SKU","Description","Unit","Cost","Price","Supplier","Date"],Array.from({length:size},(_,i)=>["P-"+String(i).padStart(5,"0"),"Imported","EA","12","25","Acme",date]));
   if(size>MAX_IMPORT_DATA_ROWS){
    const before=await allCounts(db);
    assert.throws(()=>parse(text),(e:any)=>e.status===422&&/data rows/.test(e.message));
    const direct=parse(text.split("\r\n").slice(0,2).join("\r\n"));direct.rows=Array.from({length:size},(_,i)=>({...direct.rows[0],row:i+2}));
    await assert.rejects(previewImport(db,tenant,user,"overflow.csv",direct,ImportOptions.parse({effectiveDate:date})),(e:any)=>e.status===422);
    assert.deepEqual(await allCounts(db),before,"overflow must create no job or issue rows");
   }else{
    let source=text;
    if(populated){
     const exported=parse(await exportLifeline(db,tenant,user,"Acme"));assert.equal(exported.rows.length,size,"lifeline export uses the same row maximum");
     source=csvDocument(exported.headers,exported.rows.map(r=>r.cells.map((c,i)=>i===3?"Imported":i===5?"12":i===6?"25":c.value)));
     await db.query("UPDATE public.product SET name='App edit' WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[tenant,[fixtures[0].id,fixtures.at(-1)!.id]]);
    }
    const baseline=await business(db,tenant),parseStart=performance.now(),parsed=parse(source),parseMs=performance.now()-parseStart;
    const review=await createImportReview(db,tenant,user,parsed);
    assert.ok((review.totalIssues||0)>=size*2,"text-number issues are retained beyond the old 8,000-issue ceiling");
    assert.ok(review.issues.length<=IMPORT_PREVIEW_PAGE_SIZE);
    const lastIssueOffset=Math.max(0,(review.totalIssues||0)-IMPORT_PREVIEW_PAGE_SIZE);
    const issuePage=await importReviewIssues(db,tenant,review.jobId,lastIssueOffset);
    assert.ok(issuePage.issues.some((i:any)=>i.row===size+1),"the last row's issues remain accessible");
    const previewStart=performance.now();
    let plan=await previewImport(db,tenant,user,"capacity.csv",parsed,ImportOptions.parse({effectiveDate:date,approveTextNumbers:true,acknowledgeWarnings:true}));
    const previewMs=performance.now()-previewStart;
    assert.equal(plan.totalRows,size);assert.equal(plan.rows.length,Math.min(IMPORT_PREVIEW_PAGE_SIZE,size));
    assert.equal(plan.counts[populated?"changed":"new"],size);assert.equal(plan.counts.rejected,0);
    const lastOffset=Math.max(0,size-IMPORT_PREVIEW_PAGE_SIZE),lastPage=await importPlanPage(db,tenant,plan.id,lastOffset);
    assert.equal(lastPage.rows.at(-1)!.row,size+1);
    if(populated){
     assert.equal(plan.conflicts,2);assert.equal(plan.canCommit,false);
     plan=await resolveImportChoices(db,tenant,plan.id,{"2":"file"},lastOffset);assert.equal(plan.conflicts,1);
     plan=await resolveImportChoices(db,tenant,plan.id,{[String(size+1)]:"file"},0);assert.equal(plan.conflicts,0);
    }
    const jobs=(await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1 AND import_type='catalog_import_v1'",[tenant])).rows[0].n;
    assert.equal(jobs,1,"one import_job for every batch and conflict page");
    const auditBefore=(await db.query("SELECT count(*)::integer AS n FROM public.audit_log WHERE tenant_id=$1 AND action=$2",[tenant,populated?"product.update":"product.insert"])).rows[0].n;
    if(size===MAX_IMPORT_DATA_ROWS&&run===1)await failureInSecondBatch(db,tenant,user,plan.id,"commit");
    const commitStart=performance.now();await commitImport(db,tenant,user,plan.id);const commitMs=performance.now()-commitStart;
    assert.equal((await db.query("SELECT status,accepted_rows FROM public.import_job WHERE id=$1",[plan.id])).rows[0].accepted_rows,size);
    const auditAfter=(await db.query("SELECT count(*)::integer AS n FROM public.audit_log WHERE tenant_id=$1 AND action=$2",[tenant,populated?"product.update":"product.insert"])).rows[0].n;
    assert.equal(auditAfter-auditBefore,size,"every changed/inserted product is audited");
    if(size===MAX_IMPORT_DATA_ROWS&&run===1)await failureInSecondBatch(db,tenant,user,plan.id,"undo");
    const undoStart=performance.now();await undoImport(db,tenant,user,plan.id);const undoMs=performance.now()-undoStart;
    assert.deepEqual(await business(db,tenant),baseline,"undo restores exact row counts, IDs, values and dated history");
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1 AND import_type='catalog_import_v1'",[tenant])).rows[0].n,1);
    console.log("IMPORT_CAPACITY_TIMING "+JSON.stringify({mode:populated?"populated":"fresh",rows:size,run,parse_ms:Math.round(parseMs),preview_ms:Math.round(previewMs),commit_ms:Math.round(commitMs),undo_ms:Math.round(undoMs),batch_size:IMPORT_BATCH_SIZE}));
   }
   await db.exec("RESET ROLE;ROLLBACK;");assert.deepEqual(await allCounts(db),empty,"each repeated run leaves all 38 tenant tables unchanged");
   await db.exec("VACUUM;");
  }
 }finally{await db.close();}
});
