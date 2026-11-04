import { testIdentity, installTestIdentityKey } from './helpers/signed-context';
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import ts from "typescript";
import seed from "../seed_data.json";
import {validatePrototype,importPrototypeData} from "../lib/prototype-import";
import {dataReadiness} from "../lib/readiness";
import {seedRestoreData} from "../scripts/seed-restore-drill";
import {testDatabase,tenantCounts,normalizedSql} from "./helpers/database";
const migration="20261029175710_chunk3c_invoice_actual_cost.sql";
test("Chunk 3C migration upgrades existing invoice rows without inventing actuals",async()=>{
 const {PGlite}=await import("@electric-sql/pglite"),{pgcrypto}=await import("@electric-sql/pglite/contrib/pgcrypto"),{btree_gist}=await import("@electric-sql/pglite/contrib/btree_gist");
 const db:any=new PGlite({extensions:{pgcrypto,btree_gist}});
 try{
  await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")&&n<migration).sort())await db.exec(readFileSync("supabase/migrations/"+name,"utf8"));
  const tenant=randomUUID(),customer=randomUUID(),product=randomUUID(),invoice=randomUUID(),line=randomUUID();
  await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Already populated')",[tenant]);
  await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,'A','Customer')",[customer,tenant]);
  await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'P','Product','Test','EA',10,20)",[product,tenant]);
  await db.query("INSERT INTO public.invoice(id,tenant_id,customer_id,invoice_date,currency) VALUES($1,$2,$3,'2026-10-01','USD')",[invoice,tenant,customer]);
  await db.query("INSERT INTO public.invoice_line(id,tenant_id,invoice_id,product_id,quantity,net_sales,currency,uom_code) VALUES($1,$2,$3,$4,1,20,'USD','EA')",[line,tenant,invoice,product]);
  await db.exec(readFileSync("supabase/migrations/"+migration,"utf8"));
  const row=(await db.query("SELECT actual_cost_amount,actual_cost_source FROM public.invoice_line WHERE id=$1",[line])).rows[0];
  assert.deepEqual(row,{actual_cost_amount:null,actual_cost_source:null});assert.equal((await dataReadiness(db,tenant)).score,25);
  for(const [amount,source] of [[-1,"bill"],[0,null],[null,"bill"],["NaN","bill"],[0,""],[0,"x".repeat(201)]]){
   await assert.rejects(db.query("UPDATE public.invoice_line SET actual_cost_amount=$2::numeric,actual_cost_source=$3 WHERE id=$1",[line,amount,source]),(e:any)=>e.code==="23514");
  }
 }finally{await db.close();}
});
test("Restore inventory includes invoice evidence and ingestion metadata; column mismatches stay fatal",async()=>{
 const executed=new Set<string>(),db=await testDatabase(executed);
 const {applicationColumnsSql,assertApplicationColumnsEqual,ingestionEvidenceSql}=await import("../scripts/verify-restore-equivalence.mjs");
 try{
  await db.query("BEGIN");const rows=await seedRestoreData(db);await db.query("COMMIT");
  const value=await dataReadiness(db,rows.tenant);assert.equal(value.score,100);assert.equal(value.complete,1);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.column_mapping_template WHERE tenant_id=$1",[rows.tenant])).rows[0].n,2);
  assert.equal((await db.query("SELECT provider FROM public.connector_sync_run WHERE id=$1",[rows.run])).rows[0].provider,"google_sheets");
  const tableNames=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((r:any)=>r.tablename);
  assert.ok(tableNames.length>=38);
  const columns=(await db.query(applicationColumnsSql,[tableNames])).rows;
  assert.equal(assertApplicationColumnsEqual(columns,structuredClone(columns)),true);
  assert.throws(()=>assertApplicationColumnsEqual(columns,columns.filter((c:any)=>c.column_name!=="actual_cost_source")),/invoice_line.actual_cost_source/);
  assert.throws(()=>assertApplicationColumnsEqual(columns,columns.map((c:any)=>c.column_name==="actual_cost_amount"?{...c,data_type:"real"}:c)),/invoice_line.actual_cost_amount/);
  assert.throws(()=>assertApplicationColumnsEqual([],[]),/empty/);
  const content=(await db.query(ingestionEvidenceSql)).rows[0];
  await db.exec("BEGIN;");
  await db.query("UPDATE public.invoice_line SET actual_cost_amount=2 WHERE id=$1",[rows.line]);
  assert.notDeepEqual((await db.query(ingestionEvidenceSql)).rows[0],content,"changing an actual amount must change the restore evidence hash");
  await db.exec("ROLLBACK;");
  assert.deepEqual((await db.query(ingestionEvidenceSql)).rows[0],content);
  // The seeded source is now pre-existing data. Repeated checks preserve it.
  const baseline=await tenantCounts(db);
  for(let i=0;i<2;i++){await db.query("BEGIN");assert.equal((await dataReadiness(db,rows.tenant)).score,100);await assert.rejects(seedRestoreData(db),/sentinel UUID collision/);await db.query("ROLLBACK");assert.deepEqual(await tenantCounts(db),baseline);}
  const source=ts.createSourceFile("seed",readFileSync("scripts/seed-restore-drill.ts","utf8"),ts.ScriptTarget.Latest,true);
  let checked=0;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="query"){const sql=node.arguments[0];if(sql&&(ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))){checked++;assert.ok(executed.has(normalizedSql(sql.text)),`Unexecuted restore seed SQL: ${sql.text}`);}}ts.forEachChild(node,visit);};visit(source);assert.ok(checked>=12);
 }finally{await db.close();}
});
test("The checked-in demo invoices have unit coverage but no invented actual cost/freight/rebate evidence",async()=>{
 const db=await testDatabase();
 try{
  const tenant=randomUUID(),user=randomUUID();await db.exec("BEGIN;");
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[user,user+"@example.invalid"]);
  await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'Real demo seed','USD')",[tenant]);
  await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[tenant,user,user+"@example.invalid"]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);await testIdentity(db,user);await db.exec("SET LOCAL ROLE rebatehq_app;");
  const plan=validatePrototype(seed),job=(await db.query("INSERT INTO public.import_job(tenant_id,import_type,status) VALUES($1,'prototype','dry_run') RETURNING id",[tenant])).rows[0].id;
  await importPrototypeData(db,tenant,user,plan,job);
  const readiness=await dataReadiness(db,tenant);
  assert.equal(readiness.invoices,seed.invoices.length);assert.equal(readiness.score,25);assert.equal(readiness.complete,0);
  assert.deepEqual(readiness.checks.map(c=>c.ready),[0,0,0,seed.invoices.length]);
  await db.exec("RESET ROLE;ROLLBACK;");
 }finally{await db.close();}
});
