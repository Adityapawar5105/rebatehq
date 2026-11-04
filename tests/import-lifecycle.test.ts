import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {exportLifeline,previewImport,commitImport,undoImport,importHistory,decimal,perBaseUnit,ImportOptions,importPlanPage,resolveImportChoices} from "../lib/import-lifecycle";
import {MAX_IMPORT_DATA_ROWS} from "../lib/import-config";
import {parseUpload} from "../lib/upload-parser";
import {csvDocument} from "../lib/csv";
import {calculateServerQuote} from "../lib/margin";
import {currentImportPrices,currentStandardCosts} from "../lib/catalog-values";
import ts from "typescript";
const executedSql=new Set<string>(),normalizeSql=(sql:string)=>sql.replace(/\s+/g," ").trim();
const parse=(text:string)=>parseUpload("edited.csv",new TextEncoder().encode(text),{headerRow:1});
const options=(date:string,extra:Record<string,unknown>={})=>ImportOptions.parse({effectiveDate:date,approveTextNumbers:true,acknowledgeWarnings:true,...extra});
const denied=(status:number)=>(e:any)=>e.status===status;
async function database(){
 const {PGlite}=await import("@electric-sql/pglite"),{pgcrypto}=await import("@electric-sql/pglite/contrib/pgcrypto"),{btree_gist}=await import("@electric-sql/pglite/contrib/btree_gist");
 const db:any=new PGlite({extensions:{pgcrypto,btree_gist}});
 await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort())await db.exec(readFileSync("supabase/migrations/"+name,"utf8"));
 const query=db.query.bind(db);db.query=(sql:string,...args:any[])=>{executedSql.add(normalizeSql(sql));return query(sql,...args);};
 return db;
}
async function counts(db:any){
 const tables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id') ORDER BY c.relname")).rows;
 assert.equal(tables.length,38);const result:Record<string,number>={};for(const t of tables)result[t.relname]=(await db.query(`SELECT count(*)::int AS n FROM public.${t.relname}`)).rows[0].n;return result;
}
async function domain(db:any,tenant:string){
 const result:Record<string,unknown>={};
 for(const table of ["product","cost_history","price_list","price_list_item","uom"]){
  result[table]=(await db.query(`SELECT to_jsonb(t) AS value FROM public.${table} t WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows;
 }return result;
}
test("catalog lifecycle is isolated, audited, conflict-aware and exactly reversible twice on fresh and populated databases",async()=>{
 const db=await database();
 try{
  const empty=await counts(db);
  for(const populated of [false,true])for(let run=0;run<2;run++){
   await db.exec("BEGIN;");
   const tenant=randomUUID(),other=randomUUID(),user=randomUUID(),otherUser=randomUUID(),p1=randomUUID(),p2=randomUUID();
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)",[user,user+"@example.invalid",otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'A','EUR'),($2,'B','EUR')",[tenant,other]);
   await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner'),($4,$5,$6,'owner')",[tenant,user,user+"@example.invalid",other,otherUser,otherUser+"@example.invalid"]);
   await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price,supplier) VALUES($1,$2,'P-1','Original','Test','EA',10,20,'Acme'),($3,$2,'P-2','Unchanged','Test','EA',15,30,'Acme')",[p1,tenant,p2]);
   await db.query("DELETE FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2",[tenant,p1]);
   await db.query("INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,effective_to,source,currency) VALUES($1,$2,10,'standard','2020-01-01','2030-01-01','old','EUR'),($1,$2,20,'standard','2030-01-01',NULL,'future','EUR')",[tenant,p1]);
   if(populated)await db.query("INSERT INTO public.import_job(tenant_id,import_type,status,source_name) VALUES($1,'catalog_import_v1','dry_run','earlier.csv'),($2,'catalog_export_v1','dry_run','other.csv')",[tenant,other]);
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);
   await db.exec("SET LOCAL ROLE rebatehq_app;");
   const role=(await db.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];assert.equal(role.name,"rebatehq_app");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
   const date=(await db.query("SELECT current_date::text AS day")).rows[0].day;
   const exported=parse(await exportLifeline(db,tenant,user,"Acme"));assert.equal(exported.headers[0],"md_row_id");assert.equal(exported.rows.length,2);
   const edited=structuredClone(exported);edited.rows[0].cells[3].value="File name";edited.rows[0].cells[5].value="12";edited.rows[0].cells[6].value="25";
   await db.query("UPDATE public.product SET name='App name' WHERE tenant_id=$1 AND id=$2",[tenant,p1]);
   const baseline=await domain(db,tenant);
   const conflict=await previewImport(db,tenant,user,"edited.csv",edited,options(date));
   assert.equal(conflict.conflicts,1);assert.equal(conflict.canCommit,false);
   assert.equal(conflict.rows[0].conflict!.baseline.description,"Original");assert.equal(conflict.rows[0].conflict!.app.description,"App name");assert.equal(conflict.rows[0].conflict!.file.description,"File name");
   assert.equal((await importPlanPage(db,tenant,conflict.id)).totalRows,2);
   const resolved=await resolveImportChoices(db,tenant,conflict.id,{"2":"file"});assert.equal(resolved.conflicts,0);assert.equal(resolved.canCommit,true);
   await resolveImportChoices(db,tenant,conflict.id,{"2":"review"});
   await assert.rejects(commitImport(db,tenant,user,conflict.id),denied(409));
   const keep=await previewImport(db,tenant,user,"edited.csv",edited,options(date,{decisions:{"2":"app"}}));assert.equal(keep.rows[0].state,"unchanged");
   assert.deepEqual(await domain(db,tenant),baseline,"dry runs never mutate business rows");
   const source=[...edited.rows.map(r=>r.cells.map(c=>c.value)),["","","P-3","New product","EA","5","10","Acme",date],["","","BAD","Bad product","EA","=1+1","10","Acme",date]];
   const plan=await previewImport(db,tenant,user,"edited.csv",parse(csvDocument(edited.headers,source)),options(date,{decisions:{"2":"file"}}));
   assert.deepEqual(plan.counts,{new:1,changed:1,unchanged:1,rejected:1});assert.equal(plan.canCommit,true);
   await assert.rejects(commitImport(db,tenant,user,plan.id),denied(422));
   await db.exec("SAVEPOINT currency_changed;");await db.query("UPDATE public.tenant SET currency='USD' WHERE tenant_id=$1",[tenant]);await assert.rejects(commitImport(db,tenant,user,plan.id,true),denied(409));await db.exec("ROLLBACK TO SAVEPOINT currency_changed;");
   const applied=await commitImport(db,tenant,user,plan.id,true);assert.equal(applied.accepted,2);
   await assert.rejects(commitImport(db,tenant,user,plan.id,true),denied(409));
   assert.equal((await db.query("SELECT name FROM public.product WHERE id=$1",[p1])).rows[0].name,"File name");
   const history=(await db.query("SELECT cost::text,effective_from::text,effective_to::text FROM public.cost_history WHERE product_id=$1 ORDER BY effective_from",[p1])).rows;
   assert.deepEqual(history,[{cost:"10.0000",effective_from:"2020-01-01",effective_to:date},{cost:"12.0000",effective_from:date,effective_to:"2030-01-01"},{cost:"20.0000",effective_from:"2030-01-01",effective_to:null}]);
   const price=(await db.query("SELECT unit_price::text,currency::text FROM public.price_list_item WHERE product_id=$1",[p1])).rows[0];assert.deepEqual(price,{unit_price:"25.0000",currency:"EUR"});
   assert.equal((await currentImportPrices(db,tenant,[p1])).get(p1),"25.0000");
   assert.equal((await currentStandardCosts(db,tenant,[p1])).get(p1),"12.0000");
   const customer=randomUUID();await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,$3,'Test buyer')",[customer,tenant,randomUUID()]);
   const quote=await calculateServerQuote(db,tenant,customer,[{productId:p1,qty:1,uom:"EA",discountPct:0,rebatePct:0,accessory:0}],date,"EUR");
   assert.equal(quote.math.lines[0].unitPrice,25);assert.equal(quote.math.cogs,12);assert.equal(quote.math.lines[0].pricingExplanation.source,"Approved file import");
   await db.query("DELETE FROM public.customer WHERE tenant_id=$1 AND id=$2",[tenant,customer]);
   for(const action of ["product.insert","product.update","cost_history.insert","cost_history.update","price_list.insert","price_list_item.insert","import_job.update"]){
    assert.ok((await db.query("SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id=$1 AND action=$2 AND actor_id=$3",[tenant,action,user])).rows[0].n>0,action+" must be audited");
   }
   await db.exec("SAVEPOINT later_edit;");await db.query("UPDATE public.product SET name='Later edit' WHERE id=$1",[p1]);await assert.rejects(undoImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT later_edit;");
   await db.exec("SAVEPOINT undo_currency;");await db.query("UPDATE public.tenant SET currency='USD' WHERE tenant_id=$1",[tenant]);await assert.rejects(undoImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT undo_currency;");
   await db.exec("SAVEPOINT later_list;");const pl=(await db.query("SELECT id FROM public.price_list WHERE tenant_id=$1 AND name='RebateHQ file imports'",[tenant])).rows[0].id;
   await db.query("INSERT INTO public.price_list_item(tenant_id,price_list_id,product_id,unit_price,effective_from,currency) VALUES($1,$2,$3,35,$4::date,'EUR')",[tenant,pl,p2,date]);
   await assert.rejects(undoImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT later_list;");
   await db.exec("SAVEPOINT later_version;");await db.query("INSERT INTO public.price_list_version(tenant_id,price_list_id,version_no,status) VALUES($1,$2,1,'published')",[tenant,pl]);await assert.rejects(undoImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT later_version;");
   await db.exec("SAVEPOINT referenced_new;");const newId=(await db.query("SELECT id FROM public.product WHERE tenant_id=$1 AND sku='P-3'",[tenant])).rows[0].id;
   await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,$3,'Dependency')",[customer,tenant,randomUUID()]);
   const q=randomUUID();await db.query("INSERT INTO public.quote(id,tenant_id,customer_id,created_by,status,margin_zone,currency) VALUES($1,$2,$3,$4,'draft','green','EUR')",[q,tenant,customer,user]);
   await db.query("INSERT INTO public.quote_line(tenant_id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct,currency,uom_code) VALUES($1,$2,$3,1,10,10,5,5,50,'EUR','EA')",[tenant,q,newId]);
   await assert.rejects(undoImport(db,tenant,user,plan.id),(e:any)=>e.code==="23503");await db.exec("ROLLBACK TO SAVEPOINT referenced_new;");
   await undoImport(db,tenant,user,plan.id);assert.deepEqual(await domain(db,tenant),baseline,"undo restores exact business rows and counts, including original IDs/dates");
   for(const action of ["product.delete","cost_history.delete","price_list_item.delete","price_list.delete","import_job.insert"]){
    assert.ok((await db.query("SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id=$1 AND actor_id=$2 AND action=$3",[tenant,user,action])).rows[0].n>0,action+" must be audited");
   }
   assert.ok((await db.query("SELECT id FROM public.audit_log WHERE tenant_id=$1 AND entity_id=$2 AND after->>'status'='committed'",[tenant,plan.id])).rows.length);
   assert.ok((await db.query("SELECT id FROM public.audit_log WHERE tenant_id=$1 AND entity_id=$2 AND after->'summary'->>'undoneAt' IS NOT NULL",[tenant,plan.id])).rows.length);
   await assert.rejects(undoImport(db,tenant,user,plan.id),denied(409));
   assert.equal((await importHistory(db,tenant)).find(r=>r.id===plan.id)!.status,"undone");
   assert.equal((await importHistory(db,tenant)).find(r=>r.id===plan.id)!.who,user+"@example.invalid");
   assert.equal((await importHistory(db,tenant)).find(r=>r.id===plan.id)!.filename,"edited.csv");
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[otherUser]);
   assert.equal((await importHistory(db,tenant)).length,0);await assert.rejects(commitImport(db,other,otherUser,plan.id,true),denied(404));
   const foreign=await previewImport(db,other,otherUser,"foreign.csv",exported,options(date));assert.equal(foreign.counts.rejected,2);assert.equal(foreign.canCommit,false);
   await db.exec("RESET ROLE;ROLLBACK;");assert.deepEqual(await counts(db),empty,"both runs roll back every tenant row, journal and audit event");
  }
 }finally{await db.close();}
});
test("same-day updates, future gaps, explicit unit conversion and stale/key controls run against real SQL",async()=>{
 const db=await database();
 try{
  const empty=await counts(db);for(let run=0;run<2;run++){
  await db.exec("BEGIN;");const tenant=randomUUID(),user=randomUUID(),p=randomUUID(),pl=randomUUID(),box=randomUUID();
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[user,user+"@example.invalid"]);
  await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'Lifecycle','EUR')",[tenant]);
  await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'manager')",[tenant,user,user+"@example.invalid"]);
  await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'P','Part','Test','EA',10,20)",[p,tenant]);
  await db.query("INSERT INTO public.price_list(id,tenant_id,name,currency) VALUES($1,$2,'RebateHQ file imports','EUR')",[pl,tenant]);
  const date=(await db.query("SELECT current_date::text AS value")).rows[0].value;
  await db.query("INSERT INTO public.price_list_item(tenant_id,price_list_id,product_id,unit_price,effective_from,effective_to,currency) VALUES($1,$2,$3,20,$4::date,'2030-01-01','EUR'),($1,$2,$3,30,'2030-01-01',NULL,'EUR')",[tenant,pl,p,date]);
  await db.query("INSERT INTO public.uom(id,tenant_id,code,display_name) VALUES($1,$2,'BOX','Box')",[box,tenant]);
  const ea=(await db.query("SELECT id FROM public.uom WHERE tenant_id=$1 AND code='EA'",[tenant])).rows[0].id,conversion=randomUUID();
  await db.query("INSERT INTO public.uom_conversion(id,tenant_id,product_id,from_uom_id,to_uom_id,factor,direction) VALUES($1,$2,$3,$4,$5,12,'multiply')",[conversion,tenant,p,box,ea]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('app.real_actor_id',$1,true)",[user]);await db.exec("SET LOCAL ROLE rebatehq_app;");
  const input=parse(`SKU,Description,Unit,Cost,Price,Date\nP,Part,BOX,144,300,${date}`),base=await domain(db,tenant);
  assert.equal((await previewImport(db,tenant,user,"x.csv",input,options(date))).counts.rejected,1,"unit conversion requires approval");
  assert.equal((await previewImport(db,tenant,user,"x.csv",input,options(date,{approveTextNumbers:false,approveUnits:true}))).counts.rejected,1,"text conversion requires approval");
  const plan=await previewImport(db,tenant,user,"x.csv",input,options(date,{approveUnits:true}));assert.equal(plan.rows[0].after!.cost,"12.0000");assert.equal(plan.rows[0].after!.price,"25.0000");assert.equal(plan.rows[0].after!.unit,"EA");
  const priceOnly=await previewImport(db,tenant,user,"price.csv",parse(`SKU,Unit,Price\nP,BOX,300`),options(date,{approveUnits:true}));assert.equal(priceOnly.rows[0].after!.cost,"10.0000");assert.equal(priceOnly.rows[0].after!.price,"25.0000");
  await db.exec("SAVEPOINT factor_changed;");await db.query("UPDATE public.uom_conversion SET factor=24 WHERE id=$1",[conversion]);await assert.rejects(commitImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT factor_changed;");
  await db.exec("SAVEPOINT stale;");await db.query("UPDATE public.product SET supplier='Changed' WHERE id=$1",[p]);await assert.rejects(commitImport(db,tenant,user,plan.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT stale;");
  await commitImport(db,tenant,user,plan.id);assert.equal((await currentStandardCosts(db,tenant,[p])).get(p),"12.0000");assert.equal((await currentImportPrices(db,tenant,[p])).get(p),"25.0000");
  await undoImport(db,tenant,user,plan.id);assert.deepEqual(await domain(db,tenant),base);
  const later=new Date(date+"T00:00:00Z");later.setUTCDate(later.getUTCDate()+1);const tomorrow=later.toISOString().slice(0,10);
  const split=await previewImport(db,tenant,user,"split.csv",parse(`SKU,Description,Unit,Cost,Price,Date\nP,Part,EA,14,26,${tomorrow}`),options(date));
  await commitImport(db,tenant,user,split.id);
  assert.equal((await db.query("SELECT effective_to::text AS value FROM public.price_list_item WHERE product_id=$1 AND effective_from=$2::date",[p,date])).rows[0].value,tomorrow);
  await undoImport(db,tenant,user,split.id);assert.deepEqual(await domain(db,tenant),base);
  const unknown=parse(`SKU,Description,Unit,Cost,Price,Date\nP,Part,PAL,12,25,${date}`),missing=await previewImport(db,tenant,user,"x.csv",unknown,options(date,{approveUnits:true}));
  assert.equal(missing.counts.rejected,1);assert.ok((await db.query("SELECT id FROM public.data_quality_issue WHERE tenant_id=$1 AND entity_type='import_job' AND entity_id=$2",[tenant,missing.id+":2"])).rows.length);
  const noUnit=parse(`SKU,Price\nP,25`),missingUnit=await previewImport(db,tenant,user,"x.csv",noUnit,options(date));assert.equal(missingUnit.counts.rejected,1);
  assert.ok((await db.query("SELECT id FROM public.data_quality_issue WHERE tenant_id=$1 AND entity_id=$2",[tenant,missingUnit.id+":2"])).rows.length);
  const lowerUnit=parse(`SKU,Description,Unit,Cost,Price\nLOWER,Lower,ea,1,2`);assert.equal((await previewImport(db,tenant,user,"x.csv",lowerUnit,options(date,{approveUnits:true}))).counts.rejected,1);
  const exported=parse(await exportLifeline(db,tenant,user)),tampered=structuredClone(exported);tampered.rows[0].cells[2].value="RENAMED";
  assert.equal((await previewImport(db,tenant,user,"tamper.csv",tampered,options(date))).counts.rejected,1);
  tampered.rows[0].cells[0].value=randomUUID();assert.equal((await previewImport(db,tenant,user,"tamper.csv",tampered,options(date))).counts.rejected,1);
  tampered.rows[0].cells[0].value="";tampered.rows[0].cells[1].value="";tampered.rows[0].cells[2].value="P";assert.equal((await previewImport(db,tenant,user,"tamper.csv",tampered,options(date))).counts.rejected,1);
  const removed=structuredClone(exported);removed.headers[1]="renamed";await assert.rejects(previewImport(db,tenant,user,"tamper.csv",removed,options(date)),denied(422));
  const mapped=structuredClone(exported);mapped.mapping.sku=0;await assert.rejects(previewImport(db,tenant,user,"tamper.csv",mapped,options(date)),denied(422));
  const wrongCase=structuredClone(exported);wrongCase.headers[0]="MD_ROW_ID";await assert.rejects(previewImport(db,tenant,user,"tamper.csv",wrongCase,options(date)),denied(422));
  const overflow=structuredClone(input);overflow.rows=Array.from({length:MAX_IMPORT_DATA_ROWS+1},(_,i)=>({...input.rows[0],row:i+2}));
  await assert.rejects(previewImport(db,tenant,user,"large.csv",overflow,options(date)),denied(422));
  const caseUnit=randomUUID();await db.query("INSERT INTO public.uom(id,tenant_id,code,display_name) VALUES($1,$2,'CASE','Case')",[caseUnit,tenant]);
  const newCase=await previewImport(db,tenant,user,"case.csv",parse("SKU,Description,Unit,Cost,Price\nNEWCASE,New case,CASE,1,2"),options(date));
  await db.exec("SAVEPOINT removed_unit;");await db.query("DELETE FROM public.uom WHERE tenant_id=$1 AND id=$2",[tenant,caseUnit]);await assert.rejects(commitImport(db,tenant,user,newCase.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT removed_unit;");
  const newSku=parse(`SKU,Description,Unit,Cost,Price,Date\nNEW,New,EA,1,2,${date}`),staleNew=await previewImport(db,tenant,user,"new.csv",newSku,options(date));
  await db.exec("SAVEPOINT expiry;");await db.query("UPDATE public.import_job SET summary=jsonb_set(summary,'{plan,expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1",[staleNew.id]);await assert.rejects(commitImport(db,tenant,user,staleNew.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT expiry;");
  await db.exec("SAVEPOINT created_after_preview;");await db.query("INSERT INTO public.product(tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,'NEW','Other','Test','EA',1,2)",[tenant]);await assert.rejects(commitImport(db,tenant,user,staleNew.id),denied(409));await db.exec("ROLLBACK TO SAVEPOINT created_after_preview;");
  // A gap must end at the already scheduled future row; undo restores that gap.
  await db.exec("SAVEPOINT gap;");await db.query("DELETE FROM public.cost_history WHERE product_id=$1",[p]);await db.query("INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,source,currency) VALUES($1,$2,30,'standard','2030-01-01','future','EUR')",[tenant,p]);
  await db.query("DELETE FROM public.price_list_item WHERE product_id=$1 AND effective_from<$2::date",[p,"2030-01-01"]);
  const gapBase=await domain(db,tenant),gap=await previewImport(db,tenant,user,"gap.csv",parse(`SKU,Description,Unit,Cost,Price,Date\nP,Part,EA,14,26,${date}`),options(date));
  await commitImport(db,tenant,user,gap.id);
  assert.equal((await db.query("SELECT effective_to::text AS value FROM public.cost_history WHERE product_id=$1 AND effective_from=$2::date",[p,date])).rows[0].value,"2030-01-01");
  assert.equal((await db.query("SELECT effective_to::text AS value FROM public.price_list_item WHERE product_id=$1 AND effective_from=$2::date",[p,date])).rows[0].value,"2030-01-01");
  await undoImport(db,tenant,user,gap.id);assert.deepEqual(await domain(db,tenant),gapBase);await db.exec("ROLLBACK TO SAVEPOINT gap;");
  await db.exec("RESET ROLE;ROLLBACK;");assert.deepEqual(await counts(db),empty);}
 }finally{await db.close();}
});
test("decimal approval is explicit and price-per-base-unit arithmetic never uses floating point",()=>{
 assert.equal(decimal("12,50","comma"),"12.5000");assert.equal(perBaseUnit("120.0000","12.0000"),"10.0000");
 assert.equal(perBaseUnit("1.0000","3.0000"),"0.3333");
 assert.equal(decimal("99999999999999.9999"),"99999999999999.9999");
 for(const v of ["1,000.00","-1","1e3","0.00001"," 1","NaN"])assert.throws(()=>decimal(v));
});
test("every new runtime SQL statement executed locally in PGlite",()=>{
 let found=0;
 for(const file of ["lib/import-lifecycle.ts","lib/import-batches.ts","lib/catalog-values.ts","lib/margin.ts"]){
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
  const visit=(node:ts.Node)=>{
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="query"){
    const sql=node.arguments[0];
    if(sql&&(ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))&&(file!=="lib/margin.ts"||sql.text.includes("AS list_history"))){
     found++;assert.ok(executedSql.has(normalizeSql(sql.text)),`${file}: runtime SQL was not executed: ${normalizeSql(sql.text)}`);
    }
   }ts.forEachChild(node,visit);
  };visit(source);
 }
 assert.ok(found>=35,"SQL inventory cannot be empty or lose the import paths");
});
