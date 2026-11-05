import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {Pool} from "pg";
import type {PoolClient} from "pg";
type DB=Pick<PoolClient,"query">;
// 6R: the sentinel is a rebate agreement (wave-2 tables stay until 8R). A quote whose
// customer/product IDs no longer reference a server table proves those rows restore intact.
export const SENTINEL={tenant:"61000000-0000-4000-8000-000000000001",agreement:"62000000-0000-4000-8000-000000000001",name:"RESTORE-SENTINEL"};
export async function seedRestoreData(db:DB){
 const {tenant,agreement}=SENTINEL;
 if((await db.query("SELECT 1 FROM public.tenant WHERE tenant_id=$1",[tenant])).rows.length)throw new Error("Restore sentinel UUID collision in public.tenant; use a clean disposable source.");
 await db.query("INSERT INTO public.tenant(tenant_id,name,currency,is_demo) VALUES($1,'Restore drill sentinel','USD',true)",[tenant]);
 await db.query("INSERT INTO public.rebate_agreement(tenant_id,id,party_type,party_id,name,rate_pct,threshold_amount,period_start,period_end,currency) VALUES($1,$2,'vendor','RESTORE-VENDOR','RESTORE-SENTINEL',2.5,1000,'2026-01-01','2026-12-31','USD')",[tenant,agreement]);
 const owner=randomUUID(),device=randomUUID(),quote=randomUUID(),line=randomUUID(),customer=randomUUID(),product=randomUUID();
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1::uuid,$2::text,now())",[owner,owner+'@example.test']);
 await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1::uuid,$2::uuid,$3::text,'owner')",[tenant,owner,owner+'@example.test']);
 await db.query("INSERT INTO public.quote(id,tenant_id,customer_id,created_by,status,currency,margin_zone,pocket_price,cogs_total,pocket_margin,margin_pct) VALUES($1,$2,$3,$4,'draft','USD','green',30,20,10,33.333)",[quote,tenant,customer,owner]);
 await db.query("INSERT INTO public.quote_line(id,tenant_id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct,currency,uom_code) VALUES($1,$2,$3,$4,2,20,30,20,10,33.333,'USD','EA')",[line,tenant,quote,product]);
 await db.query("INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) VALUES($1::uuid,'scale',now()+interval '7 days')",[tenant]);
 await db.query("INSERT INTO public.licence_seat(tenant_id,user_id) VALUES($1::uuid,$2::uuid)",[tenant,owner]);
 await db.query("INSERT INTO public.licence_location(tenant_id,name,erp_profile) VALUES($1::uuid,'Synthetic restore location','generic')",[tenant]);
 await db.query("INSERT INTO public.licence_device(id,tenant_id,user_id) VALUES($1::uuid,$2::uuid,$3::uuid)",[device,tenant,owner]);
 return {tenant,agreement,quote,line,owner};
}
async function main(){
 if(!process.env.SEED_DATABASE_URL)throw new Error("SEED_DATABASE_URL is required for the disposable restore drill.");
 const pool=new Pool({connectionString:process.env.SEED_DATABASE_URL,ssl:/(localhost|127\.0\.0\.1)/i.test(process.env.SEED_DATABASE_URL)?false:{rejectUnauthorized:true}});
 const db=await pool.connect();
 try{await db.query("BEGIN");await seedRestoreData(db);await db.query("COMMIT");process.stdout.write("Seeded the restore sentinel agreement, a quote with retired-table IDs and control-plane rows.\n");}
 catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write("Could not seed disposable restore fixtures. Check source setup and sentinel UUID collisions.\n");process.exitCode=1;});
