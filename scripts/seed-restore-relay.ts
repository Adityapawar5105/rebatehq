import {generateIdentity,newEpoch,encryptEvent,unbase64} from '../lib/relay/crypto';
import {ZERO_HASH} from '../lib/relay/protocol';
import type {PoolClient} from 'pg';
// Disposable synthetic restore evidence only. Private material is never stored
// in Postgres or printed; real application keys are generated in the worker.
export async function seedRestoreRelay(db:Pick<PoolClient,'query'>,tenant:string,user:string,device:string){
 const identity=await generateIdentity(tenant,user,device),d=identity.device;
 await db.query('INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::bytea,$5::bytea,$6::bytea,$7::timestamptz)',[device,tenant,user,unbase64(d.ecdh),unbase64(d.signing),unbase64(d.signature),d.createdAt]);
 const {epoch:e,key}=await newEpoch(identity,[{...d,role:'owner'}],null,{sequence:'0',hash:ZERO_HASH});
 const hex=(h:string)=>Uint8Array.from(h.match(/../g)!,b=>parseInt(b,16));
 await db.query('INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at) VALUES($1::uuid,$2::uuid,$3::bigint,$4::bytea,$5::bigint,$6::bytea,$7::uuid,$8::uuid,$9::uuid[],$10::text[],$11::bytea,$12::bytea,$13::timestamptz)',[e.id,tenant,e.number,hex(e.previousHash),e.baseSequence,hex(e.baseHash),user,device,[device],['owner'],unbase64(e.signature),hex(e.hash),e.createdAt]);
 for(const w of e.members)await db.query('INSERT INTO public.relay_key_wrap(id,tenant_id,epoch_id,recipient_device,ephemeral_public,iv,ciphertext) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6::bytea,$7::bytea)',[w.id,tenant,e.id,device,unbase64(w.ephemeral),unbase64(w.iv),unbase64(w.wrappedKey)]);
 const v=await encryptEvent(identity,e,key,{sequence:'0',hash:ZERO_HASH},crypto.randomUUID(),'rebate',{kind:'share',subject:{objectKind:'rebate',title:'Synthetic restore relay sentinel',reference:'synthetic-restore-only',amountMinor:'123456789012345678',currency:'USD',preset:'standard'}});
 await db.query('INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bytea,$6::uuid,$7::uuid,$8::uuid,$9::text,$10::uuid[],$11::uuid[],$12::bytea,$13::bytea,$14::integer,$15::bytea,$16::bytea,$17::timestamptz)',[v.id,tenant,e.id,v.sequence,hex(v.previousHash),user,device,v.objectId,v.objectKind,v.recipients,v.mentions,unbase64(v.iv),unbase64(v.ciphertext),unbase64(v.ciphertext).length,unbase64(v.signature),hex(v.hash),v.createdAt]);
 return {epoch:e.id,event:v.id,hash:v.hash};
}
