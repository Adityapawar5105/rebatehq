import { getAppContext, databaseContext } from '@/lib/context';
import { withDatabase } from '@/lib/db';
import { errorResponse, HttpError } from '@/lib/authz';
import { workspaceAssertion } from '@/lib/licence-server';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const ctx = await getAppContext(request.headers); if (!ctx) throw new HttpError(401,'Sign in to your workspace.');
    const device = new URL(request.url).searchParams.get('device') ?? '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(device)) throw new HttpError(400,'A device id is required.');
    const result = await withDatabase(databaseContext(ctx,request.headers), db => workspaceAssertion(db,ctx,device));
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch (e) { return errorResponse(e); }
}
