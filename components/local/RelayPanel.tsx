"use client";
import {useEffect,useRef,useState} from 'react';
import type {VaultClient} from '@/lib/vault/client';
import type {Action,Commands} from '@/lib/vault/protocol';
import type {RelayView} from '@/lib/relay/session';
import type {ShareInput} from '@/lib/relay/protocol';
import {centsText} from '@/lib/margin/decimal';
import styles from './vault.module.css';
type RelayAction=Extract<Action,`relay${string}`>;
export function RelayPanel({client,userId,onChange}:{client:VaultClient;userId:string;onChange:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false),[view,setView]=useState<RelayView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<'inbox'|'share'|'keys'>('inbox'),[selected,setSelected]=useState(''),[pin,setPin]=useState(''),[confirmed,setConfirmed]=useState<string[]>([]);
 const [title,setTitle]=useState(''),[reference,setReference]=useState(''),[amount,setAmount]=useState(''),[currency,setCurrency]=useState('USD'),[kind,setKind]=useState<ShareInput['objectKind']>('price_change'),[preset,setPreset]=useState<ShareInput['preset']>('standard');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[text,setText]=useState(''),[mentions,setMentions]=useState<string[]>([]);
 useEffect(()=>{if(!open)return;let active=true;dialog.current?.showModal();setView(null);setError('');setBusy(true);
  void client.call('relayView',{}).then(v=>{if(active)setView(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;dialog.current?.close();};
 },[client,open]);
 async function run<K extends RelayAction>(action:K,data:Commands[K],message:string){
  setBusy(true);setError('');setNotice('');
  try{const value=await client.call(action,data) as RelayView;setView(value);setNotice(message);await onChange();return true;}
  catch(e){setError(e instanceof Error?e.message:'Sharing could not finish. Sync before retrying.');return false;}
  finally{setBusy(false);}
 }
 const object=view?.objects.find(o=>o.id===selected),request=object?.approval,canDecide=!!request&&request.status==='pending'&&request.approvers[request.decisions.length]===userId,canRequest=!!object&&!request&&object.author===userId;
 const admins=[...new Map((view?.devices??[]).filter(d=>['owner','manager'].includes(d.role)&&d.userId!==userId).map(d=>[d.userId,d])).values()];
 const people=[...new Map((view?.devices??[]).map(d=>[d.userId,d])).values()],label=(id:string)=>people.find(p=>p.userId===id)?.label??id;
 const check=(values:string[],value:string,on:boolean)=>on?[...values,value]:values.filter(v=>v!==value);
 return <section className={styles.card}>
  <h2>Workspace sharing</h2><p>Share an encrypted reference, request approval and discuss it in your workspace inbox.</p>
  <button onClick={()=>{setTab('inbox');setSelected('');setOpen(true);}}>Open shared inbox</button>
  <dialog ref={dialog} className={styles.relayDialog} aria-labelledby="relay-title" onCancel={()=>setOpen(false)}>
   <div className={styles.row}><h2 id="relay-title">Shared inbox</h2><button onClick={()=>setOpen(false)}>Close shared inbox</button></div>
   <p className={styles.muted}>Shared with every approved relay member in this workspace. Mentions notify people; they are not private messages. Sync to retrieve changes.</p>
   {error&&<p className={styles.error} role="alert"><span aria-hidden="true">⚠ </span>{error}</p>}
   <p role="status" aria-live="polite">{busy?'Working in the encrypted vault…':notice}</p>
   {!view&&!busy&&<button onClick={()=>void run('relayView',{},'Sharing status refreshed.')}>Retry sharing status</button>}
   {view&&<>
    {!view.registered?<><p>Set up a sharing key on this approved device. Private keys stay in your encrypted local vault.</p><button className={styles.primary} disabled={busy} onClick={()=>void run('relayRegister',{},'Device sharing keys registered. Keep an encrypted backup.')}>Set up this sharing device</button></>:
    !view.joined?<>
     <p>Your device fingerprint: <code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p>
     {view.canStart?<><p>Before starting, verify each device fingerprint through a separate trusted channel.</p><DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/><button className={styles.primary} disabled={busy||confirmed.length!==view.devices.length} onClick={()=>void run('relayRotate',{confirmations:view.devices.filter(d=>confirmed.includes(d.deviceId)).map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))},'Workspace sharing started.')}>Start workspace sharing</button></>:
     view.administratorFingerprint?<form onSubmit={e=>{e.preventDefault();void run('relayJoin',{fingerprint:pin},'Workspace key verified.');}}><p>Ask a trusted administrator for their signing fingerprint through a separate channel. Enter that verified fingerprint here.</p><label>Verified administrator fingerprint<input value={pin} onChange={e=>setPin(e.target.value)} autoComplete="off" required/></label><button className={styles.primary} disabled={busy||!pin.trim()}>Verify and join sharing</button></form>:<><p>Ask your administrator to start or rotate sharing after verifying your device fingerprint.</p><button className={styles.primary} disabled={busy} onClick={()=>void run('relayView',{},'Device list refreshed.')}>Refresh sharing setup</button></>}
    </>:<>
     <nav className={styles.row} aria-label="Workspace sharing"><button aria-pressed={tab==='inbox'} onClick={()=>setTab('inbox')}>Inbox</button><button aria-pressed={tab==='share'} onClick={()=>setTab('share')}>Share a reference</button><button aria-pressed={tab==='keys'} onClick={()=>{setConfirmed([]);setTab('keys');}}>Device keys</button><button className={tab==='inbox'&&!object?styles.primary:undefined} disabled={busy} onClick={()=>void run('relaySync',{},'Inbox verified and synced.')}>Sync inbox</button></nav>
     {view.rotationRequired&&<p className={styles.warning} role="alert"><span aria-hidden="true">⚠ </span>The member/device list changed. An administrator must verify fingerprints and rotate the workspace key before another item is shared.</p>}
     {view.pending&&<div className={styles.warning}><p>A send is pending. Sync first to check whether it arrived. Discarding this local pending copy does not remove an item already delivered.</p><button disabled={busy} onClick={()=>void run('relayRetry',{},'Pending send checked.')}>Retry pending send</button><button disabled={busy} onClick={()=>void run('relayDiscard',{},'Local pending copy discarded. Sync before recreating it.')}>Discard pending copy</button></div>}
     {view.rejected.length>0&&<p className={styles.warning} role="alert"><span aria-hidden="true">⚠ </span>{view.rejected.length} signed operations were rejected. No approval was granted by those operations. Ask your administrator to compare verification heads.</p>}
     {tab==='keys'&&<section><h3>Device verification</h3><p>Your fingerprint: <code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p><p>Current verification head: epoch {view.head.epoch}, event {view.head.sequence}, <code>{view.head.hash}</code>. Compare this head with a colleague to check for diverging histories.</p><DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/>{['owner','manager'].includes(view.role)&&<button className={styles.primary} disabled={busy||confirmed.length!==view.devices.length} onClick={()=>void run('relayRotate',{confirmations:view.devices.filter(d=>confirmed.includes(d.deviceId)).map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))},'A fresh workspace key was published for these verified devices.')}>Rotate workspace key</button>}<p className={styles.muted}>Revoke lost devices in workspace controls before rotating. There is no server-side recovery if all device keys and encrypted backups are lost.</p></section>}
     {tab==='share'&&<form onSubmit={e=>{e.preventDefault();void run('relayShare',{input:{objectKind:kind,title,reference,amount,currency,preset}},'Encrypted reference shared.').then(ok=>{if(ok){setTitle('');setReference('');setAmount('');setTab('inbox');setSelected('');}});}}>
      <h3>Share a reference</h3><p>This shares a summary, not your vault or invoice history. The recipient should check the referenced quote/change before approving.</p>
      <label>Reference type<select value={kind} onChange={e=>setKind(e.target.value as ShareInput['objectKind'])}><option value="price_change">Price change</option><option value="quote">Quote reference</option><option value="rebate">Rebate reference</option></select></label>
      <label>Shared title<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required/></label><label>Local reference<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={160} required/></label>
      <label>Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="5000.00" required/></label><label>Currency<input value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())} pattern="[A-Z]{3}" maxLength={3} required/></label>
      <label>Approval preset<select value={preset} onChange={e=>setPreset(e.target.value as ShareInput['preset'])}><option value="standard">Standard: one approval through 5,000.00; two above</option><option value="conservative">Conservative: always two approvals</option></select></label>
      <button className={styles.primary} disabled={busy||view.rotationRequired||view.pending}>Share encrypted reference</button>
     </form>}
     {tab==='inbox'&&<>
      {!view.objects.length?<p>No shared references yet. Share a reference or sync to check for new items.</p>:<div className={styles.row}>{view.objects.map(o=><button key={o.id} aria-pressed={selected===o.id} onClick={()=>{setSelected(o.id);setFirst('');setSecond('');setText('');setMentions([]);}}>{o.subject.title}</button>)}</div>}
      {object&&<article data-testid="relay-object"><h3>{object.subject.title}</h3><p>{object.kind} · {object.subject.reference} · {object.subject.currency} {centsText(BigInt(object.subject.amountMinor))}</p><p>Shared by {label(object.author)}. Required approvals: {object.requiredLevels}.</p>
       {canRequest&&<form onSubmit={e=>{e.preventDefault();void run('relayRequest',{id:object.id,approvers:object.requiredLevels===2?[first,second]:[first]},'Approval request sent.');}}><label>Pricing Owner approver<select value={first} onChange={e=>setFirst(e.target.value)} required><option value="">Choose a different person</option>{admins.map(d=><option key={d.userId} value={d.userId}>{d.label} ({d.role})</option>)}</select></label>{object.requiredLevels===2&&<label>Second-level manager<select value={second} onChange={e=>setSecond(e.target.value)} required><option value="">Choose another person</option>{admins.filter(d=>d.userId!==first).map(d=><option key={d.userId} value={d.userId}>{d.label} ({d.role})</option>)}</select></label>}<button className={styles.primary} disabled={busy}>Request approval</button></form>}
       {request&&<><p role="status">Approval: {request.status}. {request.decisions.length} of {request.approvers.length} levels decided.</p>{canDecide&&<div className={styles.row}><button className={styles.primary} disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'approve'},'Signed approval sent.')}>Approve level {request.decisions.length+1}</button><button disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'reject'},'Request rejected. A new revision needs a new share.')}>Reject request (final)</button></div>}</>}
       <h4>Comments and mentions</h4>{object.comments.map(c=><p key={c.id}><strong>{label(c.author)}:</strong> {c.text}{c.mentions.includes(userId)&&<span className={styles.pill}>Mentions you</span>}</p>)}
       <form onSubmit={e=>{e.preventDefault();void run('relayComment',{id:object.id,text,mentions},'Encrypted comment sent.').then(ok=>{if(ok){setText('');setMentions([]);}});}}><label>Comment<textarea value={text} onChange={e=>setText(e.target.value)} maxLength={4000} required rows={3}/></label><fieldset className={styles.relayChecks}><legend>Mention people</legend>{people.filter(p=>p.userId!==userId).map(p=><label key={p.userId}><input type="checkbox" checked={mentions.includes(p.userId)} onChange={e=>setMentions(check(mentions,p.userId,e.target.checked))}/>@{p.label}</label>)}</fieldset><button className={!canDecide&&!canRequest?styles.primary:undefined} disabled={busy}>Send encrypted comment</button></form>
      </article>}
     </>}
    </>}
   </>}
  </dialog>
 </section>;
}
function DeviceChecks({view,confirmed,setConfirmed,disabled}:{view:RelayView;confirmed:string[];setConfirmed:(v:string[])=>void;disabled:boolean}){
 return <fieldset className={styles.relayChecks}><legend>Verified device fingerprints</legend>{view.devices.map(d=><label key={d.deviceId}><input type="checkbox" disabled={disabled} checked={confirmed.includes(d.deviceId)} onChange={e=>setConfirmed(e.target.checked?[...confirmed,d.deviceId]:confirmed.filter(id=>id!==d.deviceId))}/><span>{d.label} ({d.role})<br/><code>{d.fingerprint}</code><br/>I verified this fingerprint through a trusted channel.</span></label>)}</fieldset>;
}
