import {SpikeError} from "./exact";
export const KDF_ITERATIONS=600_000,CRYPTO_CHUNK_BYTES=1024*1024;
const MAGIC=new TextEncoder().encode("MDSPK001");
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const owned=(bytes:Uint8Array)=>new Uint8Array(bytes).buffer;
export type Sink={write:(data:Uint8Array<ArrayBuffer>)=>Promise<unknown>;close:()=>Promise<unknown>;abort:(reason?:unknown)=>Promise<unknown>};
export async function deriveSnapshotKey(passphrase:string,salt:Uint8Array,iterations=KDF_ITERATIONS){
 if(passphrase.length<12||passphrase.length>256)throw new SpikeError("Use a passphrase of 12–256 characters.");
 if(iterations!==KDF_ITERATIONS||salt.length!==16)throw new SpikeError("Unsupported snapshot key settings.");
 const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(passphrase),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"PBKDF2",salt:owned(salt),iterations,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
function iv(prefix:Uint8Array,index:number){const result=new Uint8Array(12);result.set(prefix);new DataView(result.buffer).setUint32(8,index);return result;}
function aad(header:Uint8Array,index:number){const result=new Uint8Array(header.length+4);result.set(header);new DataView(result.buffer).setUint32(header.length,index);return result;}
export async function encryptSnapshot(source:Blob,sink:Sink,passphrase:string,progress=(done:number,total:number)=>{},signal?:AbortSignal){
 if(source.size>512*1024*1024)throw new SpikeError("Snapshot exceeds this spike's 512 MiB guardrail.");
 const salt=crypto.getRandomValues(new Uint8Array(16)),prefix=crypto.getRandomValues(new Uint8Array(8));
 const meta=new TextEncoder().encode(JSON.stringify({version:1,bytes:source.size,chunkBytes:CRYPTO_CHUNK_BYTES,iterations:KDF_ITERATIONS,salt:encode(salt),iv:encode(prefix)}));
 const header=new Uint8Array(12+meta.length);header.set(MAGIC);new DataView(header.buffer).setUint32(8,meta.length);header.set(meta,12);
 try{
  const key=await deriveSnapshotKey(passphrase,salt);await sink.write(header);
  for(let start=0,index=0;start<source.size||index===0;start+=CRYPTO_CHUNK_BYTES,index++){
   signal?.throwIfAborted();
   const plain=await source.slice(start,Math.min(start+CRYPTO_CHUNK_BYTES,source.size)).arrayBuffer();
   const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv:owned(iv(prefix,index)),additionalData:owned(aad(header,index)),tagLength:128},key,plain);
   await sink.write(new Uint8Array(encrypted));progress(Math.min(start+CRYPTO_CHUNK_BYTES,source.size),source.size);
  }
  await sink.close();return {bytes:source.size,iterations:KDF_ITERATIONS};
 }catch(e){await sink.abort().catch(()=>{});throw e;}
}
export async function decryptSnapshot(source:Blob,sink:Sink,passphrase:string,progress=(done:number,total:number)=>{},signal?:AbortSignal){
 try{
  const first=new Uint8Array(await source.slice(0,12).arrayBuffer());
  if(first.length!==12||!MAGIC.every((b,i)=>b===first[i]))throw new SpikeError("Not a RebateHQ spike snapshot.");
  const length=new DataView(first.buffer).getUint32(8);
  if(length>4096||source.size<12+length+16)throw new SpikeError("Snapshot header is invalid.");
  const header=new Uint8Array(await source.slice(0,12+length).arrayBuffer());
  const meta=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(header.subarray(12)));
  if(meta.version!==1||meta.chunkBytes!==CRYPTO_CHUNK_BYTES||meta.iterations!==KDF_ITERATIONS||!Number.isSafeInteger(meta.bytes)||meta.bytes<0||meta.bytes>512*1024*1024||typeof meta.salt!=="string"||typeof meta.iv!=="string")throw new SpikeError("Unsupported snapshot settings.");
  const salt=decode(meta.salt),prefix=decode(meta.iv);
  if(salt.length!==16||prefix.length!==8)throw new SpikeError("Snapshot key settings are invalid.");
  const chunks=Math.max(1,Math.ceil(meta.bytes/CRYPTO_CHUNK_BYTES));
  if(source.size!==header.length+meta.bytes+16*chunks)throw new SpikeError("Snapshot is truncated or has extra data.");
  const key=await deriveSnapshotKey(passphrase,salt);
  for(let index=0,at=header.length;index<chunks;index++){
   signal?.throwIfAborted();
   const bytes=Math.min(CRYPTO_CHUNK_BYTES,meta.bytes-index*CRYPTO_CHUNK_BYTES);
   const encrypted=await source.slice(at,at+bytes+16).arrayBuffer();at+=bytes+16;
   const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:owned(iv(prefix,index)),additionalData:owned(aad(header,index)),tagLength:128},key,encrypted);
   await sink.write(new Uint8Array(plain));progress(Math.min((index+1)*CRYPTO_CHUNK_BYTES,meta.bytes),meta.bytes);
  }
  await sink.close();return {bytes:meta.bytes};
 }catch{await sink.abort().catch(()=>{});throw new SpikeError("Wrong passphrase or damaged snapshot. No data was opened.");}
}
