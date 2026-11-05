// Display names for stable ids that the vault returns (tiers, file roles, cost bases).
import { t, type MessageKey } from "@/lib/i18n";
import type { Tier } from "@/lib/vault/protocol";
const TIER: Record<Tier, MessageKey> = { starter: "tier.starter", professional: "tier.professional", scale: "tier.scale" };
export const tierName = (tier: Tier | string) => tier in TIER ? t(TIER[tier as Tier]) : tier;
