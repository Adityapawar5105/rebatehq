// Resilient parser: turn messy export values into canonical text before exact SQL
// validation. Anything that cannot be cleaned unambiguously is returned unchanged,
// so the import rejects it with a location instead of guessing. Pure functions.
import { isoDate, type DateFormat } from "./formats";
export type CleanNote = "symbols" | "grouping" | "placeholder" | "negative" | "time" | "short_year" | "month_name" | "id_decimal" | "apostrophe" | "spaces";
export const NOTE_TEXT: Record<CleanNote, string> = {
  symbols: "removed currency symbols or codes", grouping: "removed thousands separators", placeholder: "treated placeholders (TBD, CALL, N/A, -) as empty",
  negative: "read parentheses or a trailing minus as negative", time: "dropped the time of day", short_year: "expanded two-digit years",
  month_name: "read month names", id_decimal: "removed a spreadsheet .0 from IDs", apostrophe: "removed a leading text apostrophe", spaces: "collapsed repeated spaces",
};
const PLACEHOLDER = /^(tbd|tba|call|call for price|n\/?a|na|null|none|nil|pending|see note|\?+|-+|–|—|#n\/a|#value!|#ref!)$/i;
const CURRENCY = /^(usd|cad|aud|eur|gbp|inr|mxn)\s*|\s*(usd|cad|aud|eur|gbp|inr|mxn)$|[$£€¥₹]/gi;
type Out = { value: string; notes: CleanNote[] };
/** Numbers become a plain canonical decimal ("-1234.5"); signs survive so negatives can be reported. */
export function cleanNumber(raw: string, decimal: "dot" | "comma"): Out {
  const notes: CleanNote[] = [];
  let v = raw.replace(/[  ]/g, " ").trim();
  if (!v) return { value: "", notes };
  if (PLACEHOLDER.test(v)) return { value: "", notes: ["placeholder"] };
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1).trim(); notes.push("negative"); }
  if (/-$/.test(v) && !/^-/.test(v)) { negative = true; v = v.slice(0, -1).trim(); notes.push("negative"); }
  const stripped = v.replace(CURRENCY, "").trim();
  if (stripped !== v) { notes.push("symbols"); v = stripped; }
  if (v.startsWith("-")) { negative = !negative; v = v.slice(1).trim(); }
  else if (v.startsWith("+")) v = v.slice(1).trim();
  const group = decimal === "dot" ? /^\d{1,3}([, '’]\d{3})+(\.\d+)?$/ : /^\d{1,3}([. '’]\d{3})+(,\d+)?$/;
  if (group.test(v)) { v = v.replace(decimal === "dot" ? /[, '’]/g : /[. '’]/g, ""); notes.push("grouping"); }
  if (decimal === "comma") v = v.replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return { value: raw.trim(), notes: [] }; // unchanged: the import reports it
  const int = m[1].replace(/^0+(?=\d)/, ""), frac = m[2] ?? "";
  const zero = /^0+$/.test(int + frac);
  return { value: (negative && !zero ? "-" : "") + int + (frac ? "." + frac : ""), notes };
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const month = (s: string) => { const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase()); return i < 0 ? 0 : i + 1; };
const pad = (x: number) => String(x).padStart(2, "0");
/** Dates become ISO when they parse unambiguously in the chosen format (time dropped, 2-digit years expanded). */
export function cleanDate(raw: string, format: DateFormat): Out {
  const notes: CleanNote[] = [];
  let v = raw.trim();
  if (!v) return { value: "", notes };
  if (PLACEHOLDER.test(v)) return { value: "", notes: ["placeholder"] };
  const timeless = v.replace(/[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, "");
  if (timeless !== v) { notes.push("time"); v = timeless.trim(); }
  let m = /^(\d{1,2})[ -]([a-z]{3,9})\.?[ ,-]+(\d{2}|\d{4})$/i.exec(v) || null;
  if (m && month(m[2])) { notes.push("month_name"); return { value: iso(Number(year(m[3], notes)), month(m[2]), Number(m[1]), v), notes }; }
  m = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(v);
  if (m && month(m[1])) { notes.push("month_name"); return { value: iso(Number(m[3]), month(m[1]), Number(m[2]), v), notes }; }
  const short = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2})$/.exec(v);
  if (short && format !== "YYYY-MM-DD") { v = `${short[1]}${short[2]}${short[3]}${short[2]}${year(short[4], notes)}`; }
  const out = isoDate(v, format);
  return out ? { value: out, notes } : { value: raw.trim(), notes: [] };
}
function year(y: string, notes: CleanNote[]) { if (y.length === 4) return y; notes.push("short_year"); const n = Number(y); return String(n < 70 ? 2000 + n : 1900 + n); }
function iso(y: number, mo: number, d: number, fallback: string) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && y <= 2100 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : fallback;
}
/** IDs: trim, drop Excel's leading apostrophe and a float ".0" on numeric IDs, collapse spaces. */
export function cleanId(raw: string): Out {
  const notes: CleanNote[] = [];
  let v = raw.trim();
  if (PLACEHOLDER.test(v)) return { value: "", notes: ["placeholder"] };
  if (v.startsWith("'")) { v = v.slice(1).trim(); notes.push("apostrophe"); }
  if (/^\d+\.0+$/.test(v)) { v = v.replace(/\.0+$/, ""); notes.push("id_decimal"); }
  if (/\s{2,}/.test(v)) { v = v.replace(/\s{2,}/g, " "); notes.push("spaces"); }
  return { value: v, notes };
}
/** Exact unit x quantity in cents, rounded half away from zero. null when either is not a canonical number. */
export function lineTotal(unit: string, qty: string) {
  const parse = (s: string) => { const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(s); if (!m) return null; return { neg: m[1] === "-", n: BigInt(m[2] + (m[3] ?? "").padEnd(6, "0")) }; };
  const u = parse(unit), q = parse(qty);
  if (!u || !q) return null;
  const product = u.n * q.n, scale = BigInt(10) ** BigInt(10); // 1e6 * 1e6 -> cents needs /1e10
  const cents = (product + scale / BigInt(2)) / scale, neg = u.neg !== q.neg && cents !== BigInt(0);
  return (neg ? "-" : "") + (cents / BigInt(100)).toString() + "." + (cents % BigInt(100)).toString().padStart(2, "0");
}
