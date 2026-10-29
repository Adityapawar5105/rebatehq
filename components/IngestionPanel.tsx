"use client";
import {useEffect,useRef,useState} from "react";
import type {ingestionState} from "@/lib/ingestion";
import type {ImportPlan} from "@/lib/import-lifecycle-types";
import type {UploadIssue} from "@/lib/upload-types";
import {UPLOAD_LIMITS} from "@/lib/upload-types";
import {ImportActions} from "./ImportActions";
import {SourceIssues} from "./SourceIssues";
type State=Awaited<ReturnType<typeof ingestionState>>;
async function responseData(response:Response){const data=await response.json();if(!response.ok)throw new Error(data.error||"Ingestion is unavailable. Try again.");return data;}
export function IngestionPanel(){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [name,setName]=useState("Supplier prices"),[url,setUrl]=useState(""),[template,setTemplate]=useState(""),[hours,setHours]=useState(24),[header,setHeader]=useState(1);
 const [format,setFormat]=useState("dot"),[text,setText]=useState(false),[units,setUnits]=useState(false);
 const [editingId,setEditingId]=useState<string|undefined>();const formDetails=useRef<HTMLDetailsElement>(null);
 const [review,setReview]=useState<{plan:ImportPlan;jobId:string;issues:UploadIssue[];totalIssues:number}|null>(null);
 async function load(){const data=await responseData(await fetch("/api/ingestion",{cache:"no-store"}));setState(data);}
 useEffect(()=>{let active=true;fetch("/api/ingestion",{cache:"no-store"}).then(responseData).then(data=>{if(active)setState(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function openReview(planId:string,jobId:string){
  const [plan,issues]=await Promise.all([responseData(await fetch("/api/imports?"+new URLSearchParams({plan:planId}),{cache:"no-store"})),responseData(await fetch("/api/import-preview?"+new URLSearchParams({job:jobId}),{cache:"no-store"}))]);
  setReview({plan:plan.plan,jobId,issues:issues.issues,totalIssues:issues.totalIssues});
 }
 async function action(body:unknown){
  setBusy(true);setError("");setMessage("");
  try{const result=await responseData(await fetch("/api/ingestion",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
   await load();setMessage(result.planId?"Fetched and staged a review. No catalog rows were committed.":result.paused?"Schedule paused.":"Schedule saved. A due runner must be configured by the operator.");
   if(result.id&&!result.planId){setEditingId(undefined);if(formDetails.current)formDetails.current.open=false;}
   if(result.planId&&result.reviewId)await openReview(result.planId,result.reviewId);
  }catch(e){setError((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}
 }
 return <section id="ingestion" className="app-card" aria-busy={busy||!state&&!error}>
  <h2>Scheduled file reviews</h2><p>First insights in minutes from files; a live connector typically takes weeks.</p>
  {busy||!state&&!error?<p role="status">Loading ingestion…</p>:null}
  {error?<p role="alert" className="import-issue">⚠ {error}</p>:null}{message?<p role="status" className="success-note">{message}</p>:null}
  {error&&!state?<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Retry ingestion</button>:null}
  {review?<><button type="button" disabled={busy} onClick={()=>{setReview(null);setMessage("");}}>Back to schedules</button><SourceIssues preview={review} expanded/><ImportActions key={review.plan.id} file={null} preview={null} initialPlan={review.plan}/></>:state?<>
   <p>Read-only Google Sheets CSV fetches create reviews, never automatic catalog commits. Only public or link-readable sheets are supported; there is no Google sign-in or private Sheets access. Use manual files for confidential sheets. Recurring execution needs the operator's due-runner setup.</p>
   {!state.flags.sheets?<p role="status">Google Sheets fetching is disabled by the operator.</p>:null}
   <details ref={formDetails}><summary>{editingId?"Edit Google Sheets schedule":"Add a Google Sheets schedule"}</summary>
    <form className="app-form" onSubmit={e=>{e.preventDefault();void action({action:"save",schedule:{id:editingId,name,url,templateId:template,headerRow:header,intervalHours:hours,numericFormat:format,approveTextNumbers:text,approveUnits:units}});}}>
     <label>Schedule name<input required maxLength={120} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
     <label>Google Sheets link<input type="url" required maxLength={2048} placeholder="https://docs.google.com/spreadsheets/d/…" value={url} disabled={busy} onChange={e=>setUrl(e.target.value)}/></label>
     <label>Saved CSV mapping<select aria-label="Saved CSV mapping" required value={template} disabled={busy} onChange={e=>setTemplate(e.target.value)}><option value="">Choose a template</option>{state.templates.map(t=><option key={t.id} value={t.id} disabled={!t.column_checks}>{t.supplier}{t.column_checks?"":" — re-save this older template"}</option>)}</select></label>
     {!state.templates.some(t=>t.column_checks)?<p className="import-issue">⚠ Review a CSV in Upload a file and save its supplier mapping first. Older templates need re-saving for exact header-column checks.</p>:null}
     <div className="import-controls"><label>Header row<input type="number" min={1} max={UPLOAD_LIMITS.rows} value={header} disabled={busy} onChange={e=>setHeader(Number(e.target.value))}/></label><label>Fetch interval<select aria-label="Fetch interval" value={hours} disabled={busy} onChange={e=>setHours(Number(e.target.value))}>{[1,6,24,168].map(h=><option key={h} value={h}>{h} hours</option>)}</select></label>
     <label>Text-number decimal separator<select aria-label="Text-number decimal separator" value={format} disabled={busy} onChange={e=>setFormat(e.target.value)}><option value="dot">Dot: 12.50</option><option value="comma">Comma: 12,50</option></select></label></div>
     <label className="import-check"><input type="checkbox" checked={text} disabled={busy} onChange={e=>setText(e.target.checked)}/>Approve this decimal format for text numbers in staged reviews. Invalid amounts remain rejected.</label>
     <label className="import-check"><input type="checkbox" checked={units} disabled={busy} onChange={e=>setUnits(e.target.checked)}/>Approve registered unit conversions and four-decimal rounding in staged reviews.</label>
     <button className="primary" disabled={busy||!state.flags.sheets||!template}>{editingId?"Save changes":"Save schedule"}</button>
     {editingId?<button type="button" disabled={busy} onClick={()=>{setEditingId(undefined);if(formDetails.current)formDetails.current.open=false;}}>Cancel editing</button>:null}
    </form>
   </details>
   <h3>Schedules</h3>{!state.schedules.length?<p>No schedules yet. Add a read-only Sheets link or continue with manual files.</p>:<ul className="ingestion-schedules">{state.schedules.map(s=><li key={s.id}><strong>{s.name}</strong> · {s.enabled?`Every ${s.intervalHours} hours; next due ${new Date(s.nextRunAt).toLocaleString()}`:"Paused"}
    {s.lastError?<p className="import-issue">⚠ {s.lastError}</p>:null}<div className="import-controls">
     <button type="button" disabled={busy||!state.flags.sheets} onClick={()=>{setEditingId(s.id);setName(s.name);setUrl(s.url);setTemplate(s.templateId);setHours(s.intervalHours);setHeader(s.headerRow);setFormat(s.numericFormat);setText(s.approveTextNumbers);setUnits(s.approveUnits);if(formDetails.current){formDetails.current.open=true;formDetails.current.scrollIntoView({block:"start",behavior:"smooth"});}}}>Edit</button>
     <button type="button" disabled={busy||!state.flags.sheets||!s.enabled} onClick={()=>action({action:"run",id:s.id})}>Fetch review now</button>
     {s.lastPlanId&&s.lastReviewId?<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{await openReview(s.lastPlanId!,s.lastReviewId!);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Review latest fetch</button>:null}
     <button type="button" disabled={busy||(!s.enabled&&!state.flags.sheets)} onClick={()=>action({action:s.enabled?"pause":"resume",id:s.id})}>{s.enabled?"Pause":"Resume"}</button>
    </div></li>)}</ul>}
   <h3>Recent fetches</h3>{state.runs.length?<div className="data-table" tabIndex={0} aria-label="Recent fetches"><table><caption>Latest 20 Google Sheets fetches; succeeded means a review was staged</caption><thead><tr><th>Status</th><th>Rows reviewed</th><th>Rejected rows</th><th>Started</th></tr></thead><tbody>{state.runs.map(r=><tr key={r.id}><td>{r.status}</td><td>{r.processed_count}</td><td>{r.failed_count}</td><td>{r.started_at?new Date(r.started_at).toLocaleString():"Queued"}</td></tr>)}</tbody></table></div>:<p>No fetches yet.</p>}
   <h3>Other drop interfaces</h3>
   {state.stubs.email?<p><strong>Email-in preview:</strong> <code>{state.stubs.email.address}</code> · {state.stubs.email.status}</p>:<p>Email-in interface is disabled; no mail server is connected.</p>}
   {state.stubs.sftp?<p><strong>SFTP-style preview:</strong> <code>{state.stubs.sftp.path}</code> · {state.stubs.sftp.status}</p>:<p>SFTP-style interface is disabled; no SFTP server is connected.</p>}
  </>:null}
 </section>;
}
