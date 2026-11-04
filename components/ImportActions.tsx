"use client";
import {useState} from "react";
import type {UploadPreview} from "@/lib/upload-types";
import type {ImportPlan,ImportValue} from "@/lib/import-lifecycle-types";
import {MAX_IMPORT_DATA_ROWS} from "@/lib/import-config";
const display=(value:ImportValue|null)=>value?`${value.description} · ${value.unit} · cost ${value.cost??"missing"} · price ${value.price} · ${value.supplier||"no supplier"} · ${value.date}`:"New product";
export function ImportActions({file,preview,initialPlan}:{file:File|null;preview:UploadPreview|null;initialPlan?:ImportPlan}){
 const [plan,setPlan]=useState<ImportPlan|null>(initialPlan||null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 const [date,setDate]=useState(new Date().toISOString().slice(0,10)),[format,setFormat]=useState<"dot"|"comma">("dot"),[text,setText]=useState(false),[units,setUnits]=useState(false),[warnings,setWarnings]=useState(false),[skip,setSkip]=useState(false);
 const [decisions,setDecisions]=useState<Record<string,"app"|"file"|"review">>({});
 const invalidate=()=>{setPlan(null);setDecisions({});setError("");setSuccess("");};
 async function dryRun(){
  setBusy(true);setError("");setSuccess("");
  try{
   if(!plan&&(!file||!preview))throw new Error("Fetch the sheet again to create a fresh review.");
   const response=plan?await fetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resolve",id:plan.id,choices:decisions,offset:plan.offset,acknowledgeWarnings:!file&&warnings})}):await fetch("/api/imports/preview",{method:"POST",headers:{"content-type":"application/octet-stream","x-file-name":encodeURIComponent(file!.name),"x-import-options":JSON.stringify({sheetId:preview!.sheetId,headerRow:preview!.headerRow,mapping:preview!.mapping,rules:{effectiveDate:date,numericFormat:format,approveTextNumbers:text,approveUnits:units,acknowledgeWarnings:warnings,decisions:{}}})},body:file});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"The dry run failed.");setPlan(data.plan);setDecisions({});setSkip(false);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function page(offset:number){
  if(!plan)return;setBusy(true);setError("");
  try{
   const response=Object.keys(decisions).length||(!file&&warnings)?await fetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resolve",id:plan.id,choices:decisions,offset,acknowledgeWarnings:!file&&warnings})}):await fetch("/api/imports?"+new URLSearchParams({plan:plan.id,offset:String(offset)}),{cache:"no-store"});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"The preview page is unavailable.");setPlan(data.plan);setDecisions({});
  }catch(e){setError((e as Error).message);setPlan({...plan,canCommit:false});}finally{setBusy(false);}
 }
 async function commit(){
  if(!plan)return;setBusy(true);setError("");
  try{
   const response=await fetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"commit",id:plan.id,acknowledgeRejected:skip})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"The import could not be committed.");
   setSuccess(`Imported ${data.accepted} rows; ${data.rejected} rows were rejected. Open Import history to undo. Refresh the page to see the current catalog.`);setPlan(null);window.dispatchEvent(new Event("rebatehq-import"));
  }catch(e){setError((e as Error).message);setPlan(null);setDecisions({});}finally{setBusy(false);}
 }
 return <section className="import-commit" aria-busy={busy}>
  <h3>Preview changes before importing</h3>
  <p>Up to {MAX_IMPORT_DATA_ROWS.toLocaleString("en-US")} data rows per file, including unchanged rows. One commit applies the whole valid import atomically. Existing SKUs, row IDs and base units are protected. Costs use the standard basis; prices use the file-import list. Dates apply to costs and prices. Description and supplier changes apply immediately. Quantity does not change inventory.</p>
  {file?<><div className="import-controls">
   <label>Effective date when the file has none<input type="date" value={date} disabled={busy} onChange={e=>{invalidate();setDate(e.target.value);}}/></label>
   <label>Text-number decimal separator<select value={format} disabled={busy} onChange={e=>{invalidate();setFormat(e.target.value as "dot"|"comma");}}><option value="dot">Dot: 12.50</option><option value="comma">Comma: 12,50</option></select></label>
  </div></>:null}
  {!file&&plan?.warnings.length?<label className="import-check"><input type="checkbox" checked={warnings} disabled={busy} onChange={e=>{setWarnings(e.target.checked);setPlan({...plan,canCommit:false});}}/>I reviewed the fetched source issues and warnings. Save this acknowledgement with Refresh preview before committing.</label>:null}
  {file?<div className="import-consents">
   <label><input type="checkbox" checked={text} disabled={busy} onChange={e=>{invalidate();setText(e.target.checked);}}/>Approve converting text numbers using the selected separator. No grouping separators or rounding of input amounts.</label>
   <label><input type="checkbox" checked={units} disabled={busy} onChange={e=>{invalidate();setUnits(e.target.checked);}}/>Approve listed unit conversions and four-decimal rounding of cost and price per base unit.</label>
   <label><input type="checkbox" checked={warnings} disabled={busy} onChange={e=>{invalidate();setWarnings(e.target.checked);}}/>I reviewed the source issues above, including merged or hidden cells. Rejected rows will still be excluded.</label>
  </div>:null}
  {busy?<p role="status">Checking the import…</p>:null}
  {error?<p role="alert" className="import-issue">⚠ {error}</p>:null}
  {success?<p role="status" className="success-note">{success}</p>:null}
  {plan?<>
   <h4>Before and after</h4>
   <p>Amounts in {plan.currency} · {plan.counts.new} new · {plan.counts.changed} changed · {plan.counts.unchanged} unchanged · {plan.counts.rejected} rejected · {plan.conflicts} unresolved conflicts</p>
   <p>Rows {plan.offset+1}–{plan.offset+plan.rows.length} of {plan.totalRows.toLocaleString("en-US")}. Conflict choices are saved when refreshing or changing pages.</p>
   {plan.warnings.length?<details><summary>Source warnings ({plan.warnings.length})</summary>{plan.warnings.map((w,i)=><p key={i} className="import-issue">⚠ {w}</p>)}</details>:null}
   <div className="data-table" tabIndex={0} aria-label="Import change rows"><table><caption>Review every row. No catalog changes have been written.</caption><thead><tr><th>Source row / SKU</th><th>Status</th><th>Current app value</th><th>Proposed file value</th><th>Issues or conflict choice</th></tr></thead><tbody>{plan.rows.map(r=><tr key={r.row}>
    <th scope="row">Row {r.row} · {r.after?.sku||r.before?.sku||"Rejected"}</th><td>{r.state}</td><td>{display(r.before)}</td><td>{r.after?display(r.after):"Excluded"}</td><td>
     {r.messages.map((m,i)=><p key={i} className="import-issue">⚠ {m}</p>)}
     {r.conflict?<><p className="import-issue">⚠ Changed in the app since export.</p><p>At export: {display(r.conflict.baseline)}</p><p>App now: {display(r.conflict.app)}</p><p>File: {display(r.conflict.file)}</p>
      <label>Conflict choice for row {r.row}<select aria-label={`Conflict choice for row ${r.row}`} value={decisions[String(r.row)]||r.conflict.choice} disabled={busy} onChange={e=>{setDecisions({...decisions,[String(r.row)]:e.target.value as "app"|"file"|"review"});setPlan({...plan,canCommit:false});}}><option value="review">Review — do not commit</option><option value="app">Keep mine — current app value</option><option value="file">Keep theirs — uploaded file value</option></select></label></>:null}
    </td></tr>)}</tbody></table></div>
   <div className="import-controls"><button type="button" disabled={busy||plan.offset===0} onClick={()=>page(Math.max(0,plan.offset-plan.pageSize))}>Previous rows</button><button type="button" disabled={busy||plan.offset+plan.rows.length>=plan.totalRows} onClick={()=>page(plan.offset+plan.pageSize)}>Next rows</button></div>
   {plan.counts.rejected>0?<label className="import-check"><input type="checkbox" checked={skip} disabled={busy} onChange={e=>setSkip(e.target.checked)}/>Commit valid rows only; skip the {plan.counts.rejected} rejected rows.</label>:null}
   <p>Preview expires at {new Date(plan.expiresAt).toLocaleTimeString()}. Any later app edit requires another preview.</p>
  </>:null}
  {file||plan?<div className="import-controls"><button type="button" className={plan?.canCommit?"":"primary"} disabled={busy} onClick={dryRun}>{plan?"Refresh preview and conflict choices":"Preview changes"}</button>{plan?.canCommit?<button type="button" className="primary" disabled={busy||(plan.counts.rejected>0&&!skip)||(!file&&plan.warnings.length>0&&!warnings)} onClick={commit}>Commit {plan.counts.new+plan.counts.changed} valid rows</button>:null}</div>:null}
 </section>;
}
