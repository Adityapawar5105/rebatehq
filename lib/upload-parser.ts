// Server-side parsing only. Values remain source strings; no formula evaluation.
import { createHash } from "node:crypto";
import path from "node:path";
import { HttpError } from "./authz";
import {MAX_IMPORT_DATA_ROWS,IMPORT_HEADER_SCAN_ROWS} from "./import-config";
import { workbookParts,parseXml,list,xmlText } from "./upload-archive";
import { IMPORT_FIELDS,UPLOAD_LIMITS as L,type ColumnMapping,type ParsedUpload,type UploadIssue,type UploadRow,type Cell,type ImportField } from "./upload-types";
export const columnName=(index:number):string=>{let s="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function colIndex(s:string){let n=0;for(const c of s)n=n*26+c.charCodeAt(0)-64;return n-1;}
const aliases:Record<ImportField,string[]>={sku:["sku","item","itemnumber","productcode","partnumber","itemcode"],description:["description","productdescription","productname","name"],unit:["unit","uom","unitofmeasure","units"],cost:["cost","unitcost","suppliercost","purchaseprice"],price:["price","listprice","sellingprice","unitprice"],supplier:["supplier","vendor","suppliername","vendorname"],date:["date","effectivedate","effectivefrom","transactiondate"],quantity:["quantity","qty","orderquantity"]};
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function suggestMapping(headers:string[]):ColumnMapping {
 const result:ColumnMapping={};const used=new Set<number>();
 for(const field of IMPORT_FIELDS){let best=-1,score=0;headers.forEach((h,i)=>{const key=normalize(h);const value=Math.max(...aliases[field].map(a=>key===a?100:(key.length>=4&&(key.includes(a)||a.includes(key))?Math.min(key.length,a.length)/Math.max(key.length,a.length)*80:0)));if(!used.has(i)&&value>score){score=value;best=i;}});if(score>=55){result[field]=best;used.add(best);}}
 return result;
}
function reject(message:string):never{throw new HttpError(422,message);}
export function validateMapping(value:unknown,columns:number):ColumnMapping {
 if(!value||typeof value!=="object"||Array.isArray(value))reject("Choose which columns match MarginDesk fields.");
 const result:ColumnMapping={};const seen=new Set<number>();
 for(const [key,index] of Object.entries(value!)){if(!IMPORT_FIELDS.includes(key as ImportField)||!Number.isInteger(index)||Number(index)<0||Number(index)>=columns||seen.has(Number(index)))reject("Map each field to a different existing column.");result[key as ImportField]=Number(index);seen.add(Number(index));}
 return result;
}
export function parseDelimited(text:string,delimiter:string):UploadRow[] {
 const rows:UploadRow[]=[];let values:string[]=[],value="",quoted=false,closed=false,line=1,start=1,cells=0;
 const field=()=>{if(value.length>L.cellChars)reject("A cell exceeds the 2,000-character limit.");values.push(value);if(values.length>L.columns)reject("This file has more than 64 columns.");value="";closed=false;};
 const row=()=>{field();cells+=values.length;if(cells>L.cells)reject("This file has too many cells.");rows.push({row:start,cells:values.map(value=>({value,kind:"text"}))});if(rows.length>L.rows)reject(`This file exceeds the ${MAX_IMPORT_DATA_ROWS.toLocaleString("en-US")}-data-row limit plus header/preamble allowance.`);values=[];start=line+1;};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else{value+=c;if(c==='\n')line++;}continue;}
  if(closed&&c!==delimiter&&c!=='\r'&&c!=='\n')reject("A quoted cell has unexpected text after its closing quote.");
  if(c==='"'){if(value!=="")reject("A quote appears inside an unquoted cell. Quote the whole cell.");quoted=true;}
  else if(c===delimiter)field();
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row();line++;}
  else value+=c;
 }
 if(quoted)reject("A quoted cell was never closed.");
 if(value!==""||values.length||closed)row();
 return rows;
}
export type ParseOptions={sheetId?:string;headerRow?:number;mapping?:ColumnMapping};
function parseUploadInner(filename:string,bytes:Uint8Array,options:ParseOptions={}):ParsedUpload {
 if(!bytes.length)reject("This file is empty.");if(bytes.length>L.bytes)throw new HttpError(413,`This file exceeds the ${L.bytes.toLocaleString("en-US")}-byte upload limit. Split it into smaller files.`);
 const ext=path.extname(filename).toLowerCase().slice(1);if(!["xlsx","csv","tsv"].includes(ext))throw new HttpError(415,"Choose an .xlsx, .csv or .tsv file. Macro-enabled files are not accepted.");
 const issues:UploadIssue[]=[];let rows:UploadRow[]=[];let sheets:ParsedUpload["sheets"]=[],sheetId="text",sheetName="Text file";
 const issue=(code:string,row:number,column:string,message:string)=>{if(issues.length>=L.issues)reject(`This file has more than ${L.issues.toLocaleString("en-US")} issues. Split it to review every issue.`);issues.push({code,row,column,message,sheet:sheetName});};
 if(ext!=="xlsx"){
  let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{reject("Save this CSV/TSV as UTF-8 text before uploading.");}
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text!)||/^\s*(?:PK\x03\x04|<\?xml|<!DOCTYPE|<html|\{|\[)/i.test(text!))reject("The file contents are not a CSV/TSV table.");
  const bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;
  const counts:Record<string,number>={",":0,";":0,"\t":0};let quoted=false,lines=0;
  // Sniff a delimiter outside quoted cells, then parse once. Never retry a
  // different delimiter to make an over-limit or malformed file appear valid.
  for(let i=0;i<text!.length&&lines<25;i++){const c=text![i];if(c==='"'){if(quoted&&text![i+1]==='"')i++;else quoted=!quoted;}else if(!quoted){if(c in counts)counts[c]++;if(c==='\n')lines++;}}
  const delimiter=ext==="tsv"?"\t":[";","\t",","].sort((a,b)=>counts[b]-counts[a])[0];
  if(counts[delimiter]===0)reject("This file is not a supported table with at least two columns.");
  rows=parseDelimited(text!,delimiter);sheets=[{id:sheetId,name:sheetName,hidden:false}];
  if(bom)issue("bom",1,"A","This file starts with a UTF-8 byte-order mark. It is treated as an encoding marker, not part of the first column name.");
 }else{
  const parts=workbookParts(bytes);
  const read=(name:string)=>{const b=parts.get(name);if(!b)reject("The workbook is missing a required data part.");return parseXml(b!);};
  // Validate ALL XML, including unused sheets, before accepting a workbook.
  for(const [name,data] of parts)if(/\.(xml|rels)$/i.test(name)){
   const doc=parseXml(data);
   if(name==="[Content_Types].xml"&&/macroEnabled|vbaProject|activeX|oleObject/i.test(data.toString("utf8")))reject("Macro or embedded executable content is not accepted.");
   if(name.endsWith(".rels")&&list<any>(doc.Relationships?.Relationship).some(r=>r["@TargetMode"]==="External"))reject("External workbook links are not accepted. Save a data-only workbook.");
  }
  const types=read("[Content_Types].xml");
  if(!list<any>(types.Types?.Override).some(x=>x["@PartName"]==="/xl/workbook.xml"&&x["@ContentType"]==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"))reject("The file is not a data-only .xlsx workbook.");
  const book=read("xl/workbook.xml").workbook,rels=list<any>(read("xl/_rels/workbook.xml.rels").Relationships?.Relationship);
  if(!book)reject("The workbook definition is missing.");
  const defs=list<any>(book.sheets?.sheet);if(!defs.length||defs.length>16)reject("Choose a workbook with between 1 and 16 sheets.");
  sheets=defs.map((d,i)=>({id:String(i),name:String(d["@name"]||`Sheet ${i+1}`),hidden:d["@state"]==="hidden"||d["@state"]==="veryHidden"}));
  sheetId=options.sheetId??sheets.find(s=>!s.hidden)?.id??"0";const selected=sheets.find(s=>s.id===sheetId);if(!selected)reject("Choose an existing workbook sheet.");sheetName=selected!.name;
  if(selected!.hidden)issue("hidden_sheet",1,"A","This sheet is hidden in Excel. Its data is included because you selected it.");
  const relationship=rels.find(r=>r["@Id"]===defs[Number(sheetId)]["@r:id"]&&/\/worksheet$/.test(r["@Type"]||""));
  const target=String(relationship?.["@Target"]||"");if(!target||target.includes("..")||target.includes("\\"))reject("The selected sheet has an unsafe data path.");
  const sheetPath=target.startsWith("/")?target.slice(1):path.posix.join("xl",target);if(!/^xl\/worksheets\/[^/]+\.xml$/.test(sheetPath))reject("The selected sheet is not a supported worksheet.");
  const sheet=read(sheetPath).worksheet;if(!sheet)reject("The sheet contains no worksheet data.");
  const rich=(v:any)=>v?.t!==undefined?xmlText(v.t):list<any>(v?.r).map(r=>xmlText(r.t)).join("");
  const shared=parts.has("xl/sharedStrings.xml")?list<any>(read("xl/sharedStrings.xml").sst?.si).map(rich):[];
  if(shared.length>L.cells||shared.some(s=>s.length>L.cellChars))reject("Shared text exceeds the workbook cell limits.");
  const styles=parts.has("xl/styles.xml")?read("xl/styles.xml").styleSheet:{};
  const formats=list<any>(styles?.cellXfs?.xf),custom=list<any>(styles?.numFmts?.numFmt);
  let count=0,lastRow=0;
  for(const row of list<any>(sheet.sheetData?.row)){
   const rn=Number(row["@r"]);if(!Number.isInteger(rn)||rn<=lastRow||rn>L.rows)reject(`Workbook rows must be ordered and within 1–${L.rows.toLocaleString("en-US")}.`);lastRow=rn;
   const cells:Cell[]=[];let previous=-1;
   if(row["@hidden"]==="1"||row["@hidden"]==="true")issue("hidden_row",rn,"A","This row is hidden in Excel; review it before using it.");
   for(const cell of list<any>(row.c)){
    const match=/^([A-Z]+)([1-9][0-9]*)$/.exec(cell["@r"]||"");if(!match||Number(match[2])!==rn)reject("A workbook cell has an invalid row/column address.");const c=colIndex(match[1]);if(c<=previous||c>=L.columns||++count>L.cells)reject(`Workbook cells exceed the ${L.columns}-column/${L.cells.toLocaleString("en-US")}-cell limit or repeat an address.`);previous=c;
    while(cells.length<c)cells.push({value:"",kind:"text"});
    const type=cell["@t"]||"n";let value=xmlText(cell.v),kind:Cell["kind"]="text";
    if(cell.f!==undefined){kind="formula";value="="+xmlText(cell.f);issue("formula",rn,columnName(c),"This cell contains an Excel formula. It was not evaluated and its cached value is not used. Replace it with an approved value.");}
    else if(type==="s"){if(!/^\d+$/.test(value)||shared[Number(value)]===undefined)reject("A workbook cell references missing shared text.");value=shared[Number(value)];}
    else if(type==="inlineStr")value=rich(cell.is);
    else if(type==="b")kind="boolean";
    else if(type==="e"){kind="error";issue("excel_error",rn,columnName(c),"Excel stores an error in this cell. Replace it with a value.");}
    else if(type==="d")kind="date";
    else if(type==="n"&&value!==""){
     if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))reject("An Excel numeric cell contains invalid numeric data.");kind="number";
     const id=Number(formats[Number(cell["@s"]||0)]?.["@numFmtId"]||0);const fmt=custom.find(x=>Number(x["@numFmtId"])===id)?.["@formatCode"]||"";
     if((id>=14&&id<=22)||/[ymd]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g,"")))kind="date";
    }else if(!["str","inlineStr","n"].includes(type))reject("This workbook uses an unsupported cell data type.");
    if(value.length>L.cellChars)reject("A cell exceeds the 2,000-character limit.");cells.push({value,kind});
   }
   rows.push({row:rn,cells});
  }
  for(const merge of list<any>(sheet.mergeCells?.mergeCell)){const ref=String(merge["@ref"]||"");const m=/^([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/.exec(ref);if(!m)reject("The workbook has an invalid merged-cell range.");issue("merged_cell",Number(m![2]),m![1],`Merged range ${ref}: only the top-left source value exists; no values were filled in.`);}
  for(const col of list<any>(sheet.cols?.col))if(col["@hidden"]==="1"||col["@hidden"]==="true"){const n=Number(col["@min"]),end=Number(col["@max"]);if(!Number.isInteger(n)||n<1||end<n||end>16384)reject("A hidden-column range is invalid.");issue("hidden_column",1,columnName(n-1),`Column ${columnName(n-1)}${end===n?"":":"+columnName(end-1)} is hidden in Excel; its source data is still included.`);}
 }
 if(!rows.length)reject("The selected sheet has no rows.");
 let header=options.headerRow;
 if(header!==undefined&&(!Number.isInteger(header)||!rows.some(r=>r.row===header)))reject("Choose an existing header row.");
 if(header===undefined){let score=-1;for(const row of rows.slice(0,IMPORT_HEADER_SCAN_ROWS)){const s=Object.keys(suggestMapping(row.cells.map(c=>c.value))).length*100+row.cells.filter(c=>c.value.trim()).length;if(s>score){score=s;header=row.row;}}}
 const headers=rows.find(r=>r.row===header)!.cells.map(c=>c.value);const width=Math.max(...rows.map(r=>r.cells.length));while(headers.length<width)headers.push("");
 const mapping=options.mapping===undefined?suggestMapping(headers):validateMapping(options.mapping,width);
 if(options.headerRow===undefined)issue("header_suggestion",header!,"A","This header row was suggested. Confirm it or choose another row; rows above it are not treated as records.");
 for(let i=0;i<headers.length;i++){if(!headers[i].trim())issue("missing_header",header!,columnName(i),"This column has no header. Map it explicitly or leave it unused.");if(headers[i]&&headers.indexOf(headers[i])!==i)issue("duplicate_header",header!,columnName(i),"This header repeats another column. Confirm the mapping by column letter.");}
 const dataRows=rows.filter(r=>r.row>header!&&r.cells.some(c=>c.value!==""));const seen=new Map<string,number>();
 if(dataRows.length>MAX_IMPORT_DATA_ROWS)reject(`This file has more than ${MAX_IMPORT_DATA_ROWS.toLocaleString("en-US")} data rows.`);
 for(const row of rows){for(let c=0;c<row.cells.length;c++){
  const cell=row.cells[c],v=cell.value;
  if(v.includes("\uFEFF"))issue("bom_text",row.row,columnName(c),"This cell contains a byte-order-mark character inside its text. It was not removed.");
  if(cell.kind!=="formula"&&/^[\s\uFEFF]*[=+@-]/.test(v))issue("formula_text",row.row,columnName(c),"This text starts like a spreadsheet formula. It is shown as inert text and is neutralized in exports.");
  if(/[<>]|[\u202a-\u202e\u2066-\u2069]|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))issue("unsafe_text",row.row,columnName(c),"This cell contains markup or control characters. It is displayed as plain text, never HTML.");
 }}
 for(const row of dataRows){
  if(row.cells.length!==headers.length)issue("row_width",row.row,columnName(Math.min(row.cells.length,headers.length)-1),"This row has a different number of columns from the header; no cells were shifted or filled in.");
  for(const field of ["cost","price","quantity"] as const){const c=mapping[field];if(c===undefined)continue;const cell=row.cells[c];if(!cell||!cell.value.trim())continue;
   if(cell.kind!=="number"){
    if(/^[+-]?[0-9]+(?:[.,][0-9]+)?$/.test(cell.value.trim())){issue("text_number",row.row,columnName(c),"This number is stored as text. It was not converted. Correct the source or explicitly approve a numeric format in a later import step.");if(cell.value.includes(","))issue("comma_decimal",row.row,columnName(c),"This text uses a comma decimal separator. Its locale must be confirmed; no decimal conversion was made.");}
    else if(cell.kind!=="formula")issue("invalid_number",row.row,columnName(c),"This field needs a non-negative numeric value, not text, an error or a date.");
   }else if(cell.value.startsWith("-"))issue("negative_number",row.row,columnName(c),"This field is negative. Confirm the intended meaning before importing.");
  }
  const sku=mapping.sku===undefined?undefined:row.cells[mapping.sku];if(sku){if(!sku.value.trim())issue("missing_sku",row.row,columnName(mapping.sku!),"This row has no SKU.");else{const prior=seen.get(sku.value);if(prior!==undefined)issue("duplicate_sku",row.row,columnName(mapping.sku!),`This SKU repeats row ${prior}. Neither row was removed.`);else seen.set(sku.value,row.row);if(sku.value!==sku.value.trim())issue("sku_whitespace",row.row,columnName(mapping.sku!),"This SKU has surrounding spaces. They were not removed.");}}
  const dc=mapping.date;if(dc!==undefined){const value=row.cells[dc]?.value||"";if(value){const d=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+"T00:00:00Z"):null;if(!d||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value)issue("bad_date",row.row,columnName(dc),"Use an unambiguous YYYY-MM-DD date. Excel serial dates and ambiguous dates are not silently converted.");}}
 }
 if(mapping.sku===undefined)issue("sku_mapping",header!,"A","Map a SKU column before this file can be used in a later import.");
 return {fileType:ext as ParsedUpload["fileType"],sheets,sheetId,sheetName,headerRow:header!,headers,mapping,rows:dataRows,issues,sourceHash:createHash("sha256").update(bytes).digest("hex")};
}

// Files are untrusted. A malformed OOXML shape must never escape as a raw
// parser/driver exception or turn into a request error that exposes internals.
export function parseUpload(filename:string,bytes:Uint8Array,options:ParseOptions={}):ParsedUpload {
 try{return parseUploadInner(filename,bytes,options);}
 catch(error){if(error instanceof HttpError)throw error;throw new HttpError(422,"The file contains malformed or unsupported table data.");}
}
