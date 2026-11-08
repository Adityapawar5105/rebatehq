// Message-key i18n core (chunk 7U). Pure: used by the UI, the server pages and the vault
// worker. Every user-facing string lives in lib/i18n/locales/*.ts under a stable key.
// Messages use {name} placeholders; a message can instead be a plural object chosen by
// Intl.PluralRules on params.count. Numbers passed as params are formatted with Intl.
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { frCA } from "./locales/fr-CA";

export type Plural = { one?: string; few?: string; many?: string; other: string };
export type Message = string | Plural;
export type MessageKey = keyof typeof en;
/** Every shipped language must translate every key (checked by tsc and tests/i18n.test.ts). */
export type Catalog = { [K in MessageKey]: Message };
export type Param = string | number | bigint | null | undefined;
export type Params = Record<string, Param>;

export const LOCALES = ["en", "es", "fr", "fr-CA"] as const;
export type Shipped = typeof LOCALES[number];
/** "pseudo" is a test locale: accented, padded and bracketed English that shows untranslated or truncated text. */
export type Locale = Shipped | "pseudo";
export const DEFAULT_LOCALE: Locale = "en";
/** The Intl tag used for numbers and dates in each language. */
export const INTL_TAG: Record<Locale, string> = { en: "en-US", es: "es-US", fr: "fr-FR", "fr-CA": "fr-CA", pseudo: "en-US" };
/** Language names are shown in their own language, so they are not message keys. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", es: "Español", fr: "Français", "fr-CA": "Français (Canada)", pseudo: "Pseudo (test)" };
export const HTML_LANG: Record<Locale, string> = { en: "en", es: "es", fr: "fr", "fr-CA": "fr-CA", pseudo: "en-XA" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (value === "pseudo" || (LOCALES as readonly string[]).includes(value));
}

// ---------------------------------------------------------------- pseudo-locale
const ACCENT: Record<string, string> = { a: "à", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", n: "ñ", o: "ö", p: "þ", r: "ŕ", s: "š", t: "ţ", u: "û", w: "ŵ", y: "ý", z: "ž", A: "Å", C: "Ç", D: "Ð", E: "É", G: "Ĝ", I: "Î", L: "Ļ", N: "Ñ", O: "Ö", S: "Š", T: "Ţ", U: "Û", Y: "Ý", Z: "Ž" };
export const PSEUDO_OPEN = "⟦", PSEUDO_CLOSE = "⟧";
/** Accents every letter outside {placeholders}, pads by about 35% and brackets the result. */
export function pseudoText(template: string): string {
  let out = "", depth = 0, letters = 0;
  for (const ch of template) {
    if (ch === "{") depth++;
    if (depth === 0) { out += ACCENT[ch] ?? ch; if (/[A-Za-z]/.test(ch)) letters++; } else out += ch;
    if (ch === "}" && depth > 0) depth--;
  }
  return PSEUDO_OPEN + out + (letters ? " " + "·".repeat(Math.ceil(letters * 0.35)) : "") + PSEUDO_CLOSE;
}
const pseudoMessage = (m: Message): Message => typeof m === "string" ? pseudoText(m) : Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pseudoText(v as string)])) as Plural;

let pseudoCache: Catalog | null = null;
export function catalog(locale: Locale): Catalog {
  if (locale === "es") return es;
  if (locale === "fr") return fr;
  if (locale === "fr-CA") return { ...fr, ...frCA } as Catalog;
  if (locale === "pseudo") return pseudoCache ??= Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudoMessage(v as Message)])) as Catalog;
  return en as Catalog;
}

// ---------------------------------------------------------------- formatting
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>();
function memo<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined; if (!v) { v = make(); cache.set(key, v); } return v;
}
const numberFormat = (locale: Locale, min: number, max: number) => memo(`n|${locale}|${min}|${max}`, () => new Intl.NumberFormat(INTL_TAG[locale], { minimumFractionDigits: min, maximumFractionDigits: max }));
/** Exact decimal text such as "-1234.50" in the locale's digits and separators; other text is returned unchanged. */
export function decimal(locale: Locale, value: string | number | bigint, digits?: number): string {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const places = digits ?? (text.split(".")[1]?.length ?? 0);
  // Intl.NumberFormat formats decimal strings exactly (no float rounding of large cents values).
  return numberFormat(locale, places, places).format(text as unknown as number);
}
/** Whole cents as a numeric input/export amount. UI money uses currency(), with the vault currency. */
export function money(locale: Locale, cents: string | bigint): string {
  const c = BigInt(cents), neg = c < BigInt(0), abs = neg ? -c : c, hundred = BigInt(100);
  return decimal(locale, `${neg ? "-" : ""}${abs / hundred}.${(abs % hundred).toString().padStart(2, "0")}`, 2);
}
/**
 * Whole cents in the workspace currency. The caller supplies the encrypted-vault setting;
 * USD is the backward-compatible default for old vaults and standalone legacy callers.
 */
export function currency(locale: Locale, cents: string | bigint, code = "USD"): string {
  const c = BigInt(cents), neg = c < BigInt(0), abs = neg ? -c : c, hundred = BigInt(100);
  const text = `${neg ? "-" : ""}${abs / hundred}.${(abs % hundred).toString().padStart(2, "0")}`;
  return memo(`c|${locale}|${code}`, () => new Intl.NumberFormat(INTL_TAG[locale], { style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 })).format(text as unknown as number);
}
export const integer = (locale: Locale, value: string | number | bigint) => decimal(locale, String(value), 0);
/** "12.34%" (the worker's rate text) or a plain number of percent, in the locale's percent style. "n/a" stays a message. */
export function percent(locale: Locale, value: string | number): string {
  const text = String(value).trim().replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return translate(locale, "common.notApplicable");
  const places = text.split(".")[1]?.length ?? 0;
  return memo(`p|${locale}|${places}`, () => new Intl.NumberFormat(INTL_TAG[locale], { style: "percent", minimumFractionDigits: places, maximumFractionDigits: places })).format(Number(text) / 100);
}
/** A calendar date ("2025-03-01") or a timestamp, in the locale's medium date style. */
export function date(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return translate(locale, "common.none");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso), when = new Date(day ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(when.getTime())) return iso;
  return memo(`d|${locale}|${day}`, () => new Intl.DateTimeFormat(INTL_TAG[locale], day ? { dateStyle: "medium", timeZone: "UTC" } : { dateStyle: "medium" })).format(when);
}
export function dateTime(locale: Locale, iso: string | null | undefined, utc = false): string {
  if (!iso) return translate(locale, "common.none");
  const when = new Date(iso); if (Number.isNaN(when.getTime())) return iso;
  return memo(`dt|${locale}|${utc}`, () => new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: "medium", timeStyle: "short", ...(utc ? { timeZone: "UTC" } : {}) })).format(when);
}
/** A month key ("2025-03") as "Mar 2025". */
export function month(locale: Locale, key: string): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  return memo(`m|${locale}`, () => new Intl.DateTimeFormat(INTL_TAG[locale], { month: "short", year: "numeric", timeZone: "UTC" })).format(new Date(key + "-01T00:00:00Z"));
}
/** A list joined the locale's way ("A, B and C"). */
export function list(locale: Locale, items: string[]): string {
  return new Intl.ListFormat(INTL_TAG[locale], { style: "long", type: "conjunction" }).format(items);
}

// ---------------------------------------------------------------- translation
/** Marks the start of a message reference inside text that crosses the worker boundary. */
export const REF = "⁣";
function param(locale: Locale, value: Param): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return Number.isInteger(Number(value)) ? integer(locale, value) : decimal(locale, String(value));
  return value.includes(REF) ? say(locale, value) : value;
}
export function interpolate(locale: Locale, template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? param(locale, params[name]) : whole);
}
export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  const book = catalog(locale), m: Message | undefined = book[key] ?? (en as Catalog)[key];
  if (m === undefined) return String(key);
  if (typeof m === "string") return interpolate(locale, m, params);
  const n = Number(params.count ?? 0), rule = memo(`r|${locale}`, () => new Intl.PluralRules(INTL_TAG[locale])).select(n) as keyof Plural;
  return interpolate(locale, (n === 1 && m.one) || m[rule] || m.other, params);
}

// The key and params travel as Unicode tag characters (U+E0020-U+E007E mirror printable ASCII).
// They are invisible, so text that is shown without say() still reads as plain English.
const TAG = 0xe0000;
const hide = (ascii: string) => Array.from(ascii, c => String.fromCodePoint(TAG + c.charCodeAt(0))).join("");
const reveal = (tags: string) => Array.from(tags, c => { const p = c.codePointAt(0)! - TAG; return p >= 0x20 && p <= 0x7e ? String.fromCharCode(p) : ""; }).join("");
const asciiJson = (value: unknown) => JSON.stringify(value).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
/**
 * A message reference for text created in the worker (errors, findings, reports, checklist).
 * It reads as English (so logs, exports and unit tests stay language-neutral English) and
 * carries the key invisibly, so the UI shows it in the chosen language with say().
 */
export function msg(key: MessageKey, params: Params = {}): string {
  const plain: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) plain[k] = typeof v === "bigint" ? v.toString() : v;
  return plainText(translate("en", key, params)) + REF + hide(asciiJson([key, plain])) + REF;
}
const TIER_KEY: Record<string, MessageKey> = { starter: "tier.starter", professional: "tier.professional", scale: "tier.scale" };
/** A licence tier's display name as a message reference, for use inside worker messages. */
export const tierRef = (tier: string) => tier in TIER_KEY ? msg(TIER_KEY[tier]) : tier;
/** Renders a worker message reference (or returns other text unchanged) in the given language. */
export function say(locale: Locale, text: string | null | undefined): string {
  if (!text) return "";
  const at = text.indexOf(REF);
  if (at < 0) return text;
  // References joined with spaces ("Merged 2 groups. You can undo…") keep the space between them.
  const end = text.indexOf(REF, at + 1), tail = end < 0 ? "" : text.slice(end + 1), lead = /^\s*/.exec(text)![0];
  try {
    const [key, params] = JSON.parse(reveal(text.slice(at + 1, end < 0 ? undefined : end))) as [MessageKey, Params];
    if (typeof key !== "string" || !(key in en)) return plainText(text);
    return lead + translate(locale, key, params ?? {}) + (tail ? say(locale, tail) : "");
  } catch { return plainText(text); }
}
/** English text without the message reference, for exports, audit details and logs. */
export function plainText(text: string): string {
  return text.includes(REF) ? text.replace(/⁣[\u{E0000}-\u{E007F}]*⁣?/gu, "") : text;
}
export const isRef = (text: unknown): text is string => typeof text === "string" && text.includes(REF);
