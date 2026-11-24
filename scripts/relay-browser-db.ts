// Local browser harness only: production UI + worker + production store/RLS,
// with PGlite transport interception. Authenticated CI uses real HTTP/Supabase.
import {testDatabase} from '../tests/helpers/database';
import {relayFixture,asRelay} from '../tests/helpers/relay-fixtures';
import {relayPost,relayDirectory,relayPage,relayPackPage} from '../lib/relay/store';
export async function localRelayDatabase(){
 const db=await testDatabase(),fixture=await relayFixture(db);
 let tail:Promise<unknown>=Promise.resolve();
 const serial=<T>(fn:()=>Promise<T>)=>{const p=tail.then(fn);tail=p.catch(()=>undefined);return p;};
 return {actors:fixture.actors.map(v=>({...v.actor,email:v.actor.userId+'@example.invalid'})),
  query:(sql:string,args?:unknown[])=>serial(()=>db.query(sql,args)),close:()=>db.close(),
  handle:(actor:typeof fixture.actors[0]['actor'],method:string,url:string,body:unknown)=>serial(()=>asRelay<unknown>(db,actor,()=>{
   const u=new URL(url);return method==='POST'?relayPost(db,actor,body):u.searchParams.get('mode')==='directory'?relayDirectory(db,actor):u.searchParams.get('mode')==='packs'?relayPackPage(db,actor,u.searchParams.get('pack')??'',u.searchParams.get('after')??'0'):relayPage(db,actor,u.searchParams.get('after')??'0',u.searchParams.get('epochAfter')??'0');
  })),
 };
}
