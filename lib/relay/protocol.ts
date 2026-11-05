import { z } from 'zod';
import { msg } from "../i18n/core";
export const RELAY_LIMITS = { messageBytes: 16_384, totalBytes: 16_777_216, events: 10_000, devices: 60, epochs: 256, page: 25, responseBytes: 3_145_728 } as const;
export const ZERO_HASH = '0'.repeat(64);
const uuid = z.string().uuid().transform(s => s.toLowerCase());
const counter = z.string().regex(/^(0|[1-9][0-9]{0,8})$/);
const positive = counter.refine(s => s !== '0');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
const b64 = (bytes: number) => z.string().max(Math.ceil(bytes / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).refine(s => { try { return atob(s).length === bytes && btoa(atob(s)) === s; } catch { return false; } });
const ciphertext = z.string().min(24).max(4 * Math.ceil(RELAY_LIMITS.messageBytes / 3)).refine(s => { try { const n=atob(s).length;return n>=17&&n<=RELAY_LIMITS.messageBytes&&btoa(atob(s))===s; } catch { return false; } });
const ids = z.array(uuid).max(RELAY_LIMITS.devices).refine(a => new Set(a).size===a.length && a.every((v,i)=>i===0||a[i-1]<v));
export const RelayRole = z.enum(['owner','manager','rep','analyst']);
export type RelayRole = z.infer<typeof RelayRole>;
export const DeviceSchema = z.object({v:z.literal('1'),tenantId:uuid,userId:uuid,deviceId:uuid,ecdh:b64(65),signing:b64(65),createdAt:date,signature:b64(64)}).strict();
export type Device = z.infer<typeof DeviceSchema>;
export type DirectoryDevice = Device & {role:RelayRole;label?:string};
export const WrapSchema = z.object({id:uuid,deviceId:uuid,userId:uuid,role:RelayRole,ecdh:b64(65),signing:b64(65),ephemeral:b64(65),iv:b64(12),wrappedKey:b64(48)}).strict();
export type Wrap = z.infer<typeof WrapSchema>;
export const EpochSchema = z.object({v:z.literal('1'),id:uuid,tenantId:uuid,number:positive,previousHash:hash,baseSequence:counter,baseHash:hash,signerUser:uuid,signerDevice:uuid,createdAt:date,members:z.array(WrapSchema).min(1).max(RELAY_LIMITS.devices),signature:b64(64),hash}).strict().refine(e => new Set(e.members.map(m=>m.deviceId)).size===e.members.length && e.members.every((m,i)=>i===0||e.members[i-1].deviceId<m.deviceId));
export type Epoch = z.infer<typeof EpochSchema>;
export const EventSchema = z.object({v:z.literal('1'),id:uuid,tenantId:uuid,epochId:uuid,sequence:positive,previousHash:hash,senderUser:uuid,senderDevice:uuid,objectId:uuid,objectKind:z.enum(['quote','price_change','rebate']),recipients:ids,mentions:ids,createdAt:date,iv:b64(12),ciphertext,signature:b64(64),hash}).strict();
export type RelayEvent = z.infer<typeof EventSchema>;
export const ShareInputSchema = z.object({objectKind:EventSchema.shape.objectKind,title:z.string().trim().min(1).max(160),reference:z.string().trim().min(1).max(160),amountMinor:z.string().regex(/^(0|[1-9][0-9]{0,17})$/),currency:z.string().regex(/^[A-Z]{3}$/),preset:z.enum(['standard','conservative'])}).strict();
export type ShareInput = z.infer<typeof ShareInputSchema>;
export const ContentSchema = z.discriminatedUnion('kind',[
 z.object({kind:z.literal('share'),subject:ShareInputSchema}).strict(),
 z.object({kind:z.literal('request'),subjectHash:hash,approvers:z.array(uuid).min(1).max(2)}).strict(),
 z.object({kind:z.literal('decision'),requestId:uuid,requestHash:hash,level:z.enum(['1','2']),decision:z.enum(['approve','reject'])}).strict(),
 z.object({kind:z.literal('comment'),text:z.string().trim().min(1).max(4000)}).strict(),
]);
export type Content = z.infer<typeof ContentSchema>;
export const PostSchema = z.discriminatedUnion('action',[
 z.object({action:z.literal('register'),device:DeviceSchema}).strict(),
 z.object({action:z.literal('epoch'),epoch:EpochSchema}).strict(),
 z.object({action:z.literal('event'),event:EventSchema}).strict(),
]);
export type Post = z.infer<typeof PostSchema>;
export type Directory = {devices:DirectoryDevice[];latest:Epoch|null;head:{sequence:string;hash:string}};
export type Page = {epochs:Epoch[];events:RelayEvent[];latestEpoch:string;head:{sequence:string;hash:string}};
export const DirectorySchema=z.object({devices:z.array(DeviceSchema.extend({role:RelayRole,label:z.string().max(320).optional()}).strict()).max(RELAY_LIMITS.devices),latest:EpochSchema.nullable(),head:z.object({sequence:counter,hash}).strict()}).strict();
export const PageSchema=z.object({epochs:z.array(EpochSchema).max(8),events:z.array(EventSchema).max(RELAY_LIMITS.page),latestEpoch:counter,head:z.object({sequence:counter,hash}).strict()}).strict();
export class RelayError extends Error { constructor(public code:string,message:string){super(message);this.name='RelayError';} }
export function fail(message=msg("relay.proto.theSharedItemCould")):never {throw new RelayError('VERIFY',message);}
export const admin = (role:string) => role==='owner'||role==='manager';
export function levelsFor(amountMinor:string,preset:ShareInput['preset']):1|2 {
 if(!/^(0|[1-9][0-9]{0,17})$/.test(amountMinor))fail();
 return preset==='conservative'||BigInt(amountMinor)>BigInt(500_000)?2:1;
}
