// Home greeting/work tabs and the trimmed command palette (15 Nov 2026, blueprint section 22, item 32).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("an empty palette shows at most five recent picks and four suggested actions", () => {
  // The component imports CSS modules, so its constants are read from source.
  const src = readFileSync("components/local/CommandPalette.tsx", "utf8");
  assert.match(src, /export const SUGGESTED_COUNT = 4, RECENT_COUNT = 5;/);
  const suggested = JSON.parse(src.match(/export const SUGGESTED = (\[[^\]]*\]) as const;/)![1]) as string[];
  assert.ok(suggested.length > 4, "fallbacks for roles that lack a screen");
  assert.match(src, /\.slice\(0, SUGGESTED_COUNT\)/);
  // Typing still searches the whole list plus the worker's role-checked SKU/customer hits.
  assert.match(src, /if \(q\) return \[\.\.\.list\.filter\(/);
});

test("recent SKUs and customers never reach browser storage and are forgotten on lock or role change", () => {
  const src = readFileSync("components/local/CommandPalette.tsx", "utf8");
  const writes = [...src.matchAll(/localStorage\.setItem\(([^;]*)\)/g)].map(m => m[1]);
  assert.equal(writes.length, 1, "one storage write");
  assert.match(writes[0], /next\.filter\(x => !isHit\(x\)\)/, "only screen and command ids are stored");
  assert.match(src, /JSON\.parse\(localStorage\.getItem\(key\) \?\? "\[\]"\)[^\n]*!isHit\(x\)/, "stored hits are ignored on read");
  assert.match(src, /recentHits\.current\.clear\(\); setRecent\(r => r\.filter\(id => !isHit\(id\)\)\); \}, \[client, capsKey\]\)/);
  // The key is scoped to the workspace and user.
  assert.match(readFileSync("components/local/VaultApp.tsx", "utf8"), /storageKey=\{`rebatehq\.palette\.recent:\$\{scope\.tenantId\}:\$\{scope\.userId\}`\}/);
});

test("the Home greeting reads only the caller's own name", () => {
  const src = readFileSync("lib/vault/service.ts", "utf8"), home = src.slice(src.indexOf("async home()"), src.indexOf("async checklist()"));
  assert.match(home, /FROM role_assignments WHERE user_id=\$\{sqlText\(this\.identity\.userId\)\}/);
  assert.match(home, /state\.owner\?\.id === this\.identity\.userId \? state\.owner\.name : null/);
  // The work list is built from reads the role already has: no new worker command. The one write besides naming the
  // Pricing Owner is the first-run start card's "Try the Playground" (20 Nov 2026): shown only to `data` roles, and the
  // worker refuses playgroundLoad to everyone else.
  const view = readFileSync("components/local/HomeView.tsx", "utf8");
  const calls = [...view.matchAll(/client\.call\("([a-zA-Z]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ["home", "playgroundLoad", "pricingOwner", "pricingState", "quoteList"]);
  assert.match(view, /sample === "empty" && has\("data"\) && dataHub && <StartCard/);
});
