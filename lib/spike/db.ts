import * as duckdb from "@duckdb/duckdb-wasm";
import { verifiedAssetUrl } from "../vault/asset-integrity";
export type Engine={db:duckdb.AsyncDuckDB;conn:duckdb.AsyncDuckDBConnection;bundle:string;fallback:string|null};
export async function openEngine(path="opfs://md-spike.duckdb",isolated=true):Promise<Engine>{
 // The pinned COI bundle starts but stalls on OPFS writes on the measured
 // Chrome build. COI FileReader imports also lost rows in the 13-file check.
 // Use the reliable single-thread engine for the whole spike, isolated or not.
 const candidates=["eh","mvp"];
 let fallback:string|null=null;
 for(const kind of candidates){
  const workerUrl=await verifiedAssetUrl(`duckdb-browser-${kind}.worker.js`);
  let wasmUrl:string;
  try{wasmUrl=await verifiedAssetUrl(`duckdb-${kind}.wasm`);}catch(error){URL.revokeObjectURL(workerUrl);throw error;}
  const worker=new Worker(workerUrl);
  const db=new duckdb.AsyncDuckDB(new duckdb.VoidLogger(),worker);
  try{
   await db.instantiate(wasmUrl);
   await db.open({path,accessMode:duckdb.DuckDBAccessMode.READ_WRITE,maximumThreads:kind==="coi"?2:1,opfs:{fileHandling:"manual"},query:{castBigIntToDouble:false,castDecimalToDouble:false}});
   const conn=await db.connect();
   await conn.query("SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET memory_limit='512MB'");
   return {db,conn,bundle:kind,fallback};
  }catch{fallback=kind+" could not open OPFS; trying a single-thread bundle.";await db.terminate().catch(()=>{});worker.terminate();}
  finally{URL.revokeObjectURL(workerUrl);URL.revokeObjectURL(wasmUrl);}
 }
 throw new Error("The local database could not start. Check OPFS support and available memory.");
}
export async function closeEngine(engine:Engine){await engine.conn.query("CHECKPOINT");await engine.conn.close();await engine.db.terminate();}
export const SCHEMA=`
 CREATE TABLE IF NOT EXISTS products(product_id INTEGER PRIMARY KEY,sku VARCHAR,list_cents BIGINT,cost_cents BIGINT);
 CREATE TABLE IF NOT EXISTS sales_lines(line_id BIGINT,product_id INTEGER,customer_id INTEGER,sale_date DATE,quantity INTEGER,list_cents BIGINT,discount_cents BIGINT,freight_cents BIGINT,rebate_cents BIGINT,cost_cents BIGINT,source_file VARCHAR);
 CREATE TABLE IF NOT EXISTS spike_meta(version INTEGER); INSERT INTO spike_meta SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM spike_meta);
`;
