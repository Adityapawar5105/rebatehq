import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { can } from "../lib/permissions";
import { assertRepResponseSafe } from "../lib/rep-response";
import { assertNotQuoteCreator } from "../lib/quote-approval";
import { csvSafeCell, csvDocument } from "../lib/csv";
import { QuoteRequestSchema } from "../lib/validators";
import { RETIRED_API_PATHS } from "../config/http-boundary.mjs";
import { readTextLimited } from "../lib/request";

test("roles enforce the Phase 1 permission matrix",()=>{
  assert.equal(can("owner","users.invite"),true);assert.equal(can("manager","quotes.approve"),true);
  assert.equal(can("analyst","quotes.approve"),false);assert.equal(can("analyst","policy.edit"),false);
  assert.equal(can("rep","customers.read.assigned"),true);assert.equal(can("rep","customers.read.all"),false);
  assert.equal(can("rep","costs.read"),false);assert.equal(can("rep","quotes.read.own"),true);assert.equal(can("rep","quotes.approve"),false);
});

test("retired business APIs hold no database code; rep-accessible APIs still guard responses",()=>{
  // 6R: the routes that served the wave-1 tables are fixed 410 stubs.
  for(const route of RETIRED_API_PATHS){
    const source=readFileSync(path.join(process.cwd(),"app/api",route,"route.ts"),"utf8");
    assert.doesNotMatch(source,/withDatabase|\.query\(|getAppContext|from "pg"/,`${route} must not reach the database`);
    assert.match(source,/retiredBusinessResponse\(\)/,`${route} must answer with the retired response`);
  }
  const switchSource=readFileSync(path.join(process.cwd(),"app/api/tenant/switch/route.ts"),"utf8");
  assert.match(switchSource,/assertRepResponseSafe\(context\.role/,"POST /api/tenant/switch must run the response guard");
  assert.deepEqual(assertRepResponseSafe("rep",{ok:true}),{ok:true});
  const permissionBoundRoutes=new Set<string>();
  const visit=(directory:string)=>{for(const entry of readdirSync(path.join(process.cwd(),directory),{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else if(file.endsWith("route.ts")){const source=readFileSync(path.join(process.cwd(),file),"utf8");if(["customers.read.assigned","products.read","quotes.read.own","quotes.create","quotes.send","policy.read"].some(permission=>source.includes(`"${permission}"`)))permissionBoundRoutes.add(file);}}};
  visit("app/api");
  for(const file of permissionBoundRoutes)assert.match(readFileSync(path.join(process.cwd(),file),"utf8"),/assertRepResponseSafe\(context\.role/,`${file} has a rep permission and must guard its response`);
  const protectedExamples=[
    {unit_cost:50},{actual_cost_amount:50},{actual_cost_source:"vendor-bill"},{freightCost:4},{payment_terms_cost:2},{cogs:10},{cogs_total:10},
    {pocket_price:90},{pocketMargin:20},{margin:20},{margin_dollars:20},{cost_components:[{amount:2}]},{terms:2}
  ];
  for(const payload of protectedExamples)assert.throws(()=>assertRepResponseSafe("rep",payload));
});
test("users cannot approve their own quote",()=>{
  assert.throws(()=>assertNotQuoteCreator("user-1","user-1"),(error:unknown)=>typeof error==="object"&&error!==null&&"status" in error&&(error as {status:number}).status===403);
  assert.doesNotThrow(()=>assertNotQuoteCreator("user-1","user-2"));
});

test("CSV exports neutralize spreadsheet formula prefixes",()=>{
  for(const payload of ["=1+1","+CMD()","-2+3","@SUM(A1)","\tformula","\rformula","   =1+1"])assert.equal(csvSafeCell(payload).startsWith("'"),true,payload);
  assert.match(csvDocument(["cell"],[["=1+1"]]),/"'=1\+1"/);
});

test("quote request accepts calculation inputs and strips client-calculated fields",()=>{
  const result=QuoteRequestSchema.parse({customerId:"00000000-0000-4000-8000-000000000001",lines:[{productId:"00000000-0000-4000-8000-000000000002",qty:2,discountPct:1,rebatePct:0,accessory:0,margin:99999,zone:"green",price:0}]});
  assert.equal("margin" in result.lines[0],false);assert.equal("zone" in result.lines[0],false);assert.equal("price" in result.lines[0],false);
});

test("bounded request reader rejects oversized JSON bodies",async()=>{
  const request=new Request("http://localhost/upload",{method:"POST",body:"0123456789"});
  await assert.rejects(()=>readTextLimited(request,5),(error:unknown)=>typeof error==="object"&&error!==null&&"status" in error&&(error as {status:number}).status===413);
});
