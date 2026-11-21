import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import JSZip from "jszip";
import {minorUnits,moneyText,decimalText,validDate} from "../lib/spike/exact";
import {exactRow,cleanCsv,xlsxRows} from "../lib/spike/converter";
import {encryptSnapshot,decryptSnapshot,CRYPTO_CHUNK_BYTES,type Sink} from "../lib/spike/crypto";
import {nativeInsertSql} from "../lib/spike/imports";
function sink(){
 const chunks:Uint8Array<ArrayBuffer>[]=[];let aborted=false,closed=false;
 const stream:Sink={async write(b){chunks.push(new Uint8Array(b));},async close(){closed=true;},async abort(){aborted=true;chunks.length=0;}};
 return {stream,blob:()=>new Blob(chunks),get aborted(){return aborted;},get closed(){return closed;}};
}
test("spike money stays exact as integer minor units, including large values and comma decimals",()=>{
 assert.equal(minorUnits("0.10")+minorUnits("0.20"),minorUnits("0.30"));
 assert.equal(minorUnits("999999999999.99").toString(),"99999999999999");
 assert.equal(minorUnits("12,50","comma").toString(),"1250");
 assert.equal(decimalText(BigInt("-1250")),"-12.50");assert.equal(moneyText("-123456"),"-1,234.56");
 for(const value of ["1.001","-1.00","=1+1","1e3","1,000.00","NaN","Infinity"," 1.00","01.00"])assert.throws(()=>minorUnits(value));
 assert.throws(()=>validDate("2025-02-30"));assert.equal(validDate("2024-02-29"),"2024-02-29");
});
test("spike row validation names source locations and safe CSV cannot execute formulas",()=>{
 const values=["1","1","1","2025-01-01","2","0.10","0.00","0.00","0.00","0.05"];
 const row=exactRow(values,"source.csv",17);assert.equal(typeof row.list_cents,"bigint");assert.equal(row.list_cents.toString(),"10");assert.equal(row.source_file,"source.csv");
 assert.throws(()=>exactRow([...values.slice(0,5),"secret-price",...values.slice(6)],"source.csv",17),/Row 17, column F/);
 const csv=cleanCsv([["=1+1","+SUM(A1)","@cmd","-2"]]);for(const s of ["'=1+1","'+SUM(A1)","'@cmd","'-2"])assert.ok(csv.includes(s));
 assert.ok(!nativeInsertSql("import_stage","local-file.csv","source.csv").includes("DOUBLE"));
 assert.ok(nativeInsertSql("import_stage","local-file.csv","source.csv").includes("DECIMAL(18,2)"));
});
test("XLSX spike ignores formulas/cached results and rejects macros and unsafe XML",async()=>{
 const ExcelJS=(await import("exceljs")).default;
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Sales");
 sheet.addRow(["line_id","product_id","customer_id","sale_date","quantity","list_amount","discount_amount","freight_amount","rebate_amount","cost_amount"]);
 sheet.addRow(["1","1","1","2025-01-01","1","12.50","0.00","0.00","0.00","8.00"]);
 sheet.addRow(["2","1","1","2025-01-01","1",{formula:"1+1",result:9999},"0.00","0.00","0.00","8.00"]);
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());
 const result=await xlsxRows(new File([bytes],"data.xlsx"));
 assert.equal(result.rows.length,1);assert.ok(result.issues.some(i=>i.row===3&&i.column==="F"&&i.message.includes("cached result")));
 const archive=await JSZip.loadAsync(bytes);archive.file("xl/vbaProject.bin","not-executable");
 await assert.rejects(xlsxRows(new File([new Uint8Array(await archive.generateAsync({type:"uint8array"}))],"data.xlsx")),/Macros/);
 archive.remove("xl/vbaProject.bin");archive.file("xl/worksheets/sheet1.xml",'<!DOCTYPE root [<!ENTITY x "unsafe">]><root/>');
 await assert.rejects(xlsxRows(new File([new Uint8Array(await archive.generateAsync({type:"uint8array"}))],"data.xlsx")),/entities/);
});
test("AES-GCM snapshot round trips authenticated chunks at 600k PBKDF2 iterations",async()=>{
 const source=new Uint8Array(CRYPTO_CHUNK_BYTES+7);for(let i=0;i<source.length;i++)source[i]=i%251;
 const encrypted=sink();await encryptSnapshot(new Blob([source]),encrypted.stream,"unit-test-snapshot-passphrase");
 assert.ok(encrypted.closed);assert.ok(encrypted.blob().size>source.length);
 const plain=sink();await decryptSnapshot(encrypted.blob(),plain.stream,"unit-test-snapshot-passphrase");
 assert.deepEqual(new Uint8Array(await plain.blob().arrayBuffer()),source);
});
test("snapshot rejects wrong keys, tampering, truncation, reordering and unsupported KDF settings",async()=>{
 const bytes=new Uint8Array(CRYPTO_CHUNK_BYTES+32).fill(42),encrypted=sink();
 await encryptSnapshot(new Blob([bytes]),encrypted.stream,"unit-test-snapshot-passphrase");
 const data=new Uint8Array(await encrypted.blob().arrayBuffer());
 const cases=[data.slice(0,-1),new Uint8Array(data),new Uint8Array(data),new Uint8Array(data)];
 cases[1][cases[1].length-1]^=1;
 const headerLength=12+new DataView(data.buffer).getUint32(8);
 cases[2][headerLength]^=1;
 const first=cases[3].slice(headerLength,headerLength+32),last=cases[3].slice(-32);
 cases[3].set(last,headerLength);cases[3].set(first,cases[3].length-32);
 for(const modified of cases){const rejected=sink();await assert.rejects(decryptSnapshot(new Blob([modified]),rejected.stream,"unit-test-snapshot-passphrase"),/Wrong passphrase or damaged/);assert.ok(rejected.aborted);}
 const rejected=sink();await assert.rejects(decryptSnapshot(encrypted.blob(),rejected.stream,"different-test-passphrase"));assert.ok(rejected.aborted);
 const text=new TextDecoder().decode(data.subarray(12,headerLength));assert.ok(text.includes('"iterations":600000'));
 const unsupported=new Uint8Array(data);unsupported.set(new TextEncoder().encode(text.replace('600000','600001')),12);
 await assert.rejects(decryptSnapshot(new Blob([unsupported]),sink().stream,"unit-test-snapshot-passphrase"));
});
test("spike boundary: the lab is retired (13.4), money helpers moved, and the engine loader stays self-hosted",()=>{
 for(const gone of ["app/lab/spike/page.tsx","app/lab/spike/SpikeClient.tsx","lib/spike/worker.ts","scripts/test-spike-browser.mjs"])assert.ok(!existsSync(gone),gone+" should be gone");
 assert.ok(!readFileSync("scripts/build-spike.mjs","utf8").includes("spike-worker.js"),"the lab worker is no longer built");
 assert.match(readFileSync("lib/spike/exact.ts","utf8"),/export \* from "\.\.\/money\/exact";/,"the old import path re-exports the moved helpers");
 const db=readFileSync("lib/spike/db.ts","utf8");
 assert.ok(db.includes('verifiedAssetUrl(`duckdb-'));assert.ok(readFileSync("lib/vault/asset-integrity.ts","utf8").includes('new URL("/spike/"'));assert.ok(!db.includes("getJsDelivrBundles"));assert.ok(db.includes("VoidLogger"));
 const dependency=JSON.parse(readFileSync("package.json","utf8")).dependencies["@duckdb/duckdb-wasm"];assert.equal(dependency,"1.32.0");
});
