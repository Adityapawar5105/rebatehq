// Deterministic synthetic Import Studio fixtures, generated in memory for unit and
// browser tests (no binary fixtures are committed). All data is invented.
import * as XLSX from "xlsx";
export const SALES_HEADER = ["line_id", "product_id", "customer_id", "sale_date", "quantity", "list_amount", "discount_amount", "freight_amount", "rebate_amount", "cost_amount"];
export type Fixture = { name: string; bytes: Uint8Array };
const enc = new TextEncoder();
const pad = (n: number) => String(n).padStart(2, "0");
/** Ten-ish columns of sales: products P-1..P-7, customers C-1..C-3. */
export function salesRows(firstId: number, count: number, month: string, marker = "") {
  return Array.from({ length: count }, (_, i) => [String(firstId + i), marker || `P-${(i % 7) + 1}`, `C-${(i % 3) + 1}`, `${month}-${pad((i % 27) + 1)}`, "2", "125.50", "5.00", "2.25", "0.00", "80.10"]);
}
export function csv(rows: string[][], delimiter = ",", newline = "\n") {
  const cell = (v: string) => /["\n\r]/.test(v) || v.includes(delimiter) ? `"${v.replaceAll('"', '""')}"` : v;
  return rows.map(r => r.map(cell).join(delimiter)).join(newline) + newline;
}
export function monthlyCsvs(): Fixture[] {
  return Array.from({ length: 12 }, (_, m) => ({ name: `sales-2025-${pad(m + 1)}.csv`, bytes: enc.encode(csv([SALES_HEADER, ...salesRows(1000 * (m + 1), 10, `2025-${pad(m + 1)}`)])) }));
}
const serial = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
function book(sheets: Array<[string, XLSX.WorkSheet]>) { const wb = XLSX.utils.book_new(); for (const [n, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, n); return wb; }
const write = (wb: XLSX.WorkBook, bookType: XLSX.BookType) => new Uint8Array(XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer);
/** Q1 2026 sales as a messy ERP report: title (merged), blank row, header, data, formula total, footer. */
export function salesXlsx(bookType: XLSX.BookType = "xlsx", marker = "", firstId = 50001): Fixture {
  const rows = salesRows(firstId, 10, "2026-02", marker);
  const ws = XLSX.utils.aoa_to_sheet([["Sales export - Q1 2026"], [], SALES_HEADER]);
  rows.forEach((r, i) => {
    const at = i + 3;
    XLSX.utils.sheet_add_aoa(ws, [[Number(r[0]), r[1], r[2], null, 2, 125.5, 5, 2.25, 0, 80.1]], { origin: { r: at, c: 0 } });
    ws[XLSX.utils.encode_cell({ r: at, c: 3 })] = { t: "n", v: serial(r[3]), z: "yyyy-mm-dd" };
  });
  XLSX.utils.sheet_add_aoa(ws, [["Total", null, null, null, null, null]], { origin: { r: 13, c: 0 } });
  ws["F14"] = { t: "n", f: "SUM(F4:F13)", v: 1255 };
  XLSX.utils.sheet_add_aoa(ws, [["Printed 2026-04-01, page 1 of 1"]], { origin: { r: 14, c: 0 } });
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
  ws["!ref"] = "A1:J15";
  return { name: `sales-2026-q1.${bookType}`, bytes: write(book([["Q1 2026", ws], ["Notes", XLSX.utils.aoa_to_sheet([["Exported by a synthetic ERP"]])]]), bookType) };
}
/** One logical table as three messy files: BOM+semicolon+comma decimals+DD.MM.YYYY, TSV, XLSX. */
export function conversionTrio(): { semicolon: Fixture; tsv: Fixture; xlsx: Fixture } {
  const rows = salesRows(70001, 4, "2026-03");
  const dmy = (iso: string) => iso.split("-").reverse().join(".");
  const semicolon = csv([SALES_HEADER, ...rows.map(r => r.map((v, i) => i === 3 ? dmy(v) : i >= 5 ? v.replace(".", ",") : v))], ";", "\r\n");
  const ws = XLSX.utils.aoa_to_sheet([SALES_HEADER, ...rows.map(r => [Number(r[0]), r[1], r[2], null, 2, 125.5, 5, 2.25, 0, 80.1])]);
  rows.forEach((r, i) => { ws[XLSX.utils.encode_cell({ r: i + 1, c: 3 })] = { t: "n", v: serial(r[3]), z: "yyyy-mm-dd" }; });
  return {
    semicolon: { name: "messy-semicolon.csv", bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode(semicolon)]) },
    tsv: { name: "messy.tsv", bytes: enc.encode(csv([SALES_HEADER, ...rows], "\t")) },
    xlsx: { name: "messy.xlsx", bytes: write(book([["Sheet1", ws]]), "xlsx") },
  };
}
export const ITEM_HEADER = ["product_id", "description", "category", "uom", "current_cost", "list_price"];
export function itemMasterXls(): Fixture {
  const rows = [["P-1", "Brass gate valve 1in", "Valves", "EA", 61.2, 125.5], ["P-2", "PVC elbow 2in", "Fittings", "EA", 1.1, 2.75], ["P-99", "Steel pipe 10ft", "Pipe", "FT", 3.4, 6.9]];
  return { name: "item-master.xls", bytes: write(book([["Items", XLSX.utils.aoa_to_sheet([ITEM_HEADER, ...rows])]]), "biff8") };
}
export function customersOds(): Fixture {
  const rows = [["C-1", "Harbor Mechanical", "Gold", "North", "East", "Net 30"], ["C-2", "Ridge Plumbing", "Silver", "South", "East", "Net 45"]];
  return { name: "customers.ods", bytes: write(book([["Customers", XLSX.utils.aoa_to_sheet([["customer_id", "name", "tier", "branch", "region", "payment_terms"], ...rows])]]), "ods") };
}
export function vendorXlsb(): Fixture {
  const ws = XLSX.utils.aoa_to_sheet([["vendor", "product_id", "cost", "effective_date"], ["Acme Valve", "P-1", 60.75, null], ["Acme Valve", "P-2", 1.05, null]]);
  ws["D2"] = { t: "n", v: serial("2026-03-01"), z: "yyyy-mm-dd" }; ws["D3"] = { t: "n", v: serial("2026-03-01"), z: "yyyy-mm-dd" };
  return { name: "vendor-costs.xlsb", bytes: write(book([["Costs", ws]]), "xlsb") };
}
export function priceJson(marker = "Valves"): Fixture {
  return { name: "price-list.json", bytes: enc.encode(JSON.stringify({ exported: "2026-03-01", prices: [
    { product_id: "P-1", tier: "Gold", price: "119.90", valid_from: "2026-03-01", terms: { qty_break: "10" } },
    { category: marker, tier: "Silver", price: "122.00", valid_from: "2026-03-01", valid_to: "2026-12-31" },
  ] }, null, 2)) };
}
export function rebateXml(): Fixture {
  return { name: "rebates.xml", bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<rebates><program program_id="R-1"><party>Acme Valve</party><rate_percent>2.5</rate_percent><threshold_amount>50000.00</threshold_amount><period_start>2026-01-01</period_start><period_end>2026-12-31</period_end></program>
<program program_id="R-2"><party>Delta Fittings</party><rate_percent>1.5</rate_percent><period_start>2026-01-01</period_start><period_end>2026-06-30</period_end></program></rebates>`) };
}
/** Sales history as XML/JSON/TSV with a marker in product_id, for the privacy gate. */
export function markedSales(marker: string, firstId: number): Fixture[] {
  const rows = (n: number) => salesRows(firstId + n * 100, 2, "2025-06").map(r => { r[1] = marker; return r; });
  const obj = (r: string[]) => Object.fromEntries(SALES_HEADER.map((h, i) => [h, r[i]]));
  return [
    { name: "marked.tsv", bytes: enc.encode(csv([SALES_HEADER, ...rows(0)], "\t")) },
    { name: "marked.json", bytes: enc.encode(JSON.stringify(rows(1).map(obj))) },
    { name: "marked.xml", bytes: enc.encode(`<lines>${rows(2).map(r => `<line>${SALES_HEADER.map((h, i) => `<${h}>${r[i]}</${h}>`).join("")}</line>`).join("")}</lines>`) },
    { ...salesXlsx("xlsx", marker, firstId + 300), name: "marked.xlsx" },
  ];
}
/** Customer list in Windows-1252 (é = 0xE9) with semicolons. */
export function customers1252(): Fixture {
  const text = "customer_id;name;tier\r\nC-3;Café Supply;Bronze\r\n";
  return { name: "customers-1252.txt", bytes: Uint8Array.from([...text].map(c => c.charCodeAt(0))) };
}
export function salesUtf16(): Fixture {
  const text = csv([SALES_HEADER, ...salesRows(80001, 3, "2026-01")]);
  const bytes = new Uint8Array(2 + text.length * 2); bytes[0] = 0xff; bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[2 + i * 2] = c & 0xff; bytes[3 + i * 2] = c >> 8; }
  return { name: "sales-utf16.csv", bytes };
}
export const toFile = (f: Fixture) => new File([f.bytes as Uint8Array<ArrayBuffer>], f.name);
/**
 * A small export shaped like the real UCI "Online Retail" file tested in chunk 4C-2:
 * no line IDs or totals, unit prices, M/D/YY H:MM dates, blank customers, cancellations
 * (negative quantities, "C" invoices), exact duplicate rows and a mixed-case SKU.
 */
export const RETAIL_HEADER = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice", "CustomerID", "Country"];
export function retailLike(marker = "", count = 20): Fixture {
  const rows: string[][] = [RETAIL_HEADER];
  for (let i = 0; i < count; i++) {
    const inv = String(536365 + Math.floor(i / 4)), stock = marker && i === 0 ? marker : ["85123A", "71053", "84406B", "22752"][i % 4];
    rows.push([inv, stock, `ITEM ${i % 4}`, String(1 + (i % 6)), `12/${1 + (i % 9)}/10 8:${String(10 + i).slice(-2)}`, ["2.55", "3.39", "$1,275.00", "0.425"][i % 4], String(17850 + (i % 3)), "United Kingdom"]);
  }
  rows.push(["536370", "22752", "ITEM 2", "2", "12/1/10 9:00", "7.65", "", "United Kingdom"]);       // blank customer
  rows.push(["536371", "85123a", "item lower", "1", "12/1/10 9:01", "2.55", "", "France"]);          // blank customer, mixed-case SKU
  rows.push(["C536379", "D", "Discount", "-1", "12/1/10 9:41", "27.50", "14527", "United Kingdom"]); // cancellation
  rows.push(rows[1].slice(), rows[2].slice());                                                     // exact duplicate rows
  return { name: "online-retail-like.csv", bytes: enc.encode(csv(rows)) };
}
