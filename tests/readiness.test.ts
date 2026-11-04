import { testIdentity, installTestIdentityKey } from './helpers/signed-context';
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {dataReadiness,READINESS_SQL} from "../lib/readiness";
import {DataReadiness} from "../components/DataReadiness";
import {testDatabase,tenantCounts,normalizedSql} from "./helpers/database";
test("Readiness matches sourced invoice evidence exactly, never counts model/default zeros, on fresh and populated data twice",async()=>{
 const executed=new Set<string>(),db=await testDatabase(executed);
 try{
  const baseline=await tenantCounts(db);
  for(const populated of [false,true])for(let repeat=0;repeat<2;repeat++){
   await db.exec("BEGIN;");
   const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),customer=randomUUID(),product=randomUUID();
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[user,user+"@example.invalid"]);
   await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Readiness'),($2,'Other')",[tenant,other]);
   await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[tenant,user,user+"@example.invalid"]);
   await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,'R','Readiness customer')",[customer,tenant]);
   await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'R','Readiness product','Test','EA',10,20)",[product,tenant]);
   await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'BOX','Box')",[tenant]);
   if(populated)await db.query("INSERT INTO public.import_job(tenant_id,import_type,status) VALUES($1,'preexisting','committed'),($2,'preexisting','committed')",[tenant,other]);
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);await testIdentity(db,user);await db.exec("SET LOCAL ROLE rebatehq_app;");
   assert.equal((await dataReadiness(db,tenant)).score,null);
   const ids=Array.from({length:4},()=>randomUUID());
   for(const id of ids)await db.query("INSERT INTO public.invoice(id,tenant_id,customer_id,invoice_date,currency,source_ref) VALUES($1,$2,$3,'2026-10-01','USD',$4)",[id,tenant,customer,id]);
   const lines=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
   for(let i=0;i<4;i++)await db.query(`INSERT INTO public.invoice_line(id,tenant_id,invoice_id,product_id,quantity,net_sales,currency,uom_code,actual_cost_amount,actual_cost_source)
    VALUES($1,$2,$3,$4,1,20,'USD',$5,$6,$7)`,[lines[i],tenant,ids[i<2?0:i-1],product,i===2?"BOX":"EA",i===2?null:0,i===2?null:"vendor-bill"]);
   for(const i of [0,1,2])await db.query("INSERT INTO public.cost_component(tenant_id,invoice_line_id,component_type,amount,currency,source_ref) VALUES($1,$2,'freight',0,'USD','freight-reconciliation')",[tenant,lines[i]]);
   for(let i=0;i<4;i++)await db.query("INSERT INTO public.cost_component(tenant_id,invoice_line_id,component_type,amount,currency,source_ref) VALUES($1,$2,'off_invoice_rebate',0,'USD',$3)",[tenant,lines[i],i<2?"rebate-reconciliation":null]);
   const value=await dataReadiness(db,tenant);
   assert.equal(value.invoices,4);assert.equal(value.complete,1);assert.equal(value.score,43.8);
   assert.deepEqual(value.checks.map(c=>[c.key,c.ready,c.percent]),[["freight",2,50],["cost",2,50],["rebate",1,25],["units",2,50]]);
   const html=renderToStaticMarkup(createElement(DataReadiness,{data:value}));
   assert.match(html,/43.8%/);assert.match(html,/4 × total invoices/);assert.match(html,/First insights in minutes from files; a live connector typically takes weeks./);
   await db.query(`INSERT INTO public.uom_conversion(tenant_id,from_uom_id,to_uom_id,factor,direction)
    SELECT $1,a.id,b.id,12,'multiply' FROM public.uom a JOIN public.uom b ON b.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.code='BOX' AND b.code='EA'`,[tenant]);
   assert.equal((await dataReadiness(db,tenant)).score,50);
   assert.equal((await db.query("SELECT public.convert_quantity($1,$2,2,'BOX','EA','2026-10-01')::text AS n",[tenant,product])).rows[0].n,"24.0000");
   assert.equal((await dataReadiness(db,other)).invoices,0);
   await db.exec("SAVEPOINT invalid_actual;");
   await assert.rejects(db.query("UPDATE public.invoice_line SET actual_cost_source=NULL WHERE tenant_id=$1 AND actual_cost_amount IS NOT NULL",[tenant]),(e:any)=>e.code==="23514");
   await db.exec("ROLLBACK TO SAVEPOINT invalid_actual;");
   await db.exec("RESET ROLE;ROLLBACK;");assert.deepEqual(await tenantCounts(db),baseline);
  }
  assert.ok(executed.has(normalizedSql(READINESS_SQL)));
 }finally{await db.close();}
});
