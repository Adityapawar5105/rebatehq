import { DeviceSchema,EpochSchema,EventSchema,ContentSchema,RelayError,ZERO_HASH,admin,fail,type Device,type DirectoryDevice,type Epoch,type Wrap,type RelayEvent,type Content } from './protocol';
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
export const epochBody=(e:Epoch)=>['rehq.relay.epoch.v1',e.v,e.id,e.tenantId,e.number,e.previousHash,e.baseSequence,e.baseHash,e.signerUser,e.signerDevice,e.createdAt,e.members.map(w=>[w.id,w.deviceId,w.userId,w.role,w.ecdh,w.signing,w.ephemeral,w.iv,w.wrappedKey])];
export async function newEpoch(identity:Identity,roster:DirectoryDevice[],previous:Epoch|null,head:{sequence:string;hash:string}){
 const id=crypto.randomUUID(),key=crypto.getRandomValues(new Uint8Array(32)),members:Wrap[]=[];
 try{for(const member of [...roster].sort((a,b)=>a.deviceId.localeCompare(b.deviceId))){
  const {role: _role,label: _label,...registration}=member;await verifyDevice(registration);
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const w:Wrap={id:crypto.randomUUID(),deviceId:member.deviceId,userId:member.userId,role:member.role,ecdh:member.ecdh,signing:member.signing,ephemeral:await point(ephemeral.publicKey),iv:base64(crypto.getRandomValues(new Uint8Array(12))),wrappedKey:''};
  const header=wrapHeader(identity.device.tenantId,id,identity.device.deviceId,w),k=await wrappingKey(ephemeral.privateKey,w.ecdh,id,header);
  w.wrappedKey=base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(key))));members.push(w);
 }
 const e:Epoch={v:'1',id,tenantId:identity.device.tenantId,number:(BigInt(previous?.number??'0')+BigInt(1)).toString(),previousHash:previous?.hash??ZERO_HASH,baseSequence:head.sequence,baseHash:head.hash,signerUser:identity.device.userId,signerDevice:identity.device.deviceId,createdAt:new Date().toISOString(),members,signature:'',hash:''};
 e.signature=await sign(identity.signingPrivate,epochBody(e));e.hash=await sha([epochBody(e),e.signature]);return {epoch:EpochSchema.parse(e),key:base64(key)};
 }finally{key.fill(0);}
}
export async function verifyEpoch(value:unknown,previous:Epoch|null,expectedFingerprint?:string){
 const e=EpochSchema.parse(value),signer=e.members.find(m=>m.deviceId===e.signerDevice&&m.userId===e.signerUser);
 if(!signer||!admin(signer.role))fail();
 if(previous){const old=previous.members.find(m=>m.deviceId===e.signerDevice&&m.userId===e.signerUser);if(!old||!admin(old.role)||old.signing!==signer.signing||old.ecdh!==signer.ecdh||e.tenantId!==previous.tenantId||BigInt(e.number)!==BigInt(previous.number)+BigInt(1)||e.previousHash!==previous.hash||BigInt(e.baseSequence)<BigInt(previous.baseSequence))fail();}
 else if(!expectedFingerprint||await fingerprint(signer)!==expectedFingerprint)fail('Verify the administrator fingerprint before joining this workspace.');
 if(!await verifySignature(signer.signing,epochBody(e),e.signature)||e.hash!==await sha([epochBody(e),e.signature]))fail();return e;
}
export async function unwrapEpoch(identity:Identity,epoch:Epoch){
 try{if(identity.device.tenantId!==epoch.tenantId)fail();const w=epoch.members.find(m=>m.deviceId===identity.device.deviceId&&m.userId===identity.device.userId);if(!w||w.ecdh!==identity.device.ecdh||w.signing!==identity.device.signing)fail();
 const header=wrapHeader(epoch.tenantId,epoch.id,epoch.signerDevice,w),k=await wrappingKey(await privateKey(identity.ecdhPrivate,'ECDH'),w.ephemeral,epoch.id,header);
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(w.iv)),additionalData:bytes(canonical(header))},k,bytes(unbase64(w.wrappedKey))));
 try{if(raw.length!==32)fail();return base64(raw);}finally{raw.fill(0);}
 }catch{throw new RelayError('KEY','This device cannot open the shared workspace key. Ask a trusted administrator to rotate and add this device.');}
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
 try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(unbase64(e.iv)),additionalData:bytes(canonical(eventHeader(e)))},await messageKey(key,e),bytes(unbase64(e.ciphertext))));}catch{throw new RelayError('DECRYPT','This signed item could not be decrypted. No business operation was applied.');}
 try{return ContentSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));}catch{throw new RelayError('CONTENT','An authenticated but invalid shared operation was rejected.');}
 }finally{plain?.fill(0);}}
