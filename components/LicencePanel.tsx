"use client";
import { useEffect,useState } from 'react';
import { t, msg, useLocale, say, fmt } from "@/lib/i18n";
import { DataTable } from "@/components/ui/ui";
type Device={id:string;user_id:string;status:string;created_at?:string;email?:string|null};
// The device table scrolls inside its own box, so a long device id and two buttons never widen a phone screen (CI on
// PR #17, 21 Nov 2026). Audit B-5: the device ids this browser holds (one per workspace and person), to mark "This device".
const ownDevices=()=>{try{return new Set(Object.keys(localStorage).filter(k=>k.startsWith('rebatehq-device-v1:')).map(k=>localStorage.getItem(k)||''));}catch{return new Set<string>();}};
const STATUS:Record<string,'licencePanel.status.pending'|'licencePanel.status.active'|'licencePanel.status.revoked'>={pending:'licencePanel.status.pending',active:'licencePanel.status.active',revoked:'licencePanel.status.revoked'};
export function LicencePanel({owner}:{owner:boolean}){useLocale();
 const[mine,setMine]=useState<Set<string>>(new Set());useEffect(()=>{setMine(ownDevices());},[]);
 const[devices,setDevices]=useState<Device[]>([]),[message,setMessage]=useState(t("licencePanel.loadingLicenceMetadata")),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const response=await fetch('/api/licence/devices',{cache:'no-store'});if(!response.ok)throw Error(msg("licencePanel.couldNotLoadDevices"));setDevices((await response.json()).data);setMessage(msg("licencePanel.devicesAreControlMetadata"));}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 async function save(kind:string,data:object){setBusy(true);setError('');try{const r=await fetch('/api/licence/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),value=await r.json();if(!r.ok)throw Error(value.error||msg("licencePanel.theChangeCouldNot"));await load();setMessage(msg("licencePanel.licenceMetadataSavedAnd"));}catch(e){setError(e instanceof Error?e.message:t("licencePanel.couldNotSave"));}finally{setBusy(false);}}
 return <section><p role="status">{say(message)}</p>{error&&<p role="alert">⚠ {say(error)}</p>}
 <p>{t("licencePanel.pilotLicencesAreIssued")}</p>
 <h2>{t("licencePanel.devices")}</h2>
 {owner&&devices.some(d=>d.status==='pending')&&<p role="note" data-testid="devices-pending-note">{t("licencePanel.pendingNote",{count:devices.filter(d=>d.status==='pending').length})}</p>}
 {devices.length===0?<p>{t("licencePanel.noDevicesRegisteredYet")}</p>:<DataTable caption={t("licencePanel.devices")} label={msg("licencePanel.devices")}><thead><tr><th scope="col">{t("licencePanel.col.person")}</th><th scope="col">{t("licencePanel.col.added")}</th><th scope="col">{t("licencePanel.col.status")}</th>{owner&&<th scope="col">{t("licencePanel.col.actions")}</th>}</tr></thead>
 <tbody>{devices.map(d=><tr key={d.id} data-status={d.status}><td><span translate="no">{d.email||d.user_id}</span>{mine.has(d.id)&&<> <strong data-testid="this-device">{t("licencePanel.thisDevice")}</strong></>}<br/><small translate="no">{d.id}</small></td><td>{d.created_at?fmt.date(String(d.created_at).slice(0,10)):''}</td><td>{STATUS[d.status]?t(STATUS[d.status]):d.status}</td>
 {owner&&<td><button disabled={busy||d.status!=='pending'} onClick={()=>void save('devices',{id:d.id,status:'active'})}>{t("licencePanel.approveDevice")}</button><button disabled={busy||d.status==='revoked'} onClick={()=>void save('devices',{id:d.id,status:'revoked'})}>{t("licencePanel.revokeDevice")}</button></td>}</tr>)}</tbody></DataTable>}
 {owner&&<><h2>{t("licencePanel.assignALicenceSeat")}</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('seats',{userId:f.get('userId')});}}><label>{t("licencePanel.workspaceMemberUserId")}<input name="userId" required maxLength={36}/></label><button disabled={busy}>{t("licencePanel.assignSeat")}</button></form>
 <h2>{t("licencePanel.addALocationErp")}</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('locations',{name:f.get('name'),erpProfile:f.get('erpProfile')});}}><label>{t("licencePanel.locationName")}<input name="name" required maxLength={120}/></label><label>{t("licencePanel.erpProfile")}<select name="erpProfile">{['generic','netsuite','p21','infor','bc','quickbooks'].map(v=><option key={v}>{v}</option>)}</select></label><button disabled={busy}>{t("licencePanel.addLocation")}</button></form></>}
 </section>;
}
