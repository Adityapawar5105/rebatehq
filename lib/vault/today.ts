// "Today" for business dates (audit B-4, 20 Nov 2026; decision D4: the device's own time zone). Price-export effective
// dates, expiry windows, dead-stock age, rebate periods and report windows use the calendar date where the person is,
// not the UTC date, which is already tomorrow from late afternoon in the Americas. Timestamps stay UTC (toISOString).
/** The device's local calendar date as YYYY-MM-DD. */
export function businessToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** A calendar date moved by whole days. Pure date arithmetic: no time zone is involved. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}
/** The first day of the device's local calendar year. */
export function yearStart(now: Date = new Date()): string { return `${now.getFullYear()}-01-01`; }
/** The last day of the device's local calendar year. */
export function yearEnd(now: Date = new Date()): string { return `${now.getFullYear()}-12-31`; }
/** The device's local calendar date of a stored UTC timestamp (a price run's run_date): its effective date in exports. */
export function businessDate(at: string): string { return businessToday(new Date(at)); }
