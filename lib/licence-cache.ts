// Only signed control metadata is cached here; never business data or passphrases.
import { REFRESH_MS, type LicenceEnvelope } from './licence-policy';
import type { Scope } from './vault/protocol';
import { verifyLicence } from './licence-verify';
const deviceKey='rebatehq-device-v1';
export function deviceId(scope:Scope) { const scopedKey=deviceKey+':'+scope.tenantId+':'+scope.userId;let id=localStorage.getItem(scopedKey);if(!id){id=crypto.randomUUID();localStorage.setItem(scopedKey,id);}return id; }
/**
 * What a failed licence reply means (audit B-2, 20 Nov 2026). A refusal (4xx: signed out, no seat, bad device id)
 * is a real answer and clears the saved licence. A server error, a rate limit or a timeout (5xx, 429, 408) says
 * nothing about the licence, so the vault keeps the saved one inside its offline allowance, as when the network drops.
 */
export function failedReply(status:number):'refused'|'offline'{return status>=400&&status<500&&status!==408&&status!==429?'refused':'offline';}
export async function refreshLicence(scope:Scope, device:string):Promise<{envelope:LicenceEnvelope|null;offline:boolean}> {
  const key='rebatehq-licence-v1:'+scope.tenantId+':'+scope.userId+':'+device;
  const cached=()=>{try{return {envelope:JSON.parse(localStorage.getItem(key)||'null') as LicenceEnvelope|null,offline:true};}catch{return {envelope:null,offline:true};}};
  let response:Response;
  try{response=await fetch('/api/licence?device='+encodeURIComponent(device),{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});}
  catch{return cached();} // the network itself failed
  if(!response.ok){if(failedReply(response.status)==='offline')return cached();localStorage.removeItem(key);return {envelope:null,offline:false};}
  let envelope:LicenceEnvelope;
  try{envelope=await response.json() as LicenceEnvelope;}catch{return cached();} // a proxy or error page, not a licence reply
  try{await verifyLicence(envelope,process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY||'',{userId:scope.userId,workspaceId:scope.tenantId},device);}
  catch{localStorage.removeItem(key);return {envelope:null,offline:false};} // invalid signatures never get the offline allowance
  // A known revocation replaces the active cache; it cannot silently fall back on the old one.
  localStorage.setItem(key,JSON.stringify(envelope));return {envelope,offline:false};
}
export { REFRESH_MS };
