"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {moneyText} from "@/lib/spike/exact";
import styles from "./spike.module.css";
type Result=Record<string,any>;
type Progress={stage:string;done:number;total:number};
type Call=(action:string,data?:Record<string,unknown>)=>Promise<Result>;
declare global{interface Window{__spike?:{call:Call;ready:Promise<Result>}}}
const fields=[["list","List amount"],["discounts","Discounts"],["freight","Freight"],["rebates","Off-invoice rebates"],["pocket","Pocket revenue"],["cost","Cost"],["margin","Pocket margin"]];
export default function Spike(){
 const worker=useRef<Worker|null>(null),pending=useRef(new Map<number,{resolve:(r:Result)=>void;reject:(e:Error)=>void}>()),nextId=useRef(0);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("Starting the local data worker…");
 const [progress,setProgress]=useState<Progress|null>(null),[metrics,setMetrics]=useState<Record<string,Result>>({}),[totals,setTotals]=useState<Result>({});
 const [product,setProduct]=useState("0"),[customer,setCustomer]=useState("0"),[passphrase,setPassphrase]=useState("");
 const [storage,setStorage]=useState<{persistent?:boolean;usage?:number;quota?:number}>({}),[downloads,setDownloads]=useState<Array<{name:string;blob:Blob;rows:number;issues:unknown[]}>>([]);
 const call=useCallback<Call>((action,data={})=>new Promise((resolve,reject)=>{
  const id=++nextId.current;if(!worker.current){reject(new Error("The local worker is not ready."));return;}
  pending.current.set(id,{resolve,reject});worker.current.postMessage({id,action,...data});
 }),[]);
 useEffect(()=>{
  const w=new Worker("/spike/spike-worker.js",{type:"module"});worker.current=w;let active=true;
  w.onmessage=e=>{
   const data=e.data;if(data.progress){if(active){setProgress(data.progress);window.dispatchEvent(new CustomEvent("spike-progress",{detail:data.progress}));}return;}
   const request=pending.current.get(data.id);if(!request)return;pending.current.delete(data.id);
   if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);
  };
  w.onerror=e=>{e.preventDefault();for(const p of pending.current.values())p.reject(new Error("The local worker stopped. Reload and retry; no source values were logged."));pending.current.clear();};
  const start=performance.now(),init=call("init",{isolated:crossOriginIsolated}).then(result=>{
   if(active){setMetrics({init:{...result,worker_roundtrip_ms:Math.round(performance.now()-start),navigation_to_ready_ms:Math.round(performance.now())}});setTotals(result.totals);setReady(true);setMessage("Local worker ready. No business-data API is used.");}
   return result;
  });
  window.__spike={call,ready:init};
  init.catch(e=>{if(active){setError(e.message);setMessage("The lab could not start.");}});
  void Promise.all([navigator.storage.persisted(),navigator.storage.estimate()]).then(([persistent,estimate])=>{if(active)setStorage({persistent,...estimate});}).catch(()=>{});
  return()=>{active=false;w.terminate();worker.current=null;for(const p of pending.current.values())p.reject(new Error("Local worker closed."));pending.current.clear();delete window.__spike;};
 },[call]);
 async function run(action:string,data:Record<string,unknown>={}){
  setBusy(true);setError("");setProgress(null);
  try{
   const result=await call(action,data);setMetrics(old=>({...old,[action+(data.target?"_target":"")]:result}));
   if(result.totals)setTotals(result.totals);
   if(result.files)setDownloads(result.files);
   setMessage("Completed locally. See the measured result below.");
   const estimate=await navigator.storage.estimate();setStorage(old=>({...old,...estimate}));
  }catch(e){setError((e as Error).message);setMessage("No import was committed if the operation was cancelled or rejected.");}
  finally{setBusy(false);setProgress(null);if(action==="snapshot"||action==="restore")setPassphrase("");}
 }
 const disabled=busy||!ready;
 const download=(name:string,blob:Blob)=>{const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <main className={styles.lab}>
  <header><span className={styles.eyebrow}>MARGINDESK · CHUNK 4A · LOCAL PROTOTYPE</span><h1>Prove the local data plane.</h1><p>Generate, import and measure in a dedicated Web Worker. The page sends no business data to an API.</p></header>
  <aside className={styles.notice}><strong>Spike, not a production vault.</strong> Generated synthetic data uses a plaintext OPFS database to test persistence. User-selected files use a separate memory-only database. Never treat encrypted snapshots as protection for a plaintext working file. Full vault work belongs to 4B.</aside>
  <section className={styles.panel} aria-busy={busy}>
   <div className={styles.row}><h2>Run the experiment</h2><span>{ready?`${metrics.init?.bundle?.toUpperCase()} · ${metrics.init?.threads} thread(s) · ${metrics.init?.isolated?"isolated":"single-thread fallback"}`:"Starting…"}</span></div>
   <div className={styles.controls}><button className={styles.primary} disabled={disabled} onClick={()=>run("generate")}>Generate 200k SKUs + 2M lines</button><button disabled={disabled} onClick={()=>run("benchmark",{rows:1_000_000})}>Compare 1M-row import paths</button><button disabled={disabled} onClick={()=>run("simulate")}>Simulate +4.5% · all lines</button><button disabled={disabled} onClick={()=>run("simulate",{target:true})}>Simulate · 100k SKUs / 12 months</button></div>
   <p role="status">{message}</p>
   {progress?<div><label htmlFor="spike-progress">{progress.stage} · {progress.done.toLocaleString()} / {progress.total.toLocaleString()}</label><progress id="spike-progress" max={progress.total||1} value={progress.done}/><button onClick={()=>{void call("cancel");setMessage("Cancellation requested; waiting for the current bounded chunk or SQL statement.");}}>Cancel current operation</button></div>:null}
   {error?<p role="alert" className={styles.error}>⚠ {error}</p>:null}
  </section>
  <section className={styles.panel}>
   <h2>Waterfall · full set or drill-down</h2>
   <div className={styles.controls}><label>Product ID (0 = all)<input type="number" min="0" max="200000" value={product} onChange={e=>setProduct(e.target.value)}/></label><label>Customer ID (0 = all)<input type="number" min="0" max="2000000000" value={customer} onChange={e=>setCustomer(e.target.value)}/></label><button disabled={disabled} onClick={()=>run("query",{product:Number(product),customer:Number(customer)})}>Query waterfall</button></div>
   <p>{String(totals.lines||"0")} invoice lines. All stored/reconciled amounts are integer minor units; the worker returns decimal strings.</p>
   <div className={styles.waterfall}>{fields.map(([key,label])=><div key={key}><span>{label}</span><strong>{totals[key]===null||totals[key]===undefined?"—":moneyText(String(totals[key]))}</strong></div>)}</div>
  </section>
  <section className={styles.panel}>
   <h2>Streaming files and conversion</h2><p>Spike columns: line_id, product_id, customer_id, sale_date, quantity, list_amount, discount_amount, freight_amount, rebate_amount, cost_amount. Use ISO dates and two-decimal line totals. No mappings are guessed.</p>
   <div className={styles.controls}><label>Import local .csv / .tsv / .xlsx files<input type="file" multiple accept=".csv,.tsv,.xlsx" disabled={disabled} onChange={e=>{const files=Array.from(e.target.files||[]);if(files.length)void run("files",{files});e.target.value="";}}/></label><button disabled={disabled} onClick={()=>run("fixtures")}>Combine 12 monthly CSVs + 1 XLSX</button><button disabled={disabled} onClick={()=>run("conversions")}>Convert XLSX + TSV + comma-decimal demos</button></div>
   <p>CSV imports are streamed; limit 2M lines / 256 MiB. This spike's XLSX/conversion demo is capped at 8 MiB and 10k rows. It does not evaluate formulas or run macros.</p>
   {downloads.map((f,i)=><p key={i}>{f.name} · {f.rows} rows · {f.issues.length} issues <button onClick={()=>download(f.name,f.blob)}>Download clean UTF-8 CSV</button></p>)}
  </section>
  <section className={styles.panel}>
   <h2>Encryption feasibility</h2><p>Native OPFS encryption is probed independently. The snapshot test uses PBKDF2-SHA256 (600,000 iterations), AES-256-GCM and authenticated 1 MiB chunks. The passphrase stays on this device.</p>
   <div className={styles.controls}><button disabled={disabled} onClick={()=>run("probe")}>Test native encrypted OPFS</button><label>Local snapshot passphrase<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={passphrase} disabled={busy} onChange={e=>setPassphrase(e.target.value)}/></label><button disabled={disabled||passphrase.length<12} onClick={()=>run("snapshot",{passphrase})}>Measure encrypted save + open</button><button disabled={disabled||passphrase.length<12} onClick={()=>run("restore",{passphrase})}>Open saved snapshot</button></div>
  </section>
  <section className={styles.panel}>
   <h2>Browser storage</h2><p>Persistence: {storage.persistent===undefined?"unknown":storage.persistent?"granted":"not granted"} · Used: {storage.usage?.toLocaleString()??"unknown"} bytes · Quota: {storage.quota?.toLocaleString()??"unknown"} bytes. A persistent-storage grant is not a backup.</p>
   <button onClick={async()=>{try{const persistent=await navigator.storage.persist(),estimate=await navigator.storage.estimate();setStorage({persistent,...estimate});}catch{setError("The browser could not grant persistent storage.");}}}>Request persistent storage</button>
  </section>
  <section className={styles.panel}><div className={styles.row}><h2>Local measurements</h2><button onClick={()=>download("spike-measurements.json",new Blob([JSON.stringify(metrics,null,2)],{type:"application/json"}))}>Download measurements</button></div><p>Measured here, not CI evidence or a performance promise. The 8 GB Chrome/Edge checklist is in SPIKE_RESULTS.md.</p><pre tabIndex={0}>{JSON.stringify(metrics,(_k,v)=>v instanceof Blob?{bytes:v.size,type:v.type}:v,2)}</pre></section>
 </main>;
}
