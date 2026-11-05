// Chunk 6R: wave-1 legacy table retirement, applied in PGlite over the locked migrations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
// Historical schema snapshot: later chunks add control/relay tables after 6R.
const CONTROL_TABLES=['tenant','membership','invite','audit_log','workspace_licence','licence_seat','licence_location','licence_device'];

const MIGRATION = "20261105120000_chunk6r_retire_wave1.sql";
export const WAVE1 = ["customer", "customer_group", "product", "uom", "uom_conversion", "cost_history", "cost_component", "price_list", "price_list_version", "price_list_item", "customer_price", "margin_policy", "invoice", "invoice_line", "sales_order", "margin_snapshot", "data_quality_issue", "import_job", "column_mapping_template", "connector_secret", "connector_sync_run", "plan_feature"];
export const WAVE2 = ["quote", "quote_line", "quote_share_link", "approval", "approval_rule", "rebate_agreement", "rebate_progress", "rebate_tier", "rebate_entry", "supplier_credit", "alert", "fx_rate"];

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

test("6R: wave-1 tables and their functions are dropped; wave-2 rows survive without the old foreign keys", async () => {
  const db = await database(n => n < MIGRATION);
  try {
    const before = await publicTables(db);
    for (const t of [...WAVE1, ...WAVE2, ...CONTROL_TABLES]) assert.ok(before.includes(t), `missing before 6R: ${t}`);
    assert.equal(before.length, 42, "the 5B schema has 42 public tables");
    // A quote that points at a customer and a product, as legacy quoting wrote them.
    const tenant = randomUUID(), user = randomUUID(), customer = randomUUID(), product = randomUUID(), quote = randomUUID(), line = randomUUID();
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    await db.query("INSERT INTO public.tenant(tenant_id,name) VALUES($1,'Wave 1')", [tenant]);
    await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,'A','Customer')", [customer, tenant]);
    await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'P','Product','Test','EA',10,20)", [product, tenant]);
    await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'EA','EA') ON CONFLICT DO NOTHING", [tenant]);
    await db.query("INSERT INTO public.quote(id,tenant_id,customer_id,created_by,status,currency,margin_zone) VALUES($1,$2,$3,$4,'draft','USD','green')", [quote, tenant, customer, user]);
    await db.query("INSERT INTO public.quote_line(id,tenant_id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct,currency,uom_code) VALUES($1,$2,$3,$4,2,20,30,20,10,33.333,'USD','EA')", [line, tenant, quote, product]);

    await db.exec(readFileSync("supabase/migrations/" + MIGRATION, "utf8"));

    const after = await publicTables(db);
    for (const t of WAVE1) assert.ok(!after.includes(t), `still present after 6R: ${t}`);
    assert.deepEqual(after, [...WAVE2, ...CONTROL_TABLES].sort(), "exactly the control-plane and wave-2 tables remain");
    const kept = (await db.query("SELECT q.customer_id::text AS customer, l.product_id::text AS product, l.uom_code FROM public.quote q JOIN public.quote_line l ON l.quote_id=q.id WHERE q.id=$1", [quote])).rows;
    assert.deepEqual(kept, [{ customer, product, uom_code: "EA" }], "wave-2 rows keep their IDs");
    const fks = (await db.query("SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 1,2")).rows;
    for (const fk of fks) assert.ok(![...WAVE1].includes(fk.r.replace(/^public\./, "")), `a foreign key still points at ${fk.r}`);
    const functions = (await db.query("SELECT p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace")).rows.map((r: any) => r.proname);
    for (const f of ["convert_quantity", "record_data_quality_issue", "sync_product_standard_cost_history"]) assert.ok(!functions.includes(f), `function ${f} still exists`);
    // RLS and the audit trigger still guard every remaining table.
    const unguarded = (await db.query("SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")).rows;
    assert.deepEqual(unguarded, []);
  } finally { await db.close(); }
});

test("6R: the migration refuses to run if the expected quote foreign keys are not there", async () => {
  const db = await database(n => n < MIGRATION);
  try {
    await db.exec("ALTER TABLE public.quote_line DROP CONSTRAINT quote_line_uom_fk");
    await assert.rejects(db.exec(readFileSync("supabase/migrations/" + MIGRATION, "utf8")), /Expected 3 quote\/quote_line foreign keys/);
    assert.ok((await publicTables(db)).includes("product"), "nothing was dropped");
  } finally { await db.close(); }
});
