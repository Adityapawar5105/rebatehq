"use client";
import { useEffect,useState } from 'react';
type Device={id:string;user_id:string;status:string};
export function LicencePanel({owner}:{owner:boolean}){
 const[devices,setDevices]=useState<Device[]>([]),[message,setMessage]=useState('Loading licence metadata…'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const response=await fetch('/api/licence/devices',{cache:'no-store'});if(!response.ok)throw Error('Could not load devices.');setDevices((await response.json()).data);setMessage('Devices are control metadata. Revocation is picked up at the next refresh (up to five minutes online). Offline grace ends within 24 hours.');}
 useEffect(()=>{void load().catch(e=>setError(e.message));},[]);
 async function save(kind:string,data:object){setBusy(true);setError('');try{const r=await fetch('/api/licence/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),value=await r.json();if(!r.ok)throw Error(value.error||'The change could not be saved.');await load();setMessage('Licence metadata saved and audited.');}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
 return <section><p role="status">{message}</p>{error&&<p role="alert">⚠ {error}</p>}
 <p>Pilot licences are issued manually by the operator. To upgrade, contact your workspace owner. The server never receives vault files.</p>
 <h2>Devices</h2>{devices.length===0?<p>No devices registered yet. Open your local vault once to enrol this device.</p>:<ul>{devices.map(d=><li key={d.id}>{d.id} · {d.status}{owner&&<><button disabled={busy||d.status!=='pending'} onClick={()=>void save('devices',{id:d.id,status:'active'})}>Approve device</button><button disabled={busy||d.status==='revoked'} onClick={()=>void save('devices',{id:d.id,status:'revoked'})}>Revoke device</button></>}</li>)}</ul>}
 {owner&&<><h2>Assign a licence seat</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('seats',{userId:f.get('userId')});}}><label>Workspace member user ID<input name="userId" required maxLength={36}/></label><button disabled={busy}>Assign seat</button></form>
 <h2>Add a location / ERP profile</h2><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save('locations',{name:f.get('name'),erpProfile:f.get('erpProfile')});}}><label>Location name<input name="name" required maxLength={120}/></label><label>ERP profile<select name="erpProfile">{['generic','netsuite','p21','infor','bc','quickbooks'].map(v=><option key={v}>{v}</option>)}</select></label><button disabled={busy}>Add location</button></form></>}
 </section>;
}
