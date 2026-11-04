import type { PoolClient } from "pg";
export async function appendAudit(db: PoolClient, input: { tenantId: string; actorId: string; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown }) {
  await db.query('SELECT public.append_control_audit($1::uuid,$2::text,$3::text,$4::text,$5::jsonb,$6::jsonb)',[input.tenantId,input.action,input.entityType,input.entityId||null,input.before==null?null:JSON.stringify(input.before),input.after==null?null:JSON.stringify(input.after)]);
}
