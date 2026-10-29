import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import seed from "../seed_data.json";
import { can } from "../lib/permissions";
import { assertRepResponseSafe } from "../lib/rep-response";
import { assertNotQuoteCreator } from "../lib/quote-approval";
import { csvSafeCell, csvDocument } from "../lib/csv";
import { validatePrototype } from "../lib/prototype-import";
import { QuoteRequestSchema } from "../lib/validators";
import { encryptSecret, decryptSecret } from "../lib/secrets";
import { readTextLimited } from "../lib/request";

test("roles enforce the Phase 1 permission matrix",()=>{
  assert.equal(can("owner","users.invite"),true);assert.equal(can("manager","quotes.approve"),true);
  assert.equal(can("analyst","quotes.approve"),false);assert.equal(can("analyst","policy.edit"),false);
  assert.equal(can("rep","customers.read.assigned"),true);assert.equal(can("rep","customers.read.all"),false);
  assert.equal(can("rep","costs.read"),false);assert.equal(can("rep","quotes.read.own"),true);assert.equal(can("rep","quotes.approve"),false);
});

test("every rep-accessible data API enforces response redaction",()=>{
  const endpoints=[
    ["GET /api/customers","app/api/customers/route.ts",{data:[{id:"c1",account_no:"A1",name:"Customer",region:"West",tier:"A",assigned_rep_id:"rep1"}]}],
    ["GET /api/products","app/api/products/route.ts",{data:[{id:"p1",sku:"S1",name:"Valve",category:"Parts",list_price:100,tier_prices:{A:90}}],role:"rep"}],
    ["GET /api/quotes","app/api/quotes/route.ts",{data:[{id:"q1",status:"draft",zone:"green",headroom:5}] }],
    ["POST /api/quotes","app/api/quotes/route.ts",{data:{id:"q1",status:"pending_approval",zone:"yellow",headroom:2}}],
    ["POST /api/quotes/:id/send","app/api/quotes/[quoteId]/send/route.ts",{data:{id:"q1",status:"sent",zone:"green",headroom:5}}],
    ["GET /api/policy","app/api/policy/route.ts",{data:{policies:[{target_margin_pct:30,floor_margin_pct:22,walkaway_margin_pct:18}],categories:["Parts"],tiers:["A"]},canEdit:false}],
    ["GET /api/search","app/api/search/route.ts",{data:[{id:"p1",label:"S1",kind:"Product",href:"/prices"}]}],
    ["POST /api/tenant/switch","app/api/tenant/switch/route.ts",{ok:true}]
  ] as const;
  for(const [endpoint,file,payload] of endpoints){
    const source=readFileSync(path.join(process.cwd(),file),"utf8");
    assert.match(source,/assertRepResponseSafe\(context\.role/,`${endpoint} must run the response guard`);
    assert.deepEqual(assertRepResponseSafe("rep",payload),payload,`${endpoint} safe example`);
  }
  const permissionBoundRoutes=new Set<string>();
  const visit=(directory:string)=>{for(const entry of readdirSync(path.join(process.cwd(),directory),{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else if(file.endsWith("route.ts")){const source=readFileSync(path.join(process.cwd(),file),"utf8");if(["customers.read.assigned","products.read","quotes.read.own","quotes.create","quotes.send","policy.read"].some(permission=>source.includes(`"${permission}"`)))permissionBoundRoutes.add(file);}}};
  visit("app/api");
  for(const file of permissionBoundRoutes)assert.match(readFileSync(path.join(process.cwd(),file),"utf8"),/assertRepResponseSafe\(context\.role/,`${file} has a rep permission and must guard its response`);
  assert.ok(permissionBoundRoutes.size>=5,"The scan should cover the current rep permission-bound API routes.");
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

test("prototype import validates relations and recomputes snapshots with the shared engine",()=>{
  const plan=validatePrototype(seed);assert.equal(plan.products.length,seed.products.length);assert.equal(plan.orders.length,seed.orders.length);
  const rapid=plan.customers.find(customer=>customer.sourceId==="c-rapid");const loss=plan.snapshots.find(snapshot=>snapshot.entityType==="customer"&&snapshot.entityId===rapid.id&&snapshot.month==="2026-10");
  assert.ok(loss);assert.ok(loss.margin<0,"fixture SO-8102 must remain loss-making after import recomputation");
});

test("prototype data rejects invalid percentages and protects textual fields as data",()=>{
  const bad=structuredClone(seed);bad.orders[0].discountPct=150;assert.throws(()=>validatePrototype(bad),/cannot exceed 100/);
  const xss=structuredClone(seed);xss.customers[0].name="<img src=x onerror=alert(1)>";assert.equal(validatePrototype(xss).customers[0].name,"<img src=x onerror=alert(1)>");
});

test("quote request accepts calculation inputs and strips client-calculated fields",()=>{
  const result=QuoteRequestSchema.parse({customerId:"00000000-0000-4000-8000-000000000001",lines:[{productId:"00000000-0000-4000-8000-000000000002",qty:2,discountPct:1,rebatePct:0,accessory:0,margin:99999,zone:"green",price:0}]});
  assert.equal("margin" in result.lines[0],false);assert.equal("zone" in result.lines[0],false);assert.equal("price" in result.lines[0],false);
});

test("connector credentials use authenticated AES-256-GCM encryption",()=>{
  const previous=process.env.CONNECTOR_ENCRYPTION_KEY;process.env.CONNECTOR_ENCRYPTION_KEY=randomBytes(32).toString("base64");
  try{const plain="provider-private-token-123";const encrypted=encryptSecret(plain);assert.notEqual(encrypted.ciphertext,plain);assert.equal(decryptSecret(encrypted),plain);assert.throws(()=>decryptSecret({...encrypted,authTag:Buffer.alloc(16).toString("base64")}));}
  finally{if(previous===undefined)delete process.env.CONNECTOR_ENCRYPTION_KEY;else process.env.CONNECTOR_ENCRYPTION_KEY=previous;}
});

test("bounded request reader rejects oversized JSON bodies",async()=>{
  const request=new Request("http://localhost/upload",{method:"POST",body:"0123456789"});
  await assert.rejects(()=>readTextLimited(request,5),(error:unknown)=>typeof error==="object"&&error!==null&&"status" in error&&(error as {status:number}).status===413);
});
