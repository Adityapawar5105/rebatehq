// Imported only by the vault worker. Plain business commands never reach fetch.
import {z} from 'zod';
import {PostSchema,DirectorySchema,PageSchema,PackPageSchema,RelayError,RELAY_LIMITS,type Post,type Directory,type Page,type PackPage} from './protocol';
import { msg } from "../i18n/core";
/** Team sharing S3: where encrypted pack chunks are stored (Supabase Storage, checked by relay_storage_allowed). */
export type ChunkStore={put(path:string,bytes:Uint8Array):Promise<void>;get(path:string):Promise<Uint8Array>};
export type RelayTransport={directory():Promise<Directory>;page(after:string,epochAfter:string):Promise<Page>;post(value:Post):Promise<void>;packPage?(pack:string,after:string):Promise<PackPage>;chunks?:ChunkStore;
 /** Team sharing S4: the person's own short-lived session token, for the Realtime doorbell (never a service key). */
 token?():Promise<z.infer<typeof TokenSchema>>};
const TokenSchema=z.object({url:z.string().url(),apikey:z.string().min(1).max(400),token:z.string().min(1).max(8000),expiresAt:z.string()}).strict();
const CHUNK_PATH=/^[0-9a-f-]{36}\/[a-z_]{1,20}\/[0-9a-f-]{36}\/(0|[1-9][0-9]?|1[01][0-9]|12[0-7])$/;
const messages:Record<string,string>={ACCESS:msg("relay.http.sharingRequiresAnApproved"),ROTATE:msg("relay.http.theWorkspaceKeyOr"),CONFLICT:msg("relay.http.someoneChangedTheShared"),LIMIT:msg("relay.http.theSharingQuotaWas"),DEVICE:msg("relay.http.thisDeviceHasDifferent"),VERIFY:msg("relay.http.aSharedRecordCould")};
export function relayHttp(deviceId:string,signal:AbortSignal):RelayTransport{
 if(!/^[a-f0-9-]{36}$/.test(deviceId))throw new RelayError('DEVICE',msg("relay.http.thisDeviceNeedsSharing"));
 async function request(query:Record<string,string>|null,value?:Post){
  const path='/api/relay'+(query?'?'+new URLSearchParams({device:deviceId,...query}):'');
  let response:Response;
  try{response=await fetch(path,{method:value?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(PostSchema.parse(value))}:{}),signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)])});}
  catch{throw new RelayError('NETWORK',msg("relay.http.sharingCouldNotReach"));}
  const reader=response.body?.getReader();if(!reader)throw new RelayError('NETWORK',msg("relay.http.sharingReturnedAnEmpty"));
  const chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>RELAY_LIMITS.responseBytes){await reader.cancel();throw new RelayError('LIMIT',msg("relay.http.sharingReturnedTooMuch"));}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RelayError('NETWORK',msg("relay.http.sharingReturnedAnInvalid"));}
  if(!response.ok){const code=String((parsed as {code?:string}).code??'NETWORK');throw new RelayError(code,messages[code]??(response.status===404?msg("relay.http.workspaceSharingIsNot"):msg("relay.http.sharingIsUnavailableYour")));}
  return parsed;
 }
 return {
  async directory(){return DirectorySchema.parse(await request({mode:'directory'}));},
  async packPage(pack,after){if(!/^[a-z_]{1,20}$/.test(pack)||!/^(0|[1-9][0-9]{0,8})$/.test(after))throw new RelayError('VERIFY',msg("relay.http.invalidLocalSharingCursor"));return PackPageSchema.parse(await request({mode:'packs',pack,after,times:'1'}));},
  async page(after,epochAfter){if(!/^(0|[1-9][0-9]{0,8})$/.test(after)||!/^(0|[1-9][0-9]{0,5})$/.test(epochAfter))throw new RelayError('VERIFY',msg("relay.http.invalidLocalSharingCursor"));return PageSchema.parse(await request({mode:'sync',after,epochAfter}));},
  chunks:storageChunks(()=>request({mode:'token'}).then(v=>TokenSchema.parse(v)),signal),
  token:()=>request({mode:'token'}).then(v=>TokenSchema.parse(v)),
  async post(value){const result=await request(null,value) as {ok?:unknown};if(result.ok!==true)throw new RelayError('NETWORK',msg("relay.http.sharingDidNotAcknowledge"));},
 };
}

/** Chunks go straight between this worker and Supabase Storage with the person's own token (direct downloads, so the
 *  app host carries no price-book bytes). Only well-formed chunk paths are ever requested; bodies are ciphertext. */
function storageChunks(token:()=>Promise<z.infer<typeof TokenSchema>>,signal:AbortSignal):ChunkStore{
 let cached:{value:z.infer<typeof TokenSchema>;until:number}|null=null;
 const auth=async()=>{if(!cached||cached.until<Date.now()+60_000){const v=await token();cached={value:v,until:Date.parse(v.expiresAt)||Date.now()+300_000};}return cached.value;};
 const url=(base:string,path:string,read:boolean)=>{if(!CHUNK_PATH.test(path))throw new RelayError('VERIFY',msg("relay.http.invalidLocalSharingCursor"));return base.replace(/\/$/,'')+'/storage/v1/object/'+(read?'authenticated/':'')+'relay-packs/'+path;};
 const call=async(path:string,init:RequestInit,read:boolean)=>{const t=await auth();let r:Response;
  try{r=await fetch(url(t.url,path,read),{...init,credentials:'omit',cache:'no-store',redirect:'error',headers:{...(init.headers??{}),Authorization:'Bearer '+t.token,apikey:t.apikey},signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)])});}
  catch{throw new RelayError('NETWORK',msg("relay.http.sharingCouldNotReach"));}
  if(!r.ok){
   // Review R2 (R26): with x-upsert false, Storage refuses a path that already exists (409, or 400 with statusCode 409).
   if(!read){const text=await r.text().catch(()=>'');if(r.status===409||/"statusCode"s*:s*"409"|Duplicate/i.test(text))throw new RelayError('EXISTS',msg("relay.http.sharingIsUnavailableYour"));}
   throw new RelayError(r.status===403||r.status===401||r.status===400&&read?'ACCESS':'NETWORK',msg("relay.http.sharingIsUnavailableYour"));}
  return r;};
 return {
  async put(path,bytes){if(bytes.length>524400)throw new RelayError('LIMIT',msg("relay.http.sharingReturnedTooMuch"));await call(path,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-upsert':'false'},body:new Blob([new Uint8Array(bytes)])},false);},
  async get(path){const r=await call(path,{method:'GET'},true);const b=new Uint8Array(await r.arrayBuffer());if(b.length>524400)throw new RelayError('LIMIT',msg("relay.http.sharingReturnedTooMuch"));return b;},
 };
}
