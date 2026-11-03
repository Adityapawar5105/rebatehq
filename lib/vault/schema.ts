export const SCHEMA_VERSION = 2;
export const TABLES = ["vault_meta", "products", "customers", "price_matrix", "price_guardrails", "source_files", "import_batches", "sales_lines", "vendor_costs", "cost_basis_settings", "rules", "rule_runs", "price_versions", "roi_ledger", "audit_log", "import_issues", "converter_recipes"] as const;
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
export function upgradeSql(version: number) {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) throw new Error("Unsupported vault schema version; update the app before opening this vault.");
  return version === 1 ? V2_SQL : "";
}
