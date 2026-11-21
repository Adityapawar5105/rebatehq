// Chunk 7F-2 fixtures shared by the unit tests, the browser worker test and the UI gate: a fixed-width print report
// with a title, repeated headers, a total and page footers, and a two-page PDF item list. Synthetic values only.
import { makePdf, tablePage } from "./pdf";
const fx = (c: string[]) => c[0].padEnd(9) + c[1].padEnd(12) + c[2].padEnd(13) + c[3].padEnd(12) + c[4].padStart(8) + "  " + c[5].padStart(11) + "  " + c[6].padStart(11);
export const PRINT_HEAD = ["line_id", "product_id", "customer_id", "sale_date", "quantity", "list_amount", "cost_amount"];
/** A print-to-file sales report: rows split over two pages, the header repeated, a total and footers. */
export function printReport(rows: string[][]) {
  const half = Math.ceil(rows.length / 2);
  return ["SALES BY ITEM REPORT                                   Page 1", "", fx(PRINT_HEAD), ...rows.slice(0, half).map(fx),
    "Printed 2026-02-01                                     Page 1", "", fx(PRINT_HEAD), ...rows.slice(half).map(fx),
    "Total" + " ".repeat(41) + "13".padStart(8) + "  " + "1550.50".padStart(11), "Printed 2026-02-01                                     Page 2"].join("\r\n") + "\r\n";
}
export const PRICE_HEAD = ["product_id", "description", "current_cost", "list_price"];
/** A two-page PDF price list: title, header on both pages, page footers. */
export function priceListPdf(rows: string[][]) {
  const xs = [50, 150, 320, 420], half = Math.ceil(rows.length / 2);
  return makePdf([
    [[50, 770, "Item price list"], ...tablePage([PRICE_HEAD, ...rows.slice(0, half)], xs), [280, 40, "Page 1 of 2"]],
    [...tablePage([PRICE_HEAD, ...rows.slice(half)], xs), [50, 40, "Printed 2026-02-01"], [480, 40, "Page 2 of 2"]],
  ]);
}
/** Roadmap 8.6: a PDF whose two pages carry no text layer at all (a scan). */
export function scannedPdf() { return makePdf([[], []]); }
