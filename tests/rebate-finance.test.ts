// Roadmap 15.3: payments against supplier claims and the accrual export for finance, in real DuckDB.
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { duckdbConnection, rows } from "./helpers/duckdb-node";
import { schemaSql, TABLES, SCHEMA_VERSION } from "../lib/vault/schema";
import type { Engine } from "../lib/vault/engine";
import * as finance from "../lib/rebate/finance";
import * as rebates from "../lib/rebate/store";

async function fixture() {
  const c = await duckdbConnection(); c.query("DROP VIEW IF EXISTS rebate_sales"); for (const t of [...TABLES].reverse()) c.query("DROP TABLE IF EXISTS " + t);
  c.query(schemaSql(SCHEMA_VERSION)); c.query(`INSERT INTO vault_meta(id,schema_version,tier,scope,audit_tip,currency) VALUES(1,${SCHEMA_VERSION},'professional','test','tip','CAD')`);
  return { c, e: { conn: { query: async (s: string) => c.query(s) } } as unknown as Engine };
}
const claim = (id: string, status: string, claimed: number | null, due = "2026-10-31") => `INSERT INTO supplier_claims VALUES('${id}','REF-${id}','North Supply','Q3','rebate',DATE '2026-07-01',DATE '2026-09-30',DATE '${due}','retroactive','[{"from":"0","to":null,"rate":"2"}]','','',NULL,'','${status}',${claimed ?? "NULL"},NULL,'actor','2026-10-01','2026-10-01')`;
const pay = (claimId: string, amount: string, extra: Partial<finance.PaymentInput> = {}): finance.PaymentInput => ({ claim: claimId, received: "2026-11-10", amount, reference: "REM-1", method: "transfer", ...extra });
const TODAY = "2026-11-22";

test("15.3 partial and full payments, the open balance, days past due, and a paid claim", async () => {
  const { c, e } = await fixture();
  try {
    c.query(claim("a", "submitted", 100000));
    let b = await finance.balance(e, "a", TODAY);
    assert.deepEqual([b.claimed, b.paid, b.outstanding, b.daysPastDue], ["100000", "0", "100000", 22]);
    let p = await finance.paymentSql(e, pay("a", "400.00"), "acct", "2026-11-22T10:00:00Z", TODAY); c.query(p.sql); assert.equal(p.full, false);
    b = await finance.balance(e, "a", TODAY); assert.deepEqual([b.paid, b.outstanding], ["40000", "60000"]);
    await assert.rejects(finance.paymentSql(e, pay("a", "600.01"), "acct", "x", TODAY), /more than the open balance of 600\.00/);
    await assert.rejects(finance.paymentSql(e, pay("a", "0"), "acct", "x", TODAY), /Check the payment/);
    await assert.rejects(finance.paymentSql(e, pay("a", "10", { received: "2026-11-23" }), "acct", "x", TODAY), /Check the payment/, "a future date");
    await assert.rejects(finance.paymentSql(e, pay("a", "10", { method: "cash" as never }), "acct", "x", TODAY), /Check the payment/);
    await assert.rejects(finance.paymentSql(e, pay("a", "10", { reference: " " }), "acct", "x", TODAY), /Check the payment/);
    p = await finance.paymentSql(e, pay("a", "600.00", { method: "credit_memo", reference: "CM-9" }), "acct", "2026-11-22T11:00:00Z", TODAY); c.query(p.sql); assert.equal(p.full, true);
    assert.equal(rows(c, "SELECT status FROM supplier_claims WHERE id='a'")[0].status, "paid", "fully paid claims are marked paid");
    b = await finance.balance(e, "a", TODAY); assert.deepEqual([b.paid, b.outstanding, b.shortPaid, b.daysPastDue], ["100000", "0", "0", null]);
    await assert.rejects(finance.paymentSql(e, pay("a", "1"), "acct", "x", TODAY), /submitted or approved/);
    // A voided payment stays on record; the claim it no longer covers goes back to approved.
    const v = await finance.voidSql(e, b.payments[1].id, "acct", "2026-11-22T12:00:00Z", TODAY); c.query(v.sql);
    b = await finance.balance(e, "a", TODAY);
    assert.equal(rows(c, "SELECT status FROM supplier_claims WHERE id='a'")[0].status, "approved");
    assert.deepEqual([b.paid, b.outstanding, b.payments.length, b.payments[1].voided], ["40000", "60000", 2, true]);
    await assert.rejects(finance.voidSql(e, b.payments[1].id, "acct", "x", TODAY), /Check the payment/, "voiding twice");
    // Closing as paid with less received shows the short payment.
    c.query("UPDATE supplier_claims SET status='paid' WHERE id='a'"); b = await finance.balance(e, "a", TODAY); assert.equal(b.shortPaid, "60000");
    c.query(claim("d", "draft", null)); await assert.rejects(finance.paymentSql(e, pay("d", "1"), "acct", "x", TODAY), /submitted or approved/);
  } finally { c.close(); }
});

test("15.3 finance export: customer accruals by programme and month, then supplier claims owed; exact and formula-safe", async () => {
  const { c, e } = await fixture();
  try {
    c.query(`INSERT INTO customers(customer_id) VALUES('=C1');INSERT INTO products(product_id) VALUES('A');INSERT INTO source_files VALUES('s','sales.csv','sales_history',1,'2026-11-01');
INSERT INTO sales_lines(source_id,line_id,product_id,customer_id,sale_date,quantity,list_cents,discount_cents,freight_cents,rebate_cents,cost_cents,source_row,invoice_id) VALUES
('s',1,'A','=C1','2026-09-10',1,100000,0,0,500,50000,2,'I1'),('s',2,'A','=C1','2026-10-05',1,50000,0,0,0,25000,3,'I2')`);
    const p = await rebates.saveSql(e, { reference: "NORTH-2026", customer: "=C1", mode: "retroactive", treatment: "replace", from: "2026-01-01", to: "2026-12-31", eligible: "", excluded: "", enabled: true, tiers: [{ from: "0", to: "", rate: "2" }] }, "actor");
    c.query(p.sql); await rebates.rebuildAccruals(e);
    c.query(claim("a", "approved", 100000, "2026-11-01")); c.query(claim("x", "draft", null));
    c.query((await finance.paymentSql(e, pay("a", "250.00"), "acct", "t", TODAY)).sql);
    const data = await finance.financeRows(e, TODAY, "2026-11-22T00:00:00Z");
    assert.deepEqual(data.map(r => [r.record_type, r.period, r.accrued ?? "", r.booked ?? "", r.adjustment ?? "", r.liability ?? "", r.outstanding ?? "", r.days_past_due ?? ""]), [
      ["customer_accrual", "2026-09", "20.00", "5.00", "15.00", "20.00", "", ""],
      ["customer_accrual", "2026-10", "10.00", "0.00", "10.00", "10.00", "", ""],
      ["supplier_claim", "2026-09", "", "", "", "", "750.00", "21"],
    ], "replace mode books the difference; drafts are left out");
    const bytes = new Uint8Array(await finance.financeFile(data, "csv", TODAY).blob.arrayBuffer()), csv = new TextDecoder().decode(bytes);
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 byte-order mark for Excel");
    assert.ok(csv.startsWith('"record_type","period","reference","counterparty"'), csv.slice(0, 60));
    assert.ok(csv.includes(`"'=C1"`), "a cell starting with = is neutralised");
    const wb = XLSX.read(new Uint8Array(await finance.financeFile(data, "xlsx", TODAY).blob.arrayBuffer()));
    assert.equal(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Rebates, { header: 1 }).length, 4);
  } finally { c.close(); }
});
