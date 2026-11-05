import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './helpers/database';
import {relayFixture,asRelay} from './helpers/relay-fixtures';
import {relayPost,relayDirectory,relayPage} from '../lib/relay/store';
import {newEpoch,encryptEvent,decryptEvent,unwrapEpoch,verifyEvent} from '../lib/relay/crypto';
import {ZERO_HASH} from '../lib/relay/protocol';
test('relay migration and all store SQL run in PGlite: real encrypted exchange, idempotency, isolation, tier/removal gates and metadata-only audit',async()=>{
 const db=await testDatabase();
 try{
  const {tenantId,actors}=await relayFixture(db),[owner,manager,rep]=actors,other=await relayFixture(db);
  for(const a of actors)await asRelay(db,a.actor,()=>relayPost(db,a.actor,{action:'register',device:a.identity.device}));
  await asRelay(db,owner.actor,()=>relayPost(db,owner.actor,{action:'register',device:owner.identity.device}));
  const dir=await asRelay(db,owner.actor,()=>relayDirectory(db,owner.actor));assert.equal(dir.devices.length,3);
  const {epoch,key}=await newEpoch(owner.identity,dir.devices,null,dir.head);
  await asRelay(db,owner.actor,()=>relayPost(db,owner.actor,{action:'epoch',epoch}));
  await asRelay(db,owner.actor,()=>relayPost(db,owner.actor,{action:'epoch',epoch}));
  const objectId=crypto.randomUUID(),content={kind:'share' as const,subject:{objectKind:'quote' as const,title:'RELAY-PRIVATE-MARKER',reference:'PRIVATE-QUOTE',amountMinor:'987654321098765432',currency:'USD',preset:'standard' as const}};
  const event=await encryptEvent(rep.identity,epoch,key,{sequence:'0',hash:ZERO_HASH},objectId,'quote',content);
  await asRelay(db,rep.actor,()=>relayPost(db,rep.actor,{action:'event',event}));
  await asRelay(db,rep.actor,()=>relayPost(db,rep.actor,{action:'event',event}));
  const page=await asRelay(db,manager.actor,()=>relayPage(db,manager.actor,'0','0'));
  assert.equal(page.events.length,1);await verifyEvent(page.events[0],page.epochs[0],{sequence:'0',hash:ZERO_HASH});assert.deepEqual(await decryptEvent(page.events[0],await unwrapEpoch(manager.identity,page.epochs[0])),content);
  assert.equal((await asRelay(db,manager.actor,()=>relayPage(db,manager.actor,'1','1'))).events.length,0);
  const inaccessible=await asRelay<{rows:unknown[]}>(db,other.actors[0].actor,()=>db.query('SELECT * FROM public.relay_event WHERE tenant_id=$1::uuid',[tenantId]));assert.equal(inaccessible.rows.length,0);
  const audit=await db.query("SELECT before,after FROM public.audit_log WHERE entity_type LIKE 'relay_%' AND tenant_id=$1::uuid",[tenantId]);assert.ok(audit.rows.length>=8);
  for(const row of audit.rows){assert.equal(row.before,null);assert.deepEqual(Object.keys(row.after).sort(),['id','tenant_id']);}
  for(const t of ['relay_device_key','relay_epoch','relay_key_wrap','relay_event']){
   const result=await db.query('SELECT * FROM public.'+t+' WHERE tenant_id=$1::uuid',[tenantId]);assert.ok(result.rows.length>0);
   assert.ok(!JSON.stringify(result.rows).includes('RELAY-PRIVATE-MARKER'));assert.ok(!JSON.stringify(result.rows).includes('987654321098765432'));
  }
  await db.query("UPDATE public.membership SET status='suspended' WHERE tenant_id=$1::uuid AND user_id=$2::uuid",[tenantId,rep.actor.userId]);
  await assert.rejects(asRelay(db,rep.actor,()=>relayDirectory(db,rep.actor)),/Professional or Scale/);
  const freshDir=await asRelay(db,owner.actor,()=>relayDirectory(db,owner.actor));assert.equal(freshDir.devices.length,2);
  const rotated=await newEpoch(owner.identity,freshDir.devices,epoch,freshDir.head);await asRelay(db,owner.actor,()=>relayPost(db,owner.actor,{action:'epoch',epoch:rotated.epoch}));
  await assert.rejects(unwrapEpoch(rep.identity,rotated.epoch));
  await db.query("UPDATE public.workspace_licence SET tier='starter' WHERE tenant_id=$1::uuid",[tenantId]);
  await assert.rejects(asRelay(db,owner.actor,()=>relayDirectory(db,owner.actor)),/Professional or Scale/);
 }finally{await db.close();}
});
