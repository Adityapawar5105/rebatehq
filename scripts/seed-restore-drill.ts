import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.SEED_DATABASE_URL;
  if (!databaseUrl) throw new Error("SEED_DATABASE_URL is required for the disposable restore drill.");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: /(?:localhost|127\.0\.0\.1)/i.test(databaseUrl) ? false : { rejectUnauthorized: true },
  });
  try {
    await pool.query(`
      INSERT INTO public.tenant(tenant_id,name,currency,is_demo)
      VALUES ('61000000-0000-4000-8000-000000000001','Restore drill sentinel','USD',true)
      ON CONFLICT (tenant_id) DO NOTHING;
      INSERT INTO public.product(tenant_id,id,sku,name,category,unit_cost,list_price)
      VALUES ('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','RESTORE-SENTINEL','Restore drill sentinel product','Test',1,2)
      ON CONFLICT (tenant_id,id) DO NOTHING;
    `);
    process.stdout.write("Seeded disposable restore sentinel rows.\n");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Could not seed restore drill."}\n`);
  process.exitCode = 1;
});
