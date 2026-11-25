"use client";
// Workspace sharing (chunk 7A) on the shared components (roadmap 8.3). 8.4: the status shows in the card header without
// opening the inbox, a conflict uses the "bad" tone with its retry and discard actions beside it, and epoch, sequence and
// hash sit in a collapsed "Technical details". 8.5: the set-up card is its own component, placed under the Home work tabs.
import {useCallback,useEffect,useRef,useState} from 'react';
import type {VaultClient} from '@/lib/vault/client';
import type {Action,Commands} from '@/lib/vault/protocol';
import type {RelayView} from '@/lib/relay/session';
import type {ShareInput} from '@/lib/relay/protocol';
import { getWorkspaceCurrency, fmt, msg, say, t, type MessageKey } from "@/lib/i18n";
import styles from './vault.module.css';
import {Badge,Button,Card,Field,Notice,Tabs,tabPanelProps,type Tone} from '@/components/ui/ui';
import {Icon} from '@/components/ui/Icon';
const RELAY_ROLE: Record<string, MessageKey> = { owner: "relay.role.owner", manager: "relay.role.manager", rep: "relay.role.rep", analyst: "relay.role.analyst" };
const relayRole = (r: string) => r in RELAY_ROLE ? t(RELAY_ROLE[r]) : r;
/** Team sharing S2b: the data packs this device holds a key for, by name. */
const PACK_NAME: Record<string, MessageKey> = { items: "share.pack.items", customers: "share.pack.customers", book: "share.pack.book", contracts: "share.pack.contracts", guards: "share.pack.guards", cost: "share.pack.cost", cost_floors: "share.pack.cost_floors", supplier: "share.pack.supplier", rules: "share.pack.rules", competitors: "share.pack.competitors", documents: "share.pack.documents", results: "share.pack.results" };
const KIND: Record<string, MessageKey> = { price_change: "relay.priceChange", quote: "relay.quoteReference", rebate: "relay.rebateReference" };
const STATUS: Record<string, MessageKey> = { pending: "relay.status.pending", approved: "relay.status.approved", rejected: "relay.status.rejected" };
type Sync=RelayView['sync'];
const SYNC_TONE:Record<Sync['status'],Tone>={synced:'ok',pending:'warn',conflict:'bad'};
const SYNC_TEXT:Record<Sync['status'],MessageKey>={synced:'monitor.synced',pending:'monitor.pending',conflict:'monitor.conflict'};
type RelayAction=Extract<Action,`relay${string}`>;
type Tab='inbox'|'share'|'keys';
/** v2.6 gap 2: this browser remembers that the user dismissed the sharing set-up card (a preference, never business data). */
const onboardKey=(tenant:string,user:string)=>`rebatehq.relayOnboarding.dismissed:${tenant}:${user}`;
const dismissed=(tenant:string,user:string)=>{try{return localStorage.getItem(onboardKey(tenant,user))==="yes";}catch{return false;}};
/** The set-up card's button opens the inbox on the device-key step through this page event (no data is carried). */
const SETUP_EVENT='rebatehq:relay-setup';
type Local={identity:boolean;pending:boolean;lastSyncedAt:string|null;live?:{joined:string[];rings:number;statuses?:Record<string,string>}|null};

/** 8.5: "Turn on sharing" card, shown under the Home work tabs on Professional or Scale when the server has sharing on,
 *  this device has no key and the card was not dismissed. Both checks are local: the server flag comes from the page. */
export function RelayOnboarding({client,userId,tenantId,relayEnabled}:{client:VaultClient;userId:string;tenantId:string;relayEnabled:boolean}){
 const [show,setShow]=useState(false);
 useEffect(()=>{if(!relayEnabled||dismissed(tenantId,userId)){setShow(false);return;}let active=true;
  void client.call("relayLocal",{}).then(v=>{if(active)setShow(!v.identity);}).catch(()=>{if(active)setShow(false);});return()=>{active=false;};},[client,tenantId,userId,relayEnabled]);
 if(!show)return null;
 const later=()=>{try{localStorage.setItem(onboardKey(tenantId,userId),"yes");}catch{}setShow(false);};
 return <Card data-testid="relay-onboarding" headingId="relay-onboarding-heading" title={<span className={styles.row}><Icon name="users"/>{t("relay.onboard.title")}</span>}>
  <p>{t("relay.onboard.body")}</p>
  <p className={styles.muted}>{t("relay.onboard.notShared")}</p>
  <p className={styles.small}>{t("relay.onboard.steps")}</p>
  <div className={styles.row}>
   <Button variant="primary" data-testid="relay-onboarding-start" onClick={()=>{setShow(false);window.dispatchEvent(new Event(SETUP_EVENT));}}>{t("relay.onboard.start")}</Button>
   <Button variant="ghost" data-testid="relay-onboarding-dismiss" onClick={later}>{t("relay.onboard.later")}</Button>
  </div>
 </Card>;
}

/** 8.5: after "Not now", Settings › Team and roles keeps one muted line with a way back to the set-up card. */
export function RelaySetupLine({client,userId,tenantId,relayEnabled}:{client:VaultClient;userId:string;tenantId:string;relayEnabled:boolean}){
 const [show,setShow]=useState(false);
 useEffect(()=>{if(!relayEnabled||!dismissed(tenantId,userId)){setShow(false);return;}let active=true;
  void client.call("relayLocal",{}).then(v=>{if(active)setShow(!v.identity);}).catch(()=>{if(active)setShow(false);});return()=>{active=false;};},[client,tenantId,userId,relayEnabled]);
 if(!show)return null;
 return <p className={styles.muted} data-testid="relay-setup-line">{t("relay.setupLine")}{" "}
  <Button size="sm" variant="ghost" onClick={()=>{try{localStorage.removeItem(onboardKey(tenantId,userId));}catch{}location.hash="home";}}>{t("relay.setupLink")}</Button></p>;
}

export function RelayPanel({client,userId,tenantId,relayEnabled,onChange}:{client:VaultClient;userId:string;tenantId:string;relayEnabled:boolean;onChange:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),[open,setOpen]=useState(false),[view,setView]=useState<RelayView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<Tab>('inbox'),[selected,setSelected]=useState(''),[pin,setPin]=useState(''),[confirmed,setConfirmed]=useState<string[]>([]);
 const currency=getWorkspaceCurrency();
 const [title,setTitle]=useState(''),[reference,setReference]=useState(''),[amount,setAmount]=useState(''),[kind,setKind]=useState<ShareInput['objectKind']>('price_change'),[preset,setPreset]=useState<ShareInput['preset']>('standard');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[text,setText]=useState(''),[mentions,setMentions]=useState<string[]>([]);
 // 8.4: the last status this page knows. It starts from the vault's own relay row and is replaced by the inbox's full
 // status (which can also report a conflict) once the inbox has been opened.
 const [local,setLocal]=useState<Local|null>(null),[live,setLive]=useState<Sync|null>(null);
 const readLocal=useCallback(async()=>{try{setLocal(await client.call("relayLocal",{}));}catch{setLocal(null);}},[client]);
 useEffect(()=>{void readLocal();},[readLocal]);
 const start=(next:Tab)=>{setTab(next);setSelected('');setView(null);setError('');setBusy(true);setOpen(true);};
 useEffect(()=>{const go=()=>start('keys');window.addEventListener(SETUP_EVENT,go);return()=>window.removeEventListener(SETUP_EVENT,go);},[]);
 useEffect(()=>{if(!open)return;let active=true;dialog.current?.showModal();setView(null);setError('');setBusy(true);
  void readLocal();void client.call('relayView',{}).then(v=>{if(active){setView(v);setLive(v.sync);}}).catch(e=>{if(active)setError(e instanceof Error&&e.message?e.message:msg("relay.sharingCouldNotFinish"));}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;dialog.current?.close();};
 },[client,open]);
 async function run<K extends RelayAction>(action:K,data:Commands[K],message:string){
  setBusy(true);setError('');setNotice('');
  try{const value=await client.call(action,data) as RelayView;setView(value);setLive(value.sync);setNotice(message);await onChange();return true;}
  catch(e){setError(e instanceof Error&&e.message?e.message:msg("relay.sharingCouldNotFinish"));try{const v=await client.call('relayView',{});setView(v);setLive(v.sync);}catch{/* Keep the last confirmed view when offline. */}return false;}
  finally{setBusy(false);void readLocal();}
 }
 const object=view?.objects.find(o=>o.id===selected),request=object?.approval,canDecide=!!request&&request.status==='pending'&&request.approvers[request.decisions.length]===userId,canRequest=!!object&&!request&&object.author===userId;
 const admins=[...new Map((view?.devices??[]).filter(d=>['owner','manager'].includes(d.role)&&d.userId!==userId).map(d=>[d.userId,d])).values()];
 const people=[...new Map((view?.devices??[]).map(d=>[d.userId,d])).values()],label=(id:string)=>people.find(p=>p.userId===id)?.label??id;
 const check=(values:string[],value:string,on:boolean)=>on?[...values,value]:values.filter(v=>v!==value);
 const cardSync:Sync|null=live??(local?.identity?{status:local.pending||!local.lastSyncedAt?'pending':'synced',lastSyncedAt:local.lastSyncedAt}:null);
 const rotate=(note:MessageKey)=>void run('relayRotate',{confirmations:view!.devices.filter(d=>confirmed.includes(d.deviceId)).map(d=>({deviceId:d.deviceId,fingerprint:d.fingerprint}))},msg(note));
 return <Card headingId="relay-card-heading" title={t("relay.workspaceSharing2")} description={t("relay.shareAnEncryptedReference")}
  actions={cardSync&&<Badge tone={SYNC_TONE[cardSync.status]} data-testid="relay-card-status" title={cardSync.lastSyncedAt?t('monitor.lastSynced',{date:fmt.dateTime(cardSync.lastSyncedAt)}):t('monitor.neverSynced')}>{t(SYNC_TEXT[cardSync.status])}</Badge>}>
  {cardSync&&<p className={styles.small}>{cardSync.lastSyncedAt?t('monitor.lastSynced',{date:fmt.dateTime(cardSync.lastSyncedAt)}):t('monitor.neverSynced')}</p>}
  <Button onClick={()=>start('inbox')}>{t("relay.openSharedInbox")}</Button>
  <dialog ref={dialog} className={styles.relayDialog} aria-labelledby="relay-title" aria-busy={open&&(busy||(!view&&!error))} onCancel={()=>setOpen(false)}>
   <div className={styles.row}><h2 id="relay-title">{t("relay.sharedInbox")}</h2>
    {view&&<span data-testid="relay-sync-status"><Badge tone={SYNC_TONE[view.sync.status]}>{t(SYNC_TEXT[view.sync.status])}</Badge> {view.sync.lastSyncedAt?t('monitor.lastSynced',{date:fmt.dateTime(view.sync.lastSyncedAt)}):t('monitor.neverSynced')}</span>}
    {local?.live&&<span data-testid="relay-live" data-joined={local.live.joined.join(',')} data-rings={String(local.live.rings)} data-statuses={JSON.stringify(local.live.statuses??{})} title={t('relay.liveHint')}>{local.live.joined.length>0&&<Badge tone="ok" icon="checkCircle">{t('relay.live')}</Badge>}</span>}
    <Button onClick={()=>setOpen(false)}>{t("relay.closeSharedInbox")}</Button></div>
   <p className={styles.muted}>{t("relay.sharedWithEveryApproved")}</p>
   {error&&<Notice tone="bad" role="alert">{say(error)}</Notice>}
   <p role="status" aria-live="polite">{busy?t("relay.workingInTheEncrypted"):say(notice)}</p>
   {!view&&!busy&&<Button onClick={()=>void run('relayView',{},msg("relay.note1"))}>{t("relay.retrySharingStatus")}</Button>}
   {view&&<>
    {!view.registered?<><p>{t("relay.setUpASharing")}</p><Button variant="primary" disabled={busy} onClick={()=>void run('relayRegister',{},msg("relay.note2"))}>{t("relay.setUpThisSharing")}</Button></>:
    !view.joined?<>
     <p>{t("relay.yourDeviceFingerprint")}{" "}<code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p>
     {view.canStart?<><p>{t("relay.beforeStartingVerifyEach")}</p><DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/><Button variant="primary" disabled={busy||confirmed.length!==view.devices.length} onClick={()=>rotate("relay.note3")}>{t("relay.startWorkspaceSharing")}</Button></>:
     view.administratorFingerprint?<form onSubmit={e=>{e.preventDefault();void run('relayJoin',{fingerprint:pin},msg("relay.note4"));}}><p>{t("relay.askATrustedAdministrator")}</p><Field label={t("relay.verifiedAdministratorFingerprint")}><input value={pin} onChange={e=>setPin(e.target.value)} autoComplete="off" required/></Field><Button variant="primary" type="submit" disabled={busy||!pin.trim()}>{t("relay.verifyAndJoinSharing")}</Button></form>:<><p>{t("relay.askYourAdministratorTo")}</p><Button variant="primary" disabled={busy} onClick={()=>void run('relayView',{},msg("relay.note5"))}>{t("relay.refreshSharingSetup")}</Button></>}
    </>:<>
     <div className={styles.row}>
      <Tabs label={t("relay.workspaceSharing")} idPrefix="relay" active={tab} onChange={x=>{if(x==='keys')setConfirmed([]);setTab(x);}} tabs={[{id:'inbox',label:t("relay.inbox")},{id:'share',label:t("relay.shareAReference2")},{id:'keys',label:t("relay.deviceKeys")}]}/>
      <Button variant={tab==='inbox'&&!object?'primary':'secondary'} disabled={busy} onClick={()=>void run('relaySync',{},msg("relay.note6"))}>{t("relay.syncInbox")}</Button>
     </div>
     {view.rotationRequired&&<Notice tone="warn" role="alert">{t("relay.theMemberDeviceList")}</Notice>}
     {view.pending&&<Notice tone={view.sync.status==='conflict'?'bad':'warn'} data-testid="relay-pending" actions={<>
      <Button size="sm" disabled={busy} onClick={()=>void run('relayRetry',{},msg("relay.note7"))}>{t("relay.retryPendingSend")}</Button>
      <Button size="sm" disabled={busy} onClick={()=>void run('relayDiscard',{},msg("relay.note8"))}>{t("relay.discardPendingCopy")}</Button></>}>{t("relay.aSendIsPending")}</Notice>}
     {view.rejected.length>0&&<Notice tone="bad" role="alert">{t("relay.signedOperationsWereRejected", { count: view.rejected.length })}</Notice>}
     {view.grid&&view.grid.people.some(p=>p.userId===userId&&p.role==='owner')&&view.ownerDevices<2&&<Notice tone="warn" data-testid="relay-recovery-kit" title={t("relay.recoveryTitle")}>{t("relay.recoveryBody")}</Notice>}
     {view.grid&&<p className={styles.small} data-testid="relay-packs">{view.packs.length?t("relay.packsHeld",{packs:view.packs.map(p=>p in PACK_NAME?t(PACK_NAME[p]):p).join(', ')}):t("relay.packsNone")}</p>}
     <div {...tabPanelProps("relay",tab)}>
     {tab==='keys'&&<section><h3>{t("relay.deviceVerification")}</h3><p>{t("relay.yourFingerprint")}{" "}<code data-testid="relay-own-fingerprint">{view.fingerprint}</code></p>
      <details className={styles.small}><summary>{t("relay.techDetails")}</summary><p>{t("relay.currentVerificationHeadEpoch", { epoch: Number(view.head.epoch), sequence: Number(view.head.sequence) })}{" "}<code>{view.head.hash}</code>{t("relay.compareThisHeadWith")}</p></details>
      <DeviceChecks view={view} confirmed={confirmed} setConfirmed={setConfirmed} disabled={busy}/>{['owner','manager'].includes(view.role)&&<Button variant="primary" disabled={busy||confirmed.length!==view.devices.length} onClick={()=>rotate("relay.note9")}>{t("relay.rotateWorkspaceKey")}</Button>}<p className={styles.muted}>{t("relay.revokeLostDevicesIn")}</p></section>}
     {tab==='share'&&<form onSubmit={e=>{e.preventDefault();void run('relayShare',{input:{objectKind:kind,title,reference,amount,currency,preset}},msg("relay.note10")).then(ok=>{if(ok){setTitle('');setReference('');setAmount('');setTab('inbox');setSelected('');}});}}>
      <h3>{t("relay.shareAReference")}</h3><p>{t("relay.thisSharesASummary")}</p>
      <Field label={t("relay.referenceType")}><select value={kind} onChange={e=>setKind(e.target.value as ShareInput['objectKind'])}><option value="price_change">{t("relay.priceChange")}</option><option value="quote">{t("relay.quoteReference")}</option><option value="rebate">{t("relay.rebateReference")}</option></select></Field>
      <Field label={t("relay.sharedTitle")}><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required/></Field><Field label={t("relay.localReference")}><input value={reference} onChange={e=>setReference(e.target.value)} maxLength={160} required/></Field>
      <Field label={t("relay.amount")}><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="5000.00" required/></Field><Field label={t("relay.currency")}><input value={currency} readOnly pattern="[A-Z]{3}" maxLength={3} required/></Field>
      <Field label={t("relay.approvalPreset")}><select value={preset} onChange={e=>setPreset(e.target.value as ShareInput['preset'])}><option value="standard">{t("relay.standardOneApprovalThrough")}</option><option value="conservative">{t("relay.conservativeAlwaysTwoApprovals")}</option></select></Field>
      <Button variant="primary" type="submit" disabled={busy||view.rotationRequired||view.pending}>{t("relay.shareEncryptedReference")}</Button>
     </form>}
     {tab==='inbox'&&<>
      {!view.objects.length?<p>{t("relay.noSharedReferencesYet")}</p>:<div className={styles.row}>{view.objects.map(o=><Button key={o.id} translate="no" aria-pressed={selected===o.id} onClick={()=>{setSelected(o.id);setFirst('');setSecond('');setText('');setMentions([]);}}>{o.subject.title}</Button>)}</div>}
      {object&&<article data-testid="relay-object"><h3 translate="no">{object.subject.title}</h3><p>{object.kind in KIND ? t(KIND[object.kind]) : object.kind} · <span translate="no">{object.subject.reference}</span> · <span translate="no">{object.subject.currency}</span> {fmt.currency(object.subject.amountMinor, object.subject.currency)}</p><p>{t("relay.sharedByRequiredApprovals", { author: label(object.author), count: Number(object.requiredLevels) })}</p>
       {canRequest&&<form onSubmit={e=>{e.preventDefault();void run('relayRequest',{id:object.id,approvers:object.requiredLevels===2?[first,second]:[first]},msg("relay.note11"));}}><Field label={t("relay.pricingOwnerApprover")}><select value={first} onChange={e=>setFirst(e.target.value)} required><option value="">{t("relay.chooseADifferentPerson")}</option>{admins.map(d=><option key={d.userId} value={d.userId}>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}</option>)}</select></Field>{object.requiredLevels===2&&<Field label={t("relay.secondLevelManager")}><select value={second} onChange={e=>setSecond(e.target.value)} required><option value="">{t("relay.chooseAnotherPerson")}</option>{admins.filter(d=>d.userId!==first).map(d=><option key={d.userId} value={d.userId}>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}</option>)}</select></Field>}<Button variant="primary" type="submit" disabled={busy}>{t("relay.requestApproval")}</Button></form>}
       {request&&<><p role="status">{t("relay.approvalOfLevelsDecided", { status: request.status in STATUS ? t(STATUS[request.status]) : request.status, decided: request.decisions.length, count: request.approvers.length })}</p>{canDecide&&<div className={styles.row}><Button variant="primary" disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'approve'},msg("relay.note12"))}>{t("relay.approveLevel", { level: request.decisions.length+1 })}</Button><Button disabled={busy} onClick={()=>void run('relayDecide',{id:object.id,decision:'reject'},msg("relay.note13"))}>{t("relay.rejectRequestFinal")}</Button></div>}</>}
       <h4>{t("relay.commentsAndMentions")}</h4>{object.comments.map(c=><p key={c.id}><strong translate="no">{label(c.author)}</strong>{t("common.definitionSeparator")}<span translate="no">{c.text}</span>{c.mentions.includes(userId)&&<Badge tone="accent">{t("relay.mentionsYou")}</Badge>}</p>)}
       <form onSubmit={e=>{e.preventDefault();void run('relayComment',{id:object.id,text,mentions},msg("relay.note14")).then(ok=>{if(ok){setText('');setMentions([]);}});}}><Field label={t("relay.comment")}><textarea value={text} onChange={e=>setText(e.target.value)} maxLength={4000} required rows={3}/></Field><fieldset className={styles.relayChecks}><legend>{t("relay.mentionPeople")}</legend>{people.filter(p=>p.userId!==userId).map(p=><label key={p.userId}><input type="checkbox" checked={mentions.includes(p.userId)} onChange={e=>setMentions(check(mentions,p.userId,e.target.checked))}/><span translate="no">@{p.label}</span></label>)}</fieldset><Button variant={!canDecide&&!canRequest?'primary':'secondary'} type="submit" disabled={busy}>{t("relay.sendEncryptedComment")}</Button></form>
      </article>}
     </>}
     </div>
    </>}
   </>}
  </dialog>
 </Card>;
}
function DeviceChecks({view,confirmed,setConfirmed,disabled}:{view:RelayView;confirmed:string[];setConfirmed:(v:string[])=>void;disabled:boolean}){
 return <fieldset className={styles.relayChecks}><legend>{t("relay.verifiedDeviceFingerprints")}</legend>{view.devices.map(d=><label key={d.deviceId}><input type="checkbox" disabled={disabled} checked={confirmed.includes(d.deviceId)} onChange={e=>setConfirmed(e.target.checked?[...confirmed,d.deviceId]:confirmed.filter(id=>id!==d.deviceId))}/><span>{t("relay.personRole", { name: d.label, role: relayRole(d.role) })}<br/><code>{d.fingerprint}</code><br/>{t("relay.iVerifiedThisFingerprint")}</span></label>)}</fieldset>;
}
