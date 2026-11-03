import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extractMagicLink, localUrl } from "../scripts/vault-test-auth.mjs";
test("local Auth mail parsing accepts both loopback aliases and rejects external verify links", () => {
  const auth = new URL("http://127.0.0.1:54321");
  assert.equal(extractMagicLink({ HTML: '<a href="http://localhost:54321/auth/v1/verify?token=synthetic&amp;type=magiclink">Continue</a>' }, auth), "http://localhost:54321/auth/v1/verify?token=synthetic&type=magiclink");
  assert.equal(extractMagicLink({ Text: "https://example.test/auth/v1/verify?token=synthetic" }, auth), null);
  assert.equal(extractMagicLink({ Text: "http://localhost:9999/auth/v1/verify?token=synthetic" }, auth), null);
  assert.throws(() => localUrl("https://example.test", "App"));
});
test("the CI Auth fixture SQL runs as the restricted role against locked migrations in PGlite", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    for (const name of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
    const source = readFileSync("scripts/vault-test-auth.mjs", "utf8");
    const statements = [...source.matchAll(/db\.query\("([^"]+)"/g)].map(match => match[1]);
    const expected = ["BEGIN", "SET LOCAL ROLE margindesk_app", "SELECT set_config('request.jwt.claim.sub',$1::text,true),set_config('request.jwt.claims',$2::text,true)", "SELECT public.create_tenant_with_owner($1::text)", "COMMIT", "ROLLBACK"];
    assert.deepEqual(statements, expected);
    for (let n = 0; n < 2; n++) {
      const id = randomUUID(); await db.query("INSERT INTO auth.users VALUES($1,$2,now())", [id, `synthetic-${id}@example.test`]);
      await db.exec(expected[0]); await db.exec(expected[1]);
      await db.query(expected[2], [id, JSON.stringify({ sub: id, role: "authenticated" })]);
      const result = await db.query<{create_tenant_with_owner:string}>(expected[3], ["Synthetic privacy gate"]);
      assert.ok(result.rows[0].create_tenant_with_owner); await db.exec(expected[4]);
      await db.exec(expected[0]); await db.exec(expected[5]);
    }
  } finally { await db.close(); }
});
