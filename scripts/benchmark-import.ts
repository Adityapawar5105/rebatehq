import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {performance} from "node:perf_hooks";
import {appendFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {Client} from "pg";
import type {PoolClient} from "pg";
import {MAX_IMPORT_DATA_ROWS} from "../lib/import-config";
import {parseUpload} from "../lib/upload-parser";
import {previewImport,commitImport,undoImport,ImportOptions} from "../lib/import-lifecycle";
type DB=Pick<PoolClient,"query">;
export async function benchmarkImport(db:DB,rows=MAX_IMPORT_DATA_ROWS){
 assert.ok(Number.isInteger(rows)&&rows>0&&rows<=MAX_IMPORT_DATA_ROWS);
 const tables=(await db.query(`SELECT c.relname::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) ORDER BY c.relname`)).rows;
 assert.ok(tables.length>=38);
 const counts=async()=>{const result:Record<string,string>={};for(const t of tables)result[t.name]=(await db.query(`SELECT count(*)::text AS n FROM public."${String(t.name).replaceAll('"','""')}"`)).rows[0].n;return result;};
 const before=await counts(),tenant=randomUUID(),user=randomUUID();
 await db.query("BEGIN");
 let phase="fixture setup";
 try{
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[user,user+"@benchmark.invalid"]);
  await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Disposable import benchmark')",[tenant]);
  await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[tenant,user,user+"@benchmark.invalid"]);
  await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'EA','Each')",[tenant]);
  phase="restricted role and authenticated context";
  await db.query("SET LOCAL ROLE rebatehq_app");
  const role=(await db.query("SELECT current_user AS role,rolsuper,rolbypassrls,current_setting('server_version') AS version FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(role.role,"rebatehq_app");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1::text,true),set_config('app.real_actor_id',$1::text,true)",[user]);
  const date=(await db.query("SELECT current_date::text AS date")).rows[0].date;
  const source="SKU,Description,Unit,Cost,Price,Date\n"+Array.from({length:rows},(_,i)=>`BENCH-${i},Benchmark item,EA,10,20,${date}`).join("\n");
  const parsed=parseUpload("benchmark.csv",new TextEncoder().encode(source),{headerRow:1});
  phase="preview";
  const plan=await previewImport(db,tenant,user,"benchmark.csv",parsed,ImportOptions.parse({effectiveDate:date,approveTextNumbers:true,acknowledgeWarnings:true}));
  phase="commit";
  const start=performance.now(),result=await commitImport(db,tenant,user,plan.id),commitMs=performance.now()-start;
  assert.equal(result.accepted,rows);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.product WHERE tenant_id=$1",[tenant])).rows[0].n,rows);
  phase="undo";
  const undoStart=performance.now();await undoImport(db,tenant,user,plan.id);const undoMs=performance.now()-undoStart;
  const restored=(await db.query(`SELECT (SELECT count(*)::integer FROM public.product WHERE tenant_id=$1) AS products,
   (SELECT count(*)::integer FROM public.cost_history WHERE tenant_id=$1) AS costs,
   (SELECT count(*)::integer FROM public.price_list_item WHERE tenant_id=$1) AS prices,
   (SELECT count(*)::integer FROM public.price_list WHERE tenant_id=$1) AS lists,
   (SELECT count(*)::integer FROM public.import_job WHERE tenant_id=$1 AND status='committed') AS jobs,
   (SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=$1 AND action='product.insert') AS inserted,
   (SELECT count(*)::integer FROM public.audit_log WHERE tenant_id=$1 AND action='product.delete') AS deleted`,[tenant])).rows[0];
  assert.deepEqual(restored,{products:0,costs:0,prices:0,lists:0,jobs:1,inserted:rows,deleted:rows});
  return {rows,commit_ms:Math.round(commitMs),undo_ms:Math.round(undoMs),postgres_version:role.version,role:role.role};
 }catch(error){
  const code=error&&typeof error==="object"&&"code" in error?String(error.code).replace(/[^A-Z0-9]/g,"").slice(0,10):"assertion";
  throw new Error(`Import benchmark failed during ${phase} (${code}); no source values or credentials were logged.`);
 }finally{
  await db.query("ROLLBACK");await db.query("RESET ROLE");
  assert.deepEqual(await counts(),before,"Benchmark fixture transaction must leave no tenant-table residue.");
 }
}
async function main(){
 const connectionString=process.env.TEST_DATABASE_URL||process.env.SEED_DATABASE_URL;
 if(!connectionString)throw new Error("TEST_DATABASE_URL or SEED_DATABASE_URL is required for a disposable benchmark database.");
 const client=new Client({connectionString,ssl:/(localhost|127\.0\.0\.1)/i.test(connectionString)?false:{rejectUnauthorized:true}});
 await client.connect();
 try{
  const timing=await benchmarkImport(client);
  process.stdout.write("REAL_POSTGRES_IMPORT_TIMING "+JSON.stringify(timing)+"\n");
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### Real Postgres import benchmark\n\n- Rows: ${timing.rows}; PostgreSQL ${timing.postgres_version}; role ${timing.role} (non-superuser, non-bypass).\n- commitImport: ${timing.commit_ms} ms; undoImport: ${timing.undo_ms} ms.\n- Fresh catalog with row audits; rollback verified all tenant-table counts unchanged.\n- Excludes parsing/setup/network and durable outer COMMIT/WAL flush; not a serverless latency guarantee.\n`);
 }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(error instanceof Error&&error.message.startsWith("Import benchmark failed during")?error.message+"\n":"Real Postgres import benchmark setup failed; no connection details were logged.\n");process.exitCode=1;});
