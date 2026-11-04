// Only signed control metadata is cached here; never business data or passphrases.
import { REFRESH_MS, type LicenceEnvelope } from './licence-policy';
import type { Scope } from './vault/protocol';
import { verifyLicence } from './licence-verify';
const deviceKey='rebatehq-device-v1';
export function deviceId(scope:Scope) { const scopedKey=deviceKey+':'+scope.tenantId+':'+scope.userId;let id=localStorage.getItem(scopedKey);if(!id){id=crypto.randomUUID();localStorage.setItem(scopedKey,id);}return id; }
export async function refreshLicence(scope:Scope, device:string):Promise<{envelope:LicenceEnvelope|null;offline:boolean}> {
  const key='rebatehq-licence-v1:'+scope.tenantId+':'+scope.userId+':'+device;
  let fetched=false;
  try {
    const response=await fetch('/api/licence?device='+encodeURIComponent(device),{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});fetched=true;
    if(!response.ok){localStorage.removeItem(key);return {envelope:null,offline:false};}
    const envelope=await response.json() as LicenceEnvelope;
    await verifyLicence(envelope,process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY||'',{userId:scope.userId,workspaceId:scope.tenantId},device);
    // A known revocation replaces the active cache; it cannot silently fall back on the old one.
    localStorage.setItem(key,JSON.stringify(envelope));return {envelope,offline:false};
  }catch(error){
    // Only actual offline transport failures permit grace; invalid signatures never do.
    if(fetched){localStorage.removeItem(key);return {envelope:null,offline:false};}
    try{return {envelope:JSON.parse(localStorage.getItem(key)||'null'),offline:true};}catch{return {envelope:null,offline:true};}
  }
}
export { REFRESH_MS };
