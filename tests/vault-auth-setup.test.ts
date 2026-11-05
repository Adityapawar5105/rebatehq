import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extractMagicLink, localDatabaseUrl, localUrl } from "../scripts/vault-test-auth.mjs";
test("local Auth mail parsing accepts both loopback aliases and rejects external verify links", () => {
  const auth = new URL("http://127.0.0.1:54321");
  assert.equal(extractMagicLink({ HTML: '<a href="http://localhost:54321/auth/v1/verify?token=synthetic&amp;type=magiclink">Continue</a>' }, auth), "http://localhost:54321/auth/v1/verify?token=synthetic&type=magiclink");
  assert.equal(extractMagicLink({ Text: "https://example.test/auth/v1/verify?token=synthetic" }, auth), null);
  assert.equal(extractMagicLink({ Text: "http://localhost:9999/auth/v1/verify?token=synthetic" }, auth), null);
  assert.throws(() => localUrl("https://example.test", "App"));
});
test("local database URLs accept loopback Postgres and reject web or external hosts (CI #79 regression)", () => {
  // The authenticated relay gate passed the postgresql:// seed URL to the web-only localUrl check.
  assert.equal(localDatabaseUrl("postgresql://postgres:postgres@127.0.0.1:54322/postgres", "DB").port, "54322");
  assert.equal(localDatabaseUrl("postgres://u:p@localhost:5432/db", "DB").hostname, "localhost");
  assert.throws(() => localDatabaseUrl("postgresql://postgres:postgres@db.example.test:5432/postgres", "DB"), /disposable local stack/);
  assert.throws(() => localDatabaseUrl("http://127.0.0.1:54322", "DB"), /Postgres connection string/);
  assert.throws(() => localDatabaseUrl(undefined, "DB"), /required/);
  assert.throws(() => localUrl("postgresql://postgres:postgres@127.0.0.1:54322/postgres", "App"), "web URLs stay http/https only");
});
test('CI Auth workspace bootstrap uses the production signed context on PGlite twice',async()=>{
 const {testDatabase}=await import('./helpers/database');const {installTestIdentityKey}=await import('./helpers/signed-context');
 const {createPrivacyWorkspace}=await import('../scripts/vault-test-auth.mjs');const db=await testDatabase();const prior=process.env.ACTOR_SIGNING_SECRET;
 try{process.env.ACTOR_SIGNING_SECRET=await installTestIdentityKey(db);
 for(let i=0;i<2;i++){const id=randomUUID();await db.query('INSERT INTO auth.users VALUES($1,$2,now())',[id,id+'@example.test']);const tenant=await createPrivacyWorkspace(db,id);assert.ok(tenant);assert.equal((await db.query('SELECT (SELECT count(*) FROM quote WHERE tenant_id=$1)+(SELECT count(*) FROM alert WHERE tenant_id=$1) AS n',[tenant])).rows[0].n,0);}
 }finally{if(prior===undefined)delete process.env.ACTOR_SIGNING_SECRET;else process.env.ACTOR_SIGNING_SECRET=prior;await db.close();}
});
