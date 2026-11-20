// Audit B-4 (20 Nov 2026): "today" for business dates is the device's local calendar date, not the UTC date.
import test from "node:test";
import assert from "node:assert/strict";
import { addDays, businessDate, businessToday, yearEnd, yearStart } from "../lib/vault/today";

test("a stored UTC run time maps to the local business date used as the export's effective date", () => {
  const run = "2026-11-20T23:30:00.000Z"; // a price preview run at 3:30 pm in Los Angeles
  assert.equal(inZone("America/Los_Angeles", () => businessDate(run)), "2026-11-20", "the ERP effective date must not be tomorrow");
  assert.equal(inZone("Asia/Kolkata", () => businessDate(run)), "2026-11-21");
});

function inZone<T>(tz: string, run: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try { return run(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}

test("the business date follows the device's time zone, not UTC", () => {
  const evening = new Date("2026-11-20T23:30:00Z"); // 3:30 pm in Los Angeles, already 21 Nov in UTC+5:30
  assert.equal(inZone("America/Los_Angeles", () => businessToday(evening)), "2026-11-20");
  assert.equal(inZone("America/New_York", () => businessToday(evening)), "2026-11-20");
  assert.equal(inZone("Asia/Kolkata", () => businessToday(evening)), "2026-11-21");
  assert.equal(inZone("UTC", () => businessToday(evening)), "2026-11-20");
  const newYear = new Date("2027-01-01T03:00:00Z"); // still 31 Dec 2026 in Los Angeles
  assert.deepEqual(inZone("America/Los_Angeles", () => [businessToday(newYear), yearStart(newYear), yearEnd(newYear)]), ["2026-12-31", "2026-01-01", "2026-12-31"]);
});

test("addDays is plain calendar arithmetic, across month, year and leap days", () => {
  assert.equal(addDays("2026-11-20", -364), "2025-11-21");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(inZone("America/Los_Angeles", () => addDays("2026-03-08", 1)), "2026-03-09", "daylight saving does not shift a calendar date");
});
