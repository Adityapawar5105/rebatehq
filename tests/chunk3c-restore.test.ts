import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import ts from "typescript";
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
  assert.deepEqual(row,{actual_cost_amount:null,actual_cost_source:null});
  for(const [amount,source] of [[-1,"bill"],[0,null],[null,"bill"],["NaN","bill"],[0,""],[0,"x".repeat(201)]]){
   await assert.rejects(db.query("UPDATE public.invoice_line SET actual_cost_amount=$2::numeric,actual_cost_source=$3 WHERE id=$1",[line,amount,source]),(e:any)=>e.code==="23514");
  }
 }finally{await db.close();}
});
test("Restore inventory hashes wave-2 rows whose IDs outlived the retired tables; column mismatches stay fatal (6R)",async()=>{
 const executed=new Set<string>(),db=await testDatabase(executed);
 const {applicationColumnsSql,assertApplicationColumnsEqual,wave2EvidenceSql,relayEvidenceSql,assertRelayEvidenceEqual}=await import("../scripts/verify-restore-equivalence.mjs");
 try{
  await db.query("BEGIN");const rows=await seedRestoreData(db);await db.query("COMMIT");
  assert.equal((await db.query("SELECT name FROM public.rebate_agreement WHERE id=$1",[rows.agreement])).rows[0].name,"RESTORE-SENTINEL");
  const tableNames=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((r:any)=>r.tablename);
  assert.equal(tableNames.length,24);
  const columns=(await db.query(applicationColumnsSql,[tableNames])).rows;
  assert.equal(assertApplicationColumnsEqual(columns,structuredClone(columns)),true);
  assert.throws(()=>assertApplicationColumnsEqual(columns,columns.filter((c:any)=>c.column_name!=="uom_code")),/quote_line.uom_code/);
  assert.throws(()=>assertApplicationColumnsEqual(columns,columns.map((c:any)=>c.column_name==="threshold_amount"?{...c,data_type:"real"}:c)),/rebate_agreement.threshold_amount/);
  assert.throws(()=>assertApplicationColumnsEqual([],[]),/empty/);
  const content=(await db.query(wave2EvidenceSql)).rows[0];
  for(const change of ["UPDATE public.quote_line SET list_price=21 WHERE id=$1","UPDATE public.quote_line SET product_id=gen_random_uuid() WHERE id=$1"]){
   await db.exec("BEGIN;");await db.query(change,[rows.line]);
   assert.notDeepEqual((await db.query(wave2EvidenceSql)).rows[0],content,"changing a quote line must change the restore evidence hash");
   await db.exec("ROLLBACK;");
  }
  assert.deepEqual((await db.query(wave2EvidenceSql)).rows[0],content);
  // The seeded source is now pre-existing data. Repeated checks preserve it.
  const relayEvidence=(await db.query(relayEvidenceSql)).rows;
  assert.equal(assertRelayEvidenceEqual(relayEvidence,structuredClone(relayEvidence)),true);
  await db.exec('BEGIN');await db.query("UPDATE public.relay_event SET ciphertext=decode(repeat('00',32),'hex'),ciphertext_bytes=32 WHERE id=$1::uuid",[rows.relay.event]);
  assert.throws(()=>assertRelayEvidenceEqual(relayEvidence,[]),/four tables/);
  assert.throws(()=>assertRelayEvidenceEqual(relayEvidence,relayEvidence.map((r:any)=>({...r,content_hash:'changed'}))),/content hashes differ/);
  assert.notDeepEqual((await db.query(relayEvidenceSql)).rows,relayEvidence);await db.exec('ROLLBACK');
  const baseline=await tenantCounts(db);
  for(let i=0;i<2;i++){await db.query("BEGIN");await assert.rejects(seedRestoreData(db),/sentinel UUID collision/);await db.query("ROLLBACK");assert.deepEqual(await tenantCounts(db),baseline);}
  const source=ts.createSourceFile("seed",readFileSync("scripts/seed-restore-drill.ts","utf8"),ts.ScriptTarget.Latest,true);
  let checked=0;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="query"){const sql=node.arguments[0];if(sql&&(ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))){checked++;assert.ok(executed.has(normalizedSql(sql.text)),`Unexecuted restore seed SQL: ${sql.text}`);}}ts.forEachChild(node,visit);};visit(source);assert.ok(checked>=10);
 }finally{await db.close();}
});