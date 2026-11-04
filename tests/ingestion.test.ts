import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {testDatabase,tenantCounts,normalizedSql} from "./helpers/database";
import {saveSchedule,pauseSchedule,claimSchedule,runSchedule,ingestionState,stubInterfaces,SHEETS_SCHEDULE_TYPE,ScheduleInput} from "../lib/ingestion";
import {saveMappingTemplate} from "../lib/import-review";
import {parseUpload} from "../lib/upload-parser";
import {commitImport,undoImport,importPlanPage,resolveImportChoices} from "../lib/import-lifecycle";
import {benchmarkImport} from "../scripts/benchmark-import";
const flags={sheets:true,emailStub:true,sftpStub:true},link="https://docs.google.com/spreadsheets/d/abcdefghijklmno/edit";
const executed=new Set<string>();
test("Sheets schedules stage tenant-isolated audited reviews, reject changed data safely and repeat on fresh/populated schemas",async()=>{
 const db=await testDatabase(executed);
 try{
  const empty=await tenantCounts(db);
  for(const populated of [false,true])for(let repeat=0;repeat<2;repeat++){
   await db.exec("BEGIN;");
   const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),otherUser=randomUUID();
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)",[user,user+"@example.invalid",otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Sheets'),($2,'Restored other tenant')",[tenant,other]);
   await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner'),($4,$5,$6,'owner')",[tenant,user,user+"@example.invalid",other,otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'EA','Each')",[tenant]);
   if(populated){
    await db.query("INSERT INTO public.product(tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,'P','Existing part','Test','EA',5,15)",[tenant]);
    await db.query("INSERT INTO public.import_job(tenant_id,import_type,status) VALUES($1,'preexisting','committed')",[other]);
    await db.query("INSERT INTO public.connector_sync_run(tenant_id,provider,direction,status,started_at,finished_at) VALUES($1,'fixture','inbound','succeeded',now(),now())",[other]);
   }
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);await db.exec("SET LOCAL ROLE rebatehq_app;");
   const role=(await db.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
   assert.equal(role.role,"rebatehq_app");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
   const bytes=new TextEncoder().encode("\uFEFFSKU,Description,Unit,Cost,Price\nP,Part,EA,10,20");
   const parsed=parseUpload("sheet.csv",bytes,{headerRow:1});
   const template=await saveMappingTemplate(db,tenant,user,{supplier:"Supplier",fileType:"csv",fields:parsed.mapping,headers:parsed.headers});
   const input=ScheduleInput.parse({name:"Supplier prices",url:link,templateId:template.id,approveTextNumbers:true});
   await assert.rejects(saveSchedule(db,tenant,user,input,{...flags,sheets:false}),/disabled/);
   await db.exec("SAVEPOINT older_template;");
   await db.query("UPDATE public.column_mapping_template SET column_mapping=column_mapping-'headerHashes' WHERE id=$1",[template.id]);
   assert.equal((await ingestionState(db,tenant,flags)).templates[0].column_checks,false);
   await assert.rejects(saveSchedule(db,tenant,user,input,flags),/re-save this older mapping/);
   await db.exec("ROLLBACK TO SAVEPOINT older_template;");
   const saved=await saveSchedule(db,tenant,user,input,flags);
   await saveSchedule(db,tenant,user,{...input,id:saved.id,name:"Updated schedule"},flags);
   assert.equal((await ingestionState(db,tenant,flags)).schedules.length,1);
   assert.equal((await ingestionState(db,other,flags)).schedules.length,0);
   const transaction=async<T,>(fn:(db:any)=>Promise<T>)=>{
    // Mirrors withDatabase rollback behavior while retaining the outer fixture.
    await db.exec("SAVEPOINT ingestion_request;");
    try{const result=await fn(db);await db.exec("RELEASE SAVEPOINT ingestion_request;");return result;}
    catch(e){await db.exec("ROLLBACK TO SAVEPOINT ingestion_request;RELEASE SAVEPOINT ingestion_request;");throw e;}
   };
   const result=await runSchedule(transaction,tenant,user,undefined,flags,async()=>bytes);
   assert.ok(result.ran);assert.ok(result.planId&&result.reviewId);
   assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.product WHERE tenant_id=$1",[tenant])).rows[0].n,populated?1:0,"scheduled fetch never commits catalog changes");
   let plan=await importPlanPage(db,tenant,result.planId!);
   assert.equal(plan.counts[populated?"changed":"new"],1);assert.equal(plan.canCommit,false,"BOM warning still needs per-file review");
   plan=await resolveImportChoices(db,tenant,plan.id,{},0,true);assert.equal(plan.canCommit,true);
   await commitImport(db,tenant,user,plan.id);await undoImport(db,tenant,user,plan.id);
   const state=await ingestionState(db,tenant,flags);
   assert.equal(state.runs.length,1);assert.equal(state.runs[0].status,"succeeded");assert.equal(state.runs[0].processed_count,"1");
   assert.equal(state.schedules[0].lastPlanId,plan.id);assert.equal(state.schedules[0].lastReviewId,result.reviewId);
   assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.audit_log WHERE tenant_id=$1 AND action='connector_sync_run.update'",[tenant])).rows[0].n,1);
   assert.equal((await runSchedule(transaction,tenant,user,undefined,flags,async()=>{throw new Error("must not fetch before due");})).ran,false);
   // Changed headers fail, record a failed run and keep existing plans intact.
   const oldJobs=(await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1",[tenant])).rows[0].n;
   await assert.rejects(runSchedule(transaction,tenant,user,saved.id,flags,async()=>new TextEncoder().encode("SKU,Other,Unit,Cost,Price\nP,Part,EA,10,20")),/Row 1, column B.*headers changed/);
   assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1",[tenant])).rows[0].n,oldJobs);
   const failed=await ingestionState(db,tenant,flags);
   assert.equal(failed.runs.find(r=>r.id===failed.schedules[0].lastRunId)!.status,"failed");
   await assert.rejects(runSchedule(transaction,tenant,user,saved.id,flags,async()=>{throw new Error("SECRET SOURCE CELL");}),e=>(e as Error).message==="The scheduled review failed. Retry or review the source file.");
   assert.ok(!(await ingestionState(db,tenant,flags)).schedules[0].lastError?.includes("SECRET"));
   // A claim cannot be stolen while its lease is live; stale claims are retired.
   const claimed=await claimSchedule(db,tenant,user,saved.id,flags);assert.ok(claimed);
   await assert.rejects(claimSchedule(db,tenant,user,saved.id,flags),/already running/);
   await db.query("UPDATE public.column_mapping_template SET column_mapping=jsonb_set(column_mapping,'{inFlightUntil}',to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE tenant_id=$1 AND id=$2",[tenant,saved.id]);
   await runSchedule(transaction,tenant,user,saved.id,flags,async()=>bytes);
   assert.equal((await db.query("SELECT status FROM public.connector_sync_run WHERE id=$1",[claimed!.runId])).rows[0].status,"failed");
   await pauseSchedule(db,tenant,user,saved.id);
   assert.equal((await ingestionState(db,tenant,flags)).schedules[0].enabled,false);
   await saveSchedule(db,tenant,user,{...input,id:saved.id},flags);
   assert.equal((await ingestionState(db,tenant,flags)).schedules[0].enabled,false,"Editing a paused schedule must not silently enable it.");
   await pauseSchedule(db,tenant,user,saved.id,true,flags);
   assert.equal((await ingestionState(db,tenant,flags)).schedules[0].enabled,true);
   const beforePausedJobs=(await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1",[tenant])).rows[0].n;
   await assert.rejects(runSchedule(transaction,tenant,user,saved.id,flags,async()=>{await transaction(db=>pauseSchedule(db,tenant,user,saved.id));return bytes;}),/schedule changed during the fetch/);
   assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.import_job WHERE tenant_id=$1",[tenant])).rows[0].n,beforePausedJobs);
   await pauseSchedule(db,tenant,user,saved.id,true,flags);
   // Missing conversion keeps the row rejected and records an existing DQI.
   await saveSchedule(db,tenant,user,{...input,id:saved.id,approveUnits:true},flags);
   await runSchedule(transaction,tenant,user,saved.id,flags,async()=>new TextEncoder().encode("SKU,Description,Unit,Cost,Price\nP,Part,BOX,10,20"));
   assert.ok(Number((await db.query("SELECT count(*)::integer AS n FROM public.data_quality_issue WHERE tenant_id=$1",[tenant])).rows[0].n)>0);
   const rejected=await ingestionState(db,tenant,flags);
   assert.equal(rejected.runs.find(r=>r.id===rejected.schedules[0].lastRunId)!.failed_count,"1");
   // Tenant B cannot read or run A's schedule. Table ACL/RLS still do the work.
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[otherUser]);
   assert.equal((await ingestionState(db,tenant,flags)).schedules.length,0);
   await assert.rejects(saveSchedule(db,tenant,otherUser,input,flags),(e:any)=>e.status===403);
   await assert.rejects(claimSchedule(db,other,otherUser,saved.id,flags),(e:any)=>e.status===404);
   await db.exec("SAVEPOINT denied_insert;");
   await assert.rejects(db.query("INSERT INTO public.connector_sync_run(tenant_id,provider,direction) VALUES($1,'google_sheets','inbound')",[tenant]),(e:any)=>e.code==="42501"&&/row-level security/.test(e.message));
   await db.exec("ROLLBACK TO SAVEPOINT denied_insert;");
   await db.exec("RESET ROLE;ROLLBACK;");assert.deepEqual(await tenantCounts(db),empty,"every fixture, sync run, template, import, issue and audit row rolls back");
  }
 }finally{await db.close();}
});
test("Drop interfaces are inert feature-flagged tenant-specific stubs, not live addresses or servers",()=>{
 assert.deepEqual(stubInterfaces(randomUUID(),{sheets:false,emailStub:false,sftpStub:false}),{email:null,sftp:null});
 const a=stubInterfaces(randomUUID(),flags),b=stubInterfaces(randomUUID(),flags);
 assert.match(a.email!.address,/@drop\.rebatehq\.invalid$/);assert.notEqual(a.email!.address,b.email!.address);assert.notEqual(a.sftp!.path,b.sftp!.path);
 assert.match(a.email!.status,/cannot receive/);assert.match(a.sftp!.status,/no SFTP server/);
});
test("The real-Postgres CI benchmark's SQL executes locally and leaves no residue",async()=>{
 const db=await testDatabase(executed);
 try{for(let i=0;i<2;i++){const result=await benchmarkImport(db,251);assert.equal(result.rows,251);assert.equal(result.role,"rebatehq_app");assert.ok(result.commit_ms>=0&&result.undo_ms>=0);}}
 finally{await db.close();}
});
test("Every Chunk 3C ingestion and benchmark literal SQL statement executed in PGlite",()=>{
 let count=0;
 for(const file of ["lib/ingestion.ts","scripts/benchmark-import.ts"]){
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="query"){
   const sql=node.arguments[0];if(sql&&(ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))){count++;assert.ok(executed.has(normalizedSql(sql.text)),`${file}: unexecuted SQL: ${normalizedSql(sql.text)}`);}
  }ts.forEachChild(node,visit);};visit(source);
 }assert.ok(count>=25);
});
