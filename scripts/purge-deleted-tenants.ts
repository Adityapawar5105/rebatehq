// Operator-only retention job (review R3, 28 Nov 2026): removes workspaces whose Owner deleted them more than 30 days
// ago. For each one it deletes the encrypted pack chunks in Supabase Storage (bucket relay-packs, through the Storage
// API, which is the only supported way), checks none are left, then calls rebatehq_private.purge_deleted_tenant, which
// removes the workspace's rows from all 14 tenant tables and keeps the audit log.
//
//   Dry run (default):  pnpm tsx scripts/purge-deleted-tenants.ts
//   Apply:              CONFIRM_TENANT_PURGE=YES pnpm tsx scripts/purge-deleted-tenants.ts --apply
//
// Needs SEED_DATABASE_URL (the migration administrator), NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or a legacy
// service-role key). These stay on the operator's machine and are never deployed. Nothing secret is printed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const BUCKET = "relay-packs";
export const BATCH = 1000;

/** Object names in batches the Storage delete endpoint accepts. */
export function batches<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Headers for the Storage API, as supabase-js sends them: the same key as `apikey` and as Bearer. */
export function storageHeaders(key: string): Record<string, string> {
  if (!key) throw new Error("SUPABASE_SECRET_KEY is required to delete Storage objects.");
  if (key.startsWith("sb_publishable_")) throw new Error("A publishable key cannot delete Storage objects; use the secret key.");
  return { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" };
}

/** One delete request for up to BATCH objects of one workspace. Every name must sit under that workspace's prefix. */
export function deleteRequest(base: string, key: string, tenant: string, names: readonly string[]): { url: string; init: RequestInit } {
  if (!/^[0-9a-f-]{36}$/.test(tenant)) throw new Error("Invalid workspace id.");
  if (!names.length || names.length > BATCH) throw new Error("A Storage delete takes 1 to " + BATCH + " names.");
  for (const n of names) if (!n.startsWith(tenant + "/") || n.includes("..")) throw new Error("A Storage object outside the workspace prefix was selected.");
  const url = new URL(`/storage/v1/object/${BUCKET}`, base).toString();
  return { url, init: { method: "DELETE", headers: storageHeaders(key), body: JSON.stringify({ prefixes: names }) } };
}

type Due = { tenant_id: string; name: string; deleted_at: Date; objects: number };

async function main() {
  const apply = process.argv.includes("--apply");
  const dbUrl = process.env.SEED_DATABASE_URL, base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!dbUrl) throw new Error("SEED_DATABASE_URL (the migration administrator) is required.");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
  if (apply && process.env.CONFIRM_TENANT_PURGE !== "YES") throw new Error("Set CONFIRM_TENANT_PURGE=YES after reviewing the dry run.");
  const local = /(localhost|127\.0\.0\.1)/i.test(dbUrl);
  const caFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "certs", "supabase-root-ca.crt");
  const db = new pg.Client({ connectionString: dbUrl, application_name: "rebatehq-tenant-retention",
    ssl: local ? false : { rejectUnauthorized: true, ...(existsSync(caFile) ? { ca: readFileSync(caFile, "utf8") } : {}) } });
  await db.connect();
  try {
    const due = (await db.query<Due>(`SELECT t.tenant_id::text, t.name, t.deleted_at,
        (SELECT count(*)::int FROM storage.objects o WHERE o.bucket_id=$1 AND o.name LIKE t.tenant_id::text || '/%') AS objects
       FROM public.tenant t WHERE t.deleted_at < now() - interval '30 days' ORDER BY t.deleted_at`, [BUCKET])).rows;
    if (!due.length) { process.stdout.write("No workspace is due for purge.\n"); return; }
    if (!apply) {
      process.stdout.write(JSON.stringify({ dryRun: true, due: due.map(d => ({ tenant: d.tenant_id, name: d.name, deletedAt: d.deleted_at, storageObjects: d.objects })) }, null, 2) + "\n");
      return;
    }
    const report = [];
    for (const d of due) {
      // 1. Storage chunks, through the Storage API.
      const names = (await db.query<{ name: string }>("SELECT name FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2 ORDER BY name", [BUCKET, d.tenant_id + "/%"])).rows.map(r => r.name);
      for (const part of batches(names)) {
        const { url, init } = deleteRequest(base, key, d.tenant_id, part);
        const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`Storage refused the delete for ${d.tenant_id} (status ${res.status}); nothing else was removed for it.`);
      }
      const left = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id=$1 AND name LIKE $2", [BUCKET, d.tenant_id + "/%"])).rows[0].n;
      if (left) throw new Error(`${left} Storage objects of ${d.tenant_id} are still there; its rows were not purged.`);
      // 2. The rows, in one transaction.
      await db.query("BEGIN");
      try {
        const counts = (await db.query("SELECT rebatehq_private.purge_deleted_tenant($1::uuid) AS counts", [d.tenant_id])).rows[0].counts;
        await db.query("COMMIT");
        report.push({ tenant: d.tenant_id, storageObjects: names.length, rows: counts });
      } catch (error) { await db.query("ROLLBACK"); throw error; }
    }
    process.stdout.write(JSON.stringify({ purged: report, auditRowsKept: true }, null, 2) + "\n");
  } finally { await db.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: "tenant_purge.failed", message: error instanceof Error ? error.message : "unknown" })); process.exit(1); });
}
