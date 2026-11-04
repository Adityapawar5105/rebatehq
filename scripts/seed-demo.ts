import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { validatePrototype, importPrototypeData } from "@/lib/prototype-import";
import { withDatabase } from "@/lib/db";
loadEnvConfig(process.cwd());

async function main(){
  const adminUrl=process.env.SEED_DATABASE_URL,actorId=process.env.DEMO_OWNER_USER_ID;
  if(!adminUrl||!actorId)throw new Error("Set SEED_DATABASE_URL and DEMO_OWNER_USER_ID to an existing verified Supabase Auth user.");
  if(!process.env.APP_DATABASE_URL)throw new Error("Set APP_DATABASE_URL for the dedicated NOBYPASSRLS app login.");
  const pool=new Pool({connectionString:adminUrl,ssl:{rejectUnauthorized:true},application_name:"rebatehq-seed-demo"});
  const seed=JSON.parse(await readFile(new URL("../seed_data.json",import.meta.url),"utf8"));
  const plan=validatePrototype(seed);const name=`${seed.company?.name||"RebateHQ"} — Demo`;let tenantId:string;
  try{
    const db=await pool.connect();try{await db.query("BEGIN");const user=await db.query<{email:string;email_confirmed_at:Date|null}>("SELECT email,email_confirmed_at FROM auth.users WHERE id=$1",[actorId]);if(!user.rows[0]?.email_confirmed_at)throw new Error("DEMO_OWNER_USER_ID must be an existing verified Supabase Auth user.");const existing=await db.query<{tenant_id:string}>("SELECT tenant_id FROM public.tenant WHERE is_demo=true AND name=$1 AND created_by=$2 ORDER BY created_at LIMIT 1 FOR UPDATE",[name,actorId]);tenantId=existing.rows[0]?.tenant_id||randomUUID();if(!existing.rows[0]){await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",[actorId,JSON.stringify({sub:actorId,role:"authenticated"})]);await db.query("INSERT INTO public.tenant(tenant_id,name,is_demo,created_by) VALUES($1,$2,true,$3)",[tenantId,name,actorId]);await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner') ON CONFLICT DO NOTHING",[tenantId,actorId,user.rows[0].email.toLowerCase()]);await db.query("INSERT INTO public.margin_policy(tenant_id,scope_type,scope_key,target_margin_pct,floor_margin_pct,walkaway_margin_pct,updated_by) VALUES($1,'global','',30,22,18,$2) ON CONFLICT(tenant_id,scope_type,scope_key) DO NOTHING",[tenantId,actorId]);}await db.query("COMMIT")}catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error}finally{db.release()}
    const sourceHash=createHash("sha256").update(JSON.stringify(seed)).digest("hex");
    const result=await withDatabase({userId:actorId},async db=>{const existing=await db.query("SELECT id FROM import_job WHERE tenant_id=$1 AND import_type='prototype' AND status='committed'",[tenantId]);if(existing.rowCount)return{alreadySeeded:true};const job=await db.query<{id:string}>("INSERT INTO import_job(tenant_id,import_type,status,source_name,source_hash,summary,created_by) VALUES($1,'prototype','dry_run','seed_data.json',$2,'{}'::jsonb,$3) RETURNING id",[tenantId,sourceHash,actorId]);const imported=await importPrototypeData(db,tenantId,actorId,plan,job.rows[0].id);return{tenantId,imported}});
    process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  }finally{await pool.end()}
}
main().catch(error=>{console.error(JSON.stringify({event:"seed_demo.failed",name:error instanceof Error?error.name:"unknown",message:error instanceof Error?error.message:"unknown"}));process.exit(1)});
