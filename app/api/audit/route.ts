import { getAppContext, databaseContext } from "@/lib/context";
import { assertPermission, errorResponse } from "@/lib/authz";
import { withDatabase } from "@/lib/db";
import { csvDocument } from "@/lib/csv";
export const runtime = "nodejs";
// Fixed metadata projection: never return historical business snapshots, IP or user agent.
export async function GET(request: Request) {
 try { const context=await getAppContext(request.headers);assertPermission(context,"audit.read");
 const data=await withDatabase(databaseContext(context,request.headers),async db=>(await db.query("SELECT id,actor_id,action,entity_type,entity_id,created_at FROM audit_log WHERE tenant_id=$1 AND entity_type IN ('tenant','membership','invite','workspace_licence','licence_seat','licence_location','licence_device') AND action ~ '^(tenant|membership|invite|workspace_licence|licence_seat|licence_location|licence_device)\\.' ORDER BY created_at DESC LIMIT 200",[context.tenantId])).rows);
 if(new URL(request.url).searchParams.get('format')==='csv'){const columns=['id','actor_id','action','entity_type','entity_id','created_at'];return new Response(csvDocument(columns,data.map(r=>columns.map(c=>r[c]))),{headers:{'Content-Type':'text/csv;charset=utf-8','Cache-Control':'no-store','Content-Disposition':'attachment; filename=rebatehq-control-audit.csv'}});}
 return Response.json({data},{headers:{'Cache-Control':'no-store'}});
 } catch(e){return errorResponse(e);}
}
