import {admin,DirectorySchema,PageSchema,RelayError,ShareInputSchema,ZERO_HASH,levelsFor,fail,type Content,type Directory,type Epoch,type Grid,type RelayEvent,type ShareInput} from './protocol';
import {ALL_PACKS} from '../sharing/catalog';
import {generateIdentity,verifyDevice,fingerprint,newEpoch,verifyEpoch,unwrapEpoch,unwrapPacks,encryptEvent,verifyEvent,decryptEvent,encryptPackVersion,verifyPackVersion,decryptPackVersion,gridPublisher,base64,unbase64,type Identity,sealThread,openThread} from './crypto';
import type { AnyPack } from '../sharing/catalog';
import { foldThreads, holders, THREAD_OBJECT_KIND, TARGET_PACK, type Target, type TaskState, type ThreadBody, type SealedState } from '../sharing/threads';
import {PackPageSchema,type PackVersion} from './protocol';
import {sealPack,openPack,openDelta} from '../sharing/publish';
import type {DeltaData} from '../sharing/delta';
import type {PackData,PackId} from '../sharing/packs';
import {fold,ensureOperation,type Applied,type Shared} from './state';
import type {RelayTransport} from './http';
import { msg } from "../i18n/core";
/** Team sharing S4: how long a pack version may lack its chunks before that counts as a failure (uploads take seconds). */
export const NOT_READY_MS = 15 * 60_000;
import {syncStatus} from './sync-status';
export type RelayState={version:'1';lastSyncedAt?:string;identity:Identity|null;retired:Identity[];epochs:{epoch:Epoch;key:string;packs?:Record<string,string>}[];start:{sequence:string;hash:string};head:{sequence:string;hash:string};entries:Applied[];pending:RelayEvent|null;pendingEpoch:{epoch:Epoch;key:string}|null;
 /** Team sharing S5a: the log position up to which this person has seen their inbox. */
 inboxSeen?:string;
 /** Team sharing S3a: grid edits an Owner made on this device, signed at the next rotation (never sent before). */
 gridDraft?:Grid;
 /** The hash of the signed epoch the draft was edited from; a draft from an older grid is never signed (security review). */
 gridDraftBase?:string;
 /** Team sharing S3: the last verified version of each pack's chain, and the version this vault last applied. */
 packHeads?:Record<string,{version:string;hash:string}>;packApplied?:Record<string,string>};
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
  return {sync:syncStatus({head:this.state.head,remote:d.head,pending:this.state.pending,pendingEpoch:!!this.state.pendingEpoch,rejected:derived.rejected.length+foldThreads(this.state.entries,this.state.epochs.map(e=>e.epoch)).rejected.length,lastSyncedAt:this.state.lastSyncedAt}),registered:!!identity&&identity.device.deviceId===this.scope.deviceId&&!!current,joined:!!last,deviceId:this.scope.deviceId,fingerprint:identity?await fingerprint(identity.device):'',role:current?.role??'',devices:await Promise.all(d.devices.map(async v=>({deviceId:v.deviceId,userId:v.userId,label:v.label??v.userId,role:v.role,fingerprint:await fingerprint(v)}))),head:{...this.state.head,epoch:last?.epoch.number??'0'},administratorFingerprint:signer?await fingerprint(signer):'',canStart:!d.latest&&!!current&&admin(current.role),rotationRequired:!!last&&!this.rosterMatches(d),pending:!!this.state.pending||!!this.state.pendingEpoch,objects:derived.objects.slice(0,100).map(o=>({...o,comments:o.comments.slice(-100)})),rejected:derived.rejected,
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
  // S5a: an older version of the app quarantined content kinds it did not know (thread events); read them again now.
  for(const entry of this.state.entries){
   if(entry.content)continue;const keys=this.state.epochs.find(x=>x.epoch.id===entry.event.epochId);if(!keys)continue;
   try{entry.content=await decryptEvent(entry.event,keys.key);entry.sealed=await this.openSealed(entry.event,entry.content,keys.packs);}catch(error){if(!(error instanceof RelayError&&['CONTENT','DECRYPT'].includes(error.code)))throw error;}
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
    const sealed=content?await this.openSealed(e,content,entry.packs):undefined;
    this.state.entries.push(sealed?{event:e,content,sealed}:{event:e,content});this.state.head={sequence:e.sequence,hash:e.hash};
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
 private async send(objectId:string,objectKind:RelayEvent['objectKind'],content:Content|((last:{epoch:Epoch;key:string;packs?:Record<string,string>},id:string)=>Promise<{content:Content;sealed:SealedState}>),recipients:string[]=[],mentions:string[]=[]){
  await this.sync();const d=this.directory!;if(!this.rosterMatches(d))throw new RelayError('ROTATE',msg("relay.err.anAdministratorMustRotate"));
  if(this.state.pending)throw new RelayError('NETWORK',msg("relay.err.anItemIsStill"));
  const last=this.last()!,id=crypto.randomUUID(),built=typeof content==='function'?await content(last,id):{content,sealed:undefined};
  const event=await encryptEvent(this.currentIdentity(),last.epoch,last.key,this.state.head,objectId,objectKind,built.content,recipients,mentions,id);
  ensureOperation(this.state.entries,this.state.epochs.map(e=>e.epoch),event,built.content);
  if(built.sealed&&foldThreads([...this.state.entries,{event,content:built.content,sealed:built.sealed}],this.state.epochs.map(e=>e.epoch)).rejected.includes(event.id))throw new RelayError('CONTENT',msg("relay.state.anInvalidSharedOperation"));
  this.state.pending=event;await this.persist('send_pending');
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
 // ---- Team sharing S5a: threads and tasks (lib/sharing/threads.ts) ----
 private async openSealed(e:RelayEvent,content:Content,packs:Record<string,string>|undefined):Promise<SealedState|undefined>{
  if(content.kind!=='thread')return undefined;const key=packs?.[content.pack];if(!key)return {state:'nokey'};
  try{return {state:'ok',body:await openThread(key,{eventId:e.id,tenantId:e.tenantId,epochId:e.epochId,objectId:e.objectId,pack:content.pack,senderUser:e.senderUser},content)};}
  catch(error){if(error instanceof RelayError&&['CONTENT','DECRYPT'].includes(error.code))return {state:'bad'};throw error;}
 }
 /** Threads this device can read, folded from the local log (no network). */
 threads(){return foldThreads(this.state.entries,this.state.epochs.map(e=>e.epoch));}
 inboxSeen(){return this.state.inboxSeen??'0';}
 async markInboxSeen(){this.state.inboxSeen=this.state.head.sequence;await this.persist('inbox_seen');}
 private sealedSend(objectId:string,pack:AnyPack,body:ThreadBody,mentions:string[],recipients:string[]){
  return this.send(objectId,THREAD_OBJECT_KIND,async(last,id)=>{
   if(last.epoch.v!=='2')throw new RelayError('ROTATE',msg("relay.err.anAdministratorMustRotate"));
   const key=last.packs?.[pack];if(!key)throw new RelayError('ACCESS',msg("relay.http.sharingRequiresAnApproved"));
   // Everyone mentioned or assigned must be able to read the thread (hold the pack under this epoch).
   const allowed=holders(last.epoch,pack);if([...mentions,...recipients].some(u=>!allowed.has(u)))throw new RelayError('CONTENT',msg("thread.err.cannotRead"));
   const sealed=await sealThread(key,{eventId:id,tenantId:this.scope.tenantId,epochId:last.epoch.id,objectId,pack,senderUser:this.scope.userId},body);
   return {content:{kind:'thread',pack,iv:sealed.iv,body:sealed.body},sealed:{state:'ok',body}};
  },[...recipients,...mentions].filter(u=>u!==this.scope.userId),mentions.filter(u=>u!==this.scope.userId));
 }
 private thread(id:string){const t=this.threads().threads.find(x=>x.id===id);if(!t)throw new RelayError('CONTENT',msg("thread.err.notFound"));return t;}
 async threadOpen(target:Target,text:string,mentions:string[],task:TaskState|null){
  await this.sync();return this.sealedSend(crypto.randomUUID(),TARGET_PACK[target.type],{kind:'open',target,text,task},mentions,task?.assignee?[task.assignee]:[]);
 }
 async threadReply(id:string,text:string,mentions:string[]){await this.sync();const t=this.thread(id);return this.sealedSend(id,t.pack,{kind:'reply',text},mentions,[]);}
 async threadStatus(id:string,resolved:boolean){await this.sync();const t=this.thread(id);return this.sealedSend(id,t.pack,{kind:'status',resolved},[],[]);}
 async threadTask(id:string,task:TaskState){await this.sync();const t=this.thread(id);return this.sealedSend(id,t.pack,{kind:'task',task},[],task.assignee?[task.assignee]:[]);}
 // ---- Team sharing S3: publishing and receiving data packs (SHARING_DESIGN.md section 5) ----
 private packTransport(){const t=this.transport;if(!t.packPage||!t.chunks)throw new RelayError('NETWORK',msg("relay.http.sharingIsUnavailableYour"));return {page:t.packPage.bind(t),chunks:t.chunks};}
 private chunkPath(pack:string,versionId:string,n:number){return this.scope.tenantId+'/'+pack+'/'+versionId+'/'+n;}
 /** Publish a full copy of one pack under the latest epoch. Only a grid publisher whose device holds the pack can. */
 async packPublish(pack:PackId,data:PackData,delta?:{data:DeltaData;baseHash:string}){
  await this.sync();const last=this.last(),me=this.currentIdentity(),t=this.packTransport();
  if(!last||last.epoch.v!=='2')throw new RelayError('ROTATE',msg("relay.err.anAdministratorMustRotate"));
  const key=last.packs?.[pack];if(!key||!gridPublisher(last.epoch.grid,me.device.userId))throw new RelayError('ACCESS',msg("relay.http.sharingRequiresAnApproved"));
  const head=PackPageSchema.parse(await t.page(pack,this.state.packHeads?.[pack]?.version??'0')).head,id=crypto.randomUUID();
  // S4b: a delta only applies to exactly the version it was made from; if another publisher went in between, send all.
  const asDelta=!!delta&&head.version===delta.data.base&&head.hash===delta.baseHash;
  const {chunks,manifest}=await sealPack(pack,asDelta?delta!.data:data,key,id);
  const version=await encryptPackVersion(me,last.epoch,key,head,pack,asDelta?'delta':'snapshot',asDelta?delta!.data.base:'0',manifest,id);
  await this.transport.post({action:'pack',pack:version});
  // Chunks are uploaded after the signed version exists: Storage only accepts chunks of a version this person signed.
  for(const c of chunks){const iv=unbase64(c.iv),ct=unbase64(c.ciphertext),body=new Uint8Array(iv.length+ct.length);body.set(iv);body.set(ct,iv.length);await t.chunks.put(this.chunkPath(pack,id,c.n),body);}
  (this.state.packHeads??={})[pack]={version:version.version,hash:version.hash};(this.state.packApplied??={})[pack]=version.version;
  await this.persist('pack_published');return {pack,epoch:last.epoch.id,version:version.version,hash:version.hash,kind:asDelta?'delta' as const:'snapshot' as const,rows:manifest.rows};
 }
 /**
  * Read one pack's chain from the version this vault last applied, checked end to end, and return what to apply: the
  * newest snapshot this device can open (when there is one after that point) and the contiguous chain of deltas after it
  * (S4b). A device anchors at the first version signed under an epoch it holds (versions before it joined cannot be
  * checked and are skipped; the anchor's signature covers the link to them); after that every version must verify, in
  * order, or nothing is applied. Nothing is persisted here: the vault calls packMarkApplied once its own write succeeded,
  * so a failed or interrupted apply is simply walked again.
  */
 async packReceive(pack:PackId):Promise<{version:string;createdAt:string;sender:string;head:{version:string;hash:string};steps:Array<{kind:'snapshot';version:string;data:PackData}|{kind:'delta';version:string;data:DeltaData}>}|null>{
  const t=this.packTransport(),start=this.state.packHeads?.[pack]??null;let head=start,after=head?.version??'0';const seen:Array<{v:PackVersion;key:string|null}>=[];
  for(let round=0;round<400;round++){
   this.signal.throwIfAborted();const page=PackPageSchema.parse(await t.page(pack,after));
   for(const raw of page.versions){
    const entry=this.state.epochs.find(e=>e.epoch.id===raw.epochId);
    if(!entry){if(head)fail();after=raw.version;continue;}
    const v=await verifyPackVersion(raw,entry.epoch,head??{version:(BigInt(raw.version)-BigInt(1)).toString(),hash:raw.previousHash});
    head={version:v.version,hash:v.hash};after=v.version;seen.push({v,key:entry.packs?.[pack]??null});
   }
   if(BigInt(after)>=BigInt(page.head.version)||!page.versions.length)break;
  }
  // From the newest snapshot this device can open, or else from what it last applied; stop at the first version it
  // cannot open or the first delta that does not follow the one before it (a later snapshot then starts again).
  let from=-1;for(let i=seen.length-1;i>=0;i--)if(seen[i].v.kind==='snapshot'&&seen[i].key){from=i;break;}
  const chosen:Array<{v:PackVersion;key:string}>=[];let prev:string|null=from>=0?null:start?.version??null;
  for(const e of seen.slice(Math.max(from,0))){
   if(!e.key)break;
   if(e.v.kind==='delta'&&(prev===null||e.v.baseVersion!==prev))break;
   chosen.push({v:e.v,key:e.key});prev=e.v.version;
  }
  if(!chosen.length){
   // Nothing here this device can use (versions under keys it does not hold): move past them so they are not walked again.
   if(seen.length&&seen.every(e=>!e.key)&&head){(this.state.packHeads??={})[pack]=head;await this.persist('pack_checked');}
   return null;
  }
  const steps:Array<{kind:'snapshot';version:string;data:PackData}|{kind:'delta';version:string;data:DeltaData}>=[];
  for(const {v,key} of chosen){
   const manifest=await decryptPackVersion(v,key),chunks=[];
   for(const c of manifest.chunks){let b:Uint8Array;
    // S4: the version row is written before its chunks, so a chunk missing within minutes of signing is still uploading.
    try{b=await t.chunks.get(this.chunkPath(pack,v.id,Number(c.n)));}catch(error){if(error instanceof RelayError&&error.code!=='LIMIT'&&Date.now()-Date.parse(v.createdAt)<NOT_READY_MS)throw new RelayError('NOT_READY',msg('relay.http.sharingIsUnavailableYour'));throw error;}
    if(b.length<29)fail();chunks.push({n:Number(c.n),iv:base64(b.subarray(0,12)),ciphertext:base64(b.subarray(12))});}
   steps.push(v.kind==='snapshot'?{kind:'snapshot',version:v.version,data:await openPack(pack,manifest,chunks,key,v.id)}:{kind:'delta',version:v.version,data:await openDelta(pack,manifest,chunks,key,v.id)});
  }
  const lastStep=chosen[chosen.length-1].v;
  return {version:lastStep.version,createdAt:lastStep.createdAt,sender:lastStep.senderUser,head:{version:lastStep.version,hash:lastStep.hash},steps};
 }
 /** Forget where this pack's walk stopped, so the next receive starts again from its newest snapshot (S4b recovery). */
 packReset(pack:string){if(this.state.packHeads)delete this.state.packHeads[pack];if(this.state.packApplied)delete this.state.packApplied[pack];}
 /** Record that this vault applied a pack version (after the vault's own audited write succeeded). */
 async packMarkApplied(pack:string,version:string,head?:{version:string;hash:string}){(this.state.packApplied??={})[pack]=version;if(head)(this.state.packHeads??={})[pack]=head;await this.persist('pack_applied');}
 /** The packs this device holds keys for in the latest epoch. */
 heldPacks(){return Object.keys(this.last()?.packs??{});}
 /** The epoch this device would publish under now (S4b: a delta never crosses epochs). */
 epochId(){return this.last()?.epoch.id??null;}
 isPublisher(){const e=this.last()?.epoch;return e?.v==='2'&&gridPublisher(e.grid,this.scope.userId);}
}
