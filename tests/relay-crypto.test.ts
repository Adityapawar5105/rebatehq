import test from 'node:test';
import assert from 'node:assert/strict';
import { generateIdentity,verifyDevice,newEpoch,verifyEpoch,unwrapEpoch,encryptEvent,verifyEvent,decryptEvent,fingerprint,unbase64,base64 } from '../lib/relay/crypto';
import { ZERO_HASH,levelsFor,type RelayEvent,type Epoch } from '../lib/relay/protocol';
const scope=()=>crypto.randomUUID();
async function setup(){const tenant=scope(),a=await generateIdentity(tenant,scope(),scope()),b=await generateIdentity(tenant,scope(),scope()),c=await generateIdentity(tenant,scope(),scope());
 const roster=[{...a.device,role:'owner' as const},{...b.device,role:'manager' as const},{...c.device,role:'rep' as const}];const head={sequence:'0',hash:ZERO_HASH},created=await newEpoch(a,roster,null,head);
 return {a,b,c,roster,head,...created};}
test('relay device proof, independently wrapped keys and encrypted content round-trip without sharing a passphrase',async()=>{
 const {a,b,head,epoch,key}=await setup();assert.deepEqual(await verifyDevice(a.device),a.device);
 assert.equal((await verifyEpoch(epoch,null,await fingerprint(a.device))).hash,epoch.hash);
 assert.equal(await unwrapEpoch(a,epoch),key);assert.equal(await unwrapEpoch(b,epoch),key);
 const content={kind:'share' as const,subject:{objectKind:'quote' as const,title:'PRIVATE-CUSTOMER',reference:'PRIVATE-QUOTE',amountMinor:'987654321',currency:'USD',preset:'standard' as const}};
 const event=await encryptEvent(a,epoch,key,head,scope(),'quote',content,[b.device.userId]);
 await verifyEvent(event,epoch,head);assert.deepEqual(await decryptEvent(event,await unwrapEpoch(b,epoch)),content);
 for(const marker of ['PRIVATE-CUSTOMER','PRIVATE-QUOTE','987654321'])assert.ok(!JSON.stringify(event).includes(marker));
});
test('relay fails closed for tampered device, wrap, epoch signature, metadata, ciphertext, wrong key and scope',async()=>{
 const {a,b,head,epoch,key}=await setup();const flip=(s:string)=>{const bytes=unbase64(s);bytes[bytes.length-1]^=1;return base64(bytes);};
 await assert.rejects(verifyDevice({...a.device,ecdh:b.device.ecdh}));
 await assert.rejects(verifyEpoch(epoch,null,'a'.repeat(64)));
 const changed=structuredClone(epoch),wrap=changed.members.find(m=>m.deviceId===b.device.deviceId)!;wrap.wrappedKey=flip(wrap.wrappedKey);
 await assert.rejects(verifyEpoch(changed,null,await fingerprint(a.device)));await assert.rejects(unwrapEpoch(b,changed));
 await assert.rejects(unwrapEpoch({...a,device:{...a.device,tenantId:scope()}},epoch));
 const event=await encryptEvent(a,epoch,key,head,scope(),'quote',{kind:'comment',text:'private'});
 for(const e of [{...event,ciphertext:flip(event.ciphertext)},{...event,objectId:scope()},{...event,tenantId:scope()},{...event,signature:flip(event.signature)}])await assert.rejects(verifyEvent(e,epoch,head));
 await assert.rejects(decryptEvent(event,base64(crypto.getRandomValues(new Uint8Array(32)))));
 // ECDSA (r,n-s) is otherwise valid but must not create a second hash-chain head.
 const signature=unbase64(event.signature),n=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
 const low=BigInt('0x'+Array.from(signature.subarray(32),b=>b.toString(16).padStart(2,'0')).join(''));
 const high=(n-low).toString(16).padStart(64,'0');signature.set(Uint8Array.from(high.match(/../g)!,v=>parseInt(v,16)),32);
 await assert.rejects(verifyEvent({...event,signature:base64(signature)},epoch,head));
});
test('replay, reordering and untrusted rotation fail; removed device cannot decrypt a new epoch',async()=>{
 const {a,b,c,roster,head,epoch,key}=await setup(),first=await encryptEvent(a,epoch,key,head,scope(),'rebate',{kind:'comment',text:'first'});
 const next={sequence:first.sequence,hash:first.hash},second=await encryptEvent(b,epoch,key,next,first.objectId,'rebate',{kind:'comment',text:'second'});
 await verifyEvent(first,epoch,head);await verifyEvent(second,epoch,next);
 await assert.rejects(verifyEvent(first,epoch,next));await assert.rejects(verifyEvent(second,epoch,head));
 const rotated=await newEpoch(a,roster.filter(d=>d.deviceId!==c.device.deviceId),epoch,{sequence:second.sequence,hash:second.hash});
 await verifyEpoch(rotated.epoch,epoch);assert.notEqual(rotated.key,key);
 await assert.rejects(unwrapEpoch(c,rotated.epoch));assert.equal(await unwrapEpoch(b,rotated.epoch),rotated.key);
 const fresh=await encryptEvent(a,rotated.epoch,rotated.key,{sequence:second.sequence,hash:second.hash},first.objectId,'rebate',{kind:'comment',text:'after removal'});
 await assert.rejects(decryptEvent(fresh,key));
 const forged=await newEpoch(c,roster,epoch,next);await assert.rejects(verifyEpoch(forged.epoch,epoch));
});
test('thresholds use integer minor units, with exact boundary and at most two levels',()=>{
 assert.equal(levelsFor('500000','standard'),1);assert.equal(levelsFor('500001','standard'),2);assert.equal(levelsFor('0','conservative'),2);
 assert.equal(levelsFor('999999999999999999','standard'),2);assert.throws(()=>levelsFor('1.01','standard'));
});
