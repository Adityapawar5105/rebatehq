// Roadmap 15.1: scheduled pickup from the remembered import folder. The worker side (reading a real folder, adding,
// planning and importing) runs in the browser gate's converters flow; these are the rules it applies.
import test from "node:test";
import assert from "node:assert/strict";
import { checkPickupSettings, cleanForAuto, pickupDue, PICKUP_EVERY } from "../lib/vault/folder";

test("15.1 pickup is due only when switched on and the last check is old enough", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  assert.equal(pickupDue({ every: 0, auto: false, last: null, result: null }, now), false, "off never runs");
  assert.equal(pickupDue({ every: 15, auto: false, last: null, result: null }, now), true, "never checked runs at once");
  assert.equal(pickupDue({ every: 15, auto: false, last: "2026-11-22T09:50:00Z", result: null }, now), false);
  assert.equal(pickupDue({ every: 15, auto: false, last: "2026-11-22T09:45:00Z", result: null }, now), true);
  assert.equal(pickupDue({ every: 1440, auto: true, last: "2026-11-21T10:00:01Z", result: null }, now), false);
});

test("15.1 settings accept only the offered intervals and a yes/no for automatic import", () => {
  for (const every of PICKUP_EVERY) assert.deepEqual(checkPickupSettings(every, true), { every, auto: true });
  for (const [every, auto] of [[5, false], ["60", false], [60, "yes"], [-15, true], [null, false]] as [unknown, unknown][]) assert.throws(() => checkPickupSettings(every, auto), /how often/);
});

test("15.1 only a batch with nothing to decide is imported without a person", () => {
  const clean = { rejected: "0", warnings: [] as string[], rebateTerms: false, skippedPages: false, capOk: true, replaces: null };
  assert.equal(cleanForAuto(clean, ["sales_history"]), true);
  assert.equal(cleanForAuto(null, ["sales_history"]), false, "no plan");
  assert.equal(cleanForAuto({ ...clean, rejected: "1" }, ["sales_history"]), false, "rejected rows need a confirmation");
  assert.equal(cleanForAuto({ ...clean, warnings: ["x"] }, ["sales_history"]), false, "warnings wait for review");
  assert.equal(cleanForAuto({ ...clean, rebateTerms: true }, ["rebate_agreement"]), false, "rebate terms need a confirmation");
  assert.equal(cleanForAuto(clean, ["purchases"]), false, "purchases need rebate rights, so a person imports them");
  assert.equal(cleanForAuto({ ...clean, skippedPages: true }, ["item_master"]), false, "scanned pages left out");
  assert.equal(cleanForAuto({ ...clean, capOk: false }, ["sales_history"]), false, "over the licence");
  assert.equal(cleanForAuto({ ...clean, replaces: "src" }, ["sales_history"]), false, "a replacement is never automatic");
  assert.equal(cleanForAuto(clean, [null]), false, "a file without a role");
  assert.equal(cleanForAuto(clean, []), false, "an empty batch");
});
