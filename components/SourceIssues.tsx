"use client";
import {useState} from "react";
import {csvDocument} from "@/lib/csv";
import {IMPORT_PREVIEW_PAGE_SIZE} from "@/lib/import-config";
import type {UploadIssue,UploadPreview} from "@/lib/upload-types";
export function SourceIssues({preview,expanded}:{preview:Pick<UploadPreview,"jobId"|"issues"|"totalIssues">;expanded:boolean}){
 const total=preview.totalIssues??preview.issues.length;
 const [issues,setIssues]=useState(preview.issues),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function page(start:number,limit=IMPORT_PREVIEW_PAGE_SIZE){
  const response=await fetch("/api/import-preview?"+new URLSearchParams({job:preview.jobId,offset:String(start),limit:String(limit)}),{cache:"no-store"});
  const data=await response.json();if(!response.ok)throw new Error(data.error||"Issue pages are unavailable.");return data as {issues:UploadIssue[]};
 }
 async function load(start:number){setBusy(true);setError("");try{const data=await page(start);setIssues(data.issues);setOffset(start);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function download(){
  setBusy(true);setError("");
  try{
   const all:UploadIssue[]=[];
   if(total<=preview.issues.length)all.push(...preview.issues);
   else for(let i=0;i<total;i+=IMPORT_PREVIEW_PAGE_SIZE*10)all.push(...(await page(i,IMPORT_PREVIEW_PAGE_SIZE*10)).issues);
   if(all.length!==total)throw new Error("The issue count changed. Re-read the source file before downloading.");
   const url=URL.createObjectURL(new Blob([csvDocument(["Sheet","Row","Column","Issue"],all.map(i=>[i.sheet,i.row,i.column,i.message]))],{type:"text/csv;charset=utf-8"}));
   const link=document.createElement("a");link.href=url;link.download="file-issues.csv";link.click();URL.revokeObjectURL(url);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(!total)return <p role="status">No issues found by these checks. Review the change preview before committing.</p>;
 return <div aria-busy={busy}>
  <p className="import-issue">⚠ Review every source issue. Changes require explicit approvals and a final commit.</p>
  <details open={expanded}><summary>All {total.toLocaleString("en-US")} issues — paged</summary>
   <p>Issues {offset+1}–{Math.min(offset+issues.length,total)} of {total.toLocaleString("en-US")}</p>
   <div className="data-table import-issues" tabIndex={0} aria-label="Source issues"><table><caption>Issues by original sheet, row and column</caption><thead><tr><th>Location</th><th>Issue</th></tr></thead><tbody>{issues.map((i,n)=><tr key={n}><td>{i.sheet} · Row {i.row}, column {i.column}</td><td>⚠ {i.message}</td></tr>)}</tbody></table></div>
   <div className="import-controls"><button type="button" disabled={busy||offset===0} onClick={()=>load(Math.max(0,offset-IMPORT_PREVIEW_PAGE_SIZE))}>Previous issues</button><button type="button" disabled={busy||offset+issues.length>=total} onClick={()=>load(offset+IMPORT_PREVIEW_PAGE_SIZE)}>Next issues</button></div>
  </details>
  <button type="button" disabled={busy} onClick={download}>Download all {total.toLocaleString("en-US")} issues</button>
  {busy?<p role="status">Loading issues…</p>:null}{error?<p role="alert" className="import-issue">⚠ {error}</p>:null}
 </div>;
}
