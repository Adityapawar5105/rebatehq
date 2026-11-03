import Papa from "papaparse";
import JSZip from "jszip";
import {CSV_FIELDS,minorUnits,decimalText,boundedInteger,validDate,SpikeError,MAX_PRODUCTS} from "./exact";
export type Issue={row:number;column:string;message:string};
export type ExactRow={line_id:bigint;product_id:number;customer_id:number;sale_date:string;quantity:number;list_cents:bigint;discount_cents:bigint;freight_cents:bigint;rebate_cents:bigint;cost_cents:bigint;source_file:string};
export function columnLetter(index:number){let s="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export function validateHeaders(headers:string[]){
 if(headers.length!==CSV_FIELDS.length||!CSV_FIELDS.every((f,i)=>headers[i]===f))throw new SpikeError("Row 1: use the spike's ten documented CSV columns in order. No columns were silently remapped.");
}
export function exactRow(values:string[],source:string,row:number,decimal:"dot"|"comma"="dot"):ExactRow{
 if(values.length!==CSV_FIELDS.length)throw new SpikeError(`Row ${row}: expected ten columns.`);
 const field=<T>(i:number,fn:(value:string)=>T)=>{try{return fn(values[i]);}catch(e){throw new SpikeError(`Row ${row}, column ${columnLetter(i)}: ${e instanceof SpikeError?e.message:"Invalid value."}`);}};
 const line_id=field(0,v=>{if(!/^[1-9]\d{0,14}$/.test(v))throw new SpikeError("Use a positive whole line ID.");return BigInt(v);});
 const product_id=field(1,v=>boundedInteger(v,MAX_PRODUCTS)),customer_id=field(2,v=>boundedInteger(v,2_000_000_000));
 const sale_date=field(3,validDate),quantity=field(4,v=>boundedInteger(v,1_000_000));
 if(product_id===0||customer_id===0||quantity===0)throw new SpikeError(`Row ${row}, columns B/C/E: IDs and quantity must be positive.`);
 return {line_id,product_id,customer_id,sale_date,quantity,list_cents:field(5,v=>minorUnits(v,decimal)),discount_cents:field(6,v=>minorUnits(v,decimal)),freight_cents:field(7,v=>minorUnits(v,decimal)),rebate_cents:field(8,v=>minorUnits(v,decimal)),cost_cents:field(9,v=>minorUnits(v,decimal)),source_file:source};
}
export function rowValues(row:ExactRow){
 return [row.line_id.toString(),String(row.product_id),String(row.customer_id),row.sale_date,String(row.quantity),decimalText(row.list_cents),decimalText(row.discount_cents),decimalText(row.freight_cents),decimalText(row.rebate_cents),decimalText(row.cost_cents)];
}
export function cleanCsv(rows:string[][],header=true){return Papa.unparse({fields:[...CSV_FIELDS],data:rows},{header,newline:"\n",escapeFormulae:true})+"\n";}
export async function streamCsv(file:File,onChunk:(rows:string[][],rowStart:number,bytes:number)=>Promise<void>,signal:AbortSignal,delimiter=","){
 // Parse each bounded text chunk ourselves instead of Papa's nested worker.
 // This worker owns FileReaderSync; no entire-file text/row array is created.
 let line=2,first=true,total=0;
 await new Promise<void>((resolve,reject)=>{
  Papa.parse<string[]>(file,{header:false,dynamicTyping:false,skipEmptyLines:true,delimiter,chunkSize:1024*1024,
   chunk(result,parser){
    parser.pause();
    void (async()=>{
     signal.throwIfAborted();
     if(result.errors.length)throw new SpikeError(`Row ${line}: invalid CSV quoting or column structure.`);
     const rows=result.data;
     if(first){first=false;validateHeaders(rows.shift()||[]);}
     for(const row of rows)if(row.length>64||row.some(v=>v.length>2000))throw new SpikeError(`Row ${line}: a column or cell exceeds the spike limit.`);
     await onChunk(rows,line,Math.min(file.size,result.meta.cursor));line+=rows.length;total+=rows.length;
     if(total>2_000_000)throw new SpikeError("The file exceeds the two-million-line spike cap.");
     parser.resume();
    })().catch(e=>{reject(e instanceof SpikeError?e:new SpikeError(signal.aborted?"Import cancelled. No rows were committed.":"The CSV chunk could not be appended.",{cause:e}));parser.abort();});
   },
   complete(){resolve();},
   error(){reject(new SpikeError("This local file could not be read."));}
  });
 });
 if(first)throw new SpikeError("The file is empty.");
}
function zipDirectory(bytes:Uint8Array){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<22||v.getUint32(0,true)!==0x04034b50)throw new SpikeError("Not a valid XLSX archive.");
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw new SpikeError("Unsupported XLSX ZIP directory.");
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);
 if(count<1||count>256||start+v.getUint32(end+12,true)!==end)throw new SpikeError("Invalid or oversized XLSX directory.");
 let at=start,total=0;
 const names=new Set<string>();
 for(let i=0;i<count;i++){
  if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw new SpikeError("Invalid XLSX ZIP entry.");
  const packed=v.getUint32(at+20,true),size=v.getUint32(at+24,true),n=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true);
  if(at+46+n+extra+comment>end||v.getUint16(at+8,true)&1)throw new SpikeError("Unsupported XLSX entry.");
  const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(at+46,at+46+n));at+=46+n+extra+comment;
  if(names.has(name)||name.startsWith("/")||name.includes("\\")||name.split("/").some(x=>x==="..")||/vba|macro|activex|embeddings|externalLinks/i.test(name))throw new SpikeError("Macros, external links, embedded objects or unsafe paths are not accepted.");
  names.add(name);
  if(size>16*1024*1024||(total+=size)>64*1024*1024||size>100000&&size/Math.max(1,packed)>200)throw new SpikeError("XLSX expands beyond the spike's safe limits.");
 }
 if(at!==end)throw new SpikeError("Invalid XLSX directory length.");
}
export async function xlsxRows(file:File):Promise<{rows:string[][];issues:Issue[]}>{
 if(file.size>8*1024*1024)throw new SpikeError("XLSX conversion in this spike is capped at 8 MiB; use CSV for large sets.");
 const bytes=new Uint8Array(await file.arrayBuffer());zipDirectory(bytes);
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
 for(const [name,entry] of Object.entries(zip.files))if(!entry.dir&&/\.(xml|rels)$/i.test(name)){
  const text=await entry.async("string");
  if(/<!\s*(DOCTYPE|ENTITY)/i.test(text)||/<Relationship\b[^>]*TargetMode\s*=\s*["']External/i.test(text))throw new SpikeError("Workbook XML entities or external relationships are not allowed.");
 }
 const ExcelJS=(await import("exceljs")).default;
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
 if(workbook.worksheets.length!==1)throw new SpikeError("This spike accepts one XLSX sheet. The full sheet picker is deferred.");
 const sheet=workbook.worksheets[0],issues:Issue[]=[],rows:string[][]=[];
 if(sheet.rowCount>10_001||sheet.columnCount>64)throw new SpikeError("XLSX spike limit is 10,000 data rows and 64 columns.");
 if(sheet.model.merges.length)issues.push({row:1,column:"A",message:"Merged cells are present; inspect the workbook before loading."});
 for(let i=1;i<=sheet.columnCount;i++)if(sheet.getColumn(i).hidden)issues.push({row:1,column:columnLetter(i-1),message:"This workbook column is hidden."});
 sheet.eachRow({includeEmpty:false},(row,n)=>{
  const values:string[]=[];let rejected=false;
  for(let c=1;c<=CSV_FIELDS.length;c++){
   const cell=row.getCell(c),value=cell.value;
   if(cell.type===ExcelJS.ValueType.Formula||value&&typeof value==="object"&&("formula" in value||"sharedFormula" in value)){
    issues.push({row:n,column:columnLetter(c-1),message:"Formula ignored; its cached result was not read."});rejected=true;values.push("");
   }else if(value===null||value===undefined)values.push("");
   else if(typeof value==="string"||typeof value==="number")values.push(String(value));
   else {issues.push({row:n,column:columnLetter(c-1),message:"Use a plain data cell; no object or link was evaluated."});rejected=true;values.push("");}
  }
  if(!rejected)rows.push(values);
 });
 validateHeaders(rows.shift()||[]);return {rows,issues};
}
export async function convertSmallFile(file:File,decimal:"dot"|"comma"="dot"){
 if(file.size>8*1024*1024)throw new SpikeError("The conversion demonstration is capped at 8 MiB; large CSV import remains streamed.");
 const issues:Issue[]=[],values:string[][]=[];
 if(/\.xlsx$/i.test(file.name)){const result=await xlsxRows(file);issues.push(...result.issues);for(let i=0;i<result.rows.length;i++)values.push(rowValues(exactRow(result.rows[i],file.name,i+2,decimal)));}
 else if(/\.(csv|tsv)$/i.test(file.name)){
  const controller=new AbortController();await streamCsv(file,async(rows,start)=>{for(let i=0;i<rows.length;i++)values.push(rowValues(exactRow(rows[i],file.name,start+i,decimal)));},controller.signal,/\.tsv$/i.test(file.name)?"\t":decimal==="comma"?";":",");
 }else throw new SpikeError("Choose a data-only .xlsx, .csv or .tsv file.");
 return {name:file.name.replace(/\.[^.]+$/,"")+".csv",blob:new Blob([cleanCsv(values)],{type:"text/csv;charset=utf-8"}),rows:values.length,issues};
}
