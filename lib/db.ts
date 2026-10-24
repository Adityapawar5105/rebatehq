import { Pool, type PoolClient } from "pg";
import { isIP } from "node:net";

export type DbContext = {
  userId?: string;
  actorId?: string;
  realActorId?: string;
  headers?: Headers;
};

type GlobalPool = typeof globalThis & { __margindeskPool?: Pool };
const globalPool = globalThis as GlobalPool;

function getPool(): Pool {
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) throw new Error("Database is not configured. Set APP_DATABASE_URL to the dedicated NOBYPASSRLS app login.");
  if (!globalPool.__margindeskPool) {
    const local = /(?:localhost|127\.0\.0\.1)/i.test(connectionString);
    globalPool.__margindeskPool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 4),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      ssl: local ? false : { rejectUnauthorized: true },
      application_name: "margindesk-web"
    });
    globalPool.__margindeskPool.on("error", (error) => console.error(JSON.stringify({ event: "database.pool_error", name: error.name })));
  }
  return globalPool.__margindeskPool;
}

export async function withDatabase<T>(context: DbContext, operation: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const login = await db.query<{ rolsuper: boolean; rolbypassrls: boolean; app_member: boolean }>(
      `SELECT r.rolsuper,r.rolbypassrls,pg_has_role(session_user,'margindesk_app','member') AS app_member
       FROM pg_roles r WHERE r.rolname=session_user`
    );
    const loginRole = login.rows[0];
    if (!loginRole || loginRole.rolsuper || loginRole.rolbypassrls || !loginRole.app_member) {
      throw new Error("APP_DATABASE_URL must use a NOSUPERUSER NOBYPASSRLS login that is a member of margindesk_app.");
    }
    await db.query("SET LOCAL ROLE margindesk_app");
    const subject = context.userId || "";
    await db.query("SELECT set_config('request.jwt.claim.sub',$1::text,true), set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claims',$2::text,true)", [subject, JSON.stringify({ sub: subject || null, role: "authenticated" })]);
    await db.query("SELECT set_config('app.real_actor_id',$1::text,true), set_config('app.client_ip',$2::text,true), set_config('app.user_agent',$3::text,true)", [context.realActorId || context.actorId || context.userId || "", clientIp(context.headers), context.headers?.get("user-agent") || ""]);
    await db.query("SET LOCAL statement_timeout='8s'");
    const value = await operation(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (globalPool.__margindeskPool) {
    await globalPool.__margindeskPool.end();
    delete globalPool.__margindeskPool;
  }
}

export function clientIp(headers?: Headers): string {
  const value = headers?.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || headers?.get("x-real-ip")?.trim()
    || headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "";
  return isIP(value) ? value : "";
}
