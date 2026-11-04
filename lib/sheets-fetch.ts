import {lookup} from "node:dns/promises";
import {BlockList,isIP} from "node:net";
import {request} from "node:https";
import {HttpError} from "./authz";
import {UPLOAD_LIMITS} from "./upload-types";
// Only Google Sheets CSV endpoints, including their narrowly scoped export
// redirect hosts. No cookies, OAuth token or caller headers are forwarded.
export const SHEETS_HOSTS=["docs.google.com"] as const;
export const SHEETS_EXPORT_HOST=/^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/;
export const SHEETS_TIMEOUT_MS=15_000;
export const SHEETS_MAX_REDIRECTS=3;
const bad=(message:string):never=>{throw new HttpError(422,message);};
const blocked=new BlockList();
for(const [ip,prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.168.0.0",16],["192.0.2.0",24],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const)blocked.addSubnet(ip,prefix,"ipv4");
const global6=new BlockList();global6.addSubnet("2000::",3,"ipv6");
for(const [ip,prefix] of [["2001:db8::",32],["2001::",32],["2002::",16]] as const)blocked.addSubnet(ip,prefix,"ipv6");
export function publicAddress(address:string){
 const family=isIP(address);
 return family===4?!blocked.check(address,"ipv4"):family===6&&global6.check(address,"ipv6")&&!blocked.check(address,"ipv6");
}
function checkedUrl(input:string,initial=false){
 if(input.length>4096||/[\s\x00-\x1f\x7f]/.test(input))bad("The Sheets URL contains invalid characters or is too long.");
 let u:URL;try{u=new URL(input);}catch{bad("Use a valid Google Sheets link.");}
 if(u!.protocol!=="https:"||u!.username||u!.password||u!.port||isIP(u!.hostname.replace(/^\[|\]$/g,""))||u!.hostname.endsWith("."))bad("Only HTTPS Google Sheets links on approved hosts are accepted.");
 if(u!.hostname==="docs.google.com"){
  if(!/^\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{10,200}\/(?:edit|export|pub|pubhtml)?$/.test(u!.pathname))bad("Use a Google Sheets document or published CSV link.");
 }else if(initial||!SHEETS_EXPORT_HOST.test(u!.hostname)||!u!.pathname.startsWith("/export/"))bad("The Sheets link or redirect host is not allowlisted.");
 return u!;
}
export function sheetsCsvUrl(input:string){
 const u=checkedUrl(input,true),match=/^\/spreadsheets\/d\/(e\/)?([A-Za-z0-9_-]+)\/(?:edit|export|pub|pubhtml)?$/.exec(u.pathname)!;
 const hash=new URLSearchParams(u.hash.slice(1)),gid=u.searchParams.get("gid")??hash.get("gid")??"0";
 if(!/^\d{1,12}$/.test(gid))bad("Choose a numeric Google Sheets tab ID.");
 const published=Boolean(match[1]);
 const url=new URL(`https://docs.google.com/spreadsheets/d/${published?"e/":""}${match[2]}/${published?"pub":"export"}`);
 url.searchParams.set(published?"output":"format","csv");url.searchParams.set("gid",gid);
 if(published)url.searchParams.set("single","true");
 return url.toString();
}
export type SheetReply={status:number;location?:string;contentType?:string;bytes:Uint8Array};
export type SheetNetwork={
 resolve:(host:string)=>Promise<Array<{address:string;family:number}>>;
 get:(url:URL,address:{address:string;family:number},signal:AbortSignal,maxBytes:number)=>Promise<SheetReply>;
};
export const sheetNetwork:SheetNetwork={
 resolve:host=>lookup(host,{all:true,verbatim:true}),
 get:(url,ip,signal,maxBytes)=>new Promise((resolve,reject)=>{
  const req=request(url,{method:"GET",agent:false,family:ip.family,signal,
   servername:url.hostname,headers:{accept:"text/csv","accept-encoding":"identity","user-agent":"RebateHQ-Sheets/1"},
   // Pin the approved address: a second DNS lookup cannot rebind the host.
   lookup:(_host,_options,callback)=>callback(null,ip.address,ip.family)},res=>{
    const status=res.statusCode||0;
    if([301,302,303,307,308].includes(status)){res.destroy();resolve({status,location:res.headers.location,bytes:new Uint8Array()});return;}
    if(res.headers["content-encoding"]&&res.headers["content-encoding"]!=="identity"){res.destroy();reject(new HttpError(422,"Compressed HTTP responses are not accepted. Use a Sheets CSV export."));return;}
    if(Number(res.headers["content-length"]||0)>maxBytes){res.destroy();reject(new HttpError(413,"The Sheets response exceeds the upload size limit."));return;}
    const chunks:Buffer[]=[];let size=0;
    res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){res.destroy(new HttpError(413,"The Sheets response exceeds the upload size limit."));return;}chunks.push(chunk);});
    res.on("error",reject);res.on("end",()=>resolve({status,contentType:res.headers["content-type"],bytes:Buffer.concat(chunks)}));
   });
  req.on("error",reject);req.setTimeout(5000,()=>req.destroy(new HttpError(504,"The Sheets response timed out.")));req.end();
 })
};
export async function fetchSheetsCsv(input:string,network:SheetNetwork=sheetNetwork):Promise<Uint8Array>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),SHEETS_TIMEOUT_MS);
 const aborted=new Promise<never>((_resolve,reject)=>controller.signal.addEventListener("abort",()=>reject(new HttpError(504,"The Sheets request timed out.")),{once:true}));
 try{
  let url=checkedUrl(sheetsCsvUrl(input),true);
  for(let hop=0;hop<=SHEETS_MAX_REDIRECTS;hop++){
   // Check host before resolving, then check EVERY returned address. The
   // connection uses only an approved pinned address, with TLS hostname checks.
   url=checkedUrl(url.toString());
   const addresses=await Promise.race([network.resolve(url.hostname),aborted]);
   if(!addresses.length||addresses.some(a=>!publicAddress(a.address)||isIP(a.address)!==a.family))bad("The Sheets host resolved to a private, internal or unsupported address.");
   const response=await Promise.race([network.get(url,addresses[0],controller.signal,UPLOAD_LIMITS.bytes),aborted]);
   if([301,302,303,307,308].includes(response.status)){
    if(!response.location||hop===SHEETS_MAX_REDIRECTS)bad("The Sheets link redirects too many times or has no valid destination.");
    let next:URL;try{next=new URL(response.location!,url);}catch{bad("The Sheets redirect is invalid.");}
    url=checkedUrl(next!.toString());continue;
   }
   if(response.status!==200)bad("The sheet could not be read. Use a public or published read-only CSV link; private Sheets sign-in is not supported.");
   if(response.bytes.length>UPLOAD_LIMITS.bytes)throw new HttpError(413,"The Sheets response exceeds the upload size limit.");
   if(!/^(text\/(csv|plain|tab-separated-values)|application\/(octet-stream|vnd\.ms-excel))(?:;|$)/i.test(response.contentType||""))bad("The Sheets response is not CSV data. Check its sharing and export settings.");
   return response.bytes;
  }
  return bad("The Sheets redirect could not be followed safely.");
 }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(422,"The Sheets request failed. Check the link and try again.");}
 finally{clearTimeout(timer);}
}
