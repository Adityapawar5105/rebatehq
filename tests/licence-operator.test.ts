import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes,randomUUID } from 'node:crypto';
import ts from 'typescript';
import { testDatabase } from './helpers/database';
import { LICENCE_LIMITS } from '../lib/licence-policy';
test('operator issuer and key installer SQL execute idempotently in PGlite without key material in audit rows',async()=>{
 const db=await testDatabase();
 try{
  const {installActorKey}=await import('../scripts/control-plane-keys.mjs');
  const key=randomBytes(32).toString('hex');await installActorKey(db,key);
  const n=(await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;await installActorKey(db,key);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n,n);
  assert.ok(!(await db.query('SELECT to_jsonb(a)::text AS a FROM audit_log a')).rows.some((r:any)=>r.a.includes(key)));
  const t=randomUUID(),u=randomUUID();await db.query("INSERT INTO tenant(tenant_id,name) VALUES($1,'Operator pilot')",[t]);await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[u,u+'@example.test']);await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')",[t,u,u+'@example.test']);
  const source=ts.transpileModule(readFileSync('scripts/issue-licence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\r?\n/gm,'');
  const code=source.slice(0,source.lastIndexOf('main().catch'))+'\nreturn main;';
  const pg={Client:class{async connect(){}async end(){}query=(sql:string,args:any[])=>db.query(sql,args);}};
  const main=new Function('pg','LICENCE_LIMITS','process','console',code)(pg,LICENCE_LIMITS,{argv:['node','issuer',t,'starter','2100-01-01T00:00:00Z'],env:{SEED_DATABASE_URL:'postgresql://localhost/fixture'}},{log(){}});
  await main();await main();
  assert.equal((await db.query('SELECT tier FROM workspace_licence WHERE tenant_id=$1',[t])).rows[0].tier,'starter');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM licence_seat WHERE tenant_id=$1',[t])).rows[0].n,1);
 }finally{await db.close();}
});
