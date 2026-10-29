import {z} from "zod";
import {withDatabase,closeDatabasePool} from "../lib/db";
import {runSchedule} from "../lib/ingestion";
async function main(){
 const tenant=z.uuid().parse(process.env.TENANT_ID),user=z.uuid().parse(process.env.ACTOR_ID);
 // Trusted operator identity, checked against active owner/manager membership
 // by runSchedule. Uses the NOBYPASSRLS app pool; never the seed/admin URL.
 try{for(let n=0;n<5;n++){
  const result=await runSchedule(fn=>withDatabase({userId:user,realActorId:user},db=>fn(db)),tenant,user);
  process.stdout.write(JSON.stringify({event:"ingestion.review",...result})+"\n");
  if(!result.ran)break;
 }}finally{await closeDatabasePool();}
}
main().catch(()=>{process.stderr.write("Scheduled ingestion failed. Inspect the tenant's ingestion history; no source contents were logged.\n");process.exitCode=1;});
