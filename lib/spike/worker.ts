/// <reference lib="webworker" />
import {openEngine,closeEngine,SCHEMA,type Engine} from "./db";
import {MAX_LINES,MAX_PRODUCTS,SpikeError} from "./exact";
import {generatorSql,productSql,waterfallSql,simulationSql,summarySimulationSql} from "./sql";
import {appendPapa,nativeRead,importFiles,type Progress} from "./imports";
import {convertSmallFile} from "./converter";
import {monthlyFixtures,conversionFixtures} from "./fixtures";
import {encryptSnapshot,decryptSnapshot} from "./crypto";

const scope=self as unknown as DedicatedWorkerGlobalScope;
let engine:Engine,isolated=false,busy=false,abort=new AbortController();
let chosen:"native"|"papa"="native";
const totals=async(db=engine)=>({...((await db.conn.query(waterfallSql())).toArray()[0])});
const root=()=>navigator.storage.getDirectory();
const elapsed=(start:number)=>Math.round((performance.now()-start)*10)/10;
async function remove(name:string){await (await root()).removeEntry(name).catch(e=>{if(e.name!=="NotFoundError")throw e;});}
async function memory(){return Number((await engine.conn.query("SELECT sum(memory_usage_bytes)::VARCHAR AS bytes FROM duckdb_memory()")).toArray()[0].bytes);}
async function counts(db=engine){return {...((await db.conn.query("SELECT (SELECT count(*) FROM products)::VARCHAR AS products,(SELECT count(*) FROM sales_lines)::VARCHAR AS lines,(SELECT count(DISTINCT strftime(sale_date,'%Y-%m')) FROM sales_lines)::VARCHAR AS months")).toArray()[0])};}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

async function generate(products:number,lines:number,progress:Progress){
 if(!Number.isInteger(products)||!Number.isInteger(lines)||products<1||products>MAX_PRODUCTS||lines<1||lines>MAX_LINES)throw new SpikeError("Use at most 200,000 SKUs and 2,000,000 lines.");
 const start=performance.now();
 progress("Starting synthetic transaction",0,lines);
 await engine.conn.query("BEGIN; DELETE FROM sales_lines; DELETE FROM products;");
 try{
  progress("Writing synthetic product catalog",0,lines);
  await engine.conn.query(productSql(products));
  for(let at=0;at<lines;at+=50_000){abort.signal.throwIfAborted();await engine.conn.query(generatorSql(at,Math.min(at+50_000,lines),products,lines));progress("Generating deterministic invoice chunks",Math.min(at+50_000,lines),lines);await tick();}
  await engine.conn.query("COMMIT; CHECKPOINT");
 }catch(e){await engine.conn.query("ROLLBACK");throw e;}
 return {generation_ms:elapsed(start),counts:await counts(),totals:await totals(),duckdb_memory_bytes:await memory()};
}
async function query(product=0,customer=0){
 const start=performance.now(),result={...((await engine.conn.query(waterfallSql(product,customer))).toArray()[0])};
 return {query_ms:elapsed(start),totals:result,duckdb_memory_bytes:await memory()};
}
async function simulate(target=false){
 const before=await totals(),start=performance.now();
 await engine.conn.query(simulationSql(target));const simulation_ms=elapsed(start);
 const result={...((await engine.conn.query(summarySimulationSql)).toArray()[0])};
 await engine.conn.query("DROP TABLE simulation");
 const unchanged=JSON.stringify(before)===JSON.stringify(await totals());if(!unchanged)throw new SpikeError("Simulation changed the base table.");
 return {simulation_ms,scope:target?"100k SKUs / first 12 months":"all lines",...result,base_unchanged:unchanged,duckdb_memory_bytes:await memory()};
}
async function benchmarkImport(rows:number,progress:Progress){
 if(!Number.isInteger(rows)||rows<1||rows>MAX_LINES)throw new SpikeError("Choose a benchmark between one and two million rows.");
 const available=Number((await counts()).lines);if(available<rows)throw new SpikeError("Generate enough synthetic rows first.");
 const path="opfs://md-spike-benchmark.csv";await remove("md-spike-benchmark.csv");
 await engine.db.registerOPFSFileName(path);
 const csvAmount=(name:string)=>`((${name}//100)::VARCHAR||'.'||lpad((${name}%100)::VARCHAR,2,'0'))`;
 const exportStart=performance.now();
 try{await engine.conn.query(`COPY (SELECT line_id,product_id,customer_id,sale_date,quantity,${csvAmount("list_cents")} AS list_amount,${csvAmount("discount_cents")} AS discount_amount,${csvAmount("freight_cents")} AS freight_amount,${csvAmount("rebate_cents")} AS rebate_amount,${csvAmount("cost_cents")} AS cost_amount FROM sales_lines WHERE source_file='synthetic' LIMIT ${rows}) TO '${path}' (HEADER true,DELIMITER ',')`);}
 finally{await engine.db.dropFile(path);}
 const fixture_export_ms=elapsed(exportStart),file=await (await (await root()).getFileHandle("md-spike-benchmark.csv")).getFile();
 const checksum=async(table:string)=>({...((await engine.conn.query(`SELECT count(*)::VARCHAR AS n,sum(line_id)::VARCHAR AS id_sum,sum(list_cents)::VARCHAR AS list,sum(cost_cents)::VARCHAR AS cost,sum(discount_cents+freight_cents+rebate_cents)::VARCHAR AS deductions FROM ${table}`)).toArray()[0])});
 let papa_ms=0,native_ms=0,papa:unknown,native:unknown;
 try{
  await engine.conn.query("CREATE TEMP TABLE bench_papa AS SELECT * FROM sales_lines WHERE false; CREATE TEMP TABLE bench_native AS SELECT * FROM sales_lines WHERE false");
  let start=performance.now();await appendPapa(engine,file,"bench_papa",abort.signal,progress);papa_ms=elapsed(start);papa=await checksum("bench_papa");
  // Compare serially, retaining exact checksums rather than two million-row
  // copies at once. The same generated OPFS input is used by both methods.
  await engine.conn.query("DROP TABLE bench_papa");
  start=performance.now();await nativeRead(engine,file,"bench_native",abort.signal,progress,path);native_ms=elapsed(start);native=await checksum("bench_native");
  if(JSON.stringify(papa)!==JSON.stringify(native)||Number((papa as {n:string}).n)!==rows)throw new SpikeError("The two import paths did not reconcile exactly.");
  chosen=native_ms<=papa_ms?"native":"papa";
  return {rows,bytes:file.size,fixture_export_ms,papa_ms,native_ms,chosen,equal_checksums:true,duckdb_memory_bytes:await memory()};
 }catch(e){
  // This path uses only our generated fixture, never a user-selected file.
  const error=e instanceof Error?(e.cause instanceof Error?e.cause:e):new Error("Unknown benchmark failure");
  throw new SpikeError("Synthetic import benchmark failed: "+error.message.split("\n")[0].slice(0,300));
 }finally{await engine.conn.query("DROP TABLE IF EXISTS bench_papa; DROP TABLE IF EXISTS bench_native");await remove("md-spike-benchmark.csv");}
}
async function nativeEncryptionProbe(){
 const path="opfs://md-spike-native-probe.duckdb";
 let native=false,reason="",httpfs="";
 await remove("md-spike-native-probe.duckdb");
 try{
  await engine.db.registerOPFSFileName(path);
  try{
   await engine.conn.query(`ATTACH '${path}' AS native_probe (ENCRYPTION_KEY 'synthetic-spike-probe-key'); CREATE TABLE native_probe.test AS SELECT 42 AS n; CHECKPOINT native_probe; DETACH native_probe`);
   native=true;
  }catch(e){reason=e instanceof Error?e.message.split("\n")[0].slice(0,350):"Unavailable";
   // Even LOAD can cause the Wasm runtime to fetch code. Inspect inventory
   // only: this spike never installs or loads a runtime extension.
   const installed=(await engine.conn.query("SELECT installed FROM duckdb_extensions() WHERE extension_name='httpfs'")).toArray()[0]?.installed;
   httpfs=installed?"Installed but not loaded by this offline spike.":"Not installed in the pinned offline bundle; no remote extension was fetched.";
  }
 }finally{await engine.db.dropFile(path);await remove("md-spike-native-probe.duckdb");await remove("md-spike-native-probe.duckdb.wal");}
 return {native,reason,httpfs,version:await engine.db.getVersion()};
}
async function snapshot(passphrase:string,progress:Progress){
 const before=await totals(),beforeCounts=await counts();
 const saveStart=performance.now();await closeEngine(engine);
 const directory=await root(),source=await (await directory.getFileHandle("md-spike.duckdb")).getFile();
 const encryptedName="md-spike-encrypted-"+crypto.randomUUID()+".bin";
 const encryptedHandle=await directory.getFileHandle(encryptedName,{create:true});
 await encryptSnapshot(source,await encryptedHandle.createWritable(),passphrase,(a,b)=>progress("Encrypting authenticated 1 MiB chunks",a,b),abort.signal);
 const save_ms=elapsed(saveStart),encrypted=await encryptedHandle.getFile();
 // Probe the fallback using generated synthetic data only. Real file imports
 // use a separate in-memory DB and never enter this plaintext OPFS benchmark.
 const openStart=performance.now(),restoredHandle=await directory.getFileHandle("md-spike-restored.duckdb",{create:true});
 await decryptSnapshot(encrypted,await restoredHandle.createWritable(),passphrase,(a,b)=>progress("Authenticating and opening snapshot",a,b),abort.signal);
 engine=await openEngine("opfs://md-spike-restored.duckdb",isolated);
 const after=await totals(),afterCounts=await counts();
 const open_ms=elapsed(openStart);
 const exact=JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(beforeCounts)===JSON.stringify(afterCounts);
 if(!exact)throw new SpikeError("Snapshot contents did not reconcile.");
 // Return the main lab to its original synthetic-only persistent database.
 await closeEngine(engine);engine=await openEngine(undefined,isolated);
 await remove("md-spike-restored.duckdb");await remove("md-spike-restored.duckdb.wal");
 let wrong_passphrase_rejected=false;
 const rejectHandle=await directory.getFileHandle("md-spike-rejected.tmp",{create:true});
 try{await decryptSnapshot(encrypted,await rejectHandle.createWritable(),passphrase+"-wrong");}catch{wrong_passphrase_rejected=true;}
 await remove("md-spike-rejected.tmp");
 const manifest=await (await directory.getFileHandle("md-spike-snapshot.json",{create:true})).createWritable();
 await manifest.write(JSON.stringify({file:encryptedName}));await manifest.close();
 return {save_ms,open_ms,plain_bytes:source.size,cipher_bytes:encrypted.size,rows:String(beforeCounts.lines),iterations:600000,cipher:"AES-256-GCM / authenticated chunk envelope",exact,wrong_passphrase_rejected,
  note:"Synthetic plaintext OPFS persistence is a lab probe, not a production encrypted vault. Chosen production fallback is memory-only working data plus encrypted snapshots."};
}
async function restoreSnapshot(passphrase:string,progress:Progress){
 const directory=await root();
 let manifest:{file:string};try{manifest=JSON.parse(await (await (await directory.getFileHandle("md-spike-snapshot.json")).getFile()).text());}catch{throw new SpikeError("Save a snapshot first.");}
 if(!/^md-spike-encrypted-[a-f0-9-]+\.bin$/.test(manifest.file))throw new SpikeError("Snapshot manifest is invalid.");
 const source=await (await directory.getFileHandle(manifest.file)).getFile(),file="md-spike-restored.duckdb";
 await closeEngine(engine);
 try{
  const start=performance.now();await decryptSnapshot(source,await (await directory.getFileHandle(file,{create:true})).createWritable(),passphrase,(a,b)=>progress("Opening saved encrypted snapshot",a,b),abort.signal);
  engine=await openEngine("opfs://"+file,isolated);const result={open_ms:elapsed(start),counts:await counts(),totals:await totals()};
  await closeEngine(engine);engine=await openEngine(undefined,isolated);await remove(file);await remove(file+".wal");return result;
 }catch(e){await remove(file);engine=await openEngine(undefined,isolated);throw e;}
}
async function scratchImport(files:File[],progress:Progress){
 const scratch=await openEngine(":memory:",isolated);
 try{await scratch.conn.query(SCHEMA);const start=performance.now();const result=await importFiles(scratch,files,chosen,abort.signal,progress);return {...result,import_ms:elapsed(start),persistence:"memory only — user files are not written to plaintext OPFS"};}
 finally{await scratch.conn.close();await scratch.db.terminate();}
}
async function action(name:string,data:Record<string,any>,progress:Progress):Promise<unknown>{
 switch(name){
  case "init":{
   isolated=data.isolated===true;const start=performance.now();engine=await openEngine(undefined,isolated);await engine.conn.query(SCHEMA);
   return {init_ms:elapsed(start),bundle:engine.bundle,fallback:engine.fallback,threads:String((await engine.conn.query("SELECT current_setting('threads') AS n")).toArray()[0].n),version:await engine.db.getVersion(),counts:await counts(),totals:await totals(),isolated};
  }
  case "generate":return generate(Number(data.products??MAX_PRODUCTS),Number(data.lines??MAX_LINES),progress);
  case "query":return query(Number(data.product??0),Number(data.customer??0));
  case "simulate":return simulate(Boolean(data.target));
  case "benchmark":return benchmarkImport(Number(data.rows??1_000_000),progress);
  case "probe":return nativeEncryptionProbe();
  case "snapshot":return snapshot(String(data.passphrase||""),progress);
  case "restore":return restoreSnapshot(String(data.passphrase||""),progress);
  case "files":return scratchImport(data.files,progress);
  case "fixtures":return scratchImport(await monthlyFixtures(),progress);
  case "conversions":{
   const monthly=await monthlyFixtures(),{tsv,messy}=conversionFixtures(),start=performance.now();
   const files=[await convertSmallFile(monthly.at(-1)!),await convertSmallFile(tsv),await convertSmallFile(messy,"comma")];
   return {conversion_ms:elapsed(start),files};
  }
  case "convert":return {files:[await convertSmallFile(data.file,data.decimal==="comma"?"comma":"dot")]};
  case "shutdown":await closeEngine(engine);return {closed:true};
  default:throw new SpikeError("Unknown spike action.");
 }
}
scope.onmessage=(event:MessageEvent)=>{
 const {id,action:name,...data}=event.data;
 if(name==="cancel"){abort.abort();scope.postMessage({id,result:{cancel_requested:true}});return;}
 if(busy){scope.postMessage({id,error:"Wait for the current local operation to finish."});return;}
 busy=true;abort=new AbortController();
 const progress:Progress=(stage,done,total)=>scope.postMessage({id,progress:{stage,done,total}});
 void action(name,data,progress).then(result=>scope.postMessage({id,result})).catch(error=>{
  scope.postMessage({id,error:abort.signal.aborted?"Operation cancelled; no import rows were committed.":error instanceof SpikeError?error.message:"The local database operation failed. Check storage, memory and file format; no source values were logged."});
 }).finally(()=>{busy=false;});
};
