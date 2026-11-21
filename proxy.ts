import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

/**
 * CSRF guard for state-changing requests that carry an Origin header. The origin must
 * name the host the browser addressed (X-Forwarded-Host behind a proxy, else Host), the
 * same check Next.js applies to Server Actions. nextUrl reflects the address the server
 * is bound to (for example 0.0.0.0 in a container or CI), so comparing against it
 * rejected every legitimate browser POST there (found by the 7A relay gate, CI #80).
 */
export function originVerdict(origin:string,headers:Headers,fallbackHost:string):"same"|"cross"|"invalid"{
 let url:URL;try{url=new URL(origin);}catch{return "invalid";}
 if(!["http:","https:"].includes(url.protocol))return "invalid";
 const forwarded=headers.get("x-forwarded-host")?.split(",")[0]?.trim();
 const host=(forwarded||headers.get("host")||fallbackHost).toLowerCase();
 return url.host.toLowerCase()===host?"same":"cross";
}
export async function proxy(request:NextRequest){
 const origin=request.headers.get("origin");
 if(origin&&["POST","PUT","PATCH","DELETE"].includes(request.method)){
  const verdict=originVerdict(origin,request.headers,request.nextUrl.host);
  if(verdict!=="same")return new NextResponse(verdict==="invalid"?"Invalid request origin":"Cross-origin request denied",{status:403,headers:{"cache-control":"no-store"}});
 }
 const requestHeaders=new Headers(request.headers);const nonce=randomBytes(18).toString("base64");
 const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||"";let connectOrigin="";try{connectOrigin=new URL(supabaseUrl).origin}catch{}
 const dev=process.env.NODE_ENV!=="production";
 // Header configuration only: local Wasm/workers on the lab and local shell.
 const lab=["/lab/vault","/home"].includes(request.nextUrl.pathname)||request.nextUrl.pathname.startsWith("/spike/");
 // Only engine workers fetch verified in-memory WASM blobs. Page fetch policy
 // stays self-only; no external host or JS unsafe-eval is added.
 const workerAsset=request.nextUrl.pathname.startsWith("/spike/");
 const policy=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":""}${lab?" 'wasm-unsafe-eval'":""}`,...(lab?["worker-src 'self' blob:"]:[]),"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self' data:",`connect-src 'self' ${workerAsset?"blob:":lab?"":connectOrigin}`.trim(),"object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'",...(dev?[]:["upgrade-insecure-requests"])].join("; ");
 requestHeaders.set("x-nonce",nonce);requestHeaders.set("Content-Security-Policy",policy);
 let response=NextResponse.next({request:{headers:requestHeaders}});
 if(supabaseUrl&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){
  const supabase=createServerClient(supabaseUrl,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{cookies:{getAll:()=>request.cookies.getAll(),setAll(values){values.forEach(({name,value})=>request.cookies.set(name,value));requestHeaders.set("cookie",request.cookies.toString());response=NextResponse.next({request:{headers:requestHeaders}});values.forEach(({name,value,options})=>response.cookies.set(name,value,options));}}});
  await supabase.auth.getClaims();
 }
 response.headers.set("Content-Security-Policy",policy);response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Referrer-Policy","strict-origin-when-cross-origin");response.headers.set("X-Frame-Options","DENY");response.headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");response.headers.set("Cross-Origin-Opener-Policy","same-origin");if(!dev)response.headers.set("Strict-Transport-Security","max-age=63072000; includeSubDomains; preload");
 return response;
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]};
