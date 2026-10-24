import type { PoolClient } from "pg";
export async function appendAudit(db: PoolClient, input: { tenantId: string; actorId: string; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown }) {
  await db.query(`INSERT INTO audit_log(tenant_id,actor_id,action,entity_type,entity_id,before,after,ip,user_agent)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NULLIF(current_setting('app.client_ip',true),'')::inet,left(current_setting('app.user_agent',true),1000))`, [input.tenantId,input.actorId,input.action,input.entityType,input.entityId || null,input.before == null ? null : JSON.stringify(input.before),input.after == null ? null : JSON.stringify(input.after)]);
}
