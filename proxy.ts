import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

export async function proxy(request:NextRequest){
 const origin=request.headers.get("origin");
 if(origin&&["POST","PUT","PATCH","DELETE"].includes(request.method)){
  try{if(new URL(origin).origin!==request.nextUrl.origin)return new NextResponse("Cross-origin request denied",{status:403,headers:{"cache-control":"no-store"}})}catch{return new NextResponse("Invalid request origin",{status:403,headers:{"cache-control":"no-store"}})}
 }
 const requestHeaders=new Headers(request.headers);const nonce=randomBytes(18).toString("base64");
 const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||"";let connectOrigin="";try{connectOrigin=new URL(supabaseUrl).origin}catch{}
 const dev=process.env.NODE_ENV!=="production";
 const policy=["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":""}`,"style-src 'self' 'unsafe-inline'","img-src 'self' data: blob:","font-src 'self' data:",`connect-src 'self' ${connectOrigin}`.trim(),"object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'",...(dev?[]:["upgrade-insecure-requests"])].join("; ");
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
