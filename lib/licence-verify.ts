import { ASSERTION_SECONDS, OFFLINE_GRACE_SECONDS, LICENCE_LIMITS, type LicenceClaims, type LicenceEnvelope } from './licence-policy';
function bytes(s: string) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export async function verifyLicence(envelope: LicenceEnvelope, key: string, scope: { userId: string; workspaceId: string }, device: string): Promise<LicenceClaims> {
  if (!key || !envelope || envelope.payload.length > 4096 || envelope.signature.length > 200) throw Error('Licence could not be verified. Your vault remains available read-only.');
  const publicKey = await crypto.subtle.importKey('spki', bytes(key), 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', publicKey, bytes(envelope.signature), new TextEncoder().encode(envelope.payload))) throw Error('Invalid licence signature.');
  const c = JSON.parse(envelope.payload) as LicenceClaims;
  if (c.v !== 1 || c.sub !== scope.userId || c.workspace !== scope.workspaceId || c.device !== device || !Object.hasOwn(LICENCE_LIMITS,c.tier) || !['active','readonly'].includes(c.state) || ![c.issued,c.expires,c.offlineUntil].every(Number.isSafeInteger) || c.expires < c.issued || c.expires > c.issued + ASSERTION_SECONDS || c.offlineUntil < c.expires || c.offlineUntil > c.issued + OFFLINE_GRACE_SECONDS || typeof c.reason !== 'string' || c.reason.length > 200) throw Error('Licence is for another user, workspace or device, or has invalid dates.');
  return c;
}
