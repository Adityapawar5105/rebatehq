// Local browser harness only: production UI + worker + production store/RLS,
// with PGlite transport interception. Authenticated CI uses real HTTP/Supabase.
import {testDatabase} from '../tests/helpers/database';
import {relayFixture,asRelay} from '../tests/helpers/relay-fixtures';
import {relayPost,relayDirectory,relayPage,relayPackPage} from '../lib/relay/store';
export async function localRelayDatabase(storageUrl:string){
 const db=await testDatabase(),fixture=await relayFixture(db),objects=new Map<string,Uint8Array>();
 const allowed=async(userId:string,name:string,write:boolean)=>{await db.exec('BEGIN');try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);await db.exec('SET LOCAL ROLE authenticated');return (await db.query('SELECT rebatehq_storage.relay_storage_allowed($1,$2) AS ok',[name,write])).rows[0].ok===true;}finally{await db.exec('ROLLBACK');}};
 let tail:Promise<unknown>=Promise.resolve();
 const serial=<T>(fn:()=>Promise<T>)=>{const p=tail.then(fn);tail=p.catch(()=>undefined);return p;};
 return {actors:fixture.actors.map(v=>({...v.actor,email:v.actor.userId+'@example.invalid'})),
  query:(sql:string,args?:unknown[])=>serial(()=>db.query(sql,args)),close:()=>db.close(),
  /** Team sharing S3: Supabase Storage stand-in for the local harness (the authenticated CI gate uses real Storage). */
  storage:(actor:typeof fixture.actors[0]['actor'],method:string,path:string,body:Uint8Array|null)=>serial(async()=>{
   if(method==='POST'){if(!await allowed(actor.userId,path,true)||objects.has(path))return {status:403,body:null};objects.set(path,new Uint8Array(body!));return {status:200,body:null};}
   if(!await allowed(actor.userId,path,false)||!objects.has(path))return {status:400,body:null};return {status:200,body:objects.get(path)!};
  }),
  handle:(actor:typeof fixture.actors[0]['actor'],method:string,url:string,body:unknown)=>serial(()=>asRelay<unknown>(db,actor,()=>{
   const u=new URL(url);if(u.searchParams.get('mode')==='token')return Promise.resolve({url:storageUrl,apikey:'local-harness',token:'local-'+actor.userId,expiresAt:new Date(Date.now()+3600_000).toISOString()});
   return method==='POST'?relayPost(db,actor,body):u.searchParams.get('mode')==='directory'?relayDirectory(db,actor):u.searchParams.get('mode')==='packs'?relayPackPage(db,actor,u.searchParams.get('pack')??'',u.searchParams.get('after')??'0'):relayPage(db,actor,u.searchParams.get('after')??'0',u.searchParams.get('epochAfter')??'0');
  })),
 };
}
