import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextTabIndex } from "../components/ui/tabKeys";

test("roadmap 8.1: tab keys move with wrap-around, Left goes back, Home and End jump", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 1, 3), 0, "Left goes back");
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 0, 3), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
});

test("roadmap 8.1 and 8.3: in-page tab lists use the shared Tabs component, not pressed-button groups", () => {
  for (const file of ["components/local/QuotesView.tsx", "components/local/RelayPanel.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /<Tabs\b/, `${file} should use the shared Tabs component`);
    assert.doesNotMatch(src, /role="group"[^>]*tabsLabel|aria-pressed=\{tab/, `${file} still has a pressed-button tab group`);
  }
  assert.match(readFileSync("components/local/HomeView.tsx", "utf8"), /nextTabIndex\(/, "Home tabs should use the shared key rule");
});
