// Local spike evidence, not the authenticated application privacy gate (4B).
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile,mkdtemp} from "node:fs/promises";
import {spawn} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {chromium} from "@playwright/test";
const full=process.argv.includes("--full"),channel=(process.argv.find(x=>x.startsWith("--browser="))||"--browser=chrome").split("=")[1];
const base=process.env.SPIKE_URL||"http://127.0.0.1:3100";
const output=path.resolve("test-results");await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),"rebatehq-spike-"));
const results={date:new Date().toISOString(),scope:full?"full":"smoke",channel,machine:{cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,ram_bytes:os.totalmem(),os:os.type()+" "+os.release(),architecture:os.arch()},measurements:{},checks:{},memory:{peak_working_set_sum_bytes:0,peak_private_bytes:0,method:"sum of measured browser process working sets/private bytes; working sets can double-count shared pages; 500 ms sampling"}};
const measurements=results.measurements,checks=results.checks;
let context,page,memorySampler;const failures=[],requests=[];
async function launch(){
 context=await chromium.launchPersistentContext(profile,{channel,headless:true,serviceWorkers:"block",viewport:{width:1365,height:950}});
 results.browser=context.browser()?.version()||"";
 context.on("request",request=>{
  const u=new URL(request.url());
  if(u.origin!==new URL(base).origin)failures.push("Unexpected external request: "+u.protocol+" "+u.hostname);
  if(request.url().includes("/api/"))failures.push("Spike called an API");
  const text=[request.url(),JSON.stringify(request.headers()),request.postData()||""].join("\n");
  if(text.includes("PRIVATE-SPIKE-MARKER"))failures.push("Fixture marker left in a request");
  requests.push({path:new URL(request.url()).pathname,method:request.method()});
 });
 context.on("console",message=>{if(message.text().includes("PRIVATE-SPIKE-MARKER"))failures.push("Fixture marker logged");});
 page=await context.newPage();page.on("pageerror",()=>failures.push("Unhandled browser error"));
 await page.addInitScript(()=>{window.__longTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.__longTasks.push(e.duration);}).observe({type:"longtask",buffered:true});});
 const response=await page.goto(base+"/lab/spike");
 assert.equal(response.status(),200);assert.equal(response.headers()["cross-origin-embedder-policy"],"require-corp");
 await page.waitForFunction(()=>Boolean(window.__spike),undefined,{timeout:45_000});
 const ready=await call("ready");
 if(!results.browser)results.browser=await page.evaluate(()=>navigator.userAgent);
 return ready;
}
async function call(action,data={}){
 let timer;
 try{return await Promise.race([page.evaluate(async({action,data})=>action==="ready"?window.__spike.ready:window.__spike.call(action,data),{action,data}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(action+" exceeded local harness deadline")),full?240_000:60_000);})]);}
 finally{clearTimeout(timer);}
}
async function sampleMemory(){
 const session=await context.browser().newBrowserCDPSession();
 const {processInfo}=await session.send("SystemInfo.getProcessInfo");
 const ids=processInfo.map(p=>Number(p.id)).filter(Number.isInteger);
 if(process.platform==="win32"){
  const script=`$ids=@(${ids.join(",")}); while($true){$p=Get-Process -Id $ids -ErrorAction SilentlyContinue; $rss=($p|Measure-Object WorkingSet64 -Sum).Sum; $private=($p|Measure-Object PrivateMemorySize64 -Sum).Sum; Write-Output "$rss,$private"; Start-Sleep -Milliseconds 500}`;
  memorySampler=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  let pending="";memorySampler.stdout.on("data",chunk=>{pending+=chunk.toString();let at;while((at=pending.indexOf("\n"))>=0){const [rss,privateBytes]=pending.slice(0,at).trim().split(",").map(Number);pending=pending.slice(at+1);if(Number.isFinite(rss))results.memory.peak_working_set_sum_bytes=Math.max(results.memory.peak_working_set_sum_bytes,rss);if(Number.isFinite(privateBytes))results.memory.peak_private_bytes=Math.max(results.memory.peak_private_bytes,privateBytes);}});
 }else{
  const interval=setInterval(async()=>{let rss=0;for(const id of ids){try{const status=await readFile(`/proc/${id}/status`,"utf8");rss+=Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]||0)*1024;}catch{}}results.memory.peak_working_set_sum_bytes=Math.max(results.memory.peak_working_set_sum_bytes,rss);},500);
  memorySampler={kill:()=>clearInterval(interval)};
 }
}
function reconciles(t){return BigInt(t.list)-BigInt(t.discounts)-BigInt(t.freight)-BigInt(t.rebates)===BigInt(t.pocket)&&BigInt(t.pocket)-BigInt(t.cost)===BigInt(t.margin);}
try{
 measurements.initial=await launch();checks.cross_origin_isolated=measurements.initial.isolated;
 await sampleMemory();
 measurements.generation=await call("generate",{products:full?200_000:1000,lines:full?2_000_000:10_000});
 assert.equal(measurements.generation.counts.products,full?"200000":"1000");assert.equal(measurements.generation.counts.lines,full?"2000000":"10000");assert.equal(measurements.generation.counts.months,"24");assert.ok(reconciles(measurements.generation.totals));
 console.log("Synthetic generation and exact waterfall passed.");
 for(const [name,args] of [["waterfall",{}],["product",{product:42}],["customer",{customer:42}]]){
  measurements[name]=[];
  for(let n=0;n<7;n++){const result=await call("query",args);if(result.totals.list!==null)assert.ok(reconciles(result.totals));measurements[name].push(result.query_ms);}
 }
 measurements.simulation_target=await call("simulate",{target:true});
 measurements.simulation_all=await call("simulate");assert.ok(measurements.simulation_all.base_unchanged);
 const expected=measurements.generation.totals;
 memorySampler?.kill();await context.close();
 measurements.reopen=await launch();await sampleMemory();
 assert.deepEqual(measurements.reopen.totals,expected);checks.browser_restart_exact=true;
 measurements.import=await call("benchmark",{rows:full?1_000_000:5000});assert.ok(measurements.import.equal_checksums);
 if(full){measurements.import_2m=await call("benchmark",{rows:2_000_000});assert.ok(measurements.import_2m.equal_checksums);}
 console.log("Browser restart, simulations and both streamed import paths passed.");
 measurements.native_encryption=await call("probe");
 measurements.snapshot=await call("snapshot",{passphrase:"local-spike-measurement-passphrase"});
 assert.ok(measurements.snapshot.exact);assert.ok(measurements.snapshot.wrong_passphrase_rejected);
 await assert.rejects(call("restore",{passphrase:"deliberately-wrong-passphrase"}));
 measurements.restore=await call("restore",{passphrase:"local-spike-measurement-passphrase"});assert.deepEqual(measurements.restore.totals,expected);
 memorySampler?.kill();await context.close();
 measurements.encrypted_restart_init=await launch();
 const unlocked=await call("restore",{passphrase:"local-spike-measurement-passphrase"});assert.deepEqual(unlocked.totals,expected);
 measurements.encrypted_navigation_to_open_ms=await page.evaluate(()=>Math.round(performance.now()*10)/10);
 checks.encrypted_browser_restart_exact=true;await sampleMemory();
 measurements.multifile=await call("fixtures");assert.equal(measurements.multifile.rows,"130");assert.equal(measurements.multifile.sources.length,13);checks.thirteen_sources=true;
 const conversion=await call("conversions");assert.equal(conversion.files.length,3);assert.deepEqual(conversion.files.map(f=>f.rows),[10,1,1]);
 const texts=await page.evaluate(async()=>{const r=await window.__spike.call("conversions");return Promise.all(r.files.map(async f=>({name:f.name,text:await f.blob.text()})));});
 assert.equal(texts[1].text,texts[2].text);checks.utf8_conversions_exact=true;measurements.conversions={conversion_ms:conversion.conversion_ms,rows:[10,1,1]};
 const marker="PRIVATE-SPIKE-MARKER";
 const imported=await page.evaluate(async marker=>{const header="line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n";const file=new File([header+"881199330011,1,1,2025-01-01,1,12.50,0.50,0.25,0.00,8.00\n"],marker+".csv",{type:"text/csv"});return window.__spike.call("files",{files:[file]});},marker);
 assert.equal(imported.rows,"1");checks.valid_marker_imported=true;
 await assert.rejects(page.evaluate(async marker=>{const header="line_id,product_id,customer_id,sale_date,quantity,list_amount,discount_amount,freight_amount,rebate_amount,cost_amount\n";const file=new File([header+`1,1,1,2025-01-01,1,${marker},0.00,0.00,0.00,1.00\n`],marker+".csv",{type:"text/csv"});return window.__spike.call("files",{files:[file]});},marker));
 const cancelled=await page.evaluate(async rows=>{
  const cancel=event=>{if(event.detail.stage.startsWith("PapaParse")&&event.detail.done===0){removeEventListener("spike-progress",cancel);void window.__spike.call("cancel");}};
  addEventListener("spike-progress",cancel);
  try{await window.__spike.call("benchmark",{rows});return false;}catch(e){return /cancel/i.test(e.message);}finally{removeEventListener("spike-progress",cancel);}
 },Math.min(100_000,Number(expected.lines)));
 assert.ok(cancelled);assert.deepEqual((await call("query")).totals,expected);checks.cancel_no_partial_rows=true;
 checks.storage=await page.evaluate(async()=>({persisted:await navigator.storage.persisted(),estimate:await navigator.storage.estimate()}));
 memorySampler?.kill();await context.close();
 context=await chromium.launchPersistentContext(profile,{channel,headless:true,serviceWorkers:"block",viewport:{width:390,height:844}});page=await context.newPage();
 await page.route(new RegExp("/lab/spike$"),async route=>{const r=await route.fetch();const headers={...r.headers()};delete headers["cross-origin-embedder-policy"];await route.fulfill({response:r,headers});});
 await page.goto(base+"/lab/spike");await page.waitForFunction(()=>Boolean(window.__spike),undefined,{timeout:45_000});const fallback=await call("ready");
 assert.equal(fallback.isolated,false);assert.equal(fallback.threads,"1");assert.deepEqual(fallback.totals,expected);checks.nonisolated_fallback=true;
 checks.mobile_no_overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);assert.ok(checks.mobile_no_overflow);
 await page.screenshot({path:path.join(output,`spike-${channel}-${full?"full":"smoke"}.png`),fullPage:true});
 checks.system_fonts=await page.evaluate(()=>document.fonts.check("14px system-ui"));
 checks.no_data_egress_or_console_marker=failures.length===0;assert.deepEqual(failures,[]);
 results.request_summary={requests:requests.length,paths:[...new Set(requests.map(r=>r.path))].filter(p=>!p.startsWith("/_next/")).sort()};results.status="passed";
 console.log("Encryption, multi-file conversion, cancellation, local-only boundary and fallback checks passed.");
}catch(error){results.status="failed";results.failure=error.message;process.exitCode=1;console.error("Spike browser check failed: "+error.message);}
finally{memorySampler?.kill();await context?.close();await writeFile(path.join(output,`spike-${channel}-${full?"full":"smoke"}.json`),JSON.stringify(results,null,2)+"\n");console.log(`Local evidence: test-results/spike-${channel}-${full?"full":"smoke"}.json`);}
