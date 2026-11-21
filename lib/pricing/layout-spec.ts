// Roadmap 15.6: the parts of a custom export layout the page needs too (fields, options, date formatting), kept apart
// from the worker-side file builder so the page bundle does not carry the spreadsheet library.
export const LAYOUT_FIELDS = ["product_id", "tier", "price", "effective_from", "valid_to", "customer_id", "category", "qty_break", "currency", "constant"] as const;
export type LayoutField = typeof LAYOUT_FIELDS[number];
export const DELIMITERS = [",", ";", "\t", "|"] as const;
export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "DD.MM.YYYY", "YYYYMMDD"] as const;
export type LayoutColumn = { header: string; field: LayoutField; value?: string };
export type LayoutSpec = { name: string; columns: LayoutColumn[]; delimiter: typeof DELIMITERS[number]; decimal: "dot" | "comma"; date: typeof DATE_FORMATS[number]; header: boolean };
export type Layout = LayoutSpec & { id: string; updatedBy: string; updatedAt: string };
const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
export function formatDate(iso: string, f: LayoutSpec["date"]) {
  const m = DATE_PARTS.exec(iso); if (!m) return iso;
  const [, y, mo, d] = m;
  return f === "MM/DD/YYYY" ? `${mo}/${d}/${y}` : f === "DD/MM/YYYY" ? `${d}/${mo}/${y}` : f === "DD.MM.YYYY" ? `${d}.${mo}.${y}` : f === "YYYYMMDD" ? `${y}${mo}${d}` : iso;
}
