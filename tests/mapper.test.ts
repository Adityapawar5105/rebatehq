import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectProfile, detectRole, lineIdFor, mappingProblems, needsConfirmation, suggestMapping, toMapping, type MappedField } from "../lib/studio/mapper";
import { cleanDate, cleanId, cleanNumber, lineTotal } from "../lib/studio/clean";
import { detectDateFormat, normalizeHeader } from "../lib/studio/formats";
import { generatePlayground, tierDiscountBp } from "../lib/studio/playground";
import { RETAIL_HEADER, SALES_HEADER } from "./helpers/studio-fixtures";

const show = (fields: MappedField[], headers: string[]) => Object.fromEntries(fields.map(f => [f.field, f.source.kind === "column" || f.source.kind === "unit" ? `${f.source.kind}:${headers[f.source.index]}` : f.source.kind]));
test("the real Online Retail export maps as sales history (it was misread as a customer list in 4C-1)", () => {
  const role = detectRole("Online Retail.xlsx", RETAIL_HEADER);
  assert.equal(role.role, "sales_history");
  assert.ok(role.scores.sales_history > role.scores.customer_list + 0.1, JSON.stringify(role.scores));
  assert.equal(detectProfile(RETAIL_HEADER), "generic");
  const fields = suggestMapping("sales_history", RETAIL_HEADER);
  assert.deepEqual(show(fields, RETAIL_HEADER), {
    line_id: "generate", invoice_id: "column:InvoiceNo", product_id: "column:StockCode", customer_id: "column:CustomerID", sale_date: "column:InvoiceDate",
    quantity: "column:Quantity", list_amount: "unit:UnitPrice", discount_amount: "zero", freight_amount: "zero", rebate_amount: "zero", cost_amount: "none", line_type: "none",
  });
  assert.equal(mappingProblems("sales_history", toMapping(fields)).length, 0);
  assert.ok(needsConfirmation(fields), "Inferred mappings must be confirmed by the user");
  assert.ok(!needsConfirmation(suggestMapping("sales_history", SALES_HEADER)), "Canonical headers need no confirmation");
});
test("ERP profiles are detected only from ERP-specific header names", () => {
  const bc = ["Document No.", "Line No.", "No.", "Sell-to Customer No.", "Posting Date", "Quantity", "Unit Price", "Line Discount Amount", "Unit Cost (LCY)"];
  assert.equal(detectProfile(bc), "bc");
  const m = show(suggestMapping("sales_history", bc, "bc"), bc);
  assert.equal(m.product_id, "column:No."); assert.equal(m.customer_id, "column:Sell-to Customer No."); assert.equal(m.list_amount, "unit:Unit Price");
  assert.equal(m.discount_amount, "column:Line Discount Amount"); assert.equal(m.cost_amount, "unit:Unit Cost (LCY)");
  const gen = suggestMapping("sales_history", bc, "bc").find(f => f.field === "line_id")!;
  assert.deepEqual(gen.source, { kind: "generate", lineNo: 1 }, "BC line IDs come from Document No. + Line No.");
  assert.equal(detectProfile(["Document Number", "Date", "Name", "Item", "Quantity", "Item Rate", "Amount", "Est. Extended Cost", "Est. Unit Cost"]), "netsuite");
  assert.equal(detectProfile(["orderno", "lineno", "shipprod", "custno", "qtyship", "price", "netamt", "prodcost", "invoicedt"]), "infor");
  assert.equal(detectProfile(["Invoice No", "Line No", "Item ID", "Customer ID", "Qty Shipped", "Unit Price", "Extended Price", "Extended Cost", "Invoice Line UID"]), "p21");
  const p21 = ["Invoice No", "Line No", "Item ID", "Customer ID", "Qty Shipped", "Unit Price", "Extended Price", "Extended Cost", "Invoice Line UID", "Invoice Date"];
  const pm = show(suggestMapping("sales_history", p21, "p21"), p21);
  assert.equal(pm.line_id, "column:Invoice Line UID"); assert.equal(pm.list_amount, "column:Extended Price"); assert.equal(pm.cost_amount, "column:Extended Cost");
});
test("mapping problems name what is missing", () => {
  const m = toMapping(suggestMapping("sales_history", ["StockCode", "CustomerID", "InvoiceDate", "UnitPrice"]));
  const p = mappingProblems("sales_history", m);
  assert.ok(p.includes("line_id") && p.includes("quantity (needed for unit x quantity)"), p.join());
  assert.ok(mappingProblems("price_list", toMapping(suggestMapping("price_list", ["price", "valid_from"]))).includes("product_id or category"));
});
test("resilient number cleaning: symbols, grouping, negatives and placeholders", () => {
  const c = (v: string, d: "dot" | "comma" = "dot") => cleanNumber(v, d);
  assert.deepEqual(c("$1,234.50"), { value: "1234.50", notes: ["symbols", "grouping"] });
  assert.equal(c("(12.00)").value, "-12.00"); assert.equal(c("12.50-").value, "-12.50");
  assert.equal(c("1.234,50", "comma").value, "1234.50"); assert.equal(c("12,5", "comma").value, "12.5");
  assert.equal(c("USD 5").value, "5"); assert.equal(c("€ 3,00", "comma").value, "3.00");
  for (const p of ["TBD", "CALL", "N/A", "-", "—", "#N/A"]) assert.deepEqual(c(p), { value: "", notes: ["placeholder"] }, p);
  assert.equal(c("1,5").value, "1,5", "Ambiguous values stay unchanged so the import rejects them");
  assert.equal(c("12 apples").value, "12 apples");
  assert.equal(c("-0.00").value, "0.00");
});
test("resilient date and ID cleaning", () => {
  assert.deepEqual(cleanDate("12/1/10 8:26", "MM/DD/YYYY"), { value: "2010-12-01", notes: ["time", "short_year"] });
  assert.equal(cleanDate("01-Dec-2010", "YYYY-MM-DD").value, "2010-12-01");
  assert.equal(cleanDate("Dec 1, 2010", "MM/DD/YYYY").value, "2010-12-01");
  assert.equal(cleanDate("2010-12-01T08:26:00Z", "YYYY-MM-DD").value, "2010-12-01");
  assert.equal(cleanDate("31/02/2026", "DD/MM/YYYY").value, "31/02/2026", "Impossible dates stay unchanged and are rejected");
  assert.deepEqual(detectDateFormat([["12/1/10 8:26", "12/13/10 9:00"]]), { format: "MM/DD/YYYY", ambiguous: false });
  assert.equal(cleanId("17850.0").value, "17850"); assert.equal(cleanId("'00123").value, "00123"); assert.equal(cleanId("CALL").value, "");
});
test("unit x quantity is exact to the cent, rounded half away from zero", () => {
  assert.equal(lineTotal("2.55", "6"), "15.30"); assert.equal(lineTotal("0.425", "3"), "1.28"); assert.equal(lineTotal("1.005", "1"), "1.01");
  assert.equal(lineTotal("2.55", "-6"), "-15.30"); assert.equal(lineTotal("1275.00", "1"), "1275.00"); assert.equal(lineTotal("x", "1"), null);
  assert.equal(lineTotal("0.0001", "1"), "0.00");
});
test("generated line IDs are deterministic, distinct and within 53 bits", () => {
  assert.equal(lineIdFor("536365\u0001#1"), lineIdFor("536365\u0001#1"));
  const ids = new Set(Array.from({ length: 100000 }, (_, i) => lineIdFor(`${536365 + (i >> 3)}\u0001#${(i & 7) + 1}`)));
  assert.equal(ids.size, 100000);
  for (const id of [...ids].slice(0, 1000)) assert.ok(Number.isSafeInteger(Number(id)) && Number(id) > 0 && /^[1-9]\d{0,17}$/.test(id));
});
test("Playground is deterministic and its planted-leak manifest is committed", () => {
  const a = generatePlayground(), b = generatePlayground();
  assert.deepEqual(a.manifest, b.manifest);
  assert.equal(a.files[4].text, b.files[4].text);
  assert.deepEqual(a.manifest, JSON.parse(readFileSync("tests/fixtures/playground-manifest.json", "utf8")));
  assert.equal(a.files[4].text.trim().split("\n").length - 1, 120000);
  assert.equal(a.files[0].text.trim().split("\n").length - 1, 5000);
  assert.equal(a.manifest.leaks.length, 5);
  for (const l of a.manifest.leaks) assert.ok(l.lines > 0 && BigInt(l.cents) > BigInt(0), l.id);
  assert.equal(tierDiscountBp(1), 3000); assert.equal(tierDiscountBp(50), 550);
  for (const f of a.files) assert.ok(f.name.startsWith("Playground - "));
  assert.ok(normalizeHeader(a.files[4].text.split("\n")[0].split(",")[1]) === "invoiceid");
});
