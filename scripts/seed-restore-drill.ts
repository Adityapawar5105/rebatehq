import {seedRestoreRelay} from './seed-restore-relay';
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {Pool} from "pg";
import type {PoolClient} from "pg";
type DB=Pick<PoolClient,"query">;
// 8R: the wave-2 business tables are gone, so the sentinel is a licence location with a fixed ID. The
// control-plane rows and the encrypted relay rows are the tenant data a restore must bring back intact.
export const SENTINEL={tenant:"61000000-0000-4000-8000-000000000001",location:"62000000-0000-4000-8000-000000000001",name:"RESTORE-SENTINEL"};
export async function seedRestoreData(db:DB){
 const {tenant,location,name}=SENTINEL;
 if((await db.query("SELECT 1 FROM public.tenant WHERE tenant_id=$1",[tenant])).rows.length)throw new Error("Restore sentinel UUID collision in public.tenant; use a clean disposable source.");
 await db.query("INSERT INTO public.tenant(tenant_id,name,currency,is_demo) VALUES($1,'Restore drill sentinel','USD',true)",[tenant]);
 const owner=randomUUID(),device=randomUUID();
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1::uuid,$2::text,now())",[owner,owner+'@example.test']);
 await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1::uuid,$2::uuid,$3::text,'owner')",[tenant,owner,owner+'@example.test']);
 await db.query("INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) VALUES($1::uuid,'scale',now()+interval '7 days')",[tenant]);
 await db.query("INSERT INTO public.licence_seat(tenant_id,user_id) VALUES($1::uuid,$2::uuid)",[tenant,owner]);
 await db.query("INSERT INTO public.licence_location(id,tenant_id,name,erp_profile) VALUES($1::uuid,$2::uuid,$3::text,'generic')",[location,tenant,name]);
 await db.query("INSERT INTO public.licence_device(id,tenant_id,user_id) VALUES($1::uuid,$2::uuid,$3::uuid)",[device,tenant,owner]);
 const relay=await seedRestoreRelay(db,tenant,owner,device);
 return {tenant,location,owner,relay};
}
async function main(){
 if(!process.env.SEED_DATABASE_URL)throw new Error("SEED_DATABASE_URL is required for the disposable restore drill.");
 const pool=new Pool({connectionString:process.env.SEED_DATABASE_URL,ssl:/(localhost|127\.0\.0\.1)/i.test(process.env.SEED_DATABASE_URL)?false:{rejectUnauthorized:true}});
 const db=await pool.connect();
 try{await db.query("BEGIN");await seedRestoreData(db);await db.query("COMMIT");process.stdout.write("Seeded the restore sentinel location, control-plane rows and encrypted relay rows.\n");}
 catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write("Could not seed disposable restore fixtures. Check source setup and sentinel UUID collisions.\n");process.exitCode=1;});
