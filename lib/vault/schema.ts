export const SCHEMA_VERSION = 6;
const V1_TABLES = ["vault_meta", "products", "customers", "price_matrix", "price_guardrails", "source_files", "import_batches", "sales_lines", "vendor_costs", "cost_basis_settings", "rules", "rule_runs", "price_versions", "roi_ledger", "audit_log", "import_issues", "converter_recipes"] as const;
const V4_TABLES = [...V1_TABLES, "rejected_rows"] as const;
const V5_TABLES = [...V4_TABLES, "agg_cpm", "agg_cm", "agg_p", "recon_issues"] as const;
export const TABLES = [...V5_TABLES, "pricing_settings", "rule_revisions", "rule_changes"] as const;
/** Tables that exist at a schema version (in creation order, so copy-on-write inserts parents first). */
export function tablesFor(version: number): readonly string[] { return version >= 6 ? TABLES : version >= 5 ? V5_TABLES : version >= 4 ? V4_TABLES : V1_TABLES; }
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
const STEPS = [V1_SQL, V2_SQL, V3_SQL, V4_SQL, V5_SQL, V6_SQL];
function checkVersion(version: number) {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) throw new Error("Unsupported vault schema version; update the app before opening this vault.");
}
/** Full schema DDL as it existed at `version`, in migration order. */
export function schemaSql(version: number) { checkVersion(version); return STEPS.slice(0, version).join("\n"); }
/** Forward-only migration SQL from `version` to SCHEMA_VERSION. */
export function upgradeSql(version: number) { checkVersion(version); return STEPS.slice(version).join("\n"); }
