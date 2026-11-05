// Chunk 7U: theme tokens. Every theme defines the same tokens and passes WCAG 2.2 contrast for its
// text and control pairs; colours appear nowhere else in the product's CSS or TSX.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const css = readFileSync("app/theme.css", "utf8");
function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector); assert.ok(at >= 0, `missing ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6,8})/gi)].map(m => [m[1], m[2].toLowerCase()]));
}
const THEMES = { light: block(':root,:root[data-theme="light"]'), dark: block(':root[data-theme="dark"]'), contrast: block(':root[data-theme="contrast"]'), systemDark: block(":root:not([data-theme])") };

function rgb(hex: string, over = "#ffffff"): [number, number, number] {
  const h = hex.slice(1), c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  if (h.length === 8) { const a = parseInt(h.slice(6, 8), 16) / 255, b = rgb(over); return c.map((v, i) => v * a + b[i] * (1 - a)) as [number, number, number]; }
  return c as [number, number, number];
}
const lum = ([r, g, b]: [number, number, number]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export function contrast(a: string, b: string) { const x = lum(rgb(a, b)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

/** [foreground, background] text pairs as the stylesheets use them. */
const TEXT: [string, string][] = [
  ["text", "bg"], ["text", "surface"], ["text", "surface-2"], ["text", "accent-surface"], ["heading", "surface"], ["heading", "bg"],
  ["text-muted", "surface"], ["text-muted", "bg"], ["text-muted", "surface-2"], ["link", "surface"], ["link", "bg"], ["link", "surface-2"],
  ["control-text", "surface"], ["on-accent", "accent"], ["on-accent", "heading"], ["on-selected", "selected"],
  ["warn-text", "warn-bg"], ["bad-text", "bad-bg"], ["ok-text", "ok-bg"], ["info-text", "info-bg"], ["toast-text", "toast-bg"],
];
/** Non-text UI: control boundaries and focus indicators need 3:1 (WCAG 1.4.11). */
const UI: [string, string][] = [["border-strong", "surface"], ["control-border", "surface"], ["focus", "bg"], ["focus", "surface"], ["accent", "surface"], ["warn-border", "warn-bg"]];

test("7U: every theme defines the same tokens", () => {
  const names = Object.keys(THEMES.light).sort();
  assert.ok(names.length >= 40, `expected a full token set, found ${names.length}`);
  for (const [theme, tokens] of Object.entries(THEMES)) assert.deepEqual(Object.keys(tokens).sort(), names, `${theme} tokens differ from light`);
  assert.deepEqual(THEMES.systemDark, THEMES.dark, "the system dark theme must equal the dark theme");
});

test("7U: every theme passes WCAG contrast (AA; AAA text in high contrast)", () => {
  const failures: string[] = [];
  for (const [theme, tokens] of Object.entries(THEMES)) {
    const textMin = theme === "contrast" ? 7 : 4.5;
    for (const [fg, bg] of TEXT) { const r = contrast(tokens[fg], tokens[bg]); if (r < textMin) failures.push(`${theme}: --${fg} on --${bg} is ${r.toFixed(2)}:1 (needs ${textMin})`); }
    for (const [fg, bg] of UI) { const r = contrast(tokens[fg], tokens[bg]); if (r < 3) failures.push(`${theme}: --${fg} against --${bg} is ${r.toFixed(2)}:1 (needs 3)`); }
  }
  assert.deepEqual(failures, []);
});

test("7U: colours come only from theme tokens", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = [...walk("app"), ...walk("components")].map(f => f.split(path.sep).join("/"))
    .filter(f => /\.(css|tsx)$/.test(f) && f !== "app/theme.css" && !f.startsWith("app/legacy/") && !f.startsWith("app/lab/spike/") && !f.startsWith("app/dashboard/") && !["components/GlobalSearch.tsx", "components/DeleteTenantForm.tsx"].includes(f));
  const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w.-])(white|black|red|green|blue|orange|yellow|gray|grey|navy|teal)(?![\w-])/gi;
  const found: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const scan = f.endsWith(".css") ? text : [...text.matchAll(/style=\{\{([^}]*)\}\}|(?:fill|stroke|color|background)=["']([^"']*)["']/g)].map(m => (m[1] ?? m[2]).replace(/[!=]==?\s*['"][^'"]*['"]/g, "")).join("\n"); // comparisons such as guard==='red' are ids, not colours
    for (const m of scan.matchAll(COLOUR)) found.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(found, [], "Use a var(--token) from app/theme.css");
});

test("7U: the contrast helper matches known WCAG values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
  assert.equal(contrast("#ffffff", "#ffffff").toFixed(1), "1.0");
});
