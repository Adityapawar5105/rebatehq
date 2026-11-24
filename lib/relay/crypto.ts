import { DeviceSchema,EpochSchema,EventSchema,ContentSchema,PackVersionSchema,ManifestSchema,RelayError,ZERO_HASH,admin,fail,type Device,type DirectoryDevice,type Epoch,type EpochV2,type Grid,type PackWrap,type PackVersion,type Manifest,type Wrap,type RelayEvent,type Content } from './protocol';
import { ALL_PACKS, COST_PACKS, costRole, packsFor, publisherRole, type AnyPack } from '../sharing/catalog';
import { msg } from "../i18n/core";
const enc=new TextEncoder();
const bytes=(v:Uint8Array)=>new Uint8Array(v).buffer;
export const base64=(v:Uint8Array)=>{let s='';for(const b of v)s+=String.fromCharCode(b);return btoa(s);};
export const unbase64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
export const canonical=(v:unknown)=>enc.encode(JSON.stringify(v));
export async function sha(v:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(canonical(v)))),b=>b.toString(16).padStart(2,'0')).join('');}
export const fingerprint=(d:Pick<Device,'ecdh'|'signing'>)=>sha(['rehq.relay.device.v1',d.ecdh,d.signing]);
export type Identity={device:Device;ecdhPrivate:JsonWebKey;signingPrivate:JsonWebKey};
const point=(key:CryptoKey)=>crypto.subtle.exportKey('raw',key).then(b=>base64(new Uint8Array(b)));
const importPoint=(raw:string,algorithm:'ECDH'|'ECDSA')=>crypto.subtle.importKey('raw',bytes(unbase64(raw)),{name:algorithm,namedCurve:'P-256'},false,algorithm==='ECDSA'?['verify']:[]);
const privateKey=(jwk:JsonWebKey,algorithm:'ECDH'|'ECDSA')=>crypto.subtle.importKey('jwk',jwk,{name:algorithm,namedCurve:'P-256'},false,algorithm==='ECDSA'?['sign']:['deriveBits']);
const N=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
function integer(v:Uint8Array){return BigInt('0x'+Array.from(v,b=>b.toString(16).padStart(2,'0')).join(''));}
function normalized(sig:Uint8Array){const out=new Uint8Array(sig),s=integer(out.subarray(32));if(s>N/BigInt(2)){const hex=(N-s).toString(16).padStart(64,'0');out.set(Uint8Array.from(hex.match(/../g)!,s=>parseInt(s,16)),32);}return out;}
/** Exported for tests that build deliberately invalid signed records; a private key is still required. */
export async function signValue(jwk:JsonWebKey,value:unknown){return sign(jwk,value);}
async function sign(jwk:JsonWebKey,value:unknown){return base64(normalized(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},await privateKey(jwk,'ECDSA'),bytes(canonical(value))))));}
export async function verifySignature(pointValue:string,value:unknown,signature:string){
 try{const s=unbase64(signature);if(s.length!==64||integer(s.subarray(0,32))<BigInt(1)||integer(s.subarray(0,32))>=N||integer(s.subarray(32))<BigInt(1)||integer(s.subarray(32))>N/BigInt(2))return false;
 return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await importPoint(pointValue,'ECDSA'),bytes(s),bytes(canonical(value)));}catch{return false;}
}
export const deviceBody=(d:Omit<Device,'signature'>|Device)=>['rehq.relay.registration.v1',d.v,d.tenantId,d.userId,d.deviceId,d.ecdh,d.signing,d.createdAt];
export async function generateIdentity(tenantId:string,userId:string,deviceId:string):Promise<Identity>{
 const agreement=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const ecdhPrivate=await crypto.subtle.exportKey('jwk',agreement.privateKey),signingPrivate=await crypto.subtle.exportKey('jwk',signing.privateKey);
 const d={v:'1' as const,tenantId,userId,deviceId,ecdh:await point(agreement.publicKey),signing:await point(signing.publicKey),createdAt:new Date().toISOString()};
 return {device:DeviceSchema.parse({...d,signature:await sign(signingPrivate,deviceBody(d))}),ecdhPrivate,signingPrivate};
}
export async function verifyDevice(value:unknown){const d=DeviceSchema.parse(value);await importPoint(d.ecdh,'ECDH');if(!await verifySignature(d.signing,deviceBody(d),d.signature))fail();return d;}
const wrapHeader=(tenant:string,epoch:string,sender:string,w:Wrap)=>['rehq.relay.wrap.v1',tenant,epoch,sender,w.id,w.deviceId,w.userId,w.role,w.ecdh,w.signing,w.ephemeral,w.iv];
async function hkdf(raw:Uint8Array,salt:Uint8Array,info:unknown){const key=await crypto.subtle.importKey('raw',bytes(raw),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(salt),info:bytes(canonical(info))},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const uuidBytes=(id:string)=>Uint8Array.from(id.replaceAll('-','').match(/../g)!,s=>parseInt(s,16));
async function wrappingKey(privateValue:CryptoKey,publicValue:string,epoch:string,header:unknown){const raw=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:await importPoint(publicValue,'ECDH')},privateValue,256));try{return await hkdf(raw,uuidBytes(epoch),header);}finally{raw.fill(0);}}
export const gridBody=(g:Grid)=>['rehq.relay.grid.v1',g.v,g.namedOwner,g.people.map(p=>[p.userId,p.role,p.extras]),g.ticks];
export const epochBody=(e:Epoch)=>{
 const base=['rehq.relay.epoch.v1',e.v,e.id,e.tenantId,e.number,e.previousHash,e.baseSequence,e.baseHash,e.signerUser,e.signerDevice,e.createdAt,e.members.map(w=>[w.id,w.deviceId,w.userId,w.role,w.ecdh,w.signing,w.ephemeral,w.iv,w.wrappedKey])];
 return e.v==='2'?[...base,gridBody(e.grid),e.packWraps.map(w=>[w.id,w.pack,w.deviceId,w.ephemeral,w.iv,w.wrappedKey])]:base;
};
/** The packs one person receives under a signed grid (none when they are not in it). */
export function personPacks(g:Grid,userId:string):AnyPack[]{const p=g.people.find(x=>x.userId===userId);return p?packsFor(p.role,g.namedOwner===userId,Object.fromEntries(g.ticks),p.extras):[];}
const gridPerson=(g:Grid,userId:string)=>g.people.find(x=>x.userId===userId);
export const gridPublisher=(g:Grid,userId:string)=>{const p=gridPerson(g,userId);return !!p&&publisherRole(p.role,g.namedOwner===userId);};
/** A grid that ticks a cost pack for a role (or person) without cost is refused outright, never silently trimmed (D18). */
export function checkGrid(g:Grid,members:{userId:string}[]){
 for(const [role,packs] of g.ticks)if(!costRole(role)&&packs.some(p=>COST_PACKS.includes(p)))fail();
 for(const p of g.people)if(!costRole(p.role)&&!publisherRole(p.role,g.namedOwner===p.userId)&&p.extras.some(x=>COST_PACKS.includes(x)))fail();
 if(g.namedOwner!==null&&!gridPerson(g,g.namedOwner))fail();
 if(!g.people.some(p=>p.role==='owner'))fail();
 for(const m of members)if(!gridPerson(g,m.userId))fail();
}
/** Which device gets which pack key, in canonical order: every pack, then every member device by ID. */
export function expectedPackWraps(g:Grid,members:{deviceId:string;userId:string}[]){
 const out:{pack:AnyPack;deviceId:string}[]=[];
 for(const pack of ALL_PACKS)for(const m of members)if(personPacks(g,m.userId).includes(pack))out.push({pack,deviceId:m.deviceId});
 return out;
}
const packWrapHeader=(tenant:string,epoch:string,sender:string,w:Omit<PackWrap,'wrappedKey'>,m:Wrap)=>['rehq.relay.packwrap.v1',tenant,epoch,sender,w.id,w.pack,w.deviceId,m.userId,m.ecdh,m.signing,w.ephemeral,w.iv];
/** A new key epoch. With a grid (team sharing S2) it is format 2: it also carries the signed grid and a fresh key per pack,
 *  wrapped only for the devices whose person is entitled to that pack. packKeys stay on this device. */
export async function newEpoch(identity:Identity,roster:DirectoryDevice[],previous:Epoch|null,head:{sequence:string;hash:string},grid?:Grid){
 const id=crypto.randomUUID(),key=crypto.getRandomValues(new Uint8Array(32)),members:Wrap[]=[],packKeys:Partial<Record<AnyPack,string>>={};
 try{for(const member of [...roster].sort((a,b)=>a.deviceId.localeCompare(b.deviceId))){
  const {role: _role,label: _label,...registration}=member;await verifyDevice(registration);
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const w:Wrap={id:crypto.randomUUID(),deviceId:member.deviceId,userId:member.userId,role:member.role,ecdh:member.ecdh,signing:member.signing,ephemeral:await point(ephemeral.publicKey),iv:base64(crypto.getRandomValues(new Uint8Array(12))),wrappedKey:''};
  const header=wrapHeader(identity.device.tenantId,id,identity.device.deviceId,w),k=await wrappingKey(ephemeral.privateKey,w.ecdh,id,header);
  w.wrappedKey=base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(key))));members.push(w);
 }
 const fields={id,tenantId:identity.device.tenantId,number:(BigInt(previous?.number??'0')+BigInt(1)).toString(),previousHash:previous?.hash??ZERO_HASH,baseSequence:head.sequence,baseHash:head.hash,signerUser:identity.device.userId,signerDevice:identity.device.deviceId,createdAt:new Date().toISOString(),members,signature:'',hash:''};
 let e:Epoch;
 if(grid){
  checkGrid(grid,members);const packWraps:PackWrap[]=[];
  for(const {pack,deviceId} of expectedPackWraps(grid,members)){
   const m=members.find(x=>x.deviceId===deviceId)!,raw=packKeys[pack]?unbase64(packKeys[pack]!):crypto.getRandomValues(new Uint8Array(32));
   try{packKeys[pack]??=base64(raw);
    const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
    const w={id:crypto.randomUUID(),pack,deviceId,ephemeral:await point(ephemeral.publicKey),iv:base64(crypto.getRandomValues(new Uint8Array(12)))};
    const header=packWrapHeader(identity.device.tenantId,id,identity.device.deviceId,w,m),k=await wrappingKey(ephemeral.privateKey,m.ecdh,id,header);
    packWraps.push({...w,wrappedKey:base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(raw))))});
   }finally{raw.fill(0);}
  }
  e={v:'2',...fields,grid,packWraps};
 }else e={v:'1',...fields};
 e.signature=await sign(identity.signingPrivate,epochBody(e));e.hash=await sha([epochBody(e),e.signature]);return {epoch:EpochSchema.parse(e),key:base64(key),packKeys};
 }finally{key.fill(0);}
}
export async function verifyEpoch(value:unknown,previous:Epoch|null,expectedFingerprint?:string){
 const e=EpochSchema.parse(value),signer=e.members.find(m=>m.deviceId===e.signerDevice&&m.userId===e.signerUser);
 if(!signer||!admin(signer.role))fail();
 if(previous){const old=previous.members.find(m=>m.deviceId===e.signerDevice&&m.userId===e.signerUser);if(!old||!admin(old.role)||old.signing!==signer.signing||old.ecdh!==signer.ecdh||e.tenantId!==previous.tenantId||BigInt(e.number)!==BigInt(previous.number)+BigInt(1)||e.previousHash!==previous.hash||BigInt(e.baseSequence)<BigInt(previous.baseSequence))fail();}
 else if(!expectedFingerprint||await fingerprint(signer)!==expectedFingerprint)fail(msg("relay.crypto.verifyTheAdministratorFingerprint"));
 if(previous?.v==='2'&&e.v!=='2')fail();
 if(e.v==='2')verifyGridEpoch(e,previous);
 if(!await verifySignature(signer.signing,epochBody(e),e.signature)||e.hash!==await sha([epochBody(e),e.signature]))fail();return e;
}
/**
 * Format 2 rules (SHARING_DESIGN.md section 4; decision D18). The signer is a publisher (Owner, Pricing Owner or the named
 * Pricing Owner) under the previous grid, or under its own grid for the first format 2 epoch; only an Owner changes the
 * grid; every member is in the role table; no cost pack is ticked for a role without cost; and the pack keys are wrapped
 * for exactly the devices the grid entitles, no more and no fewer.
 */
function verifyGridEpoch(e:EpochV2,previous:Epoch|null){
 checkGrid(e.grid,e.members);
 // The signed roles are tied to the server's membership roles of the devices in the epoch (security review, S2): a grid
 // Owner is a workspace owner, and a publisher (Pricing Owner or the named Pricing Owner) is an owner or manager.
 for(const m of e.members){const p=gridPerson(e.grid,m.userId)!;if((p.role==='owner'&&m.role!=='owner')||(gridPublisher(e.grid,m.userId)&&!admin(m.role)))fail();}
 const authority=previous?.v==='2'?previous.grid:e.grid;
 if(!gridPublisher(authority,e.signerUser))fail();
 // The first signed grid (a new workspace, or the step up from format 1) must come from an Owner, not any publisher.
 if(previous?.v!=='2'&&gridPerson(e.grid,e.signerUser)?.role!=='owner')fail();
 if(previous?.v==='2'&&JSON.stringify(gridBody(previous.grid))!==JSON.stringify(gridBody(e.grid))&&gridPerson(previous.grid,e.signerUser)?.role!=='owner')fail();
 const expected=expectedPackWraps(e.grid,e.members);
 if(e.packWraps.length!==expected.length||new Set(e.packWraps.map(w=>w.id)).size!==e.packWraps.length||e.packWraps.some((w,i)=>w.pack!==expected[i].pack||w.deviceId!==expected[i].deviceId))fail();
}
/** This device's pack keys from a verified format 2 epoch. A device holds only the packs its person is entitled to. */
export async function unwrapPacks(identity:Identity,epoch:Epoch):Promise<Partial<Record<AnyPack,string>>>{
 if(epoch.v!=='2')return {};
 const out:Partial<Record<AnyPack,string>>={},me=epoch.members.find(m=>m.deviceId===identity.device.deviceId&&m.userId===identity.device.userId);
 if(!me)return out;
 try{for(const w of epoch.packWraps.filter(x=>x.deviceId===identity.device.deviceId)){
  const header=packWrapHeader(epoch.tenantId,epoch.id,epoch.signerDevice,w,me),k=await wrappingKey(await privateKey(identity.ecdhPrivate,'ECDH'),w.ephemeral,epoch.id,header);
  const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(unbase64(w.wrappedKey))));
  try{if(raw.length!==32)fail();out[w.pack]=base64(raw);}finally{raw.fill(0);}
 }}catch{throw new RelayError('KEY',msg("relay.crypto.thisDeviceCannotOpen"));}
 return out;
}
export async function unwrapEpoch(identity:Identity,epoch:Epoch){
 try{if(identity.device.tenantId!==epoch.tenantId)fail();const w=epoch.members.find(m=>m.deviceId===identity.device.deviceId&&m.userId===identity.device.userId);if(!w||w.ecdh!==identity.device.ecdh||w.signing!==identity.device.signing)fail();
 const header=wrapHeader(epoch.tenantId,epoch.id,epoch.signerDevice,w),k=await wrappingKey(await privateKey(identity.ecdhPrivate,'ECDH'),w.ephemeral,epoch.id,header);
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(unbase64(w.wrappedKey))));
 try{if(raw.length!==32)fail();return base64(raw);}finally{raw.fill(0);}
 }catch{throw new RelayError('KEY',msg("relay.crypto.thisDeviceCannotOpen"));}
}
export const eventHeader=(e:RelayEvent)=>['rehq.relay.event.v1',e.v,e.id,e.tenantId,e.epochId,e.sequence,e.previousHash,e.senderUser,e.senderDevice,e.objectId,e.objectKind,e.recipients,e.mentions,e.createdAt,e.iv];
async function messageKey(key:string,e:RelayEvent){const raw=unbase64(key);try{return await hkdf(raw,uuidBytes(e.id),['rehq.relay.payload.v1',e.tenantId,e.epochId]);}finally{raw.fill(0);}}
export async function encryptEvent(identity:Identity,epoch:Epoch,key:string,head:{sequence:string;hash:string},objectId:string,objectKind:RelayEvent['objectKind'],content:Content,recipients:string[]=[],mentions:string[]=[],id=crypto.randomUUID()){
 const payload=ContentSchema.parse(content),e:RelayEvent={v:'1',id,tenantId:identity.device.tenantId,epochId:epoch.id,sequence:(BigInt(head.sequence)+BigInt(1)).toString(),previousHash:head.hash,senderUser:identity.device.userId,senderDevice:identity.device.deviceId,objectId,objectKind,recipients:[...new Set(recipients)].sort(),mentions:[...new Set(mentions)].sort(),createdAt:new Date().toISOString(),iv:base64(crypto.getRandomValues(new Uint8Array(12))),ciphertext:'',signature:'',hash:''};
 const plain=canonical(payload);try{if(plain.length>16_000)fail();e.ciphertext=base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(unbase64(e.iv)),additionalData:bytes(canonical(eventHeader(e)))},await messageKey(key,e),bytes(plain))));}finally{plain.fill(0);}
 e.signature=await sign(identity.signingPrivate,[eventHeader(e),e.ciphertext]);e.hash=await sha([eventHeader(e),e.ciphertext,e.signature]);return EventSchema.parse(e);
}
export async function verifyEvent(value:unknown,epoch:Epoch,head:{sequence:string;hash:string}){
 const e=EventSchema.parse(value),sender=epoch.members.find(m=>m.deviceId===e.senderDevice&&m.userId===e.senderUser);
 if(!sender||e.tenantId!==epoch.tenantId||e.epochId!==epoch.id||BigInt(e.sequence)!==BigInt(head.sequence)+BigInt(1)||e.previousHash!==head.hash||BigInt(e.sequence)<=BigInt(epoch.baseSequence))fail();
 const users=new Set(epoch.members.map(m=>m.userId));if([...e.recipients,...e.mentions].some(id=>!users.has(id)))fail();
 if(!await verifySignature(sender.signing,[eventHeader(e),e.ciphertext],e.signature)||e.hash!==await sha([eventHeader(e),e.ciphertext,e.signature]))fail();return e;
}
export async function decryptEvent(e:RelayEvent,key:string){let plain:Uint8Array|undefined;try{
 try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(e.iv)),additionalData:bytes(canonical(eventHeader(e)))},await messageKey(key,e),bytes(unbase64(e.ciphertext))));}catch{throw new RelayError('DECRYPT',msg("relay.crypto.thisSignedItemCould"));}
 try{return ContentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));}catch{throw new RelayError('CONTENT',msg("relay.crypto.anAuthenticatedButInvalid"));}
 }finally{plain?.fill(0);}}

// ---- Team sharing S2: published pack versions (a signed hash chain per pack; the manifest is under the pack key) ----
export const packHeader=(p:PackVersion)=>['rehq.relay.pack.v1',p.v,p.id,p.tenantId,p.epochId,p.pack,p.version,p.previousHash,p.kind,p.baseVersion,p.senderUser,p.senderDevice,p.createdAt,p.iv];
async function packMessageKey(key:string,p:PackVersion){const raw=unbase64(key);try{return await hkdf(raw,uuidBytes(p.id),['rehq.relay.packpayload.v1',p.tenantId,p.epochId,p.pack]);}finally{raw.fill(0);}}
export async function encryptPackVersion(identity:Identity,epoch:Epoch,packKey:string,head:{version:string;hash:string},pack:AnyPack,kind:'snapshot'|'delta',baseVersion:string,manifest:Manifest,id=crypto.randomUUID()){
 if(epoch.v!=='2'||!gridPublisher(epoch.grid,identity.device.userId))fail();
 const p:PackVersion={v:'1',id,tenantId:identity.device.tenantId,epochId:epoch.id,pack,version:(BigInt(head.version)+BigInt(1)).toString(),previousHash:head.hash,kind,baseVersion:kind==='snapshot'?'0':baseVersion,senderUser:identity.device.userId,senderDevice:identity.device.deviceId,createdAt:new Date().toISOString(),iv:base64(crypto.getRandomValues(new Uint8Array(12))),ciphertext:'',signature:'',hash:''};
 const plain=canonical(ManifestSchema.parse(manifest));try{if(plain.length>16_000)fail();p.ciphertext=base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(unbase64(p.iv)),additionalData:bytes(canonical(packHeader(p)))},await packMessageKey(packKey,p),bytes(plain))));}finally{plain.fill(0);}
 p.signature=await sign(identity.signingPrivate,[packHeader(p),p.ciphertext]);p.hash=await sha([packHeader(p),p.ciphertext,p.signature]);return PackVersionSchema.parse(p);
}
/** A pack version is accepted only from a publisher under the epoch's signed grid whose device holds that pack, in order. */
export async function verifyPackVersion(value:unknown,epoch:Epoch,head:{version:string;hash:string}){
 const p=PackVersionSchema.parse(value);if(epoch.v!=='2')fail();
 const sender=epoch.members.find(m=>m.deviceId===p.senderDevice&&m.userId===p.senderUser);
 if(!sender||p.tenantId!==epoch.tenantId||p.epochId!==epoch.id||!gridPublisher(epoch.grid,p.senderUser)||!epoch.packWraps.some(w=>w.pack===p.pack&&w.deviceId===p.senderDevice))fail();
 if(BigInt(p.version)!==BigInt(head.version)+BigInt(1)||p.previousHash!==head.hash||(p.kind==='snapshot'?p.baseVersion!=='0':BigInt(p.baseVersion)<BigInt(1)||BigInt(p.baseVersion)>=BigInt(p.version)))fail();
 if(!await verifySignature(sender.signing,[packHeader(p),p.ciphertext],p.signature)||p.hash!==await sha([packHeader(p),p.ciphertext,p.signature]))fail();return p;
}
export async function decryptPackVersion(p:PackVersion,packKey:string):Promise<Manifest>{let plain:Uint8Array|undefined;try{
 try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(p.iv)),additionalData:bytes(canonical(packHeader(p)))},await packMessageKey(packKey,p),bytes(unbase64(p.ciphertext))));}catch{throw new RelayError('DECRYPT',msg("relay.crypto.thisSignedItemCould"));}
 try{return ManifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));}catch{throw new RelayError('CONTENT',msg("relay.crypto.anAuthenticatedButInvalid"));}
 }finally{plain?.fill(0);}}
