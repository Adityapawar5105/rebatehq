import { licenceWritable, lowerTier, type LicenceClaims, type LicenceEnvelope } from '../licence-policy';
import { verifyLicence } from '../licence-verify';
import { VaultError, type Action, type Scope, type Tier } from './protocol';
import { msg } from "../i18n/core";
// Roadmap 9.3: read or write is marked beside each command's capability in lib/roles/access.ts (ACTIONS); this re-export keeps old imports working.
export { READ_ONLY_ACTIONS } from "../roles/access";
import { ACTIONS } from "../roles/access";
export class VaultLicence {
  claims: LicenceClaims | null = null;
  offline = false;
  private highWater = 0;
  constructor(private key: string) {}
  async set(envelope: LicenceEnvelope | null, scope: Scope, device: string, offline: boolean) {
    this.claims = null; this.offline = offline;
    if (envelope) { const c = await verifyLicence(envelope,this.key,{userId:scope.userId,workspaceId:scope.tenantId},device); if(c.issued<this.highWater)throw new VaultError('LICENCE',msg("licence.olderLicenceAssertionRejected")); this.highWater=c.issued;this.claims=c; }
  }
  get writable() { return licenceWritable(this.claims,Date.now(),this.offline); }
  get tier(): Tier { return this.claims?.tier ?? 'starter'; }
  effective(tier:Tier) { return lowerTier(tier,this.tier); }
  assert() { if (!this.writable) throw new VaultError('LICENCE',this.claims?.reason || msg("licence.yourLicenceIsUnavailable")); }
  guard(action:Action) { if(ACTIONS[action].mode==="write")this.assert(); }
  view() { return {writable:this.writable,tier:this.tier,offline:this.offline,until:this.claims ? String((this.offline?this.claims.offlineUntil:this.claims.expires)*1000) : null,reason:this.writable?'':this.claims?.reason||msg("licence.reconnectToVerifyYour")}; }
}

export function capacitySql(tier:Tier){if(!["starter","professional","scale"].includes(tier))throw new VaultError("LICENCE",msg("licence.unsupportedLicensedTier"));return "UPDATE vault_meta SET tier='"+tier+"' WHERE id=1";}
