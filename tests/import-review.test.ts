import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createImportReview,saveMappingTemplate,loadMappingTemplate,headersFingerprint,importReviewIssues } from "../lib/import-review";
import { parseUpload } from "../lib/upload-parser";
import { can } from "../lib/permissions";
import { csvDocument } from "../lib/csv";

test('file reviews and per-supplier templates run as restricted tenant users twice on fresh and populated schemas without residue',async()=>{
 const { PGlite }=await import('@electric-sql/pglite');const { pgcrypto }=await import('@electric-sql/pglite/contrib/pgcrypto');const { btree_gist }=await import('@electric-sql/pglite/contrib/btree_gist');
 const db:any=new PGlite({extensions:{pgcrypto,btree_gist}});
 try{
  await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  const snapshot=async()=>{
   const tables=(await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id') ORDER BY c.relname`)).rows;
   assert.equal(tables.length,38);const counts:Record<string,string>={};for(const t of tables)counts[t.relname]=(await db.query(`SELECT count(*)::text AS n FROM public.${t.relname}`)).rows[0].n;return counts;
  };
  const baseline=await snapshot();
  for(const populated of [false,true])for(let run=0;run<2;run++){
   const ta=randomUUID(),tb=randomUUID(),ua=randomUUID(),ub=randomUUID(),product=randomUUID();
   await db.exec('BEGIN;');
   await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[ua,ua+'@example.invalid',ub,ub+'@example.invalid']);
   await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'A'),($2,'B')",[ta,tb]);
   await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner'),($4,$5,$6,'owner')",[ta,ua,ua+'@example.invalid',tb,ub,ub+'@example.invalid']);
   await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'P-1','Fixture','Test','EA',10,20)",[product,ta]);
   if(populated){for(let i=0;i<2;i++){
    await db.query("INSERT INTO public.import_job(tenant_id,import_type,status) VALUES($1,'earlier_upload','dry_run')",[tb]);
    await db.query("INSERT INTO public.column_mapping_template(tenant_id,name,import_type) VALUES($1,$2,'earlier_upload')",[tb,randomUUID()]);
   }}
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[ua]);
   await db.exec('SET LOCAL ROLE rebatehq_app;');
   const role=(await db.query('SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(role.role,'rebatehq_app');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
   const parsed=parseUpload('messy.xlsx',readFileSync('tests/fixtures/messy-supplier.xlsx'));
   const review=await createImportReview(db,ta,ua,parsed);
   assert.equal((await importReviewIssues(db,ta,review.jobId)).totalIssues,review.totalIssues);
   assert.ok(review.issues.some(i=>i.code==='unit_mismatch'&&i.row===5&&i.column==='C'));
   assert.ok(review.issues.some(i=>i.code==='missing_conversion'&&i.row===5&&i.column==='C'));
   const dq=(await db.query("SELECT details FROM public.data_quality_issue WHERE tenant_id=$1 AND entity_type='import_job' AND entity_id=$2",[ta,review.jobId+':5:C'])).rows;assert.equal(dq.length,1);assert.equal(dq[0].details.row,5);assert.equal(dq[0].details.column,'C');
   assert.equal((await db.query('SELECT status,accepted_rows,summary FROM public.import_job WHERE tenant_id=$1 AND id=$2',[ta,review.jobId])).rows[0].accepted_rows,0);
   assert.equal(review.rows[0].cells[3].value,'12,50');
   // Approved BOX/EA conversion surfaces the mismatch without changing source values.
   await db.exec('RESET ROLE;');
   const box=randomUUID();await db.query("INSERT INTO public.uom(id,tenant_id,code,display_name) VALUES($1,$2,'BOX','Box')",[box,ta]);
   const each=(await db.query("SELECT id FROM public.uom WHERE tenant_id=$1 AND code='EA'",[ta])).rows[0].id;
   await db.query("INSERT INTO public.uom_conversion(id,tenant_id,product_id,from_uom_id,to_uom_id,factor,direction) VALUES($1,$2,$3,$4,$5,12,'multiply')",[randomUUID(),ta,product,box,each]);
   await db.exec('SET LOCAL ROLE rebatehq_app;');
   const approved=await createImportReview(db,ta,ua,parsed);assert.ok(approved.issues.some(i=>i.code==='unit_mismatch'));assert.ok(!approved.issues.some(i=>i.code==='missing_conversion'));assert.equal(approved.rows[1].cells[7].value,'1');
   const key={supplier:'Acme',fileType:'xlsx' as const};const payload={...key,fields:parsed.mapping,headers:parsed.headers};
   const first=await saveMappingTemplate(db,ta,ua,payload);const second=await saveMappingTemplate(db,ta,ua,payload);assert.equal(first.id,second.id);
   const template=await loadMappingTemplate(db,ta,key);assert.deepEqual(template!.fields,parsed.mapping);assert.equal(template!.headersFingerprint,headersFingerprint(parsed.headers));
   assert.equal(await loadMappingTemplate(db,ta,{supplier:'NorthStar',fileType:'xlsx'}),null);assert.equal(await loadMappingTemplate(db,ta,{supplier:'Acme',fileType:'csv'}),null);
   assert.equal(await loadMappingTemplate(db,tb,key),null);
   await db.exec('SAVEPOINT foreign_write;');await assert.rejects(saveMappingTemplate(db,tb,ua,payload),(e:any)=>e.code==='42501'&&/row-level security/i.test(e.message));await db.exec('ROLLBACK TO SAVEPOINT foreign_write;');
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[ub]);
   await assert.rejects(importReviewIssues(db,ta,review.jobId),(e:any)=>e.status===404);
   assert.equal(await loadMappingTemplate(db,ta,key),null);const other=await saveMappingTemplate(db,tb,ub,{...payload,fields:{sku:0}});assert.notEqual(other.id,first.id);
   assert.deepEqual((await loadMappingTemplate(db,tb,key))!.fields,{sku:0});
   await db.exec('RESET ROLE;ROLLBACK;');assert.deepEqual(await snapshot(),baseline,'Every fixture, review, template and audit row rolls back');
  }
 }finally{await db.close();}
});
test('only owner and manager can access upload APIs, which derive the tenant from authenticated context',()=>{
 for(const role of ['owner','manager','analyst','rep'] as const)assert.equal(can(role,'files.review'),role==='owner'||role==='manager');
 for(const file of ['app/api/import-preview/route.ts','app/api/mapping-templates/route.ts','app/api/imports/route.ts','app/api/imports/preview/route.ts','app/api/ingestion/route.ts']){
  const source=readFileSync(file,'utf8');assert.match(source,/assertPermission\(context,"files.review"\)/);assert.match(source,/databaseContext\(context,request.headers\)/);assert.match(source,/context.tenantId/);assert.ok(!/console\.|request\.json\(|arrayBuffer\(/.test(source));
 }
 const ui=readFileSync('components/ImportWizard.tsx','utf8');assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(ui));assert.match(ui,/csvDocument\(headers,rows\)/);
});
