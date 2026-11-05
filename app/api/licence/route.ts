import { getAppContext, databaseContext } from '@/lib/context';
import { withDatabase } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/authz';
import { workspaceAssertion } from '@/lib/licence-server';
import { msg } from "../../../lib/i18n/core";
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const ctx = await getAppContext(request.headers); if (!ctx) throw new HttpError(401,msg("api.licence.signInToYour"));
    const device = new URL(request.url).searchParams.get('device') ?? '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(device)) throw new HttpError(400,msg("api.licence.aDeviceIdIs"));
    const result = await withDatabase(databaseContext(ctx,request.headers), db => workspaceAssertion(db,ctx,device));
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch (e) { return errorResponse(e); }
}
