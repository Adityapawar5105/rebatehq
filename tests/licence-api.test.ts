import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { testDatabase } from './helpers/database';
import { testIdentity } from './helpers/signed-context';
import { HttpError,errorResponse } from '../lib/authz';
import { msg } from '../lib/i18n/core';
test('all licence admin endpoint SQL branches run against PGlite with signed RLS and leave business tables untouched',async()=>{
 const db=await testDatabase(),u=randomUUID(),member=randomUUID(),t=randomUUID(),device=randomUUID();
 try{
  await db.exec('BEGIN');for(const id of [u,member])await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,id+'@example.test']);
  await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1,'API metadata')",[t]);
  for(const id of [u,member])await db.query('INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,$4)',[t,id,id+'@example.test',id===u?'owner':'rep']);
  await db.query("INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES($1,'professional',now()+interval '1 day')",[t]);
  await db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1,$2)',[t,u]);
  await db.exec('SET LOCAL ROLE rebatehq_app');await testIdentity(db,u);
  await db.query('INSERT INTO licence_device(id,tenant_id,user_id) VALUES($1,$2,$3)',[device,t,u]);
  const javascript=ts.transpileModule(readFileSync('lib/licence-admin-api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
  let role='owner';const ctx=()=>({userId:u,tenantId:t,role});
  const invoke=new Function('getAppContext','withDatabase','databaseContext','HttpError','errorResponse','readJsonLimited','z','msg',javascript+'\nreturn licenceAdmin;')(async()=>ctx(),async(_ctx:any,f:any)=>f(db),()=>({}),HttpError,errorResponse,(r:Request)=>r.json(),z,msg);
  const call=(kind:string,data?:object)=>invoke(new Request('https://app.example/api/licence/'+kind,{method:data?'POST':'GET',...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})}),kind);
  for(const kind of ['seats','locations','devices'])assert.equal((await call(kind)).status,200);
  assert.equal((await call('seats',{userId:member})).status,200);assert.equal((await call('seats',{userId:member,remove:true})).status,200);
  assert.equal((await call('locations',{name:'One metadata location',erpProfile:'p21'})).status,200);
  assert.equal((await call('devices',{id:device,status:'revoked'})).status,200);
  role='rep';assert.equal((await call('seats',{userId:member})).status,403);
  const empty=(await db.query('SELECT (SELECT count(*) FROM quote)::int AS quotes,(SELECT count(*) FROM rebate_agreement)::int AS agreements,(SELECT count(*) FROM alert)::int AS alerts')).rows[0];assert.deepEqual(empty,{quotes:0,agreements:0,alerts:0});
  await db.exec('ROLLBACK');
 }finally{await db.close();}
});
