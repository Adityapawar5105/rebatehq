// Server-only ZIP/XML boundary. No archive entry is ever written to disk.
import { inflateRawSync } from "node:zlib";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { HttpError } from "./authz";
import { UPLOAD_LIMITS as L } from "./upload-types";
const fail = (message: string): never => { throw new HttpError(422,message); };
const crcTable = Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes: Uint8Array) { let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0; }
export function workbookParts(bytes: Uint8Array): Map<string, Buffer> {
 const b=Buffer.from(bytes);const parts=new Map<string,Buffer>();
 if(b.length<22 || b.readUInt32LE(0)!==0x04034b50)fail("This .xlsx file is not a valid Excel workbook.");
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)fail("The workbook ZIP directory is missing.");
 if(b.readUInt16LE(end+4)!==0||b.readUInt16LE(end+6)!==0||b.readUInt16LE(end+8)!==b.readUInt16LE(end+10))fail("Split ZIP workbooks are not supported.");
 const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),start=b.readUInt32LE(end+16);
 if(count<1||count>L.zipEntries||start+size!==end||end+22+b.readUInt16LE(end+20)!==b.length)fail("The workbook archive exceeds a limit or has an invalid directory.");
 let at=start,total=0;const ranges:Array<[number,number]>=[];
 for(let i=0;i<count;i++) {
  if(at+46>end||b.readUInt32LE(at)!==0x02014b50)fail("The workbook ZIP directory is malformed.");
  const flags=b.readUInt16LE(at+8),method=b.readUInt16LE(at+10),crc=b.readUInt32LE(at+16),packed=b.readUInt32LE(at+20),unpacked=b.readUInt32LE(at+24),nl=b.readUInt16LE(at+28),el=b.readUInt16LE(at+30),cl=b.readUInt16LE(at+32),offset=b.readUInt32LE(at+42);
  if(at+46+nl+el+cl>end||flags&1||![0,8].includes(method)||b.readUInt16LE(at+34)!==0)fail("Encrypted or unsupported workbook archives are not accepted.");
  const name=b.subarray(at+46,at+46+nl).toString("utf8");at+=46+nl+el+cl;
  if(!/^[A-Za-z0-9_./\[\] -]+$/.test(name)||name.startsWith("/")||name.split("/").some(p=>p===".."||p===".")||parts.has(name))fail("The workbook has an unsafe or duplicate archive path.");
  if(/vba|macro|activex|embeddings|externalLinks/i.test(name))fail("Macros, embedded objects and external workbook links are not accepted. Save a data-only .xlsx file.");
  if(unpacked>L.partBytes||(total+=unpacked)>L.expandedBytes||(unpacked>100000&&unpacked/Math.max(1,packed)>200))fail("The workbook expands beyond the safe size limit.");
  if(offset+30>start||b.readUInt32LE(offset)!==0x04034b50||b.readUInt16LE(offset+6)!==flags||b.readUInt16LE(offset+8)!==method)fail("The workbook ZIP entry is invalid.");
  const localName=b.readUInt16LE(offset+26),localExtra=b.readUInt16LE(offset+28),dataStart=offset+30+localName+localExtra,dataEnd=dataStart+packed;
  if(b.subarray(offset+30,offset+30+localName).toString("utf8")!==name||dataEnd>start||ranges.some(([a,z])=>offset<z&&dataEnd>a))fail("The workbook ZIP entry overlaps or has an invalid name.");
  ranges.push([offset,dataEnd]);
  let data:Buffer;
  try{data=method===0?b.subarray(dataStart,dataEnd):inflateRawSync(b.subarray(dataStart,dataEnd),{maxOutputLength:Math.min(L.partBytes,unpacked+1)});}catch{fail("The workbook cannot be expanded safely.");}
  if(data!.length!==unpacked||crc32(data!)!==crc)fail("The workbook ZIP data failed its integrity check.");
  parts.set(name,data!);
 }
 if(at!==end)fail("The workbook ZIP directory has unexpected data.");
 return parts;
}
// XML is bounded before parsing. DTDs/entities and excessive depth are rejected,
// so the parser can decode only predefined/numeric XML entities, never a DTD.
export function parseXml(bytes: Uint8Array): any {
 let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch{fail("Workbook XML must use UTF-8.");}
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(text!))fail("XML document types and entity declarations are not accepted.");
 let depth=0;
 for(let at=0;at<text!.length;){
  const begin=text!.indexOf("<",at);if(begin<0)break;
  const special=text!.startsWith("<!--",begin)?["-->",4]:text!.startsWith("<![CDATA[",begin)?["]]>",9]:text!.startsWith("<?",begin)?["?>",2]:null;
  if(special){const end=text!.indexOf(String(special[0]),begin+Number(special[1]));if(end<0)fail("The workbook contains malformed XML.");at=end+String(special[0]).length;continue;}
  let quote="",end=begin+1;
  for(;end<text!.length;end++){const c=text![end];if(quote){if(c===quote)quote="";}else if(c==='"'||c==="'")quote=c;else if(c===">")break;}
  if(end===text!.length)fail("The workbook contains malformed XML.");
  const tag=text!.slice(begin,end+1);if(tag.startsWith("</"))depth--;else if(!/\/\s*>$/.test(tag))depth++;
  if(depth>48||depth<0)fail("The workbook XML has invalid or excessive nesting.");at=end+1;
 }
 if(XMLValidator.validate(text!)!==true)fail("The workbook contains malformed XML.");
 try{return new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@",parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true,removeNSPrefix:false}).parse(text!);}catch{fail("The workbook contains unsupported XML.");}
}
export function list<T>(value:T|T[]|undefined):T[]{return value===undefined?[]:Array.isArray(value)?value:[value];}
export function xmlText(value:any):string { if(value===undefined||value===null)return "";if(typeof value!=="object")return String(value);return xmlText(value["#text"]); }
