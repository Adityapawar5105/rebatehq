import {admin,DirectorySchema,PageSchema,RelayError,ShareInputSchema,ZERO_HASH,levelsFor,fail,type Content,type Directory,type Epoch,type Grid,type RelayEvent,type ShareInput} from './protocol';
import {ALL_PACKS} from '../sharing/catalog';
import {generateIdentity,verifyDevice,fingerprint,newEpoch,verifyEpoch,unwrapEpoch,unwrapPacks,encryptEvent,verifyEvent,decryptEvent,type Identity} from './crypto';
import {fold,ensureOperation,type Applied,type Shared} from './state';
import type {RelayTransport} from './http';
import { msg } from "../i18n/core";
import {syncStatus} from './sync-status';
export type RelayState={version:'1';lastSyncedAt?:string;identity:Identity|null;retired:Identity[];epochs:{epoch:Epoch;key:string;packs?:Record<string,string>}[];start:{sequence:string;hash:string};head:{sequence:string;hash:string};entries:Applied[];pending:RelayEvent|null;pendingEpoch:{epoch:Epoch;key:string}|null};
export type RelayView={sync:{status:'synced'|'pending'|'conflict';lastSyncedAt:string|null};registered:boolean;joined:boolean;deviceId:string;fingerprint:string;role:string;devices:{deviceId:string;userId:string;label:string;role:string;fingerprint:string}[];head:{sequence:string;hash:string;epoch:string};administratorFingerprint:string;canStart:boolean;rotationRequired:boolean;pending:boolean;objects:Shared[];rejected:string[];packs:string[];grid:{namedOwner:string|null;people:{userId:string;role:string}[]}|null;ownerDevices:number};
export function emptyRelay():RelayState{return {version:'1',identity:null,retired:[],epochs:[],start:{sequence:'0',hash:ZERO_HASH},head:{sequence:'0',hash:ZERO_HASH},entries:[],pending:null,pendingEpoch:null};}
export class RelaySession{
 private directory:Directory|null=null;
 constructor(private scope:{tenantId:string;userId:string;deviceId:string},private state:RelayState,private transport:RelayTransport,private save:(state:RelayState,stage:string)=>Promise<void>,private signal:AbortSignal){
  if(state.version!=='1'||state.entries.length>10000||state.epochs.length>256)fail();
  if(state.identity&&(state.identity.device.tenantId!==scope.tenantId||state.identity.device.userId!==scope.userId))fail();
 }
 private currentIdentity(){const i=this.state.identity;if(!i||i.device.deviceId!==this.scope.deviceId)throw new RelayError('DEVICE',msg("relay.err.setUpSharingOn"));return i;}
 private last(){return this.state.epochs.at(-1)??null;}
 private async persist(stage:string){this.signal.throwIfAborted();await this.save(this.state,stage);}
 private async loadDirectory(){
  this.signal.throwIfAborted();const d=DirectorySchema.parse(await this.transport.directory());
  for(const peer of d.devices){const {role:_role,label:_label,...device}=peer;await verifyDevice(device);if(device.tenantId!==this.scope.tenantId)fail();}
  if(d.devices.some((v,i)=>i>0&&d.devices[i-1].deviceId>=v.deviceId))fail();
  const last=this.last();if(last&&(!d.latest||BigInt(d.latest.number)<BigInt(last.epoch.number)))fail(msg("relay.err.theRelayReturnedAn"));
  if(last&&d.latest?.number===last.epoch.number&&d.latest.hash!==last.epoch.hash)fail();
  this.directory=d;return d;
 }
 private rosterMatches(d:Directory){const latest=this.last()?.epoch;return !!latest&&latest.members.length===d.devices.length&&latest.members.every((m,i)=>{const v=d.devices[i];return m.deviceId===v.deviceId&&m.userId===v.userId&&m.role===v.role&&m.ecdh===v.ecdh&&m.signing===v.signing;});}
 async view(){const d=this.directory??await this.loadDirectory(),identity=this.state.identity,current=d.devices.find(p=>p.deviceId===this.scope.deviceId&&p.userId===this.scope.userId),last=this.last(),signer=d.latest?.members.find(m=>m.deviceId===d.latest!.signerDevice),derived=fold(this.state.entries,this.state.epochs.map(e=>e.epoch));
  return {sync:syncStatus({head:this.state.head,remote:d.head,pending:this.state.pending,pendingEpoch:!!this.state.pendingEpoch,rejected:derived.rejected.length,lastSyncedAt:this.state.lastSyncedAt}),registered:!!identity&&identity.device.deviceId===this.scope.deviceId&&!!current,joined:!!last,deviceId:this.scope.deviceId,fingerprint:identity?await fingerprint(identity.device):'',role:current?.role??'',devices:await Promise.all(d.devices.map(async v=>({deviceId:v.deviceId,userId:v.userId,label:v.label??v.userId,role:v.role,fingerprint:await fingerprint(v)}))),head:{...this.state.head,epoch:last?.epoch.number??'0'},administratorFingerprint:signer?await fingerprint(signer):'',canStart:!d.latest&&!!current&&admin(current.role),rotationRequired:!!last&&!this.rosterMatches(d),pending:!!this.state.pending||!!this.state.pendingEpoch,objects:derived.objects.slice(0,100).map(o=>({...o,comments:o.comments.slice(-100)})),rejected:derived.rejected,
   packs:ALL_PACKS.filter(p=>!!last?.packs?.[p]),grid:last?.epoch.v==='2'?{namedOwner:last.epoch.grid.namedOwner,people:last.epoch.grid.people.map(p=>({userId:p.userId,role:p.role}))}:null,
   ownerDevices:d.devices.filter(v=>last?.epoch.v==='2'?last.epoch.grid.people.some(p=>p.userId===v.userId&&p.role==='owner'):v.role==='owner').length};
 }
 async register(){
  if(!this.state.identity||this.state.identity.device.deviceId!==this.scope.deviceId){
   if(this.state.identity){if(this.state.retired.length>=10)throw new RelayError('LIMIT',msg("relay.err.thisVaultAlreadyRetains"));this.state.retired.push(this.state.identity);}
   this.state.identity=await generateIdentity(this.scope.tenantId,this.scope.userId,this.scope.deviceId);
  }
  await this.persist('device_registration_pending');await this.transport.post({action:'register',device:this.currentIdentity().device});await this.loadDirectory();return this.view();
 }
 private async keyFor(epoch:Epoch){for(const identity of [this.currentIdentity(),...this.state.retired]){try{return await unwrapEpoch(identity,epoch);}catch{/* Only identities from this encrypted vault are tried. */}}throw new RelayError('KEY',msg("relay.err.thisDeviceWasNot"));}
 async join(administratorFingerprint:string){
  if(this.last())return this.sync();this.currentIdentity();const d=await this.loadDirectory();if(!d.latest)throw new RelayError('KEY',msg("relay.err.askAnAdministratorTo"));
  const pin=administratorFingerprint.replace(/[\s-]/g,'').toLowerCase();if(!/^[a-f0-9]{64}$/.test(pin))throw new RelayError('VERIFY',msg("relay.err.enterTheAdministratorFingerprint"));
  const epoch=await verifyEpoch(d.latest,null,pin),key=await this.keyFor(epoch);this.state.epochs=[{epoch,key,packs:await this.packsFor(epoch)}];this.state.start={sequence:epoch.baseSequence,hash:epoch.baseHash};this.state.head={...this.state.start};await this.persist('workspace_joined');return this.sync();
 }
 /** Team sharing S2: this device's pack keys from a format 2 epoch (none from format 1). */
 private async packsFor(epoch:Epoch):Promise<Record<string,string>>{return epoch.v==='2'?await unwrapPacks(this.currentIdentity(),epoch) as Record<string,string>:{};}
 /** The signed grid of the latest epoch, if the workspace has one. */
 grid():Grid|null{const e=this.last()?.epoch;return e?.v==='2'?e.grid:null;}
 /** gridFor (team sharing S2) builds the grid for the people on the roster; without it the epoch stays format 1. */
 async rotate(confirmations:{deviceId:string;fingerprint:string}[],gridFor?:(userIds:string[],previous:Grid|null)=>Grid){
  this.currentIdentity();if(this.last())await this.sync();const d=await this.loadDirectory(),you=d.devices.find(p=>p.deviceId===this.scope.deviceId);
  if(this.state.pending||this.state.pendingEpoch)throw new RelayError('NETWORK',msg("relay.err.syncOrExplicitlyDiscard"));
  if(!you||!admin(you.role)||(!this.last()&&d.latest))throw new RelayError('ACCESS',msg("relay.err.joinFirstOnlyAn"));
  if(confirmations.length!==d.devices.length||new Set(confirmations.map(v=>v.deviceId)).size!==confirmations.length)throw new RelayError('VERIFY',msg("relay.err.verifyEveryDeviceFingerprint"));
  for(const p of d.devices)if(confirmations.find(c=>c.deviceId===p.deviceId)?.fingerprint!==await fingerprint(p))throw new RelayError('VERIFY',msg("relay.err.theDeviceListChanged"));
  const users=[...new Set(d.devices.map(v=>v.userId))].sort(),previousGrid=d.latest?.v==='2'?d.latest.grid:null;
  const next=await newEpoch(this.currentIdentity(),d.devices,d.latest,d.head,gridFor?gridFor(users,previousGrid):undefined);this.state.pendingEpoch=next;await this.persist('key_publication_pending');await this.transport.post({action:'epoch',epoch:next.epoch});return this.sync();
 }
 async sync():Promise<RelayView>{
  this.currentIdentity();const directory=await this.loadDirectory();
  if(!this.last()){
   const pending=this.state.pendingEpoch;
   if(!pending)return this.view();
   // Our own signed first publication is already a trusted local root, even if
   // its HTTP acknowledgement was lost. It must actually appear in the log.
   const page=PageSchema.parse(await this.transport.page('0','0')),observed=page.epochs.find(e=>e.id===pending.epoch.id&&e.hash===pending.epoch.hash);
   if(!observed)throw new RelayError('NETWORK',msg("relay.err.theKeyPublicationIs"));
   await verifyEpoch(observed,null,await fingerprint(this.currentIdentity().device));this.state.epochs=[{epoch:observed,key:await this.keyFor(observed),packs:await this.packsFor(observed)}];this.state.start={sequence:observed.baseSequence,hash:observed.baseHash};this.state.head={...this.state.start};this.state.pendingEpoch=null;
  }
  for(let round=0;round<410;round++){
   this.signal.throwIfAborted();const page=PageSchema.parse(await this.transport.page(this.state.head.sequence,this.last()!.epoch.number));
   if(BigInt(page.head.sequence)<BigInt(this.state.head.sequence)||BigInt(page.latestEpoch)<BigInt(this.last()!.epoch.number))fail();
   for(const record of page.epochs){
    const prior=this.last()!.epoch,epoch=await verifyEpoch(record,prior);this.state.epochs.push({epoch,key:await this.keyFor(epoch),packs:await this.packsFor(epoch)});
    if(this.state.pendingEpoch?.epoch.id===epoch.id){if(this.state.pendingEpoch.epoch.hash!==epoch.hash)fail();this.state.pendingEpoch=null;}
   }
   for(const item of page.events){
    this.signal.throwIfAborted();const entry=this.state.epochs.find(e=>e.epoch.id===item.epochId);if(!entry)fail();
    const e=await verifyEvent(item,entry.epoch,this.state.head);
    const expected=this.state.epochs.filter(p=>BigInt(p.epoch.baseSequence)<BigInt(e.sequence)).at(-1);if(expected?.epoch.id!==e.epochId)fail();
    // Signature/hash verification above is mandatory. An authentic participant
    // can submit invalid encrypted content: quarantine it without applying an
    // approval, so one member cannot permanently poison the workspace log.
    let content:Content|null=null;try{content=await decryptEvent(e,entry.key);}catch(error){if(!(error instanceof RelayError&&['CONTENT','DECRYPT'].includes(error.code)))throw error;}
    this.state.entries.push({event:e,content});this.state.head={sequence:e.sequence,hash:e.hash};
    if(this.state.pending?.id===e.id){if(this.state.pending.hash!==e.hash)fail();this.state.pending=null;}
   }
   for(const {epoch} of this.state.epochs){
    if(BigInt(epoch.baseSequence)<=BigInt(this.state.head.sequence)){
     const base=epoch.baseSequence===this.state.start.sequence?this.state.start.hash:this.state.entries.find(e=>e.event.sequence===epoch.baseSequence)?.event.hash;
     if(base!==epoch.baseHash)fail();
    }
   }
   if(this.state.head.sequence===page.head.sequence&&this.last()!.epoch.number===page.latestEpoch){if(this.state.head.hash!==page.head.hash)fail();this.state.lastSyncedAt=new Date().toISOString();await this.persist('inbox_synced');await this.loadDirectory();return this.view();}
   if(!page.events.length&&!page.epochs.length)fail(msg("relay.err.theRelayOmittedPart"));
  }
  throw new RelayError('LIMIT',msg("relay.err.sharingExceededItsHistory"));
 }
 private object(id:string){const object=fold(this.state.entries,this.state.epochs.map(e=>e.epoch)).objects.find(o=>o.id===id);if(!object)throw new RelayError('CONTENT',msg("relay.err.syncThisSharedReference"));return object;}
 private async send(objectId:string,objectKind:RelayEvent['objectKind'],content:Content,recipients:string[]=[],mentions:string[]=[]){
  await this.sync();const d=this.directory!;if(!this.rosterMatches(d))throw new RelayError('ROTATE',msg("relay.err.anAdministratorMustRotate"));
  if(this.state.pending)throw new RelayError('NETWORK',msg("relay.err.anItemIsStill"));
  const last=this.last()!,event=await encryptEvent(this.currentIdentity(),last.epoch,last.key,this.state.head,objectId,objectKind,content,recipients,mentions);
  ensureOperation(this.state.entries,this.state.epochs.map(e=>e.epoch),event,content);this.state.pending=event;await this.persist('send_pending');
  await this.transport.post({action:'event',event});return this.sync();
 }
 async retry(){
  if(this.state.pendingEpoch){await this.persist('key_publication_pending');await this.transport.post({action:'epoch',epoch:this.state.pendingEpoch.epoch});return this.sync();}
  await this.sync();
  const event=this.state.pending;if(!event)return this.view();
  if(event.senderDevice!==this.scope.deviceId)throw new RelayError('DEVICE',msg("relay.err.thisPendingSendBelongs"));
  // Never re-sign a changed history automatically. If another append won the
  // sequence, keep the pending item for an explicit discard/recreate decision.
  await this.transport.post({action:'event',event});return this.sync();
 }
 async discard(){this.state.pending=null;this.state.pendingEpoch=null;await this.persist('pending_discarded');return this.view();}
 async share(input:ShareInput){const subject=ShareInputSchema.parse(input);return this.send(crypto.randomUUID(),subject.objectKind,{kind:'share',subject});}
 async request(id:string,approvers:string[]){await this.sync();const o=this.object(id);return this.send(id,o.kind,{kind:'request',subjectHash:o.hash,approvers},approvers);}
 async decide(id:string,decision:'approve'|'reject'){await this.sync();const o=this.object(id),r=o.approval;if(!r)throw new RelayError('CONTENT',msg("relay.err.thisReferenceHasNo"));return this.send(id,o.kind,{kind:'decision',requestId:r.id,requestHash:r.hash,level:String(r.decisions.length+1) as '1'|'2',decision},[r.requester,...r.approvers].filter(u=>u!==this.scope.userId));}
 async comment(id:string,text:string,mentions:string[]){await this.sync();const o=this.object(id);return this.send(id,o.kind,{kind:'comment',text},mentions,mentions);}
}
