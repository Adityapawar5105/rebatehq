import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
/** Called only after server-side Supabase getUser verification; never trust request JSON for these IDs. */
export async function setRequestIdentity(db: Pick<PoolClient,"query">, subject: string, actor = subject, secret = process.env.ACTOR_SIGNING_SECRET) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Server actor signing is not configured.");
  const r = await db.query<{pid:number;tx:string}>("SELECT pg_backend_pid() AS pid,txid_current()::text AS tx");
  const payload = JSON.stringify({ sub:subject||null, actor:actor||null, pid:r.rows[0].pid, tx:r.rows[0].tx, exp:Math.floor(Date.now()/1000)+300, nonce:randomUUID() });
  const signature = createHmac("sha256",Buffer.from(secret,"hex")).update(payload).digest("hex");
  await db.query("SELECT set_config('app.identity_payload',$1::text,true),set_config('app.identity_signature',$2::text,true)",[payload,signature]);
  await db.query("SELECT public.verified_request_actor()");
}
