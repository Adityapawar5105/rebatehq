import { setRequestIdentity } from "../lib/request-identity.ts";
// CI-only real local Supabase PKCE login. No auth bypass and no admin key.
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";
export function localUrl(value, label) {
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), `${label} must target the disposable local stack`);
  assert.ok(["http:", "https:"].includes(url.protocol)); return url;
}
/** A disposable local Postgres connection string (postgres:// or postgresql:// on a loopback host). */
export function localDatabaseUrl(value, label) {
  assert.ok(value, `${label} is required`);
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), `${label} must target the disposable local stack`);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), `${label} must be a Postgres connection string`); return url;
}
export async function emailLink(mailUrl, email, authUrl) {
  const mailbox = email.split("@")[0];
  for (let attempt = 0; attempt < 45; attempt++) {
    for (const mode of ["mailpit", "inbucket"]) {
      try {
        const path = mode === "mailpit" ? "/api/v1/messages" : `/api/v1/mailbox/${mailbox}`;
        const response = await fetch(new URL(path, mailUrl), { signal: AbortSignal.timeout(3000) }); if (!response.ok) continue;
        const listing = await response.json(), messages = mode === "mailpit" ? listing.messages : listing;
        for (const message of messages || []) {
          if (mode === "mailpit" && !(message.To || []).some(to => to.Address === email)) continue;
          const id = mode === "mailpit" ? message.ID : message.id;
          const item = await (await fetch(new URL(mode === "mailpit" ? `/api/v1/message/${id}` : `/api/v1/mailbox/${mailbox}/${id}`, mailUrl), { signal: AbortSignal.timeout(3000) })).json();
          const link = extractMagicLink(item, authUrl); if (link) return link;
        }
      } catch { /* Both local mail API shapes are supported; fail after deadline. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Local magic-link email was not received. Check the mail service and redirect configuration; authentication was not skipped.");
}
export function extractMagicLink(item, authUrl) {
  const content = JSON.stringify(item).replaceAll("&amp;", "&").replaceAll("\\u0026", "&");
  const urls = content.match(/https?:\/\/[^\s"<>\\]+/g) || [];
  for (const candidate of urls) {
    const url = new URL(candidate);
    if (["localhost","127.0.0.1","[::1]"].includes(url.hostname) && url.port === authUrl.port && ["http:","https:"].includes(url.protocol) && url.pathname === "/auth/v1/verify") return url.href;
  }
  return null;
}
export async function signInLocal(context, page, base, options = {}) {
  localUrl(base, "App");
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.VAULT_MAIL_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.APP_DATABASE_URL, "Authenticated privacy gate requires a real local Supabase stack (Auth, mail and restricted app DB URL). No synthetic session or configuration is used.");
  const authUrl = localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "Supabase"), mailUrl = localUrl(process.env.VAULT_MAIL_URL, "Mail");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; assert.ok(key && process.env.APP_DATABASE_URL, "Real local-stack environment is required");
  const email = `vault-gate-${crypto.randomUUID()}@example.test`;
  const supabase = createServerClient(authUrl.href, key, { cookies: {
    getAll: async () => (await context.cookies(base)).map(({ name, value }) => ({ name, value })),
    setAll: async values => { await context.addCookies(values.map(({ name, value, options }) => ({ name, value, url: base, httpOnly: Boolean(options.httpOnly), secure: Boolean(options.secure), sameSite: typeof options.sameSite === "string" ? options.sameSite[0].toUpperCase() + options.sameSite.slice(1) : "Lax" }))); },
  } });
  // The existing production email endpoint requires an operator's distributed
  // rate limiter. Exercise the real SDK/PKCE + app callback instead; no fake
  // rate-limit service or production relaxation is introduced for CI.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: new URL("/auth/callback", base).href, shouldCreateUser: true } });
  assert.ok(!error, "Local Supabase could not send the PKCE magic link");
  const link = await emailLink(mailUrl, email, authUrl);
  await page.goto(link); await page.waitForURL(url => ["/setup", "/home", "/login"].includes(url.pathname));
  assert.ok(!new URL(page.url()).searchParams.has("error"), "Magic-link callback rejected the real session");
  const { data, error: userError } = await supabase.auth.getUser(); assert.ok(!userError && data.user?.id, "The local Supabase session was not verified");
  const db = new pg.Client({ connectionString: process.env.APP_DATABASE_URL }); await db.connect();
  let tenant;try{tenant=options.tenantId ?? await createPrivacyWorkspace(db,data.user.id);}finally{await db.end();}
  const seedUrl=new URL(process.env.SEED_DATABASE_URL);assert.ok(['localhost','127.0.0.1','[::1]'].includes(seedUrl.hostname),'Test licence issuer must target the disposable local stack');
  const admin=new pg.Client({connectionString:process.env.SEED_DATABASE_URL});await admin.connect();
  try{await admin.query('BEGIN');
   await seedPrivacyLicence(admin,tenant,data.user.id,email,options);
   await admin.query('COMMIT');}catch(e){await admin.query('ROLLBACK');throw e;}finally{await admin.end();}
  if(options.deviceId)await context.addInitScript(({tenant,user,device})=>localStorage.setItem('rebatehq-device-v1:'+tenant+':'+user,device),{tenant,user:data.user.id,device:options.deviceId});
  // A locked vault shows only the unlock card, with no navigation (blueprint section 22, item 33), so wait for that card.
  await page.goto(new URL("/home", base).href); await page.getByRole("button", { name: /Create encrypted vault|Unlock vault/ }).waitFor();
  return {tenantId:tenant,userId:data.user.id,deviceId:options.deviceId,email};
}

export async function createPrivacyWorkspace(db,userId){
 try{
  await db.query("BEGIN");await db.query("SET LOCAL ROLE rebatehq_app");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1::text,true),set_config('request.jwt.claims',$2::text,true)",[userId,JSON.stringify({sub:userId,role:'authenticated'})]);
  await setRequestIdentity(db,userId);
  const result=await db.query("SELECT public.create_tenant_with_owner($1::text) AS tenant",["Synthetic privacy gate"]);
  await db.query("COMMIT");return result.rows[0].tenant;
 }catch(e){await db.query("ROLLBACK");throw e;}
}

// Test-only operator fixture used by real-auth CI and exercised locally in PGlite.
export async function seedPrivacyLicence(db,tenant,userId,email,options={}){
   if(options.tenantId)await db.query("INSERT INTO membership(tenant_id,user_id,email,role) VALUES($1::uuid,$2::uuid,$3::text,$4::text)",[tenant,userId,email,options.role??'rep']);
   else await db.query("INSERT INTO workspace_licence(tenant_id,tier,valid_until) VALUES($1::uuid,'scale',now()+interval '2 days')",[tenant]);
   await db.query('INSERT INTO licence_seat(tenant_id,user_id) VALUES($1::uuid,$2::uuid)',[tenant,userId]);
   if(options.deviceId){await db.query('INSERT INTO licence_device(id,tenant_id,user_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[options.deviceId,tenant,userId]);await db.query("UPDATE licence_device SET status='active' WHERE id=$1::uuid",[options.deviceId]);}
}
