import {getAppContext,databaseContext} from '@/lib/context';
import {withDatabase} from '@/lib/db';
import {readJsonLimited} from '@/lib/request';
import {errorResponse,HttpError} from '@/lib/authz';
import {relayDirectory,relayPage,relayPost,type RelayActor} from '@/lib/relay/store';
import {RelayError,PostSchema} from '@/lib/relay/protocol';
export const runtime='nodejs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(body:unknown)=>Response.json(body,{headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){
 if(e instanceof RelayError)return Response.json({code:e.code,error:e.message},{status:e.code==='ACCESS'?403:['ROTATE','CONFLICT'].includes(e.code)?409:400,headers:{'Cache-Control':'no-store'}});
 const code=(e as {code?:string})?.code;
 if(code==='40001'||code==='23505')return Response.json({code:'CONFLICT',error:'The shared workspace changed. Sync and try again.'},{status:409,headers:{'Cache-Control':'no-store'}});
 if(code==='23514')return Response.json({code:'ROTATE',error:'A key rotation or quota check blocked this change. Sync and ask your workspace administrator.'},{status:409,headers:{'Cache-Control':'no-store'}});
 return errorResponse(e);
}
export async function GET(request:Request){try{
 if(process.env.RELAY_ENABLED!=='true')throw new HttpError(404,'Workspace sharing is not enabled.');
 const ctx=await getAppContext(request.headers);if(!ctx)throw new HttpError(401,'Sign in to your workspace.');
 const u=new URL(request.url),deviceId=u.searchParams.get('device')??'',mode=u.searchParams.get('mode');
 if(!uuid.test(deviceId)||!['directory','sync'].includes(mode??'')||[...u.searchParams.keys()].some(k=>!['device','mode','after','epochAfter'].includes(k))||[...u.searchParams.keys()].some(k=>u.searchParams.getAll(k).length!==1))throw new HttpError(400,'Invalid sharing request.');
 const actor:RelayActor={tenantId:ctx.tenantId,userId:ctx.userId,deviceId},after=u.searchParams.get('after')??'0',epochAfter=u.searchParams.get('epochAfter')??'0';
 if(!/^(0|[1-9][0-9]{0,4})$/.test(after)||BigInt(after)>BigInt(10000)||!/^(0|[1-9][0-9]{0,2})$/.test(epochAfter)||BigInt(epochAfter)>BigInt(256))throw new HttpError(400,'Invalid sharing cursor.');
 return json(await withDatabase(databaseContext(ctx,request.headers),async db=>mode==='directory'?await relayDirectory(db,actor):await relayPage(db,actor,after,epochAfter)));
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(process.env.RELAY_ENABLED!=='true')throw new HttpError(404,'Workspace sharing is not enabled.');
 const ctx=await getAppContext(request.headers);if(!ctx)throw new HttpError(401,'Sign in to your workspace.');
 const parsed=PostSchema.safeParse(await readJsonLimited(request,96*1024));if(!parsed.success)throw new HttpError(400,'The sharing request has an invalid format. No content was logged.');
 const p=parsed.data,deviceId=p.action==='register'?p.device.deviceId:p.action==='epoch'?p.epoch.signerDevice:p.event.senderDevice;
 return json(await withDatabase(databaseContext(ctx,request.headers),db=>relayPost(db,{tenantId:ctx.tenantId,userId:ctx.userId,deviceId},p)));
 }catch(e){return failure(e);}}
