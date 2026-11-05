import { admin,levelsFor,RelayError,type Content,type Epoch,type RelayEvent,type ShareInput } from './protocol';
import { msg } from "../i18n/core";
export type Applied = {event:RelayEvent;content:Content|null};
export type Approval = {id:string;hash:string;requester:string;approvers:string[];decisions:{userId:string;decision:'approve'|'reject';level:string}[];status:'pending'|'approved'|'rejected'};
export type Shared = {id:string;kind:RelayEvent['objectKind'];subject:ShareInput;author:string;hash:string;epochId:string;requiredLevels:1|2;approval:Approval|null;comments:{id:string;author:string;text:string;mentions:string[]}[];sequence:string};
function reject():never{throw new RelayError('CONTENT',msg("relay.state.anInvalidSharedOperation"));}
export function fold(entries:Applied[],epochs:Epoch[]){
 const objects=new Map<string,Shared>(),rejected:string[]=[];
 for(const {event:e,content:c} of entries){
  if(!c){rejected.push(e.id);continue;}
  try{
   const epoch=epochs.find(p=>p.id===e.epochId);if(!epoch)reject();
   if(c.kind==='share'){
    if(objects.has(e.objectId)||c.subject.objectKind!==e.objectKind)reject();
    objects.set(e.objectId,{id:e.objectId,kind:e.objectKind,subject:c.subject,author:e.senderUser,hash:e.hash,epochId:e.epochId,requiredLevels:levelsFor(c.subject.amountMinor,c.subject.preset),approval:null,comments:[],sequence:e.sequence});continue;
   }
   const object=objects.get(e.objectId);if(!object||object.kind!==e.objectKind)reject();
   if(c.kind==='comment')object.comments.push({id:e.id,author:e.senderUser,text:c.text,mentions:e.mentions});
   if(c.kind==='request'){
    const oldEpoch=epochs.find(p=>p.id===object.epochId),oldUsers=new Set(oldEpoch?.members.map(m=>m.userId));
    if(object.approval||e.senderUser!==object.author||c.subjectHash!==object.hash||c.approvers.length!==levelsFor(object.subject.amountMinor,object.subject.preset)||new Set(c.approvers).size!==c.approvers.length||c.approvers.includes(e.senderUser))reject();
    if(c.approvers.some(user=>!oldUsers.has(user)||!epoch.members.some(m=>m.userId===user&&admin(m.role))))reject();
    if(JSON.stringify([...c.approvers].sort())!==JSON.stringify(e.recipients))reject();
    object.approval={id:e.id,hash:e.hash,requester:e.senderUser,approvers:c.approvers,decisions:[],status:'pending'};
   }
   if(c.kind==='decision'){
    const request=object.approval;
    if(!request||request.status!=='pending'||c.requestId!==request.id||c.requestHash!==request.hash||e.senderUser===request.requester)reject();
    const index=request.decisions.length;
    if(c.level!==String(index+1)||request.approvers[index]!==e.senderUser||!epoch.members.some(m=>m.userId===e.senderUser&&admin(m.role)))reject();
    request.decisions.push({userId:e.senderUser,decision:c.decision,level:c.level});
    request.status=c.decision==='reject'?'rejected':request.decisions.length===request.approvers.length?'approved':'pending';
   }
   object.sequence=e.sequence;
  }catch(error){if(error instanceof RelayError&&error.code==='CONTENT')rejected.push(e.id);else throw error;}
 }
 return {objects:[...objects.values()].sort((a,b)=>BigInt(a.sequence)>BigInt(b.sequence)?-1:1),rejected};
}
export function ensureOperation(entries:Applied[],epochs:Epoch[],event:RelayEvent,content:Content){
 const result=fold([...entries,{event,content}],epochs);if(result.rejected.includes(event.id))reject();
}
