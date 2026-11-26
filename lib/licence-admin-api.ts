import { getAppContext, databaseContext } from './context';
import { withDatabase } from './db';
import { HttpError, errorResponse } from './authz';
import { readJsonLimited } from './request';
import { z } from 'zod';
import { msg } from "./i18n/core";
const schemas = {
  seats: z.object({userId:z.uuid(),remove:z.boolean().optional()}).strict(),
  locations: z.object({name:z.string().trim().min(1).max(120),erpProfile:z.enum(['generic','netsuite','p21','infor','bc','quickbooks'])}).strict(),
  devices: z.object({id:z.uuid(),status:z.enum(['active','revoked'])}).strict(),
};
export async function licenceAdmin(request:Request, kind:keyof typeof schemas) {
  try {
    const ctx=await getAppContext(request.headers);if(!ctx)throw new HttpError(401,msg("api.licenceAdmin.signInFirst"));
    if(request.method!=='GET'&&ctx.role!=='owner')throw new HttpError(403,msg("api.licenceAdmin.onlyTheWorkspaceOwner"));
    const input=request.method==='GET'?null:schemas[kind].parse(await readJsonLimited(request));
    const data=await withDatabase(databaseContext(ctx,request.headers),async db=>{
      if(!input){if(kind==='seats')return(await db.query('SELECT id,user_id,created_at FROM licence_seat WHERE tenant_id=$1::uuid ORDER BY created_at',[ctx.tenantId])).rows;
        if(kind==='locations')return(await db.query('SELECT id,name,erp_profile,created_at FROM licence_location WHERE tenant_id=$1::uuid ORDER BY created_at',[ctx.tenantId])).rows;
        // Audit B-5: the Owner sees whose device each one is (the member's email); others get no emails.
        return(await db.query(ctx.role==='owner'?'SELECT d.id,d.user_id,d.status,d.created_at,m.email FROM licence_device d LEFT JOIN membership m ON m.tenant_id=d.tenant_id AND m.user_id=d.user_id WHERE d.tenant_id=$1::uuid ORDER BY d.created_at':'SELECT id,user_id,status,created_at,NULL::text AS email FROM licence_device WHERE tenant_id=$1::uuid ORDER BY created_at',[ctx.tenantId])).rows;}
      if('userId'in input){if(input.remove)await db.query('DELETE FROM licence_seat WHERE tenant_id=$1::uuid AND user_id=$2::uuid',[ctx.tenantId,input.userId]);else await db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1::uuid,$2::uuid)',[ctx.tenantId,input.userId]);}
      else if('erpProfile'in input)await db.query('INSERT INTO licence_location(tenant_id,name,erp_profile) VALUES($1::uuid,$2::text,$3::text)',[ctx.tenantId,input.name,input.erpProfile]);
      else await db.query('UPDATE licence_device SET status=$3::text WHERE tenant_id=$1::uuid AND id=$2::uuid',[ctx.tenantId,input.id,input.status]);
      return {ok:true};
    });return Response.json(kind==='devices'&&!input?{data,canApprove:ctx.role==='owner'}:{data},{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    if(typeof e==='object'&&e&&'code'in e&&e.code==='23514')return Response.json({error:msg("api.licenceAdmin.licenceLimitReachedAsk")},{status:409});
    // Review R1: a seat whose devices registered for team sharing is referenced by relay_device_key, so the delete
    // cascading to licence_device fails (23503). Say what to do instead of a generic server error.
    if(kind==='seats'&&typeof e==='object'&&e&&'code'in e&&e.code==='23503')return Response.json({error:msg("api.licenceAdmin.seatInSharing")},{status:409});
    return errorResponse(e);}
}
