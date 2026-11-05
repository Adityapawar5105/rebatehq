import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './helpers/database';
import {seedPrivacyLicence} from '../scripts/vault-test-auth.mjs';
import {scanRelayDatabase} from '../scripts/relay-privacy-scan.mjs';
import {seedRestoreRelay} from '../scripts/seed-restore-relay';
test('every new authenticated browser fixture and server privacy scan SQL statement executes in PGlite',async()=>{
 const db=await testDatabase(),tenant=crypto.randomUUID(),users=[crypto.randomUUID(),crypto.randomUUID()],devices=users.map(()=>crypto.randomUUID());
 try{
  await db.exec('BEGIN');await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1::uuid,'7A Auth fixture SQL')",[tenant]);
  for(const user of users)await db.query('INSERT INTO auth.users(id,email) VALUES($1::uuid,$2::text)',[user,user+'@example.invalid']);
  await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1::uuid,$2::uuid,$3::text,'owner')",[tenant,users[0],users[0]+'@example.invalid']);
  for(let i=0;i<2;i++)await seedPrivacyLicence(db,tenant,users[i],users[i]+'@example.invalid',{...(i?{tenantId:tenant,role:'manager'}:{}),deviceId:devices[i]});
  const {rows}=await db.query('SELECT status FROM licence_device WHERE tenant_id=$1::uuid ORDER BY id',[tenant]);assert.equal(rows.length,2);assert.ok(rows.every((r:any)=>r.status==='active'));
  await seedRestoreRelay(db,tenant,users[0],devices[0]);
  assert.deepEqual(await scanRelayDatabase(db,tenant,['SHOULD-NEVER-EXIST-HERE']),{relay_device_key:1,relay_epoch:1,relay_key_wrap:1,relay_event:1});await db.exec('ROLLBACK');
 }finally{await db.close();}
});
