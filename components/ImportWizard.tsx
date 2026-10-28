"use client";
import { useRef,useState } from "react";
import { csvDocument } from "@/lib/csv";
import { IMPORT_FIELDS,UPLOAD_LIMITS,type ColumnMapping,type UploadPreview } from "@/lib/upload-types";
const labels={sku:"SKU",description:"Description",unit:"Unit",cost:"Cost",price:"Price",supplier:"Supplier",date:"Date",quantity:"Quantity"};
const letter=(index:number)=>{let s="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
async function responseData(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.error||"We couldn't complete this review. Try again.");return body;}
function download(name:string,headers:string[],rows:unknown[][]){const url=URL.createObjectURL(new Blob([csvDocument(headers,rows)],{type:"text/csv;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);}
export function ImportWizard(){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<UploadPreview|null>(null),[mapping,setMapping]=useState<ColumnMapping>({}),[step,setStep]=useState(0),[supplier,setSupplier]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const heading=useRef<HTMLHeadingElement>(null);
 async function review(options:{sheetId?:string;headerRow?:number;mapping?:ColumnMapping}={},nextStep=1){
  if(!file)return;setBusy(true);setError("");setNotice("");
  try{const data:UploadPreview=await responseData(await fetch("/api/import-preview",{method:"POST",headers:{"content-type":"application/octet-stream","x-file-name":encodeURIComponent(file.name),"x-import-options":JSON.stringify(options)},body:file}));setPreview(data);setMapping(data.mapping);setStep(nextStep);setNotice(nextStep===2?"Review complete. No business data was imported.":"File read. Confirm the sheet, header and column mapping.");requestAnimationFrame(()=>heading.current?.focus());}
  catch(e){setError(e instanceof Error?e.message:"We couldn't read this file.");}finally{setBusy(false);}
 }
 async function template(action:"save"|"load"){
  if(!preview||!supplier.trim())return;setBusy(true);setError("");setNotice("");
  try{
   const key={supplier:supplier.trim(),fileType:preview.fileType};
   if(action==="save"){
    await responseData(await fetch("/api/mapping-templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...key,fields:mapping,headers:preview.headers})}));setNotice("Template saved for this supplier and file type in this workspace.");
   }else{
    const result=await responseData(await fetch("/api/mapping-templates?"+new URLSearchParams(key)));
    if(!result.template){setNotice("No template for this supplier and file type yet. Map the columns below, then save it.");return;}
    if(result.template.headersFingerprint!==preview.headersFingerprint)throw new Error("This template was saved for different headers or a different column order. Map this file explicitly before saving a replacement.");
    setMapping(result.template.fields);setNotice("Template loaded. Review the mapping before continuing.");
   }
  }catch(e){setError(e instanceof Error?e.message:"The template is unavailable.");}finally{setBusy(false);}
 }
 return <section className="app-card import-wizard" aria-busy={busy}>
  <h2 ref={heading} tabIndex={-1}>Review a supplier file</h2>
  <p>1. Choose a file → 2. Match columns → 3. Review issues. No product, price or cost data will be imported.</p>
  <p className="small">XLSX, CSV or TSV · UTF-8 text · 2 MB · 2,000 rows · 64 columns · 50,000 cells. Files are processed in memory and are not stored.</p>
  {error?<p role="alert" className="import-issue"><span aria-hidden="true">⚠ </span>{error}</p>:null}
  <p role="status" aria-live="polite">{busy?"Working on your file…":notice||(!file?"Choose a supplier file to start.":"")}</p>
  {step===0?<div className="import-controls"><label>Supplier file<input type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={e=>{const selected=e.target.files?.[0]||null;setError("");setPreview(null);setNotice("");if(selected&&selected.size>UPLOAD_LIMITS.bytes){setError("This file is larger than 2 MB. Split it before uploading.");setFile(null);}else setFile(selected);}}/></label><button type="button" className="primary" disabled={busy||!file} onClick={()=>review()}>Read file</button></div>:null}
  {preview&&step===1?<>
   <div className="import-controls">
    <label>Sheet<select aria-label="Sheet" disabled={busy} value={preview.sheetId} onChange={e=>review({sheetId:e.target.value})}>{preview.sheets.map(s=><option key={s.id} value={s.id}>{s.name}{s.hidden?" (hidden)":""}</option>)}</select></label>
    <label>Header row<input key={preview.headerRow+preview.sheetId} type="number" min="1" max="2000" defaultValue={preview.headerRow} disabled={busy} onBlur={e=>{const n=Number(e.target.value);if(n!==preview.headerRow)review({sheetId:preview.sheetId,headerRow:n});}}/></label>
    <label>Supplier for this template<input value={supplier} maxLength={120} disabled={busy} placeholder="Enter the supplier name" onChange={e=>setSupplier(e.target.value)}/></label>
    <button type="button" disabled={busy||!supplier.trim()} onClick={()=>template("load")}>Load template</button>
   </div>
   <p>Suggested matches need your review. Column letters identify duplicate or empty headers.</p>
   <div className="import-mapping">{IMPORT_FIELDS.map(field=><label key={field}>{labels[field]}<select aria-label={labels[field]} disabled={busy} value={mapping[field]??""} onChange={e=>{const next={...mapping};if(e.target.value==="")delete next[field];else next[field]=Number(e.target.value);setMapping(next);}}><option value="">Not mapped</option>{preview.headers.map((h,i)=><option key={i} value={i}>{letter(i)} · {h||"(no header)"}</option>)}</select></label>)}</div>
   <div className="import-controls"><button type="button" disabled={busy||!supplier.trim()||!Object.keys(mapping).length} onClick={()=>template("save")}>Save supplier template</button><button type="button" className="primary" disabled={busy} onClick={()=>review({sheetId:preview.sheetId,headerRow:preview.headerRow,mapping},2)}>Review mapped file</button></div>
  </>:null}
  {preview?<>
   <h3>{step===2?"Review results":"Source preview"}</h3><p>{preview.totalRows} data rows · {preview.issues.length} issues · Header row {preview.headerRow} · {preview.sheetName}</p><p>{preview.limits}</p>
   {preview.issues.length?<><p className="import-issue"><span aria-hidden="true">⚠ </span>Resolve or explicitly review these issues before a later import. Nothing has been corrected automatically.</p><details open={step===2}><summary>All {preview.issues.length} issues</summary><div className="data-table import-issues"><table><caption>Issues by original sheet, row and column</caption><thead><tr><th>Location</th><th>Issue</th></tr></thead><tbody>{preview.issues.map((item,i)=><tr key={i}><td>{item.sheet} · Row {item.row}, column {item.column}</td><td><span aria-hidden="true">⚠ </span>{item.message}</td></tr>)}</tbody></table></div></details></>:<p role="status">No issues found by these checks. This is a file review, not an approval of supplier terms.</p>}
   <div className="data-table"><table><caption>First {preview.rows.length} source rows; all cell text is inert</caption><thead><tr><th>Row</th>{preview.headers.map((h,i)=><th key={i}>{letter(i)} · {h||"(no header)"}</th>)}</tr></thead><tbody>{preview.rows.map(row=><tr key={row.row}><th scope="row">{row.row}</th>{preview.headers.map((_,i)=><td key={i}>{row.cells[i]?.value||""}</td>)}</tr>)}</tbody></table></div>
   <div className="import-controls"><button type="button" onClick={()=>download("file-issues.csv",["Sheet","Row","Column","Issue"],preview.issues.map(i=>[i.sheet,i.row,i.column,i.message]))}>Download issues</button><button type="button" onClick={()=>download("source-preview.csv",["Row",...preview.headers],preview.rows.map(r=>[r.row,...preview.headers.map((_,i)=>r.cells[i]?.value||"")]))}>Download preview rows</button>{step===2?<button type="button" disabled={busy} onClick={()=>setStep(1)}>Edit mapping</button>:null}<button type="button" className={step===2?"primary":""} disabled={busy} onClick={()=>{setStep(0);setPreview(null);setFile(null);setMapping({});setError("");setNotice("");}}>Review another file</button></div>
  </>:null}
 </section>;
}
