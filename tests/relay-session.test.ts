import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './helpers/database';
import {relayFixture,asRelay} from './helpers/relay-fixtures';
import {relayPost,relayPage,relayDirectory} from '../lib/relay/store';
import {RelaySession,emptyRelay,type RelayState} from '../lib/relay/session';
import {fingerprint} from '../lib/relay/crypto';
import {RelayError,type Post} from '../lib/relay/protocol';
import {encryptEvent,base64,unbase64} from '../lib/relay/crypto';
test('worker session performs share/request/two approvals/comment, retains encrypted outbox across lost ack and rotates after removal',async()=>{
 const db=await testDatabase();
 try{
  const fixture=await relayFixture(db),[a,b,c]=fixture.actors,network:string[]=[],saved=new Map<string,RelayState>();let loseAck=false;
  const client=(person:typeof a)=>new RelaySession(person.actor,structuredClone(saved.get(person.actor.deviceId)??emptyRelay()),{
   directory:()=>asRelay(db,person.actor,()=>relayDirectory(db,person.actor)),
   page:(after,epoch)=>asRelay(db,person.actor,()=>relayPage(db,person.actor,after,epoch)),
   async post(value:Post){network.push(JSON.stringify(value));await asRelay(db,person.actor,()=>relayPost(db,person.actor,value));if(loseAck&&value.action==='event'){loseAck=false;throw new RelayError('NETWORK','synthetic lost acknowledgement');}},
  },async(value)=>{saved.set(person.actor.deviceId,structuredClone(value));},new AbortController().signal);
  await client(a).register();await client(b).register();await client(c).register();
  const initial=await client(a).view(),confirmations=initial.devices.map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}));
  await assert.rejects(client(a).rotate([]),/every device/);
  const root=await client(a).rotate(confirmations),pin=root.fingerprint;
  await assert.rejects(client(b).join('a'.repeat(64)),/fingerprint/);
  await client(b).join(pin);await client(c).join(pin);
  let view=await client(c).share({objectKind:'quote',title:'RELAY-PRIVATE-SUBJECT-UNIQUE',reference:'PRIVATE-REFERENCE-UNIQUE',amountMinor:'987654321098765432',currency:'USD',preset:'standard'});
  const id=view.objects[0].id;
  await client(c).request(id,[a.actor.userId,b.actor.userId]);
  await assert.rejects(client(c).decide(id,'approve'),/invalid shared operation/);
  await assert.rejects(client(b).decide(id,'approve'),/invalid shared operation/);
  view=await client(a).decide(id,'approve');assert.equal(view.objects[0].approval!.status,'pending');
  view=await client(b).decide(id,'approve');assert.equal(view.objects[0].approval!.status,'approved');
  await client(c).comment(id,'@Owner RELAY-PRIVATE-COMMENT-UNIQUE',[a.actor.userId]);
  view=await client(a).sync();assert.equal(view.objects[0].comments[0].text,'@Owner RELAY-PRIVATE-COMMENT-UNIQUE');
  loseAck=true;await assert.rejects(client(c).comment(id,'RELAY-PRIVATE-LOST-ACK-UNIQUE',[]),/lost acknowledgement/);
  assert.ok(saved.get(c.actor.deviceId)!.pending);
  const before=(await db.query('SELECT count(*)::integer AS n FROM public.relay_event')).rows[0].n;
  view=await client(c).sync();assert.equal(view.pending,false);assert.equal(view.objects[0].comments.length,2);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.relay_event')).rows[0].n,before);
  for(const marker of ['RELAY-PRIVATE-SUBJECT-UNIQUE','PRIVATE-REFERENCE-UNIQUE','987654321098765432','RELAY-PRIVATE-COMMENT-UNIQUE','RELAY-PRIVATE-LOST-ACK-UNIQUE'])assert.ok(network.every(body=>!body.includes(marker)));
  await db.query("UPDATE public.membership SET status='suspended' WHERE tenant_id=$1::uuid AND user_id=$2::uuid",[fixture.tenantId,c.actor.userId]);
  await assert.rejects(client(c).sync(),/Professional or Scale/);
  await assert.rejects(client(a).share({objectKind:'rebate',title:'fresh',reference:'rebate-ref',amountMinor:'1',currency:'USD',preset:'standard'}),/rotate/);
  const changed=await client(a).view();await client(a).rotate(changed.devices.map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint})));
  view=await client(a).share({objectKind:'rebate',title:'fresh',reference:'rebate-ref',amountMinor:'1',currency:'USD',preset:'standard'});assert.equal(view.head.epoch,'2');
  assert.ok((await client(b).sync()).objects.some(o=>o.subject.reference==='rebate-ref'));
 }finally{await db.close();}
});

test('relay saves before network, recovers a lost key-publication ack, quarantines authentic bad ciphertext, rejects bad signatures and retains a competing outbox',async()=>{
 const db=await testDatabase();
 try{
  const {actors}=await relayFixture(db),[a,b]=actors,saved=new Map<string,RelayState>();let posts=0,saveFailure=true,loseEpoch=false,dropEvent=false,tamper=false;
  const client=(p:typeof a)=>new RelaySession(p.actor,structuredClone(saved.get(p.actor.deviceId)??emptyRelay()),{
   directory:()=>asRelay(db,p.actor,()=>relayDirectory(db,p.actor)),
   async page(after,epoch){const page=await asRelay(db,p.actor,()=>relayPage(db,p.actor,after,epoch));if(tamper&&page.events.length){const bytes=unbase64(page.events[0].signature);bytes[0]^=1;page.events[0].signature=base64(bytes);}return page;},
   async post(v){posts++;if(dropEvent&&v.action==='event'){dropEvent=false;throw new RelayError('NETWORK','offline before send');}await asRelay(db,p.actor,()=>relayPost(db,p.actor,v));if(loseEpoch&&v.action==='epoch'){loseEpoch=false;throw new RelayError('NETWORK','lost key ack');}},
  },async value=>{if(saveFailure)throw new Error('injected snapshot failure');saved.set(p.actor.deviceId,structuredClone(value));},new AbortController().signal);
  await assert.rejects(client(a).register(),/snapshot failure/);assert.equal(posts,0);assert.equal(saved.size,0);
  saveFailure=false;await client(a).register();await client(b).register();const view=await client(a).view();loseEpoch=true;
  await assert.rejects(client(a).rotate(view.devices.map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))),/lost key ack/);assert.ok(saved.get(a.actor.deviceId)!.pendingEpoch);
  const joined=await client(a).sync();assert.equal(joined.joined,true);assert.equal(joined.pending,false);await client(b).join(joined.fingerprint);
  const state=saved.get(a.actor.deviceId)!,epoch=state.epochs[0].epoch;
  const bad=await encryptEvent(state.identity!,epoch,base64(crypto.getRandomValues(new Uint8Array(32))),state.head,crypto.randomUUID(),'quote',{kind:'comment',text:'authentic but undecryptable'});
  await asRelay(db,a.actor,()=>relayPost(db,a.actor,{action:'event',event:bad}));
  let result=await client(a).sync();assert.equal(result.rejected.length,1);assert.equal(result.objects.length,0);assert.equal(result.head.hash,bad.hash);
  await client(b).share({objectKind:'quote',title:'valid after quarantined record',reference:'valid',amountMinor:'1',currency:'USD',preset:'standard'});
  const prior=structuredClone(saved.get(a.actor.deviceId));tamper=true;await assert.rejects(client(a).sync(),/verified/);assert.deepEqual(saved.get(a.actor.deviceId),prior);tamper=false;
  result=await client(a).sync();assert.equal(result.objects.length,1);
  dropEvent=true;await assert.rejects(client(a).comment(result.objects[0].id,'pending while offline',[]),/offline/);const pending=structuredClone(saved.get(a.actor.deviceId)!.pending);assert.ok(pending);
  await client(b).comment(result.objects[0].id,'competing append',[]);const count=(await db.query('SELECT count(*)::integer AS n FROM public.relay_event')).rows[0].n;
  await assert.rejects(client(a).retry());assert.deepEqual(saved.get(a.actor.deviceId)!.pending,pending);assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.relay_event')).rows[0].n,count);
 }finally{await db.close();}
});
