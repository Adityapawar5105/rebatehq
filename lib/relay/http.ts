// Imported only by the vault worker. Plain business commands never reach fetch.
import {PostSchema,DirectorySchema,PageSchema,PackPageSchema,RelayError,RELAY_LIMITS,type Post,type Directory,type Page,type PackPage} from './protocol';
import { msg } from "../i18n/core";
export type RelayTransport={directory():Promise<Directory>;page(after:string,epochAfter:string):Promise<Page>;post(value:Post):Promise<void>;packPage?(pack:string,after:string):Promise<PackPage>};
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
  async packPage(pack,after){if(!/^[a-z_]{1,20}$/.test(pack)||!/^(0|[1-9][0-9]{0,8})$/.test(after))throw new RelayError('VERIFY',msg("relay.http.invalidLocalSharingCursor"));return PackPageSchema.parse(await request({mode:'packs',pack,after}));},
  async page(after,epochAfter){if(!/^(0|[1-9][0-9]{0,8})$/.test(after)||!/^(0|[1-9][0-9]{0,5})$/.test(epochAfter))throw new RelayError('VERIFY',msg("relay.http.invalidLocalSharingCursor"));return PageSchema.parse(await request({mode:'sync',after,epochAfter}));},
  async post(value){const result=await request(null,value) as {ok?:unknown};if(result.ok!==true)throw new RelayError('NETWORK',msg("relay.http.sharingDidNotAcknowledge"));},
 };
}
