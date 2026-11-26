import { getAppContext, databaseContext } from '@/lib/context';
import { withDatabase } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/authz';
import { labAssertion, workspaceAssertion } from '@/lib/licence-server';
import { msg } from "../../../lib/i18n/core";
import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const lab = process.env.VAULT_LAB_ENABLED === 'true';
    // The lab harness (/lab/vault, default off) has no sign-in, and may run without Supabase at all.
    const ctx = lab ? await getAppContext(request.headers).catch(() => null) : await getAppContext(request.headers);
    const device = new URL(request.url).searchParams.get('device') ?? '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(device)) throw new HttpError(400,msg("api.licence.aDeviceIdIs"));
    if (!ctx && lab) return Response.json(labAssertion(device),{headers:{'Cache-Control':'no-store'}});
    if (!ctx) throw new HttpError(401,msg("api.licence.signInToYour"));
    // Review R2: each call can register a pending device, so one person cannot flood the Owner's approval list; a device refreshes
    // every 5 minutes, and a 429 keeps the saved licence inside its offline allowance.
    if (!(await rateLimit(request,'licence',60,10*60_000,{subject:ctx.userId,memoryFallback:true})).ok) return Response.json({error:msg('api.licence.tooManyRequests')},{status:429,headers:{'Cache-Control':'no-store','Retry-After':'60'}});
    const result = await withDatabase(databaseContext(ctx,request.headers), db => workspaceAssertion(db,ctx,device));
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch (e) { return errorResponse(e); }
}
