import { installTestIdentityKey } from './signed-context';
import {readFileSync,readdirSync} from "node:fs";
export const normalizedSql=(sql:string)=>sql.replace(/\s+/g," ").trim();
export async function testDatabase(executed=new Set<string>()){
 const {PGlite}=await import("@electric-sql/pglite"),{pgcrypto}=await import("@electric-sql/pglite/contrib/pgcrypto"),{btree_gist}=await import("@electric-sql/pglite/contrib/btree_gist");
 const db:any=new PGlite({extensions:{pgcrypto,btree_gist}});
 await db.exec(`CREATE SCHEMA extensions;CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 await db.exec(readFileSync("tests/helpers/storage-stub.sql","utf8"));
 for(const n of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort())await db.exec(readFileSync("supabase/migrations/"+n,"utf8"));
 await installTestIdentityKey(db);
 const original=db.query.bind(db);db.query=(sql:string,args?:unknown[])=>{executed.add(normalizedSql(sql));return original(sql,args);};
 return db;
}
export async function tenantCounts(db:any){
 const tables=(await db.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped) ORDER BY c.relname")).rows;
 if(tables.length<15)throw new Error("Expected at least 15 tenant tables after team sharing S2.");
 const counts:Record<string,number>={};for(const t of tables)counts[t.relname]=(await db.query(`SELECT count(*)::integer AS n FROM public."${t.relname}"`)).rows[0].n;
 return counts;
}
