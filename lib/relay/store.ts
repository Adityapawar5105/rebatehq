// Server boundary: public verification and opaque records only. No workspace or
// private device key is accepted here; business content is never decrypted.
import type { PoolClient } from 'pg';
import { PostSchema,RelayError,RELAY_LIMITS,ZERO_HASH,type Device,type DirectoryDevice,type Epoch,type RelayEvent,type Directory,type Page,type Post } from './protocol';
import { base64,unbase64,verifyDevice,verifyEpoch,verifyEvent,fingerprint,epochBody,deviceBody } from './crypto';
export type RelayDb=Pick<PoolClient,'query'>;
export type RelayActor={tenantId:string;userId:string;deviceId:string};
const blob=(s:string)=>unbase64(s);
const hashBytes=(s:string)=>Uint8Array.from(s.match(/../g)!,v=>parseInt(v,16));
const encoded=(v:Uint8Array)=>base64(new Uint8Array(v));
const hex=(v:Uint8Array)=>Buffer.from(v).toString('hex');
const iso=(v:Date|string)=>new Date(v).toISOString();
type Row=Record<string,any>;
export async function authorizeRelay(db:RelayDb,actor:RelayActor,administrator=false){
 const allowed=await db.query('SELECT public.relay_allowed($1::uuid,$2::boolean) AS allowed',[actor.tenantId,administrator]);
 if(!allowed.rows[0]?.allowed)throw new RelayError('ACCESS','Sharing requires an active Professional or Scale seat in this workspace.');
 const device=await db.query("SELECT 1 FROM public.licence_device WHERE tenant_id=$1::uuid AND id=$2::uuid AND user_id=$3::uuid AND status='active'",[actor.tenantId,actor.deviceId,actor.userId]);
 if(!device.rowCount)throw new RelayError('ACCESS','Ask your workspace owner to approve this device before sharing.');
}
export const lockRelay=(db:RelayDb,tenant:string)=>db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,7142))',[tenant]);
const deviceFrom=(r:Row,tenant:string):Device=>({v:'1',tenantId:tenant,userId:String(r.user_id),deviceId:String(r.id??r.device_id),ecdh:encoded(r.agreement_public),signing:encoded(r.signing_public),signature:encoded(r.possession_proof),createdAt:iso(r.signed_at)});
export async function relayDevices(db:RelayDb,tenant:string):Promise<DirectoryDevice[]>{
 const rows=await db.query('SELECT * FROM public.relay_directory($1::uuid)',[tenant]);
 return rows.rows.map(r=>({...deviceFrom(r,tenant),role:r.member_role,label:r.email}));
}
export async function relayHead(db:RelayDb,tenant:string){const rows=await db.query('SELECT sequence::text AS sequence,content_hash FROM public.relay_event WHERE tenant_id=$1::uuid ORDER BY sequence DESC LIMIT 1',[tenant]);return rows.rows.length?{sequence:rows.rows[0].sequence,hash:hex(rows.rows[0].content_hash)}:{sequence:'0',hash:ZERO_HASH};}
export async function relayEpochs(db:RelayDb,tenant:string,query:{latest?:boolean;id?:string;after?:string}={}):Promise<Epoch[]>{
 const rows=await db.query(`SELECT * FROM public.relay_epoch WHERE tenant_id=$1::uuid AND ($2::uuid IS NULL OR id=$2::uuid) AND ($3::bigint IS NULL OR epoch_number>$3::bigint) ORDER BY epoch_number ${query.latest?'DESC':'ASC'} LIMIT ${query.latest||query.id?'1':'8'}`,[tenant,query.id??null,query.after??null]);
 if(!rows.rows.length)return [];
 const wraps=await db.query('SELECT w.*,k.user_id,k.agreement_public,k.signing_public FROM public.relay_key_wrap w JOIN public.relay_device_key k ON k.tenant_id=w.tenant_id AND k.id=w.recipient_device WHERE w.tenant_id=$1::uuid AND w.epoch_id=ANY($2::uuid[])',[tenant,rows.rows.map(r=>r.id)]);
 return rows.rows.map(e=>{
  const members=(e.device_ids as string[]).map((deviceId,index)=>{
   const w=wraps.rows.find(w=>w.epoch_id===e.id&&w.recipient_device===deviceId);if(!w)throw new RelayError('VERIFY','Shared key publication is incomplete. Ask an administrator to check this workspace.');
   return {id:w.id,deviceId,userId:w.user_id,role:e.member_roles[index],ecdh:encoded(w.agreement_public),signing:encoded(w.signing_public),ephemeral:encoded(w.ephemeral_public),iv:encoded(w.iv),wrappedKey:encoded(w.ciphertext)};
  });
  return {v:'1',id:e.id,tenantId:tenant,number:String(e.epoch_number),previousHash:hex(e.previous_hash),baseSequence:String(e.base_sequence),baseHash:hex(e.base_hash),signerUser:e.signer_user,signerDevice:e.signer_device,createdAt:iso(e.signed_at),members,signature:encoded(e.signature),hash:hex(e.content_hash)};
 });
}
function eventFrom(r:Row):RelayEvent{return {v:'1',id:r.id,tenantId:r.tenant_id,epochId:r.epoch_id,sequence:String(r.sequence),previousHash:hex(r.previous_hash),senderUser:r.sender_user,senderDevice:r.sender_device,objectId:r.object_id,objectKind:r.object_kind,recipients:r.recipient_ids,mentions:r.mention_ids,createdAt:iso(r.signed_at),iv:encoded(r.iv),ciphertext:encoded(r.ciphertext),signature:encoded(r.signature),hash:hex(r.content_hash)};}
export async function relayDirectory(db:RelayDb,actor:RelayActor):Promise<Directory>{await authorizeRelay(db,actor);await lockRelay(db,actor.tenantId);const [devices,epochs,head]=await Promise.all([relayDevices(db,actor.tenantId),relayEpochs(db,actor.tenantId,{latest:true}),relayHead(db,actor.tenantId)]);return {devices,latest:epochs[0]??null,head};}
export async function relayPage(db:RelayDb,actor:RelayActor,after:string,epochAfter:string):Promise<Page>{
 await authorizeRelay(db,actor);await lockRelay(db,actor.tenantId);
 const epochs=await relayEpochs(db,actor.tenantId,{after:epochAfter}),head=await relayHead(db,actor.tenantId);
 const result=await db.query('SELECT * FROM public.relay_event WHERE tenant_id=$1::uuid AND sequence>$2::bigint ORDER BY sequence LIMIT $3::integer',[actor.tenantId,after,RELAY_LIMITS.page]);
 const latest=await db.query("SELECT COALESCE(max(epoch_number),0)::text AS n FROM public.relay_epoch WHERE tenant_id=$1::uuid",[actor.tenantId]);
 return {epochs,events:result.rows.map(eventFrom),latestEpoch:latest.rows[0].n,head};
}
export async function relayPost(db:RelayDb,actor:RelayActor,input:unknown):Promise<{ok:true;id:string}>{
 const parsed=PostSchema.safeParse(input);if(!parsed.success)throw new RelayError('REQUEST','The sharing request has an invalid format. No content was logged.');
 const p:Post=parsed.data;await authorizeRelay(db,actor,p.action==='epoch');await lockRelay(db,actor.tenantId);
 if(p.action==='register'){
  const d=await verifyDevice(p.device);
  if(d.tenantId!==actor.tenantId||d.userId!==actor.userId||d.deviceId!==actor.deviceId)throw new RelayError('ACCESS','The sharing key belongs to another identity.');
  const found=await db.query('SELECT * FROM public.relay_device_key WHERE tenant_id=$1::uuid AND id=$2::uuid',[actor.tenantId,actor.deviceId]);
  if(found.rows.length){const old=deviceFrom(found.rows[0],actor.tenantId);if(JSON.stringify([deviceBody(old),old.signature])!==JSON.stringify([deviceBody(d),d.signature]))throw new RelayError('DEVICE','This device has different sharing keys. Enrol a new approved device instead.');return {ok:true,id:d.deviceId};}
  await db.query('INSERT INTO public.relay_device_key(id,tenant_id,user_id,agreement_public,signing_public,possession_proof,signed_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::bytea,$5::bytea,$6::bytea,$7::timestamptz)',[d.deviceId,d.tenantId,d.userId,blob(d.ecdh),blob(d.signing),blob(d.signature),d.createdAt]);
  return {ok:true,id:d.deviceId};
 }
 if(p.action==='epoch'){
  const e=p.epoch;
  if(e.tenantId!==actor.tenantId||e.signerUser!==actor.userId||e.signerDevice!==actor.deviceId)throw new RelayError('ACCESS','The shared key publication belongs to another identity.');
  const existing=(await relayEpochs(db,actor.tenantId,{id:e.id}))[0];
  if(existing){if(JSON.stringify(epochBody(existing))!==JSON.stringify(epochBody(e))||existing.signature!==e.signature||existing.hash!==e.hash)throw new RelayError('CONFLICT','The sharing identifier already contains a different record.');return {ok:true,id:e.id};}
  const directory=await relayDevices(db,actor.tenantId);
  if(e.members.length!==directory.length||e.members.some((m,i)=>{const d=directory[i];return !d||m.deviceId!==d.deviceId||m.userId!==d.userId||m.role!==d.role||m.ecdh!==d.ecdh||m.signing!==d.signing;}))throw new RelayError('ROTATE','The device list changed. Verify fingerprints and rotate again.');
  const previous=(await relayEpochs(db,actor.tenantId,{latest:true}))[0]??null,signer=directory.find(d=>d.deviceId===actor.deviceId);
  if(!signer)throw new RelayError('ACCESS','Register this sharing device first.');
  await verifyEpoch(e,previous,await fingerprint(signer));
  await db.query('INSERT INTO public.relay_epoch(id,tenant_id,epoch_number,previous_hash,base_sequence,base_hash,signer_user,signer_device,device_ids,member_roles,signature,content_hash,signed_at) VALUES($1::uuid,$2::uuid,$3::bigint,$4::bytea,$5::bigint,$6::bytea,$7::uuid,$8::uuid,$9::uuid[],$10::text[],$11::bytea,$12::bytea,$13::timestamptz)',[e.id,e.tenantId,e.number,hashBytes(e.previousHash),e.baseSequence,hashBytes(e.baseHash),e.signerUser,e.signerDevice,e.members.map(m=>m.deviceId),e.members.map(m=>m.role),blob(e.signature),hashBytes(e.hash),e.createdAt]);
  for(const m of e.members)await db.query('INSERT INTO public.relay_key_wrap(id,tenant_id,epoch_id,recipient_device,ephemeral_public,iv,ciphertext) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6::bytea,$7::bytea)',[m.id,e.tenantId,e.id,m.deviceId,blob(m.ephemeral),blob(m.iv),blob(m.wrappedKey)]);
  return {ok:true,id:e.id};
 }
 const e=p.event;
 if(e.tenantId!==actor.tenantId||e.senderUser!==actor.userId||e.senderDevice!==actor.deviceId)throw new RelayError('ACCESS','The shared item belongs to another identity.');
 const found=await db.query('SELECT * FROM public.relay_event WHERE tenant_id=$1::uuid AND id=$2::uuid',[actor.tenantId,e.id]);
 if(found.rows.length){if(JSON.stringify(eventFrom(found.rows[0]))!==JSON.stringify(e))throw new RelayError('CONFLICT','The sharing identifier already contains a different record.');return {ok:true,id:e.id};}
 const latest=(await relayEpochs(db,actor.tenantId,{latest:true}))[0];if(!latest||latest.id!==e.epochId)throw new RelayError('ROTATE','Sync the new workspace key before sharing.');
 await verifyEvent(e,latest,await relayHead(db,actor.tenantId));
 await db.query('INSERT INTO public.relay_event(id,tenant_id,epoch_id,sequence,previous_hash,sender_user,sender_device,object_id,object_kind,recipient_ids,mention_ids,iv,ciphertext,ciphertext_bytes,signature,content_hash,signed_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::bytea,$6::uuid,$7::uuid,$8::uuid,$9::text,$10::uuid[],$11::uuid[],$12::bytea,$13::bytea,$14::integer,$15::bytea,$16::bytea,$17::timestamptz)',[e.id,e.tenantId,e.epochId,e.sequence,hashBytes(e.previousHash),e.senderUser,e.senderDevice,e.objectId,e.objectKind,e.recipients,e.mentions,blob(e.iv),blob(e.ciphertext),unbase64(e.ciphertext).length,blob(e.signature),hashBytes(e.hash),e.createdAt]);
 return {ok:true,id:e.id};
}
