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
  const relay = readFileSync("components/local/RelayPanel.tsx", "utf8");
  assert.match(relay, /<Tabs\b/, "RelayPanel should use the shared Tabs component");
  assert.doesNotMatch(relay, /role="group"[^>]*tabsLabel|aria-pressed=\{tab/, "RelayPanel still has a pressed-button tab group");
  // 23 Nov 2026 (blueprint section 22, item 36): the Quotes pages are sidebar links; the view reads its page from the hash.
  const quotes = readFileSync("components/local/QuotesView.tsx", "utf8");
  assert.doesNotMatch(quotes, /<Tabs\b|role="group"[^>]*tabsLabel|aria-pressed=\{tab/, "QuotesView should not draw its own tab list");
  assert.match(quotes, /#quotes-\(check\|new\|inbox\|history\|winloss\)/, "QuotesView should read its page from the hash");
  assert.match(quotes, /markSubPage\(/, "QuotesView should keep the hash in step when it moves itself");
  assert.match(readFileSync("components/local/HomeView.tsx", "utf8"), /nextTabIndex\(/, "Home tabs should use the shared key rule");
});
