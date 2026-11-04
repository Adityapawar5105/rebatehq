import { createPrivateKey, sign } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AppContext } from './context';
import { ASSERTION_SECONDS, OFFLINE_GRACE_SECONDS, type LicenceClaims, type LicenceEnvelope } from './licence-policy';
export function signLicence(claims: LicenceClaims): LicenceEnvelope {
  const secret = process.env.LICENCE_SIGNING_KEY;
  if (!secret) throw Error('Licence signing is not configured.');
  const payload = JSON.stringify(claims);
  return { payload, signature: sign(null, Buffer.from(payload), createPrivateKey({ key: Buffer.from(secret,'base64'), format: 'der', type: 'pkcs8' })).toString('base64') };
}
export async function workspaceAssertion(db: PoolClient, ctx: AppContext, device: string) {
  const l = (await db.query("SELECT tier,status,valid_until FROM workspace_licence WHERE tenant_id=$1::uuid",[ctx.tenantId])).rows[0];
  const seat = (await db.query("SELECT 1 FROM licence_seat WHERE tenant_id=$1::uuid AND user_id=$2::uuid",[ctx.tenantId,ctx.userId])).rowCount;
  let d = (await db.query("SELECT status,user_id FROM licence_device WHERE tenant_id=$1::uuid AND id=$2::uuid",[ctx.tenantId,device])).rows[0];
  if (l?.status === 'active' && new Date(l.valid_until).getTime() > Date.now() && seat && !d) d = (await db.query("INSERT INTO licence_device(id,tenant_id,user_id) VALUES($1::uuid,$2::uuid,$3::uuid) RETURNING status,user_id",[device,ctx.tenantId,ctx.userId])).rows[0];
  const issued = Math.floor(Date.now()/1000), active = !!l && l.status === 'active' && new Date(l.valid_until).getTime() > Date.now() && !!seat && d?.status === 'active' && d.user_id === ctx.userId;
  const end = active ? Math.floor(new Date(l.valid_until).getTime()/1000) : issued + ASSERTION_SECONDS;
  return signLicence({v:1,sub:ctx.userId,workspace:ctx.tenantId,device,tier:l?.tier ?? 'starter',state:active?'active':'readonly',issued,expires:Math.min(issued+ASSERTION_SECONDS,end),offlineUntil:Math.min(issued+OFFLINE_GRACE_SECONDS,end),reason:active?'':!l?'Ask your workspace owner to request a pilot licence.':!seat?'Ask your workspace owner for a licence seat.':d?.status!=='active'?'This device needs owner approval or has been revoked.':'Renew your workspace licence.'});
}
