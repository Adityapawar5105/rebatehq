import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { clientIp } from "./db";
const localCounters=new Map<string,{count:number;resetAt:number}>();
const limiters=new Map<string,Ratelimit>();
function limiter(limit:number,windowMs:number):Ratelimit|null{
 const url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;if(!url||!token)return null;
 const key=`${limit}:${windowMs}`;let item=limiters.get(key);if(!item){item=new Ratelimit({redis:new Redis({url,token}),limiter:Ratelimit.fixedWindow(limit,`${Math.ceil(windowMs/1000)} s`),analytics:false,prefix:"md:phase1"});limiters.set(key,item)}return item;
}
/** `subject` keys the limit on a signed-in person instead of the client address (review R2: the relay, licence and benchmark
 *  routes). `memoryFallback` lets those abuse guards fall back to a per-instance counter when Upstash is not configured; the
 *  sign-in, invite and workspace routes keep failing closed without it. */
export async function rateLimit(request:Request,action:string,limit=12,windowMs=10*60_000,options:{subject?:string;memoryFallback?:boolean}={}):Promise<{ok:boolean;remaining:number}>{
  // B-9: the same platform-set address as the audit log (lib/db.ts clientIp), never a caller-chosen first hop.
 const ip=clientIp(request.headers)||"unknown";const key=createHash("sha256").update(options.subject?`user:${options.subject}`:ip).digest("hex").slice(0,24);const upstash=limiter(limit,windowMs);
 if(upstash){const result=await upstash.limit(`${action}:${key}`);return{ok:result.success,remaining:result.remaining}}
 if(process.env.NODE_ENV==="production"&&!options.memoryFallback)throw new Error("Production rate limiter is not configured.");
 const now=Date.now(),id=`${action}:${key}`,current=localCounters.get(id);if(!current||current.resetAt<=now){localCounters.set(id,{count:1,resetAt:now+windowMs});return{ok:true,remaining:limit-1}}current.count+=1;return{ok:current.count<=limit,remaining:Math.max(0,limit-current.count)};
}
