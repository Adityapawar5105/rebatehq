"use client";
import {useState} from "react";
import {ImportWizard} from "./ImportWizard";
import {IngestionPanel} from "./IngestionPanel";
export function ImportWorkspace({startScheduled=false}:{startScheduled?:boolean}){
 const [scheduled,setScheduled]=useState(startScheduled);
 return <><div className="import-controls import-workspace" role="group" aria-label="Choose a file ingestion method">
  <button type="button" aria-pressed={!scheduled} onClick={()=>setScheduled(false)}>Upload a file</button>
  <button type="button" aria-pressed={scheduled} onClick={()=>setScheduled(true)}>Scheduled file reviews</button>
 </div>{scheduled?<IngestionPanel/>:<ImportWizard/>}</>;
}
