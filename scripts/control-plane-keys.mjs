// Administrative/CI helper. Values stay in process environment or GitHub's env channel.
import { randomBytes,generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
export function generateKeys() {
 const pair=generateKeyPairSync('ed25519');
 return { ACTOR_SIGNING_SECRET:randomBytes(32).toString('hex'),LICENCE_SIGNING_KEY:pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),NEXT_PUBLIC_LICENCE_VERIFY_KEY:pair.publicKey.export({format:'der',type:'spki'}).toString('base64') };
}
export async function installActorKey(client,secret) {
 if(!/^[a-f0-9]{64}$/i.test(secret||''))throw Error('A 32-byte actor secret is required.');
 await client.query("INSERT INTO rebatehq_private.actor_key(id,secret) VALUES('actor-v1',decode($1::text,'hex')) ON CONFLICT(id) DO UPDATE SET secret=EXCLUDED.secret WHERE actor_key.secret IS DISTINCT FROM EXCLUDED.secret",[secret]);
}
async function main(){
 if(process.argv.includes('--ci-env')){
  if(!process.env.GITHUB_ENV)throw Error('--ci-env is only for an Actions runner.');
  const keys=generateKeys();for(const [name,value]of Object.entries(keys)){if(!name.startsWith('NEXT_PUBLIC'))console.log('::add-mask::'+value);fs.appendFileSync(process.env.GITHUB_ENV,name+'='+value+'\n');}
  console.log('Generated per-run control keys; signing secrets masked before export.');
 }else if(process.argv.includes('--install')){
  if(!process.env.SEED_DATABASE_URL)throw Error('Administrative SEED_DATABASE_URL is required.');
  const client=new pg.Client({connectionString:process.env.SEED_DATABASE_URL,ssl:/(localhost|127\.0\.0\.1)/i.test(process.env.SEED_DATABASE_URL)?false:{rejectUnauthorized:true}});await client.connect();
  try{const r=await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');if(!r.rows[0]?.rolsuper&&!r.rows[0]?.rolbypassrls)throw Error('Actor key installation requires the migration administrator.');await installActorKey(client,process.env.ACTOR_SIGNING_SECRET);console.log('Actor key installed; no key value printed.');}finally{await client.end();}
 }else throw Error('Use --ci-env or --install. Production keys are supplied by the operator’s secret manager; never commit them.');
}

if(process.argv[1]?.endsWith('control-plane-keys.mjs'))main().catch(()=>{console.error('Control-key setup failed. Check operator environment and database privileges; no secrets logged.');process.exitCode=1;});
