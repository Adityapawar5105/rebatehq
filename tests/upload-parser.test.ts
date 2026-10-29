import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { parseUpload,parseDelimited,suggestMapping } from "../lib/upload-parser";
import { UPLOAD_LIMITS } from "../lib/upload-types";
import {MAX_IMPORT_DATA_ROWS} from "../lib/import-config";
import { csvDocument } from "../lib/csv";
import { readBytesLimited } from "../lib/request";
import { workbook,stringCell,numberCell } from "./helpers/upload-fixture";
const bytes=(s:string)=>new TextEncoder().encode(s);
const rejects=(f:()=>unknown)=>assert.throws(f,e=>typeof e==='object'&&e!==null&&'status'in e&&[400,413,415,422].includes(Number(e.status)));
test('messy XLSX fixture keeps every value and identifies every known problem by row and column',()=>{
 const result=parseUpload('messy.xlsx',readFileSync('tests/fixtures/messy-supplier.xlsx'));
 assert.equal(result.headerRow,3);assert.equal(result.rows.length,2);assert.equal(result.rows[0].cells[3].value,'12,50');
 assert.equal(result.rows[1].cells[4].value,'=SUM(D5,7)');assert.ok(!JSON.stringify(result.rows).includes('999999'));
 const issues=result.issues.map(i=>[i.code,i.row,i.column]);
 assert.deepEqual(issues,[['formula',5,'E'],['merged_cell',1,'A'],['hidden_column',1,'F'],['header_suggestion',3,'A'],['unsafe_text',4,'B'],['bom_text',4,'F'],['formula_text',4,'I'],['text_number',4,'D'],['comma_decimal',4,'D'],['bad_date',4,'G'],['duplicate_sku',5,'A']]);
 for(const issue of result.issues){assert.ok(issue.row>0);assert.match(issue.column,/^[A-Z]+$/);assert.equal(issue.sheet,'Supplier');}
});
test('sheet and header are explicit choices, and header similarity suggests all eight mappings',()=>{
 const b=readFileSync('tests/fixtures/messy-supplier.xlsx');assert.equal(parseUpload('x.xlsx',b,{sheetId:'1',headerRow:1}).sheetName,'Notes');
 rejects(()=>parseUpload('x.xlsx',b,{sheetId:'99'}));rejects(()=>parseUpload('x.xlsx',b,{headerRow:2}));
 assert.deepEqual(suggestMapping(['Part Number','Product Description','UOM','Unit Cost','Selling Price','Vendor','Effective Date','Qty']),{sku:0,description:1,unit:2,cost:3,price:4,supplier:5,date:6,quantity:7});
});
test('native XLSX accepts 200 and the configured maximum data rows, rejects one over, and excludes its header',async()=>{
 for(const count of [200,MAX_IMPORT_DATA_ROWS,MAX_IMPORT_DATA_ROWS+1]){
  const header=stringCell("A1","SKU")+stringCell("B1","Unit")+stringCell("C1","Cost")+stringCell("D1","Price");
  const rows=Array.from({length:count},(_,i)=>{const r=i+2;return `<row r="${r}">${stringCell("A"+r,"P-"+i)}${stringCell("B"+r,"EA")}${numberCell("C"+r,"12")}${numberCell("D"+r,"25")}</row>`;}).join("");
  const data=await workbook({"xl/worksheets/sheet1.xml":`<worksheet><sheetData><row r="1">${header}</row>${rows}</sheetData></worksheet>`});
  if(count>MAX_IMPORT_DATA_ROWS)rejects(()=>parseUpload("native.xlsx",data,{headerRow:1}));
  else assert.equal(parseUpload("native.xlsx",data,{headerRow:1}).rows.length,count);
 }
});
test('UTF-8 BOM, semicolon CSV, comma decimals, TSV and multiline quoted cells retain source locations',()=>{
 const r=parseUpload('x.csv',readFileSync('tests/fixtures/messy-supplier.csv'));
 assert.equal(r.rows[0].cells[2].value,'12,50');assert.ok(r.issues.some(i=>i.code==='bom'&&i.row===1&&i.column==='A'));
 assert.ok(r.issues.some(i=>i.code==='comma_decimal'&&i.row===2&&i.column==='C'));
 const t=parseUpload('x.tsv',bytes('SKU\tCost\nA\t12\n'));assert.equal(t.rows[0].cells[1].value,'12');assert.ok(t.issues.some(i=>i.code==='text_number'));
 assert.equal(parseDelimited('SKU,Description\nA,"two\nlines"\nB,ok',',')[2].row,4);
});
test('size, content, extension, column, row and cell limits fail closed without delimiter fallback',()=>{
 rejects(()=>parseUpload('x.csv',new Uint8Array(UPLOAD_LIMITS.bytes+1)));rejects(()=>parseUpload('x.exe',bytes('A,B\n1,2')));
 rejects(()=>parseUpload('x.xlsx',bytes('A,B\n1,2')));rejects(()=>parseUpload('x.csv',readFileSync('tests/fixtures/messy-supplier.xlsx')));
 rejects(()=>parseUpload('x.csv',bytes('<html><body>not a table</body></html>')));rejects(()=>parseUpload('x.csv',new Uint8Array([255,254,0,1])));
 rejects(()=>parseUpload('x.xlsm',readFileSync('tests/fixtures/messy-supplier.xlsx')));
 rejects(()=>parseUpload('x.csv',bytes(Array(65).fill('column').join(',')+'\n'+Array(65).fill('1;2').join(','))));
 rejects(()=>parseUpload('x.csv',bytes('A,B\n'+'1,2\n'.repeat(MAX_IMPORT_DATA_ROWS+1)),{headerRow:1}));rejects(()=>parseUpload('x.csv',bytes('A,B\n'+"x".repeat(2001)+',a')));
 rejects(()=>parseUpload('x.csv',bytes('A,B\n1,"unclosed')));
});
test('macros, XML entities, unsafe paths, external links and both honest/lying zip bombs are blocked',async()=>{
 const cases:Array<Record<string,string|Uint8Array>>=[
  {'xl/vbaProject.bin':new Uint8Array([1,2])},
  {'xl/worksheets/sheet1.xml':'<!DOCTYPE a [<!ENTITY x "payload">]><worksheet>&x;</worksheet>'},
  {'../escape.xml':'<x/>'},
  {'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" TargetMode="External" Target="https://invalid.test"/></Relationships>'},
  {'xl/worksheets/sheet1.xml':'<worksheet>'+ '<a>'.repeat(60)+'</a>'.repeat(60)+'</worksheet>'},
  {'xl/bomb.bin':new Uint8Array(300000)},
 ];
 for(const parts of cases){const file=await workbook(parts);rejects(()=>parseUpload('x.xlsx',file));}
 const bomb=Buffer.from(await workbook({'xl/bomb.bin':new Uint8Array(300000)}));
 // Lie about the uncompressed size in the central directory; bounded inflate still rejects.
 for(let i=0;i<bomb.length-46;i++)if(bomb.readUInt32LE(i)===0x02014b50){const n=bomb.readUInt16LE(i+28);if(bomb.subarray(i+46,i+46+n).toString()==='xl/bomb.bin')bomb.writeUInt32LE(8,i+24);}
 rejects(()=>parseUpload('x.xlsx',bomb));
});

test('malicious cell text is inert React text and all CSV exports neutralize formula prefixes',()=>{
 const r=parseUpload('x.xlsx',readFileSync('tests/fixtures/messy-supplier.xlsx'));const cell=r.rows[0].cells[1].value;
 const html=renderToStaticMarkup(createElement('td',null,cell));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));
 for(const value of ['=cmd()','+cmd()','-cmd()','@cmd()','  =SUM(1)','\uFEFF=cmd()'])assert.ok(csvDocument(['x'],[[value]]).includes("'"));
});
test('streamed upload size enforcement does not trust Content-Length',async()=>{
 await assert.rejects(readBytesLimited(new Request('http://localhost',{method:'POST',body:new Uint8Array(30)}),10),e=>typeof e==='object'&&e!==null&&'status'in e&&e.status===413);
});
test('deterministic malformed-file fuzzing never returns out-of-limit data or leaks parser errors',async()=>{
 let state=20261029;const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 for(let i=0;i<80;i++){
  const b=new Uint8Array(10+next()%512);for(let j=0;j<b.length;j++)b[j]=next()%256;
  for(const name of ['x.csv','x.xlsx','x.tsv']){try{const result=parseUpload(name,b);assert.ok(result.rows.length<=UPLOAD_LIMITS.rows);}catch(e){assert.ok(e instanceof Error&&'status'in e, 'Parser must return a generic bounded upload error');}}
 }
 const valid=await workbook();for(let n=0;n<12;n++){const b=valid.slice(0,Math.floor(valid.length*(n/12)));rejects(()=>parseUpload('x.xlsx',b));}
 for(let n=0;n<20;n++){
  const fragment=Array.from({length:15},()=>String.fromCharCode(32+next()%95)).join('');
  const b=await workbook({'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${fragment}</sheetData></worksheet>`});
  rejects(()=>parseUpload('x.xlsx',b));
 }
});
