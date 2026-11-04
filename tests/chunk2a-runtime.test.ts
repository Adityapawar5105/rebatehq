import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getRebateAudit } from "../lib/rebates";
import { appendAudit } from "../lib/audit";
import { getMonthlyWaterfall } from "../lib/analytics";
import { calculateServerQuote, assertQuotedPricesCurrent } from "../lib/margin";
import { importPrototypeData, validatePrototype } from "../lib/prototype-import";

const root = path.resolve(__dirname, "..");
const foundation = readFileSync(path.join(root, "supabase/migrations/202610240001_phase1_foundation.sql"), "utf8");
const chunk2a = readFileSync(path.join(root, "supabase/migrations/202610280001_chunk2a_cost_units_currency.sql"), "utf8");
const seed = JSON.parse(readFileSync(path.join(root, "seed_data.json"), "utf8"));

async function createDatabase(): Promise<any> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
  const db: any = new PGlite({ extensions: { pgcrypto, btree_gist } });
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
  await db.exec(chunk2a);
  await db.exec(readFileSync(path.join(root, 'supabase/migrations/20261028162156_chunk2b_pricing_rebate_tiers.sql'), 'utf8'));
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')&&n>'20261028162156_chunk2b_pricing_rebate_tiers.sql').sort())await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
  return db;
}

async function seedWorkspace(db: any, tenantId: string, userId: string) {
  await db.query(`INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
    VALUES($1,'authenticated','authenticated',$2,'',now(),now())`, [userId, `${tenantId}@example.invalid`]);
  await db.query("INSERT INTO tenant(tenant_id,name,currency) VALUES($1,'Runtime SQL test','USD')", [tenantId]);
  await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,$3,'owner')", [tenantId,userId,`${tenantId}@example.invalid`]);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',json_build_object('sub',$1,'role','authenticated')::text,false),set_config('app.real_actor_id',$1,false)", [userId]);
}

test("Chunk 2A runtime quote queries and prototype import statements execute in PGlite", async () => {
  const db: any = await createDatabase();
  try {
    const tenantId = "91000000-0000-4000-8000-000000000001";
    const userId = "92000000-0000-4000-8000-000000000001";
    await seedWorkspace(db, tenantId, userId);
    const plan = validatePrototype(seed);
    const jobId = "93000000-0000-4000-8000-000000000001";
    await db.query(`INSERT INTO import_job(id,tenant_id,import_type,status,source_name,source_hash,created_by)
      VALUES($1,$2,'prototype','dry_run','pglite-seed','runtime-test',$3)`, [jobId,tenantId,userId]);

    const imported = await importPrototypeData(db as any, tenantId, userId, plan, jobId);
    assert.equal(imported.products, seed.products.length);
    const audits = await getRebateAudit(db as any,tenantId);
    const northstar = audits.find((row:any)=>row.name.startsWith('NorthStar'))!;
    assert.equal(Number(northstar.audit.earned),590);
    assert.equal(Number(northstar.audit.difference),240);

    assert.ok(imported.orders > 0);
    assert.equal((await db.query("SELECT status FROM import_job WHERE id=$1", [jobId])).rows[0].status, "committed");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM quote WHERE tenant_id=$1", [tenantId])).rows[0].n, imported.quotes);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM cost_history WHERE tenant_id=$1", [tenantId])).rows[0].n, seed.products.length);

    const customerId = (await db.query("SELECT id FROM customer WHERE tenant_id=$1 ORDER BY account_no LIMIT 1", [tenantId])).rows[0].id;
    const product = (await db.query("SELECT id,uom FROM product WHERE tenant_id=$1 ORDER BY sku LIMIT 1", [tenantId])).rows[0];
    const today = (await db.query("SELECT current_date::text AS value")).rows[0].value;
    const quote = await calculateServerQuote(db as any, tenantId, customerId, [{
      productId: product.id, qty: 2, uom: product.uom, discountPct: 0, rebatePct: 0, accessory: 0,
    }], today, "USD");
    assert.equal(quote.currency, "USD");
    assert.equal(quote.normalizedLines[0].qty, 2);
    assert.equal(quote.math.valid, true);
    await db.query("INSERT INTO customer_price(tenant_id,customer_id,product_id,rule_kind,contract_ref,price,currency,effective_from,source) VALUES($1,$2,$3,'contract','TEST-C',99,'USD',current_date,'Signed test contract')",[tenantId,customerId,product.id]);
    const contractQuote=await calculateServerQuote(db as any,tenantId,customerId,[{productId:product.id,qty:2,uom:product.uom,discountPct:0,rebatePct:0,accessory:0}],today);
    assert.equal(contractQuote.math.lines[0].unitPrice,99);
    assert.equal(contractQuote.math.lines[0].pricingExplanation.source,'Signed test contract');
    assert.throws(()=>assertQuotedPricesCurrent([{quotedUnitPrice:98}],contractQuote.math),/approved price changed/);
    assertQuotedPricesCurrent([{quotedUnitPrice:99}],contractQuote.math);
    await db.query("DELETE FROM customer_price WHERE tenant_id=$1",[tenantId]);


    const productRows = (await db.query(`SELECT id,sku,name,category,supplier,uom,unit_cost,freight_cost,payment_terms_cost,list_price,tier_prices
      FROM product WHERE tenant_id=$1 AND active=true AND ($2='' OR sku ILIKE $3 OR name ILIKE $3 OR category ILIKE $3) ORDER BY sku LIMIT 500`, [tenantId,"","%%"])).rows;
    const repProductRows = await db.query(`SELECT id,sku,name,category,supplier,uom,list_price,tier_prices
      FROM product WHERE tenant_id=$1 AND active=true AND ($2='' OR sku ILIKE $3 OR name ILIKE $3 OR category ILIKE $3) ORDER BY sku LIMIT 500`, [tenantId,"","%%"]);
    const productConversions = await db.query(`SELECT c.product_id,u.code FROM uom_conversion c
      JOIN uom u ON u.tenant_id=c.tenant_id AND u.id IN (c.from_uom_id,c.to_uom_id)
      WHERE c.tenant_id=$1 AND (c.product_id IS NULL OR c.product_id=ANY($2::uuid[])) ORDER BY c.product_id,u.code`, [tenantId,productRows.map((row: any) => row.id)]);
    assert.ok(productRows.length > 0);
    assert.equal(repProductRows.rows.length, productRows.length);
    assert.ok(Array.isArray(productConversions.rows));

    const quoteId = "94000000-0000-4000-8000-000000000001";
    const line = quote.math.lines[0];
    await db.query(`INSERT INTO quote(tenant_id,id,customer_id,created_by,status,currency,pocket_price,cogs_total,pocket_margin,margin_pct,margin_zone,headroom,policy_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [tenantId,quoteId,customerId,userId,"pending_approval",quote.currency,quote.math.pocket,quote.math.cogs,quote.math.margin,quote.math.rate,quote.zone,quote.headroom,quote.policyVersion]);
    await db.query(`INSERT INTO quote_line(tenant_id,quote_id,product_id,quantity,list_price,discount_pct,off_invoice_rebate_pct,freight,payment_terms_cost,accessory_amount,pocket_price,cogs_total,pocket_margin,margin_pct,currency,uom_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [tenantId,quoteId,line.productId,line.qty,line.unitPrice,line.list?line.discount/line.list*100:0,line.list?line.rebate/line.list*100:0,line.freight,line.terms,line.accessory,line.pocket,line.cogs,line.margin,line.rate,quote.currency,quote.normalizedLines[0]?.uom||null]);
    await db.query("INSERT INTO approval(tenant_id,quote_id,requested_by,status,margin_pct_at_decision,policy_version) VALUES($1,$2,$3,'pending',$4,$5)", [tenantId,quoteId,userId,quote.math.rate,quote.policyVersion]);
    const listedQuotes = await db.query(`SELECT q.id,q.customer_id,c.name AS customer_name,q.status,q.margin_zone,q.headroom,q.pocket_price,q.cogs_total,q.pocket_margin,q.margin_pct,q.created_at
      FROM quote q JOIN customer c ON c.tenant_id=q.tenant_id AND c.id=q.customer_id WHERE q.tenant_id=$1 ORDER BY q.created_at DESC LIMIT 100`, [tenantId]);
    assert.ok(listedQuotes.rows.some((row: any) => row.id === quoteId));

    const managerId = "95000000-0000-4000-8000-000000000001";
    await db.query(`INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at)
      VALUES($1,'authenticated','authenticated','runtime-manager@example.invalid','',now(),now())`, [managerId]);
    await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1,$2,'runtime-manager@example.invalid','manager')", [tenantId,managerId]);
    const decisionQuote = (await db.query("SELECT id,customer_id,created_by,status,currency,created_at::date::text AS created_at FROM quote WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,quoteId])).rows[0];
    const approval = (await db.query("SELECT id,requested_by FROM approval WHERE tenant_id=$1 AND quote_id=$2 AND status='pending' FOR UPDATE", [tenantId,quoteId])).rows[0];
    const decisionLines = (await db.query(`SELECT product_id AS "productId",quantity AS qty,uom_code AS uom,list_price AS "quotedUnitPrice",
      discount_pct AS "discountPct",off_invoice_rebate_pct AS "rebatePct",accessory_amount AS accessory
      FROM quote_line WHERE tenant_id=$1 AND quote_id=$2`, [tenantId,quoteId])).rows;
    const decisionMath = await calculateServerQuote(db as any,tenantId,decisionQuote.customer_id,decisionLines,decisionQuote.created_at,decisionQuote.currency);
    assertQuotedPricesCurrent(decisionLines,decisionMath.math);
    await db.query("UPDATE approval SET status=$3,decided_by=$4,decision_note=$5,margin_pct_at_decision=$6,policy_version=$7,decided_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId,approval.id,"approved",managerId,"PGlite decision",decisionMath.math.rate,decisionMath.policyVersion]);
    await db.query("UPDATE quote SET status=$3,pocket_price=$4,cogs_total=$5,pocket_margin=$6,margin_pct=$7,margin_zone=$8,headroom=$9,policy_version=$10,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId,quoteId,"approved",decisionMath.math.pocket,decisionMath.math.cogs,decisionMath.math.margin,decisionMath.math.rate,decisionMath.zone,decisionMath.headroom,decisionMath.policyVersion]);
    await db.query("SELECT set_config('app.real_actor_id',$1,false)", [managerId]);
    await appendAudit(db as any, { tenantId, actorId: managerId, action: "quote.approved", entityType: "quote", entityId: quoteId, after: { zone: decisionMath.zone } });

    const sendQuote = (await db.query("SELECT id,customer_id,status,currency,created_at::date::text AS created_at FROM quote WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,quoteId])).rows[0];
    const sendLines = (await db.query(`SELECT product_id AS "productId",quantity AS qty,uom_code AS uom,list_price AS "quotedUnitPrice",
      discount_pct AS "discountPct",off_invoice_rebate_pct AS "rebatePct",accessory_amount AS accessory
      FROM quote_line WHERE tenant_id=$1 AND quote_id=$2`, [tenantId,quoteId])).rows;
    const sendMath = await calculateServerQuote(db as any,tenantId,sendQuote.customer_id,sendLines,sendQuote.created_at,sendQuote.currency);
    await db.query("UPDATE quote SET status='sent',pocket_price=$3,cogs_total=$4,pocket_margin=$5,margin_pct=$6,margin_zone=$7,headroom=$8,policy_version=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2", [tenantId,quoteId,sendMath.math.pocket,sendMath.math.cogs,sendMath.math.margin,sendMath.math.rate,sendMath.zone,sendMath.headroom,sendMath.policyVersion]);
    await appendAudit(db as any, { tenantId, actorId: managerId, action: "quote.send", entityType: "quote", entityId: quoteId, after: { zone: sendMath.zone } });
    assert.equal((await db.query("SELECT status FROM quote WHERE id=$1", [quoteId])).rows[0].status, "sent");

    const exportTables = ["tenant","membership","invite","customer","product","price_list","price_list_version","price_list_item","margin_policy","quote","quote_line","approval","sales_order","rebate_agreement","rebate_progress","invoice","invoice_line","cost_component","supplier_credit","alert","margin_snapshot","connector_secret","import_job","audit_log","uom","cost_history","uom_conversion","fx_rate","data_quality_issue"];
    for (const table of exportTables) {
      const exported = await db.query(`SELECT * FROM public.${table} WHERE tenant_id=$1 ORDER BY 1`, [tenantId]);
      assert.ok(Array.isArray(exported.rows), `export query failed for public.${table}`);
    }

    const waterfall = await getMonthlyWaterfall(db as any, tenantId, "2026-10");
    assert.equal(waterfall.month, "2026-10");
    assert.ok(waterfall.dataQualityIssues.length > 0, "the pre-cost-history orders must be reported as data-quality issues");

    const beforeCost = new Date(`${today}T00:00:00Z`);
    beforeCost.setUTCDate(beforeCost.getUTCDate() - 1);
    await assert.rejects(
      calculateServerQuote(db as any, tenantId, customerId, [{
        productId: product.id, qty: 1, uom: product.uom, discountPct: 0, rebatePct: 0, accessory: 0,
      }], beforeCost.toISOString().slice(0,10), "USD"),
      (error: any) => error.status === 422,
      "A transaction before the first cost-history range must fail and record a data-quality issue.",
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM data_quality_issue WHERE tenant_id=$1 AND issue_code='cost_history_gap' AND occurred_on=$2 AND entity_type='product' AND entity_id=$3", [tenantId,beforeCost.toISOString().slice(0,10),product.id])).rows[0].n, 1);

    await assert.rejects(
      calculateServerQuote(db as any, tenantId, customerId, [{
        productId: product.id, qty: 1, uom: product.uom, discountPct: 0, rebatePct: 0, accessory: 0,
      }], today, "EUR"),
      (error: any) => error.status === 422,
      "A missing transaction-date FX rate must fail and record a data-quality issue.",
    );
    assert.equal((await db.query("SELECT count(*)::int AS n FROM data_quality_issue WHERE tenant_id=$1 AND issue_code='fx_rate_missing' AND occurred_on=$2 AND entity_type='product' AND entity_id=$3", [tenantId,today,product.id])).rows[0].n, 1);

    await db.query(`INSERT INTO fx_rate(tenant_id,rate_date,from_currency,to_currency,rate,source)
      VALUES($1,$2,'USD','EUR',0.92,'PGlite runtime test')`, [tenantId,today]);
    const convertedQuote = await calculateServerQuote(db as any, tenantId, customerId, [{
      productId: product.id, qty: 1, uom: product.uom, discountPct: 0, rebatePct: 0, accessory: 0,
    }], today, "EUR");
    assert.equal(convertedQuote.currency, "EUR");
    assert.equal(convertedQuote.math.valid, true);
  } finally {
    await db.close();
  }
});
