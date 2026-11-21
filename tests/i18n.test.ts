// Chunk 7U: message-key i18n. No hard-coded user-facing strings in the product UI, every key
// translated in every shipped language with the same placeholders, a pseudo-locale that exposes
// untranslated or truncated text, worker message references, and Intl formatting.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { en } from "../lib/i18n/locales/en";
import { es } from "../lib/i18n/locales/es";
import { fr } from "../lib/i18n/locales/fr";
import { frCA } from "../lib/i18n/locales/fr-CA";
import { LOCALES, PSEUDO_CLOSE, PSEUDO_OPEN, catalog, currency, date, decimal, integer, money, msg, percent, plainText, pseudoText, say, translate, type Message, type MessageKey } from "../lib/i18n/core";
import { TERMS } from "../lib/ui/glossary";

const KEYS = Object.keys(en) as MessageKey[];
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
/**
 * The product UI covered by 7U: every page and component (the legacy pages were retired in roadmap 13.3). Out of scope: app/api/**.
 */
const UI_FILES = [...walk("components"), ...walk("app")].map(f => f.split(path.sep).join("/"))
  .filter(f => f.endsWith(".tsx") && !f.startsWith("app/api/"))
  .filter(f => !["components/GlobalSearch.tsx"].includes(f));
/** Text that is not translated on purpose: product and format names, sample form defaults, CSS values. */
const ALLOWED = new Map<string, string>([
  ["UTF-8", "encoding name"], ["UTF-16 LE", "encoding name"], ["UTF-16 BE", "encoding name"], ["csv", "file format name"], ["xlsx", "file format name"],
  ["NetSuite", "product name"], ["QuickBooks", "product name"], ["Business Central", "product name"], ["HubSpot", "product name"], ["Salesforce", "product name"],
  ["Valves", "sample category default in the pricing form (user data)"], ["SteelWorks", "sample supplier default in the pricing form (user data)"],
]);
const SECTION_IDS = new Set(["Home", "Data Hub", "Margin", "Pricing", "Reports", "Settings"]);
const VISIBLE_ATTRS = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description", "summary", "aria-roledescription"]);
const NON_UI_CALLS = new Set(["t", "msg", "say", "require", "call", "querySelector", "getElementById", "getItem", "setItem", "includes", "startsWith", "endsWith", "split", "replace", "replaceAll", "join", "test", "addEventListener", "removeEventListener", "dispatchEvent", "CustomEvent", "Blob", "createElement", "toLocaleLowerCase", "padStart", "find", "filter", "map", "some", "fetch", "redirect", "can", "Error"]);

function violations(file: string): string[] {
  const src = readFileSync(file, "utf8"), sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), out: string[] = [];
  const where = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const allowed = (text: string) => ALLOWED.has(text.trim()) || text in en || SECTION_IDS.has(text) || /^var\(--[a-z0-9-]+\)$/.test(text) || /^\d+(\.\d+)?(vh|vw|px|rem|em|%)( auto)?$/.test(text);
  const words = (text: string) => /[A-Za-z]{3,}/.test(text) || /\b[A-Z][a-z]\b/.test(text);
  /** Nearest meaningful parent: skips parentheses, ternaries and ||/&&/?? so `{x ? "text" : y}` counts as JSX content. */
  const owner = (n: ts.Node) => { let p = n.parent; while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind)) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p))) p = p.parent; return p; };
  const callee = (c: ts.CallExpression | ts.NewExpression) => { const e = c.expression; return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ""; };
  function literal(n: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression) {
    const text = ts.isTemplateExpression(n) ? n.head.text + n.templateSpans.map(s => "{}" + s.literal.text).join("") : n.text;
    if (!words(text) || allowed(text)) return;
    // Outside JSX, only sentence-like text counts: a setter called with "inbox" is an id, not a message.
    const sentence = /\s/.test(text.trim()) || /^[A-Z][a-z]/.test(text) || /[.!?…:]$/.test(text);
    const p = owner(n);
    if (!p) return;
    if (ts.isJsxExpression(p)) {
      const host = p.parent;
      if (ts.isJsxAttribute(host) && !VISIBLE_ATTRS.has(host.name.getText())) return;
      out.push(`${where(n)} ${JSON.stringify(text)}`); return;
    }
    if (ts.isJsxAttribute(p)) { if (VISIBLE_ATTRS.has(p.name.getText())) out.push(`${where(n)} ${JSON.stringify(text)}`); return; }
    // Text handed to state setters or thrown is rendered later.
    if (sentence && (ts.isCallExpression(p) || ts.isNewExpression(p)) && !NON_UI_CALLS.has(callee(p)) && /^set[A-Z]/.test(callee(p))) { out.push(`${where(n)} ${JSON.stringify(text)}`); return; }
    if (sentence && ts.isNewExpression(p) && callee(p) === "Error") out.push(`${where(n)} ${JSON.stringify(text)}`);
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && words(n.text) && !allowed(n.text.trim())) out.push(`${where(n)} ${JSON.stringify(n.text.trim())}`);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) { literal(n); if (ts.isTemplateExpression(n)) n.templateSpans.forEach(s => visit(s.expression)); return; }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test("7U: no hard-coded user-facing strings remain in the product UI", () => {
  assert.ok(UI_FILES.length >= 30, `expected the whole UI in scope, found ${UI_FILES.length} files`);
  const found = UI_FILES.flatMap(violations);
  assert.deepEqual(found, [], "Move these strings to lib/i18n/locales/en.ts and render them with t():\n" + found.join("\n"));
});

test("7U: the scanner catches the hard-coded string shapes it must catch", () => {
  const probe = path.join(tmpdir(), `i18n-probe-${process.pid}.tsx`);
  const cases = `export function X({ a }: { a: boolean }) { const [m, setM] = useState(""); setM("Saved the thing.");
    return <p title="Hover text">Plain words {a ? "detected" : "manual"} {\`Count \${a}\`}<b aria-label={"Close panel"}/>{t("common.close")}</p>; }`;
  writeFileSync(probe, cases);
  const hits = violations(probe).map(v => v.split(" ").slice(1).join(" "));
  for (const expected of ['"Saved the thing."', '"Hover text"', '"Plain words"', '"detected"', '"manual"', '"Count {}"', '"Close panel"']) assert.ok(hits.includes(expected), `scanner missed ${expected}: ${hits.join(" | ")}`);
  assert.equal(hits.length, 7, hits.join(" | "));
});

const placeholders = (m: Message) => new Set((typeof m === "string" ? [m] : Object.values(m)).flatMap(v => [...String(v).matchAll(/\{(\w+)\}/g)].map(x => x[1])));
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

test("7U: every shipped language translates every key with the same placeholders and plural shape", () => {
  assert.deepEqual([...LOCALES], ["en", "es", "fr", "fr-CA"]);
  for (const [name, book] of [["es", es], ["fr", fr], ["fr-CA", catalog("fr-CA")]] as const) {
    const extra = Object.keys(book).filter(k => !(k in en)); assert.deepEqual(extra, [], `${name} has keys English does not`);
    for (const key of KEYS) {
      const source = en[key] as Message, target = (book as Record<string, Message>)[key];
      assert.ok(target !== undefined && target !== "", `${name} is missing ${key}`);
      assert.ok(same(placeholders(source), placeholders(target)), `${name} ${key}: placeholders ${[...placeholders(target)]} differ from English ${[...placeholders(source)]}`);
      assert.equal(typeof target, typeof source, `${name} ${key}: plural shape differs from English`);
      if (typeof target === "object") assert.ok(target.other, `${name} ${key}: a plural needs "other"`);
    }
  }
  for (const k of Object.keys(frCA)) assert.ok(k in en, `fr-CA override ${k} is not an English key`);
});

test("7U: Spanish and French are real translations, not copies of English", () => {
  const prose = KEYS.filter(k => { const v = en[k] as Message; const s = typeof v === "string" ? v : v.other; return s.replace(/\{\w+\}/g, "").split(/\s+/).filter(w => /[a-z]{3,}/i.test(w)).length >= 3; });
  assert.ok(prose.length > 300, `expected many prose messages, found ${prose.length}`);
  for (const [name, book] of [["es", es], ["fr", fr]] as const) {
    const copied = prose.filter(k => JSON.stringify((book as Record<string, Message>)[k]) === JSON.stringify(en[k]));
    assert.ok(copied.length <= prose.length * 0.02, `${name}: ${copied.length} of ${prose.length} prose messages are unchanged English, e.g. ${copied.slice(0, 5).join(", ")}`);
  }
});

test("7U: every key is used, and every glossary term has a name and a definition", () => {
  const sources = [...walk("components"), ...walk("lib"), ...walk("app")].filter(f => /\.(ts|tsx)$/.test(f) && !f.includes(`${path.sep}locales${path.sep}`)).map(f => readFileSync(f, "utf8")).join("\n");
  const unused = KEYS.filter(k => !k.startsWith("glossary.") && !sources.includes(JSON.stringify(k)) && !sources.includes(`'${k}'`));
  assert.deepEqual(unused, [], "Remove unused keys from every catalog");
  for (const id of TERMS) for (const k of [`glossary.${id}`, `glossary.${id}.def`]) assert.ok(k in en, `glossary key ${k} is missing`);
});

test("7U: the pseudo-locale accents, pads and brackets every message and keeps its placeholders", () => {
  assert.equal(pseudoText("Save {count} rows"), "⟦Šàvé {count} ŕöŵš ···⟧");
  const book = catalog("pseudo");
  for (const key of KEYS) {
    const m = book[key], branches = typeof m === "string" ? [m] : Object.values(m) as string[];
    for (const b of branches) assert.ok(b.startsWith(PSEUDO_OPEN) && b.endsWith(PSEUDO_CLOSE), `${key} is not bracketed`);
    assert.ok(same(placeholders(m), placeholders(en[key] as Message)), `${key} lost a placeholder in the pseudo-locale`);
  }
  const words = translate("pseudo", "shell.passphraseNote"), english = translate("en", "shell.passphraseNote");
  assert.ok(words.length >= english.length * 1.3, "pseudo text must be at least 30% longer to expose truncation");
  assert.ok(!/[A-Za-z]{4,}/.test(words.replace(/\{\w+\}/g, "")), "pseudo text must not contain plain English words");
});

test("7U: worker message references read as English, carry their key invisibly and translate on screen", () => {
  const ref = msg("vault.fixCount", { count: 3 });
  assert.equal(plainText(ref), "3 fixes");
  assert.ok(/^3 fixes⁣[\u{E0000}-\u{E007F}]+⁣$/u.test(ref), "the key travels as invisible tag characters");
  assert.equal(say("fr", ref), translate("fr", "vault.fixCount", { count: 3 }));
  assert.notEqual(say("es", ref), "3 fixes");
  // Nested references (a role label inside a sentence) and concatenated references both translate.
  const nested = msg("role.withNamedOwner", { role: msg("role.owner") });
  assert.equal(plainText(nested), "Owner / CFO · named Pricing Owner");
  assert.equal(say("es", nested), translate("es", "role.withNamedOwner", { role: translate("es", "role.owner") }));
  const two = msg("cleanup.merged", { count: 2 }) + " " + msg("cleanup.undoWholeBatch");
  assert.equal(say("fr", two), translate("fr", "cleanup.merged", { count: 2 }) + " " + translate("fr", "cleanup.undoWholeBatch"));
  // Non-ASCII params survive; unknown keys and plain text fall back safely.
  assert.equal(say("en", msg("roles.removed", { name: "Zoë Müller" })), "Zoë Müller was removed.");
  assert.equal(say("fr", "plain text"), "plain text");
  assert.equal(plainText("A⁣\u{E005B}⁣ B"), "A B", "a reference is stripped; the text around it stays");
});

test("7U: plurals follow each language's rules", () => {
  assert.equal(translate("en", "margin.lineCount", { count: 1 }), "1 line");
  assert.equal(translate("en", "margin.lineCount", { count: 0 }), "0 lines");
  // French treats 0 and 1 as singular; Spanish only 1.
  assert.equal(translate("fr", "margin.lineCount", { count: 0 }), translate("fr", "margin.lineCount", { count: 1 }).replace("1", "0"));
  assert.notEqual(translate("es", "margin.lineCount", { count: 0 }), translate("es", "margin.lineCount", { count: 1 }).replace("1", "0"));
});

test("7U: numbers, money, percentages and dates use Intl in every language and stay exact", () => {
  assert.equal(money("en", "123456789012345"), "1,234,567,890,123.45", "exact beyond float precision");
  assert.equal(money("en", "-5"), "-0.05");
  assert.equal(money("fr", "-1234567").replace(/\s/g, " "), "-12 345,67");
  assert.equal(money("es", "123456"), "1,234.56");
  assert.equal(currency("en", "-2750"), "-$27.50");
  assert.match(currency("fr-CA", "2750"), /^27,50\s\$\sUS$/);
  assert.equal(integer("en", "100000"), "100,000");
  assert.equal(decimal("en", "104.50"), "104.50");
  assert.equal(percent("en", "12.34%"), "12.34%");
  assert.equal(percent("fr", "12.34").replace(/\s/g, " "), "12,34 %");
  assert.equal(percent("en", "n/a"), "n/a");
  assert.equal(date("en", "2025-03-01"), "Mar 1, 2025");
  assert.equal(date("fr-CA", "2025-03-01"), "1 mars 2025");
  assert.equal(date("es", "2025-03-01"), "1 mar 2025");
});

test("8.17: storage sizes read in kB, MB or GB with the locale's unit names, never as byte counts", async () => {
  const { bytes } = await import("../lib/i18n/core");
  assert.equal(bytes("en", 123456789), "123 MB");
  assert.equal(bytes("en", 5300), "5.3 kB");
  assert.match(bytes("fr", 2.5e9), /^2,5\s?Go$/);
  assert.match(bytes("fr-CA", 42e6), /^42\s?Mo$/);
  assert.match(bytes("es", 1.2e9), /^1[.,]2\s?GB$/, "Latin-American Spanish uses the locale separator");
  assert.equal(bytes("en", -1), "0 kB");
});
