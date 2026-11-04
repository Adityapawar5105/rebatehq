// Metadata only. Scale's provisional cap is deliberately below the blueprint target.
export const LICENCE_LIMITS = {
  starter: { users: 1, locations: 1, products: 20_000, lines: 200_000 },
  professional: { users: 5, locations: null, products: 100_000, lines: 1_000_000 },
  scale: { users: 15, locations: null, products: 200_000, lines: 1_000_000 },
} as const;
export type LicenceTier = keyof typeof LICENCE_LIMITS;
export const ASSERTION_SECONDS = 3600;
export const OFFLINE_GRACE_SECONDS = 86400;
export const REFRESH_MS = 300_000;
export type LicenceClaims = { v: 1; sub: string; workspace: string; device: string; tier: LicenceTier; state: 'active' | 'readonly'; issued: number; expires: number; offlineUntil: number; reason: string };
export type LicenceEnvelope = { payload: string; signature: string };
export const lowerTier = (a: LicenceTier, b: LicenceTier): LicenceTier => ['starter','professional','scale'].indexOf(a) <= ['starter','professional','scale'].indexOf(b) ? a : b;
export function licenceWritable(c: LicenceClaims | null, now = Date.now(), offline = false) {
  return !!c && c.state === 'active' && now >= c.issued * 1000 - 60_000 && now < (offline ? c.offlineUntil : c.expires) * 1000;
}

export function fitsLicenceCapacity(tier:LicenceTier, products:bigint, lines:bigint){const cap=LICENCE_LIMITS[tier];return products>=BigInt(0)&&lines>=BigInt(0)&&products<=BigInt(cap.products)&&lines<=BigInt(cap.lines);}
