"use client";
import { useEffect,useState } from 'react';
import { t, msg, useLocale, say, fmt } from "@/lib/i18n";
type Device={id:string;user_id:string;status:string};
export function LicencePanel({owner}:{owner:boolean}){useLocale();
 const[devices,setDevices]=useState<Device[]>([]),[message,setMessage]=useState(t("licencePanel.loadingLicenceMetadata")),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const response=await fetch('/api/licence/devices',{cache:'no-store'});if(!response.ok)throw Error(msg("licencePanel.couldNotLoadDevices"));setDevices((await response.json()).data);setMessage(msg("licencePanel.devicesAreControlMetadata"));}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 async function save(kind:string,data:object){setBusy(true);setError('');try{const r=await fetch('/api/licence/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),value=await r.json();if(!r.ok)throw Error(value.error||msg("licencePanel.theChangeCouldNot"));await load();setMessage(msg("licencePanel.licenceMetadataSavedAnd"));}catch(e){setError(e instanceof Error?e.message:t("licencePanel.couldNotSave"));}finally{setBusy(false);}}
 return <section><p role="status">{say(message)}</p>{error&&<p role="alert">⚠ {say(error)}</p>}
 <p>{t("licencePanel.pilotLicencesAreIssued")}</p>
 <h2>{t("licencePanel.devices")}</h2>{devices.length===0?<p>{t("licencePanel.noDevicesRegisteredYet")}</p>:<ul>{devices.map(d=><li key={d.id}>{d.id} · {d.status}{owner&&<><button disabled={busy||d.status!=='pending'} onClick={()=>void save('devices',{id:d.id,status:'active'})}>{t("licencePanel.approveDevice")}</button><button disabled={busy||d.status==='revoked'} onClick={()=>void save('devices',{id:d.id,status:'revoked'})}>{t("licencePanel.revokeDevice")}</button></>}</li>)}</ul>}
 {owner&&<><h2>{t("licencePanel.assignALicenceSeat")}</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('seats',{userId:f.get('userId')});}}><label>{t("licencePanel.workspaceMemberUserId")}<input name="userId" required maxLength={36}/></label><button disabled={busy}>{t("licencePanel.assignSeat")}</button></form>
 <h2>{t("licencePanel.addALocationErp")}</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('locations',{name:f.get('name'),erpProfile:f.get('erpProfile')});}}><label>{t("licencePanel.locationName")}<input name="name" required maxLength={120}/></label><label>{t("licencePanel.erpProfile")}<select name="erpProfile">{['generic','netsuite','p21','infor','bc','quickbooks'].map(v=><option key={v}>{v}</option>)}</select></label><button disabled={busy}>{t("licencePanel.addLocation")}</button></form></>}
 </section>;
}
