import {getAppContext,databaseContext} from '@/lib/context';
import {withDatabase} from '@/lib/db';
import {readJsonLimited} from '@/lib/request';
import {errorResponse,HttpError} from '@/lib/authz';
import {relayDirectory,relayPage,relayPackPage,relayPost,type RelayActor} from '@/lib/relay/store';
import {RelayError,PostSchema} from '@/lib/relay/protocol';
import { msg } from "../../../lib/i18n/core";
import {createSupabaseServerClient} from '@/lib/supabase/server';
export const runtime='nodejs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(body:unknown)=>Response.json(body,{headers:{'Cache-Control':'no-store'}});
function failure(e:unknown){
 if(e instanceof RelayError)return Response.json({code:e.code,error:e.message},{status:e.code==='ACCESS'?403:['ROTATE','CONFLICT'].includes(e.code)?409:400,headers:{'Cache-Control':'no-store'}});
 const code=(e as {code?:string})?.code;
 if(code==='40001'||code==='23505')return Response.json({code:'CONFLICT',error:msg("api.relay.theSharedWorkspaceChanged")},{status:409,headers:{'Cache-Control':'no-store'}});
 if(code==='23514')return Response.json({code:'ROTATE',error:msg("api.relay.aKeyRotationOr")},{status:409,headers:{'Cache-Control':'no-store'}});
 return errorResponse(e);
}
export async function GET(request:Request){try{
 if(process.env.RELAY_ENABLED!=='true')throw new HttpError(404,msg("api.relay.workspaceSharingIsNot2"));
 const ctx=await getAppContext(request.headers);if(!ctx)throw new HttpError(401,msg("api.relay.signInToYour2"));
 const u=new URL(request.url),deviceId=u.searchParams.get('device')??'',mode=u.searchParams.get('mode');
 if(!uuid.test(deviceId)||!['directory','sync','packs','token'].includes(mode??'')||[...u.searchParams.keys()].some(k=>!['device','mode','after','epochAfter','pack'].includes(k))||[...u.searchParams.keys()].some(k=>u.searchParams.getAll(k).length!==1))throw new HttpError(400,msg("api.relay.invalidSharingRequest"));
 const actor:RelayActor={tenantId:ctx.tenantId,userId:ctx.userId,deviceId},after=u.searchParams.get('after')??'0',epochAfter=u.searchParams.get('epochAfter')??'0',pack=u.searchParams.get('pack')??'';
 // Team sharing S2: the lifetime limits grew (sequence below 10^9, epochs up to 100,000); packs page by version.
 if(!/^(0|[1-9][0-9]{0,8})$/.test(after)||!/^(0|[1-9][0-9]{0,5})$/.test(epochAfter)||BigInt(epochAfter)>BigInt(100000)||(mode==='packs')!==u.searchParams.has('pack')||(mode==='token'&&[...u.searchParams.keys()].some(k=>k!=='device'&&k!=='mode')))throw new HttpError(400,msg("api.relay.invalidSharingCursor"));
 // Team sharing S3: Storage checks the person's own token against the relay_storage_allowed rule; the token is short-lived,
 // goes only to this person's worker and is never stored.
 if(mode==='token'){const {data}=await (await createSupabaseServerClient()).auth.getSession();const s=data.session;
  if(!s||s.user.id!==ctx.userId)throw new HttpError(401,msg("api.relay.signInToYour2"));
  return json({url:process.env.NEXT_PUBLIC_SUPABASE_URL,apikey:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,token:s.access_token,expiresAt:new Date((s.expires_at??0)*1000).toISOString()});}
 return json(await withDatabase(databaseContext(ctx,request.headers),async db=>mode==='directory'?await relayDirectory(db,actor):mode==='packs'?await relayPackPage(db,actor,pack,after):await relayPage(db,actor,after,epochAfter)));
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{
 if(process.env.RELAY_ENABLED!=='true')throw new HttpError(404,msg("api.relay.workspaceSharingIsNot"));
 const ctx=await getAppContext(request.headers);if(!ctx)throw new HttpError(401,msg("api.relay.signInToYour"));
 const parsed=PostSchema.safeParse(await readJsonLimited(request,1024*1024));if(!parsed.success)throw new HttpError(400,msg("api.relay.theSharingRequestHas"));
 const p=parsed.data,deviceId=p.action==='register'?p.device.deviceId:p.action==='epoch'?p.epoch.signerDevice:p.action==='pack'?p.pack.senderDevice:p.event.senderDevice;
 return json(await withDatabase(databaseContext(ctx,request.headers),db=>relayPost(db,{tenantId:ctx.tenantId,userId:ctx.userId,deviceId},p)));
 }catch(e){return failure(e);}}
