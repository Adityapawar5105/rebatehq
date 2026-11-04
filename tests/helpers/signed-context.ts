import { randomBytes } from 'node:crypto';
import { setRequestIdentity } from '../../lib/request-identity';
const keys = new WeakMap<object,string>();
export async function installTestIdentityKey(db:any) {
  const key=randomBytes(32).toString('hex'); keys.set(db,key);
  await db.query("INSERT INTO rebatehq_private.actor_key(id,secret) VALUES('actor-v1',decode($1::text,'hex')) ON CONFLICT(id) DO UPDATE SET secret=EXCLUDED.secret",[key]);
  return key;
}
export async function testIdentity(db:any, subject:string, actor=subject) {
  const key=keys.get(db);if(!key)throw Error('Install the test identity key before SET ROLE.');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1::text,true),set_config('request.jwt.claims',$2::text,true)",[subject,JSON.stringify({sub:subject||null,role:'authenticated'})]);
  await setRequestIdentity(db,subject,actor,key);
}
