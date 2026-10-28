const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202610280001_chunk2a_cost_units_currency.sql"), "utf8");
const foundation = fs.readFileSync(path.join(root, "supabase/migrations/202610240001_phase1_foundation.sql"), "utf8");

test("Chunk 2A migration executes in PGlite and cost, UOM, and privilege behavior is strict", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`
      CREATE SCHEMA extensions;
      CREATE SCHEMA auth;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY, aud text, role text, email text UNIQUE, encrypted_password text,
        email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
      );
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
    `);
    await db.exec(foundation);
    await db.exec(migration);

    const userId = "10000000-0000-4000-8000-000000000001";
    const tenantId = "20000000-0000-4000-8000-000000000001";
    await db.query(`INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
      VALUES($1,'authenticated','authenticated','chunk2a@example.invalid','',now(),now())`, [userId]);
    await db.query("INSERT INTO public.tenant(tenant_id,name,currency) VALUES($1,'Chunk 2A','USD')", [tenantId]);
    await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,'chunk2a@example.invalid','owner')", [tenantId,userId]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',json_build_object('sub',$1,'role','authenticated')::text,false)", [userId]);
    await db.query("SELECT set_config('app.real_actor_id',$1,false)", [userId]);

    const productId = "30000000-0000-4000-8000-000000000001";
    await db.query(`INSERT INTO public.product(tenant_id,id,sku,name,category,uom,unit_cost,list_price)
      VALUES($1,$2,'P-1','Fixture product','Test','EA',12.50,50)`, [tenantId,productId]);
    const seededCost = await db.query(`SELECT cost::text,currency,basis,effective_from::text,effective_to
      FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2`, [tenantId,productId]);
    assert.equal(seededCost.rows.length, 1, "product insert trigger must create a standard cost row");
    assert.equal(seededCost.rows[0].cost, "12.5000");
    assert.equal(seededCost.rows[0].basis, "standard");

    const units = await db.query(`SELECT id,code FROM public.uom WHERE tenant_id=$1 ORDER BY code`, [tenantId]);
    assert.deepEqual(units.rows.map(row => row.code), ["EA"]);
    await db.query("INSERT INTO public.uom(tenant_id,code,display_name) VALUES($1,'BOX','Box')", [tenantId]);
    const unitIds = (await db.query("SELECT code,id FROM public.uom WHERE tenant_id=$1", [tenantId])).rows;
    const ids = Object.fromEntries(unitIds.map(row => [row.code,row.id]));
    await db.query(`INSERT INTO public.uom_conversion(tenant_id,product_id,from_uom_id,to_uom_id,factor,direction)
      VALUES($1,NULL,$2,$3,12,'divide'),($1,$4,$2,$3,10,'divide')`, [tenantId,ids.EA,ids.BOX,productId]);
    const productSpecific = await db.query("SELECT public.convert_quantity($1,$2,25,'EA','BOX',current_date)::text AS value", [tenantId,productId]);
    const roundTrip = await db.query("SELECT public.convert_quantity($1,$2,public.convert_quantity($1,$2,25,'EA','BOX',current_date),'BOX','EA',current_date)::text AS value", [tenantId,productId]);
    const tenantWide = await db.query("SELECT public.convert_quantity($1,NULL,25,'EA','BOX',current_date)::text AS value", [tenantId]);
    assert.equal(Number(productSpecific.rows[0].value), 2.5, "product-specific conversion must override tenant-wide conversion");
    assert.equal(Number(roundTrip.rows[0].value), 25, "EA to BOX and back must round-trip");
    assert.equal(Number(tenantWide.rows[0].value), 2.0833, "tenant-wide conversion should round to four decimals");
    const missing = await db.query("SELECT public.convert_quantity($1,$2,1,'EA','PALLET',current_date) AS value", [tenantId,productId]);
    assert.equal(missing.rows[0].value, null, "missing conversion must return NULL instead of guessing");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.data_quality_issue WHERE tenant_id=$1 AND issue_code='uom_conversion_missing'", [tenantId])).rows[0].n, 1);

    const activeDate = seededCost.rows[0].effective_from;
    await assert.rejects(
      db.query(`INSERT INTO public.cost_history(tenant_id,product_id,cost,basis,effective_from,source,currency)
        VALUES($1,$2,14,'standard',$3,'overlap','USD')`, [tenantId,productId,activeDate]),
      error => error.code === "23P01",
      "overlapping cost ranges must be rejected by the exclusion constraint",
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2", [tenantId,productId])).rows[0].n, 1);

    const tables = await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity AND c.relforcerowsecurity`, [["cost_history","uom","uom_conversion","fx_rate","data_quality_issue"]]);
    assert.equal(tables.rows.length, 5, "all new tables must have enabled and forced RLS");
    const acl = await db.query(`SELECT c.relname,has_table_privilege('margindesk_app',c.oid,'TRUNCATE') AS app_truncate,
        has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
        has_table_privilege('authenticated',c.oid,'SELECT') AS auth_select,
        has_table_privilege('service_role',c.oid,'SELECT') AS service_select
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [["cost_history","uom","uom_conversion","fx_rate","data_quality_issue"]]);
    assert.ok(acl.rows.every(row => !row.app_truncate && !row.anon_select && !row.auth_select && !row.service_select));
  } finally {
    await db.close();
  }
});

test("Chunk 2A migration backfills a database that already contains Phase 1 tenant data", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  try {
    await db.exec(`
      CREATE SCHEMA extensions;
      CREATE SCHEMA auth;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users (id uuid PRIMARY KEY,email text UNIQUE);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
    `);
    await db.exec(foundation);
    await db.exec(`
      CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
      DO $verify$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
          WHERE e.extname='btree_gist' AND n.nspname='extensions'
        ) THEN RAISE EXCEPTION 'btree_gist is not installed in schema extensions'; END IF;
      END $verify$;
    `);
    const userId = "11000000-0000-4000-8000-000000000001";
    const tenantId = "21000000-0000-4000-8000-000000000001";
    const customerId = "41000000-0000-4000-8000-000000000001";
    const productId = "51000000-0000-4000-8000-000000000001";
    const priceListId = "71000000-0000-4000-8000-000000000001";
    const quoteId = "81000000-0000-4000-8000-000000000001";
    const quoteLineId = "82000000-0000-4000-8000-000000000001";
    const invoiceId = "83000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'seeded@example.invalid')", [userId]);
    await db.query("INSERT INTO public.tenant(tenant_id,name,currency,created_by) VALUES($1,'Seeded Phase 1 tenant','EUR',$2)", [tenantId,userId]);
    await db.query("INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES($1,$2,'seeded@example.invalid','owner')", [tenantId,userId]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',json_build_object('sub',$1,'role','authenticated')::text,false),set_config('app.real_actor_id',$1,false)", [userId]);
    await db.query("INSERT INTO public.customer(id,tenant_id,account_no,name) VALUES($1,$2,'SEED-1','Seed customer')", [customerId,tenantId]);
    await db.query("INSERT INTO public.product(id,tenant_id,sku,name,category,uom,unit_cost,list_price) VALUES($1,$2,'SEED-1','Seed product','test','EA',17.25,80)", [productId,tenantId]);
    await db.query("INSERT INTO public.price_list(id,tenant_id,name) VALUES($1,$2,'Seed list')", [priceListId,tenantId]);
    await db.query("INSERT INTO public.price_list_item(tenant_id,price_list_id,product_id,unit_price) VALUES($1,$2,$3,80)", [tenantId,priceListId,productId]);
    await db.query(`INSERT INTO public.quote(id,tenant_id,customer_id,created_by,status,margin_zone)
      VALUES($1,$2,$3,$4,'approved','green')`, [quoteId,tenantId,customerId,userId]);
    await db.query(`INSERT INTO public.quote_line(id,tenant_id,quote_id,product_id,quantity,list_price,pocket_price,cogs_total,pocket_margin,margin_pct)
      VALUES($1,$2,$3,$4,2,80,160,34.5,125.5,78.438)`, [quoteLineId,tenantId,quoteId,productId]);
    await db.query("INSERT INTO public.invoice(id,tenant_id,customer_id,invoice_date) VALUES($1,$2,$3,'2026-10-01')", [invoiceId,tenantId,customerId]);
    await db.query("INSERT INTO public.invoice_line(tenant_id,invoice_id,product_id,quantity,net_sales) VALUES($1,$2,$3,2,160)", [tenantId,invoiceId,productId]);
    await db.query(`INSERT INTO public.sales_order(tenant_id,source_id,customer_id,product_id,quantity,month_key)
      VALUES($1,'seed-order-1',$2,$3,2,'2026-10')`, [tenantId,customerId,productId]);
    await db.exec(migration);

    const cost = await db.query("SELECT cost::text,basis,currency,effective_from::text FROM public.cost_history WHERE tenant_id=$1 AND product_id=$2", [tenantId,productId]);
    assert.equal(cost.rows.length, 1, "Existing product cost must backfill to one effective standard cost.");
    assert.equal(cost.rows[0].cost, "17.2500");
    assert.equal(cost.rows[0].basis, "standard");
    assert.equal(cost.rows[0].currency, "EUR");
    assert.equal(cost.rows[0].effective_from, new Date().toISOString().slice(0,10));
    const inherited = await db.query(`
      SELECT (SELECT currency FROM public.price_list WHERE id=$1) AS price_list_currency,
        (SELECT currency FROM public.price_list_item WHERE price_list_id=$1) AS item_currency,
        (SELECT currency FROM public.quote WHERE id=$2) AS quote_currency,
        (SELECT currency FROM public.quote_line WHERE quote_id=$2) AS line_currency,
        (SELECT currency FROM public.invoice WHERE id=$3) AS invoice_currency,
        (SELECT currency FROM public.invoice_line WHERE invoice_id=$3) AS invoice_line_currency,
        (SELECT currency FROM public.sales_order WHERE source_id='seed-order-1') AS order_currency,
        (SELECT uom_code FROM public.sales_order WHERE source_id='seed-order-1') AS order_uom,
        (SELECT count(*)::int FROM public.uom WHERE tenant_id=$4 AND code='EA') AS canonical_uom_count
    `,[priceListId,quoteId,invoiceId,tenantId]);
    assert.deepEqual(inherited.rows[0], {
      price_list_currency: "EUR", item_currency: "EUR", quote_currency: "EUR", line_currency: "EUR",
      invoice_currency: "EUR", invoice_line_currency: "EUR", order_currency: "EUR", order_uom: "EA", canonical_uom_count: 1,
    });
    const listItem = await db.query("SELECT id,unit_price,effective_from,effective_to FROM public.price_list_item WHERE tenant_id=$1", [tenantId]);
    assert.equal(listItem.rows.length, 1);
    assert.ok(listItem.rows[0].id, "Existing price-list item surrogate ID remains present.");
    assert.equal(Number(listItem.rows[0].unit_price), 80);
    assert.ok(listItem.rows[0].effective_from instanceof Date || String(listItem.rows[0].effective_from).length >= 10);
    // The new migration must also apply to populated Phase 1 + 2A data.
    const agreementIds=[];
    const seed=JSON.parse(fs.readFileSync(path.join(root,'seed_data.json'),'utf8'));
    for (const x of seed.rebates.slice(0,2)) {
      const id=require('node:crypto').randomUUID();agreementIds.push(id);
      await db.query("INSERT INTO rebate_agreement(tenant_id,id,party_type,party_id,name,rate_pct,threshold_amount,period_start,period_end,currency) VALUES($1,$2,'vendor',$3,$4,$5,$6,$7,$8,'EUR')",[tenantId,id,x.partyId,x.name,x.rate,x.threshold,x.periodStart,x.periodEnd]);
      await db.query("INSERT INTO rebate_progress(tenant_id,agreement_id,period_start,period_end,eligible_spend,recorded_credits,currency,updated_at) VALUES($1,$2,$3,$4,1,0,'EUR','2020-01-01'),($1,$2,$3,$4,$5,$6,'EUR',now())",[tenantId,id,x.periodStart,x.periodEnd,x.eligibleSpend,x.credits]);
    }
    // Reproduce the legacy demo importer bug, with its documented source credits.
    await db.query("UPDATE tenant SET is_demo=true WHERE tenant_id=$1",[tenantId]);
    await db.query("UPDATE rebate_progress SET modeled_amount=350,recorded_credits=0 WHERE tenant_id=$1 AND agreement_id=$2 AND eligible_spend=29500",[tenantId,agreementIds[0]]);
    await db.query("INSERT INTO supplier_credit(tenant_id,vendor_name,credit_date,amount,reference,currency) VALUES($1,'NorthStar Metals','2026-08-31',200,'Remit 08-31','EUR'),($1,'NorthStar Metals','2026-09-30',150,'Remit 09-30','EUR')",[tenantId]);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261028162156_chunk2b_pricing_rebate_tiers.sql'),'utf8'));
    for (let i=0;i<agreementIds.length;i++){
      const a=(await db.query("SELECT calculation_mode,currency,period_start::text,period_end::text FROM rebate_agreement WHERE id=$1",[agreementIds[i]])).rows[0];
      const tiers=(await db.query("SELECT from_amount,to_amount,rate FROM rebate_tier WHERE agreement_id=$1",[agreementIds[i]])).rows;
      const entries=(await db.query("SELECT amount,currency,entry_type,occurred_on::text,source_ref FROM rebate_entry WHERE agreement_id=$1",[agreementIds[i]])).rows;
      assert.equal(entries.length,2,'Only latest cumulative snapshot migrates');
      const result=require('../rebate-engine.js').calculate(a,tiers,entries);
      if(i===0){assert.equal(Number(result.eligibleSpend),29500);assert.equal(Number(result.earned),590);assert.equal(Number(result.difference),240);}
      else assert.equal(Number(result.remaining),5000);
    }
    const groupId=require('node:crypto').randomUUID();
    await db.query("INSERT INTO customer_group(tenant_id,id,name) VALUES($1,$2,'Seed group')",[tenantId,groupId]);
    await db.query("UPDATE customer SET group_id=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,customerId,groupId]);
    const insertRule="INSERT INTO customer_price(tenant_id,group_id,product_id,rule_kind,price,currency,min_quantity,max_quantity,effective_from,effective_to,source) VALUES($1,$2,$3,'group',70,'EUR',$4,$5,$6,$7,'Seed rule')";
    await db.query(insertRule,[tenantId,groupId,productId,0,10,'2030-01-01','2030-02-01']);
    await db.query(insertRule,[tenantId,groupId,productId,10,20,'2030-01-01','2030-02-01']);
    await db.query(insertRule,[tenantId,groupId,productId,0,10,'2030-02-01','2030-03-01']);
    await assert.rejects(db.query(insertRule,[tenantId,groupId,productId,9,11,'2030-01-01','2030-02-01']),error=>error.code==='23P01');
    await assert.rejects(db.query("INSERT INTO customer_price(tenant_id,customer_id,product_id,rule_kind,price,currency,effective_from,source) VALUES($1,$2,$3,'customer','NaN','EUR',current_date,'invalid price')",[tenantId,customerId,productId]),error=>error.code==='23514');

    await assert.rejects(db.query("INSERT INTO rebate_tier(tenant_id,agreement_id,from_amount,rate) VALUES($1,$2,0,101)",[tenantId,agreementIds[0]]),error=>error.code==='23514');


  } finally {
    await db.close();
  }
});

test("Chunk 2A raises the completed tenant-table minimum without changing the locked ACL migration", () => {
  assert.match(migration, /Chunk 2A expected at least 29 tenant tables after migration/);
  assert.match(migration, /v_tenant_table_count<29/);
});
