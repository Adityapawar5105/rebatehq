import {testIdentity} from './signed-context';
import {generateIdentity} from '../../lib/relay/crypto';
import type {RelayRole} from '../../lib/relay/protocol';
import type {RelayActor} from '../../lib/relay/store';
export async function relayFixture(db:any){
 const tenantId=crypto.randomUUID(),actors=[];
 await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1::uuid,'synthetic relay test')",[tenantId]);
 for(const role of ['owner','manager','rep'] as RelayRole[]){
  const userId=crypto.randomUUID(),deviceId=crypto.randomUUID(),identity=await generateIdentity(tenantId,userId,deviceId);
  await db.query('INSERT INTO auth.users(id,email) VALUES($1::uuid,$2::text)',[userId,userId+'@example.invalid']);
  await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1::uuid,$2::uuid,$3::text,$4::text)",[tenantId,userId,userId+'@example.invalid',role]);
  actors.push({actor:{tenantId,userId,deviceId},identity,role});
 }
 await db.query("INSERT INTO public.workspace_licence(tenant_id,tier,valid_until) VALUES($1::uuid,'professional',now()+interval '30 days')",[tenantId]);
 for(const {actor} of actors){await db.query('INSERT INTO public.licence_seat(tenant_id,user_id) VALUES($1::uuid,$2::uuid)',[tenantId,actor.userId]);await db.query("INSERT INTO public.licence_device(id,tenant_id,user_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,'active')",[actor.deviceId,tenantId,actor.userId]);await db.query("UPDATE public.licence_device SET status='active' WHERE id=$1::uuid",[actor.deviceId]);}
 return {tenantId,actors};
}
export async function asRelay<T>(db:any,actor:RelayActor,work:()=>Promise<T>):Promise<T>{
 await db.exec('BEGIN;SET LOCAL ROLE rebatehq_app;');
 try{await testIdentity(db,actor.userId);const value=await work();await db.exec('COMMIT');return value;}
 catch(error){await db.exec('ROLLBACK');throw error;}
}
