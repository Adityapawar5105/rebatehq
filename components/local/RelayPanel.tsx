"use client";
import {useEffect,useRef,useState} from 'react';
import type {VaultClient} from '@/lib/vault/client';
import type {Action,Commands} from '@/lib/vault/protocol';
import type {RelayView} from '@/lib/relay/session';
import type {ShareInput} from '@/lib/relay/protocol';
import { getWorkspaceCurrency, fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
const RELAY_ROLE: Record<string, MessageKey> = { owner: "relay.role.owner", manager: "relay.role.manager", rep: "relay.role.rep", analyst: "relay.role.analyst" };
const relayRole = (r: string) => r in RELAY_ROLE ? t(RELAY_ROLE[r]) : r;
const KIND: Record<string, MessageKey> = { price_change: "relay.priceChange", quote: "relay.quoteReference", rebate: "relay.rebateReference" };
const STATUS: Record<string, MessageKey> = { pending: "relay.status.pending", approved: "relay.status.approved", rejected: "relay.status.rejected" };
import styles from './vault.module.css';
type RelayAction=Extract<Action,`relay${string}`>;
export function RelayPanel({client,userId,onChange}:{client:VaultClient;userId:string;onChange:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false),[view,setView]=useState<RelayView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<'inbox'|'share'|'keys'>('inbox'),[selected,setSelected]=useState(''),[pin,setPin]=useState(''),[confirmed,setConfirmed]=useState<string[]>([]);
 const currency=getWorkspaceCurrency();
 const [title,setTitle]=useState(''),[reference,setReference]=useState(''),[amount,setAmount]=useState(''),[kind,setKind]=useState<ShareInput['objectKind']>('price_change'),[preset,setPreset]=useState<ShareInput['preset']>('standard');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[text,setText]=useState(''),[mentions,setMentions]=useState<string[]>([]);
 useEffect(()=>{if(!open)return;let active=true;dialog.current?.showModal();setView(null);setError('');setBusy(true);
  void client.call('relayView',{}).then(v=>{if(active)setView(v);}).catch(e=>{if(active)setError(e instanceof Error&&e.message?e.message:msg("relay.sharingCouldNotFinish"));}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;dialog.current?.close();};
 },[client,open]);
 async function run<K extends RelayAction>(action:K,data:Commands[K],message:string){
  setBusy(true);setError('');setNotice('');
  try{const value=await client.call(action,data) as RelayView;setView(value);setNotice(message);await onChange();return true;}
  catch(e){setError(e instanceof Error&&e.message?e.message:msg("relay.sharingCouldNotFinish"));return false;}
  finally{setBusy(false);}
 }
 const object=view?.objects.find(o=>o.id===selected),request=object?.approval,canDecide=!!request&&request.status==='pending'&&request.approvers[request.decisions.length]===userId,canRequest=!!object&&!request&&object.author===userId;
 const admins=[...new Map((view?.devices??[]).filter(d=>['owner','manager'].includes(d.role)&&d.userId!==userId).map(d=>[d.userId,d])).values()];
 const people=[...new Map((view?.devices??[]).map(d=>[d.userId,d])).values()],label=(id:string)=>people.find(p=>p.userId===id)?.label??id;
 const check=(values:string[],value:string,on:boolean)=>on?[...values,value]:values.filter(v=>v!==value);
 return <section className={styles.card}>
  <h2>{t("relay.workspaceSharing2")}</h2><p>{t("relay.shareAnEncryptedReference")}</p>
  <button onClick={()=>{setTab('inbox');setSelected('');setView(null);setError('');setBusy(true);setOpen(true);}}>{t("relay.openSharedInbox")}</button>
  <dialog ref={dialog} className={styles.relayDialog} aria-labelledby="relay-title" aria-busy={open&&(busy||(!view&&!error))} onCancel={()=>setOpen(false)}>
   <div className={styles.row}><h2 id="relay-title">{t("relay.sharedInbox")}</h2><button onClick={()=>setOpen(false)}>{t("relay.closeSharedInbox")}</button></div>
   <p className={styles.muted}>{t("relay.sharedWithEveryApproved")}</p>
   {error&&<p className={styles.error} role="alert"><span aria-hidden="true">⚠ </span>{say(error)}</p>}
   <p role="status" aria-live="polite">{busy?t("relay.workingInTheEncrypted"):say(notice)}</p>
   {!view&&!busy&&<button onClick={()=>void run('relayView',{},msg("relay.note1"))}>{t("relay.retrySharingStatus")}</button>}
   {view&&<>
    {!view.registered?<><p>{t("relay.setUpASharing")}</p><button className={styles.primary} disabled={busy} onClick={()=>void run('relayRegister',{},msg("relay.note2"))}>{t("relay.setUpThisSharing")}</button></>:
    !view.joined?<>
     <p>{t("relay.yourDeviceFingerprint")}{" "}<code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p>
     {view.canStart?<><p>{t("relay.beforeStartingVerifyEach")}</p><DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/><button className={styles.primary} disabled={busy||confirmed.length!==view.devices.length} onClick={()=>void run('relayRotate',{confirmations:view.devices.filter(d=>confirmed.includes(d.deviceId)).map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))},msg("relay.note3"))}>{t("relay.startWorkspaceSharing")}</button></>:
     view.administratorFingerprint?<form onSubmit={e=>{e.preventDefault();void run('relayJoin',{fingerprint:pin},msg("relay.note4"));}}><p>{t("relay.askATrustedAdministrator")}</p><label>{t("relay.verifiedAdministratorFingerprint")}<input value={pin} onChange={e=>setPin(e.target.value)} autoComplete="off" required/></label><button className={styles.primary} disabled={busy||!pin.trim()}>{t("relay.verifyAndJoinSharing")}</button></form>:<><p>{t("relay.askYourAdministratorTo")}</p><button className={styles.primary} disabled={busy} onClick={()=>void run('relayView',{},msg("relay.note5"))}>{t("relay.refreshSharingSetup")}</button></>}
    </>:<>
     <nav className={styles.row} aria-label={t("relay.workspaceSharing")}><button aria-pressed={tab==='inbox'} onClick={()=>setTab('inbox')}>{t("relay.inbox")}</button><button aria-pressed={tab==='share'} onClick={()=>setTab('share')}>{t("relay.shareAReference2")}</button><button aria-pressed={tab==='keys'} onClick={()=>{setConfirmed([]);setTab('keys');}}>{t("relay.deviceKeys")}</button><button className={tab==='inbox'&&!object?styles.primary:undefined} disabled={busy} onClick={()=>void run('relaySync',{},msg("relay.note6"))}>{t("relay.syncInbox")}</button></nav>
     {view.rotationRequired&&<p className={styles.warning} role="alert"><span aria-hidden="true">⚠ </span>{t("relay.theMemberDeviceList")}</p>}
     {view.pending&&<div className={styles.warning}><p>{t("relay.aSendIsPending")}</p><button disabled={busy} onClick={()=>void run('relayRetry',{},msg("relay.note7"))}>{t("relay.retryPendingSend")}</button><button disabled={busy} onClick={()=>void run('relayDiscard',{},msg("relay.note8"))}>{t("relay.discardPendingCopy")}</button></div>}
     {view.rejected.length>0&&<p className={styles.warning} role="alert"><span aria-hidden="true">⚠ </span>{t("relay.signedOperationsWereRejected", { count: view.rejected.length })}</p>}
     {tab==='keys'&&<section><h3>{t("relay.deviceVerification")}</h3><p>{t("relay.yourFingerprint")}{" "}<code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p><p>{t("relay.currentVerificationHeadEpoch", { epoch: Number(view.head.epoch), sequence: Number(view.head.sequence) })}{" "}<code>{view.head.hash}</code>{t("relay.compareThisHeadWith")}</p><DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/>{['owner','manager'].includes(view.role)&&<button className={styles.primary} disabled={busy||confirmed.length!==view.devices.length} onClick={()=>void run('relayRotate',{confirmations:view.devices.filter(d=>confirmed.includes(d.deviceId)).map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))},msg("relay.note9"))}>{t("relay.rotateWorkspaceKey")}</button>}<p className={styles.muted}>{t("relay.revokeLostDevicesIn")}</p></section>}
     {tab==='share'&&<form onSubmit={e=>{e.preventDefault();void run('relayShare',{input:{objectKind:kind,title,reference,amount,currency,preset}},msg("relay.note10")).then(ok=>{if(ok){setTitle('');setReference('');setAmount('');setTab('inbox');setSelected('');}});}}>
      <h3>{t("relay.shareAReference")}</h3><p>{t("relay.thisSharesASummary")}</p>
      <label>{t("relay.referenceType")}<select value={kind} onChange={e=>setKind(e.target.value as ShareInput['objectKind'])}><option value="price_change">{t("relay.priceChange")}</option><option value="quote">{t("relay.quoteReference")}</option><option value="rebate">{t("relay.rebateReference")}</option></select></label>
      <label>{t("relay.sharedTitle")}<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required/></label><label>{t("relay.localReference")}<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={160} required/></label>
      <label>{t("relay.amount")}<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="5000.00" required/></label><label>{t("relay.currency")}<input value={currency} readOnly pattern="[A-Z]{3}" maxLength={3} required/></label>
      <label>{t("relay.approvalPreset")}<select value={preset} onChange={e=>setPreset(e.target.value as ShareInput['preset'])}><option value="standard">{t("relay.standardOneApprovalThrough")}</option><option value="conservative">{t("relay.conservativeAlwaysTwoApprovals")}</option></select></label>
      <button className={styles.primary} disabled={busy||view.rotationRequired||view.pending}>{t("relay.shareEncryptedReference")}</button>
     </form>}
     {tab==='inbox'&&<>
      {!view.objects.length?<p>{t("relay.noSharedReferencesYet")}</p>:<div className={styles.row}>{view.objects.map(o=><button key={o.id} translate="no" aria-pressed={selected===o.id} onClick={()=>{setSelected(o.id);setFirst('');setSecond('');setText('');setMentions([]);}}>{o.subject.title}</button>)}</div>}
      {object&&<article data-testid="relay-object"><h3 translate="no">{object.subject.title}</h3><p>{object.kind in KIND ? t(KIND[object.kind]) : object.kind} · <span translate="no">{object.subject.reference}</span> · <span translate="no">{object.subject.currency}</span> {fmt.currency(object.subject.amountMinor, object.subject.currency)}</p><p>{t("relay.sharedByRequiredApprovals", { author: label(object.author), count: Number(object.requiredLevels) })}</p>
       {canRequest&&<form onSubmit={e=>{e.preventDefault();void run('relayRequest',{id:object.id,approvers:object.requiredLevels===2?[first,second]:[first]},msg("relay.note11"));}}><label>{t("relay.pricingOwnerApprover")}<select value={first} onChange={e=>setFirst(e.target.value)} required><option value="">{t("relay.chooseADifferentPerson")}</option>{admins.map(d=><option key={d.userId} value={d.userId}>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}</option>)}</select></label>{object.requiredLevels===2&&<label>{t("relay.secondLevelManager")}<select value={second} onChange={e=>setSecond(e.target.value)} required><option value="">{t("relay.chooseAnotherPerson")}</option>{admins.filter(d=>d.userId!==first).map(d=><option key={d.userId} value={d.userId}>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}</option>)}</select></label>}<button className={styles.primary} disabled={busy}>{t("relay.requestApproval")}</button></form>}
       {request&&<><p role="status">{t("relay.approvalOfLevelsDecided", { status: request.status in STATUS ? t(STATUS[request.status]) : request.status, decided: request.decisions.length, count: request.approvers.length })}</p>{canDecide&&<div className={styles.row}><button className={styles.primary} disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'approve'},msg("relay.note12"))}>{t("relay.approveLevel", { level: request.decisions.length+1 })}</button><button disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'reject'},msg("relay.note13"))}>{t("relay.rejectRequestFinal")}</button></div>}</>}
       <h4>{t("relay.commentsAndMentions")}</h4>{object.comments.map(c=><p key={c.id}><strong translate="no">{label(c.author)}</strong>{t("common.definitionSeparator")}<span translate="no">{c.text}</span>{c.mentions.includes(userId)&&<span className={styles.pill}>{t("relay.mentionsYou")}</span>}</p>)}
       <form onSubmit={e=>{e.preventDefault();void run('relayComment',{id:object.id,text,mentions},msg("relay.note14")).then(ok=>{if(ok){setText('');setMentions([]);}});}}><label>{t("relay.comment")}<textarea value={text} onChange={e=>setText(e.target.value)} maxLength={4000} required rows={3}/></label><fieldset className={styles.relayChecks}><legend>{t("relay.mentionPeople")}</legend>{people.filter(p=>p.userId!==userId).map(p=><label key={p.userId}><input type="checkbox" checked={mentions.includes(p.userId)} onChange={e=>setMentions(check(mentions,p.userId,e.target.checked))}/><span translate="no">@{p.label}</span></label>)}</fieldset><button className={!canDecide&&!canRequest?styles.primary:undefined} disabled={busy}>{t("relay.sendEncryptedComment")}</button></form>
      </article>}
     </>}
    </>}
   </>}
  </dialog>
 </section>;
}
function DeviceChecks({view,confirmed,setConfirmed,disabled}:{view:RelayView;confirmed:string[];setConfirmed:(v:string[])=>void;disabled:boolean}){
 return <fieldset className={styles.relayChecks}><legend>{t("relay.verifiedDeviceFingerprints")}</legend>{view.devices.map(d=><label key={d.deviceId}><input type="checkbox" disabled={disabled} checked={confirmed.includes(d.deviceId)} onChange={e=>setConfirmed(e.target.checked?[...confirmed,d.deviceId]:confirmed.filter(id=>id!==d.deviceId))}/><span>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}<br/><code>{d.fingerprint}</code><br/>{t("relay.iVerifiedThisFingerprint")}</span></label>)}</fieldset>;
}
