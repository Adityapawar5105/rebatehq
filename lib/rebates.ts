import type { PoolClient } from 'pg';
import RebateEngine from '../rebate-engine.js';

export async function getRebateAudit(db: PoolClient, tenantId: string) {
  const agreements = (await db.query(`SELECT id,name,party_id,party_type,currency,calculation_mode,
    eligible_skus,excluded_skus,period_start::text AS period_start,period_end::text AS period_end
    FROM rebate_agreement WHERE tenant_id=$1 ORDER BY period_end DESC,id`, [tenantId])).rows;
  const tiers = (await db.query('SELECT id,agreement_id,from_amount,to_amount,rate FROM rebate_tier WHERE tenant_id=$1 ORDER BY from_amount,id', [tenantId])).rows;
  const entries = (await db.query(`SELECT id,agreement_id,entry_type,amount,currency,sku,source_ref,occurred_on::text AS occurred_on
    FROM rebate_entry WHERE tenant_id=$1 ORDER BY occurred_on,id`, [tenantId])).rows;
  return agreements.map(agreement => ({ ...agreement, audit: RebateEngine.calculate(agreement,
    tiers.filter(tier => tier.agreement_id === agreement.id), entries.filter(entry => entry.agreement_id === agreement.id)) }));
}
