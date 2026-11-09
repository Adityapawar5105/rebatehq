import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdir,copyFile,writeFile,readFile,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,"..");
const dist=path.dirname(require.resolve("@duckdb/duckdb-wasm"));
const output=path.join(root,"public","spike");
await mkdir(output,{recursive:true});
const names=["duckdb-mvp.wasm","duckdb-eh.wasm","duckdb-coi.wasm","duckdb-browser-mvp.worker.js","duckdb-browser-eh.worker.js","duckdb-browser-coi.worker.js","duckdb-browser-coi.pthread.worker.js"];
const files={};
const silence="Object.assign(console,{log(){},info(){},warn(){},error(){},debug(){}});\n";
for(const name of names){
 if(name.endsWith(".js"))await writeFile(path.join(output,name),silence+await readFile(path.join(dist,name),"utf8"));
 else await copyFile(path.join(dist,name),path.join(output,name));
 files[name]=createHash("sha256").update(await readFile(path.join(output,name))).digest("hex");
}
await writeFile(path.join(output,"vault-ram-worker.js"),silence+await readFile(path.join(root,"lib/vault/ram-filesystem.js"),"utf8")+"\n"+await readFile(path.join(output,"duckdb-browser-eh.worker.js"),"utf8"));
files["vault-ram-worker.js"]=createHash("sha256").update(await readFile(path.join(output,"vault-ram-worker.js"))).digest("hex");
// 7F-2: DuckDB's signed Parquet extension (vendor/duckdb-extensions/README.md), served from this origin and pinned.
const parquet="extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm",parquetSha="22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55";
const parquetBytes=await readFile(path.join(root,"vendor/duckdb-extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm"));
if(createHash("sha256").update(parquetBytes).digest("hex")!==parquetSha)throw new Error("The vendored DuckDB Parquet extension does not match its pinned SHA-256.");
await mkdir(path.join(output,"extensions/v1.4.3/wasm_eh"),{recursive:true});await writeFile(path.join(output,parquet),parquetBytes);files[parquet]=parquetSha;
const pins={};
for(const name of Object.keys(files))pins[name]={integrity:"sha256-"+Buffer.from(files[name],"hex").toString("base64"),bytes:(await readFile(path.join(output,name))).length};
// The vault worker is a module worker split into chunks, so code used only on demand (pdf.js for PDF tables, 7F-2)
// is fetched from this origin when first needed instead of with every unlock. Old chunks are removed first.
await rm(path.join(output,"chunks"),{recursive:true,force:true});
for(const [entry,out] of [["lib/spike/worker.ts","spike-worker.js"],["lib/vault/worker.ts","vault-worker.js"]]){
 const split=out==="vault-worker.js";
 await build({entryPoints:split?{"vault-worker":path.join(root,entry)}:[path.join(root,entry)],...(split?{outdir:output,splitting:true,entryNames:"[name]",chunkNames:"chunks/[name]-[hash]"}:{outfile:path.join(output,out)}),bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,legalComments:"eof",banner:{js:silence},define:{__DUCKDB_ASSET_PINS__:JSON.stringify(pins),"process.env.NODE_ENV":'"production"',"process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY":JSON.stringify(process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY||"")}});
}
await writeFile(path.join(output,"assets.json"),JSON.stringify({duckdbWasm:"1.32.0",files,pins},null,2)+"\n");
console.log("Built local workers with embedded integrity pins for seven DuckDB assets, the RAM wrapper and the Parquet extension (no CDN).");
