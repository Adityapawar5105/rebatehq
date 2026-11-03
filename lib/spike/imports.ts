import * as duckdb from "@duckdb/duckdb-wasm";
import {Table,makeData,makeVector,Utf8} from "apache-arrow";
import type {Engine} from "./db";
import {CSV_FIELDS,MAX_LINES,SpikeError,sqlText} from "./exact";
import {streamCsv,exactRow,xlsxRows,cleanCsv,rowValues,type ExactRow} from "./converter";
export type Progress=(stage:string,done:number,total:number)=>void;
function utf8(values:string[]){
 // Arrow's generic string builder uses new Function for validity checks.
 // Build non-null UTF-8 vectors explicitly so production CSP stays strict.
 const chunks=values.map(value=>new TextEncoder().encode(value)),offsets=new Int32Array(values.length+1);
 for(let i=0;i<chunks.length;i++)offsets[i+1]=offsets[i]+chunks[i].length;
 const bytes=new Uint8Array(offsets.at(-1)!);for(let i=0;i<chunks.length;i++)bytes.set(chunks[i],offsets[i]);
 return makeVector(makeData({type:new Utf8(),data:bytes,valueOffsets:offsets,length:values.length,nullCount:0}));
}
export async function appendPapa(engine:Engine,file:File,table:string,signal:AbortSignal,progress:Progress,decimal:"dot"|"comma"="dot"){
 let loaded=0;
 progress("PapaParse → Arrow append",0,file.size);
 await streamCsv(file,async(values,start,bytes)=>{
  signal.throwIfAborted();
  const rows=values.map((r,i)=>exactRow(r,file.name,start+i,decimal));
  // The Wasm API exposes Arrow append, not the native C Appender object.
  // Typed Int64 columns preserve exact minor units across the worker boundary.
  const big=(key:keyof ExactRow)=>makeVector(BigInt64Array.from(rows,r=>BigInt(r[key])));
  const int=(key:keyof ExactRow)=>makeVector(Int32Array.from(rows,r=>Number(r[key])));
  if(rows.length)await engine.conn.insertArrowTable(new Table({
   line_id:big("line_id"),product_id:int("product_id"),customer_id:int("customer_id"),
   sale_date:utf8(rows.map(r=>r.sale_date)),quantity:int("quantity"),
   list_cents:big("list_cents"),discount_cents:big("discount_cents"),freight_cents:big("freight_cents"),
   rebate_cents:big("rebate_cents"),cost_cents:big("cost_cents"),source_file:utf8(rows.map(r=>r.source_file))
  }),{name:table,create:false});
  loaded+=rows.length;progress("PapaParse → Arrow append",bytes,file.size);
 },signal,/\.tsv$/i.test(file.name)?"\t":decimal==="comma"?";":",");
 return loaded;
}
export function nativeInsertSql(table:string,path:string,source:string){
 if(!/^(bench_native|import_stage)$/.test(table))throw new SpikeError("Unsupported spike staging table.");
 const amount=(field:string,column:string)=>`CASE WHEN regexp_full_match(${field},'^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,2})?$') THEN (CAST(${field} AS DECIMAL(18,2))*100)::BIGINT ELSE error('Row '||(source_row+1)||', column ${column}: invalid exact decimal amount.') END`;
 const positive=(field:string,max:string,column:string)=>`CASE WHEN regexp_full_match(${field},'^[1-9][0-9]*$') AND try_cast(${field} AS BIGINT) BETWEEN 1 AND ${max} THEN CAST(${field} AS BIGINT) ELSE error('Row '||(source_row+1)||', column ${column}: invalid positive whole number.') END`;
 return `INSERT INTO ${table}
 WITH source AS (SELECT *,row_number() OVER() AS source_row FROM read_csv(${sqlText(path)},header=true,auto_detect=false,delim=',',quote='"',escape='"',columns={${CSV_FIELDS.map(f=>sqlText(f)+":'VARCHAR'").join(",")}},strict_mode=true))
 SELECT ${positive("line_id","999999999999999","A")},${positive("product_id","200000","B")},${positive("customer_id","2000000000","C")},
 CASE WHEN regexp_full_match(sale_date,'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND try_cast(sale_date AS DATE)::VARCHAR=sale_date THEN CAST(sale_date AS DATE) ELSE error('Row '||(source_row+1)||', column D: invalid date.') END,
 ${positive("quantity","1000000","E")},${amount("list_amount","F")},${amount("discount_amount","G")},${amount("freight_amount","H")},${amount("rebate_amount","I")},${amount("cost_amount","J")},${sqlText(source)} FROM source`;
}
export async function nativeRead(engine:Engine,file:File,table:string,signal:AbortSignal,progress:Progress,opfsPath?:string){
 // Header check is bounded and does not parse the entire CSV on the UI thread.
 const prefix=await file.slice(0,65536).text();
 const first=prefix.replace(/^\uFEFF/,"").split(/\r?\n/)[0].replace(/\r$/,"");
 if(first!==CSV_FIELDS.join(","))throw new SpikeError("Row 1: use the spike's ten CSV columns in order.");
 const path=opfsPath||"local-"+crypto.randomUUID()+".csv";
 if(opfsPath)await engine.db.registerOPFSFileName(path);
 else await engine.db.registerFileHandle(path,file,duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,true);
 try{
  signal.throwIfAborted();progress("DuckDB read_csv (cancellation waits for current statement)",0,file.size);
  await engine.conn.query(nativeInsertSql(table,path,file.name));signal.throwIfAborted();
  progress("DuckDB read_csv",file.size,file.size);
 }finally{await engine.db.dropFile(path);}
}
export async function importFiles(engine:Engine,files:File[],method:"papa"|"native",signal:AbortSignal,progress:Progress){
 if(files.length<1||files.length>32)throw new SpikeError("Choose 1–32 local files.");
 if(new Set(files.map(f=>f.name)).size!==files.length)throw new SpikeError("Use unique source file names for this spike.");
 for(const f of files)if(!/\.(csv|tsv|xlsx)$/i.test(f.name)||f.size>256*1024*1024||f.name.length>200)throw new SpikeError("Choose .csv, .tsv or .xlsx files below the 256 MiB spike limit.");
 await engine.conn.query("BEGIN; CREATE TEMP TABLE import_stage AS SELECT * FROM sales_lines WHERE false");
 const issues=[];
 try{
  for(const original of files){
   let file=original;
   if(/\.xlsx$/i.test(file.name)){
    const result=await xlsxRows(file);issues.push(...result.issues);
    file=new File([cleanCsv(result.rows.map((r,i)=>rowValues(exactRow(r,original.name,i+2))))],original.name+".csv",{type:"text/csv"});
   }
   if(method==="native"&&/\.csv$/i.test(file.name))await nativeRead(engine,file,"import_stage",signal,progress);
   else await appendPapa(engine,file,"import_stage",signal,progress);
   if(file!==original)await engine.conn.query(`UPDATE import_stage SET source_file=${sqlText(original.name)} WHERE source_file=${sqlText(file.name)}`);
   signal.throwIfAborted();
  }
  const stats=(await engine.conn.query("SELECT count(*)::VARCHAR AS rows,count(DISTINCT (source_file,line_id))::VARCHAR AS unique_rows FROM import_stage")).toArray()[0];
  if(Number(stats.rows)>MAX_LINES||stats.rows!==stats.unique_rows)throw new SpikeError("Import exceeds two million rows or repeats a line ID within a source file.");
  await engine.conn.query("INSERT INTO sales_lines SELECT * FROM import_stage; DROP TABLE import_stage; COMMIT; CHECKPOINT");
  return {rows:String(stats.rows),sources:(await engine.conn.query("SELECT source_file,count(*)::VARCHAR AS rows FROM sales_lines GROUP BY source_file ORDER BY source_file")).toArray().map(r=>({source_file:String(r.source_file),rows:String(r.rows)})),issues};
 }catch(e){await engine.conn.query("ROLLBACK");if(signal.aborted)throw new SpikeError("Import cancelled. No rows were committed.");throw e;}
}
