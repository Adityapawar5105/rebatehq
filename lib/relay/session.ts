import {admin,DirectorySchema,PageSchema,RelayError,ShareInputSchema,ZERO_HASH,levelsFor,fail,type Content,type Directory,type Epoch,type RelayEvent,type ShareInput} from './protocol';
import {generateIdentity,verifyDevice,fingerprint,newEpoch,verifyEpoch,unwrapEpoch,encryptEvent,verifyEvent,decryptEvent,type Identity} from './crypto';
import {fold,ensureOperation,type Applied,type Shared} from './state';
import type {RelayTransport} from './http';
export type RelayState={version:'1';identity:Identity|null;retired:Identity[];epochs:{epoch:Epoch;key:string}[];start:{sequence:string;hash:string};head:{sequence:string;hash:string};entries:Applied[];pending:RelayEvent|null;pendingEpoch:{epoch:Epoch;key:string}|null};
export type RelayView={registered:boolean;joined:boolean;deviceId:string;fingerprint:string;role:string;devices:{deviceId:string;userId:string;label:string;role:string;fingerprint:string}[];head:{sequence:string;hash:string;epoch:string};administratorFingerprint:string;canStart:boolean;rotationRequired:boolean;pending:boolean;objects:Shared[];rejected:string[]};
export function emptyRelay():RelayState{return {version:'1',identity:null,retired:[],epochs:[],start:{sequence:'0',hash:ZERO_HASH},head:{sequence:'0',hash:ZERO_HASH},entries:[],pending:null,pendingEpoch:null};}
export class RelaySession{
 private directory:Directory|null=null;
 constructor(private scope:{tenantId:string;userId:string;deviceId:string},private state:RelayState,private transport:RelayTransport,private save:(state:RelayState,stage:string)=>Promise<void>,private signal:AbortSignal){
  if(state.version!=='1'||state.entries.length>10000||state.epochs.length>256)fail();
  if(state.identity&&(state.identity.device.tenantId!==scope.tenantId||state.identity.device.userId!==scope.userId))fail();
 }
 private currentIdentity(){const i=this.state.identity;if(!i||i.device.deviceId!==this.scope.deviceId)throw new RelayError('DEVICE','Set up sharing on this approved device first.');return i;}
 private last(){return this.state.epochs.at(-1)??null;}
 private async persist(stage:string){this.signal.throwIfAborted();await this.save(this.state,stage);}
 private async loadDirectory(){
  this.signal.throwIfAborted();const d=DirectorySchema.parse(await this.transport.directory());
  for(const peer of d.devices){const {role:_role,label:_label,...device}=peer;await verifyDevice(device);if(device.tenantId!==this.scope.tenantId)fail();}
  if(d.devices.some((v,i)=>i>0&&d.devices[i-1].deviceId>=v.deviceId))fail();
  const last=this.last();if(last&&(!d.latest||BigInt(d.latest.number)<BigInt(last.epoch.number)))fail('The relay returned an older workspace key. Compare verification heads with your administrator.');
  if(last&&d.latest?.number===last.epoch.number&&d.latest.hash!==last.epoch.hash)fail();
  this.directory=d;return d;
 }
 private rosterMatches(d:Directory){const latest=this.last()?.epoch;return !!latest&&latest.members.length===d.devices.length&&latest.members.every((m,i)=>{const v=d.devices[i];return m.deviceId===v.deviceId&&m.userId===v.userId&&m.role===v.role&&m.ecdh===v.ecdh&&m.signing===v.signing;});}
 async view(){const d=this.directory??await this.loadDirectory(),identity=this.state.identity,current=d.devices.find(p=>p.deviceId===this.scope.deviceId&&p.userId===this.scope.userId),last=this.last(),signer=d.latest?.members.find(m=>m.deviceId===d.latest!.signerDevice),derived=fold(this.state.entries,this.state.epochs.map(e=>e.epoch));
  return {registered:!!identity&&identity.device.deviceId===this.scope.deviceId&&!!current,joined:!!last,deviceId:this.scope.deviceId,fingerprint:identity?await fingerprint(identity.device):'',role:current?.role??'',devices:await Promise.all(d.devices.map(async v=>({deviceId:v.deviceId,userId:v.userId,label:v.label??v.userId,role:v.role,fingerprint:await fingerprint(v)}))),head:{...this.state.head,epoch:last?.epoch.number??'0'},administratorFingerprint:signer?await fingerprint(signer):'',canStart:!d.latest&&!!current&&admin(current.role),rotationRequired:!!last&&!this.rosterMatches(d),pending:!!this.state.pending||!!this.state.pendingEpoch,objects:derived.objects.slice(0,100).map(o=>({...o,comments:o.comments.slice(-100)})),rejected:derived.rejected};
 }
 async register(){
  if(!this.state.identity||this.state.identity.device.deviceId!==this.scope.deviceId){
   if(this.state.identity){if(this.state.retired.length>=10)throw new RelayError('LIMIT','This vault already retains ten old device identities. Keep an encrypted backup and ask your operator for help.');this.state.retired.push(this.state.identity);}
   this.state.identity=await generateIdentity(this.scope.tenantId,this.scope.userId,this.scope.deviceId);
  }
  await this.persist('device_registration_pending');await this.transport.post({action:'register',device:this.currentIdentity().device});await this.loadDirectory();return this.view();
 }
 private async keyFor(epoch:Epoch){for(const identity of [this.currentIdentity(),...this.state.retired]){try{return await unwrapEpoch(identity,epoch);}catch{/* Only identities from this encrypted vault are tried. */}}throw new RelayError('KEY','This device was not added to this key epoch. Ask a trusted administrator to rotate.');}
 async join(administratorFingerprint:string){
  if(this.last())return this.sync();this.currentIdentity();const d=await this.loadDirectory();if(!d.latest)throw new RelayError('KEY','Ask an administrator to start sharing first.');
  const pin=administratorFingerprint.replace(/[\s-]/g,'').toLowerCase();if(!/^[a-f0-9]{64}$/.test(pin))throw new RelayError('VERIFY','Enter the administrator fingerprint you verified through a separate trusted channel.');
  const epoch=await verifyEpoch(d.latest,null,pin),key=await this.keyFor(epoch);this.state.epochs=[{epoch,key}];this.state.start={sequence:epoch.baseSequence,hash:epoch.baseHash};this.state.head={...this.state.start};await this.persist('workspace_joined');return this.sync();
 }
 async rotate(confirmations:{deviceId:string;fingerprint:string}[]){
  this.currentIdentity();if(this.last())await this.sync();const d=await this.loadDirectory(),you=d.devices.find(p=>p.deviceId===this.scope.deviceId);
  if(this.state.pending||this.state.pendingEpoch)throw new RelayError('NETWORK','Sync or explicitly discard the pending operation before preparing another key publication.');
  if(!you||!admin(you.role)||(!this.last()&&d.latest))throw new RelayError('ACCESS','Join first; only an existing trusted workspace administrator may rotate keys.');
  if(confirmations.length!==d.devices.length||new Set(confirmations.map(v=>v.deviceId)).size!==confirmations.length)throw new RelayError('VERIFY','Verify every device fingerprint before publishing a workspace key.');
  for(const p of d.devices)if(confirmations.find(c=>c.deviceId===p.deviceId)?.fingerprint!==await fingerprint(p))throw new RelayError('VERIFY','The device list changed. Verify every fingerprint again.');
  const next=await newEpoch(this.currentIdentity(),d.devices,d.latest,d.head);this.state.pendingEpoch=next;await this.persist('key_publication_pending');await this.transport.post({action:'epoch',epoch:next.epoch});return this.sync();
 }
 async sync():Promise<RelayView>{
  this.currentIdentity();const directory=await this.loadDirectory();
  if(!this.last()){
   const pending=this.state.pendingEpoch;
   if(!pending)return this.view();
   // Our own signed first publication is already a trusted local root, even if
   // its HTTP acknowledgement was lost. It must actually appear in the log.
   const page=PageSchema.parse(await this.transport.page('0','0')),observed=page.epochs.find(e=>e.id===pending.epoch.id&&e.hash===pending.epoch.hash);
   if(!observed)throw new RelayError('NETWORK','The key publication is still pending. Retry after syncing with your administrator.');
   await verifyEpoch(observed,null,await fingerprint(this.currentIdentity().device));this.state.epochs=[{epoch:observed,key:await this.keyFor(observed)}];this.state.start={sequence:observed.baseSequence,hash:observed.baseHash};this.state.head={...this.state.start};this.state.pendingEpoch=null;
  }
  for(let round=0;round<410;round++){
   this.signal.throwIfAborted();const page=PageSchema.parse(await this.transport.page(this.state.head.sequence,this.last()!.epoch.number));
   if(BigInt(page.head.sequence)<BigInt(this.state.head.sequence)||BigInt(page.latestEpoch)<BigInt(this.last()!.epoch.number))fail();
   for(const record of page.epochs){
    const prior=this.last()!.epoch,epoch=await verifyEpoch(record,prior);this.state.epochs.push({epoch,key:await this.keyFor(epoch)});
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
   if(this.state.head.sequence===page.head.sequence&&this.last()!.epoch.number===page.latestEpoch){if(this.state.head.hash!==page.head.hash)fail();await this.persist('inbox_synced');await this.loadDirectory();return this.view();}
   if(!page.events.length&&!page.epochs.length)fail('The relay omitted part of the signed history. No incomplete approval was applied.');
  }
  throw new RelayError('LIMIT','Sharing exceeded its history limit. Nothing unverified was applied.');
 }
 private object(id:string){const object=fold(this.state.entries,this.state.epochs.map(e=>e.epoch)).objects.find(o=>o.id===id);if(!object)throw new RelayError('CONTENT','Sync this shared reference before acting on it.');return object;}
 private async send(objectId:string,objectKind:RelayEvent['objectKind'],content:Content,recipients:string[]=[],mentions:string[]=[]){
  await this.sync();const d=this.directory!;if(!this.rosterMatches(d))throw new RelayError('ROTATE','An administrator must rotate the workspace key after a membership or device change.');
  if(this.state.pending)throw new RelayError('NETWORK','An item is still pending. Sync or explicitly discard the pending send before creating another.');
  const last=this.last()!,event=await encryptEvent(this.currentIdentity(),last.epoch,last.key,this.state.head,objectId,objectKind,content,recipients,mentions);
  ensureOperation(this.state.entries,this.state.epochs.map(e=>e.epoch),event,content);this.state.pending=event;await this.persist('send_pending');
  await this.transport.post({action:'event',event});return this.sync();
 }
 async retry(){
  if(this.state.pendingEpoch){await this.persist('key_publication_pending');await this.transport.post({action:'epoch',epoch:this.state.pendingEpoch.epoch});return this.sync();}
  await this.sync();
  const event=this.state.pending;if(!event)return this.view();
  if(event.senderDevice!==this.scope.deviceId)throw new RelayError('DEVICE','This pending send belongs to an old device. Sync or explicitly discard it.');
  // Never re-sign a changed history automatically. If another append won the
  // sequence, keep the pending item for an explicit discard/recreate decision.
  await this.transport.post({action:'event',event});return this.sync();
 }
 async discard(){this.state.pending=null;this.state.pendingEpoch=null;await this.persist('pending_discarded');return this.view();}
 async share(input:ShareInput){const subject=ShareInputSchema.parse(input);return this.send(crypto.randomUUID(),subject.objectKind,{kind:'share',subject});}
 async request(id:string,approvers:string[]){await this.sync();const o=this.object(id);return this.send(id,o.kind,{kind:'request',subjectHash:o.hash,approvers},approvers);}
 async decide(id:string,decision:'approve'|'reject'){await this.sync();const o=this.object(id),r=o.approval;if(!r)throw new RelayError('CONTENT','This reference has no approval request.');return this.send(id,o.kind,{kind:'decision',requestId:r.id,requestHash:r.hash,level:String(r.decisions.length+1) as '1'|'2',decision},[r.requester,...r.approvers].filter(u=>u!==this.scope.userId));}
 async comment(id:string,text:string,mentions:string[]){await this.sync();const o=this.object(id);return this.send(id,o.kind,{kind:'comment',text},mentions,mentions);}
}
