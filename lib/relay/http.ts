// Imported only by the vault worker. Plain business commands never reach fetch.
import {PostSchema,DirectorySchema,PageSchema,RelayError,RELAY_LIMITS,type Post,type Directory,type Page} from './protocol';
export type RelayTransport={directory():Promise<Directory>;page(after:string,epochAfter:string):Promise<Page>;post(value:Post):Promise<void>};
const messages:Record<string,string>={ACCESS:'Sharing requires an approved device and active Professional or Scale seat.',ROTATE:'The workspace key or device list changed. Sync, then ask an administrator to rotate.',CONFLICT:'Someone changed the shared workspace. Sync and retry.',LIMIT:'The sharing quota was reached. Ask your workspace administrator.',DEVICE:'This device has different sharing keys. Enrol a new approved device.',VERIFY:'A shared record could not be verified. Nothing was applied.'};
export function relayHttp(deviceId:string,signal:AbortSignal):RelayTransport{
 if(!/^[a-f0-9-]{36}$/.test(deviceId))throw new RelayError('DEVICE','This device needs sharing setup.');
 async function request(query:Record<string,string>|null,value?:Post){
  const path='/api/relay'+(query?'?'+new URLSearchParams({device:deviceId,...query}):'');
  let response:Response;
  try{response=await fetch(path,{method:value?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(PostSchema.parse(value))}:{}),signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)])});}
  catch{throw new RelayError('NETWORK','Sharing could not reach the server. Sync to check whether a pending item arrived; your encrypted local save is retained.');}
  const reader=response.body?.getReader();if(!reader)throw new RelayError('NETWORK','Sharing returned an empty response.');
  const chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>RELAY_LIMITS.responseBytes){await reader.cancel();throw new RelayError('LIMIT','Sharing returned too much data. No item was applied.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RelayError('NETWORK','Sharing returned an invalid response. Your local save is safe.');}
  if(!response.ok){const code=String((parsed as {code?:string}).code??'NETWORK');throw new RelayError(code,messages[code]??(response.status===404?'Workspace sharing is not enabled by your operator.':'Sharing is unavailable. Your encrypted local save is safe.'));}
  return parsed;
 }
 return {
  async directory(){return DirectorySchema.parse(await request({mode:'directory'}));},
  async page(after,epochAfter){if(!/^(0|[1-9][0-9]{0,4})$/.test(after)||!/^(0|[1-9][0-9]{0,2})$/.test(epochAfter))throw new RelayError('VERIFY','Invalid local sharing cursor.');return PageSchema.parse(await request({mode:'sync',after,epochAfter}));},
  async post(value){const result=await request(null,value) as {ok?:unknown};if(result.ok!==true)throw new RelayError('NETWORK','Sharing did not acknowledge this item. Sync before retrying.');},
 };
}
