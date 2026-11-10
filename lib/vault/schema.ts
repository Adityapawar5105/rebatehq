import { msg } from "../i18n/core";
export const SCHEMA_VERSION = 19;
const V1_TABLES = ["vault_meta", "products", "customers", "price_matrix", "price_guardrails", "source_files", "import_batches", "sales_lines", "vendor_costs", "cost_basis_settings", "rules", "rule_runs", "price_versions", "roi_ledger", "audit_log", "import_issues", "converter_recipes"] as const;
const V4_TABLES = [...V1_TABLES, "rejected_rows"] as const;
const V5_TABLES = [...V4_TABLES, "agg_cpm", "agg_cm", "agg_p", "recon_issues"] as const;
const V6_TABLES = [...V5_TABLES, "pricing_settings", "rule_revisions", "rule_changes"] as const;
const V7_TABLES = [...V6_TABLES, "role_assignments", "access_settings", "cleanup_fixes", "cleanup_changes", "setup_progress"] as const;
const V9_TABLES = [...V7_TABLES, "relay_state"] as const;
const V10_TABLES = [...V9_TABLES, "source_kinds", "credit_profiles", "quotes", "quote_lines"] as const;
const V11_TABLES = [...V10_TABLES, "price_changesets", "price_changeset_rows"] as const;
const V12_TABLES = [...V11_TABLES, "competitor_prices", "price_grid_drafts", "price_export_receipts", "price_landed_checks", "sales_service_flags"] as const;
const V15_TABLES = [...V12_TABLES,"rebate_programs","rebate_tiers","rebate_accruals"] as const;
const V16_TABLES = [...V15_TABLES,"supplier_claims","purchases"] as const;
const V17_TABLES = [...V16_TABLES,"roi_recoveries","scorecard_consent","report_checks"] as const;
const V18_TABLES = [...V17_TABLES,"cost_index_points","cost_index_triggers","agent_settings","agent_runs","agent_inbox"] as const;
export const TABLES = [...V18_TABLES,"inventory_levels","dead_stock_settings"] as const;
/** Tables that exist at a schema version (in creation order, so copy-on-write inserts parents first). */
export function tablesFor(version: number): readonly string[] { return version >= 19 ? TABLES : version >= 18 ? V18_TABLES : version >= 17 ? V17_TABLES : version >= 16 ? V16_TABLES : version >= 14 ? V15_TABLES : version >= 12 ? V12_TABLES : version >= 11 ? V11_TABLES : version >= 10 ? V10_TABLES : version >= 9 ? V9_TABLES : version >= 7 ? V7_TABLES : version >= 6 ? V6_TABLES : version >= 5 ? V5_TABLES : version >= 4 ? V4_TABLES : V1_TABLES; }
// These are local DuckDB migrations, not Supabase migrations. V1 stays frozen
// so the committed encrypted compatibility fixture exercises a real upgrade.
export const V1_SQL = `
CREATE TABLE vault_meta(id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, tier VARCHAR NOT NULL CHECK(tier IN ('starter','professional','scale')), scope VARCHAR NOT NULL, audit_tip VARCHAR NOT NULL, audit_count BIGINT NOT NULL DEFAULT 0 CHECK(audit_count>=0));
CREATE TABLE products(product_id VARCHAR PRIMARY KEY, description VARCHAR NOT NULL DEFAULT '', category VARCHAR NOT NULL DEFAULT '', uom VARCHAR NOT NULL DEFAULT 'EA', current_cost BIGINT CHECK(current_cost>=0), list_price BIGINT CHECK(list_price>=0));
CREATE TABLE customers(customer_id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL DEFAULT '', tier VARCHAR NOT NULL DEFAULT '', branch VARCHAR NOT NULL DEFAULT '', region VARCHAR NOT NULL DEFAULT '', payment_terms VARCHAR NOT NULL DEFAULT '');
CREATE TABLE price_matrix(id VARCHAR PRIMARY KEY, product_id VARCHAR, category VARCHAR, customer_id VARCHAR, tier VARCHAR, qty_break DECIMAL(18,4) NOT NULL DEFAULT 0 CHECK(qty_break>=0), price BIGINT NOT NULL CHECK(price>=0), valid_from DATE NOT NULL, valid_to DATE CHECK(valid_to>valid_from));
CREATE TABLE price_guardrails(id VARCHAR PRIMARY KEY, scope VARCHAR NOT NULL, start BIGINT NOT NULL, target BIGINT NOT NULL, floor BIGINT NOT NULL CHECK(floor>=0 AND target>=floor AND start>=target));
CREATE TABLE source_files(id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, role VARCHAR NOT NULL CHECK(role IN ('sales_history','item_master','customer_list','vendor_cost','price_list')), bytes BIGINT NOT NULL CHECK(bytes>=0), imported_at VARCHAR NOT NULL);
CREATE TABLE import_batches(id VARCHAR PRIMARY KEY, source_id VARCHAR NOT NULL REFERENCES source_files(id), rows_loaded BIGINT NOT NULL CHECK(rows_loaded>=0), rows_rejected BIGINT NOT NULL CHECK(rows_rejected>=0), imported_at VARCHAR NOT NULL);
CREATE TABLE sales_lines(source_id VARCHAR NOT NULL REFERENCES source_files(id), line_id BIGINT NOT NULL CHECK(line_id>0), product_id VARCHAR NOT NULL REFERENCES products(product_id), customer_id VARCHAR NOT NULL REFERENCES customers(customer_id), sale_date DATE NOT NULL, quantity DECIMAL(18,4) NOT NULL CHECK(quantity>0), list_cents BIGINT NOT NULL CHECK(list_cents>=0), discount_cents BIGINT NOT NULL CHECK(discount_cents>=0), freight_cents BIGINT NOT NULL CHECK(freight_cents>=0), rebate_cents BIGINT NOT NULL CHECK(rebate_cents>=0), cost_cents BIGINT NOT NULL CHECK(cost_cents>=0), source_row BIGINT NOT NULL CHECK(source_row>=2), PRIMARY KEY(source_id,line_id));
CREATE TABLE vendor_costs(id VARCHAR PRIMARY KEY, vendor VARCHAR NOT NULL, product_id VARCHAR NOT NULL, cost BIGINT NOT NULL CHECK(cost>=0), effective_date DATE NOT NULL, source_file VARCHAR NOT NULL);
CREATE TABLE cost_basis_settings(product_group VARCHAR PRIMARY KEY, basis VARCHAR NOT NULL CHECK(basis IN ('last','average','replacement')));
CREATE TABLE rules(id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, definition VARCHAR NOT NULL, scope VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
CREATE TABLE rule_runs(id VARCHAR PRIMARY KEY, rule_id VARCHAR NOT NULL REFERENCES rules(id), run_date VARCHAR NOT NULL, affected_rows BIGINT NOT NULL CHECK(affected_rows>=0), status VARCHAR NOT NULL CHECK(status IN ('preview','approved','exported')));
CREATE TABLE price_versions(id VARCHAR PRIMARY KEY, snapshot_id VARCHAR NOT NULL, created_by VARCHAR NOT NULL, diff_summary VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
CREATE TABLE roi_ledger(id VARCHAR PRIMARY KEY, leak_id VARCHAR NOT NULL, action_taken VARCHAR NOT NULL, identified_cents BIGINT NOT NULL CHECK(identified_cents>=0), recovered_cents BIGINT NOT NULL DEFAULT 0 CHECK(recovered_cents>=0), recorded_at VARCHAR NOT NULL);
CREATE TABLE audit_log(sequence BIGINT PRIMARY KEY CHECK(sequence>0), id VARCHAR UNIQUE NOT NULL, occurred_at VARCHAR NOT NULL, action VARCHAR NOT NULL, details VARCHAR NOT NULL, previous_hash VARCHAR NOT NULL, hash VARCHAR NOT NULL);
CREATE TABLE import_issues(id VARCHAR PRIMARY KEY, source_id VARCHAR NOT NULL REFERENCES source_files(id), row_number BIGINT NOT NULL CHECK(row_number>=1), column_name VARCHAR NOT NULL, message VARCHAR NOT NULL, status VARCHAR NOT NULL CHECK(status IN ('open','resolved')));
CREATE TABLE converter_recipes(id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, profile VARCHAR NOT NULL, settings VARCHAR NOT NULL, updated_at VARCHAR NOT NULL);
`;
export const V2_SQL = `ALTER TABLE import_batches ADD COLUMN content_sha256 VARCHAR;
CREATE INDEX sales_lines_customer_date ON sales_lines(customer_id,sale_date);
CREATE INDEX sales_lines_product_date ON sales_lines(product_id,sale_date);`;
// V3 (chunk 4C-1): every row loaded from a file remembers its source file and
// row. A NULL source on products/customers means "derived from sales lines".
export const V3_SQL = `ALTER TABLE products ADD COLUMN source_id VARCHAR;
ALTER TABLE products ADD COLUMN source_row BIGINT;
ALTER TABLE customers ADD COLUMN source_id VARCHAR;
ALTER TABLE customers ADD COLUMN source_row BIGINT;
ALTER TABLE vendor_costs ADD COLUMN source_id VARCHAR;
ALTER TABLE vendor_costs ADD COLUMN source_row BIGINT;
ALTER TABLE price_matrix ADD COLUMN source_id VARCHAR;
ALTER TABLE price_matrix ADD COLUMN source_row BIGINT;
ALTER TABLE import_batches ADD COLUMN fingerprint VARCHAR;
ALTER TABLE import_batches ADD COLUMN rows_skipped BIGINT DEFAULT 0;`;
// DuckDB cannot add columns with constraints; the studio always writes rows_skipped.
// V4 (chunk 4C-2): cost may be unknown (NULL, never a guessed zero), sales keep their
// invoice number, issues carry a code, and rejected rows are kept for Fix Later.
// DuckDB refuses DROP NOT NULL on a table with indexes, so they are rebuilt around it.
export const V4_SQL = `DROP INDEX sales_lines_customer_date; DROP INDEX sales_lines_product_date;
ALTER TABLE sales_lines ALTER COLUMN cost_cents DROP NOT NULL;
CREATE INDEX sales_lines_customer_date ON sales_lines(customer_id,sale_date);
CREATE INDEX sales_lines_product_date ON sales_lines(product_id,sale_date);
ALTER TABLE sales_lines ADD COLUMN invoice_id VARCHAR;
ALTER TABLE import_issues ADD COLUMN code VARCHAR;
CREATE TABLE rejected_rows(source_id VARCHAR NOT NULL REFERENCES source_files(id), source_row BIGINT NOT NULL CHECK(source_row>=1), role VARCHAR NOT NULL, code VARCHAR NOT NULL, ${Array.from({ length: 12 }, (_, i) => `v${i} VARCHAR`).join(", ")}, status VARCHAR NOT NULL CHECK(status IN ('open','loaded','dismissed')), PRIMARY KEY(source_id,source_row));`;
/** rejected_rows keeps a role's canonical fields positionally in v0..v11 (ROLE_FIELDS order) so Fix Later can bulk-correct in SQL. */
export const REJECTED_SLOTS = 12;
// V5 (chunk 4D): returns and credits load as signed `credit` lines, so sales_lines is
// rebuilt (DuckDB cannot drop CHECK constraints) with sign rules per line kind. Cost
// stays NULL when unknown. agg_cpm is the customer x product x month x kind
// pre-aggregate the margin views read; recon_issues holds reconciliation differences
// (never silently adjusted); roi_ledger gains the finding text and a sample flag.
export const SALES_LINES_V5 = `CREATE TABLE sales_lines(source_id VARCHAR NOT NULL REFERENCES source_files(id), line_id BIGINT NOT NULL CHECK(line_id>0), product_id VARCHAR NOT NULL REFERENCES products(product_id), customer_id VARCHAR NOT NULL REFERENCES customers(customer_id), sale_date DATE NOT NULL, quantity DECIMAL(18,4) NOT NULL, list_cents BIGINT NOT NULL, discount_cents BIGINT NOT NULL, freight_cents BIGINT NOT NULL, rebate_cents BIGINT NOT NULL, cost_cents BIGINT, source_row BIGINT NOT NULL CHECK(source_row>=2), invoice_id VARCHAR, line_kind VARCHAR NOT NULL DEFAULT 'sale' CHECK(line_kind IN ('sale','credit')),
 CHECK((line_kind='sale' AND quantity>0 AND list_cents>=0 AND discount_cents>=0 AND freight_cents>=0 AND rebate_cents>=0 AND coalesce(cost_cents,0)>=0) OR (line_kind='credit' AND quantity<0 AND list_cents<=0 AND discount_cents<=0 AND freight_cents<=0 AND rebate_cents<=0 AND coalesce(cost_cents,0)<=0)),
 PRIMARY KEY(source_id,line_id));`;
export const V5_SQL = `CREATE TEMP TABLE md_v4_sales AS SELECT * FROM sales_lines;
DROP TABLE sales_lines;
${SALES_LINES_V5}
INSERT INTO sales_lines SELECT *, 'sale' FROM md_v4_sales ORDER BY customer_id, sale_date, line_id;
DROP TABLE md_v4_sales;
CREATE INDEX sales_lines_customer_date ON sales_lines(customer_id,sale_date);
CREATE INDEX sales_lines_product_date ON sales_lines(product_id,sale_date);
-- BIGINT, not HUGEINT: DuckDB-Wasm scans HUGEINT columns ~50x slower. A sum beyond BIGINT fails the rebuild loudly (never wraps).
CREATE TABLE agg_cpm(customer_id VARCHAR NOT NULL, product_id VARCHAR NOT NULL, month DATE NOT NULL, line_kind VARCHAR NOT NULL, lines BIGINT NOT NULL, quantity DECIMAL(18,4) NOT NULL, list_cents BIGINT NOT NULL, discount_cents BIGINT NOT NULL, rebate_cents BIGINT NOT NULL, freight_cents BIGINT NOT NULL, costed_lines BIGINT NOT NULL, costed_pocket_cents BIGINT NOT NULL, cost_cents BIGINT NOT NULL);
CREATE TABLE agg_cm(customer_id VARCHAR NOT NULL, month DATE NOT NULL, line_kind VARCHAR NOT NULL, lines BIGINT NOT NULL, list_cents BIGINT NOT NULL, discount_cents BIGINT NOT NULL, rebate_cents BIGINT NOT NULL, freight_cents BIGINT NOT NULL, costed_lines BIGINT NOT NULL, costed_pocket_cents BIGINT NOT NULL, cost_cents BIGINT NOT NULL);
CREATE TABLE agg_p(product_id VARCHAR NOT NULL, line_kind VARCHAR NOT NULL, lines BIGINT NOT NULL, list_cents BIGINT NOT NULL, discount_cents BIGINT NOT NULL, rebate_cents BIGINT NOT NULL, freight_cents BIGINT NOT NULL, costed_lines BIGINT NOT NULL, costed_pocket_cents BIGINT NOT NULL, cost_cents BIGINT NOT NULL);
CREATE TABLE recon_issues(id VARCHAR PRIMARY KEY, level VARCHAR NOT NULL CHECK(level IN ('invoice','customer_month','total')), scope_key VARCHAR NOT NULL, component VARCHAR NOT NULL, imported_cents HUGEINT, waterfall_cents HUGEINT, source_id VARCHAR, source_row BIGINT, message VARCHAR NOT NULL, status VARCHAR NOT NULL CHECK(status IN ('open','accepted')), found_at VARCHAR NOT NULL);
ALTER TABLE roi_ledger ADD COLUMN finding VARCHAR;
ALTER TABLE roi_ledger ADD COLUMN sample BOOLEAN;
ALTER TABLE roi_ledger ADD COLUMN updated_at VARCHAR;`;
// V6 (4E). V1–V5 remain immutable. Preview rows are price pairs, never invoice copies.
export const V6_SQL = `ALTER TABLE vault_meta ADD COLUMN pricing_revision BIGINT DEFAULT 0;
ALTER TABLE price_guardrails ADD COLUMN tier VARCHAR;
ALTER TABLE price_guardrails ADD COLUMN category VARCHAR;
CREATE UNIQUE INDEX guardrail_tier_category ON price_guardrails(tier,category);
CREATE TABLE pricing_settings(id INTEGER PRIMARY KEY CHECK(id=1), owner_id VARCHAR NOT NULL, owner_name VARCHAR NOT NULL, backup_days INTEGER NOT NULL CHECK(backup_days BETWEEN 1 AND 90));
CREATE TABLE rule_revisions(rule_id VARCHAR NOT NULL, version INTEGER NOT NULL CHECK(version>0), definition VARCHAR NOT NULL, explanation VARCHAR NOT NULL, created_at VARCHAR NOT NULL, PRIMARY KEY(rule_id,version));
ALTER TABLE rule_runs ADD COLUMN rule_version INTEGER;
ALTER TABLE rule_runs ADD COLUMN base_revision BIGINT;
ALTER TABLE rule_runs ADD COLUMN approved_by VARCHAR;
CREATE TABLE rule_changes(run_id VARCHAR NOT NULL, product_id VARCHAR NOT NULL, tier VARCHAR NOT NULL, before_cents BIGINT NOT NULL CHECK(before_cents>=0), after_cents BIGINT NOT NULL CHECK(after_cents>=0), cost_cents BIGINT, quantity DECIMAL(18,4) NOT NULL, impact_cents BIGINT NOT NULL, guard_status VARCHAR NOT NULL CHECK(guard_status IN ('green','yellow','red','unset')), PRIMARY KEY(run_id,product_id,tier));`;
// V7 (5A). Local roles, the owner's "reps may see cost" switch, the item-master cleanup
// journal (every fix keeps the cells it changed so it can be undone) and the setup
// checklist. No seed rows: copy-on-write copies whole tables into a fresh schema.
export const ROLE_IDS = ["owner", "pricing_owner", "pricing_manager", "sales_manager", "sales_rep", "accountant", "admin"] as const;
export const SETUP_STEPS = ["import", "map", "fix", "report", "rule", "export", "team"] as const;
const list = (values: readonly string[]) => values.map(v => `'${v}'`).join(",");
export const V7_SQL = `CREATE TABLE role_assignments(user_id VARCHAR PRIMARY KEY, display_name VARCHAR NOT NULL, role VARCHAR NOT NULL CHECK(role IN (${list(ROLE_IDS)})), assigned_by VARCHAR NOT NULL, assigned_at VARCHAR NOT NULL);
CREATE TABLE access_settings(id INTEGER PRIMARY KEY CHECK(id=1), rep_sees_cost BOOLEAN NOT NULL);
CREATE TABLE cleanup_fixes(id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL CHECK(kind IN ('merge_duplicates','normalize_uom','set_category')), summary VARCHAR NOT NULL, cells BIGINT NOT NULL CHECK(cells>=0), applied_at VARCHAR NOT NULL, applied_by VARCHAR NOT NULL, undone_at VARCHAR, undone_by VARCHAR);
CREATE TABLE cleanup_changes(fix_id VARCHAR NOT NULL, seq BIGINT NOT NULL CHECK(seq>0), tbl VARCHAR NOT NULL, key1 VARCHAR NOT NULL, key2 VARCHAR, col VARCHAR NOT NULL, before_value VARCHAR, after_value VARCHAR, PRIMARY KEY(fix_id,seq));
CREATE TABLE setup_progress(step VARCHAR PRIMARY KEY CHECK(step IN (${list(SETUP_STEPS)})), done_at VARCHAR NOT NULL, how VARCHAR NOT NULL CHECK(how IN ('auto','manual')));`;
// V8 (6A). A file with no header row has data on its first line, so a sales line's
// source row may be 1. DuckDB cannot drop a CHECK constraint, so sales_lines is rebuilt
// as in V5 with only that check relaxed; every row, column and index is kept.
export const SALES_LINES_V8 = SALES_LINES_V5.replace("CHECK(source_row>=2)", "CHECK(source_row>=1)");
export const V8_SQL = `CREATE TEMP TABLE md_v7_sales AS SELECT * FROM sales_lines;
DROP TABLE sales_lines;
${SALES_LINES_V8}
INSERT INTO sales_lines SELECT * FROM md_v7_sales ORDER BY customer_id, sale_date, line_id;
DROP TABLE md_v7_sales;
CREATE INDEX sales_lines_customer_date ON sales_lines(customer_id,sale_date);
CREATE INDEX sales_lines_product_date ON sales_lines(product_id,sale_date);`;
// Only inside the encrypted local vault: device private JWKs, epoch keys,
// authenticated inbox and durable outbox. None of this table goes to the API.
export const V9_SQL = `CREATE TABLE relay_state(id INTEGER PRIMARY KEY CHECK(id=1), payload VARCHAR NOT NULL);`;
// V10 (7B). Quote Desk and the AR aging credit signal. source_files keeps its V1 role CHECK (DuckDB
// cannot rebuild a table other tables reference), so an AR aging file is stored as 'customer_list'
// with its real kind in source_kinds. A quote line keeps the price, guardrail and cost it was built with.
export const V10_SQL = `CREATE TABLE source_kinds(source_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL CHECK(kind IN ('ar_aging')));
CREATE TABLE credit_profiles(customer_id VARCHAR PRIMARY KEY, as_of DATE, current_cents BIGINT NOT NULL CHECK(current_cents>=0), d1_30_cents BIGINT NOT NULL CHECK(d1_30_cents>=0), d31_60_cents BIGINT NOT NULL CHECK(d31_60_cents>=0), d61_90_cents BIGINT NOT NULL CHECK(d61_90_cents>=0), d90_plus_cents BIGINT NOT NULL CHECK(d90_plus_cents>=0), credit_limit_cents BIGINT CHECK(credit_limit_cents>=0), dso_days DECIMAL(18,4) CHECK(dso_days>=0), source_id VARCHAR NOT NULL, source_row BIGINT);
CREATE TABLE quotes(id VARCHAR PRIMARY KEY, number VARCHAR NOT NULL UNIQUE, customer_id VARCHAR NOT NULL, status VARCHAR NOT NULL CHECK(status IN ('draft','submitted','pending','approved','rejected')), created_by VARCHAR NOT NULL, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL, valid_until DATE, exception_reason VARCHAR, decided_by VARCHAR, decided_at VARCHAR, decision_note VARCHAR, relay_object VARCHAR);
CREATE TABLE quote_lines(quote_id VARCHAR NOT NULL, line_no INTEGER NOT NULL CHECK(line_no>0), product_id VARCHAR NOT NULL, quantity DECIMAL(18,4) NOT NULL CHECK(quantity>0), unit_price_cents BIGINT NOT NULL CHECK(unit_price_cents>=0), book_price_cents BIGINT CHECK(book_price_cents>=0), price_source VARCHAR NOT NULL CHECK(price_source IN ('customer','tier','category','list','none')), start_cents BIGINT, target_cents BIGINT, floor_cents BIGINT, guard_status VARCHAR NOT NULL CHECK(guard_status IN ('green','yellow','red','unset')), cost_cents BIGINT CHECK(cost_cents>=0), PRIMARY KEY(quote_id,line_no));`;
// 7C-1: draft metadata and scoped changes; never invoice copies.
export const V11_SQL = `CREATE TABLE price_changesets(run_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL CHECK(kind IN ('planner','rollback')), source_version VARCHAR, segment_type VARCHAR NOT NULL CHECK(segment_type IN ('tier','category','customer','version')), segment_value VARCHAR NOT NULL, increase_bp INTEGER, created_by VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
CREATE TABLE price_changeset_rows(run_id VARCHAR NOT NULL,product_id VARCHAR NOT NULL,tier VARCHAR NOT NULL,customer_id VARCHAR,valid_to DATE,matrix_tier VARCHAR,PRIMARY KEY(run_id,product_id,tier));`;
// Bounded draft/receipt payloads contain exact integer cents and decimal quantity
// strings, never floating-point JSON numbers. They preserve the complete scope.
export const V12_SQL = `CREATE TABLE competitor_prices(id VARCHAR PRIMARY KEY,product_id VARCHAR NOT NULL,competitor VARCHAR NOT NULL,price BIGINT NOT NULL CHECK(price>=0),observed_on DATE NOT NULL,source VARCHAR NOT NULL,created_by VARCHAR NOT NULL,created_at VARCHAR NOT NULL);
CREATE TABLE price_grid_drafts(run_id VARCHAR PRIMARY KEY,required_tier VARCHAR NOT NULL CHECK(required_tier IN ('starter','professional')),rows_json VARCHAR NOT NULL);
CREATE TABLE price_export_receipts(id VARCHAR PRIMARY KEY,run_id VARCHAR NOT NULL,profile VARCHAR NOT NULL,created_at VARCHAR NOT NULL,content_hash VARCHAR NOT NULL,rows_json VARCHAR NOT NULL);
CREATE TABLE price_landed_checks(id VARCHAR PRIMARY KEY,receipt_id VARCHAR NOT NULL,file_name VARCHAR NOT NULL,created_at VARCHAR NOT NULL,results_json VARCHAR NOT NULL);
CREATE TABLE sales_service_flags(invoice_key VARCHAR PRIMARY KEY,free_delivery BOOLEAN NOT NULL,recorded_by VARCHAR NOT NULL,recorded_at VARCHAR NOT NULL);`;
// V13: no amount is rewritten; old vaults retain USD cents exactly.
export const V13_SQL = `ALTER TABLE vault_meta ADD COLUMN currency VARCHAR DEFAULT 'USD';
ALTER TABLE import_batches ADD COLUMN source_currency VARCHAR DEFAULT 'USD';
ALTER TABLE import_batches ADD COLUMN workspace_currency VARCHAR DEFAULT 'USD';
ALTER TABLE import_batches ADD COLUMN fx_rate VARCHAR DEFAULT '1';
ALTER TABLE import_batches ADD COLUMN header_fx VARCHAR DEFAULT '[]';`;
// Local-only, forward migration. The unreferenced kind sidecar is rebuilt, never
// source_files (its original CHECK/FKs stay intact). No server migration.
export const V14_SQL = `CREATE TEMP TABLE md_v13_kinds AS SELECT * FROM source_kinds;
DROP TABLE source_kinds;
CREATE TABLE source_kinds(source_id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL CHECK(kind IN ('ar_aging','rebate_agreement')));
INSERT INTO source_kinds SELECT * FROM md_v13_kinds;
DROP TABLE md_v13_kinds;
CREATE TABLE rebate_programs(id VARCHAR PRIMARY KEY,reference VARCHAR NOT NULL UNIQUE,name VARCHAR NOT NULL,customer_id VARCHAR NOT NULL,mode VARCHAR NOT NULL CHECK(mode IN ('retroactive','incremental')),booking_mode VARCHAR NOT NULL CHECK(booking_mode IN ('additional','replace')),period_start DATE NOT NULL,period_end DATE NOT NULL CHECK(period_end>=period_start),eligible_skus VARCHAR NOT NULL,excluded_skus VARCHAR NOT NULL,enabled BOOLEAN NOT NULL DEFAULT true,source_id VARCHAR,source_row BIGINT CHECK(source_row>0),created_by VARCHAR NOT NULL,created_at VARCHAR NOT NULL,last_calculated_at VARCHAR);
CREATE INDEX rebate_program_customer_period ON rebate_programs(customer_id,period_start,period_end);
CREATE TABLE rebate_tiers(program_id VARCHAR NOT NULL,from_cents BIGINT NOT NULL CHECK(from_cents>=0),to_cents BIGINT CHECK(to_cents>from_cents),rate_milli INTEGER NOT NULL CHECK(rate_milli BETWEEN 0 AND 100000),source_row BIGINT CHECK(source_row>0),PRIMARY KEY(program_id,from_cents));
CREATE TABLE rebate_accruals(program_id VARCHAR NOT NULL,source_id VARCHAR NOT NULL,line_id BIGINT NOT NULL,base_cents BIGINT NOT NULL,booked_cents BIGINT NOT NULL,accrued_cents BIGINT NOT NULL,PRIMARY KEY(source_id,line_id));
CREATE INDEX rebate_accrual_program ON rebate_accruals(program_id);
CREATE OR REPLACE VIEW rebate_sales AS SELECT s.* REPLACE(CASE WHEN p.id IS NULL OR NOT p.enabled THEN s.rebate_cents WHEN p.booking_mode='replace' THEN a.accrued_cents ELSE s.rebate_cents+a.accrued_cents END AS rebate_cents)
FROM sales_lines s LEFT JOIN rebate_accruals a ON a.source_id=s.source_id AND a.line_id=s.line_id LEFT JOIN rebate_programs p ON p.id=a.program_id;`;
// V15 (7V-3b, blueprint v2.5 item 26): plain-text row notes, local only. Existing rows get no note (NULL).
// The 1,000-character limit (Unicode code points) is enforced in the worker, where it is measured.
export const V15_SQL = `ALTER TABLE products ADD COLUMN notes VARCHAR;
ALTER TABLE customers ADD COLUMN notes VARCHAR;`;
export const V16_SQL = `CREATE TEMP TABLE md_v15_kinds AS SELECT * FROM source_kinds;
DROP TABLE source_kinds;
CREATE TABLE source_kinds(source_id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL CHECK(kind IN ('ar_aging','rebate_agreement','purchases')));
INSERT INTO source_kinds SELECT * FROM md_v15_kinds; DROP TABLE md_v15_kinds;
CREATE TABLE purchases(source_id VARCHAR NOT NULL,line_id BIGINT NOT NULL CHECK(line_id>0),receipt_ref VARCHAR NOT NULL,supplier VARCHAR NOT NULL,product_id VARCHAR NOT NULL,receipt_date DATE NOT NULL,quantity DECIMAL(18,4) NOT NULL,amount_cents BIGINT NOT NULL,entry_kind VARCHAR NOT NULL CHECK(entry_kind IN ('receipt','return','credit_memo')),uom VARCHAR NOT NULL,source_row BIGINT NOT NULL CHECK(source_row>0),PRIMARY KEY(source_id,line_id),CHECK((entry_kind='receipt' AND quantity>0 AND amount_cents>=0) OR (entry_kind='return' AND quantity<0 AND amount_cents<=0) OR (entry_kind='credit_memo' AND quantity<=0 AND amount_cents<=0)));
CREATE INDEX purchase_supplier_period ON purchases(supplier,receipt_date);
CREATE TABLE supplier_claims(id VARCHAR PRIMARY KEY,reference VARCHAR NOT NULL UNIQUE,supplier VARCHAR NOT NULL,program VARCHAR NOT NULL,claim_type VARCHAR NOT NULL CHECK(claim_type IN ('rebate','ship_and_debit')),period_start DATE NOT NULL,period_end DATE NOT NULL CHECK(period_end>=period_start),due_date DATE NOT NULL,mode VARCHAR NOT NULL CHECK(mode IN ('retroactive','incremental')),tiers_json VARCHAR NOT NULL,eligible_skus VARCHAR NOT NULL,excluded_skus VARCHAR NOT NULL,requested_cents BIGINT CHECK(requested_cents>=0),authorization_ref VARCHAR NOT NULL,status VARCHAR NOT NULL CHECK(status IN ('draft','prepared','submitted','approved','rejected','paid','cancelled')),amount_claimed BIGINT CHECK(amount_claimed>=0),snapshot_json VARCHAR,created_by VARCHAR NOT NULL,created_at VARCHAR NOT NULL,updated_at VARCHAR NOT NULL);
CREATE INDEX supplier_claim_program_period ON supplier_claims(supplier,program,period_start,period_end);`;
export const V17_SQL = `CREATE TABLE roi_recoveries(id VARCHAR PRIMARY KEY,ledger_id VARCHAR NOT NULL,run_id VARCHAR NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),evidence_ref VARCHAR NOT NULL UNIQUE CHECK(length(evidence_ref) BETWEEN 1 AND 100),period_start DATE NOT NULL,period_end DATE NOT NULL CHECK(period_end>=period_start),recorded_by VARCHAR NOT NULL,recorded_at VARCHAR NOT NULL,voided_by VARCHAR,voided_at VARCHAR);
CREATE INDEX roi_recovery_ledger ON roi_recoveries(ledger_id);
CREATE TABLE scorecard_consent(user_id VARCHAR PRIMARY KEY,opted_in BOOLEAN NOT NULL,updated_at VARCHAR NOT NULL);
CREATE TABLE report_checks(kind VARCHAR PRIMARY KEY CHECK(kind IN ('monthly','weekly')),checked_at VARCHAR NOT NULL,period_start DATE NOT NULL,period_end DATE NOT NULL CHECK(period_end>=period_start),revision BIGINT NOT NULL CHECK(revision>=0));`;
// V18 (8B-1): cost index files as an import role, cost-index triggers with the import-cost currency buffer, and the
// Margin Drain agents' settings, run log and inbox. All local; nothing here is sent anywhere.
export const V18_SQL = `CREATE TEMP TABLE md_v17_kinds AS SELECT * FROM source_kinds;
DROP TABLE source_kinds;
CREATE TABLE source_kinds(source_id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL CHECK(kind IN ('ar_aging','rebate_agreement','purchases','cost_index')));
INSERT INTO source_kinds SELECT * FROM md_v17_kinds; DROP TABLE md_v17_kinds;
CREATE TABLE cost_index_points(source_id VARCHAR NOT NULL,index_name VARCHAR NOT NULL,period_date DATE NOT NULL,index_value DECIMAL(18,4) NOT NULL CHECK(index_value>0),source_row BIGINT NOT NULL,PRIMARY KEY(index_name,period_date));
CREATE TABLE cost_index_triggers(id VARCHAR PRIMARY KEY,name VARCHAR NOT NULL,index_name VARCHAR NOT NULL,scope VARCHAR NOT NULL CHECK(scope IN ('category','product')),scope_value VARCHAR NOT NULL,base_date DATE NOT NULL,threshold_bp INTEGER NOT NULL CHECK(threshold_bp BETWEEN 1 AND 100000),pass_through_bp INTEGER NOT NULL CHECK(pass_through_bp BETWEEN 0 AND 10000),fx_currency VARCHAR,fx_base DECIMAL(18,6),fx_now DECIMAL(18,6),fx_buffer_bp INTEGER,created_by VARCHAR NOT NULL,created_at VARCHAR NOT NULL,
 CHECK((fx_currency IS NULL AND fx_base IS NULL AND fx_now IS NULL AND fx_buffer_bp IS NULL) OR (fx_currency IS NOT NULL AND fx_base>0 AND fx_now>0 AND fx_buffer_bp BETWEEN 0 AND 10000)));
CREATE TABLE agent_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL,interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 15 AND 1440),leak_threshold_cents BIGINT NOT NULL CHECK(leak_threshold_cents>=0),health_threshold_bp INTEGER NOT NULL CHECK(health_threshold_bp BETWEEN 1 AND 10000),expiry_days INTEGER NOT NULL CHECK(expiry_days IN (30,60,90)),cost_rise_bp INTEGER NOT NULL CHECK(cost_rise_bp BETWEEN 1 AND 100000),updated_at VARCHAR NOT NULL);
CREATE TABLE agent_runs(id VARCHAR PRIMARY KEY,started_at VARCHAR NOT NULL,finished_at VARCHAR NOT NULL,reason VARCHAR NOT NULL CHECK(reason IN ('schedule','open','manual')),findings BIGINT NOT NULL CHECK(findings>=0),new_findings BIGINT NOT NULL CHECK(new_findings>=0),resolved BIGINT NOT NULL CHECK(resolved>=0));
CREATE TABLE agent_inbox(key VARCHAR PRIMARY KEY,rule VARCHAR NOT NULL CHECK(rule IN ('leak','below_floor','contract_expiry','cost_rise','customer_health','index_trigger')),subject VARCHAR NOT NULL,detail VARCHAR NOT NULL,amount_cents BIGINT,first_seen VARCHAR NOT NULL,last_seen VARCHAR NOT NULL,status VARCHAR NOT NULL CHECK(status IN ('new','read','dismissed','resolved')));`;
// 8B-2: stock on hand (Import Studio role inventory), dead-stock carrying-cost settings, and clearance drafts in the
// normal changeset tables. source_kinds and price_changesets are rebuilt to widen their CHECKs; rows are kept.
export const V19_SQL = `CREATE TEMP TABLE md_v18_kinds AS SELECT * FROM source_kinds;
DROP TABLE source_kinds;
CREATE TABLE source_kinds(source_id VARCHAR PRIMARY KEY,kind VARCHAR NOT NULL CHECK(kind IN ('ar_aging','rebate_agreement','purchases','cost_index','inventory')));
INSERT INTO source_kinds SELECT * FROM md_v18_kinds; DROP TABLE md_v18_kinds;
CREATE TEMP TABLE md_v18_changesets AS SELECT * FROM price_changesets;
DROP TABLE price_changesets;
CREATE TABLE price_changesets(run_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL CHECK(kind IN ('planner','rollback','clearance')), source_version VARCHAR, segment_type VARCHAR NOT NULL CHECK(segment_type IN ('tier','category','customer','version','clearance')), segment_value VARCHAR NOT NULL, increase_bp INTEGER, created_by VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
INSERT INTO price_changesets SELECT * FROM md_v18_changesets; DROP TABLE md_v18_changesets;
CREATE TABLE inventory_levels(source_id VARCHAR NOT NULL,product_id VARCHAR NOT NULL,location VARCHAR NOT NULL DEFAULT '',on_hand DECIMAL(18,4) NOT NULL CHECK(on_hand>=0),source_row BIGINT NOT NULL,PRIMARY KEY(product_id,location));
CREATE TABLE dead_stock_settings(id INTEGER PRIMARY KEY CHECK(id=1),idle_days INTEGER NOT NULL CHECK(idle_days BETWEEN 90 AND 730),capital_rate_bp INTEGER NOT NULL CHECK(capital_rate_bp BETWEEN 0 AND 10000),storage_cents BIGINT NOT NULL CHECK(storage_cents>=0),horizon_months INTEGER NOT NULL CHECK(horizon_months BETWEEN 1 AND 36),updated_at VARCHAR NOT NULL);`;
const STEPS = [V1_SQL, V2_SQL, V3_SQL, V4_SQL, V5_SQL, V6_SQL, V7_SQL, V8_SQL, V9_SQL, V10_SQL, V11_SQL, V12_SQL, V13_SQL,V14_SQL,V15_SQL,V16_SQL,V17_SQL,V18_SQL,V19_SQL];
function checkVersion(version: number) {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) throw new Error(msg("vault.schema.unsupportedVaultSchemaVersion"));
}
/** Full schema DDL as it existed at `version`, in migration order. */
export function schemaSql(version: number) { checkVersion(version); return STEPS.slice(0, version).join("\n"); }
/** Forward-only migration SQL from `version` to SCHEMA_VERSION. */
export function upgradeSql(version: number) { checkVersion(version); return STEPS.slice(version).join("\n"); }
