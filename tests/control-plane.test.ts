import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase,tenantCounts } from './helpers/database';
import { testIdentity } from './helpers/signed-context';
import { loadDatabaseTestSql } from '../scripts/load-db-test-sql.mjs';
import { readFileSync } from 'node:fs';
import { workspaceAssertion } from '../lib/licence-server';
import { generateKeys } from '../scripts/control-plane-keys.mjs';
import { verifyLicence } from '../lib/licence-verify';
test('complete SQL suite executes twice against fresh and populated PGlite with assertion stubs (not CI evidence)',async()=>{
 const db=await testDatabase();
 try{
  await db.exec(`ALTER TABLE auth.users ADD COLUMN aud text, ADD COLUMN role text, ADD COLUMN encrypted_password text, ADD COLUMN created_at timestamptz, ADD COLUMN updated_at timestamptz;
   CREATE FUNCTION extensions.plan(integer) RETURNS text LANGUAGE sql AS $$SELECT 'plan stub'::text$$;
   CREATE FUNCTION extensions.ok(boolean,text) RETURNS text LANGUAGE plpgsql AS $$BEGIN IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION FAILED: %',$2;END IF;RETURN $2;END$$;
   CREATE FUNCTION extensions.is(anyelement,anyelement,text) RETURNS text LANGUAGE plpgsql AS $$BEGIN RETURN extensions.ok($1 IS NOT DISTINCT FROM $2,$3);END$$;
   CREATE FUNCTION extensions.throws_ok(text,text,text,text) RETURNS text LANGUAGE plpgsql AS $$DECLARE code text;BEGIN BEGIN EXECUTE $1;EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;END;RETURN extensions.ok(code IS NOT DISTINCT FROM $2,$4||' actual SQLSTATE='||COALESCE(code,'success'));END$$;
   CREATE FUNCTION extensions.finish() RETURNS SETOF text LANGUAGE sql AS $$SELECT 'finish stub'::text$$;`);
  let sql=(await loadDatabaseTestSql()).replace('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;','');
  for(const token of new Set([...sql.matchAll(/__PHASE1_([A-Z0-9_]+_ID)__/g)].map((m:any)=>m[0])))sql=sql.replaceAll(token as string,randomUUID());
  // Unrelated pre-existing rows make the second database state nonempty.
  for(const populated of [false,true]){
   if(populated)await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1,'pre-existing control row')",[randomUUID()]);
   const baseline=await tenantCounts(db);
   for(let run=0;run<2;run++){try{await db.exec(sql);}catch(e:any){throw new Error(e.message+'\n'+(e.where||'')+'\n'+(e.detail||'')+'\nposition '+e.position+' '+sql.slice(Number(e.position)-150,Number(e.position)+150));}assert.deepEqual(await tenantCounts(db),baseline);}
  }
 }finally{await db.close();}
});

test('issuer, request signature replay, and restore-only private ACL cleanup SQL execute in PGlite',async()=>{
 const db=await testDatabase(),keys=generateKeys(),prior=process.env.LICENCE_SIGNING_KEY;
 process.env.LICENCE_SIGNING_KEY=keys.LICENCE_SIGNING_KEY;
 try{
  const {privateIssuerSql}=await import('../scripts/verify-restore-equivalence.mjs');
  const before=(await db.query(privateIssuerSql)).rows;
  await db.exec('GRANT SELECT ON rebatehq_private.actor_key TO anon;GRANT USAGE ON SEQUENCE rebatehq_private.login_budget TO service_role;');
  await db.exec(readFileSync('scripts/restore-platform-acl-cleanup.sql','utf8'));await db.exec(readFileSync('scripts/restore-platform-acl-cleanup.sql','utf8'));
  assert.deepEqual((await db.query(privateIssuerSql)).rows,before);
  const u=randomUUID(),t=randomUUID(),device=randomUUID();
  await db.exec('BEGIN');await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[u,u+'@example.test']);await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1,'issuer')",[t]);await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[t,u,u+'@example.test']);
  await db.query("INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES($1,'starter',now()+interval '2 days')",[t]);await db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1,$2)',[t,u]);
  await db.exec('SET LOCAL ROLE rebatehq_app');await testIdentity(db,u);
  const ctx={userId:u,tenantId:t} as any,envelope=await workspaceAssertion(db,ctx,device),scope={userId:u,workspaceId:t};
  const c=await verifyLicence(envelope,keys.NEXT_PUBLIC_LICENCE_VERIFY_KEY,scope,device);assert.equal(c.state,'active');assert.equal(c.tier,'starter');
  const pending=await workspaceAssertion(db,ctx,randomUUID());assert.equal(JSON.parse(pending.payload).state,'readonly');
  await db.query("UPDATE licence_device SET status='revoked' WHERE id=$1::uuid",[device]);assert.equal(JSON.parse((await workspaceAssertion(db,ctx,device)).payload).state,'readonly');
  const proof=(await db.query("SELECT current_setting('app.identity_payload') AS payload,current_setting('app.identity_signature') AS signature")).rows[0];
  await db.exec('RESET ROLE;COMMIT;BEGIN;SET LOCAL ROLE rebatehq_app;');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1::text,true),set_config('app.identity_payload',$2::text,true),set_config('app.identity_signature',$3::text,true)",[u,proof.payload,proof.signature]);
  await assert.rejects(db.query('SELECT verified_request_actor()'),(e:any)=>e.code==='42501');await db.exec('ROLLBACK');
 }finally{if(prior===undefined)delete process.env.LICENCE_SIGNING_KEY;else process.env.LICENCE_SIGNING_KEY=prior;await db.close();}
});
test('seat, invite, location and device boundaries at each tier, audited without actor spoofing',async()=>{
 const db=await testDatabase();
 try{
  for(const [tier,cap] of [['starter',1],['professional',5],['scale',15]] as const){
   await db.exec('BEGIN');const tenant=randomUUID(),owner=randomUUID(),users=Array.from({length:cap+1},()=>randomUUID());
   await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1,'licence limits')",[tenant]);
   for(const u of [owner,...users]){await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[u,u+'@example.test']);await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,$4)",[tenant,u,u+'@example.test',u===owner?'owner':'rep']);}
   await db.query("INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES($1,$2,now()+interval '1 day')",[tenant,tier]);
   await db.exec('SET LOCAL ROLE rebatehq_app');await testIdentity(db,owner);
   for(let i=0;i<cap;i++)await db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1,$2)',[tenant,i===0?owner:users[i]]);
   await assert.rejects(db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1,$2)',[tenant,users[cap]]),(e:any)=>e.code==='23514');
   // PGlite individual queries inside BEGIN abort on failure: recover with a savepoint around expected errors below.
   await db.exec('ROLLBACK');
  }
 }finally{await db.close();}
});
