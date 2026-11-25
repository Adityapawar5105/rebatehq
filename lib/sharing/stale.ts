// Team sharing: when a received copy counts as old. A hand-off file ages from when it was published (S1); a relay copy
// (S3) only when this device has not synced for a week, since a publisher with nothing new to send does not make it old.
export const STALE_DAYS = 7;
export const daysSince = (iso: string | null, now = Date.now()) => iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000)) : 0;
