import test,{mock} from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import {EventEmitter} from "node:events";
import {fetchSheetsCsv,sheetsCsvUrl,publicAddress,sheetNetwork,SHEETS_TIMEOUT_MS,type SheetNetwork} from "../lib/sheets-fetch";
import {UPLOAD_LIMITS} from "../lib/upload-types";
const link="https://docs.google.com/spreadsheets/d/abcdefghijklmno/edit#gid=12";
const csv=new TextEncoder().encode("SKU,Unit,Cost,Price\nA,EA,1,2");
const network=(parts:Partial<SheetNetwork>={}):SheetNetwork=>({resolve:async()=>[{address:"8.8.8.8",family:4}],get:async()=>({status:200,contentType:"text/csv; charset=utf-8",bytes:csv}),...parts});
test("Sheets links canonicalize only supported HTTPS documents; non-allowlisted/internal URLs fail before DNS",async()=>{
 assert.equal(sheetsCsvUrl(link),"https://docs.google.com/spreadsheets/d/abcdefghijklmno/export?format=csv&gid=12");
 assert.match(sheetsCsvUrl("https://docs.google.com/spreadsheets/d/e/abcdefghijklmnop/pubhtml?gid=2"),/\/e\/abcdefghijklmnop\/pub\?output=csv&gid=2&single=true$/);
 let resolved=0;
 for(const bad of ["http://docs.google.com/spreadsheets/d/abcdefghijklmno/edit","https://evil.test/x.csv","https://docs.google.com.evil.test/x",
  "https://docs.google.com@evil.test/","https://user:secret@docs.google.com/spreadsheets/d/abcdefghijklmno/edit",
  "https://127.0.0.1/x","https://2130706433/","https://0x7f000001/","https://localhost/x","https://10.0.0.1/x","https://[::1]/x",
  "https://docs.google.com:444/spreadsheets/d/abcdefghijklmno/edit","https://docs.google.com./spreadsheets/d/abcdefghijklmno/edit",
  "https://docs.google.com/document/d/abcdefghijklmno/edit",link.replace("#gid=12","#gid=evil")]){
  await assert.rejects(fetchSheetsCsv(bad,network({resolve:async()=>{resolved++;return [];}})),(e:any)=>e.status===422);
 }assert.equal(resolved,0);
});
test("DNS rejects private, internal, reserved and mapped addresses, including mixed answers",async()=>{
 const privateIps=["0.0.0.1","10.3.4.5","127.0.0.2","172.16.1.2","172.31.255.1","192.168.1.1","169.254.169.254","100.64.0.1","224.0.0.1","::","::1","fe80::1","fc00::1","fd12::1","::ffff:127.0.0.1","::ffff:8.8.8.8","2001:db8::1","2002:7f00:1::1"];
 let connected=0;
 for(const address of privateIps){assert.equal(publicAddress(address),false,address);
  await assert.rejects(fetchSheetsCsv(link,network({resolve:async()=>[{address:"8.8.8.8",family:4},{address,family:address.includes(":")?6:4}],get:async()=>{connected++;throw new Error();}})),/private, internal/);
 }
 assert.equal(connected,0);assert.equal(publicAddress("8.8.8.8"),true);assert.equal(publicAddress("2001:4860:4860::8888"),true);
 await assert.rejects(fetchSheetsCsv(link,network({resolve:async()=>[]})),/private, internal/);
 await assert.rejects(fetchSheetsCsv(link,network({resolve:async()=>[{address:"8.8.8.8",family:6}]})),/private, internal/);
});
test("Every redirect is host checked and DNS rechecked, with approved addresses pinned",async()=>{
 const resolved:string[]=[],connected:string[]=[];
 const good=network({resolve:async host=>{resolved.push(host);return [{address:"8.8.8.8",family:4}];},
  get:async(url,ip,_signal,cap)=>{connected.push(url.hostname);assert.equal(ip.address,"8.8.8.8");assert.equal(cap,UPLOAD_LIMITS.bytes);
   return connected.length===1?{status:302,location:"https://doc-ab-12-sheets.googleusercontent.com/export/data",bytes:new Uint8Array()}:{status:200,contentType:"text/csv",bytes:csv};}});
 assert.deepEqual(await fetchSheetsCsv(link,good),csv);assert.deepEqual(resolved,connected);assert.equal(resolved.length,2);
 for(const target of ["https://evil.test/x","http://docs.google.com/spreadsheets/d/abcdefghijklmno/export","https://127.0.0.1/x","https://[fe80::1]/x","https://storage.googleapis.com/x","https://accounts.google.com/login","https://evil.googleusercontent.com/export/data"]){
  let calls=0;await assert.rejects(fetchSheetsCsv(link,network({get:async()=>{calls++;return {status:302,location:target,bytes:new Uint8Array()};}})));assert.equal(calls,1);
 }
 let dns=0,gets=0;
 await assert.rejects(fetchSheetsCsv(link,network({resolve:async()=>[{address:++dns===1?"8.8.8.8":"10.0.0.1",family:4}],
  get:async()=>{gets++;return {status:302,location:"https://doc-ab-sheets.googleusercontent.com/export/data",bytes:new Uint8Array()};}})),/private, internal/);
 assert.equal(dns,2);assert.equal(gets,1);
 await assert.rejects(fetchSheetsCsv(link,network({get:async()=>({status:302,location:sheetsCsvUrl(link),bytes:new Uint8Array()})})),/too many/);
});
test("Fetch response cap, MIME/status and global DNS timeout fail closed",async()=>{
 await assert.rejects(fetchSheetsCsv(link,network({get:async()=>({status:200,contentType:"text/csv",bytes:new Uint8Array(UPLOAD_LIMITS.bytes+1)})})),(e:any)=>e.status===413);
 await assert.rejects(fetchSheetsCsv(link,network({get:async()=>({status:200,contentType:"text/html",bytes:csv})})),/not CSV/);
 await assert.rejects(fetchSheetsCsv(link,network({get:async()=>({status:403,contentType:"text/csv",bytes:csv})})),/could not be read/);
 mock.timers.enable({apis:["setTimeout"]});
 try{const pending=fetchSheetsCsv(link,network({resolve:()=>new Promise(()=>{})}));mock.timers.tick(SHEETS_TIMEOUT_MS);await assert.rejects(pending,(e:any)=>e.status===504);}
 finally{mock.timers.reset();}
});
test("HTTPS transport pins lookup, retains TLS verification and caps streamed/chunked bodies",async()=>{
 let options:any,headers:Record<string,string>={},length=5;const original=https.request;
 const replacement:any=(_url:any,opts:any,callback:any)=>{
  options=opts;const req:any=new EventEmitter();req.setTimeout=()=>req;req.destroy=(e:any)=>req.emit("error",e);
  req.end=()=>queueMicrotask(()=>{const res:any=new EventEmitter();res.statusCode=200;res.headers={"content-type":"text/csv",...headers};res.destroy=(e:any)=>{if(e)res.emit("error",e);};callback(res);res.emit("data",Buffer.alloc(length));res.emit("end");});return req;
 };
 (https as any).request=replacement;
 try{
  await sheetNetwork.get(new URL(sheetsCsvUrl(link)),{address:"8.8.8.8",family:4},new AbortController().signal,10);
  assert.equal(options.agent,false);assert.equal(options.servername,"docs.google.com");assert.equal(options.family,4);assert.notEqual(options.rejectUnauthorized,false);
  options.lookup("docs.google.com",{},(error:any,address:string,family:number)=>{assert.equal(error,null);assert.equal(address,"8.8.8.8");assert.equal(family,4);});
  assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);
  length=11;await assert.rejects(sheetNetwork.get(new URL(sheetsCsvUrl(link)),{address:"8.8.8.8",family:4},new AbortController().signal,10),(e:any)=>e.status===413);
  headers={"content-length":"11"};await assert.rejects(sheetNetwork.get(new URL(sheetsCsvUrl(link)),{address:"8.8.8.8",family:4},new AbortController().signal,10),(e:any)=>e.status===413);
  headers={"content-encoding":"gzip"};await assert.rejects(sheetNetwork.get(new URL(sheetsCsvUrl(link)),{address:"8.8.8.8",family:4},new AbortController().signal,10),/Compressed/);
 }finally{(https as any).request=original;}
});
