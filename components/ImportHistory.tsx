"use client";
import {useEffect,useState,useCallback} from "react";
import type {ImportHistory as History} from "@/lib/import-lifecycle-types";
import {MAX_IMPORT_DATA_ROWS} from "@/lib/import-config";
export function ImportHistory(){
 const [rows,setRows]=useState<History[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[supplier,setSupplier]=useState(""),[confirm,setConfirm]=useState<string|null>(null);
 const load=useCallback(async()=>{setBusy(true);setError("");try{const r=await fetch("/api/imports",{cache:"no-store"}),data=await r.json();if(!r.ok)throw new Error(data.error||"History is unavailable.");setRows(data.history);}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[]);
 useEffect(()=>{void load();const refresh=()=>{void load();};window.addEventListener("margindesk-import",refresh);return()=>window.removeEventListener("margindesk-import",refresh);},[load]);
 async function action(kind:"export"|"undo",id?:string){
  setBusy(true);setError("");setNotice("");
  try{
   const r=await fetch("/api/imports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(kind==="export"?{action:kind,supplier:supplier||undefined}:{action:kind,id})});
   if(!r.ok){const data=await r.json();throw new Error(data.error||"This action could not be completed.");}
   if(kind==="export"){
    const url=URL.createObjectURL(await r.blob()),link=document.createElement("a");link.href=url;link.download="margindesk-lifeline.csv";link.click();URL.revokeObjectURL(url);setNotice("Export ready. Keep md_row_id, md_version, SKU and Unit unchanged. Re-upload to review edits.");
   }else{setNotice("Import undone. Catalog rows and dated history were restored; audit and import history remain. Refresh the page to see the catalog.");setConfirm(null);window.dispatchEvent(new Event("margindesk-import"));await load();}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="app-card import-wizard" aria-busy={busy}>
  <h2>Excel lifeline and import history</h2>
  <p>Export a CSV for Excel, edit values, then re-upload above. Keep the ID, version, SKU and base-unit columns. Export or import up to {MAX_IMPORT_DATA_ROWS.toLocaleString("en-US")} data rows per file. No omitted row is deleted.</p>
  <div className="import-controls"><label>Filter export by exact supplier (optional)<input value={supplier} maxLength={200} disabled={busy} onChange={e=>setSupplier(e.target.value)}/></label><button type="button" disabled={busy} onClick={()=>action("export")}>Export for Excel</button><button type="button" disabled={busy} onClick={load}>Refresh history</button></div>
  {busy?<p role="status">Loading…</p>:null}{error?<p role="alert" className="import-issue">⚠ {error}</p>:null}{notice?<p role="status" className="success-note">{notice}</p>:null}
  {!rows.length&&!busy&&!error?<p>No imports yet. Review a supplier file above to begin.</p>:null}
  {rows.length?<div className="data-table"><table><caption>Latest 50 imports in this workspace. Undo preserves later edits by refusing conflicting changes.</caption><thead><tr><th>File</th><th>Who / when</th><th>Status</th><th>Rows</th><th>Undo</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><th scope="row">{r.filename}</th><td>{r.who}<br/>{new Date(r.when).toLocaleString()}</td><td>{r.status}{r.undoneAt?<><br/>{new Date(r.undoneAt).toLocaleString()}</>:null}</td><td>{r.accepted} written · {r.unchanged} unchanged · {r.rejected} rejected</td><td>{r.canUndo?(confirm===r.id?<><p>Restore all rows changed by this import? Later changes or references will block undo.</p><button type="button" disabled={busy} onClick={()=>action("undo",r.id)}>Confirm undo</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></>:<button type="button" disabled={busy} onClick={()=>setConfirm(r.id)}>Undo import</button>):"—"}</td></tr>)}</tbody></table></div>:null}
 </section>;
}
