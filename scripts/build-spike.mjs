import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdir,copyFile,writeFile,readFile} from "node:fs/promises";
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
await build({entryPoints:[path.join(root,"lib/spike/worker.ts")],outfile:path.join(output,"spike-worker.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,legalComments:"eof",banner:{js:silence},define:{"process.env.NODE_ENV":'"production"',"process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY":JSON.stringify(process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY||"")}});
await writeFile(path.join(output,"vault-ram-worker.js"),silence+await readFile(path.join(root,"lib/vault/ram-filesystem.js"),"utf8")+"\n"+await readFile(path.join(output,"duckdb-browser-eh.worker.js"),"utf8"));
await build({entryPoints:[path.join(root,"lib/vault/worker.ts")],outfile:path.join(output,"vault-worker.js"),bundle:true,format:"esm",platform:"browser",target:"es2022",minify:true,legalComments:"eof",banner:{js:silence},define:{"process.env.NODE_ENV":'"production"',"process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY":JSON.stringify(process.env.NEXT_PUBLIC_LICENCE_VERIFY_KEY||"")}});
await writeFile(path.join(output,"assets.json"),JSON.stringify({duckdbWasm:"1.32.0",files},null,2)+"\n");
console.log("Built local spike worker and seven pinned DuckDB assets (no CDN).");
