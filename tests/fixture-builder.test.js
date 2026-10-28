const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const test = require("node:test");

const repoRoot = path.join(__dirname, "..");
const phase1Sql = fs.readFileSync(path.join(repoRoot, "supabase", "tests", "phase1_rls.sql"), "utf8").replace(/\r\n/g,"\n");
const pgliteModule = import("@electric-sql/pglite");

const tables = [
  "tenant", "membership", "customer", "product", "invite", "price_list", "price_list_version",
  "price_list_item", "margin_policy", "quote", "quote_line", "approval", "sales_order",
  "rebate_agreement", "rebate_progress", "invoice", "invoice_line", "cost_component",
  "supplier_credit", "alert", "margin_snapshot", "connector_secret", "import_job", "audit_log",
  "uom", "cost_history", "uom_conversion", "fx_rate", "data_quality_issue", "customer_group", "customer_price", "rebate_tier", "rebate_entry",
];
const existingTenant = "20000000-0000-4000-8000-000000000001";
const otherTenant = "20000000-0000-4000-8000-000000000002";
const existingOwner = "30000000-0000-4000-8000-000000000001";
const existingRep = "30000000-0000-4000-8000-000000000002";
const otherOwner = "30000000-0000-4000-8000-000000000003";
const quoteOne = "37000000-0000-4000-8000-000000000002";
const quoteTwo = "37000000-0000-4000-8000-000000000012";
const otherQuote = "37000000-0000-4000-8000-000000000022";
const approvalForQuoteTwo = "38000000-0000-4000-8000-000000000002";
const approvalForQuoteOne = "38000000-0000-4000-8000-000000000012";
const otherApproval = "38000000-0000-4000-8000-000000000022";

function extractFixtureGraph() {
  const startMarker = "-- Suite-owned auth users and tenants are inserted before dependent rows.";
  const endMarker = "SELECT extensions.ok(NOT EXISTS (\n SELECT 1 FROM pg_temp.phase1_rls_tables t WHERE NOT EXISTS (";
  const start = phase1Sql.indexOf(startMarker);
  const end = phase1Sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Could not find the explicit fixture graph SQL block.");
  return phase1Sql.slice(start, end);
}

function extractTableInventory() {
  const startMarker = "CREATE TEMP TABLE phase1_rls_tables(table_name text PRIMARY KEY);";
  const endMarker = "DO $$ DECLARE t text; n integer; v_sentinel jsonb;";
  const start = phase1Sql.indexOf(startMarker);
  const end = phase1Sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Could not find the tenant table inventory SQL.");
  return phase1Sql.slice(start, end);
}

function extractPositiveInsertLoop() {
  const start = phase1Sql.indexOf("DO $$ DECLARE t text; v_row jsonb; v_insert jsonb;");
  const end = phase1Sql.indexOf("END $$;", start);
  assert.ok(start >= 0 && end > start, "Could not find the positive-insert control loop SQL.");
  return phase1Sql.slice(start, end + "END $$;".length);
}

function materialize(sql, existingIds = undefined) {
  const tokens = [...new Set([...sql.matchAll(/__PHASE1_([A-Z0-9_]+_ID)__/g)].map(match => match[0]))];
  const ids = existingIds ?? new Map(tokens.map(token => [token, randomUUID()]));
  let output = sql;
  for (const [token, id] of ids) output = output.replaceAll(token, id);
  assert.doesNotMatch(output, /__PHASE1_[A-Z0-9_]+_ID__/);
  assert.equal(new Set(ids.values()).size, ids.size, "Fixture IDs must be independent and unique.");
  return { sql: output, ids };
}

async function createHarnessSchema(db) {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, aud text, role text, email text UNIQUE, encrypted_password text,
      email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE public.tenant (
      tenant_id uuid PRIMARY KEY, name text, created_by uuid REFERENCES auth.users(id)
    );
    CREATE TABLE public.membership (
      tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), user_id uuid NOT NULL REFERENCES auth.users(id),
      email text, role text, PRIMARY KEY(tenant_id,user_id)
    );
    CREATE TABLE public.customer (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), account_no text,
      name text, assigned_rep_id uuid REFERENCES auth.users(id), UNIQUE(tenant_id,id), UNIQUE(tenant_id,account_no)
    );
    CREATE TABLE public.uom (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), code text NOT NULL,
      display_name text NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE(tenant_id,id), UNIQUE(tenant_id,code)
    );
    CREATE TABLE public.product (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), sku text, name text,
      category text, list_price numeric, unit_cost numeric, uom text, UNIQUE(tenant_id,id), UNIQUE(tenant_id,sku)
    );
    CREATE TABLE public.cost_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), product_id uuid NOT NULL,
      cost numeric NOT NULL, basis text NOT NULL, effective_from date NOT NULL, effective_to date, source text NOT NULL,
      created_by uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(), currency text NOT NULL,
      UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id)
    );
    CREATE TABLE public.uom_conversion (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), product_id uuid,
      from_uom_id uuid NOT NULL, to_uom_id uuid NOT NULL, factor numeric NOT NULL, direction text NOT NULL,
      created_at timestamptz DEFAULT now(), UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id),
      FOREIGN KEY(tenant_id,from_uom_id) REFERENCES public.uom(tenant_id,id),
      FOREIGN KEY(tenant_id,to_uom_id) REFERENCES public.uom(tenant_id,id)
    );
    CREATE TABLE public.fx_rate (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), rate_date date NOT NULL,
      from_currency text NOT NULL, to_currency text NOT NULL, rate numeric NOT NULL, source text NOT NULL,
      created_at timestamptz DEFAULT now(), UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.data_quality_issue (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), issue_code text NOT NULL,
      entity_type text NOT NULL, entity_id text NOT NULL, occurred_on date NOT NULL, details jsonb NOT NULL DEFAULT '{}',
      created_by uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(), resolved_at timestamptz,
      resolved_by uuid REFERENCES auth.users(id), UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.invite (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), email text, role text,
      token_hash text NOT NULL UNIQUE, invited_by uuid REFERENCES auth.users(id), expires_at timestamptz
    );
    CREATE TABLE public.price_list (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), name text,
      UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.price_list_version (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), price_list_id uuid,
      version_no integer, status text, created_by uuid REFERENCES auth.users(id), UNIQUE(tenant_id,id),
      UNIQUE(tenant_id,price_list_id,version_no),
      FOREIGN KEY(tenant_id,price_list_id) REFERENCES public.price_list(tenant_id,id)
    );
    CREATE TABLE public.price_list_item (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), price_list_id uuid,
      product_id uuid, unit_price numeric, version_id uuid, effective_from date, effective_to date, currency text, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,price_list_id) REFERENCES public.price_list(tenant_id,id),
      FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id),
      FOREIGN KEY(tenant_id,version_id) REFERENCES public.price_list_version(tenant_id,id)
    );
    CREATE TABLE public.margin_policy (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), scope_type text,
      scope_key text, target_margin_pct numeric, floor_margin_pct numeric, walkaway_margin_pct numeric,
      updated_by uuid REFERENCES auth.users(id), UNIQUE(tenant_id,id), UNIQUE(tenant_id,scope_type,scope_key)
    );
    CREATE TABLE public.quote (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), customer_id uuid,
      created_by uuid REFERENCES auth.users(id), status text, pocket_price numeric, cogs_total numeric,
      pocket_margin numeric, margin_pct numeric, margin_zone text, headroom numeric, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,customer_id) REFERENCES public.customer(tenant_id,id)
    );
    CREATE TABLE public.quote_line (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), quote_id uuid,
      product_id uuid, quantity numeric, list_price numeric, pocket_price numeric, cogs_total numeric,
      pocket_margin numeric, margin_pct numeric, currency text, uom_code text, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,quote_id) REFERENCES public.quote(tenant_id,id),
      FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id)
    );
    CREATE TABLE public.approval (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), quote_id uuid NOT NULL,
      requested_by uuid REFERENCES auth.users(id), status text, margin_pct_at_decision numeric,
      policy_version integer, UNIQUE(tenant_id,id),
      CONSTRAINT approval_tenant_id_quote_id_fkey FOREIGN KEY(tenant_id,quote_id)
        REFERENCES public.quote(tenant_id,id)
    );
    CREATE TABLE public.sales_order (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), source_id text,
      customer_id uuid, product_id uuid, quantity numeric, month_key text, transaction_date date, currency text, uom_code text, UNIQUE(tenant_id,id),
      UNIQUE(tenant_id,source_id), FOREIGN KEY(tenant_id,customer_id) REFERENCES public.customer(tenant_id,id),
      FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id)
    );
    CREATE TABLE public.rebate_agreement (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), party_type text,
      party_id text, name text, rate_pct numeric, threshold_amount numeric, period_start date, period_end date, currency text,
      UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.rebate_progress (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), agreement_id uuid,
      period_start date, period_end date, eligible_spend numeric, modeled_amount numeric, recorded_credits numeric, currency text,
      UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,agreement_id) REFERENCES public.rebate_agreement(tenant_id,id)
    );
    CREATE TABLE public.invoice (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), customer_id uuid,
      invoice_date date, source_ref text, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,customer_id) REFERENCES public.customer(tenant_id,id)
    );
    CREATE TABLE public.invoice_line (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), invoice_id uuid,
      product_id uuid, quantity numeric, net_sales numeric, currency text, uom_code text, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,invoice_id) REFERENCES public.invoice(tenant_id,id),
      FOREIGN KEY(tenant_id,product_id) REFERENCES public.product(tenant_id,id)
    );
    CREATE TABLE public.cost_component (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), invoice_line_id uuid,
      component_type text, amount numeric, currency text, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,invoice_line_id) REFERENCES public.invoice_line(tenant_id,id)
    );
    CREATE TABLE public.supplier_credit (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), vendor_name text,
      credit_date date, amount numeric, reference text, currency text, UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.alert (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), severity text,
      message text, UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.margin_snapshot (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), entity_type text,
      entity_id text, period_month date, order_count integer, pocket_revenue numeric, pocket_margin numeric,
      margin_pct numeric, currency text, UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.connector_secret (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), provider text,
      ciphertext text, nonce text, auth_tag text, created_by uuid REFERENCES auth.users(id),
      UNIQUE(tenant_id,id), UNIQUE(tenant_id,provider)
    );
    CREATE TABLE public.import_job (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenant(tenant_id), import_type text,
      status text, created_by uuid REFERENCES auth.users(id), UNIQUE(tenant_id,id)
    );
    CREATE TABLE public.audit_log (
      id uuid PRIMARY KEY, tenant_id uuid, actor_id uuid, action text, entity_type text, entity_id text
    );
  `);
}

async function seedRestoredRows(db) {
  await db.exec(`
    CREATE TABLE public.customer_group(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),name text,UNIQUE(tenant_id,id));
    CREATE TABLE public.customer_price(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),group_id uuid,product_id uuid,rule_kind text,price numeric,currency text,effective_from date,effective_to date,source text,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,group_id) REFERENCES customer_group(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES product(tenant_id,id));
    CREATE TABLE public.rebate_tier(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),agreement_id uuid,from_amount numeric,rate numeric,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,agreement_id) REFERENCES rebate_agreement(tenant_id,id));
    CREATE TABLE public.rebate_entry(id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenant(tenant_id),agreement_id uuid,entry_type text,amount numeric,currency text,occurred_on date,source_ref text,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,agreement_id) REFERENCES rebate_agreement(tenant_id,id));
  `);

  await db.query(`INSERT INTO auth.users(id,aud,role,email,encrypted_password,created_at,updated_at) VALUES
    ($1,'authenticated','authenticated','old-owner@example.invalid','',now(),now()),
    ($2,'authenticated','authenticated','old-rep@example.invalid','',now(),now()),
    ($3,'authenticated','authenticated','other-owner@example.invalid','',now(),now())`, [existingOwner, existingRep, otherOwner]);
  await db.query(`INSERT INTO public.tenant(tenant_id,name,created_by) VALUES
    ($1,'Restored tenant one',$3),($2,'Restored tenant two',$4)`, [existingTenant, otherTenant, existingOwner, otherOwner]);
  await db.query(`INSERT INTO public.membership(tenant_id,user_id,email,role) VALUES
    ($1,$3,'old-owner@example.invalid','owner'),($1,$4,'old-rep@example.invalid','rep'),
    ($2,$5,'other-owner@example.invalid','owner')`, [existingTenant, otherTenant, existingOwner, existingRep, otherOwner]);

  const uomIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.query(`INSERT INTO public.uom(id,tenant_id,code,display_name) VALUES
    ($1,$7,'EA','Each'),($2,$7,'BOX','Box'),($3,$7,'CASE','Case'),
    ($4,$8,'EA','Each'),($5,$8,'BOX','Box'),($6,$8,'CASE','Case')`, [...uomIds, existingTenant, otherTenant]);

  const customerIds = ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002", "40000000-0000-4000-8000-000000000003"];
  const productIds = ["50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002", "50000000-0000-4000-8000-000000000003"];
  await db.query(`INSERT INTO public.customer(id,tenant_id,account_no,name,assigned_rep_id) VALUES
    ($1,$4,'R-1','Restored customer one',$6),($2,$4,'R-2','Restored customer two',$6),
    ($3,$5,'O-1','Other tenant customer',$7)`, [...customerIds, existingTenant, otherTenant, existingRep, otherOwner]);
  await db.query(`INSERT INTO public.product(id,tenant_id,sku,name,category,list_price,unit_cost,uom) VALUES
    ($1,$4,'R-1','Restored product one','test',100,60,'EA'),($2,$4,'R-2','Restored product two','test',100,60,'EA'),
    ($3,$5,'O-1','Other tenant product','test',100,60,'EA')`, [...productIds, existingTenant, otherTenant]);
  await db.query(`INSERT INTO public.cost_history(id,tenant_id,product_id,cost,basis,effective_from,effective_to,source,currency) VALUES
    ($1,$5,$7,55,'standard','2025-01-01','2025-06-01','restored old cost','USD'),
    ($2,$5,$7,60,'standard','2025-06-01',NULL,'restored current cost','USD'),
    ($3,$5,$8,45,'average','2025-01-01',NULL,'restored average cost','USD'),
    ($4,$6,$9,70,'standard','2025-01-01',NULL,'other tenant cost','USD')`, [randomUUID(), randomUUID(), randomUUID(), randomUUID(), existingTenant, otherTenant, ...productIds]);
  await db.query(`INSERT INTO public.uom_conversion(id,tenant_id,product_id,from_uom_id,to_uom_id,factor,direction) VALUES
    ($1,$2,$3,$4,$5,2.5,'multiply'),($6,$2,NULL,$4,$5,12,'multiply'),
    ($7,$8,$9,$10,$11,24,'multiply')`, [randomUUID(), existingTenant, productIds[0], uomIds[0], uomIds[1], randomUUID(), randomUUID(), otherTenant, productIds[2], uomIds[3], uomIds[4]]);
  await db.query(`INSERT INTO public.fx_rate(id,tenant_id,rate_date,from_currency,to_currency,rate,source) VALUES
    ($1,$4,'2026-10-01','USD','EUR',0.9,'restored fx'),($2,$4,'2026-10-02','USD','EUR',0.91,'restored fx'),
    ($3,$5,'2026-10-01','USD','EUR',0.9,'other tenant fx')`, [randomUUID(), randomUUID(), randomUUID(), existingTenant, otherTenant]);
  await db.query(`INSERT INTO public.data_quality_issue(id,tenant_id,issue_code,entity_type,entity_id,occurred_on,details) VALUES
    ($1,$4,'cost_history_gap','product',$6,'2026-01-01','{}'),($2,$4,'fx_rate_missing','order',$7,'2026-01-02','{}'),
    ($3,$5,'uom_conversion_missing','product',$8,'2026-01-03','{}')`, [randomUUID(), randomUUID(), randomUUID(), existingTenant, otherTenant, productIds[0], quoteOne, productIds[2]]);
  await db.query(`INSERT INTO public.quote(id,tenant_id,customer_id,created_by) VALUES
    ($1,$2,$3,$4),($5,$2,$6,$4),($7,$8,$9,$10)`, [quoteOne, existingTenant, customerIds[0], existingOwner, quoteTwo, customerIds[1], otherQuote, otherTenant, customerIds[2], otherOwner]);
  await db.query(`INSERT INTO public.approval(id,tenant_id,quote_id,requested_by) VALUES
    ($1,$2,$3,$4),($5,$2,$6,$4),($7,$8,$9,$10)`, [approvalForQuoteTwo, existingTenant, quoteTwo, existingOwner, approvalForQuoteOne, quoteOne, otherApproval, otherTenant, otherQuote, otherOwner]);

  await db.query(`INSERT INTO public.invite(id,tenant_id,email,role,token_hash,invited_by,expires_at) VALUES
    ($1,$2,'old-one@example.invalid','rep','old-invite-token-one',$3,now()+interval '7 days'),
    ($4,$2,'old-two@example.invalid','manager','old-invite-token-two',$3,now()+interval '7 days'),
    ($5,$6,'other@example.invalid','analyst','other-invite-token',$7,now()+interval '7 days')`, [
      randomUUID(), existingTenant, existingOwner, randomUUID(), randomUUID(), otherTenant, otherOwner,
    ]);

  const skip = new Set(["tenant", "membership", "customer", "product", "quote", "approval", "invite", "uom", "cost_history", "uom_conversion", "fx_rate", "data_quality_issue"]);
  let counter = 1;
  for (const table of tables) {
    if (skip.has(table)) continue;
    for (const tenantId of [existingTenant, existingTenant, otherTenant]) {
      const id = `90000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
      await db.query(`INSERT INTO public."${table}"(id,tenant_id) VALUES($1,$2)`, [id, tenantId]);
    }
  }
}

async function snapshotAllTenantTables(db) {
  const snapshot = {};
  for (const table of tables) {
    const result = await db.query(`SELECT count(*)::int AS count FROM public."${table}"`);
    snapshot[table] = result.rows[0].count;
  }
  return snapshot;
}

test("PGlite reproduces the arbitrary-clone FK failure and runs the explicit fixture graph against restored rows", async () => {
  const { PGlite } = await pgliteModule;
  const db = new PGlite();
  try {
    await createHarnessSchema(db);
    await seedRestoredRows(db);

    const sourceCounts = {};
    for (const table of tables) {
      const count = await db.query(`SELECT count(*)::int AS count FROM public."${table}" WHERE tenant_id=$1`, [existingTenant]);
      sourceCounts[table] = count.rows[0].count;
    }
    assert.equal(sourceCounts.quote, 2);
    assert.equal(sourceCounts.approval, 2);
    assert.ok(tables.every(table => sourceCounts[table] >= 1), "Every tenant table has pre-existing source rows.");

    const positiveInvite = await db.query(`
      WITH sample AS (SELECT jsonb_build_object('id',$1::text) AS v_insert)
      SELECT jsonb_set(v_insert,'{token_hash}',to_jsonb(replace(v_insert->>'id','-','')),true) AS with_token,
             jsonb_set(v_insert,'{email}',to_jsonb('phase1-positive-'||(v_insert->>'id')||'@example.invalid'),true) AS with_email
      FROM sample
    `, [randomUUID()]);
    assert.match(positiveInvite.rows[0].with_token.token_hash, /^[0-9a-f]{32}$/);
    assert.match(positiveInvite.rows[0].with_email.email, /^phase1-positive-[0-9a-f-]{36}@example\.invalid$/);

    const selectedQuote = (await db.query("SELECT id::text FROM public.quote WHERE tenant_id=$1 LIMIT 1", [existingTenant])).rows[0].id;
    const selectedApproval = (await db.query("SELECT id::text,quote_id::text FROM public.approval WHERE tenant_id=$1 LIMIT 1", [existingTenant])).rows[0];
    const clonedQuoteId = (await db.query("SELECT regexp_replace($1::text,'2$','3') AS id", [selectedQuote])).rows[0].id;
    const clonedApprovalId = (await db.query("SELECT regexp_replace($1::text,'2$','3') AS id", [selectedApproval.id])).rows[0].id;
    const clonedApprovalQuoteId = (await db.query("SELECT regexp_replace($1::text,'2$','3') AS id", [selectedApproval.quote_id])).rows[0].id;
    const selectedQuoteSourceIds = [selectedQuote];
    console.log(`Old-helper Tenant B source counts before cloning: ${tables.map(table => `${table}=${sourceCounts[table]}`).join(", ")}`);
    console.log(`Old-helper selected source approval ${selectedApproval.id} references quote_id ${selectedApproval.quote_id}; selected source quote row ${selectedQuote}; referenced parent was among selected source quote rows=${selectedQuoteSourceIds.includes(selectedApproval.quote_id)}; selected quote maps to ${clonedQuoteId} while approval FK maps to ${clonedApprovalQuoteId}.`);

    await db.exec("BEGIN; SAVEPOINT old_arbitrary_clone;");
    await db.query("INSERT INTO public.quote(tenant_id,id) VALUES($1,$2)", [otherTenant, clonedQuoteId]);
    let oldCloneError;
    try {
      await db.query("INSERT INTO public.approval(tenant_id,id,quote_id) VALUES($1,$2,$3)", [otherTenant, clonedApprovalId, clonedApprovalQuoteId]);
    } catch (error) {
      oldCloneError = error;
    }
    assert.equal(oldCloneError?.code, "23503", "The old independent LIMIT 1 cloning pattern should fail on the broken approval-to-quote edge.");
    assert.match(oldCloneError.constraint, /approval_tenant_id_quote_id_fkey/);
    await db.exec("ROLLBACK TO SAVEPOINT old_arbitrary_clone; RELEASE SAVEPOINT old_arbitrary_clone; COMMIT;");
    console.log(`Old arbitrary clone reproduced: SQLSTATE ${oldCloneError.code}, constraint=${oldCloneError.constraint}.`);

    const tableInventory = extractTableInventory();
    const beforeGraph = await snapshotAllTenantTables(db);
    assert.ok(tables.every(table => beforeGraph[table] >= 2), "The restored-data harness must have multiple pre-existing rows in every tenant table.");
    for (let run = 1; run <= 2; run += 1) {
      const runGraph = materialize(extractFixtureGraph());
      await db.exec("BEGIN;");
      await db.exec(tableInventory);
      await db.exec(runGraph.sql);
      await db.exec(materialize(extractPositiveInsertLoop(), runGraph.ids).sql);
      const positiveInsertResult = await db.query("SELECT current_setting('app.phase1_positive_insert_result')::jsonb AS result");
      assert.equal(positiveInsertResult.rows[0].result.passed, true, `Positive insert SQL should execute for every fixture table: ${JSON.stringify(positiveInsertResult.rows[0].result)}`);

      const actualTables = (await db.query("SELECT table_name FROM pg_temp.phase1_rls_tables ORDER BY table_name")).rows.map(row => row.table_name);
      assert.deepEqual(actualTables, [...tables].sort());
      const tenantAFixtures = await db.query("SELECT table_name,row_data FROM pg_temp.phase1_rls_tenant_a_fixtures ORDER BY table_name");
      const tenantBFixtures = await db.query("SELECT table_name,row_data FROM pg_temp.phase1_rls_insert_fixtures ORDER BY table_name");
      assert.equal(tenantAFixtures.rows.length, 33);
      assert.equal(tenantBFixtures.rows.length, 33);

      const ids = runGraph.ids;
      const tenantA = ids.get("__PHASE1_TENANT_A_ID__");
      const tenantB = ids.get("__PHASE1_TENANT_B_ID__");
      for (const row of tenantAFixtures.rows) assert.equal(row.row_data.tenant_id, tenantA, `Tenant A map must reference the suite-created tenant for ${row.table_name}.`);
      for (const row of tenantBFixtures.rows) assert.equal(row.row_data.tenant_id, tenantB, `Tenant B map must reference the suite-created tenant for ${row.table_name}.`);
      const approvalGraph = await db.query(`
        SELECT a.row_data->>'quote_id' AS approval_quote_id,q.row_data->>'id' AS quote_id
        FROM pg_temp.phase1_rls_tenant_a_fixtures a
        JOIN pg_temp.phase1_rls_tenant_a_fixtures q ON q.table_name='quote'
        WHERE a.table_name='approval'
      `);
      assert.equal(approvalGraph.rows[0].approval_quote_id, approvalGraph.rows[0].quote_id);
      const storedApproval = await db.query("SELECT quote_id::text FROM public.approval WHERE tenant_id=$1 AND id=$2", [tenantA, ids.get("__PHASE1_APPROVAL_A_ID__")]);
      assert.equal(storedApproval.rows[0].quote_id, ids.get("__PHASE1_QUOTE_A_ID__"));
      const preservedSourceRows = await db.query("SELECT count(*)::int AS count FROM public.approval WHERE tenant_id=$1", [existingTenant]);
      assert.equal(preservedSourceRows.rows[0].count, 2, "The builder must leave restored source approvals untouched.");
      await db.exec("ROLLBACK;");
      assert.deepEqual(await snapshotAllTenantTables(db), beforeGraph, `Fixture graph run ${run} must leave every tenant table unchanged after rollback.`);
    }
    console.log("Explicit Tenant A/B fixture graph passed twice with 33 tenant tables and pre-existing multi-row restored data; both transactions rolled back with unchanged row counts.");
  } finally {
    await db.close();
  }
});
