// Chunk 8R: wave-2 legacy table retirement, applied in PGlite over the locked migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// RETIREMENT_PROPOSAL.md "Wave 2" (the same list chunk6r-retirement.test.ts keeps as history).
const WAVE2 = ["quote", "quote_line", "quote_share_link", "approval", "approval_rule", "rebate_agreement", "rebate_progress", "rebate_tier", "rebate_entry", "supplier_credit", "alert", "fx_rate"];
const MIGRATION = "20261113120000_chunk8r_retire_wave2.sql";

async function database(through: (name: string) => boolean) {
  const { PGlite } = await import("@electric-sql/pglite"), { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"), { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db: any = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const n of readdirSync("supabase/migrations").filter(n => n.endsWith(".sql") && through(n)).sort()) await db.exec(readFileSync("supabase/migrations/" + n, "utf8"));
  return db;
}
const publicTables = async (db: any) => (await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1")).rows.map((r: any) => r.relname as string);
const publicFunctions = async (db: any) => (await db.query("SELECT p.oid::regprocedure::text AS f FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1")).rows.map((r: any) => r.f as string);

// One row in every wave-2 table, as the legacy server routes wrote them before 5B switched them off.
async function seedWave2(db: any) {
  const t = randomUUID(), u = randomUUID(), q = randomUUID(), a = randomUUID();
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [u]);
  await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Wave 2')", [t]);
  await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,'wave2@example.invalid','owner')", [t, u]);
  await db.query("INSERT INTO public.fx_rate(tenant_id,rate_date,from_currency,to_currency,rate,source) VALUES($1,current_date,'USD','EUR',0.9,'legacy')", [t]);
  await db.query("INSERT INTO public.quote(tenant_id,id,customer_id,created_by,status,currency,margin_zone) VALUES($1,$2,$3,$4,'pending_approval','USD','green')", [t, q, randomUUID(), u]);
  await db.query("INSERT INTO public.quote_line(tenant_id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct,currency,uom_code) VALUES($1,$2,$3,1,100,100,60,40,40,'USD','EA')", [t, q, randomUUID()]);
  await db.query("INSERT INTO public.approval(tenant_id,quote_id,requested_by,status,margin_pct_at_decision,policy_version) VALUES($1,$2,$3,'pending',40,1)", [t, q, u]);
  await db.query("INSERT INTO public.quote_share_link(tenant_id,quote_id,token_hash,expires_at) VALUES($1,$2,md5('a')||md5('b'),now()+interval '1 day')", [t, q]);
  await db.query("INSERT INTO public.approval_rule(tenant_id,name,minimum_margin_pct,approver_role) VALUES($1,'Legacy rule',20,'manager')", [t]);
  await db.query("INSERT INTO public.rebate_agreement(tenant_id,id,party_type,party_id,name,rate_pct,threshold_amount,period_start,period_end,currency) VALUES($1,$2,'vendor','V','Legacy rebate',2,1000,'2026-01-01','2026-12-31','USD')", [t, a]);
  await db.query("INSERT INTO public.rebate_progress(tenant_id,agreement_id,period_start,period_end,eligible_spend,modeled_amount,recorded_credits,currency) VALUES($1,$2,'2026-01-01','2026-12-31',1000,20,10,'USD')", [t, a]);
  await db.query("INSERT INTO public.rebate_tier(tenant_id,agreement_id,from_amount,rate) VALUES($1,$2,1000,2)", [t, a]);
  await db.query("INSERT INTO public.rebate_entry(tenant_id,agreement_id,entry_type,amount,currency,occurred_on,source_ref) VALUES($1,$2,'sale',1000,'USD',current_date,'legacy')", [t, a]);
  await db.query("INSERT INTO public.supplier_credit(tenant_id,vendor_name,credit_date,amount,reference,currency) VALUES($1,'V','2026-10-02',5,'CREDIT','USD')", [t]);
  await db.query("INSERT INTO public.alert(tenant_id,severity,message) VALUES($1,'review','Legacy alert')", [t]);
  for (const table of WAVE2) assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n, 1, `seeded ${table}`);
  return t;
}

test("8R: the 12 wave-2 tables are dropped; control-plane tables, functions, RLS and the audit trail stay", async () => {
  const { CONTROL_TABLES } = await import("../config/http-boundary.mjs");
  const db = await database(n => n < MIGRATION);
  try {
    const before = await publicTables(db);
    assert.deepEqual(before, [...WAVE2, ...CONTROL_TABLES].sort(), "before 8R: the control plane plus the 12 wave-2 tables");
    const tenant = await seedWave2(db);
    const functionsBefore = await publicFunctions(db);
    const audit = (await db.query("SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id=$1", [tenant])).rows[0].n;
    assert.ok(audit >= 12, "the legacy writes were audited");

    await db.exec(readFileSync("supabase/migrations/" + MIGRATION, "utf8"));

    const after = await publicTables(db);
    assert.deepEqual(after, [...CONTROL_TABLES].sort(), "exactly the 13 control-plane tables remain");
    assert.equal(after.length, 13);
    assert.deepEqual(await publicFunctions(db), functionsBefore, "no function is dropped or added");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.audit_log WHERE tenant_id=$1", [tenant])).rows[0].n, audit, "audit rows written before the drop stay");
    const fks = (await db.query("SELECT confrelid::regclass::text AS r FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")).rows;
    for (const fk of fks) assert.ok(!WAVE2.includes(fk.r.replace(/^public\./, "")), `a foreign key still points at ${fk.r}`);
    const unguarded = (await db.query("SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")).rows;
    assert.deepEqual(unguarded, [], "RLS stays forced on every remaining table");
    const leftovers = (await db.query("SELECT polname FROM pg_policy WHERE polrelid NOT IN (SELECT oid FROM pg_class)")).rows;
    assert.deepEqual(leftovers, []);
  } finally { await db.close(); }
});

test("8R: without CASCADE the drop refuses to remove a table something else still depends on", async () => {
  const db = await database(n => n < MIGRATION);
  try {
    await db.exec("CREATE TABLE public.unexpected_dependent(tenant_id uuid NOT NULL, quote_id uuid NOT NULL, FOREIGN KEY (tenant_id,quote_id) REFERENCES public.quote(tenant_id,id))");
    await assert.rejects(db.exec(readFileSync("supabase/migrations/" + MIGRATION, "utf8")), /depend/i);
    const tables = await publicTables(db);
    for (const t of WAVE2) assert.ok(tables.includes(t), `nothing was dropped: ${t}`);
  } finally { await db.close(); }
});

test("8R: the migration drops only the wave-2 list, with no CASCADE and no IF EXISTS", () => {
  const sql = readFileSync("supabase/migrations/" + MIGRATION, "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\bCASCADE\b/i);
  assert.doesNotMatch(sql, /\bIF\s+EXISTS\b/i);
  const dropped = [...sql.matchAll(/DROP\s+TABLE([^;]+);/gi)].flatMap(m => m[1].split(",").map(s => s.trim().replace(/^public\./, "")));
  assert.deepEqual([...dropped].sort(), [...WAVE2].sort());
  assert.doesNotMatch(sql, /DROP\s+(FUNCTION|TYPE|SCHEMA|ROLE|POLICY)/i);
});

test("8R: no server code reads a retired wave-2 table; the legacy rebates page is a fixed not-found", () => {
  assert.ok(!existsSync("lib/rebates.ts"), "the server rebate helper is removed");
  const page = readFileSync("app/legacy/rebates/page.tsx", "utf8");
  assert.match(page, /export default function RetiredPage\(\) \{ notFound\(\); \}/);
  assert.doesNotMatch(page, /withDatabase|@\/lib\/db/);
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [join(dir, e.name)] : []);
  // Server code: every route and page, and the top-level server helpers (lib subfolders are local-vault code).
  const server = [...files("app"), ...readdirSync("lib").filter(n => /\.(ts|tsx)$/.test(n)).map(n => join("lib", n))];
  const sql = new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\\s+(?:public\\.)?(?:${WAVE2.join("|")})\\b`, "i");
  for (const f of server) assert.doesNotMatch(readFileSync(f, "utf8"), sql, `${f} still reads a retired table`);
  assert.ok(server.length > 50);
});
